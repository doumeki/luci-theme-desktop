/* Verify the [data-tab-title]/[data-tab-active] CSS fix: after clicking the
 * 2nd tab, the 1st pane must have computed height 0 / opacity 0 and the
 * 2nd pane must be visible. Every script is single-line (multiline scripts
 * return null from execute/sync).
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

function readPanes() {
    return "return (function(){ var panes = document.querySelectorAll('[data-tab-title]'); var out = []; for (var i = 0; i < panes.length; i++) { var p = panes[i], cs = getComputedStyle(p); out.push({tab: p.getAttribute('data-tab'), active: p.getAttribute('data-tab-active'), h: cs.height, o: cs.opacity, ov: cs.overflow, d: cs.display}); } return JSON.stringify(out); })()";
}

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

    console.log('BEFORE: ' + await exec(sid, readPanes()));
    await sleep(300);

    const clickScript = "return (function(){ var a = document.querySelectorAll('ul.cbi-tabmenu li a'); if (a.length < 2) return JSON.stringify({err: 'only-' + a.length}); try { a[1].click(); return JSON.stringify({ok: true}); } catch(e) { return JSON.stringify({exc: String(e)}); } })()";
    console.log('CLICK: ' + await exec(sid, clickScript));
    await sleep(2000);

    console.log('AFTER: ' + await exec(sid, readPanes()));
    const clsScript = "return (function(){ var lis = document.querySelectorAll('ul.cbi-tabmenu li'); var cls = []; for (var i = 0; i < lis.length; i++) cls.push(lis[i].className); return JSON.stringify(cls); })()";
    console.log('CLS: ' + await exec(sid, clsScript));

    await wd('DELETE', '/session/' + sid, null, 5000).catch(() => {});
    killStale();
}
main().catch(e => { console.error('FATAL: ' + e.message); killStale(); process.exit(1); });
