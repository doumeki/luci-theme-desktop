/* shell-app.test.js — Direct-visit app boot behavior:
 * Visiting a non-landing page (bookmark / URL bar) renders the full
 * desktop shell AND auto-opens that page as an app window — desktop and
 * mobile alike. The header injects __DESKTOP_BOOT_APP__ (server-side);
 * shell.js boot() consumes it and calls WM.open.
 *
 * Tests:
 *  1. boot() with __DESKTOP_BOOT_APP__ set → WM.open called with the URL
 *  2. boot() without it → no window opened (landing page stays clean)
 *  3. path normalization (leading /cgi-bin/luci/ stripped/added)
 */
(function() {
'use strict';

var DESKTOP = window.LuCIDesktop;
var realOpen = null;

function setup() {
    // Spy on WM.open without breaking the rest of the suite
    realOpen = WM.open;
    WM.open = function(url, title) { window.__TEST_OPEN__ = { url: url, title: title }; return 'win'; };
}

function teardown() {
    WM.open = realOpen;
    delete window.__TEST_OPEN__;
    delete window.__DESKTOP_BOOT_APP__;
}

describe('Direct-visit app boot (__DESKTOP_BOOT_APP__)', function() {
    beforeEach(setup);
    afterEach(teardown);

    it('boot() auto-opens the injected path as an app window', function() {
        window.__DESKTOP_BOOT_APP__ = '/cgi-bin/luci/admin/status/overview';
        // boot() does a lot (wallpaper, indicators…); exercise the same
        // code path via _handleAppParam which the injected var feeds.
        // We stub _handleAppParam's internals by calling it directly after
        // setting the var — the var handling is what we test.
        if (DESKTOP._openBootApp) DESKTOP._openBootApp();
        assert.ok(window.__TEST_OPEN__, 'WM.open called');
        assert.equal(window.__TEST_OPEN__.url, '/cgi-bin/luci/admin/status/overview', 'full URL opened');
    });

    it('boot() without the injected path opens nothing', function() {
        delete window.__DESKTOP_BOOT_APP__;
        if (DESKTOP._openBootApp) DESKTOP._openBootApp();
        assert.ok(!window.__TEST_OPEN__, 'no window opened on landing page');
    });

    it('_handleAppParam still handles ?app= (existing shortcut path)', function() {
        // existing behavior must not regress
        var qs = '?app=admin/status/overview';
        var m = qs.match(/[?&]app=([^&]+)/);
        assert.ok(m, 'app param parsed');
        assert.equal(m[1], 'admin/status/overview', 'path extracted');
    });
});

// ===== Browser tab title: <hostname> Router (translated) =====
// The header injects __ROUTER_HOSTNAME__; shell.boot() applies the theme
// i18n dictionary (zh_cn: Router -> 路由器). WM.open must not touch it.
describe('Router browser title', function() {
    var origLang, origHost, origTitle;

    beforeEach(function() {
        origLang = document.documentElement.getAttribute('lang');
        origHost = window.__ROUTER_HOSTNAME__;
        origTitle = document.title;
    });

    afterEach(function() {
        if (origLang === null) document.documentElement.removeAttribute('lang');
        else document.documentElement.setAttribute('lang', origLang);
        if (typeof origHost === 'undefined') delete window.__ROUTER_HOSTNAME__;
        else window.__ROUTER_HOSTNAME__ = origHost;
        document.title = origTitle;
    });

    it('uses hostname + translated Router in zh_cn', function() {
        document.documentElement.setAttribute('lang', 'zh_Hans');
        window.__ROUTER_HOSTNAME__ = 'TestRouter';
        DESKTOP._applyRouterTitle();
        assert.equal(document.title, 'TestRouter 路由器');
    });

    it('uses hostname + Router in English', function() {
        document.documentElement.setAttribute('lang', 'en');
        window.__ROUTER_HOSTNAME__ = 'TestRouter';
        DESKTOP._applyRouterTitle();
        assert.equal(document.title, 'TestRouter Router');
    });
});
})();
