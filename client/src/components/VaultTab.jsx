window.VaultTab = function({ workspace, user, onUpdate, onUpdateUser }) {
    const { showPrompt, showAlert, showConfirm } = window.useModals();
    const { showToast } = window.useToasts();
    const { t } = window.useTranslation ? window.useTranslation() : { t: k => k };
    const [secrets, setSecrets] = React.useState(workspace.secrets || []);
    const [newSecret, setNewSecret] = React.useState({ service: '', account: '', password: '' });
    const [isAdding, setIsAdding] = React.useState(false);
    const [revealData, setRevealData] = React.useState(null);

    const addSecret = async function() {
        if (!newSecret.service || !newSecret.account || !newSecret.password) return showAlert(t('alerts.missing_fields'), 'Missing Intel');
        try {
            const res = await fetch('/api/workspaces/' + workspace.id + '/vault/encrypt', { 
                method: 'POST', 
                headers: {'Content-Type': 'application/json'}, 
                body: JSON.stringify({ text: JSON.stringify(newSecret), password: user?.vaultPin || user?.password }) 
            });
            if (!res.ok) throw new Error('Encryption failed');
            const data = await res.json();
            const encrypted = data.encrypted;
            
            const updatedSecrets = secrets.concat([{ id: window.generateId('sec'), service: newSecret.service, value: encrypted }]);
            
            await onUpdate({ secrets: updatedSecrets });
            
            setSecrets(updatedSecrets);
            setNewSecret({ service: '', account: '', password: '' });
            setIsAdding(false);
            showToast(t('alerts.payload_secured'));
        } catch (err) {
            showAlert(t('alerts.vault_sync_failed') + ': ' + err.message, 'Error');
        }
    };

    const [revealError, setRevealError] = React.useState('');
    const [revealLoading, setRevealLoading] = React.useState(false);
    const [revealPrompt, setRevealPrompt] = React.useState({ isOpen: false, id: null, pass: '' });
    const [pinPrompt, setPinPrompt] = React.useState({ isOpen: false, pin: '', confirm: '' });
    const [pinError, setPinError] = React.useState('');
    const [pinLoading, setPinLoading] = React.useState(false);

    const handleCreatePin = async function(e) {
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

            const updatedUser = Object.assign({}, user || {}, { vaultPin: data.vaultPin });
            onUpdateUser(updatedUser);
            showToast(t('alerts.payload_secured'));
            setPinPrompt({ isOpen: false, pin: '', confirm: '' });
        } catch (err) {
            setPinError(err.message);
        } finally {
            setPinLoading(false);
        }
    };

    const handleReveal = async function() {
        if (!revealPrompt.pass) return;
        setRevealLoading(true);
        setRevealError('');
        try {
            const s = secrets.find(x => (x.id === revealPrompt.id || x._id === revealPrompt.id));
            const res = await fetch('/api/workspaces/' + workspace.id + '/vault/decrypt', { 
                method: 'POST', 
                headers: {'Content-Type':'application/json'}, 
                body: JSON.stringify({ cipherBase64: s.value, password: revealPrompt.pass }) 
            });
            if (!res.ok) throw new Error(t('alerts.credentials_mismatch'));
            const data = await res.json();
            setRevealData(JSON.parse(data.decrypted));
            setRevealPrompt({ isOpen: false, id: null, pass: '' });
            showToast(t('alerts.decryption_successful'));
        } catch (err) {
            setRevealError(err.message);
        } finally {
            setRevealLoading(false);
        }
    };

    const deleteSecret = async (id) => {
        showConfirm(t('actions.delete_mission'), t('actions.erase_completely'), async () => {
            const updated = secrets.filter(s => (s.id !== id && s._id !== id));
            await onUpdate({ secrets: updated });
            setSecrets(updated);
            showToast(t('alerts.secret_purged'));
        });
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        showToast(t('alerts.copied_to_clipboard'));
    };

    return (
        <div className="p-8 max-w-6xl mx-auto animate-fade-in text-black">
            <header className="mb-12 flex justify-between items-end">
                <div>
                    <h2 className="text-5xl font-black tracking-tighter">{t('labels.project_vault')}</h2>
                    <p className="text-gray-400 mt-2 font-bold uppercase tracking-[0.2em] text-[10px]">{t('labels.encrypted_storage_center')}</p>
                </div>
                <button onClick={() => setIsAdding(true)} className="bg-black text-white px-10 py-4 rounded-full text-[10px] font-black uppercase tracking-widest shadow-2xl hover:scale-105 active:scale-95 transition flex items-center gap-3">
                    <window.Icon name="plus-circle" size={18} /> {t('actions.add_secret') || "Add Secret"}
                </button>
            </header>

            <div className="bg-white border border-gray-100 rounded-[2.5rem] shadow-xl overflow-hidden">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-gray-50/50 border-b border-gray-50 text-[10px] font-black uppercase tracking-widest text-gray-400">
                            <th className="px-8 py-6">{t('labels.service')}</th>
                            <th className="px-8 py-6">{t('labels.status')}</th>
                            <th className="px-8 py-6 text-right">{t('labels.actions_col')}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                        {secrets.map(s => (
                            <tr key={s.id || s._id} className="hover:bg-gray-50/50 transition-colors group">
                                <td className="px-8 py-6">
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-blue-500">
                                            <window.Icon name="shield" size={20} />
                                        </div>
                                        <span className="font-black text-sm tracking-tight">{s.service}</span>
                                    </div>
                                </td>
                                <td className="px-8 py-6">
                                    <span className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full text-[9px] font-black uppercase tracking-widest">
                                        <div className="w-1 h-1 bg-emerald-500 rounded-full animate-pulse"></div>
                                        {t('labels.secured_archive')}
                                    </span>
                                </td>
                                <td className="px-8 py-6 text-right">
                                    <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button onClick={() => setRevealPrompt({ isOpen: true, id: s.id || s._id, pass: '' })} className="p-3 bg-gray-50 hover:bg-black hover:text-white rounded-xl transition-all duration-300 text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                                            <window.Icon name="key" size={14} /> {t('actions.reveal')}
                                        </button>
                                        <button onClick={() => deleteSecret(s.id || s._id)} className="p-3 bg-red-50 text-red-500 hover:bg-red-500 hover:text-white rounded-xl transition-all duration-300">
                                            <window.Icon name="trash-2" size={14} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {secrets.length === 0 && (
                    <div className="py-20 text-center flex flex-col items-center">
                        <window.Icon name="lock" size={48} className="text-gray-100 mb-4" />
                        <p className="text-gray-300 italic text-sm font-medium">Vault is currently empty. Secure your first credential above.</p>
                    </div>
                )}
            </div>

            <window.GlobalModal isOpen={isAdding} onClose={() => setIsAdding(false)} title={t('actions.encrypt_archive')} footer={<button onClick={addSecret} className="bg-black text-white px-8 py-3 rounded-full text-[9px] font-black uppercase tracking-widest shadow-xl">{t('actions.encrypt_archive')}</button>}>
                <div className="space-y-4">
                    <input className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none text-xs font-bold" placeholder={t('labels.service_label')} value={newSecret.service} onChange={e => setNewSecret({...newSecret, service: e.target.value})} />
                    <input className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none text-xs font-bold" placeholder={t('labels.account_identifier')} value={newSecret.account} onChange={e => setNewSecret({...newSecret, account: e.target.value})} />
                    <input className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none text-xs font-bold" type="password" placeholder={t('labels.password')} value={newSecret.password} onChange={e => setNewSecret({...newSecret, password: e.target.value})} />
                </div>
            </window.GlobalModal>

            <window.GlobalModal isOpen={revealPrompt.isOpen} onClose={() => setRevealPrompt({ isOpen: false, id: null, pass: '' })} title={t('labels.vault_security')} footer={
                <button onClick={handleReveal} disabled={revealLoading} className="bg-black text-white px-8 py-3 rounded-full text-[9px] font-black uppercase tracking-widest shadow-xl flex items-center gap-2">
                    {revealLoading && <window.Icon name="loader" size={14} className="animate-spin" />} {t('actions.decrypt')}
                </button>
            }>
                <p className="mb-4">{t('alerts.retype_pin')}</p>
                <input className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none text-xs font-bold" type="password" placeholder={t('labels.master_pin')} autoFocus value={revealPrompt.pass} onChange={e => setRevealPrompt({...revealPrompt, pass: e.target.value})} onKeyDown={e => e.key === 'Enter' && handleReveal()} />
                {revealError && <p className="text-red-500 mt-2 text-[10px] font-black animate-shake">{revealError}</p>}
            </window.GlobalModal>

            <window.GlobalModal isOpen={!!revealData} onClose={() => setRevealData(null)} title={t('alerts.secure_access_granted')} footer={<button onClick={() => setRevealData(null)} className="bg-black text-white px-8 py-3 rounded-full text-[9px] font-black uppercase tracking-widest shadow-xl">{t('actions.close')}</button>}>
                <div className="space-y-6">
                    <div>
                        <label className="text-[8px] font-black text-gray-400 uppercase tracking-widest block mb-2">{t('labels.service')}</label>
                        <p className="text-sm font-black">{revealData?.service}</p>
                    </div>
                    <div>
                        <label className="text-[8px] font-black text-gray-400 uppercase tracking-widest block mb-2">{t('labels.account')}</label>
                        <div className="flex justify-between items-center bg-gray-50 p-4 rounded-xl border border-gray-100">
                            <span className="font-mono text-xs">{revealData?.account}</span>
                            <button onClick={() => copyToClipboard(revealData?.account)} className="text-blue-500"><window.Icon name="copy" size={16}/></button>
                        </div>
                    </div>
                    <div>
                        <label className="text-[8px] font-black text-gray-400 uppercase tracking-widest block mb-2">{t('labels.password')}</label>
                        <div className="flex justify-between items-center bg-gray-50 p-4 rounded-xl border border-gray-100">
                            <span className="font-mono text-xs">{revealData?.password}</span>
                            <button onClick={() => copyToClipboard(revealData?.password)} className="text-blue-500"><window.Icon name="copy" size={16}/></button>
                        </div>
                    </div>
                </div>
            </window.GlobalModal>
        </div>
    );
};
