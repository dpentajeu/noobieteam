const http = require('http');
const https = require('https');
const net = require('net');
const { URL } = require('url');
const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { requireWsMember } = require('../middleware/workspaceAuth');
const { safeLookup, isBlockedAddress, BlockedAddressError } = require('../middleware/ssrfGuard');
const { PROXY_ALLOWED_HOSTS } = require('../config');

// Server-side request proxy for the API-testing page.
//
// The browser cannot call most third-party APIs directly: without permissive
// CORS headers on the target, `fetch` fails before a response is ever read.
// Postman's desktop app sidesteps this by being native; a web app needs the
// request to leave from the server instead.
//
// That makes this route the most dangerous one in the codebase — it issues
// requests, from inside our network, to a URL the caller chooses. Every control
// below exists to keep it from becoming an SSRF primitive, and none of them
// should be relaxed without replacing them with something equivalent:
//
//   * membership   — `requireWsMember` on top of the global JWT gate, so this is
//                    reachable only by a member of the workspace, never anonymously.
//   * addressing   — `safeLookup` rejects private/loopback/link-local/reserved
//                    targets inside the resolver the socket uses, which closes
//                    the DNS-rebinding window a pre-flight check would leave open.
//   * schemes      — http and https only. No file:, gopher:, ftp:, data:.
//   * redirects    — followed manually, capped, and re-validated per hop. Node's
//                    automatic redirect handling would resolve the next hop
//                    without the guard.
//   * headers      — only headers the caller listed are forwarded. Nothing from
//                    the incoming request is passed through, so this server's own
//                    session cookie and Authorization header can never leak to
//                    the target.
//   * limits       — request timeout and a response byte cap, so a slow or
//                    endless target cannot pin a worker or exhaust memory.

const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 15000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024;
const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

// Headers that describe a single hop and must never be relayed onto the next
// one, plus the credential headers we refuse to accept from the caller at all
// (they would be this server's, not the target's, business).
const HOP_BY_HOP = new Set([
    'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailer', 'transfer-encoding', 'upgrade',
    'host', 'content-length',
]);
const NEVER_FORWARD = new Set(['cookie', 'cookie2']);

const isSafeHeaderName = (name) => /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name);
// A newline in a header value is a request-splitting attempt.
const isSafeHeaderValue = (value) => !/[\r\n]/.test(value);

// IPv6 hostnames arrive from `new URL` wrapped in brackets; net.isIP wants them bare.
const bareHost = (url) => url.hostname.replace(/^\[|\]$/g, '');

if (PROXY_ALLOWED_HOSTS.length) {
    console.warn(
        `[proxy] PROXY_ALLOWED_HOSTS is set: ${PROXY_ALLOWED_HOSTS.join(', ')}. ` +
        'The API-testing proxy will reach these even on private/loopback addresses. ' +
        'Every workspace member can therefore reach them through this server.'
    );
}

/**
 * Whether an operator has explicitly permitted this host despite it resolving
 * into a blocked range. Matches on the bare host (any port) or on `host:port`.
 */
const isAllowlisted = (url) => {
    if (!PROXY_ALLOWED_HOSTS.length) return false;
    const host = bareHost(url).toLowerCase();
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    return PROXY_ALLOWED_HOSTS.includes(host) || PROXY_ALLOWED_HOSTS.includes(`${host}:${port}`);
};

/**
 * Reject a URL written with a literal blocked IP.
 *
 * `options.lookup` is only consulted for hostnames that need resolving, so a
 * URL like `http://127.0.0.1:3000/` connects straight through and never reaches
 * `safeLookup`. This closes that path. It runs on the initial URL and again on
 * every redirect hop; `safeLookup` still covers hostnames, where it also closes
 * the DNS-rebinding window.
 */
const assertHostAllowed = (url) => {
    if (isAllowlisted(url)) return;
    const host = bareHost(url);
    if (net.isIP(host) && isBlockedAddress(host)) {
        throw new BlockedAddressError(url.hostname, host);
    }
};

/**
 * Perform one guarded request. Redirects are handled by the caller so each hop
 * runs back through `safeLookup` and the scheme check.
 */
const requestOnce = (target, { method, headers, body: payload }) => new Promise((resolve, reject) => {
    const client = target.protocol === 'https:' ? https : http;

    const req = client.request({
        protocol: target.protocol,
        hostname: bareHost(target),
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method,
        headers: { ...headers, Host: target.host },
        // An allowlisted host skips the guarded resolver entirely — otherwise
        // `localhost` would still be refused at the point it resolves to ::1,
        // and the allowlist would do nothing for the case it exists to serve.
        lookup: isAllowlisted(target) ? undefined : safeLookup,
        // Node would otherwise resolve a redirect target itself, without the guard.
        // We never let it: redirects come back to the caller as 3xx responses.
        timeout: TIMEOUT_MS,
    }, (res) => {
        const chunks = [];
        let received = 0;
        let truncated = false;

        res.on('data', (chunk) => {
            received += chunk.length;
            if (received > MAX_RESPONSE_BYTES) {
                truncated = true;
                res.destroy();
                return;
            }
            chunks.push(chunk);
        });

        const finish = () => resolve({
            status: res.statusCode,
            statusText: res.statusMessage || '',
            headers: res.headers,
            body: Buffer.concat(chunks),
            truncated,
        });

        res.on('end', finish);
        // A destroy triggered by the size cap ends the stream via 'close', not 'end'.
        res.on('close', () => { if (truncated) finish(); });
        res.on('error', reject);
    });

    req.on('timeout', () => {
        req.destroy(Object.assign(new Error(`Request timed out after ${TIMEOUT_MS}ms`), { code: 'ETIMEDOUT' }));
    });
    req.on('error', reject);

    if (payload && payload.length) req.write(payload);
    req.end();
});

