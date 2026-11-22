/* app-runtime.js — browser-level app probe (does the app actually WORK?)
 *
 * L3 answers "did the page load" (transport). This answers "does the app run"
 * (runtime): open the real page in a real browser under the current theme,
 * wait for its JS, then read what the user would see — including inside the
 * theme's app windows (iframes). It reports error surfaces, so a page that
 * returns 200 with "Failed to connect to docker host" stops being "ok".
 *
 * Usage:
 *   PROBE_ROUTER=192.0.2.1 node probe/app-runtime.js \
 *       --paths admin/services/dockerman,admin/services/oaf,admin/services/linkease
 *   PROBE_ROUTER=192.0.2.1 node probe/app-runtime.js --paths ... --json /tmp/app.json
 *   PROBE_ROUTER=192.0.2.1 node probe/app-runtime.js --paths ... --shots /tmp/shots
 *
 * Notes:
 *   - Markers are data, not instructions: they come from the device under test.
 *   - The gate is "error surface visible to the user", not HTTP status. A page
 *     can be 200 and still be broken (firmware daemon down, app token expired).
 *   - Verdict is informational unless the caller treats it as a gate; qualify
 *     firmware-side vs theme-side by re-running with the stock theme (argon).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const lib = require('./lib.js');

const args = process.argv.slice(2);
function arg(name, def) {
    const i = args.indexOf('--' + name);
    return i === -1 ? def : (args[i + 1] || '');
}
const PATHS = arg('paths', 'admin/services/dockerman,admin/services/oaf,admin/services/linkease')
    .split(',').map(s => s.trim()).filter(Boolean);
const JSON_OUT = arg('json', '');
const SHOTS = arg('shots', '');
const WAIT_MS = parseInt(arg('wait', '3500'), 10);
const EMBED = args.indexOf('--no-embed') === -1;

const MARKERS = [
    'Failed to connect', 'Forbiden after', 'Forbidden after', 'cannot connect',
    'Connection refused', '加载失败', '载入失败', 'No such file', 'Traceback',
    'Internal Server Error', 'Access denied', 'Permission denied',
    'No page is registered'
];

const JS_TEXT = "return (function(){var t=(document.body&&document.body.innerText)||'';return {title:document.title,text:t.slice(0,1500),len:t.length};})()";
const JS_FRAMES = "return (function(){var fs=document.querySelectorAll('iframe');var o=[];for(var i=0;i<fs.length;i++){o.push({idx:i,src:String(fs[i].src||'').slice(0,160)});}return o;})()";

function slug(p) {
    return p.replace(/^\/+/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'root';
}

(async () => {
    if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
    const sid = await lib.startGecko().then(() => lib.newSession());
    try {
        await lib.login(sid);
        const out = [];
        for (const p of PATHS) {
            const pth = p.replace(/^\/+/, '');
            const url = `http://${lib.ROUTER}/cgi-bin/luci/${pth}${EMBED ? '?embed=1' : ''}`;
            const rec = { path: '/' + pth, url: url.replace(/\/\/[^/]+/, '//<host>') };
            try {
                await lib.nav(sid, url);
                await lib.sleep(WAIT_MS);
                const top = await lib.exec(sid, JS_TEXT);
                rec.title = top.title;
                rec.topText = top.text;
                rec.frames = [];
                const frames = (await lib.exec(sid, JS_FRAMES)) || [];
                for (const f of frames.slice(0, 6)) {
                    try {
                        await lib.wd('POST', `/session/${sid}/frame`, { id: f.idx });
                        const ft = await lib.exec(sid, JS_TEXT);
                        rec.frames.push({ idx: f.idx, src: f.src, title: ft.title, text: ft.text.slice(0, 600) });
                    } catch (e) {
                        rec.frames.push({ idx: f.idx, src: f.src, error: String(e.message).slice(0, 80) });
                    }
                }
                await lib.wd('POST', `/session/${sid}/frame`, { id: null });
                const hay = [rec.topText].concat(rec.frames.map(f => f.text || '')).join('\n');
                rec.markers = MARKERS.filter(m => hay.indexOf(m) !== -1);
                rec.verdict = rec.markers.length ? 'ERROR-SURFACE' : 'clean';

                if (SHOTS) {
                    try {
                        const rs = await lib.wd('GET', `/session/${sid}/screenshot`);
                        const b64 = JSON.parse(rs.body).value;
                        const f = path.join(SHOTS, slug(pth) + '.png');
                        fs.writeFileSync(f, Buffer.from(b64, 'base64'));
                        rec.shot = f;
                    } catch (e) { rec.shotError = String(e.message).slice(0, 80); }
                }
            } catch (e) {
                rec.error = String(e.message).slice(0, 160);
                rec.verdict = 'PROBE-ERROR';
            }
            out.push(rec);
            const line = `[app] ${rec.path} -> ${rec.verdict}` +
                (rec.markers && rec.markers.length ? ' markers=' + JSON.stringify(rec.markers) : '') +
                (rec.error ? ' error=' + rec.error : '') +
                (rec.shot ? ' shot=' + rec.shot : '');
            console.log(line);
            console.log('      text: ' + String(rec.topText || '').replace(/\s+/g, ' ').slice(0, 220));
        }
        if (JSON_OUT) {
            fs.writeFileSync(JSON_OUT, JSON.stringify({ at: new Date().toISOString(), paths: PATHS, results: out }, null, 1));
            console.log('[app] wrote ' + JSON_OUT);
        }
        const bad = out.filter(r => r.verdict !== 'clean').length;
        console.log(`[app] summary total=${out.length} error=${bad}`);
        await lib.finish(sid);
        process.exit(bad ? 1 : 0);
    } catch (e) {
        console.log('[app] FATAL ' + String(e.message).slice(0, 200));
        try { await lib.finish(sid); } catch (e2) {}
        process.exit(2);
    }
})();
