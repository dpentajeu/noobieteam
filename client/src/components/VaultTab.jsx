window.VaultTab = ({ workspace, user, onUpdate }) => {
    const { showPrompt, showAlert, showConfirm } = window.useModals();
    const { showToast } = window.useToasts();
    const [secrets, setSecrets] = React.useState(workspace.secrets || []);
    const [newSecret, setNewSecret] = React.useState({ service: '', account: '', password: '' });
    const [isAdding, setIsAdding] = React.useState(false);
    const [revealData, setRevealData] = React.useState(null);

    const addSecret = async () => {
        if (!newSecret.service || !newSecret.account || !newSecret.password) return showAlert('Please fill all fields.', 'Missing Intel');
        try {
            const res = await fetch(`/api/workspaces/${workspace.id}/vault/encrypt`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ text: JSON.stringify(newSecret), password: user?.password || user?.vaultPin }) });
            if (!res.ok) throw new Error('Encryption failed');
            const data = await res.json();
            const encrypted = data.encrypted;
            
            const updatedSecrets = [...secrets, { id: window.generateId('sec'), service: newSecret.service, value: encrypted }];
            
            await onUpdate({ secrets: updatedSecrets });
            
            setSecrets(updatedSecrets);
            setNewSecret({ service: '', account: '', password: '' });
            setIsAdding(false);
            showToast("Payload secured in the Vault. 🔐");
        } catch (err) {
            showAlert('Vault sync failed: ' + err.message, 'Error');
        }
    };

    const [revealError, setRevealError] = React.useState('');
    const [revealLoading, setRevealLoading] = React.useState(false);
    const [revealPrompt, setRevealPrompt] = React.useState({ isOpen: false, id: null, pass: '' });
    const [pinPrompt, setPinPrompt] = React.useState({ isOpen: false, pin: '', confirm: '' });
    const [pinError, setPinError] = React.useState('');
    const [pinLoading, setPinLoading] = React.useState(false);

    const handleCreatePin = async (e) => {
        e.preventDefault();
        if (pinPrompt.pin !== pinPrompt.confirm) return setPinError('PINs do not match.');
        if (pinPrompt.pin.length < 6) return setPinError('PIN must be at least 6 characters.');
        setPinLoading(true);
        try {
            const res = await fetch('/api/users/pin', { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ email: user.email, pin: pinPrompt.pin }) });
            if (!res.ok) throw new Error('Failed to save PIN.');
            const data = await res.json();
            onUpdateUser({ ...user, vaultPin: data.vaultPin });
            showToast('Master Vault PIN created successfully. 🔐');
            setPinPrompt({ isOpen: false, pin: '', confirm: '' });
        } catch (err) {
            setPinError(err.message);
        } finally {
            setPinLoading(false);
        }
    };

    const handleReveal = (id) => {
        if (user?.method === 'google' && !user?.vaultPin) {
            setPinPrompt({ isOpen: true, pin: '', confirm: '' });
            return;
        }
        setRevealPrompt({ isOpen: true, id, pass: '' });
        setRevealError('');
    };

    const processReveal = async () => {
        if (!revealPrompt.pass) return;
        setRevealLoading(true);
        setRevealError('');
        try {
            const s = secrets.find(x => (x.id === revealPrompt.id || x._id === revealPrompt.id));
            const payloadPass = user?.method === 'google' ? await window.inHouseHash(revealPrompt.pass) : revealPrompt.pass;
            const res = await fetch(`/api/workspaces/${workspace.id}/vault/decrypt`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ cipherBase64: s.value, password: payloadPass }) });
            
            if (res.status === 401) {
                setRevealError('Incorrect password. Unable to decrypt secret.');
                setRevealPrompt({ ...revealPrompt, pass: '' }); // Clear input field
                setRevealLoading(false);
                return;
            }
            if (!res.ok) throw new Error('Decryption failed');
            
            const data = await res.json();
            const dec = data.decrypted;
            
            try {
                const parsed = JSON.parse(dec);
                setRevealData({ ...parsed, service: s.service });
                setRevealPrompt({ isOpen: false, id: null, pass: '' });
            } catch (e) {
                setRevealData({ service: s.service, account: 'Data Error', password: dec });
                setRevealPrompt({ isOpen: false, id: null, pass: '' });
            }
        } catch (err) {
            setRevealError(err.message || 'Vault Error');
            setRevealPrompt({ ...revealPrompt, pass: '' });
        }
        setRevealLoading(false);
    };

    const deleteSecret = async (id) => {
        const updatedSecrets = secrets.filter(x => (x.id !== id && x._id !== id));
        await onUpdate({ secrets: updatedSecrets });
        setSecrets(updatedSecrets);
        showToast("Secret purged.");
    };

    const copyToClipboard = (text) => {
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text);
        } else {
            let textArea = document.createElement("textarea");
            textArea.value = text;
            textArea.style.position = "fixed";
            textArea.style.left = "-999999px";
            textArea.style.top = "-999999px";
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            try {
                document.execCommand('copy');
            } catch (err) {
                console.error('Fallback: Oops, unable to copy', err);
            }
            textArea.remove();
        }
        showToast("Copied to clipboard! 📋");
    };

    return (
        <div className="p-8 max-w-4xl mx-auto animate-fade-in pb-32">
            <header className="flex justify-between items-start mb-12">
                <div><h2 className="text-4xl font-black mb-2 tracking-tighter">Project Vault</h2><p className="text-gray-400 text-[10px] font-bold uppercase tracking-[0.2em]">Encrypted Storage Center</p></div>
                <button onClick={() => setIsAdding(true)} className="relative p-4 bg-black text-white rounded-full hover:scale-110 active:scale-90 transition shadow-xl ml-8"><window.Icon name="key-round" size={24} /><div className="absolute bottom-2 right-2 bg-blue-500 rounded-full w-4 h-4 flex items-center justify-center border-2 border-black"><window.Icon name="plus" size={8} className="text-white" /></div></button>
            </header>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {secrets.map(s => {
                    const secretId = s.id || s._id;
                    return (
                    <div key={secretId} className="p-6 bg-white border border-gray-100 rounded-[2rem] flex justify-between items-center shadow-sm hover:border-blue-200 transition group">
                        <div><p className="font-black text-lg tracking-tight">{s.service}</p><p className="text-[8px] text-gray-400 uppercase tracking-[0.2em] font-black mt-2">Secured Archive</p></div>
                        <div className="flex gap-3">
                            <button onClick={() => handleReveal(secretId)} className="px-5 py-2 bg-blue-50 text-blue-500 rounded-full font-black text-[9px] uppercase tracking-widest hover:bg-blue-500 hover:text-white transition shadow-sm">Reveal</button>
                            <button onClick={() => showConfirm('Destroy Payload', `Delete ${s.service}?`, () => deleteSecret(secretId))} className="p-2 text-gray-200 hover:text-red-500 transition"><window.Icon name="trash-2" size={16}/></button>
                        </div>
                    </div>
                    );
                })}
            </div>
            
            <window.GlobalModal isOpen={isAdding} onClose={() => setIsAdding(false)} title="Secure Data Archiving" footer={<button onClick={addSecret} className="bg-black text-white px-8 py-3 rounded-full text-[9px] font-black uppercase tracking-widest shadow-xl">Encrypt & Archive</button>}>
                <div className="space-y-4">
                    <input className="w-full p-4 bg-gray-50 rounded-xl border border-gray-100 outline-none text-[11px] font-bold" placeholder="Service Label (e.g. AWS)" value={newSecret.service} onChange={e => setNewSecret({...newSecret, service: e.target.value})} />
                    <input className="w-full p-4 bg-gray-50 rounded-xl border border-gray-100 outline-none text-[11px] font-medium" placeholder="Account Identifier" value={newSecret.account} onChange={e => setNewSecret({...newSecret, account: e.target.value})} />
                    <input className="w-full p-4 bg-gray-50 rounded-xl border border-gray-100 outline-none text-[11px] font-medium" type="password" placeholder="Access Key / Password" value={newSecret.password} onChange={e => setNewSecret({...newSecret, password: e.target.value})} />
                </div>
            </window.GlobalModal>
            <window.GlobalModal isOpen={revealPrompt.isOpen} onClose={() => setRevealPrompt({ isOpen: false, id: null, pass: '' })} title="Identity Verification" footer={
                <button onClick={processReveal} disabled={revealLoading} className="bg-black text-white px-8 py-3 rounded-full text-[9px] font-black uppercase tracking-widest shadow-xl">
                    {revealLoading ? 'Decrypting...' : 'Decrypt'}
                </button>
            }>
                <div className="space-y-2">
                    <p className="mb-2 font-bold text-gray-600 text-sm">Re-type your {user?.method === 'google' ? 'Master PIN' : 'Noobieteam password'} to decrypt.</p>
                    <input 
                        className={`w-full p-4 bg-gray-50 rounded-2xl border-2 outline-none text-black transition font-black text-xs ${revealError ? 'border-red-500 animate-shake focus:border-red-500' : 'border-gray-100 focus:border-black'}`} 
                        type="password" 
                        value={revealPrompt.pass} 
                        onChange={e => { setRevealPrompt({ ...revealPrompt, pass: e.target.value }); setRevealError(''); }} 
                        autoFocus 
                        onKeyDown={e => e.key === 'Enter' && processReveal()} 
                        placeholder={user?.method === 'google' ? 'Master PIN' : 'Master Password'}
                    />
                    {revealError && <p className="text-red-500 text-xs font-bold mt-2 ml-1">{revealError}</p>}
                </div>
            </window.GlobalModal>


            <window.GlobalModal isOpen={!!revealData} onClose={() => setRevealData(null)} title="Secure Access Granted" footer={<button onClick={() => setRevealData(null)} className="bg-black text-white px-8 py-3 rounded-full text-[9px] font-black uppercase tracking-widest shadow-xl">Close</button>}>
                {revealData && (
                    <div className="space-y-6">
                        <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100 text-emerald-700 flex items-center gap-3">
                            <window.Icon name="shield-check" size={20} />
                            <p className="text-[10px] font-bold uppercase tracking-widest">Decryption Successful</p>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <p className="text-[9px] font-black text-gray-400 uppercase tracking-[0.2em] mb-2">Service</p>
                                <p className="text-sm font-bold text-black">{revealData.service}</p>
                            </div>
                            <div>
                                <p className="text-[9px] font-black text-gray-400 uppercase tracking-[0.2em] mb-2">Account</p>
                                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
                                    <p className="text-xs font-bold font-mono">{revealData.account}</p>
                                    <button onClick={() => copyToClipboard(revealData.account)} className="p-2 text-gray-400 hover:text-black transition"><window.Icon name="copy" size={16} /></button>
                                </div>
                            </div>
                            <div>
                                <p className="text-[9px] font-black text-gray-400 uppercase tracking-[0.2em] mb-2">Password</p>
                                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
                                    <p className="text-xs font-bold font-mono">{revealData.password}</p>
                                    <button onClick={() => copyToClipboard(revealData.password)} className="p-2 text-gray-400 hover:text-black transition"><window.Icon name="copy" size={16} /></button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </window.GlobalModal>
        </div>
    );
};
