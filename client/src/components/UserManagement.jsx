// Platform admin terminal. Superadmin-only; rendered from WorkspaceHub and
// WorkspaceView, both of which gate on user.systemRole === 'SUPERADMIN'.
//
// Deliberately still light-themed: every other overlay in the app (GlobalModal,
// CardModal, the PIN modal) is light, so theming this one alone would read as a
// rendering bug rather than a feature. Belongs to the app-wide P6 theme pass.

// Presentational pieces live at module scope on purpose. Declared inside the
// component they would be a new component type on every render, so React would
// unmount and remount the whole user list on each keystroke in the search box.

const UMPill = ({ tone, children }) => {
    const tones = {
        green: 'bg-emerald-50 text-emerald-700 border-emerald-100',
        red: 'bg-red-50 text-red-700 border-red-100',
        amber: 'bg-amber-50 text-amber-700 border-amber-100',
        indigo: 'bg-indigo-50 text-indigo-700 border-indigo-100',
        gray: 'bg-gray-50 text-gray-500 border-gray-100',
    };
    return (
        <span
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[9px] font-black uppercase tracking-widest whitespace-nowrap ${tones[tone] || tones.gray}`}
        >
            {children}
        </span>
    );
};

const UMAccessPill = ({ u, tr }) =>
    u.banned ? (
        <UMPill tone="red">
            <window.Icon name="ban" size={10} />
            {tr('labels.banned', 'Banned')}
        </UMPill>
    ) : (
        <UMPill tone="green">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            {tr('labels.active', 'Active')}
        </UMPill>
    );

const UMVaultPill = ({ u, tr }) =>
    u.vaultPin ? (
        <UMPill tone="gray">
            <window.Icon name="lock" size={10} />
            {tr('labels.vault_pin_set', 'PIN set')}
        </UMPill>
    ) : (
        <UMPill tone="amber">
            <window.Icon name="unlock" size={10} />
            {tr('labels.vault_pin_missing', 'No PIN')}
        </UMPill>
    );

const UMIdentity = ({ u, tr, self }) => {
    // GET /api/admin/users returns raw toObject() output, so the schema's
    // avatarUrl -> avatar toJSON transform has not run. Read both.
    const avatar = window.getImageUrl(u.avatar || u.avatarUrl);
    return (
        <div className="flex items-center gap-4 min-w-0">
            {/* Deliberately not window.Avatar: this one is a blue squircle with a
                banned state, not the app's round member chip. The initials size
                still tracks the shared scale though — ~1/3 of the box, so 15px at
                44px, matching Avatar's 16px at 48px. */}
            <div
                className={`w-11 h-11 rounded-2xl flex items-center justify-center text-white font-black text-[15px] shadow-md shrink-0 overflow-hidden ${
                    u.banned ? 'bg-gray-300 shadow-gray-100' : 'bg-blue-500 shadow-blue-100'
                }`}
            >
                {avatar ? (
                    <img src={avatar} alt="" className="w-full h-full object-cover" />
                ) : (
                    window.getInitials(u)
                )}
            </div>
            <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <p className={`text-xs font-black truncate ${u.banned ? 'text-gray-400 line-through' : ''}`}>
                        {u.email}
                    </p>
                    {u.systemRole === 'SUPERADMIN' && (
                        <UMPill tone="indigo">
                            <window.Icon name="shield" size={10} />
                            {tr('labels.superadmin', 'Superadmin')}
                        </UMPill>
                    )}
                    {self && <UMPill tone="gray">{tr('labels.you', 'You')}</UMPill>}
                </div>
                <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider mt-1">
                    {u.method === 'google' ? 'Google Auth' : 'Local Terminal'}
                </p>
            </div>
        </div>
    );
};

// Actions are always visible. The previous hover-reveal made them
// undiscoverable on desktop and completely unreachable on touch.
const UMActions = ({ u, tr, busy, can, on, align = 'end' }) => {
    const base =
        'p-3 rounded-xl transition shadow-sm disabled:opacity-30 disabled:cursor-not-allowed disabled:shadow-none';
    const btn = (key, cls, icon, label, onClick, enabled) => (
        <button
            key={key}
            onClick={onClick}
            disabled={busy || !enabled}
            title={enabled ? label : `${label} — ${tr('labels.not_permitted', 'not permitted')}`}
            aria-label={label}
            className={`${base} ${cls}`}
        >
            <window.Icon name={busy ? 'loader' : icon} size={15} className={busy ? 'animate-spin' : ''} />
        </button>
    );
    const isSuper = u.systemRole === 'SUPERADMIN';
    return (
        <div className={`flex items-center gap-2 ${align === 'end' ? 'justify-end' : ''}`}>
            {btn(
                'role',
                'bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white',
                isSuper ? 'shield-off' : 'shield-check',
                isSuper
                    ? tr('actions.demote_user', 'Revoke Superadmin')
                    : tr('actions.promote_user', 'Promote to Superadmin'),
                () => on.role(u),
                can.role
            )}
            {btn(
                'pin',
                'bg-gray-50 text-gray-500 hover:bg-gray-800 hover:text-white',
                'refresh-cw',
                tr('actions.reset_vault_pin', 'Reset Vault PIN'),
                () => on.pin(u),
                true
            )}
            {btn(
                'ban',
                u.banned
                    ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-600 hover:text-white'
                    : 'bg-amber-50 text-amber-600 hover:bg-amber-500 hover:text-white',
                u.banned ? 'user-check' : 'user-x',
                u.banned ? tr('actions.unban_user', 'Unban User') : tr('actions.ban_user', 'Ban User'),
                () => on.ban(u),
                can.ban
            )}
            {/* Divider: delete is irreversible, so it does not sit flush with the
                reversible actions where a mis-click could land on it. */}
            <span className="w-px h-7 bg-gray-200 mx-1.5" aria-hidden="true" />
            {btn(
                'delete',
                'bg-red-50 text-red-500 hover:bg-red-600 hover:text-white',
                'trash-2',
                tr('actions.delete_user', 'Delete User'),
                () => on.delete(u),
                can.delete
            )}
        </div>
    );
};

const UMStatChip = ({ tone, value, label }) => (
    <div className="flex items-baseline gap-2 whitespace-nowrap">
        <span className={`text-base font-black ${tone}`}>{value}</span>
        <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">{label}</span>
    </div>
);

const UMEmptyState = ({ icon, title, detail, action }) => (
    <div className="py-24 px-10 text-center flex flex-col items-center">
        {icon}
        <p className="text-sm font-black tracking-tight mb-1.5">{title}</p>
        {detail && <p className="text-[11px] text-gray-500 max-w-sm mb-7">{detail}</p>}
        {action}
    </div>
);

window.UserManagement = ({ user, onClose }) => {
    const [users, setUsers] = React.useState([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState(null);
    const [busyEmail, setBusyEmail] = React.useState('');
    const [query, setQuery] = React.useState('');
    const [statusFilter, setStatusFilter] = React.useState('all');
    const [sortBy, setSortBy] = React.useState('recent');
    const panelRef = React.useRef(null);

    const { showToast } = window.useToasts();
    const { showConfirm } = window.useModals();
    const { t } = window.useTranslation ? window.useTranslation() : { t: k => k };
    // t() returns null for a missing key so callers can supply their own default.
    const tr = React.useCallback((key, fallback, params) => t(key, params) || fallback, [t]);

    window.useEscapeKey(onClose);
    window.useFocusTrap(panelRef);

    const fetchUsers = React.useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/admin/users');
            const data = await res.json().catch(() => null);
            if (!res.ok) throw new Error((data && data.error) || res.statusText || 'Request failed');
            setUsers(Array.isArray(data) ? data : []);
        } catch (e) {
            // A silent failure renders an empty table that reads as "no users
            // exist" — the one wrong message to send an admin (UIUX_ISSUES 4.6).
            console.error(e);
            setError(e.message);
            setUsers([]);
        } finally {
            setLoading(false);
        }
    }, []);

    React.useEffect(() => {
        fetchUsers();
    }, [fetchUsers]);

    const superadminCount = React.useMemo(() => users.filter(u => u.systemRole === 'SUPERADMIN').length, [users]);
    const bannedCount = React.useMemo(() => users.filter(u => u.banned).length, [users]);
    const noPinCount = React.useMemo(() => users.filter(u => !u.vaultPin).length, [users]);

    const visibleUsers = React.useMemo(() => {
        const needle = query.trim().toLowerCase();
        const list = users.filter(u => {
            if (statusFilter === 'active' && u.banned) return false;
            if (statusFilter === 'banned' && !u.banned) return false;
            if (statusFilter === 'nopin' && u.vaultPin) return false;
            if (statusFilter === 'admins' && u.systemRole !== 'SUPERADMIN') return false;
            if (!needle) return true;
            return `${u.email || ''} ${u.name || ''}`.toLowerCase().includes(needle);
        });
        const stamp = v => (v ? new Date(v).getTime() : 0);
        const sorted = [...list];
        if (sortBy === 'name') sorted.sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || ''));
        else if (sortBy === 'newest') sorted.sort((a, b) => stamp(b.createdAt) - stamp(a.createdAt));
        else if (sortBy === 'oldest') sorted.sort((a, b) => stamp(a.createdAt) - stamp(b.createdAt));
        else sorted.sort((a, b) => stamp(b.lastLogin) - stamp(a.lastLogin)); // 'recent'
        return sorted;
    }, [users, query, statusFilter, sortBy]);

    const filtersActive = query.trim() !== '' || statusFilter !== 'all';
    const clearFilters = () => {
        setQuery('');
        setStatusFilter('all');
    };

    const isSelf = React.useCallback(u => u.email === user?.email, [user?.email]);

    // Each guard mirrors a server-side rule. Never render a control whose click is
    // guaranteed to fail — the server returns 400/403 for every case below.
    const guardsFor = React.useCallback(
        u => ({
            ban: !isSelf(u) && u.systemRole !== 'SUPERADMIN',
            delete: !isSelf(u) && u.systemRole !== 'SUPERADMIN',
            // Demoting the final superadmin would leave the platform unadministrable.
            role: !isSelf(u) && !(u.systemRole === 'SUPERADMIN' && superadminCount <= 1),
        }),
        [isSelf, superadminCount]
    );

    const runAction = async (email, request, onSuccess) => {
        setBusyEmail(email);
        try {
            const res = await request();
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || res.statusText || 'Request failed');
            onSuccess(data);
        } catch (e) {
            showToast(e.message, 'error');
        } finally {
            setBusyEmail('');
        }
    };

    const resetPin = u =>
        showConfirm(
            tr('actions.reset_vault_pin', 'Reset Vault PIN'),
            tr(
                'alerts.confirm_reset_pin',
                `Reset the Master Vault PIN for ${u.email}? They will be required to create a new one on their next login.`,
                { email: u.email }
            ),
            () =>
                runAction(
                    u.email,
                    () => fetch(`/api/admin/users/${encodeURIComponent(u.email)}/reset-pin`, { method: 'POST' }),
                    () => {
                        setUsers(prev => prev.map(x => (x.email === u.email ? { ...x, vaultPin: false } : x)));
                        showToast(tr('alerts.vault_pin_reset', `Vault PIN reset for ${u.email}.`, { email: u.email }));
                    }
                )
        );

    const toggleBan = u => {
        const next = !u.banned;
        showConfirm(
            next ? tr('actions.ban_user', 'Ban User') : tr('actions.unban_user', 'Unban User'),
            next
                ? tr(
                      'alerts.confirm_ban_user',
                      `Ban ${u.email}? They lose access immediately and will not be able to sign in again.`,
                      { email: u.email }
                  )
                : tr('alerts.confirm_unban_user', `Restore sign-in access for ${u.email}?`, { email: u.email }),
            () =>
                runAction(
                    u.email,
                    () =>
                        fetch(`/api/users/${encodeURIComponent(u.email)}/ban`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ banned: next }),
                        }),
                    data => {
                        setUsers(prev => prev.map(x => (x.email === u.email ? { ...x, banned: data.banned } : x)));
                        showToast(
                            next
                                ? tr('alerts.user_banned', `${u.email} has been banned.`, { email: u.email })
                                : tr('alerts.user_unbanned', `${u.email} has been restored.`, { email: u.email })
                        );
                    }
                )
        );
    };

    const toggleRole = u => {
        const promoting = u.systemRole !== 'SUPERADMIN';
        showConfirm(
            promoting
                ? tr('actions.promote_user', 'Promote to Superadmin')
                : tr('actions.demote_user', 'Revoke Superadmin'),
            promoting
                ? tr(
                      'alerts.confirm_promote_user',
                      `Grant ${u.email} full superadmin access? They will be able to manage every workspace and every user, including banning and deleting accounts.`,
                      { email: u.email }
                  )
                : tr('alerts.confirm_demote_user', `Revoke superadmin access for ${u.email}?`, { email: u.email }),
            () =>
                runAction(
                    u.email,
                    () =>
                        fetch(`/api/users/${encodeURIComponent(u.email)}/role`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ systemRole: promoting ? 'SUPERADMIN' : 'USER' }),
                        }),
                    data => {
                        setUsers(prev =>
                            prev.map(x => (x.email === u.email ? { ...x, systemRole: data.systemRole } : x))
                        );
                        showToast(
                            promoting
                                ? tr('alerts.user_promoted', `${u.email} is now a superadmin.`, { email: u.email })
                                : tr('alerts.user_demoted', `${u.email} is no longer a superadmin.`, { email: u.email })
                        );
                    }
                )
        );
    };

    const deleteUser = u =>
        showConfirm(
            tr('actions.delete_user', 'Delete User'),
            tr(
                'alerts.confirm_delete_user',
                `Permanently delete ${u.email}? This removes their account, their workspace memberships and their task assignments. Comments and activity history they authored are kept. This cannot be undone.`,
                { email: u.email }
            ),
            () =>
                runAction(
                    u.email,
                    () => fetch(`/api/users/${encodeURIComponent(u.email)}`, { method: 'DELETE' }),
                    data => {
                        setUsers(prev => prev.filter(x => x.email !== u.email));
                        showToast(tr('alerts.user_deleted', `${u.email} has been deleted.`, { email: u.email }));
                        // The server reports workspaces left with no OWNER. Staying
                        // silent would leave a board only a superadmin can administer.
                        const orphaned = Array.isArray(data.orphanedWorkspaces) ? data.orphanedWorkspaces : [];
                        if (orphaned.length > 0) {
                            showToast(
                                tr(
                                    'alerts.workspaces_left_ownerless',
                                    `No owner left on: ${orphaned.join(', ')}. Assign a new owner.`,
                                    { names: orphaned.join(', ') }
                                ),
                                'error'
                            );
                        }
                    }
                )
        );

    const handlers = { role: toggleRole, pin: resetPin, ban: toggleBan, delete: deleteUser };

    const controlClass =
        'bg-white border border-gray-200 rounded-xl text-[10px] font-black uppercase tracking-widest text-gray-600 outline-none focus:border-blue-500 transition';

    const renderBody = () => {
        if (loading) {
            return (
                <div className="p-5 md:p-8 space-y-4">
                    {[0, 1, 2, 3, 4].map(i => (
                        <div
                            key={`skeleton-user-${i}`}
                            aria-hidden="true"
                            className="flex items-center gap-4 p-5 rounded-2xl border border-gray-100 animate-pulse"
                        >
                            <div className="w-11 h-11 rounded-2xl bg-gray-200 shrink-0" />
                            <div className="flex-1 min-w-0">
                                <div className="h-3 rounded bg-gray-200 w-1/3 mb-2" />
                                <div className="h-2 rounded bg-gray-100 w-1/5" />
                            </div>
                            <div className="h-6 w-20 rounded-full bg-gray-100 hidden md:block" />
                            <div className="h-6 w-24 rounded-full bg-gray-100 hidden lg:block" />
                        </div>
                    ))}
                </div>
            );
        }

        if (error) {
            return (
                <UMEmptyState
                    icon={
                        <div className="w-14 h-14 rounded-2xl bg-red-50 text-red-500 flex items-center justify-center mb-4">
                            <window.Icon name="alert-triangle" size={26} />
                        </div>
                    }
                    title={tr('alerts.users_load_failed', 'Could not load users')}
                    detail={error}
                    action={
                        <button
                            onClick={fetchUsers}
                            className="px-6 py-3 bg-black text-white rounded-full text-[10px] font-black uppercase tracking-widest shadow-lg hover:scale-105 active:scale-95 transition"
                        >
                            {tr('actions.retry_connection', 'Retry')}
                        </button>
                    }
                />
            );
        }

        if (users.length === 0) {
            return (
                <UMEmptyState
                    icon={<window.Icon name="users" size={44} className="text-gray-200 mb-4" />}
                    title={tr('labels.no_users_yet', 'No users registered yet.')}
                />
            );
        }

        // Filtered-empty is a different message from truly-empty: one means "adjust
        // your filters", the other means "there is nothing here" (UIUX_ISSUES 8.2).
        if (visibleUsers.length === 0) {
            return (
                <UMEmptyState
                    icon={<window.Icon name="search-x" size={40} className="text-gray-200 mb-4" />}
                    title={tr('labels.no_users_match', 'No users match your filters.')}
                    action={
                        <button
                            onClick={clearFilters}
                            className="px-5 py-2.5 bg-gray-100 text-gray-700 rounded-full text-[10px] font-black uppercase tracking-widest hover:bg-gray-200 transition"
                        >
                            {tr('actions.clear_filters', 'Clear filters')}
                        </button>
                    }
                />
            );
        }

        return (
            <>
                {/* Desktop: table. Below md it would need horizontal scrolling to be
                    readable, so the card list replaces it entirely (UIUX_ISSUES 7.4). */}
                <div className="hidden md:block">
                    <table className="w-full text-left border-collapse">
                        <thead className="sticky top-0 bg-white/95 backdrop-blur z-10">
                            <tr className="text-[10px] font-black uppercase tracking-widest text-gray-400 border-b border-gray-100">
                                <th className="py-4 px-8 font-black">{tr('labels.user_identity', 'User')}</th>
                                <th className="py-4 px-4 font-black">{tr('labels.access_status', 'Access')}</th>
                                <th className="py-4 px-4 font-black">{tr('labels.vault_status', 'Vault')}</th>
                                <th className="py-4 px-4 font-black">{tr('labels.last_active', 'Last active')}</th>
                                <th className="py-4 px-4 font-black">{tr('labels.enlisted_date', 'Joined')}</th>
                                <th className="py-4 px-8 text-right font-black">
                                    {tr('labels.actions_col', 'Actions')}
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {visibleUsers.map(u => (
                                <tr
                                    key={u.email}
                                    className={`transition ${u.banned ? 'bg-red-50/40 hover:bg-red-50/70' : 'hover:bg-gray-50/70'}`}
                                >
                                    <td className="py-5 px-8 max-w-[320px]">
                                        <UMIdentity u={u} tr={tr} self={isSelf(u)} />
                                    </td>
                                    <td className="py-5 px-4">
                                        <UMAccessPill u={u} tr={tr} />
                                    </td>
                                    <td className="py-5 px-4">
                                        <UMVaultPill u={u} tr={tr} />
                                    </td>
                                    <td className="py-5 px-4">
                                        <span
                                            className="text-[11px] font-bold text-gray-600 whitespace-nowrap"
                                            title={u.lastLogin ? new Date(u.lastLogin).toLocaleString() : undefined}
                                        >
                                            {u.lastLogin
                                                ? window.formatRelativeTime(u.lastLogin)
                                                : tr('labels.never', 'Never')}
                                        </span>
                                    </td>
                                    <td className="py-5 px-4">
                                        <span className="text-[11px] font-bold text-gray-500 whitespace-nowrap">
                                            {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}
                                        </span>
                                    </td>
                                    <td className="py-5 px-8">
                                        <UMActions
                                            u={u}
                                            tr={tr}
                                            busy={busyEmail === u.email}
                                            can={guardsFor(u)}
                                            on={handlers}
                                        />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Mobile: one card per user. */}
                <div className="md:hidden p-5 space-y-4">
                    {visibleUsers.map(u => (
                        <div
                            key={u.email}
                            className={`rounded-3xl border p-5 ${u.banned ? 'bg-red-50/50 border-red-100' : 'bg-white border-gray-100'}`}
                        >
                            <UMIdentity u={u} tr={tr} self={isSelf(u)} />
                            <div className="flex flex-wrap gap-2 mt-4">
                                <UMAccessPill u={u} tr={tr} />
                                <UMVaultPill u={u} tr={tr} />
                            </div>
                            <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-4 text-[10px] font-bold text-gray-500">
                                <span>
                                    {tr('labels.last_active', 'Last active')}:{' '}
                                    {u.lastLogin ? window.formatRelativeTime(u.lastLogin) : tr('labels.never', 'Never')}
                                </span>
                                <span>
                                    {tr('labels.enlisted_date', 'Joined')}:{' '}
                                    {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}
                                </span>
                            </div>
                            <div className="mt-5 pt-4 border-t border-gray-100">
                                <UMActions
                                    u={u}
                                    tr={tr}
                                    busy={busyEmail === u.email}
                                    can={guardsFor(u)}
                                    on={handlers}
                                    align="start"
                                />
                            </div>
                        </div>
                    ))}
                </div>
            </>
        );
    };

    return (
        <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xl z-[9999] flex items-center justify-center p-3 md:p-6 animate-fade-in text-black"
            onMouseDown={event => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-label={tr('labels.user_management', 'User Management')}
                className="max-w-6xl w-full bg-white rounded-[2rem] md:rounded-[2.5rem] shadow-2xl border border-gray-100 flex flex-col max-h-[92vh] md:max-h-[88vh] overflow-hidden"
            >
                {/* Stats live inside the header rather than in their own strip — three
                    stacked bands before any data was most of what made this feel busy. */}
                <header className="px-6 md:px-10 pt-8 pb-7 border-b border-gray-100">
                    <div className="flex justify-between items-start gap-4">
                        <div className="min-w-0">
                            <h2 className="text-2xl md:text-3xl font-black tracking-tighter italic">
                                {tr('labels.user_management', 'User Management')}
                            </h2>
                            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1.5">
                                {tr('labels.platform_admin_terminal', 'Platform Admin Terminal')}
                            </p>
                        </div>
                        <button
                            onClick={onClose}
                            title={tr('actions.close', 'Close')}
                            aria-label={tr('actions.close', 'Close')}
                            className="p-3 md:p-4 bg-gray-50 hover:bg-gray-100 rounded-full transition shrink-0"
                        >
                            <window.Icon name="x" size={20} />
                        </button>
                    </div>
                    {!loading && !error && users.length > 0 && (
                        <div className="flex items-center gap-6 md:gap-8 flex-wrap mt-7">
                            <UMStatChip
                                tone="text-black"
                                value={filtersActive ? `${visibleUsers.length}/${users.length}` : users.length}
                                label={tr('labels.users_count_label', 'users')}
                            />
                            <UMStatChip
                                tone="text-indigo-600"
                                value={superadminCount}
                                label={tr('labels.superadmin', 'Superadmin')}
                            />
                            <UMStatChip tone="text-red-500" value={bannedCount} label={tr('labels.banned', 'Banned')} />
                            <UMStatChip
                                tone="text-amber-600"
                                value={noPinCount}
                                label={tr('labels.vault_pin_missing', 'No PIN')}
                            />
                        </div>
                    )}
                </header>

                <div className="px-6 md:px-10 py-5 border-b border-gray-100 bg-gray-50/60 flex flex-col lg:flex-row lg:items-center gap-4">
                    <div className="relative flex-1 min-w-0">
                        <window.Icon
                            name="search"
                            size={14}
                            className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
                        />
                        <input
                            autoFocus
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder={tr('labels.search_users', 'Search email or name...')}
                            aria-label={tr('labels.search_users', 'Search email or name')}
                            className="w-full pl-11 pr-11 py-3 bg-white border border-gray-200 rounded-xl text-xs font-bold outline-none focus:border-blue-500 transition"
                        />
                        {query && (
                            <button
                                onClick={() => setQuery('')}
                                title={tr('actions.clear', 'Clear')}
                                aria-label={tr('actions.clear', 'Clear search')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-300 hover:text-gray-600 transition"
                            >
                                <window.Icon name="x" size={14} />
                            </button>
                        )}
                    </div>
                    <div className="flex items-center gap-2.5 flex-wrap">
                        <select
                            value={statusFilter}
                            onChange={e => setStatusFilter(e.target.value)}
                            aria-label={tr('labels.filter_by_status', 'Filter by status')}
                            className={`${controlClass} px-4 py-3 cursor-pointer`}
                        >
                            <option value="all">{tr('labels.all_users', 'All users')}</option>
                            <option value="active">{tr('labels.active', 'Active')}</option>
                            <option value="banned">{tr('labels.banned', 'Banned')}</option>
                            <option value="nopin">{tr('labels.vault_pin_missing', 'No PIN')}</option>
                            <option value="admins">{tr('labels.superadmin', 'Superadmin')}</option>
                        </select>
                        <select
                            value={sortBy}
                            onChange={e => setSortBy(e.target.value)}
                            aria-label={tr('labels.sort_by', 'Sort by')}
                            className={`${controlClass} px-4 py-3 cursor-pointer`}
                        >
                            <option value="recent">{tr('labels.sort_recent', 'Recently active')}</option>
                            <option value="name">{tr('labels.sort_name', 'Name')}</option>
                            <option value="newest">{tr('labels.sort_newest', 'Newest')}</option>
                            <option value="oldest">{tr('labels.sort_oldest', 'Oldest')}</option>
                        </select>
                        {filtersActive && (
                            <button
                                onClick={clearFilters}
                                className="px-4 py-3 rounded-xl bg-blue-50 text-blue-600 border border-blue-100 text-[10px] font-black uppercase tracking-widest hover:bg-blue-100 transition whitespace-nowrap"
                            >
                                {tr('actions.clear_filters', 'Clear filters')}
                            </button>
                        )}
                        <button
                            onClick={fetchUsers}
                            disabled={loading}
                            title={tr('actions.refresh', 'Refresh')}
                            aria-label={tr('actions.refresh', 'Refresh')}
                            className="p-3 rounded-xl bg-white border border-gray-200 text-gray-500 hover:text-black hover:border-gray-300 transition disabled:opacity-40"
                        >
                            <window.Icon name="rotate-cw" size={14} className={loading ? 'animate-spin' : ''} />
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto">{renderBody()}</div>
            </div>
        </div>
    );
};
