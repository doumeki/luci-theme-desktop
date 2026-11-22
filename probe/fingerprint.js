/* fingerprint.js — contract-profile capture + gate check (plan §2, rules fixed).
 *
 * Gate rule (do not soften): a firmware whose fingerprint matches NO known
 * profile in tests/profiles/*.json is a NEW class — it must run the L4 hot
 * pack full + --save a new profile baseline before standing in for anything.
 * It may NOT be treated as an existing representative and go straight to L3.
 *
 * Capture is browser-free (ssh session forge + curl):
 *   - cookieName: probe sysauth / sysauth_http against an ssh-forged session
 *   - resources:  GET /luci-static/resources/{xhr.js,cbi.js,ui.js,cbi.css}
 *                 recorded as "<sha8>:<bytes>" or "unavailable(http <code>)"
 *                 (0-byte-200 xhr.js / 404 cbi.css are real modern-gen
 *                 signals, q660 — they ARE fingerprint values, not errors)
 *   - menuHash:   sha8(JSON.stringify(sorted admin paths)) from the shell
 *                 page (menu-data JSON walk + anchor hrefs, same rules as
 *                 the scan's in-page harvest)
 *   - fw/theme:   informational only (never gate-fail)
 *
 * Usage:
 *   node probe/fingerprint.js                 # capture + gate verdict (rc 0 match / 3 new)
 *   node probe/fingerprint.js --save dev1     # capture + write tests/profiles/dev1.json
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const lib = require('./lib.js');

const SSH_HOST = process.env.PROBE_SSH || lib.SSH_HOST || lib.ROUTER;
const SSH_KEY = ('PROBE_SSH_KEY_FORCE' in process.env) ? process.env.PROBE_SSH_KEY_FORCE : lib.SSH_KEY;
const ROUTER = lib.ROUTER;
const PROFDIR = path.join(__dirname, '..', 'tests', 'profiles');

function sha8(s) { return crypto.createHash('sha1').update(s).digest('hex').slice(0, 8); }
function mask(s) {
    return String(s)
        .replace(/github_pat_\S+/g, '<masked>')
        .replace(/\b[0-9a-f]{40}\b/g, '<masked-token>')
        .replace(/([0-9]{1,3}\.){3}[0-9]{1,3}/g, '<masked-ip>');
}
function ssh(cmdStr) {
    const full = (SSH_KEY ? ['-i', SSH_KEY] : []).concat(
        ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', 'root@' + SSH_HOST, cmdStr]);
    try { return execFileSync('ssh', full, { encoding: 'utf8', timeout: 25000, maxBuffer: 30 * 1024 * 1024 }).trim(); }
    catch (e) { return 'SSH-ERR: ' + String(e.message).split('\n')[0]; }
}
function curlBody(url, cookie) {
    const f = '/tmp/fingerprint-body-' + process.pid;
    const args = ['-s', '-o', f, '-w', '%{http_code}', '--max-time', '25'];
    if (cookie) args.push('-H', 'Cookie: ' + cookie);
    args.push(url);
    let code = '0';
    try { code = execFileSync('curl', args, { encoding: 'utf8' }).trim(); }
    catch (e) { return { code: '0', buf: Buffer.alloc(0), text: '' }; }
    let buf = Buffer.alloc(0);
    try { buf = fs.readFileSync(f); } catch (e) {}
    try { fs.unlinkSync(f); } catch (e) {}
    return { code, buf, text: buf.toString('utf8') };
}

/* ---- capture ---- */
function capture() {
    const fp = { cookieName: '', resources: {}, menuHash: null, pages: 0, fw: '', theme: '' };
    fp.fw = ssh("source /etc/openwrt_release 2>/dev/null; echo $DISTRIB_DESCRIPTION");
    fp.theme = ssh('cat /www/luci-static/desktop/version.txt 2>/dev/null');
    for (const f of ['xhr.js', 'cbi.js', 'ui.js', 'cbi.css']) {
        const g = curlBody('http://' + ROUTER + '/luci-static/resources/' + f);
        fp.resources[f] = (g.code === '200' && g.buf.length > 0) ? sha8(g.buf) + ':' + g.buf.length : 'unavailable(http ' + g.code + ')';
    }
    /* session acquisition — curl login first (empty-password boxes, proven in
     * lib.curlLoginToken; the runtime sets the cookie name, both tracks work),
     * else the proven ssh forge: create + SET {token: tok, username: root}
     * (lib.js login(); the token value is what the dispatcher validates —
     * q669 failed with create-only, no token set). */
    let tok = ''; let how = '';
    try {
        const raw = execFileSync('curl', ['-s', '-c', '-', '-o', '/dev/null', '-d',
            'luci_username=root&luci_password=', 'http://' + ROUTER + '/cgi-bin/luci/'],
            { encoding: 'utf8', timeout: 20000 });
        const cm = raw.match(/(sysauth_http|sysauth)\t(\S+)/);
        if (cm) { fp.cookieName = cm[1]; tok = cm[2]; how = 'curl-login'; }
    } catch (e) {}
    if (!tok) {
        const create = ssh("ubus call session create '{\"timeout\":900}'");
        const mtok = create.match(/"ubus_rpc_session"\s*:\s*"([0-9a-f]+)"/);
        if (!mtok) { fp.error = 'forge create failed: ' + mask(create.slice(0, 90)); return fp; }
        tok = mtok[1];
        ssh("ubus call session set '{\"ubus_rpc_session\":\"" + tok + "\",\"values\":{\"token\":\"" + tok + "\",\"username\":\"root\"}}'");
        /* cookie name probed from the VM against the web host (same rpcd
         * session store) — lib.detectCookieName replaces the old ssh-side
         * loopback curl, whose hardcoded literal a secret scan flagged */
        fp.cookieName = lib.detectCookieName(ROUTER, tok);
        how = 'ssh-forge';
        if (!fp.cookieName) { fp.error = 'forge: neither cookie name authenticates'; return fp; }
    }
    /* authenticated shell page (VM-side curl; cookie rides via -H) */
    const pg = curlBody('http://' + ROUTER + '/cgi-bin/luci/admin/status/overview', fp.cookieName + '=' + tok);
    if (pg.code !== '200' || pg.buf.length < 4000 || pg.text.indexOf('luci_username') !== -1) {
        fp.error = 'page probe failed: how=' + how + ' http=' + pg.code + ' bytes=' + pg.buf.length +
            ' loginForm=' + (pg.text.indexOf('luci_username') !== -1) +
            ' head=' + pg.text.slice(0, 80).replace(/\s+/g, ' ');
        return fp;
    }
    const page = pg.text;
    ssh("ubus call session destroy '{\"ubus_rpc_session\":\"" + tok + "\"}' >/dev/null 2>&1; true");
    /* menu extraction — same rules as the scan's in-page harvest (JS_HARVEST) */
    const seen = {}; const paths = [];
    const push = (p) => {
        p = String(p || '');
        if (p.charAt(0) !== '/') p = '/' + p;
        if (p.indexOf('/admin/') !== 0 || p.indexOf('/logout') !== -1 || p.length > 90) return;
        if (!seen[p]) { seen[p] = 1; paths.push(p); }
    };
    const tags = page.match(/<script[^>]*type="application\/json"[^>]*>[\s\S]*?<\/script>/g) || [];
    for (const tag of tags) {
        const m = tag.match(/>([\s\S]*)<\/script>/);
        let o = null; try { o = JSON.parse(m[1]); } catch (e) {}
        if (!o) continue;
        const walk = (x) => {
            if (!x) return;
            if (typeof x === 'string') {
                const mm = x.match(/admin\/[a-z0-9\-]+(?:\/[a-z0-9\-]+)*/g);
                if (mm) for (const z of mm) push(z);
                return;
            }
            if (typeof x !== 'object') return;
            if (Array.isArray(x) && x.length > 1 && x[0] === 'admin') { push(x.join('/')); return; }
            for (const k in x) {
                /* modern ucode menu JSON encodes paths as object KEYS
                 * (JSON.parse unescapes '\/') — q670: value-only walk caught
                 * dev2 (57 pages) but only 3 on dev1 */
                if (typeof k === 'string') {
                    const km = k.match(/admin\/[a-z0-9\-]+(?:\/[a-z0-9\-]+)*/g);
                    if (km) for (const z of km) push(z);
                }
                walk(x[k]);
            }
        };
        walk(o);
    }
    const reHref = /href="([^"]+)"/g; let mh;
    while ((mh = reHref.exec(page))) {
        const h = mh[1];
        const am = h.match(/\/cgi-bin\/luci(\/admin\/[^?#]*)/) || h.match(/^(\/admin\/[^?#]*)/) || h.match(/^(admin\/[^?#]+)/);
        if (am) push(am[1]);
    }
    if (paths.length < 25) {
        const reAdm = /admin\/[a-z0-9\-]+(?:\/[a-z0-9\-]+)*/g; let am2;
        while ((am2 = reAdm.exec(page))) push(am2[0]);
    }
    paths.sort();
    fp.menuHash = sha8(JSON.stringify(paths));
    fp.pages = paths.length;
    return fp;
}

/* ---- gate ---- */
function compare(fp, prof) {
    const diffs = [];
    if (fp.cookieName !== prof.cookieName) diffs.push('cookieName(' + fp.cookieName + '!=' + prof.cookieName + ')');
    for (const f of Object.keys(fp.resources)) {
        const pv = prof.resources && prof.resources[f];
        if (fp.resources[f] !== pv) diffs.push(f + '(' + fp.resources[f] + '!=' + pv + ')');
    }
    if (fp.menuHash !== prof.menuHash) diffs.push('menuHash(' + fp.menuHash + '!=' + prof.menuHash + ')');
    return diffs;
}

(function main() {
    const argv = process.argv.slice(2);
    const saveIdx = argv.indexOf('--save');
    const saveLabel = saveIdx >= 0 ? argv[saveIdx + 1] : null;
    const fp = capture();
    console.log('[fingerprint] live ' + mask(JSON.stringify(fp)));
    if (fp.pages > 0 && fp.pages < 8) console.log('[fingerprint] NOTE pages=' + fp.pages + ' — suspiciously small menu tree, check menu extraction');
    const complete = !!(fp.cookieName && fp.menuHash && !fp.error);
    if (!complete && saveLabel) {
        console.log('[fingerprint] REFUSED to save: capture incomplete (' + mask(fp.error || 'missing cookieName/menuHash') + ') — a degraded fingerprint must never overwrite a profile');
        process.exit(1);
    }
    if (saveLabel) {
        fs.mkdirSync(PROFDIR, { recursive: true });
        const prof = {
            label: saveLabel, fw: fp.fw, theme: fp.theme,
            cookieName: fp.cookieName, resources: fp.resources,
            menuHash: fp.menuHash, pages: fp.pages,
            captured: new Date().toISOString(),
            note: 'canonical profile captured by probe/fingerprint.js; gate rule in compat-scan.config.js (no softening)'
        };
        const f = path.join(PROFDIR, saveLabel + '.json');
        fs.writeFileSync(f, JSON.stringify(prof, null, 1) + '\n');
        console.log('[fingerprint] saved ' + f);
    }
    if (!complete) {
        console.log('[gate] verdict=NEW-CLASS — capture incomplete; a degraded fingerprint never matches (q669 hole closed)');
        process.exit(3);
    }
    if (!fs.existsSync(PROFDIR)) { console.log('[gate] no profiles dir — treat as NEW CLASS'); process.exit(3); }
    const files = fs.readdirSync(PROFDIR).filter(n => n.slice(-5) === '.json');
    let matched = null;
    for (const n of files) {
        let p; try { p = JSON.parse(fs.readFileSync(path.join(PROFDIR, n), 'utf8')); } catch (e) { continue; }
        const diffs = compare(fp, p);
        console.log('[gate] vs ' + n + ': ' + (diffs.length ? 'differs (' + diffs.join(', ').slice(0, 220) + ')' : 'MATCH'));
        if (!diffs.length) matched = n;
    }
    if (fp.error && !matched) console.log('[gate] note: capture error — ' + mask(fp.error));
    if (matched) { console.log('[gate] verdict=match profile=' + matched + ' — representative OK for L3'); process.exit(0); }
    console.log('[gate] verdict=NEW-CLASS — run L4 hot full + --save a baseline first (never stand in for a representative on L3)');
    process.exit(3);
})();
