/* Theme consistency explorer: load the same app pages under a given theme
 * (argon|desktop) and dump structural/visual facts. Usage:
 *   node theme-cmp-probe.js <argon|desktop> [pageIndex]
 */
const { spawn, execSync } = require('child_process');
const http = require('http');
const lib = require('../probe/lib.js');
const GPORT = 4444, ROUTER = lib.ROUTER;
const THEME = process.argv[2] || 'argon';
const ONLY = process.argv[3] ? parseInt(process.argv[3]) : null;
const PAGES = [
    { name: 'system', url: '/admin/system/system' },
    { name: 'network', url: '/admin/network/network' },
    { name: 'overview', url: '/admin/status/overview' },
    { name: 'adh', url: '/admin/AdGuardHome/overview' },
];
const sleep = ms => new Promise(r => setTimeout(r, ms));
function killStale() { for (const pat of ['[f]irefox.*--headless', '[g]eckodriver --port']) { try { execSync(`pkill -9 -f '${pat}' 2>/dev/null; true`); } catch (e) {} } }
function wd(method, urlPath, body, timeoutMs) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const req = http.request({ host: '127.0.0.1', port: GPORT, path: urlPath, method,
            headers: { 'Content-Type': 'application/json' } }, res => {
            let b = ''; res.on('data', d => b += d);
            res.on('end', () => resolve({ status: res.statusCode, body: b }));
        });
        req.setTimeout(timeoutMs || 30000, () => req.destroy(new Error('wd timeout')));
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}
async function newSession() {
    const r = await wd('POST', '/session', { capabilities: { alwaysMatch: { pageLoadStrategy: 'none',
        'moz:firefoxOptions': { args: ['--headless', '--width=1600', '--height=900'] } } } }, 90000);
    return JSON.parse(r.body).value.sessionId;
}
async function exec(sid, script) {
    const r = await wd('POST', `/session/${sid}/execute/sync`, { script, args: [] }, 20000);
    try { return JSON.parse(r.body).value; } catch (e) { return '?(' + r.status + ' ' + String(r.body).slice(0, 200) + ')'; }
}
async function nav(sid, url) { try { await wd('POST', `/session/${sid}/url`, { url }, 25000); } catch (e) {} }

const DUMP = "return (function(){ function g(s){ try { return getComputedStyle(document.querySelector(s)); } catch(e){ return null; } } function rect(s){ try { var r = document.querySelector(s).getBoundingClientRect(); return {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)}; } catch(e){ return null; } } var out = {url: location.pathname, bodyBg: g('body').backgroundColor, bodyFont: g('body').fontFamily, title: document.title}; var main = document.querySelector('#maincontent .container') || document.querySelector('main .container') || document.querySelector('#maincontent > div'); if (main) { var mcs = getComputedStyle(main); out.main = {cls: main.className, bg: mcs.backgroundColor, border: mcs.borderTopWidth + ' ' + mcs.borderTopColor, radius: mcs.borderRadius, shadow: mcs.boxShadow, pad: mcs.padding}; } out.mainRect = rect('#maincontent .container') || rect('main .container') || rect('#maincontent'); var acts = document.querySelector('#maincontent .cbi-page-actions, main .cbi-page-actions'); if (acts) { var btns = []; acts.querySelectorAll('button, a.btn, .btn').forEach(function(b){ btns.push({t: (b.innerText||'').trim().slice(0,18), c: (b.className||'').slice(0,60)}); }); out.actions = {btns: btns, dropdown: !!acts.querySelector('.dropdown'), dropdownBtn: !!acts.querySelector('.btn-dropdown')}; } var tabs = document.querySelector('ul.cbi-tabmenu'); if (tabs) { var lis = tabs.querySelectorAll('li'); var act = tabs.querySelector('li.active, li[class*=active], li[data-tab-active]'); var actc = act ? getComputedStyle(act) : null; out.tabs = {n: lis.length, activeCls: act ? (act.className||'') : null, activeColor: actc ? actc.color : null, activeBg: actc ? actc.backgroundColor : null, tabAttr: lis[0] ? lis[0].outerHTML.slice(0, 120) : null}; } var tbl = document.querySelector('#maincontent table, main table'); if (tbl) { var th = tbl.querySelector('thead tr, tr:first-child'); var trs = tbl.querySelectorAll('tbody tr'); var tc = getComputedStyle(tbl); out.table = {cls: tbl.className, bg: tc.backgroundColor, rows: trs.length, rowBg: trs[0] ? getComputedStyle(trs[0]).backgroundColor : null, border: tc.borderTopWidth + ' ' + tc.borderTopColor}; } var inp = document.querySelector('input[type=text], input:not([type])'); if (inp) { var ic = getComputedStyle(inp); out.input = {border: ic.borderTopWidth + ' ' + ic.borderTopColor, bg: ic.backgroundColor, h: ic.height, radius: ic.borderRadius}; } var sel = document.querySelector('select'); if (sel) { var sc = getComputedStyle(sel); out.select = {border: sc.borderTopWidth + ' ' + sc.borderTopColor, bg: sc.backgroundColor, h: sc.height, radius: sc.borderRadius}; } var sec = document.querySelector('.cbi-section'); if (sec) { var csc = getComputedStyle(sec); out.section = {bg: csc.backgroundColor, border: csc.borderTopWidth + ' ' + csc.borderTopColor, radius: csc.borderRadius, shadow: csc.boxShadow, pad: csc.padding}; } out.indicators = !!document.getElementById('indicators'); return JSON.stringify(out); })()";

async function main() {
    killStale();
    spawn('geckodriver', ['--port', String(GPORT)], { stdio: 'ignore' });
    let up = false;
    for (let i = 0; i < 40; i++) { try { await wd('GET', '/status', null, 2000); up = true; break; } catch (e) { await sleep(250); } }
    if (!up) throw new Error('geckodriver not up');
    const sid = await newSession();
    await lib.login(sid);   // shared login: device+cookie from probe/lib.js (.local-env / PROBE_ROUTER / PROBE_SSH)

    for (let i = 0; i < PAGES.length; i++) {
        if (ONLY !== null && i !== ONLY) continue;
        const p = PAGES[i];
        await nav(sid, `http://${ROUTER}/cgi-bin/luci${p.url}?embed=1`); await sleep(4500);
        const d = await exec(sid, DUMP);
        console.log(`\n===== [${THEME}] ${p.name} ${p.url} =====`);
        try { const o = JSON.parse(d); for (const k in o) console.log('  ' + k + ': ' + JSON.stringify(o[k])); }
        catch (e) { console.log('  RAW: ' + d.slice(0, 400)); }
    }
    await wd('DELETE', '/session/' + sid, null, 5000).catch(() => {});
    killStale();
}
main().catch(e => { console.error('FATAL: ' + e.message); killStale(); process.exit(1); });
