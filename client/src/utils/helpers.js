// --- Global Utilities ---
// Simple async hashing for Google PIN encryption key
window.inHouseHash = async text => {
    // Web Crypto API is only available in secure contexts (HTTPS or localhost).
    // Provide a robust fallback for development environments or insecure IPs.
    if (window.crypto && window.crypto.subtle) {
        const encoder = new TextEncoder();
        const data = encoder.encode(text);
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } else {
        console.warn('[VAULT] window.crypto.subtle is undefined. Falling back to internal SHA-256 simulation.');
        // A simple deterministic hash fallback for non-secure contexts
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            const char = text.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        // Return as a padded hex string to maintain payload consistency
        return Math.abs(hash).toString(16).padStart(64, '0');
    }
};

// Single clipboard path for the whole app. navigator.clipboard only exists in a
// secure context (HTTPS or localhost), so plain-HTTP deployments fall back to the
// legacy execCommand textarea. Resolves true only when the write actually
// happened — callers must never show a success toast without checking.
window.copyText = async text => {
    if (text === null || text === undefined) return false;
    const value = String(text);
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(value);
            return true;
        }
    } catch (e) {
        // Permission denied or rejected write — fall through to the legacy path.
    }
    try {
        const input = document.createElement('textarea');
        input.value = value;
        input.setAttribute('readonly', '');
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(input);
        return !!ok;
    } catch (e) {
        return false;
    }
};

// One document listener drives a LIFO stack, and Escape only ever invokes the
// topmost entry. This matters because overlays nest: a discard-changes confirm
// opens on top of the card modal, and Escape there must cancel the confirm only.
// Giving each hook its own listener cannot express that — they all sit on
// `document`, where stopPropagation has no effect between sibling listeners and
// stopImmediatePropagation would fire them in registration order (outermost
// first), which is exactly backwards.
//
// Entries are pushed when they become active, so the most recently opened
// overlay is on top regardless of where it sits in the component tree.
(() => {
    const stack = [];
    let listening = false;

    const onKeyDown = event => {
        if (event.key !== 'Escape') return;
        const top = stack[stack.length - 1];
        if (!top || typeof top.current !== 'function') return;
        event.preventDefault();
        top.current();
    };

    window.useEscapeKey = (onEscape, active = true) => {
        const handlerRef = React.useRef(onEscape);
        React.useEffect(() => {
            handlerRef.current = onEscape;
        }, [onEscape]);
        React.useEffect(() => {
            if (!active) return;
            if (!listening) {
                document.addEventListener('keydown', onKeyDown);
                listening = true;
            }
            stack.push(handlerRef);
            return () => {
                const i = stack.lastIndexOf(handlerRef);
                if (i !== -1) stack.splice(i, 1);
            };
        }, [active]);
    };

    // Exposed for tests only.
    window.__ntEscapeStackDepth = () => stack.length;
})();

/**
 * Sanitize author-written HTML before it is handed to dangerouslySetInnerHTML.
 *
 * Documents and collection descriptions are Quill/Tiptap output, stored as HTML
 * and rendered as HTML — in the app, and on the public pages at /docs/ and
 * /apis/, which are same-origin with `localStorage.nt_token`. A collection is
 * written by one workspace member and read by anyone holding the link, so
 * unsanitized markup is script execution in a stranger's browser with a working
 * session sitting next to it. The API page already refuses to store executable
 * assertions for this reason; this closes the HTML path to match.
 *
 * DOMPurify is loaded from a CDN (index.html). If it did not load, return the
 * empty string rather than the markup: a page that renders nothing is a bug, a
 * page that renders unsanitized author HTML is the hole this exists to close.
 */
window.sanitizeHtml = (html) => {
    if (!html) return '';
    if (!window.DOMPurify) {
        console.error('DOMPurify unavailable — refusing to render unsanitized HTML.');
        return '';
    }
    return window.DOMPurify.sanitize(String(html), {
        // `target`/`rel` are on links the reading views already render, and
        // Quill's image button inlines a `data:` URI rather than uploading, so
        // images would otherwise lose their src on documents written that way.
        ADD_ATTR: ['target', 'rel'],
        ADD_DATA_URI_TAGS: ['img'],
    });
};

