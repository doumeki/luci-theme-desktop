/* compat-scan.js — L3 wide scan: every admin page x generic invariants.
 *
 * Purpose: the firmware-compat failures concentrate in UI/interaction and all
 * sit on the theme<->stock contracts. This scan walks EVERY page the firmware
 * exposes — the device's own menu tree (/cgi-bin/luci/admin/menu JSON, q685)
 * unioned with the shell page's hidden LuCI menu DOM — and applies the same
 * cheap detectors everywhere — no per-page assertions:
 *
 *   login-bounce   session/nav death (the "Revert Failed" class)
 *   blank          empty/short main container (the overview-blank class)
 *   jserr          window.onerror + unhandledrejection trap counts
 *   reqfail        hooked XHRs with status >=400 or 0 (endpoints missing)
 *   res404         HEAD-probe of img/script/link subresources (icons/fonts)
 *   overflow       horizontal scrollWidth (misalignment)
 *   zeromain       zero-size main container (misalignment)
 *   poll           repeating same-URL requests within dwell (auto-refresh,
 *                  the XHR.poll-stub class); expectation-driven, record-only
 *                  until calibrated (see compat-scan.config.js)
 *   slow/timeout   per-page budget; distinguishes "page itself slow" from
 *                  "theme hung"
 *
 * Faces: embed=1 top-level nav for the wide pass (the face users see inside
 * windows), a WM.open iframe-face sample, and a 390px mobile sample.
 * Screenshots per page (noise masking for pixel diffs is a later step; diffs
 * are same-firmware cross-theme-version only).
 *
 * Usage (repo root or anywhere):
 *   node probe/compat-scan.js --label vm2512
 *   PROBE_ROUTER=<ip> PROBE_SSH=<ip> node probe/compat-scan.js --label 1.1
 *   node probe/compat-scan.js --label vm2512 --baseline /tmp/compat-scan/vm2512/report.json
 *
 * Output: <out>/<label>/report.json + shots/*.png + log.txt (masked).
 */
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const lib = require('./lib.js');
const cfg = require('./compat-scan.config.js');
const geomMeasure = require('../tests/geom/measure.js');
const geomEval = require('../tests/geom/evaluate.js');
const { sleep, exec, nav, startGecko, newSession, login, finish } = lib;

const BASE = () => 'http://' + lib.ROUTER;
let OUT = '/tmp/compat-scan/run';
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
function sha8(s) { return crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 8); }

async function shot(sid, name) {
    try {
        const r = await lib.wd('GET', '/session/' + sid + '/screenshot', null, 20000);
        let b64 = null;
        try { b64 = JSON.parse(r.body).value; } catch (e) {}
        if (typeof b64 === 'string' && b64.length > 1000) {
            fs.writeFileSync(OUT + '/shots/' + name + '.png', Buffer.from(b64, 'base64'));
            return true;
        }
    } catch (e) {}
    return false;
}

