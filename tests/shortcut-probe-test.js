/* Verify default-shortcut availability probing:
 * 1. desktop loads → default icons rendered (Terminal present, ttyd installed)
 * 2. LuCIMenuData contains the ttyd page → probe skips network check
 * 3. fetch HEAD behavior on a 404 URL (probe's fallback path)
 * Usage: node shortcut-probe-test.js
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

const ICONS = "return (function(){ var els = document.querySelectorAll('#desktop-icons .desktop-icon'); var out = []; for (var i = 0; i < els.length; i++) { out.push((els[i].innerText||'').trim().slice(0,12)); } return JSON.stringify(out); })()";
const MENU_CHECK = "return (function(){ var data = window.LuCIMenuData; if (!data) return JSON.stringify({err: 'no menu data'}); var found = []; (function walk(cats){ cats.forEach(function(c){ if (c.subs) walk(c.subs); if (c.href && c.href.indexOf('ttyd') !== -1) found.push(c.href); }); })(data); return JSON.stringify({ttydEntries: found, cats: data.length}); })()";
const HEAD_404 = "return fetch('/cgi-bin/luci/admin/system/terminal', {method: 'HEAD', credentials: 'same-origin'}).then(function(r) { return JSON.stringify({status: r.status, ok: r.ok}); })";
const HEAD_OK = "return fetch('/cgi-bin/luci/admin/system/ttyd/ttyd', {method: 'HEAD', credentials: 'same-origin'}).then(function(r) { return JSON.stringify({status: r.status, ok: r.ok}); })";

async function main() {
    killStale();
    spawn('geckodriver', ['--port', String(GPORT)], { stdio: 'ignore' });
    let up = false;
    for (let i = 0; i < 40; i++) { try { await wd('GET', '/status', null, 2000); up = true; break; } catch (e) { await sleep(250); } }
    if (!up) throw new Error('geckodriver not up');
    const sid = await newSession();
    await lib.login(sid);   // shared login: device+cookie from probe/lib.js (.local-env / PROBE_ROUTER / PROBE_SSH)
    await nav(sid, `http://${ROUTER}/cgi-bin/luci/`); await sleep(4000);

    console.log('ICONS: ' + await exec(sid, ICONS));
    console.log('MENU: ' + await exec(sid, MENU_CHECK));
    console.log('HEAD404: ' + await exec(sid, HEAD_404));
    console.log('HEADOK: ' + await exec(sid, HEAD_OK));

    await wd('DELETE', '/session/' + sid, null, 5000).catch(() => {});
    killStale();
}
main().catch(e => { console.error('FATAL: ' + e.message); killStale(); process.exit(1); });
