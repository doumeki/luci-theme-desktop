/* Business probe: net-traffic widget renders real rates (not "--") in the
 * desktop shell, fed by /admin/desktop/bandwidth. Reads the widget text
 * after enough update ticks for a rate to appear.
 * Usage: node probe/net-traffic.js [argon|desktop]  (default: desktop) */
'use strict';
const lib = require('./lib.js');
const { sleep, exec, nav, startGecko, newSession, login, assertTheme, finish } = lib;

const WANT = process.argv[2] || 'desktop';

(async () => {
    await startGecko();
    const sid = await newSession();
    await login(sid);
    await nav(sid, `http://${lib.ROUTER}/cgi-bin/luci/`);
    await sleep(12000);   // shell boot + widget init + >=2 update ticks
    await assertTheme(sid, WANT);
    const out = await exec(sid, `return (function(){
        var d=document, w=window, r=[];
        var cards=d.querySelectorAll('.widget-card');
        r.push('widget-cards: '+(cards.length?cards.length:'NONE'));
        var wd=d.querySelector('[data-mode="traffic"]') || d.querySelector('.nt-rx');
        if(!wd){ r.push('net-traffic widget: NOT FOUND'); return r.join(' | '); }
        var rx=wd.querySelector('.nt-rx'), tx=wd.querySelector('.nt-tx'), iface=wd.querySelector('.nt-iface');
        r.push('iface="'+(iface?iface.textContent:'?')+'" rx="'+(rx?rx.textContent:'?')+'" tx="'+(tx?tx.textContent:'?')+'"');
        // also verify the widget's fetch target resolves (in-page XHR test)
        r.push('bw-endpoint: '+(w.__ntTest||'not captured'));
        return r.join(' | ');
    })()`);
    console.log(out);
    await finish(sid);
})().catch(e => { console.error('FATAL: ' + e.message); process.exit(1); });
