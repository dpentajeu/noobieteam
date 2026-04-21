window.WorkspaceHub = ({ onSelect, onLogout, user, theme, onThemeChange, onUpdateUser }) => {
            const { showPrompt, showConfirm } = window.useModals();
            const { showToast } = window.useToasts();
            const [workspaces, setWorkspaces] = React.useState([]);
            const [loading, setLoading] = React.useState(true);
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
                if (pinPrompt.pin !== pinPrompt.confirm) return setPinError('PINs do not match.');
                if (pinPrompt.pin.length < 6) return setPinError('PIN must be at least 6 characters.');
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

                    if (!data || (!data.vaultPin && !data.success && !data._id && data.error === undefined)) {
                        console.error("Vault PIN verification failed. Payload:", data);
                        throw new Error('Server successfully saved PIN but returned malformed verification data.');
                    }
                    
                    const updatedUser = Object.assign({}, user || {}, { vaultPin: data.vaultPin });
                    onUpdateUser(updatedUser);
                    showToast('Master Vault PIN created successfully. 🔐');
                    setPinPrompt({ isOpen: false, pin: '', confirm: '' });
                } catch (err) {
                    setPinError(err.message);
                } finally {
                    setPinLoading(false);
                }
            };


            React.useEffect(() => {
                fetch('/api/workspaces').then(r => r.json()).then(ws => { setWorkspaces(Array.isArray(ws) ? ws : []); setLoading(false); }).catch(err => { console.error(err); setWorkspaces([]); setLoading(false); });
            }, []);

            // No longer save to localStorage, only API calls
            // 
            const [viewArchived, setViewArchived] = React.useState(false);

            const [adminEmail, setAdminEmail] = React.useState('admin@noobieteam.ai');
            React.useEffect(() => {
                fetch('/api/config').then(res => res.json()).then(data => setAdminEmail(data.adminEmail)).catch(console.error);
            }, []);
            const isAdmin = user?.email === adminEmail;

            React.useEffect(() => { localStorage.setItem('nt_workspaces', JSON.stringify(workspaces)); }, [workspaces]);

            const addWS = () => {
                showPrompt('New Workspace', 'Enter workspace name:', async (name) => {
                    if (!name) return;
                    const newWs = { name, color: 'from-blue-400 to-indigo-500', avatar: name.substring(0,2).toUpperCase(), archived: false, members: [{ userId: user?.email, role: 'OWNER' }] };
                    const res = await fetch('/api/workspaces', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(newWs) });
                    const saved = await res.json();
                    setWorkspaces(prev => [...prev, saved]);
                    showToast("New mission workspace initialized! ✨");
                }, false);
            };

            const toggleArchive = async (e, id, archive) => {
                e.stopPropagation();
                if (!archive) {
                    showConfirm("Archive Workspace", "Are you sure you want to archive this workspace?", async () => {
                        await fetch(`/api/workspaces/${id}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ archived: true }) });
                        setWorkspaces(prev => prev.map(w => w.id === id ? { ...w, archived: true } : w));
                        showToast("Workspace archived. 📦");
                    });
                } else {
                    if (!isAdmin) return;
                    await fetch(`/api/workspaces/${id}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ archived: false }) });
                    setWorkspaces(prev => prev.map(w => w.id === id ? { ...w, archived: false } : w));
                    showToast("Workspace reactivated. 🚀");
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
                <div className="min-h-screen bg-white animate-fade-in relative flex flex-col text-black">
                {pinPrompt.isOpen && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-xl z-[9999] flex items-center justify-center p-4 animate-fade-in">
                    <div className="max-w-[320px] w-full bg-white p-8 rounded-[2rem] shadow-2xl text-center">
                        <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-6"><window.Icon name="shield-alert" size={32} className="text-blue-500" /></div>
                        <h2 className="text-2xl font-black italic tracking-tighter mb-2">Vault Security</h2>
                        <p className="text-[10px] text-gray-500 mb-6">You must create a Master PIN to securely encrypt your Vault secrets. Minimum 6 characters.</p>
                        <div className="space-y-4">
                            <input className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-none focus:ring-1 focus:ring-blue-400 text-black font-black" type="password" placeholder="Enter PIN" autoFocus required value={pinPrompt.pin} onChange={e => { setPinPrompt(p => ({ ...p, pin: e.target.value })); setPinError(''); }} onKeyDown={e => e.key === 'Enter' && handleCreatePin(e)} />
                            <input className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-none focus:ring-1 focus:ring-blue-400 text-black font-black" type="password" placeholder="Confirm PIN" required value={pinPrompt.confirm} onChange={e => { setPinPrompt(p => ({ ...p, confirm: e.target.value })); setPinError(''); }} onKeyDown={e => e.key === 'Enter' && handleCreatePin(e)} />
                            <button type="button" onClick={(e) => handleCreatePin(e)} disabled={pinLoading} className="w-full py-3 bg-blue-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-100 hover:scale-105 active:scale-95 transition disabled:opacity-50 flex items-center justify-center gap-2">
                                {pinLoading && <window.Icon name="loader" size={14} className="animate-spin" />} Create Vault PIN
                            </button>
                            {pinError && <p className="text-red-500 text-[10px] font-bold animate-shake">{pinError}</p>}
                        </div>
                    </div>
                </div>
            )}
                    <nav className={`h-16 px-6 lg:px-12 flex items-center justify-between transition-colors duration-500 shadow-sm ${headerClass}`}>
                        <h1 className={`text-xl font-black italic tracking-tighter ${isDarkHeader ? 'text-white' : 'text-black'}`}>Noobieteam</h1>
                        <window.ProfileMenu user={user} onLogout={onLogout} onThemeChange={onThemeChange} currentTheme={theme} onUpdateUser={onUpdateUser} />
                    </nav>
                    <div className="max-w-5xl mx-auto p-10 flex-1">
                        <header className="mb-12 flex justify-between items-end">
                            <div>
                                <h2 className="text-5xl font-black tracking-tighter">{viewArchived ? 'Archive' : 'Workspaces'}</h2>
                                <p className="text-gray-400 mt-2 font-bold uppercase tracking-[0.2em] text-[10px]">Project Command Hub</p>
                            </div>
                            <div className="flex gap-4">
                                {isAdmin && (
                                    <button onClick={() => setViewArchived(!viewArchived)} className={`p-4 rounded-full transition shadow-xl ${viewArchived ? 'bg-black text-white' : 'bg-white text-gray-400 border border-gray-100'}`}>
                                        <window.Icon name={viewArchived ? "layout" : "archive"} size={24} />
                                    </button>
                                )}
                                {!viewArchived && <button onClick={addWS} className="p-4 bg-black text-white rounded-full hover:scale-110 active:scale-90 transition shadow-xl ml-6"><window.Icon name="plus" size={24} /></button>}
                            </div>
                        </header>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                            {displayWorkspaces.map(ws => {
                                const wsId = ws.id || ws._id;
                                return (
                                <div key={wsId} onClick={() => onSelect(ws)} className="cursor-pointer bg-white border border-gray-100 rounded-[2rem] p-8 insta-shadow hover:shadow-xl hover:scale-[1.03] transition-all duration-300 group relative">
                                    <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${ws.color} mb-6 flex items-center justify-center text-white font-black text-xl shadow-lg group-hover:rotate-6 transition-transform`}>{ws.avatar}</div>
                                    <h3 className="text-xl font-black text-black tracking-tight">{ws.name}</h3>
                                    <p className="text-[9px] text-gray-400 font-black uppercase tracking-[0.2em] mt-4">{ws.createdAt ? 'Created ' + ws.createdAt : 'Created N/A'}</p>
                                    {isAdmin && (
                                        <button onClick={(e) => toggleArchive(e, wsId, ws.archived)} className="absolute top-8 right-8 p-2 text-gray-200 hover:text-gray-400 transition opacity-0 group-hover:opacity-100">
                                            <window.Icon name={ws.archived ? "rotate-ccw" : "archive"} size={18} />
                                        </button>
                                    )}
                                    {isAdmin ? (
                                        <button onClick={(e) => { e.stopPropagation(); showConfirm("Destroy Workspace", "PERMANENTLY delete this workspace?", async () => { await fetch(`/api/workspaces/${wsId}`, { method: "DELETE", headers: { "user-email": user?.email } }); setWorkspaces(prev => prev.filter(w => (w.id !== wsId && w._id !== wsId))); showToast("Workspace destroyed."); }); }} className="absolute bottom-8 right-8 p-2 text-red-300 hover:text-red-500 transition opacity-0 group-hover:opacity-100">
                                            <window.Icon name="trash-2" size={18} />
                                        </button>
                                    ) : null}
                                </div>
                                );
                            })}
                            {displayWorkspaces.length === 0 && <div className="col-span-full py-20 text-center text-gray-300 italic text-sm">No {viewArchived ? 'archived' : 'active'} workspaces found.</div>}
                        </div>
                    </div>
                </div>
            );
        };