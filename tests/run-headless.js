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

    // Lua-CBI Save&Apply compat contract (0.1.0-210+): the interceptor +
    // apply-pending logic lives in files/htdocs/js/cbi-compat.js (single
    // source — both header branches must include it) and must keep the
    // invariants that make legacy Lua CBI saves work inside the embed
    // shell — without them old-style buttons submit embed-less and the
    // pending apply never fires (config silently not saved).
    const compatRel = 'files/htdocs/js/cbi-compat.js';
    let compatSrc = null;
    try { compatSrc = readFile(compatRel); } catch (e) {}
    for (const rel of headerRels) {
        let src = '';
        try { src = readFile(rel); } catch (e) { continue; }
        if (!src.includes('js/cbi-compat.js')) {
            problems.push('header must include cbi-compat.js (Lua CBI Save&Apply compat):\n  → ' + rel);
        }
    }
    if (!compatSrc) {
        problems.push('missing ' + compatRel);
    }
    else {
        const need = [
            ['old-style button recognition (onclick contains cbi.apply)', /oc\.indexOf\('cbi\.apply'\)/],
            ['class-independent fallback uses the EXACT compat call pattern (no hijack)', /cbi_submit\(this, 'cbi\.apply'\)/],
            ['native onclick suppression (stopPropagation gated on nameless buttons)', /if \(!btn\.name\)[\s\S]{0,200}e\.stopPropagation\(\)/],
            ['apply-pending flag (sessionStorage)', /sessionStorage\.setItem\('desktop-apply-pending'[^)]*\)/],
            ['apply-pending trigger (luci-loaded + poll fallback)', /document\.addEventListener\('luci-loaded'[\s\S]{0,200}setInterval/],
            ['apply dedupe wrapper (concurrent apply_rollback → Permission denied)', /__desktopDeduped/],
            ['apply dedupe window (8s)', /now - _last < 8000/],
        ];
        for (const [what, re] of need) {
            if (!re.test(compatSrc)) {
                problems.push('cbi-compat.js missing: ' + what + '\n  → ' + compatRel);
            }
        }
    }

    // Shipped-file permission contract (0.1.0-212): the build copies
    // files/ as-is (CP -a) — a 0600 file (or 0700 dir) ships to the router
    // and uhttpd refuses to serve it (403) with NO page error (JS silently
    // missing → interceptor dead → old-style Lua CBI saves break). Every
    // shipped regular file must be group/other-readable and every shipped
    // directory group/other-searchable (uhttpd serves as a non-owner
    // identity; owner-only bits still 403 — 0.1.0-212 实锤).
    (function walkShipped(dir) {
        let st;
        try { st = fs.statSync(path.join(THEME_DIR, dir)); } catch (e) { return; }
        if ((st.mode & 0o011) === 0) {
            problems.push('shipped dir not group/other-searchable (uhttpd 403 on device, silent JS loss):\n  → ' + dir + ' (mode ' + (st.mode & 0o777).toString(8) + ')');
        }
        let entries;
        try { entries = fs.readdirSync(path.join(THEME_DIR, dir), { withFileTypes: true }); } catch (e) { return; }
        for (const en of entries) {
            const rel = dir + '/' + en.name;
            let mode;
            try { mode = fs.statSync(path.join(THEME_DIR, rel)).mode; } catch (e) { continue; }
            if (en.isDirectory()) walkShipped(rel);
            else if (en.isFile() && (mode & 0o044) === 0) {
                problems.push('shipped file not group/other-readable (uhttpd 403 on device, silent JS loss):\n  → ' + rel + ' (mode ' + (mode & 0o777).toString(8) + ')');
            }
        }
    })('files');

    // uci_changes session-first contract (0.1.0-208): Lua CBI / client
    // saves key their pending deltas by the login session — an anonymous
    // query returns count 0 and the tray never shows "Unsaved Changes".
    // The endpoint must query with the session from the cookie and only
    // fall back to the anonymous cursor when denied.
    try {
        const ctlSrc = readFile('files/controller/desktop.lua');
        if (!ctlSrc.includes('set_session_id') || !ctlSrc.includes('getcookie(Runtime.cookieName())')) {
            problems.push('action_uci_changes must query with the session (session-keyed pending — see HANDOVER §9.6):\n  → files/controller/desktop.lua');
        }
    } catch (e) {}

    // Progressive app rendering (0.1.0-215): the window loading hint must
    // stay a small non-blocking chip. As an opaque inset:0 overlay it hid
    // the app that had ALREADY painted until the load event (which waits
    // for every subresource) — a slow app like firewall then looked like it
    // "appears all at once", and tabs already rendered were unclickable.
    try {
        const css = readFile('files/htdocs/css/window.css');
        const block = /\.window-loading\s*\{([^}]*)\}/.exec(css);
        if (!block || /inset:\s*0/.test(block[1]) || !/pointer-events:\s*none/.test(block[1])) {
            problems.push('window-loading must be a non-blocking floating hint (no inset:0 full overlay, needs pointer-events:none):\n  → files/htdocs/css/window.css');
        }
    } catch (e) {}

    // Every literal passed to _('...') in the front-end must be in the
    // dict — the three-way check above only proves the FILES agree with
    // each other, so a string used in code but never registered silently
    // renders English on the desktop.
    try {
        const jsFiles = [];
        (function walkJs(d) {
            fs.readdirSync(d, { withFileTypes: true }).forEach(function(en) {
                const rel = d + '/' + en.name;
                if (en.isDirectory()) walkJs(rel);
                else if (en.name.slice(-3) === '.js') jsFiles.push(rel);
            });
        })(path.join(THEME_DIR, 'files/htdocs/js'));
        const missing = new Set();
        jsFiles.forEach(function(f) {
            const src = fs.readFileSync(f, 'utf8');
            const re = /\b_\(\s*'((?:[^'\\]|\\.)*)'\s*\)/g;
            let m;
            while ((m = re.exec(src)) !== null) {
                // Ignore examples inside comments (doc headers use
                // _('English string') as illustration).
                const lineStart = src.lastIndexOf('\n', m.index) + 1;
                const before = src.slice(lineStart, m.index);
                if (before.indexOf('//') !== -1 || /^\s*\*/.test(before)) continue;
                const key = m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
                // Punctuation-only placeholders (e.g. _('...') as a loading
                // label) carry nothing to translate.
                if (!key || !/[A-Za-z\u4e00-\u9fff]/.test(key)) continue;
                if (!dict.has(key)) missing.add(key);
            }
        });
        if (missing.size) {
            problems.push('_() strings missing from the i18n dict (UI would show English):\n  ' +
                [...missing].sort().join('\n  ') + '\n  → files/htdocs/js/i18n.js');
        }
    } catch (e) {}

    // Dual-template asset sync: an asset linked by only one header branch
    // is invisible on the other LuCI runtime (the classic dual-template
    // bug, previously only guarded for cbi-compat.js).
    try {
        const grab = function(src, re) {
            const out = new Set();
            let m;
            while ((m = re.exec(src)) !== null) out.add(m[1]);
            return out;
        };
        const htm = readFile('files/templates/header.htm');
        const ut  = readFile('files/usr/share/ucode/luci/template/themes/desktop/header.ut');
        [['css', /href="[^"]*\/css\/([A-Za-z0-9_.-]+\.css)/g],
         ['js',  /src="[^"]*\/js\/([A-Za-z0-9_.-]+\.js)/g]].forEach(function(pair) {
            const label = pair[0];
            const a = grab(htm, new RegExp(pair[1].source, 'g'));
            const b = grab(ut, new RegExp(pair[1].source, 'g'));
            const onlyHtm = [...a].filter(x => !b.has(x));
            const onlyUt  = [...b].filter(x => !a.has(x));
            if (onlyHtm.length || onlyUt.length) {
                problems.push('header ' + label + ' assets out of sync (.htm vs .ut):\n' +
                    (onlyHtm.length ? '  only in header.htm: ' + onlyHtm.join(', ') + '\n' : '') +
                    (onlyUt.length ? '  only in header.ut: ' + onlyUt.join(', ') + '\n' : '') +
                    '  → files/templates/header.htm + .../header.ut');
            }
        });
    } catch (e) {}

    if (problems.length) {
        console.log('❌ i18n consistency failed:\n\n' + problems.join('\n\n'));
        process.exit(1);
    }
    console.log('✅ i18n consistency: dict=' + dict.size + ' pot=' + pot.size + ' po=' + po.size + ' aligned');
}

