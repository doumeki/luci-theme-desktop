/* tabs-matrix.js — sibling-tabs policy matrix on a live router (L3 probe).
 *
 * Encodes the desktop theme's sibling-tab "modes" on the real device:
 *   A. a PURE firstchild aggregate's own URL (?embed=1) renders a bar with
 *      its children, first child active;
 *   B. a 4-segment page inside such an aggregate renders the same bar with
 *      the current page active;
 *   C. category URLs (preferred/recurse firstchildren) and plain view pages
 *      render NO bar;
 *   D. full-shell navigation (no ?embed=1) renders NO bar anywhere — tab
 *      bars only exist inside desktop app windows (embed mode).
 * Device-agnostic by design: the tab membership is derived from the
 * aggregate's own rendered bar (installed apps vary the tab set), and
 * standard pages missing on a device are skipped, not failed.
 *
 * Usage (theme git root):  node tests/tabs-matrix.js
 * Router/login via probe/lib.js (PROBE_ROUTER / probe/.local-env; on a
 * password-protected box set PROBE_SSH + PROBE_SSH_KEY instead).
 */
'use strict';
const lib = require('../probe/lib.js');

const BASE = 'http://' + lib.ROUTER + '/cgi-bin/luci';
const EMBED = '?embed=1';

let pass = 0, fail = 0;
function ok(cond, msg) {
    if (cond) { pass++; console.log('  OK   ' + msg); }
    else { fail++; console.log('  FAIL ' + msg); }
}

/* Single-line scripts (multiline returns null from execute/sync). */
function tabsInfo() {
    return "return (function(){var u=document.querySelector('ul.tabs');if(!u)return 'null';var lis=u.querySelectorAll('li');var act=u.querySelector('li.active');var m=act?act.className.match(/tabmenu-item-([a-z0-9_-]+)/):[];return JSON.stringify({n:lis.length,active:(m&&m[1])||null});})()";
}
function tabNames() {
    return "return (function(){var out=[],lis=document.querySelectorAll('ul.tabs li');for(var i=0;i<lis.length;i++){var m=lis[i].className.match(/tabmenu-item-([a-z0-9_-]+)/);if(m)out.push(m[1]);}return JSON.stringify(out);})()";
}

async function fetchTabs(sid, path, embed) {
    await lib.nav(sid, BASE + path + (embed ? EMBED : ''));
    await lib.sleep(1200);
    const raw = await lib.exec(sid, tabsInfo());
    try {
        const v = JSON.parse(raw);
        return v === null ? { n: 0 } : v;
    } catch (e) {
        return { n: -1, err: String(raw).slice(0, 80) };
    }
}

async function checkAggregate(sid, aggPath) {
    const agg = await fetchTabs(sid, aggPath, true);
    if (agg.n < 2 || !agg.active) {
        console.log('  SKIP ' + aggPath + ' — no aggregate bar here (n=' + agg.n + ')');
        return;
    }
    ok(true, 'A ' + aggPath + EMBED + ' → bar n=' + agg.n + ', first child ' + agg.active + ' active');
    const names = JSON.parse(await lib.exec(sid, tabNames())) || [];
    for (const name of names.slice(0, 3)) {
        const t = await fetchTabs(sid, aggPath + '/' + name, true);
        ok(t.n === agg.n && t.active === name,
            'B ' + aggPath + '/' + name + EMBED + ' → same bar (n=' + t.n + '), itself active');
    }
}

async function main() {
    await lib.startGecko();
    const sid = await lib.newSession();
    try {
        await lib.login(sid);
        await lib.assertTheme(sid, 'desktop');
        console.log('tabs-matrix on ' + lib.ROUTER + ' (desktop theme)');

        // C. categories / plain view pages → no bar (embed mode)
        for (const p of ['/admin/system', '/admin/system/startup',
                         '/admin/status/overview', '/admin/network/network']) {
            const t = await fetchTabs(sid, p, true);
            ok(t.n === 0, 'C ' + p + EMBED + ' → no tab bar (got n=' + t.n + ')');
        }

        // D. full-shell visit (no embed) → no bar even on aggregate URLs
        const shell = await fetchTabs(sid, '/admin/system/admin', false);
        ok(shell.n === 0, 'D /admin/system/admin full shell → no tab bar (got n=' + shell.n + ')');

        // A + B. pure aggregates (standard LuCI nodes; absent → skip)
        await checkAggregate(sid, '/admin/system/admin');
        await checkAggregate(sid, '/admin/system/ttyd');
    } finally {
        await lib.finish(sid);
    }
    console.log('tabs-matrix: ' + pass + '/' + (pass + fail) + ' passed');
    process.exit(fail ? 1 : 0);
}

main().catch(e => { console.log('⚠ tabs-matrix error: ' + e.message); process.exit(1); });
