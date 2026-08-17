/* mobile-bell-review.js — 移动端 switcher 铃铛通知复现验证（2026-08-15 bugfix）:
 * 用户场景：switcher 点 🔔 → 弹回桌面 → 通知"秒关"（旧 toast 被 dismissAll
 * 且无重弹）→ 需再点一次。修复：移动端铃铛 = forceReview（恒重弹不关闭）。
 * 验证：造一个 on-screen changes toast → 开 switcher → 点铃铛 →
 * 断言 toast 仍可读（修复前会被 dismissAll 清掉）。
 * 用法同 runtime-matrix（默认 1.1；253 用 PROBE_SSH）。
 */
'use strict';
const lib = require('./lib.js');
const { sleep, exec, nav, startGecko, newSession, login, finish } = lib;
const R = () => `http://${lib.ROUTER}`;

function wd(m, p, b, t) {
    return new Promise((res, rej) => {
        const d = b ? JSON.stringify(b) : null;
        const r = require('http').request({ host: '127.0.0.1', port: 4444, path: p, method: m,
            headers: { 'Content-Type': 'application/json' } }, s => {
            let x = ''; s.on('data', c => x += c);
            s.on('end', () => res({ status: s.statusCode, body: x }));
        });
        r.setTimeout(t || 30000, () => r.destroy(new Error('t')));
        r.on('error', rej);
        if (d) r.write(d);
        r.end();
    });
}
async function sess(w, h) {
    const rs = await wd('POST', '/session', { capabilities: { alwaysMatch: { pageLoadStrategy: 'none',
        'moz:firefoxOptions': { args: ['--headless', `--width=${w}`, `--height=${h}`] } } } }, 90000);
    return JSON.parse(rs.body).value.sessionId;
}
const toastState = (s) => exec(s, `return (function(){
    var t = document.querySelector('.desktop-toast[data-key="changes"]:not(.toast-hiding)');
    return t ? 'PRESENT: ' + (t.querySelector('.toast-msg') || {}).textContent : 'GONE';
})()`);

(async () => {
    await startGecko();
    const s = await sess(420, 740);   // 移动端窄视口
    await login(s);
    await nav(s, `${R()}/cgi-bin/luci/`); await sleep(13000);

    // 1) 造一个待读的 changes 通知（模拟 _count>0 时屏幕上已有 toast）
    console.log('[setup] ' + await exec(s, `return (function(){
        if (!window.TrayManager) return 'NO-TRAY';
        TrayManager.notify('Unsaved Changes: 2', { key: 'changes', type: 'warn',
            title: 'Unsaved Changes', icon: '⚙️' });
        return 'toast created';
    })()`));
    await sleep(300);
    console.log('[1 before switcher] ' + await toastState(s));

    // 2) 打开 switcher
    console.log('[open] ' + await exec(s, `return (function(){
        if (window.LuCIDesktop && LuCIDesktop.mobile && LuCIDesktop.mobile.openSwitcher) {
            LuCIDesktop.mobile.openSwitcher(); return 'opened';
        }
        return 'NO-MOBILE';
    })()`));
    await sleep(400);

    // 3) 点 switcher 铃铛（修复路径：forceReview）
    console.log('[bell click] ' + await exec(s, `return (function(){
        var b = document.querySelector('.switcher-bell');
        if (!b) return 'NO-BELL';
        b.click(); return 'clicked';
    })()`));
    await sleep(600);   // closeSwitcher 动画 170ms + toast 重弹

    // 4) 断言：toast 仍可读（修复前 = GONE）
    const after = await toastState(s);
    console.log('[4 after bell] ' + after);
    console.log(after !== 'GONE' ? '== mobile bell review PASS (toast readable)' : '== mobile bell review FAIL (toast gone)');

    // 清理
    await exec(s, `return (function(){ if (window.TrayManager) TrayManager.dismissAll();
        if (window.LuCIDesktop && LuCIDesktop.mobile) LuCIDesktop.mobile.closeSwitcher(); return 1; })()`);
    await wd('DELETE', '/session/' + s, null, 5000).catch(() => {});
    await finish(s).catch(() => {});
    process.exit(after !== 'GONE' ? 0 : 1);
})().catch(e => { console.error('FATAL: ' + e.message); process.exit(1); });
