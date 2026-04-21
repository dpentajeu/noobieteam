window.AuthScreen = ({ onAuthSuccess }) => {
    const { showAlert } = window.useModals();
    const { showToast } = window.useToasts();
    const { t } = window.useTranslation ? window.useTranslation() : { t: k => k };
    const [mode, setMode] = React.useState('login');
    const [email, setEmail] = React.useState('');
    const [password, setPassword] = React.useState('');

    const validateEmail = (email) => {
        return String(email).toLowerCase().match(/^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/);
    };

    const handleLogin = async (email, password) => {
        try {
            const res = await fetch('/api/auth/login', { 
                method: 'POST', 
                headers: {'Content-Type':'application/json'}, 
                body: JSON.stringify({ email, password }) 
            });
            if (!res.ok) throw new Error('Unauthorized: Credentials mismatch.');
            const user = await res.json();
            onAuthSuccess(user);
            showToast(`Welcome back, ${user.name || email.split('@')[0]}! 🚀`);
        } catch (e) {
            showAlert(e.message, 'Access Denied');
        }
    };

    const handleGoogleResponse = async (response) => {
        try {
            const res = await fetch('/api/auth/google', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ credential: response.credential }) });
            if (!res.ok) throw new Error('Google authentication failed on server.');
            const user = await res.json();
            onAuthSuccess(user);
            showToast(`Welcome back, ${user.name || user.email.split('@')[0]}! 🚀`);
        } catch (e) {
            showAlert(e.message, 'Google Sign-In Error');
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!validateEmail(email)) return showAlert('Please enter a valid email address.', 'Invalid Email');
        if (password.length < 4) return showAlert('Password must be at least 4 characters.', 'Weak Security');

        if (mode === 'signup') {
            try {
                const res = await fetch('/api/users', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ email, password, name: email.split('@')[0] }) });
                if (!res.ok) return showAlert('This user is already registered.', 'Duplicate User');
                setMode('login');
                showAlert('User profile registered. Please login.', 'Signup Sync');
            } catch(e) { showAlert(e.message, 'Error'); }
        } else {
            handleLogin(email, password);
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
                        { theme: 'outline', size: 'large', text: 'continue_with', width: '240' }
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

    return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50 animate-fade-in text-black">
            <div className="max-w-[320px] w-full bg-white p-10 rounded-[2.5rem] shadow-2xl text-center border border-gray-100">
                <h1 className="text-3xl font-black italic tracking-tighter mb-8">Noobieteam</h1>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <input className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-none focus:ring-1 focus:ring-blue-400" type="email" placeholder="Email" required value={email} onChange={e => setEmail(e.target.value)} />
                    <input className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-none focus:ring-1 focus:ring-blue-400" type="password" placeholder="Password" required value={password} onChange={e => setPassword(e.target.value)} />
                    <button className="w-full py-3 bg-blue-500 text-white rounded-xl text-xs font-black shadow-lg shadow-blue-100 active:scale-95 transition tracking-widest uppercase">{mode === 'login' ? 'Login' : 'Sign Up'}</button>
                    <div className="relative py-2">
                        <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-gray-200"></span></div>
                        <div className="relative flex justify-center text-[9px] uppercase font-black text-gray-400"><span className="bg-white px-3">OR</span></div>
                    </div>
                    <div id="google-signin-btn" className="flex justify-center w-full mt-2 overflow-hidden rounded-xl h-12"></div>
                    {/* Fallback button just in case Google renderButton fails, or to explicitly trigger the prompt */}
                    <button type="button" id="custom-google-btn" onClick={() => window.google?.accounts.id.prompt()} className="hidden w-full flex items-center justify-center gap-3 py-3 bg-white border border-gray-300 rounded-xl text-gray-700 text-xs font-bold hover:bg-gray-50 hover:shadow-md transition active:scale-95">
                        <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                        Sign in with Google
                    </button>
                </form>
                <button onClick={() => setMode(mode === 'login' ? 'signup' : 'login')} className="mt-8 text-blue-500 text-[9px] font-black uppercase tracking-[0.2em]">{mode === 'login' ? "New User? Sign Up" : "Back to Terminal"}</button>
            </div>
        </div>
    );
};

