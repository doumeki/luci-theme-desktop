/* Interaction comparison: argon vs desktop. For the given theme:
 *  1. AdGuardHome/base (legacy Lua cbi page) structural dump
 *  2. system page: tab switch behavior + dropdown menu open + save badge
 * Usage: node interact-cmp.js <argon|desktop>
 */
const { spawn, execSync } = require('child_process');
const http = require('http');
const lib = require('../probe/lib.js');
const GPORT = 4444, ROUTER = lib.ROUTER;
const THEME = process.argv[2] || 'argon';
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

const ADH_DUMP = "return (function(){ var out = {url: location.pathname, title: document.title}; var sec = document.querySelector('.cbi-section'); if (sec) { var c = getComputedStyle(sec); out.section = {bg: c.backgroundColor, radius: c.borderRadius, shadow: c.boxShadow, pad: c.padding}; } var btn = document.querySelector('#maincontent .cbi-page-actions, main .cbi-page-actions'); if (btn) { var btns = []; btn.querySelectorAll('button, a.btn').forEach(function(b){ btns.push((b.innerText||'').trim().slice(0,14) + '|' + (b.className||'').slice(0,50)); }); out.actions = btns; } var tbl = document.querySelector('#maincontent table, main table'); if (tbl) { var trs = tbl.querySelectorAll('tbody tr'); out.table = {rows: trs.length, rowBg: trs[0] ? getComputedStyle(trs[0]).backgroundColor : null, rowHover: null}; } return JSON.stringify(out); })()";
const TAB_SCRIPT = "return (function(){ var lis = document.querySelectorAll('ul.cbi-tabmenu li'); if (lis.length < 2) return JSON.stringify({err: 'no tabs'}); lis[1].querySelector('a').click(); return JSON.stringify({clicked: lis[1].getAttribute('data-tab')}); })()";
const TAB_DUMP = "return (function(){ var lis = document.querySelectorAll('ul.cbi-tabmenu li'); var out = []; for (var i = 0; i < lis.length; i++) { var c = getComputedStyle(lis[i]); var pane = document.querySelector('.cbi-tabcontainer [data-tab-title=\"' + lis[i].getAttribute('data-tab') + '\"]'); var ps = pane ? getComputedStyle(pane) : null; out.push({tab: lis[i].getAttribute('data-tab'), active: lis[i].getAttribute('data-tab-active') || lis[i].className, color: c.color, bg: c.backgroundColor, paneH: ps ? ps.height : null, paneOp: ps ? ps.opacity : null, paneVis: ps ? ps.visibility : null}); } return JSON.stringify(out); })()";
const DROP_SCRIPT = "return (function(){ var b = document.querySelector('.cbi-dropdown'); if (!b) return JSON.stringify({err: 'no dropdown btn'}); b.click(); return 'clicked'; })()";
const DROP_DUMP = "return (function(){ var items = document.querySelectorAll('.cbi-dropdown .dropdown-item, .dropdown-menu li, .dropdown-item'); var out = []; for (var i = 0; i < items.length && i < 5; i++) { var c = getComputedStyle(items[i]); out.push((items[i].innerText||'').trim().slice(0,16) + '|bg:' + c.backgroundColor + '|hover:defined'); } return JSON.stringify({n: items.length, items: out}); })()";
const SAVE_SCRIPT = "return (function(){ var b = document.querySelector('button.cbi-button-save'); if (!b) return JSON.stringify({err: 'no save'}); b.click(); return 'clicked'; })()";
const IND_SCRIPT = "return (function(){ var el = document.getElementById('indicators'); if (!el) return JSON.stringify({err: 'no indicators'}); var out = []; for (var i = 0; i < el.children.length; i++) { var c = el.children[i]; out.push((c.getAttribute('data-indicator')||'') + '=' + (c.innerText||'').slice(0,30)); } return JSON.stringify(out); })()";

