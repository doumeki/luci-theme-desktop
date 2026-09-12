/* Verify the modal CSS fix: after Save + postMessage, the official
 * uci-changes modal must render FIXED and centered (not at page bottom).
 * Also verify the standalone changes page opens with a real entry. */
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

    // Change the language select → Save → badge
    console.log('SETLANG: ' + await exec(sid, "return (function(){ var sels = document.querySelectorAll('select'); var sel = null; for (var i = 0; i < sels.length; i++) { if (sels[i].id.indexOf('_lang') !== -1) { sel = sels[i]; break; } } if (!sel) return JSON.stringify({err: 'no lang select'}); var cur = sel.value; sel.value = (cur === 'zh_cn') ? 'en' : 'zh_cn'; return JSON.stringify({old: cur, new: sel.value}); })()"));
    console.log('SAVE: ' + await exec(sid, "return (function(){ var b = document.querySelector('button.cbi-button-save'); if (!b) return JSON.stringify({err: 'no save'}); b.click(); return JSON.stringify({ok: true}); })()"));
    await sleep(3500);
    console.log('BADGE: ' + await exec(sid, "return (function(){ var el = document.getElementById('indicators'); if (!el) return JSON.stringify({err: 'no container'}); var out = []; for (var i = 0; i < el.children.length; i++) { var c = el.children[i]; out.push((c.getAttribute('data-indicator') || '') + '=' + (c.innerText || '').slice(0, 40)); } return JSON.stringify(out); })()"));

    // Open the official modal via postMessage
    console.log('POSTMSG: ' + await exec(sid, "return (function(){ window.postMessage({type: 'show-uci-changes'}, '*'); return 'sent'; })()"));
    await sleep(1500);

    // The key check: overlay + modal computed layout
    console.log('MODALPOS: ' + await exec(sid, "return (function(){ var ov = document.getElementById('modal_overlay'); var m = document.querySelector('#modal_overlay .modal'); if (!ov || !m) return JSON.stringify({err: 'no overlay/modal', ov: !!ov, m: !!m}); var os = getComputedStyle(ov); var ms = getComputedStyle(m); var mr = m.getBoundingClientRect(); return JSON.stringify({overlayPos: os.position, overlayVis: os.visibility, bodyClass: document.body.className, bodyOv: getComputedStyle(document.body).overflow, modalPos: ms.position, modalRect: {top: Math.round(mr.top), left: Math.round(mr.left), w: Math.round(mr.width)}, winW: window.innerWidth, viewH: window.innerHeight}); })()"));

    // Diff content present?
    console.log('DIFF: ' + await exec(sid, "return (function(){ var m = document.querySelector('#modal_overlay .modal'); if (!m) return JSON.stringify({err: 'no modal'}); return JSON.stringify({txt: (m.innerText || '').slice(0, 200).replace(/\\n/g, ' '), hasIns: !!m.querySelector('ins'), hasDel: !!m.querySelector('del')}); })()"));

    // Revert to clean up
    console.log('REVERT: ' + await exec(sid, "return (function(){ var dlg = document.querySelector('.modal'); if (!dlg) return JSON.stringify({err: 'no modal'}); var btns = dlg.querySelectorAll('button, .cbi-button'); for (var i = 0; i < btns.length; i++) { var t = (btns[i].innerText || '').trim(); if (t.indexOf('Revert') !== -1 || t.indexOf('恢复') !== -1 || t.indexOf('还原') !== -1) { btns[i].click(); return JSON.stringify({clicked: t}); } } return JSON.stringify({err: 'no revert'}); })()"));
    await sleep(3500);
    console.log('BADGE2: ' + await exec(sid, "return (function(){ var el = document.getElementById('indicators'); if (!el) return JSON.stringify({err: 'no container'}); return JSON.stringify({children: el.children.length}); })()"));

    await wd('DELETE', '/session/' + sid, null, 5000).catch(() => {});
    killStale();
}
main().catch(e => { console.error('FATAL: ' + e.message); killStale(); process.exit(1); });
