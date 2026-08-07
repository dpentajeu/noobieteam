window.MyTasksView = ({ user, workspaces, onOpenTask, onBack, theme, onThemeChange, onLogout, onUpdateUser }) => {
    const { t } = window.useTranslation ? window.useTranslation() : { t: k => k };
    const [tasks, setTasks] = React.useState([]);
    const [allUsers, setAllUsers] = React.useState([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState(null);

    // Default view filters by "Assignee = Current User"
    const [scope, setScope] = React.useState('mine'); // 'mine' | 'all'
    const [boardFilter, setBoardFilter] = React.useState('');
    const [statusFilter, setStatusFilter] = React.useState('');
    const [keyword, setKeyword] = React.useState('');

    const hdr = window.getHeaderTheme(theme);

    React.useEffect(() => {
        if (!user?.email) return;
        setLoading(true);
        fetch('/api/my-tasks', { headers: { 'user-email': user.email } })
            .then(r => {
                if (!r.ok) throw new Error('Failed to load tasks.');
                return r.json();
            })
            .then(data => { setTasks(Array.isArray(data) ? data : []); setLoading(false); })
            .catch(err => { console.error(err); setError(err.message); setLoading(false); });
        fetch('/api/users').then(r => r.json()).then(data => setAllUsers(Array.isArray(data) ? data : [])).catch(console.error);
    }, [user?.email]);

    const getMemberData = (email) => (Array.isArray(allUsers) ? allUsers : []).find(u => u.email === email) || { email, avatar: null };

    const boards = React.useMemo(() => {
        const map = new Map();
        tasks.forEach(tk => { if (!map.has(tk.workspaceId)) map.set(tk.workspaceId, tk.workspaceName); });
        return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
    }, [tasks]);

    const statuses = React.useMemo(() => [...new Set(tasks.map(tk => tk.columnTitle).filter(Boolean))], [tasks]);

    const isExpiringSoon = (tk) => {
        if (!tk.dueDate) return false;
        const diffDays = (new Date(tk.dueDate) - new Date()) / (1000 * 60 * 60 * 24);
        return diffDays <= 3;
    };

    const filteredTasks = React.useMemo(() => {
        const list = tasks.filter(tk => {
            if (scope === 'mine' && !(tk.assignees && tk.assignees.includes(user?.email))) return false;
            if (boardFilter && tk.workspaceId !== boardFilter) return false;
            if (statusFilter && tk.columnTitle !== statusFilter) return false;
            if (keyword && !(tk.title || '').toLowerCase().includes(keyword.toLowerCase())) return false;
            return true;
        });
        // Sort: due date ascending (no date last), then high urgency first
        const urgencyRank = { HIGH: 0, MED: 1, LOW: 2 };
        return list.sort((a, b) => {
            const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
            const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
            if (ad !== bd) return ad - bd;
            return (urgencyRank[(a.urgency || 'LOW').toUpperCase()] ?? 2) - (urgencyRank[(b.urgency || 'LOW').toUpperCase()] ?? 2);
        });
    }, [tasks, scope, boardFilter, statusFilter, keyword, user]);

    const myCount = React.useMemo(() => tasks.filter(tk => tk.assignees && tk.assignees.includes(user?.email)).length, [tasks, user]);
    const expiringCount = React.useMemo(() => filteredTasks.filter(isExpiringSoon).length, [filteredTasks]);

    const statusClass = (title) => {
        const low = (title || '').toLowerCase();
        if (low.includes('done') || low.includes('complete')) return 'bg-emerald-100 text-emerald-700';
        if (low.includes('progress') || low.includes('doing')) return 'bg-blue-100 text-blue-700';
        if (low.includes('backlog')) return 'bg-gray-100 text-gray-600';
        return 'bg-purple-100 text-purple-700';
    };

    const urgencyDot = (urgency) => ({ low: 'bg-blue-300', med: 'bg-yellow-400', high: 'bg-red-500' }[(urgency || 'low').toLowerCase()] || 'bg-blue-300');

    return (
        <div className="min-h-screen bg-white animate-fade-in flex flex-col text-black">
            <nav className={`h-16 px-6 lg:px-12 flex items-center justify-between transition-colors duration-300 shadow-sm ${hdr.nav}`}>
                <div className="flex items-center gap-6">
                    <button type="button" onClick={onBack} title={t('actions.back') || 'Back'} className={`p-2.5 rounded-xl transition ${hdr.ghost}`}><window.Icon name="arrow-left" size={20} /></button>
                    <div className={`leading-none ${hdr.title}`}>
                        <h2 className="text-lg font-black tracking-tighter italic mr-4">{t('app_name')}</h2>
                        <p className="text-[8px] font-black uppercase tracking-[0.4em] opacity-50 mt-1.5">{t('labels.my_tasks') || 'My Tasks'}</p>
                    </div>
                </div>
                {window.ProfileMenu && <window.ProfileMenu user={user} onLogout={onLogout} onThemeChange={onThemeChange} currentTheme={theme} onUpdateUser={onUpdateUser} />}
            </nav>

            <div className="max-w-6xl w-full mx-auto p-4 md:p-10 flex-1">
                <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
                    <div>
                        <h2 className="text-3xl md:text-5xl font-black tracking-tighter">{t('labels.my_tasks') || 'My Tasks'}</h2>
                        <p className="text-gray-400 mt-2 font-bold uppercase tracking-[0.2em] text-[10px]">{t('labels.my_tasks_subtitle') || 'All your work across every board'}</p>
                    </div>
                    <div className="flex gap-3">
                        <div className="bg-gray-50 border border-gray-100 rounded-2xl px-5 py-3 text-center">
                            <p className="text-2xl font-black leading-none">{myCount}</p>
                            <p className="text-[8px] font-black uppercase tracking-widest text-gray-400 mt-1">{t('labels.assigned_to_me') || 'Assigned to me'}</p>
                        </div>
                        <div className="bg-red-50 border border-red-100 rounded-2xl px-5 py-3 text-center">
                            <p className="text-2xl font-black leading-none text-red-500">{expiringCount}</p>
                            <p className="text-[8px] font-black uppercase tracking-widest text-red-400 mt-1">{t('labels.expiring_soon') || 'Expiring soon'}</p>
                        </div>
                    </div>
                </header>

                {/* Filter bar */}
                <div className="flex flex-wrap items-center gap-3 bg-gray-50/80 p-2 rounded-2xl border border-gray-100 mb-6">
                    <div className="flex bg-white p-1 rounded-xl border border-gray-200">
                        <button onClick={() => setScope('mine')} className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition ${scope === 'mine' ? 'bg-black text-white shadow' : 'text-gray-400'}`}>{t('labels.assigned_to_me') || 'Assigned to me'}</button>
                        <button onClick={() => setScope('all')} className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition ${scope === 'all' ? 'bg-black text-white shadow' : 'text-gray-400'}`}>{t('labels.all_tasks') || 'All tasks'}</button>
                    </div>
                    <div className="relative">
                        <window.Icon name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input className="pl-8 pr-3 py-2 bg-white border border-gray-200 rounded-xl text-[10px] font-bold outline-none focus:border-blue-500 w-40" placeholder={t('labels.search_placeholder') || 'Search...'} value={keyword} onChange={e => setKeyword(e.target.value)} />
                    </div>
                    <select className="bg-white text-[10px] font-bold px-3 py-2 rounded-xl border border-gray-200 outline-none cursor-pointer text-gray-600" value={boardFilter} onChange={e => setBoardFilter(e.target.value)}>
                        <option value="">{t('labels.all_boards') || 'All Boards'}</option>
                        {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                    <select className="bg-white text-[10px] font-bold px-3 py-2 rounded-xl border border-gray-200 outline-none cursor-pointer text-gray-600" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                        <option value="">{t('labels.all_statuses') || 'All Statuses'}</option>
                        {statuses.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                </div>

                {/* Task list */}
                {loading ? (
                    <div className="py-20 text-center text-gray-300 italic text-sm">{t('labels.loading') || 'Loading your tasks...'}</div>
                ) : error ? (
                    <div className="py-20 text-center text-red-400 font-bold text-sm">{error}</div>
                ) : filteredTasks.length === 0 ? (
                    <div className="py-20 text-center text-gray-300 italic text-sm">{t('labels.no_tasks_found') || 'No tasks match your filters. 🎉'}</div>
                ) : (
                    <div className="space-y-2">
                        {/* Column headers (desktop) */}
                        <div className="hidden md:grid grid-cols-12 gap-4 px-5 pb-2 text-[8px] font-black uppercase tracking-[0.2em] text-gray-400">
                            <div className="col-span-5">{t('labels.task') || 'Task'}</div>
                            <div className="col-span-3">{t('labels.board') || 'Board'}</div>
                            <div className="col-span-2">{t('labels.status') || 'Status'}</div>
                            <div className="col-span-2 text-right">{t('labels.due_date') || 'Due'}</div>
                        </div>
                        {filteredTasks.map(tk => (
                            <div key={tk.id} onClick={() => onOpenTask && onOpenTask(tk)} className="grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-4 items-center bg-white border border-gray-100 rounded-2xl px-5 py-4 insta-shadow hover:shadow-lg hover:scale-[1.005] transition-all duration-200 cursor-pointer group">
                                <div className="col-span-5 flex items-center gap-3 min-w-0">
                                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${urgencyDot(tk.urgency)}`}></span>
                                    <div className="min-w-0">
                                        <p className="font-black text-sm truncate group-hover:text-blue-600 transition">{tk.title}</p>
                                        {tk.epic && <span className="inline-block mt-1 px-2 py-0.5 bg-purple-100 text-purple-700 text-[7px] font-black uppercase tracking-widest rounded">{tk.epic}</span>}
                                    </div>
                                </div>
                                <div className="col-span-3 flex items-center gap-2 text-gray-500 min-w-0">
                                    <window.Icon name="layout-grid" size={14} className="text-gray-300 flex-shrink-0" />
                                    <span className="text-xs font-bold truncate">{tk.workspaceName}</span>
                                </div>
                                <div className="col-span-2">
                                    <span className={`inline-block px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${statusClass(tk.columnTitle)}`}>{tk.columnTitle}</span>
                                </div>
                                <div className="col-span-2 flex items-center justify-between md:justify-end gap-3">
                                    {tk.dueDate ? (
                                        <span className={`text-[10px] font-black whitespace-nowrap ${isExpiringSoon(tk) ? 'text-red-500' : 'text-gray-400'}`}>{new Date(tk.dueDate).toLocaleDateString()}</span>
                                    ) : (
                                        <span className="text-[10px] font-black text-gray-300">{t('labels.no_date') || 'No date'}</span>
                                    )}
                                    <div className="flex -space-x-2">
                                        {(tk.assignees || []).filter(Boolean).slice(0, 3).map(email => {
                                            const m = getMemberData(email);
                                            return <window.Avatar key={email} label={window.getInitials(m)} src={window.getImageUrl(m.avatar)} size="sm" active />;
                                        })}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
