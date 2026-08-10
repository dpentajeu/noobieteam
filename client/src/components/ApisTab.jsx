const React = window.React;

// NoobieAPI — the Postman-style API page.
//
// This surface owns API endpoints only; text documents live on the GitBook-style
// `DocsTab`. The two pages read the same `Doc`/`Folder` collections and split on
// `type` for now — the folder-level `kind` flag replaces that filter later.
//
// The one rule worth keeping: `buildRequest` is the single source of truth for
// what an endpoint actually sends. Send, the URL preview and every code snippet
// all derive from it, so a request can never be shown one way and sent another.
// When the server-side proxy lands it consumes the same shape.

const NT_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const NT_METHOD_STYLE = {
    GET: 'text-[#0670DE] bg-[#EAF3FF]',
    POST: 'text-[#1A7F52] bg-[#E6F6EE]',
    PUT: 'text-[#9A6400] bg-[#FDF3E0]',
    PATCH: 'text-[#6D4AC0] bg-[#F0EBFB]',
    DELETE: 'text-[#C4363A] bg-[#FCECEC]',
};

// A Postman collection that used `{{base_url}}` should keep working against a
// folder environment that only defines a base URL, so these names fall back to
// `environment.baseUrl` when no explicit variable shadows them.
const NT_BASE_ALIASES = ['baseurl', 'base_url', 'base-url', 'host', 'server', 'url'];

const NT_VAR_RE = /\{\{\s*([\w.\-]+)\s*\}\}/g;

// --- Pure request building ------------------------------------------------
// Kept at module scope: no React state, no closures, so the same input always
// produces the same request whether it is being sent or rendered as a snippet.

const ntSubstitute = (text, vars, baseUrl, missing) => {
    if (!text) return '';
    return String(text).replace(NT_VAR_RE, (whole, name) => {
        if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name];
        if (baseUrl && NT_BASE_ALIASES.includes(name.toLowerCase())) return baseUrl;
        if (missing) missing.add(name);
        return whole;
    });
};

const ntJoinUrl = (base, path) => {
    if (!base) return path;
    if (!path) return base;
    return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
};

const ntHasScheme = (url) => /^[a-z][a-z0-9+.\-]*:\/\//i.test(url);

const ntB64 = (str) => {
    try {
        return window.btoa(unescape(encodeURIComponent(str)));
    } catch (e) {
        return '';
    }
};

const ntFindHeader = (headers, name) => headers.find(h => (h.key || '').toLowerCase() === name.toLowerCase());

/**
 * Resolve an endpoint against an environment into the exact request that will
 * go on the wire.
 *
 * Returns `{ method, url, headers, body, bodyMode, missing }` where `missing`
 * lists `{{variables}}` nothing resolved — surfaced in the UI rather than sent
 * through as literal braces without warning.
 */
