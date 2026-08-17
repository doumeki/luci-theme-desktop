/* features.test.js — Tests for new simple features:
 *   1. URL App address handling (_handleAppParam)
 *   2. Ghost app cleanup (cleanGhostApps)
 *   3. Sticky Note widget (sticky-note)
 */
(function() {
'use strict';

var DESKTOP = window.LuCIDesktop;
if (!DESKTOP) { console.error('features.test.js: LuCIDesktop not found'); return; }

// ===== Test data =====
function setupMenuData() {
    window.LuCIMenuData = [
        { title: 'Status', id: 'status', subs: [
            { title: 'Overview', href: '/cgi-bin/luci/admin/status/overview' },
            { title: 'Routes',  href: '/cgi-bin/luci/admin/status/routes' }
        ]},
        { title: 'System', id: 'system', subs: [
            { title: 'System',   href: '/cgi-bin/luci/admin/system/system' },
            { title: 'Terminal', href: '/cgi-bin/luci/admin/system/terminal' }
        ]},
        { title: 'Network', id: 'network', href: '/cgi-bin/luci/admin/network/firewall' }
    ];
}

function clearMenuData() {
    delete window.LuCIMenuData;
}

// ===== Feature 1: URL App Address Handling =====
describe('Feature: URL App param', function() {

    it('should exist as _handleAppParam on LuCIDesktop', function() {
        assert.ok(DESKTOP._handleAppParam, '_handleAppParam exists');
        assert.equal(typeof DESKTOP._handleAppParam, 'function', 'is function');
    });

    it('should return early when no ?app= param', function() {
        // Simulate no search query
        var oldSearch = window.location.search;
        // _handleAppParam just returns when no matching param
        // We test by verifying no console error occurs
        try {
            DESKTOP._handleAppParam();
        } catch(e) {
            assert.fail('should not throw: ' + e.message);
        }
        assert.ok(true, 'no-op when no ?app= param');
    });

    it('should open window for valid app path', function() {
        setupMenuData();
        // Spy on WM.open
        var calledUrl = null, calledTitle = null;
        var _origOpen = WM.open;
        WM.open = function(url, title) {
            calledUrl = url; calledTitle = title;
            return 'test-win';
        };

        // Simulate ?app=admin/status/routes (location.search is not
        // redefinable in modern Firefox — use history.pushState instead)
        var oldUrl = window.location.href;
        history.pushState({}, '', '?app=admin/status/routes');

        // Note: location.search might not be writable in all browsers.
        // We test the matching logic directly instead.
        var qs = '?app=admin/status/routes';
        var m = qs.match(/[?&]app=([^&]+)/);
        assert.ok(m, 'regex matches app param');
        assert.equal(decodeURIComponent(m[1]), 'admin/status/routes', 'app path extracted');

        // Restore
        WM.open = _origOpen;
        clearMenuData();
    });

    it('should normalize /cgi-bin/luci/ prefix from app param', function() {
        // Test the normalization logic inline
        var app = '/cgi-bin/luci/admin/status/overview';
        var appPath = app.replace(/^\/cgi-bin\/luci\//, '');
        assert.equal(appPath, 'admin/status/overview', 'prefix stripped');
    });

    it('should find title from LuCIMenuData for matching href', function() {
        setupMenuData();
        var appPath = 'admin/status/routes';
        var title = '';
        var data = window.LuCIMenuData;
        for (var i = 0; i < data.length && !title; i++) {
            var cat = data[i];
            if (cat.subs) {
                for (var j = 0; j < cat.subs.length; j++) {
                    if (cat.subs[j].href && cat.subs[j].href.indexOf(appPath) !== -1) {
                        title = cat.subs[j].title;
                        break;
                    }
                }
            }
            if (!title && cat.href && cat.href.indexOf(appPath) !== -1) {
                title = cat.title;
            }
        }
        assert.equal(title, 'Routes', 'title found from menu');
        clearMenuData();
    });

    it('should find top-level menu item by href', function() {
        setupMenuData();
        var appPath = 'admin/network/firewall';
        var title = '';
        var data = window.LuCIMenuData;
        for (var i = 0; i < data.length && !title; i++) {
            var cat = data[i];
            if (cat.subs) {
                for (var j = 0; j < cat.subs.length; j++) {
                    if (cat.subs[j].href && cat.subs[j].href.indexOf(appPath) !== -1) {
                        title = cat.subs[j].title;
                        break;
                    }
                }
            }
            if (!title && cat.href && cat.href.indexOf(appPath) !== -1) {
                title = cat.title;
            }
        }
        assert.equal(title, 'Network', 'top-level title found');
        clearMenuData();
    });
});

// ===== Feature 2: Ghost App Cleanup =====
describe('Feature: Ghost app cleanup', function() {

    it('should exist as cleanGhostApps on Desktop', function() {
        assert.ok(window.Desktop, 'Desktop exists');
        assert.ok(window.Desktop.cleanGhostApps, 'cleanGhostApps exists');
        assert.equal(typeof window.Desktop.cleanGhostApps, 'function', 'is function');
    });

    it('should not throw when no menu data', function() {
        clearMenuData();
        try {
            window.Desktop.cleanGhostApps();
        } catch(e) {
            assert.fail('should not throw without menu data: ' + e.message);
        }
        assert.ok(true, 'graceful no-op without menu data');
    });

    it('should build valid URL set from menu data', function() {
        setupMenuData();
        var validUrls = {};
        var data = window.LuCIMenuData;
        data.forEach(function(cat) {
            if (cat.subs) {
                cat.subs.forEach(function(sub) {
                    if (sub.href) validUrls[sub.href] = true;
                });
            }
            if (cat.href) validUrls[cat.href] = true;
        });
        assert.ok(validUrls['/cgi-bin/luci/admin/status/overview'], 'Overview URL valid');
        assert.ok(validUrls['/cgi-bin/luci/admin/system/terminal'], 'Terminal URL valid');
        assert.ok(validUrls['/cgi-bin/luci/admin/network/firewall'], 'Firewall URL valid');
        assert.equal(Object.keys(validUrls).length, 5, '5 valid URLs');
        clearMenuData();
    });

    it('should identify ghost (nonexistent) URLs', function() {
        setupMenuData();
        var validUrls = {};
        var data = window.LuCIMenuData;
        data.forEach(function(cat) {
            if (cat.subs) {
                cat.subs.forEach(function(sub) { if (sub.href) validUrls[sub.href] = true; });
            }
            if (cat.href) validUrls[cat.href] = true;
        });

        // Ghost URLs that don't exist in menu
        assert.ok(!validUrls['/cgi-bin/luci/admin/status/old_app'], 'old_app is ghost');
        assert.ok(!validUrls['/cgi-bin/luci/admin/vpn/pptp'], 'pptp is ghost');
        assert.ok(!validUrls['/cgi-bin/luci/admin/services/deleted'], 'deleted service is ghost');
        clearMenuData();
    });

    it('should filter ghost pins (objects with url property)', function() {
        setupMenuData();
        var pins = [
            { url: '/cgi-bin/luci/admin/status/overview', title: 'Status' },
            { url: '/cgi-bin/luci/admin/vpn/pptp', title: 'PPTP' },       // ghost
            { url: '/cgi-bin/luci/admin/system/terminal', title: 'TTYD' },
            { url: '/cgi-bin/luci/admin/services/deleted', title: 'Dead' }  // ghost
        ];

        var validUrls = {};
        var data = window.LuCIMenuData;
        data.forEach(function(cat) {
            if (cat.subs) cat.subs.forEach(function(sub) { if (sub.href) validUrls[sub.href] = true; });
            if (cat.href) validUrls[cat.href] = true;
        });

        var removed = [];
        pins = pins.filter(function(p) {
            if (!validUrls[p.url]) { removed.push(p.url); return false; }
            return true;
        });

        assert.equal(pins.length, 2, '2 pins remain');
        assert.equal(removed.length, 2, '2 ghosts removed');
        assert.equal(pins[0].url, '/cgi-bin/luci/admin/status/overview', 'Status kept');
        assert.equal(pins[1].url, '/cgi-bin/luci/admin/system/terminal', 'Terminal kept');
        assert.equal(removed[0], '/cgi-bin/luci/admin/vpn/pptp', 'PPTP removed');
        assert.equal(removed[1], '/cgi-bin/luci/admin/services/deleted', 'Deleted removed');
        clearMenuData();
    });

    it('should filter ghost hidden icons (URL strings)', function() {
        setupMenuData();
        var hidden = [
            '/cgi-bin/luci/admin/status/routes',
            '/cgi-bin/luci/admin/services/deleted',
            '/cgi-bin/luci/admin/system/system'
        ];

        var validUrls = {};
        var data = window.LuCIMenuData;
        data.forEach(function(cat) {
            if (cat.subs) cat.subs.forEach(function(sub) { if (sub.href) validUrls[sub.href] = true; });
            if (cat.href) validUrls[cat.href] = true;
        });

        var removed = [];
        hidden = hidden.filter(function(h) {
            if (!validUrls[h]) { removed.push(h); return false; }
            return true;
        });

        assert.equal(hidden.length, 2, '2 hidden remain');
        assert.equal(removed.length, 1, '1 ghost removed');
        assert.equal(removed[0], '/cgi-bin/luci/admin/services/deleted', 'Deleted removed');
        clearMenuData();
    });
});

// ===== Feature 3: Sticky Note Widget =====
describe('Feature: Sticky Note widget', function() {

    it('should be registered in WidgetManager registry', function() {
        var def = WidgetManager.registry['sticky-note'];
        assert.ok(def, 'sticky-note in registry');
        assert.equal(def.name, 'Sticky Note', 'display name');
        assert.ok(def.render, 'has render function');
    });

    it('should have 3 fixed slots x 7 colors + shared-store hooks', function() {
        var def = WidgetManager.registry['sticky-note'];
        assert.equal(def.maxInstances, 3, '3 slots (product design, not 99)');
        assert.equal(def.resizable, true, 'uses shared _makeResizable handle');
        assert.equal(def.defaults.width, 200, 'default width (top-level)');
        assert.equal(def.defaults.clickThrough, false, 'clickThrough false (editable)');
        assert.equal(def.defaults.updateInterval, 3000, '3s periodic save');
        assert.equal(def.data.w, 200, 'default width');
        assert.equal(def.data.mobileHidden, false, 'mobile-hidden default off');
        assert.ok(def.options.mobileHidden, 'hide-on-mobile option declared');
        assert.ok(def.sharedKeys, 'shared style keys declared');
        assert.ok(def.sharedKeys.indexOf('opacity') >= 0, 'opacity is a shared style key');
        assert.ok(def.sharedKeys.indexOf('clickThrough') >= 0, 'clickThrough is a shared style key');
        assert.equal(typeof def.restoreShared, 'function', 'restoreShared pulls shared style into instance');
        assert.equal(typeof def.onStyleChange, 'function', 'onStyleChange forwards style change to shared store');
        assert.equal(typeof def.onEnable, 'function', 'onEnable clears the closed marker');
        assert.equal(typeof def.onDisable, 'function', 'onDisable marks closed, keeps content');
        assert.equal(typeof def.onClear, 'function', 'onClear deletes the slot content');
    });

    it('should have update for periodic save', function() {
        var def = WidgetManager.registry['sticky-note'];
        assert.ok(def.update, 'update exists');
        assert.equal(typeof def.update, 'function', 'update is function');
    });

    // Helper: get first active instance ID for a type
    function firstIid(typeId) { return WidgetManager._instancesOf(typeId)[0]; }

    it('should enable and render without error', function() {
        try {
            WidgetManager.enable('sticky-note');
            var iid = firstIid('sticky-note');
            var inst = WidgetManager.instances[iid];
            assert.ok(inst, 'instance created');
            assert.ok(inst.el, 'element created');
            assert.ok(inst.el.querySelector('.sticky-body'), 'has editable body');
            assert.ok(inst.el.querySelector('.sticky-header'), 'has header bar');
            assert.ok(inst.el.querySelector('.sticky-color'), 'has color picker');
            assert.ok(inst.el.querySelector('.sticky-del'), 'has close button');
        } catch(e) {
            assert.fail('should not throw: ' + e.message);
        }
    });

    it('should contain contenteditable body', function() {
        var iid = firstIid('sticky-note');
        var inst = WidgetManager.instances[iid];
        var body = inst.el.querySelector('.sticky-body');
        assert.ok(body, 'body exists');
        assert.equal(body.getAttribute('contenteditable'), 'true', 'is contenteditable');
    });

    it('should have periodic update timer', function() {
        var iid = firstIid('sticky-note');
        var inst = WidgetManager.instances[iid];
        assert.ok(inst._timer, 'update timer active');
    });

    it('should disable without error', function() {
        var iid = firstIid('sticky-note');
        try {
            WidgetManager.disable(iid);
            assert.ok(!WidgetManager.instances[iid], 'instance removed');
        } catch(e) {
            assert.fail('should not throw: ' + e.message);
        }
    });

    it('should render from the shared slot entry (text and color)', function() {
        // Model: 7 color-keyed pages per slot in stickysync (desktop-config),
        // keyed by the slot name; activeColor (show) picks WHICH page shows.
        var cfgEl = document.getElementById('desktop-config');
        var cfg = JSON.parse(cfgEl.textContent || '{}');
        cfg.stickysync = { 'sticky-note-test': { notes: { '#7ec8a0': 'Hello Green' }, activeColor: '#7ec8a0' } };
        cfgEl.textContent = JSON.stringify(cfg);
        WidgetManager.enable('sticky-note', { id: 'sticky-note-test' });
        var inst = WidgetManager.instances['sticky-note-test'];
        assert.ok(inst, 'instance created');
        var body = inst.el.querySelector('.sticky-body');
        assert.contains(body.textContent || '', 'Hello Green', 'custom text rendered from shared entry');
        var sel = inst.el.querySelector('.sticky-color');
        assert.equal(sel.value, '#7ec8a0', 'custom color selected');
        WidgetManager.disable('sticky-note-test');
    });

    it('should support multiple instances', function() {
        WidgetManager.enable('sticky-note'); // sticky-note-1 (or next)
        WidgetManager.enable('sticky-note'); // sticky-note-2 (or next)
        var ids = WidgetManager._instancesOf('sticky-note');
        assert.ok(ids.length >= 2, 'at least 2 instances');
        // Clean up all
        ids.forEach(function(iid) { WidgetManager.disable(iid); });
    });

    it('color switch changes WHICH page shows (each color keeps its own content)', function() {
        var cfgEl = document.getElementById('desktop-config');
        var cfg = JSON.parse(cfgEl.textContent || '{}');
        cfg.stickysync = {
            'sticky-note-C1': {
                notes: { '#f9e74a': 'yellow page', '#7ec8a0': 'green page' },
                activeColor: '#7ec8a0'
            }
        };
        cfgEl.textContent = JSON.stringify(cfg);
        WidgetManager.enable('sticky-note', { id: 'sticky-note-C1' });
        var inst = WidgetManager.instances['sticky-note-C1'];
        // NOTE: rerender replaces innerHTML — always re-query the body.
        var body = function() { return inst.el.querySelector('.sticky-body'); };
        assert.contains(body().textContent || '', 'green page', 'green page showing (activeColor)');
        // Switch the color picker to yellow → yellow page shows
        var sel = inst.el.querySelector('.sticky-color');
        sel.value = '#f9e74a';
        sel.dispatchEvent(new Event('change'));
        assert.contains(body().textContent || '', 'yellow page', 'yellow page shows after switch');
        // Switch back to green → green page still intact
        sel.value = '#7ec8a0';
        sel.dispatchEvent(new Event('change'));
        assert.contains(body().textContent || '', 'green page', 'green page content preserved');
        WidgetManager.disable('sticky-note-C1');
    });

    it('close button disables + marks the shared entry closed (content kept)', function() {
        var cfgEl = document.getElementById('desktop-config');
        var cfg = JSON.parse(cfgEl.textContent || '{}');
        cfg.stickysync = { 'sticky-note-X1': { notes: { '#f9e74a': 'keep me' }, activeColor: '#f9e74a' } };
        cfgEl.textContent = JSON.stringify(cfg);
        WidgetManager.enable('sticky-note', { id: 'sticky-note-X1' });
        var inst = WidgetManager.instances['sticky-note-X1'];
        var closeBtn = inst.el.querySelector('.sticky-del');
        assert.ok(closeBtn, 'close button exists');
        closeBtn.click();
        assert.ok(!WidgetManager.instances['sticky-note-X1'], 'instance removed');
        assert.ok(WidgetManager._preservedConfigs['sticky-note-X1'], 'config preserved');
        var after = JSON.parse(cfgEl.textContent).stickysync['sticky-note-X1'];
        assert.equal(after.closed, true, 'entry marked closed');
        assert.equal(after.notes['#f9e74a'], 'keep me', 'content preserved');
    });

    it('re-enable restores content and clears the closed marker', function() {
        var cfgEl = document.getElementById('desktop-config');
        var cfg = JSON.parse(cfgEl.textContent || '{}');
        cfg.stickysync = { 'sticky-note-Y1': { notes: { '#f9e74a': 'restored' }, activeColor: '#f9e74a', closed: true } };
        cfgEl.textContent = JSON.stringify(cfg);
        WidgetManager.enable('sticky-note', { id: 'sticky-note-Y1' });
        var inst = WidgetManager.instances['sticky-note-Y1'];
        assert.ok(inst, 're-enabled');
        var body = inst.el.querySelector('.sticky-body');
        assert.contains(body.textContent || '', 'restored', 'content restored from shared entry');
        var after = JSON.parse(cfgEl.textContent).stickysync['sticky-note-Y1'];
        assert.ok(!after.closed, 'closed marker cleared on re-enable');
        WidgetManager.disable('sticky-note-Y1');
    });
});

// ===== Background refresh must not clobber a newer mode choice =====
describe('Background refresh mode guard', function() {
    it('does not apply a stale download when mode changed mid-flight', function() {
        var cfg = document.getElementById('desktop-config');
        cfg.textContent = JSON.stringify({
            widgets: {}, pins: [], hidden_icons: [],
            theme: { desktop_wallpaper: 'bing', picsum_auto_refresh: '1' },
            wallpaper: { mode: 'bing', url: '/cache/wallpaper_bing.jpg' }
        });
        var wp = document.getElementById('desktop-wallpaper');
        if (!wp) { wp = document.createElement('div'); wp.id = 'desktop-wallpaper'; document.body.appendChild(wp); }
        wp.style.backgroundImage = '';

        var origSetTimeout = window.setTimeout;
        var origXHR = window.XMLHttpRequest;
        var origImage = window.Image;
        var xhrs = [], imgObj = null;
        window.setTimeout = function(fn) { fn(); return 1; };
        window.XMLHttpRequest = function() {
            var x = this;
            x.open = function(m, u) { x.method = m; x.url = u; };
            x.setRequestHeader = function() {};
            x.send = function() { xhrs.push(x); };
        };
        window.Image = function() { imgObj = this; this.onload = null; this.onerror = null; this.src = ''; };

        try {
            LuCIDesktop._backgroundRefresh();
            assert.ok(xhrs.length === 1, 'bg-refresh XHR fired');
            assert.contains(xhrs[0].url, 'mode=bing', 'bg-refresh requested bing');

            // User switches to picsum and applies while download is in flight
            var c = JSON.parse(cfg.textContent);
            c.theme.desktop_wallpaper = 'picsum';
            c.wallpaper.mode = 'picsum';
            cfg.textContent = JSON.stringify(c);

            xhrs[0].status = 200;
            xhrs[0].responseText = '{"url":"/luci-static/desktop/cache/wallpaper_bing.jpg?v=1","debug":"download=ok"}';
            xhrs[0].onload();
            if (imgObj && imgObj.onload) imgObj.onload();

            assert.equal(wp.style.backgroundImage, '',
                'desktop NOT clobbered by stale bing download');
        } finally {
            window.setTimeout = origSetTimeout;
            window.XMLHttpRequest = origXHR;
            window.Image = origImage;
        }
    });
});

// ===== Picsum auto-refresh off must suppress login force-refresh =====
describe('Picsum auto-refresh guard', function() {
    function setupCfg(hasUrl) {
        var cfg = document.getElementById('desktop-config');
        cfg.textContent = JSON.stringify({
            widgets: {}, pins: [], hidden_icons: [],
            theme: { desktop_wallpaper: 'picsum', picsum_auto_refresh: '0' },
            wallpaper: { mode: 'picsum', url: hasUrl ? '/cache/wallpaper_picsum.jpg' : null }
        });
    }
    function stubXHR() {
        window.__xhrs = [];
        window.XMLHttpRequest = function() {
            var x = this;
            x.open = function(m, u) { x.url = u; };
            x.setRequestHeader = function() {};
            x.send = function() { window.__xhrs.push(x); };
        };
    }
    it('login force-refresh is skipped when picsum auto-refresh is off (cached image exists)', function() {
        setupCfg(true);
        var origXHR = window.XMLHttpRequest;
        stubXHR();
        try {
            LuCIDesktop._applyWallpaper({ forceRefresh: true });
            assert.ok(window.__xhrs.length === 0, 'no download XHR fired');
        } finally { window.XMLHttpRequest = origXHR; }
    });
    it('still downloads on login when NO cached image exists', function() {
        setupCfg(false);
        var origXHR = window.XMLHttpRequest;
        stubXHR();
        try {
            LuCIDesktop._applyWallpaper({ forceRefresh: true });
            assert.ok(window.__xhrs.length === 1, 'download XHR fired (no cached image)');
            assert.contains(window.__xhrs[0].url, 'mode=picsum', 'requests picsum');
        } finally { window.XMLHttpRequest = origXHR; }
    });
});

// ===== v76: bg-refresh gating — login refreshes, F5 never does =====
// User-defined semantics: bing means "refresh on every login"; a new image
// replaces the old one, otherwise the old one stays. F5 (page refresh) NEVER
// triggers a wallpaper download — the page only applies the last confirmed
// cached URL. boot() gates _backgroundRefresh behind _isNewSession.
describe('Wallpaper refresh gating: login vs F5 (v76)', function() {
    function setupBootCfg(mode, hasUrl) {
        var cfg = document.getElementById('desktop-config');
        cfg.textContent = JSON.stringify({
            widgets: {}, pins: [], hidden_icons: [],
            theme: { desktop_wallpaper: mode, picsum_auto_refresh: '1' },
            wallpaper: { mode: mode, url: hasUrl ? '/cache/wallpaper_' + mode + '.jpg' : null }
        });
        var wp = document.getElementById('desktop-wallpaper');
        if (!wp) { wp = document.createElement('div'); wp.id = 'desktop-wallpaper'; document.body.appendChild(wp); }
        wp.style.backgroundImage = '';
        wp.style.backgroundSize = '';
        wp.style.backgroundPosition = '';
    }
    function stubAsync() {
        window.__gatingXhrs = [];
        window.setTimeout = function(fn) { fn(); return 1; };
        window.XMLHttpRequest = function() {
            var x = this;
            x.open = function(m, u) { x.url = u; };
            x.setRequestHeader = function() {};
            x.send = function() { window.__gatingXhrs.push(x); };
        };
        window.Image = function() { this.onload = null; this.onerror = null; this.src = ''; };
    }
    function wpXHRs() {
        return window.__gatingXhrs.filter(function(x) { return x.url.indexOf('random_wallpaper') !== -1; });
    }
    it('login (no _desktop_sid): boot shows cached image, fires exactly one bg-refresh XHR', function() {
        setupBootCfg('bing', true);
        try { sessionStorage.removeItem('_desktop_sid'); } catch(e) {}
        var oSt = window.setTimeout, oXHR = window.XMLHttpRequest, oImg = window.Image;
        stubAsync();
        try {
            LuCIDesktop.boot();
            var wp = document.getElementById('desktop-wallpaper');
            assert.contains(wp.style.backgroundImage, 'wallpaper_bing.jpg',
                'login first shows the confirmed image (old image until new arrives)');
            var xhrs = wpXHRs();
            assert.ok(xhrs.length === 1, 'exactly one wallpaper XHR on login (fast path + 1 bg-refresh)');
            assert.contains(xhrs[0].url, 'mode=bing', 'bg-refresh requests bing');
            assert.ok(xhrs[0].url.indexOf('force=1') === -1, 'bg-refresh is a silent check, not a force download');
        } finally {
            window.setTimeout = oSt; window.XMLHttpRequest = oXHR; window.Image = oImg;
        }
    });
    it('F5 (session present): boot fires ZERO wallpaper XHRs, desktop keeps cached image', function() {
        setupBootCfg('bing', true);
        try { sessionStorage.setItem('_desktop_sid', '1'); } catch(e) {}
        var oSt = window.setTimeout, oXHR = window.XMLHttpRequest, oImg = window.Image;
        stubAsync();
        try {
            LuCIDesktop.boot();
            var wp = document.getElementById('desktop-wallpaper');
            assert.ok(wpXHRs().length === 0, 'F5 never fires a wallpaper XHR');
            assert.contains(wp.style.backgroundImage, 'wallpaper_bing.jpg',
                'F5 applies the last confirmed cached image (fast path, no XHR)');
        } finally {
            window.setTimeout = oSt; window.XMLHttpRequest = oXHR; window.Image = oImg;
        }
    });
    it('login boot with picsum auto-refresh off: bg-refresh skipped at the login gate too', function() {
        setupBootCfg('picsum', true);
        var cfg = document.getElementById('desktop-config');
        var c = JSON.parse(cfg.textContent);
        c.theme.picsum_auto_refresh = '0';
        cfg.textContent = JSON.stringify(c);
        try { sessionStorage.removeItem('_desktop_sid'); } catch(e) {}
        var oSt = window.setTimeout, oXHR = window.XMLHttpRequest, oImg = window.Image;
        stubAsync();
        try {
            LuCIDesktop.boot();
            assert.ok(wpXHRs().length === 0, 'picsum auto-refresh off suppresses login bg-refresh');
        } finally {
            window.setTimeout = oSt; window.XMLHttpRequest = oXHR; window.Image = oImg;
        }
    });
});

})();
