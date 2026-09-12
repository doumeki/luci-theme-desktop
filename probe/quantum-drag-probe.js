#!/usr/bin/env node
/* quantum-drag-probe.js — diagnose quantum drag on a real router
 *
 * Usage:
 *   node probe/quantum-drag-probe.js                       # 1.1 direct (passwordless curl)
 *   PROBE_ROUTER=<router-ip-or-host> PROBE_SSH=<ssh-host> \
 *     PROBE_SSH_KEY=<path-to-private-key> node probe/quantum-drag-probe.js   # 253 (ssh-forged session)
 *
 * Login cookie name follows the LuCI runtime, not the device: Lua track sets
 * `sysauth`, ucode track sets `sysauth_http` (Runtime.cookieName()). lib.login()
 * reads whichever name the login response set, so the same probe works on both.
 *
 * Checks (on the shell page):
 *   1. engine module loaded (LuCIDesktop.QuantumIcons)
 *   2. engine instantiated (Desktop._qicons) / mobile detection
 *   3. desktop container + grid dimensions
 *   4. simulated drag: mousedown -> mousemove -> mouseup, icon moved?
 * Prints JSON diagnostics + captured console lines.
 */
'use strict';
const path = require('path');
const lib = require(path.join(__dirname, 'lib.js'));

const ROUTER = process.env.PROBE_ROUTER || process.env.PROBE_SSH || lib.ROUTER;

async function consoleLines(sid) {
    try {
        const r = await lib.wd('GET', `/session/${sid}/log`, null, 8000);
        if (r && r.value) {
            return r.value
                .filter(e => e && (e.level === 'INFO' || e.level === 'WARN' || e.level === 'ERROR'))
                .map(e => `[${e.level}] ${e.message}`)
                .filter(m => /QuantumIcons|desktop\]|drag|icon|luci-static|script|error/i.test(m))
                .slice(-40);
        }
    } catch (e) {}
    return [];
}

async function main() {
    await lib.startGecko();
    const sid = await lib.newSession();
    try {
        await lib.login(sid);
        // Shell renders on a normal page (Lua dispatcher firstchild would
        // redirect /admin/desktop to the save API on the Lua runtime).
        await lib.nav(sid, `http://${ROUTER}/cgi-bin/luci/admin/status`);
        await lib.sleep(8000);

        const diag = await lib.exec(sid, `try {
            var out = {};
            out.runtime = window.__LUCI_RUNTIME__ || 'unknown';
            out.hasLuCIDesktop = typeof window.LuCIDesktop !== 'undefined';
            out.hasEngine = typeof (window.LuCIDesktop && window.LuCIDesktop.QuantumIcons) === 'function';
            out.hasIconConfig = typeof (window.LuCIDesktop && window.LuCIDesktop.IconConfig) === 'object';
            out.hasDesktop = typeof window.Desktop === 'object';
            out.qicons = window.Desktop && window.Desktop._qicons ? 'instantiated' : 'none';
            out.isMobile = window.LuCIDesktop ? window.LuCIDesktop.isMobile() : 'n/a';
            out.isMobileFlag = window.__IS_MOBILE__;
            var c = document.getElementById('desktop-icons');
            if (c) {
                var r = c.getBoundingClientRect();
                out.container = { w: Math.round(r.width), h: Math.round(r.height), icons: c.querySelectorAll('.desktop-icon').length, overlays: c.querySelectorAll('.q-icon-grid-overlay').length };
                var qi = window.Desktop && window.Desktop._qicons;
                if (qi) out.grid = { cols: qi.gridCols, rows: qi.gridRows, gridW: qi.config.gridW, gridH: qi.config.gridH, enabled: qi.config.enabled };
            } else {
                out.container = 'no #desktop-icons';
            }
            return JSON.stringify(out);
        } catch(e) { return 'ERR:' + e.message; }`);

        // Simulated drag on the first icon
        const drag = await lib.exec(sid, `try {
            var out = { ok: false };
            var c = document.getElementById('desktop-icons');
            var icon = c && c.querySelector('.desktop-icon');
            if (!icon) { out.reason = 'no icon'; return JSON.stringify(out); }
            var r = icon.getBoundingClientRect();
            var sx = r.left + r.width / 2, sy = r.top + r.height / 2;
            var before = { left: icon.style.left, top: icon.style.top, url: icon.getAttribute('data-url') };
            icon.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: sx, clientY: sy }));
            document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: sx + 120, clientY: sy + 90 }));
            document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: sx + 120, clientY: sy + 90 }));
            out.before = before;
            out.after = { left: icon.style.left, top: icon.style.top, col: icon.dataset.col, row: icon.dataset.row };
            out.draggingClass = icon.classList.contains('q-dragging');
            out.moved = icon.style.left !== before.left || icon.style.top !== before.top;
            out.ok = out.moved;
            return JSON.stringify(out);
        } catch(e) { return 'ERR:' + e.message; }`);

        const consoleOut = await consoleLines(sid);
        console.log(JSON.stringify({ ok: true, diag: JSON.parse(diag), drag: JSON.parse(drag), console: consoleOut }, null, 2));
    } catch (e) {
        console.log(JSON.stringify({ ok: false, error: String(e && e.stack || e) }, null, 2));
    } finally {
        await lib.finish(sid);
    }
}

main();
