/* pw-alert-cdp.js — Edge headless + CDP 验证 desktop-pw-alert 渲染
 * （firefox headless 连续 SIGKILL，改用 Edge——记忆：状态页等重页面用
 * Edge CDP 稳定）。验证：420px 视口 pw-alert 应 HIDDEN、1400px 应 VISIBLE。
 * 依赖：Node v24 原生 WebSocket + /usr/bin/microsoft-edge。
 * 注意：清理进程用 pkill -x（-f 会匹配 bash 命令行自杀——记忆坑）。
 *
 * 登录方式特殊：不走 WebDriver/geckodriver，而是 Edge CDP 直连浏览器。
 * 设备地址与 cookie 名仍统一来自 probe/lib.js——ROUTER 读
 * .local-env/PROBE_ROUTER，cookie 名读登录响应实际 Set-Cookie 的名字
 * （Lua `sysauth` / ucode `sysauth_http`，随 runtime 不随设备）。 */
'use strict';
const { spawn, execSync } = require('child_process');
const http = require('http');
const lib = require('./lib.js');

const EDGE = '/usr/bin/microsoft-edge';
const PORT = 9223;
const ROUTER = lib.ROUTER;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function req(method, path) {
    return new Promise((res, rej) => {
        const r = http.request({ host: '127.0.0.1', port: PORT, path, method }, resp => {
            let x = ''; resp.on('data', c => x += c);
            resp.on('end', () => { try { res(JSON.parse(x)); } catch (e) { rej(new Error('non-JSON: ' + x.slice(0, 80))); } });
        });
        r.on('error', rej);
        r.end();
    });
}
const getJson = p => req('GET', p);
const putJson = p => req('PUT', p);

function cdpSend(ws, id, method, params) {
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => {
        const onMsg = (ev) => {
            const m = JSON.parse(ev.data);
            if (m.id === id) {
                ws.removeEventListener('message', onMsg);
                m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
            }
        };
        ws.addEventListener('message', onMsg);
    });
}

(async () => {
    try { execSync('pkill -9 -x microsoft-edge 2>/dev/null; pkill -9 -x microsoft-edge-crashpad 2>/dev/null; true'); } catch (e) {}
    await sleep(500);
    const edge = spawn(EDGE, ['--headless', '--disable-gpu', '--no-sandbox',
        '--remote-debugging-port=' + PORT, 'about:blank'], { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) {
        try { await getJson('/json/version'); break; } catch (e) { await sleep(300); }
    }
    // Shared cookie source: lib reads the name the login response set.
    const cookie = lib.curlLoginToken(ROUTER);
    console.log('[pw-alert-cdp] router=' + ROUTER + ' cookie=' + cookie.name);

    async function check(w, h) {
        const tab = await putJson('/json/new?http://' + ROUTER + '/cgi-bin/luci/');
        const ws = new WebSocket(tab.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        await cdpSend(ws, 1, 'Network.enable', {});
        await cdpSend(ws, 2, 'Network.setCookie', { name: cookie.name, value: cookie.value, domain: ROUTER, path: '/' });
        await cdpSend(ws, 3, 'Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true });
        await cdpSend(ws, 4, 'Page.enable', {});
        await cdpSend(ws, 5, 'Page.navigate', { url: 'http://' + ROUTER + '/cgi-bin/luci/' });
        await sleep(8000);
        const r = await cdpSend(ws, 6, 'Runtime.evaluate', {
            expression: `(function(){
                var el = document.getElementById('desktop-pw-alert');
                if (!el) return 'NO-ELEMENT';
                return getComputedStyle(el).display === 'none' ? 'HIDDEN' : 'VISIBLE';
            })()`, returnByValue: true });
        const v = r.result && r.result.value;
        console.log('[' + w + 'x' + h + '] pw-alert: ' + v);
        ws.close();
        return v;
    }
    const m = await check(420, 740);
    const dt = await check(1400, 900);
    console.log(m === 'HIDDEN' && dt === 'VISIBLE' ? '== pw-alert mobile-hide PASS' : '== pw-alert check FAIL');
    edge.kill();
    try { execSync('pkill -9 -x microsoft-edge 2>/dev/null; pkill -9 -x microsoft-edge-crashpad 2>/dev/null; true'); } catch (e) {}
    process.exit(m === 'HIDDEN' && dt === 'VISIBLE' ? 0 : 1);
})().catch(e => { console.error('FATAL: ' + e.message); process.exit(1); });