/* page-side scripts — brace-balanced (q652 lesson), single expressions */
const JS_INSTALL = "return (function(){if(window.__scanInstalled){return 'already('+document.readyState+')';}window.__scanInstalled=true;window.__scanErr=[];window.__scanReq=[];window.addEventListener('error',function(e){window.__scanErr.push(String((e&&e.message)||(e&&e.type)||'error').slice(0,140));});window.addEventListener('unhandledrejection',function(e){window.__scanErr.push('promise: '+String((e&&e.reason)||'').slice(0,140));});var xo=XMLHttpRequest.prototype.open;var xs=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.open=function(m,u){this.__m=m;this.__u=u;return xo.apply(this,arguments);};XMLHttpRequest.prototype.send=function(){var x=this;var t0=Date.now();x.addEventListener('load',function(){try{window.__scanReq.push({m:x.__m,u:String(x.__u||'').slice(0,140),s:x.status,ms:Date.now()-t0});}catch(e){}});x.addEventListener('error',function(){window.__scanReq.push({m:x.__m,u:String(x.__u||''),s:0,ms:Date.now()-t0});});return xs.apply(this,arguments);};return 'installed('+document.readyState+')';})()";
const JS_DETECT = "return (function(){var out={};out.ready=document.readyState;out.login=!!document.querySelector('input[name=\"luci_username\"]');out.notfound=/\\b404\\b|not found/i.test(String(document.title||''))||/No page (is )?registered/i.test(String(document.body&&document.body.textContent||'').slice(0,400));var mains=['#maincontent','.container','main','.cbi-map'];var el=null;for(var i=0;i<mains.length;i++){var e=document.querySelector(mains[i]);if(e){el=e;break;}}out.mainText=el?String(el.textContent||'').replace(/\\s+/g,' ').trim().length:-1;out.zeroMain=el?(el.getBoundingClientRect().width<10||el.getBoundingClientRect().height<10):false;out.overflow=document.documentElement.scrollWidth>document.documentElement.clientWidth+2;out.errors=(window.__scanErr||[]).slice(0,8);var req=window.__scanReq||[];out.reqN=req.length;var fails=0;for(var j=0;j<req.length;j++){if(req[j].s>=400||req[j].s===0)fails++;}out.reqFail=fails;var cnt={};for(var k=0;k<req.length;k++){var key=String(req[k].u).replace(/[?#].*$/,'');cnt[key]=(cnt[key]||0)+1;}out.urls=Object.keys(cnt).map(function(u){return {u:u.slice(0,110),n:cnt[u]};}).sort(function(a,b){return b.n-a.n;}).slice(0,8);var poll=false;for(var p=0;p<out.urls.length;p++){if(out.urls[p].n>=2){poll=true;break;}}out.pollAlive=poll;out.title=String(document.title||'').slice(0,80);return out;})()";
const JS_RES404 = "return (function(){var els=document.querySelectorAll('img[src],script[src],link[href]');var urls=[];var seen={};for(var i=0;i<els.length;i++){var e=els[i];var u=e.getAttribute('src')||e.getAttribute('href');if(!u)continue;if(/^(data:|blob:|javascript:|about:)/i.test(u))continue;if(u.indexOf('/')===0){u=location.origin+u;}else if(u.indexOf('http')!==0){u=location.origin+location.pathname.replace(/[^/]*$/,'')+u;}if(u.indexOf(location.origin)!==0)continue;if(seen[u])continue;seen[u]=1;urls.push(u);if(urls.length>=40)break;}var bad=[];for(var j=0;j<urls.length;j++){try{var x=new XMLHttpRequest();x.open('HEAD',urls[j],false);x.send();if(x.status>=400){bad.push(x.status+' '+urls[j].slice(location.origin.length));}}catch(err){bad.push('ERR '+urls[j].slice(location.origin.length));}}return {n:urls.length,bad:bad.slice(0,6)};})()";
/* DOM harvest (fallback when the device has no /admin/menu endpoint — Lua
 * track). q687: the string/HTML extractors must accept `_` — iStoreOS menu
 * leaves such as nas/hd_idle, status/release_ram and system/advanced_reboot
 * were truncated to nas/hd etc., which produced phantom notfound pages and
 * silently dropped the real ones. HTML comments are stripped first: template
 * comments legitimately name routes (that is documentation, not navigation)
 * and were harvested as phantom pages. */
