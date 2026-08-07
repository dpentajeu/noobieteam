if (!window.NTNotifications) {
    const ntKey = (workspaceId) => `nt_ws_notifications_${workspaceId || 'unknown'}`;
    const read = (workspaceId) => {
        try {
            const raw = sessionStorage.getItem(ntKey(workspaceId));
            const data = raw ? JSON.parse(raw) : [];
            return Array.isArray(data) ? data : [];
        } catch (_) {
            return [];
        }
    };
    const readAll = () => {
        const all = [];
        try {
            for (let i = 0; i < sessionStorage.length; i += 1) {
                const key = sessionStorage.key(i);
                if (!key || !key.startsWith('nt_ws_notifications_')) continue;
                const workspaceId = key.replace('nt_ws_notifications_', '');
                read(workspaceId).forEach((n) => {
                    if (n) all.push({ ...n, workspaceId: n.workspaceId || workspaceId });
                });
            }
        } catch (_) {}
        return all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    };
    window.NTNotifications = {
        readAll,
        push(workspaceId, message, options = {}) {
            if (!workspaceId || !message) return read(workspaceId);
            const prev = read(workspaceId);
            if (options.dedupeKey && prev.some((n) => n && n.dedupeKey === options.dedupeKey)) return prev;
            const entry = {
                id: window.generateId ? window.generateId('ntf') : `ntf-${Date.now()}`,
                message,
                createdAt: Date.now(),
                workspaceId,
                workspaceName: options.workspaceName || '',
                type: options.type || 'activity',
                cardId: options.cardId || '',
                dedupeKey: options.dedupeKey || '',
            };
            const next = [entry, ...prev].slice(0, 50);
            try {
                sessionStorage.setItem(ntKey(workspaceId), JSON.stringify(next));
                window.dispatchEvent(new CustomEvent('nt:notifications-changed'));
            } catch (_) {}
            return next;
        },
        remove(notification) {
            if (!notification || !notification.workspaceId) return readAll();
            const next = read(notification.workspaceId).filter((n) => n && n.id !== notification.id);
            try {
                sessionStorage.setItem(ntKey(notification.workspaceId), JSON.stringify(next));
                window.dispatchEvent(new CustomEvent('nt:notifications-changed'));
            } catch (_) {}
            return readAll();
        },
        clearAll() {
            try {
                const keys = [];
                for (let i = 0; i < sessionStorage.length; i += 1) {
                    const key = sessionStorage.key(i);
                    if (key && key.startsWith('nt_ws_notifications_')) keys.push(key);
                }
                keys.forEach((key) => sessionStorage.removeItem(key));
                window.dispatchEvent(new CustomEvent('nt:notifications-changed'));
            } catch (_) {}
            return [];
        },
    };
}

// `color` and `avatar` have no schema default (server/db.js), so any workspace
// not created through the Hub button arrives with both unset. `avatar` still
// needs the initials fallback below.
//
// `color` is recorded on create but no longer drives the tile: the gradient is
// the plain `.nt-tile-gradient` class in index.html rather than Tailwind's
// from-*/to-* utilities. Those utilities set `--tw-gradient-from` to a colour
// *plus* a position, which breaks outright if anything else on the page
// registers that variable as `@property { syntax: "<color>" }` — Tailwind v4
// does exactly that, and a browser extension injecting v4 turned every tile
// transparent. A literal gradient cannot be hijacked that way.
const WH_DEFAULT_COLOR = 'from-blue-400 to-indigo-500';

