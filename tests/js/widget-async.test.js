/* widget-async.test.js — async update runtime behavior (real timers).
 *
 * These tests return Promises — testRunner.run() awaits each thenable
 * (10s watchdog) before starting the next test. Real setInterval ticks
 * (50ms) drive the update loop; we assert overlap guarding, rejection
 * swallowing and flag reset — the behavior WIDGET-API.md promises but a
 * sync framework cannot observe.
 */
(function() {
'use strict';

function setupWidgetDOM() {
    var layer = document.getElementById('widget-layer');
    if (!layer) {
        layer = document.createElement('div');
        layer.id = 'widget-layer';
        document.body.appendChild(layer);
    }
    layer.innerHTML = '';
    WidgetManager.closeSettings();

    if (!window.__BASE_WIDGET_REGISTRY__) window.__BASE_WIDGET_REGISTRY__ = Object.assign({}, WidgetManager.registry);
    WidgetManager.registry = Object.assign({}, window.__BASE_WIDGET_REGISTRY__);
    WidgetManager.instances = {};
    WidgetManager._nextNum = {};
    WidgetManager._preservedConfigs = {};
}

function sleep(ms) {
    return new Promise(function(res) { setTimeout(res, ms); });
}

function registerAsyncWidget(id, updateFn) {
    WidgetManager.register({
        id: id,
        name: 'Async ' + id,
        updateInterval: 50,          // real ticks: 20/s
        defaults: { x: 10, y: 10 },
        render: function(el) { el.textContent = 'x'; },
        update: updateFn
    });
    WidgetManager.enable(id);
    return WidgetManager.instances[id + '-1'];
}

describe('Widget API: async update runtime', function() {
    beforeEach(setupWidgetDOM);

    it('ticks do not overlap a pending update', function() {
        var calls = 0;
        var release = null;
        var inst = registerAsyncWidget('async-overlap', function() {
            calls++;
            return new Promise(function(res) { release = res; });
        });
        return sleep(160).then(function() {   // ~3 tick windows, first still pending
            assert.equal(calls, 1, 'update called once while pending (got ' + calls + ')');
            assert.equal(inst._updating, true, 'updating flag set while pending');
            release();
            return sleep(140);                // next tick after settle
        }).then(function() {
            assert.equal(calls, 2, 'update resumes after settle (got ' + calls + ')');
        });
    });

    it('rejected update is swallowed and the cycle continues', function() {
        var calls = 0;
        var unhandled = 0;
        var onUnhandled = function() { unhandled++; };
        window.addEventListener('unhandledrejection', onUnhandled);
        var inst = registerAsyncWidget('async-rej', function() {
            calls++;
            return Promise.reject(new Error('boom'));
        });
        return sleep(260).then(function() {   // ~5 tick windows
            window.removeEventListener('unhandledrejection', onUnhandled);
            assert.ok(calls >= 2, 'update keeps firing after rejection (got ' + calls + ')');
            assert.equal(inst._updating, false, 'updating flag reset after rejection');
            assert.equal(unhandled, 0, 'no unhandledrejection events');
        });
    });

    it('disable during a pending update is safe', function() {
        var calls = 0;
        var release = null;
        registerAsyncWidget('async-disable', function() {
            calls++;
            return new Promise(function(res) { release = res; });
        });
        var iid = 'async-disable-1';
        return sleep(120).then(function() {
            assert.equal(calls, 1, 'update is pending');
            WidgetManager.disable(iid);
            assert.ok(!WidgetManager.instances[iid], 'instance removed');
            release();                        // settle after disable: harmless
            return sleep(50);
        });
    });

    it('net-traffic update renders rates from the desktop bandwidth endpoint', function() {
        var origFetch = window.fetch;
        var lastUrl = null;
        var sample = { rx: 1000, tx: 200, phy: true };
        window.fetch = function(url) {
            // New protocol: /desktop/bandwidth returns cumulative per-iface
            // bytes { iface: { rx, tx, phy } }; the widget diffs samples.
            lastUrl = url;
            return Promise.resolve({ json: function() { return Promise.resolve({ eth0: sample }); } });
        };
        WidgetManager.enable('net-traffic', { data: { iface: 'eth0' } });
        var inst = WidgetManager.instances['net-traffic-1'];
        var d = WidgetManager.registry['net-traffic'];
        var first = d.update.call(d, inst.el, inst.data, inst._api);
        return first.then(function() {
            assert.equal(lastUrl, '/cgi-bin/luci/admin/desktop/bandwidth',
                'rates come from the theme bandwidth endpoint');
            assert.equal(inst.el.querySelector('.nt-rx').textContent, '--', 'first tick is baseline');
            assert.equal(inst.el.querySelector('.nt-tx').textContent, '--', 'first tick is baseline');
            // Second tick after a real time gap: bytes grew by 1000 rx /
            // 200 tx over ~1s → ≈8 kb/s / ≈2 kb/s. (selfDiff needs dt > 0;
            // the exact figure wobbles with the sleep duration, so match
            // the unit-level value, not an exact string.)
            return sleep(1100).then(function() {
                sample = { rx: 2000, tx: 400, phy: true };
                return d.update.call(d, inst.el, inst.data, inst._api);
            });
        }).then(function() {
            assert.ok(/^\d+ kb\/s$/.test(inst.el.querySelector('.nt-rx').textContent),
                'rx rate rendered (got ' + inst.el.querySelector('.nt-rx').textContent + ')');
            assert.ok(/^\d+ kb\/s$/.test(inst.el.querySelector('.nt-tx').textContent),
                'tx rate rendered (got ' + inst.el.querySelector('.nt-tx').textContent + ')');
        }).then(function() {
            window.fetch = origFetch;
        }, function(e) {
            window.fetch = origFetch;
            throw e;
        });
    });

    it('net-traffic update shows -- on empty samples', function() {
        var origFetch = window.fetch;
        window.fetch = function() {
            return Promise.resolve({ text: function() { return Promise.resolve('[ ]'); } });
        };
        WidgetManager.enable('net-traffic', { data: { iface: 'eth0' } });
        var inst = WidgetManager.instances['net-traffic-1'];
        var d = WidgetManager.registry['net-traffic'];
        return d.update.call(d, inst.el, inst.data, inst._api).then(function() {
            assert.equal(inst.el.querySelector('.nt-rx').textContent, '--');
            assert.equal(inst.el.querySelector('.nt-tx').textContent, '--');
        }).then(function() {
            window.fetch = origFetch;
        }, function(e) {
            window.fetch = origFetch;
            throw e;
        });
    });

    it('net-traffic adopts a real iface when the default does not exist', function() {
        var origFetch = window.fetch;
        var bwCalls = 0;
        window.fetch = function(url) {
            if (url.indexOf('/desktop/interfaces') !== -1) {
                return Promise.resolve({ json: function() { return Promise.resolve(['pppoe-wan', 'br-lan']); } });
            }
            bwCalls++;
            // New protocol: cumulative bytes per iface. 'wan' is missing
            // (the placeholder), pppoe-wan carries traffic → auto-adopt.
            return Promise.resolve({ json: function() {
                return Promise.resolve({ 'pppoe-wan': { rx: 5000000, tx: 1000000, phy: true } });
            } });
        };
        WidgetManager.enable('net-traffic', { data: { iface: 'wan' } });   // default, not on device
        var inst = WidgetManager.instances['net-traffic-1'];
        var d = WidgetManager.registry['net-traffic'];
        return d.update.call(d, inst.el, inst.data, inst._api).then(function() {
            assert.equal(inst.data.iface, 'pppoe-wan', 'switched to first real iface');
            assert.ok(bwCalls >= 2, 'bandwidth refetched after switch');
            var saved = JSON.parse(document.getElementById('desktop-config').textContent);
            assert.equal(saved.widgets.instances[0].data.iface, 'pppoe-wan', 'iface persisted');
        }).then(function() {
            window.fetch = origFetch;
        }, function(e) {
            window.fetch = origFetch;
            throw e;
        });
    });

    it('loadOptions fills the settings select after the panel opens', function() {
        var origFetch = window.fetch;
        window.fetch = function(url) {
            if (url.indexOf('/desktop/bandwidth') !== -1) {
                // loadIfaceList asks bandwidth FIRST (sorted by traffic);
                // this stub has no bandwidth data → falls back to the
                // plain interfaces list below.
                return Promise.reject(new Error('no bandwidth'));
            }
            // GET /cgi-bin/luci/admin/desktop/interfaces → [...]
            return Promise.resolve({ json: function() {
                return Promise.resolve(['br-lan', 'eth0', 'wlan0']);
            } });
        };
        WidgetManager.enable('net-traffic');
        WidgetManager.openSettings();
        var sel = document.querySelector('select[data-option-key="iface"]');
        assert.ok(sel, 'iface select in panel');
        assert.ok(sel.hasAttribute('data-load-options'), 'flagged for async fill');
        assert.equal(sel.querySelectorAll('option').length, 2, 'static fallback renders first');
        return sleep(50).then(function() {
            var values = {};
            sel.querySelectorAll('option').forEach(function(o) { values[o.value] = o.textContent; });
            assert.equal(values['br-lan'], 'br-lan', 'dynamic iface loaded');
            assert.equal(values['eth0'], 'eth0', 'dynamic iface loaded');
            assert.equal(values['wlan0'], 'wlan0', 'dynamic iface loaded');
            WidgetManager.closeSettings();
        }).then(function() {
            window.fetch = origFetch;
        }, function(e) {
            WidgetManager.closeSettings();
            window.fetch = origFetch;
            throw e;
        });
    });

    it('loadOptions keeps the persisted iface selected after filling', function() {
        // Regression: with data.iface='br-lan' (not in the static {wan,lan}
        // placeholder) the select used to show 'wan' — and the fill read
        // that wrong value as current, so br-lan was never restored.
        var origFetch = window.fetch;
        window.fetch = function() {
            return Promise.resolve({ json: function() {
                return Promise.resolve(['br-lan', 'eth0', 'wlan0']);
            } });
        };
        WidgetManager.enable('net-traffic', { data: { iface: 'br-lan' } });
        WidgetManager.openSettings();
        var sel = document.querySelector('select[data-option-key="iface"]');
        assert.equal(sel.value, 'br-lan', 'persisted value shown BEFORE async fill');
        return sleep(50).then(function() {
            assert.equal(sel.value, 'br-lan', 'still selected after dynamic fill');
            WidgetManager.closeSettings();
        }).then(function() {
            window.fetch = origFetch;
        }, function(e) {
            WidgetManager.closeSettings();
            window.fetch = origFetch;
            throw e;
        });
    });

    it('net-traffic keeps a user-chosen iface even when it has no samples', function() {
        // User explicitly picked eth5 (not on device, not the 'wan'
        // placeholder) — the widget must respect it: no auto-switch, no
        // silent persistence of a different iface. Shows '--' instead.
        // enable() fires the first update immediately, so wait for it to
        // drain before counting the manual update's fetches.
        var origFetch = window.fetch;
        var calls = [];
        window.fetch = function(url) {
            calls.push(url);
            if (url.indexOf('/desktop/interfaces') !== -1) {
                return Promise.resolve({ json: function() { return Promise.resolve(['pppoe-wan', 'br-lan']); } });
            }
            return Promise.resolve({ text: function() { return Promise.resolve('[ ]'); } });
        };
        WidgetManager.enable('net-traffic', { data: { iface: 'eth5' } });
        var inst = WidgetManager.instances['net-traffic-1'];
        var d = WidgetManager.registry['net-traffic'];
        return sleep(50).then(function() {
            calls.length = 0;   // drop the enable-time first update
            return d.update.call(d, inst.el, inst.data, inst._api);
        }).then(function() {
            // After the interfaces probe rejected the adoption, there must
            // be no second bandwidth_status fetch (the old code refetched
            // and persisted the replacement iface).
            var seenInterfaces = false, bwAfter = 0;
            calls.forEach(function(u) {
                if (u.indexOf('/desktop/interfaces') !== -1) seenInterfaces = true;
                else if (seenInterfaces) bwAfter++;
            });
            assert.equal(bwAfter, 0, 'no bandwidth refetch after rejecting adoption');
            assert.equal(inst.data.iface, 'eth5', 'user choice respected');
            assert.equal(inst.el.querySelector('.nt-rx').textContent, '--', 'shows -- (respects silence)');
            var saved = JSON.parse(document.getElementById('desktop-config').textContent);
            assert.equal(saved.widgets.instances[0].data.iface, 'eth5', 'not persisted away');
        }).then(function() {
            window.fetch = origFetch;
        }, function(e) {
            window.fetch = origFetch;
            throw e;
        });
    });
});

})();
