const crypto = require('crypto');
const bcrypt = require('bcrypt');
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const { Workspace, Folder, Doc } = require('../db');
const wrap = require('../middleware/asyncHandler');
const { body } = require('express-validator');
const validate = require('../middleware/validate');

// Everything this router returns is readable by anyone holding the share link,
// so credentials have to be stripped before they leave. Several places hold them:
//
//   * `apiSpec.auth` — the bearer token, basic-auth password and API-key value
//     the workspace uses to call the endpoint.
//   * `environment.variables` — free-form values that routinely hold tokens,
//     since `{{apiKey}}` is exactly what the substitution feature is for.
//   * `apiSpec.headers` / `queryParams` — free text. Nothing stops a credential
//     being typed straight in, and a Postman import copies both verbatim.
//   * `apiSpec.body` and `apiSpec.examples` — a recorded login response is the
//     single most likely place a live token sits.
//
// What survives is the shape, not the secret: which auth scheme an endpoint
// uses, which header carries the key, and which variable names exist. That is
// what published API documentation is supposed to show, and it leaves the
// public page rendering `{{apiKey}}` as a placeholder rather than resolving it.
//
// There is no per-variable "this one is safe" flag today, so every value is
// redacted rather than guessed at. Add an explicit opt-in before relaxing this.
const publicAuth = (auth) => {
    if (!auth || !auth.type || auth.type === 'none') return undefined;
    const safe = { type: auth.type };
    if (auth.type === 'apikey') {
        if (auth.key) safe.key = auth.key;
        safe.addTo = auth.addTo || 'header';
    }
    if (auth.type === 'basic' && auth.username) safe.username = auth.username;
    return safe;
};

// `auth` is not the only place a credential ends up. The Headers and Params
// grids are free text, and a Postman import copies both verbatim, so
// `Authorization: Bearer sk_live_...` is a header like any other as far as the
// schema is concerned. Names are documentation and stay; the values behind
// these ones are not.
const SECRET_KEY_RE = /^(authorization|proxy-authorization|cookie|set-cookie)$/i;
const SECRET_KEY_SUBSTRINGS = [
    'token', 'secret', 'password', 'passwd', 'apikey', 'api-key', 'api_key',
    'credential', 'signature', 'auth',
];
const isSecretKey = (key) => {
    const name = String(key || '').toLowerCase();
    if (!name) return false;
    if (SECRET_KEY_RE.test(name)) return true;
    return SECRET_KEY_SUBSTRINGS.some(part => name.includes(part));
};

// A value that is already a bare `{{placeholder}}` names a variable rather than
// holding anything, and the variable's own value is redacted separately. Keeping
// it is the whole point of the published page: the reader sees which variable to
// fill in.
const isPlaceholder = (value) => /^\s*\{\{\s*[\w.\-]+\s*\}\}\s*$/.test(String(value || ''));

const publicPairs = (rows) => (rows || [])
    .filter(r => r && r.key)
    .map(r => {
        const obj = typeof r.toObject === 'function' ? r.toObject() : { ...r };
        const value = obj.value == null ? '' : obj.value;
        return { key: obj.key, value: (isSecretKey(obj.key) && !isPlaceholder(value)) ? '' : value };
    });

// Recorded request/response bodies are where a live token is most likely to be
// sitting — an example named "login" holds exactly the thing it just returned.
// JSON is walked by key so the shape survives; a body that does not parse as
// JSON cannot be scrubbed safely and is published as written. That is a known
// gap: a hand-written non-JSON body with a secret in it goes out verbatim.
const scrubJsonValue = (value) => {
    if (Array.isArray(value)) return value.map(scrubJsonValue);
    if (value && typeof value === 'object') {
        return Object.keys(value).reduce((acc, key) => {
            acc[key] = isSecretKey(key) ? '' : scrubJsonValue(value[key]);
            return acc;
        }, {});
    }
    return value;
};

const publicBody = (text) => {
    if (typeof text !== 'string' || !text.trim()) return text;
    let parsed;
    try { parsed = JSON.parse(text); } catch (e) { return text; }
    if (parsed === null || typeof parsed !== 'object') return text;
    return JSON.stringify(scrubJsonValue(parsed), null, 2);
};

// A key written straight into the URL rather than the Params grid is the same
// credential in a different field. Split by hand instead of going through
// URLSearchParams, which would re-encode `{{apiKey}}` into `%7B%7B...` and stop
// the public page resolving it as a placeholder.
const publicUrlQuery = (url) => {
    const raw = String(url || '');
    const at = raw.indexOf('?');
    if (at === -1) return raw;

    const scrubbed = raw.slice(at + 1).split('&').map(part => {
        const eq = part.indexOf('=');
        if (eq === -1) return part;
        const key = part.slice(0, eq);
        const value = part.slice(eq + 1);
        let decoded = key;
        try { decoded = decodeURIComponent(key); } catch (e) { /* malformed — match on the raw key */ }
        return (isSecretKey(decoded) && !isPlaceholder(value)) ? `${key}=` : part;
    }).join('&');

    return `${raw.slice(0, at)}?${scrubbed}`;
};

