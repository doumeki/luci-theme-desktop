/* mobile-drag.test.js — Mobile icon drag-reorder
 *
 * Mobile lays #desktop-icons out with CSS grid (mobile.css): the visual
 * order IS the DOM order. desktop-icons.js:
 *   - renders icons in the persisted `mobile` {col,row} order of each
 *     icon_layout entry (desktop keeps its own absolute grid, unchanged);
 *   - engages a touch drag when a press moves >=12px before the 500ms
 *     long-press (menu) timer fires, and persists the dropped order back
 *     into the same `mobile` field.
 *
 * No Touch API on desktop Firefox — the tests drive the pure parts:
 * mobileSlotOf, the mobile render order, and _finishMobileDrag's
 * layout-persisting behavior.
 */
(function() {
'use strict';

describe('Mobile icon drag-reorder', function() {
    var origIsMobile, origState, origDefaults;

    function icons() {
        // window.Desktop is the facade; the rendering engine lives on
        // LuCIDesktop.desktopIcons directly.
        return window.LuCIDesktop.desktopIcons;
    }

    function makeContainer(urls) {
        var c = document.createElement('div');
        c.id = 'desktop-icons';
        urls.forEach(function(u) {
            var d = document.createElement('div');
            d.className = 'desktop-icon';
            d.setAttribute('data-url', u);
            c.appendChild(d);
        });
        document.body.appendChild(c);
        return c;
    }

    beforeEach(function() {
        origIsMobile = window.__IS_MOBILE__;
        origState = {};
        origDefaults = window.LuCIDesktop.desktopIcons.effectiveDefaults;
        ['layout', 'pins', 'hidden', 'saveIconLayout'].forEach(function(k) {
            origState[k] = window.LuCIDesktop.desktopState[k];
        });
        var _layout = {};
        var _saved = 0;
        window.LuCIDesktop.desktopState.layout = function() { return _layout; };
        window.LuCIDesktop.desktopState.pins = function() { return []; };
        window.LuCIDesktop.desktopState.hidden = function() { return []; };
        window.LuCIDesktop.desktopState.saveIconLayout = function() { _saved++; };
        window.LuCIDesktop.desktopState._savedCount = function() { return _saved; };
    });

    afterEach(function() {
        window.__IS_MOBILE__ = origIsMobile;
        window.LuCIDesktop.desktopIcons.effectiveDefaults = origDefaults;
        ['layout', 'pins', 'hidden', 'saveIconLayout'].forEach(function(k) {
            window.LuCIDesktop.desktopState[k] = origState[k];
        });
        var c = document.getElementById('desktop-icons');
        if (c) c.remove();
    });

    it('mobileSlotOf maps {col,row} to a row-major slot; missing/garbage → null', function() {
        assert.equal(icons().mobileSlotOf({ mobile: { col: 1, row: 0 } }), 1);
        assert.equal(icons().mobileSlotOf({ mobile: { col: 0, row: 2 } }), 8);
        assert.equal(icons().mobileSlotOf({ mobile: { col: 3, row: 1 } }), 7);
        assert.equal(icons().mobileSlotOf({}), null);
        assert.equal(icons().mobileSlotOf({ mobile: { col: 'x' } }), null);
        assert.equal(icons().mobileSlotOf(null), null);
    });

    it('renderShortcuts (mobile) orders icons by the persisted mobile slot', function() {
        var A = '/a', B = '/b', C = '/c', D = '/d';
        icons().effectiveDefaults = function() {
            return [{ title: 'A', url: A }, { title: 'B', url: B },
                    { title: 'C', url: C }, { title: 'D', url: D }];
        };
        // D dragged to slot 0 earlier; A moved to row 1, col 1 (slot 5)
        window.LuCIDesktop.desktopState.layout = function() {
            return {
                [A]: { mobile: { col: 1, row: 1 } },
                [B]: {},
                [C]: {},
                [D]: { mobile: { col: 0, row: 0 } }
            };
        };
        window.__IS_MOBILE__ = true;
        var c = makeContainer([A, B, C, D]);
        icons().renderShortcuts();
        var order = Array.prototype.slice.call(c.querySelectorAll('.desktop-icon'))
            .map(function(el) { return el.getAttribute('data-url'); });
        assert.equal(JSON.stringify(order), JSON.stringify([D, B, C, A]),
            'D(slot 0) first, unpositioned keep default order, A(slot 5) behind');
    });

    it('renderShortcuts (desktop) ignores mobile slots', function() {
        var A = '/a', B = '/b';
        icons().effectiveDefaults = function() {
            return [{ title: 'A', url: A }, { title: 'B', url: B }];
        };
        window.__IS_MOBILE__ = false;
        var c = makeContainer([A, B]);
        icons().renderShortcuts();
        var order = Array.prototype.slice.call(c.querySelectorAll('.desktop-icon'))
            .map(function(el) { return el.getAttribute('data-url'); });
        assert.equal(JSON.stringify(order), JSON.stringify([A, B]));
    });

    it('_finishMobileDrag writes grid cells from DOM order and keeps desktop cells', function() {
        window.__IS_MOBILE__ = true;
        var lt = {
            '/a': { desktop: { col: 0, row: 0 } },
            '/b': { desktop: { col: 1, row: 0 } },
            '/c': {}
        };
        window.LuCIDesktop.desktopState.layout = function() { return lt; };
        var c = makeContainer(['/b', '/c', '/a']);
        icons()._dragIcon = null;
        icons()._dragActive = false;
        var dirty = icons()._finishMobileDrag();
        assert.ok(dirty, 'first pass reports changes');
        assert.equal(JSON.stringify(lt['/a']),
            JSON.stringify({ desktop: { col: 0, row: 0 }, mobile: { col: 2, row: 0 } }),
            'desktop cell kept, mobile cell added');
        assert.equal(JSON.stringify(lt['/b']),
            JSON.stringify({ desktop: { col: 1, row: 0 }, mobile: { col: 0, row: 0 } }));
        assert.equal(JSON.stringify(lt['/c'].mobile), JSON.stringify({ col: 1, row: 0 }));
    });

    it('_finishMobileDrag is idempotent (second run with same order: no changes)', function() {
        window.__IS_MOBILE__ = true;
        var lt = {};
        window.LuCIDesktop.desktopState.layout = function() { return lt; };
        makeContainer(['/a', '/b']);
        icons()._dragIcon = null;
        icons()._dragActive = false;
        assert.ok(icons()._finishMobileDrag(), 'first pass dirty');
        assert.equal(icons()._finishMobileDrag(), false, 'second pass clean');
    });
});
})();
