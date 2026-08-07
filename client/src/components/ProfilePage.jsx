window.ProfilePage = ({ user, onBack, onUpdateUser, theme }) => {
    const { showToast } = window.useToasts();
    const { t } = window.useTranslation ? window.useTranslation() : { t: k => k };
    const [currentPassword, setCurrentPassword] = React.useState('');
    const [password, setPassword] = React.useState('');
    const [pin, setPin] = React.useState('');
    const [confirmPin, setConfirmPin] = React.useState('');
    const [saving, setSaving] = React.useState('');
    const avatarInputRef = React.useRef(null);
    const backgroundInputRef = React.useRef(null);
    const hdr = window.getHeaderTheme(theme);
    const email = user?.email || '';
    const label = window.getInitials(user || email);

    const persistUser = async (patch, successMessage) => {
        let updatedUser = { ...user, ...patch };
        if (email) {
            const res = await fetch(`/api/users/${encodeURIComponent(email)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch)
            });
            if (!res.ok) {
                const data = await res.json().catch(() => null);
                throw new Error(data?.error || 'Unable to update profile.');
            }
            const saved = await res.json();
            updatedUser = { ...updatedUser, ...saved };
        }

        onUpdateUser(updatedUser);
        localStorage.setItem('nt_user', JSON.stringify(updatedUser));
        showToast(successMessage);
    };

    // `category` picks the folder under <repo>/uploads/. It is sent in the query
    // string as well as the body because multer only exposes multipart fields
    // that arrive before the file part.
    const uploadMedia = async (file, category) => {
        const formData = new FormData();
        formData.append('category', category);
        formData.append('file', file);
        const res = await fetch(`/api/upload?category=${encodeURIComponent(category)}`, {
            method: 'POST',
            body: formData,
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || 'Upload failed.');
        return data.path;
    };

    const handleAvatarUpload = async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        setSaving('avatar');
        try {
            const avatar = await uploadMedia(file, 'profile_picture');
            await persistUser({ avatar }, t('alerts.profile_picture_updated') || 'Profile picture updated.');
        } catch (err) {
            showToast(err.message);
        } finally {
            setSaving('');
            event.target.value = '';
        }
    };

    const handleBackgroundUpload = async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        setSaving('background');
        try {
            const homeBackgroundImage = await uploadMedia(file, 'background');
            await persistUser({ homeBackgroundImage }, t('alerts.home_background_updated') || 'Home background image updated.');
        } catch (err) {
            showToast(err.message);
        } finally {
            setSaving('');
            event.target.value = '';
        }
    };

    const handlePasswordSave = async () => {
        if (!currentPassword) return showToast(t('alerts.current_password_required') || 'Current password is required');
        if (!window.checkPasswordRules(password).valid) return showToast(t('alerts.weak_security') || 'Password must be at least 8 characters and include a symbol.');
        setSaving('password');
        try {
            const res = await fetch(`/api/users/${encodeURIComponent(email)}/password`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentPassword, password })
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) throw new Error(data?.errors?.[0]?.message || data?.error || 'Unable to update password.');
            setCurrentPassword('');
            setPassword('');
            showToast(t('alerts.password_updated') || 'Password updated successfully.');
        } catch (err) {
            showToast(err.message);
        } finally {
            setSaving('');
        }
    };

    const handlePinSave = async () => {
        if (pin !== confirmPin) return showToast(t('alerts.pins_do_not_match') || 'PINs do not match.');
        if (pin.length < 6) return showToast(t('alerts.pin_min_length') || 'PIN must be at least 6 characters.');
        setSaving('pin');
        try {
            const res = await fetch('/api/users/pin', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, pin })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || 'Unable to update Master PIN.');
            const updatedUser = { ...user, vaultPin: data.vaultPin };
            onUpdateUser(updatedUser);
            localStorage.setItem('nt_user', JSON.stringify(updatedUser));
            setPin('');
            setConfirmPin('');
            showToast(t('alerts.master_pin_updated') || 'Master PIN updated.');
        } catch (err) {
            showToast(err.message);
        } finally {
            setSaving('');
        }
    };

    const removeBackground = async () => {
        setSaving('background');
        try {
            await persistUser({ homeBackgroundImage: '' }, t('alerts.home_background_updated') || 'Home background image updated.');
        } catch (err) {
            showToast(err.message);
        } finally {
            setSaving('');
        }
    };

    return (
        <div className="h-screen bg-gray-50 text-black flex flex-col animate-fade-in overflow-hidden">
            <nav className={`h-16 px-6 lg:px-12 flex items-center justify-between flex-shrink-0 transition-colors duration-300 shadow-sm ${hdr.nav}`}>
                <div className="flex items-center gap-4 min-w-0">
                    <button type="button" onClick={onBack} className={`p-2.5 rounded-xl transition ${hdr.ghost}`} title={t('actions.back') || 'Back'}>
                        <window.Icon name="arrow-left" size={20} />
                    </button>
                    <div className={hdr.title}>
                        <h1 className="text-lg font-black tracking-tighter italic">{t('labels.profile_settings') || 'Profile Settings'}</h1>
                        <p className="text-[9px] font-black uppercase tracking-[0.25em] opacity-50 truncate max-w-[60vw]">{email}</p>
                    </div>
                </div>
            </nav>

            <main className="flex-1 overflow-y-auto p-4 md:p-10">
                <div className="max-w-5xl mx-auto space-y-6">
                    <section className="bg-white border border-gray-100 rounded-2xl p-5 md:p-8 shadow-sm">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                            <div className="flex items-center gap-4 min-w-0">
                                <window.Avatar label={label} src={window.getImageUrl(user?.avatar)} size="lg" />
                                <div className="min-w-0">
                                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{t('labels.authorized_user') || 'Authorized User'}</p>
                                    <h2 className="text-2xl font-black tracking-tight truncate">{user?.name || email.split('@')[0]}</h2>
                                    <p className="text-sm text-gray-400 truncate">{email}</p>
                                </div>
                            </div>
                            <button onClick={() => avatarInputRef.current.click()} disabled={saving === 'avatar'} className="px-5 py-3 bg-black text-white rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50">
                                {saving === 'avatar' ? <window.Icon name="loader" size={14} className="animate-spin" /> : <window.Icon name="camera" size={14} />}
                                {t('actions.update_profile_picture') || 'Update Profile Picture'}
                            </button>
                            <input ref={avatarInputRef} type="file" className="hidden" accept="image/*" onChange={handleAvatarUpload} />
                        </div>
                    </section>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <section className="bg-white border border-gray-100 rounded-2xl p-5 md:p-6 shadow-sm">
                            <div className="flex items-center gap-3 mb-5">
                                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-500 flex items-center justify-center"><window.Icon name="key-round" size={18} /></div>
                                <div>
                                    <h3 className="text-sm font-black uppercase tracking-widest">{t('actions.update_password') || 'Update Password'}</h3>
                                    <p className="text-xs text-gray-400">{t('labels.password_policy') || 'At least 8 characters, including one symbol.'}</p>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
                                <input className="min-w-0 p-4 bg-gray-50 rounded-xl border border-gray-100 outline-none text-xs font-bold focus:border-blue-400" type="password" placeholder={t('labels.current_password') || 'Current Password'} value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
                                <input className="min-w-0 p-4 bg-gray-50 rounded-xl border border-gray-100 outline-none text-xs font-bold focus:border-blue-400" type="password" placeholder={t('labels.new_password') || 'New Password'} value={password} onChange={e => setPassword(e.target.value)} />
                                <button onClick={handlePasswordSave} disabled={saving === 'password'} className="h-12 sm:w-12 rounded-xl bg-black text-white flex items-center justify-center disabled:opacity-50" title={t('actions.save_key') || 'Save'}>
                                    {saving === 'password' ? <window.Icon name="loader" size={16} className="animate-spin" /> : <window.Icon name="save" size={16} />}
                                </button>
                            </div>
                        </section>

                        <section className="bg-white border border-gray-100 rounded-2xl p-5 md:p-6 shadow-sm">
                            <div className="flex items-center gap-3 mb-5">
                                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center"><window.Icon name="shield-check" size={18} /></div>
                                <div>
                                    <h3 className="text-sm font-black uppercase tracking-widest">{t('actions.update_master_pin') || 'Update Master PIN'}</h3>
                                    <p className="text-xs text-gray-400">{t('alerts.master_pin_requirement') || 'Minimum 6 characters.'}</p>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
                                <input className="min-w-0 p-4 bg-gray-50 rounded-xl border border-gray-100 outline-none text-xs font-bold focus:border-blue-400" type="password" placeholder={t('labels.enter_pin') || 'Enter PIN'} value={pin} onChange={e => setPin(e.target.value)} />
                                <input className="min-w-0 p-4 bg-gray-50 rounded-xl border border-gray-100 outline-none text-xs font-bold focus:border-blue-400" type="password" placeholder={t('labels.confirm_pin') || 'Confirm PIN'} value={confirmPin} onChange={e => setConfirmPin(e.target.value)} />
                                <button onClick={handlePinSave} disabled={saving === 'pin'} className="h-12 sm:w-12 rounded-xl bg-black text-white flex items-center justify-center disabled:opacity-50" title={t('actions.save_key') || 'Save'}>
                                    {saving === 'pin' ? <window.Icon name="loader" size={16} className="animate-spin" /> : <window.Icon name="save" size={16} />}
                                </button>
                            </div>
                        </section>
                    </div>

                    <section className="bg-white border border-gray-100 rounded-2xl p-5 md:p-6 shadow-sm">
                        <div className="flex flex-col lg:flex-row gap-6 lg:items-center justify-between">
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center flex-shrink-0"><window.Icon name="image" size={18} /></div>
                                <div className="min-w-0">
                                    <h3 className="text-sm font-black uppercase tracking-widest">{t('actions.update_home_background') || 'Update Home Background Image'}</h3>
                                    <p className="text-xs text-gray-400">{t('labels.home_background_hint') || 'Shown behind your workspace home page.'}</p>
                                </div>
                            </div>
                            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                                <button onClick={() => backgroundInputRef.current.click()} disabled={saving === 'background'} className="px-5 py-3 bg-black text-white rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50">
                                    {saving === 'background' ? <window.Icon name="loader" size={14} className="animate-spin" /> : <window.Icon name="upload" size={14} />}
                                    {t('actions.choose_image') || 'Choose Image'}
                                </button>
                                {user?.homeBackgroundImage && (
                                    <button onClick={removeBackground} disabled={saving === 'background'} className="px-5 py-3 bg-gray-100 text-gray-500 hover:text-red-500 rounded-xl text-[10px] font-black uppercase tracking-widest transition disabled:opacity-50">
                                        {t('actions.remove') || 'Remove'}
                                    </button>
                                )}
                                <input ref={backgroundInputRef} type="file" className="hidden" accept="image/*" onChange={handleBackgroundUpload} />
                            </div>
                        </div>
                        {user?.homeBackgroundImage && (
                            <div className="mt-5 aspect-[16/5] rounded-2xl overflow-hidden border border-gray-100 bg-gray-50">
                                <img src={window.getImageUrl(user.homeBackgroundImage)} className="w-full h-full object-cover" />
                            </div>
                        )}
                    </section>

                </div>
            </main>
        </div>
    );
};
