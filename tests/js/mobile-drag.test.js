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

    // Geometry-dependent: _reorderMobileDrag maps the pointer onto the
    // grid of #desktop-icons (mobile.css: 4 cols, 94px row pitch, 10px
    // padding). The runner is real Firefox, so rect stubs are enough:
    // a fake container rect {left:0,top:0,width:500,height:400} yields
    // a 121px column stride and 94px row pitch; x=400 lands on cell 3 in
    // the 4-icon case. These tests guard the wiring contract
    // (0.1.0-247 regression: the touchmove active branch painted only and
    // never called this, so the drag did nothing — slot math was tested,
    // this path was not).
    function stubRects(c) {
        var kids = Array.prototype.slice.call(c.querySelectorAll('.desktop-icon'));
        c.getBoundingClientRect = function() {
            return { left: 0, top: 0, width: 500, height: 400 };
        };
        kids.forEach(function(el) {
            el.getBoundingClientRect = function() {
                return { left: 0, top: 0, width: 0, height: 0 };
            };
        });
        return kids;
    }

    it('_reorderMobileDrag swaps the dragged icon into the hovered cell', function() {
        window.__IS_MOBILE__ = true;
        var c = makeContainer(['/a', '/b', '/c', '/d']);
        var kids = stubRects(c);
        var m = icons();
        m._dragIcon = kids[0];
        m._dragGrab = { x: 0, y: 0 };
        m._dragOrigin = { x: 0, y: 0 };
        m._reorderMobileDrag({ clientX: 400, clientY: 10 });   // cell 3 (col 3, row 0)
        var order = Array.prototype.slice.call(c.querySelectorAll('.desktop-icon'))
            .map(function(el) { return el.getAttribute('data-url'); });
        assert.equal(JSON.stringify(order), JSON.stringify(['/b', '/c', '/d', '/a']),
            'a swapped past d: insertBefore(d.nextSibling)');
    });

    it('_reorderMobileDrag ignores empty cells and the dragged cell itself', function() {
        window.__IS_MOBILE__ = true;
        var c = makeContainer(['/a', '/b']);
        var kids = stubRects(c);
        var m = icons();
        m._dragIcon = kids[0];
        m._dragGrab = { x: 0, y: 0 };
        m._dragOrigin = { x: 0, y: 0 };
        // empty cell in row 0 (col 2 of 2 icons) → kids[2] undefined → no-op
        m._reorderMobileDrag({ clientX: 300, clientY: 10 });
        var order1 = Array.prototype.slice.call(c.querySelectorAll('.desktop-icon'))
            .map(function(el) { return el.getAttribute('data-url'); });
        assert.equal(JSON.stringify(order1), JSON.stringify(['/a', '/b']), 'empty cell no-op');
        // the dragged icon's own cell → target === icon → no-op
        m._reorderMobileDrag({ clientX: 10, clientY: 10 });
        var order2 = Array.prototype.slice.call(c.querySelectorAll('.desktop-icon'))
            .map(function(el) { return el.getAttribute('data-url'); });
        assert.equal(JSON.stringify(order2), JSON.stringify(['/a', '/b']), 'same cell no-op');
    });
});
})();
