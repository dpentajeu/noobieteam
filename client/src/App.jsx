// --- JWT: attach Bearer token to same-origin /api requests (patched once) ---
//
// The origin check is not cosmetic. This used to match on `url.includes('/api/')`
// alone, so any third-party URL with `/api/` in its path — exactly the shape the
// API-testing page sends — was handed a working session token for this app.
const isSameOriginApi = (url) => {
    try {
        const resolved = new URL(url, window.location.origin);
        return resolved.origin === window.location.origin && resolved.pathname.startsWith('/api/');
    } catch (e) {
        return false;
    }
};

if (!window.__authFetchPatched) {
    window.__authFetchPatched = true;
    const _origFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
        try {
            const url = typeof input === 'string' ? input : (input && input.url) || '';
            const token = localStorage.getItem('nt_token');
            if (token && isSameOriginApi(url)) {
                const headers = new Headers(init.headers || (typeof input !== 'string' && input.headers) || {});
                if (!headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + token);
                init = { ...init, headers };
            }
        } catch (e) { /* fall through to unmodified fetch */ }
        return _origFetch(input, init);
    };
}

window.AuthScreen = ({ onAuthSuccess }) => {
    const { showToast } = window.useToasts();
    const { t } = window.useTranslation ? window.useTranslation() : { t: k => k };
    const [mode, setMode] = React.useState('login');
    const [email, setEmail] = React.useState('');
    const [password, setPassword] = React.useState('');
    const [showPassword, setShowPassword] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    // Field-level problems stay next to the field that caused them; only failures
    // that belong to no single field (server/network) go into `form`.
    const [errors, setErrors] = React.useState({ email: '', password: '', form: '' });
    const isSignup = mode === 'signup';
    const passwordRules = window.checkPasswordRules(password);

    const validateEmail = (email) => {
        return String(email).toLowerCase().match(/^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/);
    };

    const switchMode = (next) => {
        if (next === mode) return;
        setMode(next);
        setErrors({ email: '', password: '', form: '' });
    };

    const handleLogin = async (email, password) => {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ email, password })
        });
        if (!res.ok) throw new Error(t('alerts.credentials_mismatch') || 'Incorrect email or password.');
        const user = await res.json();
        if (user.token) localStorage.setItem('nt_token', user.token);
        onAuthSuccess(user);
        showToast(t('alerts.welcome_back', { name: user.name || email.split('@')[0] }));
    };

    const handleGoogleResponse = async (response) => {
        setErrors({ email: '', password: '', form: '' });
        try {
            const res = await fetch('/api/auth/google', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ credential: response.credential }) });
            if (!res.ok) {
                const errData = await res.json().catch(() => null);
                throw new Error(errData?.error || 'Google authentication failed on server.');
            }
            const user = await res.json();
            if (user.token) localStorage.setItem('nt_token', user.token);
            onAuthSuccess(user);
            showToast(t('alerts.welcome_back', { name: user.name || user.email.split('@')[0] }));
        } catch (e) {
            setErrors({ email: '', password: '', form: e.message });
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (busy) return;

        const nextErrors = { email: '', password: '', form: '' };
        if (!validateEmail(email)) nextErrors.email = t('alerts.invalid_email') || 'Please enter a valid email address.';
        // New accounts must meet the policy; logins only need something typed, so
        // accounts created under the old 4-character rule can still sign in.
        if (isSignup) {
            if (!passwordRules.valid) nextErrors.password = t('alerts.weak_security') || 'Password must be at least 8 characters and include a symbol.';
        } else if (!password) {
            nextErrors.password = t('alerts.password_required') || 'Password is required.';
        }
        if (nextErrors.email || nextErrors.password) return setErrors(nextErrors);

        setErrors(nextErrors);
        setBusy(true);
        try {
            if (isSignup) {
                const res = await fetch('/api/users', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ email, password, name: email.split('@')[0] }) });
                if (!res.ok) {
                    const errData = await res.json().catch(() => null);
                    // Field validators answer with { error: 'Validation failed', errors: [...] },
                    // so surface the specific message on the field it belongs to.
                    const fieldError = errData?.errors?.[0];
                    if (fieldError?.field === 'password') return setErrors({ ...nextErrors, password: fieldError.message });
                    const message = fieldError?.message || errData?.error || t('alerts.duplicate_user') || 'This user is already registered.';
                    return setErrors({ ...nextErrors, email: message });
                }
                // The account exists now, so sign straight in — no "go back and log
                // in again" round trip with the credentials just typed.
                await handleLogin(email, password);
            } else {
                await handleLogin(email, password);
            }
        } catch (err) {
            setErrors({ ...nextErrors, form: err.message });
        } finally {
            setBusy(false);
        }
    };

    React.useEffect(() => {
        let timerId;
        const initGoogle = () => {
            if (window.google && document.getElementById('google-signin-btn')) {
                try {
                    window.google.accounts.id.initialize({
                        client_id: '634448520526-8159mplc06g6ekc3467adfi5t84tmt5u.apps.googleusercontent.com',
                        callback: handleGoogleResponse
                    });
                    window.google.accounts.id.renderButton(
                        document.getElementById('google-signin-btn'),
                        { theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill', width: '300' }
                    );
                    clearInterval(timerId);
                } catch (e) {
                    console.error('Google Sign-In initialization error:', e);
                }
            } else if (!window.google && timerId === undefined) {
                console.warn('window.google missing on mount, polling...');
            }
        };
        timerId = setInterval(initGoogle, 100);
        initGoogle();
        return () => clearInterval(timerId);
    }, []);

    const inputClass = (hasError) => `w-full px-4 py-3 bg-gray-50 border rounded-xl text-sm outline-none transition placeholder:text-gray-400 focus:bg-white focus:ring-2 ${hasError ? 'border-red-300 focus:ring-red-200' : 'border-gray-200 focus:border-blue-400 focus:ring-blue-100'}`;
    const tabClass = (active) => `flex-1 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest transition ${active ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`;

    return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50 animate-fade-in text-black">
            <div className="max-w-[380px] w-full bg-white p-8 sm:p-10 rounded-[2.5rem] shadow-2xl border border-gray-100">
                <h1 className="text-3xl font-black italic tracking-tighter text-center">{t('app_name')}</h1>

                {/* Two visible tabs: the current mode is never a guess */}
                <div role="tablist" className="flex gap-1 p-1 mt-6 bg-gray-100 rounded-2xl">
                    <button type="button" role="tab" aria-selected={!isSignup} onClick={() => switchMode('login')} className={tabClass(!isSignup)}>{t('actions.login')}</button>
                    <button type="button" role="tab" aria-selected={isSignup} onClick={() => switchMode('signup')} className={tabClass(isSignup)}>{t('actions.signup')}</button>
                </div>

                <div className="mt-6 mb-5 text-center">
                    <h2 className="text-lg font-black tracking-tight">{isSignup ? (t('labels.signup_title') || 'Create your account') : (t('labels.login_title') || 'Welcome back')}</h2>
                    <p className="mt-1 text-[11px] text-gray-500">{isSignup ? (t('labels.signup_subtitle') || 'Set up your workspace in a few seconds.') : (t('labels.login_subtitle') || 'Log in to pick up where you left off.')}</p>
                </div>

                <div id="google-signin-btn" className="flex justify-center w-full overflow-hidden rounded-xl min-h-[44px]"></div>
                {/* Fallback button just in case Google renderButton fails, or to explicitly trigger the prompt */}
                <button type="button" id="custom-google-btn" onClick={() => window.google?.accounts.id.prompt()} className="hidden w-full items-center justify-center gap-3 py-3 bg-white border border-gray-300 rounded-xl text-gray-700 text-xs font-bold hover:bg-gray-50 hover:shadow-md transition active:scale-95">
                    <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                    {t('labels.sign_in_with_google')}
                </button>

                <div className="relative py-4">
                    <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-gray-200"></span></div>
                    <div className="relative flex justify-center text-[9px] uppercase font-black text-gray-400"><span className="bg-white px-3">{t('labels.or_continue_with_email') || t('labels.or')}</span></div>
                </div>

                {errors.form && (
                    <div role="alert" className="mb-4 px-4 py-3 bg-red-50 border border-red-100 rounded-xl text-[11px] font-semibold text-red-600">{errors.form}</div>
                )}

                <form onSubmit={handleSubmit} noValidate className="space-y-4 text-left">
                    <div>
                        <label htmlFor="auth-email" className="block mb-1.5 text-[10px] font-black uppercase tracking-widest text-gray-500">{t('labels.email')}</label>
                        <input
                            id="auth-email"
                            className={inputClass(!!errors.email)}
                            type="email"
                            autoComplete="email"
                            autoFocus
                            placeholder={t('labels.email_placeholder') || 'you@company.com'}
                            aria-invalid={!!errors.email}
                            aria-describedby={errors.email ? 'auth-email-error' : undefined}
                            value={email}
                            onChange={e => { setEmail(e.target.value); if (errors.email) setErrors(prev => ({ ...prev, email: '' })); }}
                        />
                        {errors.email && <p id="auth-email-error" className="mt-1.5 text-[11px] font-semibold text-red-500">{errors.email}</p>}
                    </div>

                    <div>
                        <label htmlFor="auth-password" className="block mb-1.5 text-[10px] font-black uppercase tracking-widest text-gray-500">{t('labels.password')}</label>
                        <div className="relative">
                            <input
                                id="auth-password"
                                className={inputClass(!!errors.password) + ' pr-16'}
                                type={showPassword ? 'text' : 'password'}
                                autoComplete={isSignup ? 'new-password' : 'current-password'}
                                placeholder="••••••••"
                                aria-invalid={!!errors.password}
                                aria-describedby={errors.password ? 'auth-password-error' : (isSignup ? 'auth-password-hint' : undefined)}
                                value={password}
                                onChange={e => { setPassword(e.target.value); if (errors.password) setErrors(prev => ({ ...prev, password: '' })); }}
                            />
                            <button type="button" onClick={() => setShowPassword(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black uppercase tracking-wider text-gray-400 hover:text-blue-500 transition">
                                {showPassword ? (t('actions.hide') || 'Hide') : (t('actions.show') || 'Show')}
                            </button>
                        </div>
                        {errors.password && <p id="auth-password-error" className="mt-1.5 text-[11px] font-semibold text-red-500">{errors.password}</p>}
                        {isSignup && (
                            <ul id="auth-password-hint" className="mt-2 space-y-1">
                                {[
                                    { ok: passwordRules.length, label: t('labels.password_rule_length', { min: window.PASSWORD_MIN_LENGTH }) || `At least ${window.PASSWORD_MIN_LENGTH} characters` },
                                    { ok: passwordRules.symbol, label: t('labels.password_rule_symbol') || 'At least one symbol (! ? @ # …)' }
                                ].map(rule => (
                                    <li key={rule.label} className={`flex items-center gap-1.5 text-[11px] ${rule.ok ? 'text-green-600' : (errors.password ? 'text-red-500' : 'text-gray-400')}`}>
                                        <span className="w-3 text-center font-black">{rule.ok ? '✓' : '•'}</span>
                                        {rule.label}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    <button type="submit" disabled={busy} className="w-full py-3.5 bg-blue-500 text-white rounded-xl text-xs font-black shadow-lg shadow-blue-100 active:scale-95 transition tracking-widest uppercase disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100">
                        {busy ? (t('actions.please_wait') || 'Please wait…') : (isSignup ? (t('actions.create_account') || 'Create Account') : t('actions.login'))}
                    </button>
                </form>

                <p className="mt-6 text-center text-[11px] text-gray-500">
                    {isSignup ? (t('labels.have_account') || 'Already have an account?') : (t('labels.no_account') || 'New here?')}{' '}
                    <button onClick={() => switchMode(isSignup ? 'login' : 'signup')} className="font-black text-blue-500 hover:text-blue-600 underline underline-offset-2">
                        {isSignup ? t('actions.login') : (t('actions.create_account') || 'Create Account')}
                    </button>
                </p>
            </div>
        </div>
    );
};

// --- AI Assistant Service ---
// Calls go through the server proxy (POST /api/ai/generate). The provider API
// key lives only on the server and is never exposed to the browser.
window.AIService = {
    async call(messages, config, tools = []) {
        const response = await fetch('/api/ai/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages, tools })
        });
        if (!response.ok) {
            let msg = response.statusText;
            try { msg = (await response.json()).error || msg; } catch (e) { /* ignore */ }
            throw new Error(`AI Service Error: ${msg}`);
        }
        return await response.json();
    }
};

class ErrorBoundary extends React.Component {
    constructor(props) { super(props); this.state = { hasError: false, error: null }; }
    static getDerivedStateFromError(error) { return { hasError: true, error }; }
    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen flex items-center justify-center bg-red-50 p-10">
                    <div className="max-w-xl bg-white p-12 rounded-[3rem] shadow-2xl border border-red-100">
                        <h1 className="text-2xl font-black text-red-600 mb-4">Component Crash Detected</h1>
                        <pre className="bg-gray-50 p-6 rounded-2xl text-xs overflow-auto max-h-96 text-red-400 font-mono">
                            {this.state.error?.stack || this.state.error?.message}
                        </pre>
                        <button onClick={() => window.location.reload()} className="mt-8 px-8 py-3 bg-red-600 text-white rounded-full text-[10px] font-black uppercase tracking-widest">Restart Application</button>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}

const React = window.React;

// PublicDocsView (GitBook) and PublicApiView (Postman) live in their own
// component files — see client/src/components/PublicDocsView.jsx and
// client/src/components/PublicApiView.jsx.

window.Main = () => {
    const [user, setUser] = React.useState(() => window.safeParse('nt_user', null));
    const [lang, setLang] = React.useState(() => localStorage.getItem('nt_lang') || 'en');
    const [translations, setTranslations] = React.useState({});
    const [ws, setWs] = React.useState(null);
    // Profile and My Tasks are full pages, so they get real URLs rather than
    // living only in state — a refresh on either used to drop the user on the hub.
    // Seeded from the address bar so that reload lands where it left off; the SPA
    // fallbacks for both paths are in server/index.js.
    const [showProfile, setShowProfile] = React.useState(() => window.location.pathname === '/profile');
    const [pendingCardId, setPendingCardId] = React.useState(null);
    const [pendingMyTasks, setPendingMyTasks] = React.useState(() => window.location.pathname === '/my-tasks');
    const [theme, setTheme] = React.useState(() => localStorage.getItem('nt_theme') || 'default');
    const [player, setPlayer] = React.useState({ url: '', isMinimized: true });
    const [toasts, setToasts] = React.useState([]);
    const [modalState, setModalState] = React.useState({ isOpen: false, type: 'alert', title: '', message: '', callback: null, promptValue: '', isPassword: false });

    React.useEffect(() => { localStorage.setItem('nt_user', JSON.stringify(user)); }, [user]);
    React.useEffect(() => { localStorage.setItem('nt_theme', theme); }, [theme]);
    React.useEffect(() => { localStorage.setItem('nt_lang', lang); }, [lang]);

    // Identity reconciliation: the localStorage `nt_user` blob is only a display
    // cache and is user-editable, so it must never be trusted for *who you are*.
    // On load, the signed JWT is authoritative — ask the server who the token
    // belongs to and overwrite local state with that. No/invalid token => log out.
    React.useEffect(() => {
        const token = localStorage.getItem('nt_token');
        if (!token) {
            localStorage.removeItem('nt_user');
            setUser(null);
            return;
        }
        fetch('/api/me')
            .then(r => { if (!r.ok) throw new Error('unauthenticated'); return r.json(); })
            .then(fresh => setUser(fresh))
            .catch(() => {
                localStorage.removeItem('nt_token');
                localStorage.removeItem('nt_user');
                setUser(null);
            });
    }, []);

    React.useEffect(() => {
        if (!window.NT_FALLBACK_EN) {
            fetch('/src/locales/en.json').then(r => r.json()).then(data => { window.NT_FALLBACK_EN = data; }).catch(console.error);
        }
    }, []);

    React.useEffect(() => {
        fetch(`/src/locales/${lang}.json`)
            .then(r => r.json())
            .then(data => setTranslations(data))
            .catch(err => {
                console.error('Failed to load translations:', err);
                if (lang !== 'en') {
                    fetch('/src/locales/en.json').then(r => r.json()).then(setTranslations).catch(console.error);
                }
            });
    }, [lang]);

    // Media is served from this origin under /media/, so there is no media host
    // to discover at runtime — getImageUrl builds the URL synchronously and the
    // app no longer has to wait on /api/config before rendering an <img>.

    const t = React.useCallback((key, params = {}) => {
        const keys = key.split('.');
        let val = translations;
        for (let k of keys) {
            if (!val || typeof val !== 'object') break;
            val = val[k];
        }
        if (typeof val !== 'string') {
            const fallbackVal = window.NT_FALLBACK_EN && key.split('.').reduce((acc, k) => (acc && typeof acc === 'object' ? acc[k] : undefined), window.NT_FALLBACK_EN);
            if (typeof fallbackVal === 'string') {
                let fbResult = fallbackVal;
                Object.keys(params).forEach(pK => {
                    fbResult = fbResult.replace(`{${pK}}`, params[pK]);
                });
                return fbResult;
            }
            return null; // Return null to allow code-side fallbacks (e.g. || 'Default')
        }
        
        let result = val;
        Object.keys(params).forEach(pK => {
            result = result.replaceAll(`{${pK}}`, params[pK]);
        });
        return result;
    }, [translations]);

    const showToast = (message, type = 'info') => { const id = window.generateId('tst'); setToasts(prev => [...prev, { id, message, type }]); };
    const removeToast = (id) => setToasts(prev => prev.filter(t => t.id !== id));

    const setUrl = (newUrl) => {
        setPlayer(prev => ({ ...prev, url: newUrl }));
        if (newUrl) showToast(t('alerts.audio_synced') || 'Audio stream synchronized. 🎵');
    };

    const showAlert = (message, title = t('labels.system_log') || 'System Log') => setModalState({ isOpen: true, type: 'alert', title, message, callback: null });
    const showConfirm = (title, message, callback) => setModalState({ isOpen: true, type: 'confirm', title, message, callback });
    const showPrompt = (title, message, callback, isPassword = false) => {
        setModalState({ isOpen: true, type: 'prompt', title, message, callback, promptValue: '', isPassword });
    };

    const path = window.location.pathname;
    const isWorkspaceUrl = path.startsWith('/workspace/');
    const urlWsSlug = isWorkspaceUrl ? path.split('/')[2] : null;
    // A pasted /workspace/<slug>/card/<id> link resolves its board through the Hub,
    // which then re-pushes the plain board path — so the card id has to be carried
    // separately or it is lost before the board ever mounts.
    const urlCardId = (() => {
        if (!isWorkspaceUrl) return null;
        const parts = path.split('/');
        return parts[3] === 'card' && parts[4] ? decodeURIComponent(parts[4]) : null;
    })();
    // The two public surfaces. `/apis/` and not `/api/` — the Express API router
    // owns `/api/*` on the server and would never let these reach the client.
    const isPublicDocs = path.startsWith('/docs/');
    const isPublicApis = path.startsWith('/apis/');
    let publicWsPath = '';
    let publicFolderName = '';

    if (isPublicDocs || isPublicApis) {
        const parts = path.split('/');
        publicWsPath = parts[2];
        publicFolderName = parts[3];
    }

    // Logging out from inside a board leaves the browser at /workspace/<slug>.
    // The next person to sign in on this browser would otherwise be deep-linked
    // straight into that board instead of landing on the hub.
    const resetUrlToHome = () => {
        if (window.location.pathname !== '/') window.history.replaceState({}, '', '/');
    };

    const openProfile = () => {
        if (window.location.pathname !== '/profile') window.history.pushState({}, '', '/profile');
        setShowProfile(true);
    };

    // Profile can be opened from the hub or from inside a board. Leaving it goes
    // back to whichever the app still holds — after a reload straight onto
    // /profile that is the hub, because no board was ever mounted.
    const closeProfile = () => {
        if (window.location.pathname === '/profile') {
            const wsRoute = ws ? '/workspace/' + (ws.slug || ws.id || ws._id) : '/';
            window.history.pushState({}, '', wsRoute);
        }
        setShowProfile(false);
    };

    // Back/forward has to agree with the two paths above, or the buttons move the
    // address bar while the screen stays put.
    React.useEffect(() => {
        const syncProfileFromUrl = () => setShowProfile(window.location.pathname === '/profile');
        window.addEventListener('popstate', syncProfileFromUrl);
        return () => window.removeEventListener('popstate', syncProfileFromUrl);
    }, []);

    const selectWorkspace = (selectedWs, cardId) => {
        const wsRoute = '/workspace/' + (selectedWs.slug || selectedWs.id || selectedWs._id);
        // Skip the push when the browser is already somewhere under this board — a
        // pasted /card/<id> link would otherwise get a duplicate history entry, and
        // the board would then rewrite the path back to the card it came from.
        if (!(window.location.pathname === wsRoute || window.location.pathname.startsWith(wsRoute + '/'))) {
            window.history.pushState({}, '', wsRoute);
        }
        setPendingCardId(cardId || null);
        setWs(selectedWs);
    };

    // Opens a card link found in user text (a comment body, a card description) without
    // leaving the app. Registered on `window` because the anchors live inside deeply
    // nested components and, for the description, inside injected HTML.
    //
    // Cross-board links reuse the pasted-link route rather than resolving the board here:
    // dropping to the Hub lets its existing slug lookup — which also enforces membership —
    // do the work, so a link to a board you are not on cannot open it.
    React.useEffect(() => {
        window.NTNavigateToCard = (target) => {
            const { path, workspaceSlug } = target || {};
            if (!path) return;
            const go = () => {
                if (window.location.pathname !== path) window.history.pushState({}, '', path);
                const currentSlug = ws ? String(ws.slug || ws.id || ws._id) : null;
                if (currentSlug && currentSlug === String(workspaceSlug)) {
                    // Same board: the view already watches popstate for the card id, so
                    // this swaps the open card without tearing the board down.
                    window.dispatchEvent(new PopStateEvent('popstate'));
                    return;
                }
                setPendingCardId(null);
                setWs(null);
            };
            // An open card modal with unsaved edits gets to confirm first — following the
            // link would otherwise discard the draft with no warning, unlike every other
            // way of leaving a card.
            const confirmLeave = window.NTConfirmLeaveCard;
            if (typeof confirmLeave === 'function') return confirmLeave(target, go);
            go();
        };
        return () => { delete window.NTNavigateToCard; };
    }, [ws]);

    return (
        <ErrorBoundary>
        <window.TranslationContext.Provider value={{ lang, setLang, t }}>
        <window.ModalContext.Provider value={{ showAlert, showConfirm, showPrompt }}>
            <window.JukeboxContext.Provider value={{ ...player, setUrl, setMinimized: (m) => setPlayer(prev => ({...prev, isMinimized: m})) }}>
                <window.ToastContext.Provider value={{ showToast }}>
                {isPublicDocs ? <window.PublicDocsView wsPath={publicWsPath} folderName={publicFolderName} /> :
                isPublicApis ? <window.PublicApiView wsPath={publicWsPath} folderName={publicFolderName} /> :
                !user ? <window.AuthScreen onAuthSuccess={setUser} /> :
                showProfile ? <window.ProfilePage user={user} onBack={closeProfile} onUpdateUser={setUser} theme={theme} /> :
                 !ws ? <window.WorkspaceHub user={user} onLogout={() => { localStorage.removeItem('nt_token'); resetUrlToHome(); setShowProfile(false); setUser(null); showToast("Session ended. 👋"); }} onSelect={selectWorkspace} onThemeChange={setTheme} theme={theme} onUpdateUser={setUser} onOpenProfile={openProfile} urlWsSlug={urlWsSlug} urlCardId={urlCardId} openMyTasks={pendingMyTasks} onConsumeMyTasks={() => setPendingMyTasks(false)} /> :
                 <window.WorkspaceView workspace={ws} initialCardId={pendingCardId} onOpenMyTasks={() => { window.history.pushState({}, '', '/my-tasks'); setPendingCardId(null); setPendingMyTasks(true); setWs(null); }} onBack={() => { window.history.pushState({}, '', '/'); setPendingCardId(null); setWs(null); }} user={user} onLogout={() => { localStorage.removeItem('nt_token'); resetUrlToHome(); setShowProfile(false); setWs(null); setPendingCardId(null); setUser(null); showToast(t('alerts.session_ended') || "Session ended. 👋"); }} onThemeChange={setTheme} theme={theme} onUpdateUser={setUser} onOpenProfile={openProfile} isJukeboxActive={!!player.url && !player.isMinimized} />}
                <window.FloatingJukebox />
                <div className="toast-container">{toasts.map(t => <window.Toast key={t.id} message={t.message} type={t.type} onRemove={() => removeToast(t.id)} />)}</div>
                {modalState.isOpen && (
                    
                    <window.GlobalModal isOpen={true} onClose={() => setModalState(prev => ({...prev, isOpen: false}))} title={modalState.title} footer={
                        <div className="flex gap-2">
                            {modalState.type !== 'alert' && <button onClick={() => setModalState(prev => ({...prev, isOpen: false}))} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-bold transition">{t('actions.cancel')}</button>}
                            <button onClick={() => {
                                setModalState(prev => ({...prev, isOpen: false}));
                                if (modalState.callback) {
                                    if (modalState.type === 'prompt') modalState.callback(modalState.promptValue);
                                    else modalState.callback();
                                }
                            }} className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-xs font-bold transition shadow-md shadow-blue-100">
                                {modalState.type === 'alert' ? t('actions.ok') : t('actions.confirm')}
                            </button>
                        </div>
                    }>
                        <p>{modalState.message}</p>
                        {modalState.type === 'prompt' && (
                            <input 
                                autoFocus 
                                type={modalState.isPassword ? "password" : "text"} 
                                value={modalState.promptValue} 
                                onChange={e => setModalState(prev => ({...prev, promptValue: e.target.value}))} 
                                className="w-full mt-4 p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-none focus:ring-1 focus:ring-blue-400" 
                                onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                        setModalState(prev => ({...prev, isOpen: false}));
                                        if (modalState.callback) modalState.callback(modalState.promptValue);
                                    }
                                }}
                            />
                        )}
                    </window.GlobalModal>
                )}
                </window.ToastContext.Provider>
            </window.JukeboxContext.Provider>
        </window.ModalContext.Provider>
        </window.TranslationContext.Provider>
        </ErrorBoundary>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<window.Main />);