const JS_HARVEST = "return (function(){var out={links:[],anchorLinks:[],menuDom:!!document.querySelector('.main-left,#mainmenu,.nav'),jsonTags:0};var acc={};var add=function(p){if(!p)return;p=String(p);if(p.charAt(0)!=='/')p='/'+p;if(p.indexOf('/admin/')!==0)return;if(p.indexOf('/logout')!==-1)return;if(p.length>90)return;acc[p]=1;};var as=document.querySelectorAll('a[href]');for(var i=0;i<as.length;i++){var h=as[i].getAttribute('href')||'';var m=h.match(/\\/cgi-bin\\/luci(\\/admin\\/[^?#]*)/)||h.match(/^(\\/admin\\/[^?#]*)/)||h.match(/^(admin\\/[^?#]+)/);if(m){add(m[1]);var ap=String(m[1]);if(ap.charAt(0)!=='/')ap='/'+ap;out.anchorLinks.push(ap);}}var scripts=document.querySelectorAll('script[type=\"application/json\"]');out.jsonTags=scripts.length;for(var j=0;j<scripts.length;j++){var t=String(scripts[j].textContent||'');var o=null;try{o=JSON.parse(t);}catch(e){}if(o){var walk=function(x){if(!x)return;if(typeof x==='string'){var mm=x.match(/admin\\/[a-z0-9_\\-]+(?:\\/[a-z0-9_\\-]+)*/g);if(mm)for(var z=0;z<mm.length;z++)add(mm[z]);return;}if(typeof x!=='object')return;if(Object.prototype.toString.call(x)==='[object Array]'&&x.length>1&&x[0]==='admin'){add(x.join('/'));return;}for(var k in x)walk(x[k]);};walk(o);}}if(out.links.length<25){var html=document.documentElement.innerHTML.replace(/<!--[\\s\\S]*?-->/g,'');var hm=html.match(/admin\\/[a-z0-9_\\-]+(?:\\/[a-z0-9_\\-]+)*/g);if(hm)for(var y=0;y<hm.length&&y<4000;y++)add(hm[y]);}for(var p3 in acc)out.links.push(p3);out.links.sort();return out;})()";
const JS_PAGE_GET = (u) => "return (function(){try{var x=new XMLHttpRequest();x.open('GET'," + JSON.stringify(u) + ",false);x.send();return x.status+'\\n'+x.responseText;}catch(e){return '0\\nXHR-ERR '+e.message;}})()";
/* q685: authoritative menu source. /cgi-bin/luci/admin/menu returns the full
 * dispatcher menu tree as JSON (ucode track). Walk it and classify leaves:
 *   - PAGE leaves: view/cbi/template/alias, OR any non-function leaf that
 *     carries a non-empty title. A titled leaf is a user-visible menu entry;
 *     iStoreOS ships whole apps as `call` leaves with titles (nas/cifs,
 *     system/argon-config, ...) and they answer 200 text/html — verified
 *     q862/q863 on iStoreOS 25.12.6: 17 titled call leaves, all real pages.
 *     Excluding them both loses coverage and fakes a "leak" (q866).
 *   - ACTION endpoints: untitled call/function leaves (changes/apply,
 *     uci/apply_unchecked, docker prune, logout, ...). GET-scanning them would
 *     fire side effects, so they must never enter the page set.
 * Old Lua track has no such endpoint; an empty/404 result simply falls back
 * to the DOM harvest. */
const JS_MENU_API = "return (function(){var out={links:[],endpoints:[],status:0,api:0,err:null};try{var x=new XMLHttpRequest();x.open('GET','/cgi-bin/luci/admin/menu',false);x.send();out.status=x.status;if(x.status!==200)return out;var root=JSON.parse(x.responseText||'{}');out.api=1;var acc={};var PAGE={view:1,cbi:1,template:1,alias:1};var add=function(p){if(!p)return;p=String(p);if(p.charAt(0)!=='/')p='/'+p;if(p.indexOf('/admin/')!==0)return;if(p.indexOf('/logout')!==-1)return;if(p.length>90)return;acc[p]=1;};var walk=function(n,path){if(!n||typeof n!=='object')return;if(n.satisfied===false)return;var kids=n.children||{};var keys=[];for(var k in kids)keys.push(k);if(!keys.length){var t=(n.action&&n.action.type)||'';var ti=String(n.title||'').trim();var isPage=PAGE[t]===1||(t!=='function'&&ti!=='');if(isPage&&path.length>1)add(path.join('/'));else if(path.length>1)out.endpoints.push('/'+path.join('/'));return;}for(var i=0;i<keys.length;i++)walk(kids[keys[i]],path.concat([keys[i]]));};walk(root,[]);for(var p in acc)out.links.push(p);out.links.sort();out.endpoints.sort();}catch(e){out.err=String((e&&e.message)||e).slice(0,120);}return out;})()";
const JS_WM_OPEN = (p) => "return (function(){try{WM.open('/cgi-bin/luci/" + p + "','scan');return 'wm-open-ok';}catch(e){return 'wm-open-fail:'+String(e&&e.message||e);}})()";
const JS_FRAMES_ALL = "return (function(){var fs=document.querySelectorAll('iframe');var out=[];for(var i=0;i<fs.length;i++){out.push({idx:i,src:String(fs[i].src||'').replace(/^https?:\\/\\/[^/]+/,'').slice(0,140)});}return out;})()";

function pollExpectFor(path) {
    for (const k of Object.keys(cfg.pollExpect)) {
        try { if (new RegExp(k).test(path)) return cfg.pollExpect[k]; } catch (e) {}
    }
    return null;
}

function isSkipped(path) {
    for (const r of cfg.skip) {
        try { if (new RegExp(r.match).test(path)) return r.reason || 'skip'; } catch (e) {}
    }
    return null;
}

