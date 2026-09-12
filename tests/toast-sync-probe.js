/* Verify the changes toast stays in sync with the real pending count:
 * 1. system page: change lang + hostname, save → 2-entry delta
 * 2. desktop shell: toast shows "Unsaved Changes: 2"
 * 3. revert the luci entry out-of-band (ssh, same session) → 1 remains
 * 4. after the next poll the toast must read "Unsaved Changes: 1"
 * 5. revert the rest → the changes toast must disappear (dismissed)
 * Usage: node toast-sync-probe.js
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

const SET_BOTH = "return (function(){ var out = {}; var sels = document.querySelectorAll('select'); var sel = null; for (var i = 0; i < sels.length; i++) { if (sels[i].id.indexOf('_lang') !== -1) { sel = sels[i]; break; } } if (sel) { sel.value = (sel.value === 'zh_cn') ? 'en' : 'zh_cn'; out.lang = sel.value; } var hn = document.querySelector('input[id$=\".hostname\"]'); if (hn) { hn.value = hn.value + '-X'; out.hostname = hn.value; } return JSON.stringify(out); })()";
const SAVE = "return (function(){ var b = document.querySelector('button.cbi-button-save'); if (!b) return JSON.stringify({err: 'no save btn'}); b.click(); return 'save-clicked'; })()";
const TOAST_MSG = "return (function(){ var t = document.querySelector('.desktop-toast[data-key=\"changes\"]'); if (!t) return JSON.stringify({err: 'no toast'}); return JSON.stringify({msg: (t.querySelector('.toast-msg')||{}).innerText || '', shown: true}); })()";
const TOAST_GONE = "return (function(){ var t = document.querySelector('.desktop-toast[data-key=\"changes\"]'); return JSON.stringify({gone: !t}); })()";
const COUNT_NOW = "return fetch('/cgi-bin/luci/admin/desktop/uci_changes').then(function(r) { return r.json(); }).then(function(j) { return JSON.stringify({count: j.count}); });";
const HAS_UPDATE_MSG = "return JSON.stringify({upd: typeof (window.TrayManager || {}).updateMessage, dis: typeof (window.TrayManager || {}).dismiss, src: document.querySelector('script[src*=\"tray.js\"]') ? 'tray-script' : '?no-tray-script'});";
const TRY_DISMISS = "return (function(){ var tm = window.TrayManager; if (!tm) return 'no-TM'; try { tm.dismiss('changes'); return 'dismiss-called'; } catch (e) { return 'dismiss-threw: ' + (e && e.message); } })()";

function ubusRevert(sid, cfg) {
    // Out-of-band revert over ssh: host/key follow probe/lib.js conventions
    // (PROBE_SSH / PROBE_SSH_KEY with .local-env fallbacks) — no hardcoded IP.
    const host = lib.SSH_HOST || ROUTER;
    const key = lib.SSH_KEY ? `-i ${lib.SSH_KEY}` : '';
    try {
        execSync(`ssh ${key} -o StrictHostKeyChecking=no root@${host} "ubus call uci revert '{\\\"config\\\":\\\"${cfg}\\\",\\\"ubus_rpc_session\\\":\\\"${sid}\\\"}'"`, { timeout: 10000 });
        return 'revert-' + cfg;
    } catch (e) { return 'ssh-fail: ' + e.message; }
}

async function main() {
    killStale();
    spawn('geckodriver', ['--port', String(GPORT)], { stdio: 'ignore' });
    let up = false;
    for (let i = 0; i < 40; i++) { try { await wd('GET', '/status', null, 2000); up = true; break; } catch (e) { await sleep(250); } }
    if (!up) throw new Error('geckodriver not up');
    const sid = await newSession();
    const auth = await lib.login(sid);   // shared login: device+cookie from probe/lib.js (.local-env / PROBE_ROUTER / PROBE_SSH)

    // 1) two-entry delta
    await nav(sid, `http://${ROUTER}/cgi-bin/luci/admin/system/system?embed=1`); await sleep(4500);
    console.log('SET_BOTH: ' + await exec(sid, SET_BOTH));
    console.log('SAVE: ' + await exec(sid, SAVE));
    await sleep(4000);
    await nav(sid, `http://${ROUTER}/cgi-bin/luci/`); await sleep(12000);
    console.log('TOAST#1: ' + await exec(sid, TOAST_MSG));
    console.log('API-CHECK: ' + await exec(sid, HAS_UPDATE_MSG));

    // 3) revert one entry out-of-band → count drops 2 → 1 while toast is up.
    //    The toast text must update to "1" after the next poll (updateMessage).
    console.log('REVERT-luci: ' + ubusRevert(auth.value, 'luci'));
    console.log('COUNT-after-revert: ' + await exec(sid, COUNT_NOW));
    await sleep(12000);   // wait one poll cycle (10s)
    console.log('TOAST#2 (expect msg 1): ' + await exec(sid, TOAST_MSG));

    // 4) revert the rest → count 0 → toast dismissed by the poller
    console.log('REVERT-system: ' + ubusRevert(auth.value, 'system'));
    await sleep(12000);
    console.log('TOAST#3 (expect gone): ' + await exec(sid, TOAST_GONE));

    await wd('DELETE', '/session/' + sid, null, 5000).catch(() => {});
    killStale();
}
main().catch(e => { console.error('FATAL: ' + e.message); killStale(); process.exit(1); });
