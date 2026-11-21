/* ui-contract.js — rule-based UI contract over the WHOLE menu tree (no eyes).
 *
 * Why: hand-verifying screenshots does not scale and misses click-through
 * breakage (theme 367 rendered the right tab NAMES with wrong hrefs, so every
 * click 404'd while every screenshot looked fine).
 *
 * Rules (curl only, ~1-2 min on a 85-page box):
 *   R1 menu sweep   every menu-declared page: HTTP 200, not a login form, and
 *                   not "No page is registered". A dead declaration is a NOTE
 *                   (firmware menu bug, e.g. iStoreOS unishare/index), while a
 *                   login-form/5xx/empty body is a FAIL (theme/session broke).
 *   R2 tab contract every tab group: tab set identical on each tab page, the
 *                   clicked tab active, and every href == group/tab (the exact
 *                   check that would have caught 367's missing /oaf segment).
 *   R5 assets       every /luci-static/... referenced by a fetched page is 200.
 *
 * Usage:
 *   PROBE_ROUTER=192.0.2.1 node probe/ui-contract.js
 *   ... --json /tmp/ui.json --max-pages 0 --max-assets 300
 * Exit: 0 = no FAIL (NOTE allowed), 1 = FAIL, 2 = probe error.
 */
'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');
const lib = require('./lib.js');

const args = process.argv.slice(2);
function arg(name, def) {
    const i = args.indexOf('--' + name);
    return i === -1 ? def : (args[i + 1] || '');
}
const JSON_OUT = arg('json', '');
const MAX_PAGES = parseInt(arg('max-pages', '0'), 10);
const MAX_ASSETS = parseInt(arg('max-assets', '300'), 10);
const TIMEOUT = parseInt(arg('timeout', '20'), 10);

const HOST = lib.ROUTER || process.env.PROBE_ROUTER;
if (!HOST) { console.log('[ui] no PROBE_ROUTER'); process.exit(2); }

let cookie = null;
const cache = new Map();   /* url -> {status, body, type} */