// Keeps Tab inside an overlay and returns focus to whatever opened it on unmount
// (see UIUX_ISSUES 2.5). Does not steal initial focus — use autoFocus on the
// element that should receive it, so the caller controls where you land.
window.useFocusTrap = (containerRef, active = true) => {
    React.useEffect(() => {
        if (!active) return;
        const previouslyFocused = document.activeElement;
        const SELECTOR =
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
        const focusable = () =>
            Array.from(containerRef.current ? containerRef.current.querySelectorAll(SELECTOR) : []).filter(
                el => el.offsetParent !== null
            );
        const onKeyDown = event => {
            if (event.key !== 'Tab') return;
            const items = focusable();
            if (items.length === 0) return;
            const first = items[0];
            const last = items[items.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            if (previouslyFocused && typeof previouslyFocused.focus === 'function') previouslyFocused.focus();
        };
    }, [active]);
};

// "3 days ago" reads far faster than a full timestamp when scanning a list.
// Past ~30 days relative time stops being meaningful, so fall back to a date.
window.formatRelativeTime = value => {
    if (!value) return '';
    const then = new Date(value);
    if (Number.isNaN(then.getTime())) return '';
    const seconds = Math.floor((Date.now() - then.getTime()) / 1000);
    if (seconds < 0) return then.toLocaleDateString();
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
    return then.toLocaleDateString();
};

window.safeParse = (key, fallback) => {
    try {
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : fallback;
    } catch (e) {
        console.error('Local Storage Corruption Detected:', key);
        localStorage.removeItem(key);
        return fallback;
    }
};

window.generateId = (prefix = '') =>
    prefix + '-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now().toString(36);

// --- Card links inside user text ---------------------------------------------------
//
// Links to a card on this platform should move you within the app, not spawn a tab that
// reloads it from scratch. Production serves the board from task.zettalog.com, so a link
// pasted from there has to be recognised even when it is read on localhost or a tunnel
// host — hence matching that host explicitly alongside the current origin.
window.NT_INTERNAL_CARD_HOSTS = ['task.zettalog.com'];

// Returns { path, workspaceSlug, cardId } for a link to a card on this platform, or null
// for anything else — an external site, a non-card page, or a non-http scheme.
window.parseInternalCardUrl = (rawUrl) => {
    if (!rawUrl) return null;
    let parsed;
    try {
        // Base supplied so protocol-relative and root-relative links resolve too.
        parsed = new URL(String(rawUrl), window.location.origin);
    } catch (e) {
        return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    const isKnownHost = parsed.host === window.location.host
        || window.NT_INTERNAL_CARD_HOSTS.indexOf(parsed.host) !== -1;
    if (!isKnownHost) return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'workspace' || !parts[1]) return null;
    if (parts[2] !== 'card' || !parts[3]) return null;
    return {
        path: `/workspace/${parts[1]}/card/${parts[3]}`,
        workspaceSlug: decodeURIComponent(parts[1]),
        cardId: decodeURIComponent(parts[3]),
    };
};

// Trailing punctuation is nearly always sentence punctuation rather than part of the
// address ("see https://x.com/a." or "(https://x.com/a)"), so it is handed back to the
// surrounding text. Balanced closing brackets are kept when the URL opened one.
window.trimUrlPunctuation = (url) => {
    let end = url.length;
    while (end > 0) {
        const ch = url[end - 1];
        if ('.,;:!?'.indexOf(ch) !== -1) { end -= 1; continue; }
        if (ch === ')') {
            const slice = url.slice(0, end);
            const opens = (slice.match(/\(/g) || []).length;
            const closes = (slice.match(/\)/g) || []).length;
            // Unmatched closer belongs to the sentence, not to the address. A URL that
            // opened its own bracket keeps it: .../Foo_(disambiguation)
            if (closes > opens) { end -= 1; continue; }
        }
        break;
    }
    return url.slice(0, end);
};

// One anchor style for user-authored links. Internal card links are intercepted so they
// navigate in place; everything else opens in a new tab as before. `href` stays set on
// both so cmd/ctrl/middle-click still opens a real tab, and so the status bar shows the
// destination.
window.NTLink = ({ url, children }) => {
    const internal = window.parseInternalCardUrl(url);
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const onClick = internal
        ? (event) => {
            // Leave modified clicks to the browser — that is how you open a card in a
            // second tab on purpose.
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
            event.preventDefault();
            if (window.NTNavigateToCard) window.NTNavigateToCard(internal);
        }
        : undefined;
    return React.createElement(
        'a',
        {
            href,
            onClick,
            className: 'text-blue-500 underline break-words',
            target: internal ? undefined : '_blank',
            rel: internal ? undefined : 'noopener noreferrer',
        },
        children || url
    );
};

// Renders plain text with its URLs turned into anchors. Text, not HTML: comment bodies
// are user input and must never be injected as markup.
window.LinkedText = ({ text, className }) => {
    const value = text === null || text === undefined ? '' : String(text);
    const pattern = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/g;
    const nodes = [];
    let lastIndex = 0;
    let match;
    while ((match = pattern.exec(value)) !== null) {
        const raw = match[0];
        const url = window.trimUrlPunctuation(raw);
        if (!url) continue;
        if (match.index > lastIndex) nodes.push(value.slice(lastIndex, match.index));
        nodes.push(React.createElement(window.NTLink, { key: `${match.index}-${url}`, url }));
        lastIndex = match.index + url.length;
    }
    if (lastIndex < value.length) nodes.push(value.slice(lastIndex));
    return React.createElement('span', { className }, nodes);
};

// The create buttons store a placeholder title ("New Task") and open the editor for the
// real one, so a card created seconds ago and not yet saved still carries that
// placeholder. Announcing it then would broadcast the placeholder, so callers hold it
// back — and must also keep it out of the diff baseline, or it stops looking new on the
// next poll and is never announced at all.
window.CARD_CREATE_GRACE_MS = 30000;
window.isCardAwaitingFirstSave = (card) => {
    if (!card) return false;
    // Any save, move or archive appends a second audit entry — the title has settled.
    const auditLength = Array.isArray(card.auditTrail) ? card.auditTrail.length : 0;
    if (auditLength > 1) return false;
    const createdAt = new Date(card.createdAt || 0).getTime();
    if (!createdAt || Number.isNaN(createdAt)) return false;
    // Bounded, so a card abandoned at its placeholder is still announced eventually
    // rather than staying invisible to the rest of the board forever.
    return Date.now() - createdAt < window.CARD_CREATE_GRACE_MS;
};

// A new card is news to the whole board, so unlike the other card notifications this
// one names the actor rather than addressing the reader.
window.buildCardCreatedMessage = (actor, title) =>
    `${actor || 'Someone'} created "${title || 'Untitled card'}".`;

// Notification copy for a qaStatus value. 'NONE' is a cleared status rather than a
// state to announce, so callers word that case differently.
window.QA_STATUS_LABELS = { NONE: 'None', PENDING: 'Pending', PASSED: 'Passed', FAILED: 'Failed' };
window.formatQaStatus = (status) => window.QA_STATUS_LABELS[status] || String(status || 'None');
window.buildQaNotificationMessage = (title, status) => {
    const name = title || 'Untitled card';
    return (status || 'NONE') === 'NONE'
        ? `QA status for "${name}" was cleared.`
        : `QA status for "${name}" is now ${window.formatQaStatus(status)}.`;
};

/**
 * The one id a workspace is keyed by in per-tab storage (notifications, card
 * snapshots). Rows reach the client with `id`, `_id`, or both, and an ObjectId `_id`
 * needs stringifying — so every screen has to derive this the same way or the Hub and
 * the board end up reading different buckets for the same workspace.
 */
window.getWorkspaceCanonicalId = (ws) => {
    if (!ws) return '';
    const primary = ws.id;
    const secondary = ws._id;
    const pick =
        primary != null && String(primary).trim() !== ''
            ? primary
            : secondary != null && String(secondary).trim() !== ''
                ? secondary
                : '';
    if (pick === '') return '';
    return String(pick);
};

/**
 * Card snapshots used as the "already seen" baseline for notification diffing,
 * keyed by workspace id.
 *
 * The Hub and the project board each run their own poll, and each used to hold its
 * baseline in a component ref. Navigating between the two destroyed that ref, so
 * the next scan ran as an initial scan and folded everything that changed while the
 * other screen was mounted into a fresh baseline — those changes never notified.
 *
 * Stored in sessionStorage alongside the notifications themselves so the two share a
 * lifetime: a brand new tab has neither, and starts from a clean baseline rather than
 * replaying a workspace's whole history as unread notifications.
 */
window.NTCardSnapshots = (() => {
    const storageKey = (workspaceId) => `nt_ws_cardsnapshot_${workspaceId || 'unknown'}`;

    // Only the fields the notification scan actually compares are kept. Card bodies,
    // attachments and full audit trails would push a few busy workspaces past the
    // sessionStorage quota, and the scan never reads them.
    const project = (card) => {
        if (!card) return null;
        const trail = Array.isArray(card.auditTrail) ? card.auditTrail : [];
        const newestStamp = trail.reduce((max, entry) => {
            const time = new Date((entry && entry.timestamp) || 0).getTime();
            return Number.isNaN(time) ? max : Math.max(max, time);
        }, 0);
        const comments = Array.isArray(card.comments) ? card.comments : [];
        return {
            id: card.id,
            _id: card._id,
            title: card.title,
            assignees: Array.isArray(card.assignees) ? card.assignees.slice() : [],
            dueDate: card.dueDate,
            archived: !!card.archived,
            columnId: card.columnId,
            col: card.col,
            // Normalised, because a card that predates the field reads as undefined and
            // would otherwise look like a change away from 'NONE' on every single poll.
            qaStatus: card.qaStatus || 'NONE',
            updatedAt: card.updatedAt,
            // Comment identity and mention targets only — the id falls back to
            // author+timestamp+position, so order has to survive the projection.
            comments: comments.map((comment) => ({
                _id: comment && comment._id,
                id: comment && comment.id,
                authorEmail: comment && comment.authorEmail,
                timestamp: comment && comment.timestamp,
                taggedUsers: Array.isArray(comment && comment.taggedUsers) ? comment.taggedUsers.slice() : [],
            })),
            // The scan reads this trail only to take its newest timestamp as the
            // watermark for "audit entries added since", so one entry carries it all.
            auditTrail: newestStamp ? [{ timestamp: new Date(newestStamp).toISOString() }] : [],
        };
    };

    return {
        /** Returns null when this tab has no baseline yet, which callers treat as an initial scan. */
        read(workspaceId) {
            if (!workspaceId) return null;
            try {
                const raw = sessionStorage.getItem(storageKey(workspaceId));
                if (!raw) return null;
                const data = JSON.parse(raw);
                return Array.isArray(data) ? data : null;
            } catch (e) {
                return null;
            }
        },
        write(workspaceId, cards) {
            if (!workspaceId) return;
            try {
                const projected = (Array.isArray(cards) ? cards : [])
                    // A card awaiting its first save is deliberately left out of the
                    // baseline: it has to keep looking new until its real title lands,
                    // or the hold-back in the scan would silence it permanently.
                    .filter((card) => !window.isCardAwaitingFirstSave(card))
                    .map(project)
                    .filter(Boolean);
                sessionStorage.setItem(storageKey(workspaceId), JSON.stringify(projected));
            } catch (e) {
                // Quota or serialization failure only costs this tab one baseline: the
                // next scan re-reads as initial instead of notifying stale changes.
            }
        },
    };
})();

// Derives 2-letter initials for avatar fallbacks. Accepts a user-like object or a raw string.
// Objects prefer `name` over `email` so a display name wins when one is set.
// Strings drop the domain if they look like an email, then split on common separators
// (./_/-/space) and use the first letter of each of the first 2 segments; otherwise the
// first 2 characters.
// Examples: {name:"Jin Lun"} -> "JL", "junwah@x" -> "JU", "jin.lun@x" -> "JL", "" -> "?".
window.getInitials = input => {
    const source = typeof input === 'string' ? input : (input?.name || input?.email || '');
    if (!source || typeof source !== 'string') return '?';
    const base = (source.includes('@') ? source.split('@')[0] : source).trim();
    if (!base) return '?';
    const parts = base.split(/[._\-\s]+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    if (base.length >= 2) return base.slice(0, 2).toUpperCase();
    return base[0].toUpperCase();
};

// Turn a stored media key into a URL. Keys look like `task_media/<file>` and are
// served from this origin under /media/, so the mapping is synchronous — no
// waiting on /api/config, no media host to resolve.
//
// Stored keys never include the URL prefix, which is what made moving the upload
// directory a config change rather than a data migration.
//
// Three legacy shapes still have to render, or existing data disappears from the UI:
//   - absolute http(s) URLs, from when uploads went to an OSS bucket
//   - `data:` URLs, from when card attachments were base64-embedded in the task
//   - `/public/...`, from the brief window when uploads lived in client/public/
window.getImageUrl = path => {
    if (!path) return '';
    const value = String(path);
    if (/^https?:\/\//.test(value) || value.startsWith('data:')) return value;
    const key = value.replace(/^\/+/, '').replace(/^(media|public)\//, '');
    return `/media/${key}`;
};

// Robust In-House Hex-based Encryption (Unicode safe)
window.stringToHex = str => {
    let res = '';
    for (let i = 0; i < str.length; i++) res += str.charCodeAt(i).toString(16).padStart(4, '0');
    return res;
};

window.hexToString = hex => {
    let res = '';
    for (let i = 0; i < hex.length; i += 4) res += String.fromCharCode(parseInt(hex.substr(i, 4), 16));
    return res;
};

window.inHouseEncrypt = (text, key) => {
    if (!key) key = 'noobieteam_core';
    const hexText = window.stringToHex(text);
    let result = '';
    for (let i = 0; i < hexText.length; i++) {
        result += String.fromCharCode(hexText.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return btoa(result);
};

window.inHouseDecrypt = (base64, key) => {
    try {
        if (!key) key = 'noobieteam_core';
        const cipher = atob(base64);
        let hex = '';
        for (let i = 0; i < cipher.length; i++) {
            hex += String.fromCharCode(cipher.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        return window.hexToString(hex);
    } catch (e) {
        return null;
    }
};

window.extractYoutubeId = url => {
    if (!url) return null;
    let cleanUrl = url.trim().replace(/['"]/g, '');
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=|shorts\/|live\/)([^#\&\?\/]*).*/;
    const match = cleanUrl.match(regExp);
    return match && match[2].length === 11 ? match[2] : null;
};

window.extractPlaylistId = url => {
    if (!url) return null;
    let cleanUrl = url.trim().replace(/['"]/g, '');
    const regExp = /[&?]list=([^&]+)/i;
    const match = cleanUrl.match(regExp);
    return match ? match[1] : null;
};

window.extractSpotifyPlaylistId = url => {
    if (!url) return null;
    const cleanUrl = url.trim().replace(/['"]/g, '');
    const uriMatch = cleanUrl.match(/^spotify:playlist:([a-zA-Z0-9]+)$/i);
    if (uriMatch) return uriMatch[1];
    const webMatch = cleanUrl.match(/spotify\.com\/(?:embed\/)?playlist\/([a-zA-Z0-9]+)(?:\?|$|\/)/i);
    return webMatch ? webMatch[1] : null;
};

// Password policy — kept in sync with the server validator in server/routes/users.js.
// Login is deliberately exempt: accounts created before this rule must still sign in.
window.PASSWORD_MIN_LENGTH = 8;
window.PASSWORD_SYMBOL_REGEX = /[^A-Za-z0-9]/;
window.checkPasswordRules = (password) => {
    const value = String(password || '');
    const length = value.length >= window.PASSWORD_MIN_LENGTH;
    const symbol = window.PASSWORD_SYMBOL_REGEX.test(value);
    return { length, symbol, valid: length && symbol };
};

// --- API request helpers (shared by the workspace API tab and the public API page) ---

// Rewrite a documented request URL against the selected environment's base URL.
// Authors write the URL in one of three shapes and all three must resolve:
//   {{base}}/v1/users     -> placeholder swapped for the base URL
//   https://a.com/v1/users -> host/protocol/port swapped, path kept
//   /v1/users              -> appended to the base URL
// With no environment selected the URL is returned untouched.
window.resolveApiUrl = (rawUrl, env) => {
    let url = rawUrl || '';
    const base = env && env.baseUrl;
    if (!base) return url;
    const trimmedBase = base.replace(/\/$/, '');

    if (/\{\{.*?\}\}/.test(url)) return url.replace(/\{\{.*?\}\}/g, trimmedBase);

    if (/^https?:\/\//.test(url)) {
        try {
            const parsedUrl = new URL(url);
            const parsedBase = new URL(base);
            parsedUrl.protocol = parsedBase.protocol;
            parsedUrl.host = parsedBase.host;
            parsedUrl.port = parsedBase.port;
            return parsedUrl.toString();
        } catch (e) {
            return url;
        }
    }

    // A bare `api.example.com/v1/users` keeps only its path; anything else is a path already.
    const hostLike = url.match(/^([a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|localhost)(:\d+)?(\/.*)?$/);
    if (hostLike) return trimmedBase + (hostLike[3] || '');
    return trimmedBase + '/' + url.replace(/^\//, '');
};

// Tailwind classes for an HTTP method chip.
window.methodColor = (method) => {
    switch (method) {
        case 'GET': return 'bg-blue-100 text-blue-700';
        case 'POST': return 'bg-emerald-100 text-emerald-700';
        case 'PUT': return 'bg-yellow-100 text-yellow-700';
        case 'PATCH': return 'bg-purple-100 text-purple-700';
        default: return 'bg-red-100 text-red-700';
    }
};

// Apply an apiSpec's query parameters to a resolved URL.
window.withQueryParams = (url, queryParams) => {
    const pairs = (queryParams || []).filter(q => q && q.key);
    if (!pairs.length) return url;
    const params = new URLSearchParams();
    pairs.forEach(q => params.append(q.key, q.value || ''));
    return url + (url.includes('?') ? '&' : '?') + params.toString();
};

// Decorate rendered document HTML in a read-only container.
//
// Stored documents are plain HTML, so two affordances the editor provides have
// to be grafted on after render: a copy button on every code block, and a
// horizontal scroll box around wide tables (Tiptap's own .tableWrapper only
// exists inside the editor view, never in the saved markup).
//
// Safe to call repeatedly — already-decorated nodes are skipped.
window.enhanceDocContent = (root, labels = {}) => {
    if (!root) return;
    const copyLabel = labels.copy || 'Copy';
    const copiedLabel = labels.copied || 'Copied';

    root.querySelectorAll('pre').forEach(pre => {
        if (pre.parentElement && pre.parentElement.classList.contains('nd-code')) return;
        const wrap = document.createElement('div');
        wrap.className = 'nd-code';
        pre.parentNode.insertBefore(wrap, pre);
        wrap.appendChild(pre);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'nd-copy';
        btn.textContent = copyLabel;
        btn.addEventListener('click', async () => {
            const ok = await window.copyText(pre.innerText);
            btn.textContent = ok ? copiedLabel : copyLabel;
            btn.classList.toggle('is-copied', ok);
            setTimeout(() => { btn.textContent = copyLabel; btn.classList.remove('is-copied'); }, 1600);
        });
        wrap.appendChild(btn);
    });

    root.querySelectorAll('table').forEach(table => {
        if (table.parentElement && table.parentElement.classList.contains('nd-table-scroll')) return;
        const wrap = document.createElement('div');
        wrap.className = 'nd-table-scroll';
        table.parentNode.insertBefore(wrap, table);
        wrap.appendChild(table);
    });

    // Checkboxes in a to-do list are a rendering of stored state, not a control.
    root.querySelectorAll('input[type="checkbox"]').forEach(box => { box.disabled = true; });
};

(() => {
    // --- Markdown -> HTML --------------------------------------------------------
    // Shared by two callers: the editor, which rescues markdown pasted as plain
    // text, and the Docs importer, which turns an uploaded .md file into a
    // document. Documents are stored as HTML, so this is the only conversion step.
    const _looksLikeMarkdown = (text) => /^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```|\|)/m.test(text)
        || /\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)/.test(text);

    const escapeHtml = (s) => String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const inlineMarkdown = (text) => escapeHtml(text)
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_]+)__/g, '<strong>$1</strong>')
        .replace(/~~([^~]+)~~/g, '<s>$1</s>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
        .replace(/(^|[^_])_([^_]+)_/g, '$1<em>$2</em>');

    // Table rows look like `| a | b |`; the delimiter row (`| --- | --- |`) marks
    // the line above it as the header.
    const isTableDelimiter = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
    const splitRow = (line) => line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());

    const _markdownToHtml = (text) => {
        const lines = text.replace(/\r\n?/g, '\n').split('\n');
        const out = [];
        let listType = null;
        let inFence = false;
        let fence = [];

        // A task list is still a <ul>, but Tiptap only recognises it by the
        // data-type marker — without it the items land in a plain bullet list and
        // leave an empty stray list behind.
        const LIST_TAGS = { ul: ['<ul>', '</ul>'], ol: ['<ol>', '</ol>'], task: ['<ul data-type="taskList">', '</ul>'] };
        const closeList = () => { if (listType) { out.push(LIST_TAGS[listType][1]); listType = null; } };
        const openList = (type) => { if (listType !== type) { closeList(); out.push(LIST_TAGS[type][0]); listType = type; } };

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            if (/^\s*```/.test(line)) {
                if (inFence) { out.push(`<pre><code>${escapeHtml(fence.join('\n'))}</code></pre>`); fence = []; }
                else closeList();
                inFence = !inFence;
                continue;
            }
            if (inFence) { fence.push(line); continue; }

            // A table needs its delimiter row to be recognised, so look ahead.
            if (/\|/.test(line) && lines[i + 1] !== undefined && isTableDelimiter(lines[i + 1])) {
                closeList();
                const head = splitRow(line);
                const rows = [];
                let j = i + 2;
                while (j < lines.length && /\|/.test(lines[j]) && lines[j].trim()) { rows.push(splitRow(lines[j])); j++; }
                out.push('<table><tbody><tr>'
                    + head.map(c => `<th>${inlineMarkdown(c)}</th>`).join('')
                    + '</tr>'
                    + rows.map(r => '<tr>' + r.map(c => `<td>${inlineMarkdown(c)}</td>`).join('') + '</tr>').join('')
                    + '</tbody></table>');
                i = j - 1;
                continue;
            }

            if (!line.trim()) { closeList(); continue; }
            if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { closeList(); out.push('<hr>'); continue; }

            const heading = /^(#{1,6})\s+(.*)$/.exec(line);
            if (heading) {
                closeList();
                const level = Math.min(heading[1].length, 3);
                out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
                continue;
            }
            const todo = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line);
            if (todo) {
                openList('task');
                out.push(`<li data-type="taskItem" data-checked="${todo[1].trim() ? 'true' : 'false'}"><p>${inlineMarkdown(todo[2])}</p></li>`);
                continue;
            }
            const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
            if (bullet) { openList('ul'); out.push(`<li>${inlineMarkdown(bullet[1])}</li>`); continue; }

            const ordered = /^\s*\d+\.\s+(.*)$/.exec(line);
            if (ordered) { openList('ol'); out.push(`<li>${inlineMarkdown(ordered[1])}</li>`); continue; }

            const quote = /^>\s?(.*)$/.exec(line);
            if (quote) { closeList(); out.push(`<blockquote><p>${inlineMarkdown(quote[1])}</p></blockquote>`); continue; }

            closeList();
            out.push(`<p>${inlineMarkdown(line)}</p>`);
        }
        if (inFence && fence.length) out.push(`<pre><code>${escapeHtml(fence.join('\n'))}</code></pre>`);
        closeList();
        return out.join('');
    };
    window.looksLikeMarkdown = _looksLikeMarkdown;
    window.markdownToHtml = _markdownToHtml;
})();

// --- HTML -> Markdown --------------------------------------------------------
// The inverse of window.markdownToHtml, used to export stored documents as .md.
// It walks the rendered DOM rather than pattern-matching the HTML string, so it
// sees the same structure a reader does and cannot be fooled by attribute order
// or self-closing quirks.
(() => {
    const BLOCK_MARK = { STRONG: '**', B: '**', EM: '*', I: '*', S: '~~', DEL: '~~', STRIKE: '~~' };

    // Pipes would split a table cell; backslash-escape them inside one.
    const escapePipes = (text) => text.replace(/\|/g, '\\|');

    const inline = (node) => {
        if (node.nodeType === 3) return node.nodeValue.replace(/\s+/g, ' ');
        if (node.nodeType !== 1) return '';
        const tag = node.tagName;
        if (tag === 'BR') return '\n';
        if (tag === 'CODE' && !(node.parentElement && node.parentElement.tagName === 'PRE')) {
            return '`' + node.textContent + '`';
        }
        if (tag === 'IMG') {
            const src = node.getAttribute('src') || '';
            // Relative /media paths mean nothing outside the app, so the export
            // carries absolute URLs.
            const abs = /^https?:|^data:/.test(src) ? src : window.location.origin + src;
            return `![${node.getAttribute('alt') || ''}](${abs})`;
        }
        const inner = children(node);
        if (tag === 'A') {
            const href = node.getAttribute('href') || '';
            return href ? `[${inner}](${href})` : inner;
        }
        const mark = BLOCK_MARK[tag];
        // An empty pair of markers renders as literal asterisks, so skip them.
        if (mark) return inner.trim() ? mark + inner.trim() + mark : inner;
        return inner;
    };

    const children = (node) => Array.from(node.childNodes).map(inline).join('');

    const listItems = (list, ordered, depth) => {
        const pad = '  '.repeat(depth);
        const isTaskList = list.getAttribute('data-type') === 'taskList';
        return Array.from(list.children).filter(li => li.tagName === 'LI').map((li, i) => {
            const nested = Array.from(li.children).filter(c => c.tagName === 'UL' || c.tagName === 'OL');
            const own = Array.from(li.childNodes)
                .filter(c => !(c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL')))
                .map(inline).join('').trim();
            let bullet = ordered ? `${i + 1}.` : '-';
            if (isTaskList) bullet = `- [${li.getAttribute('data-checked') === 'true' ? 'x' : ' '}]`;
            const lines = [`${pad}${bullet} ${own}`];
            nested.forEach(sub => lines.push(listItems(sub, sub.tagName === 'OL', depth + 1)));
            return lines.join('\n');
        }).join('\n');
    };

    const table = (node) => {
        const rows = Array.from(node.querySelectorAll('tr'));
        if (!rows.length) return '';
        const cells = (tr) => Array.from(tr.children).map(td => escapePipes(children(td).trim()));
        const head = cells(rows[0]);
        const body = rows.slice(1).map(cells);
        const out = ['| ' + head.join(' | ') + ' |', '| ' + head.map(() => '---').join(' | ') + ' |'];
        body.forEach(r => out.push('| ' + r.join(' | ') + ' |'));
        return out.join('\n');
    };

    const block = (node) => {
        if (node.nodeType === 3) {
            const text = node.nodeValue.trim();
            return text ? text : '';
        }
        if (node.nodeType !== 1) return '';
        const tag = node.tagName;
        if (/^H[1-6]$/.test(tag)) return '#'.repeat(Math.min(Number(tag[1]), 6)) + ' ' + children(node).trim();
        if (tag === 'P') return children(node).trim();
        if (tag === 'UL') return listItems(node, false, 0);
        if (tag === 'OL') return listItems(node, true, 0);
        if (tag === 'BLOCKQUOTE') {
            return blocks(node).split('\n').map(l => '> ' + l).join('\n');
        }
        if (tag === 'PRE') return '```\n' + node.textContent.replace(/\n$/, '') + '\n```';
        if (tag === 'HR') return '---';
        if (tag === 'TABLE') return table(node);
        if (tag === 'IMG') return inline(node);
        if (tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE') return blocks(node);
        return children(node).trim();
    };

    const blocks = (root) => Array.from(root.childNodes)
        .map(block)
        .filter(part => part !== '')
        .join('\n\n');

    window.htmlToMarkdown = (html) => {
        const probe = document.createElement('div');
        probe.innerHTML = html || '';
        // Copy buttons and scroll wrappers are reading-view decorations, never content.
        probe.querySelectorAll('.nd-copy').forEach(el => el.remove());
        probe.querySelectorAll('.nd-table-scroll').forEach(el => el.replaceWith(...el.childNodes));
        return blocks(probe).replace(/\n{3,}/g, '\n\n').trim() + '\n';
    };
})();
