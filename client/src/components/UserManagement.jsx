window.UserManagement = ({ user, adminEmail, onClose }) => {
    const [users, setUsers] = React.useState([]);
    const [loading, setLoading] = React.useState(true);
    const { showToast } = window.useToasts();
    const { showConfirm } = window.useModals();

    const fetchUsers = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/users');
            const data = await res.json();
            setUsers(Array.isArray(data) ? data : []);
        } catch (e) { console.error(e); }
        setLoading(false);
    };

    React.useEffect(() => { fetchUsers(); }, []);

    const resetPin = async (email) => {
        showConfirm("Reset Vault PIN", `Reset Master Vault PIN for ${email}? They will be required to create a new one on their next login.`, async () => {
            try {
                const res = await fetch(`/api/admin/users/${email}/reset-pin`, { method: 'POST' });
                if (res.ok) {
                    showToast(`Vault PIN reset for ${email}.`);
                    fetchUsers();
                }
            } catch (e) { console.error(e); }
        });
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xl z-[9999] flex items-center justify-center p-4 animate-fade-in text-black">
            <div className="max-w-4xl w-full bg-white rounded-[2.5rem] shadow-2xl flex flex-col max-h-[80vh] overflow-hidden border border-gray-100">
                <header className="p-8 border-b border-gray-50 flex justify-between items-center">
                    <div>
                        <h2 className="text-3xl font-black tracking-tighter italic">User Management</h2>
                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">Platform Administrative Terminal</p>
                    </div>
                    <button onClick={onClose} className="p-4 bg-gray-50 hover:bg-gray-100 rounded-full transition"><window.Icon name="x" size={24}/></button>
                </header>
                <div className="flex-1 overflow-auto p-8">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-20 animate-pulse text-blue-500">
                            <window.Icon name="loader" size={48} className="animate-spin mb-4" />
                            <p className="font-black text-[10px] uppercase tracking-widest">Hydrating User Data...</p>
                        </div>
                    ) : (
                        <div className="w-full">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="text-[10px] font-black uppercase tracking-widest text-gray-400 border-b border-gray-50">
                                        <th className="pb-4 px-4 font-black">User Identity</th>
                                        <th className="pb-4 px-4 font-black">Enlisted Date</th>
                                        <th className="pb-4 px-4 font-black">Last Active</th>
                                        <th className="pb-4 px-4 font-black">Vault Status</th>
                                        <th className="pb-4 px-4 text-right font-black">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                    {users.map(u => (
                                        <tr key={u.email} className="hover:bg-gray-50 transition group">
                                            <td className="py-5 px-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded-xl bg-blue-500 flex items-center justify-center text-white font-black text-xs shadow-md shadow-blue-100">{(u.name || u.email).substring(0,2).toUpperCase()}</div>
                                                    <div>
                                                        <p className="text-xs font-black">{u.email}</p>
                                                        <p className="text-[9px] text-gray-400 font-bold uppercase">{u.method === 'google' ? 'Google Auth' : 'Local Terminal'}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="py-5 px-4 text-xs font-bold text-gray-600">
                                                {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : 'N/A'}
                                            </td>
                                            <td className="py-5 px-4 text-xs font-bold text-gray-600">
                                                {u.lastLogin ? new Date(u.lastLogin).toLocaleString() : 'Never'}
                                            </td>
                                            <td className="py-5 px-4">
                                                {u.vaultPin ? (
                                                    <span className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-[8px] font-black uppercase tracking-widest">Locked 🔐</span>
                                                ) : (
                                                    <span className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-[8px] font-black uppercase tracking-widest">Unsecured 🔓</span>
                                                )}
                                            </td>
                                            <td className="py-5 px-4 text-right">
                                                <button onClick={() => resetPin(u.email)} className="p-3 bg-red-50 text-red-500 rounded-xl hover:bg-red-500 hover:text-white transition opacity-0 group-hover:opacity-100 shadow-sm" title="Reset Vault PIN">
                                                    <window.Icon name="refresh-cw" size={16} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
