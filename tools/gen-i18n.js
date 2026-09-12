#!/usr/bin/env node
/* gen-i18n.js — generate po/template.pot + po/zh_Hans/luci-theme-desktop.po
 * from the runtime dictionary in files/htdocs/js/i18n.js.
 *
 * The zh_cn dict is the SINGLE SOURCE OF TRUTH for user-visible strings:
 * msgid  = the dict key (English source text)
 * msgstr = the dict value (Simplified Chinese)
 *
 * Editing a string therefore means: change the dict, run this script.
 * `node tests/run-headless.js` re-renders both files in memory and fails
 * when the copies on disk drift from the dict — so a stale pot/po can no
 * longer slip through (previously three hand-maintained lists: dict, pot
 * and po; a string changed in one place only silently showed English).
 *
 * Usage:
 *   node tools/gen-i18n.js           # write both files
 *   node tools/gen-i18n.js --check   # verify disk == generated (exit 1 if not)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const THEME_DIR = path.resolve(__dirname, '..');
const I18N_JS = 'files/htdocs/js/i18n.js';
const POT = 'po/template.pot';
const PO = 'po/zh_Hans/luci-theme-desktop.po';

// ===== dict parsing =====

// Unescape a JS single-quoted string body into the real character value.
// (The dict uses \n for the multi-line "?…cannot be undone" entry.)
function unescapeJs(s) {
    return s.replace(/\\(.)/g, function(_, c) {
        switch (c) {
            case 'n': return '\n';
            case 't': return '\t';
            case 'r': return '\r';
            case "'": return "'";
            case '"': return '"';
            case '\\': return '\\';
            default: return c;
        }
    });
}

// Escape a real string for a PO/POT quoted string (single line).
function poEscape(s) {
    return s.replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\t/g, '\\t')
            .replace(/\r/g, '\\r')
            .replace(/\n/g, '\\n');
}

// Normalize a dict `//` comment into a PO section comment. The block markers
// (`// ===== widget.js =====`) lose their decoration; plain labels are kept.
function sectionLabel(comment) {
    return comment.replace(/^=+\s*/, '').replace(/\s*=+$/, '').trim();
}

// Parse the zh_cn block into ordered entries [{section, key, value}].
// Only the zh_cn block is read — i18n.js has other single-quoted strings.
// The dict deliberately repeats a handful of fragment keys (the tray and the
// widget error messages share `" already registered` / `" not registered`):
// gettext wants ONE msgid per string, so the first occurrence wins. A repeat
// with a DIFFERENT value is a real conflict and aborts the generation.
function parseDict(src) {
    const start = src.indexOf("'zh_cn': {");
    if (start === -1) throw new Error('zh_cn dict block not found in ' + I18N_JS);
    const end = src.indexOf('};', start);
    if (end === -1) throw new Error('unterminated zh_cn dict block in ' + I18N_JS);
    const block = src.slice(start, end);

    const re = /^'((?:[^'\\]|\\.)*)':\s*'((?:[^'\\]|\\.)*)'\s*,?\s*$/;
    const entries = [];
    const byKey = new Map();
    let section = null;
    block.split('\n').forEach(function(line, i) {
        const t = line.trim();
        const cm = /^\/\/\s*(.*)$/.exec(t);
        if (cm) {
            const label = sectionLabel(cm[1]);
            if (label) section = label;
            return;
        }
        const m = re.exec(t);
        if (!m) return;
        const key = unescapeJs(m[1]);
        const value = unescapeJs(m[2]);
        if (byKey.has(key)) {
            if (byKey.get(key).value !== value) {
                throw new Error('conflicting translations for "' + key + '" (' +
                    I18N_JS + ':' + (i + 1) + ')');
            }
            return;   // duplicate fragment key — keep the first occurrence
        }
        const entry = { section: section, key: key, value: value };
        byKey.set(key, entry);
        entries.push(entry);
    });
    return entries;
}

// ===== rendering =====

const POT_HEADER = [
    '# LuCI Desktop Theme — Translation Template',
    '# Copyright 2026 DMKLIGHT',
    '#',
    '# GENERATED FILE — do not edit by hand.',
    '# Source of truth: ' + I18N_JS + ' (the zh_cn dict).',
    '# Regenerate: node tools/gen-i18n.js',
    'msgid ""',
    'msgstr ""',
    '"Content-Type: text/plain; charset=UTF-8\\n"'
].join('\n');

const PO_HEADER = [
    '# LuCI Desktop Theme — Simplified Chinese Translation',
    '# Copyright 2026 DMKLIGHT',
    '#',
    '# GENERATED FILE — do not edit by hand.',
    '# Source of truth: ' + I18N_JS + ' (the zh_cn dict).',
    '# Regenerate: node tools/gen-i18n.js',
    'msgid ""',
    'msgstr ""',
    '"Content-Type: text/plain; charset=UTF-8\\n"'
].join('\n');

function render(entries, header, msgstrOf) {
    const out = [header];
    let lastSection = null;
    entries.forEach(function(e) {
        out.push('');
        if (e.section && e.section !== lastSection) {
            out.push('# ' + e.section);
            lastSection = e.section;
        }
        out.push('msgid "' + poEscape(e.key) + '"');
        out.push('msgstr "' + poEscape(msgstrOf(e)) + '"');
    });
    out.push('');
    return out.join('\n');
}

function renderPot(entries) {
    return render(entries, POT_HEADER, function() { return ''; });
}

function renderPo(entries) {
    return render(entries, PO_HEADER, function(e) { return e.value; });
}

// ===== entry points =====

function generate() {
    const src = fs.readFileSync(path.join(THEME_DIR, I18N_JS), 'utf8');
    const entries = parseDict(src);
    return { pot: renderPot(entries), po: renderPo(entries), entries: entries };
}

function check() {
    const g = generate();
    const problems = [];
    [['po/template.pot', g.pot], ['po/zh_Hans/luci-theme-desktop.po', g.po]].forEach(function(pair) {
        let disk = '';
        try { disk = fs.readFileSync(path.join(THEME_DIR, pair[0]), 'utf8'); } catch (e) {}
        if (disk !== pair[1]) problems.push(pair[0]);
    });
    return problems;
}

function write() {
    const g = generate();
    fs.mkdirSync(path.join(THEME_DIR, 'po/zh_Hans'), { recursive: true });
    fs.writeFileSync(path.join(THEME_DIR, POT), g.pot);
    fs.writeFileSync(path.join(THEME_DIR, PO), g.po);
    return g;
}

if (require.main === module) {
    if (process.argv.indexOf('--check') !== -1) {
        const problems = check();
        if (problems.length) {
            console.log('❌ stale i18n files (regenerate: node tools/gen-i18n.js):\n  ' + problems.join('\n  '));
            process.exit(1);
        }
        console.log('✅ i18n files match ' + I18N_JS);
    } else {
        const g = write();
        console.log('✅ wrote ' + POT + ' + ' + PO + ' (' + g.entries.length + ' strings)');
    }
}

module.exports = {
    THEME_DIR: THEME_DIR,
    I18N_JS: I18N_JS,
    POT: POT,
    PO: PO,
    parseDict: parseDict,
    renderPot: renderPot,
    renderPo: renderPo,
    generate: generate,
    check: check,
    write: write
};