// ===== i18n single-source drift check (0.1.0-230) =====
// po/template.pot + po/zh_Hans/luci-theme-desktop.po are GENERATED from the
// zh_cn dict by tools/gen-i18n.js. i18nConsistencyCheck above only proves the
// three files agree on the msgid SET; this one proves the two generated files
// still match what the generator would write right now — a dict edit without
// a regeneration otherwise ships the old catalog silently (the exact bug the
// single-source refactor removes).
function i18nDriftCheck() {
    let gen;
    try { gen = require(path.join(THEME_DIR, 'tools/gen-i18n.js')); }
    catch (e) {
        console.log('❌ cannot load tools/gen-i18n.js: ' + e.message);
        process.exit(1);
    }
    const r = gen.generate();
    const stale = [];
    [['po/template.pot', r.pot], ['po/zh_Hans/luci-theme-desktop.po', r.po]].forEach(function(pair) {
        let disk = '';
        try { disk = readFile(pair[0]); } catch (e) {}
        if (disk !== pair[1]) stale.push('  ' + pair[0]);
    });
    if (stale.length) {
        console.log('❌ i18n catalog is stale (dict changed without regeneration):\n' +
            stale.join('\n') + '\n  → run `node tools/gen-i18n.js`');
        process.exit(1);
    }
    console.log('✅ i18n catalog: pot/po match the dict (no drift)');
}

