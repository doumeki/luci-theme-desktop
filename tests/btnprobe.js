/* Probe the save/apply button zone on the embedded system/system page:
 * what renders the buttons, is L.ui (with .changes) available, what does
 * clicking 保存 vs 保存并应用 do. All scripts single-line.
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

    const zoneScript = "return (function(){ var forms = document.querySelectorAll('form'); var out = {forms: []}; for (var i = 0; i < forms.length; i++) { var f = forms[i]; var btns = f.querySelectorAll('button, input[type=submit]'); var b = []; for (var j = 0; j < btns.length; j++) b.push({id: btns[j].id || '', cls: btns[j].className, val: btns[j].value || btns[j].innerText || '', action: btns[j].getAttribute('data-action') || '', onclick: (btns[j].getAttribute('onclick') || '').slice(0, 80)}); out.forms.push({action: f.action, cbiState: f.getAttribute('data-cbi-state') || f.cbi_state || '', btns: b}); } return JSON.stringify(out); })()";
    console.log('ZONE: ' + await exec(sid, zoneScript));
    await sleep(300);

    const envScript = "return (function(){ var sc = document.querySelectorAll('script'); var ui = false; for (var i = 0; i < sc.length; i++) { var src = sc[i].getAttribute('src') || ''; if (src.indexOf('ui.js') !== -1) ui = src; } return JSON.stringify({Lui: typeof L !== 'undefined' && L.ui ? 'yes' : 'no', LuiChanges: typeof L !== 'undefined' && L.ui && L.ui.changes ? 'yes' : 'no', uiScript: ui, requires: typeof L !== 'undefined' && L.require ? 'yes' : 'no'}); })()";
    console.log('ENV: ' + await exec(sid, envScript));

    await wd('DELETE', '/session/' + sid, null, 5000).catch(() => {});
    killStale();
}
main().catch(e => { console.error('FATAL: ' + e.message); killStale(); process.exit(1); });
