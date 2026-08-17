/* widget.test.js — Widget Manager Unit Tests */

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

    // Reset manager state (re-init)
    if (WidgetManager) {
        // Capture the real registry (sticky-note, clock...) once, then
        // restore it each time — test widgets must not leak between
        // suites, and real widgets must survive for features.test.js
        if (!window.__BASE_WIDGET_REGISTRY__) window.__BASE_WIDGET_REGISTRY__ = Object.assign({}, WidgetManager.registry);
        WidgetManager.registry = Object.assign({}, window.__BASE_WIDGET_REGISTRY__);
        WidgetManager.instances = {};
        WidgetManager._nextNum = {};
        WidgetManager._preservedConfigs = {};
        // Serialized-save state (mock XHRs never fire onload — a parked
        // save would wedge the next test's POST).
        WidgetManager._saveBusy = false;
        WidgetManager._savePending = null;
    }
}

describe('WidgetManager.register(def)', function() {
    beforeEach(setupWidgetDOM);

    it('should register a widget definition', function() {
        WidgetManager.register({
            id: 'test-widget',
            name: 'Test Widget',
            render: function(el) { el.textContent = 'hello'; }
        });
        assert.ok(WidgetManager.registry['test-widget'], 'registered');
        assert.equal(WidgetManager.registry['test-widget'].name, 'Test Widget');
    });

    it('should reject duplicate id', function() {
        WidgetManager.register({id: 'dup', name: 'A', render: function(el){}});
        var threw = false;
        try { WidgetManager.register({id: 'dup', name: 'B', render: function(el){}}); } catch(e) { threw = true; }
        assert.ok(threw, 'should throw on duplicate id');
    });

    it('should reject definition without id', function() {
        var threw = false;
        try { WidgetManager.register({name: 'No ID'}); } catch(e) { threw = true; }
        assert.ok(threw, 'should throw on missing id');
    });

    it('should reject definition without render', function() {
        var threw = false;
        try { WidgetManager.register({id: 'no-render', name: 'X'}); } catch(e) { threw = true; }
        assert.ok(threw, 'should throw on missing render');
    });
});

describe('WidgetManager.enable(id)', function() {
    beforeEach(function() {
        setupWidgetDOM();
        WidgetManager.register({
            id: 'en-test',
            name: 'Enable Test',
            defaults: { x: 10, y: 20, opacity: 0.5, clickThrough: true },
            render: function(el) { el.textContent = 'enabled'; }
        });
    });

    it('should create a widget instance in the layer', function() {
        WidgetManager.enable('en-test');
        var inst = WidgetManager.instances['en-test-1'];
        assert.ok(inst, 'instance exists');
        assert.ok(inst.el, 'has DOM element');
        assert.equal(inst.el.textContent, 'enabled', 'render was called');
    });

    it('should position widget at default coordinates', function() {
        WidgetManager.enable('en-test');
        var el = WidgetManager.instances['en-test-1'].el;
        assert.equal(el.style.left, '10px', 'left from defaults');
        assert.equal(el.style.top, '20px', 'top from defaults');
    });

    it('should apply default opacity as background alpha', function() {
        // Opacity fades the card BACKGROUND (--widget-bg-alpha), never the
        // text — the element's own opacity stays untouched.
        WidgetManager.enable('en-test');
        var el = WidgetManager.instances['en-test-1'].el;
        assert.equal(el.style.getPropertyValue('--widget-bg-alpha'), '0.5',
            'background alpha set');
        assert.equal(el.style.opacity, '', 'no whole-widget opacity');
    });

    it('should apply click-through when enabled', function() {
        WidgetManager.enable('en-test');
        var el = WidgetManager.instances['en-test-1'].el;
        assert.equal(el.style.pointerEvents, 'none', 'pointer-events: none');
    });

    it('should throw for unregistered widget', function() {
        var threw = false;
        try { WidgetManager.enable('nope'); } catch(e) { threw = true; }
        assert.ok(threw, 'should throw for unknown widget');
    });

    it('should ignore double enable (single-instance)', function() {
        WidgetManager.enable('en-test');
        WidgetManager.enable('en-test'); // silently returns
        assert.ok(WidgetManager._instancesOf('en-test').length === 1, 'still one instance');
    });
});

