/* tab-sweep.js — browser sweep over EVERY menu page: are all tabs displayed?
 *
 * Source of truth: the page's OWN bar (ul.cbi-tabmenu / ul.tabs / ul.nav-tabs,
 * the same set wm.js mirrors). A page may build its bar server-side or in JS,
 * so only a browser can see it. For each page we compare the page bar with the
 * window-titlebar mirror and report:
 *   MISSING  page has a bar, mirror is empty or shorter   -> tabs not displayed
 *   EXTRA    mirror shows labels the page does not have   -> stale/wrong tabs
 *   HIDDEN   page bar is still visible in the content     -> duplicate bar
 *
 * Usage: PROBE_ROUTER=<ip> node probe/tab-sweep.js [--json /tmp/x.json]
 * Exit: 0 no anomalies, 1 anomalies, 2 probe error.
 */
'use strict';
const fs = require('fs');
const lib = require('./lib.js');
const HOST = lib.ROUTER || process.env.PROBE_ROUTER;
const args = process.argv.slice(2);
function arg(n, d) { const i = args.indexOf('--' + n); return i === -1 ? d : (args[i + 1] || ''); }
const JSON_OUT = arg('json', '');
const ONLY = arg('only', '');           /* substring filter, debugging */

if (!HOST) { console.log('[sw] no PROBE_ROUTER'); process.exit(2); }

const JS_PAGES = `return (function(){
  var req=new XMLHttpRequest(); req.open('GET','/cgi-bin/luci/admin/menu',false); req.send();
  var t=JSON.parse(req.responseText||'{}'); var out=[];
  (function walk(n,p){ var ks=Object.keys(n.children||{});
    if(!ks.length){ var a=n.action||{}; var title=String(n.title||'').trim();
      var pageish=(a.type==='view'||a.type==='cbi'||a.type==='template'||a.type==='alias')||(a.type!=='function'&&title!=='');
      if(pageish&&p.length>1) out.push('/'+p.join('/')); return; }
    for(var i=0;i<ks.length;i++) walk(n.children[ks[i]], p.concat([ks[i]])); })(t,[]);
  return out;})()`;

const JS_STATE = `return (function(){
  var out={windows:0, strip:[], hasTabs:false, pageBar:[], pageBarVisible:false, url:null};
  var ws=document.querySelectorAll('.window'); out.windows=ws.length;
  if(!ws.length) return out;
  var w=ws[0];
  out.hasTabs=String(w.className).indexOf('has-tabs')!==-1;
  var s=w.querySelector('.titlebar-tabs');
  out.clipped=[]; out.visible=0;
  if(s){ var sr=s.getBoundingClientRect(); var bs=s.querySelectorAll('button');
    for(var i=0;i<bs.length;i++){ out.strip.push((bs[i].textContent||'').trim());
      var r=bs[i].getBoundingClientRect();
      if(r.left>=sr.left-1 && r.right<=sr.right+1) out.visible++;
      else out.clipped.push((bs[i].textContent||'').trim()); } }
  var fr=w.querySelector('iframe');
  if(fr){
    try{ out.url=fr.contentWindow.location.pathname; }catch(e){}
    try{ var d=fr.contentDocument;
      var ul=d&&d.querySelector('ul.cbi-tabmenu, ul.tabs, ul.nav-tabs');
      if(ul){ var as=ul.querySelectorAll('a');
        for(var q=0;q<as.length;q++) out.pageBar.push(as[q].textContent.trim());
        var cs=d.defaultView.getComputedStyle(ul);
        out.pageBarVisible=(cs.display!=='none' && ul.getBoundingClientRect().height>4);
      }
    }catch(e){}
  }
  return out;})()`;

(async () => {
    const sid = await lib.startGecko().then(() => lib.newSession());
    try {
        await lib.login(sid);
        await lib.nav(sid, `http://${HOST}/cgi-bin/luci/`);
        await lib.sleep(2500);
        let pages = (await lib.exec(sid, JS_PAGES)) || [];
        if (ONLY) pages = pages.filter(p => p.indexOf(ONLY) !== -1);
        console.log(`[sw] pages=${pages.length}`);

        const anomalies = [];
        let withBar = 0;
        for (const p of pages) {
            await lib.nav(sid, `http://${HOST}/cgi-bin/luci${p}`);
            /* settle: wait until a window exists and the mirror had a chance */
            let st = null;
            for (let i = 0; i < 10; i++) {
                await lib.sleep(700);
                st = await lib.exec(sid, JS_STATE);
                if (st && st.windows > 0 && (st.strip.length || st.pageBar.length)) break;
            }
            if (!st || st.windows === 0) { anomalies.push({ p, kind: 'NO-WINDOW', detail: st }); continue; }
            if (st.pageBar.length) { withBar++;
                if (args.indexOf('--list') !== -1)
                    console.log(`[sw] bar ${p} n=${st.pageBar.length} ${JSON.stringify(st.pageBar)}`); }
            const strip = st.strip, bar = st.pageBar;
            const missing = bar.filter(x => strip.indexOf(x) === -1);
            const extra = strip.filter(x => bar.indexOf(x) === -1);
            if (bar.length && !strip.length) {
                anomalies.push({ p, kind: 'MISSING-ALL', bar: bar });
            } else if (missing.length) {
                anomalies.push({ p, kind: 'MISSING', missing: missing, bar: bar, strip: strip });
            } else if (extra.length) {
                anomalies.push({ p, kind: 'EXTRA', extra: extra, strip: strip, bar: bar });
            }
            if (st.pageBarVisible && strip.length) {
                anomalies.push({ p, kind: 'DUPLICATE', note: 'page bar still visible while mirror shown' });
            }
            if (bar.length && !st.hasTabs) anomalies.push({ p, kind: 'NO-HAS-TABS', bar: bar });
            if (st.clipped && st.clipped.length)
                anomalies.push({ p, kind: 'CLIPPED', clipped: st.clipped, visible: st.visible, total: st.strip.length });
        }
        console.log(`[sw] pages-with-bar=${withBar} anomalies=${anomalies.length}`);
        for (const a of anomalies) {
            console.log(`[sw] ${a.kind} ${a.p} ` + JSON.stringify({ bar: a.bar, strip: a.strip, missing: a.missing, extra: a.extra }));
        }
        if (JSON_OUT) {
            fs.writeFileSync(JSON_OUT, JSON.stringify({ at: new Date().toISOString(), pages: pages.length, withBar: withBar, anomalies: anomalies }, null, 1));
            console.log('[sw] wrote ' + JSON_OUT);
        }
        await lib.finish(sid);
        process.exit(anomalies.length ? 1 : 0);
    } catch (e) {
        console.log('[sw] FATAL ' + String(e.message).slice(0, 200));
        try { await lib.finish(sid); } catch (e2) {}
        process.exit(2);
    }
})();
