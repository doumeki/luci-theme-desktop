/* compat-hot.js — L4 hot pack: the ~10 deep interaction flows that generic
 * wide-scan detectors cannot assert. Built from the case drivers:
 *   H2/H2b/H9  <- q602-repro.js (poll shape, wan4 fill, hidden copy, narrow)
 *   H3         <- q652b.js C1  (changes full flow in the real WM window)
 *   H4         <- q656.js  E   (session expiry UX: text + lock + shell toast)
 *   H5         <- q656.js  D   (stock banner Dismiss fades)
 * Expectations adapt to the firmware/era: e.g. H2b hidden-copy fill depends on
 * desktop.settings.tab_era (legacy -> filled; unset -> stubbed by design),
 * and stock features a firmware lacks are recorded as skip-reason, not fail.
 *
 * Usage: node probe/compat-hot.js --label vm2512
 *        PROBE_ROUTER=<ip> PROBE_SSH=<ip> node probe/compat-hot.js --label 1.1
 * Output: /tmp/compat-hot/<label>/report.json + shots/ + log.txt (masked).
 */
'use strict';
const fs = require('fs');
const { execFileSync } = require('child_process');
const lib = require('./lib.js');
const { sleep, exec, nav, startGecko, newSession, login, finish } = lib;

const BASE = () => 'http://' + lib.ROUTER;
const SSH_HOST = process.env.PROBE_SSH || lib.SSH_HOST || lib.ROUTER;
/* PROBE_SSH_KEY_FORCE wins even when empty — lets an empty-password box run
 * without -i (lib falls back to SSH_KEY_2 otherwise, wrong for 1.1). */
const SSH_KEY = ('PROBE_SSH_KEY_FORCE' in process.env) ? process.env.PROBE_SSH_KEY_FORCE : lib.SSH_KEY;
let LOG = '';
function mask(s) {
    return String(s)
        .replace(/github_pat_\S+/g, '<masked>')
        .replace(/\b[0-9a-f]{40}\b/g, '<masked-token>')
        .replace(/([0-9]{1,3}\.){3}[0-9]{1,3}/g, '<masked-ip>');
}
function say(s) { const line = mask(s); LOG += line + '\n'; console.log(line); }
function ssh(cmdStr) {
    const full = (SSH_KEY ? ['-i', SSH_KEY] : []).concat(
        ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', 'root@' + SSH_HOST, cmdStr]);
    try { return execFileSync('ssh', full, { encoding: 'utf8', timeout: 20000 }).trim(); }
    catch (e) { return 'SSH-ERR: ' + String(e.message).split('\n')[0]; }
}
const shl = (c) => ssh(c + ' 2>/dev/null || echo __EMPTY__');

async function shot(sid, name) {
    try {
        const r = await lib.wd('GET', '/session/' + sid + '/screenshot', null, 20000);
        let b64 = null; try { b64 = JSON.parse(r.body).value; } catch (e) {}
        if (typeof b64 === 'string' && b64.length > 1000) {
            fs.writeFileSync(OUT + '/shots/' + name + '.png', Buffer.from(b64, 'base64'));
            return true;
        }
    } catch (e) {}
    return false;
}

/* ---- staging helpers (route-aware; q675-q677 route matrix) ----
 * ubus uci writes are only granted to sessions created by REAL logins
 * (q676: forged sessions are ACL-denied on BOTH tracks even with
 * acl:"unlimited" stored — the dev1 forge control was denied too).
 * So staging has two routes, picked once per run:
 *   route 'ubus' (dev1-style): the real-login session stages into its own
 *     rpcd session scope; needs the attendedsysupgrade config, which also
 *     feeds H5's stock banner on 25.x.
 *   route 'cli' (dev2-style): password box — stage through root-side CLI
 *     into /tmp/.uci; the theme's uci_changes endpoint sees it because its
 *     cursor is anonymous on this LuCI build (set_session_id absent,
 *     q676 grep=0), and the revert endpoint reverts anonymously as root.
 * Route rule: attendedsysupgrade config present -> ubus, else -> cli. */
let TOK = ''; let tokDead = false; /* set after H4 destroys the session */
let COOKIE = ''; /* cookie name the login actually set (runtime authority) */
let ROUTE = ''; let ASU = null;
/* Firmware property, independent of how we stage: the stock upgrade-check
 * config exists -> H5 has a banner source. */
function hasAsu() {
    if (ASU === null) ASU = /yes/.test(ssh('test -f /etc/config/attendedsysupgrade && echo yes || echo no'));
    return ASU;
}
function ubusCall(method, obj) { return ssh("ubus call uci " + method + " '" + JSON.stringify(obj) + "'"); }
function httpJson(path) {
    try {
        const args = ['-s', '-m', '8'];
        if (COOKIE) args.push('-H', 'Cookie: ' + COOKIE + '=' + TOK);
        args.push('http://' + lib.ROUTER + path);
        return JSON.parse(execFileSync('curl', args, { encoding: 'utf8' }));
    } catch (e) { return null; }
}
/* Route matrix (q687 — ImmortalWrt 25.12-SNAPSHOT / LuCI 26.203):
 *   'ubus'      attendedsysupgrade present: stage the upgrade-check option in
 *               the real login session (dev1 shape; also feeds H5's banner).
 *   'ubus-sess' no ASU, but the build has uci:set_session_id() (dispatcher.lua
 *               calls it), so the theme's endpoint reads the SESSION-scoped
 *               delta. A root-CLI write lives in a different scope and the
 *               changes page then correctly closes itself ("nothing
 *               pending") — the iframe context disappears mid-probe. Stage
 *               add+set with the session token instead.
 *   'cli'       password box (dev2): no real login token; the root CLI delta
 *               is the scope the endpoint reads on builds without
 *               set_session_id.
 * ubus-sess is self-verifying: stage a probe entry, then require the theme
 * endpoint (with this session cookie) to show the key. If it does not, fall
 * back to cli — no gate softening, the precondition check stays as-is. */
function ubusSessStagingWorks() {
    if (!TOK) return false;
    const add = ubusCall('add', { ubus_rpc_session: TOK, config: 'system', type: 'h3probe' });
    const m = String(add).match(/"section"\s*:\s*"([^"]+)"/);
    if (!m) return false;
    ubusCall('set', { ubus_rpc_session: TOK, config: 'system', section: m[1], values: { h3probe: '1' } });
    const j = httpJson('/cgi-bin/luci/admin/desktop/uci_changes');
    const ok = !!(j && j.count >= 1 && JSON.stringify(j.list || '').indexOf('h3probe') !== -1);
    ubusCall('revert', { ubus_rpc_session: TOK, config: 'system' });
    return ok;
}
function routeState() {
    if (ROUTE) return ROUTE;
    if (hasAsu()) ROUTE = 'ubus';
    else if (ubusSessStagingWorks()) ROUTE = 'ubus-sess';
    else ROUTE = 'cli';
    return ROUTE;
}
function stageKey() { return routeState() === 'ubus' ? 'login_check_for_upgrades' : 'h3probe'; }
function stageChange() {
    const r = routeState();
    if (r === 'ubus') {
        const j = '{"ubus_rpc_session":"' + TOK + '","config":"attendedsysupgrade","type":"client","name":"client","values":{"login_check_for_upgrades":"1"}}';
        return ssh("ubus call uci set '" + j + "'");
    }
    if (r === 'ubus-sess') {
        const add = ubusCall('add', { ubus_rpc_session: TOK, config: 'system', type: 'h3probe' });
        const m = String(add).match(/"section"\s*:\s*"([^"]+)"/);
        if (!m) return add;
        const st = ubusCall('set', { ubus_rpc_session: TOK, config: 'system', section: m[1], values: { h3probe: '1' } });
        return String(add) + ' ' + String(st) + ' ' + deltaView();
    }
    return ssh('uci set system.h3probe=probe_h3 2>&1; uci set system.h3probe.x=1 2>&1; uci changes system 2>&1');
}
function revertDelta() {
    const r = routeState();
    if (r === 'ubus') {
        const j = '{"ubus_rpc_session":"' + TOK + '","config":"attendedsysupgrade"}';
        return ssh("ubus call uci revert '" + j + "'");
    }
    if (r === 'ubus-sess') return ubusCall('revert', { ubus_rpc_session: TOK, config: 'system' });
    return ssh('uci -q revert system 2>&1; uci -q changes system 2>&1; echo cli-revert-done');
}
function deltaView() {
    const r = routeState();
    if (r === 'ubus' || r === 'ubus-sess') return ubusCall('changes', { ubus_rpc_session: TOK });
    return ssh('uci -q changes 2>&1');
}
function killSession() {
    const j = '{"ubus_rpc_session":"' + TOK + '"}';
    try { return ssh("ubus call session destroy '" + j + "'"); }
    catch (e) { return 'destroy-failed'; }
}