function auth() {
    const tok = lib.curlLoginToken(HOST);
    const name = lib.detectCookieName(HOST, tok.value);
    cookie = name + '=' + tok.value;
}
function fetchPath(p) {
    const url = `http://${HOST}/cgi-bin/luci${p}${p.indexOf('?') === -1 ? '?embed=1' : ''}`;
    if (cache.has(url)) return cache.get(url);
    let rec = { status: 0, body: '' };
    try {
        const out = execFileSync('curl', ['-s', '--max-time', String(TIMEOUT), '-w', '\n%{http_code}', '-H', 'Cookie: ' + cookie, url],
            { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
        const i = out.lastIndexOf('\n');
        rec.status = parseInt(out.slice(i + 1).trim(), 10) || 0;
        rec.body = out.slice(0, i);
    } catch (e) {
        rec.status = -1;
    }
    cache.set(url, rec);
    return rec;
}
function fetchAsset(u) {
    const url = /^https?:/.test(u) ? u : `http://${HOST}${u}`;
    if (cache.has(url)) return cache.get(url);
    let code = 0;
    try { code = parseInt(execFileSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', String(TIMEOUT), url], { encoding: 'utf8' }).trim(), 10) || 0; }
    catch (e) { code = -1; }
    const rec = { status: code, body: '' };
    cache.set(url, rec);
    return rec;
}
function menu() {
    try {
        return JSON.parse(execFileSync('curl', ['-s', '--max-time', String(TIMEOUT), '-H', 'Cookie: ' + cookie, `http://${HOST}/cgi-bin/luci/admin/menu`],
            { encoding: 'utf8', maxBuffer: 20e6 }) || '{}');
    } catch (e) { return {}; }
}

const PAGE_TYPES = { view: 1, cbi: 1, template: 1, alias: 1 };

function collectPages(tree) {
    const out = [];
    (function walk(node, path) {
        const kids = Object.keys((node && node.children) || {});
        if (!kids.length) {
            if (path.length < 2) return;
            const a = (node.action) || {};
            const title = String(node.title || '').trim();
            const pageLike = PAGE_TYPES[a.type] === 1 || (a.type !== 'function' && title !== '');
            if (pageLike) out.push({ path: '/' + path.join('/'), type: a.type || '-', title: title });
            return;
        }
        for (const k of kids) walk(node.children[k], path.concat([k]));
    })(tree, []);
    return out;
}
function parseTabs(html) {
    const re = /<li class="tabmenu-item-([A-Za-z0-9_-]+)( active)?"><a href="([^"]+)">([^<]*)<\/a><\/li>/g;
    const out = [];
    let m;
    while ((m = re.exec(html))) out.push({ name: m[1], active: !!m[2], href: m[3] });
    return out;
}
function isPure(n) { const a = (n && n.action) || {}; return a.type === 'firstchild' && !a.preferred && !a.recurse; }
function titledChildren(n) {
    return Object.entries((n && n.children) || {})
        .filter(([, c]) => c.satisfied !== false && c.title && c.title !== '')
        .map(([name, c]) => ({ name: name, order: c.order == null ? 100 : c.order }))
        .sort((a, b) => a.order - b.order);
}
function nodeAt(tree, p) {
    let n = tree;
    for (const s of p.split('/').filter(Boolean)) {
        if (!n.children || !n.children[s]) return null;
        n = n.children[s];
    }
    return n;
}

auth();
const tree = menu();
let pages = collectPages(tree);
if (MAX_PAGES > 0) pages = pages.slice(0, MAX_PAGES);
console.log(`[ui] menu pages=${pages.length}`);

/* ---------- R1: menu sweep ---------- */
let r1ok = 0, r1dead = 0, r1bad = 0;
const dead = [], bad = [];
for (const pg of pages) {
    const r = fetchPath(pg.path);
    const body = r.body || '';
    /* Dead menu declaration: LuCI answers 404 + this text. It is a FIRMWARE
     * menu bug (iStoreOS ships switch/wireless/leds/vpn entries without a
     * route here), not a theme failure -- record it as a note, not a fail. */
    if (body.indexOf('No page is registered') !== -1) {
        r1dead++; dead.push(pg.path); continue;
    }
    if (r.status !== 200 || body.length < 200 || /luci_username/.test(body)) {
        r1bad++; bad.push({ path: pg.path, status: r.status, bytes: body.length, loginForm: /luci_username/.test(body) });
        continue;
    }
    r1ok++;
}
console.log(`[ui] R1 ok=${r1ok} dead-entry=${r1dead} bad=${r1bad}`);
for (const d of dead.slice(0, 8)) console.log('[ui]   dead-entry ' + d);
for (const b of bad.slice(0, 8))
    console.log(`[ui]   BAD ${b.path} status=${b.status} bytes=${b.bytes}${b.loginForm ? ' LOGIN-FORM' : ''}`);

/* ---------- R2: tab contract over every group ---------- */
const groups = [];
(function walk(node, path) {
    if (!node) return;
    if (isPure(node) && path.length >= 2) {
        const kids = titledChildren(node);
        if (kids.length > 1) groups.push({ path: '/' + path.join('/'), node: node });
    }
    for (const [k, c] of Object.entries(node.children || {})) walk(c, path.concat([k]));
})(tree, []);

let r2ok = 0, r2bad = 0;
for (const g of groups) {
    const tabs = parseTabs(fetchPath(g.path).body);
    const want = titledChildren(g.node).map(x => x.name);
    const got = tabs.map(t => t.name);
    const setOk = got.slice().sort().join(',') === want.slice().sort().join(',');
    if (!setOk) {
        r2bad++;
        console.log(`[ui]   BAD tabs ${g.path} got=[${got.join(',')}] want=[${want.join(',')}]`);
        continue;
    }
    let groupOk = true;
    for (const t of tabs) {
        const wantHref = `/cgi-bin/luci${g.path}/${t.name}`;
        if (t.href.split('?')[0] !== wantHref) {
            r2bad++; groupOk = false;
            console.log(`[ui]   BAD href ${g.path}/${t.name} -> ${t.href.split('?')[0]} want ${wantHref}`);
            continue;
        }
        const r = fetchPath(t.href.replace('/cgi-bin/luci', ''));
        const st = parseTabs(r.body);
        const act = st.find(x => x.name === t.name);
        if (r.status !== 200 || !act || !act.active) {
            r2bad++; groupOk = false;
            console.log(`[ui]   BAD tab ${g.path}/${t.name} status=${r.status} active=${!!(act && act.active)}`);
        }
    }
    if (groupOk) r2ok++;
}
console.log(`[ui] R2 groups=${groups.length} ok=${r2ok} bad=${r2bad}`);

/* ---------- R5: referenced theme assets ---------- */
const assets = new Set();
for (const rec of cache.values()) {
    const body = rec.body || '';
    const re = /\/luci-static\/[A-Za-z0-9_./-]+\.(?:css|js|png|jpg|svg|woff2?|ttf)/g;
    let m;
    while ((m = re.exec(body))) assets.add(m[0]);
}
const assetList = [...assets].slice(0, MAX_ASSETS);
let r5ok = 0, r5bad = 0;
const assetBad = [];
const assetNote = [];
for (const a of assetList) {
    const r = fetchAsset(a);
    if (r.status === 200) { r5ok++; continue; }
    /* Theme-owned assets are a FAIL; app-owned assets (e.g. quickstart's own
     * i18n bundle) are a firmware/app note -- the theme does not ship them. */
    if (/^\/luci-static\/(desktop|resources)\//.test(a)) { r5bad++; assetBad.push({ url: a, status: r.status }); }
    else assetNote.push({ url: a, status: r.status });
}
console.log(`[ui] R5 assets=${assetList.length} ok=${r5ok} bad=${r5bad} note=${assetNote.length}`);
for (const a of assetBad.slice(0, 8)) console.log(`[ui]   BAD asset ${a.url} status=${a.status}`);
for (const a of assetNote.slice(0, 8)) console.log(`[ui]   asset-note (app-owned) ${a.url} status=${a.status}`);

const fail = r1bad + r2bad + r5bad;
console.log(`[ui] summary fail=${fail} note=${r1dead + assetNote.length}`);
if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify({
        at: new Date().toISOString(), pages: pages.length,
        r1: { ok: r1ok, dead: dead, bad: bad },
        r2: { groups: groups.length, ok: r2ok, bad: r2bad },
        r5: { assets: assetList.length, ok: r5ok, bad: assetBad, note: assetNote }
    }, null, 1));
    console.log('[ui] wrote ' + JSON_OUT);
}
process.exit(fail ? 1 : 0);
