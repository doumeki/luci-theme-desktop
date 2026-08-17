/* wallpaper-preview.test.js — Wallpaper preview download + toast chain tests
 *
 * Covers:
 *  - toast event chain: LuCIDesktop.emit('toast') → TrayManager.notify (registered in boot)
 *  - first-time switch to bing/picsum downloads a preview (preview=1) with toasts
 *  - cached preview: no download, direct display
 *  - Refresh button forces download with preview=1 (never touches desktop baseline)
 */
(function() {
'use strict';

// ===== Stubs =====
var origImage, origXHR;
var lastImage, lastXHRs;
var booted = false;

function installStubs() {
    origImage = window.Image;
    lastImage = null;
    window.Image = function() {
        var img = this;
        lastImage = img;
        img.onload = null;
        img.onerror = null;
        img.src = '';
    };
    origXHR = window.XMLHttpRequest;
    lastXHRs = [];
    window.XMLHttpRequest = function() {
        var x = this;
        x.open = function(method, url) { x.method = method; x.url = url; };
        x.setRequestHeader = function() {};
        x.send = function() { lastXHRs.push(x); };
    };
}

function restoreStubs() {
    window.Image = origImage;
    window.XMLHttpRequest = origXHR;
    lastImage = null;
    lastXHRs = [];
}

function clearToasts() {
    document.querySelectorAll('.desktop-toast').forEach(function(t) { t.remove(); });
}

function setupDOM() {
    var cfg = document.getElementById('desktop-config');
    if (!cfg) {
        cfg = document.createElement('script');
        cfg.id = 'desktop-config';
        cfg.type = 'application/json';
        document.head.appendChild(cfg);
    }
    cfg.textContent = JSON.stringify({
        widgets: {}, pins: [], hidden_icons: [],
        theme: { desktop_wallpaper: 'gradient' }
    });
    var wp = document.getElementById('desktop-wallpaper');
    if (!wp) {
        wp = document.createElement('div');
        wp.id = 'desktop-wallpaper';
        document.body.appendChild(wp);
    }
    var p = document.getElementById('theme-settings-panel');
    if (p) p.remove();
    clearToasts();
    try {
        localStorage.removeItem('__desktop_wp_candidate_bing');
        localStorage.removeItem('__desktop_wp_candidate_picsum');
    } catch(e) {}
}

function openPanel() {
    ThemeSettings.open();
    return document.getElementById('theme-settings-panel');
}

function switchMode(mode) {
    var sel = document.getElementById('ts-desktop_wallpaper');
    sel.value = mode;
    sel.dispatchEvent(new Event('change', {bubbles: true}));
}

function findXHR(substr) {
    return lastXHRs.filter(function(x) { return x.url.indexOf(substr) !== -1; });
}

// Boot the desktop shell once so the toast listener is registered.
// (boot also fires _applyWallpaper/_initUciIndicator — stubbed XHRs record only)
function ensureBoot() {
    if (booted) return;
    LuCIDesktop.boot();
    booted = true;
}

// ===== Toast event chain =====
describe('Toast event chain (boot-registered listener)', function() {
    beforeEach(function() {
        setupDOM();
        installStubs();
        ensureBoot();
    });
    afterEach(restoreStubs);

    it('emit("toast") shows a notification via TrayManager', function() {
        LuCIDesktop.emit('toast', {msg: 'Chain test', type: 'info'});
        var toast = document.querySelector('.desktop-toast');
        assert.ok(toast, 'toast DOM created');
        assert.contains(toast.textContent, 'Chain test', 'toast shows the message');
    });

    it('honors toast type classes', function() {
        LuCIDesktop.emit('toast', {msg: 'Warning', type: 'warn'});
        var toast = document.querySelector('.desktop-toast');
        assert.ok(toast, 'toast created');
        assert.ok(toast.className.indexOf('toast-warn') !== -1, 'has toast-warn class');
    });
});

// ===== First-time preview auto-download =====
describe('Wallpaper preview auto-download', function() {
    beforeEach(function() {
        setupDOM();
        installStubs();
        ensureBoot();
        openPanel();
    });
    afterEach(restoreStubs);

    it('switching to bing without cache downloads preview (preview=1) with toast + loading', function() {
        switchMode('bing');
        assert.ok(lastImage, 'Image probe created');
        assert.contains(lastImage.src, 'wallpaper_bing_desktop.jpg', 'probes the confirmed desktop file first');

        // No confirmed desktop → probe fails → no remembered candidate → download
        lastImage.onerror();
        var dl = findXHR('random_wallpaper');
        assert.ok(dl.length === 1, 'download XHR fired');
        assert.contains(dl[0].url, 'mode=bing', 'downloads bing mode');
        assert.contains(dl[0].url, 'preview=1', 'uses preview=1 (no desktop baseline touch)');
        var toasts = document.querySelectorAll('.desktop-toast');
        var downloading = Array.prototype.some.call(toasts, function(t) {
            return t.textContent.indexOf('Downloading preview') !== -1;
        });
        assert.ok(downloading, 'toast "Downloading preview…" shown');
        var preview = document.getElementById('wp-preview-img');
        assert.ok(preview && preview.className.indexOf('wp-loading') !== -1, 'preview box shows loading');
    });

    it('download completion shows the preview and a ready toast', function() {
        switchMode('bing');
        lastImage.onerror();
        var dl = findXHR('random_wallpaper')[0];
        dl.status = 200;
        dl.responseText = '{"url":"/luci-static/desktop/cache/wallpaper_bing.jpg?v=1","debug":"download=ok"}';
        dl.onload();
        var preview = document.getElementById('wp-preview-img');
        assert.contains(preview.style.backgroundImage, 'wallpaper_bing.jpg', 'preview shows downloaded image');
        try {
            assert.equal(localStorage.getItem('__desktop_wp_candidate_bing'), '1', 'first-time candidate remembered');
        } catch(e) {}
        assert.ok(preview.className.indexOf('wp-loading') === -1, 'loading class removed');
        var toasts = document.querySelectorAll('.desktop-toast');
        var ready = Array.prototype.some.call(toasts, function(t) {
            return t.textContent.indexOf('Preview ready') !== -1;
        });
        assert.ok(ready, 'toast "Preview ready" shown');
    });

    it('confirmed desktop exists → preview snaps back, no download', function() {
        switchMode('bing');
        // _desktop.jpg exists → probe succeeds
        lastImage.onload();
        var dl = findXHR('random_wallpaper');
        assert.ok(dl.length === 0, 'no download XHR fired');
        var preview = document.getElementById('wp-preview-img');
        assert.contains(preview.style.backgroundImage, 'wallpaper_bing_desktop.jpg',
            'preview shows the confirmed desktop image (Refresh is revoked)');
    });

    /* TEMP-DISABLED
    it('first-time candidate is remembered and kept on reopen', function() {
        // Session 1: no _desktop, no candidate → download + remember
        switchMode('bing');
        lastImage.onerror();
        var dl = findXHR('random_wallpaper')[0];
        dl.status = 200;
        dl.responseText = '{"url":"/luci-static/desktop/cache/wallpaper_bing.jpg?v=1","debug":"download=ok"}';
        dl.onload();

        // Session 2: reopen panel — _desktop still missing, candidate remembered
        var p = document.getElementById('theme-settings-panel');
        if (p) p.remove();
        switchMode('bing');
        // dProbe fails, cProbe (cache) succeeds → keep candidate, no download
        var xhrsBefore = lastXHRs.length;
        lastImage.onerror();   // dProbe onerror → remembered → cProbe created
        var cProbe = lastImage;
        cProbe.onload();
        var dl2 = findXHR('random_wallpaper');
        assert.ok(dl2.length === 1, 'no new download — candidate kept');
        var preview = document.getElementById('wp-preview-img');
        assert.contains(preview.style.backgroundImage, 'wallpaper_bing.jpg', 'keeps the first-time candidate');
    });

    });
    */

    it('confirmed desktop → re-checks save state (no ?v= in check URL)', function() {
        switchMode('bing');
        lastImage.onload();
        // checkSavedState must fire with the plain filename (no ?v= cache buster)
        var checks = findXHR('check_saved');
        assert.ok(checks.length >= 1, 'check_saved XHR fired after preview snapped back');
        var checkUrl = checks[checks.length - 1].url;
        assert.contains(checkUrl, 'wallpaper_bing_desktop.jpg', 'checks the confirmed desktop file');
        assert.ok(checkUrl.indexOf('?v=') === -1, 'check URL has no ?v= cache buster');
        // Server says already saved → Save button becomes disabled
        var saveBtn = document.getElementById('wp-save-btn');
        assert.ok(saveBtn, 'save button exists');
        assert.ok(!saveBtn.disabled, 'save button clickable before check result');
        checks[checks.length - 1].status = 200;
        checks[checks.length - 1].responseText = '{"saved":true,"name":"bing_1.jpg"}';
        checks[checks.length - 1].onload();
        assert.ok(saveBtn.disabled, 'save button disabled once server confirms it is saved');
    });

    it('Refresh button forces download with preview=1', function() {
        switchMode('bing');
        lastImage.onload(); // confirmed desktop exists → no auto download
        var refreshBtn = document.querySelector('.ts-wp-refresh');
        assert.ok(refreshBtn, 'refresh button visible for bing');
        refreshBtn.click();
        var dl = findXHR('random_wallpaper');
        assert.ok(dl.length >= 1, 'refresh download XHR fired');
        var last = dl[dl.length - 1];
        assert.contains(last.url, 'force=1', 'refresh forces download');
        assert.contains(last.url, 'preview=1', 'refresh uses preview=1 (desktop untouched until Apply)');
    });
});
})();
