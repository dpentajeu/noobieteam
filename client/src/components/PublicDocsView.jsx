const React = window.React;

// The public, read-only reading surface behind both share links:
//
//   /docs/:workspace/:folder  — the GitBook-style documentation site
//   /apis/:workspace/:folder  — the Postman-style API reference
//
// One component, because the two surfaces differ in *identity*, not layout: a
// published API reference needs its own URL and must not be reachable through a
// docs link, but a text page and an endpoint page render the same either way.
// The `kind` prop picks which public endpoint to read and which URL to build
// share links against; the server refuses to serve a collection through the
// wrong one.
//
// Same typography, code copy buttons, and table rendering as the in-app pages,
// with every editing affordance stripped out. Scoped to one root folder and its
// subfolders, so a published link never exposes the rest of the workspace.
window.PublicCollectionView = ({ wsPath, folderName, kind = 'DOCS' }) => {
    const surface = kind === 'API' ? 'apis' : 'docs';
    const { t } = window.useTranslation ? window.useTranslation() : { t: k => k };
    const { showToast } = window.useToasts ? window.useToasts() : { showToast: () => {} };

    const [workspace, setWorkspace] = React.useState(null);
    const [folder, setFolder] = React.useState(null);
    const [subfolders, setSubfolders] = React.useState([]);
    const [docs, setDocs] = React.useState([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState(null);

    const [selectedDocId, setSelectedDocId] = React.useState(null);
    const [selectedFolderId, setSelectedFolderId] = React.useState(null);
    const [expandedFolders, setExpandedFolders] = React.useState({});
    const [query, setQuery] = React.useState('');
    const [showMobileSidebar, setShowMobileSidebar] = React.useState(false);

    // Password-protected documents arrive masked and are unlocked one at a time.
    const [unlockedDocs, setUnlockedDocs] = React.useState({});
    const [passwordInput, setPasswordInput] = React.useState('');
    const [unlockError, setUnlockError] = React.useState(null);
    const [unlocking, setUnlocking] = React.useState(false);

    const [activeEnvId, setActiveEnvId] = React.useState('');
    const [testResponse, setTestResponse] = React.useState(null);
    const [testLoading, setTestLoading] = React.useState(false);
    const [codeLang, setCodeLang] = React.useState('curl');

    const idOf = (o) => (o ? (o.id || o._id) : null);
    const stripHtml = (html) => (html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');

    React.useEffect(() => {
        if (!wsPath || !folderName) {
            setError('Invalid documentation URL format.');
            setLoading(false);
            return;
        }
        fetch(`/api/public/${surface}/${wsPath}/${folderName}`)
            .then(r => {
                if (!r.ok) throw new Error('Documentation not found or access denied.');
                return r.json();
            })
            .then(data => {
                setWorkspace(data.workspace);
                setFolder(data.folder);
                setSubfolders(data.subfolders || []);
                setDocs(data.docs || []);
                if (data.folder) setSelectedFolderId(idOf(data.folder));

                // Deep link: /<surface>/:ws/:folder?doc=<id> opens straight to a page.
                const deepDocId = new URLSearchParams(window.location.search).get('doc');
                const deepDoc = deepDocId && (data.docs || []).find(d => idOf(d) === deepDocId);
                if (deepDoc) {
                    setSelectedDocId(deepDocId);
                    if (deepDoc.folderId) {
                        setSelectedFolderId(deepDoc.folderId);
                        setExpandedFolders(prev => ({ ...prev, [deepDoc.folderId]: true }));
                    }
                }
            })
            .catch(err => setError(err.message))
            .finally(() => setLoading(false));
    }, [wsPath, folderName]);

    // Name the browser tab after what it is showing: "<board> | <collection>".
    // index.html carries one static <title> for the whole app, so without this
    // every published collection opens under the marketing headline and a reader
    // with several tabs open cannot tell them apart. Restored on unmount because
    // the app and the public surfaces share the document.
    React.useEffect(() => {
        if (!workspace || !folder) return;
        const previous = document.title;
        document.title = `${workspace.name} | ${folder.name}`;
        return () => { document.title = previous; };
    }, [workspace, folder]);

    const handleUnlockDoc = async (docId) => {
        setUnlocking(true);
        setUnlockError(null);
        try {
            const res = await fetch(`/api/public/docs/${wsPath}/unlock`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // The collection is what scopes the unlock: the server only
                // reaches documents inside it, so a bare id cannot pull an
                // unrelated document out of the same workspace.
                body: JSON.stringify({ docId, folderSlug: folderName, password: passwordInput })
            });
            if (res.status === 401) {
                setUnlockError(t('alerts.incorrect_password') || 'Incorrect password. Please try again.');
                return;
            }
            if (!res.ok) throw new Error('Unable to unlock document.');
            const data = await res.json();
            setUnlockedDocs(prev => ({ ...prev, [docId]: { content: data.content, apiSpec: data.apiSpec } }));
            setPasswordInput('');
        } catch (err) {
            setUnlockError(err.message);
        } finally {
            setUnlocking(false);
        }
    };

    const copyShareLink = async (link) => {
        const ok = await window.copyText(link);
        showToast(ok ? (t('alerts.copied_to_clipboard') || 'Copied!') : (t('alerts.copy_failed') || 'Unable to copy link.'), ok ? 'success' : 'error');
    };

    const envs = (folder && folder.environments) || [];
    const selectedEnv = envs.find(e => e.id === activeEnvId);

    // The public API redacts auth secrets, so an endpoint that needs a bearer
    // token arrives as `{ type: 'bearer' }` with no token — and the builder only
    // emits an Authorization header when there is a value to put in it. Left
    // alone, a reader would copy a snippet with no authentication at all and get
    // a 401 with nothing explaining why. Named placeholders keep the scheme
    // documented and land in the "replace these" list, because they do not
    // resolve either.
    const AUTH_PLACEHOLDERS = {
        bearer: { token: '{{token}}' },
        basic: { username: '{{username}}', password: '{{password}}' },
        apikey: { value: '{{apiKey}}' },
    };

    const withAuthPlaceholders = (doc) => {
        const spec = doc && doc.apiSpec;
        const auth = spec && spec.auth;
        const defaults = auth && AUTH_PLACEHOLDERS[auth.type];
        if (!defaults) return doc;

        const filled = { ...auth };
        Object.keys(defaults).forEach(field => {
            if (!filled[field]) filled[field] = defaults[field];
        });
        if (auth.type === 'apikey' && !filled.key) filled.key = 'X-API-Key';
        return { ...doc, apiSpec: { ...spec, auth: filled } };
    };

    // The same builder the in-app API editor uses, so a published endpoint
    // resolves here exactly as it does for the person who wrote it. Environment
    // variable values are redacted too, so anything that depended on one stays
    // visible as its `{{placeholder}}` for the reader to fill in.
    const buildRequest = (doc) => (
        window.buildApiRequest ? window.buildApiRequest(withAuthPlaceholders(doc), selectedEnv) : null
    );

    const handleTestApi = async (doc) => {
        const req = buildRequest(doc);
        if (!req) return;
        setTestLoading(true);
        setTestResponse(null);
        try {
            const headers = {};
            req.headers.forEach(h => { headers[h.key] = h.value; });

            const start = Date.now();
            // Public visitors are unauthenticated, so this cannot go through the
            // workspace proxy — it is a direct browser request and fails on any
            // target that does not serve permissive CORS headers.
            const res = await fetch(req.url, {
                method: req.method,
                headers,
                body: req.body == null ? undefined : req.body,
            });
            const time = Date.now() - start;
            const text = await res.text();
            let data = text;
            try { data = JSON.parse(text); } catch (e) { /* not JSON */ }

            // The same evaluator the editor uses. It only ever reads data, so
            // running an author's checks in a visitor's browser is safe here in
            // a way an author's *script* would not be.
            const headerRows = [];
            res.headers.forEach((value, key) => headerRows.push({ key, value }));
            const assertions = window.runApiAssertions
                ? window.runApiAssertions((doc.apiSpec || {}).assertions, {
                    status: res.status, statusText: res.statusText, time,
                    size: new window.Blob([text]).size, headers: headerRows, body: text,
                })
                : [];

            setTestResponse({ status: res.status, time, data, assertions });
        } catch (err) {
            setTestResponse({ status: 'ERROR', time: 0, data: `${err.message}\n\n${t('alerts.api_cors_hint') || ''}`.trim() });
        } finally {
            setTestLoading(false);
        }
    };

    const copySnippet = async (snippet) => {
        const ok = await window.copyText(snippet);
        showToast(
            ok ? (t('alerts.code_copied') || 'Code copied.') : (t('alerts.copy_failed') || 'Unable to copy.'),
            ok ? 'success' : 'error'
        );
    };

    // --- Derived view state ----------------------------------------------
    const q = query.trim().toLowerCase();
    const docMatches = (doc) => !q
        || (doc.title || '').toLowerCase().includes(q)
        || stripHtml(doc.content).toLowerCase().includes(q);
    const visibleDocs = docs.filter(docMatches);
    const docsIn = (folderId) => visibleDocs.filter(d => d.folderId === folderId);

    const rootFolderId = idOf(folder);
    const rawActiveDoc = selectedDocId ? docs.find(d => idOf(d) === selectedDocId) : null;
    const activeDocId = idOf(rawActiveDoc);
    const isDocLocked = !!(rawActiveDoc && rawActiveDoc.passwordProtected && !unlockedDocs[activeDocId]);
    // Unlocked content is merged over the masked record the public API returned.
    const activeDoc = rawActiveDoc && unlockedDocs[activeDocId]
        ? { ...rawActiveDoc, ...unlockedDocs[activeDocId] }
        : rawActiveDoc;

    const activeFolder = !rawActiveDoc && selectedFolderId
        ? (selectedFolderId === rootFolderId ? folder : subfolders.find(f => idOf(f) === selectedFolderId))
        : null;
    const isHome = !!(activeFolder && idOf(activeFolder) === rootFolderId);
    const docFolder = activeDoc && activeDoc.folderId
        ? (activeDoc.folderId === rootFolderId ? folder : subfolders.find(f => idOf(f) === activeDoc.folderId))
        : null;

    const previewRef = React.useRef(null);
    const previewHtml = activeDoc ? (activeDoc.content || '') : (activeFolder ? (activeFolder.description || '') : '');
    React.useEffect(() => {
        window.enhanceDocContent(previewRef.current, {
            copy: t('actions.copy') || 'Copy',
            copied: t('actions.copied') || 'Copied',
        });
    }, [previewHtml, selectedDocId, selectedFolderId, isDocLocked]);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-white text-[#6E6E73] text-[13px] font-semibold animate-pulse">
                {t('labels.loading_documentation') || 'Loading documentation…'}
            </div>
        );
    }
    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-white px-6">
                <div className="text-center">
                    <div className="w-14 h-14 rounded-xl bg-[#FDEDEE] flex items-center justify-center mx-auto mb-4">
                        <window.Icon name="file-x" size={24} className="text-[#E5484D]" />
                    </div>
                    <p className="text-[15px] font-bold text-[#171719]">{error}</p>
                </div>
            </div>
        );
    }

    const rowBase = 'flex items-center gap-1.5 px-2 py-1.5 rounded-[7px] text-[12.8px] cursor-pointer select-none transition-colors';
    const rowIdle = 'text-[#171719] hover:bg-[#F0F0F2]';
    const rowActive = 'bg-[#EAF3FF] text-[#0670DE] font-semibold';

    const DocRow = ({ doc, depth = 0 }) => {
        const docId = idOf(doc);
        const isActive = selectedDocId === docId;
        return (
            <div
                onClick={() => { setSelectedDocId(docId); setSelectedFolderId(doc.folderId || rootFolderId); setShowMobileSidebar(false); }}
                className={`${rowBase} ${isActive ? rowActive : rowIdle}`}
                style={{ paddingLeft: `${8 + depth * 14}px` }}
            >
                {doc.type === 'API' ? (
                    <span className={`text-[9px] font-bold font-mono w-9 text-center rounded px-1 py-0.5 flex-shrink-0 ${window.methodColor(doc.apiSpec && doc.apiSpec.method)}`}>
                        {(doc.apiSpec && doc.apiSpec.method) || 'GET'}
                    </span>
                ) : (
                    <window.Icon name="file-text" size={15} className={isActive ? 'text-[#0A84FF]' : 'text-[#A5A5AA]'} />
                )}
                <span className="flex-1 truncate">{doc.title || t('labels.untitled')}</span>
                {doc.passwordProtected && <window.Icon name="lock" size={11} className="text-[#A5A5AA] flex-shrink-0" />}
            </div>
        );
    };

    const visibleSubfolders = subfolders.filter(sub =>
        !q || docsIn(idOf(sub)).length > 0 || (sub.name || '').toLowerCase().includes(q));

    // The root is pinned to the viewport rather than `min-h-screen`: index.html
    // sets `body { overflow: hidden }` for the app shell, so a root taller than
    // the viewport is clipped with no page scrollbar. The fixed height is what
    // gives the sidebar and <main> a bounded parent to scroll inside.
    return (
        <div className="h-screen bg-white text-[#171719] flex flex-col">
            {/* Header */}
            <header className="h-14 flex-shrink-0 border-b border-[#ECECEC] flex items-center justify-between px-4 md:px-7 bg-white">
                <div className="flex items-center gap-2.5 min-w-0">
                    <button onClick={() => setShowMobileSidebar(true)} className="md:hidden p-1.5 -ml-1.5 text-[#6E6E73]">
                        <window.Icon name="menu" size={18} />
                    </button>
                    <span className="text-[13px] font-bold truncate">{workspace ? workspace.name : 'Workspace'}</span>
                    <span className="text-[#A5A5AA]">/</span>
                    <span className="text-[13px] font-semibold text-[#6E6E73] truncate">{folder ? folder.name : (kind === 'API' ? t('labels.api_collection') : t('labels.documentation'))}</span>
                </div>
                <button
                    onClick={() => {
                        const base = `${window.location.origin}/${surface}/${wsPath}/${folderName}`;
                        copyShareLink(rawActiveDoc ? `${base}?doc=${activeDocId}` : base);
                    }}
                    className="flex items-center gap-1.5 border border-[#DEDEDE] rounded-[6px] px-3 py-[6px] text-[12.5px] font-semibold text-[#6E6E73] hover:border-[#0A84FF] hover:text-[#0A84FF] transition-colors flex-shrink-0"
                >
                    <window.Icon name="link" size={13} />
                    <span className="hidden sm:inline">{t('actions.copy_link') || 'Copy Link'}</span>
                </button>
            </header>

            <div className="flex-1 flex min-h-0">
                {/* Sidebar */}
                <aside className={`${showMobileSidebar ? 'fixed inset-0 top-14 z-50 flex w-full' : 'hidden'} md:flex md:w-[252px] md:flex-shrink-0 bg-[#FAFAFA] border-r border-[#ECECEC] flex-col`}>
                    <div className="mx-3.5 mt-3.5 mb-1.5 flex items-center gap-[7px] bg-white border border-[#ECECEC] rounded-[6px] px-2.5 py-1.5">
                        <window.Icon name="search" size={14} className="text-[#A5A5AA] flex-shrink-0" />
                        <input
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder={t('labels.search_docs') || 'Search docs…'}
                            className="w-full bg-transparent border-none outline-none text-[12.5px] placeholder:text-[#A5A5AA]"
                        />
                        {query && (
                            <button onClick={() => setQuery('')} className="text-[#A5A5AA] hover:text-[#171719]">
                                <window.Icon name="x" size={12} />
                            </button>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto px-2 pb-6">
                        <div
                            onClick={() => { setSelectedFolderId(rootFolderId); setSelectedDocId(null); setShowMobileSidebar(false); }}
                            className={`${rowBase} ${isHome ? rowActive : rowIdle}`}
                        >
                            <window.Icon name="home" size={15} className={isHome ? 'text-[#0A84FF]' : 'text-[#A5A5AA]'} />
                            <span className="flex-1 truncate font-semibold">{t('labels.home') || 'Home'}</span>
                        </div>

                        {visibleSubfolders.map(sub => {
                            const subId = idOf(sub);
                            const isExpanded = !!expandedFolders[subId] || !!q;
                            const isActive = !selectedDocId && selectedFolderId === subId;
                            return (
                                <div key={subId} className="mb-0.5">
                                    <div
                                        onClick={() => {
                                            setExpandedFolders(prev => ({ ...prev, [subId]: !prev[subId] }));
                                            setSelectedFolderId(subId);
                                            setSelectedDocId(null);
                                        }}
                                        className={`${rowBase} ${isActive ? rowActive : rowIdle}`}
                                    >
                                        <window.Icon name="chevron-right" size={12} className={`text-[#A5A5AA] flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                                        <window.Icon name={isExpanded ? 'folder-open' : 'folder'} size={15} className="text-[#9AA0A6] flex-shrink-0" />
                                        <span className="flex-1 truncate">{sub.name}</span>
                                    </div>
                                    {isExpanded && docsIn(subId).map(doc => <DocRow key={idOf(doc)} doc={doc} depth={1} />)}
                                </div>
                            );
                        })}

                        {docsIn(rootFolderId).map(doc => <DocRow key={idOf(doc)} doc={doc} />)}

                        {visibleDocs.length === 0 && (
                            <p className="text-[12px] text-[#A5A5AA] italic text-center px-4 mt-8">
                                {q ? (t('labels.no_results') || 'No matches.') : (t('labels.no_documentation_found') || 'Nothing published yet.')}
                            </p>
                        )}
                    </div>

                    <div className="m-3.5 flex gap-[7px] items-start px-2.5 py-2 bg-white border border-dashed border-[#DEDEDE] rounded-[6px] text-[11px] leading-relaxed text-[#6E6E73]">
                        <window.Icon name="lock" size={12} className="text-[#A5A5AA] flex-shrink-0 mt-0.5" />
                        <span>{t('labels.read_only') || 'Read-only'} — {t('labels.public_read_only_hint') || 'editing tools are hidden for visitors.'}</span>
                    </div>
                </aside>

                {/* Content */}
                <main className="flex-1 min-w-0 overflow-y-auto">
                    {isDocLocked ? (
                        <div className="max-w-sm mx-auto mt-16 px-6">
                            <div className="bg-[#FAFAFA] border border-[#ECECEC] rounded-[14px] p-8 text-center">
                                <div className="w-14 h-14 mx-auto mb-5 rounded-full bg-[#EAF3FF] flex items-center justify-center">
                                    <window.Icon name="lock" size={24} className="text-[#0A84FF]" />
                                </div>
                                <h3 className="text-[16px] font-bold mb-1.5">{t('labels.protected_document') || 'Protected Document'}</h3>
                                <p className="text-[12.5px] text-[#6E6E73] mb-5">{t('labels.enter_password_to_view') || 'Enter the password to view this document.'}</p>
                                <form onSubmit={e => { e.preventDefault(); handleUnlockDoc(activeDocId); }} className="space-y-3">
                                    <input
                                        autoFocus
                                        type="password"
                                        value={passwordInput}
                                        onChange={e => { setPasswordInput(e.target.value); setUnlockError(null); }}
                                        placeholder={t('labels.password') || 'Password'}
                                        className="w-full px-3 py-2.5 bg-white border border-[#DEDEDE] rounded-[6px] text-[13px] text-center outline-none focus:border-[#0A84FF]"
                                    />
                                    {unlockError && <p className="text-[12px] font-semibold text-[#E5484D]">{unlockError}</p>}
                                    <button
                                        type="submit"
                                        disabled={unlocking || !passwordInput}
                                        className="w-full py-2.5 bg-[#0A84FF] text-white rounded-[6px] text-[12.5px] font-semibold hover:bg-[#0670DE] transition-colors disabled:opacity-50"
                                    >
                                        {unlocking ? (t('actions.sending') || 'Unlocking…') : (t('actions.unlock') || 'Unlock')}
                                    </button>
                                </form>
                            </div>
                        </div>
                    ) : activeDoc && activeDoc.type === 'API' ? (() => {
                      const builtRequest = buildRequest(activeDoc);
                      const codeLangs = window.apiCodeSnippets || [];
                      const activeLang = codeLangs.find(l => l.id === codeLang) || codeLangs[0];
                      const snippet = builtRequest && activeLang ? activeLang.render(builtRequest) : '';
                      return (
                        <div className="max-w-[760px] mx-auto px-5 md:px-8 py-7 pb-20">
                            <div className="flex items-start justify-between gap-4 mb-5">
                                <div className="min-w-0">
                                    {docFolder && <p className="text-[11px] font-semibold text-[#A5A5AA] mb-1">{docFolder.name}</p>}
                                    <h1 className="text-[24px] font-extrabold tracking-[-0.01em] truncate">{activeDoc.title || t('labels.untitled')}</h1>
                                </div>
                                {envs.length > 0 && (
                                    <select
                                        value={activeEnvId}
                                        onChange={e => setActiveEnvId(e.target.value)}
                                        className="text-[12px] font-semibold text-[#6E6E73] bg-white border border-[#DEDEDE] rounded-[6px] px-2.5 py-[7px] outline-none cursor-pointer flex-shrink-0"
                                    >
                                        <option value="">{t('labels.no_environment') || 'No Environment'}</option>
                                        {envs.map(env => <option key={env.id} value={env.id}>{env.name}</option>)}
                                    </select>
                                )}
                            </div>

                            <div className="flex items-center gap-3 bg-[#FAFAFA] border border-[#ECECEC] rounded-[10px] px-3 py-2.5 mb-6 overflow-x-auto">
                                <span className={`font-mono font-bold text-[11px] px-2 py-1 rounded flex-shrink-0 ${window.methodColor(activeDoc.apiSpec && activeDoc.apiSpec.method)}`}>
                                    {(activeDoc.apiSpec && activeDoc.apiSpec.method) || 'GET'}
                                </span>
                                <code className="font-mono text-[12.5px] whitespace-nowrap">
                                    {(builtRequest && builtRequest.url) || (t('labels.no_url_specified') || 'No URL specified')}
                                </code>
                            </div>

                            {stripHtml(activeDoc.content).trim() && (
                                <div ref={previewRef} className="nd-doc-body readme-preview mb-8" dangerouslySetInnerHTML={{ __html: window.sanitizeHtml(activeDoc.content) }} />
                            )}

                            {['headers', 'queryParams'].map(key => {
                                const rows = (activeDoc.apiSpec && activeDoc.apiSpec[key]) || [];
                                if (!rows.length) return null;
                                return (
                                    <div key={key} className="mb-7">
                                        <h3 className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#A5A5AA] mb-2.5">
                                            {key === 'headers' ? (t('labels.headers') || 'Headers') : (t('labels.query_parameters') || 'Query Parameters')}
                                        </h3>
                                        <div className="nd-table-scroll">
                                            <table className="w-full text-left text-[13px] border-collapse">
                                                <thead>
                                                    <tr className="border-b border-[#ECECEC]">
                                                        <th className="py-2 pr-4 font-bold w-1/3">{t('labels.key') || 'Key'}</th>
                                                        <th className="py-2 font-bold">{t('labels.value') || 'Value'}</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {rows.map((row, i) => (
                                                        <tr key={i} className="border-b border-[#ECECEC]">
                                                            <td className="py-2 pr-4 font-mono text-[12px] text-[#6E6E73] align-top">{row.key}</td>
                                                            <td className="py-2 font-mono text-[12px] break-all">{row.value}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                );
                            })}

                            {activeDoc.apiSpec && activeDoc.apiSpec.body && (
                                <div className="mb-7">
                                    <h3 className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#A5A5AA] mb-2.5">{t('labels.request_body') || 'Request Body'}</h3>
                                    <pre className="bg-[#141416] text-[#E8E8EA] rounded-[10px] p-4 overflow-x-auto font-mono text-[12.5px]"><code>{activeDoc.apiSpec.body}</code></pre>
                                </div>
                            )}

                            {/* Copy-paste starting point in the reader's own language.
                                Anything backed by a redacted variable or credential
                                stays as its `{{placeholder}}` for them to fill in. */}
                            {builtRequest && builtRequest.url && codeLangs.length > 0 && (
                                <div className="mb-7">
                                    <div className="flex items-center justify-between gap-3 mb-2.5">
                                        <h3 className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#A5A5AA]">
                                            {t('labels.code') || 'Code'}
                                        </h3>
                                        <div className="flex items-center gap-1.5">
                                            <div className="flex gap-1">
                                                {codeLangs.map(lang => (
                                                    <button
                                                        key={lang.id}
                                                        onClick={() => setCodeLang(lang.id)}
                                                        className={`rounded-[6px] border px-2.5 py-[5px] text-[11.5px] font-semibold transition-colors ${
                                                            (activeLang && activeLang.id === lang.id)
                                                                ? 'border-[#0A84FF] bg-[#EAF3FF] text-[#0670DE]'
                                                                : 'border-[#DEDEDE] bg-white text-[#6E6E73] hover:border-[#0A84FF]'
                                                        }`}
                                                    >
                                                        {lang.label}
                                                    </button>
                                                ))}
                                            </div>
                                            <button
                                                onClick={() => copySnippet(snippet)}
                                                className="flex items-center gap-1.5 border border-[#DEDEDE] rounded-[6px] px-2.5 py-[5px] text-[11.5px] font-semibold text-[#6E6E73] hover:border-[#0A84FF] hover:text-[#0A84FF] transition-colors"
                                            >
                                                <window.Icon name="copy" size={12} /> {t('actions.copy') || 'Copy'}
                                            </button>
                                        </div>
                                    </div>
                                    <pre className="bg-[#141416] text-[#E8E8EA] rounded-[10px] p-4 overflow-x-auto font-mono text-[12.5px]"><code>{snippet}</code></pre>
                                    {builtRequest.missing.length > 0 && (
                                        <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-[#9A6400] bg-[#FDF3E0] border border-[#F5E3BE] rounded-[6px] px-2.5 py-1.5">
                                            <window.Icon name="alert-triangle" size={12} className="flex-shrink-0" />
                                            <span>
                                                {t('labels.fill_in_placeholders') || 'Replace these with your own values'}:{' '}
                                                {builtRequest.missing.map(v => `{{${v}}}`).join(', ')}
                                            </span>
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* What the endpoint's author says a good response looks
                                like. Documentation before a run; pass/fail after one. */}
                            {((activeDoc.apiSpec || {}).assertions || []).length > 0 && (
                                <div className="mb-7">
                                    <h3 className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#A5A5AA] mb-2.5">
                                        {t('labels.expected_response') || 'Expected response'}
                                    </h3>
                                    <ul className="border border-[#ECECEC] rounded-[10px] divide-y divide-[#ECECEC] overflow-hidden">
                                        {activeDoc.apiSpec.assertions.map((a, i) => {
                                            const result = ((testResponse && testResponse.assertions) || [])[i];
                                            return (
                                                <li key={i} className="flex items-center gap-2 px-3.5 py-2 text-[12.5px]">
                                                    {result ? (
                                                        <span className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${result.passed ? 'bg-[#E6F6EE] text-[#18A957]' : 'bg-[#FCECEC] text-[#E5484D]'}`}>
                                                            <window.Icon name={result.passed ? 'check' : 'x'} size={10} />
                                                        </span>
                                                    ) : (
                                                        <span className="w-1.5 h-1.5 rounded-full bg-[#DEDEDE] flex-shrink-0 ml-1.5 mr-1" />
                                                    )}
                                                    <code className="font-mono text-[12px]">
                                                        {a.source}{a.path ? ` ${a.path}` : ''} {t(`labels.op_${a.op || 'eq'}`) || a.op}{a.value ? ` ${a.value}` : ''}
                                                    </code>
                                                    {result && !result.passed && (
                                                        <span className="ml-auto font-mono text-[11px] text-[#E5484D] truncate max-w-[45%]">
                                                            {t('labels.actual') || 'Actual'}: {result.actual === '' ? '(none)' : result.actual}
                                                        </span>
                                                    )}
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </div>
                            )}

                            <div className="mt-9 pt-6 border-t border-[#ECECEC]">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#171719]">{t('labels.live_api_test') || 'Live API Test'}</h3>
                                    <button
                                        onClick={() => handleTestApi(activeDoc)}
                                        disabled={testLoading}
                                        className="flex items-center gap-1.5 bg-[#0A84FF] text-white rounded-[6px] px-3.5 py-2 text-[12.5px] font-semibold hover:bg-[#0670DE] transition-colors disabled:opacity-50"
                                    >
                                        <window.Icon name={testLoading ? 'loader' : 'send'} size={13} className={testLoading ? 'animate-spin' : ''} />
                                        {testLoading ? (t('actions.sending') || 'Sending…') : (t('actions.send_request') || 'Send Request')}
                                    </button>
                                </div>
                                {testResponse ? (
                                    <div className="border border-[#ECECEC] rounded-[10px] overflow-hidden">
                                        <div className="flex gap-5 px-4 py-2.5 bg-[#FAFAFA] border-b border-[#ECECEC] text-[11.5px] font-semibold font-mono">
                                            <span className={testResponse.status === 200 || testResponse.status === 201 ? 'text-[#18A957]' : 'text-[#E5484D]'}>
                                                {t('labels.status') || 'Status'}: {testResponse.status}
                                            </span>
                                            <span className="text-[#A5A5AA]">{t('labels.time') || 'Time'}: {testResponse.time}ms</span>
                                        </div>
                                        <pre className="p-4 text-[12.5px] font-mono overflow-x-auto max-h-96">
                                            {typeof testResponse.data === 'object' ? JSON.stringify(testResponse.data, null, 2) : String(testResponse.data)}
                                        </pre>
                                    </div>
                                ) : (
                                    <p className="text-[12.5px] text-[#A5A5AA]">{t('labels.no_response_yet') || 'Send a request to see the response.'}</p>
                                )}
                            </div>
                        </div>
                      );
                    })() : activeDoc ? (
                        <div className="max-w-[680px] mx-auto px-5 md:px-8 py-7 pb-20">
                            {docFolder && <p className="text-[11px] font-semibold text-[#A5A5AA] mb-1.5">{docFolder.name}</p>}
                            <h1 className="text-[26px] font-extrabold tracking-[-0.02em] mb-6">{activeDoc.title || t('labels.untitled')}</h1>
                            {stripHtml(activeDoc.content).trim() ? (
                                <div ref={previewRef} className="nd-doc-body readme-preview" dangerouslySetInnerHTML={{ __html: window.sanitizeHtml(activeDoc.content) }} />
                            ) : (
                                <p className="text-[13px] text-[#A5A5AA]">{t('labels.document_empty_hint') || 'This document has no written content.'}</p>
                            )}
                        </div>
                    ) : activeFolder ? (
                        <div className="max-w-[680px] mx-auto px-5 md:px-8 py-7 pb-20">
                            <h1 className="text-[26px] font-extrabold tracking-[-0.02em] mb-1.5">{activeFolder.name}</h1>
                            <p className="text-[12.5px] text-[#A5A5AA] mb-7">
                                {docsIn(idOf(activeFolder)).length} {docsIn(idOf(activeFolder)).length === 1 ? (t('labels.document') || 'document') : (t('labels.documents') || 'documents')}
                                {isHome && subfolders.length > 0 && ` · ${subfolders.length} ${subfolders.length === 1 ? (t('labels.section') || 'section') : (t('labels.sections') || 'sections')}`}
                            </p>

                            {stripHtml(activeFolder.description).trim() ? (
                                <div ref={previewRef} className="nd-doc-body readme-preview" dangerouslySetInnerHTML={{ __html: window.sanitizeHtml(activeFolder.description) }} />
                            ) : (
                                <p className="text-[13px] text-[#A5A5AA]">{t('labels.readme_empty') || 'No README yet'}</p>
                            )}

                            {(docsIn(idOf(activeFolder)).length > 0 || (isHome && visibleSubfolders.length > 0)) && (
                                <div className="mt-10 pt-6 border-t border-[#ECECEC]">
                                    <h3 className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#A5A5AA] mb-3">{t('labels.in_this_section') || 'In this section'}</h3>
                                    <div className="space-y-1.5">
                                        {isHome && visibleSubfolders.map(sub => (
                                            <button
                                                key={idOf(sub)}
                                                onClick={() => { setSelectedFolderId(idOf(sub)); setExpandedFolders(prev => ({ ...prev, [idOf(sub)]: true })); }}
                                                className="w-full flex items-center gap-2.5 px-3.5 py-3 rounded-[10px] border border-[#ECECEC] hover:border-[#0A84FF] hover:bg-[#EAF3FF]/40 transition-colors text-left"
                                            >
                                                <window.Icon name="folder" size={15} className="text-[#9AA0A6] flex-shrink-0" />
                                                <span className="text-[13px] font-semibold truncate">{sub.name}</span>
                                                <span className="ml-auto text-[11px] font-mono text-[#A5A5AA] flex-shrink-0">{docsIn(idOf(sub)).length}</span>
                                            </button>
                                        ))}
                                        {docsIn(idOf(activeFolder)).map(doc => (
                                            <button
                                                key={idOf(doc)}
                                                onClick={() => setSelectedDocId(idOf(doc))}
                                                className="w-full flex items-center gap-2.5 px-3.5 py-3 rounded-[10px] border border-[#ECECEC] hover:border-[#0A84FF] hover:bg-[#EAF3FF]/40 transition-colors text-left"
                                            >
                                                {doc.type === 'API' ? (
                                                    <span className={`text-[9px] font-bold font-mono w-9 text-center rounded px-1 py-0.5 flex-shrink-0 ${window.methodColor(doc.apiSpec && doc.apiSpec.method)}`}>
                                                        {(doc.apiSpec && doc.apiSpec.method) || 'GET'}
                                                    </span>
                                                ) : (
                                                    <window.Icon name="file-text" size={15} className="text-[#A5A5AA] flex-shrink-0" />
                                                )}
                                                <span className="text-[13px] font-semibold truncate">{doc.title || t('labels.untitled')}</span>
                                                {doc.passwordProtected && <window.Icon name="lock" size={11} className="text-[#A5A5AA] ml-auto flex-shrink-0" />}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-center px-6 py-20">
                            <window.Icon name="book-open" size={44} className="text-[#ECECEC] mb-4" />
                            <p className="text-[14px] font-bold text-[#6E6E73]">{t('labels.select_document') || 'Select a document'}</p>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
};

// The GitBook-style documentation site: /docs/:workspace/:folder.
// Its Postman-style counterpart lives in PublicApiView.jsx.
window.PublicDocsView = ({ wsPath, folderName }) => (
    <window.PublicCollectionView wsPath={wsPath} folderName={folderName} kind="DOCS" />
);