/* ---- page-side scripts (brace-balanced, proven in q602/q652b/q656) ---- */
const JS_INSTALL = "return (function(){if(window.__scanInstalled){return 'already('+document.readyState+')';}window.__scanInstalled=true;window.__scanErr=[];window.__scanReq=[];window.addEventListener('error',function(e){var u=String((e&&e.filename)||'').replace(/^https?:\\/\\/[^/]+/,'');window.__scanErr.push((u?u+':'+String((e&&e.lineno)||0)+' | ':'')+String((e&&e.message)||(e&&e.type)||'error').slice(0,120));});window.addEventListener('unhandledrejection',function(e){window.__scanErr.push('promise: '+String((e&&e.reason)||'').slice(0,140));});var xo=XMLHttpRequest.prototype.open;var xs=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.open=function(m,u){this.__m=m;this.__u=u;return xo.apply(this,arguments);};XMLHttpRequest.prototype.send=function(){var x=this;var t0=Date.now();x.addEventListener('load',function(){try{window.__scanReq.push({m:x.__m,u:String(x.__u||'').slice(0,140),s:x.status,ms:Date.now()-t0});}catch(e){}});x.addEventListener('error',function(){window.__scanReq.push({m:x.__m,u:String(x.__u||''),s:0,ms:Date.now()-t0});});return xs.apply(this,arguments);};return 'installed('+document.readyState+')';})()";
const JS_WAN = "return (function(){var d=document,w=window,r={};var wi=d.getElementById('wan4_i'),ws=d.getElementById('wan4_s'),w6=d.getElementById('wan6_i');r.wan4_i=wi?String(wi.innerHTML).slice(0,60):'ABSENT';r.wan4_s=ws?String(ws.innerHTML).slice(0,60):'ABSENT';r.wan6_i=w6?String(w6.innerHTML).slice(0,40):'ABSENT';r.xhr=w.XHR?('poll='+String(w.XHR.poll).slice(0,40)+' _q='+(w.XHR._q?w.XHR._q.length:'none')+' _i='+(w.XHR._i?'active':'none')):'ABSENT';var req=window.__scanReq||[];var cnt={};for(var k=0;k<req.length;k++){var key=String(req[k].u).replace(/[?#].*$/,'');cnt[key]=(cnt[key]||0)+1;}var poll=false;for(var u in cnt){if(cnt[u]>=2){poll=true;break;}}r.pollAlive=poll;r.reqN=req.length;var main=d.querySelector('#maincontent,.container,main');r.mainText=main?String(main.textContent||'').replace(/\\s+/g,' ').trim().length:-1;var errs=window.__scanErr||[];r.jsErr=errs.length;r.errHead=errs.slice(0,3).join(' | ');r.errs=errs.slice(0,8);return r;})()";
/* Resource-timing snapshot (q687): counts every request the page made since
 * load (XHR, fetch and navigations alike), independent of when the scan shim
 * got injected. The H2 assertion keeps its semantic (the embedded stock page
 * keeps polling) but no longer depends on the shim winning a race against a
 * late page load — ImmortalWrt's overview polls /ubus/ over POST, which the
 * old XHR-only counter missed whenever the install landed on the old
 * document. */
