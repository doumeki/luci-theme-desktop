/* tab-display.js — R6/R7: is the TAB BAR displayed correctly AND completely?
 *
 * R6 (display): strip exists, count matches menu, mirror==iframe, active moves,
 *     click navigates, no-tab pages stay bar-less.
 * R7 (completeness, q970): every tab button's rect must sit INSIDE the strip's
 *     visible box; the active tab must be visible; and if the strip overflows it
 *     must be scrollable (overflow-x auto/scroll) so hidden tabs are reachable.
 *     Measured at several viewport widths, because clipping only shows up narrow.
 *
 * Usage:
 *   PROBE_ROUTER=192.0.2.1 node probe/tab-display.js --app admin/system/admin
 *   ... --widths 1600,1024,800   (default)
 * Exit: 0 pass, 1 violation, 2 probe error.
 */
'use strict';

const fs = require('fs');
const lib = require('./lib.js');

const args = process.argv.slice(2);
function arg(n, d) { const i = args.indexOf('--' + n); return i === -1 ? d : (args[i + 1] || ''); }
const APP = arg('app', 'admin/system/admin').replace(/^\/+/, '');
const JSON_OUT = arg('json', '');
const SHOTS = arg('shots', '');
const WIDTHS = (arg('widths', '1600,1024,800')).split(',').map(x => parseInt(x, 10)).filter(Boolean);
const HOST = lib.ROUTER || process.env.PROBE_ROUTER;

if (!HOST) { console.log('[td] no PROBE_ROUTER'); process.exit(2); }

const JS_MENU_COUNT = `return (function(){
  var req=new XMLHttpRequest(); req.open('GET','/cgi-bin/luci/admin/menu',false); req.send();
  if(req.status!==200) return -1;
  var t=JSON.parse(req.responseText||'{}'); var segs=${JSON.stringify(APP)}.split('/'); var n=t;
  for(var i=0;i<segs.length;i++){ if(!n.children||!n.children[segs[i]]) return -2; n=n.children[segs[i]]; }
  var c=0; for(var k in (n.children||{})){ var ch=n.children[k]; if(ch.satisfied!==false && ch.title && ch.title!=='') c++; }
  return c;
})()`;

/* NOTE: template literals eat \b and \/ — avoid regexes inside injected JS. */
const JS_STATE = `return (function(){
  var out={count:0, hasTabs:false, stripCount:0, stripVisible:false, labels:[], activeLabel:null,
           titleDisplay:null, iframe:null, iframeTabs:[], iframeActive:null,
           strip:{}, buttons:[], fullyVisible:0, clipped:[]};
  var ws=document.querySelectorAll('.window');
  out.count=ws.length;
  if(!ws.length) return out;
  var w=ws[0];
  out.hasTabs=String(w.className).indexOf('has-tabs')!==-1;
  var strip=w.querySelector('.titlebar-tabs');
  if(strip){
    var sr=strip.getBoundingClientRect();
    var bs=strip.querySelectorAll('button');
    out.stripCount=bs.length;
    out.stripVisible=sr.height>4;
    out.strip={left:Math.round(sr.left), right:Math.round(sr.right), width:Math.round(sr.width),
               clientW:strip.clientWidth, scrollW:strip.scrollWidth, scrollLeft:strip.scrollLeft,
               overflowX:getComputedStyle(strip).overflowX};
    for(var i=0;i<bs.length;i++){
      var r=bs[i].getBoundingClientRect();
      var lab=(bs[i].textContent||'').trim();
      var inside=(r.left>=sr.left-1 && r.right<=sr.right+1);
      out.labels.push(lab);
      out.buttons.push({t:lab, left:Math.round(r.left), right:Math.round(r.right), w:Math.round(r.width), inside:inside});
      if(inside) out.fullyVisible++; else out.clipped.push(lab);
      if(String(bs[i].className).indexOf('tb-active')!==-1) out.activeLabel=lab;
    }
  }
  var title=w.querySelector('.window-title');
  out.titleDisplay=title?getComputedStyle(title).display:'no-title';
  var fr=w.querySelector('iframe');
  out.iframe=fr?String((function(){ try { return fr.contentWindow.location.href; } catch(e){ return fr.src; } })()):null;
  if(fr){
    try{
      var d=fr.contentDocument;
      /* same selector set as wm.js eraTabSel: a page may carry its tab bar as
       * ul.cbi-tabmenu / ul.nav-tabs, not only ul.tabs. Reading only ul.tabs
       * produced false "mirror != page" alarms (q970). */
      var ul=d&&d.querySelector('ul.cbi-tabmenu, ul.tabs, ul.nav-tabs');
      if(ul){
        var as=ul.querySelectorAll('a'); var L=[];
        for(var q=0;q<as.length;q++) L.push(as[q].textContent.trim());
        out.iframeTabs=L;
        var act=ul.querySelector('li.active a, li.cbi-tab a, a.active, a.selected');
        out.iframeActive=act?act.textContent.trim():null;
      }
    }catch(e){}
  }
  return out;
})()`;

