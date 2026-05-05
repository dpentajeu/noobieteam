window.WorkspaceHub = ({ onSelect, onLogout, user, theme, onThemeChange, onUpdateUser, urlWsSlug }) => {
            const { showPrompt, showConfirm } = window.useModals();
            const { showToast } = window.useToasts();
            const { t } = window.useTranslation ? window.useTranslation() : { t: k => k };
            const [workspaces, setWorkspaces] = React.useState([]);
            const [loading, setLoading] = React.useState(true);
    const onSelectRef = React.useRef(onSelect); React.useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
            const [pinPrompt, setPinPrompt] = React.useState({ isOpen: false, pin: '', confirm: '' });
            const [pinError, setPinError] = React.useState('');
            const [pinLoading, setPinLoading] = React.useState(false);

            React.useEffect(() => {
                if (!user?.vaultPin) {
                    setPinPrompt({ isOpen: true, pin: '', confirm: '' });
                }
            }, [user]);

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
                        if (targetWs) {
                            // Delay slightly to let hub render logic finish, then auto-select
                            setTimeout(() => onSelect(targetWs), 100);
                        }
                    }
                }).catch(err => { console.error(err); setWorkspaces([]); setLoading(false); });
            }, []);

            // No longer save to localStorage, only API calls
            // 
            const [viewArchived, setViewArchived] = React.useState(false);

            const [adminEmail, setAdminEmail] = React.useState('admin@noobieteam.ai');
            React.useEffect(() => {
                fetch('/api/config').then(res => res.json()).then(data => setAdminEmail(data.adminEmail)).catch(console.error);
            }, []);
            const isAdmin = user?.email === adminEmail;
            const [showUserManagement, setShowUserManagement] = React.useState(false);

            React.useEffect(() => { localStorage.setItem('nt_workspaces', JSON.stringify(workspaces)); }, [workspaces]);

            const addWS = () => {
                showPrompt(t('actions.new_workspace') || 'New Workspace', t('labels.enter_workspace_name') || 'Enter workspace name:', async (name) => {
                    if (!name) return;
                    const newWs = { name, color: 'from-blue-400 to-indigo-500', avatar: name.substring(0,2).toUpperCase(), archived: false, members: [{ userId: user?.email, role: 'OWNER' }] };
                    const res = await fetch('/api/workspaces', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(newWs) });
                    const saved = await res.json();
                    setWorkspaces(prev => [...prev, saved]);
                    showToast(t('alerts.workspace_initialized') || "New mission workspace initialized! ✨");
                }, false);
            };

            const toggleArchive = async (e, id, archive) => {
                e.stopPropagation();
                if (!archive) {
                    showConfirm(t('actions.archive_workspace') || "Archive Workspace", t('alerts.confirm_archive_workspace') || "Are you sure you want to archive this workspace?", async () => {
                        await fetch(`/api/workspaces/${id}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ archived: true }) });
                        setWorkspaces(prev => prev.map(w => w.id === id ? { ...w, archived: true } : w));
                        showToast(t('alerts.workspace_archived') || "Workspace archived. 📦");
                    });
                } else {
                    if (!isAdmin) return;
                    await fetch(`/api/workspaces/${id}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ archived: false }) });
                    setWorkspaces(prev => prev.map(w => w.id === id ? { ...w, archived: false } : w));
                    showToast(t('alerts.workspace_reactivated') || "Workspace reactivated. 🚀");
                }
            };

            const headerClass = window.THEMES.find(t => t.id === theme)?.class || 'theme-default';
            const isDarkHeader = ['dark', 'darkblue', 'green', 'ocean'].includes(theme);

            const displayWorkspaces = React.useMemo(() => {
                let filtered = Array.isArray(workspaces) ? workspaces : [];
                if (!isAdmin) {
                    filtered = filtered.filter(w => {
                        const memberEmails = w.members ? w.members.map(m => m.userId) : [];
                        return memberEmails.includes(user?.email);
                    });
                }
                return filtered.filter(w => w.archived === viewArchived);
            }, [workspaces, viewArchived, isAdmin, user]);

            return (
                <div className="h-screen bg-white animate-fade-in relative flex flex-col text-black">
                {pinPrompt.isOpen && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-xl z-[9999] flex items-center justify-center p-4 animate-fade-in">
                    <div className="max-w-[320px] w-[95%] mx-auto bg-white p-6 md:p-8 rounded-[2rem] shadow-2xl text-center">
                        <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-6"><window.Icon name="shield-alert" size={32} className="text-blue-500" /></div>
                        <h2 className="text-2xl font-black italic tracking-tighter mb-2">{t('labels.vault_security')}</h2>
                        <p className="text-[10px] text-gray-500 mb-6">{t('alerts.master_pin_requirement')}</p>
                        <div className="space-y-4">
                            <input className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-none focus:ring-1 focus:ring-blue-400 text-black font-black" type="password" placeholder={t('labels.enter_pin')} autoFocus required value={pinPrompt.pin} onChange={e => { setPinPrompt(p => ({ ...p, pin: e.target.value })); setPinError(''); }} onKeyDown={e => e.key === 'Enter' && handleCreatePin(e)} />
                            <input className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-none focus:ring-1 focus:ring-blue-400 text-black font-black" type="password" placeholder={t('labels.confirm_pin')} required value={pinPrompt.confirm} onChange={e => { setPinPrompt(p => ({ ...p, confirm: e.target.value })); setPinError(''); }} onKeyDown={e => e.key === 'Enter' && handleCreatePin(e)} />
                            <button type="button" onClick={(e) => handleCreatePin(e)} disabled={pinLoading} className="w-full py-3 bg-blue-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-100 hover:scale-105 active:scale-95 transition disabled:opacity-50 flex items-center justify-center gap-2">
                                {pinLoading && <window.Icon name="loader" size={14} className="animate-spin" />} {t('actions.create_vault_pin')}
                            </button>
                            {pinError && <p className="text-red-500 text-[10px] font-bold animate-shake">{pinError}</p>}
                        </div>
                    </div>
                </div>
            )}
                    <nav className={`h-16 px-6 lg:px-12 flex items-center justify-between transition-colors duration-500 shadow-sm ${headerClass}`}>
                        <div className="flex items-center gap-8">
                            <h1 className={`text-xl font-black italic tracking-tighter ${isDarkHeader ? 'text-white' : 'text-black'}`}>{t('app_name')}</h1>
                            {isAdmin && (
                                <button onClick={() => setShowUserManagement(true)} className={`text-[10px] font-black uppercase tracking-widest transition hover:opacity-70 flex items-center gap-2 ${isDarkHeader ? 'text-white/80' : 'text-gray-500'}`}>
                                    <window.Icon name="users" size={14} /> {t('labels.user_management')}
                                </button>
                            )}
                        </div>
                        <window.ProfileMenu user={user} onLogout={onLogout} onThemeChange={onThemeChange} currentTheme={theme} onUpdateUser={onUpdateUser} />
                    </nav>
                    {showUserManagement && <window.UserManagement user={user} adminEmail={adminEmail} onClose={() => setShowUserManagement(false)} />}
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
                            <div className="flex items-center gap-3">
                                {isAdmin && (
                                    <button onClick={() => setViewArchived(!viewArchived)} className={`w-9 h-9 flex items-center justify-center rounded-xl transition ${viewArchived ? 'bg-black text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                                        <window.Icon name={viewArchived ? "layout" : "archive"} size={16} />
                                    </button>
                                )}
                                {!viewArchived && <button onClick={addWS} className="w-14 h-14 flex items-center justify-center bg-black text-white rounded-full shadow-xl hover:scale-110 active:scale-90 transition"><window.Icon name="plus" size={22} /></button>}
                            </div>
                        </header>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                            {displayWorkspaces.map(ws => {
                                const wsId = ws.id || ws._id;
                                return (
                                <div key={wsId} onClick={() => onSelect(ws)} className="cursor-pointer bg-white border border-gray-100 rounded-[2rem] p-8 insta-shadow hover:shadow-xl hover:scale-[1.03] transition-all duration-300 group relative">
                                    <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${ws.color} mb-6 flex items-center justify-center text-white font-black text-xl shadow-lg group-hover:rotate-6 transition-transform`}>{ws.avatar}</div>
                                    <h3 className="text-xl font-black text-black tracking-tight">{ws.name}</h3>
                                    <p className="text-[9px] text-gray-400 font-black uppercase tracking-[0.2em] mt-4">{ws.createdAt ? t('labels.created_at', {date: new Date(ws.createdAt).toLocaleDateString()}) : t('labels.created_at', {date: 'N/A'})}</p>
                                    {isAdmin && (
                                        <button onClick={(e) => toggleArchive(e, wsId, ws.archived)} className="absolute top-8 right-8 p-2 text-gray-200 hover:text-gray-400 transition opacity-0 group-hover:opacity-100">
                                            <window.Icon name={ws.archived ? "rotate-ccw" : "archive"} size={18} />
                                        </button>
                                    )}
                                    {isAdmin ? (
                                        <button onClick={(e) => { e.stopPropagation(); showConfirm(t('actions.destroy_workspace') || "Destroy Workspace", t('alerts.confirm_destroy_workspace') || "PERMANENTLY delete this workspace?", async () => { await fetch(`/api/workspaces/${wsId}`, { method: "DELETE", headers: { "user-email": user?.email } }); setWorkspaces(prev => prev.filter(w => (w.id !== wsId && w._id !== wsId))); showToast(t('alerts.workspace_destroyed') || "Workspace destroyed."); }); }} className="absolute bottom-8 right-8 p-2 text-red-300 hover:text-red-500 transition opacity-0 group-hover:opacity-100">
                                            <window.Icon name="trash-2" size={18} />
                                        </button>
                                    ) : null}
                                </div>
                                );
                            })}
                            {displayWorkspaces.length === 0 && <div className="col-span-full py-20 text-center text-gray-300 italic text-sm">{t('labels.no_active_workspaces')}</div>}
                        </div>
                </div>
            </div>
        </div>
    );
};
