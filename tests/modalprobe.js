/* Where does the empty .modal come from? Parent context + all script srcs. */
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

    const s1 = "return (function(){ var m = document.querySelector('.modal'); if (!m) return JSON.stringify({none: true}); var p = m.parentElement; return JSON.stringify({parent: p ? p.tagName + '.' + p.className + '#' + p.id : null, prev: m.previousElementSibling ? (m.previousElementSibling.tagName + '.' + m.previousElementSibling.className).slice(0, 60) : null, next: m.nextElementSibling ? (m.nextElementSibling.tagName + '.' + m.nextElementSibling.className).slice(0, 60) : null, bodyChildren: document.body.children.length, inMain: !!m.closest('#maincontent')}); })()";
    console.log('PARENT: ' + await exec(sid, s1));

    const s2 = "return (function(){ var sc = document.querySelectorAll('script'); var out = []; for (var i = 0; i < sc.length; i++) out.push((sc[i].getAttribute('src') || 'inline:' + sc[i].textContent.length).slice(0, 90)); return JSON.stringify(out); })()";
    console.log('ALL SCRIPTS: ' + await exec(sid, s2));

    // MutationObserver before clicking: does any click create/modify modal?
    const s3 = "return (function(){ window.__mut = []; var mo = new MutationObserver(function(muts){ for (var i = 0; i < muts.length; i++) { var t = muts[i]; if (t.type === 'childList' && t.addedNodes.length) window.__mut.push('+' + t.addedNodes[0].tagName + '.' + (t.addedNodes[0].className || '').slice(0, 40)); } }); mo.observe(document.body, {childList: true}); window.__mo = mo; return JSON.stringify({ok: 1}); })()";
    console.log('MO: ' + await exec(sid, s3));
    const s4 = "return (function(){ var b = document.querySelector('button.cbi-button-save'); if (b) b.click(); return JSON.stringify({clicked: true}); })()";
    await exec(sid, s4);
    await sleep(2500);
    console.log('MUTATIONS: ' + await exec(sid, "return JSON.stringify(window.__mut || [])"));

    await wd('DELETE', '/session/' + sid, null, 5000).catch(() => {});
    killStale();
}
main().catch(e => { console.error('FATAL: ' + e.message); killStale(); process.exit(1); });