const JS_CLICK_MIRROR = (idx) => `return (function(){
  var w=document.querySelector('.window'); if(!w) return 'no-window';
  var strip=w.querySelector('.titlebar-tabs'); if(!strip) return 'no-strip';
  var bs=strip.querySelectorAll('button'); if(!bs[${idx}]) return 'no-item';
  var lab=(bs[${idx}].textContent||'').trim(); bs[${idx}].click(); return lab;
})()`;

function shot(sid, name) {
    if (!SHOTS) return Promise.resolve();
    fs.mkdirSync(SHOTS, { recursive: true });
    return lib.wd('GET', `/session/${sid}/screenshot`).then(r => {
        fs.writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(JSON.parse(r.body).value, 'base64'));
    }).catch(() => {});
}

const results = [];
let pass = 0, fail = 0;
function rec(name, ok, detail) {
    results.push({ check: name, ok: ok, detail: detail });
    if (ok) { pass++; console.log(`[td] PASS ${name} ${detail || ''}`.trim()); }
    else { fail++; console.log(`[td] FAIL ${name} ${detail || ''}`.trim()); }
}

async function settle(sid, want, tries) {
    let st = null;
    for (let i = 0; i < (tries || 12); i++) {
        st = await lib.exec(sid, JS_STATE);
        const ok = want ? (st.stripCount > 1 && st.titleDisplay === 'none') : (st.stripCount === 0);
        if (ok) return st;
        await lib.sleep(600);
    }
    return st;
}

/* R7: all tabs inside the strip box, active visible, overflow scrollable. */
function checkCompleteness(st, width, menuCount) {
    const clip = st.clipped || [];
    rec(`r7-all-visible@${width}`, st.stripCount === menuCount && clip.length === 0,
        `visible=${st.fullyVisible}/${st.stripCount} clipped=${JSON.stringify(clip.slice(0, 6))}`);
    const act = (st.buttons || []).find(b => b.t === st.activeLabel);
    rec(`r7-active-visible@${width}`, !!(act && act.inside),
        `active=${JSON.stringify(st.activeLabel)} inside=${act ? act.inside : 'n/a'}`);
    const overflowing = st.strip && st.strip.scrollW > st.strip.clientW + 2;
    if (overflowing) {
        rec(`r7-overflow-scrollable@${width}`, /auto|scroll/.test(String(st.strip.overflowX)),
            `scrollW=${st.strip.scrollW} clientW=${st.strip.clientW} overflowX=${st.strip.overflowX}`);
    } else {
        rec(`r7-overflow-scrollable@${width}`, true, `no overflow (scrollW=${st.strip.scrollW} clientW=${st.strip.clientW})`);
    }
}

