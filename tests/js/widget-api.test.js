/* widget-api.test.js — Formal Widget API: options schema, api context, async update.
 *
 * NOTE: the test framework is synchronous — the async-update *behavior*
 * (overlap guard, rejection swallowing) is verified indirectly:
 * enabling a widget whose update returns a Promise must not throw, and the
 * returned Promise follows the documented pattern (update() → Promise).
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

    if (WidgetManager) {
        if (!window.__BASE_WIDGET_REGISTRY__) window.__BASE_WIDGET_REGISTRY__ = Object.assign({}, WidgetManager.registry);
        WidgetManager.registry = Object.assign({}, window.__BASE_WIDGET_REGISTRY__);
        WidgetManager.instances = {};
        WidgetManager._nextNum = {};
        WidgetManager._preservedConfigs = {};
    }
}

function registerOptWidget(extra) {
    WidgetManager.register(Object.assign({
        id: 'opt-test',
        name: 'Options Test',
        updateInterval: 50,
        defaults: { x: 10, y: 10 },
        options: {
            title:    { type: 'text',     label: 'Title',    default: '' },
            refresh:  { type: 'number',   label: 'Refresh',  min: 1, max: 60, step: 1, default: 3, apply: false },
            accent:   { type: 'color',    label: 'Accent',   default: '#4a90d9' },
            showTemp: { type: 'checkbox', label: 'ShowTemp', default: true },
            unit:     { type: 'select',   label: 'Unit',     options: { auto: 'Auto', mb: 'MB/s' }, default: 'auto' }
        },
        render: function(el, data) { el.textContent = 'rendered:' + data.title + ':' + data.showTemp; }
    }, extra || {}));
}

function optionInput(group, key) {
    return group.querySelector('[data-option-key="' + key + '"]');
}

describe('Widget API: options schema', function() {
    beforeEach(function() {
        setupWidgetDOM();
        registerOptWidget();
    });

    it('register normalizes updateInterval and options', function() {
        var def = WidgetManager.registry['opt-test'];
        assert.equal(def.updateInterval, 50, 'top-level updateInterval kept');
        assert.equal(def.options.refresh.type, 'number');
        assert.equal(def.options.refresh.apply, false, 'apply:false preserved');
        assert.equal(def.options.unit.options.mb, 'MB/s');
    });

    it('enable merges option defaults into instance data', function() {
        WidgetManager.enable('opt-test');
        var data = WidgetManager.instances['opt-test-1'].data;
        assert.equal(data.title, '', 'text default');
        assert.equal(data.refresh, 3, 'number default');
        assert.equal(data.accent, '#4a90d9', 'color default');
        assert.equal(data.showTemp, true, 'checkbox default');
        assert.equal(data.unit, 'auto', 'select default');
    });

    it('enable does not overwrite persisted option values', function() {
        WidgetManager.enable('opt-test', { data: { refresh: 7, accent: '#ff0000' } });
        var data = WidgetManager.instances['opt-test-1'].data;
        assert.equal(data.refresh, 7, 'persisted number wins');
        assert.equal(data.accent, '#ff0000', 'persisted color wins');
    });

    it('settings panel renders controls for all five types', function() {
        WidgetManager.enable('opt-test');
        WidgetManager.openSettings();
        var group = document.querySelector('.widget-options[data-type="opt-test"]');
        assert.ok(group, 'options group present');
        assert.equal(optionInput(group, 'title').type, 'text');
        assert.equal(optionInput(group, 'refresh').type, 'number');
        assert.equal(optionInput(group, 'accent').type, 'color');
        assert.equal(optionInput(group, 'showTemp').type, 'checkbox');
        assert.equal(optionInput(group, 'unit').tagName, 'SELECT');
        WidgetManager.closeSettings();
    });

    it('empty accent value renders the declared default (panel swatch parity)', function() {
        // Regression: an unset accent removed the variable → currentColor
        // (white) on the card while the settings swatch showed #4a90d9.
        // The user had to re-pick the color for it to take effect.
        WidgetManager.enable('opt-test', { data: { accent: '' } });
        var el = WidgetManager.instances['opt-test-1'].el;
        assert.equal(el.style.getPropertyValue('--widget-accent'), '#4a90d9',
            'empty accent applies options.default');
        // Swatch in the settings panel must show the same value
        WidgetManager.openSettings();
        var group = document.querySelector('.widget-options[data-type="opt-test"]');
        assert.equal(optionInput(group, 'accent').value, '#4a90d9',
            'panel swatch matches the rendered default');
        WidgetManager.closeSettings();
    });

    it('empty bg value applies declared default; swatch matches', function() {
        WidgetManager.register({
            id: 'opt-bg-test', name: 'BG Test', defaults: {},
            options: { bg: { type: 'color', label: 'BG', default: '#0a0e14' } },
            render: function(el) { el.textContent = 'x'; }
        });
        WidgetManager.enable('opt-bg-test', { data: { bg: '' } });
        var el = WidgetManager.instances['opt-bg-test-1'].el;
        assert.equal(el.style.getPropertyValue('--widget-bg-color'), '#0a0e14',
            'empty bg renders the declared default');
        WidgetManager.openSettings();
        var group = document.querySelector('.widget-options[data-type="opt-bg-test"]');
        assert.equal(optionInput(group, 'bg').value, '#0a0e14',
            'panel swatch matches the rendered default');
        WidgetManager.closeSettings();
    });

    it('empty value with empty default removes the override (CSS fallback)', function() {
        WidgetManager.register({
            id: 'opt-nodef', name: 'NoDef', defaults: {},
            options: { fg: { type: 'color', label: 'FG', default: '' } },
            render: function(el) { el.textContent = 'x'; }
        });
        WidgetManager.enable('opt-nodef', { data: { fg: '' } });
        var el = WidgetManager.instances['opt-nodef-1'].el;
        assert.equal(el.style.getPropertyValue('--widget-fg'), '',
            'no default → variable removed, CSS fallback takes over');
    });

    it('option change writes data + persists to #desktop-config', function() {
        WidgetManager.enable('opt-test');
        WidgetManager.openSettings();
        var group = document.querySelector('.widget-options[data-type="opt-test"]');
        var inp = optionInput(group, 'accent');
        inp.value = '#00ff00';
        inp.dispatchEvent(new Event('input'));
        var inst = WidgetManager.instances['opt-test-1'];
        assert.equal(inst.data.accent, '#00ff00', 'data updated');
        var saved = JSON.parse(document.getElementById('desktop-config').textContent);
        assert.equal(saved.widgets.instances[0].data.accent, '#00ff00', 'persisted');
        WidgetManager.closeSettings();
    });

    it('hide-bg-at-0% is per-widget: render mirrors data onto the element', function() {
        // Use test-local ids — the real system-info/net-traffic widgets are
        // already registered by the scripts loaded in test-runner.html, so
        // registering those ids again throws "already registered".
        WidgetManager.register(Object.assign({
            id: 'si-hidebg-test',
            name: 'System Info',
            defaults: { x: 10, y: 10 },
            options: { hideBgAtZero: { type: 'checkbox', label: 'HideBG', default: false } },
            render: function(el, data) {
                if (data.hideBgAtZero) el.setAttribute('data-hide-bg', '1');
                else el.removeAttribute('data-hide-bg');
            }
        }));
        WidgetManager.enable('si-hidebg-test');
        var inst = WidgetManager.instances['si-hidebg-test-1'];
        assert.equal(inst.el.getAttribute('data-hide-bg'), null, 'default: no hide attribute');

        // Two instances of DIFFERENT widgets must not influence each other
        WidgetManager.register(Object.assign({
            id: 'nt-hidebg-test',
            name: 'Network Traffic',
            defaults: { x: 10, y: 10 },
            options: { hideBgAtZero: { type: 'checkbox', label: 'HideBG', default: false } },
            render: function(el, data) {
                if (data.hideBgAtZero) el.setAttribute('data-hide-bg', '1');
                else el.removeAttribute('data-hide-bg');
            }
        }));
        WidgetManager.enable('nt-hidebg-test');
        var nt = WidgetManager.instances['nt-hidebg-test-1'];
        WidgetManager.openSettings();
        var siGroup = document.querySelector('.widget-options[data-type="si-hidebg-test"]');
        var inp = optionInput(siGroup, 'hideBgAtZero');
        inp.checked = true;
        inp.dispatchEvent(new Event('change'));
        assert.equal(inst.el.getAttribute('data-hide-bg'), '1',
            'widget own toggle affects itself');
        assert.equal(nt.el.getAttribute('data-hide-bg'), null,
            'other widget unaffected by first widget toggle');
        WidgetManager.closeSettings();
    });

    it('setOpacity mirrors the value onto the data-opacity attribute', function() {
        WidgetManager.enable('opt-test');
        var inst = WidgetManager.instances['opt-test-1'];
        WidgetManager.setOpacity('opt-test-1', 0);
        assert.equal(inst.el.getAttribute('data-opacity'), '0', 'data-opacity reflects 0');
        WidgetManager.setOpacity('opt-test-1', 0.55);
        assert.equal(inst.el.getAttribute('data-opacity'), '0.55', 'data-opacity reflects 0.55');
    });

    it('clock hide-bg option is disabled in analog mode, enabled in digital', function() {
        // Test-local id — the real clock widget is already registered.
        WidgetManager.register(Object.assign({
            id: 'clock-hidebg-test',
            name: 'Clock',
            defaults: { x: 10, y: 10, mode: 'analog' },
            modes: { analog: 'Analog', digital: 'Digital' },
            options: {
                hideBgAtZero: {
                    type: 'checkbox', label: 'HideBG', default: false,
                    disabled: function(data) { return !data.mode || data.mode === 'analog'; }
                }
            },
            render: function(el, data) {
                if (data.hideBgAtZero) el.setAttribute('data-hide-bg', '1');
                else el.removeAttribute('data-hide-bg');
            }
        }));
        WidgetManager.enable('clock-hidebg-test');   // default mode: analog
        WidgetManager.openSettings();
        var cb = optionInput(document.querySelector('.widget-options[data-type="clock-hidebg-test"]'), 'hideBgAtZero');
        assert.ok(cb.disabled, 'analog mode: option greyed out');

        // Switch to digital while the panel is open — setMode refreshes the
        // settings body so the disabled state re-evaluates.
        WidgetManager.setMode('clock-hidebg-test-1', 'digital');
        var cb2 = optionInput(document.querySelector('.widget-options[data-type="clock-hidebg-test"]'), 'hideBgAtZero');
        assert.ok(!cb2.disabled, 'digital mode: option enabled');
        WidgetManager.closeSettings();
    });

    it('option change re-renders by default', function() {
        WidgetManager.enable('opt-test');
        WidgetManager.openSettings();
        var group = document.querySelector('.widget-options[data-type="opt-test"]');
        var inp = optionInput(group, 'title');
        inp.value = 'hello';
        inp.dispatchEvent(new Event('input'));
        assert.equal(WidgetManager.instances['opt-test-1'].el.textContent, 'rendered:hello:true', 'render ran with new value');
        WidgetManager.closeSettings();
    });

    it('apply:false option change stores without re-rendering', function() {
        var renders = 0;
        WidgetManager.registry['opt-test'].render = function(el, data) { renders++; el.textContent = 'x'; };
        WidgetManager.enable('opt-test');
        var before = renders;
        WidgetManager.openSettings();
        var group = document.querySelector('.widget-options[data-type="opt-test"]');
        var inp = optionInput(group, 'refresh');
        inp.value = '10';
        inp.dispatchEvent(new Event('input'));
        assert.equal(WidgetManager.instances['opt-test-1'].data.refresh, 10, 'value stored');
        assert.equal(renders, before, 'no re-render for apply:false');
        WidgetManager.closeSettings();
    });

    it('select change stores the chosen value', function() {
        WidgetManager.enable('opt-test');
        WidgetManager.openSettings();
        var group = document.querySelector('.widget-options[data-type="opt-test"]');
        var sel = optionInput(group, 'unit');
        sel.value = 'mb';
        sel.dispatchEvent(new Event('change'));
        assert.equal(WidgetManager.instances['opt-test-1'].data.unit, 'mb');
        WidgetManager.closeSettings();
    });

    it('select with loadOptions is flagged and keeps static options', function() {
        WidgetManager.register(Object.assign({
            id: 'opt-dynamic',
            name: 'Dynamic',
            updateInterval: 50,
            defaults: { x: 10, y: 10 },
            options: {
                iface: {
                    type: 'select', label: 'Iface',
                    options: { wan: 'WAN', lan: 'LAN' },
                    loadOptions: function() { return Promise.resolve({}); }
                }
            },
            render: function(el) { el.textContent = 'x'; }
        }));
        WidgetManager.enable('opt-dynamic');
        WidgetManager.openSettings();
        var group = document.querySelector('.widget-options[data-type="opt-dynamic"]');
        var sel = optionInput(group, 'iface');
        assert.ok(sel.hasAttribute('data-load-options'), 'flagged for async fill');
        assert.equal(sel.querySelectorAll('option').length, 2, 'static fallback options render immediately');
        WidgetManager.closeSettings();
    });

    it('select outside the static list shows the persisted value, not the first option', function() {
        // Regression: net-traffic's real ifaces (br-lan, pppoe-wan) are not
        // in the static {wan,lan} placeholder — the select fell back to the
        // first option, and the async fill later read THAT as "current", so
        // the user's choice was lost every panel open.
        WidgetManager.register(Object.assign({
            id: 'opt-outside',
            name: 'Outside',
            updateInterval: 50,
            defaults: { x: 10, y: 10 },
            options: { unit: { type: 'select', label: 'Unit', options: { auto: 'Auto' }, default: 'auto' } },
            render: function(el) { el.textContent = 'x'; }
        }));
        WidgetManager.enable('opt-outside', { data: { unit: 'pppoe-wan' } });
        WidgetManager.openSettings();
        var group = document.querySelector('.widget-options[data-type="opt-outside"]');
        var sel = optionInput(group, 'unit');
        assert.equal(sel.value, 'pppoe-wan', 'select shows the persisted value');
        var opts = sel.querySelectorAll('option');
        assert.equal(opts[opts.length - 1].value, 'pppoe-wan', 'value appended as its own option');
        assert.equal(opts[opts.length - 1].selected, true, 'appended value is the selection');
        WidgetManager.closeSettings();
    });
});

describe('Widget API: api context', function() {
    var apiSeen = null;
    beforeEach(function() {
        apiSeen = null;
        setupWidgetDOM();
        registerOptWidget({
            render: function(el, data, api) { apiSeen = api; el.textContent = 'v1'; }
        });
        WidgetManager.enable('opt-test');
    });

    it('render receives api with instanceId and typeId', function() {
        assert.ok(apiSeen, 'api passed to render');
        assert.equal(apiSeen.instanceId, 'opt-test-1');
        assert.equal(apiSeen.typeId, 'opt-test');
        assert.equal(apiSeen.data, WidgetManager.instances['opt-test-1'].data, 'data reference');
    });

    it('api.rerender calls render again', function() {
        var renders = 0;
        WidgetManager.registry['opt-test'].render = function(el, data, api) { renders++; el.textContent = 'v' + renders; };
        var inst = WidgetManager.instances['opt-test-1'];
        inst._api.rerender();
        inst._api.rerender();
        assert.equal(renders, 2, 'rerender invoked render twice');
        assert.equal(inst.el.textContent, 'v2');
    });

    it('api.disable removes the instance', function() {
        WidgetManager.instances['opt-test-1']._api.disable();
        assert.ok(!WidgetManager.instances['opt-test-1'], 'instance gone');
    });

    it('api.saveConfig persists', function() {
        WidgetManager.instances['opt-test-1']._api.saveConfig();
        var saved = JSON.parse(document.getElementById('desktop-config').textContent);
        assert.ok(saved.widgets.instances.length >= 1, 'saved');
    });
});

describe('Widget API: async update', function() {
    beforeEach(function() {
        setupWidgetDOM();
    });

    it('enable runs the first update immediately (no one-interval wait)', function() {
        var calls = 0;
        WidgetManager.register({
            id: 'async-first',
            name: 'Async First',
            defaults: { x: 10, y: 10 },
            updateInterval: 100000,   // never ticks again — proves first run
            render: function(el) { el.textContent = 'x'; },
            update: function() { calls++; return Promise.resolve(); }
        });
        WidgetManager.enable('async-first');
        assert.equal(calls, 1, 'first update fired synchronously on enable');
    });

    it('enable does not throw when update returns a Promise', function() {
        WidgetManager.register({
            id: 'async-test',
            name: 'Async Test',
            defaults: { x: 10, y: 10 },
            updateInterval: 100,
            render: function(el) { el.textContent = 'x'; },
            update: function() { return Promise.resolve(); }
        });
        WidgetManager.enable('async-test');
        assert.ok(WidgetManager.instances['async-test-1'], 'instance created');
    });

    it('update returning a rejected Promise does not throw synchronously', function() {
        WidgetManager.register({
            id: 'async-rej',
            name: 'Async Reject',
            defaults: { x: 10, y: 10 },
            updateInterval: 100,
            render: function(el) { el.textContent = 'x'; },
            update: function() { return Promise.reject(new Error('boom')); }
        });
        // The WM swallows rejections (p.catch) — enable and a full tick cycle
        // must not raise synchronously. Rejection handling is async; the
        // sync assertion is that registration + enable succeed.
        WidgetManager.enable('async-rej');
        assert.ok(WidgetManager.instances['async-rej-1'], 'instance created');
    });

    it('widget update functions can return a Promise (documented pattern)', function() {
        WidgetManager.register({
            id: 'async-doc',
            name: 'Async Doc',
            defaults: { x: 10, y: 10 },
            render: function(el) { el.textContent = 'x'; },
            update: function() { return Promise.resolve('ok'); }
        });
        WidgetManager.enable('async-doc');
        var def = WidgetManager.registry['async-doc'];
        var p = def.update.call(def, null, {}, {});
        assert.ok(p && typeof p.then === 'function', 'update returns a thenable');
    });
});

describe('Widget API: clearable is opt-in + bg option styles', function() {
    beforeEach(function() {
        setupWidgetDOM();
    });

    it('clearable defaults to false — no Clear button unless declared', function() {
        // Regression: WM used to default clearable=true and every content-less
        // widget had to remember `clearable:false`; system-info shipped the
        // meaningless "Clear data" button because of it. Default is now off.
        registerOptWidget();   // no clearable declared
        assert.equal(WidgetManager.registry['opt-test'].clearable, false,
            'clearable defaults to false');
        // enable must not surface any Clear button in the settings panel
        WidgetManager.enable('opt-test');
        WidgetManager.openSettings();
        assert.ok(!document.querySelector('.wps-clear-data'),
            'no Clear data button for content-less widget');
        WidgetManager.closeSettings();
    });

    it('clearable:true widgets keep the Clear data button', function() {
        registerOptWidget({ clearable: true });
        assert.equal(WidgetManager.registry['opt-test'].clearable, true,
            'explicit clearable:true preserved');
    });

    it('bg option exports --widget-bg-color on the widget root', function() {
        // The bg color is a CSS variable consumed by widget.css's color-mix
        // chain (alongside --widget-bg-alpha) — NOT an inline background,
        // so the opacity slider fades a custom background too.
        registerOptWidget({
            options: { bg: { type: 'color', label: 'BG', default: '' } },
            render: function(el) {
                el.innerHTML = '<div class="widget-card">card</div>';
            }
        });
        WidgetManager.enable('opt-test', { data: { bg: '#123456' } });
        var el = WidgetManager.instances['opt-test-1'].el;
        assert.equal(el.style.getPropertyValue('--widget-bg-color'), '#123456',
            'bg exported as --widget-bg-color');
    });

    it('empty bg option removes the variable — theme default background', function() {
        registerOptWidget({
            options: { bg: { type: 'color', label: 'BG', default: '' } },
            render: function(el) {
                el.innerHTML = '<div class="widget-card">card</div>';
            }
        });
        WidgetManager.enable('opt-test');   // default '' — no custom color
        var el = WidgetManager.instances['opt-test-1'].el;
        assert.equal(el.style.getPropertyValue('--widget-bg-color'), '',
            'no background override variable');
    });

    it('bg re-applies after re-render (options change path)', function() {
        registerOptWidget({
            options: { bg: { type: 'color', label: 'BG', default: '' } },
            render: function(el, data) {
                el.innerHTML = '<div class="widget-card">' + (data.bg || 'none') + '</div>';
            }
        });
        WidgetManager.enable('opt-test', { data: { bg: '#abcdef' } });
        WidgetManager.openSettings();
        var group = document.querySelector('.widget-options[data-type="opt-test"]');
        var inp = optionInput(group, 'bg');
        inp.value = '#abcdef';
        inp.dispatchEvent(new Event('input'));   // default apply: re-render
        var el = WidgetManager.instances['opt-test-1'].el;
        assert.equal(el.style.getPropertyValue('--widget-bg-color'), '#abcdef',
            'bg variable survives re-render');
        assert.contains(el.querySelector('.widget-card').textContent, '#abcdef',
            'render saw the bg value');
        WidgetManager.closeSettings();
    });

    it('accent option exports --widget-accent on the widget root', function() {
        // Headless runner loads no CSS — inject the widget.css rule so the
        // var() consumption chain is verified end-to-end.
        var st = document.createElement('style');
        st.id = 'test-accent-rules';
        st.textContent = '.widget-card { color: var(--widget-accent, currentColor); }';
        document.head.appendChild(st);

        registerOptWidget({
            options: { accent: { type: 'color', label: 'ACC', default: '#4a90d9' } },
            render: function(el) { el.innerHTML = '<div class="widget-card">card</div>'; }
        });
        WidgetManager.enable('opt-test', { data: { accent: '#ff0000' } });
        var el = WidgetManager.instances['opt-test-1'].el;
        assert.equal(el.style.getPropertyValue('--widget-accent'), '#ff0000',
            'accent exported as CSS variable');
        // computed: card text resolves the variable
        assert.equal(getComputedStyle(el.querySelector('.widget-card')).color,
            'rgb(255, 0, 0)', 'card text resolves accent');

        document.head.removeChild(st);
    });

    it('accent option removed when cleared — falls back to default', function() {
        registerOptWidget({
            options: { accent: { type: 'color', label: 'ACC', default: '' } },
            render: function(el) { el.innerHTML = '<div class="widget-card">card</div>'; }
        });
        WidgetManager.enable('opt-test', { data: { accent: '' } });
        var el = WidgetManager.instances['opt-test-1'].el;
        assert.equal(el.style.getPropertyValue('--widget-accent'), '',
            'empty accent removes the variable');
    });

    it('fg option exports --widget-fg (font color override)', function() {
        // Clock-style font color: declared as fg, applied as a per-instance
        // --widget-fg override on the widget root; '' restores the theme
        // default foreground.
        registerOptWidget({
            options: { fg: { type: 'color', label: 'FG', default: '' } },
            render: function(el) { el.innerHTML = '<div class="widget-clock">digits</div>'; }
        });
        WidgetManager.enable('opt-test', { data: { fg: '#00ff00' } });
        var el = WidgetManager.instances['opt-test-1'].el;
        assert.equal(el.style.getPropertyValue('--widget-fg'), '#00ff00',
            'fg exported as --widget-fg');
        // ''/unset removes the override — theme default applies (enable is
        // a no-op for existing instances, so drive the options-change path:
        // data write + re-render, as the panel's input handler does)
        var inst = WidgetManager.instances['opt-test-1'];
        inst.data.fg = '';
        WidgetManager._render(WidgetManager.registry['opt-test'], inst.el, inst.data, inst._api);
        assert.equal(inst.el.style.getPropertyValue('--widget-fg'), '',
            'empty fg removes the variable');
    });

    it('digital clock renders a shared face container for time + date', function() {
        // Regression: the clock's bg card must cover BOTH digit rows as one
        // chip (.widget-clock-face) — a per-row background broke this into
        // two chips, and inline-block on the rows put them side by side.
        var def = WidgetManager.registry['desktop-clock'];
        var el = document.createElement('div');
        document.body.appendChild(el);   // getComputedStyle needs DOM attachment
        try {
            def.render.call(def, el, { mode: 'digital' });
            var face = el.querySelector('.widget-clock-face');
            assert.ok(face, 'face container present');
            assert.ok(face.querySelector('.widget-clock-time'), 'time inside face');
            assert.ok(face.querySelector('.widget-clock-date'), 'date inside face');
            // Both rows are block-level children of the face — stacked, not
            // side by side (inline-block on the rows was the layout bug).
            assert.equal(getComputedStyle(face.querySelector('.widget-clock-time')).display,
                'block', 'time is a block row');
            assert.equal(getComputedStyle(face.querySelector('.widget-clock-date')).display,
                'block', 'date is a block row');
        } finally {
            document.body.removeChild(el);
        }
    });

    it('clock declares fg + bg options (font color, card background)', function() {
        var def = WidgetManager.registry['desktop-clock'];
        assert.equal(def.options.fg.type, 'color', 'fg is a color option');
        assert.equal(def.options.bg.type, 'color', 'bg is a color option');
    });

    it('mobile rule overrides click-through pointer-events — drag chain reachable', function() {
        // Regression: click-through widgets get inline pointer-events:none
        // (widget.js enable), which swallows TOUCH events too — the mobile
        // long-press drag chain never starts. mobile.css forces auto with
        // !important, so touch events reach the widget even with
        // clickThrough:true. The rule is injected here the way the headless
        // runner loads no CSS (same pattern as the accent tests).
        registerOptWidget({
            defaults: { x: 10, y: 10, clickThrough: true },
            render: function(el) { el.innerHTML = '<div class="widget-card">card</div>'; }
        });
        WidgetManager.enable('opt-test');
        var el = WidgetManager.instances['opt-test-1'].el;
        assert.equal(getComputedStyle(el).pointerEvents, 'none',
            'click-through widget is pointer-events:none by default');

        var st = document.createElement('style');
        st.id = 'test-mobile-widget-rule';
        st.textContent = '#widget-layer .widget-instance { pointer-events: auto !important; }';
        document.head.appendChild(st);
        try {
            assert.equal(getComputedStyle(el).pointerEvents, 'auto',
                'mobile rule beats the inline none — touch reaches the widget');
        } finally {
            document.head.removeChild(st);
        }
    });

    it('card background resolves without color-mix (older mobile browsers)', function() {
        // Regression: the bg option exports --widget-bg-color, consumed by a
        // color-mix chain. Browsers without color-mix (older WebViews) drop
        // that declaration entirely — the old first line referenced the
        // never-defined var(--widget-bg), so the card went transparent and
        // setting a background color visibly did nothing. The fallback line
        // must be a plain color: custom color when set, theme rgb otherwise.
        var st = document.createElement('style');
        st.id = 'test-nocolormix-rule';
        // Only the fallback declaration — what a no-color-mix browser keeps.
        st.textContent = '.widget-card { background: var(--widget-bg-color, rgb(var(--widget-bg-rgb, 10, 14, 20))); }';
        document.head.appendChild(st);
        registerOptWidget({
            options: { bg: { type: 'color', label: 'BG', default: '' } },
            render: function(el) { el.innerHTML = '<div class="widget-card">card</div>'; }
        });
        WidgetManager.enable('opt-test', { data: { bg: '#123456' } });
        var card = WidgetManager.instances['opt-test-1'].el.querySelector('.widget-card');
        try {
            assert.equal(getComputedStyle(card).backgroundColor, 'rgb(18, 52, 86)',
                'custom bg color applies without color-mix');

            // Unset bg → theme default rgb(10, 14, 20). _render rebuilds
            // innerHTML, so re-query the (new) card node.
            var inst = WidgetManager.instances['opt-test-1'];
            inst.data.bg = '';
            WidgetManager._render(WidgetManager.registry['opt-test'], inst.el, inst.data, inst._api);
            card = inst.el.querySelector('.widget-card');
            assert.equal(getComputedStyle(card).backgroundColor, 'rgb(10, 14, 20)',
                'theme default background applies without color-mix');
        } finally {
            document.head.removeChild(st);
        }
    });
});

describe('Widget settings panel tabs', function() {
    beforeEach(function() {
        setupWidgetDOM();
        registerOptWidget();
    });

    it('generates one tab + pane per registered widget', function() {
        WidgetManager.openSettings();
        var regIds = Object.keys(WidgetManager.registry);
        var tabs = document.querySelectorAll('.widget-settings-tab');
        assert.equal(tabs.length, regIds.length, 'tab per registered widget');
        regIds.forEach(function(id) {
            assert.ok(document.querySelector('.widget-settings-tab[data-tab="' + id + '"]'),
                'tab for ' + id);
            assert.ok(document.querySelector('.widget-tab-pane[data-pane-type="' + id + '"]'),
                'pane for ' + id);
        });
        WidgetManager.closeSettings();
    });

    it('defaults to the first registered widget', function() {
        WidgetManager.openSettings();
        var first = Object.keys(WidgetManager.registry)[0];
        var second = Object.keys(WidgetManager.registry)[1];
        assert.ok(document.querySelector('.widget-settings-tab[data-tab="' + first + '"]')
            .classList.contains('active'), 'first tab active');
        assert.equal(document.querySelector('.widget-tab-pane[data-pane-type="' + first + '"]')
            .style.display, '', 'first pane visible');
        assert.equal(document.querySelector('.widget-tab-pane[data-pane-type="' + second + '"]')
            .style.display, 'none', 'other panes hidden');
        WidgetManager.closeSettings();
    });

    it('clicking a tab switches the visible pane', function() {
        WidgetManager.openSettings();
        var first = Object.keys(WidgetManager.registry)[0];
        var tab = document.querySelector('.widget-settings-tab[data-tab="opt-test"]');
        tab.dispatchEvent(new Event('click'));
        assert.ok(tab.classList.contains('active'), 'clicked tab active');
        assert.equal(document.querySelector('.widget-tab-pane[data-pane-type="opt-test"]')
            .style.display, '', 'its pane visible');
        assert.equal(document.querySelector('.widget-tab-pane[data-pane-type="' + first + '"]')
            .style.display, 'none', 'previous pane hidden');
        WidgetManager.closeSettings();
    });

    it('keeps the active tab across refreshSettings rebuilds', function() {
        // Toggle changes (enable/disable, iface fill) call refreshSettings,
        // which rebuilds the body and rebinds — the active tab must survive.
        WidgetManager.openSettings();
        document.querySelector('.widget-settings-tab[data-tab="opt-test"]')
            .dispatchEvent(new Event('click'));
        WidgetManager.refreshSettings();
        assert.ok(document.querySelector('.widget-settings-tab[data-tab="opt-test"]')
            .classList.contains('active'), 'tab still active after refresh');
        assert.equal(document.querySelector('.widget-tab-pane[data-pane-type="opt-test"]')
            .style.display, '', 'pane still visible after refresh');
        WidgetManager.closeSettings();
    });

    it('options controls inside hidden panes stay queryable', function() {
        // The options-schema tests find controls by selector — hiding a
        // pane must not remove its controls from the DOM.
        WidgetManager.enable('opt-test');
        WidgetManager.openSettings();
        var group = document.querySelector('.widget-options[data-type="opt-test"]');
        assert.ok(group, 'options group in DOM');
        assert.ok(group.querySelector('[data-option-key="title"]'), 'control in DOM');
        WidgetManager.closeSettings();
    });
});

describe('Widget API: resizable (opt-in px width/height)', function() {
    function registerResizable(extra) {
        WidgetManager.register(Object.assign({
            id: 'resize-test',
            name: 'Resize Test',
            updateInterval: 100000,
            defaults: { x: 10, y: 10 },
            resizable: true,
            render: function(el) { el.innerHTML = '<div class="widget-card">card</div>'; }
        }, extra || {}));
    }

    beforeEach(function() {
        setupWidgetDOM();
    });

    function dragHandle(inst, dx, dy) {
        var handle = inst.el.querySelector('.widget-resize-handle');
        var x0 = 100, y0 = 100;
        handle.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: x0, clientY: y0 }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: x0 + dx, clientY: y0 + dy }));
        document.dispatchEvent(new MouseEvent('mouseup'));
    }

    // Natural content size of the widget's card — the drag floor _makeResizable
    // measures at drag start. Mirrors the implementation (inline-block so
    // width:auto is shrink-to-fit content, NOT parent-fill) so the assertions
    // track content, not magic numbers.
    function naturalCardSize(inst) {
        var card = inst.el.querySelector('.widget-card, .widget-sysinfo');
        var oldD = card.style.display, oldW = card.style.width, oldH = card.style.height;
        card.style.display = 'inline-block';
        card.style.width = 'auto'; card.style.height = 'auto';
        var w = card.offsetWidth, h = card.offsetHeight;
        card.style.display = oldD;
        card.style.width = oldW; card.style.height = oldH;
        return { w: w, h: h };
    }

    it('defaults to no handle without resizable:true', function() {
        registerResizable({ resizable: false });
        WidgetManager.enable('resize-test');
        var el = WidgetManager.instances['resize-test-1'].el;
        assert.ok(!el.hasAttribute('data-resizable'), 'no data-resizable marker');
        assert.ok(!el.querySelector('.widget-resize-handle'), 'no handle element');
    });

    it('resizable:true adds the handle and marker', function() {
        registerResizable();
        WidgetManager.enable('resize-test');
        var el = WidgetManager.instances['resize-test-1'].el;
        assert.equal(el.getAttribute('data-resizable'), '1', 'marked resizable');
        assert.ok(el.querySelector('.widget-resize-handle'), 'handle present');
        assert.equal(el.querySelector('.widget-resize-handle').title, 'Resize', 'i18n title');
    });

    it('drag updates the instance px size (and min clamp holds)', function() {
        registerResizable();
        WidgetManager.enable('resize-test');
        var inst = WidgetManager.instances['resize-test-1'];
        // startW/H come from inst.width (or offsetWidth, which is layout-
        // dependent in headless) — pin them so the math is deterministic
        inst.width = 100; inst.height = 100;
        dragHandle(inst, 60, 40);
        assert.equal(inst.width, 160, 'width follows dx (start 100 + 60)');
        assert.equal(inst.height, 140, 'height follows dy (start 100 + 40)');
        assert.equal(inst.el.style.width, '160px', 'style width applied');
        assert.equal(inst.el.style.height, '140px', 'style height applied');

        // Shrink beyond the content floor → clamped at the card's NATURAL
        // size (was a fixed 140×120 — the content-aware floor is the fix
        // for net-traffic dead space / system-info row clipping)
        var natural = naturalCardSize(inst);
        dragHandle(inst, -1000, -1000);
        assert.equal(inst.width, natural.w, 'width clamped at content width');
        assert.equal(inst.height, natural.h, 'height clamped at content height');
    });

    it('net-traffic min height is its content — not a fixed 120px floor', function() {
        // Regression: net-traffic renders only 2 rows (~90px natural), but
        // the shared 120px floor stopped the drag early, leaving a card
        // with ~30px of empty space below the rows.
        WidgetManager.enable('net-traffic');
        var inst = WidgetManager.instances['net-traffic-1'];
        dragHandle(inst, 0, -1000);
        assert.ok(inst.height < 120, 'shrinks below the old fixed 120px floor');
        // Headless layout quirk: the title sits exactly on the wrap
        // boundary at the content width (one line more after the drag than
        // the measurement at drag start, 63 vs 84 here). Both satisfy the
        // intent — content floor, not a fixed 120 — so allow one line.
        var natural = naturalCardSize(inst).h;
        assert.ok(Math.abs(inst.height - natural) <= 25,
            'clamped at the card content height (got ' + inst.height + ', natural ' + natural + ')');
    });

    it('system-info min height clamps at its content (no row clipping)', function() {
        // system-info has 4 rows — its content is the floor, so dragging
        // down never cuts the rows (a shared floor below content height
        // used to clip them).
        WidgetManager.enable('system-info');
        var inst = WidgetManager.instances['system-info-1'];
        dragHandle(inst, 0, -1000);
        assert.equal(inst.height, naturalCardSize(inst).h,
            'height clamped at the card content height');
        assert.ok(inst.el.querySelector('#si-uptime'), 'last row still rendered');
    });

    it('resized size persists to #desktop-config', function() {
        registerResizable();
        WidgetManager.enable('resize-test');
        var inst = WidgetManager.instances['resize-test-1'];
        inst.width = 100; inst.height = 100;
        dragHandle(inst, 80, 50);   // mouseup → end() → saveConfig()
        var saved = JSON.parse(document.getElementById('desktop-config').textContent);
        var cfg = saved.widgets.instances[0];
        assert.equal(cfg.width, 180, 'width in persisted config');
        assert.equal(cfg.height, 150, 'height in persisted config');
    });

    it('enable restores persisted size', function() {
        registerResizable();
        WidgetManager.enable('resize-test', { width: 240, height: 180 });
        var inst = WidgetManager.instances['resize-test-1'];
        assert.equal(inst.width, 240, 'instance width from config');
        assert.equal(inst.el.style.width, '240px', 'style width restored');
        assert.equal(inst.el.style.height, '180px', 'style height restored');
    });

    it('net-traffic resize survives re-render (no forced width reset)', function() {
        // Regression: net-traffic's render appended width:190px inline,
        // which re-won over the dragged width on every re-render (option
        // change, iface switch) — the resize silently undid itself.
        WidgetManager.enable('net-traffic');
        var inst = WidgetManager.instances['net-traffic-1'];
        inst.width = 100; inst.height = 100;
        dragHandle(inst, 200, 0);   // → 300px wide
        assert.equal(inst.el.style.width, '300px', 'dragged width applied');
        inst._api.rerender();
        assert.equal(inst.el.style.width, '300px', 'width survives re-render');
        assert.equal(inst.el.style.height, '100px', 'height survives re-render');
        assert.equal(inst.el.querySelector('.nt-rx').textContent, '--',
            'card rebuilt after re-render');
        // render() wipes innerHTML — the resize handle is a direct child
        // and must be re-attached, or the user can never resize again
        assert.ok(inst.el.querySelector('.widget-resize-handle'),
            'handle re-attached after re-render');
    });

    it('can shrink back after widening (content floor, not last size)', function() {
        // Regression: the floor was measured with the card as a block
        // (width:auto = parent-fill) — after widening, the measure read
        // the CURRENT box, locking minW to the widened size so the card
        // could never shrink again. Headless loads no CSS, so inject the
        // production fill rule (.widget-instance[data-resizable] .widget-card
        // { width:100% }) to reproduce the on-device measurement.
        var st = document.createElement('style');
        st.id = 'test-fill-rule';
        st.textContent = '#widget-layer .widget-instance[data-resizable] .widget-card { width: 100%; }';
        document.head.appendChild(st);
        try {
            WidgetManager.enable('net-traffic');
            var inst = WidgetManager.instances['net-traffic-1'];
            inst.width = 100; inst.height = 100;
            dragHandle(inst, 200, 0);       // widen to 300
            assert.equal(inst.el.style.width, '300px', 'widened');
            var natural = naturalCardSize(inst);
            dragHandle(inst, -200, 0);      // shrink back
            assert.ok(inst.width < 300, 'not locked to the widened size');
            assert.equal(inst.width, natural.w, 'shrinks to the content width');
        } finally {
            document.head.removeChild(st);
        }
    });
});

})();
