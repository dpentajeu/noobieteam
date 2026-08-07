window.ProfileMenu = ({ user, onLogout, onThemeChange, currentTheme, onUpdateUser, onOpenProfile }) => {
    const [open, setOpen] = React.useState(false);
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
    const uLabel = window.getInitials(user || uMail);
    const hdr = window.getHeaderTheme(currentTheme);
    const themeName = th => t(`themes.${th.id}`) || th.name;

    return (
        <div className="relative">
            <div className="flex items-center gap-4">
                <button
                    type="button"
                    onClick={() => setOpen(!open)}
                    aria-haspopup="menu"
                    aria-expanded={open}
                    title={t('labels.language')}
                    className={`p-2 rounded-full transition flex items-center justify-center ${hdr.ghost}`}
                >
                    <window.Icon name="globe" size={20} />
                    <span className="text-xs font-bold ml-1 uppercase">{lang.split('-')[0]}</span>
                </button>
                <window.Avatar label={uLabel} src={window.getImageUrl(user?.avatar)} active onClick={() => setOpen(!open)} />
            </div>
            {open && (
                <>
                    <div className="fixed inset-0 z-[140]" onClick={() => setOpen(false)}></div>
                    <div className="absolute right-0 top-full mt-3 w-72 bg-white rounded-2xl shadow-2xl border border-gray-100 p-3 z-[150] animate-pop text-black">
                        <div className="px-3 py-2 border-b border-gray-50 mb-1.5 flex flex-col items-center">
                            <window.Avatar label={uLabel} src={window.getImageUrl(user?.avatar)} size="lg" onClick={() => { setOpen(false); onOpenProfile && onOpenProfile(); }} />
                            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-2">{t('labels.authorized_user')}</p>
                            <p className="text-sm font-bold truncate max-w-full">{uMail}</p>
                        </div>
                        <div className="space-y-1">
                            <button onClick={() => { setOpen(false); onOpenProfile && onOpenProfile(); }} className="w-full text-left px-3 py-2.5 hover:bg-gray-50 rounded-xl text-sm font-medium flex items-center gap-2.5"><window.Icon name="user-cog" size={14} /> {t('labels.profile_settings') || 'Profile Settings'}</button>
                            <div className="px-3 py-2"><p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2">{t('labels.language')}</p><select value={lang} onChange={e => { setLang(e.target.value); setOpen(false); }} className="w-full bg-gray-50 border border-gray-100 rounded-lg p-2 text-xs font-bold outline-none cursor-pointer">{LANGS.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
                            {/* Swatches carry their own hairline ring: the Default theme is
                                white on a white menu, so an unselected chip had no edge at all
                                and read as a gap in the row. Selection is a ring plus a check,
                                not a border swap, so it survives on every fill. */}
                            <div className="px-3 py-2">
                                <div className="flex items-baseline justify-between mb-2 gap-2">
                                    <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">{t('labels.header_theme')}</p>
                                    <p className="text-[11px] font-bold text-gray-600 truncate">{themeName(hdr)}</p>
                                </div>
                                <div className="grid grid-cols-5 gap-2" role="group" aria-label={t('labels.header_theme')}>
                                    {window.THEMES.map(th => {
                                        const active = currentTheme === th.id;
                                        return (
                                            <button
                                                key={th.id}
                                                type="button"
                                                onClick={() => onThemeChange(th.id)}
                                                aria-pressed={active}
                                                aria-label={themeName(th)}
                                                title={themeName(th)}
                                                className={`w-full aspect-square rounded-lg flex items-center justify-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 active:scale-95 ${th.class} theme-swatch ${active ? 'ring-2 ring-blue-500 ring-offset-2' : 'ring-1 ring-black/10 hover:ring-black/30 hover:scale-105'}`}
                                            >
                                                {active && <window.Icon name="check" size={12} className={th.dark ? 'text-white' : 'text-blue-600'} />}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                            <button onClick={onLogout} className="w-full text-left px-3 py-2.5 hover:bg-red-50 text-red-500 rounded-xl text-sm font-bold flex items-center gap-2.5"><window.Icon name="log-out" size={14} /> {t('actions.logout')}</button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};
