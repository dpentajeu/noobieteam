/** sessionStorage: per-tab, per-workspace notification list (not shared across browser tabs). */
function ntWorkspaceNotificationsKey(workspaceId) {
  return `nt_ws_notifications_${workspaceId || 'unknown'}`;
}

function readWorkspaceNotificationsSession(workspaceId) {
  try {
    const raw = sessionStorage.getItem(ntWorkspaceNotificationsKey(workspaceId));
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (_) {
    return [];
  }
}

/** Saves one entry and returns the updated list (newest first, max 50). */
function pushWorkspaceNotificationSession(workspaceId, message, options = {}) {
  if (!workspaceId || !message) return readWorkspaceNotificationsSession(workspaceId);
  const prev = readWorkspaceNotificationsSession(workspaceId);
  if (options.dedupeKey && prev.some(n => n && n.dedupeKey === options.dedupeKey)) {
    return prev;
  }
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
    sessionStorage.setItem(ntWorkspaceNotificationsKey(workspaceId), JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('nt:notifications-changed'));
  } catch (_) {}
  return next;
}

function removeWorkspaceNotificationSession(workspaceId, notificationId) {
  const prev = readWorkspaceNotificationsSession(workspaceId);
  const next = prev.filter(n => n && n.id !== notificationId);
  try {
    sessionStorage.setItem(ntWorkspaceNotificationsKey(workspaceId), JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('nt:notifications-changed'));
  } catch (_) {}
  return next;
}

function clearWorkspaceNotificationsSession(workspaceId) {
  try {
    sessionStorage.removeItem(ntWorkspaceNotificationsKey(workspaceId));
    window.dispatchEvent(new CustomEvent('nt:notifications-changed'));
  } catch (_) {}
  return [];
}

function readAllWorkspaceNotificationsSession() {
  const all = [];
  try {
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (!key || !key.startsWith('nt_ws_notifications_')) continue;
      const workspaceId = key.replace('nt_ws_notifications_', '');
      readWorkspaceNotificationsSession(workspaceId).forEach(n => {
        if (n) all.push({ ...n, workspaceId: n.workspaceId || workspaceId });
      });
    }
  } catch (_) {}
  return all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function removeAnyWorkspaceNotificationSession(notification) {
  if (!notification || !notification.workspaceId) return readAllWorkspaceNotificationsSession();
  removeWorkspaceNotificationSession(notification.workspaceId, notification.id);
  return readAllWorkspaceNotificationsSession();
}

function clearAllWorkspaceNotificationsSession() {
  try {
    const keys = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith('nt_ws_notifications_')) keys.push(key);
    }
    keys.forEach(key => sessionStorage.removeItem(key));
    window.dispatchEvent(new CustomEvent('nt:notifications-changed'));
  } catch (_) {}
  return [];
}

function getAuditStamp(entry) {
  const time = new Date(entry?.timestamp || 0).getTime();
  return Number.isNaN(time) ? 0 : time;
}

/**
 * The actor behind a change is whoever appended an audit entry since the previous
 * snapshot — not `auditTrail[last]`, which credits whoever touched the card most
 * recently. Two changes landing inside one poll window (a teammate moves the card,
 * then anyone edits it) would otherwise both be attributed to the later editor.
 * `actionPattern` narrows to the entry that plausibly caused this change; when
 * nothing matches, the newest entry in the window is the best guess available.
 */
function getTaskActorSince(task, previousTask, actionPattern) {
  const trail = Array.isArray(task?.auditTrail) ? task.auditTrail : [];
  const seenUntil = (Array.isArray(previousTask?.auditTrail) ? previousTask.auditTrail : []).reduce(
    (max, entry) => Math.max(max, getAuditStamp(entry)),
    0
  );
  const added = previousTask ? trail.filter(entry => getAuditStamp(entry) > seenUntil) : trail;
  const matched = actionPattern ? added.filter(entry => actionPattern.test(entry?.action || '')) : added;
  const pool = matched.length ? matched : added;
  return pool[pool.length - 1]?.user || '';
}

function getTaskLastAuditTimestamp(task) {
  const trail = Array.isArray(task?.auditTrail) ? task.auditTrail : [];
  const latest = trail[trail.length - 1];
  return latest?.timestamp || task?.updatedAt || '';
}

function isUserInvolvedInCard(card, email) {
  return !!email && Array.isArray(card?.assignees) && card.assignees.includes(email);
}

function isCardDueSoon(card) {
  if (!card || card.archived || !card.dueDate) return false;
  const due = new Date(card.dueDate);
  if (Number.isNaN(due.getTime())) return false;
  const diffDays = (due - new Date()) / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= 3;
}

function formatStatusName(columns, columnId) {
  const col = (columns || []).find(c => c && c.id === columnId);
  return col?.title || columnId || 'Unknown';
}

function getCommentId(comment, index) {
  return comment?._id || comment?.id || `${comment?.authorEmail || 'unknown'}:${comment?.timestamp || index}`;
}

window.NTNotifications = {
  readAll: readAllWorkspaceNotificationsSession,
  push: pushWorkspaceNotificationSession,
  remove: removeAnyWorkspaceNotificationSession,
  clearAll: clearAllWorkspaceNotificationsSession,
};

// One string id for this workspace (API + sessionStorage) lives in helpers.js as
// window.getWorkspaceCanonicalId — the Hub keys storage with it too, and these babel
// scripts share one global scope, so a same-named local function here would overwrite it.

function getWorkspaceRouteId(ws) {
  if (!ws) return '';
  return encodeURIComponent(String(ws.slug || ws.id || ws._id || ''));
}

function getCardIdFromPath() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const cardIndex = parts.indexOf('card');
  return cardIndex >= 0 && parts[cardIndex + 1] ? decodeURIComponent(parts[cardIndex + 1]) : '';
}

function buildCardPath(ws, cardId) {
  return `/workspace/${getWorkspaceRouteId(ws)}/card/${encodeURIComponent(String(cardId))}`;
}

function buildWorkspacePath(ws) {
  return `/workspace/${getWorkspaceRouteId(ws)}`;
}

// The board's four tabs are pages, not view state — a refresh on Vault, Docs or
// APIs used to land back on the board because the tab lived only in React state.
// `board` keeps the bare /workspace/<slug> path so every link already shared
// still resolves, and `card` stays reserved for /workspace/<slug>/card/<id>.
const NT_WORKSPACE_TABS = ['board', 'vault', 'docs', 'api'];

function getTabFromPath() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const segment = parts[2];
  return NT_WORKSPACE_TABS.includes(segment) ? segment : 'board';
}

function buildTabPath(ws, tab) {
  const base = buildWorkspacePath(ws);
  return tab && tab !== 'board' ? `${base}/${tab}` : base;
}

/**
 * Loads notifications for this workspace from sessionStorage using the canonical id.
 * If nothing is stored under that key, tries the other id field once and migrates to the canonical key.
 */
function readWorkspaceNotificationsForWorkspace(ws) {
  const canon = window.getWorkspaceCanonicalId(ws);
  if (!canon) return [];
  let list = readWorkspaceNotificationsSession(canon);
  if (list.length > 0) return list;
  const alts = [];
  if (ws.id != null && String(ws.id) !== canon) alts.push(String(ws.id));
  if (ws._id != null) {
    const s = typeof ws._id === 'object' && ws._id.toString ? String(ws._id) : String(ws._id);
    if (s && s !== canon) alts.push(s);
  }
  for (const alt of alts) {
    const altList = readWorkspaceNotificationsSession(alt);
    if (altList.length > 0) {
      try {
        sessionStorage.setItem(ntWorkspaceNotificationsKey(canon), JSON.stringify(altList));
        sessionStorage.removeItem(ntWorkspaceNotificationsKey(alt));
      } catch (_) {}
      return altList;
    }
  }
  return [];
}

