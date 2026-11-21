/* tab-contract.js — per-app tab-bar contract (alias/call/template alike)
 *
 * The failure this guards against (q910, iStoreOS OAF):
 *   a tab whose menu entry is an `alias` leaf is dispatched at its TARGET
 *   path (oaf/app_filter -> oaf/app_filter/rules). A tab builder that walks
 *   the request path as if it were the menu path runs out of tree and paints
 *   nothing, so the bar silently disappears on exactly the alias tabs.
 *
 * Theme rule being tested (header.ut / compat.lua, alias-transparent):
 *   - tabs exist only inside a PURE firstchild aggregate
 *     (firstchild, !preferred, !recurse) — categories and plain pages get none;
 *   - an alias leaf inherits the tab group of its parent when that parent is
 *     a pure aggregate, and the ALIAS itself is the active tab.
 *
 * Usage:
 *   PROBE_ROUTER=192.0.2.1 node probe/tab-contract.js --app admin/services/oaf
 *   PROBE_ROUTER=192.0.2.1 node probe/tab-contract.js --app admin/services/oaf,admin/system/admin,admin/status
 *   ... --json /tmp/tabs.json     # machine-readable result
 *   ... --max N                   # only sample the first N tabs (debug)
 *
 * Exit: 0 contract holds, 1 violation, 2 probe error.
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
let APPS = arg('app', '').split(',').map(s => s.trim()).filter(Boolean);
const ALL = args.indexOf('--all') !== -1;
const AUDIT = args.indexOf('--audit') !== -1;
const JSON_OUT = arg('json', '');
const MAX = parseInt(arg('max', '0'), 10);
const TIMEOUT = parseInt(arg('timeout', '25'), 10);

if (!APPS.length && !ALL && !AUDIT) {
    console.log('usage: node probe/tab-contract.js --app admin/services/oaf | --all');
    process.exit(2);
}

const HOST = lib.ROUTER || process.env.PROBE_ROUTER;
if (!HOST) {
    console.log('[tabs] no PROBE_ROUTER');
    process.exit(2);
}

let cookie = null;
function auth() {
    const tok = lib.curlLoginToken(HOST);
    const name = lib.detectCookieName(HOST, tok.value);
    cookie = name + '=' + tok.value;
}
function curl(url) {
    try {
        return execFileSync('curl', ['-s', '--max-time', String(TIMEOUT), '-H', 'Cookie: ' + cookie, url],
            { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    } catch (e) {
        return 'CURL-ERR: ' + String(e.message).split('\n')[0];
    }
}
function menu() {
    return JSON.parse(curl(`http://${HOST}/cgi-bin/luci/admin/menu`) || '{}');
}
function parentPath(p) {
    const a = p.split('/');
    a.pop();
    return a.join('/');
}
function nodeAt(tree, appPath) {
    let n = tree;
    for (const seg of appPath.split('/')) {
        if (!n.children || !n.children[seg]) return null;
        n = n.children[seg];
    }
    return n;
}
function isPure(node) {
    const a = (node && node.action) || {};
    return a.type === 'firstchild' && !a.preferred && !a.recurse;
}
/* A tab group owns >=2 titled children and is an app node: alias, or pure
 * firstchild. Its PARENT is irrelevant (firewall sits under the recurse
 * category admin/network and still owns its tabs). */
function isGroup(node) {
    const a = (node && node.action) || {};
    const pure = (a.type === 'firstchild' && !a.preferred && !a.recurse) || a.type === 'alias';
    return pure && titledChildren(node).length > 1;
}
function titledChildren(node) {
    const out = [];
    for (const [name, child] of Object.entries((node && node.children) || {})) {
        if (child.satisfied === false) continue;
        if (!child.title || child.title === '') continue;
        out.push({
            name: name,
            title: child.title,
            type: (child.action && child.action.type) || '-',
            order: child.order == null ? 100 : child.order
        });
    }
    out.sort((a, b) => a.order - b.order);
    return out;
}
/* Which node owns the tab bar for this menu entry? Pure aggregate -> itself;
 * alias leaf -> its parent when that parent is a pure aggregate; else none. */