describe('WidgetManager.disable(id)', function() {
    beforeEach(function() {
        setupWidgetDOM();
        WidgetManager.register({
            id: 'dis-test',
            name: 'Disable Test',
            render: function(el) { el.textContent = 'x'; },
            destroy: function() { this._destroyed = true; }
        });
        WidgetManager.enable('dis-test');
    });

    it('should remove widget from DOM', function() {
        var el = WidgetManager.instances['dis-test-1'].el;
        assert.ok(el.parentNode, 'in DOM before disable');
        WidgetManager.disable('dis-test-1');
        assert.isNull(el.parentNode, 'removed from DOM');
    });

    it('should remove from instances', function() {
        WidgetManager.disable('dis-test-1');
        assert.ok(!WidgetManager.instances['dis-test-1'], 'removed from instances');
    });

    it('should call destroy hook if defined', function() {
        var def = WidgetManager.registry['dis-test'];
        WidgetManager.disable('dis-test-1');
        assert.ok(def._destroyed, 'destroy was called');
    });

    it('should do nothing for unknown id', function() {
        var threw = false;
        try { WidgetManager.disable('nope'); } catch(e) { threw = true; }
        assert.ok(!threw, 'should not throw');
    });
});

describe('WidgetManager.setOpacity(id, value)', function() {
    beforeEach(function() {
        setupWidgetDOM();
        WidgetManager.register({
            id: 'op-test',
            name: 'Opacity Test',
            render: function(el) {}
        });
        WidgetManager.enable('op-test');
    });

    it('should clamp to 0-1.0 range (0 = fully transparent shell)', function() {
        // 0 is a real value now: the slider can fade the card shell away
        // completely (text stays opaque) — clamping at 0.1 left a visible
        // ghost of the card the user could not remove.
        WidgetManager.setOpacity('op-test-1', -5);
        assert.equal(WidgetManager.instances['op-test-1'].opacity, 0, 'clamped to 0');
        WidgetManager.setOpacity('op-test-1', 999);
        assert.equal(WidgetManager.instances['op-test-1'].opacity, 1.0, 'clamped to 1.0');
    });

    it('opacity 0 stays 0 (regression: || fallback ate the zero)', function() {
        // parseFloat(0) || 0.7 returned 0.7 — the slider at minimum made
        // the card shell fully OPAQUE instead of fully transparent.
        WidgetManager.setOpacity('op-test-1', 0);
        assert.equal(WidgetManager.instances['op-test-1'].opacity, 0,
            '0 is not replaced by the default');
        assert.equal(WidgetManager.instances['op-test-1'].el.style
            .getPropertyValue('--widget-bg-alpha'), '0',
            'background alpha set to 0');
    });

    it('should update background alpha only (text stays opaque)', function() {
        WidgetManager.setOpacity('op-test-1', 0.3);
        var el = WidgetManager.instances['op-test-1'].el;
        assert.equal(el.style.getPropertyValue('--widget-bg-alpha'), '0.3',
            'background alpha updated');
        assert.equal(el.style.opacity, '', 'element opacity untouched');
    });
});

describe('WidgetManager.setClickThrough(id, bool)', function() {
    beforeEach(function() {
        setupWidgetDOM();
        WidgetManager.register({id:'ct-test', name:'CT', render:function(el){}});
        WidgetManager.enable('ct-test');
    });

    it('should set pointer-events:none when true', function() {
        WidgetManager.setClickThrough('ct-test-1', true);
        assert.equal(WidgetManager.instances['ct-test-1'].clickThrough, true);
        assert.equal(WidgetManager.instances['ct-test-1'].el.style.pointerEvents, 'none');
    });

    it('should set pointer-events:auto when false', function() {
        WidgetManager.setClickThrough('ct-test-1', false);
        assert.equal(WidgetManager.instances['ct-test-1'].clickThrough, false);
        assert.equal(WidgetManager.instances['ct-test-1'].el.style.pointerEvents, 'auto');
    });
});