const JS_RES_SNAP = "return (function(){var e=performance.getEntriesByType('resource')||[];var m={};for(var i=0;i<e.length;i++){var k=String(e[i].name).replace(/^https?:\\/\\/[^/]+/,'').replace(/[?#].*$/,'');m[k]=(m[k]||0)+1;}return m;})()";
const JS_BANNER = "return (function(){var ms=document.querySelectorAll('.alert-message');for(var i=0;i<ms.length;i++){if(/New Firmware Available/i.test(ms[i].textContent))return {found:true};}return {found:false};})()";
const JS_BANNER_GONE = "return (function(){var ms=document.querySelectorAll('.alert-message');for(var i=0;i<ms.length;i++){if(/New Firmware Available/i.test(ms[i].textContent))return false;}return true;})()";
const JS_CLICK_DISMISS = "return (function(){var ms=document.querySelectorAll('.alert-message');for(var i=0;i<ms.length;i++){if(/New Firmware Available/i.test(ms[i].textContent)){var bs=ms[i].querySelectorAll('button');for(var j=0;j<bs.length;j++){if(/Dismiss/i.test(bs[j].textContent)){bs[j].click();return 'dismiss-clicked';}}}}return 'no-banner-or-button';})()";
const JS_IREVERT = "return (function(){var b=document.getElementById('revert');if(!b)return 'NO-REVERT-BTN';b.click();return 'clicked';})()";
const JS_ISTATUS = "return String((document.getElementById('status')||{}).textContent||'')";
const JS_UGPROBE = "return (function(){var x=new XMLHttpRequest();x.open('GET','/cgi-bin/luci/admin/desktop/uci_changes',false);x.send();return {status:x.status,head:String(x.responseText||'').replace(/\\s+/g,' ').slice(0,4096)};})()";
const JS_ARB = "return (function(){var x=new XMLHttpRequest();x.open('GET','/cgi-bin/luci/admin/status/overview?embed=1&_q='+Math.random(),false);x.send();return {status:x.status,loginPage:String(x.responseText||'').indexOf('luci_username')>=0};})()";
const JS_FRAMES = (p) => "return (function(){var fs=document.querySelectorAll('iframe');var out=null;for(var i=0;i<fs.length;i++){var s=String(fs[i].src||'');if(s.indexOf('/" + p + "')!==-1){out={idx:i,src:s.replace(/^https?:\\/\\/[^/]+/,'')};break;}}return out;})()";
const JS_FRAMES_ALL = "return (function(){var fs=document.querySelectorAll('iframe');var out=[];for(var i=0;i<fs.length;i++){out.push({idx:i,src:String(fs[i].src||'').replace(/^https?:\\/\\/[^/]+/,'').slice(0,140)});}return out;})()";
const JS_NOTFOUND = "return (function(){var t=String(document.title||'');var b=String((document.body&&document.body.textContent)||'').slice(0,400);return {t404:/\\b404\\b|not found/i.test(t),disp:/No page (is )?registered/i.test(b)};})()";
const JS_WM_OPEN = (p) => "return (function(){try{WM.open('/cgi-bin/luci/" + p + "','hot');return 'wm-open-ok';}catch(e){return 'wm-open-fail:'+String(e&&e.message||e);}})()";
const JS_TOAST = "return (function(){var t=document.querySelector('.desktop-toast[data-key=\"auth-expired\"]');return t?{present:true,text:String(t.textContent).replace(/\\s+/g,' ').slice(0,100)}:{present:false};})()";
const JS_BTN_LOCKED = "return (function(){var a=document.getElementById('apply'),b=document.getElementById('revert');return {apply:a?!!a.disabled:'absent',revert:b?!!b.disabled:'absent'};})()";
const JS_LOGINCHECK = "return !!document.querySelector('input[name=\"luci_username\"]')";

async function top(sid) { const r = await lib.wd('POST', '/session/' + sid + '/frame', { id: null }, 10000); return r.status; }
async function findFrame(sid, p) { return exec(sid, JS_FRAMES(p)); }
/* slow Lua boxes render window iframes late (q673 dev2: 2.5s was not enough
 * for the changes window while H6/H7 found theirs at 3.5/4s) */
