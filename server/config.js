// Single source of truth for env-derived configuration.
// dotenv is loaded here too so this module is safe to require before index.js.
require('dotenv').config();

const path = require('path');

module.exports = {
    // No ADMIN_EMAIL: the SUPERADMIN role lives in the users collection and is
    // re-read from there on every request. Seed the first one with
    // `node server/scripts/seedSuperadmin.js <email>`.
    PORT: process.env.PORT || 8000,

    // Uploaded media lives on this server's disk in <repo>/uploads/, one folder
    // per category (profile_picture, background, task_media), served as static
    // files from this same origin under /media/. No cloud storage and no separate
    // media host, so there is nothing to configure per-deployment.
    //
    // Deliberately OUTSIDE client/: that directory is the deployable source tree,
    // so uploads placed there are destroyed by any deploy that replaces it, and
    // `client/public/` is also Vite's build-input convention. Keeping runtime data
    // in its own root-level folder makes it a single thing to back up or mount as
    // a volume.
    MEDIA_ROOT: path.resolve(__dirname, '..', 'uploads'),
    // Upload size cap in bytes (default 25 MB).
    MAX_UPLOAD_BYTES: Number(process.env.MAX_UPLOAD_BYTES) || 25 * 1024 * 1024,

    // Hosts the API-testing proxy may reach even though they resolve to a
    // private, loopback or otherwise reserved address. Empty by default: the
    // proxy fetches URLs that users type, so anything reachable from it is
    // reachable by every workspace member (see routes/proxy.js).
    //
    // This exists because testing a service on your own machine is the normal
    // case in development, and the guard blocks it. It is deliberately an
    // allowlist of specific hosts rather than a "permit private ranges" switch —
    // the latter would restore the full SSRF hole the guard exists to close, and
    // would expose whatever else lives on the network the server sits on.
    //
    // Entries are `host` or `host:port`, comma-separated. A bare host allows any
    // port on it; add the port to narrow it. Examples:
    //
    //   PROXY_ALLOWED_HOSTS=localhost:3000
    //   PROXY_ALLOWED_HOSTS=localhost,127.0.0.1,api.internal:8080
    //
    // Only set this where you control everyone who can reach the app. On a
    // shared or internet-facing deployment, leave it empty.
    PROXY_ALLOWED_HOSTS: String(process.env.PROXY_ALLOWED_HOSTS || '')
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean),
};