async function main() {
    killStale();
    spawn('geckodriver', ['--port', String(GPORT)], { stdio: 'ignore' });
    let up = false;
    for (let i = 0; i < 40; i++) { try { await wd('GET', '/status', null, 2000); up = true; break; } catch (e) { await sleep(250); } }
    if (!up) throw new Error('geckodriver not up');
    const sid = await newSession();
    await lib.login(sid);   // shared login: device+cookie from probe/lib.js (.local-env / PROBE_ROUTER / PROBE_SSH)

    console.log('========== [' + THEME + '] AdGuardHome/base ==========');
    await nav(sid, `http://${ROUTER}/cgi-bin/luci/admin/services/AdGuardHome/base?embed=1`); await sleep(4500);
    console.log('  ADH: ' + await exec(sid, ADH_DUMP));

    console.log('========== [' + THEME + '] system: tab switch ==========');
    await nav(sid, `http://${ROUTER}/cgi-bin/luci/admin/system/system?embed=1`); await sleep(4500);
    console.log('  BEFORE: ' + await exec(sid, TAB_DUMP));
    console.log('  CLICK: ' + await exec(sid, TAB_SCRIPT));
    await sleep(800);
    console.log('  AFTER: ' + await exec(sid, TAB_DUMP));

    console.log('========== [' + THEME + '] dropdown menu ==========');
    console.log('  OPEN: ' + await exec(sid, DROP_SCRIPT));
    await sleep(500);
    console.log('  MENU: ' + await exec(sid, DROP_DUMP));

    console.log('========== [' + THEME + '] save -> indicator ==========');
    console.log('  SETLANG: ' + await exec(sid, "return (function(){ var sels = document.querySelectorAll('select'); var sel = null; for (var i = 0; i < sels.length; i++) { if (sels[i].id.indexOf('_lang') !== -1) { sel = sels[i]; break; } } if (!sel) return JSON.stringify({err: 'no lang'}); sel.value = (sel.value === 'zh_cn') ? 'en' : 'zh_cn'; return JSON.stringify({set: sel.value}); })()"));
    console.log('  SAVE: ' + await exec(sid, SAVE_SCRIPT));
    await sleep(3500);
    console.log('  IND: ' + await exec(sid, IND_SCRIPT));
    console.log('  REVERT: ' + await exec(sid, "return (function(){ var el = document.getElementById('indicators'); if (!el) return JSON.stringify({err: 'no ind'}); var c = el.querySelector('[data-indicator=\"uci-changes\"]'); if (!c) return JSON.stringify({err: 'no badge'}); c.click(); return 'clicked'; })()"));
    await sleep(1500);
    console.log('  MODAL: ' + await exec(sid, "return (function(){ var m = document.querySelector('#modal_overlay .modal'); if (!m) return JSON.stringify({err: 'no modal'}); var ov = getComputedStyle(document.getElementById('modal_overlay')); var r = m.getBoundingClientRect(); return JSON.stringify({ovPos: ov.position, ovVis: ov.visibility, rect: {top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width)}, txt: (m.innerText||'').slice(0,120).replace(/\\n/g,' ')}); })()"));
    console.log('  REVERTCLICK: ' + await exec(sid, "return (function(){ var dlg = document.querySelector('.modal'); if (!dlg) return JSON.stringify({err: 'no modal'}); var btns = dlg.querySelectorAll('button, .cbi-button'); for (var i = 0; i < btns.length; i++) { var t = (btns[i].innerText || '').trim(); if (t.indexOf('Revert') !== -1 || t.indexOf('恢复') !== -1 || t.indexOf('还原') !== -1) { btns[i].click(); return JSON.stringify({clicked: t}); } } return JSON.stringify({err: 'no revert btn'}); })()"));
    await sleep(3500);
    console.log('  IND2: ' + await exec(sid, IND_SCRIPT));

    await wd('DELETE', '/session/' + sid, null, 5000).catch(() => {});
    killStale();
}
main().catch(e => { console.error('FATAL: ' + e.message); killStale(); process.exit(1); });
