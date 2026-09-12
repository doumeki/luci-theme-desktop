/* Click the save / save&apply buttons on embedded system/system and observe
 * what happens (no values changed — empty save/apply is a no-op). Also check
 * whether the official #indicators container exists on the theme page.
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

    console.log('INDICATORS: ' + await exec(sid, "return (function(){ var el = document.getElementById('indicators'); return JSON.stringify({exists: !!el, html: el ? el.innerHTML.slice(0, 200) : null, parentCls: el && el.parentElement ? el.parentElement.className : null}); })()"));

    // Click Save (cbi-button-save) — observe network + location
    const saveClick = "return (function(){ var b = document.querySelector('button.cbi-button-save'); if (!b) return JSON.stringify({err: 'no save btn'}); b.click(); return JSON.stringify({clicked: true}); })()";
    console.log('SAVE CLICK: ' + await exec(sid, saveClick));
    await sleep(3000);
    console.log('AFTER SAVE url: ' + await exec(sid, "return (function(){ return JSON.stringify({url: location.href, modals: document.querySelectorAll('.modal').length, alerts: document.querySelectorAll('.alert-message').length}); })()"));
    await sleep(1500);

    // Click Save&Apply (cbi-button-apply dropdown, default item)
    const applyClick = "return (function(){ var d = document.querySelector('.cbi-button-apply'); if (!d) return JSON.stringify({err: 'no apply btn'}); try { d.click(); return JSON.stringify({clicked: true}); } catch(e) { return JSON.stringify({exc: String(e)}); } })()";
    console.log('APPLY CLICK: ' + await exec(sid, applyClick));
    await sleep(4000);
    console.log('AFTER APPLY: ' + await exec(sid, "return (function(){ var modals = []; document.querySelectorAll('.modal').forEach(function(m){ modals.push((m.innerText || '').slice(0, 120).replace(/\\n/g, ' ')); }); return JSON.stringify({url: location.href, modals: modals, bodyStart: document.body.innerText.slice(0, 100).replace(/\\n/g, ' ')}); })()"));

    await wd('DELETE', '/session/' + sid, null, 5000).catch(() => {});
    killStale();
}
main().catch(e => { console.error('FATAL: ' + e.message); killStale(); process.exit(1); });