/* Geometry probe on the pages that render a table. Absolute invariants only:
   no reference theme run, so the scan stays cheap. A failure means the page's
   table does not fit its container, one column eats the row, or the overflow
   is hidden behind a clip. */
function isGeometryPage(path) {
    return (cfg.geometryPages || []).some(p => String(path).indexOf(p) !== -1);
}

async function probeGeometry(sid, path) {
    try {
        const g = await exec(sid, geomMeasure.EXPR);
        const gf = geomEval.evaluate(g, null);
        const gs = geomEval.summarize(gf);
        say('[geometry] ' + path + ' -> ' + gs.verdict + ' fail=' + gs.fail + ' note=' + gs.note);
        for (const f of gf) if (f.level === 'FAIL') say('[geometry]   ' + f.id + ' ' + f.dim + ' ' + f.actual + ' (expect ' + f.expect + ')');
        return { verdict: gs.verdict, fail: gs.fail, note: gs.note, findings: gf.filter(x => x.level !== 'PASS') };
    } catch (e) {
        return { error: String((e && e.message) || e).slice(0, 120) };
    }
}

/* classify one page from detector results */
function classify(path, det, res404, exp, ms, detErr) {
    const st = { page: path, ms: ms, status: 'ok', flags: [] };
    if (detErr || det === null || (typeof det === 'string' && det.indexOf('?(') === 0)) {
        st.status = 'timeout'; st.flags.push('probe-failed:' + String(detErr || det).slice(0, 90));
        return st;
    }
    const add = (f) => { st.flags.push(f); if (st.status === 'ok') st.status = f; };
    if (det.login) add('login');
    if (det.notfound) add('notfound'); /* page-missing outranks content flags */
    if (det.mainText !== -1 && det.mainText < 35) add('blank');
    if (det.zeroMain) add('zeromain');
    if (det.errors && det.errors.length) { add('jserr'); st.jsErrors = det.errors; }
    if (det.reqFail > 0) { add('reqfail'); st.reqFailN = det.reqFail; }
    if (res404 && res404.bad && res404.bad.length) { add('res404'); st.res404 = res404.bad; }
    if (det.overflow) add('overflow');
    if (cfg.pollExpectEnforced) {
        if (exp === 'poll' && !det.pollAlive) add('poll-dead');
        if (exp === 'none' && det.pollAlive) add('poll-leak');
    }
    st.pollExpect = exp || 'any';
    if (ms > cfg.slowMs && st.status === 'ok') add('slow');
    st.reqN = det.reqN;
    st.pollAlive = det.pollAlive; st.mainText = det.mainText; st.ready = det.ready;
    st.topUrls = (det.urls || []).slice(0, 4);
    return st;
}