// ===== widget inline-style contract (0.1.0-230) =====
// Widget render must be idempotent: static presentation lives in widget.css
// (`.widget-sticky-note …`), only DYNAMIC values may touch inline styles (or
// better, a CSS custom property). Appending to el.style.cssText made a
// re-render grow the inline style string without bound (sticky-note bug:
// style drift, width overrides, hard to debug). Comments are stripped so the
// rationale comments in the widget sources don't trip the check.
function stripJsComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

function widgetStyleContractCheck() {
    const dir = path.join(THEME_DIR, 'files/htdocs/js/widgets');
    const bad = [];
    try {
        fs.readdirSync(dir).filter(function(f) { return f.slice(-3) === '.js'; })
            .forEach(function(f) {
                const src = stripJsComments(fs.readFileSync(path.join(dir, f), 'utf8'));
                if (/\.style\.cssText/.test(src)) bad.push(f);
            });
    } catch (e) {
        console.log('❌ cannot scan files/htdocs/js/widgets: ' + e.message);
        process.exit(1);
    }
    if (bad.length) {
        console.log('❌ widget renders must not touch el.style.cssText (render must be idempotent):\n  ' +
            bad.join('\n  ') + '\n  → move static styles into files/htdocs/css/widget.css, keep only\n' +
            '    dynamic values inline or as CSS custom properties (--var)');
        process.exit(1);
    }
    console.log('✅ widget inline-style contract: static styles are CSS-driven');
}

