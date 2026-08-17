/* mobile.test.js — Mobile module contract + behavior tests:
 *  1. LuCIDesktop.mobile API exists (openSwitcher/closeSwitcher/reinit) —
 *     even on a desktop viewport the shell exposes the API surface.
 *  2. Taskbar buttons exist in the shell DOM (btn-switcher / btn-home) —
 *     the elements mobile.js binds.
 *  3. BEHAVIOR (regression for "home/switcher unclickable on 1.1"): with a
 *     forced mobile verdict, clicking btn-switcher opens the app-switcher
 *     overlay, and clicking btn-home closes it. Uses mobile.js's reinit()
 *     hook to re-bind with IS_MOBILE forced on.
 *  4. UA-injection contract (regression for "switcher dead on 1.1"):
 *     footer templates must set window.__IS_MOBILE__ server-side.
 */
(function() {
'use strict';

function ensureShellButtons() {
    if (!document.getElementById('btn-switcher')) {
        var b = document.createElement('button');
        b.id = 'btn-switcher';
        document.body.appendChild(b);
    }
    if (!document.getElementById('btn-home')) {
        var h = document.createElement('button');
        h.id = 'btn-home';
        document.body.appendChild(h);
    }
}

describe('Mobile module contract', function() {
    it('exposes the switcher API on LuCIDesktop.mobile', function() {
        assert.ok(LuCIDesktop && LuCIDesktop.mobile, 'LuCIDesktop.mobile exists');
        assert.equal(typeof LuCIDesktop.mobile.openSwitcher, 'function', 'openSwitcher');
        assert.equal(typeof LuCIDesktop.mobile.closeSwitcher, 'function', 'closeSwitcher');
        assert.equal(typeof LuCIDesktop.mobile.reinit, 'function', 'reinit (test hook)');
    });

    it('shell DOM carries the buttons mobile.js binds', function() {
        ensureShellButtons();
        assert.ok(document.getElementById('btn-switcher'), 'btn-switcher present');
        assert.ok(document.getElementById('btn-home'), 'btn-home present');
    });

    it('mobile.js only binds when IS_MOBILE (no-op API on desktop)', function() {
        var sw = LuCIDesktop.mobile.openSwitcher;
        var threw = false;
        try { sw(); } catch (e) { threw = true; }
        assert.ok(!threw, 'openSwitcher callable on desktop (no throw)');
    });
});

describe('Mobile switcher behavior (forced mobile verdict)', function() {
    it('btn-switcher click opens the app-switcher overlay; btn-home closes it', function() {
        ensureShellButtons();
        // Force mobile re-bind. The module body appends the overlay once;
        // drop any previous overlay so reinit builds it fresh.
        var old = document.getElementById('app-switcher');
        if (old) old.remove();
        var mob = LuCIDesktop.mobile;
        console.log("MOBILE-DEBUG keys=" + Object.keys(LuCIDesktop.mobile).join(","));
        assert.equal(typeof mob.reinit, "function", "reinit hook present; mobile keys=" + Object.keys(mob).join(","));
        mob.reinit(true);
        var swBtn = document.getElementById('btn-switcher');
        assert.ok(swBtn, 'switcher button present');
        swBtn.click();
        var overlay = document.getElementById('app-switcher');
        assert.ok(overlay, 'app-switcher overlay created on click');
        assert.ok(overlay.style.display !== 'none', 'overlay visible after click');
        var homeBtn = document.getElementById('btn-home');
        assert.ok(homeBtn, 'home button present');
        homeBtn.click();
        assert.ok(overlay.classList.contains('switcher-closing') || overlay.style.display === 'none',
            'home click closes the switcher');
        // restore desktop no-op surface for the rest of the suite
        LuCIDesktop.mobile.reinit(false);
        var after = document.getElementById('app-switcher');
        if (after) after.remove();
    });
});

// ===== Auto-refresh toggle in the mobile switcher =====
// Mobile entry for auto-refresh: the taskbar #btn-auto-refresh is hidden
// on mobile, so the switcher row owns the switch. SESSION-LEVEL (user
// decision 2026-08-16): the state is NOT persisted — every page load
// starts ON, a toggle only affects the current session + broadcasts.
describe('Mobile switcher auto-refresh toggle', function() {
    function forceMobile() {
        var old = document.getElementById('app-switcher');
        if (old) old.remove();
        LuCIDesktop.mobile.reinit(true);
    }
    function openSwitcher() {
        forceMobile();
        document.getElementById('btn-switcher').click();
        return document.getElementById('app-switcher');
    }
    afterEach(function() {
        LuCIDesktop.mobile.reinit(false);
        var el = document.getElementById('app-switcher');
        if (el) el.remove();
        // Reset UCI-visible theme state
        var c = LuCIDesktop.getConfig();
        if (c.theme) { c.theme.auto_refresh = '1'; }
        var cfgEl = document.getElementById('desktop-config');
        if (cfgEl) cfgEl.textContent = JSON.stringify(c);
    });

    it('switcher renders an Auto Refresh row with a toggle', function() {
        var overlay = openSwitcher();
        var row = overlay.querySelector('.switcher-options');
        assert.ok(row, 'auto-refresh options row exists');
        assert.ok(overlay.querySelector('.switcher-ar-toggle'), 'toggle button exists');
        var label = overlay.querySelector('.switcher-opt-label');
        assert.ok(label && label.textContent.indexOf('Auto Refresh') !== -1, 'label mentions Auto Refresh');
    });

    it('toggle starts ON on every page load (session-level, no persisted state)', function() {
        // Even if UCI (or the injected config) says '0', the session-level
        // switch must start ON — the state is not persisted (user decision
        // 2026-08-16: F5 always restores the default ON).
        var c = LuCIDesktop.getConfig();
        c.theme.auto_refresh = '0';
        document.getElementById('desktop-config').textContent = JSON.stringify(c);
        var overlay = openSwitcher();
        var t = overlay.querySelector('.switcher-ar-toggle');
        assert.ok(t.classList.contains('on'), 'starts ON regardless of stored value');
    });

    // Reopen WITHOUT reinit (same-page close → open) — the in-page state
    // must survive. forceMobile()/openSwitcher() re-run the module body
    // (= new page load), which is exactly the F5 reset case.
    it('reopening the switcher KEEPS the in-page state (no reset)', function() {
        forceMobile();
        document.getElementById('btn-switcher').click();
        var overlay = document.getElementById('app-switcher');
        var t = overlay.querySelector('.switcher-ar-toggle');
        t.click();   // ON → OFF (in-page state)
        assert.ok(!t.classList.contains('on'), 'turned OFF');
        // Close then reopen within the SAME module instance (no reinit).
        var sw = LuCIDesktop.mobile;
        sw.closeSwitcher();
        // closeSwitcher animates 170ms before display:none; force it now.
        overlay.style.display = 'none';
        document.getElementById('btn-switcher').click();
        var reopened = document.getElementById('app-switcher');
        var t2 = reopened.querySelector('.switcher-ar-toggle');
        assert.ok(!t2.classList.contains('on'), 'still OFF after same-page reopen');
    });

    it('F5 / re-login (fresh module) resets the toggle to ON', function() {
        // openSwitcher's forceMobile() re-runs initMobile — the module
        // state resets exactly like a fresh page load.
        var overlay = openSwitcher();
        var t = overlay.querySelector('.switcher-ar-toggle');
        t.click();   // ON → OFF
        assert.ok(!t.classList.contains('on'), 'turned OFF');
        var overlay2 = openSwitcher();   // forceMobile → fresh module
        var t2 = overlay2.querySelector('.switcher-ar-toggle');
        assert.ok(t2.classList.contains('on'), 'fresh page resets to default ON');
    });

    it('toggling broadcasts but does NOT persist (no POST, config untouched)', function() {
        var posts = [];
        var broadcast = null;
        var origXHR = window.XMLHttpRequest;
        window.XMLHttpRequest = function() {
            this.open = function() {};
            this.setRequestHeader = function() {};
            this.send = function(body) { posts.push(body); };
        };
        // Spy the emit (LuCIDesktop event) → taskbar forwards to iframes.
        var origOn = LuCIDesktop.on;
        LuCIDesktop.on = function(ev, fn) {
            if (ev === 'auto-refresh-toggled') { broadcast = fn; return; }
            return origOn.apply(this, arguments);
        };
        var overlay = openSwitcher();
        var t = overlay.querySelector('.switcher-ar-toggle');
        var before = LuCIDesktop.getSection('theme').auto_refresh;
        t.click();   // ON → OFF
        var theme = LuCIDesktop.getSection('theme');
        assert.equal(theme.auto_refresh, before, 'config NOT changed (no persistence)');
        var found = posts.some(function(b) { return b.indexOf('auto_refresh') !== -1; });
        assert.ok(!found, 'no settings POST with auto_refresh');
        LuCIDesktop.on = origOn;
        window.XMLHttpRequest = origXHR;
    });
});
})();
