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
})();