window.WorkspaceView = ({
  workspace,
  initialCardId,
  onOpenMyTasks,
  onBack,
  user,
  onLogout,
  onThemeChange,
  theme,
  onUpdateUser,
  onOpenProfile,
  isJukeboxActive,
}) => {
  const { showConfirm, showPrompt, showAlert } = window.useModals();
  const { showToast } = window.useToasts();
  const [columns, setColumns] = React.useState(
    workspace.columns && workspace.columns.length > 0 ? workspace.columns : [{ id: 'todo', title: 'To Do', order: 0 }]
  );
  const [localWorkspace, setLocalWorkspace] = React.useState(workspace);
  const [cards, setCards] = React.useState([]);
  const [activityLogs, setActivityLogs] = React.useState([]);

  const logActivity = React.useCallback(
    async (action, resourceType, resourceName) => {
      try {
        const res = await fetch(`/api/workspaces/${workspace.id}/activity`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user: user?.email || 'System', action, resourceType, resourceName }),
        });
        if (res.ok) {
          const log = await res.json();
          setActivityLogs(prev => [log, ...prev]);
        }
      } catch (e) {
        console.error('Activity log error:', e);
      }
    },
    [workspace.id, user?.email]
  );
  const [allUsers, setAllUsers] = React.useState([]);
  const [members, setMembers] = React.useState(() => {
    if (!workspace || !workspace.members) return [user?.email].filter(Boolean);
    return workspace.members.map(m => (typeof m === 'string' ? m : m?.userId)).filter(Boolean);
  });
  // POST /workspaces stores the creator as the OWNER member, so OWNER is what
  // identifies whoever made this board. Roles live on workspace.members; the
  // `members` state above is emails only.
  const ownerEmails = React.useMemo(
    () =>
      new Set(
        ((workspace && workspace.members) || [])
          .filter(m => m && typeof m !== 'string' && m.role === 'OWNER')
          .map(m => m.userId)
          .filter(Boolean)
      ),
    [workspace]
  );
  // Any write to members has to carry the existing roles back, or the workspace
  // silently loses its owner and owner-only actions become impossible for
  // everyone.
  const withRoles = React.useCallback(
    emails => emails.map(u => ({ userId: u, role: ownerEmails.has(u) ? 'OWNER' : 'MEMBER' })),
    [ownerEmails]
  );
  const [loading, setLoading] = React.useState(true);
  const autoOpenedRef = React.useRef(false);
  const [expiredCards, setExpiredCards] = React.useState([]);
  const [showExpiredModal, setShowExpiredModal] = React.useState(false);
  const [selectedMoveCol, setSelectedMoveCol] = React.useState('');
  const wsNotificationStorageId = window.getWorkspaceCanonicalId(workspace);
  const [sessionNotifications, setSessionNotifications] = React.useState(() =>
    readWorkspaceNotificationsForWorkspace(workspace)
  );
  const { t } = window.useTranslation ? window.useTranslation() : { t: k => k };

  React.useEffect(() => {
    setSessionNotifications(readWorkspaceNotificationsForWorkspace(workspace));
  }, [wsNotificationStorageId]);

  React.useEffect(() => {
    const refreshNotifications = () => setSessionNotifications(readWorkspaceNotificationsForWorkspace(workspace));
    window.addEventListener('nt:notifications-changed', refreshNotifications);
    return () => window.removeEventListener('nt:notifications-changed', refreshNotifications);
  }, [workspace, wsNotificationStorageId]);

  /** Ignores stale task-fetch results after the user switches to another workspace. */
  const workspaceFetchScopeRef = React.useRef('');

  const addWorkspaceNotification = React.useCallback(
    (message, options = {}) => {
      setSessionNotifications(
        pushWorkspaceNotificationSession(wsNotificationStorageId, message, {
          ...options,
          workspaceName: workspace?.name || options.workspaceName || '',
        })
      );
    },
    [workspace?.name, wsNotificationStorageId]
  );

  // Set by the task-poll effect below; the socket listener calls it to scan on demand.
  const pollTasksNowRef = React.useRef(null);

  const scanTaskNotifications = React.useCallback(
    (nextCards, previousCards = [], { initial = false } = {}) => {
      if (!user?.email || !wsNotificationStorageId) return;
      const previousById = new Map(
        (previousCards || []).filter(c => c && (c.id || c._id)).map(c => [String(c.id || c._id), c])
      );
      const nextById = new Map(
        (nextCards || []).filter(c => c && (c.id || c._id)).map(c => [String(c.id || c._id), c])
      );
      nextById.forEach((card, cardId) => {
        const prev = previousById.get(cardId);
        const title = card.title || 'Untitled card';

        if (isUserInvolvedInCard(card, user.email) && isCardDueSoon(card)) {
          const dueLabel = new Date(card.dueDate).toLocaleDateString();
          addWorkspaceNotification(`"${title}" is expiring soon (${dueLabel}).`, {
            type: 'due-soon',
            cardId,
            dedupeKey: `due-soon:${cardId}:${dueLabel}`,
          });
        }

        const prevInvolved = isUserInvolvedInCard(prev, user.email);
        const nextInvolved = isUserInvolvedInCard(card, user.email);

        if (initial) return;

        const comments = Array.isArray(card.comments) ? card.comments : [];
        const previousCommentIds = new Set((Array.isArray(prev?.comments) ? prev.comments : []).map(getCommentId));
        comments.forEach((comment, index) => {
          const commentId = getCommentId(comment, index);
          if (!Array.isArray(comment?.taggedUsers) || !comment.taggedUsers.includes(user.email)) return;
          if (prev && previousCommentIds.has(commentId)) return;
          addWorkspaceNotification(`${comment.authorEmail || 'Someone'} mentioned you in "${title}".`, {
            type: 'mention',
            cardId,
            dedupeKey: `mention:${cardId}:${commentId}`,
          });
        });

        // A card the baseline has never seen is new. No involvement check: this goes to
        // the whole board, and the scan only ever runs against workspaces the current
        // user is a member of.
        // Held back while its editor is still open and the title is a placeholder. The
        // snapshot write below excludes it too, so it is still new on the next poll.
        if (!prev && !window.isCardAwaitingFirstSave(card)) {
          const creator = getTaskActorSince(card, prev, /created/i);
          // An unattributable card still notifies — only a match on the current user
          // suppresses it, so a missing audit entry does not silence the whole board.
          if (creator !== user.email) {
            addWorkspaceNotification(window.buildCardCreatedMessage(creator, title), {
              type: 'created',
              cardId,
              dedupeKey: `created:${cardId}`,
            });
          }
        }

        // Gated on `prev`, so a newly created card reports itself as created rather than
        // also telling its creator they were added to their own card.
        if (prev && !prevInvolved && nextInvolved) {
          // Assignees only change through a card create/update, so the move entries
          // that may share this poll window must not be credited with the addition.
          const actor = getTaskActorSince(card, prev, /updated|created/i) || 'Someone';
          addWorkspaceNotification(`${actor} added you to "${title}".`, {
            type: 'assigned',
            cardId,
            dedupeKey: `assigned:${cardId}:${card.updatedAt || Date.now()}`,
          });
        }

        if (!prev) return;

        if (nextInvolved && (prev.columnId || prev.col) !== (card.columnId || card.col)) {
          addWorkspaceNotification(`"${title}" moved to ${formatStatusName(columns, card.columnId || card.col)}.`, {
            type: 'status',
            cardId,
            dedupeKey: `moved:${cardId}:${card.columnId || card.col}:${getTaskLastAuditTimestamp(card) || Date.now()}`,
          });
        }

        if (prevInvolved && !prev.archived && card.archived) {
          addWorkspaceNotification(`"${title}" was archived.`, {
            type: 'archived',
            cardId,
            dedupeKey: `archived:${cardId}:${card.updatedAt || Date.now()}`,
          });
        }

        // Reached within a second of the change: the server announces every task write
        // and that runs this scan immediately (see the cards:refresh listener).
        const nextQa = card.qaStatus || 'NONE';
        if (nextInvolved && (prev.qaStatus || 'NONE') !== nextQa) {
          addWorkspaceNotification(window.buildQaNotificationMessage(title, nextQa), {
            type: 'qa',
            cardId,
            // Both paths key off the server's own updatedAt, so whichever arrives
            // first wins and the other is dropped as a duplicate.
            dedupeKey: `qa:${cardId}:${nextQa}:${card.updatedAt || ''}`,
          });
        }
      });

      if (!initial) {
        previousById.forEach((prev, cardId) => {
          if (nextById.has(cardId) || !isUserInvolvedInCard(prev, user.email)) return;
          addWorkspaceNotification(`"${prev.title || 'Untitled card'}" was deleted.`, {
            type: 'deleted',
            cardId,
            dedupeKey: `deleted:${cardId}:${Date.now()}`,
          });
        });
      }
    },
    [addWorkspaceNotification, columns, user?.email, wsNotificationStorageId]
  );

  React.useEffect(() => {
    const fetchScopeId = window.getWorkspaceCanonicalId(workspace);
    workspaceFetchScopeRef.current = fetchScopeId;
    fetch(`/api/workspaces/${workspace.id}/activity`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setActivityLogs(data);
      })
      .catch(() => {});

    fetch(`/api/workspaces/${workspace.id}/tasks`)
      .then(r => r.json())
      .then(data => {
        if (workspaceFetchScopeRef.current !== fetchScopeId) return;
        const validData = Array.isArray(data) ? data.sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0)) : [];
        setCards(validData);
        setLoading(false);

        // Deep-link: auto-open a specific card (navigated from a notification or the
        // My Tasks dashboard). This goes through the URL rather than setEditingCard,
        // because the effect that closes a card modal with no card in the path would
        // otherwise shut this one again on the very next render. Replace rather than
        // push: the board entry is already in history, so Back should leave the board
        // instead of landing on it with the card closed.
        if (initialCardId && !autoOpenedRef.current) {
          const target = validData.find(c => c && String(c.id || c._id) === String(initialCardId));
          if (target) {
            autoOpenedRef.current = true;
            setCardUrl(target.id || target._id, true);
          }
        }

        // Check for expired cards
        const now = new Date();
        const expired = validData.filter(c => {
          if (c.archived || !c.dueDate || c.expiredAlertAcknowledged) return false;
          // Exclude cards in 'done' column or any column title like 'Done'
          const parentCol = columns.find(col => col.id === c.columnId);
          if (c.columnId === 'done' || (parentCol && parentCol.title && parentCol.title.toLowerCase().includes('done')))
            return false;
          const due = new Date(c.dueDate);
          const diffDays = (now - due) / (1000 * 60 * 60 * 24);
          return diffDays >= 3;
        });
        if (expired.length > 0) {
          setExpiredCards(expired);
          setShowExpiredModal(true);
          setSelectedMoveCol(columns[0]?.id || 'todo');
        }
        // Only a workspace this tab has never established a baseline for scans as
        // initial. Coming back from the Hub, the stored baseline is diffed instead, so
        // changes made while the Hub was open still notify rather than being absorbed.
        const previous = window.NTCardSnapshots?.read(wsNotificationStorageId);
        scanTaskNotifications(validData, previous || [], { initial: !previous });
        window.NTCardSnapshots?.write(wsNotificationStorageId, validData);
      })
      .catch(err => {
        console.error(err);
        // Skeletons are gated on `loading` — leaving it true here would spin forever.
        if (workspaceFetchScopeRef.current === fetchScopeId) setLoading(false);
      });
    fetch('/api/users')
      .then(r => r.json())
      .then(data => {
        if (workspaceFetchScopeRef.current !== fetchScopeId) return;
        setAllUsers(Array.isArray(data) ? data : []);
      })
      .catch(console.error);
    fetch('/api/config')
      .then(r => r.json())
      .then(data => {
        if (data.aiConfig) setAiConfig(data.aiConfig);
      })
      .catch(console.error);

    // Fetch unseen emojis
    const fetchUnseenEmojis = async () => {
      try {
        if (!user || !user.email) return;
        const res = await fetch(`/api/workspaces/${workspace.id}/emojis/unseen?email=${user.email}`);
        const unseen = await res.json();
        if (unseen && unseen.length > 0) {
          const idsToMark = unseen.map(e => e._id || e.id);
          let allSpawns = [];
          unseen.forEach((event, idx) => {
            const delayOffset = idx * 0.8; // Faster stagger
            // If many actions, reduce emojis per action to avoid browser lag
            const emojiCount = unseen.length > 1 ? 5 : 15;
            const spawns = Array.from({ length: emojiCount }).map((_, i) => ({
              id: window.generateId('emj'),
              emoji: event.emojiType,
              left: 50 + (Math.random() * 40 - 20) + '%',
              delay: delayOffset + Math.random() * 0.5,
              duration: 2 + Math.random() * 1.5,
              rotate: Math.random() * 60 - 30,
              sway: Math.random() * 100 - 50 + 'px',
            }));
            allSpawns = [...allSpawns, ...spawns];
          });
          setSpamEmojis(prev => [...prev, ...allSpawns]);
          setTimeout(() => setSpamEmojis([]), unseen.length * 800 + 3500);

          // Mark as viewed
          await fetch('/api/emojis/mark-viewed', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ emojiIds: idsToMark, userEmail: user.email }),
          });
        }
      } catch (e) {
        console.error('Failed to fetch unseen emojis', e);
      }
    };
    fetchUnseenEmojis();

    // Start polling loop
    const interval = setInterval(fetchUnseenEmojis, 10000);
    return () => clearInterval(interval);
  }, [wsNotificationStorageId, user, scanTaskNotifications]);

  React.useEffect(() => {
    if (!wsNotificationStorageId || !workspace?.id) return;
    let cancelled = false;
    const pollTasks = async () => {
      try {
        const res = await fetch(`/api/workspaces/${workspace.id}/tasks`);
        const data = await res.json();
        if (cancelled || workspaceFetchScopeRef.current !== wsNotificationStorageId) return;
        const validData = Array.isArray(data) ? data.sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0)) : [];
        const previous = window.NTCardSnapshots?.read(wsNotificationStorageId);
        scanTaskNotifications(validData, previous || [], { initial: !previous });
        window.NTCardSnapshots?.write(wsNotificationStorageId, validData);
        setCards(validData);
      } catch (e) {
        console.error(e);
      }
    };
    // Debounced so a burst of writes — a bulk archive, a drag that reorders a whole
    // column — collapses into one read instead of one per announcement.
    let debounce = null;
    pollTasksNowRef.current = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(pollTasks, 250);
    };
    const interval = setInterval(pollTasks, 15000);
    return () => {
      cancelled = true;
      if (debounce) clearTimeout(debounce);
      pollTasksNowRef.current = null;
      clearInterval(interval);
    };
  }, [scanTaskNotifications, workspace?.id, wsNotificationStorageId]);

  const [editingCard, setEditingCard] = React.useState(null);
  const [urlCardId, setUrlCardId] = React.useState(() => getCardIdFromPath());
  const [tab, setTab] = React.useState(() => getTabFromPath());
  const [showMemberDropdown, setShowMemberDropdown] = React.useState(false);
  const memberDropdownRef = React.useRef(null);
  const [showNotificationDropdown, setShowNotificationDropdown] = React.useState(false);
  const notificationDropdownRef = React.useRef(null);
  React.useEffect(() => {
    const handleClickOutside = event => {
      if (memberDropdownRef.current && !memberDropdownRef.current.contains(event.target)) {
        setShowMemberDropdown(false);
      }
      if (notificationDropdownRef.current && !notificationDropdownRef.current.contains(event.target)) {
        setShowNotificationDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  const [isAIChatOpen, setIsAIChatOpen] = React.useState(false);
  const [viewArchivedCol, setViewArchivedCol] = React.useState(null);
  // Which stage header is in edit mode, and the draft title being typed into it.
  const [editingStageId, setEditingStageId] = React.useState(null);
  const [editingStageTitle, setEditingStageTitle] = React.useState('');
  const socketRef = React.useRef(null);
  const [lockedCards, setLockedCards] = React.useState({});

  React.useEffect(() => {
    if (!window.io) return;
    // Point socket.io to the dynamic backend path explicitly
    const backendUrl = window.location.origin.includes('task.zettalog.com')
      ? 'https://task.zettalog.com'
      : window.location.origin;
    const socket = window.io(backendUrl, {
      path: '/api/socket.io',
      auth: { token: localStorage.getItem('nt_token') },
    });
    socketRef.current = socket;
    const joinedWorkspaceId = window.getWorkspaceCanonicalId(workspace) || workspace.id || workspace._id;
    // Rooms are per-connection, so the join has to run on every connect rather than
    // once at setup: a reconnect would otherwise leave this board out of its own room
    // with the socket reporting healthy — no lock badges, no instant notifications.
    socket.on('connect', () => socket.emit('workspace:join', { workspaceId: joinedWorkspaceId }));

    // Snapshot of locks already held when this client joined — without it, cards
    // locked before connect show no badge until someone tries to open them.
    socket.on('card:locks', ({ locks }) => {
      setLockedCards(prev => {
        const next = Object.assign({}, prev);
        (locks || []).forEach(l => { if (l && l.cardId) next[l.cardId] = l.user; });
        return next;
      });
    });

    socket.on('card:locked', ({ cardId, user }) => {
      setLockedCards(prev => Object.assign({}, prev, { [cardId]: user }));
    });

    // The server announces every task write, so the notification scan runs on the
    // change rather than on the 15s timer. Re-reading and diffing locally — instead of
    // trusting a message composed by the sender — keeps involvement filtering, dedupe
    // and wording in one place, and covers every notification type at once.
    socket.on('cards:refresh', () => pollTasksNowRef.current?.());

    socket.on('card:unlocked', ({ cardId }) => {
      setLockedCards(prev => {
        const next = Object.assign({}, prev);
        delete next[cardId];
        return next;
      });
    });

    // Rejection no longer closes the card. It only records who holds the lock,
    // which flips the open modal into read-only. This is also how a client that
    // joined *after* the lock was taken finds out about it — `card:locked` was
    // broadcast before it was listening, so the rejection is its only signal.
    socket.on('card:lock_rejected', ({ cardId, user: holder, message }) => {
      if (holder) {
        setLockedCards(prev => Object.assign({}, prev, { [cardId]: holder }));
      }
      showToast(message);
    });

    return () => {
      socket.disconnect();
    };
  }, [addWorkspaceNotification, user?.email, workspace]);
  const [showBacklog, setShowBacklog] = React.useState(false);
  const [showActivityLog, setShowActivityLog] = React.useState(false);
  const [activityTooltip, setActivityTooltip] = React.useState(null);

  // Safety check for Drag and Drop library
  const dnd = window.ReactBeautifulDnd;
  const [aiMessages, setAiMessages] = React.useState([
    {
      role: 'bot',
      content:
        t('alerts.ai_welcome') ||
        'Hello! I am NoobieHelper. I can help you manage your Kanban board via natural language. How can I assist today?',
    },
  ]);
  const [aiInput, setAiInput] = React.useState('');
  const [aiAttachment, setAiAttachment] = React.useState(null);
  const aiFileInputRef = React.useRef(null);
  const [isAiDragging, setIsAiDragging] = React.useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = React.useState(false);
  const [footerQuote, setFooterQuote] = React.useState(null);

  const footerQuoteTimeoutRef = React.useRef(null);
  const [spamEmojis, setSpamEmojis] = React.useState([]);

  // Escape-to-close for this view's overlays (UIUX_ISSUES 2.1). Each is gated on
  // its own open state, so only overlays actually on screen are on the stack and
  // the most recently opened one wins. The archived-cards modal is a GlobalModal
  // and inherits Escape from there. The card modal handles its own, because it
  // must route through the discard-changes confirm.
  window.useEscapeKey(() => setShowExpiredModal(false), showExpiredModal);
  window.useEscapeKey(() => setShowEmojiPicker(false), showEmojiPicker);
  window.useEscapeKey(() => setIsAIChatOpen(false), isAIChatOpen);

  React.useEffect(() => {
    const handlePopState = () => {
      setUrlCardId(getCardIdFromPath());
      // A card path carries no tab segment and always belongs to the board, which
      // is what getTabFromPath falls back to.
      setTab(getTabFromPath());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const setCardUrl = React.useCallback(
    (cardId, replace = false) => {
      if (!cardId) return;
      const nextPath = buildCardPath(workspace, cardId);
      if (window.location.pathname !== nextPath) {
        window.history[replace ? 'replaceState' : 'pushState']({}, '', nextPath);
      }
      setUrlCardId(String(cardId));
    },
    [workspace]
  );

  const clearCardUrl = React.useCallback(() => {
    const nextPath = buildWorkspacePath(workspace);
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextPath);
    }
    setUrlCardId('');
  }, [workspace]);

  // Only the tab bars go through this. The internal `setTab('board')` calls are
  // deliberately left alone: they run while a card is opening, and each is paired
  // with a setCardUrl that owns the path.
  const selectTab = React.useCallback(
    nextTab => {
      const nextPath = buildTabPath(workspace, nextTab);
      if (window.location.pathname !== nextPath) {
        window.history.pushState({}, '', nextPath);
      }
      setUrlCardId('');
      setTab(nextTab);
    },
    [workspace]
  );

  const openCard = React.useCallback(
    (card, replaceUrl = false) => {
      if (!card) return;
      const cardId = card.id || card._id;
      if (!cardId) return;
      setEditingCard(card);
      setTab('board');
      setCardUrl(cardId, replaceUrl);
    },
    [setCardUrl]
  );

  // Every notification is stored with the cardId that produced it (see
  // scanTaskNotifications), so the row can navigate straight to that card.
  // Mirrors the kanban card's own click behavior, including the lock check —
  // otherwise this would be a second way to open a card someone else is editing.
  const openNotification = React.useCallback(
    n => {
      if (!n || !n.cardId) return;
      setShowNotificationDropdown(false);
      const target = (cards || []).find(c => c && String(c.id || c._id) === String(n.cardId));
      if (!target) {
        showToast(t('alerts.card_unavailable') || 'That card is no longer on this board.');
        return;
      }
      if (target.archived) {
        showToast(t('alerts.card_archived_notice') || 'That card has been archived.');
        return;
      }
      // A locked card still opens — CardModal renders it read-only.
      openCard(target);
    },
    [cards, openCard, showToast, t]
  );

  React.useEffect(() => {
    const pathCardId = getCardIdFromPath();
    setUrlCardId(pathCardId);
  }, [wsNotificationStorageId]);

  React.useEffect(() => {
    if (!urlCardId || !Array.isArray(cards) || cards.length === 0) return;
    const target = cards.find(c => c && String(c.id || c._id) === String(urlCardId));
    if (!target || target.archived) return;
    const activeId = editingCard && (editingCard.id || editingCard._id);
    if (String(activeId || '') === String(urlCardId)) return;
    // Deep links open a locked card too; it lands read-only rather than bouncing
    // back to the board.
    setEditingCard(target);
    setTab('board');
  }, [urlCardId, cards, editingCard, workspace]);

  React.useEffect(() => {
    if (!urlCardId && editingCard && !getCardIdFromPath()) {
      setEditingCard(null);
    }
  }, [urlCardId, editingCard]);

  // `editingCard` is the snapshot taken when the modal opened. For a read-only
  // viewer that snapshot would stay frozen while the lock holder saves, so feed
  // it from the 15s task poll. Only when read-only: replacing the card an editor
  // is working on would discard their draft.
  React.useEffect(() => {
    if (!editingCard) return;
    const cardId = editingCard.id || editingCard._id;
    const holder = lockedCards[cardId];
    if (!holder || holder === user?.email) return;
    const fresh = (cards || []).find(c => c && String(c.id || c._id) === String(cardId));
    if (fresh && (fresh.__v || 0) !== (editingCard.__v || 0)) {
      setEditingCard(fresh);
    }
  }, [cards, editingCard, lockedCards, user?.email]);

  const handleEmojiSelect = async emoji => {
    setShowEmojiPicker(false);

    // Save to backend so others see it
    fetch(`/api/workspaces/${workspace.id}/emojis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emojiType: emoji, senderEmail: user?.email }),
    }).catch(console.error);

    // Spawn 15 emojis for the Facebook Live effect
    const spawns = Array.from({ length: 15 }).map((_, i) => ({
      id: window.generateId('emj'),
      emoji,
      left: 50 + (Math.random() * 40 - 20) + '%', // Randomly scatter around center
      delay: Math.random() * 0.5,
      duration: 2 + Math.random() * 1.5,
      rotate: Math.random() * 60 - 30,
      sway: Math.random() * 100 - 50 + 'px',
    }));
    setSpamEmojis(spawns);
    setTimeout(() => setSpamEmojis([]), 3500); // clear after animation

    try {
      const systemMsg = { role: 'system', content: 'You are a motivational speaker.' };
      const userMsg = {
        role: 'user',
        content: `Generate a one-line motivational quote based on this emoji: ${emoji}. Make it a funny mix with motivation. Very short and punchy.`,
      };
      const result = await window.AIService.call([systemMsg, userMsg], aiConfig);
      const quote = result.choices[0].message.content || 'Touch grass';
      setFooterQuote(quote);
    } catch (e) {
      console.error(e);
      setFooterQuote('Touch grass');
    }

    if (footerQuoteTimeoutRef.current) clearTimeout(footerQuoteTimeoutRef.current);
    // Stay on screen for 1 minute
    footerQuoteTimeoutRef.current = setTimeout(() => setFooterQuote(null), 60000);
  };
  const [aiConfig, setAiConfig] = React.useState({
    model: 'gemini-3-flash-preview',
    apiKey: '[REDACTED_API_KEY]',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  });
  const [isAISettingsOpen, setIsAISettingsOpen] = React.useState(false);
  const [filterKeyword, setFilterKeyword] = React.useState('');
  const [filterAssignee, setFilterAssignee] = React.useState('');
  const [filterEpic, setFilterEpic] = React.useState('');
  const [filterExpiring, setFilterExpiring] = React.useState(false);
  const userLabel = React.useMemo(() => window.getInitials(user), [user]);

  const updateWorkspace = async fields => {
    const res = await fetch(`/api/workspaces/${workspace.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    const updated = await res.json();
    setLocalWorkspace(prev => ({ ...prev, ...fields }));
    return updated;
  };

  const epics = React.useMemo(() => [...new Set((cards || []).map(c => c && c.epic).filter(Boolean))], [cards]);

  const displayCards = React.useMemo(() => {
    const uniqueCards = Array.from(
      new Map(
        (Array.isArray(cards) ? cards : []).filter(c => c && (c.id || c._id)).map(c => [String(c.id || c._id), c])
      ).values()
    );
    return uniqueCards.filter(c => {
      if (!c) return false;
      if (c.archived) return false;
      const title = c.title || '';
      const content = c.content || '';
      if (
        filterKeyword &&
        !title.toLowerCase().includes(filterKeyword.toLowerCase()) &&
        !content.toLowerCase().includes(filterKeyword.toLowerCase())
      )
        return false;
      if (filterAssignee && (!c.assignees || !c.assignees.includes(filterAssignee))) return false;
      if (filterEpic && (!c.epic || !c.epic.toLowerCase().includes(filterEpic.toLowerCase()))) return false;
      if (filterExpiring) {
        if (!c.dueDate) return false;
        const due = new Date(c.dueDate);
        const now = new Date();
        const diffTime = due - now;
        const diffDays = diffTime / (1000 * 60 * 60 * 24);
        if (diffDays > 3) return false;
      }
      return true;
    });
  }, [cards, filterKeyword, filterAssignee, filterEpic, filterExpiring]);

  // Per-stage totals for the column headers. Counted off displayCards, the same
  // filtered set the columns render, so the number always matches the cards
  // actually on screen rather than the unfiltered board.
  const columnCounts = React.useMemo(() => {
    const counts = {};
    displayCards.forEach(c => {
      const columnId = c.columnId || c.col;
      if (!columnId) return;
      counts[columnId] = (counts[columnId] || 0) + 1;
    });
    return counts;
  }, [displayCards]);

  const moveCard = async (id, direction) => {
    const card = cards.find(x => x && x.id === id);
    if (!card) return;
    const currentColId = card.columnId || card.col;
    const colIdx = columns.findIndex(c => c.id === currentColId);
    const nextIdx = colIdx + direction;
    if (nextIdx >= 0 && nextIdx < columns.length) {
      const nextColId = columns[nextIdx].id;
      const res = await fetch(`/api/tasks/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          columnId: nextColId,
          col: nextColId,
          auditEvent: { user: user?.email || 'System', action: 'Moved card to ' + nextColId },
        }),
      });
      const movedTask = await res.json().catch(() => null);
      if (!res.ok) return;
      setCards(prev =>
        prev.map(c =>
          c.id === id
            ? {
                ...(movedTask || c),
                id: c.id || movedTask?.id || movedTask?._id,
                columnId: nextColId,
                col: nextColId,
              }
            : c
        )
      );
      logActivity('Moved card to ' + (columns[nextIdx]?.title || nextColId), 'card', card.title);
    }
  };

  // Board columns used to repeat the header palette as literal hexes in a switch
  // here; they now read the same CSS variables the bar does.
  const hdr = React.useMemo(() => window.getHeaderTheme(theme), [theme]);

  // Backlog is a card bucket, not a stage on the board — it is filtered out of
  // the column row, so it must not count towards "can this one be deleted".
  const stageCount = React.useMemo(
    () => columns.filter(c => c && c.id !== 'backlog').length,
    [columns]
  );

  const beginRenameStage = col => {
    setEditingStageId(col.id);
    setEditingStageTitle(col.title || '');
  };

  const cancelRenameStage = () => {
    setEditingStageId(null);
    setEditingStageTitle('');
  };

  // Commit is driven by both Enter and blur, so it has to tolerate being called
  // twice for one edit — an unchanged or empty title just closes the editor.
  const commitRenameStage = async col => {
    const nextTitle = editingStageTitle.trim();
    if (!nextTitle || nextTitle === col.title) {
      cancelRenameStage();
      return;
    }
    const newCols = columns.map(c => (c.id === col.id ? { ...c, title: nextTitle } : c));
    const res = await fetch(`/api/workspaces/${workspace.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columns: newCols }),
    });
    if (!res.ok) {
      showAlert(t('alerts.rename_stage_failed') || 'Could not rename the stage.');
      return;
    }
    setColumns(newCols);
    cancelRenameStage();
    logActivity('Renamed stage', 'stage', nextTitle);
  };

  const getMemberData = email => {
    return (Array.isArray(allUsers) ? allUsers : []).find(u => u.email === email) || { email, avatar: null };
  };

  // The profile background image now carries over from the hub to the board, with
  // the same white wash WorkspaceHub applies (homeStyle) so cards and text stay
  // legible over an arbitrary photo. The root keeps bg-white underneath as the
  // fallback for users who never set one.
  const backgroundStyle = React.useMemo(() => {
    if (!user?.homeBackgroundImage) return {};
    return {
      backgroundImage: `linear-gradient(rgba(255,255,255,0.84), rgba(255,255,255,0.9)), url("${window.getImageUrl(user.homeBackgroundImage)}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    };
  }, [user?.homeBackgroundImage]);

  const aiTools = [
    {
      type: 'function',
      function: {
        name: 'create_card',
        description:
          'Creates a new task card in a specific column on the Kanban board. Use this when the user explicitly asks to add, create, or make a new task.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'The short, descriptive title of the task.' },
            column_id: {
              type: 'string',
              description:
                'The exact ID of the column where the card should be placed. This must be retrieved from the dynamically injected board state in the system prompt.',
            },
            description: {
              type: 'string',
              description: 'Optional. Detailed information or instructions for the task.',
            },
            due_date: {
              type: 'string',
              description:
                "Optional. The deadline for the task, formatted as an ISO 8601 date string (e.g., '2026-04-19T00:00:00.000Z'). Convert natural language like 'tomorrow' into this format.",
            },
            priority: {
              type: 'string',
              enum: ['low', 'medium', 'high'],
              description: 'Optional. The priority level of the task.',
            },
          },
          required: ['title', 'column_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'query_board',
        description:
          "Searches and filters existing tasks on the Kanban board. Use this to answer questions like 'What is assigned to me?', 'What tasks are expiring soon?', or 'Find the database migration task'.",
        parameters: {
          type: 'object',
          properties: {
            filters: {
              type: 'object',
              properties: {
                status: {
                  type: 'string',
                  description: 'Optional. Filter by the column ID or status name.',
                },
                expiring_within_days: {
                  type: 'number',
                  description:
                    "Optional. Number of days to look ahead for expiring tasks (e.g., 2 for 'next 48 hours').",
                },
                keyword: {
                  type: 'string',
                  description: 'Optional. A specific word or phrase to search for within task titles and descriptions.',
                },
                assignee_id: {
                  type: 'string',
                  description: 'Optional. The ID of the user to filter tasks by.',
                },
              },
            },
          },
          required: ['filters'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'update_card',
        description:
          'Modifies an existing task on the Kanban board. Use this to move tasks between columns, assign users, or change the title, description, or due date.',
        parameters: {
          type: 'object',
          properties: {
            card_id: {
              type: 'string',
              description:
                'The exact unique ID of the card to update. This must be retrieved from the dynamically injected board state in the system prompt.',
            },
            updates: {
              type: 'object',
              description: 'An object containing only the fields that need to be changed.',
              properties: {
                column_id: {
                  type: 'string',
                  description: 'Optional. The new column ID to move the card to.',
                },
                title: { type: 'string', description: 'Optional. The new title for the card.' },
                description: {
                  type: 'string',
                  description: 'Optional. The new description for the card.',
                },
                due_date: {
                  type: 'string',
                  description: 'Optional. The new deadline, formatted as an ISO 8601 date string.',
                },
                assignee_id: {
                  type: 'string',
                  description: 'Optional. The user ID to assign to the card.',
                },
              },
            },
          },
          required: ['card_id', 'updates'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'archive_card',
        description:
          'Archives a specific task on the Kanban board. Use this when the user asks to delete, remove, or archive a card. For safety, cards are never hard-deleted.',
        parameters: {
          type: 'object',
          properties: {
            card_id: {
              type: 'string',
              description:
                'The exact unique ID of the card to archive. This must be retrieved from the dynamically injected board state in the system prompt.',
            },
          },
          required: ['card_id'],
        },
      },
    },
  ];

  const minimizeState = () => {
    const minimizedColumns = (columns || []).map(c => ({ id: c.id, title: c.title }));
    const minimizedTasks = (cards || [])
      .filter(c => c && !c.archived)
      .map(c => ({
        id: c.id || c._id,
        title: c.title,
        columnId: c.columnId || c.col,
        urgency: c.urgency,
        dueDate: c.dueDate,
        assignees: c.assignees,
      }));
    return JSON.stringify({ columns: minimizedColumns, tasks: minimizedTasks });
  };

  const handleAiFileUpload = file => {
    const reader = new FileReader();
    reader.onload = e => {
      setAiAttachment({ name: file.name, content: e.target.result });
      showToast(t('alerts.file_attached') || 'File attached to AI Context. 📎');
    };
    reader.readAsText(file);
  };

  const handleAISend = async () => {
    if (!aiInput.trim() && !aiAttachment) return;
    const contentStr = aiAttachment
      ? `Attached Context File: [${aiAttachment.name}]

${aiAttachment.content}

User Request: ${aiInput}`
      : aiInput;
    const userMsg = { role: 'user', content: contentStr };
    setAiMessages(prev => [...prev, userMsg]);
    setAiInput('');
    setAiAttachment(null);

    let currentMessages = [...aiMessages, userMsg];
    let turnLimit = 3; // Prevent infinite loops

    try {
      while (turnLimit > 0) {
        const systemMsg = {
          role: 'system',
          content: `You are NoobieHelper. Workspace context: "${workspace.name}". Current board state: ${minimizeState()}. If a user asks about tasks, use the query_board tool first. CRITICAL: When responding to the user, you MUST reply in natural language instead of raw JSON. Never output raw arrays or JSON objects to the user.`,
        };
        const chatHistory = [
          systemMsg,
          ...currentMessages.map(m => {
            if (m.role === 'tool_result')
              return { role: 'tool', name: m.name, tool_call_id: m.tool_call_id, content: m.content };
            return {
              role: m.role === 'bot' ? 'assistant' : m.role,
              content: m.content,
              tool_calls: m.tool_calls,
            };
          }),
        ];

        const result = await window.AIService.call(chatHistory, aiConfig, aiTools);
        const choice = result.choices[0].message;
        const assistantTurn = {
          role: 'bot',
          content: choice.content || (choice.tool_calls ? null : "I couldn't process that request."),
          tool_calls: choice.tool_calls,
        };
        currentMessages.push(assistantTurn);
        setAiMessages(prev => [...prev, assistantTurn]);

        if (choice.tool_calls && choice.tool_calls.length > 0) {
          for (const tool of choice.tool_calls) {
            const args = JSON.parse(tool.function.arguments);
            let toolResponseContent = '';

            if (tool.function.name === 'create_card') {
              const pMap = { low: 'LOW', medium: 'MED', high: 'HIGH' };
              const mappedUrgency = pMap[args.priority?.toLowerCase()] || 'LOW';
              const nc = {
                columnId: args.column_id || 'todo',
                title: args.title,
                content: args.description || '',
                urgency: mappedUrgency,
                dueDate: args.due_date || '',
                assignees: [user?.email],
                attachments: [],
                checklist: [],
                auditEvent: { user: user?.email || 'System', action: 'AI created card' },
              };
              try {
                const res = await fetch(`/api/workspaces/${workspace.id}/tasks`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(nc),
                });
                const saved = await res.json();
                if (!res.ok) {
                  toolResponseContent = `Error: Failed to create task. ${saved.error || res.statusText}`;
                } else {
                  const resolvedId = saved._id || saved.id;
                  setCards(prev => [...prev, { ...saved, id: resolvedId }]);
                  toolResponseContent = `Success: Created task "${args.title}" (ID: ${resolvedId})`;
                }
              } catch (e) {
                toolResponseContent = `Error: Network failure. ${e.message}`;
              }
            } else if (tool.function.name === 'query_board') {
              const filters = args.filters || {};
              let filtered = cards.filter(c => !c.archived);
              if (filters.status) filtered = filtered.filter(c => (c.columnId || c.col) === filters.status);
              if (filters.keyword)
                filtered = filtered.filter(
                  c =>
                    c.title.toLowerCase().includes(filters.keyword.toLowerCase()) ||
                    (c.content && c.content.toLowerCase().includes(filters.keyword.toLowerCase()))
                );
              if (filters.assignee_id)
                filtered = filtered.filter(c => c.assignees && c.assignees.includes(filters.assignee_id));
              if (filters.expiring_within_days !== undefined) {
                filtered = filtered.filter(c => {
                  if (!c.dueDate) return false;
                  const due = new Date(c.dueDate);
                  const now = new Date();
                  const diffDays = (due - now) / (1000 * 60 * 60 * 24);
                  return diffDays <= filters.expiring_within_days;
                });
              }
              toolResponseContent = JSON.stringify(
                filtered.map(c => ({
                  id: c.id || c._id,
                  title: c.title,
                  columnId: c.columnId || c.col,
                  dueDate: c.dueDate,
                }))
              );
            } else if (tool.function.name === 'update_card') {
              const updates = args.updates || {};
              // Map snake_case from AI to camelCase for backend/frontend
              const mappedUpdates = {};
              if (updates.column_id) mappedUpdates.columnId = updates.column_id;
              if (updates.title) mappedUpdates.title = updates.title;
              if (updates.description) mappedUpdates.content = updates.description;
              if (updates.due_date) mappedUpdates.dueDate = updates.due_date;
              if (updates.assignee_id) mappedUpdates.assignees = [updates.assignee_id];
              if (updates.priority) {
                const pMap = { low: 'LOW', medium: 'MED', high: 'HIGH' };
                mappedUpdates.urgency = pMap[updates.priority?.toLowerCase()] || 'LOW';
              }

              const payload = {
                ...mappedUpdates,
                auditEvent: { user: user?.email || 'System', action: 'AI updated card' },
              };
              try {
                const res = await fetch(`/api/tasks/${args.card_id}`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(payload),
                });
                const updated = await res.json();
                if (!res.ok) {
                  toolResponseContent = `Error: Failed to update task. ${updated.error || res.statusText}`;
                } else {
                  setCards(prev =>
                    (prev || []).map(c =>
                      c && (c.id === args.card_id || c._id === args.card_id) ? { ...c, ...mappedUpdates } : c
                    )
                  );
                  toolResponseContent = `Success: Updated task ${args.card_id}`;
                }
              } catch (e) {
                toolResponseContent = `Error: Network failure. ${e.message}`;
              }
            } else if (tool.function.name === 'archive_card') {
              try {
                const res = await fetch(`/api/tasks/${args.card_id}`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    archived: true,
                    auditEvent: { user: user?.email || 'System', action: 'AI archived card' },
                  }),
                });
                if (!res.ok) {
                  const errData = await res.json().catch(() => ({}));
                  toolResponseContent = `Error: Failed to archive task. ${errData.error || res.statusText}`;
                } else {
                  setCards(prev =>
                    (prev || []).map(c =>
                      c && (c.id === args.card_id || c._id === args.card_id) ? { ...c, archived: true } : c
                    )
                  );
                  toolResponseContent = `Success: Archived task ${args.card_id}`;
                }
              } catch (e) {
                toolResponseContent = `Error: Network failure. ${e.message}`;
              }
            }

            const resultTurn = {
              role: 'tool_result',
              name: tool.function.name,
              tool_call_id: tool.id,
              content: toolResponseContent,
            };
            currentMessages.push(resultTurn);
            setAiMessages(prev => [...prev, resultTurn]);
          }
          turnLimit--;
          continue; // Loop for followup
        }
        break; // No more tools, stop
      }
    } catch (err) {
      setAiMessages(prev => [...prev, { role: 'bot', content: `Error: ${err.message}` }]);
    }
  };

  // Mirrors the server's own check (isSuperAdmin / requireSuperAdmin). Never
  // compare emails here — the configured admin address and the SUPERADMIN role
  // are different things, and only the role is authoritative.
  const isAdmin = user?.systemRole === 'SUPERADMIN';
  const [showUserManagement, setShowUserManagement] = React.useState(false);

  if (!dnd) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-yellow-50 p-10">
        <div className="max-w-md bg-white p-8 rounded-3xl shadow-xl text-center">
          <h2 className="text-xl font-black text-yellow-600 mb-4">{t('alerts.library_load_error')}</h2>
          <p className="text-sm text-gray-500 mb-6">
            The Drag and Drop engine (ReactBeautifulDnd) failed to initialize. This usually happens due to a slow
            network connection to the CDN.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2 bg-yellow-500 text-white rounded-full text-[10px] font-black uppercase tracking-widest"
          >
            {t('actions.retry_connection')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden text-black" style={backgroundStyle}>
      <nav
        className={`h-16 px-6 flex items-center justify-between sticky top-0 z-[120] transition-colors duration-300 shadow-sm ${hdr.nav}`}
      >
        <div className="flex items-center gap-6">
          <button
            type="button"
            onClick={onBack}
            title={t('actions.back') || 'Back'}
            className={`p-2.5 rounded-xl transition ${hdr.ghost}`}
          >
            <window.Icon name="arrow-left" size={20} />
          </button>
          <div className={`leading-none ${hdr.title}`}>
            <h2 className="text-lg font-black tracking-tighter italic mr-4">{t('app_name')}</h2>
            <p className="text-[8px] font-black uppercase tracking-[0.4em] opacity-50 mt-1.5">{workspace.name}</p>
          </div>
          {isAdmin && (
            <button
              onClick={() => setShowUserManagement(true)}
              className={`text-[10px] font-black uppercase tracking-widest transition hover:opacity-70 flex items-center gap-2 ${hdr.muted}`}
            >
              <window.Icon name="users" size={14} /> {t('labels.user_management')}
            </button>
          )}
        </div>
        {/* Idle tabs were `opacity-40` — under 3:1 against every one of the five
            header fills. They now carry real colours, and the track tints with the
            theme instead of staying a black wash that vanished on the dark bars. */}
        <div className={`hidden md:flex p-1 rounded-2xl gap-1 ${hdr.track}`} role="tablist">
          {[
            { id: 'board', label: t('tabs.board') },
            { id: 'vault', label: t('tabs.vault') },
            { id: 'docs', label: t('tabs.docs') },
            { id: 'api', label: t('tabs.api') },
          ].map(item => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => selectTab(item.id)}
              className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition ${hdr.focus} ${tab === item.id ? hdr.tabActive : hdr.tabIdle}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-6 relative">
          {onOpenMyTasks && (
            <button
              type="button"
              onClick={onOpenMyTasks}
              title={t('labels.my_tasks') || 'My Tasks'}
              className={`p-2.5 rounded-xl transition cursor-pointer ${hdr.chip}`}
            >
              <window.Icon name="list-checks" size={18} />
            </button>
          )}
          <div
            ref={memberDropdownRef}
            title={t('labels.board_members')}
            className={`p-2.5 rounded-xl transition cursor-pointer relative ${hdr.chip}`}
            onClick={() => {
              setShowNotificationDropdown(false);
              setShowMemberDropdown(!showMemberDropdown);
            }}
          >
            <window.Icon name="users" size={18} />
            {showMemberDropdown && (
              <div className="absolute top-full right-0 mt-2 w-80 bg-white rounded-2xl shadow-2xl border border-gray-100 p-5 z-[150] animate-pop text-black">
                <div className="flex justify-between items-center mb-3 px-1">
                  <p className="text-xs font-black uppercase tracking-widest text-gray-400">
                    {t('labels.board_members')}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        showConfirm(
                          t('labels.leave_workspace_title'),
                          t('alerts.confirm_detach_workspace'),
                          async () => {
                            const newMembers = members.filter(m => m !== user?.email);
                            setMembers(newMembers);
                            await fetch(`/api/workspaces/${workspace.id}`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ members: withRoles(newMembers) }),
                            });
                            setTimeout(onBack, 100);
                          }
                        );
                      }}
                      className="p-1.5 hover:bg-red-50 text-red-500 rounded-lg transition"
                      title={t('actions.leave_workspace')}
                    >
                      <window.Icon name="user-minus" size={14} />
                    </button>
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        showPrompt(t('labels.invite_user_title'), t('labels.user_email'), async email => {
                          if (email) {
                            const newMembers = [...members, email];
                            setMembers(newMembers);
                            await fetch(`/api/workspaces/${workspace.id}`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ members: withRoles(newMembers) }),
                            });
                          }
                        });
                      }}
                      className="p-1.5 hover:bg-blue-50 text-blue-500 rounded-lg transition"
                      title={t('actions.invite_user')}
                    >
                      <window.Icon name="user-plus" size={14} />
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5 max-h-56 overflow-y-auto no-scrollbar">
                  {members
                    .filter(m => m && typeof m === 'string')
                    .map(m => {
                      const md = getMemberData(m);
                      return (
                        <div
                          key={m}
                          className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded-xl transition group"
                        >
                          <window.Avatar label={window.getInitials(md)} src={window.getImageUrl(md.avatar)} size="sm" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <p className="text-sm font-black truncate">{m.split('@')[0]}</p>
                              {ownerEmails.has(m) && (
                                <span className="shrink-0 px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 text-[9px] font-black uppercase tracking-widest">
                                  {t('labels.admin_badge') || 'Admin'}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-400 truncate">{m}</p>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
          <div
            ref={notificationDropdownRef}
            className={`p-2.5 rounded-xl transition cursor-pointer relative ${hdr.chip}`}
            title={t('labels.workspace_notifications') || 'Notifications'}
            onClick={() => {
              setShowMemberDropdown(false);
              setShowNotificationDropdown(!showNotificationDropdown);
            }}
          >
            <window.Icon name="bell" size={18} />
            {/* A dot, not a count — see the matching bell in WorkspaceHub. */}
            {sessionNotifications.length > 0 && (
              <span className="absolute top-0 right-0 w-2.5 h-2.5 rounded-full bg-red-500 border-2 border-white" />
            )}
            {showNotificationDropdown && (
              <div
                className="absolute top-full right-0 mt-2 w-[min(22rem,calc(100vw-2rem))] max-w-[22rem] bg-white rounded-2xl shadow-2xl border border-gray-100 z-[150] animate-pop text-black overflow-hidden flex flex-col"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex justify-between items-center px-4 py-3 border-b border-gray-100 bg-gray-50/80">
                  <div className="min-w-0 flex-1 pr-2">
                    <p className="text-xs font-black uppercase tracking-widest text-gray-500">
                      {t('labels.workspace_notifications') || 'Notifications'}
                    </p>
                  </div>
                  {sessionNotifications.length > 0 && (
                    <button
                      type="button"
                      className="text-[10px] font-black uppercase tracking-wider text-red-500 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 transition"
                      onClick={e => {
                        e.stopPropagation();
                        setSessionNotifications(clearWorkspaceNotificationsSession(wsNotificationStorageId));
                      }}
                    >
                      {t('labels.clear_workspace_notifications') || 'Clear all'}
                    </button>
                  )}
                </div>
                <div className="max-h-64 overflow-y-auto no-scrollbar p-2">
                  {sessionNotifications.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-6 px-3">
                      {t('labels.no_workspace_notifications') || 'No notifications yet.'}
                    </p>
                  ) : (
                    sessionNotifications.map(n => (
                      <div
                        key={n.id}
                        className="group flex items-start gap-1 rounded-xl hover:bg-gray-50 border border-transparent hover:border-gray-100 transition"
                      >
                        {/* The body is a button so the row is keyboard-reachable and
                            Enter-activatable, not just clickable. Notifications with no
                            cardId stay inert rather than looking actionable. */}
                        <button
                          type="button"
                          onClick={() => openNotification(n)}
                          disabled={!n.cardId}
                          title={n.cardId ? t('actions.open_card') || 'Open card' : undefined}
                          className={`flex-1 min-w-0 text-left p-2.5 rounded-xl ${
                            n.cardId ? 'cursor-pointer' : 'cursor-default'
                          }`}
                        >
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
                          onClick={e => {
                            e.stopPropagation();
                            setSessionNotifications(removeWorkspaceNotificationSession(wsNotificationStorageId, n.id));
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
          <window.ProfileMenu
            user={user}
            onLogout={onLogout}
            onThemeChange={onThemeChange}
            currentTheme={theme}
            onUpdateUser={onUpdateUser}
            onOpenProfile={onOpenProfile}
          />
        </div>
      </nav>
      {/* Mobile Tab Nav */}
      <div className="md:hidden flex bg-black/5 p-2 gap-1.5 justify-center border-b border-gray-100">
        {['board', 'vault', 'docs', 'api'].map(id => (
          <button
            key={id}
            onClick={() => selectTab(id)}
            className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-[0.15em] transition ${tab === id ? 'bg-white shadow-md text-black' : 'text-gray-500 opacity-60'}`}
          >
            {t(`tabs.${id}`)}
          </button>
        ))}
      </div>
      {tab === 'board' ? (
        <main className="p-4 md:p-8 flex-1 overflow-x-auto overflow-y-hidden no-scrollbar flex flex-col animate-fade-in h-full">
          <header className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 md:mb-12 gap-4 md:gap-6">
            <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-8 w-full overflow-hidden">
              <h1 className="text-2xl md:text-4xl font-black tracking-tighter truncate">{workspace.name}</h1>
              <div className="flex items-center gap-3 bg-gray-50/80 p-1.5 rounded-2xl border border-gray-100 flex-shrink-0">
                <div className="relative">
                  <window.Icon
                    name="search"
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                  />
                  <input
                    className="pl-8 pr-3 py-1.5 bg-white border border-gray-200 rounded-xl text-[10px] font-bold outline-none focus:border-blue-500 w-32 lg:w-48"
                    placeholder={t('labels.search_placeholder')}
                    value={filterKeyword}
                    onChange={e => setFilterKeyword(e.target.value)}
                  />
                </div>
                <select
                  className="bg-white text-[10px] font-bold px-3 py-1.5 rounded-xl border border-gray-200 outline-none cursor-pointer text-gray-600"
                  value={filterEpic}
                  onChange={e => setFilterEpic(e.target.value)}
                >
                  <option value="">{t('labels.all_epics') || 'All Epic Tag'}</option>
                  {epics.map(epic => (
                    <option key={epic} value={epic}>
                      {epic}
                    </option>
                  ))}
                </select>
                <select
                  className="bg-white text-[10px] font-bold px-3 py-1.5 rounded-xl border border-gray-200 outline-none cursor-pointer text-gray-600"
                  value={filterAssignee}
                  onChange={e => setFilterAssignee(e.target.value)}
                >
                  <option value="">{t('labels.all_members')}</option>
                  {members
                    .filter(m => m && typeof m === 'string')
                    .map(m => (
                      <option key={m} value={m}>
                        {m.split('@')[0]}
                      </option>
                    ))}
                </select>
                <button
                  onClick={() => setFilterExpiring(!filterExpiring)}
                  className={`p-2 rounded-xl border transition ${filterExpiring ? 'bg-red-500 border-red-500 text-white shadow-lg' : 'bg-white border-gray-200 text-gray-400 hover:text-red-500'}`}
                  title={t('labels.expiring_soon')}
                >
                  <window.Icon name="clock" size={14} />
                </button>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowActivityLog(!showActivityLog)}
                className={`px-6 py-4 rounded-full text-[9px] font-black uppercase tracking-widest shadow-xl active:scale-95 transition flex items-center gap-2 whitespace-nowrap ${showActivityLog ? 'bg-purple-100 text-purple-700' : 'bg-white text-gray-700 border border-gray-200'}`}
              >
                <window.Icon name="activity" size={14} /> {t('actions.activity_log') || 'Activity Log'}
              </button>
              <button
                onClick={() => setShowBacklog(!showBacklog)}
                className={`px-6 py-4 rounded-full text-[9px] font-black uppercase tracking-widest shadow-xl active:scale-95 transition flex items-center gap-2 ${showBacklog ? 'bg-blue-100 text-blue-700' : 'bg-white text-gray-700 border border-gray-200'}`}
              >
                <window.Icon name="list" size={14} /> {t('actions.backlog')}
              </button>
              <button
                onClick={() =>
                  showPrompt(t('actions.new_stage'), t('labels.stage_name'), async name => {
                    if (name) {
                      const newCols = [...columns, { id: window.generateId('col'), title: name }];
                      await fetch(`/api/workspaces/${workspace.id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ columns: newCols }),
                      });
                      setColumns(newCols);
                      logActivity('Added stage', 'stage', name);
                    }
                  })
                }
                className="bg-black text-white px-8 py-4 rounded-full text-[9px] font-black uppercase tracking-widest shadow-xl active:scale-95 transition flex-shrink-0"
              >
                {t('actions.new_stage')}
              </button>
            </div>
          </header>
          <dnd.DragDropContext
            onDragEnd={async result => {
              if (!result.destination) return;
              const { source, destination, draggableId, type } = result;

              if (type === 'COLUMN') {
                const newCols = [...columns];
                const [removed] = newCols.splice(source.index, 1);
                newCols.splice(destination.index, 0, removed);
                setColumns(newCols);
                await fetch(`/api/workspaces/${workspace.id}`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ columns: newCols }),
                });
                return;
              }

              const newCards = [...cards];
              const draggedIdx = newCards.findIndex(c => String(c.id || c._id) === String(draggableId));
              if (draggedIdx === -1) return;

              const draggedCard = { ...newCards[draggedIdx], columnId: destination.droppableId };
              newCards.splice(draggedIdx, 1);

              const destColCards = newCards.filter(c => c && c.columnId === destination.droppableId && !c.archived);

              if (destination.index >= destColCards.length) {
                newCards.push(draggedCard);
              } else {
                const anchorCardId = destColCards[destination.index].id || destColCards[destination.index]._id;
                const globalInsertIdx = newCards.findIndex(c => String(c.id || c._id) === String(anchorCardId));
                newCards.splice(globalInsertIdx, 0, draggedCard);
              }

              // Recalculate order index for the destination column
              const destColUpdatedCards = newCards.filter(
                c => c && c.columnId === destination.droppableId && !c.archived
              );
              const bulkUpdates = destColUpdatedCards.map((c, i) => {
                c.orderIndex = i;
                return { id: c.id || c._id, orderIndex: i, columnId: c.columnId };
              });

              const moveRes = await fetch(`/api/tasks/${draggableId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  columnId: destination.droppableId,
                  auditEvent: {
                    user: user?.email || 'System',
                    action: 'Moved card to ' + destination.droppableId,
                  },
                }),
              });
              const movedTask = await moveRes.json().catch(() => null);
              setCards(newCards =>
                newCards.map(c =>
                  c.id === movedTask.id ? { ...(movedTask || c), id: c.id || movedTask?.id || movedTask?._id } : c
                )
              );

              const movedCard = cards.find(c => c.id === draggableId || c._id === draggableId);
              const destColTitle =
                columns.find(c => c.id === destination.droppableId)?.title || destination.droppableId;
              logActivity('Moved card to ' + destColTitle, 'card', movedCard?.title);
              await fetch(`/api/workspaces/${workspace.id || workspace._id}/tasks/bulk-order`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ updates: bulkUpdates }),
              });
            }}
          >
            <div className="flex flex-col md:flex-row gap-6 flex-1 overflow-hidden h-full w-full">
              {showBacklog && (
                <div className="w-full md:w-80 flex-shrink-0 bg-gray-50 border border-gray-200 rounded-[2rem] flex flex-col h-[50vh] md:h-full animate-fade-in">
                  <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-100/50 rounded-t-[2rem]">
                    <h3 className="text-sm font-black uppercase tracking-widest text-gray-700 flex items-center gap-2">
                      <window.Icon name="list" size={16} className="text-gray-500" />
                      {t('actions.backlog')}
                      <span
                        className="shrink-0 px-2 py-0.5 rounded-full border border-gray-300 text-[10px] font-black text-gray-500 tabular-nums"
                        title={t('labels.tasks_in_stage', { count: columnCounts.backlog || 0 }) || `${columnCounts.backlog || 0} task(s) in this stage`}
                      >
                        {columnCounts.backlog || 0}
                      </span>
                    </h3>
                    <div className="flex gap-1 opacity-50 hover:opacity-100 transition">
                      <button onClick={() => setShowBacklog(false)} className="p-1 hover:bg-gray-200 rounded">
                        <window.Icon name="x" size={14} />
                      </button>
                    </div>
                  </div>
                  <dnd.Droppable droppableId="backlog">
                    {provided => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className="flex-1 overflow-y-auto no-scrollbar p-3 space-y-2 min-h-[100px]"
                      >
                        {displayCards
                          .filter(c => c && (c.columnId === 'backlog' || c.col === 'backlog'))
                          .map((card, idx) => (
                            <dnd.Draggable
                              key={`backlog-${card.id || card._id || idx}`}
                              draggableId={String(card.id || card._id)}
                              index={idx}
                            >
                              {(dragProvided, snapshot) => (
                                <div
                                  ref={dragProvided.innerRef}
                                  {...dragProvided.draggableProps}
                                  {...dragProvided.dragHandleProps}
                                  onClick={() => openCard(card)}
                                  className={`bg-white border border-gray-100 rounded-xl p-3 shadow-sm hover:shadow-md transition cursor-pointer flex justify-between items-center group ${snapshot.isDragging ? 'rotate-2 scale-105 shadow-xl z-50' : ''}`}
                                >
                                  {lockedCards[card.id || card._id] &&
                                    lockedCards[card.id || card._id] !== user?.email && (
                                      <div
                                        className="absolute -top-2 -right-2 bg-red-100 text-red-600 rounded-full p-1 z-10 shadow-sm border border-white"
                                        title={`Locked by ${lockedCards[card.id || card._id]}`}
                                      >
                                        <window.Icon name="lock" size={12} />
                                      </div>
                                    )}
                                  <div className="flex flex-col gap-1 overflow-hidden pr-2">
                                    <span className="font-bold text-xs text-gray-800 truncate">
                                      {card.epic ? (
                                        <span className="mr-1 text-[8px] px-1 bg-purple-100 text-purple-700 rounded uppercase">
                                          {card.epic}
                                        </span>
                                      ) : null}
                                      {card.title}
                                    </span>
                                    <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">
                                      {card.dueDate ? new Date(card.dueDate).toLocaleDateString() : t('labels.no_date')}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    {card.qaStatus &&
                                      card.qaStatus !== 'NONE' &&
                                      (() => {
                                        const qa = {
                                          PENDING: {
                                            icon: 'clock',
                                            cls: 'bg-amber-100 text-amber-700 border-amber-200',
                                          },
                                          PASSED: {
                                            icon: 'check-circle',
                                            cls: 'bg-emerald-100 text-emerald-700 border-emerald-200',
                                          },
                                          FAILED: {
                                            icon: 'x-circle',
                                            cls: 'bg-red-100 text-red-700 border-red-200',
                                          },
                                        }[card.qaStatus];
                                        return qa ? (
                                          <div
                                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest border ${qa.cls}`}
                                            title={t(`labels.qa_${card.qaStatus.toLowerCase()}`)}
                                          >
                                            <window.Icon name={qa.icon} size={10} />
                                          </div>
                                        ) : null;
                                      })()}
                                    <div
                                      className={`w-2 h-2 rounded-full ${{ low: 'bg-blue-300', med: 'bg-yellow-400', high: 'bg-red-500', LOW: 'bg-blue-300', MED: 'bg-yellow-400', HIGH: 'bg-red-500' }[card.urgency?.toLowerCase() || 'low']}`}
                                    ></div>
                                  </div>
                                </div>
                              )}
                            </dnd.Draggable>
                          ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </dnd.Droppable>
                  <div className="p-3 border-t border-gray-200 bg-gray-100/50 rounded-b-[2rem]">
                    <button
                      onClick={() => {
                        const nc = {
                          columnId: 'backlog',
                          title: t('labels.new_backlog_item'),
                          urgency: 'LOW',
                          assignees: [user?.email],
                          auditEvent: {
                            user: user?.email || 'System',
                            action: 'Created backlog card',
                          },
                        };
                        fetch(`/api/workspaces/${workspace.id}/tasks`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(nc),
                        })
                          .then(r => r.json())
                          .then(task => {
                            const resId = task.id || task._id;
                            const finalTask = { ...task, id: resId };
                            setCards(prev => [...prev, finalTask]);
                            openCard(finalTask);
                            logActivity('Created backlog card', 'card', nc.title);
                          });
                      }}
                      className="w-full py-2 bg-white border border-gray-200 text-gray-600 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-gray-50 transition shadow-sm flex items-center justify-center gap-2"
                    >
                      <window.Icon name="plus" size={14} /> {t('actions.add_to_backlog')}
                    </button>
                  </div>
                </div>
              )}
              {showActivityLog &&
                (() => {
                  const allLogs = activityLogs;
                  return (
                    <div className="w-full md:w-80 flex-shrink-0 bg-gray-50 border border-gray-200 rounded-[2rem] flex flex-col h-[50vh] md:h-full animate-fade-in">
                      <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-100/50 rounded-t-[2rem]">
                        <h3 className="text-sm font-black uppercase tracking-widest text-gray-700 flex items-center gap-2">
                          <window.Icon name="activity" size={16} className="text-purple-500" />
                          {t('actions.activity_log') || 'Activity Log'}
                        </h3>
                        <button
                          onClick={() => setShowActivityLog(false)}
                          className="p-1 hover:bg-gray-200 rounded opacity-50 hover:opacity-100 transition"
                        >
                          <window.Icon name="x" size={14} />
                        </button>
                      </div>
                      <div className="flex-1 overflow-y-auto no-scrollbar p-3 pb-6 space-y-2">
                        {allLogs.length === 0 ? (
                          <p className="text-[10px] text-gray-400 font-bold text-center py-8 uppercase tracking-widest">
                            {t('labels.no_activity') || 'No activity yet'}
                          </p>
                        ) : (
                          allLogs.map((log, i) => (
                            <div key={log.id || i} className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex flex-col gap-0.5 overflow-hidden">
                                  <span className="text-[10px] font-black text-gray-700 truncate">
                                    {log.user || 'System'}
                                  </span>
                                  <span className="text-[9px] text-gray-500 font-bold">{log.action}</span>
                                  {log.resourceName && (
                                    <div className="flex items-center gap-1 mt-0.5 overflow-hidden">
                                      <span
                                        className="min-w-0 flex-1 overflow-hidden"
                                        onMouseEnter={e => {
                                          const r = e.currentTarget.getBoundingClientRect();
                                          setActivityTooltip({
                                            text: log.resourceName,
                                            x: r.left,
                                            y: r.top - 4,
                                          });
                                        }}
                                        onMouseLeave={() => setActivityTooltip(null)}
                                      >
                                        <span className="text-[8px] text-sky-500 font-black uppercase tracking-widest truncate px-1.5 py-0.5 bg-sky-50 rounded block">
                                          {log.resourceName}
                                        </span>
                                      </span>
                                      <span
                                        className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded flex-shrink-0 ${{ card: 'bg-purple-50 text-purple-600', stage: 'bg-orange-50 text-orange-500', vault: 'bg-yellow-50 text-yellow-600', doc: 'bg-green-50 text-green-600', folder: 'bg-pink-50 text-pink-600', api: 'bg-blue-50 text-blue-600' }[log.resourceType] || 'bg-gray-100 text-gray-500'}`}
                                      >
                                        {log.resourceType}
                                      </span>
                                    </div>
                                  )}
                                </div>
                                <span className="text-[8px] text-gray-400 font-bold flex-shrink-0">
                                  {new Date(log.createdAt).toLocaleString()}
                                </span>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                      <div className="p-3 border-t border-gray-200 bg-gray-100/50 rounded-b-[2rem]">
                        <p className="text-[8px] text-gray-400 font-black uppercase tracking-widest text-center">
                          {allLogs.length} {t('labels.events') || 'events'}
                        </p>
                      </div>
                    </div>
                  );
                })()}
              {activityTooltip && (
                <div
                  className="fixed z-[9999] bg-gray-800 text-white text-[8px] font-bold px-2 py-1 rounded shadow-lg whitespace-normal max-w-[220px] pointer-events-none"
                  style={{
                    left: activityTooltip.x,
                    top: activityTooltip.y,
                    transform: 'translateY(-100%)',
                  }}
                >
                  {activityTooltip.text}
                </div>
              )}
              <dnd.Droppable droppableId="all-columns" direction="horizontal" type="COLUMN">
                {providedBoard => (
                  <div
                    className="flex flex-col md:flex-row gap-6 md:gap-10 flex-1 h-full overflow-x-auto overflow-y-hidden no-scrollbar w-full"
                    {...providedBoard.droppableProps}
                    ref={providedBoard.innerRef}
                  >
                    {columns
                      .filter(col => col.id !== 'backlog')
                      .map((col, index) => (
                        <dnd.Draggable
                          key={String(col.id || `col-${index}`)}
                          draggableId={String(col.id || `col-${index}`)}
                          index={index}
                        >
                          {(providedCol, snapshotCol) => (
                            /* Stages are outlined: the default theme puts a white column
                               on a white page, where the only thing separating one stage
                               from the next was the gap between them. The border is the
                               drag affordance too — picking a column up colours it. */
                            <div
                              ref={providedCol.innerRef}
                              {...providedCol.draggableProps}
                              className={`w-full md:w-80 flex flex-col gap-4 group ${hdr.surfaceSoft} ${snapshotCol.isDragging ? hdr.surfaceBorderDragging : hdr.surfaceBorder} rounded-[2rem] p-4 h-full max-h-full overflow-hidden flex-shrink-0 transition-colors duration-200`}
                            >
                              <div
                                {...providedCol.dragHandleProps}
                                className={`relative flex justify-between items-start gap-2 px-4 border-b border-inherit pb-4 pt-2 flex-shrink-0`}
                              >
                                <div className="flex gap-2 items-start min-w-0 flex-1">
                                  {editingStageId === col.id ? (
                                    <input
                                      autoFocus
                                      value={editingStageTitle}
                                      onChange={e => setEditingStageTitle(e.target.value)}
                                      onBlur={() => commitRenameStage(col)}
                                      /* This header is the column's drag handle. Without
                                         stopping these two, rbd's sensors see the input's
                                         events: a mousedown starts dragging the stage
                                         instead of placing the caret, and typing a space
                                         lifts the column mid-word. */
                                      onMouseDown={e => e.stopPropagation()}
                                      onTouchStart={e => e.stopPropagation()}
                                      onKeyDown={e => {
                                        e.stopPropagation();
                                        if (e.key === 'Enter') {
                                          e.preventDefault();
                                          commitRenameStage(col);
                                        } else if (e.key === 'Escape') {
                                          e.preventDefault();
                                          cancelRenameStage();
                                        }
                                      }}
                                      aria-label={t('labels.stage_name') || 'Stage name'}
                                      className="min-w-0 flex-1 bg-transparent text-sm font-black uppercase tracking-widest text-inherit border-b border-inherit outline-none pb-0.5"
                                    />
                                  ) : (
                                    /* Wraps rather than truncates: a stage name is the
                                       only label the column carries, and an ellipsis on
                                       "In Progress — Blocked" hides the part that
                                       distinguishes it from its neighbour. `break-words`
                                       splits a word only when it cannot fit the line on
                                       its own, so this stays safe for a long unbroken
                                       name — what produced "IN PROGRE / SS" was the box
                                       being narrower than the word, not the wrap rule. */
                                    <h3
                                      className="text-sm font-black uppercase tracking-widest text-inherit break-words min-w-0"
                                      title={col.title}
                                    >
                                      {col.title}
                                    </h3>
                                  )}
                                  <span
                                    className="shrink-0 px-2 py-0.5 rounded-full border border-inherit text-[10px] font-black text-inherit opacity-60 tabular-nums"
                                    title={t('labels.tasks_in_stage', { count: columnCounts[col.id] || 0 }) || `${columnCounts[col.id] || 0} task(s) in this stage`}
                                  >
                                    {columnCounts[col.id] || 0}
                                  </span>
                                </div>
                                {/* Absolute, not a flex sibling: `opacity-0` hides these
                                    four buttons but still reserves their width, which left
                                    the title with ~135px of a 320px column and forced it to
                                    wrap. Out of flow, the title has the full header until
                                    you hover, and the group then sits on an opaque chip so
                                    it stays legible over whatever it covers.
                                    focus-within keeps it reachable by keyboard — hover-only
                                    controls are invisible to Tab otherwise. */}
                                <div
                                  className={`absolute right-3 -top-1 flex gap-1 rounded-xl px-1 py-0.5 ${hdr.surface} shadow-sm opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition`}
                                >
                                  <button
                                    type="button"
                                    onClick={() => beginRenameStage(col)}
                                    className={`p-1.5 rounded-lg transition ${hdr.surfaceIcon}`}
                                    title={t('actions.rename_stage') || 'Rename Stage'}
                                  >
                                    <window.Icon name="pencil" size={18} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setViewArchivedCol(col.id)}
                                    className={`p-1.5 rounded-lg transition ${hdr.surfaceIcon}`}
                                    title={t('labels.archived_cards')}
                                  >
                                    <window.Icon name="archive" size={18} />
                                  </button>
                                  <button
                                    onClick={() => {
                                      const nc = {
                                        columnId: col.id,
                                        title: t('labels.new_task'),
                                        urgency: 'LOW',
                                        assignees: [user?.email],
                                        auditEvent: {
                                          user: user?.email || 'System',
                                          action: 'Created card',
                                        },
                                      };
                                      fetch(`/api/workspaces/${workspace.id}/tasks`, {
                                        method: 'POST',
                                        headers: {
                                          'Content-Type': 'application/json',
                                        },
                                        body: JSON.stringify(nc),
                                      })
                                        .then(r => r.json())
                                        .then(task => {
                                          const resId = task.id || task._id;
                                          const finalTask = {
                                            ...task,
                                            id: resId,
                                          };
                                          setCards(prev => [...prev, finalTask]);
                                          openCard(finalTask);
                                          logActivity('Created card', 'card', nc.title);
                                        });
                                    }}
                                    className={`p-1.5 rounded-lg transition ${hdr.surfaceIcon}`}
                                    title={t('actions.new_task')}
                                  >
                                    <window.Icon name="plus-circle" size={18} />
                                  </button>
                                  {/* Guarded on "is this the last stage", not on the seeded
                                      id `todo`: keying on the id meant a renamed first stage
                                      stayed undeletable for no visible reason, while a board
                                      that never had a `todo` could be emptied completely. */}
                                  {stageCount > 1 && (
                                    <button
                                      onClick={() => {
                                        // Raw `cards`, not the filtered view: archived tasks
                                        // live in this stage too and would be stranded.
                                        const stranded = cards
                                          .filter(c => c && (c.columnId === col.id || c.col === col.id))
                                          .map(c => c.id || c._id)
                                          .filter(Boolean);
                                        showConfirm(
                                          t('actions.erase_stage'),
                                          stranded.length
                                            ? t('alerts.confirm_erase_stage_with_cards', {
                                                name: col.title,
                                                count: stranded.length,
                                              })
                                            : t('alerts.confirm_erase_stage', {
                                                name: col.title,
                                              }),
                                          async () => {
                                            // The cards move first. A task whose columnId
                                            // points at a deleted stage matches no column, so
                                            // it disappears from the board while still sitting
                                            // in the database — invisible, undeletable work.
                                            if (stranded.length) {
                                              const moved = await fetch(
                                                `/api/workspaces/${workspace.id}/tasks/bulk-move`,
                                                {
                                                  method: 'PUT',
                                                  headers: { 'Content-Type': 'application/json' },
                                                  body: JSON.stringify({
                                                    cardIds: stranded,
                                                    targetColumn: 'backlog',
                                                  }),
                                                }
                                              );
                                              if (!moved.ok) {
                                                showAlert(
                                                  t('alerts.erase_stage_move_failed') ||
                                                    "Could not move this stage's tasks. The stage was left in place."
                                                );
                                                return;
                                              }
                                              setCards(prev =>
                                                prev.map(c =>
                                                  stranded.includes(c.id || c._id)
                                                    ? { ...c, columnId: 'backlog', col: 'backlog' }
                                                    : c
                                                )
                                              );
                                            }
                                            const newCols = columns.filter(c => c.id !== col.id);
                                            const res = await fetch(`/api/workspaces/${workspace.id}`, {
                                              method: 'PUT',
                                              headers: {
                                                'Content-Type': 'application/json',
                                              },
                                              body: JSON.stringify({
                                                columns: newCols,
                                              }),
                                            });
                                            if (!res.ok) {
                                              showAlert(
                                                t('alerts.erase_stage_failed') ||
                                                  'Could not remove the stage. Any tasks it held were moved to the Backlog.'
                                              );
                                              return;
                                            }
                                            setColumns(newCols);
                                            logActivity('Deleted stage', 'stage', col.title);
                                          }
                                        );
                                      }}
                                      className={`p-1.5 rounded-lg transition ${hdr.surfaceIconDanger}`}
                                      title={t('actions.erase_stage')}
                                    >
                                      <window.Icon name="minus-circle" size={18} />
                                    </button>
                                  )}
                                </div>
                              </div>
                              <dnd.Droppable droppableId={String(col.id || `col-${index}`)}>
                                {providedCards => (
                                  <div
                                    ref={providedCards.innerRef}
                                    {...providedCards.droppableProps}
                                    className="space-y-8 min-h-[100px] overflow-y-auto no-scrollbar flex-1 pb-4"
                                  >
                                    {loading &&
                                      [0, 1, 2].map(i => (
                                        <div
                                          key={`skeleton-${col.id}-${i}`}
                                          aria-hidden="true"
                                          className="bg-white border border-gray-100 rounded-2xl p-4 insta-shadow animate-pulse"
                                        >
                                          <div className="w-16 h-2 rounded-full bg-gray-200 mb-4"></div>
                                          <div className="h-3 rounded bg-gray-200 mb-2 w-4/5"></div>
                                          <div className="h-3 rounded bg-gray-100 mb-4 w-2/5"></div>
                                          <div className="pt-3 border-t border-gray-50 flex items-center justify-between">
                                            <div className="w-7 h-7 rounded-full bg-gray-200"></div>
                                            <div className="w-10 h-2 rounded-full bg-gray-100"></div>
                                          </div>
                                        </div>
                                      ))}
                                    {displayCards
                                      .filter(c => c && (c.columnId === col.id || c.col === col.id))
                                      .map((card, idx) => (
                                        <dnd.Draggable
                                          key={`col-${card.id || card._id || idx}`}
                                          draggableId={String(card.id || card._id)}
                                          index={idx}
                                        >
                                          {(provided, snapshot) => (
                                            <div
                                              ref={provided.innerRef}
                                              {...provided.draggableProps}
                                              {...provided.dragHandleProps}
                                              onClick={() => openCard(card)}
                                              className={`bg-white text-gray-800 border border-gray-100 rounded-2xl p-4 insta-shadow hover:shadow-xl transition-all duration-300 cursor-pointer group relative ${snapshot.isDragging ? 'rotate-2 scale-105 shadow-2xl z-50' : 'hover:scale-[1.02]'}`}
                                            >
                                              {lockedCards[card.id || card._id] &&
                                                lockedCards[card.id || card._id] !== user?.email && (
                                                  <div
                                                    className="absolute top-2 right-2 bg-red-100 text-red-600 rounded-full p-1.5 z-10 shadow-sm border border-white"
                                                    title={`Locked by ${lockedCards[card.id || card._id]}`}
                                                  >
                                                    <window.Icon name="lock" size={14} />
                                                  </div>
                                                )}
                                              <div className="flex justify-between items-start mb-3">
                                                <div className="flex items-center gap-2">
                                                  <div
                                                    className={`w-16 h-2 rounded-full ${{ low: 'bg-blue-300', med: 'bg-yellow-400', high: 'bg-red-500', LOW: 'bg-blue-300', MED: 'bg-yellow-400', HIGH: 'bg-red-500' }[card.urgency?.toLowerCase() || 'low']}`}
                                                  ></div>
                                                  {card.qaStatus &&
                                                    card.qaStatus !== 'NONE' &&
                                                    (() => {
                                                      const qa = {
                                                        PENDING: {
                                                          icon: 'clock',
                                                          cls: 'bg-amber-100 text-amber-700 border-amber-200',
                                                        },
                                                        PASSED: {
                                                          icon: 'check-circle',
                                                          cls: 'bg-emerald-100 text-emerald-700 border-emerald-200',
                                                        },
                                                        FAILED: {
                                                          icon: 'x-circle',
                                                          cls: 'bg-red-100 text-red-700 border-red-200',
                                                        },
                                                      }[card.qaStatus];
                                                      return qa ? (
                                                        <div
                                                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest border ${qa.cls}`}
                                                          title={t(`labels.qa_${card.qaStatus.toLowerCase()}`)}
                                                        >
                                                          <window.Icon name={qa.icon} size={10} />
                                                          {t(`labels.qa_${card.qaStatus.toLowerCase()}`)}
                                                        </div>
                                                      ) : null;
                                                    })()}
                                                </div>
                                                <div
                                                  className="opacity-0 group-hover:opacity-100 flex gap-2 transition"
                                                  onClick={e => e.stopPropagation()}
                                                >
                                                  <button
                                                    onClick={async e => {
                                                      e.stopPropagation();
                                                      await fetch(`/api/tasks/${card.id}`, {
                                                        method: 'PUT',
                                                        headers: {
                                                          'Content-Type': 'application/json',
                                                        },
                                                        body: JSON.stringify({
                                                          archived: true,
                                                          auditEvent: {
                                                            user: user?.email || 'System',
                                                            action: 'Archived card',
                                                          },
                                                        }),
                                                      });
                                                      setCards(
                                                        cards.map(c =>
                                                          c.id === card.id
                                                            ? {
                                                                ...c,
                                                                archived: true,
                                                              }
                                                            : c
                                                        )
                                                      );
                                                      showToast(t('alerts.card_archived'), 'success');
                                                      logActivity('Archived card', 'card', card.title);
                                                    }}
                                                    className="p-2 bg-gray-50 text-gray-400 hover:text-red-500 rounded-xl hover:bg-red-50"
                                                    title={t('actions.archive')}
                                                  >
                                                    <window.Icon name="archive" size={14} />
                                                  </button>
                                                  <button
                                                    onClick={e => {
                                                      e.stopPropagation();
                                                      moveCard(card.id, -1);
                                                    }}
                                                    className="p-2 bg-gray-50 rounded-xl hover:bg-gray-100"
                                                  >
                                                    <window.Icon name="arrow-left" size={14} />
                                                  </button>
                                                  <button
                                                    onClick={e => {
                                                      e.stopPropagation();
                                                      moveCard(card.id, 1);
                                                    }}
                                                    className="p-2 bg-gray-50 rounded-xl hover:bg-gray-100"
                                                  >
                                                    <window.Icon name="arrow-right" size={14} />
                                                  </button>
                                                </div>
                                              </div>
                                              {card.epic && (
                                                <div className="inline-block px-2 py-0.5 bg-purple-100 text-purple-700 text-[8px] font-black uppercase tracking-widest rounded mb-2 shadow-sm border border-purple-200">
                                                  {card.epic}
                                                </div>
                                              )}
                                              <h4 className="font-black text-base leading-tight mb-3 tracking-tight">
                                                {card.title}
                                              </h4>
                                              {card.dueDate && (
                                                <div className="inline-flex items-center gap-2.5 bg-red-50 text-red-500 px-3 py-1.5 rounded-full text-[8px] font-black uppercase tracking-widest mb-3 border-2 border-red-100 shadow-lg shadow-red-100">
                                                  <window.Icon name="calendar" size={14} />{' '}
                                                  {new Date(card.dueDate).toLocaleDateString()}
                                                </div>
                                              )}
                                              {card.checklist?.length > 0 && (
                                                <div className="w-full bg-gray-50 h-1.5 rounded-full overflow-hidden mb-3 border border-gray-100">
                                                  <div
                                                    className="bg-emerald-400 h-full transition-all duration-1000"
                                                    style={{
                                                      width: `${(card.checklist.filter(i => i && i.done).length / card.checklist.length) * 100}%`,
                                                    }}
                                                  ></div>
                                                </div>
                                              )}
                                              <div className="pt-3 border-t border-gray-50 flex items-center justify-between text-gray-300">
                                                <div className="flex -space-x-2">
                                                  {card.assignees?.map(email => {
                                                    if (!email) return null;
                                                    const m = getMemberData(email);
                                                    return (
                                                      <window.Avatar
                                                        key={email}
                                                        label={window.getInitials(m)}
                                                        src={window.getImageUrl(m.avatar)}
                                                        size="sm"
                                                        active
                                                      />
                                                    );
                                                  })}
                                                </div>
                                                <div className="flex gap-2">
                                                  {card.attachments?.length > 0 && (
                                                    <window.Icon name="paperclip" size={14} />
                                                  )}
                                                  {card.content && <window.Icon name="align-left" size={14} />}
                                                  {card.comments?.length > 0 && (
                                                    <div className="flex items-center gap-1 text-[10px] font-bold text-gray-400">
                                                      <window.Icon name="message-circle" size={14} />{' '}
                                                      {card.comments.length}
                                                    </div>
                                                  )}
                                                </div>
                                              </div>
                                            </div>
                                          )}
                                        </dnd.Draggable>
                                      ))}
                                    {providedCards.placeholder}
                                  </div>
                                )}
                              </dnd.Droppable>
                            </div>
                          )}
                        </dnd.Draggable>
                      ))}
                    {providedBoard.placeholder}
                  </div>
                )}
              </dnd.Droppable>
            </div>
          </dnd.DragDropContext>
        </main>
      ) : tab === 'vault' ? (
        <window.VaultTab
          workspace={localWorkspace}
          user={user}
          onUpdate={updateWorkspace}
          onUpdateUser={onUpdateUser}
          onLogActivity={logActivity}
        />
      ) : tab === 'docs' ? (
        <window.DocsTab workspaceId={workspace?.id || workspace?._id} user={user} onLogActivity={logActivity} />
      ) : tab === 'api' ? (
        <window.ApisTab workspaceId={workspace?.id || workspace?._id} user={user} onLogActivity={logActivity} />
      ) : null}
      {editingCard && (
        <window.CardModal
          // Read-only viewers remount on every version bump so the 15s task poll
          // actually shows them the editor's saved changes. An editor keeps a
          // stable key — remounting would throw away their unsaved draft.
          key={
            lockedCards[editingCard.id || editingCard._id] &&
            lockedCards[editingCard.id || editingCard._id] !== user?.email
              ? `${editingCard.id || editingCard._id}-v${editingCard.__v || 0}`
              : String(editingCard.id || editingCard._id)
          }
          card={editingCard}
          lockedBy={lockedCards[editingCard.id || editingCard._id]}
          user={user}
          members={members}
          allUsers={allUsers}
          socket={socketRef.current}
          workspaceId={workspace.id || workspace._id}
          cardUrl={`${window.location.origin}${buildCardPath(workspace, editingCard.id || editingCard._id)}`}
          onClose={() => {
            setEditingCard(null);
            clearCardUrl();
          }}
          onSave={async upd => {
            const cardId = editingCard.id || editingCard._id;
            const res = await fetch(`/api/tasks/${cardId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(upd),
            });
            const updatedTask = await res.json();
            if (!res.ok) {
              if (res.status === 409) {
                showAlert(
                  t('alerts.overwrite_conflict') ||
                    updatedTask.error ||
                    'Conflict: This card was modified by another user recently. Please refresh to avoid overwriting their work.',
                  t('alerts.conflict') || 'Overwrite Conflict'
                );
              } else {
                showAlert(updatedTask.error || 'Failed to update task', 'Update Error');
              }
              return;
            }
            setCards(prev => (prev || []).map(c => (c && (c.id === cardId || c._id === cardId) ? updatedTask : c)));
            logActivity('Updated card', 'card', editingCard.title);
            setEditingCard(null);
            clearCardUrl();
          }}
          onDelete={async id => {
            const deletedCard = (cards || []).find(c => c && (c.id === id || c._id === id));
            await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
            setCards(prev => (prev || []).filter(c => c && c.id !== id && c._id !== id));
            setEditingCard(null);
            clearCardUrl();
            logActivity('Deleted card', 'card', deletedCard?.title || 'Untitled card');
          }}
        />
      )}

      {/* Emoji Spam Animation */}
      {spamEmojis.map(s => (
        <div
          key={s.id}
          className="fixed z-[2000] text-4xl pointer-events-none animate-fly-up-fade"
          style={{
            left: s.left,
            bottom: '15%',
            animationDelay: `${s.delay}s`,
            animationDuration: `${s.duration}s`,
            '--sway': s.sway,
            transform: `rotate(${s.rotate}deg)`,
          }}
        >
          {s.emoji}
        </div>
      ))}

      {/* AI Floating Quoter (Emoji Icon) */}
      <div
        className={`fixed right-5 z-[2001] transition-all duration-400 ${isJukeboxActive ? 'bottom-[calc(45%+70px)]' : 'bottom-[160px]'}`}
      >
        <div className="relative">
          <button
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-2xl hover:scale-110 active:scale-95 transition border border-gray-100"
          >
            <window.Icon name="smile" size={24} className="text-yellow-500" />
          </button>
          {showEmojiPicker && (
            <div className="absolute bottom-0 right-16 bg-white p-4 rounded-3xl shadow-2xl flex flex-wrap gap-3 border border-gray-100 animate-pop w-[280px]">
              {[
                '😀',
                '😂',
                '😡',
                '🤯',
                '🤖',
                '☕',
                '🔥',
                '🚀',
                '💡',
                '🏆',
                '🎯',
                '💪',
                '🎉',
                '😎',
                '😴',
                '🙌',
                '🙏',
                '🌟',
                '✨',
                '💯',
                '🦄',
                '🐉',
              ].map(e => (
                <button
                  key={e}
                  onClick={() => handleEmojiSelect(e)}
                  className="text-2xl hover:scale-125 transition transform origin-center"
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* AI Footer Quote with typing animation */}
      {footerQuote && (
        <div className="fixed bottom-0 left-0 right-0 z-[1000] p-4 pointer-events-none">
          <div className="w-3/4 max-w-4xl mx-auto bg-black/80 backdrop-blur-md border border-white/10 text-white px-8 py-4 rounded-full text-center shadow-2xl shadow-blue-500/20 animate-fade-in-up">
            <p className="text-xs font-black uppercase tracking-widest typing-effect overflow-hidden whitespace-nowrap">
              {footerQuote}
            </p>
          </div>
        </div>
      )}

      {/* Floating AI Assistant Chat */}

      {showExpiredModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xl z-[9999] flex items-center justify-center p-4 animate-fade-in">
          <div className="max-w-[480px] w-full bg-white p-8 rounded-[2.5rem] shadow-2xl border border-red-500/30">
            <div className="w-16 h-16 bg-red-50 rounded-3xl flex items-center justify-center mx-auto mb-6">
              <window.Icon name="alert-triangle" size={32} className="text-red-500" />
            </div>
            <h2 className="text-3xl font-black italic tracking-tighter mb-2 text-center text-black">
              {t('labels.action_required')}
            </h2>
            <p className="text-xs text-gray-500 mb-6 text-center font-bold">{t('alerts.overdue_msg')}</p>

            <div className="max-h-[200px] overflow-y-auto no-scrollbar space-y-2 mb-6 border border-gray-100 rounded-2xl p-4 bg-gray-50">
              {expiredCards.map(c => (
                <div key={c.id || c._id} className="flex justify-between items-center text-xs">
                  <span className="font-bold text-gray-800 truncate pr-4">{c.title}</span>
                  <span className="text-[9px] font-black text-red-500 uppercase tracking-widest whitespace-nowrap bg-red-50 px-2 py-1 rounded-md">
                    {new Date(c.dueDate).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <button
                onClick={async () => {
                  const cardIds = expiredCards.map(c => c.id || c._id);
                  await fetch(`/api/workspaces/${workspace.id}/tasks/bulk-archive`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cardIds }),
                  });
                  setCards(prev =>
                    prev.map(c =>
                      cardIds.includes(c.id || c._id) ? { ...c, archived: true, expiredAlertAcknowledged: true } : c
                    )
                  );
                  setShowExpiredModal(false);
                  showToast(t('alerts.workspace_archived'));
                }}
                className="w-full py-3 bg-red-500 text-white rounded-xl text-xs font-black tracking-widest uppercase shadow-lg shadow-red-200 hover:scale-105 active:scale-95 transition"
              >
                {t('actions.archive_all_expired')}
              </button>

              <div className="flex gap-2">
                <select
                  value={selectedMoveCol}
                  onChange={e => setSelectedMoveCol(e.target.value)}
                  className="flex-1 px-4 py-3 bg-white border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-black"
                >
                  {columns.map(col => (
                    <option key={col.id} value={col.id}>
                      {col.title}
                    </option>
                  ))}
                </select>
                <button
                  onClick={async () => {
                    if (!selectedMoveCol) return;
                    const cardIds = expiredCards.map(c => c.id || c._id);
                    await fetch(`/api/workspaces/${workspace.id}/tasks/bulk-move`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ cardIds, targetColumn: selectedMoveCol }),
                    });
                    setCards(prev =>
                      prev.map(c =>
                        cardIds.includes(c.id || c._id)
                          ? {
                              ...c,
                              columnId: selectedMoveCol,
                              col: selectedMoveCol,
                              expiredAlertAcknowledged: true,
                            }
                          : c
                      )
                    );
                    setShowExpiredModal(false);
                    showToast(t('alerts.tasks_moved'));
                  }}
                  className="px-6 py-3 bg-black text-white rounded-xl text-xs font-black tracking-widest uppercase shadow-lg shadow-gray-300 hover:scale-105 active:scale-95 transition"
                >
                  {t('actions.move_all')}
                </button>
              </div>

              <button
                onClick={() => setShowExpiredModal(false)}
                className="w-full py-3 text-gray-500 rounded-xl text-[10px] font-black tracking-widest uppercase hover:bg-gray-50 transition"
              >
                {t('actions.do_nothing')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        className={`ai-floating ${isJukeboxActive ? 'ai-floating-shifted' : 'ai-floating-default'} ${isAIChatOpen ? 'ai-maximized bg-white' : 'ai-minimized bg-black'} animate-pop`}
      >
        {isAIChatOpen ? (
          <>
            <div className="p-4 bg-black text-white flex justify-between items-center">
              <div className="flex items-center gap-2">
                <window.Icon name="sparkles" size={16} />
                <span className="text-xs font-black uppercase tracking-widest">NoobieHelper</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setIsAISettingsOpen(true)} className="p-1 hover:bg-white/10 rounded transition">
                  <window.Icon name="settings" size={14} />
                </button>
                <button onClick={() => setIsAIChatOpen(false)} className="p-1 hover:bg-white/10 rounded transition">
                  <window.Icon name="minus" size={14} />
                </button>
              </div>
            </div>
            <div className="flex-1 p-4 overflow-y-auto no-scrollbar flex flex-col">
              {aiMessages
                // tool_result turns carry raw JSON meant for the model, and a
                // tool-call-only assistant turn has content: null. Neither is
                // something a user should see as a chat bubble.
                .filter(msg => msg && (msg.role === 'user' || (msg.role === 'bot' && msg.content)))
                .map((msg, i) => (
                  <div key={i} className={`ai-message ${msg.role === 'user' ? 'ai-msg-user' : 'ai-msg-bot'}`}>
                    {msg.content}
                  </div>
                ))}
            </div>
            {aiAttachment && (
              <div className="px-4 py-2 bg-blue-50 border-t border-blue-100 flex justify-between items-center text-xs text-blue-700 font-bold">
                <div className="flex items-center gap-2 truncate">
                  <window.Icon name="file-text" size={14} /> {aiAttachment.name}
                </div>
                <button
                  onClick={() => setAiAttachment(null)}
                  className="p-1 hover:bg-blue-100 rounded text-blue-400 hover:text-blue-700 transition"
                >
                  <window.Icon name="x" size={14} />
                </button>
              </div>
            )}
            <div
              className="p-4 border-t border-gray-100 flex gap-2 relative"
              onDragOver={e => {
                e.preventDefault();
                setIsAiDragging(true);
              }}
              onDragLeave={() => setIsAiDragging(false)}
              onDrop={async e => {
                e.preventDefault();
                setIsAiDragging(false);
                const file = e.dataTransfer.files[0];
                if (file) handleAiFileUpload(file);
              }}
            >
              {isAiDragging && (
                <div className="absolute inset-0 z-50 bg-white/90 border-2 border-dashed border-blue-400 rounded-b-2xl flex items-center justify-center pointer-events-none">
                  <p className="text-blue-500 font-black text-xs uppercase tracking-widest flex items-center gap-2">
                    <window.Icon name="upload-cloud" size={16} /> Drop file to analyze context
                  </p>
                </div>
              )}
              <button
                onClick={() => aiFileInputRef.current && aiFileInputRef.current.click()}
                className="p-3 bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-700 rounded-xl transition"
                title="Upload PRD or Meeting Minutes (TXT/MD/JSON)"
              >
                <window.Icon name="paperclip" size={18} />
              </button>
              <input
                type="file"
                ref={aiFileInputRef}
                className="hidden"
                accept=".txt,.md,.json,.csv"
                onChange={e => {
                  if (e.target.files[0]) handleAiFileUpload(e.target.files[0]);
                }}
              />
              <input
                className="flex-1 p-3 bg-gray-50 rounded-xl text-xs outline-none focus:ring-1 focus:ring-black"
                placeholder={t('labels.search_placeholder')}
                value={aiInput}
                onChange={e => setAiInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAISend()}
              />
              <button onClick={handleAISend} className="p-3 bg-black text-white rounded-xl active:scale-95 transition">
                <window.Icon name="send" size={18} />
              </button>
            </div>
          </>
        ) : (
          <button
            onClick={() => setIsAIChatOpen(true)}
            className="w-full h-full flex items-center justify-center text-white hover:scale-110 transition p-0 m-0"
          >
            <window.Icon name="message-square" size={24} />
          </button>
        )}
      </div>

      <window.GlobalModal
        isOpen={isAISettingsOpen}
        onClose={() => setIsAISettingsOpen(false)}
        title={t('labels.ai_configuration')}
        footer={
          <button
            onClick={() => setIsAISettingsOpen(false)}
            className="bg-black text-white px-8 py-3 rounded-full text-[9px] font-black uppercase tracking-widest shadow-xl"
          >
            {t('actions.close')}
          </button>
        }
      >
        <div className="space-y-4">
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{t('alerts.ai_defaults_msg')}</p>
          <div>
            <label className="block text-[9px] font-black text-gray-400 uppercase tracking-[0.2em] mb-2">
              {t('labels.base_url')}
            </label>
            <input
              className="w-full p-4 bg-gray-50 rounded-xl border border-gray-100 outline-none text-xs font-bold"
              value={aiConfig.baseUrl}
              readOnly
              placeholder="https://api.openai.com/v1"
            />
          </div>
          <div>
            <label className="block text-[9px] font-black text-gray-400 uppercase tracking-[0.2em] mb-2">
              {t('labels.api_key')}
            </label>
            <input
              className="w-full p-4 bg-gray-50 rounded-xl border border-gray-100 outline-none text-xs font-bold"
              type="password"
              value={aiConfig.apiKey}
              readOnly
              placeholder="sk-..."
            />
          </div>
          <div>
            <label className="block text-[9px] font-black text-gray-400 uppercase tracking-[0.2em] mb-2">
              {t('labels.model_id')}
            </label>
            <input
              className="w-full p-4 bg-gray-50 rounded-xl border border-gray-100 outline-none text-xs font-bold"
              value={aiConfig.model}
              readOnly
              placeholder="gpt-4o"
            />
          </div>
        </div>
      </window.GlobalModal>

      <window.GlobalModal
        isOpen={!!viewArchivedCol}
        onClose={() => setViewArchivedCol(null)}
        title={t('labels.archived_cards')}
        footer={
          <button
            onClick={() => setViewArchivedCol(null)}
            className="bg-black text-white px-8 py-3 rounded-full text-[9px] font-black uppercase tracking-widest shadow-xl text-white"
          >
            {t('actions.close')}
          </button>
        }
      >
        <div className="space-y-4 max-h-96 overflow-y-auto no-scrollbar">
          {cards.filter(c => c && c.columnId === viewArchivedCol && c.archived).length === 0 ? (
            <p className="text-gray-400 text-xs text-center py-4">{t('alerts.no_archived_cards')}</p>
          ) : (
            cards
              .filter(c => c && c.columnId === viewArchivedCol && c.archived)
              .map(c => (
                <div key={c.id} className="flex justify-between items-center p-4 border border-gray-100 rounded-xl">
                  <div>
                    <p className="font-black text-sm">{c.title}</p>
                  </div>
                  <button
                    onClick={async () => {
                      await fetch(`/api/tasks/${c.id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          archived: false,
                          auditEvent: {
                            user: user?.email || 'System',
                            action: 'Restored card',
                          },
                        }),
                      });
                      setCards(prev => prev.map(card => (card.id === c.id ? { ...card, archived: false } : card)));
                      logActivity('Restored card', 'card', c.title);
                    }}
                    className="text-blue-500 hover:text-blue-600 bg-blue-50 p-2 rounded-lg flex gap-2 items-center text-xs font-bold"
                  >
                    <window.Icon name="upload-cloud" size={14} /> {t('actions.restore')}
                  </button>
                </div>
              ))
          )}
        </div>
      </window.GlobalModal>

      {showUserManagement && <window.UserManagement user={user} onClose={() => setShowUserManagement(false)} />}
    </div>
  );
};
