/* Verify: clicking the notification toast card (not just the View button)
 * opens the changes window. Real user path:
 *  1. login (curl cookie), open system page in the same browser session
 *  2. change language select + click Save → creates a session-side uci delta
 *  3. open desktop shell (same cookie → same session) → polling pops the toast
 *  4. click the toast card body → expect WM window with iframe to changes page
 *  5. cleanup via the theme's own revert endpoint
 * Usage: node toast-click-probe.js
 */
const { spawn, execSync } = require('child_process');
const http = require('http');
const lib = require('../probe/lib.js');
const GPORT = 4444, ROUTER = lib.ROUTER;
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

const SETLANG = "return (function(){ var sels = document.querySelectorAll('select'); var sel = null; for (var i = 0; i < sels.length; i++) { if (sels[i].id.indexOf('_lang') !== -1) { sel = sels[i]; break; } } if (!sel) return JSON.stringify({err: 'no lang select'}); sel.value = (sel.value === 'zh_cn') ? 'en' : 'zh_cn'; return JSON.stringify({set: sel.value}); })()";
const SAVE = "return (function(){ var b = document.querySelector('button.cbi-button-save'); if (!b) return JSON.stringify({err: 'no save btn'}); b.click(); return 'save-clicked'; })()";
const TOAST_DUMP = "return (function(){ var t = document.querySelector('.desktop-toast[data-key=\"changes\"]'); if (!t) return JSON.stringify({err: 'no toast', all: (function(){ var a = []; document.querySelectorAll('.desktop-toast').forEach(function(x){ a.push(x.getAttribute('data-key')); }); return a; })()}); var r = t.getBoundingClientRect(); var act = t.querySelector('.toast-action'); return JSON.stringify({w: Math.round(r.width), h: Math.round(r.height), title: (t.querySelector('.toast-title')||{}).innerText || null, msg: (t.querySelector('.toast-msg')||{}).innerText || null, hasActionBtn: !!act, actionLabel: act ? act.innerText : null, cursor: getComputedStyle(t).cursor}); })()";
const CLICK_TOAST = "return (function(){ var t = document.querySelector('.desktop-toast[data-key=\"changes\"]'); if (!t) return JSON.stringify({err: 'no toast'}); t.click(); return 'clicked-card'; })()";
const WIN_DUMP = "return (function(){ var wins = document.querySelectorAll('.window, .desktop-window'); var out = []; for (var i = 0; i < wins.length; i++) { var f = wins[i].querySelector('iframe'); out.push({title: (wins[i].querySelector('.window-title')||{}).innerText || '', iframe: f ? f.src : null}); } return JSON.stringify(out); })()";
const IFRAME_BTNS = "return (function(){ var f = document.querySelector('.window iframe'); if (!f) return JSON.stringify({err: 'no iframe'}); var d = f.contentDocument; if (!d) return JSON.stringify({err: 'no doc'}); function vis(s){ var el = d.querySelector(s); if (!el) return 'missing'; var c = getComputedStyle(el); return {display: c.display, h: el.offsetHeight, w: el.offsetWidth}; } return JSON.stringify({apply: vis('#apply'), revert: vis('#revert'), header: vis('.changes-header'), actions: vis('.changes-actions'), hasHider: !!d.querySelector('style#__desktop-chrome-hider')}); })()";
const CLICK_REVERT = "return (function(){ var f = document.querySelector('.window iframe'); if (!f) return JSON.stringify({err: 'no iframe'}); var d = f.contentDocument; var b = d.querySelector('#revert'); if (!b) return JSON.stringify({err: 'no revert btn'}); b.click(); return 'revert-clicked'; })()";
const AFTER_REVERT = "return (function(){ var f = document.querySelector('.window iframe'); if (!f) return JSON.stringify({err: 'no iframe'}); var d = f.contentDocument; var st = d.querySelector('#status'); var chg = []; d.querySelectorAll('.chg').forEach(function(x){ chg.push((x.innerText||'').trim().slice(0,90)); }); return JSON.stringify({status: st ? st.textContent : null, empty: !!d.querySelector('.empty'), count: d.querySelector('.count') ? d.querySelector('.count').textContent : null, changes: chg}); })()";
const REVERT = "return fetch('/cgi-bin/luci/admin/desktop/changes/revert', {method: 'POST'}).then(r => r.text()).then(t => t.slice(0, 120))";

async function main() {
    killStale();
    spawn('geckodriver', ['--port', String(GPORT)], { stdio: 'ignore' });
    let up = false;
    for (let i = 0; i < 40; i++) { try { await wd('GET', '/status', null, 2000); up = true; break; } catch (e) { await sleep(250); } }
    if (!up) throw new Error('geckodriver not up');
    const sid = await newSession();
    await lib.login(sid);   // shared login: device+cookie from probe/lib.js (.local-env / PROBE_ROUTER / PROBE_SSH)
    await nav(sid, `http://${ROUTER}/cgi-bin/luci/admin/system/system?embed=1`); await sleep(4500);
    console.log('SETLANG: ' + await exec(sid, SETLANG));
    console.log('SAVE: ' + await exec(sid, SAVE));
    await sleep(4000);

    // 2) desktop shell (same cookie → same session)
    await nav(sid, `http://${ROUTER}/cgi-bin/luci/`); await sleep(4000);
    console.log('SHELL: ' + await exec(sid, "return JSON.stringify({url: location.pathname, hasTaskbar: !!document.getElementById('taskbar')})"));
    await sleep(12000); // polling every 10s
    console.log('TOAST: ' + await exec(sid, TOAST_DUMP));
    console.log('CLICK: ' + await exec(sid, CLICK_TOAST));
    await sleep(3500);
    console.log('WINDOWS: ' + await exec(sid, WIN_DUMP));
    console.log('IFRAME_BTNS: ' + await exec(sid, IFRAME_BTNS));
    console.log('CLICK_REVERT: ' + await exec(sid, CLICK_REVERT));
    await sleep(3500);
    console.log('AFTER_REVERT: ' + await exec(sid, AFTER_REVERT));

    console.log('REVERT: ' + await exec(sid, REVERT));
    await sleep(1500);

    await wd('DELETE', '/session/' + sid, null, 5000).catch(() => {});
    killStale();
}
main().catch(e => { console.error('FATAL: ' + e.message); killStale(); process.exit(1); });
