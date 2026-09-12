/* Verify the translations resource fix: the embedded page must load
 * dispatcher.build_url('admin/translations', lang) (window.TR) so client-side
 * L() renders Chinese. Checks: scripts list, window.TR, tab pane titles.
 */
const { spawn, execSync } = require('child_process');
const http = require('http');

const lib = require('../probe/lib.js');
const GPORT = 4444;
const ROUTER = lib.ROUTER;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function killStale() {
    for (const pat of ['[f]irefox.*--headless', '[g]eckodriver --port']) {
        try { execSync(`pkill -9 -f '${pat}' 2>/dev/null; true`); } catch (e) {}
    }
}
function wd(method, urlPath, body, timeoutMs) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const req = http.request({ host: '127.0.0.1', port: GPORT, path: urlPath, method,
            headers: { 'Content-Type': 'application/json' } }, res => {
            let b = '';
            res.on('data', d => b += d);
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
    await nav(sid, `http://${ROUTER}/cgi-bin/luci/admin/system/system?embed=1`);
    await sleep(4000);

    const scriptsScript = "return (function(){ var sc = document.querySelectorAll('script'); var out = []; for (var i = 0; i < sc.length; i++) { var src = sc[i].getAttribute('src') || ''; if (src.indexOf('translations') !== -1 || src.indexOf('cbi.js') !== -1 || src.indexOf('i18n.js') !== -1) out.push(src); } return JSON.stringify(out); })()";
    console.log('SCRIPTS: ' + await exec(sid, scriptsScript));

    const trScript = "return (function(){ if (typeof window.TR === 'undefined') return JSON.stringify({err: 'no window.TR'}); var n = 0; for (var k in window.TR) n++; var sample = ''; for (var k2 in window.TR) { sample = k2 + ':' + window.TR[k2]; break; } return JSON.stringify({keys: n, sample: sample}); })()";
    console.log('TR: ' + await exec(sid, trScript));

    const tabScript = "return (function(){ var panes = document.querySelectorAll('[data-tab-title]'); var out = []; for (var i = 0; i < panes.length; i++) out.push(panes[i].getAttribute('data-tab') + '=' + panes[i].getAttribute('data-tab-title')); var lis = document.querySelectorAll('ul.cbi-tabmenu li a'); for (var j = 0; j < lis.length; j++) out.push('li:' + lis[j].innerText); return JSON.stringify(out); })()";
    console.log('TABS: ' + await exec(sid, tabScript));

    await wd('DELETE', '/session/' + sid, null, 5000).catch(() => {});
    killStale();
}
main().catch(e => { console.error('FATAL: ' + e.message); killStale(); process.exit(1); });
