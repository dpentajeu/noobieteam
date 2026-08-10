const dns = require('dns');
const net = require('net');

// SSRF guard for the API-testing proxy.
//
// The proxy fetches a URL the user typed, from inside our network. Without this
// module that turns the server into a confused deputy: `169.254.169.254` hands
// over cloud instance credentials, `127.0.0.1:27017` reaches MongoDB, and any
// RFC1918 address reaches whatever else lives behind the firewall.
//
// Filtering the hostname is not enough. An attacker controls their own DNS, so
// a name that resolves to a public address when we check it can resolve to
// 127.0.0.1 by the time the socket connects (DNS rebinding). The defence is to
// validate inside the resolver the socket itself uses: `safeLookup` is passed
// to `http.request` as `options.lookup`, so every address the connection could
// possibly use has been checked, and there is no second unguarded resolution.

const ipv4Blocks = [
    ['0.0.0.0', 8],          // "this" network
    ['10.0.0.0', 8],         // RFC1918 private
    ['100.64.0.0', 10],      // carrier-grade NAT
    ['127.0.0.0', 8],        // loopback
    ['169.254.0.0', 16],     // link-local — cloud instance metadata lives here
    ['172.16.0.0', 12],      // RFC1918 private
    ['192.0.0.0', 24],       // IETF protocol assignments
    ['192.0.2.0', 24],       // TEST-NET-1
    ['192.88.99.0', 24],     // 6to4 relay anycast
    ['192.168.0.0', 16],     // RFC1918 private
    ['198.18.0.0', 15],      // benchmarking
    ['198.51.100.0', 24],    // TEST-NET-2
    ['203.0.113.0', 24],     // TEST-NET-3
    ['224.0.0.0', 4],        // multicast
    ['240.0.0.0', 4],        // reserved / broadcast
];

const ipv6Blocks = [
    ['::', 128],             // unspecified
    ['::1', 128],            // loopback
    ['64:ff9b::', 96],       // NAT64 — unwrapped to IPv4 below, blocked outright here
    ['100::', 64],           // discard-only
    ['2001:db8::', 32],      // documentation
    ['fc00::', 7],           // unique local
    ['fe80::', 10],          // link-local
    ['ff00::', 8],           // multicast
];

const ipv4ToBytes = (ip) => ip.split('.').map(Number);

const ipv6ToBytes = (rawIp) => {
    // A trailing dotted quad (`::ffff:8.8.8.8`) is two 16-bit groups written in
    // IPv4 notation. Rewrite it to hex first, or every mapped address parses
    // short and fails the length check.
    let ip = rawIp;
    const dotted = ip.match(/:((?:\d{1,3}\.){3}\d{1,3})$/);
    if (dotted) {
        const [a, b, c, d] = dotted[1].split('.').map(Number);
        const hex = `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
        ip = ip.slice(0, ip.length - dotted[1].length) + hex;
    }

    // Expand "::" then read 8 groups of 16 bits.
    const [head, tail] = ip.split('::');
    const headGroups = head ? head.split(':').filter(Boolean) : [];
    const tailGroups = tail ? tail.split(':').filter(Boolean) : [];
    const fill = new Array(8 - headGroups.length - tailGroups.length).fill('0');
    const groups = ip.includes('::')
        ? headGroups.concat(fill, tailGroups)
        : ip.split(':');
    const bytes = [];
    groups.forEach(g => {
        const n = parseInt(g || '0', 16);
        bytes.push((n >> 8) & 0xff, n & 0xff);
    });
    return bytes;
};

const inBlock = (bytes, blockBytes, prefixLen) => {
    const fullBytes = Math.floor(prefixLen / 8);
    for (let i = 0; i < fullBytes; i++) {
        if (bytes[i] !== blockBytes[i]) return false;
    }
    const remainder = prefixLen % 8;
    if (remainder === 0) return true;
    const mask = 0xff << (8 - remainder) & 0xff;
    return (bytes[fullBytes] & mask) === (blockBytes[fullBytes] & mask);
};

/**
 * True when an IP literal is one the proxy must never connect to.
 *
 * IPv4-mapped and IPv4-compatible IPv6 addresses (`::ffff:127.0.0.1`) are
 * unwrapped and re-checked against the IPv4 table — otherwise they are a
 * trivial bypass of every v4 rule.
 */
const isBlockedAddress = (ip) => {
    const version = net.isIP(ip);
    if (version === 4) {
        const bytes = ipv4ToBytes(ip);
        if (bytes.length !== 4 || bytes.some(b => !Number.isInteger(b) || b < 0 || b > 255)) return true;
        return ipv4Blocks.some(([block, len]) => inBlock(bytes, ipv4ToBytes(block), len));
    }
    if (version === 6) {
        const normalized = ip.split('%')[0]; // drop any zone index
        let bytes;
        try {
            bytes = ipv6ToBytes(normalized);
        } catch (e) {
            return true;
        }
        if (bytes.length !== 16) return true;

        // ::ffff:a.b.c.d and ::a.b.c.d — the last four bytes are a v4 address.
        const first10Zero = bytes.slice(0, 10).every(b => b === 0);
        if (first10Zero && (bytes[10] === 0xff && bytes[11] === 0xff)) {
            return isBlockedAddress(bytes.slice(12).join('.'));
        }
        if (first10Zero && bytes[10] === 0 && bytes[11] === 0) {
            const v4 = bytes.slice(12);
            if (!v4.every(b => b === 0)) return isBlockedAddress(v4.join('.'));
        }

        return ipv6Blocks.some(([block, len]) => inBlock(bytes, ipv6ToBytes(block), len));
    }
    // Not a recognisable IP literal.
    return true;
};

class BlockedAddressError extends Error {
    constructor(host, address) {
        super(`Refusing to connect to ${host}: ${address} is a private, loopback or otherwise reserved address`);
        this.name = 'BlockedAddressError';
        this.code = 'EBLOCKEDADDRESS';
    }
}

/**
 * A `dns.lookup`-compatible resolver that rejects any hostname resolving into a
 * blocked range. Pass as `options.lookup` to http/https.request so the socket
 * connects to an address this function has already vetted.
 *
 * When `all: true` is requested we return only the surviving addresses, and
 * fail if a single one was blocked — a name that resolves to both a public and
 * a private address is a rebinding attempt, not a legitimate multi-homed host.
 */
const safeLookup = (hostname, options, callback) => {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    }
    // A bare IP literal never reaches the resolver, so check it directly.
    if (net.isIP(hostname)) {
        if (isBlockedAddress(hostname)) return callback(new BlockedAddressError(hostname, hostname));
        const family = net.isIP(hostname);
        return options && options.all
            ? callback(null, [{ address: hostname, family }])
            : callback(null, hostname, family);
    }

    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
        if (err) return callback(err);
        const list = Array.isArray(addresses) ? addresses : [addresses];
        if (list.length === 0) return callback(new Error(`No address found for ${hostname}`));

        const blocked = list.find(a => isBlockedAddress(a.address));
        if (blocked) return callback(new BlockedAddressError(hostname, blocked.address));

        if (options && options.all) return callback(null, list);
        return callback(null, list[0].address, list[0].family);
    });
};

module.exports = { safeLookup, isBlockedAddress, BlockedAddressError };
