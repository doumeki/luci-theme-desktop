/* wallpaper-smoke.js — P1 迁移后壁纸链路浏览器验证（2026-08-15）:
 * 1. 首页加载：无 JS 错误
 * 2. #desktop-wallpaper 应用了背景（gradient 或 URL）
 * 3. desktop-config 读改写正常（getConfig/setSectionLocal 路径）
 * 用法同 runtime-matrix（默认 1.1；253 用 PROBE_SSH）。
 */
'use strict';
const lib = require('./lib.js');
const { sleep, exec, nav, startGecko, newSession, login, finish } = lib;
const R = () => `http://${lib.ROUTER}`;

(async () => {
    await startGecko();
    const s = await newSession();
    await login(s);
    await nav(s, `${R()}/cgi-bin/luci/`); await sleep(13000);

    const errs = await exec(s, `return (function(){
        var e = window.__errs || [];
        return JSON.stringify(e.slice(0, 5));
    })()`);
    console.log('[js-errors] ' + errs);

    const wp = await exec(s, `return (function(){
        var el = document.getElementById('desktop-wallpaper');
        if (!el) return JSON.stringify({missing: true});
        var bg = getComputedStyle(el).backgroundImage || '';
        return JSON.stringify({bg: bg.substring(0, 80), mode: (el.style.backgroundImage || '') !== '' ? 'url' : 'gradient-or-empty'});
    })()`);
    console.log('[wallpaper] ' + wp);

    // 访问层读写回路：setSectionLocal 写一个探针键 → getSection 读回 → 清掉
    const roundtrip = await exec(s, `return (function(){
        try {
            LuCIDesktop.setSectionLocal('wallpaper', Object.assign({}, LuCIDesktop.getSection('wallpaper'), {_probe: 1}));
            var back = LuCIDesktop.getSection('wallpaper')._probe;
            var w = LuCIDesktop.getSection('wallpaper');
            delete w._probe;
            LuCIDesktop.setSectionLocal('wallpaper', w);
            return JSON.stringify({ok: back === 1});
        } catch(e) { return JSON.stringify({err: e.message}); }
    })()`);
    console.log('[access-layer roundtrip] ' + roundtrip);

    await wdDelete(s);
    await finish(s).catch(() => {});
    console.log('===== wallpaper-smoke done =====');
})().catch(e => { console.error('FATAL: ' + e.message); process.exit(1); });

function wdDelete(s) {
    const http = require('http');
    return new Promise((res) => {
        const r = http.request({ host: '127.0.0.1', port: 4444, path: '/session/' + s, method: 'DELETE' }, x => { x.resume(); x.on('end', res); });
        r.on('error', res); r.setTimeout(5000, () => r.destroy()); r.end();
    });
}
