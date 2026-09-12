/* Verify sticky note instances are independent after the deep-copy fix:
 * 1. wipe all sticky-note instances + preserved data
 * 2. create 3 fresh notes, type different text in each
 * 3. reload the desktop and check all three keep their own content
 * Usage: node stickynote-share-probe.js
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
async function exec(sid, script, args) {
    const r = await wd('POST', `/session/${sid}/execute/sync`, { script, args: args || [] }, 20000);
    try { return JSON.parse(r.body).value; } catch (e) { return '?(' + r.status + ' ' + String(r.body).slice(0, 200) + ')'; }
}
async function nav(sid, url) { try { await wd('POST', `/session/${sid}/url`, { url }, 25000); } catch (e) {} }

const WIPE = "return (function(){ var WM = window.WidgetManager || window.LuCIDesktop.WidgetManager; if (!WM) return JSON.stringify({err: 'no WM'}); WM.disableAll('sticky-note'); var ids = []; Object.keys(WM._preservedConfigs || {}).forEach(function(iid) { if (iid.indexOf('sticky-note') === 0) { ids.push(iid); WM.clearPreserved(iid); } }); return JSON.stringify({cleared: ids}); })()";
const ADD3 = "return (function(){ var WM = window.WidgetManager || window.LuCIDesktop.WidgetManager; var out = []; for (var i = 0; i < 3; i++) { var before = Object.keys(WM.instances).length; try { WM.enable('sticky-note'); } catch (e) { out.push('ERR:' + e.message); break; } } var list = []; Object.keys(WM.instances).forEach(function(iid){ if (iid.indexOf('sticky-note') === 0) list.push(iid); }); return JSON.stringify(list); })()";
const TYPE = function(n) { return "return (function(){ var bodies = document.querySelectorAll('.widget-sticky-note .sticky-body'); if (bodies.length <= " + n + ") return JSON.stringify({err: 'no body " + n + "', n: bodies.length}); bodies[" + n + "].textContent = 'NOTE-" + (n + 1) + "-TEXT'; bodies[" + n + "].dispatchEvent(new Event('input', {bubbles: true})); return 'typed-" + n + "'; })()"; };
const NOTES_DUMP = "return (function(){ var WM = window.WidgetManager || window.LuCIDesktop.WidgetManager; var out = {}; Object.keys(WM.instances).forEach(function(iid) { if (iid.indexOf('sticky-note') !== 0) return; var el = WM.instances[iid].el.querySelector('.sticky-body'); out[iid] = el ? (el.textContent || '') : 'no-el'; }); return JSON.stringify(out); })()";

async function main() {
    killStale();
    spawn('geckodriver', ['--port', String(GPORT)], { stdio: 'ignore' });
    let up = false;
    for (let i = 0; i < 40; i++) { try { await wd('GET', '/status', null, 2000); up = true; break; } catch (e) { await sleep(250); } }
    if (!up) throw new Error('geckodriver not up');
    const sid = await newSession();
    await lib.login(sid);   // shared login: device+cookie from probe/lib.js (.local-env / PROBE_ROUTER / PROBE_SSH)
    await nav(sid, `http://${ROUTER}/cgi-bin/luci/`); await sleep(4000);

    console.log('WIPE: ' + await exec(sid, WIPE));
    await sleep(1200);
    console.log('ADD3: ' + await exec(sid, ADD3));
    await sleep(800);
    console.log('TYPE0: ' + await exec(sid, TYPE(0)));
    console.log('TYPE1: ' + await exec(sid, TYPE(1)));
    console.log('TYPE2: ' + await exec(sid, TYPE(2)));
    await sleep(1500);
    console.log('BEFORE-RELOAD: ' + await exec(sid, NOTES_DUMP));

    // reload and verify persistence
    await nav(sid, `http://${ROUTER}/cgi-bin/luci/`); await sleep(5000);
    console.log('AFTER-RELOAD: ' + await exec(sid, NOTES_DUMP));

    await wd('DELETE', '/session/' + sid, null, 5000).catch(() => {});
    killStale();
}
main().catch(e => { console.error('FATAL: ' + e.message); killStale(); process.exit(1); });
