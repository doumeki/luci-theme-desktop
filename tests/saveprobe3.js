/* Pre-click modal state + error collector + modal outerHTML after Save. */
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
    try { return JSON.parse(r.body).value; } catch (e) { return '?(' + r.status + ' ' + String(r.body).slice(0, 300) + ')'; }
}
async function nav(sid, url) { try { await wd('POST', `/session/${sid}/url`, { url }, 25000); } catch (e) {} }
async function main() {
    killStale();
    spawn('geckodriver', ['--port', String(GPORT)], { stdio: 'ignore' });
    let up = false;
    for (let i = 0; i < 40; i++) { try { await wd('GET', '/status', null, 2000); up = true; break; } catch (e) { await sleep(250); } }
    if (!up) throw new Error('geckodriver not up');
    const sid = await newSession();
    await lib.login(sid);   // shared login: device+cookie from probe/lib.js (.local-env / PROBE_ROUTER / PROBE_SSH)
    await nav(sid, `http://${ROUTER}/cgi-bin/luci/admin/system/system?embed=1`); await sleep(5000);

    // install error collector (single line!)
    console.log('ERR INSTALL: ' + await exec(sid, "return (function(){ window.__errs = []; window.addEventListener('error', function(e){ window.__errs.push((e.message || '') + '@' + (e.filename || '').split('/').pop() + ':' + (e.lineno || 0)); }); return JSON.stringify({ok: 1}); })()"));

    console.log('PRE MODALS: ' + await exec(sid, "return (function(){ var ms = document.querySelectorAll('.modal'); var maps = document.querySelectorAll('.cbi-map'); return JSON.stringify({modals: ms.length, maps: maps.length, overlays: document.querySelectorAll('.modal-overlay-active').length}); })()"));

    console.log('CLICK SAVE: ' + await exec(sid, "return (function(){ var b = document.querySelector('button.cbi-button-save'); if (!b) return JSON.stringify({err: 'no save'}); b.click(); return JSON.stringify({ok: true}); })()"));
    await sleep(2500);
    console.log('MODALS AFTER: ' + await exec(sid, "return (function(){ var out = []; document.querySelectorAll('.modal').forEach(function(m){ out.push(m.outerHTML.slice(0, 400)); }); return JSON.stringify(out); })()"));
    console.log('ERRS: ' + await exec(sid, "return JSON.stringify(window.__errs || [])"));

    await wd('DELETE', '/session/' + sid, null, 5000).catch(() => {});
    killStale();
}
main().catch(e => { console.error('FATAL: ' + e.message); killStale(); process.exit(1); });