window.WorkspaceHub = ({ onSelect, onLogout, user, theme, onThemeChange, onUpdateUser, onOpenProfile, urlWsSlug, urlCardId, openMyTasks, onConsumeMyTasks }) => {
            const { showPrompt, showConfirm } = window.useModals();
            const { showToast } = window.useToasts();
            const { t } = window.useTranslation ? window.useTranslation() : { t: k => k };
            const [workspaces, setWorkspaces] = React.useState([]);
            const [loading, setLoading] = React.useState(true);
            // `/my-tasks` is the page's own URL, so a reload comes back here instead
            // of the hub. The `openMyTasks` prop still exists for the hand-off from a
            // board, which sets the path before this mounts.
            const [showMyTasks, setShowMyTasks] = React.useState(() => !!openMyTasks || window.location.pathname === '/my-tasks');
            React.useEffect(() => { if (openMyTasks && onConsumeMyTasks) onConsumeMyTasks(); }, []);
            React.useEffect(() => {
                const syncMyTasksFromUrl = () => setShowMyTasks(window.location.pathname === '/my-tasks');
                window.addEventListener('popstate', syncMyTasksFromUrl);
                return () => window.removeEventListener('popstate', syncMyTasksFromUrl);
            }, []);
            const openMyTasksPage = () => {
                if (window.location.pathname !== '/my-tasks') window.history.pushState({}, '', '/my-tasks');
                setShowMyTasks(true);
            };
            const closeMyTasksPage = () => {
                if (window.location.pathname !== '/') window.history.pushState({}, '', '/');
                setShowMyTasks(false);
            };
    const onSelectRef = React.useRef(onSelect); React.useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
            const [pinPrompt, setPinPrompt] = React.useState({ isOpen: false, pin: '', confirm: '' });
            const [pinError, setPinError] = React.useState('');
            const [pinLoading, setPinLoading] = React.useState(false);
            const [showNotificationDropdown, setShowNotificationDropdown] = React.useState(false);
            const [globalNotifications, setGlobalNotifications] = React.useState(() => window.NTNotifications?.readAll?.() || []);
            const notificationDropdownRef = React.useRef(null);

            React.useEffect(() => {
                const refreshNotifications = () => setGlobalNotifications(window.NTNotifications?.readAll?.() || []);
                const handleClickOutside = (event) => {
                    if (notificationDropdownRef.current && !notificationDropdownRef.current.contains(event.target)) {
                        setShowNotificationDropdown(false);
                    }
                };
                refreshNotifications();
                window.addEventListener('nt:notifications-changed', refreshNotifications);
                window.addEventListener('storage', refreshNotifications);
                document.addEventListener('mousedown', handleClickOutside);
                return () => {
                    window.removeEventListener('nt:notifications-changed', refreshNotifications);
                    window.removeEventListener('storage', refreshNotifications);
                    document.removeEventListener('mousedown', handleClickOutside);
                };
            }, []);

            // Dismissed for this session only (UIUX_ISSUES 2.2). Without this the
            // effect below re-opens the modal on the next `user` change, so a
            // "Later" button would bounce straight back.
            const [pinDismissed, setPinDismissed] = React.useState(false);

            React.useEffect(() => {
                if (!user?.vaultPin && !pinDismissed) {
                    setPinPrompt({ isOpen: true, pin: '', confirm: '' });
                }
            }, [user, pinDismissed]);

            // Skipping here costs nothing: the Vault demands a PIN at point of use
            // (VaultTab has its own creation flow), so the only thing this gate was
            // protecting is still protected.
            const dismissPinPrompt = () => {
                setPinDismissed(true);
                setPinError('');
                setPinPrompt({ isOpen: false, pin: '', confirm: '' });
            };

            window.useEscapeKey(dismissPinPrompt, pinPrompt.isOpen);

            const handleCreatePin = async (e) => {
                if (e && e.preventDefault) e.preventDefault();
                if (pinPrompt.pin !== pinPrompt.confirm) return setPinError(t('alerts.pins_do_not_match'));
                if (pinPrompt.pin.length < 6) return setPinError(t('alerts.pin_min_length'));
                setPinLoading(true);
                try {
                    const userEmail = user?.email;
                    if (!userEmail) throw new Error('User context missing. Please re-login.');

                    const res = await fetch('/api/users/pin', { 
                        method: 'PUT', 
                        headers: {'Content-Type': 'application/json'}, 
                        body: JSON.stringify({ email: userEmail, pin: pinPrompt.pin }) 
                    });
                    
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || 'Failed to save PIN.');

                    if (!data) throw new Error('Empty payload returned from API.');
                    
                    const updatedUser = Object.assign({}, user || {}, { vaultPin: data.vaultPin });
                    onUpdateUser(updatedUser);
                    showToast(t('alerts.payload_secured') || 'Master Vault PIN created successfully. 🔐');
                    setPinPrompt({ isOpen: false, pin: '', confirm: '' });
                } catch (err) {
                    setPinError(err.message);
                } finally {
                    setPinLoading(false);
                }
            };


            React.useEffect(() => {
                fetch('/api/workspaces').then(r => r.json()).then(ws => { 
                    const validWs = Array.isArray(ws) ? ws : [];
                    setWorkspaces(validWs); 
                    setLoading(false); 
                    
                    if (urlWsSlug) {
                        const targetWs = validWs.find(w => w.slug === urlWsSlug || w._id === urlWsSlug || w.id === urlWsSlug);
                        // GET /api/workspaces is unfiltered — it returns every workspace on
                        // the platform — so finding a match here does NOT mean this user may
                        // open it. Deep-linking has to honour the same membership rule the
                        // grid below uses, otherwise a stale or bookmarked URL drops a
                        // non-member straight into someone else's board.
                        const memberEmails = targetWs && Array.isArray(targetWs.members)
                            ? targetWs.members.map(m => (typeof m === 'string' ? m : m && m.userId)).filter(Boolean)
                            : [];
                        const mayOpen = !!targetWs
                            && (user?.systemRole === 'SUPERADMIN' || memberEmails.includes(user?.email));
                        if (mayOpen) {
                            // Delay slightly to let hub render logic finish, then auto-select.
                            // The card id from the pasted link rides along, otherwise the board
                            // opens with no card and the deep link silently loses its target.
                            setTimeout(() => onSelect(targetWs, urlCardId || null), 100);
                        } else {
                            // Unknown or not-ours: drop the dead deep link so the hub renders
                            // and the URL stops pointing somewhere this user cannot go.
                            if (window.location.pathname !== '/') window.history.replaceState({}, '', '/');
                        }
                    }
                }).catch(err => { console.error(err); setWorkspaces([]); setLoading(false); });
            }, []);

            // No longer save to localStorage, only API calls
            // 
            const [viewArchived, setViewArchived] = React.useState(false);

            // Mirrors the server's own check (isSuperAdmin / requireSuperAdmin). The
            // configured admin address and the SUPERADMIN role are different things,
            // and only the role is authoritative — promote a second superadmin in the
            // database and this picks it up with no config change.
            const isAdmin = user?.systemRole === 'SUPERADMIN';
            const [showUserManagement, setShowUserManagement] = React.useState(false);

            // Who may archive, unarchive or destroy a given workspace. Mirrors
            // requireWsOwner on the server: that workspace's OWNER. Superadmin is
            // deliberately not a shortcut here — the server dropped that bypass, so
            // showing the buttons would only produce 403s.
            // Legacy members stored as bare email strings carry no role, so they are
            // never owners — the same rule the server's isOwner() applies.
            const canManage = React.useCallback((ws) => {
                return ((ws && ws.members) || []).some(
                    m => m && typeof m !== 'string' && m.userId === user?.email && m.role === 'OWNER'
                );
            }, [user?.email]);

            React.useEffect(() => { localStorage.setItem('nt_workspaces', JSON.stringify(workspaces)); }, [workspaces]);

            const addWS = () => {
                showPrompt(t('actions.new_workspace') || 'New Workspace', t('labels.enter_workspace_name') || 'Enter workspace name:', async (name) => {
                    if (!name) return;
                    const newWs = { name, color: WH_DEFAULT_COLOR, avatar: window.getInitials(name), archived: false, members: [{ userId: user?.email, role: 'OWNER' }] };
                    const res = await fetch('/api/workspaces', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(newWs) });
                    const saved = await res.json();
                    setWorkspaces(prev => [...prev, saved]);
                    showToast(t('alerts.workspace_initialized') || "New mission workspace initialized! ✨");
                }, false);
            };

            // Previously this fired the request, ignored the result, dropped the card
            // from local state and toasted success — so a failure looked identical to
            // a success until the next refresh brought the workspace back.
            const destroyWorkspace = async (wsId) => {
                try {
                    const res = await fetch(`/api/workspaces/${wsId}`, { method: 'DELETE' });
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) throw new Error(data.error || res.statusText || 'Request failed');
                    setWorkspaces(prev => prev.filter(w => (w.id !== wsId && w._id !== wsId)));
                    showToast(t('alerts.workspace_destroyed') || 'Workspace destroyed.');
                } catch (err) {
                    showToast(err.message, 'error');
                }
            };

            const setArchived = async (id, archived) => {
                try {
                    const res = await fetch(`/api/workspaces/${id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ archived }),
                    });
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) throw new Error(data.error || res.statusText || 'Request failed');
                    setWorkspaces(prev => prev.map(w => ((w.id === id || w._id === id) ? { ...w, archived } : w)));
                    showToast(archived
                        ? (t('alerts.workspace_archived') || 'Workspace archived. 📦')
                        : (t('alerts.workspace_reactivated') || 'Workspace reactivated. 🚀'));
                } catch (err) {
                    showToast(err.message, 'error');
                }
            };

            const toggleArchive = async (e, id, archive) => {
                e.stopPropagation();
                // Re-check here as well as at the button: the server is the real gate,
                // but this keeps a stale render from firing a call that always 403s.
                const target = (workspaces || []).find(w => w.id === id || w._id === id);
                if (!canManage(target)) return;
                if (!archive) {
                    showConfirm(
                        t('actions.archive_workspace') || 'Archive Workspace',
                        t('alerts.confirm_archive_workspace') || 'Are you sure you want to archive this workspace?',
                        () => setArchived(id, true)
                    );
                } else {
                    setArchived(id, false);
                }
            };

            const hdr = window.getHeaderTheme(theme);

            // Membership applies to everyone, superadmin included — the server
            // scopes GET /workspaces the same way, so this is just belt and braces.
            const accessibleWorkspaces = React.useMemo(() => {
                const list = Array.isArray(workspaces) ? workspaces : [];
                return list.filter(w => {
                    // Legacy rows store members as plain email strings rather than
                    // { userId }; mapping m.userId alone yields undefined for those
                    // and hides the workspace from its own members.
                    const memberEmails = (w.members || [])
                        .map(m => (typeof m === 'string' ? m : m && m.userId))
                        .filter(Boolean);
                    return memberEmails.includes(user?.email);
                });
            }, [workspaces, user]);

            const displayWorkspaces = React.useMemo(() => {
                return accessibleWorkspaces.filter(w => w.archived === viewArchived);
            }, [accessibleWorkspaces, viewArchived]);

            const scanWorkspaceNotifications = React.useCallback((ws, nextCards, previousCards = [], initial = false) => {
                const email = user?.email;
                // Notifications pushed here are read back by the board under the same
                // canonical id, so this must not derive its own variant.
                const wsId = window.getWorkspaceCanonicalId(ws);
                if (!email || !wsId || !window.NTNotifications?.push) return;
                const previousById = new Map((previousCards || []).filter(c => c && (c.id || c._id)).map(c => [String(c.id || c._id), c]));
                const nextById = new Map((nextCards || []).filter(c => c && (c.id || c._id)).map(c => [String(c.id || c._id), c]));
                const push = (message, options = {}) => {
                    window.NTNotifications.push(wsId, message, { ...options, workspaceName: ws?.name || '' });
                    setGlobalNotifications(window.NTNotifications.readAll?.() || []);
                };
                const involved = (card) => Array.isArray(card?.assignees) && card.assignees.includes(email);
                const dueSoon = (card) => {
                    if (!card || card.archived || !card.dueDate) return false;
                    const due = new Date(card.dueDate);
                    if (Number.isNaN(due.getTime())) return false;
                    const diffDays = (due - new Date()) / (1000 * 60 * 60 * 24);
                    return diffDays >= 0 && diffDays <= 3;
                };
                // The actor behind a change is whoever appended an audit entry since the
                // previous snapshot, not `auditTrail[last]` — that credits whoever touched
                // the card most recently, so a teammate's move followed by anyone's edit
                // inside one poll window was attributed to the later editor.
                const auditStamp = (entry) => {
                    const time = new Date(entry?.timestamp || 0).getTime();
                    return Number.isNaN(time) ? 0 : time;
                };
                const actorSince = (card, prev, actionPattern) => {
                    const trail = Array.isArray(card?.auditTrail) ? card.auditTrail : [];
                    const seenUntil = (Array.isArray(prev?.auditTrail) ? prev.auditTrail : [])
                        .reduce((max, entry) => Math.max(max, auditStamp(entry)), 0);
                    const added = prev ? trail.filter((entry) => auditStamp(entry) > seenUntil) : trail;
                    const matched = actionPattern ? added.filter((entry) => actionPattern.test(entry?.action || '')) : added;
                    const pool = matched.length ? matched : added;
                    return pool[pool.length - 1]?.user || '';
                };
                const colName = (id) => (ws.columns || []).find(c => c && c.id === id)?.title || id || 'Unknown';
                const commentId = (comment, index) => comment?._id || comment?.id || `${comment?.authorEmail || 'unknown'}:${comment?.timestamp || index}`;

                nextById.forEach((card, cardId) => {
                    const prev = previousById.get(cardId);
                    const title = card.title || 'Untitled card';
                    if (involved(card) && dueSoon(card)) {
                        const dueLabel = new Date(card.dueDate).toLocaleDateString();
                        push(`"${title}" is expiring soon (${dueLabel}).`, { type: 'due-soon', cardId, dedupeKey: `due-soon:${cardId}:${dueLabel}` });
                    }
                    const prevInvolved = involved(prev);
                    const nextInvolved = involved(card);

                    if (initial) return;

                    const previousCommentIds = new Set((Array.isArray(prev?.comments) ? prev.comments : []).map(commentId));
                    (Array.isArray(card.comments) ? card.comments : []).forEach((comment, index) => {
                        const id = commentId(comment, index);
                        if (!Array.isArray(comment?.taggedUsers) || !comment.taggedUsers.includes(email)) return;
                        if (prev && previousCommentIds.has(id)) return;
                        push(`${comment.authorEmail || 'Someone'} mentioned you in "${title}".`, { type: 'mention', cardId, dedupeKey: `mention:${cardId}:${id}` });
                    });

                    // New to the baseline means newly created. Board-wide, so no involvement
                    // check — the Hub only polls workspaces this user belongs to.
                    // Held back while its editor is still open and the title is a
                    // placeholder; the snapshot write excludes it, so it stays new.
                    if (!prev && !window.isCardAwaitingFirstSave(card)) {
                        const creator = actorSince(card, prev, /created/i);
                        // An unattributable card still notifies — only a match on the current
                        // user suppresses it, so a missing audit entry stays visible.
                        if (creator !== email) {
                            push(window.buildCardCreatedMessage(creator, title), { type: 'created', cardId, dedupeKey: `created:${cardId}` });
                        }
                    }
                    // Gated on `prev`: a new card announces itself as created rather than also
                    // telling its creator they were added to their own card.
                    if (prev && !prevInvolved && nextInvolved) {
                        // Assignees only change through a card create/update, so move entries
                        // sharing this poll window must not be credited with the addition.
                        const actor = actorSince(card, prev, /updated|created/i) || 'Someone';
                        push(`${actor} added you to "${title}".`, { type: 'assigned', cardId, dedupeKey: `assigned:${cardId}:${card.updatedAt || Date.now()}` });
                    }
                    if (!prev) return;
                    if (nextInvolved && (prev.columnId || prev.col) !== (card.columnId || card.col)) {
                        push(`"${title}" moved to ${colName(card.columnId || card.col)}.`, { type: 'status', cardId, dedupeKey: `moved:${cardId}:${card.columnId || card.col}:${card.updatedAt || Date.now()}` });
                    }
                    if (prevInvolved && !prev.archived && card.archived) {
                        push(`"${title}" was archived.`, { type: 'archived', cardId, dedupeKey: `archived:${cardId}:${card.updatedAt || Date.now()}` });
                    }
                    // Mirrors the board's QA branch, including the dedupeKey — the board's
                    // immediate socket emit and this poll must not both land.
                    const nextQa = card.qaStatus || 'NONE';
                    if (nextInvolved && (prev.qaStatus || 'NONE') !== nextQa) {
                        push(window.buildQaNotificationMessage(title, nextQa), { type: 'qa', cardId, dedupeKey: `qa:${cardId}:${nextQa}:${card.updatedAt || ''}` });
                    }
                });

                if (!initial) {
                    previousById.forEach((prev, cardId) => {
                        if (nextById.has(cardId) || !involved(prev)) return;
                        push(`"${prev.title || 'Untitled card'}" was deleted.`, { type: 'deleted', cardId, dedupeKey: `deleted:${cardId}:${Date.now()}` });
                    });
                }
            }, [user?.email]);

            // Set by the poll effect; the socket listener calls it to sweep on demand.
            const pollAllProjectsNowRef = React.useRef(null);

            React.useEffect(() => {
                const activeWorkspaces = accessibleWorkspaces.filter(ws => ws && !ws.archived);
                if (!user?.email || activeWorkspaces.length === 0) return;
                let cancelled = false;
                const pollAllProjects = async () => {
                    for (const ws of activeWorkspaces) {
                        // Same derivation the board uses, so both diff against one baseline.
                        const wsId = window.getWorkspaceCanonicalId(ws);
                        if (!wsId) continue;
                        try {
                            const res = await fetch(`/api/workspaces/${wsId}/tasks`);
                            const data = await res.json();
                            if (cancelled) return;
                            const validData = Array.isArray(data) ? data.sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0)) : [];
                            // `initial` is per workspace and decided by whether this tab has a
                            // stored baseline — not by whether this is the first poll of the
                            // mount. A workspace the board already established a baseline for
                            // is diffed against it, so changes made while the board was open
                            // still notify here instead of being absorbed silently.
                            const previous = window.NTCardSnapshots?.read(wsId);
                            scanWorkspaceNotifications(ws, validData, previous || [], !previous);
                            window.NTCardSnapshots?.write(wsId, validData);
                        } catch (e) {
                            console.error(e);
                        }
                    }
                };
                pollAllProjects();
                // Debounced so a burst of writes collapses into one sweep.
                let debounce = null;
                pollAllProjectsNowRef.current = () => {
                    if (debounce) clearTimeout(debounce);
                    debounce = setTimeout(pollAllProjects, 250);
                };
                const interval = setInterval(pollAllProjects, 20000);
                return () => {
                    cancelled = true;
                    if (debounce) clearTimeout(debounce);
                    pollAllProjectsNowRef.current = null;
                    clearInterval(interval);
                };
            }, [accessibleWorkspaces, scanWorkspaceNotifications, user?.email]);

            // The 20s poll above is the floor, not the target: a change has to reach people
            // now, wherever they are sitting. The board keeps its own socket, so this one
            // covers people parked on the dashboard — it joins every workspace they can see
            // and listens on all of them at once. Never both at once: App renders the Hub or
            // the board, never the two together.
            React.useEffect(() => {
                if (!window.io || !user?.email) return;
                const rooms = accessibleWorkspaces
                    .filter(ws => ws && !ws.archived)
                    .map(ws => window.getWorkspaceCanonicalId(ws))
                    .filter(Boolean);
                if (rooms.length === 0) return;
                const socket = window.io(window.location.origin, {
                    path: '/api/socket.io',
                    auth: { token: localStorage.getItem('nt_token') },
                });
                const joinAll = () => rooms.forEach(workspaceId => socket.emit('workspace:join', { workspaceId }));
                // Re-join on every connect, not just the first: rooms are per-connection,
                // so a reconnect that skipped this would go quiet with the socket "up".
                socket.on('connect', joinAll);
                // Any announced task write re-sweeps every workspace and diffs locally, so
                // one handler covers all notification types across all boards.
                socket.on('cards:refresh', () => pollAllProjectsNowRef.current?.());
                return () => socket.disconnect();
            }, [accessibleWorkspaces, user?.email]);

            const homeStyle = user?.homeBackgroundImage ? {
                backgroundImage: `linear-gradient(rgba(255,255,255,0.84), rgba(255,255,255,0.9)), url("${window.getImageUrl(user.homeBackgroundImage)}")`,
                backgroundSize: 'cover',
                backgroundPosition: 'center'
            } : {};

            // Hub notifications span every workspace, so navigating means resolving
            // the board first and then deep-linking to the card inside it.
            const openNotification = (n) => {
                if (!n || !n.cardId) return;
                setShowNotificationDropdown(false);
                const targetWs = (Array.isArray(workspaces) ? workspaces : []).find(
                    w => String(w.id || w._id) === String(n.workspaceId)
                );
                if (!targetWs) {
                    showToast(t('alerts.board_not_found') || 'Board not found for this task.');
                    return;
                }
                onSelectRef.current(targetWs, n.cardId);
            };

            const handleOpenTask = (task) => {
                const targetWs = (Array.isArray(workspaces) ? workspaces : []).find(w => w._id === task.workspaceId || w.id === task.workspaceId);
                if (targetWs) {
                    onSelectRef.current(targetWs, task.id || task._id);
                } else {
                    showToast(t('alerts.board_not_found') || 'Board not found for this task.');
                }
            };

            if (showMyTasks) {
                return <window.MyTasksView user={user} workspaces={workspaces} theme={theme} onThemeChange={onThemeChange} onLogout={onLogout} onUpdateUser={onUpdateUser} onBack={closeMyTasksPage} onOpenTask={handleOpenTask} />;
            }

            return (
                <div className="h-screen bg-white animate-fade-in relative flex flex-col text-black" style={homeStyle}>
                {pinPrompt.isOpen && (
                <div
                    className="fixed inset-0 bg-black/60 backdrop-blur-xl z-[9999] flex items-center justify-center p-4 animate-fade-in"
                    onMouseDown={e => { if (e.target === e.currentTarget) dismissPinPrompt(); }}
                >
                    <div className="max-w-[320px] w-[95%] mx-auto bg-white p-6 md:p-8 rounded-[2rem] shadow-2xl text-center relative">
                        <button
                            type="button"
                            onClick={dismissPinPrompt}
                            title={t('actions.close') || 'Close'}
                            aria-label={t('actions.close') || 'Close'}
                            className="absolute top-4 right-4 p-2 text-gray-300 hover:text-gray-600 hover:bg-gray-50 rounded-full transition"
                        >
                            <window.Icon name="x" size={16} />
                        </button>
                        <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-6"><window.Icon name="shield-alert" size={32} className="text-blue-500" /></div>
                        <h2 className="text-2xl font-black italic tracking-tighter mb-2">{t('labels.vault_security')}</h2>
                        <p className="text-[10px] text-gray-500 mb-6">{t('alerts.master_pin_requirement')}</p>
                        <div className="space-y-4">
                            <input className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-none focus:ring-1 focus:ring-blue-400 text-black font-black" type="password" placeholder={t('labels.enter_pin')} autoFocus required value={pinPrompt.pin} onChange={e => { setPinPrompt(p => ({ ...p, pin: e.target.value })); setPinError(''); }} onKeyDown={e => e.key === 'Enter' && handleCreatePin(e)} />
                            <input className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-none focus:ring-1 focus:ring-blue-400 text-black font-black" type="password" placeholder={t('labels.confirm_pin')} required value={pinPrompt.confirm} onChange={e => { setPinPrompt(p => ({ ...p, confirm: e.target.value })); setPinError(''); }} onKeyDown={e => e.key === 'Enter' && handleCreatePin(e)} />
                            <button type="button" onClick={(e) => handleCreatePin(e)} disabled={pinLoading} className="w-full py-3 bg-blue-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-100 hover:scale-105 active:scale-95 transition disabled:opacity-50 flex items-center justify-center gap-2">
                                {pinLoading && <window.Icon name="loader" size={14} className="animate-spin" />} {t('actions.create_vault_pin')}
                            </button>
                            <button
                                type="button"
                                onClick={dismissPinPrompt}
                                disabled={pinLoading}
                                className="w-full py-2.5 text-gray-500 hover:text-black text-[10px] font-black uppercase tracking-widest transition disabled:opacity-40"
                            >
                                {t('actions.later') || 'Later'}
                            </button>
                            {pinError && <p className="text-red-500 text-[10px] font-bold animate-shake">{pinError}</p>}
                        </div>
                    </div>
                </div>
            )}
                    <nav className={`h-16 px-6 lg:px-12 flex items-center justify-between transition-colors duration-300 shadow-sm ${hdr.nav}`}>
                        <div className="flex items-center gap-8">
                            <h1 className={`text-xl font-black italic tracking-tighter ${hdr.title}`}>{t('app_name')}</h1>
                            {isAdmin && (
                                <button onClick={() => setShowUserManagement(true)} className={`text-[10px] font-black uppercase tracking-widest transition hover:opacity-70 flex items-center gap-2 ${hdr.muted}`}>
                                    <window.Icon name="users" size={14} /> {t('labels.user_management')}
                                </button>
                            )}
                        </div>
                        <div className="flex items-center gap-4 relative">
                            <div
                                ref={notificationDropdownRef}
                                className={`p-2.5 rounded-xl transition cursor-pointer relative ${hdr.chip}`}
                                title={t('labels.workspace_notifications') || 'Notifications'}
                                onClick={() => setShowNotificationDropdown(!showNotificationDropdown)}
                            >
                                <window.Icon name="bell" size={18} />
                                {/* A dot, not a count: the number summarised nothing useful —
                                    what matters is that something is waiting, and the list
                                    itself says what. */}
                                {globalNotifications.length > 0 && (
                                    <span className="absolute top-0 right-0 w-2.5 h-2.5 rounded-full bg-red-500 border-2 border-white" />
                                )}
                                {showNotificationDropdown && (
                                    <div
                                        className="absolute top-full right-0 mt-2 w-[min(23rem,calc(100vw-2rem))] max-w-[23rem] bg-white rounded-2xl shadow-2xl border border-gray-100 z-[150] animate-pop text-black overflow-hidden flex flex-col"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <div className="flex justify-between items-center px-4 py-3 border-b border-gray-100 bg-gray-50/80">
                                            <p className="text-xs font-black uppercase tracking-widest text-gray-500">
                                                {t('labels.workspace_notifications') || 'Notifications'}
                                            </p>
                                            {globalNotifications.length > 0 && (
                                                <button
                                                    type="button"
                                                    className="text-[10px] font-black uppercase tracking-wider text-red-500 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 transition"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setGlobalNotifications(window.NTNotifications?.clearAll?.() || []);
                                                    }}
                                                >
                                                    {t('labels.clear_workspace_notifications') || 'Clear all'}
                                                </button>
                                            )}
                                        </div>
                                        <div className="max-h-72 overflow-y-auto no-scrollbar p-2">
                                            {globalNotifications.length === 0 ? (
                                                <p className="text-xs text-gray-400 text-center py-6 px-3">
                                                    {t('labels.no_workspace_notifications') || 'No notifications yet.'}
                                                </p>
                                            ) : (
                                                globalNotifications.map((n) => (
                                                    <div
                                                        key={`${n.workspaceId}-${n.id}`}
                                                        className="group flex items-start gap-1 rounded-xl hover:bg-gray-50 border border-transparent hover:border-gray-100 transition"
                                                    >
                                                        {/* Button, not a div: keyboard-reachable and Enter-activatable.
                                                            Notifications with no cardId stay inert. */}
                                                        <button
                                                            type="button"
                                                            onClick={() => openNotification(n)}
                                                            disabled={!n.cardId}
                                                            title={n.cardId ? (t('actions.open_card') || 'Open card') : undefined}
                                                            className={`flex-1 min-w-0 text-left p-2.5 rounded-xl ${n.cardId ? 'cursor-pointer' : 'cursor-default'}`}
                                                        >
                                                            {n.workspaceName ? (
                                                                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 truncate mb-1">{n.workspaceName}</p>
                                                            ) : null}
                                                            <p className="text-[11px] text-gray-800 leading-snug">{n.message}</p>
                                                            {n.createdAt ? (
                                                                <p className="text-[9px] text-gray-400 mt-1">{new Date(n.createdAt).toLocaleString()}</p>
                                                            ) : null}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            title={t('actions.remove') || 'Remove'}
                                                            aria-label={t('actions.remove') || 'Remove'}
                                                            className="shrink-0 mt-2.5 mr-2 p-1 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setGlobalNotifications(window.NTNotifications?.remove?.(n) || []);
                                                            }}
                                                        >
                                                            <window.Icon name="x" size={14} />
                                                        </button>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                            <window.ProfileMenu user={user} onLogout={onLogout} onThemeChange={onThemeChange} currentTheme={theme} onUpdateUser={onUpdateUser} onOpenProfile={onOpenProfile} />
                        </div>
                    </nav>
                    {showUserManagement && <window.UserManagement user={user} onClose={() => setShowUserManagement(false)} />}
                    <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 10px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #E5E7EB; border-radius: 20px; border: 3px solid #FAFAFA; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #D1D5DB; }
    `}</style>
    <div className="flex-1 overflow-y-auto custom-scrollbar w-full">
        <div className="max-w-5xl mx-auto p-4 md:p-10">
                        <header className="mb-8 md:mb-12 flex flex-col md:flex-row justify-between items-center gap-4">
                            <div>
                                <h2 className="text-3xl md:text-5xl font-black tracking-tighter">{viewArchived ? t('actions.archive_workspace') : t('labels.workspace') + 's'}</h2>
                                <p className="text-gray-400 mt-2 font-bold uppercase tracking-[0.2em] text-[10px]">{t('labels.project_command_hub') || "Project Command Hub"}</p>
                            </div>
                            <div className="flex gap-4 items-center">
                                <button onClick={openMyTasksPage} className="px-6 py-4 rounded-full bg-white text-gray-700 border border-gray-200 shadow-xl hover:scale-105 active:scale-95 transition flex items-center gap-2 text-[10px] font-black uppercase tracking-widest">
                                    <window.Icon name="list-checks" size={18} /> {t('labels.my_tasks') || 'My Tasks'}
                                </button>
                                {/* Not admin-gated: it only filters the caller's own accessible
                                    list. Owners can archive their workspaces, so they must be
                                    able to see the archived ones — otherwise archiving is a
                                    one-way trip for everyone but a superadmin. */}
                                <button
                                    onClick={() => setViewArchived(!viewArchived)}
                                    title={viewArchived ? (t('labels.workspace') + 's') : (t('actions.archive_workspace') || 'Archived')}
                                    aria-label={viewArchived ? (t('labels.workspace') + 's') : (t('actions.archive_workspace') || 'Archived')}
                                    className={`w-9 h-9 flex items-center justify-center rounded-xl transition ${viewArchived ? 'bg-black text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                                >
                                    <window.Icon name={viewArchived ? 'layout' : 'archive'} size={16} />
                                </button>
                                {!viewArchived && <button onClick={addWS} className="w-14 h-14 flex items-center justify-center bg-black text-white rounded-full shadow-xl hover:scale-110 active:scale-90 transition"><window.Icon name="plus" size={22} /></button>}
                            </div>
                        </header>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                            {loading && [0, 1, 2, 3, 4, 5].map(i => (
                                <div key={`skeleton-ws-${i}`} aria-hidden="true" className="bg-white border border-gray-100 rounded-[2rem] p-8 insta-shadow animate-pulse">
                                    <div className="w-16 h-16 rounded-2xl bg-gray-200 mb-6"></div>
                                    <div className="h-5 rounded bg-gray-200 w-3/5"></div>
                                    <div className="h-2 rounded-full bg-gray-100 w-2/5 mt-6"></div>
                                </div>
                            ))}
                            {!loading && displayWorkspaces.map(ws => {
                                const wsId = ws.id || ws._id;
                                return (
                                <div key={wsId} onClick={() => onSelect(ws)} className="cursor-pointer bg-white border border-gray-100 rounded-[2rem] p-8 insta-shadow hover:shadow-xl hover:scale-[1.03] transition-all duration-300 group relative">
                                    {/* Same initials fallback the member avatars use, so a workspace
                                        saved without an avatar shows "NT" rather than an empty tile. */}
                                    <div className="w-16 h-16 rounded-2xl nt-tile-gradient mb-6 flex items-center justify-center text-white font-black text-xl shadow-lg group-hover:rotate-6 transition-transform">{ws.avatar || window.getInitials(ws.name)}</div>
                                    <h3 className="text-xl font-black text-black tracking-tight">{ws.name}</h3>
                                    <p className="text-[9px] text-gray-400 font-black uppercase tracking-[0.2em] mt-4">{ws.createdAt ? t('labels.created_at', {date: new Date(ws.createdAt).toLocaleDateString()}) : t('labels.created_at', {date: 'N/A'})}</p>
                                    {/* Owner-or-superadmin, matching requireWsOwner on the server.
                                        Archive and destroy move together on purpose: offering the
                                        irreversible action without the reversible one invites
                                        someone to destroy a board they only meant to shelve. */}
                                    {canManage(ws) && (
                                        <button
                                            onClick={(e) => toggleArchive(e, wsId, ws.archived)}
                                            title={ws.archived ? (t('actions.restore') || 'Restore') : (t('actions.archive_workspace') || 'Archive Workspace')}
                                            aria-label={ws.archived ? (t('actions.restore') || 'Restore') : (t('actions.archive_workspace') || 'Archive Workspace')}
                                            className="absolute top-8 right-8 p-2 text-gray-200 hover:text-gray-400 transition opacity-0 group-hover:opacity-100 focus:opacity-100"
                                        >
                                            <window.Icon name={ws.archived ? 'rotate-ccw' : 'archive'} size={18} />
                                        </button>
                                    )}
                                    {canManage(ws) && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); showConfirm(t('actions.destroy_workspace') || "Destroy Workspace", t('alerts.confirm_destroy_workspace') || "PERMANENTLY delete this workspace? Its cards, docs, folders, environments and activity history are deleted with it. This cannot be undone.", () => destroyWorkspace(wsId)); }}
                                            title={t('actions.destroy_workspace') || 'Destroy Workspace'}
                                            aria-label={t('actions.destroy_workspace') || 'Destroy Workspace'}
                                            className="absolute bottom-8 right-8 p-2 text-red-300 hover:text-red-500 transition opacity-0 group-hover:opacity-100 focus:opacity-100"
                                        >
                                            <window.Icon name="trash-2" size={18} />
                                        </button>
                                    )}
                                </div>
                                );
                            })}
                            {!loading && displayWorkspaces.length === 0 && <div className="col-span-full py-20 text-center text-gray-300 italic text-sm">{t('labels.no_active_workspaces')}</div>}
                        </div>
                </div>
            </div>
        </div>
    );
};
