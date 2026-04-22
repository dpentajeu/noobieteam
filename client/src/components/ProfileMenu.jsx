window.ProfileMenu = ({ user, onLogout, onThemeChange, currentTheme, onUpdateUser }) => {
    const [open, setOpen] = React.useState(false);
    const [showChangePass, setShowChangePass] = React.useState(false);
    const [newPass, setNewPass] = React.useState("");
    const { showToast } = window.useToasts();
    const { lang, setLang, t } = window.useTranslation();
    
    const LANGS = [
        { id: 'en', name: 'English' },
        { id: 'id', name: 'Bahasa Indonesia' },
        { id: 'ja', name: '日本語' },
        { id: 'ms', name: 'Bahasa Melayu' },
        { id: 'ru', name: 'Русский' },
        { id: 'zh-CN', name: '简体中文' },
        { id: 'zh-TW', name: '繁體中文' }
    ];
    const uMail = user?.email || 'User';
    const uLabel = uMail.charAt(0).toUpperCase();
    const avatarInputRef = React.useRef(null);

    const isDarkHeader = ['dark', 'darkblue', 'green', 'ocean'].includes(currentTheme);

    const handleAvatarUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (re) => {
                const updatedUser = { ...user, avatar: re.target.result };
                onUpdateUser(updatedUser);
                const users = window.safeParse('nt_users', []);
                localStorage.setItem('nt_users', JSON.stringify(users.map(u => u.email === user.email ? updatedUser : u)));
            };
            reader.readAsDataURL(file);
        }
    };

    return (
        <div className="relative">
            <div className="flex items-center gap-4">
                <button onClick={() => setOpen(!open)} className={`p-2 hover:bg-black/10 rounded-full transition flex items-center justify-center ${isDarkHeader ? 'text-white' : 'text-gray-600'}`}>
                    <window.Icon name="globe" size={20} />
                    <span className="text-xs font-bold ml-1 uppercase">{lang.split('-')[0]}</span>
                </button>
                <window.Avatar label={uLabel} src={user?.avatar} active story onClick={() => setOpen(!open)} />
            </div>
            {open && (
                <>
                    <div className="fixed inset-0 z-[140]" onClick={() => setOpen(false)}></div>
                    <div className="absolute right-0 top-full mt-3 w-72 bg-white rounded-2xl shadow-2xl border border-gray-100 p-3 z-[150] animate-pop text-black">
                        <div className="px-3 py-2 border-b border-gray-50 mb-1.5 flex flex-col items-center">
                            <window.Avatar label={uLabel} src={user?.avatar} size="lg" onClick={() => avatarInputRef.current.click()} />
                            <input type="file" ref={avatarInputRef} className="hidden" onChange={handleAvatarUpload} accept="image/*" />
                            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-2">{t('labels.authorized_user')}</p>
                            <p className="text-sm font-bold truncate max-w-full">{uMail}</p>
                        </div>
                        <div className="space-y-1">
                            <button onClick={() => { setOpen(false); setShowChangePass(true); }} className="w-full text-left px-3 py-2.5 hover:bg-gray-50 rounded-xl text-sm font-medium flex items-center gap-2.5"><window.Icon name="key" size={14} /> {t('actions.update_password')}</button>
                            <div className="px-3 py-2"><p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2">{t('labels.language')}</p><select value={lang} onChange={e => { setLang(e.target.value); setOpen(false); }} className="w-full bg-gray-50 border border-gray-100 rounded-lg p-2 text-xs font-bold outline-none cursor-pointer">{LANGS.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
                            <div className="px-3 py-2"><p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2">{t('labels.header_theme')}</p><div className="grid grid-cols-5 gap-1.5">{window.THEMES.map(th => (<button key={th.id} onClick={() => onThemeChange(th.id)} className={`w-full aspect-square rounded-md border-2 transition ${th.class.split(' ')[0]} ${currentTheme === th.id ? 'border-blue-500 scale-105' : 'border-transparent'}`} title={th.name}></button>))}</div></div>
                            <button onClick={onLogout} className="w-full text-left px-3 py-2.5 hover:bg-red-50 text-red-500 rounded-xl text-sm font-bold flex items-center gap-2.5"><window.Icon name="log-out" size={14} /> {t('actions.logout')}</button>
                        </div>
                    </div>
                </>
            )}
            <window.GlobalModal isOpen={showChangePass} onClose={() => setShowChangePass(false)} title={t('labels.security_update')} footer={<button onClick={() => {
                if (newPass.length < 4) return showToast(t('alerts.password_too_short'));
                const users = window.safeParse('nt_users', []);
                // Ensure password string is explicitly set and cleanly formatted (no encryption at rest to prevent double-hashing login failures, as prototype DB is localStorage)
                // If real backend: send to /api/update-password and hash with bcrypt
                const updatedUser = { ...user, password: newPass };
                localStorage.setItem('nt_users', JSON.stringify(users.map(u => u.email === user.email ? updatedUser : u)));
                onUpdateUser(updatedUser);
                setShowChangePass(false);
                setNewPass('');
                showToast(t('alerts.password_updated'));
            }} className="bg-black text-white px-5 py-2 rounded-full text-[10px] font-bold">{t('actions.save_key')}</button>}><p className="mb-3">{t('labels.enter_secure_key')}</p><input className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100 outline-none text-black text-xs" type="password" placeholder={t('labels.new_password')} value={newPass} onChange={e => setNewPass(e.target.value)} /></window.GlobalModal>
        </div>
    );
};
