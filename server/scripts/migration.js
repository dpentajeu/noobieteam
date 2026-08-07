/**
 * One-time migration: bring a noobieteam_old database up to the noobieteam_new
 * schema (server/db.js).
 *
 * Every change below is additive — no field is renamed, no collection is
 * dropped, and no existing value is overwritten except where a step says so.
 * The new schema declares defaults for all of it, and Mongoose applies defaults
 * to documents it loads, so the app *reads* an un-migrated database fine. What
 * breaks without this script is anything that QUERIES the new fields, because a
 * document that lacks a field never matches a filter on it:
 *
 *   - Folder.find({ kind: 'API' })  -> old folders never appear on /apis/
 *   - the public API gate reads folder.published
 *   - superadmin surfaces filter on User.systemRole / User.banned
 *
 * Steps (each independently idempotent):
 *
 *   1. users     - add systemRole:'USER' and banned:false where absent.
 *                  Optionally promote one account with --superadmin=<email>.
 *   2. folders   - assign kind (DOCS|API) per root subtree, add published,
 *                  add environments[].variables.
 *   3. docs      - add apiSpec.auth / .assertions / .extract to API endpoints.
 *   4. tasks     - backfill attachment mimeType + byteSize from legacy base64.
 *   5. tasks     - OPTIONAL (--offload-attachments): move base64 attachments out
 *                  of Mongo and onto disk as the new schema expects.
 *
 * Writing is opt-in. The default is a dry run that prints every change it would
 * make and touches nothing.
 *
 * Usage:
 *   node server/scripts/migration.js                    # dry run (default)
 *   node server/scripts/migration.js --apply            # write
 *   node server/scripts/migration.js --apply \
 *        --superadmin=boss@example.com \
 *        --publish-existing-apis \
 *        --offload-attachments --media-root=/path/to/uploads
 *
 * Reads MONGODB_URI (default mongodb://localhost:27017/noobieteam). Back the
 * database up first: mongodump --uri "$MONGODB_URI"
 */
require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
const mongoose = require('mongoose');

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (name) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
};

const APPLY = has('--apply');
const SUPERADMIN = valueOf('superadmin');
const PUBLISH_EXISTING_APIS = has('--publish-existing-apis');
const OFFLOAD = has('--offload-attachments');

// Mirrors config.MEDIA_ROOT in the new app: <repo>/uploads. Point --media-root at
// the new deployment's uploads/ directory when the two repos are not the same
// checkout, or the files land next to a codebase that will never serve them.
const MEDIA_ROOT = path.resolve(valueOf('media-root') || path.join(__dirname, '..', '..', 'uploads'));

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/noobieteam';

const did = (verb) => (APPLY ? verb.applied : verb.planned);
const SET = { applied: 'set', planned: 'would set' };
const MOVE = { applied: 'move', planned: 'would move' };
const CREATE = { applied: 'create', planned: 'would create' };

const idOf = (o) => String(o._id || o.id);
const slugify = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const stats = {
    users: 0, superadmin: 0,
    folderKinds: 0, folderSplits: 0, docsMoved: 0, folderPublished: 0, folderEnvs: 0,
    docSpecs: 0,
    attachmentMeta: 0, attachmentsOffloaded: 0, offloadBytes: 0,
};

/* ------------------------------------------------------------------ helpers */

// "data:image/png;base64,iVBORw0..." -> { mimeType, byteSize }.
// byteSize is the decoded length, computed from the base64 length rather than by
// decoding: an attachment can be tens of megabytes and there is no reason to
// allocate that buffer just to measure it.
const describeDataUrl = (dataUrl) => {
    if (typeof dataUrl !== 'string') return null;
    const match = /^data:([^;,]*)(;base64)?,/.exec(dataUrl);
    if (!match) return null;
    const mimeType = match[1] || '';
    const payload = dataUrl.slice(match[0].length);
    if (!match[2]) return { mimeType, byteSize: Buffer.byteLength(decodeURIComponent(payload)) };
    const clean = payload.replace(/\s/g, '');
    const padding = (clean.match(/=+$/) || [''])[0].length;
    return { mimeType, byteSize: Math.max(0, Math.floor((clean.length * 3) / 4) - padding) };
};

