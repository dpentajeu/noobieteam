    // Media storage — the server's own disk, in <repo>/uploads/.
//
// Uploads land in one of four category folders and are served straight back as
// static files by index.js:
//
//   uploads/profile_picture/  ->  /media/profile_picture/<file>
//   uploads/background/       ->  /media/background/<file>
//   uploads/task_media/       ->  /media/task_media/<file>
//   uploads/doc_media/        ->  /media/doc_media/<file>
//
// No cloud provider, no credentials, no separate media host. A stored key is
// category-relative (`task_media/<file>`) and carries no URL prefix, so the
// serving path can change without migrating stored data — window.getImageUrl
// adds the prefix on the client.
const fs = require('fs/promises');
const path = require('path');
const { MEDIA_ROOT } = require('../config');

// The only folders an upload may target. Anything else is rejected rather than
// created, so a caller cannot invent directories under the web root.
const CATEGORIES = Object.freeze(['profile_picture', 'background', 'task_media', 'doc_media']);

// Resolve a storage key to an absolute path, refusing anything that escapes the
// media root. buildKey() already sanitises the extension; this is the second
// line of defence for keys arriving from anywhere else (e.g. remove()).
function resolveKey(key) {
    const target = path.resolve(MEDIA_ROOT, key);
    const root = path.resolve(MEDIA_ROOT);
    if (target !== root && !target.startsWith(root + path.sep)) {
        throw new Error('Invalid storage key.');
    }
    return target;
}

// Build a storage key from a category and an uploaded filename.
//
// The extension is attacker-controlled, so it is stripped down to a short
// alphanumeric token before it reaches a filesystem path. Without this an
// originalname like "x.png/../../server/index.js" would escape the category
// folder and could overwrite application files.
function buildKey(category, originalname) {
    if (!CATEGORIES.includes(category)) {
        throw new Error(`Unknown media category "${category}". Expected one of: ${CATEGORIES.join(', ')}.`);
    }
    const raw = String(originalname || '').split('.').pop();
    const ext = /^[A-Za-z0-9]{1,10}$/.test(raw) ? raw.toLowerCase() : 'bin';
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `${category}/${unique}.${ext}`;
}

async function put(key, buffer) {
    const target = resolveKey(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, buffer);
    return { key };
}

async function remove(key) {
    const target = resolveKey(key);
    await fs.rm(target, { force: true });
}

// Best-effort bulk delete. Never throws: callers use this to clean up after a
// database write that has already succeeded, so a file that cannot be unlinked
// is a storage leak to log, not a reason to fail the request.
async function removeMany(keys) {
    const removed = [];
    for (const key of keys || []) {
        if (!key) continue;
        try {
            await remove(key);
            removed.push(key);
        } catch (err) {
            console.error('Failed to remove media file', key, err.message);
        }
    }
    return removed;
}

module.exports = {
    CATEGORIES,
    // URL prefix the stored key is served under, relative to this origin.
    publicPrefix: '/media',
    buildKey,
    put,
    remove,
    removeMany,
    resolveKey,
};