(async function main() {
    const argv = process.argv.slice(2);
    function argOf(name, dflt) { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; }
    const label = String(argOf('--label', 'run')).replace(/([0-9]{1,3}\.){3}[0-9]{1,3}/g, 'host').replace(/[^A-Za-z0-9_-]/g, '') || 'run';
    const baselineFile = argOf('--baseline', null);
    OUT = '/tmp/compat-scan/' + label;
    fs.mkdirSync(OUT + '/shots', { recursive: true });

    const t0 = Date.now();
    const baseline = (baselineFile && fs.existsSync(baselineFile)) ? JSON.parse(fs.readFileSync(baselineFile, 'utf8')) : null;
    say('== compat-scan L3 @ label=' + label + ' fw=' + shl("source /etc/openwrt_release 2>/dev/null; echo $DISTRIB_DESCRIPTION") + ' theme=' + shl('cat /www/luci-static/desktop/version.txt 2>/dev/null') + ' ==');
    say('[gate] profile gate rule: new firmware needs a profile match before standing in for a representative (see compat-scan.config.js)');

    let sid = null; let TOK = ''; let cookieName = '';
    try {
        await startGecko();
        sid = await newSession();
        const auth = await login(sid);
        TOK = (auth && auth.value) || ''; cookieName = (auth && auth.name) || '';
        say('[lib] login cookie=' + cookieName + ' tok=' + (TOK ? TOK.slice(0, 6) + '…(len ' + TOK.length + ')' : 'NONE'));
        await nav(sid, BASE() + '/cgi-bin/luci/admin/status/overview');
        await sleep(4000);
        await lib.assertTheme(sid, 'desktop');
        await lib.wd('POST', '/session/' + sid + '/window/rect', { width: cfg.desktopRect.width, height: cfg.desktopRect.height }, 10000);

        /* ---- profile (cheap fingerprint; fingerprint.js/profiles land later) ---- */
        const prof = { cookieName: cookieName };
        const grabHash = async (url, key) => {
            const r = await exec(sid, JS_PAGE_GET(url));
            const s = String(r || '');
            const nl = s.indexOf('\n');
            const code = nl > 0 ? s.slice(0, nl) : '0';
            const body = nl > 0 ? s.slice(nl + 1) : '';
            prof[key] = (code === '200' && body.length > 0) ? sha8(body) + ':' + body.length : 'unavailable(http ' + code + ')';
        };
        await grabHash('/luci-static/resources/xhr.js', 'xhr.js');
        await grabHash('/luci-static/resources/cbi.js', 'cbi.js');
        await grabHash('/luci-static/resources/ui.js', 'ui.js');
        await grabHash('/luci-static/resources/cbi.css', 'cbi.css');
        const ucodeDir = shl('ls -d /usr/share/ucode/luci/template/themes/desktop');
        const luaDir = shl('ls -d /usr/lib/lua/luci/view/themes/desktop');
        prof.trackUcode = ucodeDir.indexOf('__EMPTY__') === -1 && ucodeDir.indexOf('SSH-ERR') === -1;
        prof.trackLua = luaDir.indexOf('__EMPTY__') === -1 && luaDir.indexOf('SSH-ERR') === -1;
        say('[profile] ' + JSON.stringify(prof));

        /* ---- menu harvest: device menu tree FIRST, DOM only as fallback ---- */
        const api = await exec(sid, JS_MENU_API);
        const apiLinks = (api && api.links) || [];
        const apiEndpoints = (api && api.endpoints) || [];
        let menuSource = 'none';
        let links = [];
        say('[menu] api=' + JSON.stringify({ status: api && api.status, api: api && api.api, pages: apiLinks.length, endpoints: apiEndpoints.length, err: api && api.err }));
        if (apiLinks.length >= 10) {
            links = apiLinks.slice();
            menuSource = 'api';
        }
        /* The hidden LuCI menu DOM stays in the union: it is cheap, authenticated,
         * and only contains navigation anchors (never action endpoints). */
        let harvest = await exec(sid, JS_HARVEST);
        let domLinks = (harvest && harvest.links) || [];
        for (const l of domLinks) { if (links.indexOf(l) === -1) links.push(l); }
        say('[menu] dom=' + domLinks.length + ' union=' + links.length + ' menuDom=' + JSON.stringify(harvest && harvest.menuDom) + ' jsonTags=' + JSON.stringify(harvest && harvest.jsonTags));
        if (menuSource === 'none' && links.length > 0) menuSource = 'dom';
        if (links.length < 25) {
            menuSource = menuSource === 'api' ? 'api+seed' : 'seed';
            say('[menu] thin harvest -> seeding (nav + re-harvest)');
            for (const sp of cfg.seedPaths) {
                await nav(sid, BASE() + '/cgi-bin/luci/' + sp + '?embed=1');
                await sleep(2500);
                const got = await exec(sid, JS_HARVEST);
                for (const l of ((got && got.links) || [])) { if (links.indexOf(l) === -1) links.push(l); }
                if (links.length >= 25) break;
            }
            for (const sp of cfg.seedPaths) { const full = '/' + sp; if (links.indexOf(full) === -1) links.push(full); }
            say('[menu] after seeds: ' + links.length);
        }
        links = links.slice(0, cfg.maxPages);
        /* Safety: never GET an action endpoint (apply/revert/logout/...).
         * A leak is only a real navigation bug when the endpoint appears as an
         * ANCHOR (a theme rendering an action leaf as a menu link) -> FATAL.
         * Embedded JSON (the shell menu tree) and the raw-HTML fallback
         * legitimately mention untitled action leaves, so those strings are
         * dropped instead of failing the run (q866: iStoreOS shell JSON names
         * linkease/file + linkease_status). Titled call leaves are pages by
         * design (see JS_MENU_API note). */
        const anchorLinks = (harvest && harvest.anchorLinks) || [];
        const leakedAnchors = anchorLinks.filter(function(l) { return apiEndpoints.indexOf(l) !== -1; });
        if (leakedAnchors.length) {
            say('[menu] FATAL: action endpoints rendered as navigation anchors: ' + leakedAnchors.join(' '));
            process.exit(2);
        }
        const droppedActions = links.filter(function(l) { return apiEndpoints.indexOf(l) !== -1; });
        if (droppedActions.length) {
            say('[menu] dropped action endpoint strings from JSON/HTML harvest: ' + droppedActions.join(' '));
            links = links.filter(function(l) { return apiEndpoints.indexOf(l) === -1; });
        }
        prof.menuSource = menuSource;
        prof.apiPages = apiLinks.length;
        prof.menuHash = sha8(JSON.stringify(links.slice().sort()));
        say('[profile] menuSource=' + menuSource + ' apiPages=' + apiLinks.length + ' menuHash=' + prof.menuHash + ' pages=' + links.length);

        /* ---- wide pass: embed face, one budget per page ---- */
        const pages = [];
        for (const p of links) {
            const skipReason = isSkipped(p);
            if (skipReason) { pages.push({ page: p, status: 'skipped', flags: [skipReason] }); continue; }
            const url = BASE() + '/cgi-bin/luci' + p + '?embed=1';
            const pt0 = Date.now();
            await nav(sid, url);
            await sleep(cfg.installMs);
            let inst = await exec(sid, JS_INSTALL);
            if (typeof inst !== 'string' || inst.indexOf('installed') === -1) { await sleep(1500); inst = await exec(sid, JS_INSTALL); }
            await sleep(cfg.dwellMs);
            const det = await exec(sid, JS_DETECT);
            const res404 = await exec(sid, JS_RES404);
            const ms = Date.now() - pt0;
            const st = classify(p, det, res404, pollExpectFor(p), ms, null);
            if (st.status === 'ok' && isGeometryPage(p)) {
                st.geometry = await probeGeometry(sid, p);
                if (st.geometry.verdict === 'FAIL') st.flags.push('geometry');
            }
            pages.push(st);
            const detStr = typeof det === 'string' ? det : JSON.stringify(det);
            say('[page] ' + p + ' -> ' + st.status + (st.flags.length ? ' ' + st.flags.join(',') : '') + ' ms=' + ms + (st.status === 'ok' ? '' : ' det=' + detStr.slice(0, 220)));
            if (st.status !== 'ok' && st.status !== 'skipped' && st.status !== 'slow') await shot(sid, 'fail-' + p.replace(/[^a-z0-9]+/gi, '_').slice(0, 40));
        }

        /* ---- iframe-face sample through the real WM ---- */
        const iframePages = [];
        for (const p of cfg.iframeSample) {
            await nav(sid, BASE() + '/cgi-bin/luci/admin/status/overview');
            await sleep(4000);
            const wmo = await exec(sid, JS_WM_OPEN(p));
            await sleep(3500);
            const all = await exec(sid, JS_FRAMES_ALL);
            const arr = Array.isArray(all) ? all : [];
            const key = p.replace(/^\//, '');
            const fr = arr.filter(f => String(f.src).indexOf(key) !== -1)[0] || null;
            if (!fr) { iframePages.push({ page: p, status: 'iframe-missing', wm: wmo, framesSeen: arr }); say('[iframe] ' + p + ' -> iframe-missing wm=' + wmo + ' frames=' + JSON.stringify(arr).slice(0, 300)); continue; }
            const sw = await lib.wd('POST', '/session/' + sid + '/frame', { id: fr.idx }, 10000);
            await sleep(cfg.installMs);
            await exec(sid, JS_INSTALL);
            await sleep(Math.min(cfg.dwellMs, 5000));
            const det = await exec(sid, JS_DETECT);
            await lib.wd('POST', '/session/' + sid + '/frame', { id: null }, 10000);
            const st = classify(p, det, null, null, sw.status === 200 ? 3500 + cfg.installMs + 5000 : -1, null);
            st.face = 'iframe';
            if (det && det.login) st.flags.push('cookie-not-flowing');
            iframePages.push(st);
            say('[iframe] ' + p + ' -> ' + st.status + (st.flags.length ? ' ' + st.flags.join(',') : '') + ' sw=' + sw.status + (st.status === 'ok' ? '' : ' det=' + String(typeof det === 'string' ? det : JSON.stringify(det)).slice(0, 200)));
        }

        /* ---- 390px mobile sample ---- */
        await lib.wd('POST', '/session/' + sid + '/window/rect', { width: cfg.mobileRect.width, height: cfg.mobileRect.height }, 10000);
        const step = Math.max(1, Math.floor(links.length / cfg.mobileCount));
        const mobilePages = [];
        for (let i = 0; i < links.length && mobilePages.length < cfg.mobileCount; i += step) {
            const p = links[i];
            if (isSkipped(p)) continue;
            await nav(sid, BASE() + '/cgi-bin/luci' + p + '?embed=1');
            await sleep(3000);
            const det = await exec(sid, JS_DETECT);
            const st = classify(p, det, null, null, 3000 + 2000, null);
            st.face = 'mobile390';
            mobilePages.push(st);
            say('[mobile] ' + p + ' -> ' + st.status + (st.flags.length ? ' ' + st.flags.join(',') : '') + (st.status === 'ok' ? '' : ' det=' + String(typeof det === 'string' ? det : JSON.stringify(det)).slice(0, 200)));
            if (st.status !== 'ok') await shot(sid, 'mob-' + p.replace(/[^a-z0-9]+/gi, '_').slice(0, 40));
        }
        await lib.wd('POST', '/session/' + sid + '/window/rect', { width: cfg.desktopRect.width, height: cfg.desktopRect.height }, 10000);

        /* ---- report ---- */
        const bad = pages.filter(p => p.status !== 'ok' && p.status !== 'skipped' && p.status !== 'slow');
        const slow = pages.filter(p => p.status === 'slow');
        const skipped = pages.filter(p => p.status === 'skipped');
        const geomProbed = pages.filter(p => p.geometry && !p.geometry.error);
        const geomBad = geomProbed.filter(p => p.geometry.verdict === 'FAIL');
        const report = {
            label: label, started: new Date(t0).toISOString(), durationMs: Date.now() - t0,
            meta: { router: '<masked-ip>', theme: shl('cat /www/luci-static/desktop/version.txt 2>/dev/null'), firmware: shl("source /etc/openwrt_release 2>/dev/null; echo $DISTRIB_DESCRIPTION") },
            profile: prof,
            summary: { pages: pages.length, ok: pages.length - bad.length - slow.length - skipped.length, skipped: skipped.length, slow: slow.length, bad: bad.length, iframe: iframePages.length, mobile: mobilePages.length, geometry: { probed: geomProbed.length, bad: geomBad.length } },
            pages: pages, iframeFace: iframePages, mobileFace: mobilePages
        };
        fs.writeFileSync(OUT + '/report.json', JSON.stringify(report, null, 1));
        say('[summary] pages=' + report.summary.pages + ' ok=' + report.summary.ok + ' slow=' + report.summary.slow + ' bad=' + report.summary.bad + ' (bad list: ' + bad.map(b => b.page + ':' + b.status).join(' ') + ')');
        say('[geometry] probed=' + geomProbed.length + ' bad=' + geomBad.length + (geomBad.length ? ' (list: ' + geomBad.map(b => b.page).join(' ') + ')' : ''));

        /* ---- baseline diff ---- */
        if (baseline) {
            try {
                const prev = baseline;
                const prevMap = {}; (prev.pages || []).forEach(p => { prevMap[p.page] = p; });
                const curMap = {}; pages.forEach(p => { curMap[p.page] = p; });
                say('[diff] vs ' + baselineFile);
                for (const p of pages) {
                    const was = prevMap[p.page];
                    if (!was) { say('[diff] + new page ' + p.page + ' ' + p.status); continue; }
                    if (was.status !== p.status) say('[diff] ~ ' + p.page + ': ' + was.status + ' -> ' + p.status);
                }
                for (const p of (prev.pages || [])) { if (!curMap[p.page]) say('[diff] - gone page ' + p.page + ' ' + p.status); }
            } catch (e) { say('[diff] error: ' + e.message); }
        } else {
            say('[baseline] none given (pass --baseline <report.json> to diff; report saved for next run)');
        }
        say('[report] ' + OUT + '/report.json (keep this path as the baseline for the next run)');
    } catch (e) {
        say('FATAL: ' + (e && e.stack || e));
    }
    try { if (sid) await finish(sid); } catch (e) {}
    fs.writeFileSync(OUT + '/log.txt', mask(LOG));
    console.log('Q-SCAN DONE');
})();