// ===== context-submenu hover grace (0.1.0-235) =====
// The "New -> Link" flyout is separated from its row by a 4px gap. Closing it
// the instant the pointer leaves the row made it unreachable: the submenu was
// gone before the mouse arrived (user-reported). The fix is CSS-only (no JS
// state to keep in sync), so guard the declarations that implement it — a
// later "cleanup" back to display:none would silently restore the bug.
function submenuHoverGraceCheck() {
    const rel = 'files/htdocs/css/shell.css';
    let src = '';
    try { src = readFile(rel); }
    catch (e) { console.log('❌ missing ' + rel); process.exit(1); }
    src = src.replace(/\/\*[\s\S]*?\*\//g, '');   // comments mention display:none by name
    const base = (/\n\.context-submenu\s*\{([^}]*)\}/.exec(src) || [])[1];
    const reveal = (/\n\.context-has-sub:hover > \.context-submenu,[\s\S]*?\{([^}]*)\}/.exec(src) || [])[1];
    const problems = [];
    const timeToMs = function(v) {
        const m = /^(\d*\.?\d+)(ms|s)$/.exec(v.trim());
        return m ? parseFloat(m[1]) * (m[2] === 's' ? 1000 : 1) : 0;
    };

    if (!base) problems.push('.context-submenu base rule not found');
    else {
        if (/display\s*:\s*none/.test(base))
            problems.push('.context-submenu is display:none again — a hidden box cannot stay hit-testable for the grace period');
        if (!/visibility\s*:\s*hidden/.test(base))
            problems.push('.context-submenu base rule must hide via visibility:hidden');
        const t = (/transition\s*:([^;]*)/.exec(base) || [])[1] || '';
        const times = t.match(/(?:\d*\.)?\d+(?:ms|s)\b/g) || [];
        const delay = times.length ? timeToMs(times[times.length - 1]) : 0;
        if (!/visibility/.test(t) || delay < 100)
            problems.push('.context-submenu hide must be delayed (transition: visibility 0s linear <delay>) — got "' + t.trim() + '"');
    }
    if (!reveal) problems.push('.context-has-sub:hover/.open reveal rule not found');
    else {
        if (!/visibility\s*:\s*visible/.test(reveal))
            problems.push('the reveal rule must set visibility:visible');
        if (!/transition\s*:\s*none/.test(reveal))
            problems.push('the reveal must NOT be delayed (transition:none) — only the hide gets the grace');
    }

    if (problems.length) {
        console.log('❌ context submenu hover grace contract failed:\n  ' + problems.join('\n  ') +
            '\n  → the flyout sits 4px away from its row; without a hide delay it closes\n' +
            '    before the pointer can cross the gap (0.1.0-235 regression)');
        process.exit(1);
    }
    console.log('✅ context submenu: hide delayed 200ms, show instant (hover grace)');
}

// ===== test-file manifest check (0.1.0-230) =====
// tests/js/test-runner.html carries the ordered <script src="*.test.js"> list.
// A test file that exists on disk but is not listed silently never runs — the
// failure mode the AGENTS.md rule warns about. The runner now verifies the
// list against the directory instead of trusting it: extra, missing and
// duplicated entries all fail with the exact file names to add/remove.
function testManifestCheck() {
    const RUNNER_HTML = 'tests/js/test-runner.html';
    const dir = path.join(THEME_DIR, 'tests/js');
    let onDisk = [];
    try {
        onDisk = fs.readdirSync(dir).filter(function(f) { return /\.test\.js$/.test(f); }).sort();
    } catch (e) {
        console.log('❌ cannot read tests/js: ' + e.message);
        process.exit(1);
    }
    let html = '';
    try { html = readFile(RUNNER_HTML); }
    catch (e) {
        console.log('❌ missing ' + RUNNER_HTML);
        process.exit(1);
    }
    const registered = [];
    const re = /<script src="([^"]+\.test\.js)"><\/script>/g;
    let m;
    while ((m = re.exec(html)) !== null) registered.push(m[1]);

    const regSet = new Set(registered);
    const diskSet = new Set(onDisk);
    const notRegistered = onDisk.filter(function(f) { return !regSet.has(f); });
    const notExisting = registered.filter(function(f) { return !diskSet.has(f); });
    const dupes = registered.filter(function(f, i) { return registered.indexOf(f) !== i; });

    const problems = [];
    if (notRegistered.length) {
        problems.push('test file(s) on disk but NOT registered in ' + RUNNER_HTML +
            ' (they would silently never run):\n  add: ' + notRegistered.join('\n  add: '));
    }
    if (notExisting.length) {
        problems.push('registered in ' + RUNNER_HTML + ' but missing on disk:\n  remove: ' +
            notExisting.join('\n  remove: '));
    }
    if (dupes.length) {
        problems.push('registered more than once: ' + [...new Set(dupes)].join(', '));
    }
    if (problems.length) {
        console.log('❌ test manifest mismatch:\n\n' + problems.join('\n\n') + '\n  → ' + RUNNER_HTML);
        process.exit(1);
    }
    console.log('✅ test manifest: ' + onDisk.length + ' test files, all registered');
}