async function findFrameWait(sid, p, maxMs) {
    const t0 = Date.now();
    for (;;) {
        const fr = await findFrame(sid, p);
        if (fr) return fr;
        if (Date.now() - t0 >= maxMs) return null;
        await sleep(600);
    }
}
/* Enter the WM iframe for `p` with a readiness ping. Frame indices can be
 * invalidated between lookup and switch when the app page re-renders (and a
 * page that closes itself takes its context with it — q687). Re-resolve on a
 * dead context; a genuinely missing frame still returns null for the caller
 * to fail. */
async function enterFrame(sid, p, maxMs) {
    for (let i = 0; i < 3; i++) {
        const fr = await findFrameWait(sid, p, maxMs);
        if (!fr) return null;
        await lib.wd('POST', '/session/' + sid + '/frame', { id: fr.idx }, 10000);
        await sleep(400);
        const ping = await exec(sid, 'return String(document.readyState);');
        if (ping === 'interactive' || ping === 'complete' || ping === 'loading') return fr;
        await top(sid);
        await sleep(500);
    }
    return null;
}
/* In-frame read with the same re-resolve; returns { fr, v } or { fr:null } */
async function inFrameExec(sid, p, js) {
    for (let i = 0; i < 2; i++) {
        const fr = await enterFrame(sid, p, 8000);
        if (!fr) return { fr: null, v: null };
        const v = await exec(sid, js);
        if (JSON.stringify(v).indexOf('no such window') === -1) return { fr, v };
        await top(sid);
        await sleep(500);
    }
    return { fr: null, v: null };
}
/* the changes page renders its buttons late on slow boxes — poll for it */
async function clickRevertWait(sid) {
    for (let i = 0; i < 8; i++) {
        const c = await exec(sid, JS_IREVERT);
        if (c !== 'NO-REVERT-BTN') return String(c);
        await sleep(1000);
    }
    return 'NO-REVERT-BTN';
}
/* enter a WM window iframe, probe content + dispatcher-miss markers */
async function probeWindowPage(sid, frIdx, settleMs) {
    await lib.wd('POST', '/session/' + sid + '/frame', { id: frIdx }, 10000);
    await sleep(settleMs);
    const d = await exec(sid, JS_WAN);
    const nf = await exec(sid, JS_NOTFOUND);
    await top(sid);
    return { d: d, nfObj: nf, nf: !!(nf && (nf.t404 || nf.disp)) };
}

/* check result helper — normalizes 'fail: reason' into status=fail so the
 * summary counts every failure (q668: H2b/H6/H7 fell out of the counters). */
const R = []; let OUT = '/tmp/compat-hot/run';
function rec(id, status, detail) {
    let st = String(status || ''); let det = String(detail || '');
    if (st.indexOf('fail') === 0 && st !== 'fail') { det = st.slice(5).trim() + (det ? ' | ' + det : ''); st = 'fail'; }
    const r = { id, status: st, detail: det.slice(0, 800) };
    R.push(r); say('[hot] ' + id + ' -> ' + st + (det ? ' : ' + det : '')); return r;
}

