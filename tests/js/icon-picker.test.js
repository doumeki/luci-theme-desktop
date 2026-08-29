/* icon-picker.test.js — right-click "Change Icon" chooser + persistence
 *
 * Covers:
 *   1. IconPicker.open builds the modal with the full catalog
 *   2. search filters, category tabs filter, option click selects
 *   3. confirm calls onSelect with the chosen id; cancel calls nothing
 *   4. Desktop.openIconPicker persists the choice via saveDesktopSection
 *      (desktop.icon_layout) and re-renders the icon
 *   5. renderShortcuts prefers the user choice over the url mapping
 *   6. context menu "Reset Icon" clears the choice
 */
(function() {
'use strict';

describe('Icon picker: modal behavior', function() {
    var origCfgText;
    beforeEach(function() {
        origCfgText = document.getElementById('desktop-config').textContent;
        document.getElementById('desktop-config').textContent =
            JSON.stringify({ pins: [], hidden_icons: [], icon_layout: {}, theme: {}, theme: {} });
    });
    afterEach(function() {
        document.getElementById('desktop-config').textContent = origCfgText;
        if (window.LuCIDesktop.IconPicker) window.LuCIDesktop.IconPicker.close();
        document.querySelectorAll('.icon-picker-overlay').forEach(function(o) { o.remove(); });
    });

    it('open() builds the modal from the full catalog', function() {
        var picked = null;
        window.LuCIDesktop.IconPicker.open({ url: 'u1', currentId: 'overview', onSelect: function(id) { picked = id; } });
        var overlay = document.querySelector('.icon-picker-overlay');
        assert.ok(overlay && overlay.classList.contains('open'), 'overlay open');
        var opts = overlay.querySelectorAll('.icon-picker-option');
        assert.ok(opts.length > 100, 'full catalog rendered, got ' + opts.length);
        assert.ok(overlay.querySelector('.icon-picker-option.selected'), 'current icon preselected');
        // confirm the pre-selected icon
        overlay.querySelector('.icon-picker-confirm').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        assert.equal(picked, 'overview', 'onSelect fired with current icon');
    });

    it('search filters the grid', function() {
        window.LuCIDesktop.IconPicker.open({ url: 'u1', onSelect: function() {} });
        var input = document.querySelector('.icon-picker-search input');
        input.value = 'firewall';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        var opts = document.querySelectorAll('.icon-picker-option');
        assert.ok(opts.length >= 1 && opts.length < 10, 'filtered results, got ' + opts.length);
        var ids = Array.prototype.map.call(opts, function(o) { return o.dataset.id; });
        assert.ok(ids.indexOf('firewall') !== -1, 'firewall in results');
    });

    it('cancel closes without calling onSelect', function() {
        var picked = 'not-called';
        window.LuCIDesktop.IconPicker.open({ url: 'u1', onSelect: function(id) { picked = id; } });
        document.querySelector('.icon-picker-cancel').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        assert.equal(picked, 'not-called', 'onSelect not called on cancel');
        assert.ok(!document.querySelector('.icon-picker-overlay.open'), 'overlay closed');
    });
});

describe('Icon picker: desktop integration (choice persistence)', function() {
    var origSave, origCfgText;

    beforeEach(function() {
        origSave = window.LuCIDesktop.saveDesktopSection;
        window.LuCIDesktop.saveDesktopSection = function(section, data) {
            window.__saved = window.__saved || [];
            window.__saved.push({ section: section, data: data });
        };
        window.__saved = [];
        origCfgText = document.getElementById('desktop-config').textContent;
        var desktop = document.getElementById('desktop');
        var c = document.getElementById('desktop-icons');
        if (desktop) desktop.style.display = 'block';
        c.style.display = 'block';
        c.style.position = 'absolute';
        c.style.left = '0px';
        c.style.top = '0px';
        c.style.width = '400px';
        c.style.height = '300px';
    });

    afterEach(function() {
        window.LuCIDesktop.saveDesktopSection = origSave;
        document.getElementById('desktop-config').textContent = origCfgText;
        delete window.__saved;
        if (window.Desktop._qicons) { window.Desktop._qicons.destroy(); window.Desktop._qicons = null; }
        if (window.LuCIDesktop.IconPicker) window.LuCIDesktop.IconPicker.close();
        document.querySelectorAll('.icon-picker-overlay').forEach(function(o) { o.remove(); });
        document.getElementById('desktop-icons').innerHTML = '';
        document.getElementById('desktop-icons').style.cssText = '';
        document.getElementById('desktop').style.display = 'none';
    });

    it('choosing an icon persists icon_layout and re-renders the shortcut', function() {
        document.getElementById('desktop-config').textContent = JSON.stringify({
            pins: [{ url: '/cgi-bin/luci/admin/network/socat', title: 'Socat' }],
            hidden_icons: [],
            icon_layout: {}
        });
        window.LuCIMenuData = [{ href: '/cgi-bin/luci/admin/network/socat' }];
        window.Desktop.init();

        // automatic mapping: socat -> socat icon
        var icon = document.querySelector('#desktop-icons .desktop-icon[data-url*="socat"]');
        assert.ok(icon && icon.querySelector('.desktop-icon-emoji'), 'auto icon rendered');

        // open picker via Desktop.openIconPicker, choose 'gost'
        window.Desktop.openIconPicker('/cgi-bin/luci/admin/network/socat');
        var overlay = document.querySelector('.icon-picker-overlay');
        assert.ok(overlay, 'picker opened from desktop');
        var gost = overlay.querySelector('.icon-picker-option[data-id="gost"]');
        assert.ok(gost, 'gost option present (122-icon catalog)');
        gost.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        overlay.querySelector('.icon-picker-confirm').dispatchEvent(new MouseEvent('click', { bubbles: true }));

        // persisted
        var saved = (window.__saved || []).filter(function(s) { return s.section === 'icon_layout'; });
        assert.ok(saved.length >= 1, 'icon_layout saved');
        assert.equal(saved[saved.length - 1].data['/cgi-bin/luci/admin/network/socat'].icon, 'gost', 'choice persisted');

        // re-rendered with the chosen icon
        icon = document.querySelector('#desktop-icons .desktop-icon[data-url*="socat"]');
        var chip = icon && icon.querySelector('.desktop-icon-emoji');
        assert.ok(chip, 'emoji chip present after choice');
        assert.equal(chip.textContent, '⚡', 'gost emoji rendered (user choice wins)');
    });

    it('context menu Reset Icon clears the choice', function() {
        document.getElementById('desktop-config').textContent = JSON.stringify({
            pins: [{ url: '/cgi-bin/luci/admin/network/socat', title: 'Socat' }],
            hidden_icons: [],
            icon_layout: { '/cgi-bin/luci/admin/network/socat': { icon: 'gost' } }
        });
        window.LuCIMenuData = [{ href: '/cgi-bin/luci/admin/network/socat' }];
        window.Desktop.init();

        var icon = document.querySelector('#desktop-icons .desktop-icon[data-url*="socat"]');
        assert.equal(icon.querySelector('.desktop-icon-emoji').textContent, '⚡', 'gost before reset');

        // right-click the icon -> Reset Icon
        icon.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }));
        var menu = document.getElementById('icon-context-menu');
        assert.ok(menu, 'context menu opened');
        var reset = menu.querySelector('.context-item[data-act="reseticon"]');
        assert.ok(reset, 'Reset Icon item present when a choice exists');
        reset.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        icon = document.querySelector('#desktop-icons .desktop-icon[data-url*="socat"]');
        var chip = icon.querySelector('.desktop-icon-emoji');
        assert.equal(chip.textContent, '🔁', 'back to auto mapping (socat)');
        var saved = (window.__saved || []).filter(function(s) { return s.section === 'icon_layout'; });
        assert.equal(saved[saved.length - 1].data['/cgi-bin/luci/admin/network/socat'].icon, undefined, 'choice removed');
    });

    it('legacy icon_positions + icon_choices migrate into one icon_layout', function() {
        // Old installs stored position and choice in separate sections;
        // the first load merges them into icon_layout (position + icon
        // together per url) and persists the merged map.
        document.getElementById('desktop-config').textContent = JSON.stringify({
            pins: [{ url: '/cgi-bin/luci/admin/network/socat', title: 'Socat' }],
            hidden_icons: [],
            icon_positions: { '/cgi-bin/luci/admin/network/socat': { col: 2, row: 1 } },
            icon_choices: { '/cgi-bin/luci/admin/network/socat': 'gost' }
        });
        window.LuCIMenuData = [{ href: '/cgi-bin/luci/admin/network/socat' }];
        window.Desktop.init();

        var icon = document.querySelector('#desktop-icons .desktop-icon[data-url*="socat"]');
        assert.ok(icon, 'icon rendered');
        assert.equal(parseInt(icon.style.left, 10), 16 + 2 * 96, 'migrated col applied');
        assert.equal(parseInt(icon.style.top, 10), 16 + 1 * 90, 'migrated row applied');
        assert.equal(icon.querySelector('.desktop-icon-emoji').textContent, '⚡', 'migrated icon applied');

        var saved = (window.__saved || []).filter(function(s) { return s.section === 'icon_layout'; });
        assert.ok(saved.length >= 1, 'merged layout persisted');
        assert.equal(saved[saved.length - 1].data['/cgi-bin/luci/admin/network/socat'].desktop.col, 2, 'col in layout');
        assert.equal(saved[saved.length - 1].data['/cgi-bin/luci/admin/network/socat'].icon, 'gost', 'icon in layout');
    });

    it('off-grid stored positions are clamped into view (no missing icons)', function() {
        // Stored positions from a LARGER window/reinstall must render
        // inside the current grid — never off-screen ("missing" icons).
        // Container 400x300 -> 4 cols x 3 rows.
        document.getElementById('desktop-config').textContent = JSON.stringify({
            pins: [{ url: '/cgi-bin/luci/admin/network/socat', title: 'Socat' }],
            hidden_icons: [],
            icon_layout: { '/cgi-bin/luci/admin/network/socat': { desktop: { col: 10, row: 5 } } }
        });
        window.LuCIMenuData = [{ href: '/cgi-bin/luci/admin/network/socat' }];
        window.Desktop.init();
        var icon = document.querySelector('#desktop-icons .desktop-icon[data-url*="socat"]');
        assert.ok(icon, 'icon rendered');
        assert.equal(parseInt(icon.style.left, 10), 16 + 3 * 96, 'col clamped to last column');
        assert.equal(parseInt(icon.style.top, 10), 16 + 2 * 90, 'row clamped to last row');
        assert.ok(parseInt(icon.style.left, 10) + 80 <= 400, 'icon stays inside the viewport width');
    });

    it('colliding stored positions do not stack (second icon advances)', function() {
        // Two icons whose stored cells collide (e.g. both clamped from a
        // big window) must never render on top of each other.
        document.getElementById('desktop-config').textContent = JSON.stringify({
            pins: [
                { url: '/cgi-bin/luci/admin/network/socat', title: 'Socat' },
                { url: '/cgi-bin/luci/admin/services/ddns', title: 'DDNS' }
            ],
            hidden_icons: [],
            icon_layout: {
                '/cgi-bin/luci/admin/network/socat': { desktop: { col: 10, row: 5 } },
                '/cgi-bin/luci/admin/services/ddns': { desktop: { col: 10, row: 5 } }
            }
        });
        window.LuCIMenuData = [
            { href: '/cgi-bin/luci/admin/network/socat' },
            { href: '/cgi-bin/luci/admin/services/ddns' }
        ];
        window.Desktop.init();
        var icons = document.querySelectorAll('#desktop-icons .desktop-icon');
        var seen = {};
        icons.forEach(function(el) {
            var key = el.style.left + ',' + el.style.top;
            assert.ok(!seen[key], 'no two icons share a cell: ' + key);
            seen[key] = true;
        });
        // both icons are inside the viewport
        icons.forEach(function(el) {
            assert.ok(parseInt(el.style.left, 10) + 80 <= 400, 'left inside viewport');
            assert.ok(parseInt(el.style.top, 10) + 80 <= 300, 'top inside viewport');
        });
    });
});
})();