const publicApiSpec = (spec) => {
    if (!spec) return spec;
    const obj = typeof spec.toObject === 'function' ? spec.toObject() : { ...spec };
    const auth = publicAuth(obj.auth);
    if (auth) obj.auth = auth;
    else delete obj.auth;

    obj.url = publicUrlQuery(obj.url);
    obj.headers = publicPairs(obj.headers);
    obj.queryParams = publicPairs(obj.queryParams);
    obj.body = publicBody(obj.body);
    obj.examples = (obj.examples || []).map(ex => {
        const e = typeof ex.toObject === 'function' ? ex.toObject() : { ...ex };
        return { ...e, requestBody: publicBody(e.requestBody), responseBody: publicBody(e.responseBody) };
    });

    // Assertions stay: "returns 200 with data.token" is documentation, and it is
    // what lets the public page check a live call. Extraction rules do not —
    // they write into environment variables, whose values are redacted here, so
    // publishing them would describe a side effect that cannot happen.
    delete obj.extract;
    return obj;
};

// `http://user:pass@host` is a credential in a field that otherwise has to stay
// visible — the base URL is what a reader needs to call the endpoint at all.
const publicBaseUrl = (baseUrl) => {
    const raw = String(baseUrl || '');
    if (!raw) return raw;
    try {
        const url = new URL(raw);
        if (!url.username && !url.password) return raw;
        url.username = '';
        url.password = '';
        return url.toString();
    } catch (e) {
        // Not absolute (or not a URL at all) — strip a leading `user:pass@` if
        // one is written there anyway.
        return raw.replace(/^([a-z][a-z0-9+.\-]*:\/\/)[^/@\s]*@/i, '$1');
    }
};

const publicEnvironments = (environments) => (environments || []).map(env => {
    const obj = typeof env.toObject === 'function' ? env.toObject() : { ...env };
    return {
        id: obj.id,
        name: obj.name,
        baseUrl: publicBaseUrl(obj.baseUrl),
        variables: (obj.variables || [])
            .filter(v => v && v.key)
            .map(v => ({ key: v.key })),
    };
});

const publicDoc = (obj) => (
    obj.type === 'API' ? { ...obj, apiSpec: publicApiSpec(obj.apiSpec) } : obj
);

// The workspace segment of a share link is whatever the person holding it had:
// the id the share buttons emit, the slug the app's own /workspace/<slug> URLs
// use, or the plain name. Slug used to be missing, so a link built by analogy
// with the address bar ("/docs/test01-gpsb/guide") 404'd even though both the
// workspace and the folder existed.
const findWorkspace = (wsParam) => {
    const or = [{ slug: wsParam }, { name: wsParam }];
    if (mongoose.Types.ObjectId.isValid(wsParam) && String(wsParam).length === 24) {
        or.push({ _id: wsParam });
    }
    return Workspace.findOne({ $or: or });
};

// --- Public collections ---
//
// One handler serves both public surfaces. They return the same shape; the only
// difference is which `kind` of folder each will resolve, so a /docs/ link
// cannot serve an API collection and a /apis/ link cannot serve a docs site.
//
// Folders written before `kind` existed have none at all. Those are treated as
// DOCS — the schema default, and what /docs/ already served them as — so
// existing share links keep working. They stay invisible to /apis/ until
// something assigns them a kind.
//
// Nothing is served until an owner publishes it. A slug is a lowercase-hyphen of
// the folder name and the workspace segment matches on plain name, so a link is
// guessable by anyone who knows what the workspace is called — the flag is what
// keeps "created" from meaning "published". Only API collections are gated:
// DOCS folders predate the flag and would all go dark at once, so their existing
// share links keep working until that page grows the same toggle.
const isServable = (folder, kind) => {
    if ((folder.kind || 'DOCS') !== kind) return false;
    if (kind === 'API' && !folder.published) return false;
    return true;
};

/**
 * Resolve a collection by the slug (or id) in a share link.
 *
 * Returns null for "not found", "wrong surface" and "not published" alike: which
 * of the three it was is not something an unauthenticated caller needs to learn.
 * `kind` is the surface the link was requested through; pass null to accept the
 * folder on its own surface, which is what /unlock does — it is reached from
 * whichever page already resolved the collection.
 */
const findPublicFolder = async (workspace, slugParam, kind) => {
    const query = [{ slug: slugParam }];
    if (mongoose.Types.ObjectId.isValid(slugParam) && String(slugParam).length === 24) {
        query.push({ _id: slugParam });
    }
    const folder = await Folder.findOne({ $or: query, workspaceId: workspace._id.toString() });
    if (!folder) return null;
    if (!isServable(folder, kind || folder.kind || 'DOCS')) return null;
    return folder;
};