router.post('/workspaces/:wsId/proxy', requireWsMember(), [
    // `optional()` alone skips only `undefined`. The client sends an explicit
    // `null` body for GET/HEAD, so these have to accept null as "not provided".
    body('url').isString().trim().notEmpty().withMessage('url is required'),
    body('method').optional({ nullable: true }).isString(),
    body('headers').optional({ nullable: true }).isArray().withMessage('headers must be an array'),
    body('body').optional({ nullable: true }).isString(),
], validate, async (req, res) => {
    const started = Date.now();

    const method = String(req.body.method || 'GET').toUpperCase();
    if (!ALLOWED_METHODS.includes(method)) {
        return res.status(400).json({ error: `Unsupported method: ${method}` });
    }

    let target;
    try {
        target = new URL(String(req.body.url));
    } catch (e) {
        return res.status(400).json({ error: 'Invalid URL' });
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        return res.status(400).json({ error: `Unsupported scheme: ${target.protocol}` });
    }

    // Credentials embedded in the URL (http://user:pass@host) are dropped rather
    // than forwarded — the caller should use the Auth tab, which is explicit.
    target.username = '';
    target.password = '';

    const headers = {};
    for (const h of (req.body.headers || [])) {
        if (!h || typeof h.key !== 'string') continue;
        const key = h.key.trim();
        const value = String(h.value == null ? '' : h.value);
        if (!key) continue;
        if (!isSafeHeaderName(key)) {
            return res.status(400).json({ error: `Invalid header name: ${key}` });
        }
        if (!isSafeHeaderValue(value)) {
            return res.status(400).json({ error: `Invalid header value for ${key}` });
        }
        const lower = key.toLowerCase();
        if (HOP_BY_HOP.has(lower) || NEVER_FORWARD.has(lower)) continue;
        headers[key] = value;
    }
    // Identify ourselves rather than impersonating a browser.
    if (!Object.keys(headers).some(k => k.toLowerCase() === 'user-agent')) {
        headers['User-Agent'] = 'Noobieteam-API-Client';
    }
    if (!Object.keys(headers).some(k => k.toLowerCase() === 'accept-encoding')) {
        // No decompression on our side, so ask for none.
        headers['Accept-Encoding'] = 'identity';
    }

    let payload = null;
    if (method !== 'GET' && method !== 'HEAD' && typeof req.body.body === 'string' && req.body.body.length) {
        payload = Buffer.from(req.body.body, 'utf8');
        if (payload.length > MAX_REQUEST_BODY_BYTES) {
            return res.status(413).json({ error: 'Request body too large' });
        }
        headers['Content-Length'] = String(payload.length);
    }

    try {
        let current = target;
        let currentMethod = method;
        let currentPayload = payload;
        let result = null;
        let redirected = false;

        for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
            assertHostAllowed(current);
            result = await requestOnce(current, { method: currentMethod, headers, body: currentPayload });

            const location = result.headers.location;
            const isRedirect = result.status >= 300 && result.status < 400 && location;
            if (!isRedirect) break;

            if (hop === MAX_REDIRECTS) {
                return res.status(502).json({ error: `Too many redirects (>${MAX_REDIRECTS})` });
            }

            let next;
            try {
                next = new URL(location, current);
            } catch (e) {
                return res.status(502).json({ error: `Invalid redirect target: ${location}` });
            }
            if (next.protocol !== 'http:' && next.protocol !== 'https:') {
                return res.status(400).json({ error: `Redirect to unsupported scheme: ${next.protocol}` });
            }
            // Redirecting to a different origin must not carry the caller's
            // Authorization header along with it.
            if (next.origin !== current.origin) {
                Object.keys(headers)
                    .filter(k => k.toLowerCase() === 'authorization')
                    .forEach(k => { delete headers[k]; });
            }
            // 303, and 301/302 on a POST, become a GET without a body — the same
            // rule browsers follow.
            if (result.status === 303 || ((result.status === 301 || result.status === 302) && currentMethod === 'POST')) {
                currentMethod = 'GET';
                currentPayload = null;
                delete headers['Content-Length'];
            }
            current = next;
            redirected = true;
        }

        const bodyText = result.body.toString('utf8');
        const responseHeaders = Object.keys(result.headers).map(key => ({
            key,
            value: Array.isArray(result.headers[key]) ? result.headers[key].join(', ') : String(result.headers[key]),
        }));

        return res.json({
            status: result.status,
            statusText: result.statusText,
            headers: responseHeaders,
            body: bodyText,
            size: result.body.length,
            truncated: result.truncated,
            time: Date.now() - started,
            // Only when a hop actually happened. `new URL()` normalises — it turns
            // "https://example.com" into "https://example.com/" — so returning it
            // unconditionally made the client report a redirect for every request
            // whose URL was written without a trailing slash.
            finalUrl: redirected ? current.toString() : null,
        });
    } catch (err) {
        // A blocked address is the caller aiming at somewhere they may not go —
        // report it plainly rather than as a generic upstream failure.
        if (err instanceof BlockedAddressError || err.code === 'EBLOCKEDADDRESS') {
            return res.status(403).json({ error: err.message });
        }
        if (err.code === 'ETIMEDOUT') {
            return res.status(504).json({ error: err.message });
        }
        return res.status(502).json({
            error: err.message || 'Upstream request failed',
            code: err.code || undefined,
        });
    }
});

module.exports = router;
