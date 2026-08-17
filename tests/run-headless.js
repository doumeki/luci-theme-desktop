#!/usr/bin/env node
/* Desktop Theme — Headless Test Runner (geckodriver + HTTP verdict)
 *
 * Drives plain `firefox --headless` through geckodriver — the official
 * WebDriver layer, which owns the firefox lifecycle (fresh temp profile,
 * session state machine, reliable navigate/execute). The test page is
 * served over loopback http (snap's sandbox can refuse file:// reads
 * outside the profile dir), and the page POSTs its verdict to the runner,
 * so the runner never has to execute anything inside the page.
 */
const { spawn, execSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const THEME_DIR = path.resolve(__dirname, '..');
const GPORT = 4444;   // geckodriver (W3C WebDriver over http)
const HPORT = 8891;   // test page + verdict sink

// ===== Process hygiene =====
// Kill stale *headless* firefox and stray geckodrivers — a leftover
// instance would otherwise shadow our fresh ones. Bracket trick so the
// pattern doesn't match this process's own command line.
function killAll() {
    for (const pat of ['[f]irefox.*--headless', '[g]eckodriver --port']) {
        try { execSync(`pkill -9 -f '${pat}' 2>/dev/null; true`); } catch(e) {}
    }
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        let any = false;
        for (const pat of ['[f]irefox.*--headless', '[g]eckodriver --port']) {
            try { execSync(`pgrep -f '${pat}' 2>/dev/null`); any = true; } catch(e) {}
        }
        // No trailing "; true" — pgrep's exit code IS the signal:
        // no match (rc=1) means nothing stale is left, so return.
        if (!any) return;
        for (const pat of ['[f]irefox.*--headless', '[g]eckodriver --port']) {
            try { execSync(`pkill -9 -f '${pat}' 2>/dev/null; true`); } catch(e) {}
        }
        execSync('sleep 0.2');
    }
    throw new Error('stale firefox/geckodriver cannot be killed, aborting');
}

// ===== Static server + verdict sink =====
// GET /<rel> serves files under the theme dir; POST /__results__ stores the
// page's JSON verdict — the runner waits for this instead of polling the DOM.
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
               '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png' };
let results = null;

const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/__results__') {
        let body = '';
        req.on('data', d => { body += d; if (body.length > 4e6) req.destroy(); });
        req.on('end', () => {
            try { results = JSON.parse(body); } catch (e) { results = { parseError: body.slice(0, 200) }; }
            res.writeHead(204); res.end();
        });
        return;
    }
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    const rel = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, ''));
    const file = path.normalize(path.join(THEME_DIR, rel));
    if (!file.startsWith(THEME_DIR)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
    });
});

// ===== Minimal WebDriver client (http to geckodriver) =====
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
        req.setTimeout(timeoutMs || 30000, () => { req.destroy(new Error('wd timeout: ' + method + ' ' + urlPath)); });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

async function newSession() {
    const r = await wd('POST', '/session', {
        capabilities: { alwaysMatch: {
            pageLoadStrategy: 'none',   // don't wait for load — verdict arrives via POST
            'moz:firefoxOptions': { args: ['--headless'] },   // geckodriver spawns firefox itself
        } },
    }, 90000);
    let v;
    try { v = JSON.parse(r.body); } catch (e) { v = null; }
    if (r.status !== 200 || !v || !v.value || !v.value.sessionId) {
        const msg = v && v.value && v.value.message ? v.value.message : r.body.slice(0, 200);
        throw new Error('geckodriver session failed: ' + msg);
    }
    return v.value.sessionId;
}

// ===== i18n consistency check (dict ↔ template.pot ↔ zh_Hans.po) =====
// Every user-visible msgid must be registered in all three files: the
// runtime zh dict (i18n.js), the translation template and the zh po file.
// A missing registration silently shows English on the desktop — this
// check fails the run instead of deploying untranslated strings.

function readFile(rel) {
    return fs.readFileSync(path.join(THEME_DIR, rel), 'utf8');
}

// Extract `'key': 'value',` pairs from the zh_cn block of i18n.js only
// (the file has other single-quoted strings outside the dict).
function parseDictKeys(src) {
    const start = src.indexOf("'zh_cn': {");
    const end = src.indexOf('};', start);
    const block = src.slice(start, end);
    const keys = new Set();
    const re = /'((?:[^'\\]|\\.)*)':\s*'/g;
    let m;
    while ((m = re.exec(block)) !== null) keys.add(m[1]);
    return keys;
}

function parseMsgids(src) {
    const ids = new Set();
    const re = /^msgid "((?:[^"\\]|\\.)*)"$/gm;
    let m;
    while ((m = re.exec(src)) !== null) {
        // Unescape \" and skip the gettext header entry (msgid "")
        const v = m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        if (v) ids.add(v);
    }
    return ids;
}

