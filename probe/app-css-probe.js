'use strict';
const lib = require('./lib.js');
(async () => {
    await lib.startGecko();
    const sid = await lib.newSession();
    try {
        await lib.login(sid);
        await lib.nav(sid, 'http://' + lib.ROUTER + '/cgi-bin/luci/admin/status');
        await lib.sleep(7000);
        await lib.wd('POST', `/session/${sid}/execute/sync`, { script: `try { window.LuCIDesktop.subsystems.wm.open('/cgi-bin/luci/admin/services/passwall2/shunt_rules','pw2'); return 'ok'; } catch(e) { return 'err:'+e.message; }`, args: [] }, 15000);
        await lib.sleep(8000);
        const s = `try {
            var f = null;
            var frames = document.querySelectorAll('iframe');
            for (var i = 0; i < frames.length; i++) {
                if (frames[i].src && frames[i].src.indexOf('shunt_rules') !== -1) { f = frames[i]; break; }
            }
            if (!f) return 'no-iframe; count=' + frames.length;
            var d = f.contentDocument;
            if (!d) return 'no-doc';
            var style = d.getElementById('__desktop-app-css-passwall2');
            var row = d.querySelector('.cbi-section-table-row');
            var titles = d.querySelector('.cbi-section-table-titles');
            return JSON.stringify({
                injected: !!style,
                cssLen: style ? style.textContent.length : 0,
                rowDisplay: row ? getComputedStyle(row).display : 'no-row',
                titlesDisplay: titles ? getComputedStyle(titles).display : 'no-titles',
                width: d.documentElement.clientWidth,
                hasRules: d.querySelectorAll('.shunt_rule-wrapper').length
            });
        } catch (e) { return 'err:' + e.message; }`;
        const r = await lib.wd('POST', `/session/${sid}/execute/sync`, { script: s, args: [] }, 15000);
        console.log('check:', JSON.stringify(r.body));
    } finally { await lib.finish(sid); }
})().catch(e => { console.error('failed:', e.message); process.exit(1); });