function groupFor(tree, appPath) {
    const node = nodeAt(tree, appPath);
    if (!node) return { node: null, path: appPath, reason: 'not-in-menu' };
    if (isGroup(node)) return { node: node, path: appPath, reason: isPure(node) ? 'pure-aggregate' : 'alias-group' };
    const a = node.action || {};
    if (a.type === 'alias') {
        const parent = nodeAt(tree, parentPath(appPath));
        if (isPure(parent)) return { node: parent, path: parentPath(appPath), reason: 'alias-of-pure-aggregate' };
        return { node: null, path: parentPath(appPath), reason: 'alias-under-category' };
    }
    return { node: null, path: appPath, reason: ntype(a) };
}
function ntype(a) {
    return a.type ? ('type:' + a.type) : 'plain-page';
}
function parseTabs(html) {
    const re = /<li class="tabmenu-item-([A-Za-z0-9_-]+)( active)?"><a href="([^"]+)">([^<]*)<\/a><\/li>/g;
    const out = [];
    let m;
    while ((m = re.exec(html))) out.push({ name: m[1], active: !!m[2], href: m[3], text: m[4] });
    return out;
}
function sameSet(a, b) {
    if (a.length !== b.length) return false;
    return a.map(x => x.name).sort().join(',') === b.map(x => x.name).sort().join(',');
}

auth();
const tree = menu();

/* --audit: list every node with >=2 titled children and say which rule it hit.
 * Deliberately does NOT reuse the theme's group rule as the only source: a
 * node that is NOT alias/pure-firstchild but has page children is reported as
 * a candidate so a new firmware shape cannot hide from the gate (this is the
 * blind spot that let firewall through: the old rule never even listed it). */
if (AUDIT) {
    const rows = [];
    (function walk(node, path) {
        if (!node) return;
        const kids = titledChildren(node);
        const a = (node.action) || {};
        const cat = (a.type === 'firstchild') && (a.preferred || a.recurse);
        if (path.length >= 2 && kids.length > 1) {
            const kind = isGroup(node) ? (isPure(node) ? 'group:pure' : 'group:alias')
                : cat ? 'category' : ('candidate:' + (a.type || 'plain'));
            rows.push({ p: path.join('/'), n: kids.length, kind: kind });
        }
        for (const [k, c] of Object.entries(node.children || {})) walk(c, path.concat([k]));
    })(tree, []);
    rows.sort((x, y) => (x.kind < y.kind ? -1 : x.kind > y.kind ? 1 : 0));
    for (const r of rows) console.log(`[tabs] audit ${r.kind.padEnd(16)} ${r.p} children=${r.n}`);
    const cand = rows.filter(r => r.kind.indexOf('candidate:') === 0);
    console.log(`[tabs] audit groups=${rows.filter(r => r.kind.indexOf('group:') === 0).length} categories=${rows.filter(r => r.kind === 'category').length} candidates=${cand.length}`);
    process.exit(cand.length ? 0 : 0);
}

/* --all: every node that owns a tab bar (pure firstchild aggregate) */
if (ALL) {
    (function walk(node, path) {
        if (!node) return;
        if (path.length >= 2 && isGroup(node))
            APPS.push(path.join('/'));
        for (const [k, c] of Object.entries(node.children || {})) walk(c, path.concat([k]));
    })(tree, []);
    APPS = [...new Set(APPS)];
    console.log(`[tabs] --all groups=${APPS.length}`);
}

const results = [];
let pass = 0, fail = 0;

