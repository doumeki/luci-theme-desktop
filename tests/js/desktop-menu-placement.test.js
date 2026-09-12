/* desktop-menu-placement.test.js — popup menus clamp into the viewport on
 * BOTH axes (0.1.0-233).
 *
 * Regression: desktop-menus.js's _makeMenu() clamped right/bottom with
 * getBoundingClientRect() but its CALLERS injected innerHTML after it
 * returned. So it measured an empty 0x0 div: "r.right > innerWidth" was
 * never true when the click was inside the viewport, the clamp silently
 * no-op'd, and the content then pushed the menu off-screen. Right-clicking
 * near the bottom-right corner showed a clipped menu.
 *
 * All popup menus must go through the single factory
 * LuCIDesktop.desktopMenus._makeMenu(x, y, html) — render first, measure
 * the REAL width AND height, then clamp. The Start-Menu "Pin to Desktop"
 * menu (startmenu.js showPinMenu) reuses it too.
 *
 * Geometry note: the runner does not link shell.css, so a .context-menu has
 * no min-width here; that is fine — these tests assert the geometric
 * invariant (fits in the viewport) against the real Firefox layout, which is
 * exactly what was broken.
 */
(function() {
'use strict';

var MENUS = window.LuCIDesktop.desktopMenus;
var MARGIN = 6;   // keep in sync with MENU_MARGIN in desktop-menus.js

function cleanup() {
    document.querySelectorAll('#desktop-context-menu, #icon-context-menu, #pin-menu')
        .forEach(function(m) { m.remove(); });
}

// Assert a popup menu is fully inside the viewport (both axes) and never at
// a negative coordinate.
function assertInside(menu, label) {
    var r = menu.getBoundingClientRect();
    assert.ok(r.left >= 0, label + ' left >= 0, got ' + r.left);
    assert.ok(r.top >= 0, label + ' top >= 0, got ' + r.top);
    assert.ok(r.right <= window.innerWidth,
        label + ' right ' + r.right + ' <= innerWidth ' + window.innerWidth);
    assert.ok(r.bottom <= window.innerHeight,
        label + ' bottom ' + r.bottom + ' <= innerHeight ' + window.innerHeight);
}

var CORNERS = [
    { name: 'bottom-right', x: function() { return window.innerWidth - 2; },
                            y: function() { return window.innerHeight - 2; } },
    { name: 'top-right',    x: function() { return window.innerWidth - 2; },
                            y: function() { return 2; } },
    { name: 'bottom-left',  x: function() { return 2; },
                            y: function() { return window.innerHeight - 2; } },
    { name: 'top-left',     x: function() { return 2; },
                            y: function() { return 2; } }
];

var OPENERS = [
    { name: 'desktop menu',
      open: function(x, y) { window.Desktop._showDesktopMenu(x, y); },
      id: 'desktop-context-menu' },
    { name: 'default icon menu',
      open: function(x, y) { window.Desktop._showDefaultIconMenu(x, y, '/cgi-bin/luci/x', 'X', null); },
      id: 'icon-context-menu' },
    { name: 'pinned icon menu',
      open: function(x, y) { window.Desktop._showIconMenu(x, y, { url: '/cgi-bin/luci/x', title: 'X' }); },
      id: 'icon-context-menu' }
];

describe('Popup menus: both-axis viewport clamp (0.1.0-233)', function() {
    beforeEach(cleanup);
    afterEach(cleanup);

    OPENERS.forEach(function(opener) {
        it(opener.name + ' stays inside the viewport in every corner', function() {
            CORNERS.forEach(function(c) {
                var x = c.x(), y = c.y();
                opener.open(x, y);
                var menu = document.getElementById(opener.id);
                assert.ok(menu, opener.name + ' rendered at ' + c.name);
                assertInside(menu, opener.name + ' @ ' + c.name);
            });
        });
    });

    it('a menu with room to open stays at the click point (clamp does not always hug)', function() {
        window.Desktop._showDesktopMenu(10, 20);
        var menu = document.getElementById('desktop-context-menu');
        assert.ok(menu.offsetWidth > 0 && menu.offsetHeight > 0, 'menu really has content before measuring');
        assert.equal(menu.style.left, '10px', 'left untouched when it fits');
        assert.equal(menu.style.top, '20px', 'top untouched when it fits');
    });

    it('a menu taller than the viewport is pinned to the top margin and scrolls', function() {
        assert.equal(typeof MENUS._makeMenu, 'function',
            'desktopMenus._makeMenu is the single popup entry point');
        var html = '';
        for (var i = 0; i < 300; i++) html += '<div class="context-item">Item ' + i + '</div>';
        var menu = MENUS._makeMenu(window.innerWidth - 2, window.innerHeight - 2, html);
        var r = menu.getBoundingClientRect();
        assert.ok(r.top >= 0, 'top is not negative, got ' + r.top);
        assert.ok(r.top <= MARGIN + 1, 'pinned to the top margin, got ' + r.top);
        assert.ok(r.bottom <= window.innerHeight,
            'bottom ' + r.bottom + ' <= innerHeight ' + window.innerHeight + ' (scrolls)');
        assert.equal(menu.style.overflowY, 'auto', 'oversized menu is scrollable');
        assert.ok(menu.style.maxHeight !== '', 'oversized menu got a max-height');
    });

    it('submenu direction still flips correctly after the main menu is clamped', function() {
        window.Desktop._showDesktopMenu(window.innerWidth - 2, 60);
        var menu = document.getElementById('desktop-context-menu');
        var row = menu.querySelector('.context-has-sub');
        assert.ok(row, 'New row with submenu exists');
        window.Desktop._placeSubmenu(row);
        assert.equal(row.classList.contains('sub-left'), true,
            'submenu flips left when the clamped main menu sits on the right edge');

        cleanup();
        window.Desktop._showDesktopMenu(10, 60);
        menu = document.getElementById('desktop-context-menu');
        row = menu.querySelector('.context-has-sub');
        window.Desktop._placeSubmenu(row);
        assert.equal(row.classList.contains('sub-left'), false,
            'submenu opens right when there is room');
    });

    it('Start-Menu Pin-to-Desktop menu uses the shared factory and is clamped', function() {
        window.StartMenu.showPinMenu(window.innerWidth - 2, window.innerHeight - 2, '/cgi-bin/luci/x', 'X');
        var menu = document.getElementById('pin-menu');
        assert.ok(menu, 'pin menu rendered');
        assert.ok(menu.classList.contains('context-menu'), 'uses the shared .context-menu factory');
        assertInside(menu, 'pin menu @ bottom-right');

        // Same factory instance => opening another menu closes the pin menu.
        window.Desktop._showDesktopMenu(10, 10);
        assert.ok(!document.getElementById('pin-menu'),
            'opening a desktop menu closes the pin menu (single factory)');
    });
});

})();
