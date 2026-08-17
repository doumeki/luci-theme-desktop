/* net-traffic.test.js — Network Traffic widget (first third-party-style
 * widget written against the formal API; exercises the loadOptions
 * contract for dynamic select options).
 *
 * Sync-only: registration fields, render skeleton, options schema.
 * The async paths (rate differencing from luci-bwc samples, loadOptions
 * filling the select) live in widget-async.test.js with mocked fetch.
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

function def() { return WidgetManager.registry['net-traffic']; }

describe('net-traffic widget', function() {
    beforeEach(setupWidgetDOM);

    it('is registered with the loadOptions contract', function() {
        var d = def();
        assert.ok(d, 'net-traffic registered');
        assert.equal(d.name, 'Network Traffic');
        assert.equal(d.updateInterval, 1000, '1s polling');
        assert.equal(d.clearable, false, 'no user content');
        assert.ok(d.options.iface, 'iface option declared');
        assert.equal(d.options.iface.type, 'select');
        assert.equal(d.options.iface.default, 'wan');
        assert.equal(typeof d.options.iface.loadOptions, 'function', 'dynamic interface list');
    });

    it('render builds the skeleton with placeholders', function() {
        WidgetManager.enable('net-traffic');
        var el = WidgetManager.instances['net-traffic-1'].el;
        assert.contains(el.textContent, 'Network Traffic', 'title');
        assert.equal(el.querySelector('.nt-rx').textContent, '--', 'rx placeholder');
        assert.equal(el.querySelector('.nt-tx').textContent, '--', 'tx placeholder');
        assert.equal(el.querySelector('.nt-iface').textContent, 'wan', 'default iface shown');
    });

    it('render shows the configured interface', function() {
        WidgetManager.enable('net-traffic', { data: { iface: 'br-lan' } });
        var el = WidgetManager.instances['net-traffic-1'].el;
        assert.equal(el.querySelector('.nt-iface').textContent, 'br-lan');
    });
});

})();