const publicCollection = (kind) => wrap(async (req, res) => {
    const workspace = await findWorkspace(req.params.wsId);
    if (!workspace) return res.status(404).json({ error: 'Workspace not found' });

    const folder = await findPublicFolder(workspace, req.params.folderSlug, kind);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    // Support 1-level deep subfolders
    const subfolders = await Folder.find({ workspaceId: workspace._id.toString(), parentId: folder._id.toString() });
    const subfolderIds = subfolders.map(f => f._id.toString());

    // Fetch docs in root folder AND subfolders
    const docs = await Doc.find({ workspaceId: workspace._id.toString(), folderId: { $in: [folder._id.toString(), ...subfolderIds] } }).sort({ order: 1, createdAt: 1 });

    // Mask the content of password-protected docs. Viewers must unlock them
    // individually via the /unlock endpoint before content is revealed.
    const safeDocs = docs.map(d => {
        const obj = d.toJSON();
        if (obj.passwordProtected) {
            return {
                id: obj.id,
                _id: obj._id,
                title: obj.title,
                type: obj.type,
                folderId: obj.folderId,
                passwordProtected: true,
                content: '',
                apiSpec: obj.type === 'API' ? { method: obj.apiSpec?.method } : undefined
            };
        }
        return publicDoc(obj);
    });

    res.json({
        workspace: { id: workspace._id, name: workspace.name },
        folder: {
            id: folder._id, name: folder.name, slug: folder.slug, description: folder.description,
            kind: folder.kind || 'DOCS',
            environments: publicEnvironments(folder.environments),
        },
        subfolders: subfolders.map(f => ({
            id: f._id, name: f.name, parentId: f.parentId, description: f.description,
            kind: f.kind || 'DOCS',
            environments: publicEnvironments(f.environments),
        })),
        docs: safeDocs
    });
});

router.get('/public/docs/:wsId/:folderSlug', publicCollection('DOCS'));
router.get('/public/apis/:wsId/:folderSlug', publicCollection('API'));

/**
 * Check a share password against what is stored.
 *
 * Passwords set from now on are bcrypt. Documents protected before that hold an
 * unsalted single-round SHA-256, so those are still accepted — compared with
 * `timingSafeEqual` rather than `!==`, which leaked the hash a byte at a time.
 * A legacy hash upgrades the next time its author sets the password.
 */
const sharePasswordMatches = async (password, storedHash) => {
    if (!storedHash) return false;
    const supplied = String(password || '');
    if (/^\$2[aby]?\$/.test(storedHash)) return bcrypt.compare(supplied, storedHash);

    const legacy = crypto.createHash('sha256').update(supplied).digest();
    let stored;
    try { stored = Buffer.from(storedHash, 'hex'); } catch (e) { return false; }
    if (stored.length !== legacy.length) return false;
    return crypto.timingSafeEqual(legacy, stored);
};

// Unlock a single password-protected public document by supplying its password.
// Returns the full content only when the password matches. Credentials stay
// redacted either way: the share password gates the document's *content*, and
// knowing it does not make the workspace's API tokens the viewer's business.
//
// `folderSlug` is what scopes this. Without it the route resolved a document by
// id and workspace alone, which made it a read of *any* document in the
// workspace — including ones in collections that were never published, and ones
// in no collection at all. The set it can reach is now exactly the set the
// collection GET already returned to the same caller.
router.post('/public/docs/:wsId/unlock', [
    body('docId').isMongoId().withMessage('A valid docId is required'),
    body('folderSlug').isString().trim().notEmpty().withMessage('folderSlug is required'),
    body('password').optional().isString(),
], validate, wrap(async (req, res) => {
    const { docId, folderSlug, password } = req.body;

    const workspace = await findWorkspace(req.params.wsId);
    if (!workspace) return res.status(404).json({ error: 'Workspace not found' });

    const folder = await findPublicFolder(workspace, folderSlug, null);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    const subfolders = await Folder.find({ workspaceId: workspace._id.toString(), parentId: folder._id.toString() }).select('_id');
    const allowedFolderIds = [folder._id.toString(), ...subfolders.map(f => f._id.toString())];

    const doc = await Doc.findOne({
        _id: docId,
        workspaceId: workspace._id.toString(),
        folderId: { $in: allowedFolderIds },
    }).select('+passwordHash');
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    if (!doc.passwordProtected) {
        return res.json({ id: doc._id, title: doc.title, type: doc.type, content: doc.content, apiSpec: publicApiSpec(doc.apiSpec) });
    }

    if (!await sharePasswordMatches(password, doc.passwordHash)) {
        return res.status(401).json({ error: 'Incorrect password' });
    }

    res.json({ id: doc._id, title: doc.title, type: doc.type, content: doc.content, apiSpec: publicApiSpec(doc.apiSpec) });
}));

module.exports = router;