// ===== sensitive-information scan (public-file gate) =====
// The theme repo is published to a public remote and the L1 workflow has no
// secret scanning of its own, so one careless commit of a real device
// address / credential / private-key path is irreversible. This gate walks
// every file that WOULD be published (SECRET_SCAN_SCOPE_* minus gitignored
// and explicitly internal files) and fails on SECRET_SCAN_RULES.
//
// Findings print `file:line [rule] <masked>` — the matched value is NEVER
// shown in clear text, because CI logs are public too. A confirmed false
// positive is exempted NARROWLY, never by disabling the gate:
//   * inline on the offending line:  // secret-scan-allow: <rule-id>
//     (comma-separated ids, or `*` for the whole line); or
//   * an entry in SECRET_SCAN_ALLOW below.
const SECRET_SCAN_ALLOW = [
    // { file: 'files/htdocs/js/example.js', rule: 'ipv4', why: 'SVG path data' },
];
const SECRET_SCAN_SCOPE_DIRS = ['files', 'tests', 'tools', 'probe'];
const SECRET_SCAN_SCOPE_FILES = ['Makefile', '.gitignore', 'AGENTS.md', 'tests/README.md'];
// Internal / machine-local — never published. probe/.local-env holds the real
// values on purpose (it is gitignored); probe/.local-env.example is the public
// template and IS scanned (placeholders only).
const SECRET_SCAN_EXCLUDE = ['HANDOVER.md', 'probe/.local-env', 'BRANCH-DIFF.md'];
const SECRET_SCAN_BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico',
    '.bmp', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.pdf', '.zip', '.gz', '.xz',
    '.tar', '.ipk', '.apk', '.so', '.mo', '.bin']);

function secretScanMask(s) {
    s = String(s);
    if (s.length <= 4) return '***';
    if (s.length <= 8) return s.slice(0, 2) + '***' + s.slice(-1);
    return s.slice(0, 3) + '***' + s.slice(-2);
}

