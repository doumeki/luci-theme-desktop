/* Business probe: luci 26 poll-status indicator (top-right "刷新") must be
 * hidden. Asserts theme before measuring so a wrong theme fails loudly.
 * Usage: node probe/poll-status.js [argon|desktop]   (default: desktop) */
'use strict';
const lib = require('./lib.js');
const { sleep, exec, nav, startGecko, newSession, login, assertTheme, finish } = lib;

const WANT = process.argv[2] || 'desktop';
const URL = '/admin/services/smartdns?embed=1';

(async () => {
    await startGecko();
    const sid = await newSession();
    await login(sid);
    await nav(sid, `http://${lib.ROUTER}/cgi-bin/luci${URL}`);
    await sleep(22000);
    await assertTheme(sid, WANT);
    const out = await exec(sid, `return (function(){
        var d=document, w=window, r=[];
        var span=d.querySelector('#indicators [data-indicator="poll-status"]');
        if(!span){ r.push('poll-status span: NOT IN DOM'); }
        else {
            var cs=w.getComputedStyle(span);
            var rect=span.getBoundingClientRect();
            r.push('poll-status span: disp='+cs.display+' rect='+Math.round(rect.width)+'x'+Math.round(rect.height));
        }
        var ind=d.getElementById('indicators');
        if(ind){ var cs=w.getComputedStyle(ind);
            r.push('indicators: disp='+cs.display+' rect='+Math.round(ind.getBoundingClientRect().width)+'x'+Math.round(ind.getBoundingClientRect().height));
        }
        return r.join(' | ');
    })()`);
    console.log(out);
    await finish(sid);
})().catch(e => { console.error('FATAL: ' + e.message); process.exit(1); });