describe('Widget config persistence', function() {
    beforeEach(function() {
        setupWidgetDOM();
        WidgetManager.register({
            id: 'persist-test',
            name: 'Persistence Test',
            defaults: { x: 5, y: 10, opacity: 0.8, clickThrough: false },
            render: function(el) {}
        });
    });

    it('should save config to desktop-config', function() {
        WidgetManager.enable('persist-test');
        WidgetManager.saveConfig();

        // Config is saved to desktop-config element
        var cfgEl = document.getElementById('desktop-config');
        var cfg = JSON.parse(cfgEl.textContent);
        assert.ok(cfg.widgets, 'widgets config exists');
        assert.equal(cfg.widgets.instances.length, 1, 'one instance saved');
        assert.equal(cfg.widgets.instances[0].id, 'persist-test-1');
    });

    it('should restore config from desktop-config on reload', function() {
        WidgetManager.enable('persist-test');
        WidgetManager.setOpacity('persist-test-1', 0.3);
        WidgetManager.saveConfig();

        // Reset and reload (simulating page refresh)
        WidgetManager.instances = {};
        document.getElementById('widget-layer').innerHTML = '';
        WidgetManager.loadConfig();

        assert.ok(WidgetManager.instances['persist-test-1'], 'instance restored');
        assert.equal(WidgetManager.instances['persist-test-1'].opacity, 0.3, 'opacity restored');
    });

    it('loadConfig does NOT overwrite UCI when a restore fails (regression)', function() {
        // Config contains an instance whose type is NOT registered
        // (simulates a widget whose script failed to load). The old code
        // skipped it, then saveConfig() overwrote UCI without it — the
        // widget was permanently deleted on next refresh.
        var cfgEl = document.getElementById('desktop-config');
        var cfg = JSON.parse(cfgEl.textContent);
        cfg.widgets = { instances: [
            { id: 'ghost-1', typeId: 'ghost', x: 1, y: 2, active: true },
            { id: 'persist-test-1', typeId: 'persist-test', x: 5, y: 10, opacity: 0.8, clickThrough: false, active: true }
        ] };
        cfgEl.textContent = JSON.stringify(cfg);

        WidgetManager.instances = {};
        document.getElementById('widget-layer').innerHTML = '';
        // Spy on _saveToUCI: must NOT run (guard) — the failed restore must
        // keep the UCI copy intact.
        var saved = 0;
        var origSave = WidgetManager._saveToUCI;
        WidgetManager._saveToUCI = function() { saved++; };
        WidgetManager.loadConfig();
        WidgetManager._saveToUCI = origSave;

        assert.ok(WidgetManager.instances['persist-test-1'], 'registered instance restored');
        assert.equal(saved, 0, 'saveConfig skipped when a restore failed');
    });

    it('loadConfig NEVER posts a write-back (boot must not race user saves)', function() {
        // Regression for the 1.1 mobile-track bug: after boot, loadConfig
        // saved the restored (STALE, pre-user-action) list — racing the
        // user's own save right after F5; whichever POST landed last won,
        // so a widget the user just enabled vanished from UCI.
        WidgetManager.enable('persist-test');
        WidgetManager.saveConfig();
        WidgetManager.instances = {};
        document.getElementById('widget-layer').innerHTML = '';
        var posts = 0;
        var origXHR = window.XMLHttpRequest;
        window.XMLHttpRequest = function() {
            this.open = function() {};
            this.setRequestHeader = function() {};
            this.send = function() { posts++; };
        };
        WidgetManager.loadConfig();
        window.XMLHttpRequest = origXHR;
        assert.ok(WidgetManager.instances['persist-test-1'], 'instance restored');
        assert.equal(posts, 0, 'loadConfig performs no backend POST');
    });

    it('_sendSave serializes: a save during flight is parked and sent after done', function() {
        // Two rapid saves must not fire two concurrent POSTs — the first
        // completes, then the parked latest is sent (no stale-overwrite).
        var sent = [];
        var firstXhr = null;
        var origXHR = window.XMLHttpRequest;
        window.XMLHttpRequest = function() {
            this.open = function() {};
            this.setRequestHeader = function() {};
            this.send = function(body) {
                sent.push(body);
                if (!firstXhr) firstXhr = this;   // first save's XHR stalls
            };
        };
        try {
            WidgetManager.enable('persist-test');
            WidgetManager.saveConfig();    // in flight (stalled first XHR)
            assert.ok(WidgetManager._saveBusy, 'first save in flight');
            WidgetManager.saveConfig();    // parked — latest data wins
            assert.ok(WidgetManager._savePending, 'second save parked');
            assert.equal(sent.length, 1, 'only one POST while first in flight');
            // Release the first XHR (onload) → parked save must be sent next.
            firstXhr.status = 200;
            firstXhr.onload();
            assert.equal(sent.length, 2, 'parked save POSTed after first completes');
            assert.ok(!WidgetManager._savePending, 'queue drained');
        } finally {
            window.XMLHttpRequest = origXHR;
            WidgetManager._saveBusy = false;
            WidgetManager._savePending = null;
        }
    });

    it('_saveToUCI posts exactly once per save (no duplicate XHR)', function() {
        WidgetManager.enable('persist-test');
        // enable() already saved (async). Let the serialized queue drain so
        // the next saveConfig starts a fresh in-flight POST.
        if (WidgetManager._saveBusy) {
            WidgetManager._saveBusy = false;
            WidgetManager._savePending = null;
        }
        var posts = [];
        var origXHR = window.XMLHttpRequest;
        window.XMLHttpRequest = function() {
            this.open = function() {};
            this.setRequestHeader = function() {};
            this.send = function(body) { posts.push(body); };
        };
        WidgetManager.saveConfig();
        window.XMLHttpRequest = origXHR;
        // setSection posts once (access layer); the old code added a second
        // fire-and-forget POST per save.
        assert.equal(posts.length, 1, 'single POST per save');
        assert.contains(posts[0], 'section=widgets', 'widgets section');
    });
});