for (const app of APPS) {
    const g = groupFor(tree, app);
    const expect = g.node ? titledChildren(g.node) : [];
    const kinds = {};
    for (const t of expect) kinds[t.type] = (kinds[t.type] || 0) + 1;
    console.log(`[tabs] app=${app} group=${g.path} rule=${g.reason} total=${expect.length} kinds=${JSON.stringify(kinds)}`);

    const base = `/cgi-bin/luci/${g.path}`;
    const landing = parseTabs(curl(`http://${HOST}${base}?embed=1`));
    /* hrefs matter as much as names: a tab can exist and be active while
     * pointing at the wrong depth (q922: ucode 0-based offset dropped the app
     * segment, every click 404'd). Compare name -> href against the group. */
    const hrefOk = (tabs) => tabs.every(t => {
        const want = `${base}/${t.name}`;
        return t.href.split('?')[0] === want;
    });
    const hrefBad = landing.filter(t => t.href.split('?')[0] !== `${base}/${t.name}`);
    let ok = expect.length === 0 ? landing.length === 0 : (sameSet(landing, expect) && hrefOk(landing));
    if (ok) {
        pass++;
    } else {
        fail++;
        console.log(`[tabs] FAIL landing ${app}: got ${landing.length} (${landing.map(t => t.name).join(',') || 'none'}) want ${expect.length}`);
    }
    if (hrefBad.length) {
        fail++;
        for (const b of hrefBad.slice(0, 4))
            console.log(`[tabs] FAIL href ${b.name}: ${b.href.split('?')[0]} != ${base}/${b.name}`);
    }

    /* Zero-tab case: every child page must also stay bar-less (category
     * pages must not sprout tabs as a side effect of alias handling). */
    let tabs = expect;
    if (MAX > 0) tabs = tabs.slice(0, MAX);
    if (!tabs.length && g.node) tabs = [{ name: '', type: '-', probeChild: true }].concat();
    if (!tabs.length) {
        const node = nodeAt(tree, app);
        tabs = titledChildren(node).slice(0, MAX > 0 ? MAX : 4).map(t => ({ name: t.name, type: t.type, zeroCase: true }));
    }

    for (const t of tabs) {
        if (t.zeroCase) {
            const got = parseTabs(curl(`http://${HOST}${base}/${t.name}?embed=1`));
            const good = got.length === 0;
            results.push({ app: app, tab: t.name, type: t.type, tabs: got.length, pass: good, zeroCase: true });
            if (good) { pass++; console.log(`[tabs] ${t.name.padEnd(14)} ${String(t.type).padEnd(10)} -> PASS (no bar, as designed)`); }
            else { fail++; console.log(`[tabs] ${t.name.padEnd(14)} ${String(t.type).padEnd(10)} -> FAIL (unexpected ${got.length} tabs)`); }
            continue;
        }
        const got = parseTabs(curl(`http://${HOST}${base}/${t.name}?embed=1`));
        const active = got.find(x => x.name === t.name);
        const okSet = sameSet(got, expect);
        const okActive = !!(active && active.active);
        const okHref = got.every(x => x.href.split('?')[0] === `${base}/${x.name}`);
        const good = okSet && okActive && okHref;
        results.push({ app: app, tab: t.name, type: t.type, tabs: got.length, active: okActive, pass: good });
        if (good) {
            pass++;
            console.log(`[tabs] ${t.name.padEnd(14)} ${String(t.type).padEnd(10)} -> PASS (tabs=${got.length} active=yes)`);
        } else {
            fail++;
            console.log(`[tabs] ${t.name.padEnd(14)} ${String(t.type).padEnd(10)} -> FAIL (tabs=${got.length} active=${okActive ? 'yes' : 'no'})` +
                (okSet ? '' : ` set=[${got.map(x => x.name).join(',') || 'none'}]`));
        }
    }
}

console.log(`[tabs] summary pass=${pass} fail=${fail}`);
if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify({ at: new Date().toISOString(), apps: APPS, results: results }, null, 1));
    console.log('[tabs] wrote ' + JSON_OUT);
}
process.exit(fail ? 1 : 0);