const ntBuildRequest = (doc, env) => {
    const spec = (doc && doc.apiSpec) || {};
    const missing = new Set();

    // A variable with no value at all is *undefined*, not empty. The public docs
    // API returns declared-but-redacted variables as `{ key }` with the value
    // stripped, and collapsing those to '' would silently delete the placeholder
    // from the URL — `/{{version}}/things` would render as `/things` and read as
    // a real path rather than something the reader still has to fill in.
    const vars = {};
    ((env && env.variables) || []).forEach(v => {
        if (v && v.key && v.value != null) vars[v.key] = String(v.value);
    });
    const baseUrl = ((env && env.baseUrl) || '').trim();
    const sub = (s) => ntSubstitute(s, vars, baseUrl, missing);

    let url = sub(spec.url || '').trim();
    if (url && !ntHasScheme(url) && baseUrl) url = ntJoinUrl(baseUrl, url);

    const headers = [];
    (spec.headers || []).forEach(h => {
        if (h && h.key) headers.push({ key: sub(h.key), value: sub(h.value || '') });
    });

    const query = [];
    (spec.queryParams || []).forEach(p => {
        if (p && p.key) query.push({ key: sub(p.key), value: sub(p.value || '') });
    });

    // Auth is applied last so an explicit header the user typed themselves is
    // never silently duplicated by the helper.
    const auth = spec.auth || {};
    const authType = auth.type || 'none';
    if (authType === 'bearer' && auth.token) {
        if (!ntFindHeader(headers, 'Authorization')) {
            headers.push({ key: 'Authorization', value: `Bearer ${sub(auth.token)}` });
        }
    } else if (authType === 'basic' && (auth.username || auth.password)) {
        if (!ntFindHeader(headers, 'Authorization')) {
            const pair = `${sub(auth.username || '')}:${sub(auth.password || '')}`;
            headers.push({ key: 'Authorization', value: `Basic ${ntB64(pair)}` });
        }
    } else if (authType === 'apikey' && auth.key) {
        const k = sub(auth.key);
        const v = sub(auth.value || '');
        if (auth.addTo === 'query') query.push({ key: k, value: v });
        else if (!ntFindHeader(headers, k)) headers.push({ key: k, value: v });
    }

    let finalUrl = url;
    if (query.length) {
        const qs = query
            .map(p => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
            .join('&');
        finalUrl += (finalUrl.indexOf('?') === -1 ? '?' : '&') + qs;
    }

    const method = (spec.method || 'GET').toUpperCase();
    const rawBody = sub(spec.body || '');
    const sendsBody = method !== 'GET' && method !== 'HEAD' && !!rawBody.trim();

    const contentType = (ntFindHeader(headers, 'Content-Type') || {}).value || '';
    let bodyMode = 'raw';
    if (contentType.indexOf('multipart/form-data') !== -1) bodyMode = 'formdata';
    else if (contentType.indexOf('application/x-www-form-urlencoded') !== -1) bodyMode = 'urlencoded';

    // A JSON body with no declared Content-Type is the overwhelmingly common
    // case, so default it rather than letting the browser send text/plain.
    if (sendsBody && !contentType && bodyMode === 'raw') {
        headers.push({ key: 'Content-Type', value: 'application/json' });
    }

    return {
        method,
        url: finalUrl,
        headers,
        body: sendsBody ? rawBody : null,
        bodyMode,
        missing: Array.from(missing),
    };
};

// --- Code generation ------------------------------------------------------

const ntShellQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

const ntToCurl = (req) => {
    const lines = [`curl -X ${req.method} ${ntShellQuote(req.url || '')}`];
    req.headers.forEach(h => lines.push(`  -H ${ntShellQuote(`${h.key}: ${h.value}`)}`));
    if (req.body) lines.push(`  -d ${ntShellQuote(req.body)}`);
    return lines.join(' \\\n');
};

const ntToFetch = (req) => {
    const headerLines = req.headers
        .map(h => `    ${JSON.stringify(h.key)}: ${JSON.stringify(h.value)},`)
        .join('\n');
    const parts = [`  method: ${JSON.stringify(req.method)},`];
    if (req.headers.length) parts.push(`  headers: {\n${headerLines}\n  },`);
    if (req.body) parts.push(`  body: ${JSON.stringify(req.body)},`);
    return [
        `const res = await fetch(${JSON.stringify(req.url || '')}, {`,
        parts.join('\n'),
        `});`,
        `const data = await res.json();`,
    ].join('\n');
};

const ntToAxios = (req) => {
    const headerLines = req.headers
        .map(h => `    ${JSON.stringify(h.key)}: ${JSON.stringify(h.value)},`)
        .join('\n');
    const parts = [
        `  method: ${JSON.stringify(req.method.toLowerCase())},`,
        `  url: ${JSON.stringify(req.url || '')},`,
    ];
    if (req.headers.length) parts.push(`  headers: {\n${headerLines}\n  },`);
    if (req.body) parts.push(`  data: ${JSON.stringify(req.body)},`);
    return [`const { data } = await axios({`, parts.join('\n'), `});`].join('\n');
};

const NT_CODE_LANGS = [
    { id: 'curl', label: 'cURL', render: ntToCurl },
    { id: 'fetch', label: 'fetch', render: ntToFetch },
    { id: 'axios', label: 'axios', render: ntToAxios },
];

// --- Wire encoding --------------------------------------------------------

const ntMultipart = (fields, boundary) => {
    // A quote or newline in a field name would close the header early and let
    // the value forge extra parts, so names are stripped of both.
    const clean = (name) => String(name).replace(/["\r\n]/g, '');
    const parts = Object.keys(fields).map(k =>
        `--${boundary}\r\nContent-Disposition: form-data; name="${clean(k)}"\r\n\r\n${fields[k]}\r\n`);
    return `${parts.join('')}--${boundary}--\r\n`;
};

/**
 * Turn a built request's body into the exact string that goes on the wire.
 *
 * The proxy takes a plain string, so the encoding the browser used to do for
 * us (FormData, URLSearchParams) happens here instead. Non-raw modes are stored
 * in the editor as a JSON object of field name to value.
 */
const ntWireBody = (req) => {
    if (req.body == null) return { body: null, contentType: null };

    if (req.bodyMode === 'urlencoded') {
        try {
            const parsed = JSON.parse(req.body);
            const params = new window.URLSearchParams();
            Object.keys(parsed).forEach(k => params.append(k, parsed[k]));
            return { body: params.toString(), contentType: 'application/x-www-form-urlencoded' };
        } catch (e) {
            return { body: req.body, contentType: null };
        }
    }

    if (req.bodyMode === 'formdata') {
        try {
            const parsed = JSON.parse(req.body);
            const boundary = `----NoobieBoundary${Math.random().toString(16).slice(2)}`;
            return {
                body: ntMultipart(parsed, boundary),
                contentType: `multipart/form-data; boundary=${boundary}`,
            };
        } catch (e) {
            return { body: req.body, contentType: null };
        }
    }

    return { body: req.body, contentType: null };
};

// --- Small formatting helpers --------------------------------------------

// `13421B` is not a size a person reads. Bytes stay bytes below 1 KB, where the
// exact number is the useful part.
const ntFormatBytes = (bytes) => {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
};

// A request body is JSON far more often than not, and a stray trailing comma
// currently surfaces as a 400 from the target rather than as something the
// editor could have said immediately. Only text that is *trying* to be JSON is
// judged: a form-encoded or plain-text body is not an error.
const ntLooksLikeJson = (text) => /^\s*[{[]/.test(String(text || ''));

const ntJsonError = (text) => {
    if (!ntLooksLikeJson(text)) return null;
    try {
        JSON.parse(text);
        return null;
    } catch (e) {
        return e.message;
    }
};

const ntPrettyJson = (text) => {
    try {
        return JSON.stringify(JSON.parse(text), null, 2);
    } catch (e) {
        return null;
    }
};

// --- Declarative response checks -----------------------------------------
//
// Postman does this with user-written JavaScript in a Tests script. We cannot:
// a collection is shared across a workspace and published at /apis/:ws/:folder,
// so a script written by one author would execute in a visitor's browser on our
// origin — stored XSS, with `localStorage.nt_token` sitting right there. So the
// checks are stored as data and interpreted here. Nothing author-supplied is
// ever executed, which is also why the same evaluator can run on the public
// page with no sandboxing at all.
//
// The trade is real and worth naming: this covers asserting on a response and
// chaining a value into the next request. It cannot compute a request — an HMAC
// signature or a nonce still needs a pre-request script, which this is not.

const NT_ASSERT_SOURCES = ['status', 'statusText', 'time', 'size', 'header', 'body', 'rawBody'];

// `needsPath` — header name or JSON path. `needsValue` — has a right-hand side.
const NT_ASSERT_OPS = [
    { id: 'eq', needsValue: true },
    { id: 'ne', needsValue: true },
    { id: 'lt', needsValue: true },
    { id: 'gt', needsValue: true },
    { id: 'contains', needsValue: true },
    { id: 'notContains', needsValue: true },
    { id: 'exists', needsValue: false },
    { id: 'notExists', needsValue: false },
];

const ntSourceNeedsPath = (source) => source === 'header' || source === 'body';
const ntOpNeedsValue = (op) => {
    const found = NT_ASSERT_OPS.find(o => o.id === op);
    return found ? found.needsValue : true;
};

// Walk a dot/bracket path: `data.items[0].id`. Returns undefined at the first
// missing link rather than throwing, so a wrong path reads as "does not exist".
const ntGetPath = (obj, path) => {
    if (path === undefined || path === null || path === '') return obj;
    return String(path)
        .split(/[.[\]]+/)
        .filter(Boolean)
        .reduce((acc, key) => (acc === null || acc === undefined ? undefined : acc[key]), obj);
};

/** Pull the value an assertion or extraction rule points at, out of a response. */
const ntResolveValue = (rule, res) => {
    if (!rule || !res) return undefined;
    const source = rule.source || rule.from || 'status';

    if (source === 'status') return res.status;
    if (source === 'statusText') return res.statusText;
    if (source === 'time') return res.time;
    if (source === 'size') return res.size;
    if (source === 'rawBody') return res.body;

    if (source === 'header') {
        const wanted = String(rule.path || '').toLowerCase();
        const hit = (res.headers || []).find(h => String(h.key).toLowerCase() === wanted);
        return hit ? hit.value : undefined;
    }

    // body: parse once, then walk. A non-JSON body yields undefined, which the
    // operators treat as "not there" rather than as an error.
    let parsed;
    try { parsed = JSON.parse(res.body); } catch (e) { return undefined; }
    return ntGetPath(parsed, rule.path);
};

// Comparison is string-based on purpose: the expected value always arrives from
// a text input, while the actual may be a number, boolean or object. Comparing
// their string forms makes `status eq 200` work without asking the user to
// declare a type.
const ntStringify = (v) => {
    if (v === null || v === undefined) return '';
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
};

const ntCompare = (actual, op, expected) => {
    switch (op) {
        case 'exists': return actual !== undefined && actual !== null;
        case 'notExists': return actual === undefined || actual === null;
        case 'eq': return ntStringify(actual) === ntStringify(expected);
        case 'ne': return ntStringify(actual) !== ntStringify(expected);
        case 'lt': return Number(actual) < Number(expected);
        case 'gt': return Number(actual) > Number(expected);
        case 'contains': return ntStringify(actual).includes(ntStringify(expected));
        case 'notContains': return !ntStringify(actual).includes(ntStringify(expected));
        default: return false;
    }
};

/** Evaluate every assertion against a response. Returns one result per rule. */
const ntRunAssertions = (assertions, res) => (assertions || [])
    .filter(a => a && a.source)
    .map(a => {
        const actual = ntResolveValue(a, res);
        return {
            source: a.source,
            path: a.path,
            op: a.op || 'eq',
            value: a.value,
            actual: ntStringify(actual),
            passed: ntCompare(actual, a.op || 'eq', a.value),
        };
    });

/** Resolve every extraction rule. `found` is false when the path missed. */
const ntRunExtractions = (rules, res) => (rules || [])
    .filter(r => r && r.into)
    .map(r => {
        const value = ntResolveValue(r, res);
        const found = value !== undefined && value !== null;
        return { into: r.into, value: found ? ntStringify(value) : '', found };
    });

// Shared with the public pages so a published endpoint resolves exactly as its
// author sees it here — same substitution, same auth handling, same snippets,
// same response checks.
// (`window.resolveApiUrl` in helpers.js is the older, cruder version: it
// replaced every `{{placeholder}}` with the base URL instead of looking names
// up. Nothing on the API surfaces uses it any more.)
window.buildApiRequest = ntBuildRequest;
window.apiCodeSnippets = NT_CODE_LANGS;
window.runApiAssertions = ntRunAssertions;
window.apiAssertOps = NT_ASSERT_OPS;
window.apiAssertSources = NT_ASSERT_SOURCES;

window.ApisTab = ({ workspaceId, user, onLogActivity }) => {
    const { t } = window.useTranslation();
    const { showConfirm, showPrompt, showAlert } = window.useModals();
    const { showToast } = window.useToasts();

    const [docs, setDocs] = React.useState([]);
    const [folders, setFolders] = React.useState([]);
    const [loading, setLoading] = React.useState(true);
    const [selectedDocId, setSelectedDocId] = React.useState(null);
    const [selectedFolderId, setSelectedFolderId] = React.useState(null);
    const [expandedFolders, setExpandedFolders] = React.useState({});
    const [query, setQuery] = React.useState('');
    const [showMobileSidebar, setShowMobileSidebar] = React.useState(false);

    const [activeEnvId, setActiveEnvId] = React.useState('');
    const [reqTab, setReqTab] = React.useState('Params');
    const [resTab, setResTab] = React.useState('Body');
    const [codeLang, setCodeLang] = React.useState('curl');
    const [response, setResponse] = React.useState(null);
    const [sending, setSending] = React.useState(false);
    const [showNotes, setShowNotes] = React.useState(false);
    const [editingNotes, setEditingNotes] = React.useState(false);
    const [importing, setImporting] = React.useState(false);
    const [saveState, setSaveState] = React.useState('idle');
    // Unsaved edits, keyed by endpoint id: `{ [docId]: partialDoc }`. The server
    // copy in `docs` is never touched until a save succeeds, which is what makes
    // "unsaved" a real state rather than a spinner over an already-written row.
    const [drafts, setDrafts] = React.useState({});
    // Width of the request pane as a percentage, side-by-side layouts only. A
    // fixed half-and-half split wastes the screen either way round: a long JSON
    // body wants room to the left, a 200-line response wants it to the right.
    const [splitPct, setSplitPct] = React.useState(50);

    const idOf = (o) => (o ? (o.id || o._id) : null);

    React.useEffect(() => {
        setLoading(true);
        Promise.all([
            fetch(`/api/workspaces/${workspaceId}/docs`).then(r => (r.ok ? r.json() : [])),
            fetch(`/api/workspaces/${workspaceId}/folders`).then(r => (r.ok ? r.json() : [])),
        ])
            .then(([d, f]) => {
                setDocs(Array.isArray(d) ? d : []);
                setFolders(Array.isArray(f) ? f : []);
            })
            .catch(err => { console.error('API load error:', err); })
            .finally(() => setLoading(false));
    }, [workspaceId]);

    // --- Drafts -----------------------------------------------------------
    // Kept per workspace so switching workspaces does not surface someone
    // else's half-written endpoint, and restored on load so a refresh — or a
    // closed laptop — is not the same thing as discarding the work.
    const draftKey = `nt_api_drafts_${workspaceId}`;

    React.useEffect(() => {
        setDrafts(window.safeParse(draftKey, {}) || {});
    }, [draftKey]);

    React.useEffect(() => {
        try {
            if (Object.keys(drafts).length) localStorage.setItem(draftKey, JSON.stringify(drafts));
            else localStorage.removeItem(draftKey);
        } catch (e) {
            // A full quota is not a reason to lose the editing session in memory.
            console.error('Draft persistence failed:', e);
        }
    }, [drafts, draftKey]);

    // Listeners and async saves read through refs: they outlive the render that
    // created them, and a save that resolves after a re-render must compare
    // against the version state holds *now*, not the one it was called with.
    const draftsRef = React.useRef(drafts);
    draftsRef.current = drafts;
    const docsRef = React.useRef(docs);
    docsRef.current = docs;
    const foldersRef = React.useRef(folders);
    foldersRef.current = folders;

    const isDirty = (docId) => !!drafts[docId];
    const dirtyCount = Object.keys(drafts).length;

    // "Saved" and "Save failed" describe the endpoint they happened to, so they
    // are cleared on the way to another one rather than following the selection
    // around and describing the wrong thing.
    React.useEffect(() => {
        setSaveState(prev => (prev === 'idle' || prev === 'saving' ? prev : 'idle'));
    }, [selectedDocId]);

    // --- Data shaping -----------------------------------------------------
    // Everything below reads the *drafted* endpoint: the sidebar, search, the
    // editor and Send all show what you are working on, not what is stored.
    const apiDocs = docs
        .filter(d => d.type === 'API')
        .map(d => (drafts[idOf(d)] ? { ...d, ...drafts[idOf(d)] } : d));
    const q = query.trim().toLowerCase();
    const docMatches = (doc) => !q
        || (doc.title || '').toLowerCase().includes(q)
        || ((doc.apiSpec && doc.apiSpec.url) || '').toLowerCase().includes(q)
        || ((doc.apiSpec && doc.apiSpec.method) || '').toLowerCase().includes(q);
    const visibleDocs = apiDocs.filter(docMatches);

    const subfoldersOf = (folderId) => folders.filter(f => f.parentId === folderId);
    const docsIn = (folderId) => visibleDocs.filter(d => d.folderId === folderId);
    const rootDocs = visibleDocs.filter(d => !d.folderId);

    // A folder only earns a row while searching if it still holds a match,
    // otherwise results sit buried under a wall of empty collections.
    const folderMatches = (folder) => {
        const folderId = idOf(folder);
        if (!q) return true;
        if ((folder.name || '').toLowerCase().includes(q)) return true;
        if (docsIn(folderId).length > 0) return true;
        return subfoldersOf(folderId).some(sub =>
            docsIn(idOf(sub)).length > 0 || (sub.name || '').toLowerCase().includes(q));
    };

    // A collection belongs to this page because it is declared an API collection,
    // not because of what happens to be inside it. That declaration is what gives
    // it a stable /apis/ URL — inferring membership from `Doc.type` meant adding
    // a text page to a published collection could move it to the other surface.
    //
    // Folders written before `kind` existed have none; those fall back to the
    // schema default of DOCS.
    const isApiFolder = (folder) => (folder.kind || 'DOCS') === 'API';

    const rootFolders = folders.filter(f => !f.parentId && isApiFolder(f));

    const activeDoc = selectedDocId ? apiDocs.find(d => idOf(d) === selectedDocId) : null;
    const activeFolder = !activeDoc && selectedFolderId ? folders.find(f => idOf(f) === selectedFolderId) : null;

    // `parentId` is writable through the API, so a chain that loops back on
    // itself (A -> B -> A) is representable in the data. Walking it by recursion
    // never terminates: the stack overflows and takes the whole tab down with a
    // blank screen. Walk iteratively and stop the first time a folder repeats,
    // treating that folder as the root. A dangling parent still yields null,
    // exactly as before.
    const getRootFolder = (folderId) => {
        if (!folderId) return null;
        let current = folders.find(x => idOf(x) === folderId);
        if (!current) return null;
        const seen = new Set([idOf(current)]);
        while (current.parentId) {
            const parent = folders.find(x => idOf(x) === current.parentId);
            if (!parent) return null;
            if (seen.has(idOf(parent))) return current;
            seen.add(idOf(parent));
            current = parent;
        }
        return current;
    };

    // Environments are declared on the collection root and inherited by every
    // endpoint beneath it.
    const envRoot = activeDoc ? getRootFolder(activeDoc.folderId) : activeFolder;
    const envs = (envRoot && envRoot.environments) || [];
    const activeEnv = envs.find(e => e.id === activeEnvId) || null;

    React.useEffect(() => {
        if (activeEnvId && !envs.some(e => e.id === activeEnvId)) setActiveEnvId('');
    }, [envRoot && idOf(envRoot)]);

    const builtRequest = activeDoc ? ntBuildRequest(activeDoc, activeEnv) : null;

    // --- Mutations --------------------------------------------------------
    const toggleFolder = (folderId) => setExpandedFolders(prev => ({ ...prev, [folderId]: !prev[folderId] }));

    // Saves in flight right now. Counted rather than flagged so two overlapping
    // PUTs cannot have the first one's completion report "Saved" while the
    // second is still running.
    const inFlight = React.useRef(0);

    const beginSave = () => { inFlight.current += 1; setSaveState('saving'); };
    const endSave = (state) => {
        inFlight.current = Math.max(0, inFlight.current - 1);
        // Only the last save standing gets to say how it went, so a fast write
        // finishing first cannot report "Saved" over a slower one still running.
        if (state !== 'saved' || inFlight.current === 0) setSaveState(state);
    };

    /**
     * PUT a patch, telling the server which version we are editing.
     *
     * `expectedUpdatedAt` is the `updatedAt` of the copy this client last read.
     * The server refuses the write with a 409 if the stored copy has moved on
     * since — see `guardedUpdate` in server/routes/docs.js. Pass no expectation
     * to overwrite deliberately.
     */
    const putGuarded = async (url, patch, expectedUpdatedAt) => {
        const res = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(expectedUpdatedAt ? { ...patch, expectedUpdatedAt } : patch),
        });
        let data = null;
        try { data = await res.json(); } catch (e) { /* empty or non-JSON body */ }
        return { ok: res.ok, status: res.status, data };
    };

    const adoptDoc = (docId, incoming) => setDocs(prev => prev.map(d => (
        idOf(d) === docId ? { ...d, ...incoming, id: idOf(incoming) || idOf(d) } : d
    )));

    // Editing an endpoint writes to a draft, not to the server. Saving is an act
    // the author performs, the way it is in Postman: an endpoint is a shared,
    // published thing, and autosave meant every half-typed URL was live for the
    // whole workspace and for anyone reading the public page.
    //
    // Drafts survive a reload (localStorage) rather than being flushed on
    // unmount, so leaving the tab is not a decision to publish.
    const updateDoc = (docId, patch) => {
        if (!docId) return;
        setDrafts(prev => ({ ...prev, [docId]: { ...(prev[docId] || {}), ...patch } }));
    };

    const updateSpec = (doc, patch) =>
        updateDoc(idOf(doc), { apiSpec: { ...(doc.apiSpec || {}), ...patch } });

    // Structural changes are not editor content and have no Save button of their
    // own — moving an endpoint between collections is the whole action, so it
    // goes straight through.
    const saveDocNow = async (docId, patch) => {
        const base = docsRef.current.find(d => idOf(d) === docId);
        beginSave();
        try {
            const { ok, status, data } = await putGuarded(`/api/docs/${docId}`, patch, base && base.updatedAt);
            if (status === 409) {
                // Nothing of the caller's is lost here: the move simply did not
                // happen, and the fresh copy is what they will act on next.
                if (data && data.current) adoptDoc(docId, data.current);
                showToast(t('alerts.endpoint_changed_elsewhere'), 'error');
                return endSave('conflict');
            }
            if (!ok || !data) throw new Error(`HTTP ${status}`);
            adoptDoc(docId, data);
            endSave('saved');
        } catch (err) {
            endSave('error');
            showToast(t('alerts.save_failed_retry'), 'error');
            console.error('Endpoint update failed:', err);
        }
    };

    const discardDraft = (docId) => setDrafts(prev => {
        if (!prev[docId]) return prev;
        const next = { ...prev };
        delete next[docId];
        return next;
    });

    /**
     * Save the open endpoint's draft.
     *
     * The draft is kept on every failure. A conflict is the one case worth
     * asking about rather than deciding: their version is loaded underneath so
     * the editor shows what would be overwritten, and saving again — this time
     * against the version just fetched — is what confirms the overwrite.
     */
    const saveDoc = async (docId) => {
        const patch = draftsRef.current[docId];
        if (!docId || !patch) return;
        const base = docsRef.current.find(d => idOf(d) === docId);
        beginSave();
        try {
            const { ok, status, data } = await putGuarded(`/api/docs/${docId}`, patch, base && base.updatedAt);

            if (status === 409) {
                if (data && data.current) adoptDoc(docId, data.current);
                endSave('conflict');
                showConfirm(
                    t('alerts.conflict_title'),
                    t('alerts.conflict_endpoint'),
                    () => saveDoc(docId),
                );
                return;
            }
            // 404, or the 200-with-null-body older builds answer with, both mean
            // the endpoint is gone. Reporting either as saved would be a lie the
            // draft then hides.
            if (status === 404 || (ok && !data)) throw new Error('gone');
            if (!ok) throw new Error(`HTTP ${status}`);

            adoptDoc(docId, data);
            discardDraft(docId);
            endSave('saved');
        } catch (err) {
            endSave('error');
            showToast(err.message === 'gone' ? t('alerts.endpoint_gone') : t('alerts.save_failed_retry'), 'error');
            console.error('Endpoint save failed:', err);
        }
    };

    const addFolder = () => {
        showPrompt(t('actions.new_collection') || 'New Collection', t('labels.enter_folder_name'), async (name) => {
            if (!name) return;
            const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
            const res = await fetch(`/api/workspaces/${workspaceId}/folders`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, slug, kind: 'API' }),
            });
            if (!res.ok) return showToast(t('alerts.error'), 'error');
            const saved = await res.json();
            const savedId = idOf(saved);
            setFolders(prev => [...prev, { ...saved, id: savedId }]);
            setExpandedFolders(prev => ({ ...prev, [savedId]: true }));
            setSelectedFolderId(savedId);
            setSelectedDocId(null);
            onLogActivity?.('Created folder', 'folder', name);
            showToast(t('alerts.folder_created'));
        });
    };

    const deleteFolder = (folderId) => {
        showConfirm(t('actions.destroy_folder'), t('alerts.confirm_destroy_folder'), async () => {
            const target = folders.find(f => idOf(f) === folderId);
            await fetch(`/api/folders/${folderId}`, { method: 'DELETE' });
            setFolders(prev => prev.filter(f => idOf(f) !== folderId));
            setDocs(prev => prev.map(d => (d.folderId === folderId ? { ...d, folderId: null } : d)));
            if (selectedFolderId === folderId) setSelectedFolderId(null);
            onLogActivity?.('Deleted folder', 'folder', target?.name);
            showToast(t('alerts.folder_destroyed'));
        });
    };

    /**
     * Collections write straight through — there is no draft to hold a rename or
     * a publish toggle — so the conflict check is what stands between two people
     * and a lost edit.
     *
     * `environments` is the reason this matters: it is written as one array, so a
     * stale save does not lose the variable being edited, it restores every
     * variable the other person changed. On a conflict the server copy wins and
     * the local edit is dropped, with a toast that says so; silently overwriting
     * someone else's tokens is the worse outcome.
     */
    const saveFolder = async (folderId, patch) => {
        const base = foldersRef.current.find(f => idOf(f) === folderId);
        beginSave();
        try {
            const { ok, status, data } = await putGuarded(`/api/folders/${folderId}`, patch, base && base.updatedAt);
            if (status === 409) {
                if (data && data.current) {
                    setFolders(prev => prev.map(f => (
                        idOf(f) === folderId ? { ...data.current, id: idOf(data.current) } : f
                    )));
                }
                showToast(t('alerts.collection_changed_elsewhere'), 'error');
                return endSave('conflict');
            }
            if (!ok || !data) throw new Error(`HTTP ${status}`);
            // Adopting the response keeps `updatedAt` current; without it the
            // next save would carry a stale expectation and 409 against itself.
            setFolders(prev => prev.map(f => (idOf(f) === folderId ? { ...f, ...data, id: idOf(data) || idOf(f) } : f)));
            endSave('saved');
        } catch (err) {
            endSave('error');
            showToast(t('alerts.save_failed_retry'), 'error');
            console.error('Collection save failed:', err);
        }
    };

    const patchFolder = (folderId, patch, { persist = true } = {}) => {
        setFolders(prev => prev.map(f => (idOf(f) === folderId ? { ...f, ...patch } : f)));
        if (persist) saveFolder(folderId, patch);
    };

    const addDoc = () => {
        const targetFolderId = activeDoc ? (activeDoc.folderId || null) : selectedFolderId;
        showPrompt(t('actions.new_endpoint'), t('labels.enter_title'), async (title) => {
            if (!title) return;
            const res = await fetch(`/api/workspaces/${workspaceId}/docs`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title, type: 'API', content: '', folderId: targetFolderId,
                    apiSpec: {
                        method: 'GET', url: '', headers: [], queryParams: [], body: '',
                        auth: { type: 'none', addTo: 'header' }, examples: [],
                    },
                }),
            });
            if (!res.ok) return showToast(t('alerts.error'), 'error');
            const saved = await res.json();
            const savedId = idOf(saved);
            setDocs(prev => [...prev, { ...saved, id: savedId }]);
            setSelectedDocId(savedId);
            setResponse(null);
            if (targetFolderId) setExpandedFolders(prev => ({ ...prev, [targetFolderId]: true }));
            onLogActivity?.('Created API endpoint', 'api', title);
            showToast(t('alerts.document_initialized'));
        });
    };

    // Postman's most-used editing action: start from an endpoint that already
    // works rather than retyping its headers and auth.
    const duplicateDoc = async (docId) => {
        const source = apiDocs.find(d => idOf(d) === docId);
        if (!source) return;
        const res = await fetch(`/api/workspaces/${workspaceId}/docs`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: `${source.title || t('labels.untitled')} ${t('labels.copy_suffix')}`,
                type: 'API',
                content: source.content || '',
                folderId: source.folderId || null,
                apiSpec: source.apiSpec || {},
            }),
        });
        if (!res.ok) return showToast(t('alerts.error'), 'error');
        const saved = await res.json();
        const savedId = idOf(saved);
        setDocs(prev => [...prev, { ...saved, id: savedId }]);
        setSelectedDocId(savedId);
        setResponse(null);
        showToast(t('alerts.endpoint_duplicated'));
    };

    const deleteDoc = (docId) => {
        showConfirm(t('actions.destroy_document'), t('alerts.confirm_destroy_document'), async () => {
            const target = apiDocs.find(d => idOf(d) === docId);
            await fetch(`/api/docs/${docId}`, { method: 'DELETE' });
            setDocs(prev => prev.filter(d => idOf(d) !== docId));
            // Its draft has nothing left to be a draft of.
            discardDraft(docId);
            if (selectedDocId === docId) { setSelectedDocId(null); setResponse(null); }
            onLogActivity?.('Deleted API endpoint', 'api', target?.title);
            showToast(t('alerts.document_destroyed'));
        });
    };

    const moveToFolder = (docId, folderId) => {
        saveDocNow(docId, { folderId: folderId || null });
        if (folderId) setExpandedFolders(prev => ({ ...prev, [folderId]: true }));
    };

    // API collections publish to /apis/, the docs site to /docs/. The server
    // 404s a collection requested through the wrong surface, so this has to
    // match the folder's `kind`.
    const publicUrl = (folder) => (
        folder ? `${window.location.origin}/apis/${workspaceId}/${folder.slug || idOf(folder)}` : null
    );

    // A published page is always a collection; a single endpoint is reached
    // through a ?doc= deep link on its collection's page. An endpoint sitting at
    // the root belongs to no collection, so there is no page to link to — this
    // used to fall back to the endpoint's own id as the slug, which produced a
    // URL that resolved no folder and 404'd for whoever opened it.
    const publicUrlFor = (doc) => {
        const base = publicUrl(getRootFolder(doc && doc.folderId));
        return base ? `${base}?doc=${idOf(doc)}` : null;
    };

    const copyDocLink = async (doc) => {
        const root = getRootFolder(doc && doc.folderId);
        const url = publicUrlFor(doc);
        if (!url) return showToast(t('alerts.move_to_collection_to_share'), 'error');
        // A link to an unpublished collection resolves to a 404 for whoever
        // opens it, so say what is missing rather than handing one out.
        if (!root.published) return showToast(t('alerts.publish_to_share'), 'error');
        const ok = await window.copyText(url);
        showToast(ok ? t('alerts.link_copied') : t('alerts.copy_failed'), ok ? 'success' : 'error');
    };

    const copyCollectionLink = async (folder) => {
        const url = publicUrl(folder);
        if (!url) return;
        const ok = await window.copyText(url);
        showToast(ok ? t('alerts.link_copied') : t('alerts.copy_failed'), ok ? 'success' : 'error');
    };

    // --- Postman import ---------------------------------------------------
    const importInputRef = React.useRef(null);

    const importPostmanCollection = (file) => {
        if (!file) return;
        setImporting(true);
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const collection = JSON.parse(e.target.result);
                const name = (collection.info && collection.info.name) || 'Postman Import';
                const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
                const rawDesc = collection.info && collection.info.description;
                const description = typeof rawDesc === 'string' ? rawDesc : ((rawDesc && rawDesc.content) || '');

                // Collection-level `variable` entries become the seed environment,
                // so an imported collection resolves its own `{{placeholders}}`.
                const variables = (collection.variable || [])
                    .filter(v => v && v.key)
                    .map(v => ({ key: v.key, value: v.value == null ? '' : String(v.value) }));
                const baseVar = variables.find(v => NT_BASE_ALIASES.includes(v.key.toLowerCase()));
                const environments = variables.length
                    ? [{ id: window.generateId('env'), name: 'Imported', baseUrl: baseVar ? baseVar.value : '', variables }]
                    : [];

                const folderRes = await fetch(`/api/workspaces/${workspaceId}/folders`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, slug, description, environments, kind: 'API' }),
                });
                if (!folderRes.ok) throw new Error('Failed to create collection folder');
                const folder = await folderRes.json();
                const folderId = idOf(folder);
                setFolders(prev => [...prev, { ...folder, id: folderId }]);
                setExpandedFolders(prev => ({ ...prev, [folderId]: true }));

                const createdFolders = [];
                const createdDocs = [];

                const processItem = async (item, currentFolderId) => {
                    if (item.request) {
                        const req = item.request;
                        const method = (req.method || 'GET').toUpperCase();
                        const url = (req.url && req.url.raw) || (typeof req.url === 'string' ? req.url : '');
                        const headers = (req.header || [])
                            .filter(h => h && !h.disabled)
                            .map(h => ({ key: h.key, value: h.value }));
                        const queryParams = ((req.url && req.url.query) || [])
                            .filter(p => p && !p.disabled)
                            .map(p => ({ key: p.key, value: p.value }));

                        let body = '';
                        const mode = req.body && req.body.mode;
                        if (mode === 'raw') {
                            body = typeof req.body.raw === 'string' ? req.body.raw : JSON.stringify(req.body.raw, null, 2);
                        } else if (mode === 'formdata' || mode === 'urlencoded') {
                            const rows = Array.isArray(req.body[mode]) ? req.body[mode] : [];
                            body = JSON.stringify(rows.reduce((acc, cur) => {
                                if (cur && cur.key) acc[cur.key] = cur.value == null ? '' : cur.value;
                                return acc;
                            }, {}), null, 2);
                            headers.push({
                                key: 'Content-Type',
                                value: mode === 'formdata' ? 'multipart/form-data' : 'application/x-www-form-urlencoded',
                            });
                        }

                        // Postman's own auth block maps onto the auth helper, so an
                        // imported request arrives configured rather than bare.
                        const auth = { type: 'none', addTo: 'header' };
                        const pmAuth = req.auth;
                        const pmValue = (list, key) => {
                            const hit = (list || []).find(x => x && x.key === key);
                            return hit && hit.value != null ? String(hit.value) : '';
                        };
                        if (pmAuth && pmAuth.type === 'bearer') {
                            auth.type = 'bearer';
                            auth.token = pmValue(pmAuth.bearer, 'token');
                        } else if (pmAuth && pmAuth.type === 'basic') {
                            auth.type = 'basic';
                            auth.username = pmValue(pmAuth.basic, 'username');
                            auth.password = pmValue(pmAuth.basic, 'password');
                        } else if (pmAuth && pmAuth.type === 'apikey') {
                            auth.type = 'apikey';
                            auth.key = pmValue(pmAuth.apikey, 'key');
                            auth.value = pmValue(pmAuth.apikey, 'value');
                            auth.addTo = pmValue(pmAuth.apikey, 'in') === 'query' ? 'query' : 'header';
                        }

                        const rawItemDesc = req.description;
                        const res = await fetch(`/api/workspaces/${workspaceId}/docs`, {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                title: item.name || 'API Endpoint',
                                type: 'API',
                                content: typeof rawItemDesc === 'string' ? rawItemDesc : ((rawItemDesc && rawItemDesc.content) || ''),
                                folderId: currentFolderId,
                                apiSpec: {
                                    method: NT_METHODS.includes(method) ? method : 'GET',
                                    url, headers, queryParams, body, auth, examples: [],
                                },
                            }),
                        });
                        if (!res.ok) throw new Error(`Failed to import "${item.name || 'endpoint'}"`);
                        const saved = await res.json();
                        createdDocs.push({ ...saved, id: idOf(saved) });
                        return;
                    }

                    if (item.item) {
                        const subName = item.name || 'Subfolder';
                        const subSlug = subName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
                        const subRawDesc = item.description;
                        const subRes = await fetch(`/api/workspaces/${workspaceId}/folders`, {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                name: subName, slug: subSlug, parentId: currentFolderId, kind: 'API',
                                description: typeof subRawDesc === 'string' ? subRawDesc : ((subRawDesc && subRawDesc.content) || ''),
                            }),
                        });
                        if (!subRes.ok) throw new Error(`Failed to import folder "${subName}"`);
                        const subFolder = await subRes.json();
                        const subFolderId = idOf(subFolder);
                        createdFolders.push({ ...subFolder, id: subFolderId });
                        for (const child of item.item) await processItem(child, subFolderId);
                    }
                };

                for (const item of (collection.item || [])) await processItem(item, folderId);

                setFolders(prev => [...prev, ...createdFolders]);
                setDocs(prev => [...prev, ...createdDocs]);
                setSelectedFolderId(folderId);
                setSelectedDocId(null);
                onLogActivity?.('Imported Postman collection', 'api', name);
                showToast(t('alerts.postman_import_success'));
            } catch (err) {
                console.error('Postman import failed:', err);
                showAlert(`${t('alerts.postman_import_error')}: ${err.message}`, t('alerts.import_error_title'));
            } finally {
                setImporting(false);
            }
        };
        reader.onerror = () => { setImporting(false); showToast(t('alerts.error'), 'error'); };
        reader.readAsText(file);
    };

    // --- Extraction -------------------------------------------------------
    //
    // Captured values land in the selected environment, which is what makes the
    // login-then-use-the-token flow work: the next request resolves `{{token}}`
    // against a variable this one just wrote.
    const applyExtractions = (results) => {
        const found = (results || []).filter(r => r.found);
        if (!found.length) return;

        if (!envRoot || !activeEnv) {
            // Nowhere to put them. Say so rather than silently discarding.
            showToast(t('alerts.select_environment_to_extract'), 'error');
            return;
        }

        const nextEnvs = (envRoot.environments || []).map(env => {
            if (env.id !== activeEnv.id) return env;
            const vars = [...(env.variables || [])];
            found.forEach(({ into, value }) => {
                const at = vars.findIndex(v => v && v.key === into);
                if (at === -1) vars.push({ key: into, value });
                else vars[at] = { ...vars[at], value };
            });
            return { ...env, variables: vars };
        });

        patchFolder(idOf(envRoot), { environments: nextEnvs });
        showToast(t('alerts.variables_updated', { count: found.length }));
    };

    // --- Sending ----------------------------------------------------------
    //
    // Requests leave from the server, via POST /api/workspaces/:wsId/proxy.
    //
    // Two reasons, and the second is the important one. A browser `fetch` to a
    // third-party API fails outright unless that API serves permissive CORS
    // headers — which most do not. And this app patches `window.fetch` to attach
    // the user's session JWT to every URL containing `/api/` (App.jsx:9), so a
    // direct send to a target like `https://example.com/api/v1/users` would hand
    // that third party a working token for this app. Going through the proxy
    // means the only authenticated call is to our own origin, and the proxy
    // forwards nothing but the headers listed here.
    const sendRequest = async () => {
        if (!activeDoc) return;
        const req = ntBuildRequest(activeDoc, activeEnv);
        if (!req.url) return showToast(t('labels.no_url_specified'), 'error');

        setSending(true);
        setResponse(null);
        setResTab('Body');
        const started = Date.now();

        try {
            const wire = ntWireBody(req);
            const headers = req.headers.map(h => ({ ...h }));
            if (wire.contentType) {
                const existing = headers.find(h => (h.key || '').toLowerCase() === 'content-type');
                if (existing) existing.value = wire.contentType;
                else headers.push({ key: 'Content-Type', value: wire.contentType });
            }

            const res = await fetch(`/api/workspaces/${workspaceId}/proxy`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ method: req.method, url: req.url, headers, body: wire.body }),
            });

            let data = null;
            try { data = await res.json(); } catch (e) { data = null; }

            // The proxy refusing the request (blocked address, bad scheme,
            // upstream unreachable) is a different failure from the target
            // answering with an error status, and reads as one.
            if (!res.ok) {
                // Field-level validation details would otherwise be swallowed,
                // leaving a bare "Validation failed" with nothing to act on.
                const detail = (data && Array.isArray(data.errors))
                    ? data.errors.map(e => `${e.field}: ${e.message}`).join('\n')
                    : '';
                const message = (data && data.error) || res.statusText || t('alerts.proxy_failed');
                setResponse({
                    ok: false,
                    status: t('alerts.error'),
                    statusText: message,
                    time: Date.now() - started,
                    size: 0,
                    headers: [],
                    body: detail ? `${message}\n\n${detail}` : message,
                });
                return;
            }

            let pretty = data.body;
            try { pretty = JSON.stringify(JSON.parse(data.body), null, 2); } catch (e) { /* not JSON */ }

            // Assertions read the body the server actually sent, not the
            // pretty-printed copy — `contains` on raw JSON would otherwise match
            // against re-indented text the endpoint never returned.
            const raw = {
                status: data.status,
                statusText: data.statusText,
                time: data.time,
                size: data.size,
                headers: data.headers || [],
                body: data.body,
            };
            const spec = activeDoc.apiSpec || {};
            const assertions = ntRunAssertions(spec.assertions, raw);
            const extractions = ntRunExtractions(spec.extract, raw);
            applyExtractions(extractions);

            setResponse({
                ok: true,
                status: data.status,
                statusText: data.statusText,
                time: data.time,
                size: data.size,
                headers: data.headers || [],
                body: pretty,
                truncated: data.truncated,
                // Set by the proxy only when a redirect was actually followed.
                finalUrl: data.finalUrl || null,
                assertions,
                extractions,
            });
        } catch (err) {
            setResponse({
                ok: false,
                status: t('alerts.error'),
                statusText: err.message,
                time: Date.now() - started,
                size: 0,
                headers: [],
                body: `${t('alerts.proxy_failed')}\n\n${err.message}`,
            });
        } finally {
            setSending(false);
        }
    };

    // Ctrl/Cmd+Enter sends, from anywhere in the tab including inside the URL
    // field and the body textarea — the shortcut every API client has.
    // `sendRequest` closes over state that changes every render, so the listener
    // reads it through a ref rather than being torn down and rebuilt each time.
    const sendRef = React.useRef(sendRequest);
    sendRef.current = sendRequest;

    const saveRef = React.useRef(saveDoc);
    saveRef.current = saveDoc;
    const selectedDocRef = React.useRef(selectedDocId);
    selectedDocRef.current = selectedDocId;

    React.useEffect(() => {
        const onKeyDown = (event) => {
            if (!(event.metaKey || event.ctrlKey)) return;
            if (event.key === 'Enter') {
                event.preventDefault();
                sendRef.current();
                return;
            }
            // Ctrl/Cmd+S saves the open endpoint. preventDefault or the browser
            // offers to save the page to disk instead.
            if (event.key === 's' || event.key === 'S') {
                event.preventDefault();
                saveRef.current(selectedDocRef.current);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);

    // Drafts outlive a reload, but a closed tab is worth one question — the work
    // is only on this machine until it is saved.
    React.useEffect(() => {
        const onBeforeUnload = (event) => {
            if (!Object.keys(draftsRef.current).length) return;
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, []);

    // --- Split handling ---------------------------------------------------
    const splitRef = React.useRef(null);

    const clampSplit = (pct) => Math.min(75, Math.max(25, pct));

    const startSplitDrag = (event) => {
        const container = splitRef.current;
        if (!container) return;
        event.preventDefault();
        const rect = container.getBoundingClientRect();
        const onMove = (moveEvent) => {
            setSplitPct(clampSplit(((moveEvent.clientX - rect.left) / rect.width) * 100));
        };
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
        // Dragging over a text field would otherwise select its contents.
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    };

    const copyResponseBody = async () => {
        if (!response) return;
        const ok = await window.copyText(response.body || '');
        showToast(ok ? t('alerts.copied_to_clipboard') : t('alerts.copy_failed'), ok ? 'success' : 'error');
    };

    const copyCode = async () => {
        if (!builtRequest) return;
        const lang = NT_CODE_LANGS.find(l => l.id === codeLang) || NT_CODE_LANGS[0];
        const ok = await window.copyText(lang.render(builtRequest));
        showToast(ok ? t('alerts.code_copied') : t('alerts.copy_failed'), ok ? 'success' : 'error');
    };

    // --- Render helpers ---------------------------------------------------
    const rowBase = 'flex items-center gap-1.5 px-2 py-1.5 rounded-[7px] text-[12.8px] cursor-pointer select-none transition-colors group focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0A84FF]';
    const rowIdle = 'text-[#171719] hover:bg-[#F0F0F2]';
    const rowActive = 'bg-[#EAF3FF] text-[#0670DE] font-semibold';
    const iconBtn = 'p-1 rounded text-[#A5A5AA] hover:text-[#0A84FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0A84FF] transition-colors';
    // Visible on touch (no hover to reveal them), hover- or focus-revealed on md+.
    const rowActions = 'flex md:hidden md:group-hover:flex md:group-focus-within:flex items-center gap-0.5 flex-shrink-0';
    const fieldCls = 'bg-white border border-[#DEDEDE] rounded-[6px] px-2.5 py-[7px] text-[12.5px] outline-none focus:border-[#0A84FF] transition-colors';
    const monoField = `${fieldCls} font-mono text-[12px]`;

    // What the last write did, next to the title. Unsaved wins over everything:
    // a stale "Saved" beside edited fields is the one thing this must never say.
    const renderSaveState = (dirty) => {
        const states = {
            dirty: { icon: 'circle-dashed', label: t('labels.unsaved_changes'), cls: 'text-[#9A6400]' },
            saving: { icon: 'loader', label: t('labels.saving'), cls: 'text-[#A5A5AA] animate-pulse' },
            saved: { icon: 'check', label: t('labels.saved'), cls: 'text-[#1A7F52]' },
            error: { icon: 'alert-triangle', label: t('labels.save_failed'), cls: 'text-[#C4363A]' },
            conflict: { icon: 'users', label: t('labels.changed_elsewhere'), cls: 'text-[#C4363A]' },
        };
        // A refused write outranks "unsaved": both are true afterwards, and only
        // one of them says the save was attempted and turned down.
        const state = (saveState === 'error' || saveState === 'conflict')
            ? states[saveState]
            : (dirty && saveState !== 'saving' ? states.dirty : states[saveState]);
        if (!state) return null;
        return (
            <span
                className={`flex items-center gap-1 text-[11.5px] font-semibold flex-shrink-0 ${state.cls}`}
                role="status"
                aria-live="polite"
            >
                <window.Icon name={state.icon} size={12} />
                <span className="hidden sm:inline">{state.label}</span>
            </span>
        );
    };

    const methodBadge = (method, extra = '') => (
        <span className={`font-mono text-[9.5px] font-bold px-1 py-0.5 rounded-[4px] w-[42px] text-center flex-shrink-0 ${NT_METHOD_STYLE[method] || NT_METHOD_STYLE.GET} ${extra}`}>
            {method || 'GET'}
        </span>
    );

    const renderDocRow = (doc, depth = 0) => {
        const docId = idOf(doc);
        const isActive = selectedDocId === docId;
        const open = () => {
            setSelectedDocId(docId);
            setSelectedFolderId(doc.folderId || null);
            setResponse(null);
            setEditingNotes(false);
            setShowMobileSidebar(false);
        };
        return (
            <div
                key={docId}
                onClick={open}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
                role="button"
                tabIndex={0}
                aria-current={isActive ? 'true' : undefined}
                className={`${rowBase} ${isActive ? rowActive : rowIdle}`}
                style={{ paddingLeft: `${8 + depth * 14}px` }}
            >
                {methodBadge((doc.apiSpec || {}).method)}
                <span className="flex-1 truncate">{doc.title || t('labels.untitled')}</span>
                {/* Postman's unsaved dot: which endpoints still hold work is
                    otherwise invisible the moment you select another one. */}
                {isDirty(docId) && (
                    <span
                        className="w-[7px] h-[7px] rounded-full bg-[#F5A623] flex-shrink-0"
                        title={t('labels.unsaved_changes')}
                        aria-label={t('labels.unsaved_changes')}
                    />
                )}
                {doc.passwordProtected && <window.Icon name="lock" size={11} className="text-[#A5A5AA] flex-shrink-0" />}
                {/* Row actions were hover-only, which put them out of reach of
                    touch and keyboard entirely. Always present on small screens,
                    revealed by hover *or* focus from md up. */}
                <span className={rowActions}>
                    <button
                        onClick={(e) => { e.stopPropagation(); duplicateDoc(docId); }}
                        className={iconBtn}
                        title={t('actions.duplicate')}
                        aria-label={t('actions.duplicate')}
                    >
                        <window.Icon name="copy" size={12} />
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); deleteDoc(docId); }}
                        className="p-1 rounded text-[#A5A5AA] hover:text-[#E5484D] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0A84FF] transition-colors"
                        title={t('actions.destroy_document')}
                        aria-label={t('actions.destroy_document')}
                    >
                        <window.Icon name="trash-2" size={12} />
                    </button>
                </span>
            </div>
        );
    };

    // `ancestors` carries the folders already on the path from the root. A
    // parentId loop would otherwise recurse forever here too, the same way it
    // did in getRootFolder — this time inside React's render.
    const renderFolderRow = (folder, depth = 0, ancestors = []) => {
        const folderId = idOf(folder);
        if (ancestors.includes(folderId)) return null;
        const isExpanded = !!expandedFolders[folderId] || !!q;
        const isActive = !selectedDocId && selectedFolderId === folderId;
        const subs = subfoldersOf(folderId).filter(folderMatches);
        const own = docsIn(folderId);
        const openFolder = () => {
            toggleFolder(folderId);
            setSelectedFolderId(folderId);
            setSelectedDocId(null);
            setEditingNotes(false);
        };
        return (
            <div key={folderId} className="mb-0.5">
                <div
                    onClick={openFolder}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFolder(); } }}
                    role="button"
                    tabIndex={0}
                    aria-expanded={isExpanded}
                    aria-current={isActive ? 'true' : undefined}
                    className={`${rowBase} ${isActive ? rowActive : rowIdle}`}
                    style={{ paddingLeft: `${8 + depth * 14}px` }}
                >
                    <window.Icon name="chevron-right" size={12} className={`text-[#A5A5AA] flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                    <window.Icon name={isExpanded ? 'folder-open' : 'folder'} size={15} className="text-[#9AA0A6] flex-shrink-0" />
                    <span className="flex-1 truncate">{folder.name}</span>
                    {/* Collection state at a glance: published, and whether it
                        carries environments the endpoints below inherit. */}
                    {/* `Icon` renders a lucide glyph and drops unknown props, so the
                        tooltip lives on a wrapper. */}
                    {!folder.parentId && folder.published && (
                        <span className="flex-shrink-0 text-[#1A7F52]" title={t('labels.public_page')}>
                            <window.Icon name="globe" size={11} />
                        </span>
                    )}
                    {!folder.parentId && (folder.environments || []).length > 0 && (
                        <window.Icon name="layers" size={11} className="text-[#A5A5AA] flex-shrink-0" />
                    )}
                    <span className={rowActions}>
                        {/* Only a published collection has a page to open; the rest
                            would land on the same 404 an outsider gets. */}
                        {!folder.parentId && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (!folder.published) return showToast(t('alerts.publish_to_share'), 'error');
                                    window.open(publicUrl(folder), '_blank');
                                }}
                                className={iconBtn}
                                title={folder.published ? t('actions.open_public_page') : t('alerts.publish_to_share')}
                            >
                                <window.Icon name={folder.published ? 'external-link' : 'lock'} size={12} />
                            </button>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); deleteFolder(folderId); }} className="p-1 rounded text-[#A5A5AA] hover:text-[#E5484D] transition-colors" title={t('actions.destroy_folder')}>
                            <window.Icon name="trash-2" size={12} />
                        </button>
                    </span>
                </div>
                {isExpanded && (
                    <div>
                        {subs.map(sub => renderFolderRow(sub, depth + 1, [...ancestors, folderId]))}
                        {own.map(doc => renderDocRow(doc, depth + 1))}
                        {subs.length === 0 && own.length === 0 && (
                            <div className="text-[11px] text-[#A5A5AA] italic py-1" style={{ paddingLeft: `${22 + depth * 14}px` }}>
                                {t('labels.empty')}
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    // A key/value editor shared by the Params and Headers tabs.
    const renderKeyValues = (rows, onChange, addLabel) => (
        <div className="space-y-1.5">
            {rows.length === 0 && (
                <p className="text-[12px] text-[#A5A5AA] italic pb-1">{t('labels.empty')}</p>
            )}
            {rows.map((row, i) => (
                <div key={i} className="flex gap-1.5 items-center">
                    <input
                        className={`${monoField} flex-1 min-w-0`}
                        placeholder={t('labels.key')}
                        value={row.key || ''}
                        aria-label={t('labels.key')}
                        spellCheck={false}
                        onChange={e => {
                            const next = rows.map((r, idx) => (idx === i ? { ...r, key: e.target.value } : r));
                            onChange(next);
                        }}
                    />
                    <input
                        className={`${monoField} flex-1 min-w-0`}
                        placeholder={t('labels.value')}
                        value={row.value || ''}
                        aria-label={t('labels.value')}
                        spellCheck={false}
                        onChange={e => {
                            const next = rows.map((r, idx) => (idx === i ? { ...r, value: e.target.value } : r));
                            onChange(next);
                        }}
                    />
                    <button
                        onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
                        className="p-1.5 rounded-[6px] text-[#A5A5AA] hover:text-[#E5484D] hover:bg-[#FCECEC] transition-colors flex-shrink-0"
                        title={t('actions.delete_item')}
                        aria-label={t('actions.delete_item')}
                    >
                        <window.Icon name="trash-2" size={13} />
                    </button>
                </div>
            ))}
            <button
                onClick={() => onChange([...rows, { key: '', value: '' }])}
                className="mt-1 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#0A84FF] hover:text-[#0670DE] transition-colors"
            >
                <window.Icon name="plus" size={13} /> {addLabel}
            </button>
        </div>
    );

    const renderAuthTab = (doc) => {
        const auth = (doc.apiSpec && doc.apiSpec.auth) || { type: 'none', addTo: 'header' };
        const setAuth = (patch) => updateSpec(doc, { auth: { ...auth, ...patch } });
        const types = [
            { id: 'none', label: t('labels.auth_none') || 'No Auth' },
            { id: 'bearer', label: t('labels.auth_bearer') || 'Bearer Token' },
            { id: 'basic', label: t('labels.auth_basic') || 'Basic Auth' },
            { id: 'apikey', label: t('labels.api_key') },
        ];
        return (
            <div className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                    {types.map(ty => (
                        <button
                            key={ty.id}
                            onClick={() => setAuth({ type: ty.id })}
                            className={`rounded-[6px] border px-2.5 py-[6px] text-[12px] font-semibold transition-colors ${
                                (auth.type || 'none') === ty.id
                                    ? 'border-[#0A84FF] bg-[#EAF3FF] text-[#0670DE]'
                                    : 'border-[#DEDEDE] bg-white text-[#6E6E73] hover:border-[#0A84FF]'
                            }`}
                        >
                            {ty.label}
                        </button>
                    ))}
                </div>

                {auth.type === 'bearer' && (
                    <label className="block">
                        <span className="text-[11px] font-semibold text-[#6E6E73]">{t('labels.token') || 'Token'}</span>
                        <input
                            className={`${monoField} w-full mt-1`}
                            placeholder="{{authToken}}"
                            value={auth.token || ''}
                            onChange={e => setAuth({ token: e.target.value })}
                        />
                    </label>
                )}

                {auth.type === 'basic' && (
                    <div className="grid grid-cols-2 gap-2">
                        <label className="block">
                            <span className="text-[11px] font-semibold text-[#6E6E73]">{t('labels.username') || 'Username'}</span>
                            <input className={`${monoField} w-full mt-1`} value={auth.username || ''} onChange={e => setAuth({ username: e.target.value })} />
                        </label>
                        <label className="block">
                            <span className="text-[11px] font-semibold text-[#6E6E73]">{t('labels.password')}</span>
                            <input className={`${monoField} w-full mt-1`} value={auth.password || ''} onChange={e => setAuth({ password: e.target.value })} />
                        </label>
                    </div>
                )}

                {auth.type === 'apikey' && (
                    <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                            <label className="block">
                                <span className="text-[11px] font-semibold text-[#6E6E73]">{t('labels.key')}</span>
                                <input className={`${monoField} w-full mt-1`} placeholder="X-API-Key" value={auth.key || ''} onChange={e => setAuth({ key: e.target.value })} />
                            </label>
                            <label className="block">
                                <span className="text-[11px] font-semibold text-[#6E6E73]">{t('labels.value')}</span>
                                <input className={`${monoField} w-full mt-1`} value={auth.value || ''} onChange={e => setAuth({ value: e.target.value })} />
                            </label>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-[11px] font-semibold text-[#6E6E73]">{t('labels.add_to') || 'Add to'}</span>
                            {[
                                { id: 'header', label: t('labels.headers') },
                                { id: 'query', label: t('labels.params') },
                            ].map(opt => (
                                <button
                                    key={opt.id}
                                    onClick={() => setAuth({ addTo: opt.id })}
                                    className={`rounded-[6px] border px-2.5 py-[5px] text-[11.5px] font-semibold transition-colors ${
                                        (auth.addTo || 'header') === opt.id
                                            ? 'border-[#0A84FF] bg-[#EAF3FF] text-[#0670DE]'
                                            : 'border-[#DEDEDE] bg-white text-[#6E6E73] hover:border-[#0A84FF]'
                                    }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {(!auth.type || auth.type === 'none') && (
                    <p className="text-[12px] text-[#6E6E73] leading-relaxed bg-[#FAFAFA] border border-[#ECECEC] rounded-[6px] px-3 py-2.5">
                        {t('labels.auth_via_headers')}
                    </p>
                )}
            </div>
        );
    };

    const renderTestsTab = (doc) => {
        const spec = doc.apiSpec || {};
        const assertions = spec.assertions || [];
        const extract = spec.extract || [];
        // Results only line up with the rules that produced them, so they are
        // dropped the moment the rules are edited.
        const results = (response && response.assertions) || [];

        const setAssertions = (next) => updateSpec(doc, { assertions: next });
        const setExtract = (next) => updateSpec(doc, { extract: next });

        const patchRow = (rows, i, patch, apply) => apply(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

        const selectCls = `${fieldCls} font-semibold cursor-pointer flex-shrink-0`;

        return (
            <div className="space-y-5">
                <section>
                    <h4 className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#A5A5AA] mb-2">
                        {t('labels.assertions') || 'Assertions'}
                    </h4>

                    {assertions.length === 0 && (
                        <p className="text-[12px] text-[#A5A5AA] italic pb-1">{t('labels.no_assertions') || 'No checks yet.'}</p>
                    )}

                    <div className="space-y-1.5">
                        {assertions.map((row, i) => {
                            const source = row.source || 'status';
                            const op = row.op || 'eq';
                            const result = results[i];
                            return (
                                <div key={i} className="flex gap-1.5 items-center flex-wrap">
                                    {result && (
                                        <span
                                            className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${result.passed ? 'bg-[#E6F6EE] text-[#1A7F52]' : 'bg-[#FCECEC] text-[#C4363A]'}`}
                                            title={result.passed ? t('labels.passed') : `${t('labels.actual') || 'Actual'}: ${result.actual || '(none)'}`}
                                        >
                                            <window.Icon name={result.passed ? 'check' : 'x'} size={10} />
                                        </span>
                                    )}
                                    <select className={selectCls} value={source}
                                        onChange={e => patchRow(assertions, i, { source: e.target.value }, setAssertions)}>
                                        {NT_ASSERT_SOURCES.map(s => <option key={s} value={s}>{t(`labels.src_${s}`) || s}</option>)}
                                    </select>
                                    {ntSourceNeedsPath(source) && (
                                        <input
                                            className={`${monoField} flex-1 min-w-[110px]`}
                                            placeholder={source === 'header' ? 'content-type' : 'data.token'}
                                            value={row.path || ''}
                                            onChange={e => patchRow(assertions, i, { path: e.target.value }, setAssertions)}
                                        />
                                    )}
                                    <select className={selectCls} value={op}
                                        onChange={e => patchRow(assertions, i, { op: e.target.value }, setAssertions)}>
                                        {NT_ASSERT_OPS.map(o => <option key={o.id} value={o.id}>{t(`labels.op_${o.id}`) || o.id}</option>)}
                                    </select>
                                    {ntOpNeedsValue(op) && (
                                        <input
                                            className={`${monoField} flex-1 min-w-[80px]`}
                                            placeholder={t('labels.value')}
                                            value={row.value || ''}
                                            onChange={e => patchRow(assertions, i, { value: e.target.value }, setAssertions)}
                                        />
                                    )}
                                    <button
                                        onClick={() => setAssertions(assertions.filter((_, idx) => idx !== i))}
                                        className="p-1.5 rounded-[6px] text-[#A5A5AA] hover:text-[#E5484D] hover:bg-[#FCECEC] transition-colors flex-shrink-0"
                                        title={t('actions.delete_item')}
                                    >
                                        <window.Icon name="trash-2" size={13} />
                                    </button>
                                    {result && !result.passed && (
                                        <p className="w-full font-mono text-[11px] text-[#C4363A] pl-6 -mt-0.5 truncate">
                                            {t('labels.actual') || 'Actual'}: {result.actual === '' ? '(none)' : result.actual}
                                        </p>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    <button
                        onClick={() => setAssertions([...assertions, { source: 'status', op: 'eq', value: '200' }])}
                        className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#0A84FF] hover:text-[#0670DE] transition-colors"
                    >
                        <window.Icon name="plus" size={13} /> {t('actions.add_assertion') || 'Add Assertion'}
                    </button>
                </section>

                <section className="border-t border-[#ECECEC] pt-4">
                    <h4 className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#A5A5AA] mb-1">
                        {t('labels.extract_variables') || 'Extract to variables'}
                    </h4>
                    <p className="text-[11.5px] text-[#6E6E73] mb-2.5 leading-relaxed">
                        {t('labels.extract_hint') || 'Captured values are written to the selected environment, so the next request can use them as {{variables}}.'}
                    </p>

                    <div className="space-y-1.5">
                        {extract.map((row, i) => {
                            const captured = ((response && response.extractions) || []).find(x => x.into === row.into);
                            return (
                                <div key={i} className="flex gap-1.5 items-center">
                                    <select className={selectCls} value={row.from || 'body'}
                                        onChange={e => patchRow(extract, i, { from: e.target.value }, setExtract)}>
                                        {['body', 'header', 'rawBody'].map(s => <option key={s} value={s}>{t(`labels.src_${s}`) || s}</option>)}
                                    </select>
                                    <input
                                        className={`${monoField} flex-1 min-w-0`}
                                        placeholder={(row.from || 'body') === 'header' ? 'x-request-id' : 'data.token'}
                                        value={row.path || ''}
                                        onChange={e => patchRow(extract, i, { path: e.target.value }, setExtract)}
                                    />
                                    <span className="text-[11px] text-[#A5A5AA] flex-shrink-0">→</span>
                                    <input
                                        className={`${monoField} w-32 flex-shrink-0`}
                                        placeholder="authToken"
                                        value={row.into || ''}
                                        onChange={e => patchRow(extract, i, { into: e.target.value }, setExtract)}
                                    />
                                    {captured && (
                                        <span
                                            className={`text-[10px] font-semibold rounded-[4px] px-1.5 py-0.5 flex-shrink-0 ${captured.found ? 'bg-[#E6F6EE] text-[#1A7F52]' : 'bg-[#FDF3E0] text-[#9A6400]'}`}
                                            title={captured.found ? captured.value : (t('labels.not_found') || 'Not found')}
                                        >
                                            {captured.found ? t('labels.captured') || 'captured' : t('labels.not_found') || 'not found'}
                                        </span>
                                    )}
                                    <button
                                        onClick={() => setExtract(extract.filter((_, idx) => idx !== i))}
                                        className="p-1.5 rounded-[6px] text-[#A5A5AA] hover:text-[#E5484D] hover:bg-[#FCECEC] transition-colors flex-shrink-0"
                                        title={t('actions.delete_item')}
                                    >
                                        <window.Icon name="trash-2" size={13} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>

                    <button
                        onClick={() => setExtract([...extract, { from: 'body', path: '', into: '' }])}
                        className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#0A84FF] hover:text-[#0670DE] transition-colors"
                    >
                        <window.Icon name="plus" size={13} /> {t('actions.add_extraction') || 'Add Extraction'}
                    </button>
                </section>
            </div>
        );
    };

    if (loading) {
        return <div className="p-10 text-center text-[#6E6E73] animate-pulse">{t('labels.loading_api_reference')}</div>;
    }

    const visibleRootFolders = rootFolders.filter(folderMatches);
    const nothingToShow = visibleRootFolders.length === 0 && rootDocs.length === 0;
    const activeSpec = (activeDoc && activeDoc.apiSpec) || {};
    // Sending with no URL used to be a click that produced only a toast. The
    // button now says so before it is pressed.
    const canSend = !!(builtRequest && builtRequest.url);
    const isMac = (window.navigator.platform || '').indexOf('Mac') === 0;
    const sendShortcut = isMac ? '⌘↵' : 'Ctrl+↵';
    const saveShortcut = isMac ? '⌘S' : 'Ctrl+S';
    const activeDirty = !!(activeDoc && isDirty(idOf(activeDoc)));
    const bodyJsonError = ntJsonError(activeSpec.body);
    const codeSnippet = builtRequest
        ? (NT_CODE_LANGS.find(l => l.id === codeLang) || NT_CODE_LANGS[0]).render(builtRequest)
        : '';

    return (
        <div className="flex h-[calc(100vh-64px)] overflow-hidden bg-white text-[#171719] animate-fade-in">
            {/* Sidebar */}
            <aside className={`${showMobileSidebar ? 'fixed inset-0 z-50 flex w-full' : 'hidden'} md:flex md:w-[272px] md:flex-shrink-0 bg-[#FAFAFA] border-r border-[#ECECEC] flex-col min-h-0`}>
                <div className="px-3.5 pt-3.5 pb-2.5 flex flex-col gap-2.5">
                    <div className="flex items-start justify-between">
                        <div>
                            <div className="text-[13px] font-bold leading-tight">{t('labels.api_collection')}</div>
                            <div className="font-mono text-[11px] text-[#A5A5AA] mt-0.5">
                                API · {apiDocs.length} {apiDocs.length === 1 ? t('labels.endpoint') : t('labels.endpoints')}
                                {dirtyCount > 0 && (
                                    <span className="text-[#9A6400]"> · {dirtyCount} {t('labels.unsaved')}</span>
                                )}
                            </div>
                        </div>
                        {showMobileSidebar && (
                            <button onClick={() => setShowMobileSidebar(false)} className="md:hidden p-1.5 text-[#6E6E73] hover:bg-[#F0F0F2] rounded-md">
                                <window.Icon name="x" size={18} />
                            </button>
                        )}
                    </div>
                    <div className="flex gap-1.5">
                        <button
                            onClick={addFolder}
                            className="flex-1 flex items-center justify-center gap-1.5 border border-[#DEDEDE] bg-white rounded-[6px] px-2.5 py-[7px] text-[12.5px] font-semibold hover:border-[#0A84FF] hover:bg-[#EAF3FF] hover:text-[#0670DE] transition-colors"
                        >
                            <window.Icon name="plus" size={14} /> {t('actions.new_collection') || 'Collection'}
                        </button>
                        <button
                            onClick={() => importInputRef.current && importInputRef.current.click()}
                            disabled={importing}
                            className="flex items-center justify-center border border-[#DEDEDE] bg-white rounded-[6px] px-2.5 py-[7px] text-[#6E6E73] hover:border-[#0A84FF] hover:text-[#0A84FF] transition-colors disabled:opacity-50"
                            title={t('actions.import_postman')}
                            aria-label={t('actions.import_postman')}
                        >
                            <window.Icon name={importing ? 'loader' : 'upload-cloud'} size={14} className={importing ? 'animate-spin' : ''} />
                        </button>
                        <button
                            onClick={addDoc}
                            className="flex items-center justify-center gap-1.5 bg-[#0A84FF] border border-[#0A84FF] text-white rounded-[6px] px-2.5 py-[7px] text-[12.5px] font-semibold hover:bg-[#0670DE] transition-colors"
                            title={t('actions.new_endpoint')}
                            aria-label={t('actions.new_endpoint')}
                        >
                            <window.Icon name="zap" size={14} />
                        </button>
                        <input
                            ref={importInputRef}
                            type="file"
                            accept=".json"
                            className="hidden"
                            onChange={e => { importPostmanCollection(e.target.files[0]); e.target.value = ''; }}
                        />
                    </div>
                </div>

                <div className="mx-3.5 mb-1.5 flex items-center gap-[7px] bg-white border border-[#ECECEC] rounded-[6px] px-2.5 py-1.5">
                    <window.Icon name="search" size={14} className="text-[#A5A5AA] flex-shrink-0" />
                    <input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder={t('labels.search_endpoints')}
                        aria-label={t('labels.search_endpoints')}
                        type="search"
                        className="w-full bg-transparent border-none outline-none text-[12.5px] placeholder:text-[#A5A5AA]"
                    />
                    {query && (
                        <button
                            onClick={() => setQuery('')}
                            className="text-[#A5A5AA] hover:text-[#171719]"
                            aria-label={t('actions.clear') || 'Clear'}
                        >
                            <window.Icon name="x" size={12} />
                        </button>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto px-2 pb-4 pt-0.5">
                    {visibleRootFolders.map(folder => renderFolderRow(folder))}

                    {rootDocs.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-[#ECECEC]">
                            <p className="text-[10px] font-bold uppercase tracking-[0.06em] text-[#A5A5AA] px-2 pb-1.5">
                                {t('labels.root_documents')}
                            </p>
                            {rootDocs.map(doc => renderDocRow(doc))}
                        </div>
                    )}

                    {nothingToShow && (
                        <p className="text-[12px] text-[#A5A5AA] italic text-center px-4 mt-8 leading-relaxed">
                            {q ? t('labels.no_results') : t('labels.no_endpoints_found')}
                        </p>
                    )}
                </div>
            </aside>

            {/* Main */}
            <main className="flex-1 flex flex-col min-w-0 min-h-0">
                {activeDoc ? (
                    <React.Fragment>
                        {/* Endpoint header */}
                        <div className="flex items-center justify-between gap-4 px-5 md:px-8 py-3.5 border-b border-[#ECECEC] flex-shrink-0">
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                <button onClick={() => setShowMobileSidebar(true)} className="md:hidden p-1.5 text-[#6E6E73] hover:bg-[#F0F0F2] rounded-md flex-shrink-0">
                                    <window.Icon name="menu" size={18} />
                                </button>
                                <input
                                    className="text-[19px] font-extrabold tracking-[-0.01em] bg-transparent outline-none border-b border-dashed border-transparent hover:border-[#DEDEDE] focus:border-[#0A84FF] min-w-0 flex-1 max-w-md"
                                    value={activeDoc.title || ''}
                                    onChange={e => updateDoc(idOf(activeDoc), { title: e.target.value })}
                                    aria-label={t('labels.endpoint_title') || 'Endpoint title'}
                                />
                                {renderSaveState(activeDirty)}
                            </div>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                                {/* Save is the primary action while there is something to
                                    save, and steps back to a plain button when there is
                                    not — so "is my work stored?" is answerable from the
                                    button alone. */}
                                <button
                                    onClick={() => saveDoc(idOf(activeDoc))}
                                    disabled={!activeDirty || saveState === 'saving'}
                                    title={`${t('actions.save')} (${saveShortcut})`}
                                    className={`flex items-center gap-1.5 rounded-[6px] px-3 py-[7px] text-[12.5px] font-semibold border transition-colors disabled:cursor-default ${
                                        activeDirty
                                            ? 'bg-[#0A84FF] border-[#0A84FF] text-white hover:bg-[#0670DE]'
                                            : 'bg-white border-[#DEDEDE] text-[#A5A5AA]'
                                    }`}
                                >
                                    <window.Icon name={saveState === 'saving' ? 'loader' : 'save'} size={13} className={saveState === 'saving' ? 'animate-spin' : ''} />
                                    {t('actions.save')}
                                    <kbd className="hidden lg:inline font-sans text-[10px] font-semibold opacity-70 border border-current rounded px-1 py-px ml-0.5">
                                        {saveShortcut}
                                    </kbd>
                                </button>
                                {activeDirty && (
                                    <button
                                        onClick={() => showConfirm(t('actions.discard_changes'), t('alerts.confirm_discard_draft'), () => discardDraft(idOf(activeDoc)))}
                                        className="border border-[#DEDEDE] rounded-[6px] p-[7px] text-[#6E6E73] hover:border-[#E5484D] hover:text-[#E5484D] transition-colors"
                                        title={t('actions.discard_changes')}
                                        aria-label={t('actions.discard_changes')}
                                    >
                                        <window.Icon name="undo-2" size={14} />
                                    </button>
                                )}
                                <select
                                    className={`${fieldCls} text-[#6E6E73] font-semibold cursor-pointer hidden sm:block`}
                                    value={activeDoc.folderId || ''}
                                    onChange={e => moveToFolder(idOf(activeDoc), e.target.value || null)}
                                    aria-label={t('labels.collection') || 'Collection'}
                                >
                                    <option value="">{t('labels.no_folder_root')}</option>
                                    {/* API collections only. Moving an endpoint into a
                                        docs folder would hide it from both pages: this
                                        tab lists API-kind folders, the Docs tab lists
                                        API endpoints nowhere. */}
                                    {folders.filter(isApiFolder).map(f => <option key={idOf(f)} value={idOf(f)}>{f.name}</option>)}
                                </select>
                                <button
                                    onClick={() => copyDocLink(activeDoc)}
                                    className="border border-[#DEDEDE] rounded-[6px] p-[7px] text-[#6E6E73] hover:border-[#0A84FF] transition-colors"
                                    title={t('actions.copy_link')}
                                    aria-label={t('actions.copy_link')}
                                >
                                    <window.Icon name="link" size={14} />
                                </button>
                                <button
                                    onClick={() => { setShowNotes(!showNotes); setEditingNotes(false); }}
                                    className={`border rounded-[6px] p-[7px] transition-colors ${showNotes ? 'border-[#0A84FF] bg-[#EAF3FF] text-[#0670DE]' : 'border-[#DEDEDE] text-[#6E6E73] hover:border-[#0A84FF]'}`}
                                    title={t('labels.notes') || 'Notes'}
                                    aria-label={t('labels.notes') || 'Notes'}
                                    aria-pressed={showNotes}
                                >
                                    <window.Icon name="file-text" size={14} />
                                </button>
                            </div>
                        </div>

                        {/* Request bar */}
                        <div className="px-5 md:px-8 py-3 border-b border-[#ECECEC] flex-shrink-0 flex flex-col gap-2">
                            <div className="flex items-center gap-1.5">
                                {envs.length > 0 && (
                                    <select
                                        className={`${fieldCls} font-semibold cursor-pointer flex-shrink-0`}
                                        value={activeEnvId}
                                        onChange={e => setActiveEnvId(e.target.value)}
                                        title={t('labels.environment')}
                                        aria-label={t('labels.environment')}
                                    >
                                        <option value="">{t('labels.no_environment')}</option>
                                        {envs.map(env => <option key={env.id} value={env.id}>{env.name}</option>)}
                                    </select>
                                )}
                                <select
                                    className={`${fieldCls} font-mono font-bold cursor-pointer flex-shrink-0 ${NT_METHOD_STYLE[activeSpec.method] || ''}`}
                                    value={activeSpec.method || 'GET'}
                                    onChange={e => updateSpec(activeDoc, { method: e.target.value })}
                                    aria-label={t('labels.method') || 'Method'}
                                >
                                    {NT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                                </select>
                                <input
                                    className={`${monoField} flex-1 min-w-0`}
                                    placeholder="https://api.example.com/v1/resource"
                                    value={activeSpec.url || ''}
                                    onChange={e => updateSpec(activeDoc, { url: e.target.value })}
                                    aria-label={t('labels.request_url') || 'Request URL'}
                                />
                                <button
                                    onClick={sendRequest}
                                    disabled={sending || !canSend}
                                    className="flex items-center gap-1.5 bg-[#0A84FF] border border-[#0A84FF] text-white rounded-[6px] px-4 py-[7px] text-[12.5px] font-semibold hover:bg-[#0670DE] transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex-shrink-0"
                                    title={canSend ? `${t('actions.send_request')} (${sendShortcut})` : t('labels.no_url_specified')}
                                >
                                    <window.Icon name={sending ? 'loader' : 'send'} size={13} className={sending ? 'animate-spin' : ''} />
                                    <span className="hidden sm:inline">{sending ? t('actions.sending') : t('actions.send_request')}</span>
                                    <kbd className="hidden lg:inline font-sans text-[10px] font-semibold opacity-70 border border-white/40 rounded px-1 py-px ml-0.5">
                                        {sendShortcut}
                                    </kbd>
                                </button>
                            </div>

                            {/* The resolved URL is the one that will actually be sent, so it is
                                shown whenever substitution or a base URL changed anything. */}
                            {builtRequest && builtRequest.url && builtRequest.url !== (activeSpec.url || '') && (
                                <div className="flex items-center gap-1.5 font-mono text-[11px] text-[#6E6E73] min-w-0">
                                    <window.Icon name="corner-down-right" size={12} className="text-[#A5A5AA] flex-shrink-0" />
                                    <span className="truncate" title={builtRequest.url}>{builtRequest.url}</span>
                                    {activeEnv && (
                                        <span className="flex-shrink-0 text-[10px] font-semibold bg-[#EAF3FF] text-[#0670DE] rounded-[4px] px-1.5 py-0.5">
                                            {t('labels.env_applied')}: {activeEnv.name}
                                        </span>
                                    )}
                                </div>
                            )}

                            {builtRequest && builtRequest.missing.length > 0 && (
                                <div className="flex items-center gap-1.5 text-[11.5px] text-[#9A6400] bg-[#FDF3E0] border border-[#F5E3BE] rounded-[6px] px-2.5 py-1.5">
                                    <window.Icon name="alert-triangle" size={12} className="flex-shrink-0" />
                                    <span className="truncate">
                                        {t('labels.unresolved_vars') || 'Unresolved variables'}: {builtRequest.missing.map(v => `{{${v}}}`).join(', ')}
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* Request / response split. Stacked below lg, where a
                            draggable vertical divider has nothing to divide. */}
                        <div
                            ref={splitRef}
                            className="relative flex-1 min-h-0 grid grid-rows-2 lg:grid-rows-1 lg:grid-cols-[var(--nt-split)]"
                            style={{ '--nt-split': `${splitPct}% ${100 - splitPct}%` }}
                        >
                            {/* Request */}
                            <section className="flex flex-col min-h-0 border-b lg:border-b-0 lg:border-r border-[#ECECEC]">
                                <div className="flex gap-1 px-5 md:px-8 pt-3 pb-2 flex-shrink-0 overflow-x-auto">
                                    {[
                                        { id: 'Params', label: t('labels.params'), count: (activeSpec.queryParams || []).length },
                                        { id: 'Headers', label: t('labels.headers'), count: (activeSpec.headers || []).length },
                                        { id: 'Body', label: t('labels.body'), count: (activeSpec.body || '').trim() ? 1 : 0, warn: !!bodyJsonError },
                                        { id: 'Auth', label: t('labels.auth'), count: ((activeSpec.auth || {}).type || 'none') !== 'none' ? 1 : 0 },
                                        {
                                            id: 'Tests',
                                            label: t('labels.tests') || 'Tests',
                                            count: (activeSpec.assertions || []).length + (activeSpec.extract || []).length,
                                            warn: (response && (response.assertions || []).some(a => !a.passed)) || false,
                                        },
                                        { id: 'Code', label: t('labels.code') || 'Code', count: 0 },
                                    ].map(tab => (
                                        <button
                                            key={tab.id}
                                            onClick={() => setReqTab(tab.id)}
                                            aria-pressed={reqTab === tab.id}
                                            className={`flex items-center gap-1.5 rounded-[6px] px-2.5 py-[6px] text-[12.5px] font-semibold whitespace-nowrap transition-colors ${
                                                reqTab === tab.id ? 'bg-[#EAF3FF] text-[#0670DE]' : 'text-[#6E6E73] hover:bg-[#F0F0F2]'
                                            }`}
                                        >
                                            {tab.label}
                                            {/* How many, not merely "some": a dot could not tell
                                                three headers from eleven. */}
                                            {tab.count > 0 && (
                                                <span className={`min-w-[16px] rounded-full px-1 text-[10px] font-bold leading-[15px] text-center ${
                                                    reqTab === tab.id ? 'bg-[#0A84FF] text-white' : 'bg-[#E4E4E7] text-[#6E6E73]'
                                                }`}>
                                                    {tab.count}
                                                </span>
                                            )}
                                            {tab.warn && <window.Icon name="alert-triangle" size={11} className="text-[#C4363A]" />}
                                        </button>
                                    ))}
                                </div>
                                <div className="flex-1 overflow-y-auto px-5 md:px-8 pb-6">
                                    {reqTab === 'Params' && renderKeyValues(
                                        activeSpec.queryParams || [],
                                        (next) => updateSpec(activeDoc, { queryParams: next }),
                                        t('actions.add_param')
                                    )}
                                    {reqTab === 'Headers' && renderKeyValues(
                                        activeSpec.headers || [],
                                        (next) => updateSpec(activeDoc, { headers: next }),
                                        t('actions.add_header')
                                    )}
                                    {reqTab === 'Body' && (
                                        <div className="flex flex-col h-full min-h-[220px] gap-1.5">
                                            {/* A malformed JSON body used to leave as-is and come back
                                                as a 400 from the target. The parse happens here, where
                                                the fix is one click away. */}
                                            <div className="flex items-center justify-between gap-2 flex-shrink-0">
                                                <span className={`text-[11.5px] font-semibold truncate ${bodyJsonError ? 'text-[#C4363A]' : 'text-[#A5A5AA]'}`}>
                                                    {bodyJsonError
                                                        ? `${t('labels.invalid_json')}: ${bodyJsonError}`
                                                        : (ntLooksLikeJson(activeSpec.body) ? t('labels.valid_json') : '')}
                                                </span>
                                                {ntLooksLikeJson(activeSpec.body) && !bodyJsonError && (
                                                    <button
                                                        onClick={() => {
                                                            const pretty = ntPrettyJson(activeSpec.body);
                                                            if (pretty !== null) updateSpec(activeDoc, { body: pretty });
                                                        }}
                                                        className="flex items-center gap-1.5 border border-[#DEDEDE] rounded-[6px] px-2.5 py-[5px] text-[11.5px] font-semibold text-[#6E6E73] hover:border-[#0A84FF] hover:text-[#0A84FF] transition-colors flex-shrink-0"
                                                    >
                                                        <window.Icon name="align-left" size={12} /> {t('actions.format_json')}
                                                    </button>
                                                )}
                                            </div>
                                            <textarea
                                                className={`w-full flex-1 min-h-[200px] bg-[#FAFAFA] border rounded-[8px] p-3 font-mono text-[12px] leading-relaxed outline-none resize-none transition-colors ${
                                                    bodyJsonError ? 'border-[#F3D0D1] focus:border-[#C4363A]' : 'border-[#ECECEC] focus:border-[#0A84FF]'
                                                }`}
                                                placeholder={'{\n  "key": "value"\n}'}
                                                value={activeSpec.body || ''}
                                                onChange={e => updateSpec(activeDoc, { body: e.target.value })}
                                                aria-label={t('labels.request_body')}
                                                aria-invalid={!!bodyJsonError}
                                                spellCheck={false}
                                            />
                                        </div>
                                    )}
                                    {reqTab === 'Auth' && renderAuthTab(activeDoc)}
                                    {reqTab === 'Tests' && renderTestsTab(activeDoc)}
                                    {reqTab === 'Code' && (
                                        <div className="flex flex-col gap-2">
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="flex gap-1">
                                                    {NT_CODE_LANGS.map(lang => (
                                                        <button
                                                            key={lang.id}
                                                            onClick={() => setCodeLang(lang.id)}
                                                            className={`rounded-[6px] border px-2.5 py-[5px] text-[11.5px] font-semibold transition-colors ${
                                                                codeLang === lang.id
                                                                    ? 'border-[#0A84FF] bg-[#EAF3FF] text-[#0670DE]'
                                                                    : 'border-[#DEDEDE] bg-white text-[#6E6E73] hover:border-[#0A84FF]'
                                                            }`}
                                                        >
                                                            {lang.label}
                                                        </button>
                                                    ))}
                                                </div>
                                                <button
                                                    onClick={copyCode}
                                                    className="flex items-center gap-1.5 border border-[#DEDEDE] rounded-[6px] px-2.5 py-[5px] text-[11.5px] font-semibold text-[#6E6E73] hover:border-[#0A84FF] hover:text-[#0A84FF] transition-colors"
                                                >
                                                    <window.Icon name="copy" size={12} /> {t('actions.copy')}
                                                </button>
                                            </div>
                                            <pre className="bg-[#1C1C1E] text-[#E6E6E8] rounded-[8px] p-3.5 font-mono text-[11.5px] leading-relaxed overflow-x-auto whitespace-pre">
                                                {codeSnippet}
                                            </pre>
                                        </div>
                                    )}
                                </div>
                            </section>

                            {/* Response */}
                            <section className="flex flex-col min-h-0 bg-[#FAFAFA]">
                                <div className="flex items-center justify-between gap-3 px-5 md:px-8 pt-3 pb-2 flex-shrink-0">
                                    <div className="flex gap-1">
                                        {[
                                            { id: 'Body', label: t('labels.body') },
                                            { id: 'Headers', label: t('labels.response_headers') || 'Headers' },
                                        ].map(tab => (
                                            <button
                                                key={tab.id}
                                                onClick={() => setResTab(tab.id)}
                                                aria-pressed={resTab === tab.id}
                                                className={`flex items-center gap-1.5 rounded-[6px] px-2.5 py-[6px] text-[12.5px] font-semibold transition-colors ${
                                                    resTab === tab.id ? 'bg-[#EAF3FF] text-[#0670DE]' : 'text-[#6E6E73] hover:bg-[#F0F0F2]'
                                                }`}
                                            >
                                                {tab.label}
                                                {tab.id === 'Headers' && response && (response.headers || []).length > 0 && (
                                                    <span className={`min-w-[16px] rounded-full px-1 text-[10px] font-bold leading-[15px] text-center ${
                                                        resTab === tab.id ? 'bg-[#0A84FF] text-white' : 'bg-[#E4E4E7] text-[#6E6E73]'
                                                    }`}>
                                                        {response.headers.length}
                                                    </span>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                    {response && (
                                        <div className="flex items-center gap-2.5 font-mono text-[11px] flex-shrink-0">
                                            <span className={response.ok && response.status < 400 ? 'text-[#1A7F52] font-bold' : 'text-[#C4363A] font-bold'}>
                                                {response.status} {response.statusText}
                                            </span>
                                            <span className="text-[#6E6E73]">{response.time}ms</span>
                                            <span className="text-[#A5A5AA] hidden sm:inline">{ntFormatBytes(response.size)}</span>
                                            <button
                                                onClick={copyResponseBody}
                                                className={iconBtn}
                                                title={t('actions.copy_response')}
                                                aria-label={t('actions.copy_response')}
                                            >
                                                <window.Icon name="copy" size={13} />
                                            </button>
                                            {(response.assertions || []).length > 0 && (() => {
                                                const passed = response.assertions.filter(a => a.passed).length;
                                                const all = passed === response.assertions.length;
                                                return (
                                                    <button
                                                        onClick={() => setReqTab('Tests')}
                                                        className={`font-bold rounded-[4px] px-1.5 py-0.5 transition-colors ${all ? 'bg-[#E6F6EE] text-[#1A7F52]' : 'bg-[#FCECEC] text-[#C4363A]'}`}
                                                        title={t('labels.tests') || 'Tests'}
                                                    >
                                                        {passed}/{response.assertions.length}
                                                    </button>
                                                );
                                            })()}
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1 overflow-auto px-5 md:px-8 pb-6">
                                    {sending ? (
                                        <div className="flex items-center justify-center gap-2 h-full text-[#6E6E73] text-[12.5px]">
                                            <window.Icon name="loader" size={16} className="animate-spin" />
                                            {t('alerts.sending_request')}
                                        </div>
                                    ) : !response ? (
                                        <div className="flex flex-col items-center justify-center gap-2 h-full text-center text-[12.5px] text-[#A5A5AA] px-6">
                                            <span className="italic">{t('labels.no_response_yet')}</span>
                                            <span className="flex items-center gap-1.5 not-italic">
                                                <kbd className="font-sans text-[10.5px] font-semibold text-[#6E6E73] bg-white border border-[#DEDEDE] rounded px-1.5 py-0.5">
                                                    {sendShortcut}
                                                </kbd>
                                                {t('actions.send_request')}
                                            </span>
                                        </div>
                                    ) : resTab === 'Headers' ? (
                                        response.headers.length === 0 ? (
                                            <p className="text-[12px] text-[#A5A5AA] italic">{t('labels.no_headers')}</p>
                                        ) : (
                                            <div className="font-mono text-[11.5px] divide-y divide-[#ECECEC] border border-[#ECECEC] rounded-[8px] bg-white overflow-hidden">
                                                {response.headers.map((h, i) => (
                                                    <div key={i} className="flex gap-3 px-3 py-1.5">
                                                        <span className="text-[#6E6E73] font-semibold flex-shrink-0 w-40 truncate">{h.key}</span>
                                                        <span className="break-all">{h.value}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )
                                    ) : (
                                        <React.Fragment>
                                            {response.finalUrl && (
                                                <div className="flex items-center gap-1.5 mb-2 font-mono text-[11px] text-[#6E6E73] min-w-0">
                                                    <window.Icon name="corner-down-right" size={12} className="text-[#A5A5AA] flex-shrink-0" />
                                                    <span className="truncate" title={response.finalUrl}>
                                                        {t('labels.redirected_to') || 'Redirected to'}: {response.finalUrl}
                                                    </span>
                                                </div>
                                            )}
                                            {response.truncated && (
                                                <div className="flex items-center gap-1.5 mb-2 text-[11.5px] text-[#9A6400] bg-[#FDF3E0] border border-[#F5E3BE] rounded-[6px] px-2.5 py-1.5">
                                                    <window.Icon name="alert-triangle" size={12} className="flex-shrink-0" />
                                                    {t('labels.response_truncated') || 'Response truncated at the proxy size limit'}
                                                </div>
                                            )}
                                            <pre className={`font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-words rounded-[8px] p-3.5 border ${
                                                response.ok ? 'bg-white border-[#ECECEC]' : 'bg-[#FCECEC] border-[#F3D0D1] text-[#C4363A]'
                                            }`}>
                                                {response.body}
                                            </pre>
                                        </React.Fragment>
                                    )}
                                </div>
                            </section>

                            {/* Drag to resize, double-click to even it back up, and
                                arrow keys once focused — a mouse-only handle would
                                put the layout out of reach of a keyboard. */}
                            <div
                                role="separator"
                                aria-orientation="vertical"
                                aria-label={t('labels.resize_panes')}
                                aria-valuenow={Math.round(splitPct)}
                                aria-valuemin={25}
                                aria-valuemax={75}
                                tabIndex={0}
                                onPointerDown={startSplitDrag}
                                onDoubleClick={() => setSplitPct(50)}
                                onKeyDown={(e) => {
                                    if (e.key === 'ArrowLeft') { e.preventDefault(); setSplitPct(p => clampSplit(p - 4)); }
                                    if (e.key === 'ArrowRight') { e.preventDefault(); setSplitPct(p => clampSplit(p + 4)); }
                                    if (e.key === 'Home') { e.preventDefault(); setSplitPct(50); }
                                }}
                                className="hidden lg:block absolute inset-y-0 w-[9px] -translate-x-1/2 cursor-col-resize group focus:outline-none"
                                style={{ left: `${splitPct}%` }}
                            >
                                <span className="block w-[3px] h-full mx-auto rounded-full bg-transparent group-hover:bg-[#0A84FF] group-focus-visible:bg-[#0A84FF] transition-colors" />
                            </div>
                        </div>

                        {/* Notes — the prose that ends up on the public API page. */}
                        {showNotes && (
                            <div className="border-t border-[#ECECEC] flex-shrink-0 max-h-[42vh] overflow-y-auto">
                                <div className="flex items-center justify-between px-5 md:px-8 py-2.5 sticky top-0 bg-white border-b border-[#ECECEC]">
                                    <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#A5A5AA]">
                                        {t('labels.notes') || 'Notes'}
                                    </span>
                                    <button
                                        onClick={() => setEditingNotes(!editingNotes)}
                                        className={`flex items-center gap-1.5 border rounded-[6px] px-3 py-[5px] text-[12px] font-semibold transition-colors ${
                                            editingNotes ? 'border-[#0A84FF] bg-[#EAF3FF] text-[#0670DE]' : 'border-[#DEDEDE] text-[#6E6E73] hover:border-[#0A84FF]'
                                        }`}
                                    >
                                        <window.Icon name="pencil" size={12} />
                                        {editingNotes ? t('actions.done_editing') : t('actions.edit_document')}
                                    </button>
                                </div>
                                <div className="px-5 md:px-8 py-4">
                                    {editingNotes ? (
                                        <window.NotionEditor
                                            key={idOf(activeDoc)}
                                            initialContent={activeDoc.content}
                                            editable={true}
                                            onChange={(html) => updateDoc(idOf(activeDoc), { content: html })}
                                        />
                                    ) : (activeDoc.content || '').replace(/<[^>]*>/g, '').trim() ? (
                                        <div className="nd-doc-body readme-preview ql-editor" dangerouslySetInnerHTML={{ __html: window.sanitizeHtml(activeDoc.content) }} />
                                    ) : (
                                        <p className="text-[12.5px] text-[#A5A5AA] italic">{t('labels.endpoint_notes_placeholder')}</p>
                                    )}
                                </div>
                            </div>
                        )}
                    </React.Fragment>
                ) : activeFolder ? (
                    <React.Fragment>
                        <div className="flex items-center justify-between gap-4 px-5 md:px-8 py-3.5 border-b border-[#ECECEC] flex-shrink-0">
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                <button onClick={() => setShowMobileSidebar(true)} className="md:hidden p-1.5 text-[#6E6E73] hover:bg-[#F0F0F2] rounded-md flex-shrink-0">
                                    <window.Icon name="menu" size={18} />
                                </button>
                                <input
                                    className="text-[19px] font-extrabold tracking-[-0.01em] bg-transparent outline-none border-b border-dashed border-transparent hover:border-[#DEDEDE] focus:border-[#0A84FF] min-w-0 flex-1 max-w-md"
                                    value={activeFolder.name || ''}
                                    onChange={e => patchFolder(idOf(activeFolder), { name: e.target.value }, { persist: false })}
                                    onBlur={e => saveFolder(idOf(activeFolder), { name: e.target.value })}
                                    aria-label={t('labels.collection') || 'Collection'}
                                />
                                {/* A collection has no draft of its own: its name,
                                    environments and publish flag write straight through. */}
                                {renderSaveState(false)}
                            </div>
                            <button
                                onClick={() => setEditingNotes(!editingNotes)}
                                className={`flex items-center gap-1.5 border rounded-[6px] px-3 py-[7px] text-[12.5px] font-semibold transition-colors flex-shrink-0 ${
                                    editingNotes ? 'border-[#0A84FF] bg-[#EAF3FF] text-[#0670DE]' : 'border-[#DEDEDE] text-[#6E6E73] hover:border-[#0A84FF]'
                                }`}
                            >
                                <window.Icon name="pencil" size={13} />
                                {editingNotes ? t('actions.done_editing') : t('actions.edit_readme')}
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto px-5 md:px-8 py-6">
                            <div className="max-w-[760px] mx-auto flex flex-col gap-6">
                                {/* Publishing is opt-in and lives on the collection root, the
                                    same as environments — /apis/:ws/:slug serves the root and
                                    everything under it, so a subfolder has nothing of its own
                                    to publish. Until this is on, the public URL 404s. */}
                                {!activeFolder.parentId && (
                                    <section className="border border-[#ECECEC] rounded-[10px] bg-[#FAFAFA] p-4">
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="min-w-0">
                                                <h3 className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#A5A5AA] mb-1.5">
                                                    {t('labels.public_page')}
                                                </h3>
                                                <p className="text-[12.5px] text-[#6E6E73] leading-relaxed">
                                                    {activeFolder.published
                                                        ? t('labels.published_hint')
                                                        : t('labels.unpublished_hint')}
                                                </p>
                                                {/* The URL is a real anchor, so it opens the page it names —
                                                    in a new tab, because the collection being edited is
                                                    behind it. Copying moved to its own button: a link that
                                                    silently copied instead of navigating was the surprise. */}
                                                {activeFolder.published && (
                                                    <div className="mt-2 flex items-center gap-1.5">
                                                        <a
                                                            href={publicUrl(activeFolder)}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="font-mono text-[12px] text-[#0670DE] hover:underline break-all"
                                                            title={t('actions.open_public_page')}
                                                        >
                                                            {publicUrl(activeFolder)}
                                                        </a>
                                                        <button
                                                            onClick={() => copyCollectionLink(activeFolder)}
                                                            className={`${iconBtn} flex-shrink-0`}
                                                            title={t('actions.copy_link')}
                                                        >
                                                            <window.Icon name="copy" size={12} />
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                            <button
                                                onClick={() => patchFolder(idOf(activeFolder), { published: !activeFolder.published })}
                                                role="switch"
                                                aria-checked={!!activeFolder.published}
                                                className={`flex items-center gap-1.5 border rounded-[6px] px-3 py-[7px] text-[12.5px] font-semibold transition-colors flex-shrink-0 ${
                                                    activeFolder.published
                                                        ? 'border-[#1A7F52] bg-[#E6F6EE] text-[#1A7F52]'
                                                        : 'border-[#DEDEDE] text-[#6E6E73] hover:border-[#0A84FF]'
                                                }`}
                                            >
                                                <window.Icon name={activeFolder.published ? 'globe' : 'lock'} size={13} />
                                                {activeFolder.published ? t('actions.unpublish_collection') : t('actions.publish_collection')}
                                            </button>
                                        </div>
                                    </section>
                                )}

                                {/* Environments live on the collection root and are inherited
                                    by every endpoint below it. */}
                                {!activeFolder.parentId && (
                                    <section className="border border-[#ECECEC] rounded-[10px] bg-[#FAFAFA] p-4">
                                        <h3 className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#A5A5AA] mb-3">
                                            {t('labels.environments')}
                                        </h3>
                                        <div className="flex flex-col gap-3">
                                            {(activeFolder.environments || []).map(env => (
                                                <div key={env.id} className="bg-white border border-[#ECECEC] rounded-[8px] p-3 flex flex-col gap-2">
                                                    <div className="flex gap-1.5 items-center">
                                                        <input
                                                            className={`${fieldCls} font-semibold w-40 flex-shrink-0`}
                                                            placeholder={t('labels.env_name_placeholder')}
                                                            value={env.name || ''}
                                                            onChange={e => {
                                                                const next = activeFolder.environments.map(x => (x.id === env.id ? { ...x, name: e.target.value } : x));
                                                                patchFolder(idOf(activeFolder), { environments: next }, { persist: false });
                                                            }}
                                                            onBlur={() => saveFolder(idOf(activeFolder), { environments: activeFolder.environments })}
                                                        />
                                                        <input
                                                            className={`${monoField} flex-1 min-w-0`}
                                                            placeholder={t('labels.env_url_placeholder')}
                                                            value={env.baseUrl || ''}
                                                            onChange={e => {
                                                                const next = activeFolder.environments.map(x => (x.id === env.id ? { ...x, baseUrl: e.target.value } : x));
                                                                patchFolder(idOf(activeFolder), { environments: next }, { persist: false });
                                                            }}
                                                            onBlur={() => saveFolder(idOf(activeFolder), { environments: activeFolder.environments })}
                                                        />
                                                        <button
                                                            onClick={() => {
                                                                const next = activeFolder.environments.filter(x => x.id !== env.id);
                                                                patchFolder(idOf(activeFolder), { environments: next });
                                                            }}
                                                            className="p-1.5 rounded-[6px] text-[#A5A5AA] hover:text-[#E5484D] hover:bg-[#FCECEC] transition-colors flex-shrink-0"
                                                            title={t('actions.delete_item')}
                                                        >
                                                            <window.Icon name="trash-2" size={13} />
                                                        </button>
                                                    </div>

                                                    <div className="pl-1 flex flex-col gap-1.5">
                                                        <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-[#A5A5AA]">
                                                            {t('labels.variables') || 'Variables'}
                                                        </span>
                                                        {(env.variables || []).map((v, i) => (
                                                            <div key={i} className="flex gap-1.5 items-center">
                                                                <input
                                                                    className={`${monoField} w-40 flex-shrink-0`}
                                                                    placeholder={t('labels.key')}
                                                                    value={v.key || ''}
                                                                    onChange={e => {
                                                                        const vars = (env.variables || []).map((x, idx) => (idx === i ? { ...x, key: e.target.value } : x));
                                                                        const next = activeFolder.environments.map(x => (x.id === env.id ? { ...x, variables: vars } : x));
                                                                        patchFolder(idOf(activeFolder), { environments: next }, { persist: false });
                                                                    }}
                                                                    onBlur={() => saveFolder(idOf(activeFolder), { environments: activeFolder.environments })}
                                                                />
                                                                <input
                                                                    className={`${monoField} flex-1 min-w-0`}
                                                                    placeholder={t('labels.value')}
                                                                    value={v.value || ''}
                                                                    onChange={e => {
                                                                        const vars = (env.variables || []).map((x, idx) => (idx === i ? { ...x, value: e.target.value } : x));
                                                                        const next = activeFolder.environments.map(x => (x.id === env.id ? { ...x, variables: vars } : x));
                                                                        patchFolder(idOf(activeFolder), { environments: next }, { persist: false });
                                                                    }}
                                                                    onBlur={() => saveFolder(idOf(activeFolder), { environments: activeFolder.environments })}
                                                                />
                                                                <button
                                                                    onClick={() => {
                                                                        const vars = (env.variables || []).filter((_, idx) => idx !== i);
                                                                        const next = activeFolder.environments.map(x => (x.id === env.id ? { ...x, variables: vars } : x));
                                                                        patchFolder(idOf(activeFolder), { environments: next });
                                                                    }}
                                                                    className="p-1.5 rounded-[6px] text-[#A5A5AA] hover:text-[#E5484D] hover:bg-[#FCECEC] transition-colors flex-shrink-0"
                                                                    title={t('actions.delete_item')}
                                                                >
                                                                    <window.Icon name="trash-2" size={13} />
                                                                </button>
                                                            </div>
                                                        ))}
                                                        <button
                                                            onClick={() => {
                                                                const vars = [...(env.variables || []), { key: '', value: '' }];
                                                                const next = activeFolder.environments.map(x => (x.id === env.id ? { ...x, variables: vars } : x));
                                                                patchFolder(idOf(activeFolder), { environments: next }, { persist: false });
                                                            }}
                                                            className="self-start inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#0A84FF] hover:text-[#0670DE] transition-colors"
                                                        >
                                                            <window.Icon name="plus" size={12} /> {t('actions.add_variable') || 'Add Variable'}
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                        <button
                                            onClick={() => {
                                                const next = [
                                                    ...(activeFolder.environments || []),
                                                    { id: window.generateId('env'), name: 'New Env', baseUrl: 'https://', variables: [] },
                                                ];
                                                patchFolder(idOf(activeFolder), { environments: next });
                                            }}
                                            className="mt-3 inline-flex items-center gap-1.5 border border-[#DEDEDE] bg-white rounded-[6px] px-2.5 py-[6px] text-[12px] font-semibold text-[#6E6E73] hover:border-[#0A84FF] hover:text-[#0A84FF] transition-colors"
                                        >
                                            <window.Icon name="plus" size={13} /> {t('actions.add_environment')}
                                        </button>
                                    </section>
                                )}

                                {editingNotes ? (
                                    <window.NotionEditor
                                        key={idOf(activeFolder)}
                                        initialContent={activeFolder.description || ''}
                                        editable={true}
                                        onChange={(html) => patchFolder(idOf(activeFolder), { description: html })}
                                    />
                                ) : (activeFolder.description || '').replace(/<[^>]*>/g, '').trim() ? (
                                    <div className="nd-doc-body readme-preview ql-editor" dangerouslySetInnerHTML={{ __html: window.sanitizeHtml(activeFolder.description) }} />
                                ) : (
                                    <div className="text-center py-10">
                                        <p className="text-[13px] font-semibold text-[#6E6E73]">{t('labels.readme_empty')}</p>
                                        <p className="text-[12.5px] text-[#A5A5AA] mt-1.5">{t('labels.readme_empty_folder_hint')}</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </React.Fragment>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
                        <button onClick={() => setShowMobileSidebar(true)} className="md:hidden absolute top-3 left-4 p-1.5 text-[#6E6E73] hover:bg-[#F0F0F2] rounded-md">
                            <window.Icon name="menu" size={18} />
                        </button>
                        <div className="w-14 h-14 rounded-xl bg-[#FAFAFA] border border-dashed border-[#DEDEDE] flex items-center justify-center mb-4">
                            <window.Icon name="zap" size={22} className="text-[#A5A5AA]" />
                        </div>
                        <p className="text-[13px] font-semibold text-[#6E6E73]">{t('labels.no_endpoint_selected')}</p>
                        <p className="text-[12.5px] text-[#A5A5AA] mt-1.5 max-w-sm leading-relaxed">
                            {t('labels.select_or_create_endpoint')}
                        </p>
                        {/* The empty state said what to do without offering to do it —
                            the only controls were in a sidebar that is hidden on mobile. */}
                        <div className="flex flex-wrap items-center justify-center gap-2 mt-5">
                            <button
                                onClick={addDoc}
                                className="flex items-center gap-1.5 bg-[#0A84FF] border border-[#0A84FF] text-white rounded-[6px] px-3.5 py-[7px] text-[12.5px] font-semibold hover:bg-[#0670DE] transition-colors"
                            >
                                <window.Icon name="zap" size={14} /> {t('actions.new_endpoint')}
                            </button>
                            <button
                                onClick={addFolder}
                                className="flex items-center gap-1.5 border border-[#DEDEDE] bg-white rounded-[6px] px-3.5 py-[7px] text-[12.5px] font-semibold text-[#6E6E73] hover:border-[#0A84FF] hover:text-[#0670DE] transition-colors"
                            >
                                <window.Icon name="plus" size={14} /> {t('actions.new_collection') || 'Collection'}
                            </button>
                            <button
                                onClick={() => importInputRef.current && importInputRef.current.click()}
                                disabled={importing}
                                className="flex items-center gap-1.5 border border-[#DEDEDE] bg-white rounded-[6px] px-3.5 py-[7px] text-[12.5px] font-semibold text-[#6E6E73] hover:border-[#0A84FF] hover:text-[#0670DE] transition-colors disabled:opacity-50"
                            >
                                <window.Icon name={importing ? 'loader' : 'upload-cloud'} size={14} className={importing ? 'animate-spin' : ''} />
                                {t('actions.import_postman')}
                            </button>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
};