describe('Widget drag to reposition', function() {
    beforeEach(function() {
        setupWidgetDOM();
        WidgetManager.register({
            id: 'drag-test',
            name: 'Drag Test',
            render: function(el) { el.textContent = 'drag me'; }
        });
        WidgetManager.enable('drag-test');
    });

    it('should update position when moved', function() {
        WidgetManager.setPosition('drag-test-1', 200, 300);
        var el = WidgetManager.instances['drag-test-1'].el;
        assert.equal(el.style.left, '200px', 'left updated');
        assert.equal(el.style.top, '300px', 'top updated');
    });
});

describe('Widget i18n (clock registration)', function() {
    afterEach(function() { document.documentElement.setAttribute('lang', 'en'); });

    it('clock registers with English name and modes (msgids)', function() {
        var def = WidgetManager.registry['desktop-clock'];
        assert.ok(def, 'clock registered');
        assert.equal(def.name, 'Desktop Clock', 'name is the English msgid');
        assert.equal(def.modes.analog, 'Analog', 'analog label msgid');
        assert.equal(def.modes.digital, 'Digital', 'digital label msgid');
    });

    it('clock name and modes translate in zh (translated at render time)', function() {
        var def = WidgetManager.registry['desktop-clock'];
        document.documentElement.setAttribute('lang', 'zh_Hans');
        assert.equal(_(def.name), '桌面时钟', 'widget name');
        assert.equal(_(def.modes.analog), '指针', 'analog mode');
        assert.equal(_(def.modes.digital), '数字', 'digital mode');
    });
});

})();