(async function main() {
    const argv = process.argv.slice(2);
    function argOf(name, dflt) { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; }
    const label = String(argOf('--label', 'run')).replace(/([0-9]{1,3}\.){3}[0-9]{1,3}/g, 'host').replace(/[^A-Za-z0-9_-]/g, '') || 'run';
    OUT = '/tmp/compat-hot/' + label;
    fs.mkdirSync(OUT + '/shots', { recursive: true });
    const t0 = Date.now();
    say('== compat-hot L4 @ label=' + label + ' ==');

    let sid = null; let era = '';
    try {
        await startGecko();
        sid = await newSession();
        const auth = await login(sid);
        TOK = (auth && auth.value) || '';
        COOKIE = (auth && auth.name) || '';
        say('[lib] login cookie=' + (auth && auth.name) + ' tok=' + (TOK ? TOK.slice(0, 6) + '…' : 'NONE'));
        era = shl('uci -q get desktop.settings.tab_era');
        say('[lib] tab_era=' + (era === '__EMPTY__' ? '(unset=modern)' : era));

        /* H1: login -> shell boot -> theme assertion */
        await nav(sid, BASE() + '/cgi-bin/luci/admin/status/overview');
        await sleep(4000);
        let h1 = 'pass';
        try { await lib.assertTheme(sid, 'desktop'); } catch (e) { h1 = 'fail: ' + e.message; }
        rec('H1-login-shell-theme', h1);

        /* H2: overview embed — poll alive + interface block fills (adaptive) */
        await nav(sid, BASE() + '/cgi-bin/luci/admin/status/overview?embed=1');
        await sleep(3000);
        const res0 = await exec(sid, JS_RES_SNAP);
        await exec(sid, JS_INSTALL);
        await sleep(12000);
        const res1 = await exec(sid, JS_RES_SNAP);
        const w = await exec(sid, JS_WAN);
        /* repeated dynamic request in the window = the page is polling. Any
         * initiator counts (XHR/fetch): the semantic is "embed stays alive",
         * not "it uses XMLHttpRequest". Static assets are excluded — a cache
         * revalidation is not a poll. */
        const perfN = (o) => (o && typeof o === 'object') ? Object.keys(o).length : -1;
        let perfPoll = 0;
        if (res0 && res1 && typeof res0 === 'object' && typeof res1 === 'object') {
            for (const k in res1) {
                if (k.indexOf('/luci-static/') === 0) continue;
                const d = (res1[k] || 0) - (res0[k] || 0);
                if (d >= 2) { perfPoll = d; break; }
            }
        }
        let h2 = 'pass'; const h2why = [];
        if (!w) { h2 = 'fail'; h2why.push('no probe result'); }
        else {
            if (!w.pollAlive && !perfPoll) { h2 = 'fail'; h2why.push('poll-dead'); }
            if (w.mainText < 50) { h2 = 'fail'; h2why.push('mainBlank=' + w.mainText); }
            /* jserr attribution: only errors originating from theme files fail
             * the flow — stock/vendor plugin scripts are device-side. Every
             * error is recorded as src:line | message for review (q673:
             * message-only capture left the SyntaxError x3 unattributable). */
            const errs = (w && w.errs) || [];
            const themeErr = errs.filter(x => /luci-static\/desktop/.test(x));
            const otherErr = errs.filter(x => !/luci-static\/desktop/.test(x));
            if (themeErr.length) { h2 = 'fail'; h2why.push('THEME jserr x' + themeErr.length + ': ' + themeErr[0]); }
            else if (otherErr.length) h2why.push('NOTE device-side jserr x' + otherErr.length + ': ' + otherErr[0]);
            /* old ids are stock-page-shape dependent (19.07 vendor forks and
             * 25.12+ differ) — record, never fail */
            if (w.wan4_s === 'ABSENT') h2why.push('old ids absent (stock overview shape differs)');
            else h2why.push('wan4_s=' + String(w.wan4_s).slice(0, 30));
        }
        rec('H2-overview-embed-poll-fill', h2, (w ? 'reqN=' + w.reqN + ' perfPoll=' + perfPoll + ' perf0=' + perfN(res0) + '/perf1=' + perfN(res1) + ' mainText=' + w.mainText + ' | ' + h2why.join(' ') : ''));
        await shot(sid, 'H2-overview-embed');

        /* H11: stock .spinning feedback (q689/q690). luci-base's
         * ui.createHandlerFn() adds .spinning to whatever element is running
         * an async action (Startup -> Restart, package installs, ...) and
         * disables it; the theme must draw the indicator from that class, or
         * the only feedback is 60% disabled opacity and a 2-3s restart looks
         * like a dead click. Contract asserted here:
         *   a) the element gets the 32px icon column, and its ::before
         *      actually carries luci-base's loading.svg (the spinner users
         *      see in argon/bootstrap — a hand-rolled CSS ring read as a
         *      flicker at 14px / 60% opacity, q690);
         *   b) view-level loading (<div class="spinning"> in #view / #maincontent) is a
         *      visible centred card instead of an invisible empty div.
         * Runs on an EMBED page: the desktop shell loads only
         * shell/window/taskbar CSS — cascade.css lives in the app pages.
         * Throwaway nodes keep it side-effect free. */
        let h11 = 'fail'; let h11d = '';
        try {
            const sp = await exec(sid, "return (function(){" +
                "var b=document.createElement('button');" +
                "b.className='btn cbi-button spinning';b.textContent='x';" +
                "b.style.cssText='position:fixed;left:-9999px;top:0';" +
                "document.body.appendChild(b);" +
                "var s=getComputedStyle(b,'::before');" +
                "var o={bg:String(s.backgroundImage||'').slice(0,120),content:s.content||''," +
                "  w:s.width||'',h:s.height||'',pad:getComputedStyle(b).paddingLeft||''};" +
                "b.parentNode.removeChild(b);" +
                "var v=document.getElementById('view')||document.getElementById('maincontent');" +
                "if(v){var c=document.createElement('div');c.className='spinning';" +
                "  c.textContent='x';c.style.cssText='left:-9999px';" +
                "  v.appendChild(c);var cs=getComputedStyle(c);" +
                "  o.cardPos=cs.position;o.cardBg=cs.backgroundColor;c.parentNode.removeChild(c);}" +
                "return o;})()");
            const okIcon = !!(sp && /loading\.svg/.test(sp.bg) && parseFloat(sp.w) > 8 && parseFloat(sp.h) > 8);
            const okPad = !!(sp && parseFloat(sp.pad) >= 30);
            const okCard = !!(sp && sp.cardPos === 'fixed');
            h11 = (okIcon && okPad && okCard) ? 'pass' : 'fail';
            h11d = 'icon=' + (/loading\.svg/.test(sp && sp.bg || '') ? 'loading.svg' : String(sp && sp.bg).slice(0, 40)) +
                   ' box=' + (sp && sp.w) + 'x' + (sp && sp.h) + ' pad=' + (sp && sp.pad) +
                   ' card=' + (sp && sp.cardPos);
        } catch (e) { h11d = 'probe error: ' + (e && e.message); }
        rec('H11-button-spinning-feedback', h11, h11d);

        /* H2b: top-level face — hidden copy fill depends on tab_era */
        await nav(sid, BASE() + '/cgi-bin/luci/admin/status/overview');
        await sleep(9000);
        const wt = await exec(sid, JS_WAN);
        let h2b; const h2bwhy = [];
        if (era === 'legacy') {
            h2b = (wt && wt.wan4_s && wt.wan4_s !== 'ABSENT' && !/获取中/.test(wt.wan4_s) && wt.wan4_s.length > 1) ? 'pass' : 'fail';
            if (h2b === 'fail') h2bwhy.push('legacy expects hidden copy filled, got ' + (wt && wt.wan4_s));
        } else {
            /* modern: stock markup drops the old ids; the user face is the app
             * iframe and the top-level copy is display:none. Assert a clean boot
             * (theme-file-origin errors only — q673 attribution rule); record
             * poll shape + background reqN (the theme stub targets XHR.poll
             * only — modern LuCI.prototype.poll is a separate mechanism;
             * dev1/dev2 both measured reqN=0 = no hidden-copy polling). */
            const tE = ((wt && wt.errs) || []).filter(x => /luci-static\/desktop/.test(x));
            const oE = ((wt && wt.errs) || []).filter(x => !/luci-static\/desktop/.test(x));
            h2b = wt && tE.length === 0 ? 'pass' : 'fail';
            if (h2b === 'fail') h2bwhy.push('THEME jserr: ' + tE[0]);
            else if (oE.length) h2bwhy.push('NOTE device-side jserr x' + oE.length + ': ' + oE[0]);
            if (wt && wt.reqN > 0) h2bwhy.push('NOTE top-face reqN=' + wt.reqN + ' (hidden copy may still poll on modern)');
            if (wt && wt.wan4_s !== 'ABSENT') h2bwhy.push('old ids present: wan4_s=' + String(wt.wan4_s).slice(0, 24));
        }
        rec('H2b-top-face-hidden-copy-era-adaptive', h2b, 'era=' + (era === '__EMPTY__' ? 'unset' : era) + ' xhr=' + String(wt && wt.xhr).slice(0, 60) + ' reqN=' + (wt && wt.reqN) + ' ' + h2bwhy.join(' '));

        /* H3: changes full flow in the real WM window (valid session).
         * Stage precondition: the flow is only meaningful with a LANDED staged
         * change — a silently failed stage would let "Reverted on empty" pass
         * spuriously (q673: forged sessions lack write ACLs -> Permission
         * denied). */
        const stg = stageChange();
        say('[ssh] stage: ' + String(stg).replace(/\s+/g, ' ').slice(0, 60));
        const dv0 = deltaView();
        if (/SSH-ERR|Permission denied|Command failed/i.test(String(stg)) || String(dv0).indexOf(stageKey()) === -1) {
            rec('H3-changes-full-flow', 'skip', 'stage precondition failed (route=' + routeState() + ', env/session not theme): ' + String(stg).replace(/\s+/g, ' ').slice(0, 90) + ' delta=' + String(dv0).replace(/\s+/g, ' ').slice(0, 40));
        } else {
            const wmo3 = await exec(sid, JS_WM_OPEN('admin/desktop/changes'));
            const h3f = await inFrameExec(sid, 'admin/desktop/changes', JS_UGPROBE);
            const probe = h3f.v;
            if (!probe) {
                rec('H3-changes-full-flow', 'fail: changes frame not found', 'wm=' + wmo3 + ' frames=' + JSON.stringify(await exec(sid, JS_FRAMES_ALL)).slice(0, 200));
                await shot(sid, 'H3-frames-missing');
            } else {
                say('[hot] H3 in-frame uci_changes: ' + JSON.stringify(probe));
                /* the window must actually SHOW the staged change — otherwise
                 * the revert proves nothing (empty-list degenerate case) */
                const sawStaged = String((probe && probe.head) || '').indexOf(stageKey()) !== -1;
                const clicked = await clickRevertWait(sid);
                await sleep(350);
                const st350 = await exec(sid, JS_ISTATUS);
                await sleep(500);
                const st850 = await exec(sid, JS_ISTATUS);
                await top(sid);
                /* Locale-free pass criteria (q678: on a zh_CN LuCI the success
                 * status is t("Reverted") -> "已放弃", which broke the English
                 * /Reverted/ regex — the assertion was wrong, not the theme).
                 * The delta clearing is the semantic outcome: the revert
                 * endpoint only empties deltas on ok:true. Status text is
                 * recorded for review, not asserted. */
                const delta = deltaView();
                const deltaCleared = String(delta).indexOf(stageKey()) === -1;
                const ok = sawStaged && clicked === 'clicked' && deltaCleared;
                rec('H3-changes-full-flow', ok ? 'pass' : 'fail', 'sawStaged=' + sawStaged + ' click=' + clicked + ' status@350=' + JSON.stringify(st350) + ' @850=' + JSON.stringify(st850) + ' delta=' + String(delta).replace(/\s+/g, ' ').slice(0, 80));
                await shot(sid, 'H3-after-revert');
            }
        }
        await nav(sid, BASE() + '/cgi-bin/luci/admin/status/overview');
        await sleep(3000);

        /* H5: stock banner Dismiss. The banner source is the stock upgrade
         * check (attendedsysupgrade option staged into the session scope) —
         * firmware without that config has no banner mechanism at all. */
        if (!hasAsu()) {
            rec('H5-stock-banner-dismiss', 'skip', 'no upgrade-check config (attendedsysupgrade absent) — no stock banner source on this firmware (q675)');
        } else {
            const stg5 = stageChange();
            say('[ssh] stage(H5): ' + String(stg5).replace(/\s+/g, ' ').slice(0, 60));
            await sleep(800);
            await nav(sid, BASE() + '/cgi-bin/luci/admin/status/overview?embed=1');
            let banner = null;
            for (let i = 0; i < 17; i++) { const b = await exec(sid, JS_BANNER); if (b && b.found) { banner = b; break; } await sleep(1500); }
            if (!banner) rec('H5-stock-banner-dismiss', 'skip', 'no "New Firmware Available" banner within 25s (firmware without upgrade check or pref committed) stage=' + String(stg5).replace(/\s+/g, ' ').slice(0, 40));
            else {
                await exec(sid, JS_CLICK_DISMISS);
                await sleep(1300);
                const gone = await exec(sid, JS_BANNER_GONE);
                rec('H5-stock-banner-dismiss', gone === true ? 'pass' : 'fail', 'gone=' + JSON.stringify(gone));
                await shot(sid, 'H5-dismissed');
            }
        }

        /* H6: password page in WM window (classic CBI representative).
         * WM.open must run on a shell (top-level) page — after H5 we are still
         * on the embed page where wm.js is not loaded (q668: WM undefined).
         * Firmware without a separate password page (dev2-era: combined under
         * /admin/system/admin, q666 dispatcher miss) shows the miss INSIDE the
         * window frame (frame exists, body says "No page is registered") — so
         * the fallback triggers on the notfound assertion, not just on a
         * missing frame (q673: jsErr=0 alone was a false pass there). */
        await nav(sid, BASE() + '/cgi-bin/luci/admin/status/overview');
        await sleep(4000);
        const wmo6 = await exec(sid, JS_WM_OPEN('admin/system/admin/password'));
        await sleep(3500);
        let fr6 = await findFrameWait(sid, 'admin/system/admin/password', 6000);
        let h6page = 'admin/system/admin/password';
        let p6 = fr6 ? await probeWindowPage(sid, fr6.idx, 1500) : null;
        if (!p6 || p6.nf) {
            say('[hot] H6 password page unavailable (' + (!fr6 ? 'frame not found' : 'dispatcher miss in window') + ') — falling back to /admin/system/admin');
            h6page = 'admin/system/admin';
            await nav(sid, BASE() + '/cgi-bin/luci/admin/status/overview');
            await sleep(4000);
            await exec(sid, JS_WM_OPEN(h6page));
            await sleep(3500);
            const all6 = await exec(sid, JS_FRAMES_ALL);
            const arr6 = Array.isArray(all6) ? all6 : [];
            fr6 = arr6.filter(f => String(f.src).indexOf('/admin/system/admin') !== -1 && String(f.src).indexOf('password') === -1)[0] || null;
            p6 = fr6 ? await probeWindowPage(sid, fr6.idx, 1500) : null;
        }
        if (!fr6 || !p6) rec('H6-password-window', 'fail: frame not found', 'wm=' + wmo6 + ' page=' + h6page + ' url=' + JSON.stringify(await exec(sid, 'return document.location.pathname;')) + ' frames=' + JSON.stringify(await exec(sid, JS_FRAMES_ALL)).slice(0, 240));
        else if (p6.nf) rec('H6-password-window', 'fail', 'page=' + h6page + ' dispatcher miss (notfound) inside window: ' + JSON.stringify(p6.nfObj));
        else rec('H6-password-window', p6.d && p6.d.jsErr === 0 ? 'pass' : 'fail', 'page=' + h6page + ' jsErr=' + (p6.d && p6.d.jsErr) + ' errHead=' + (p6.d && p6.d.errHead));
        await shot(sid, 'H6-password');

        /* H7: network page in WM window (misalignment hotspot; read-only).
         * notfound assertion here too — a dispatcher miss must not pass on
         * jsErr=0 alone (q673 H6 lesson). */
        const wmo7 = await exec(sid, JS_WM_OPEN('admin/network/network'));
        await sleep(4000);
        const fr7 = await findFrameWait(sid, 'admin/network/network', 6000);
        if (!fr7) rec('H7-network-window', 'fail: frame not found', 'wm=' + wmo7 + ' url=' + JSON.stringify(await exec(sid, 'return document.location.pathname;')) + ' frames=' + JSON.stringify(await exec(sid, JS_FRAMES_ALL)).slice(0, 240));
        else {
            const p7 = await probeWindowPage(sid, fr7.idx, 2000);
            rec('H7-network-window', (!p7.nf && p7.d && p7.d.jsErr === 0) ? 'pass' : 'fail', 'nf=' + JSON.stringify(p7.nfObj) + ' jsErr=' + (p7.d && p7.d.jsErr) + ' errHead=' + (p7.d && p7.d.errHead));
            await shot(sid, 'H7-network');
        }

        /* H8: wallpaper API (read-only list) */
        const wp = await exec(sid, JS_PAGE_GET('/cgi-bin/luci/admin/desktop/list_wallpapers'));
        const wpok = wp && /\{"ok":true|"list":|\[/.test(String(wp).slice(0, 200));
        rec('H8-wallpaper-list-api', wpok ? 'pass' : 'fail', String(wp).slice(0, 160));

        /* H9: narrow window 600x800 (q602 C) */
        await lib.wd('POST', '/session/' + sid + '/window/rect', { width: 600, height: 800 }, 10000);
        await nav(sid, BASE() + '/cgi-bin/luci/admin/status/overview');
        await sleep(9000);
        const wn = await exec(sid, JS_WAN);
        rec('H9-narrow-600px', wn && wn.jsErr === 0 ? 'pass' : 'fail', 'iframe fill=' + (wn && wn.wan4_s) + ' jsErr=' + (wn && wn.jsErr));
        await shot(sid, 'H9-narrow');
        await lib.wd('POST', '/session/' + sid + '/window/rect', { width: 1600, height: 900 }, 10000);

        /* H4: session expiry UX (kills TOK — near the end by design).
         * The NAMED expiry status + shell re-login toast landed in theme 328
         * (212b97a); on older deployed themes (dev2 = 327) the honest verdict
         * is skip — a theme-version delta, not a firmware-gate softening. */
        const themeV = parseInt(String(shl('cat /www/luci-static/desktop/version.txt') || '').replace(/[^0-9]/g, '').slice(-3), 10);
        if (themeV && themeV < 328) {
            rec('H4-session-expiry-ux', 'skip', 'expiry UX (named status + shell toast) landed in theme 328; deployed theme=' + themeV + ' — version delta, not a firmware gate');
        } else {
            stageChange();
            await sleep(800);
            const wmo4 = await exec(sid, JS_WM_OPEN('admin/desktop/changes'));
            await sleep(2500);
            killSession(); tokDead = true;
            const arb = await exec(sid, JS_ARB);
            if (!(arb && arb.loginPage === true)) rec('H4-session-expiry-ux', 'skip', 'session could not be invalidated (arb=' + JSON.stringify(arb) + ')');
            else {
                const fr4 = await enterFrame(sid, 'admin/desktop/changes', 10000);
                if (!fr4) rec('H4-session-expiry-ux', 'fail: changes frame not found');
                else {
                    await sleep(600);
                    await clickRevertWait(sid);
                    await sleep(600);
                    const st4 = await exec(sid, JS_ISTATUS);
                    const lock4 = await exec(sid, JS_BTN_LOCKED);
                    await top(sid);
                    await sleep(900);
                    const toast = await exec(sid, JS_TOAST);
                    /* Locale-free (q678 lesson, now H4 too): the named status is
                     * t("Session expired. Please log in again.") -> zh_CN
                     * "会话已过期，请重新登录。", so an English regex is wrong. The
                     * semantic anchors are the auth-expired toast (data-key) and the
                     * locked Apply/Revert; a non-empty #status proves the named
                     * status rendered instead of a silent no-op. */
                    const msgOk = String(st4 || '').trim().length > 0;
                    const toastOk = toast && toast.present === true;
                    rec('H4-session-expiry-ux', msgOk && toastOk ? 'pass' : 'fail',
                        'status=' + JSON.stringify(st4) + ' lock=' + JSON.stringify(lock4) + ' toast=' + JSON.stringify(toast));
                    await shot(sid, 'H4-expired');
                }
            }
        }

        /* H10: logout -> login page reappears */
        await nav(sid, BASE() + '/cgi-bin/luci/admin/logout');
        await sleep(3500);
        const li = await exec(sid, JS_LOGINCHECK);
        rec('H10-logout-loginpage', li === true ? 'pass' : 'fail', 'loginInput=' + JSON.stringify(li));
        await shot(sid, 'H10-login');
    } catch (e) {
        say('FATAL: ' + (e && e.stack || e));
    }
    /* cleanup: best-effort, route-aware. On the ubus route session-scoped
     * staged changes die with the session (q652b C2: probe after destroy ->
     * count 0); on the cli route the /tmp/.uci deltas are anonymous and
     * SURVIVE session death, so they are always swept via CLI. */
    try {
        const cr = ROUTE || 'cli';
        if (cr === 'cli') {
            /* uci revert needs a config argument (bare `uci revert` prints
             * usage — q678); sweep every config that has a delta file. */
            say('[ssh] cleanup cli sweep: ' + ssh('for c in $(ls /tmp/.uci 2>/dev/null); do uci -q revert "$c" 2>/dev/null; done; uci -q changes 2>&1; echo sweep-done').replace(/\s+/g, ' ').slice(0, 60));
        } else if (cr === 'ubus') {
            if (tokDead) say('[ssh] session destroyed in H4 — session-scoped staged changes die with it (q652b C2)');
            else say('[ssh] cleanup revert: ' + revertDelta().slice(0, 40));
            say('[ssh] root sweep: ' + ssh("ubus call uci revert '{\"config\":\"attendedsysupgrade\"}'").replace(/\s+/g, ' ').slice(0, 40));
        } else {
            /* ubus-sess (q687): the session scope dies in H4; otherwise a
             * token-scoped revert is exact. No attendedsysupgrade touch — the
             * config does not exist on this firmware. */
            if (tokDead) say('[ssh] session destroyed in H4 — session-scoped staged changes die with it (q652b C2)');
            else say('[ssh] cleanup revert: ' + revertDelta().slice(0, 40));
        }
        say('[ssh] final delta: ' + (ROUTE ? deltaView().replace(/\s+/g, ' ').slice(0, 100) : 'n/a (no staging route used)'));
    } catch (e) {}
    try { if (sid) await finish(sid); } catch (e) {}
    const pass = R.filter(r => r.status === 'pass').length;
    const fail = R.filter(r => r.status === 'fail').length;
    const skip = R.filter(r => r.status === 'skip').length;
    const report = {
        label: label, started: new Date(t0).toISOString(), durationMs: Date.now() - t0,
        era: era === '__EMPTY__' ? 'unset(modern)' : era,
        summary: { total: R.length, pass, fail, skip }, checks: R
    };
    fs.writeFileSync(OUT + '/report.json', JSON.stringify(report, null, 1));
    say('[summary] ' + pass + ' pass / ' + fail + ' fail / ' + skip + ' skip -> ' + OUT + '/report.json');
    fs.writeFileSync(OUT + '/log.txt', mask(LOG));
    console.log('Q-HOT DONE');
})();

const JS_PAGE_GET = (u) => "return (function(){try{var x=new XMLHttpRequest();x.open('GET'," + JSON.stringify(u) + ",false);x.send();return x.status+'\\n'+x.responseText;}catch(e){return '0\\nXHR-ERR '+e.message;}})()";