// Same rules as the new app's storage.buildKey(): the extension is
// attacker-controlled (it came from a filename someone typed), so it is reduced
// to a short alphanumeric token before it is ever used as a path segment.
const buildKey = (name) => {
    const raw = String(name || '').split('.').pop();
    const ext = /^[A-Za-z0-9]{1,10}$/.test(raw) ? raw.toLowerCase() : 'bin';
    return `task_media/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
};

/* -------------------------------------------------------------- 1. users */

async function migrateUsers(db) {
    const users = db.collection('users');
    const pending = await users
        .find({ $or: [{ systemRole: { $exists: false } }, { banned: { $exists: false } }] })
        .toArray();

    for (const user of pending) {
        const $set = {};
        if (user.systemRole === undefined) $set.systemRole = 'USER';
        if (user.banned === undefined) $set.banned = false;
        console.log(`  ${did(SET)} ${JSON.stringify($set)} on ${user.email}`);
        if (APPLY) await users.updateOne({ _id: user._id }, { $set });
        stats.users++;
    }

    if (!SUPERADMIN) {
        const admins = await users.countDocuments({ systemRole: 'SUPERADMIN' });
        if (!admins) {
            console.log('  ! no SUPERADMIN exists. Re-run with --superadmin=<email>, or run');
            console.log('    server/scripts/seedSuperadmin.js <email> from the new repo, or the');
            console.log('    admin surfaces stay unreachable. There is no env-var fallback.');
        }
        return;
    }

    const target = await users.findOne({ email: SUPERADMIN });
    if (!target) {
        console.log(`  ! --superadmin=${SUPERADMIN} matches no user; skipping promotion.`);
        return;
    }
    console.log(`  ${did(SET)} systemRole=SUPERADMIN, banned=false on ${SUPERADMIN}`);
    if (APPLY) {
        await users.updateOne({ _id: target._id }, { $set: { systemRole: 'SUPERADMIN', banned: false } });
    }
    stats.superadmin++;
}

/* ------------------------------------------------------------ 2. folders */

// Port of the new repo's scripts/migrateFolderKind.js. A folder belonged to the
// Docs page or the API page by accident of what was inside it — both pages
// filtered on Doc.type. That cannot survive the /docs and /apis route split: a
// published collection is one thing with one URL, and the URL cannot change when
// someone adds a text document to it.
//
// Per ROOT folder, over its whole subtree:
//   - at least one API doc and no text docs -> API
//   - no API docs                           -> DOCS
//   - both ("mixed")                        -> stays DOCS, a sibling root folder
//     "<name> API" (kind API) is created, and every API doc in the subtree moves
//     into it. The move FLATTENS: endpoints from nested subfolders land directly
//     in the new folder rather than recreating the tree. Every move is printed —
//     read the dry run and reorganise afterwards if the nesting mattered.
async function migrateFolderKinds(db) {
    const folderCol = db.collection('folders');
    const docCol = db.collection('docs');

    const folders = await folderCol.find({}).toArray();
    const docs = await docCol.find({}).toArray();

    const childrenOf = (folderId) => folders.filter((f) => f.parentId === folderId);

    // `seen` stops a parentId cycle from recursing forever. A migration that
    // hangs on one bad row is worse than one that skips it, and the skip is
    // reported rather than silent.
    const subtree = (folder, seen = new Set()) => {
        const id = idOf(folder);
        if (seen.has(id)) {
            console.warn(`  ! skipping "${folder.name}": parentId chain loops back to it`);
            return [];
        }
        seen.add(id);
        return childrenOf(id).reduce((acc, kid) => acc.concat(subtree(kid, seen)), [folder]);
    };

    for (const root of folders.filter((f) => !f.parentId)) {
        const tree = subtree(root);
        const treeIds = tree.map(idOf);
        const treeDocs = docs.filter((d) => treeIds.includes(d.folderId));
        const apiDocs = treeDocs.filter((d) => d.type === 'API');
        const textDocs = treeDocs.filter((d) => d.type !== 'API');

        const mixed = apiDocs.length > 0 && textDocs.length > 0;
        const kind = apiDocs.length > 0 && textDocs.length === 0 ? 'API' : 'DOCS';

        // Already migrated: every folder in the subtree has a STORED kind that
        // agrees with what the subtree should be.
        if (tree.every((f) => f.kind === kind) && !mixed) continue;

        console.log(
            `\n  "${root.name}" [${tree.length} folder(s), ${textDocs.length} text, ${apiDocs.length} api]` +
            ` -> ${mixed ? `${kind} (mixed - will split)` : kind}`
        );

        for (const f of tree) {
            if (f.kind === kind) continue;
            console.log(`    ${did(SET)} kind=${kind} on "${f.name}"${f.kind ? ` (was ${f.kind})` : ''}`);
            if (APPLY) await folderCol.updateOne({ _id: f._id }, { $set: { kind } });
            f.kind = kind;
            stats.folderKinds++;
        }

        if (!mixed) continue;

        const siblingName = `${root.name} API`;
        let target = folders.find(
            (f) => !f.parentId && f.workspaceId === root.workspaceId && f.name === siblingName
        );

        if (target) {
            console.log(`    sibling "${siblingName}" already exists - reusing it`);
        } else {
            console.log(`    ${did(CREATE)} sibling folder "${siblingName}" (kind=API)`);
            if (APPLY) {
                const now = new Date();
                const inserted = await folderCol.insertOne({
                    workspaceId: root.workspaceId,
                    name: siblingName,
                    slug: slugify(siblingName),
                    kind: 'API',
                    published: false,
                    order: root.order,
                    createdBy: root.createdBy,
                    // The environments belong to the collection, and the endpoints
                    // that used them are the ones moving — carry them across or
                    // every moved endpoint loses its base URL.
                    environments: root.environments || [],
                    createdAt: now,
                    updatedAt: now,
                    __v: 0,
                });
                target = { _id: inserted.insertedId, name: siblingName };
                folders.push(target);
            }
            stats.folderSplits++;
        }

        for (const doc of apiDocs) {
            const from = folders.find((f) => idOf(f) === doc.folderId);
            console.log(`    ${did(MOVE)} "${doc.title}" from "${from ? from.name : '?'}" -> "${siblingName}"`);
            if (APPLY) await docCol.updateOne({ _id: doc._id }, { $set: { folderId: idOf(target) } });
            stats.docsMoved++;
        }
    }
}

// `published` decides whether an API collection is served on its public URL at
// all. It did not exist before, so old API collections were readable by anyone
// who could guess /apis/<workspace>/<folder-slug> — which is derived from names.
//
// This migration defaults them to NOT published, matching the new schema. That
// is a deliberate behaviour change: any share link handed out for an API
// collection stops working until an owner re-publishes it from the UI. The
// alternative, --publish-existing-apis, keeps those links alive but leaves the
// collections' request headers, bodies and recorded examples — which routinely
// carry real credentials — readable without authentication.
//
// DOCS folders are not gated by the new app, so they are given published:false
// for schema consistency only; their share links keep working either way.
async function migrateFolderPublished(db) {
    const folders = db.collection('folders');
    const pending = await folders.find({ published: { $exists: false } }).toArray();

    for (const folder of pending) {
        const isApi = (folder.kind || 'DOCS') === 'API';
        const published = isApi ? PUBLISH_EXISTING_APIS : false;
        if (isApi) {
            console.log(
                `  ${did(SET)} published=${published} on API collection "${folder.name}"` +
                (published ? '' : '  (public link goes dark until re-published)')
            );
        }
        if (APPLY) await folders.updateOne({ _id: folder._id }, { $set: { published } });
        stats.folderPublished++;
    }
}

// Folder environments gained named {{variables}} alongside baseUrl. Nothing
// queries them, so this is cosmetic — it keeps raw-driver reads from having to
// treat "no variables key" and "empty list" as separate cases.
async function migrateFolderEnvironments(db) {
    const folders = db.collection('folders');
    const pending = await folders.find({ environments: { $exists: true, $ne: [] } }).toArray();

    for (const folder of pending) {
        const environments = folder.environments || [];
        if (!environments.some((e) => e && !Array.isArray(e.variables))) continue;
        const next = environments.map((e) => ({ ...e, variables: Array.isArray(e.variables) ? e.variables : [] }));
        console.log(`  ${did(SET)} environments[].variables=[] on "${folder.name}" (${next.length} env)`);
        if (APPLY) await folders.updateOne({ _id: folder._id }, { $set: { environments: next } });
        stats.folderEnvs++;
    }
}

/* --------------------------------------------------------------- 3. docs */

// apiSpec gained three things: an auth helper, declarative response assertions,
// and response->environment extraction. All three are absent on old endpoints.
// Auth is the one that matters: routes and the client read apiSpec.auth.type to
// decide which credential inputs to render, and an undefined `auth` object is
// not the same shape as one with type:'none'.
async function migrateDocApiSpecs(db) {
    const docs = db.collection('docs');
    const pending = await docs.find({ apiSpec: { $exists: true } }).toArray();

    for (const doc of pending) {
        const spec = doc.apiSpec || {};
        const $set = {};
        if (!spec.auth || !spec.auth.type) $set['apiSpec.auth'] = { type: 'none', addTo: 'header' };
        if (!Array.isArray(spec.assertions)) $set['apiSpec.assertions'] = [];
        if (!Array.isArray(spec.extract)) $set['apiSpec.extract'] = [];
        if (!Object.keys($set).length) continue;

        console.log(`  ${did(SET)} ${Object.keys($set).join(', ')} on "${doc.title}"`);
        if (APPLY) await docs.updateOne({ _id: doc._id }, { $set });
        stats.docSpecs++;
    }
}

/* -------------------------------------------------- 4. attachment metadata */

// Attachments used to be base64 blobs in `dataUrl` with a human-readable `size`
// string. The new schema keeps `dataUrl` working — the client renders either
// shape — but adds `mimeType` and `byteSize`, which it uses to decide whether an
// attachment is an image and to display an exact size. Both are recoverable from
// the data URL itself, so this step needs no file access and no decisions.
async function migrateAttachmentMetadata(db) {
    const tasks = db.collection('tasks');
    const pending = await tasks.find({ 'attachments.0': { $exists: true } }).toArray();

    for (const task of pending) {
        let changed = 0;
        const next = (task.attachments || []).map((a) => {
            if (!a || !a.dataUrl || (a.mimeType && a.byteSize)) return a;
            const info = describeDataUrl(a.dataUrl);
            if (!info) return a;
            changed++;
            return {
                ...a,
                mimeType: a.mimeType || info.mimeType,
                byteSize: a.byteSize || info.byteSize,
            };
        });
        if (!changed) continue;

        console.log(`  ${did(SET)} mimeType/byteSize on ${changed} attachment(s) of "${task.title}"`);
        if (APPLY) await tasks.updateOne({ _id: task._id }, { $set: { attachments: next } });
        stats.attachmentMeta += changed;
    }
}

/* ------------------------------------------ 5. attachment offload (opt-in) */

// Optional: move base64 attachments out of the documents and onto disk, which is
// what `path` exists for. Worth doing on any database that has been used for a
// while — a 16 MB BSON document limit is reached quickly when every screenshot
// is inlined at 4/3 its real size, and the board query drags every byte across
// the wire on each poll.
//
// Files are written BEFORE the row is updated, so a crash mid-run leaves an
// orphaned file (harmless, re-runnable) rather than a row pointing at a file
// that was never written. `dataUrl` is cleared only once its file exists.
async function offloadAttachments(db) {
    const tasks = db.collection('tasks');
    const pending = await tasks.find({ 'attachments.dataUrl': { $exists: true } }).toArray();

    console.log(`  media root: ${MEDIA_ROOT}`);

    for (const task of pending) {
        const next = [];
        let changed = 0;

        for (const a of task.attachments || []) {
            const info = a && a.dataUrl ? describeDataUrl(a.dataUrl) : null;
            if (!info) { next.push(a); continue; }

            const key = buildKey(a.name);
            console.log(`  ${did(MOVE)} "${a.name || '(unnamed)'}" (${info.byteSize} B) -> ${key}`);

            if (APPLY) {
                const base64 = a.dataUrl.slice(a.dataUrl.indexOf(',') + 1).replace(/\s/g, '');
                const target = path.join(MEDIA_ROOT, key);
                await fs.mkdir(path.dirname(target), { recursive: true });
                await fs.writeFile(target, Buffer.from(base64, 'base64'));
            }

            const { dataUrl, ...rest } = a;
            next.push({
                ...rest,
                path: key,
                mimeType: a.mimeType || info.mimeType,
                byteSize: a.byteSize || info.byteSize,
            });
            changed++;
            stats.attachmentsOffloaded++;
            stats.offloadBytes += info.byteSize;
        }

        if (!changed) continue;
        if (APPLY) await tasks.updateOne({ _id: task._id }, { $set: { attachments: next } });
    }
}

/* --------------------------------------------------------------- runner */

(async () => {
    // Connect directly rather than through db.js. Its connectDB() falls back to
    // an in-memory MongoDB when the real server is unreachable, and a migration
    // that silently runs against an empty throwaway database and reports "0
    // documents migrated" is worse than one that fails.
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    const db = mongoose.connection.db;
    console.log(`Connected to ${MONGODB_URI} (db: ${db.databaseName})`);
    console.log(APPLY ? 'Mode: APPLY (writing)\n' : 'Mode: dry run (nothing will be written)\n');

    console.log('1/5 users: systemRole, banned');
    await migrateUsers(db);

    console.log('\n2/5 folders: kind, published, environments[].variables');
    await migrateFolderKinds(db);
    await migrateFolderPublished(db);
    await migrateFolderEnvironments(db);

    console.log('\n3/5 docs: apiSpec.auth / assertions / extract');
    await migrateDocApiSpecs(db);

    console.log('\n4/5 tasks: attachment mimeType / byteSize');
    await migrateAttachmentMetadata(db);

    console.log(`\n5/5 tasks: attachment offload${OFFLOAD ? '' : ' (skipped - pass --offload-attachments)'}`);
    if (OFFLOAD) await offloadAttachments(db);

    console.log('\n--- summary ---');
    console.log(`users backfilled:           ${stats.users}`);
    console.log(`superadmins promoted:       ${stats.superadmin}`);
    console.log(`folders assigned a kind:    ${stats.folderKinds}`);
    console.log(`collections split:          ${stats.folderSplits}`);
    console.log(`endpoints moved:            ${stats.docsMoved}`);
    console.log(`folders given published:    ${stats.folderPublished}`);
    console.log(`folders with env variables: ${stats.folderEnvs}`);
    console.log(`endpoints given apiSpec:    ${stats.docSpecs}`);
    console.log(`attachments given metadata: ${stats.attachmentMeta}`);
    if (OFFLOAD) {
        const mb = (stats.offloadBytes / 1024 / 1024).toFixed(1);
        console.log(`attachments offloaded:      ${stats.attachmentsOffloaded} (${mb} MB out of Mongo)`);
    }
    if (!APPLY) console.log('\nDry run — nothing was written. Re-run with --apply.');

    await mongoose.disconnect();
    process.exit(0);
})().catch(async (e) => {
    console.error('Migration failed:', e);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
