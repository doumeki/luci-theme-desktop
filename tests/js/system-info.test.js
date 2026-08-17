/* system-info.test.js — System Info widget (Widget API reference widget)
 *
 * Sync-only assertions: the async fetch path (real data vs mock fallback)
 * resolves outside the sync test framework — covered by TEST-PLAN as
 * runtime-verification. Here we pin the render skeleton, the options
 * schema, and the async update contract (update returns a Promise).
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
    WidgetManager.instances = {};
    WidgetManager._nextNum = {};
    WidgetManager._preservedConfigs = {};
}

function sysinfoDef() { return WidgetManager.registry['system-info']; }

describe('system-info widget', function() {
    beforeEach(setupWidgetDOM);

    it('is registered (production-enabled)', function() {
        assert.ok(sysinfoDef(), 'system-info registered');
        assert.equal(sysinfoDef().name, 'System Info');
        assert.equal(sysinfoDef().updateInterval, 3000, 'top-level updateInterval');
    });

    it('declares resizable (user-sizeable) — system-info + net-traffic', function() {
        assert.equal(sysinfoDef().resizable, true, 'system-info resizable');
        assert.equal(WidgetManager.registry['net-traffic'].resizable, true,
            'net-traffic resizable');
    });

    it('render builds the skeleton with placeholders', function() {
        WidgetManager.enable('system-info');
        var el = WidgetManager.instances['system-info-1'].el;
        assert.ok(el.querySelector('.widget-sysinfo-title'), 'title div');
        assert.equal(el.querySelector('.widget-sysinfo-title').textContent, 'System');
        assert.equal(el.querySelector('#si-cpu').textContent, '--', 'cpu placeholder');
        assert.equal(el.querySelector('#si-mem').textContent, '--', 'mem placeholder');
        assert.equal(el.querySelector('#si-uptime').textContent, '--', 'uptime placeholder');
    });

    it('showTemp option (default true) renders the temperature row', function() {
        WidgetManager.enable('system-info');
        var el = WidgetManager.instances['system-info-1'].el;
        assert.ok(el.querySelector('#si-temp'), 'temp row present by default');
    });

    it('showTemp:false hides the temperature row', function() {
        WidgetManager.enable('system-info');
        var inst = WidgetManager.instances['system-info-1'];
        inst.data.showTemp = false;
        inst._api.rerender();
        assert.ok(!inst.el.querySelector('#si-temp'), 'temp row hidden');
    });

    it('accent option colors title AND values via --widget-accent', function() {
        // The headless runner loads no CSS files — inject the widget.css
        // accent rules verbatim so the var() consumption chain is tested
        // end-to-end (WM exports the variable, CSS resolves it).
        var st = document.createElement('style');
        st.id = 'test-accent-rules';
        st.textContent = '.widget-sysinfo-title, .widget-sysinfo-row .value { color: var(--widget-accent, currentColor); }';
        document.head.appendChild(st);

        WidgetManager.enable('system-info');
        var inst = WidgetManager.instances['system-info-1'];
        inst.data.accent = '#ff0000';
        inst._api.rerender();
        // WM._applyOptionStyles sets the CSS variable on the widget root
        assert.equal(inst.el.style.getPropertyValue('--widget-accent'), '#ff0000',
            'accent exported as --widget-accent');
        // Title resolves the variable...
        assert.equal(getComputedStyle(inst.el.querySelector('.widget-sysinfo-title')).color,
            'rgb(255, 0, 0)', 'title follows accent');
        // ...and so do the value cells
        assert.equal(getComputedStyle(inst.el.querySelector('#si-cpu')).color,
            'rgb(255, 0, 0)', 'value follows accent');

        document.head.removeChild(st);
    });

    it('update returns a Promise (async update contract)', function() {
        WidgetManager.enable('system-info');
        var inst = WidgetManager.instances['system-info-1'];
        var def = sysinfoDef();
        var p = def.update.call(def, inst.el, inst.data, inst._api);
        assert.ok(p && typeof p.then === 'function', 'update is thenable');
    });

    it('options schema: refresh is apply:false, accent + bg declared', function() {
        var opts = sysinfoDef().options;
        assert.equal(opts.refresh.type, 'number');
        assert.equal(opts.refresh.apply, false, 'no re-render on interval change');
        assert.equal(opts.refresh.default, 3);
        assert.equal(opts.showTemp.type, 'checkbox');
        assert.equal(opts.accent.type, 'color', 'accent option (text color)');
        assert.equal(opts.bg.type, 'color', 'bg option (card color)');
    });

    it('mem row shows used/physical (SMBIOS total, not MemFree)', function() {
        // Regression: the widget used json.memory.free (bare MemFree),
        // which Linux's page cache drives near zero under normal load —
        // a router with 6G genuinely usable showed "0.3G/8.0G" and looked
        // like it was out of memory. The total is the PHYSICAL memory the
        // controller reads from SMBIOS (stickered size — MemTotal here is
        // 8G minus kernel/firmware reserved); used = physical − available
        // (cache is reclaimable, not counted as used; kernel reserves
        // count as used so used + available == displayed total).
        var origFetch = window.fetch;
        window.fetch = function() {
            return Promise.resolve({ ok: true, json: function() {
                return Promise.resolve({
                    cpuusage: '10%',
                    loadavg: [0.1, 0.2, 0.3],
                    // 16G stickered; MemTotal 8G (kernel-managed), MemFree
                    // gutted by page cache, 6G available
                    memory: {
                        physical: 16 * 1073741824,
                        total: 8 * 1073741824,
                        free: 300 * 1048576,
                        available: 6 * 1073741824
                    },
                    uptime: 3600,
                    thermal: [{ temp: '45.0°C' }]
                });
            } });
        };
        WidgetManager.enable('system-info');
        var inst = WidgetManager.instances['system-info-1'];
        // Module-level lastFetch throttling (3s) may have been set by an
        // earlier test's enable tick — refresh=0 disables the throttle so
        // this update actually fetches.
        inst.data.refresh = 0;
        var d = sysinfoDef();
        return d.update.call(d, inst.el, inst.data, inst._api).then(function() {
            assert.equal(inst.el.querySelector('#si-mem').textContent, '10.0G/16.0G',
                'used = physical − available (10G), total is the SMBIOS 16G');
        }).then(function() {
            window.fetch = origFetch;
        }, function(e) {
            window.fetch = origFetch;
            throw e;
        });
    });

    it('mem row falls back to MemTotal when physical is absent', function() {
        // Older controller (no SMBIOS field): used/total from MemTotal —
        // never display '--/--' for memory.
        var origFetch = window.fetch;
        window.fetch = function() {
            return Promise.resolve({ ok: true, json: function() {
                return Promise.resolve({
                    cpuusage: '10%',
                    loadavg: [0.1, 0.2, 0.3],
                    memory: {
                        total: 8 * 1073741824,
                        free: 300 * 1048576,
                        available: 6 * 1073741824
                    },
                    uptime: 3600,
                    thermal: [{ temp: '45.0°C' }]
                });
            } });
        };
        WidgetManager.enable('system-info');
        var inst = WidgetManager.instances['system-info-1'];
        inst.data.refresh = 0;
        var d = sysinfoDef();
        return d.update.call(d, inst.el, inst.data, inst._api).then(function() {
            assert.equal(inst.el.querySelector('#si-mem').textContent, '2.0G/8.0G',
                'falls back to MemTotal-based used/total');
        }).then(function() {
            window.fetch = origFetch;
        }, function(e) {
            window.fetch = origFetch;
            throw e;
        });
    });
});

})();
