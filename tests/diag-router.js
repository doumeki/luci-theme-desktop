/* Desktop Theme — Live router diagnostic
 * Opens real router pages in headless firefox, collects console errors
 * and a DOM snapshot per page. Login via curl cookie injection.
 *
 * Usage: node tests/diag-router.js
 */
const { spawn, execSync } = require('child_process');
const http = require('http');
const fs = require('fs');

const lib = require('../probe/lib.js');
const GPORT = 4444;
const ROUTER = lib.ROUTER;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function killStale() {
    for (const pat of ['[f]irefox.*--headless', '[g]eckodriver --port']) {
        try { execSync(`pkill -9 -f '${pat}' 2>/dev/null; true`); } catch (e) {}
    }
}

function wd(method, urlPath, body, timeoutMs) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const req = http.request({
            host: '127.0.0.1', port: GPORT, path: urlPath, method,
            headers: { 'Content-Type': 'application/json' },
        }, res => {
            let b = '';
            res.on('data', d => b += d);
            res.on('end', () => resolve({ status: res.statusCode, body: b }));
        });
        req.setTimeout(timeoutMs || 30000, () => req.destroy(new Error('wd timeout: ' + method + ' ' + urlPath)));
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

async function newSession() {
    const r = await wd('POST', '/session', {
        capabilities: { alwaysMatch: { pageLoadStrategy: 'none',
            'moz:firefoxOptions': { args: ['--headless', '--width=1600', '--height=900'] } } },
    }, 90000);
    let v;
    try { v = JSON.parse(r.body); } catch (e) { v = null; }
    if (r.status !== 200 || !v || !v.value || !v.value.sessionId)
        throw new Error('session failed: ' + r.body.slice(0, 300));
    return v.value.sessionId;
}

// Single-statement execute only — multi-statement scripts hang on cold start.
async function exec(sid, script) {
    const r = await wd('POST', `/session/${sid}/execute/sync`, { script, args: [] }, 20000);
    try {
        const v = JSON.parse(r.body);
        return v.value;
    } catch (e) { return '?(' + r.status + ' ' + String(r.body).slice(0, 160) + ')'; }
}

async function nav(sid, url) {
    try { await wd('POST', `/session/${sid}/url`, { url }, 25000); } catch (e) { /* timeout != failure */ }
}

// Inject an error collector and return what it captured. Must run AFTER the
// page's own scripts (geckodriver cannot fetch browser console logs), so
// it only catches errors raised after injection — pair with interactions.
async function armErrorCollector(sid) {
    return exec(sid, `(window.__diagErrs = window.__diagErrs || [], window.onerror = function(m, s, l) { window.__diagErrs.push(m + ' @' + (s || '?') + ':' + l); }, window.__diagErrs.length)`);
}

async function drainErrors(sid) {
    const n = await exec(sid, `JSON.stringify(window.__diagErrs || [])`);
    return (n && n !== '?(' && n !== '[]') ? JSON.parse(n) : [];
}