(async () => {
    const sid = await lib.startGecko().then(() => lib.newSession());
    try {
        await lib.login(sid);
        await lib.nav(sid, `http://${HOST}/cgi-bin/luci/`);
        await lib.sleep(2500);
        const menuCount = await lib.exec(sid, JS_MENU_COUNT);
        /* menuCount<=1 can be legitimate: some firmwares (24.10) build the bar
         * client-side and the menu has no titled children. The strip/bar
         * comparison below then uses the page bar as the expected set. */
        rec('menu-declares-tabs', menuCount !== -1 && menuCount !== -2,
            `menuCount=${menuCount}${menuCount <= 1 ? ' (client-side bar expected)' : ''}`);

        /* open through the start menu when possible, else deep link */
        await lib.exec(sid, "return (function(){var b=document.querySelector('#btn-start');if(b)b.click();return 'ok';})()");
        await lib.sleep(1000);
        const viaMenu = await lib.exec(sid, `return (function(){
          var items=document.querySelectorAll('.menu-item');
          for(var i=0;i<items.length;i++){var t=(items[i].textContent||'').trim().toLowerCase();
            var app=${JSON.stringify(APP)}.toLowerCase();
            var leaf=app.split('/').pop();
            if(t && (app.indexOf(t.replace(/\\s+/g,''))!==-1 || t.indexOf(leaf)!==-1)){ items[i].click(); return t; }}
          return 'no-menu-item';})()`);
        if (viaMenu === 'no-menu-item') {
            await lib.exec(sid, `return (function(){try{WM.open('/cgi-bin/luci/${APP}','tabs');return 1}catch(e){return 0}})()`);
        }
        await lib.sleep(5000);

        let st = await settle(sid, true);
        /* pages may build their bar client-side (24.10 System/DHCP): the menu
         * has no titled children, so the page bar is the expected set. */
        const expectN = menuCount > 1 ? menuCount : (st.iframeTabs || []).length;
        rec('strip-present', st.stripCount === expectN && st.stripVisible && st.titleDisplay === 'none',
            `via=${viaMenu} strip=${st.stripCount}/${expectN} visible=${st.stripVisible} title=${st.titleDisplay} hasTabs=${st.hasTabs}`);
        rec('mirror-matches-iframe', JSON.stringify(st.labels) === JSON.stringify(st.iframeTabs),
            `mirror=${JSON.stringify(st.labels.slice(0, 3))}... iframe=${JSON.stringify(st.iframeTabs.slice(0, 3))}...`);
        rec('active-matches', !!st.activeLabel && st.activeLabel === st.iframeActive,
            `mirror=${JSON.stringify(st.activeLabel)} iframe=${JSON.stringify(st.iframeActive)}`);
        await shot(sid, `r6-open-${WIDTHS[0]}`);

        /* R7 across widths */
        let currentW = WIDTHS[0];
        for (const wpx of WIDTHS) {
            if (wpx !== currentW) {
                const h = Math.max(600, Math.round(wpx * 9 / 16));
                await lib.wd('POST', `/session/${sid}/window/rect`, { width: wpx, height: h }, 10000);
                await lib.sleep(1500);
                currentW = wpx;
            }
            st = await settle(sid, true, 6);
            checkCompleteness(st, wpx, menuCount > 1 ? menuCount : (st.iframeTabs || []).length);
            if (wpx !== WIDTHS[0]) await shot(sid, `r7-${wpx}`);
        }

        /* click the 2nd tab through the mirror, then re-check completeness */
        const before = st.iframe;
        const clicked = await lib.exec(sid, JS_CLICK_MIRROR(1));
        for (let i = 0; i < 20; i++) {
            st = await lib.exec(sid, JS_STATE);
            if (st.iframe && st.iframe !== before) break;
            await lib.sleep(600);
        }
        const urlMoved = !!st.iframe && st.iframe !== before;
        const switched = st.activeLabel === clicked;
        rec('mirror-click-works', urlMoved || switched,
            `clicked=${clicked} urlMoved=${urlMoved} switchedInPlace=${switched} url=${String(st.iframe || '').replace(/^https?:\/\/[^/]+/, '')}`);
        st = await settle(sid, true);
        rec('mirror-click-keeps-strip', st.stripCount === (menuCount > 1 ? menuCount : (st.iframeTabs || []).length) && st.stripVisible, `strip=${st.stripCount}/${menuCount > 1 ? menuCount : (st.iframeTabs || []).length}`);
        rec('mirror-click-active-follows', st.activeLabel === clicked, `active=${JSON.stringify(st.activeLabel)} clicked=${JSON.stringify(clicked)}`);
        checkCompleteness(st, 'after-click', menuCount > 1 ? menuCount : (st.iframeTabs || []).length);
        await shot(sid, 'r6-after-click');

        /* no-tab control */
        await lib.nav(sid, `http://${HOST}/cgi-bin/luci/admin/status/overview`);
        await lib.sleep(3500);
        st = await settle(sid, false, 8);
        rec('no-tab-page-shows-title', st.stripCount === 0 && st.titleDisplay !== 'none',
            `strip=${st.stripCount} title=${st.titleDisplay}`);

        await lib.finish(sid);
        console.log(`[td] summary pass=${pass} fail=${fail}`);
        if (JSON_OUT) {
            fs.writeFileSync(JSON_OUT, JSON.stringify({ at: new Date().toISOString(), app: APP, menuCount: menuCount, results: results }, null, 1));
            console.log('[td] wrote ' + JSON_OUT);
        }
        process.exit(fail ? 1 : 0);
    } catch (e) {
        console.log('[td] FATAL ' + String(e.message).slice(0, 200));
        try { await lib.finish(sid); } catch (e2) {}
        process.exit(2);
    }
})();
