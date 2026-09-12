/* Reproduce the toast-count vs window-count mismatch:
 * 1. system page: change lang + save (session delta)
 * 2. desktop shell: toast appears with count N1
 * 3. keep polling uci_changes every 5s — track how the count evolves
 * 4. open the changes window and read its header count
 * Usage: node count-diff-probe.js
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
const COUNT = "return fetch('/cgi-bin/luci/admin/desktop/uci_changes').then(function(r) { return r.json(); }).then(function(j) { return JSON.stringify({count: j.count}); });";
const TOAST = "return (function(){ var t = document.querySelector('.desktop-toast[data-key=\"changes\"]'); if (!t) return JSON.stringify({err: 'no toast'}); return JSON.stringify({msg: (t.querySelector('.toast-msg')||{}).innerText || ''}); })()";
const OPEN_CHANGES = "return (function(){ var t = document.querySelector('.desktop-toast[data-key=\"changes\"]'); if (t) t.click(); return 'clicked'; })()";
const WIN_COUNT = "return (function(){ var f = document.querySelector('.window iframe'); if (!f) return JSON.stringify({err: 'no iframe'}); var d = f.contentDocument; if (!d) return JSON.stringify({err: 'no doc'}); var c = d.querySelector('.count'); var cfgs = []; var hs = d.querySelectorAll('.cfg h5'); for (var i = 0; i < hs.length; i++) cfgs.push(hs[i].textContent.trim()); return JSON.stringify({count: c ? c.textContent : null, cfgs: cfgs}); })()";

async function main() {
    killStale();
    spawn('geckodriver', ['--port', String(GPORT)], { stdio: 'ignore' });
    let up = false;
    for (let i = 0; i < 40; i++) { try { await wd('GET', '/status', null, 2000); up = true; break; } catch (e) { await sleep(250); } }
    if (!up) throw new Error('geckodriver not up');
    const sid = await newSession();
    await lib.login(sid);   // shared login: device+cookie from probe/lib.js (.local-env / PROBE_ROUTER / PROBE_SSH)

    // 1) system page: save → delta
    await nav(sid, `http://${ROUTER}/cgi-bin/luci/admin/system/system?embed=1`); await sleep(4500);
    console.log('SETLANG: ' + await exec(sid, SETLANG));
    console.log('SAVE: ' + await exec(sid, SAVE));
    await sleep(4000);
    console.log('COUNT+4s: ' + await exec(sid, COUNT));

    // 2) desktop shell, wait for the toast
    await nav(sid, `http://${ROUTER}/cgi-bin/luci/`); await sleep(12000);
    console.log('TOAST: ' + await exec(sid, TOAST));
    console.log('COUNT+t0: ' + await exec(sid, COUNT));
    await sleep(5000);
    console.log('COUNT+t5: ' + await exec(sid, COUNT));
    await sleep(5000);
    console.log('COUNT+t10: ' + await exec(sid, COUNT));
    await sleep(5000);
    console.log('COUNT+t15: ' + await exec(sid, COUNT));

    // 3) open the window and compare
    console.log('OPEN: ' + await exec(sid, OPEN_CHANGES));
    await sleep(3500);
    console.log('WIN_COUNT: ' + await exec(sid, WIN_COUNT));
    console.log('COUNT+afterWin: ' + await exec(sid, COUNT));

    await wd('DELETE', '/session/' + sid, null, 5000).catch(() => {});
    killStale();
}
main().catch(e => { console.error('FATAL: ' + e.message); killStale(); process.exit(1); });