function i18nConsistencyCheck() {
    const dict = parseDictKeys(readFile('files/htdocs/js/i18n.js'));
    const pot = parseMsgids(readFile('po/template.pot'));
    const po = parseMsgids(readFile('po/zh_Hans/luci-theme-desktop.po'));

    const diff = (a, b) => [...a].filter(k => !b.has(k)).sort();
    const problems = [];
    const report = (bad, what, rel) => {
        if (bad.length) problems.push(what + ':\n  ' + bad.join('\n  ') + '\n  → ' + rel);
    };
    report(diff(dict, pot), 'in i18n.js dict but missing from template.pot', 'po/template.pot');
    report(diff(pot, dict), 'in template.pot but missing from i18n.js dict', 'files/htdocs/js/i18n.js');
    report(diff(po, pot), 'in zh_Hans.po but missing from template.pot', 'po/template.pot');
    report(diff(pot, po), 'in template.pot but missing from zh_Hans.po', 'po/zh_Hans/luci-theme-desktop.po');

    // UA-injection contract: the footer must set window.__IS_MOBILE__
    // server-side — mobile.js gates on it (falls back to viewport
    // heuristics only when absent). A footer without the injection leaves
    // the mobile shell dead on touch laptops / embedded contexts.
    // Each branch ships ONE footer (Lua footer.htm on master, ucode
    // footer.ut on ucode-native) — check whichever exists.
    for (const rel of ['files/templates/footer.htm',
                       'files/usr/share/ucode/luci/template/themes/desktop/footer.ut']) {
        let src = '';
        try { src = readFile(rel); } catch (e) { continue; }   // branch-specific file
        if (!src.includes('__IS_MOBILE__')) {
            problems.push('footer template missing __IS_MOBILE__ injection (mobile shell dead):\n  → ' + rel);
        }
    }

    // Boot-app contract: a direct visit (bookmark/URL bar) to a NON-landing
    // page must render the full shell AND auto-open that page as an app
    // window — desktop and mobile alike, both branches. The header must
    // only embed on ?embed=1 or unauthenticated (NOT on path alone), and
    // the footer must inject the boot-app path (authenticated + non-empty
    // path). Also: no auto-embed rule on path alone.
    const headerRels = ['files/templates/header.htm',
                        'files/usr/share/ucode/luci/template/themes/desktop/header.ut'];
    const footerRels = ['files/templates/footer.htm',
                        'files/usr/share/ucode/luci/template/themes/desktop/footer.ut'];
    for (const rel of headerRels) {
        let src = '';
        try { src = readFile(rel); } catch (e) { continue; }
        const autoEmbed = src.includes('if (!is_embedded && length(request_path) > 0)') ||
                          src.includes('if not is_embedded and #request > 0');
        if (autoEmbed) {
            problems.push('header still auto-embeds on path alone (no shell/app window for direct visits):\n  → ' + rel);
        }
    }
    let anyBootInjection = false;
    for (const rel of footerRels) {
        let src = '';
        try { src = readFile(rel); } catch (e) { continue; }
        if (src.includes('__DESKTOP_BOOT_APP__')) anyBootInjection = true;
    }
    if (!anyBootInjection) {
        problems.push('footer missing __DESKTOP_BOOT_APP__ injection — direct non-landing visits must open as app windows:\n  → ' + footerRels.join(', '));
    }

    // Runtime-identity contract (merge-plan 0.1.0-125): the footer must
    // inject window.__LUCI_RUNTIME__ ('ucode'|'lua') — desktop.js resolves
    // the Terminal shortcut path from it. A missing injection silently
    // falls back to the Lua path on the ucode track → ttyd 404.
    let anyRuntimeInjection = false;
    for (const rel of footerRels) {
        let src = '';
        try { src = readFile(rel); } catch (e) { continue; }
        if (src.includes('__LUCI_RUNTIME__')) anyRuntimeInjection = true;
    }
    if (!anyRuntimeInjection) {
        problems.push('footer missing __LUCI_RUNTIME__ injection — Terminal shortcut path breaks on one track:\n  → ' + footerRels.join(', '));
    }
    try {
        const desktopSrc = readFile('files/htdocs/js/desktop.js');
        if (!desktopSrc.includes('__LUCI_RUNTIME__')) {
            problems.push('desktop.js must consume __LUCI_RUNTIME__ for the runtime-specific Terminal path:\n  → files/htdocs/js/desktop.js');
        }
    } catch (e) {}

    // Boot-app handling in the front end: shell.js must consume the
    // injected path (open it via WM) — otherwise the header's injection
    // is dead weight.
    try {
        const shellSrc = readFile('files/htdocs/js/shell.js');
        if (!shellSrc.includes('__DESKTOP_BOOT_APP__') || !shellSrc.includes('_handleAppParam')) {
            problems.push('shell.js must consume __DESKTOP_BOOT_APP__ (direct visits open as app windows):\n  → files/htdocs/js/shell.js');
        }
    } catch (e) {}

    if (problems.length) {
        console.log('❌ i18n consistency failed:\n\n' + problems.join('\n\n'));
        process.exit(1);
    }
    console.log('✅ i18n consistency: dict=' + dict.size + ' pot=' + pot.size + ' po=' + po.size + ' aligned');
}