// A real credential must leave a non-trivial literal after variable
// references and scheme words are removed — `token $GITHUB_TOKEN`, `${VAR}`,
// `<placeholder>`, `xxx`, `***`, `REPLACE` and `example` all drop out.
function secretScanLooksReal(v) {
    if (!v) return false;
    const s = String(v).trim();
    if (!s) return false;
    if (/^<.*>$/.test(s)) return false;
    if (/^\$\{[^}]*\}$/.test(s) || /^\$\(.*\)$/.test(s) || /^\$[A-Za-z_][A-Za-z0-9_]*$/.test(s)) return false;
    if (/^(?:x{3,}|\*+|REPLACE(?:_ME)?|CHANGE_?ME|example|dummy|your[-_].*)$/i.test(s)) return false;
    // `token = string.format(...)` / `secret = foo.bar` are calls, not literals.
    if (/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(s)) return false;
    const rest = s
        .replace(/\$\{[^}]*\}/g, ' ').replace(/\$\([^)]*\)/g, ' ')
        .replace(/\$[A-Za-z_][A-Za-z0-9_]*/g, ' ')
        .replace(/\b(?:bearer|token|authorization|basic)\b/gi, ' ');
    const runs = rest.match(/[A-Za-z0-9!@#$%^&*_+=.\/~-]{8,}/g) || [];
    return runs.some(function(t) {
        return /[0-9]/.test(t) || /[A-Z]/.test(t) || /[^A-Za-z0-9]/.test(t) || t.length >= 16;
    });
}

const SECRET_SCAN_RULES = [
    {
        id: 'ipv4',
        re: /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![\d.])/g,
        allow: function(ip) {
            return ip === '127.0.0.1' || ip === '0.0.0.0' || ip === '255.255.255.255' ||
                /^(?:192\.0\.2|198\.51\.100|203\.0\.113)\./.test(ip);
        },
    },
    {
        id: 'private-key',
        // Concatenated so this file never contains the literal header itself.
        re: new RegExp('-----BEGIN' + '(?: [A-Z0-9]+)* PRIVATE KEY-----' +
            '|\\bid_(?:rsa|dsa|ecdsa|ed25519|ed\\d+)\\b', 'g'),
    },
    {
        id: 'credential',
        re: /\b(password|passwd|pass|token|secret|apikey|api_key|bearer|authorization)\b\s*[:=]\s*(?:(["'`])([^"'`\n]{1,200})\2|([^\s"'`{[(<$,;)]{1,200}))/gi,
        value: function(m) { return m[3] !== undefined ? m[3] : m[4]; },
        looksReal: secretScanLooksReal,
    },
    {
        id: 'internal-host',
        re: /\b[a-z0-9][a-z0-9-]*\.(?:wrt\.com|wrt\.local)\b/gi,
    },
];

// Inline opt-out: `// secret-scan-allow: ipv4` exempts that single line.
function secretScanLineMarker(line) {
    const m = /secret-scan-allow:\s*([A-Za-z0-9_*, -]+)/.exec(line);
    if (!m) return new Set();
    return new Set(m[1].split(/[,\s]+/).filter(Boolean));
}

// Allowlist opt-out: 'path:rule' or { file, rule } exempts a whole file/rule.
function secretScanAllowed(rel, ruleId) {
    return SECRET_SCAN_ALLOW.some(function(a) {
        const parts = typeof a === 'string' ? a.split(':') : null;
        const file = parts ? parts[0] : a.file;
        const rule = parts ? parts[1] : a.rule;
        return file === rel && (!rule || rule === '*' || rule === ruleId);
    });
}

function secretScanPublicFiles() {
    const raw = [];
    const add = function(rel) {
        if (SECRET_SCAN_EXCLUDE.indexOf(rel) !== -1) return;
        if (SECRET_SCAN_BINARY_EXT.has(path.extname(rel).toLowerCase())) return;
        raw.push(rel);
    };
    SECRET_SCAN_SCOPE_FILES.forEach(function(rel) {
        let st;
        try { st = fs.statSync(path.join(THEME_DIR, rel)); } catch (e) { return; }
        if (st.isFile()) add(rel);
    });
    SECRET_SCAN_SCOPE_DIRS.forEach(function(dir) {
        (function walk(d, rel) {
            let entries;
            try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
            entries.forEach(function(en) {
                if (en.isDirectory()) walk(path.join(d, en.name), rel + '/' + en.name);
                else if (en.isFile()) add(rel + '/' + en.name);
            });
        })(path.join(THEME_DIR, dir), dir);
    });
    // Gitignored helpers are machine-local and never pushed — skip them. When
    // git is unavailable the explicit exclusion list above still applies.
    const ignored = new Set();
    try {
        const { spawnSync } = require('child_process');
        const r = spawnSync('git', ['-C', THEME_DIR, 'check-ignore', '--stdin'],
            { input: raw.join('\n'), encoding: 'utf8' });
        if (r.status === 0) {
            String(r.stdout || '').split('\n').forEach(function(p) {
                p = p.trim();
                if (p) ignored.add(p.replace(/^\.\//, ''));
            });
        }
    } catch (e) {}
    return raw.filter(function(rel) { return !ignored.has(rel); });
}

// Real values/domains from the gitignored local env must not appear in any
// published file. The value itself is never echoed — only its key name.
function secretScanLocalEnvNeedles() {
    let raw = '';
    try { raw = fs.readFileSync(path.join(THEME_DIR, 'probe/.local-env'), 'utf8'); }
    catch (e) { return { values: [], domains: [] }; }
    const values = [];
    raw.split('\n').forEach(function(line) {
        const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
        if (!m) return;
        const key = m[1];
        const val = m[2].trim().replace(/^["']|["']$/g, '');
        if (!val || key === 'PATH' || val.length < 6) return;
        values.push({ key: key, val: val });
    });
    const publicDomains = /^(?:github\.com|githubusercontent\.com|gist\.github\.com|openwrt\.org|apache\.org|mozilla\.org|example\.(?:com|org|net)|w3\.org|gnu\.org)$/i;
    const plausibleTld = /(?:^|\.)(?:com|net|org|edu|gov|io|dev|info|biz|cn|local|lan|internal|home|corp|intranet|wrt)$/;
    const domains = [];
    // Case-sensitive: keeps identifiers such as `http.extraHeader` out.
    (raw.match(/\b(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]*\b/g) || []).forEach(function(d) {
        if (!plausibleTld.test(d) || publicDomains.test(d)) return;
        if (domains.indexOf(d) === -1) domains.push(d);
    });
    return { values: values, domains: domains };
}

function secretScanCheck() {
    const allFiles = secretScanPublicFiles();
    const findings = [];
    allFiles.forEach(function(rel) {
        let src;
        try { src = fs.readFileSync(path.join(THEME_DIR, rel), 'utf8'); } catch (e) { return; }
        const lines = src.split('\n');
        SECRET_SCAN_RULES.forEach(function(rule) {
            if (secretScanAllowed(rel, rule.id)) return;
            lines.forEach(function(line, i) {
                const marker = secretScanLineMarker(line);
                if (marker.has('*') || marker.has(rule.id)) return;
                rule.re.lastIndex = 0;
                let m;
                while ((m = rule.re.exec(line)) !== null) {
                    if (!m[0]) { rule.re.lastIndex++; continue; }
                    // An address wrapped in angle brackets is a placeholder.
                    if (line[m.index - 1] === '<' && line[m.index + m[0].length] === '>') continue;
                    const value = rule.value ? rule.value(m) : m[0];
                    if (!value) continue;
                    if (rule.allow && rule.allow(value)) continue;
                    if (rule.looksReal && !rule.looksReal(value)) continue;
                    findings.push({ file: rel, line: i + 1, rule: rule.id, value: value });
                }
            });
        });
    });
    const needles = secretScanLocalEnvNeedles();
    allFiles.forEach(function(rel) {
        let src;
        try { src = fs.readFileSync(path.join(THEME_DIR, rel), 'utf8'); } catch (e) { return; }
        const allowValue = secretScanAllowed(rel, 'local-env-value');
        const allowDomain = secretScanAllowed(rel, 'local-env-domain');
        src.split('\n').forEach(function(line, i) {
            const marker = secretScanLineMarker(line);
            const wildcard = marker.has('*');
            if (!allowValue && !wildcard && !marker.has('local-env-value')) {
                needles.values.forEach(function(n) {
                    if (line.indexOf(n.val) !== -1) {
                        findings.push({ file: rel, line: i + 1, rule: 'local-env-value', value: n.val, note: n.key });
                    }
                });
            }
            if (!allowDomain && !wildcard && !marker.has('local-env-domain')) {
                needles.domains.forEach(function(d) {
                    const re = new RegExp('\\b' + d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
                    if (re.test(line)) findings.push({ file: rel, line: i + 1, rule: 'local-env-domain', value: d });
                });
            }
        });
    });

    const seen = new Set();
    const uniq = findings.filter(function(f) {
        const k = f.file + ':' + f.line + ':' + f.rule + ':' + f.value;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
    if (uniq.length) {
        console.log('❌ secret scan failed: ' + uniq.length + ' finding(s) in files that would be published:\n');
        uniq.forEach(function(f) {
            console.log('  ' + f.file + ':' + f.line + '  [' + f.rule + ']  ' + secretScanMask(f.value) +
                (f.note ? '  (' + f.note + ')' : ''));
        });
        console.log('\n  (values masked on purpose — CI logs are public)\n' +
            '  Confirmed false positive? Exempt it narrowly:\n' +
            '    * inline on that line:  // secret-scan-allow: <rule-id>\n' +
            '    * or an entry in SECRET_SCAN_ALLOW at the top of tests/run-headless.js');
        process.exit(1);
    }
    console.log('✅ secret scan: ' + allFiles.length + ' public files, no device addresses/credentials');
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
// Static gates are usable on their own (the browser part needs geckodriver):
//   node -e "require('./tests/run-headless.js').secretScanCheck()"
module.exports = { secretScanCheck: secretScanCheck, submenuHoverGraceCheck: submenuHoverGraceCheck };

if (require.main === module) (async () => {
    try {
        secretScanCheck();
        i18nConsistencyCheck();
        i18nDriftCheck();
        widgetStyleContractCheck();
        submenuHoverGraceCheck();
        testManifestCheck();
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