// --- AI Assistant Service ---
window.AIService = {
    async call(messages, config, tools = []) {
        const { model, apiKey, baseUrl } = config;
        if (!apiKey) throw new Error("API Key required. Set in AI Settings.");
        
        const sanitizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
        
        if (sanitizedBaseUrl.includes('generativelanguage.googleapis.com')) {
            const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
            let systemInstruction = null;
            const contents = [];
            for (const m of messages) {
                if (m.role === 'system') {
                    systemInstruction = { parts: [{ text: m.content }] };
                } else if (m.role === 'user') {
                    contents.push({ role: 'user', parts: [{ text: m.content }] });
                } else if (m.role === 'assistant') {
                    let parts = [];
                    if (m.content) parts.push({ text: m.content });
                    if (m.tool_calls) {
                        m.tool_calls.forEach(tc => {
                            const part = { functionCall: { name: tc.function.name, args: JSON.parse(tc.function.arguments) } };
                            // Inject both cases to ensure compatibility across different SDK versions/proxies
                            if (tc.thought_signature) {
                                part.thoughtSignature = tc.thought_signature;
                                part.thought_signature = tc.thought_signature;
                            }
                            parts.push(part);
                        });
                    }
                    if (parts.length > 0) contents.push({ role: 'model', parts });
                } else if (m.role === 'tool') {
                    // Gemini functionResponse can include the id if provided by the model
                    contents.push({ 
                        role: 'function', 
                        parts: [{ 
                            functionResponse: { 
                                name: m.name || 'tool', 
                                response: { result: m.content }
                            } 
                        }] 
                    });
                }
            }

            // Gemini SDK requires alternating 'user' / 'model' roles for history. 
            // 'function' must follow 'model'. If there are multiple function responses, Gemini groups them or expects them sequentially.
            // Let's collapse sequential roles if needed, though the SDK usually handles it.
            
            const geminiTools = tools.length > 0 ? [{ functionDeclarations: tools.map(t => ({ name: t.function.name, description: t.function.description, parameters: t.function.parameters })) }] : undefined;
            const payload = { contents };
            if (systemInstruction) payload.systemInstruction = systemInstruction;
            if (geminiTools) payload.tools = geminiTools;
            
            const response = await fetch(geminiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            if (!response.ok) throw new Error(`AI Service Error: ${await response.text()}`);
            const data = await response.json();
            
            const parts = data.candidates[0].content.parts;
            const toolCalls = parts.filter(p => p.functionCall).map((p, i) => ({ 
                id: p.functionCall.id || `call_${i}`, 
                function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args) }, 
                thought_signature: p.thoughtSignature || p.thought_signature || null 
            }));
            
            if (toolCalls.length > 0) return { choices: [{ message: { role: 'assistant', content: null, tool_calls: toolCalls } }] };
            return { choices: [{ message: { role: 'assistant', content: parts[0].text } }] };
        } else {
            // Standard OpenAI API
            let finalUrl = `${sanitizedBaseUrl}/chat/completions`;
            const headers = { 'Content-Type': 'application/json' };
            
            if (finalUrl.includes('?key=')) {
                // If user accidentally put the API key in the URL query string, do NOT send Bearer token to avoid 'Multiple authentication credentials' error
            } else {
                headers['Authorization'] = `Bearer ${apiKey}`;
            }

            const response = await fetch(finalUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify({ model, messages, tools: tools.length > 0 ? tools : undefined })
            });
            if (!response.ok) throw new Error(`AI Service Error: ${response.statusText || await response.text()}`);
            return await response.json();
        }
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

