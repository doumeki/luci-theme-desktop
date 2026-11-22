'use strict';
/* Static asset contract for the theme's own CSS.
 *
 * A theme is installed at /luci-static/desktop/, so:
 *   url(/luci-static/desktop/x)  -> must exist at files/htdocs/x
 *   url(../img/x)                -> resolved relative to files/htdocs/css/
 *   url(/luci-static/resources/...)  -> luci-base ships it, allowlisted
 *   url(/luci-static/<other>/...)    -> cross-theme reference: the asset is
 *                                       not in this package, so it 404s unless
 *                                       that other theme happens to be installed.
 *
 * The q699 case: nine rules pointed at /luci-static/argon/img/*.webp. Neither
 * the fork nor the vendored argon package ships those files, so every one of
 * them was a 404 that only showed up as "icon missing" in the browser.
 */
const fs = require('fs');
const path = require('path');

const THEME_ROOT = path.join(__dirname, '..');
const HTDOCS = path.join(THEME_ROOT, 'files', 'htdocs');
const CSS_DIR = path.join(HTDOCS, 'css');
const THEME = 'desktop';

function cssFiles() {
    try {
        return fs.readdirSync(CSS_DIR).filter(f => f.slice(-4) === '.css')
            .map(f => path.join(CSS_DIR, f));
    } catch (e) {
        return [];
    }
}

function urlsIn(file) {
    const src = fs.readFileSync(file, 'utf8');
    const out = [];
    const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
    let m;
    while ((m = re.exec(src))) {
        const before = src.slice(0, m.index);
        out.push({ u: m[2].trim(), line: before.split('\n').length });
    }
    return out;
}

function classify(u) {
    if (/^(data:|#|https?:|blob:|\/\/)/i.test(u)) return { kind: 'skip' };
    const clean = u.split('?')[0].split('#')[0];
    if (clean.indexOf('/luci-static/') === 0) {
        const m = /^\/luci-static\/([^/]+)\/(.+)$/.exec(clean);
        if (!m) return { kind: 'bad' };
        const theme = m[1], rest = m[2];
        if (theme === 'resources') return { kind: 'luci-base' };
        if (theme === THEME) {
            const local = path.join(HTDOCS, rest);
            return fs.existsSync(local) ? { kind: 'ok' } : { kind: 'missing', local };
        }
        return { kind: 'cross-theme', theme: theme };
    }
    const local = path.resolve(CSS_DIR, clean);
    return fs.existsSync(local) ? { kind: 'ok' } : { kind: 'missing', local };
}

function run() {
    const files = cssFiles();
    const problems = [];
    let refs = 0, luciBase = 0;
    for (const f of files) {
        for (const r of urlsIn(f)) {
            const c = classify(r.u);
            if (c.kind === 'skip') continue;
            refs++;
            if (c.kind === 'luci-base') { luciBase++; continue; }
            if (c.kind === 'ok') continue;
            problems.push({
                file: path.basename(f), line: r.line, url: r.u, kind: c.kind,
                detail: c.kind === 'cross-theme'
                    ? 'points into /luci-static/' + c.theme + '/ - not shipped by this package'
                    : 'missing local asset: ' + path.relative(THEME_ROOT, c.local || '')
            });
        }
    }

    /* Only a var() WITHOUT a fallback must be defined: `var(--x, #fff)` is a
       deliberate optional hook and degrades on its own. A bare `var(--x)` that
       nobody provides computes to `unset` (for color: inherit) - which is how
       --dark_webkit-any-link made every dark-mode link look like body text. */
    const defined = new Set();
    const used = [];
    for (const f of files) {
        const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        for (const m of src.matchAll(/(^|[\s;{])(--[A-Za-z0-9_-]+)\s*:/g)) defined.add(m[2]);
        for (const m of src.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*\)/g)) {
            used.push({ file: path.basename(f), line: src.slice(0, m.index).split('\n').length, name: m[1] });
        }
    }
    /* Variables written by the theme's own JS/templates are part of the
       contract too (theme-config.js, widget.js, color_calc-argon.js). Scan
       those sources so a runtime-provided name is not reported as missing. */
    function runtimeVars() {
        const set = new Set();
        const walk = (dir) => {
            let entries = [];
            try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
            for (const en of entries) {
                const p = path.join(dir, en.name);
                if (en.isDirectory()) { walk(p); continue; }
                if (!/\.(js|ut|htm)$/.test(en.name)) continue;
                const src = fs.readFileSync(p, 'utf8');
                for (const m of src.matchAll(/--[A-Za-z0-9_-]+/g)) set.add(m[0]);
            }
        };
        walk(path.join(THEME_ROOT, 'files', 'htdocs', 'js'));
        walk(path.join(THEME_ROOT, 'files', 'usr', 'share', 'ucode', 'luci', 'template', 'themes', THEME));
        walk(path.join(THEME_ROOT, 'files', 'templates'));
        return set;
    }
    const runtime = runtimeVars();

    /* Vars supplied by luci-base at runtime may be added here, deliberately. */
    const KNOWN_EXTERNAL = new Set([]);
    const varsChecked = used.length;
    for (const u of used) {
        if (defined.has(u.name) || runtime.has(u.name) || KNOWN_EXTERNAL.has(u.name)) continue;
        problems.push({
            file: u.file, line: u.line, url: 'var(' + u.name + ')', kind: 'undefined-var',
            detail: 'custom property is neither defined in CSS nor written by the theme JS/templates'
        });
    }

    return { files: files.length, refs: refs, luciBase: luciBase, vars: varsChecked, problems: problems };
}

module.exports = { run };

if (require.main === module) {
    const r = run();
    console.log('assets: ' + r.files + ' css, ' + r.refs + ' refs (' + r.luciBase + ' luci-base), ' +
        r.vars + ' css vars, ' + r.problems.length + ' problem(s)');
    for (const p of r.problems) console.log('  ' + p.kind.toUpperCase() + ' ' + p.file + ':' + p.line + '  ' + p.url + '\n    ' + p.detail);
    process.exit(r.problems.length ? 1 : 0);
}
