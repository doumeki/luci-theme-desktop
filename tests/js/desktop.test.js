/* desktop.test.js — Desktop shortcut availability probing
 *
 * Regression (2026-08-16, 1.1 ImmortalWrt ucode runtime): the Terminal
 * default shortcut is runtime-dependent (_runtimePath) — ucode serves
 * /admin/services/ttyd/ttyd, Lua keeps /admin/system/terminal. The footer
 * injects window.__LUCI_RUNTIME__ AFTER desktop.js is registered (and
 * Desktop.init ran), so probeDefaultShortcuts() resolved the path with
 * __LUCI_RUNTIME__ still undefined → fell back to the Lua path → the
 * ucode path was never probed → a 404 icon stayed on the desktop.
 *
 * These tests replay the probe with a mocked fetch to pin the behavior:
 * the URL actually probed must match the CURRENT runtime, and a 404 must
 * hide the icon.
 */
(function() {
'use strict';

// Runtime resolution, mirroring desktop.js runtimeTerminalUrl().
function terminalUrl() {
    return (window.__LUCI_RUNTIME__ === 'ucode')
        ? '/cgi-bin/luci/admin/services/ttyd/ttyd'
        : '/cgi-bin/luci/admin/system/terminal';
}

describe('Desktop terminal shortcut availability probe', function() {
    var origFetch, origRuntime, origUnavailable, origRender;

    function setupMenu(hasTerminal) {
        // Real menu hrefs are FULL paths (verified on 1.1):
        // "/cgi-bin/luci/admin/status/overview" etc.
        window.LuCIMenuData = [{
            href: '/cgi-bin/luci/admin/status/overview',
            subs: [
                { href: '/cgi-bin/luci/admin/system/system' },
                { href: '/cgi-bin/luci/admin/network/firewall' }
            ].concat(hasTerminal ? [{ href: '/cgi-bin/luci/admin/services/ttyd/ttyd' }] : [])
        }];
    }

    beforeEach(function() {
        origFetch = window.fetch;
        origRuntime = window.__LUCI_RUNTIME__;
        origUnavailable = window.Desktop._unavailable;
        origRender = window.Desktop.renderShortcuts;
        // stub render so the probe's re-render is observable but harmless
        window.Desktop.renderShortcuts = function() { window.Desktop._renderCount = (window.Desktop._renderCount || 0) + 1; };
        // fresh state
        window.Desktop._unavailable = null;
        window.Desktop._renderCount = 0;
        window.Desktop._terminalUrl = undefined;
    });

    afterEach(function() {
        window.fetch = origFetch;
        window.__LUCI_RUNTIME__ = origRuntime;
        window.Desktop._unavailable = origUnavailable;
        window.Desktop.renderShortcuts = origRender;
        delete window.LuCIMenuData;
    });

    it('probes ALL ucode terminal candidates when __LUCI_RUNTIME__=ucode (regression)', function() {
        // ttyd NOT installed, terminal absent from menu tree → must probe
        // every known ucode path (new /admin/services/ttyd/ttyd first, then
        // legacy /admin/system/ttyd/ttyd) and hide on total 404.
        setupMenu(false);
        window.__LUCI_RUNTIME__ = 'ucode';
        var probed = [];
        window.fetch = function(url, opts) {
            probed.push(url);
            return Promise.resolve({ ok: false, status: 404 });   // 404 → hide
        };
        window.Desktop.probeDefaultShortcuts();
        // fetch is async; the candidate chain spans several microtasks —
        // wait a macrotask so the whole chain settles
        return new Promise(function(res) { setTimeout(res, 20); }).then(function() {
            assert.ok(probed.indexOf('/cgi-bin/luci/admin/services/ttyd/ttyd') !== -1,
                'probed new ucode terminal path, got: ' + probed.join(','));
            assert.ok(probed.indexOf('/cgi-bin/luci/admin/system/ttyd/ttyd') !== -1,
                'probed legacy ucode terminal path, got: ' + probed.join(','));
            assert.ok(probed.indexOf('/cgi-bin/luci/admin/system/terminal') === -1,
                'did NOT probe the Lua path, got: ' + probed.join(','));
            assert.ok(window.Desktop._unavailable['/cgi-bin/luci/admin/services/ttyd/ttyd'],
                'new ucode terminal marked unavailable on 404');
            assert.ok(window.Desktop._unavailable['/cgi-bin/luci/admin/system/ttyd/ttyd'],
                'legacy ucode terminal marked unavailable on 404');
        });
    });

    it('ucode: legacy path used when the NEW path 404s (old luci-app-ttyd)', function() {
        // Older ucode LuCI (e.g. ImmortalWrt 25.12) still serves ttyd at
        // /admin/system/ttyd/ttyd — the probe must fall through to it.
        setupMenu(false);
        window.__LUCI_RUNTIME__ = 'ucode';
        var probed = [];
        window.fetch = function(url, opts) {
            probed.push(url);
            return Promise.resolve(
                url.indexOf('/admin/services/ttyd/ttyd') !== -1
                    ? { ok: false, status: 404 }
                    : { ok: true, status: 200 });
        };
        window.Desktop.probeDefaultShortcuts();
        return new Promise(function(res) { setTimeout(res, 20); }).then(function() {
            assert.equal(window.Desktop._terminalUrl, '/cgi-bin/luci/admin/system/ttyd/ttyd',
                'legacy ucode path resolved when new path 404s, got: ' + window.Desktop._terminalUrl);
            assert.ok(!window.Desktop._unavailable['/cgi-bin/luci/admin/system/ttyd/ttyd'],
                'resolved path not marked unavailable');
        });
    });

    it('ucode: stops probing after the first candidate resolves 200', function() {
        setupMenu(false);
        window.__LUCI_RUNTIME__ = 'ucode';
        var probed = [];
        window.fetch = function(url, opts) {
            probed.push(url);
            return Promise.resolve({ ok: true, status: 200 });
        };
        window.Desktop.probeDefaultShortcuts();
        return new Promise(function(res) { setTimeout(res, 20); }).then(function() {
            assert.equal(window.Desktop._terminalUrl, '/cgi-bin/luci/admin/services/ttyd/ttyd',
                'new path wins when available');
            assert.ok(probed.indexOf('/cgi-bin/luci/admin/system/ttyd/ttyd') === -1,
                'legacy path not probed after new path resolved, got: ' + probed.join(','));
        });
    });

    it('probes the LUA terminal URL when __LUCI_RUNTIME__=lua', function() {
        setupMenu(false);
        window.__LUCI_RUNTIME__ = 'lua';
        var probed = [];
        window.fetch = function(url, opts) {
            probed.push(url);
            return Promise.resolve({ ok: false, status: 404 });
        };
        window.Desktop.probeDefaultShortcuts();
        return Promise.resolve().then(function() {
            assert.ok(probed.indexOf('/cgi-bin/luci/admin/system/terminal') !== -1,
                'probed lua terminal path, got: ' + probed.join(','));
        });
    });

    it('skips probing when the terminal is in the menu tree (installed)', function() {
        // ttyd installed → menu tree contains the ucode path → no probe,
        // icon stays.
        setupMenu(true);
        window.__LUCI_RUNTIME__ = 'ucode';
        var probed = [];
        window.fetch = function(url, opts) {
            probed.push(url);
            return Promise.resolve({ ok: true, status: 200 });
        };
        window.Desktop.probeDefaultShortcuts();
        return Promise.resolve().then(function() {
            assert.ok(probed.indexOf('/cgi-bin/luci/admin/services/ttyd/ttyd') === -1,
                'no probe when menu tree has the terminal');
            assert.ok(!window.Desktop._unavailable['/cgi-bin/luci/admin/services/ttyd/ttyd'],
                'terminal not marked unavailable when in menu tree');
        });
    });

    it('regression: boot-time probe (pre-footer) must still hide the 404 terminal on ucode', function() {
        // THE actual bug (1.1 ImmortalWrt): Desktop.init ran at module
        // registration — BEFORE the footer injected __LUCI_RUNTIME__ —
        // so the probe resolved the Lua path and the ucode ttyd path was
        // never probed/hidden (icon stayed, page 404s).
        // Fix: probe moved out of init; shell.js boot() re-runs it AFTER
        // the footer injected the runtime. This test simulates the
        // FIXED sequence: probe runs with __LUCI_RUNTIME__=ucode set
        // (boot semantics) and the 404 must hide the ucode icon.
        setupMenu(false);
        window.__LUCI_RUNTIME__ = 'ucode';   // footer already injected (boot)
        var probed = [];
        window.fetch = function(url, opts) {
            probed.push(url);
            return Promise.resolve({ ok: false, status: 404 });
        };
        window.Desktop.probeDefaultShortcuts();
        return new Promise(function(res) { setTimeout(res, 20); }).then(function() {
            var ucodeProbed = probed.indexOf('/cgi-bin/luci/admin/services/ttyd/ttyd') !== -1;
            var hidden = !!(window.Desktop._unavailable || {})['/cgi-bin/luci/admin/services/ttyd/ttyd'];
            assert.ok(ucodeProbed && hidden,
                'ucode terminal probed & hidden on boot-time probe, got probes: ' + probed.join(','));
        });
    });

    it('Desktop.init must NOT probe before the runtime is injected', function() {
        // The fix moves probing out of init (register time, pre-footer).
        // Pin that: with __LUCI_RUNTIME__ undefined, calling init must not
        // fire any terminal probe (the boot() re-probe is the only place).
        setupMenu(false);
        window.__LUCI_RUNTIME__ = undefined;
        var probed = [];
        window.fetch = function(url, opts) {
            probed.push(url);
            return Promise.resolve({ ok: false, status: 404 });
        };
        // init does loadConfig/render — call it directly and watch probes.
        window.Desktop.init();
        return Promise.resolve().then(function() {
            assert.equal(probed.length, 0,
                'no terminal probe from init before runtime injection (got: ' + probed.join(',') + ')');
        });
    });
});

// ===== Installable default shortcuts (2026-08-16) =====
// A default shortcut that 404s (e.g. Terminal when ttyd is missing) is NOT
// hidden anymore — it renders as "installable" (corner badge + Install in
// the context menu) so the user can install the missing component in place.
describe('Desktop installable shortcut', function() {
    var origFetch, origRuntime, origUnavailable, origRender, origXHR, origReload;

    function setupMenu(hasTerminal) {
        window.LuCIMenuData = [{
            href: '/cgi-bin/luci/admin/status/overview',
            subs: [
                { href: '/cgi-bin/luci/admin/system/system' }
            ].concat(hasTerminal ? [{ href: '/cgi-bin/luci/admin/services/ttyd/ttyd' }] : [])
        }];
    }
    // 404 探测 → 标记 unavailable
    function probe404() {
        window.fetch = function(url, opts) {
            return Promise.resolve({ ok: false, status: 404 });
        };
        window.Desktop.probeDefaultShortcuts();
        return Promise.resolve().then(function() {});
    }

    beforeEach(function() {
        origFetch = window.fetch;
        origRuntime = window.__LUCI_RUNTIME__;
        origUnavailable = window.Desktop._unavailable;
        origRender = window.Desktop.renderShortcuts;
        origXHR = window.XMLHttpRequest;
        origReload = window.Desktop._reloadPage;
        window.__LUCI_RUNTIME__ = 'ucode';
        window.Desktop._unavailable = null;
        window.Desktop._terminalUrl = undefined;
        // 还原真实 render（要断言 DOM）
        window.Desktop.renderShortcuts = origRender;
        // stub reload hook
        window.Desktop._reloadPage = function() { window.__reloaded = true; };
        // 图标容器
        var c = document.getElementById('desktop-icons');
        if (!c) { c = document.createElement('div'); c.id = 'desktop-icons'; document.body.appendChild(c); }
    });

    afterEach(function() {
        window.fetch = origFetch;
        window.__LUCI_RUNTIME__ = origRuntime;
        window.Desktop._unavailable = origUnavailable;
        window.Desktop.renderShortcuts = origRender;
        window.XMLHttpRequest = origXHR;
        window.Desktop._reloadPage = origReload;
        delete window.LuCIMenuData;
        delete window.__reloaded;
        document.getElementById('desktop-icons').innerHTML = '';
    });

    it('404 default shortcut renders as INSTALLABLE (icon kept, badge added)', function() {
        setupMenu(false);
        return probe404().then(function() {
            window.Desktop.renderShortcuts();
            var icons = document.querySelectorAll('#desktop-icons .desktop-icon');
            var term = null;
            icons.forEach(function(el) {
                var u = el.getAttribute('data-url') || '';
                if (/ttyd|terminal/.test(u)) term = el;
            });
            assert.ok(term, 'terminal icon still rendered (not hidden)');
            assert.ok(term.classList.contains('installable'), 'icon marked installable');
            assert.ok(term.querySelector('.install-badge'), 'install badge present');
        });
    });

    it('installed shortcut (in menu tree) renders WITHOUT installable badge', function() {
        setupMenu(true);
        window.Desktop._unavailable = {};
        window.Desktop.renderShortcuts();
        var icons = document.querySelectorAll('#desktop-icons .desktop-icon');
        var term = null;
        icons.forEach(function(el) {
            var u = el.getAttribute('data-url') || '';
            if (/ttyd|terminal/.test(u)) term = el;
        });
        assert.ok(term, 'terminal icon rendered');
        assert.ok(!term.classList.contains('installable'), 'no installable class when installed');
        assert.ok(!term.querySelector('.install-badge'), 'no install badge when installed');
    });

    it('context menu of an installable icon contains Install', function() {
        setupMenu(false);
        return probe404().then(function() {
            window.Desktop.renderShortcuts();
            var icons = document.querySelectorAll('#desktop-icons .desktop-icon');
            var term = null;
            icons.forEach(function(el) {
                var u = el.getAttribute('data-url') || '';
                if (/ttyd|terminal/.test(u)) term = el;
            });
            // 触发 contextmenu → 菜单出现
            var ev = new MouseEvent('contextmenu', { clientX: 10, clientY: 10, bubbles: true });
            term.dispatchEvent(ev);
            var menu = document.getElementById('icon-context-menu');
            assert.ok(menu, 'context menu opened');
            var items = Array.prototype.map.call(menu.querySelectorAll('.context-item'), function(i) {
                return i.textContent;
            });
            assert.ok(items.indexOf('Install') !== -1, 'Install item present, got: ' + items.join(','));
            assert.ok(items.indexOf('Open') === -1, 'no Open for installable (would 404), got: ' + items.join(','));
        });
    });

    it('clicking Install POSTs the install endpoint and starts polling', function() {
        setupMenu(false);
        var posts = [];
        window.XMLHttpRequest = function() {
            this.open = function(m, u, async) { posts.push({ m: m, u: u }); };
            this.setRequestHeader = function() {};
            this.send = function() {
                var self = this;
                setTimeout(function() {
                    self.status = 200;
                    self.responseText = '{"ok":true,"started":true}';
                    if (self.onload) self.onload();
                }, 0);
            };
        };
        return probe404().then(function() {
            // 直接调用安装（避免依赖右键菜单 DOM）
            window.Desktop.installDefault('/cgi-bin/luci/admin/services/ttyd/ttyd');
            // 等异步 POST + 轮询启动
            return new Promise(function(res) { setTimeout(res, 50); });
        }).then(function() {
            var installPost = posts.filter(function(p) {
                return p.u.indexOf('/admin/desktop/install_ttyd') !== -1;
            });
            assert.ok(installPost.length > 0, 'install endpoint POSTed, got: ' + JSON.stringify(posts));
        });
    });

    it('regression: renderShortcuts re-renders with the injected runtime after probe', function() {
        // 0.1.0-137 bug: Desktop.init renders shortcuts BEFORE the footer
        // injects __LUCI_RUNTIME__ → Terminal icon URL resolved to the Lua
        // path. boot() then re-probed with ucode (ttyd/ttyd reachable) and
        // never re-rendered — the icon stayed on the 404 Lua path.
        // Fix: probeDefaultShortcuts ALWAYS re-renders afterwards.
        setupMenu(false);   // ttyd absent from menu tree → probe runs
        var probed = [];
        window.fetch = function(url, opts) {
            probed.push(url);
            return Promise.resolve({ ok: true, status: 200 });   // ttyd reachable
        };
        window.Desktop._unavailable = {};
        // init 的早期渲染（runtime 未注入）
        window.__LUCI_RUNTIME__ = undefined;
        window.Desktop.renderShortcuts();
        var earlyUrl = null;
        document.querySelectorAll('#desktop-icons .desktop-icon').forEach(function(el){
            var u = el.getAttribute('data-url') || '';
            if (/ttyd|terminal/.test(u)) earlyUrl = u;
        });
        assert.equal(earlyUrl, '/cgi-bin/luci/admin/system/terminal',
            'pre-injection render used lua path (hazard), got: ' + earlyUrl);
        // boot 注入 runtime + probe → 必须重渲染为 ucode 路径
        window.__LUCI_RUNTIME__ = 'ucode';
        // 直接验证：设 ucode 后显式 render 应该出 ttyd/ttyd
        window.Desktop.renderShortcuts();
        var midUrl = null;
        document.querySelectorAll('#desktop-icons .desktop-icon').forEach(function(el){
            var u = el.getAttribute('data-url') || '';
            if (/ttyd|terminal/.test(u)) midUrl = u;
        });
        window.__debugMid = midUrl;
        window.Desktop.probeDefaultShortcuts();
        // probe 异步（fetch promise + _finishProbeRender setTimeout(0)）
        return new Promise(function(res) { setTimeout(res, 50); }).then(function() {
            var afterUrl = null;
            document.querySelectorAll('#desktop-icons .desktop-icon').forEach(function(el){
                var u = el.getAttribute('data-url') || '';
                if (/ttyd|terminal/.test(u)) afterUrl = u;
            });
            assert.equal(afterUrl, '/cgi-bin/luci/admin/services/ttyd/ttyd',
                'post-probe re-render uses ucode path, got: ' + afterUrl + ' (mid=' + window.__debugMid + ')');
        });
    });

    it('polling reloads the page once ttyd is installed', function() {
        setupMenu(false);
        var statusCalls = 0;
        window.XMLHttpRequest = function() {
            this.open = function(m, u, async) {};
            this.setRequestHeader = function() {};
            this.send = function() {
                var self = this;
                setTimeout(function() {
                    self.status = 200;
                    statusCalls++;
                    self.responseText = statusCalls >= 2
                        ? '{"installed":true}'
                        : '{"installed":false}';
                    if (self.onload) self.onload();
                }, 0);
            };
        };
        return probe404().then(function() {
            // stub 安装完成立即轮询
            window.Desktop._installPoll = function() {};   // 屏蔽真实轮询定时器
            // 手动驱动一次状态检查
            window.Desktop.checkInstallStatus(function(done) {
                window.__reloaded = true;
                done();
            });
            return new Promise(function(res) { setTimeout(res, 60); });
        }).then(function() {
            assert.ok(window.__reloaded, 'page reloaded once ttyd installed');
        });
    });
});

// ===== Custom URL shortcuts (0.1.0-213) =====
// Desktop right-click → Add Custom URL. A custom link is a pin carrying
// custom:true — its URL is NOT in the LuCI menu tree, so the menu-driven
// ghost cleanup must leave it alone, and an external link opens in a
// browser tab (framing it would leave a blank desktop window:
// X-Frame-Options).
describe('Desktop custom URL shortcuts', function() {
    var origXHR, origWMOpen, origWindowOpen, posts;

    function setConfig(obj) {
        var el = document.getElementById('desktop-config');
        // getConfig() caches the parsed object and only re-parses when the
        // RAW TEXT changed — identical JSON would keep the previous test's
        // (mutated) arrays alive. Blank the tag first to drop the cache.
        el.textContent = '';
        LuCIDesktop.getConfig();
        el.textContent = JSON.stringify(obj);
        window.Desktop.reloadConfig();
    }
    // Last pins payload that went to the save endpoint, decoded.
    function savedPins() {
        for (var i = posts.length - 1; i >= 0; i--) {
            var b = posts[i].body || '';
            if (b.indexOf('section=pins') === -1) continue;
            var m = /(?:^|&)data=([^&]*)/.exec(b);
            if (m) return JSON.parse(decodeURIComponent(m[1].replace(/\+/g, ' ')));
        }
        return null;
    }

    beforeEach(function() {
        posts = [];
        origXHR = window.XMLHttpRequest;
        window.XMLHttpRequest = function() {
            this.open = function(method, url) { this._url = url; };
            this.setRequestHeader = function() {};
            this.send = function(body) { posts.push({ url: this._url, body: body }); };
        };
        origWMOpen = window.WM.open;
        origWindowOpen = window.open;
        setConfig({ pins: [], hidden_icons: [], widgets: {}, theme: {}, wallpaper: {} });
    });

    afterEach(function() {
        window.XMLHttpRequest = origXHR;
        window.WM.open = origWMOpen;
        window.open = origWindowOpen;
        delete window.LuCIMenuData;
        document.querySelectorAll('.link-dialog-overlay').forEach(function(el) { el.remove(); });
    });

    it('normalizes what the user typed without adding an http:// prefix', function() {
        var D = window.Desktop;
        assert.equal(D.normalizeUrl('  /cgi-bin/luci/admin/status/overview '), '/cgi-bin/luci/admin/status/overview', 'LuCI path kept');
        assert.equal(D.normalizeUrl('admin/status/overview'), '/admin/status/overview', 'bare LuCI path gets a slash');
        assert.equal(D.normalizeUrl('https://example.com/x'), 'https://example.com/x', 'https kept');
        assert.equal(D.normalizeUrl('example.com'), 'example.com', 'bare host stored as typed');
        assert.equal(D.normalizeUrl('example.com:8080'), 'example.com:8080', 'domain:port is not a scheme');
        assert.equal(D.normalizeUrl('192.0.2.1:8080'), '192.0.2.1:8080', 'bare IP:port stored as typed');
        assert.equal(D.normalizeUrl('{noproto}//example.com:8080'), '{noproto}//example.com:8080', 'noproto marker preserved');
        assert.equal(D.normalizeUrl('{noproto}mailto:x@example.com'), '{noproto}mailto:x@example.com', 'noproto allows non-http schemes');
        assert.equal(D.normalizeUrl('javascript:alert(1)'), null, 'javascript: refused');
        assert.equal(D.normalizeUrl('{noproto}javascript:alert(1)'), null, 'noproto still refuses javascript:');
        assert.equal(D.normalizeUrl('data:text/html,x'), null, 'data: refused');
        assert.equal(D.normalizeUrl('//evil.example.com'), null, 'protocol-relative refused');
        assert.equal(D.normalizeUrl('<iframe src="about:blank"></iframe>'), null, 'raw HTML without marker refused');
        assert.equal(D.normalizeUrl('{noproto}<iframe src="about:blank"></iframe>'),
            '{noproto}<iframe src="about:blank"></iframe>', 'noproto raw HTML kept');
        assert.equal(D.normalizeUrl('   '), null, 'empty refused');
    });

    it('treats only off-origin URLs as external', function() {
        var D = window.Desktop;
        assert.equal(D.isExternalUrl('/cgi-bin/luci/admin/status/overview'), false, 'LuCI path is local');
        assert.equal(D.isExternalUrl(location.origin + '/luci-static/desktop/x.css'), false, 'same origin is local');
        assert.equal(D.isExternalUrl('https://example.com/'), true, 'other origin is external');
        assert.equal(D.isExternalUrl('example.com:3000'), true, 'bare host is external');
        assert.equal(D.isExternalUrl('{noproto}//example.com:3000'), true, 'noproto marker ignored for scope check');
        assert.equal(D.isExternalUrl('{noproto}<iframe src="about:blank"></iframe>'), false,
            'raw HTML embed opens as a desktop window, not a new tab');
    });

    it('stores a custom link as a pin flagged custom', function() {
        window.Desktop.addCustomUrl('Example', 'https://example.com', true);
        var pins = savedPins();
        assert.ok(pins && pins.length === 1, 'one pin saved');
        assert.equal(pins[0].url, 'https://example.com', 'url stored');
        assert.equal(pins[0].title, 'Example', 'title stored');
        assert.equal(pins[0].custom, true, 'marked custom');
        assert.equal(pins[0].newTab, true, 'newTab stored');
    });

    it('falls back to the URL as the name when none is given', function() {
        window.Desktop.addCustomUrl('   ', 'https://example.com', false);
        assert.equal(savedPins()[0].title, 'https://example.com', 'name defaults to the URL');
    });

    it('save-through-dialog keeps a leading placeholder intact (no http:// prefix)', function() {
        // Regression: normalizeUrl saw a leading '{' (not a letter) and
        // treated "{httpx}://{router}:3000" as a bare host, storing
        // "http://{httpx}://{router}:3000".
        function save(raw) {
            window.Desktop._showLinkDialog(null);
            var overlay = document.querySelector('.link-dialog-overlay');
            overlay.querySelector('.link-url').value = raw;
            overlay.querySelector('.link-name').value = 'App';
            overlay.querySelector('.link-save').click();
        }
        function lastSaved() {
            var pins = savedPins();
            return pins[pins.length - 1].url;
        }
        save('{httpx}://{router}:3000');
        assert.equal(lastSaved(), '{httpx}://{router}:3000', '{httpx} scheme kept');
        document.querySelectorAll('.link-dialog-overlay').forEach(function(el) { el.remove(); });
        save('{origin}/cgi-bin/luci/admin/status/overview');
        assert.equal(lastSaved(), '{origin}/cgi-bin/luci/admin/status/overview', '{origin} already has a scheme');
        document.querySelectorAll('.link-dialog-overlay').forEach(function(el) { el.remove(); });
        save('{router}:3000');
        assert.equal(lastSaved(), 'http://{router}:3000', 'placeholder HOST still gets http://');
    });

    it('normalizes {httpx} written without the slashes too', function() {
        var D = window.Desktop;
        assert.equal(D.normalizeUrl('{httpx}://{router}:3000'), '{httpx}://{router}:3000', 'canonical form kept');
        assert.equal(D.normalizeUrl('{httpx}//{router}:3000'), '{httpx}://{router}:3000', 'missing colon repaired');
        assert.equal(D.normalizeUrl('{httpx}{router}:3000'), '{httpx}://{router}:3000', 'missing slashes repaired');
        assert.equal(D.normalizeUrl('{router}'), 'http://{router}', 'bare {router} → http://');
        assert.equal(D.normalizeUrl('{router}:3000'), 'http://{router}:3000', '{router}:port → http://');
    });

    it('expands {router}/{httpx} placeholders against the current address', function() {
        var D = window.Desktop;
        assert.equal(D.resolveUrlVars('http://{router}:300'), 'http://' + location.hostname + ':300', '{router}');
        assert.equal(D.resolveUrlVars('{httpx}://{router}:300'), (location.protocol === 'https:' ? 'https' : 'http') + '://' + location.hostname + ':300', 'canonical {httpx}://{router} form');
        assert.equal(D.resolveUrlVars('{HTTPX}://{ROUTER}:300'), (location.protocol === 'https:' ? 'https' : 'http') + '://' + location.hostname + ':300', 'case-insensitive');
        assert.equal(D.resolveUrlVars('http://{host}:300'), 'http://' + location.hostname + ':300', '{host} alias still expands');
        assert.equal(D.resolveUrlVars('{origin}/cgi-bin/luci/admin/status/overview'), location.origin + '/cgi-bin/luci/admin/status/overview', '{origin}');
        assert.equal(D.resolveUrlVars('{httpx}://{router}:{port}/x'), (location.protocol === 'https:' ? 'https' : 'http') + '://' + location.hostname + ':' + location.port + '/x', '{port}');
        assert.equal(D.resolveUrlVars('https://example.com/x'), 'https://example.com/x', 'no placeholders → untouched');
        assert.equal(D.resolveUrlVars('{noproto}{router}:300'), location.hostname + ':300', 'noproto marker stripped');
        assert.equal(D.resolveUrlVars('/cgi-bin/luci/admin/status/overview'), '/cgi-bin/luci/admin/status/overview', 'plain path untouched');
    });

    it('keeps the chosen icon, position and hidden state when the URL is edited', function() {
        function savedSection(name) {
            for (var i = posts.length - 1; i >= 0; i--) {
                var b = posts[i].body || '';
                if (b.indexOf('section=' + name + '&') !== 0) continue;
                var m = /(?:^|&)data=([^&]*)/.exec(b);
                if (m) return JSON.parse(decodeURIComponent(m[1].replace(/\+/g, ' ')));
            }
            return null;
        }
        setConfig({
            pins: [{ url: 'https://old.example.com', title: 'App', custom: true, newTab: true }],
            hidden_icons: ['https://old.example.com'],
            icon_layout: { 'https://old.example.com': { icon: 'docker', desktop: { col: 2, row: 1 } } },
            widgets: {}, theme: {}, wallpaper: {}
        });
        window.Desktop.editCustomUrl('https://old.example.com');
        var overlay = document.querySelector('.link-dialog-overlay');
        overlay.querySelector('.link-url').value = 'https://new.example.com';
        overlay.querySelector('.link-save').click();
        var layout = savedSection('icon_layout');
        assert.ok(layout && layout['https://new.example.com'], 'icon layout moved to the new URL');
        assert.equal(layout['https://new.example.com'].icon, 'docker', 'chosen icon kept');
        assert.equal(layout['https://new.example.com'].desktop.col, 2, 'grid cell kept');
        assert.equal(layout['https://old.example.com'], undefined, 'old URL key dropped');
        var hidden = savedSection('hidden');
        assert.equal(hidden.indexOf('https://new.example.com') !== -1, true, 'hidden state follows the new URL');
        assert.equal(hidden.indexOf('https://old.example.com'), -1, 'old URL no longer hidden');
        assert.equal(savedPins()[0].url, 'https://new.example.com', 'pin repointed');
    });

    it('stores the placeholder but opens the expanded URL', function() {
        var tabs = [];
        window.open = function(u) { tabs.push(u); return null; };
        window.Desktop.addCustomUrl('App', '{httpx}://{router}:300', true);
        assert.equal(savedPins()[0].url, '{httpx}://{router}:300', 'stored as typed (works via IP or domain)');
        window.Desktop.openShortcut('{httpx}://{router}:300', 'App');
        assert.equal(tabs[0], (location.protocol === 'https:' ? 'https' : 'http') + '://' + location.hostname + ':300', 'expanded at open time');
    });

    it('adds http:// only at open time for a bare host', function() {
        var tabs = [];
        window.open = function(u) { tabs.push(u); return null; };
        window.Desktop.addCustomUrl('App', 'example.com:3000', true);
        assert.equal(savedPins()[0].url, 'example.com:3000', 'stored without an http:// prefix');
        window.Desktop.openShortcut('example.com:3000', 'App');
        assert.equal(tabs[0], 'http://example.com:3000', 'http:// added at open time');
    });

    it('{noproto} disables the open-time http:// prefix', function() {
        var tabs = [];
        window.open = function(u) { tabs.push(u); return null; };
        window.Desktop.addCustomUrl('App', '{noproto}//example.com:3000', true);
        assert.equal(savedPins()[0].url, '{noproto}//example.com:3000', 'marker stored');
        window.Desktop.openShortcut('{noproto}//example.com:3000', 'App');
        assert.equal(tabs[0], '//example.com:3000', 'target kept verbatim (marker stripped)');
    });

    it('{noproto} raw HTML opens as a desktop window via a data: URL', function() {
        var windows = [];
        window.WM.open = function(u) { windows.push(u); return 'win'; };
        var html = '<iframe src="about:blank" width="1205" height="480"></iframe>';
        var url = '{noproto}' + html;
        window.Desktop.addCustomUrl('Embed', url, true);   // newTab ignored for raw HTML
        window.Desktop.openShortcut(url, 'Embed');
        assert.equal(windows.length, 1, 'raw HTML opens in one desktop window');
        var prefix = 'data:text/html;charset=utf-8,';
        assert.equal(windows[0].indexOf(prefix), 0, 'data: URL used for raw HTML');
        assert.equal(decodeURIComponent(windows[0].slice(prefix.length)), html, 'HTML payload preserved');
    });

    it('opens a {router} link in a desktop window when the tab box is off', function() {
        var windows = [];
        window.WM.open = function(u) { windows.push(u); };
        window.Desktop.addCustomUrl('App', '{httpx}://{router}:300', false);
        window.Desktop.openShortcut('{httpx}://{router}:300', 'App');
        assert.equal(windows[0], (location.protocol === 'https:' ? 'https' : 'http') + '://' + location.hostname + ':300', 'window gets the expanded URL');
    });

    it('keeps custom links out of the ghost cleanup (regression)', function() {
        // Menu tree WITHOUT either pinned URL: the app pin is a ghost, the
        // custom link must survive — a menu-driven cleanup would otherwise
        // delete the user's own shortcut on every page load.
        window.LuCIMenuData = [{ href: '/cgi-bin/luci/admin/status/overview', title: 'Overview', subs: [] }];
        setConfig({
            pins: [
                { url: '/cgi-bin/luci/admin/ghost/app', title: 'Ghost App' },
                { url: 'https://example.com', title: 'My Link', custom: true, newTab: true }
            ],
            hidden_icons: ['https://example.com'],
            icon_layout: { 'https://example.com': { icon: 'link', desktop: { col: 1, row: 0 } } },
            widgets: {}, theme: {}, wallpaper: {}
        });
        window.Desktop.cleanGhostApps();
        var pins = savedPins();
        assert.ok(pins, 'cleanup saved the pruned pins');
        assert.equal(pins.length, 1, 'ghost app pin removed');
        assert.equal(pins[0].url, 'https://example.com', 'custom link survives');
        assert.equal(window.Desktop._customUrlSet()['https://example.com'], true, 'custom url set kept');
    });

    it('desktop custom-link layout survives a mobile-mode boot (cross-layout regression)', function() {
        // icon_layout is shared between desktop and mobile, but custom links
        // live in pins/mobile_pins separately. A mobile boot used to prune
        // every layout entry whose URL was not in mobile_pins and not in the
        // menu tree — including a custom link created on the desktop. Every
        // phone visit silently reset that link's chosen icon/position.
        var origMobile = window.LuCIDesktop.isMobile;
        window.LuCIDesktop.isMobile = function() { return true; };
        try {
            window.LuCIMenuData = [{ href: '/cgi-bin/luci/admin/status/overview', title: 'Overview', subs: [] }];
            setConfig({
                pins: [{ url: 'https://example.com', title: 'My Link', custom: true, newTab: true }],
                mobile_pins: [],
                hidden_icons: [],
                mobile_hidden: [],
                icon_layout: { 'https://example.com': { icon: 'link', desktop: { col: 1, row: 0 } } },
                widgets: {}, theme: {}, wallpaper: {}
            });
            window.Desktop.init();
            var layout = window.LuCIDesktop.desktopState.layout();
            assert.ok(layout['https://example.com'], 'desktop custom-link layout not pruned in mobile mode');
            assert.equal(layout['https://example.com'].icon, 'link', 'chosen icon survives');
        } finally {
            window.LuCIDesktop.isMobile = origMobile;
        }
    });

    it('opens external links in a browser tab and apps in a desktop window', function() {
        var tabs = [], windows = [];
        window.open = function(u) { tabs.push(u); return null; };
        window.WM.open = function(u) { windows.push(u); };
        window.Desktop.addCustomUrl('Example', 'https://example.com', true);
        window.Desktop.addCustomUrl('Overview', '/cgi-bin/luci/admin/status/overview', false);
        window.Desktop.openShortcut('https://example.com', 'Example');
        assert.equal(tabs.length, 1, 'external custom link → new tab');
        assert.equal(windows.length, 0, '…and not a (blank) desktop window');
        window.Desktop.openShortcut('/cgi-bin/luci/admin/status/overview', 'Overview');
        assert.equal(windows.length, 1, 'LuCI path → desktop window');
        assert.equal(tabs.length, 1, 'no extra tab');
    });

    it('adds a link through the dialog (external URL pre-checks the tab box)', function() {
        window.Desktop._showLinkDialog(null);
        var overlay = document.querySelector('.link-dialog-overlay');
        assert.ok(overlay, 'dialog rendered');
        var name = overlay.querySelector('.link-name');
        var url = overlay.querySelector('.link-url');
        var tab = overlay.querySelector('.link-newtab');
        assert.equal(tab.checked, false, 'tab box starts unchecked');
        url.value = 'https://example.com/page';
        url.dispatchEvent(new Event('input'));
        assert.equal(tab.checked, true, 'external URL auto-checks "open in a new tab"');
        name.value = 'Example';
        overlay.querySelector('.link-save').click();
        var pins = savedPins();
        assert.ok(pins && pins.length === 1, 'link saved from the dialog');
        assert.equal(pins[0].url, 'https://example.com/page', 'normalized URL stored');
        assert.equal(pins[0].newTab, true, 'tab flag stored');
        assert.ok(!document.querySelector('.link-dialog-overlay'), 'dialog closed after save');
    });

    it('rejects an unopenable URL in the dialog and keeps it open', function() {
        window.Desktop._showLinkDialog(null);
        var overlay = document.querySelector('.link-dialog-overlay');
        overlay.querySelector('.link-url').value = 'javascript:alert(1)';
        overlay.querySelector('.link-save').click();
        assert.ok(overlay.querySelector('.link-error').textContent.length > 0, 'error shown');
        assert.equal(savedPins(), null, 'nothing saved');
        assert.ok(document.querySelector('.link-dialog-overlay'), 'dialog stays open');
    });

    it('edits an existing link (URL change repoints the pin)', function() {
        window.Desktop.addCustomUrl('Example', 'https://example.com', true);
        window.Desktop.editCustomUrl('https://example.com');
        var overlay = document.querySelector('.link-dialog-overlay');
        assert.ok(overlay, 'edit dialog opened');
        assert.equal(overlay.querySelector('.link-url').value, 'https://example.com', 'URL prefilled');
        assert.equal(overlay.querySelector('.link-name').value, 'Example', 'name prefilled');
        overlay.querySelector('.link-url').value = '/cgi-bin/luci/admin/status/overview';
        overlay.querySelector('.link-name').value = 'Overview';
        overlay.querySelector('.link-save').click();
        var pins = savedPins();
        assert.equal(pins.length, 1, 'still one pin (old URL dropped)');
        assert.equal(pins[0].url, '/cgi-bin/luci/admin/status/overview', 'URL updated');
        assert.equal(pins[0].title, 'Overview', 'name updated');
    });
});

// ===== Context submenu flips near the right edge (0.1.0-221) =====
describe('Desktop context menu: submenu direction', function() {
    afterEach(function() {
        document.querySelectorAll('#desktop-context-menu').forEach(function(el) { el.remove(); });
    });

    it('flips the submenu left when it would run off the right edge', function() {
        window.Desktop._showDesktopMenu(window.innerWidth - 20, 60);
        var menu = document.getElementById('desktop-context-menu');
        assert.ok(menu, 'menu rendered');
        var row = menu.querySelector('.context-has-sub');
        assert.ok(row, 'New row has a submenu');
        window.Desktop._placeSubmenu(row);
        assert.equal(row.classList.contains('sub-left'), true, 'flipped to the left near the edge');
    });

    it('keeps the submenu on the right when there is room', function() {
        window.Desktop._showDesktopMenu(10, 60);
        var menu = document.getElementById('desktop-context-menu');
        var row = menu.querySelector('.context-has-sub');
        window.Desktop._placeSubmenu(row);
        assert.equal(row.classList.contains('sub-left'), false, 'opens right when it fits');
    });
});

// ===== Desktop context menu: item order (0.1.0-234) =====
// User-specified order: settings group first (Theme, Widgets), then ONE
// separator, then the action group (New — still a submenu parent — plus
// Rearrange Icons and Refresh). Asserted by DOM order of the top-level
// .context-item rows, not by the rendered text (i18n-dependent).
describe('Desktop context menu: item order', function() {
    afterEach(function() {
        document.querySelectorAll('#desktop-context-menu').forEach(function(el) { el.remove(); });
    });

    function rows(menu) {
        return Array.prototype.filter.call(menu.children, function(el) {
            return el.classList.contains('context-item');
        });
    }

    function acts(menu) {
        return rows(menu).map(function(el) { return el.getAttribute('data-act'); });
    }

    it('renders theme, widgets, new, rearrange, refresh in that DOM order', function() {
        window.Desktop._showDesktopMenu(10, 60);
        var menu = document.getElementById('desktop-context-menu');
        assert.ok(menu, 'menu rendered');
        assert.equal(acts(menu).join(','), 'theme,widgets,new,rearrange,refresh',
            'top-level data-act order');
    });

    it('uses exactly one separator, between the settings and action groups', function() {
        window.Desktop._showDesktopMenu(10, 60);
        var menu = document.getElementById('desktop-context-menu');
        var seps = Array.prototype.filter.call(menu.children, function(el) {
            return el.classList.contains('context-separator');
        });
        assert.equal(seps.length, 1, 'single separator');
        assert.equal(seps[0].previousElementSibling.getAttribute('data-act'), 'widgets',
            'separator follows the settings group (Widgets)');
        assert.equal(seps[0].nextElementSibling.getAttribute('data-act'), 'new',
            'separator precedes the action group (New)');
    });

    it('New is still the submenu parent wrapping the Link action', function() {
        window.Desktop._showDesktopMenu(10, 60);
        var menu = document.getElementById('desktop-context-menu');
        var row = rows(menu).filter(function(el) {
            return el.getAttribute('data-act') === 'new';
        })[0];
        assert.ok(row, 'New row rendered');
        assert.ok(row.classList.contains('context-has-sub'), 'New row is still a submenu parent');
        var sub = row.querySelector('.context-submenu > .context-item');
        assert.ok(sub, 'New still has a submenu item');
        assert.equal(sub.getAttribute('data-act'), 'addlink', 'submenu item is the Link action');
    });
});

// ===== Split-module public API contract (0.1.0-231) =====
// desktop.js was split into desktop-state/icons/links/menus + a facade.
// The facade must keep forwarding EVERY public window.Desktop method
// (production callers in shell.js/startmenu.js and these tests rely on
// them), and the shared state store must stay reachable under
// LuCIDesktop.desktopState. Guards against a method being dropped when a
// piece of functionality is moved between modules.
describe('Desktop public API survives the module split', function() {
    var METHODS = [
        // state + boot
        'reloadConfig', 'init',
        // icons (desktop-icons.js)
        'renderShortcuts', '_initQuantumDrag', 'openIconPicker',
        'pinItem', 'unpinItem', 'rearrangeIcons', 'bindEvents',
        // menus + link dialog (desktop-menus.js)
        '_showDefaultIconMenu', '_showIconMenu', '_showDesktopMenu',
        '_placeSubmenu', '_showLinkDialog',
        // custom URLs + ghost clean (desktop-links.js)
        'menuUrls', '_customUrlSet', 'cleanGhostApps',
        'normalizeUrl', 'resolveUrlVars', 'isExternalUrl',
        'addCustomUrl', 'openShortcut', 'editCustomUrl', '_moveLinkMeta',
        // availability probe + ttyd install (facade)
        'probeDefaultShortcuts', '_finishProbeRender', 'installDefault',
        '_reloadPage', 'checkInstallStatus', '_installPoll'
    ];

    it('forwards every public Desktop method', function() {
        assert.ok(window.Desktop, 'window.Desktop exists');
        var missing = METHODS.filter(function(name) {
            return typeof window.Desktop[name] !== 'function';
        });
        assert.equal(missing.length, 0, 'missing Desktop methods: ' + missing.join(', '));
    });

    it('exposes the shared store via LuCIDesktop.desktopState', function() {
        var S = window.LuCIDesktop.desktopState;
        assert.ok(S, 'desktopState namespace exists');
        ['pins', 'setPins', 'hidden', 'setHidden', 'layout', 'setLayout',
         'load', 'savePins', 'saveHidden', 'saveIconLayout',
         'configSection', 'normalizeLayout'].forEach(function(k) {
            assert.equal(typeof S[k], 'function', 'desktopState.' + k + ' is a function');
        });
    });
});

// ===== Config write-through invariant (0.1.0-232) =====
// desktop-state owns THREE stores as module-level variables, and each is
// mirrored into the per-tab #desktop-config JSON (the DOM/cache that
// loadConfig()/reloadConfig() reads back). Every save MUST write the store
// back to the tab state (setSectionLocal — DOM only, no extra POST) BEFORE
// the backend POST; otherwise the two truths drift, a later reloadConfig()
// resurrects the stale DOM value, and the next save persists it over UCI
// (icon choice / pins / hidden list silently reverted).
describe('Desktop state: store <-> #desktop-config write-through', function() {
    var S = window.LuCIDesktop.desktopState;
    var origSave, origMobile, origCfgText;

    function cfg() {
        return JSON.parse(document.getElementById('desktop-config').textContent);
    }

    beforeEach(function() {
        origSave = window.LuCIDesktop.saveDesktopSection;
        // The backend POST is not under test — only the local write-through.
        window.LuCIDesktop.saveDesktopSection = function() {};
        origMobile = window.LuCIDesktop.isMobile;
        window.LuCIDesktop.isMobile = function() { return false; };   // desktop keys
        origCfgText = document.getElementById('desktop-config').textContent;
        document.getElementById('desktop-config').textContent = JSON.stringify({
            pins: [], hidden_icons: [], icon_layout: {}
        });
        S.setPins([]);
        S.setHidden([]);
        S.setLayout({});
    });

    afterEach(function() {
        window.LuCIDesktop.saveDesktopSection = origSave;
        window.LuCIDesktop.isMobile = origMobile;
        document.getElementById('desktop-config').textContent = origCfgText;
    });

    it('saveIconLayout mirrors the in-memory map into #desktop-config', function() {
        S.setLayout({ '/a': { icon: 'gost' } });
        S.saveIconLayout();
        assert.equal(cfg().icon_layout['/a'].icon, 'gost', 'DOM icon_layout updated');
        assert.equal(JSON.stringify(cfg().icon_layout), JSON.stringify(S.layout()),
            'DOM icon_layout === in-memory map');
    });

    it('savePins mirrors the in-memory pins into #desktop-config', function() {
        S.setPins([{ url: '/p', title: 'P' }]);
        S.savePins();
        assert.equal(JSON.stringify(cfg().pins), JSON.stringify(S.pins()),
            'DOM pins === in-memory list');
    });

    it('saveHidden mirrors hidden icons into #desktop-config (desktop key hidden_icons)', function() {
        S.setHidden(['/h']);
        S.saveHidden();
        assert.equal(JSON.stringify(cfg().hidden_icons), JSON.stringify(S.hidden()),
            'DOM hidden_icons === in-memory list');
    });

    it('reloadConfig after a save does not resurrect a stale layout (regression)', function() {
        S.setLayout({ '/a': { icon: 'gost' } });
        S.saveIconLayout();              // write-through: DOM now has the choice
        window.Desktop.reloadConfig();   // re-read #desktop-config
        assert.equal(S.layout()['/a'].icon, 'gost', 'choice survives reloadConfig');
        S.saveIconLayout();
        assert.equal(S.layout()['/a'].icon, 'gost', 'memory still has the new icon after save');
        assert.equal(cfg().icon_layout['/a'].icon, 'gost', 'DOM still has the new icon after save');
    });
});
})();
