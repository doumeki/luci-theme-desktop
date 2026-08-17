/* iframe-bridge.test.js — Iframe Bridge Unit Tests */

(function() {
'use strict';

// Isolated test container (NEVER touches document.body with real links)
var testContainer;
function setupContainer() {
    testContainer = document.createElement('div');
    testContainer.id = '__test-container';
    testContainer.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
    document.body.appendChild(testContainer);
}
function cleanupContainer() {
    if (testContainer) { testContainer.remove(); testContainer = null; }
}

// Create a proxy document inside the test container
function createProxyDoc() {
    var proxy = document.createElement('div');
    proxy.innerHTML =
        '<head></head>' +
        '<header>Top Bar</header>' +
        '<div class="main">' +
        '  <div class="main-left">Sidebar</div>' +
        '  <div class="main-right" style="margin-left:200px">' +
        '    <div id="maincontent">' +
        '      <div class="container">' +
        '        <ul class="tabs">' +
        '          <li class="tabmenu-item-rules active"><a href="/cgi-bin/luci/admin/network/firewall/rules">Rules</a></li>' +
        '          <li class="tabmenu-item-custom"><a href="/cgi-bin/luci/admin/network/firewall/custom">Custom</a></li>' +
        '        </ul>' +
        '        <ul class="cbi-tabmenu">' +
        '          <li class="cbi-tab" id="tab.firewall.rule.traffic"><a onclick="this.blur(); return cbi_t_switch(\'firewall.rule\', \'traffic\')" href="/cgi-bin/luci/admin/network/firewall/rules?tab.firewall.rule=traffic">Traffic Rules</a></li>' +
        '          <li class="cbi-tab-disabled" id="tab.firewall.rule.forwards"><a href="/cgi-bin/luci/admin/network/firewall/rules?tab.firewall.rule=forwards">Port Forwards</a></li>' +
        '        </ul>' +
        '        <a href="/cgi-bin/luci/admin/status/overview">Status</a>' +
        '        <a href="/cgi-bin/luci/admin/network/firewall">Firewall</a>' +
        '        <a href="https://example.com/external">External Link</a>' +
        '        <a href="#section">Hash Link</a>' +
        '        <a href="javascript:void(0)">JS Link</a>' +
        '        <form action="/cgi-bin/luci/admin/system/admin" method="post">' +
        '          <input name="hostname" value="OpenWrt">' +
        '        </form>' +
        '      </div>' +
        '    </div>' +
        '  </div>' +
        '</div>' +
        '<footer>Footer</footer>' +
        '<div class="breadcrumb">Breadcrumb</div>' +
        '<div id="modemenu">Mode Menu</div>' +
        '<div class="showSide">Show Side</div>' +
        '<div class="darkMask">Dark Mask</div>';
    testContainer.appendChild(proxy);
    // Add a fake head if the target element doesn't have one
    if (!proxy.querySelector('head')) {
        var h = document.createElement('head');
        proxy.insertBefore(h, proxy.firstChild);
    }
    return proxy;
}

// ===== All tests use beforeEach/afterEach for guaranteed cleanup =====

describe('IframeBridge CSS injection', function() {
    beforeEach(setupContainer);
    afterEach(cleanupContainer);

    it('should hide header element', function() {
        var proxy = createProxyDoc();
        IframeBridge.injectChromeHider(proxy);
        var rules = proxy.querySelector('style#__desktop-chrome-hider');
        assert.ok(rules, 'style element injected');
        assert.contains(rules.textContent, 'header', 'hides header');
    });

    it('should hide .main-left sidebar', function() {
        var proxy = createProxyDoc();
        IframeBridge.injectChromeHider(proxy);
        var rules = proxy.querySelector('style#__desktop-chrome-hider');
        assert.contains(rules.textContent, '.main-left', 'hides main-left');
    });

    it('should hide footer', function() {
        var proxy = createProxyDoc();
        IframeBridge.injectChromeHider(proxy);
        var rules = proxy.querySelector('style#__desktop-chrome-hider');
        assert.contains(rules.textContent, 'footer', 'hides footer');
    });

    it('should adjust .main-right margin to 0', function() {
        var proxy = createProxyDoc();
        IframeBridge.injectChromeHider(proxy);
        var rules = proxy.querySelector('style#__desktop-chrome-hider');
        assert.contains(rules.textContent, '.main-right', 'targets main-right');
        assert.contains(rules.textContent, 'margin-left', 'adjusts margin');
    });

    it('should only inject once (dedup)', function() {
        var proxy = createProxyDoc();
        IframeBridge.injectChromeHider(proxy);
        IframeBridge.injectChromeHider(proxy);
        assert.equal(proxy.querySelectorAll('style#__desktop-chrome-hider').length, 1, 'only one');
    });
});

describe('IframeBridge link interception', function() {
    beforeEach(setupContainer);
    afterEach(cleanupContainer);

    // Test-only guard: plain LuCI links are now navigated natively (with a
    // repaired href) — in the test page that default would navigate away.
    // Block at bubble phase, AFTER IframeBridge's own handler ran, so the
    // href repairs still apply.
    var guard;
    function addNavGuard() {
        if (guard) return;
        guard = function(e) {
            var a = e.target.closest && e.target.closest('#__test-container a[href]');
            if (!a) return;
            var href = a.getAttribute('href') || '';
            if (href.indexOf('#') === 0 || href.indexOf('javascript:') === 0) return;
            e.preventDefault();
        };
        document.addEventListener('click', guard, false);
    }
    function removeNavGuard() {
        if (!guard) return;
        document.removeEventListener('click', guard, false);
        guard = null;
    }

    it('should repair plain LuCI links with embed=1 (in-place href rewrite)', function() {
        addNavGuard();
        var proxy = createProxyDoc();
        IframeBridge.injectLinkInterceptor(proxy, 'win-1', function(){});
        var link = proxy.querySelector('a[href*="/cgi-bin/luci/admin/status/overview"]');
        var evt = new MouseEvent('click', { bubbles: true, cancelable: true });
        link.dispatchEvent(evt);
        assert.contains(link.getAttribute('href'), 'embed=1', 'href repaired');
    });

    it('should NOT touch external links', function() {
        var proxy = createProxyDoc();
        IframeBridge.injectLinkInterceptor(proxy, 'win-1', function(){});
        var link = proxy.querySelector('a[href*="example.com"]');
        var orig = link.getAttribute('href');
        var evt = new MouseEvent('click', { bubbles: true, cancelable: true });
        link.dispatchEvent(evt);
        assert.equal(link.getAttribute('href'), orig, 'external href untouched');
    });

    it('should NOT touch hash links', function() {
        var proxy = createProxyDoc();
        IframeBridge.injectLinkInterceptor(proxy, 'win-1', function(){});
        var link = proxy.querySelector('a[href="#section"]');
        var orig = link.getAttribute('href');
        var evt = new MouseEvent('click', { bubbles: true, cancelable: true });
        link.dispatchEvent(evt);
        assert.equal(link.getAttribute('href'), orig, 'hash href untouched');
    });

    it('should NOT touch javascript: links', function() {
        var proxy = createProxyDoc();
        IframeBridge.injectLinkInterceptor(proxy, 'win-1', function(){});
        var link = proxy.querySelector('a[href*="javascript:void"]');
        var orig = link.getAttribute('href');
        var evt = new MouseEvent('click', { bubbles: true, cancelable: true });
        link.dispatchEvent(evt);
        assert.equal(link.getAttribute('href'), orig, 'javascript href untouched');
    });

    it('should let tab anchors with return-false onclick switch in place', function() {
        var proxy = createProxyDoc();
        var switched = [];
        window.cbi_t_switch = function(config, tab) { switched.push(config + '/' + tab); return false; };

        IframeBridge.injectLinkInterceptor(proxy, 'win-1', function(){});
        var link = proxy.querySelector('ul.cbi-tabmenu li.cbi-tab a');
        var hrefBefore = link.getAttribute('href');
        var evt = new MouseEvent('click', { bubbles: true, cancelable: true });
        link.dispatchEvent(evt);

        assert.equal(switched.length, 1, 'page onclick ran natively');
        assert.ok(evt.defaultPrevented, 'return false prevented navigation');
        assert.equal(link.getAttribute('href'), hrefBefore, 'href untouched');
        delete window.cbi_t_switch;
    });

    it('should rewrite the href when the tab onclick does not take over', function() {
        addNavGuard();
        var proxy = createProxyDoc();
        window.cbi_t_switch = function() { return true; };
        IframeBridge.injectLinkInterceptor(proxy, 'win-1', function(){});
        var link = proxy.querySelector('ul.cbi-tabmenu li.cbi-tab a');
        var evt = new MouseEvent('click', { bubbles: true, cancelable: true });
        link.dispatchEvent(evt);
        assert.contains(link.getAttribute('href'), 'embed=1', 'href repaired');
        delete window.cbi_t_switch;
    });

    it('should trigger tab switch when clicking the li body (not the anchor)', function() {
        addNavGuard();
        var proxy = createProxyDoc();
        var switched = [];
        window.cbi_t_switch = function(config, tab) { switched.push(config + '/' + tab); return false; };

        IframeBridge.injectLinkInterceptor(proxy, 'win-1', function(){});
        var li = proxy.querySelector('ul.cbi-tabmenu li.cbi-tab');
        var evt = new MouseEvent('click', { bubbles: true, cancelable: true });
        li.dispatchEvent(evt); // target = li itself, outside the anchor

        assert.equal(switched.length, 1, 'cbi_t_switch called via simulated anchor click');
        assert.equal(switched[0], 'firewall.rule/traffic', 'switches the correct tab');
        delete window.cbi_t_switch;
    });

    it('should repair the tab href when the li anchor has no onclick', function() {
        addNavGuard();
        var proxy = createProxyDoc();
        IframeBridge.injectLinkInterceptor(proxy, 'win-1', function(){});
        var li = proxy.querySelector('ul.cbi-tabmenu li.cbi-tab-disabled');
        var evt = new MouseEvent('click', { bubbles: true, cancelable: true });
        li.dispatchEvent(evt);
        assert.contains(li.querySelector('a[href]').getAttribute('href'), 'embed=1', 'href repaired');
    });

    it('should repair plain-tab links with no onclick (iptables IPv4/IPv6 tab)', function() {
        addNavGuard();
        var proxy = createProxyDoc();
        IframeBridge.injectLinkInterceptor(proxy, 'win-1', function(){});
        var li = proxy.querySelector('ul.cbi-tabmenu li.cbi-tab');
        var a = li.querySelector('a');
        var hrefBefore = a.getAttribute('href');
        var evt = new MouseEvent('click', { bubbles: true, cancelable: true });
        a.dispatchEvent(evt);
        assert.contains(a.getAttribute('href'), 'embed=1', 'plain tab href repaired');
        assert.notEqual(a.getAttribute('href'), hrefBefore, 'href changed');
    });

    it('should handle the theme sibling tabs (ul.tabs > li.tabmenu-item-*)', function() {
        addNavGuard();
        var proxy = createProxyDoc();
        IframeBridge.injectLinkInterceptor(proxy, 'win-1', function(){});
        var li = proxy.querySelector('ul.tabs li.tabmenu-item-rules');
        var evt = new MouseEvent('click', { bubbles: true, cancelable: true });
        li.dispatchEvent(evt); // click the li body, not the anchor
        assert.contains(li.querySelector('a[href]').getAttribute('href'), 'embed=1', 'sibling tab href repaired');
    });

    it('should stay silent on input-button JS navigation (tblsection extedit, DDNS case)', function() {
        var proxy = createProxyDoc();
        var clicked = 0;
        var btn = document.createElement('input');
        btn.type = 'button';
        btn.className = 'cbi-button cbi-button-edit';
        btn.onclick = function() { clicked++; };
        proxy.querySelector('.container').appendChild(btn);

        IframeBridge.injectLinkInterceptor(proxy, 'win-1', function(){});
        var evt = new MouseEvent('click', { bubbles: true, cancelable: true });
        btn.dispatchEvent(evt);

        assert.equal(clicked, 1, 'page onclick ran natively');
        assert.ok(!evt.defaultPrevented, 'navigation not prevented — bounce handles embed');
    });

    it('should stay silent on submit-button clicks (tblsection addremove)', function() {
        var proxy = createProxyDoc();
        var clicked = 0;
        var btn = document.createElement('input');
        btn.type = 'submit';
        btn.className = 'cbi-button cbi-button-remove';
        btn.onclick = function() { clicked++; };
        proxy.querySelector('.container').appendChild(btn);

        IframeBridge.injectLinkInterceptor(proxy, 'win-1', function(){});
        var evt = new MouseEvent('click', { bubbles: true, cancelable: true });
        btn.dispatchEvent(evt);

        assert.equal(clicked, 1, 'page onclick ran natively');
        assert.ok(!evt.defaultPrevented, 'form submit not interfered with');
    });

    it('should redirect target=_blank LuCI links into the frame', function() {
        var proxy = createProxyDoc();
        var blank = document.createElement('a');
        blank.href = '/cgi-bin/luci/admin/status/overview';
        blank.target = '_blank';
        proxy.querySelector('.container').appendChild(blank);
        IframeBridge.injectLinkInterceptor(proxy, 'win-1', function(){});
        var evt = new MouseEvent('click', { bubbles: true, cancelable: true });
        blank.dispatchEvent(evt);
        assert.ok(evt.defaultPrevented, 'new-tab link prevented');
    });
});

describe('IframeBridge postMessage protocol', function() {
    beforeEach(setupContainer);
    afterEach(cleanupContainer);

    it('should handle "open-window" message', function() {
        var openedUrl = null;
        var origOpen = WM.open;
        WM.open = function(url, title) { openedUrl = url; return 'win-new'; };

        IframeBridge.handleMessage({
            data: { type: 'open-window', url: '/admin/status/overview', title: 'Status' },
            source: {}
        });

        assert.ok(!!openedUrl, 'WM.open was called');
        WM.open = origOpen;
    });

    it('should handle "set-title" message', function() {
        var titleSet = null;
        var origSet = WM.setTitle;
        WM.setTitle = function(id, title) { titleSet = title; };

        IframeBridge.handleMessage({
            data: { type: 'set-title', id: 'win-1', title: 'New Title' },
            source: {}
        });

        assert.equal(titleSet, 'New Title', 'WM.setTitle called');
        WM.setTitle = origSet;
    });
});

describe('IframeBridge auto-refresh control', function() {
    beforeEach(function() {
        setupContainer();
        // Clean up any iframes from previous tests
        document.querySelectorAll('iframe.__test-ar').forEach(function(f) { f.remove(); });
    });
    afterEach(function() {
        cleanupContainer();
        document.querySelectorAll('iframe.__test-ar').forEach(function(f) { f.remove(); });
    });

    it('getAutoRefresh: should return true by default', function() {
        // desktop-config has empty theme object, so auto_refresh is undefined → default true
        assert.equal(IframeBridge.getAutoRefresh(), true, 'defaults to true');
    });

    it('getAutoRefresh: follows the in-page toggle state, starts ON by default', function() {
        // User decision 2026-08-16: state is NOT persisted — page load
        // starts ON, and the CURRENT in-page toggle value governs newly
        // opened iframes (bugfix 0.1.0-133: closing auto-refresh then
        // opening an app must not start it refreshing).
        var origOn = IframeBridge._arOn;
        IframeBridge._arOn = true;
        assert.equal(IframeBridge.getAutoRefresh(), true, 'starts ON by default');
        IframeBridge._arOn = false;
        assert.equal(IframeBridge.getAutoRefresh(), false, 'follows in-page OFF');
        IframeBridge._arOn = origOn;
    });

    it('broadcastAutoRefresh updates the state for later-opened iframes', function() {
        // A toggle broadcast must be remembered: an iframe opened AFTER
        // the toggle (onIframeLoad → getAutoRefresh) inherits it.
        var origOn = IframeBridge._arOn;
        IframeBridge.broadcastAutoRefresh(false);
        assert.equal(IframeBridge.getAutoRefresh(), false, 'new iframes inherit OFF');
        IframeBridge.broadcastAutoRefresh(true);
        assert.equal(IframeBridge.getAutoRefresh(), true, 'back ON after toggle');
        IframeBridge._arOn = origOn;
    });

    // Helper: create a test iframe with mocked contentWindow
    function mockIframe(msgs, xhr) {
        var f = document.createElement('iframe');
        f.className = '__test-ar';
        var cw = { postMessage: function(msg, origin) { msgs.push(msg); }, XHR: xhr || null };
        Object.defineProperty(f, 'contentWindow', { value: cw, writable: true, configurable: true });
        document.body.appendChild(f);
        return f;
    }

    it('broadcastAutoRefresh: should send postMessage to all iframes', function() {
        var msgs = [];
        mockIframe(msgs, null);
        mockIframe(msgs, null);

        IframeBridge.broadcastAutoRefresh(false);

        assert.equal(msgs.length, 2, 'both iframes received postMessage');
        assert.equal(msgs[0].type, 'set-auto-refresh', 'correct message type');
        assert.equal(msgs[0].on, false, 'auto-refresh OFF');
        assert.equal(msgs[1].on, false, 'both OFF');
    });

    it('broadcastAutoRefresh: should call XHR.halt() when turning off', function() {
        var halted = false;
        var msgs = [];
        mockIframe(msgs, { halt: function() { halted = true; }, run: function() {} });

        IframeBridge.broadcastAutoRefresh(false);

        assert.ok(halted, 'XHR.halt() was called');
    });

    it('broadcastAutoRefresh: should call XHR.run() when turning on', function() {
        var ran = false;
        var msgs = [];
        mockIframe(msgs, { halt: function() {}, run: function() { ran = true; } });

        IframeBridge.broadcastAutoRefresh(true);

        assert.ok(ran, 'XHR.run() was called');
    });

    it('broadcastAutoRefresh: should skip iframes without XHR gracefully', function() {
        var msgs = [];
        mockIframe(msgs); // no XHR, just postMessage

        // Should not throw
        var threw = false;
        try { IframeBridge.broadcastAutoRefresh(false); } catch(e) { threw = true; }
        assert.ok(!threw, 'no error when XHR is missing');
    });
});

describe('IframeBridge URL helpers', function() {
    beforeEach(setupContainer);
    afterEach(cleanupContainer);

    it('getEmbedUrl: should append ?embed=1 for clean URLs', function() {
        assert.equal(IframeBridge.getEmbedUrl('/test'), '/test?embed=1');
    });

    it('getEmbedUrl: should append &embed=1 for URLs with params', function() {
        assert.equal(IframeBridge.getEmbedUrl('/test?a=1'), '/test?a=1&embed=1');
    });

    it('getEmbedUrl: should not double-append', function() {
        assert.equal(IframeBridge.getEmbedUrl('/test?embed=1'), '/test?embed=1');
    });

    it('getEmbedUrl: should repair double-question-mark mangled URLs', function() {
        assert.equal(IframeBridge.getEmbedUrl('/test?embed=1?tab.x=y'), '/test?embed=1');
        assert.equal(IframeBridge.getEmbedUrl('/test?embed=1?page=2'), '/test?embed=1');
        assert.equal(IframeBridge.getEmbedUrl('/test?a=1&embed=1?tab.x=y'), '/test?a=1&embed=1');
    });

    it('getEmbedUrl: should keep non-LuCI URLs untouched', function() {
        assert.equal(IframeBridge.getEmbedUrl('about:blank'), 'about:blank');
        assert.equal(IframeBridge.getEmbedUrl('javascript:void(0)'), 'javascript:void(0)');
        assert.equal(IframeBridge.getEmbedUrl('#section'), '#section');
        assert.equal(IframeBridge.getEmbedUrl(''), '');
    });

    it('isLuCIUrl: should detect /cgi-bin/luci/ URLs', function() {
        assert.ok(IframeBridge.isLuCIUrl('/cgi-bin/luci/admin/status/overview'));
    });

    it('isLuCIUrl: should detect relative /admin/ URLs', function() {
        assert.ok(IframeBridge.isLuCIUrl('/admin/status/overview'));
    });

    it('isLuCIUrl: should reject external URLs', function() {
        assert.ok(!IframeBridge.isLuCIUrl('https://example.com'));
        assert.ok(!IframeBridge.isLuCIUrl('http://example.com/admin'));
    });

    it('isLuCIUrl: should reject hash and javascript', function() {
        assert.ok(!IframeBridge.isLuCIUrl('#section'));
        assert.ok(!IframeBridge.isLuCIUrl('javascript:void(0)'));
    });
});

// ===== ttyd terminal iframe height fit (2026-08-16) =====
// User report: on the ttyd terminal page the app iframe carries inline
// min-height:500px and never fills the window — a large empty band below
// the shell input. fitTtydIframe() sizes it to the .main-right viewport
// remainder (container bottom − #view top).
describe('IframeBridge.fitTtydIframe', function() {
    function mockTtydDoc(mrBottom, viewTop, hasView) {
        var iframe = {
            style: {},
            getBoundingClientRect: function() {
                return { bottom: 0, height: 0, top: viewTop };
            }
        };
        var view = {
            getBoundingClientRect: function() { return { top: viewTop, bottom: viewTop + 500 }; },
            querySelector: function() { return iframe; }
        };
        var mr = {
            clientHeight: mrBottom - 8,
            scrollHeight: 700,
            getBoundingClientRect: function() { return { bottom: mrBottom, top: 8 }; }
        };
        var doc = {
            querySelector: function(sel) {
                if (sel === '#view iframe') return hasView ? iframe : null;
                if (sel === '.main-right') return mr;
                if (sel === '#view') return hasView ? view : null;
                return null;
            }
        };
        return { doc: doc, iframe: iframe, mr: mr };
    }

    it('sizes the ttyd iframe to fill the .main-right remainder', function() {
        var m = mockTtydDoc(656, 180, true);
        IframeBridge.fitTtydIframe(m.doc);
        var expect = 656 - 180 - 4;
        assert.equal(m.iframe.style.height, expect + 'px', 'iframe height = container bottom − view top − gap');
        assert.equal(m.iframe.style.minHeight, expect + 'px', 'minHeight overrides inline 500px');
    });

    it('no-ops when there is no ttyd iframe (regular pages untouched)', function() {
        var m = mockTtydDoc(656, 180, false);
        IframeBridge.fitTtydIframe(m.doc);
        assert.ok(!m.iframe.style.height, 'regular page iframe untouched');
    });

    it('legacy ttyd (253): iframe directly in .main-right, port 7681', function() {
        // 253/Lua runtime terminal page has no #view — the ttyd iframe
        // (src :7681) sits directly inside .main-right at ~380px, leaving
        // a band below it. Must be fitted to the container bottom.
        var ttydIframe = {
            src: 'http://10.0.0.2:7681/',
            style: {},
            getBoundingClientRect: function() { return { top: 146, bottom: 526, height: 380 }; }
        };
        var otherIframe = {
            src: 'http://10.0.0.2/cgi-bin/luci/admin/status',
            style: {},
            getBoundingClientRect: function() { return { top: 0, bottom: 100, height: 100 }; }
        };
        var mr = {
            getBoundingClientRect: function() { return { bottom: 648, top: 8 }; },
            querySelectorAll: function() { return [otherIframe, ttydIframe]; }
        };
        var doc = {
            querySelector: function(sel) {
                if (sel === '#view iframe') return null;
                if (sel === '#view') return null;
                if (sel === '.main-right') return mr;
                return null;
            }
        };
        IframeBridge.fitTtydIframe(doc);
        var expect = 648 - 146 - 4;
        assert.equal(ttydIframe.style.height, expect + 'px', 'legacy ttyd iframe fitted to container');
        assert.equal(ttydIframe.style.minHeight, expect + 'px', 'minHeight set');
        assert.ok(!otherIframe.style.height, 'non-ttyd iframe untouched');
    });

    // New luci-app-ttyd (26.x, OpenWrt 25.12) creates the :7681 iframe
    // from JS AFTER the page load event — onIframeLoad's fit runs too
    // early and finds nothing, leaving the terminal at inline 500px
    // (user report 2026-08-17: terminal page). A #view container marks
    // this as a ttyd page → schedule retries instead of giving up.
    it('retries when #view exists but the ttyd iframe is injected late', function() {
        var origSetTimeout = window.setTimeout;
        var scheduled = [];
        window.setTimeout = function(fn, ms) { scheduled.push(ms); return 1; };
        try {
            var view = { getBoundingClientRect: function() { return { top: 180, bottom: 680 }; } };
            var mr = {
                getBoundingClientRect: function() { return { bottom: 656, top: 8 }; },
                querySelectorAll: function() { return []; }
            };
            var doc = {
                querySelector: function(sel) {
                    if (sel === '#view iframe') return null;
                    if (sel === '.main-right') return mr;
                    if (sel === '#view') return view;
                    return null;
                }
            };
            IframeBridge.fitTtydIframe(doc);
            assert.ok(scheduled.length > 0, 'retry scheduled for late-injected ttyd iframe');
        } finally {
            window.setTimeout = origSetTimeout;
        }
    });

    it('no retry on regular pages (no #view)', function() {
        var origSetTimeout = window.setTimeout;
        var scheduled = [];
        window.setTimeout = function(fn, ms) { scheduled.push(ms); return 1; };
        try {
            var mr = { getBoundingClientRect: function() { return { bottom: 656, top: 8 }; } };
            var doc = {
                querySelector: function(sel) {
                    if (sel === '#view iframe') return null;
                    if (sel === '.main-right') return mr;
                    if (sel === '#view') return null;
                    return null;
                }
            };
            IframeBridge.fitTtydIframe(doc);
            assert.equal(scheduled.length, 0, 'no retry on non-ttyd pages');
        } finally {
            window.setTimeout = origSetTimeout;
        }
    });
});
})();