async function main() {
    killStale();
    spawn('geckodriver', ['--port', String(GPORT)], { stdio: 'ignore' });
    let up = false;
    for (let i = 0; i < 40; i++) {
        try { await wd('GET', '/status', null, 2000); up = true; break; } catch (e) { await sleep(250); }
    }
    if (!up) throw new Error('geckodriver not up');
    const sid = await newSession();

    // Shared login (probe/lib.js): device + cookie name come from the runtime
    await lib.login(sid);
    const pages = [
        ['shell',    `http://${ROUTER}/cgi-bin/luci/admin/status`],
        ['shell-root', `http://${ROUTER}/cgi-bin/luci/`],
        ['embedded', `http://${ROUTER}/cgi-bin/luci/admin/status?embed=1`],
        ['overview-embedded', `http://${ROUTER}/cgi-bin/luci/admin/status/overview?embed=1`],
        ['network',  `http://${ROUTER}/cgi-bin/luci/admin/network`],
    ];

    async function shot(sid, file) {
        const r = await wd('GET', `/session/${sid}/screenshot`, null, 30000);
        try { fs.writeFileSync(file, Buffer.from(JSON.parse(r.body).value, 'base64')); console.log('shot: ' + file); }
        catch (e) { console.log('shot failed: ' + r.status + ' ' + String(r.body).slice(0, 120)); }
    }

    for (const [label, url] of pages) {
        console.log('\n===== ' + label + ' =====');
        await nav(sid, url);
        await sleep(3500); // let page JS settle
        await shot(sid, `/tmp/diag-${label}.png`);
        console.log('probe title: ' + await exec(sid, 'return document.title'));
        console.log('probe bodyCls:  ' + await exec(sid, 'return document.body.className'));
        console.log('probe bodyLen:  ' + await exec(sid, 'return document.body.innerHTML.length'));
        console.log('probe desktop:  ' + await exec(sid, 'return !!document.getElementById("desktop")'));
        console.log('probe taskbar:  ' + await exec(sid, 'return !!document.getElementById("taskbar")'));
        console.log('probe menu:     ' + await exec(sid, 'return !!document.getElementById("menu")'));
        console.log('probe cfg:      ' + await exec(sid, 'return (document.getElementById("desktop-config") || {}).textContent ? document.getElementById("desktop-config").textContent.length : -1'));
        console.log('probe textLen:  ' + await exec(sid, 'return document.body.innerText.length'));
        console.log('probe text:     ' + await exec(sid, 'return document.body.innerText.slice(0, 400)'));
        console.log('probe loading:  ' + await exec(sid, 'return !!document.querySelector(".loading")'));
        console.log('probe icons:    ' + await exec(sid, 'return document.querySelectorAll(".desktop-icon, .icon, .desktop-app").length'));
        // Post-init error capture + a few interactions to provoke errors
        await armErrorCollector(sid);
        if (label.startsWith('shell')) {
            // 1) Start menu: open it, dump its content
            await exec(sid, `document.getElementById("btn-start").click()`);
            await sleep(800);
            console.log('START-MENU computed: ' + await exec(sid, `return getComputedStyle(document.getElementById("start-menu")).display`));
            console.log('START-MENU visible: ' + await exec(sid, `return document.getElementById("start-menu").offsetParent !== null`));
            console.log('MENU-VARS: ' + await exec(sid, `return getComputedStyle(document.documentElement).getPropertyValue("--startmenu-bg").trim() + "|" + getComputedStyle(document.documentElement).getPropertyValue("--startmenu-fg").trim() + "|" + getComputedStyle(document.documentElement).getPropertyValue("--startmenu-height").trim()`));
            console.log('MENU-STYLE: ' + await exec(sid, `return (function(){var m=document.getElementById("start-menu"); var c=document.querySelector(".menu-category"); var i=document.querySelector(".menu-item"); var s=getComputedStyle(m); var cs=c?getComputedStyle(c):null; var is=i?getComputedStyle(i):null; return "menu:"+s.display+","+s.width+"x"+s.height+" bg="+s.backgroundColor+" | cat:"+(cs?cs.display+","+cs.color:"-")+" | item:"+(is?is.display+","+is.color:"-" )+" | catStyle="+(c?c.getAttribute("style"):"-");})()`));
            console.log('MENU-ITEMS-VIS: ' + await exec(sid, `return (function(){var it=document.querySelectorAll(".menu-item"); var vis=0; for (var i=0;i<it.length;i++){ if (it[i].offsetParent !== null) vis++; } return vis + "/" + it.length;})()`));

            // 2) Click up to 3 menu items (FIRST-VISIBLE in the items panel)
            const menuItems = await exec(sid, `return document.querySelectorAll("#start-menu .menu-item, #start-menu [data-app]").length`);
            console.log('MENU-ITEMS: ' + menuItems);
            const want = Math.min(3, menuItems || 0);
            for (let k = 0; k < want; k++) {
                await exec(sid, `(function(){var m=document.querySelectorAll("#start-menu .menu-item, #start-menu [data-app]"); if (m[${k}]) { m[${k}].click(); return true; } return false;})()`);
                await sleep(3000); // iframe page load
                console.log('  after open ' + (k + 1) + ': windows=' + await exec(sid, `return document.querySelectorAll("#window-container .desktop-window, #window-container > .window, #window-container > div").length`) +
                    ' taskbarBtns=' + await exec(sid, `return document.querySelectorAll("#taskbar-windows .taskbar-window-btn").length`));
            }
            console.log('WINDOWS text: ' + await exec(sid, `return document.getElementById("window-container").textContent.slice(0, 150)`));

            // 3) Taskbar switch: click first button, check focus changed
            const btnCount = await exec(sid, `return document.querySelectorAll("#taskbar-windows .taskbar-window-btn").length`);
            const switched = await exec(sid, `(function(){var b=document.querySelectorAll("#taskbar-windows .taskbar-window-btn"); if (b.length > 1) { b[0].click(); return true; } return false;})()`);
            await sleep(1000);
            console.log('SWITCH btnCount=' + btnCount + ' clicked=' + switched +
                ' focusedWin=' + await exec(sid, `return (function(){var f=document.querySelector(".window.focused"); return f ? f.getAttribute("data-window-id") : "none";})()`) +
                ' windowsState=' + await exec(sid, `return (function(){var o=[]; var ws=document.querySelectorAll("#window-container .window"); for (var i=0;i<ws.length;i++){o.push(ws[i].getAttribute("data-window-id")+(ws[i].classList.contains("focused")?"*":""));} return o.join(",");})()`));
            // 4) What is actually loaded in each open window (start menu "opens wrong" check)
            console.log('WINDOW IFRAMES: ' + await exec(sid, `return (function(){var o=[]; var ws=document.querySelectorAll("#window-container .window iframe"); for (var i=0;i<ws.length;i++){o.push(ws[i].getAttribute("src"));} return o.join(" | ");})()`));
        }
        const errs = await drainErrors(sid);
        console.log('POST-INTERACTION ERRORS: ' + (errs.length ? JSON.stringify(errs) : 'none'));
    }

    await wd('DELETE', '/session/' + sid, null, 5000).catch(() => {});
    killStale();
    console.log('\ndone');
}

main().catch(e => { console.error('FATAL: ' + e.message); killStale(); process.exit(1); });