window.PublicDocsView = ({ wsPath, folderName }) => {
    const { t } = window.useTranslation ? window.useTranslation() : { t: k => k };
    const [docs, setDocs] = React.useState([]);
    const [folder, setFolder] = React.useState(null);
    const [workspace, setWorkspace] = React.useState(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState(null);
    const [testResponse, setTestResponse] = React.useState(null);
    const [testLoading, setTestLoading] = React.useState(false);
    const [showTestPanel, setShowTestPanel] = React.useState(false);
    const [showMobileSidebar, setShowMobileSidebar] = React.useState(false);
    
    const handleTestApi = async (spec) => {
        setTestLoading(true);
        setTestResponse(null);
        try {
            let url = spec.url;
            if (spec.queryParams && spec.queryParams.length > 0) {
                const params = new URLSearchParams();
                spec.queryParams.forEach(q => { if(q.key) params.append(q.key, q.value); });
                url += '?' + params.toString();
            }
            const headers = {};
            if (spec.headers) {
                spec.headers.forEach(h => { if(h.key) headers[h.key] = h.value; });
            }
            if (!headers['Content-Type'] && spec.method !== 'GET') {
                headers['Content-Type'] = 'application/json';
            }
            
            const start = Date.now();
            const res = await fetch(url, {
                method: spec.method,
                headers,
                body: spec.method !== 'GET' && spec.body ? spec.body : undefined
            });
            const time = Date.now() - start;
            
            let data;
            try { data = await res.json(); } catch(e) { data = await res.text(); }
            
            setTestResponse({ status: res.status, time, data });
        } catch (err) {
            setTestResponse({ status: 'ERROR', time: 0, data: err.message });
        } finally {
            setTestLoading(false);
        }
    };
    const [selectedDocId, setSelectedDocId] = React.useState(null);

    React.useEffect(() => {
        if (!wsPath || !folderName) {
            setError("Invalid documentation URL format.");
            setLoading(false);
            return;
        }

        fetch(`/api/public/docs/${wsPath}/${folderName}`)
            .then(r => {
                if (!r.ok) throw new Error("Documentation not found or access denied.");
                return r.json();
            })
            .then(data => {
                setWorkspace(data.workspace);
                setFolder(data.folder);
                setDocs(data.docs);
                if (data.docs && data.docs.length > 0) {
                    setSelectedDocId(data.docs[0].id || data.docs[0]._id);
                }
            })
            .catch(err => setError(err.message))
            .finally(() => setLoading(false));
    }, [wsPath, folderName]);

    if (loading) return <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500 font-bold">Loading API Documentation...</div>;
    if (error) return <div className="min-h-screen flex items-center justify-center bg-red-50 text-red-500 font-black">{error}</div>;

    const activeDoc = docs.find(d => (d.id === selectedDocId || d._id === selectedDocId));

    return (
        <div className="min-h-screen bg-white flex text-black font-sans">
            {/* Sidebar */}
            <div className={`${showMobileSidebar ? 'fixed inset-0 z-50 flex w-full' : 'hidden'} md:flex md:w-72 bg-gray-50 border-r border-gray-100 flex-col h-screen md:sticky top-0`}>
                <div className="p-6 md:p-8 border-b border-gray-200 flex justify-between items-start">
                    <div>
                    <h1 className="text-xl font-black tracking-tighter mb-2">{workspace?.name || 'Workspace'}</h1>
                    <div className="flex items-center gap-2 text-gray-500">
                        <window.Icon name="folder" size={14} />
                        <span className="text-xs font-bold uppercase tracking-widest">{folder?.name || 'Documentation'}</span>
                    </div>
                    </div>
                    {showMobileSidebar && (
                        <button onClick={() => setShowMobileSidebar(false)} className="md:hidden p-2 text-gray-500 hover:bg-gray-200 rounded-lg">
                            <window.Icon name="x" size={20} />
                        </button>
                    )}
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-1">
                    {docs.map(doc => {
                        const docId = doc.id || doc._id;
                        return (
                            <div key={docId} onClick={() => { setSelectedDocId(docId); setShowMobileSidebar(false); }} className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition ${selectedDocId === docId ? 'bg-white shadow-sm text-blue-600 font-bold border border-gray-200' : 'hover:bg-gray-100 text-gray-600 font-medium border border-transparent'}`}>
                                {doc.type === 'API' ? (
                                    <span className={`text-[9px] font-black w-10 text-center rounded px-1 py-0.5 ${doc.apiSpec?.method === 'POST' ? 'bg-emerald-100 text-emerald-700' : doc.apiSpec?.method === 'GET' ? 'bg-blue-100 text-blue-700' : doc.apiSpec?.method === 'PUT' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>{doc.apiSpec?.method}</span>
                                ) : (
                                    <window.Icon name="file-text" size={16} className={selectedDocId === docId ? 'text-blue-500' : 'text-gray-400'} />
                                )}
                                <span className="text-sm truncate">{doc.title || 'Untitled'}</span>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 flex flex-col h-screen overflow-hidden">
                <header className="h-16 border-b border-gray-100 flex items-center px-4 md:px-10 bg-white gap-4">
                    <button onClick={() => setShowMobileSidebar(true)} className="md:hidden p-2 text-gray-500 hover:bg-gray-100 rounded-lg">
                        <window.Icon name="menu" size={20} />
                    </button>
                    <h2 className="text-lg font-black tracking-tight">{activeDoc ? activeDoc.title : 'Select a document'}</h2>
                </header>
                <div className="flex-1 overflow-y-auto p-4 md:p-10 bg-white">
                    {activeDoc ? (
                        activeDoc.type === 'API' ? (
                            <div className="max-w-4xl mx-auto animate-fade-in">
                            <div className="space-y-8">
                                <div className="flex items-center gap-4 p-4 bg-gray-50 border border-gray-200 rounded-2xl">
                                    <span className={`font-black px-3 py-1 rounded-lg text-xs ${activeDoc.apiSpec?.method === 'POST' ? 'bg-emerald-100 text-emerald-700' : activeDoc.apiSpec?.method === 'GET' ? 'bg-blue-100 text-blue-700' : activeDoc.apiSpec?.method === 'PUT' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>{activeDoc.apiSpec?.method}</span>
                                    <code className="text-sm font-bold text-gray-800">{activeDoc.apiSpec?.url || 'No URL specified'}</code>
                                </div>
                                {activeDoc.content && (
                                    <div className="prose max-w-none text-sm" dangerouslySetInnerHTML={{__html: activeDoc.content}}></div>
                                )}
                                {activeDoc.apiSpec?.headers?.length > 0 && (
                                    <div>
                                        <h3 className="text-sm font-black uppercase tracking-widest text-gray-400 mb-4">Headers</h3>
                                        <table className="w-full text-left text-sm border-collapse">
                                            <thead><tr className="border-b-2 border-gray-100"><th className="pb-2 font-bold w-1/3">Key</th><th className="pb-2 font-bold">Value</th></tr></thead>
                                            <tbody>
                                                {activeDoc.apiSpec.headers.map((h, i) => (
                                                    <tr key={i} className="border-b border-gray-50"><td className="py-3 font-mono text-gray-600">{h.key}</td><td className="py-3 font-mono text-gray-800">{h.value}</td></tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                                {activeDoc.apiSpec?.queryParams?.length > 0 && (
                                    <div>
                                        <h3 className="text-sm font-black uppercase tracking-widest text-gray-400 mb-4">Query Parameters</h3>
                                        <table className="w-full text-left text-sm border-collapse">
                                            <thead><tr className="border-b-2 border-gray-100"><th className="pb-2 font-bold w-1/3">Key</th><th className="pb-2 font-bold">Value</th></tr></thead>
                                            <tbody>
                                                {activeDoc.apiSpec.queryParams.map((q, i) => (
                                                    <tr key={i} className="border-b border-gray-50"><td className="py-3 font-mono text-gray-600">{q.key}</td><td className="py-3 font-mono text-gray-800">{q.value}</td></tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                                {activeDoc.apiSpec?.body && (
                                    <div>
                                        <h3 className="text-sm font-black uppercase tracking-widest text-gray-400 mb-4">Request Body</h3>
                                        <pre className="p-4 bg-gray-900 text-gray-100 rounded-2xl text-xs overflow-x-auto font-mono"><code>{activeDoc.apiSpec.body}</code></pre>
                                    </div>
                                )}
                            
                                <div className="mt-12 pt-8 border-t border-gray-100">
                                    <div className="flex justify-between items-center mb-6">
                                        <h3 className="text-sm font-black uppercase tracking-widest text-black">{t('labels.live_api_test') || 'Live API Test'}</h3>
                                        <button onClick={() => { setShowTestPanel(true); handleTestApi(activeDoc.apiSpec); }} disabled={testLoading} className="px-6 py-3 bg-black text-white rounded-xl text-xs font-bold uppercase tracking-widest hover:scale-105 active:scale-95 transition disabled:opacity-50">
                                            {testLoading ? t('actions.sending') : t('actions.send_request')}
                                        </button>
                                    </div>
                                    
                                    {showTestPanel && testResponse && (
                                        <div className="bg-gray-50 border border-gray-200 rounded-2xl overflow-hidden animate-fade-in">
                                            <div className="bg-gray-100 border-b border-gray-200 px-6 py-3 flex gap-6 text-xs font-bold uppercase tracking-widest text-gray-500">
                                                <span className={testResponse.status === 200 || testResponse.status === 201 ? 'text-emerald-600' : 'text-red-600'}>{t('labels.status') || 'Status'}: {testResponse.status}</span>
                                                <span>{t('labels.time') || 'Time'}: {testResponse.time}ms</span>
                                            </div>
                                            <pre className="p-6 text-xs text-gray-800 overflow-x-auto font-mono">
                                                {typeof testResponse.data === 'object' ? JSON.stringify(testResponse.data, null, 2) : testResponse.data}
                                            </pre>
                                        </div>
                                    )}
                                </div>
                            </div>
                            </div>
                        ) : (
                            <div className="max-w-4xl mx-auto">
                                <div className="ql-editor prose max-w-none" dangerouslySetInnerHTML={{__html: activeDoc.content}}></div>
                            </div>
                        )
                    ) : (
                        <div className="text-center py-20 text-gray-400 text-sm font-bold">No content available.</div>
                    )}
                </div>
            </div>
        </div>
    );
};

window.Main = () => {
    const [user, setUser] = React.useState(() => window.safeParse('nt_user', null));
    const [lang, setLang] = React.useState(() => localStorage.getItem('nt_lang') || 'en');
    const [translations, setTranslations] = React.useState({});
    const [ws, setWs] = React.useState(null);
    const [theme, setTheme] = React.useState(() => localStorage.getItem('nt_theme') || 'default');
    const [player, setPlayer] = React.useState({ url: '', isMinimized: true });
    const [toasts, setToasts] = React.useState([]);
    const [modalState, setModalState] = React.useState({ isOpen: false, type: 'alert', title: '', message: '', callback: null, promptValue: '', isPassword: false });

    React.useEffect(() => { localStorage.setItem('nt_user', JSON.stringify(user)); }, [user]);
    React.useEffect(() => { localStorage.setItem('nt_theme', theme); }, [theme]);
    React.useEffect(() => { localStorage.setItem('nt_lang', lang); }, [lang]);

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

    const t = React.useCallback((key) => {
        const keys = key.split('.');
        let val = translations;
        for (let k of keys) {
            if (!val || typeof val !== 'object') return key;
            val = val[k];
        }
        return val || key;
    }, [translations]);

    const showToast = (message) => { const id = window.generateId('tst'); setToasts(prev => [...prev, { id, message }]); };
    const removeToast = (id) => setToasts(prev => prev.filter(t => t.id !== id));

    const setUrl = (newUrl) => {
        setPlayer(prev => ({ ...prev, url: newUrl }));
        if (newUrl) showToast('Audio stream synchronized. 🎵');
    };

    const showAlert = (message, title = 'System Log') => setModalState({ isOpen: true, type: 'alert', title, message, callback: null });
    const showConfirm = (title, message, callback) => setModalState({ isOpen: true, type: 'confirm', title, message, callback });
    const showPrompt = (title, message, callback, isPassword = false) => {
        console.log('DEBUG: showPrompt called', { title, message });
        setModalState({ isOpen: true, type: 'prompt', title, message, callback, promptValue: '', isPassword });
    };

    const path = window.location.pathname;
    const isPublicDocs = path.startsWith('/docs/');
    let publicWsPath = '';
    let publicFolderName = '';
    
    if (isPublicDocs) {
        const parts = path.split('/');
        publicWsPath = parts[2];
        publicFolderName = parts[3];
    }
    
    return (
        <ErrorBoundary>
        <window.TranslationContext.Provider value={{ lang, setLang, t }}>
        <window.ModalContext.Provider value={{ showAlert, showConfirm, showPrompt }}>
            <window.JukeboxContext.Provider value={{ ...player, setUrl, setMinimized: (m) => setPlayer(prev => ({...prev, isMinimized: m})) }}>
                <window.ToastContext.Provider value={{ showToast }}>
                {isPublicDocs ? <window.PublicDocsView wsPath={publicWsPath} folderName={publicFolderName} /> :
                !user ? <window.AuthScreen onAuthSuccess={setUser} /> :
                 !ws ? <window.WorkspaceHub user={user} onLogout={() => { setUser(null); showToast("Session ended. 👋"); }} onSelect={setWs} onThemeChange={setTheme} theme={theme} onUpdateUser={setUser} /> :
                 <window.WorkspaceView workspace={ws} onBack={() => setWs(null)} user={user} onLogout={() => { setWs(null); setUser(null); showToast("Session ended. 👋"); }} onThemeChange={setTheme} theme={theme} onUpdateUser={setUser} isJukeboxActive={!!player.url && !player.isMinimized} />}
                <window.FloatingJukebox />
                <div className="toast-container">{toasts.map(t => <window.Toast key={t.id} message={t.message} onRemove={() => removeToast(t.id)} />)}</div>
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