// ===== runtime.lua 双格式规范化单测（tests/lua/test-runtime.lua） =====
// uci:changes() 的数组/dict 格式规范化是历史最高频 bug 区（0.1.0-84 等），
// Lua 侧此前零自动化覆盖。本地 lua5.1 可跑（staging hostpkg 或系统 lua5.1）。
function runLuaRuntimeTests() {
    const { spawnSync } = require('child_process');
    const fs = require('fs');
    const candidates = [
        process.env.LEDE_ROOT + '/staging_dir/hostpkg/bin/lua5.1',
        '/usr/bin/lua5.1', '/usr/bin/lua'
    ];
    let lua = null;
    for (const c of candidates) {
        if (c && fs.existsSync(c)) { lua = c; break; }
    }
    if (!lua) {
        console.log('⚠ lua5.1 not found — skipping tests/lua/test-runtime.lua (set LEDE_ROOT to enable)');
        return;
    }
    const r = spawnSync(lua, ['tests/lua/test-runtime.lua', process.cwd()], { encoding: 'utf8', timeout: 20000 });
    const out = (r.stdout || '') + (r.stderr || '');
    if (r.status === 0) {
        console.log('✅ ' + out.trim().split('\n').pop());
    } else {
        console.log('❌ tests/lua/test-runtime.lua failed (lua=' + lua + '):\n' + out.slice(0, 800));
        process.exit(1);
    }
}

// ===== Run =====
// process.exit() skips finally, so every exit path calls cleanup() first.
let sessionId = null;
function cleanup() {
    if (sessionId) { try { wd('DELETE', '/session/' + sessionId, null, 10000).catch(() => {}); } catch(e) {} }
    try { server.close(); } catch(e) {}
    try { killAll(); } catch(e) {}
}
(async () => {
    try {
        i18nConsistencyCheck();
        runLuaRuntimeTests();
        killAll();
        await new Promise(res => server.listen(HPORT, '127.0.0.1', res));
        console.log('verdict sink on http://127.0.0.1:' + HPORT);

        // geckodriver spawns headless firefox itself (fresh temp profile).
        spawn('geckodriver', ['--port', String(GPORT)], { stdio: 'ignore' });
        // Wait until the driver is ready.
        let ready = false;
        for (let i = 0; i < 30 && !ready; i++) {
            try {
                const r = await wd('GET', '/status', null, 3000);
                if (r.status === 200) ready = true;
            } catch(e) {}
            if (!ready) await new Promise(r => setTimeout(r, 500));
        }
        if (!ready) throw new Error('geckodriver never became ready on :' + GPORT);
        sessionId = await newSession();
        console.log('firefox session ok (geckodriver, headless)');

        // Navigate with retry: a lost response is harmless — the page's
        // verdict arrives via POST, so we just navigate again if it stays
        // silent for a while.
        const URL = 'http://127.0.0.1:' + HPORT + '/tests/js/test-runner.html';
        const deadline = Date.now() + 180000;
        let lastNavAt = 0;
        let navigations = 0;
        while (Date.now() < deadline && !results) {
            if (navigations === 0 || Date.now() - lastNavAt > 12000) {
                lastNavAt = Date.now();
                navigations++;
                try {
                    await wd('POST', '/session/' + sessionId + '/url', { url: URL }, 30000);
                } catch(e) {
                    console.log('  navigate attempt ' + navigations + ' lost its response — will retry');
                }
            }
            await new Promise(r => setTimeout(r, 2000));
        }

        if (!results) {
            // Final diagnostic: see what the page actually shows.
            try {
                const d = await wd('POST', '/session/' + sessionId + '/execute/sync',
                    { script: 'return document.title + " | " + (document.body ? document.body.innerText : "").substring(0, 200)', args: [] }, 8000);
                const v = JSON.parse(d.body);
                console.log('⚠ page state: ' + String(v.value).substring(0, 300));
            } catch(e) { console.log('⚠ (diagnostic execute also failed: ' + e.message + ')'); }
            console.log('⚠ Tests never reported (navigations=' + navigations + ')');
            cleanup();
            process.exit(1);
        }

        const r = results;
        const label = r.passed + '/' + r.total + ' passed' + (r.failed ? ' | FAIL: ' + (r.failures || []).join(', ') : '');
        if (r.failed) {
            console.log('❌ Tests: ' + label);
            (r.details || []).forEach(d => console.log('• ' + d.name + ' => ' + d.msg));
            cleanup();
            process.exit(1);
        }
        console.log('✅ Tests: ' + label);
        cleanup();
        process.exit(0);
    } catch(e) {
        console.log('⚠ Runner error: ' + e.message);
        cleanup();
        process.exit(1);
    } finally {
        cleanup();
    }
})();
