/* quantum-icons.test.js — quantum snap-drag engine + emoji icon rendering
 *
 * Covers:
 *   1. IconConfig url matching (catalog -> emoji + category color)
 *   2. renderShortcuts emoji rendering (matched) / SVG fallback (unmatched)
 *   3. Engine drag: threshold engagement, grid snap, onPositionChange
 *   4. Click/dblclick survival: a press without movement must NOT engage
 *      the drag, and a real drag must suppress the trailing click
 *   5. Persistence: drag saves desktop.icon_layout via
 *      saveDesktopSection; renderShortcuts restores saved positions
 */
(function() {
'use strict';

// Make #desktop-icons measurable (runner keeps it display:none)
function showDesktopIcons(w, h) {
    var desktop = document.getElementById('desktop');
    var c = document.getElementById('desktop-icons');
    if (desktop) desktop.style.display = 'block';
    c.style.display = 'block';
    c.style.position = 'absolute';
    c.style.left = '0px';
    c.style.top = '0px';
    c.style.width = (w || 400) + 'px';
    c.style.height = (h || 300) + 'px';
    return c;
}

function resetDesktopIcons() {
    var c = document.getElementById('desktop-icons');
    c.innerHTML = '';
    c.style.cssText = '';
    document.getElementById('desktop').style.display = 'none';
}

function fire(el, type, opts) {
    var e = new MouseEvent(type, Object.assign({ bubbles: true, cancelable: true }, opts || {}));
    el.dispatchEvent(e);
    return e;
}

// Simulate a full drag gesture on the given icon element.
function dragIcon(icon, fromX, fromY, toX, toY) {
    fire(icon, 'mousedown', { clientX: fromX, clientY: fromY });
    fire(document, 'mousemove', { clientX: toX, clientY: toY });
    fire(document, 'mouseup', { clientX: toX, clientY: toY });
}

describe('Quantum icons: IconConfig catalog', function() {
    it('matches LuCI menu urls to catalog entries', function() {
        var ic = window.LuCIDesktop.IconConfig;
        assert.ok(ic, 'IconConfig exposed on LuCIDesktop');
        var ov = ic.matchUrl('/cgi-bin/luci/admin/status/overview');
        assert.ok(ov && ov.id === 'overview', 'overview matched, got ' + (ov && ov.id));
        assert.equal(ic.emojiForUrl('/cgi-bin/luci/admin/network/firewall'), '🛡️', 'firewall emoji');
        assert.ok(ic.colorForUrl('/cgi-bin/luci/admin/network/firewall'), 'category color present');
    });

    it('remaps the REAL menu tree (58 urls dumped from 1.1/253)', function() {
        // Real menu hrefs captured on 192.168.1.1 and 192.168.2.253
        // (identical on both) — 2026-08-29.
        var ic = window.LuCIDesktop.IconConfig;
        var menu = [
            '/cgi-bin/luci/admin/control/appfilter',
            '/cgi-bin/luci/admin/control/mia',
            '/cgi-bin/luci/admin/control/timewol',
            '/cgi-bin/luci/admin/nas/aria2',
            '/cgi-bin/luci/admin/nas/cifs',
            '/cgi-bin/luci/admin/nas/cifsd',
            '/cgi-bin/luci/admin/nas/fileassistant',
            '/cgi-bin/luci/admin/nas/hd_idle',
            '/cgi-bin/luci/admin/nas/minidlna',
            '/cgi-bin/luci/admin/nas/nfs',
            '/cgi-bin/luci/admin/nas/vsftpd',
            '/cgi-bin/luci/admin/network/arpbind',
            '/cgi-bin/luci/admin/network/dhcp',
            '/cgi-bin/luci/admin/network/diagnostics',
            '/cgi-bin/luci/admin/network/firewall',
            '/cgi-bin/luci/admin/network/hosts',
            '/cgi-bin/luci/admin/network/network',
            '/cgi-bin/luci/admin/network/routes',
            '/cgi-bin/luci/admin/network/socat',
            '/cgi-bin/luci/admin/nlbw/backup',
            '/cgi-bin/luci/admin/nlbw/config',
            '/cgi-bin/luci/admin/nlbw/display',
            '/cgi-bin/luci/admin/nlbw/netdata',
            '/cgi-bin/luci/admin/nlbw/realtime',
            '/cgi-bin/luci/admin/nlbw/tcpdump',
            '/cgi-bin/luci/admin/nlbw/usage',
            '/cgi-bin/luci/admin/services/AdGuardHome',
            '/cgi-bin/luci/admin/services/ddns',
            '/cgi-bin/luci/admin/services/passwall2',
            '/cgi-bin/luci/admin/services/shadowsocksr',
            '/cgi-bin/luci/admin/services/unblockneteasemusic',
            '/cgi-bin/luci/admin/services/upnp',
            '/cgi-bin/luci/admin/services/vlmcsd',
            '/cgi-bin/luci/admin/services/wol',
            '/cgi-bin/luci/admin/status/dmesg',
            '/cgi-bin/luci/admin/status/iptables',
            '/cgi-bin/luci/admin/status/overview',
            '/cgi-bin/luci/admin/status/processes',
            '/cgi-bin/luci/admin/status/routes',
            '/cgi-bin/luci/admin/status/syslog',
            '/cgi-bin/luci/admin/status/wireguard',
            '/cgi-bin/luci/admin/system/admin',
            '/cgi-bin/luci/admin/system/advancedsetting',
            '/cgi-bin/luci/admin/system/argon-config',
            '/cgi-bin/luci/admin/system/crontab',
            '/cgi-bin/luci/admin/system/diskman',
            '/cgi-bin/luci/admin/system/filetransfer',
            '/cgi-bin/luci/admin/system/flashops',
            '/cgi-bin/luci/admin/system/fstab',
            '/cgi-bin/luci/admin/system/packages',
            '/cgi-bin/luci/admin/system/reboot',
            '/cgi-bin/luci/admin/system/startup',
            '/cgi-bin/luci/admin/system/system',
            '/cgi-bin/luci/admin/system/terminal',
            '/cgi-bin/luci/admin/vpn/ipsec-server',
            '/cgi-bin/luci/admin/vpn/ocserv',
            '/cgi-bin/luci/admin/vpn/zerotier'
        ];
        var mapped = 0, unmapped = [];
        menu.forEach(function(url) {
            if (ic.matchUrl(url)) mapped++;
            else unmapped.push(url.replace('/cgi-bin/luci/admin/', ''));
        });
        assert.ok(mapped >= 50, 'coverage ' + mapped + '/58, unmapped: ' + unmapped.join(', '));

        // spot-check the remapped entries
        assert.equal(ic.matchUrl('/cgi-bin/luci/admin/network/socat').id, 'socat', 'socat');
        assert.equal(ic.matchUrl('/cgi-bin/luci/admin/services/AdGuardHome').id, 'adguard', 'AdGuardHome (case)');
        assert.equal(ic.matchUrl('/cgi-bin/luci/admin/services/vlmcsd').id, 'kms', 'vlmcsd -> kms');
        assert.equal(ic.matchUrl('/cgi-bin/luci/admin/nas/cifsd').id, 'samba', 'cifsd -> samba (longer first)');
        assert.equal(ic.matchUrl('/cgi-bin/luci/admin/nas/cifs').id, 'smb', 'cifs -> smb');
        assert.equal(ic.matchUrl('/cgi-bin/luci/admin/system/diskman').id, 'disk', 'diskman -> disk');
        assert.equal(ic.matchUrl('/cgi-bin/luci/admin/status/iptables').id, 'firewall_log', 'iptables -> firewall_log');
        assert.equal(ic.matchUrl('/cgi-bin/luci/admin/nlbw/tcpdump').id, 'sniffer', 'tcpdump -> sniffer');
        assert.equal(ic.matchUrl('/cgi-bin/luci/admin/vpn/ocserv').id, 'ocserv', 'ocserv');
    });

    it('returns null for unmatched urls', function() {
        var ic = window.LuCIDesktop.IconConfig;
        assert.isNull(ic.matchUrl('/cgi-bin/luci/admin/weird/page'), 'unmatched url -> null');
    });

    it('every icon id referenced by icon-url-map.js exists in the catalog', function() {
        // Safety net for editing the mapping file: a typo'd icon id would
        // silently degrade to the first-letter SVG on the desktop.
        var ids = {};
        window.LuCIDesktop.IconConfig.icons.forEach(function(ic) { ids[ic.id] = true; });
        var missing = [];
        var badLines = [];
        (window.__ICON_URL_MAP_TEXT__ || '').split('\n').forEach(function(line) {
            line = line.trim();
            if (!line || line.charAt(0) === '#') return;
            var i = line.indexOf(':');
            if (i <= 0) { badLines.push(line); return; }
            var id = line.slice(i + 1);
            if (!ids[id]) missing.push(line);
        });
        assert.equal(badLines.length, 0, 'malformed map lines: ' + badLines.join('; '));
        assert.equal(missing.length, 0, 'mapped ids missing from catalog: ' + missing.join('; '));
    });
});

describe('Quantum icons: emoji rendering in renderShortcuts', function() {
    var origCfgText;
    beforeEach(function() {
        window.LuCIMenuData = [{ href: '/cgi-bin/luci/admin/status/overview' }];
        origCfgText = document.getElementById('desktop-config').textContent;
        showDesktopIcons();
    });
    afterEach(function() {
        delete window.LuCIMenuData;
        document.getElementById('desktop-config').textContent = origCfgText;
        if (window.Desktop._qicons) { window.Desktop._qicons.destroy(); window.Desktop._qicons = null; }
        resetDesktopIcons();
    });

    it('matched shortcut renders emoji chip (no svg text)', function() {
        window.Desktop.renderShortcuts();
        var icon = document.querySelector('#desktop-icons .desktop-icon[data-url*="status/overview"]');
        assert.ok(icon, 'overview icon rendered');
        var chip = icon.querySelector('.desktop-icon-emoji');
        assert.ok(chip, 'emoji chip present');
        assert.ok(!icon.querySelector('svg'), 'no legacy svg for matched icon');
    });

    it('unmatched shortcut keeps the svg first-letter fallback', function() {
        // A pinned item with a url outside the catalog; init() reloads the
        // injected config so the pin actually reaches renderShortcuts. The
        // menu tree must contain the url or cleanGhostApps removes it.
        window.LuCIMenuData = [
            { href: '/cgi-bin/luci/admin/status/overview' },
            { href: '/cgi-bin/luci/admin/zzz/custom' }
        ];
        var cfg = document.getElementById('desktop-config');
        cfg.textContent = JSON.stringify({ pins: [{ url: '/cgi-bin/luci/admin/zzz/custom', title: 'Custom' }], icon_layout: {} });
        window.Desktop.init();
        var icon = document.querySelector('#desktop-icons .desktop-icon[data-url*="zzz/custom"]');
        assert.ok(icon, 'custom icon rendered');
        assert.ok(icon.querySelector('svg'), 'svg fallback kept for unmatched url');
        assert.ok(!icon.querySelector('.desktop-icon-emoji'), 'no emoji chip for unmatched url');
    });
});

describe('Quantum icons: drag engine', function() {
    var q, calls, origSave;

    function makeEngine() {
        calls = [];
        q = new window.LuCIDesktop.QuantumIcons({
            containerSelector: '#desktop-icons',
            gridW: 96,
            gridH: 90,
            marginLeft: 16,
            marginTop: 16,
            onPositionChange: function(icon, col, row) {
                calls.push({ col: col, row: row, url: icon.getAttribute('data-url') });
            }
        });
        return q;
    }

    beforeEach(function() {
        showDesktopIcons(400, 300);
        var c = document.getElementById('desktop-icons');
        c.innerHTML =
            '<div class="desktop-icon" data-url="/cgi-bin/luci/admin/status/overview" ' +
            'style="left:16px;top:16px"><div class="desktop-icon-label">Status</div></div>';
        origSave = window.LuCIDesktop.saveDesktopSection;
        window.LuCIDesktop.saveDesktopSection = function(section, data) {
            window.__saved = window.__saved || [];
            window.__saved.push({ section: section, data: data });
        };
    });

    afterEach(function() {
        if (q) { q.destroy(); q = null; }
        window.LuCIDesktop.saveDesktopSection = origSave;
        delete window.__saved;
        resetDesktopIcons();
    });

    it('engine never overrides the container position (inset:0 sizing kept)', function() {
        // Regression (0.1.0-180): init() rewrote an already-positioned
        // container to position:relative, collapsing #desktop-icons from
        // the full desktop (inset:0) to content height (32px) -> grid had
        // 1 row, only horizontal drag worked, and the align pass clamped
        // every icon to row 0 and persisted it.
        showDesktopIcons(400, 300);   // sets inline position:absolute
        document.getElementById('desktop-icons').innerHTML =
            '<div class="desktop-icon" data-url="/cgi-bin/luci/admin/status/overview" ' +
            'style="left:16px;top:16px"><div class="desktop-icon-label">Status</div></div>';
        q = makeEngine();
        assert.equal(document.getElementById('desktop-icons').style.position, 'absolute',
            'container position untouched by engine');
        assert.ok(q.gridRows > 1, 'grid has more than one row (300px / 90px)');
    });

    it('drag beyond threshold snaps to grid and fires onPositionChange', function() {        makeEngine();
        var icon = document.querySelector('#desktop-icons .desktop-icon');
        // Press at icon (30,30), move to (200,150) — well beyond threshold
        dragIcon(icon, 30, 30, 200, 150);
        assert.equal(calls.length, 1, 'onPositionChange fired once');
        assert.ok(calls[0].col >= 0 && calls[0].row >= 0, 'grid cell indices');
        // Icon position follows the grid (margin + col*gridW)
        var expectLeft = 16 + calls[0].col * 96;
        var expectTop = 16 + calls[0].row * 90;
        assert.equal(parseInt(icon.style.left, 10), expectLeft, 'left snapped to grid');
        assert.equal(parseInt(icon.style.top, 10), expectTop, 'top snapped to grid');
        assert.equal(icon.dataset.col, String(calls[0].col), 'dataset.col updated');
    });

    it('press without movement does NOT engage the drag', function() {
        makeEngine();
        var icon = document.querySelector('#desktop-icons .desktop-icon');
        // Sub-threshold wiggle then release
        fire(icon, 'mousedown', { clientX: 30, clientY: 30 });
        fire(document, 'mousemove', { clientX: 32, clientY: 31 });
        fire(document, 'mouseup', { clientX: 32, clientY: 31 });
        assert.equal(calls.length, 0, 'no onPositionChange for plain press');
        assert.ok(!icon.classList.contains('q-dragging'), 'icon not marked dragging');
    });

    it('dropping on an occupied cell swaps the two icons', function() {
        showDesktopIcons(400, 300);
        document.getElementById('desktop-icons').innerHTML =
            '<div class="desktop-icon" data-url="/a" style="left:16px;top:16px"><div class="desktop-icon-label">A</div></div>' +
            '<div class="desktop-icon" data-url="/b" style="left:112px;top:16px"><div class="desktop-icon-label">B</div></div>';
        q = makeEngine();
        var iconA = document.querySelector('.desktop-icon[data-url="/a"]');
        var iconB = document.querySelector('.desktop-icon[data-url="/b"]');
        // A at (0,0), B at (1,0). Drag A onto B's cell (1,0).
        dragIcon(iconA, 30, 30, 130, 30);
        assert.equal(iconA.dataset.col, '1', 'A moved to (1,0)');
        assert.equal(iconA.dataset.row, '0', 'A row 0');
        assert.equal(iconB.dataset.col, '0', 'B swapped to (0,0)');
        assert.equal(iconB.dataset.row, '0', 'B row 0');
        assert.equal(parseInt(iconB.style.left, 10), 16, 'B left back at origin');
        assert.equal(parseInt(iconB.style.top, 10), 16, 'B top back at origin');
        // both positions reported (occupant first, then the dragged icon)
        assert.equal(calls.length, 2, 'two onPositionChange calls (swap + drop)');
        assert.equal(calls[0].url, '/b', 'occupant reported first');
        assert.equal(calls[0].col, 0, 'occupant new col');
        assert.equal(calls[1].url, '/a', 'dragged icon reported second');
        assert.equal(calls[1].col, 1, 'dragged icon new col');
        // animated swap: the displaced icon carries a transient transition
        // (left/top glide) that is cleared shortly after
        assert.ok(iconB.style.transition.indexOf('left') !== -1, 'occupant transition active for the glide');
        assert.ok(iconB.style.transition.indexOf('cubic-bezier') !== -1, 'quantum bounce easing');
    });

    it('drag suppresses the trailing click on the container', function() {
        makeEngine();
        var container = document.getElementById('desktop-icons');
        var icon = document.querySelector('#desktop-icons .desktop-icon');
        var clicks = 0;
        container.addEventListener('click', function() { clicks++; });
        dragIcon(icon, 30, 30, 200, 150);
        fire(icon, 'click');
        assert.equal(clicks, 0, 'click after drag suppressed');
    });

    it('plain click still reaches the container (select works)', function() {
        makeEngine();
        var container = document.getElementById('desktop-icons');
        var icon = document.querySelector('#desktop-icons .desktop-icon');
        var clicks = 0;
        container.addEventListener('click', function() { clicks++; });
        fire(icon, 'mousedown', { clientX: 30, clientY: 30 });
        fire(document, 'mouseup', { clientX: 30, clientY: 30 });
        fire(icon, 'click');
        assert.equal(clicks, 1, 'plain click reaches container');
    });
});

describe('Quantum icons: persistence + restore (UCI)', function() {
    var origSave, origCfgText;

    beforeEach(function() {
        origSave = window.LuCIDesktop.saveDesktopSection;
        window.LuCIDesktop.saveDesktopSection = function(section, data) {
            window.__saved = window.__saved || [];
            window.__saved.push({ section: section, data: data });
        };
        window.__saved = [];
        origCfgText = document.getElementById('desktop-config').textContent;
        showDesktopIcons(400, 300);
    });

    afterEach(function() {
        window.LuCIDesktop.saveDesktopSection = origSave;
        document.getElementById('desktop-config').textContent = origCfgText;
        delete window.__saved;
        // tear down the engine Desktop.init created
        if (window.Desktop._qicons) { window.Desktop._qicons.destroy(); window.Desktop._qicons = null; }
        resetDesktopIcons();
    });

    it('drag from Desktop.init persists icon_layout via UCI save', function() {
        var cfg = document.getElementById('desktop-config');
        cfg.textContent = JSON.stringify({ pins: [], hidden_icons: [], icon_layout: {} });
        window.Desktop.init();
        var icon = document.querySelector('#desktop-icons .desktop-icon[data-url*="status/overview"]');
        assert.ok(icon, 'icon rendered by init');
        dragIcon(icon, 30, 30, 220, 180);
        var saved = (window.__saved || []).filter(function(s) { return s.section === 'icon_layout'; });
        assert.equal(saved.length, 1, 'icon_layout saved exactly once per drag');
        var url = icon.getAttribute('data-url');
        assert.ok(saved[0].data[url], 'saved map contains the dragged url');
        assert.ok(typeof saved[0].data[url].desktop.col === 'number', 'col persisted');
        assert.ok(typeof saved[0].data[url].desktop.row === 'number', 'row persisted');
    });

    it('renderShortcuts restores saved positions', function() {
        var savedCol = 2, savedRow = 1;
        var cfg = document.getElementById('desktop-config');
        cfg.textContent = JSON.stringify({
            pins: [],
            hidden_icons: [],
            icon_layout: {
                '/cgi-bin/luci/admin/status/overview': { col: savedCol, row: savedRow }
            }
        });
        window.Desktop.init();
        var icon = document.querySelector('#desktop-icons .desktop-icon[data-url*="status/overview"]');
        assert.ok(icon, 'icon rendered');
        assert.equal(parseInt(icon.style.left, 10), 16 + savedCol * 96, 'left restored from UCI');
        assert.equal(parseInt(icon.style.top, 10), 16 + savedRow * 90, 'top restored from UCI');
    });

    it('rearrangeIcons clears positions and reflows 4 columns from [0,0]', function() {        // Pre-existing drag positions for two defaults
        var cfg = document.getElementById('desktop-config');
        cfg.textContent = JSON.stringify({
            pins: [{ url: '/cgi-bin/luci/admin/zzz/pinned', title: 'Pinned' }],
            hidden_icons: [],
            icon_layout: {
                '/cgi-bin/luci/admin/status/overview': { col: 3, row: 2 },
                '/cgi-bin/luci/admin/zzz/pinned': { col: 0, row: 3 }
            }
        });
        window.LuCIMenuData = [
            { href: '/cgi-bin/luci/admin/status/overview' },
            { href: '/cgi-bin/luci/admin/zzz/pinned' }
        ];
        window.Desktop.init();
        // sanity: stored positions were honored before rearrange
        var ov = document.querySelector('#desktop-icons .desktop-icon[data-url*="status/overview"]');
        assert.equal(parseInt(ov.style.left, 10), 16 + 3 * 96, 'pre-rearrange left (stored)');

        window.Desktop.rearrangeIcons();

        // layout persisted as cleared
        var saved = (window.__saved || []).filter(function(s) { return s.section === 'icon_layout'; });
        var last = saved[saved.length - 1];
        assert.ok(last, 'icon_layout saved after rearrange');
        assert.equal(Object.keys(last.data).length, 0, 'layout map cleared (no stored cells)');

        // icons reflowed in DOM order: 4 columns, top-to-bottom
        var icons = document.querySelectorAll('#desktop-icons .desktop-icon');
        assert.ok(icons.length >= 5, 'defaults + pinned rendered');
        var expect = [
            [0, 0], [1, 0], [2, 0], [3, 0],   // row 0
            [0, 1], [1, 1], [2, 1], [3, 1]    // row 1
        ];
        icons.forEach(function(el, i) {
            var col = expect[i][0], row = expect[i][1];
            assert.equal(parseInt(el.style.left, 10), 16 + col * 96, 'icon ' + i + ' left');
            assert.equal(parseInt(el.style.top, 10), 16 + row * 90, 'icon ' + i + ' top');
        });
    });

    it('icon stored off-grid is clamped into view at render time', function() {
        // Container 400x300 -> 4 cols x 3 rows. A stored position far
        // outside (e.g. saved while the window was much larger) must
        // render inside the visible grid — renderShortcuts clamps it, so
        // it never needs the engine's post-render pull-back (or a UCI
        // write) to become visible.
        var cfg = document.getElementById('desktop-config');
        cfg.textContent = JSON.stringify({
            pins: [],
            hidden_icons: [],
            icon_layout: {
                '/cgi-bin/luci/admin/status/overview': { col: 10, row: 5 }
            }
        });
        window.Desktop.init();
        var icon = document.querySelector('#desktop-icons .desktop-icon[data-url*="status/overview"]');
        assert.ok(icon, 'icon rendered');
        assert.equal(parseInt(icon.style.left, 10), 16 + 3 * 96, 'left clamped into grid');
        assert.equal(parseInt(icon.style.top, 10), 16 + 2 * 90, 'top clamped into grid');
        // render-time clamping is purely visual: no UCI write needed, the
        // clamp is stable across reloads
        var saved = (window.__saved || []).filter(function(s) { return s.section === 'icon_layout'; });
        assert.equal(saved.length, 0, 'no layout save during render clamp');
    });

    it('desktop context menu Rearrange Icons click actually rearranges', function() {
        // Regression (0.1.0-177): _showDesktopMenu referenced an undefined
        // `self` (window.self) — clicking Rearrange Icons threw
        // "self.rearrangeIcons is not a function" on devices. This walks
        // the REAL menu path: contextmenu -> click menu item.
        var cfg = document.getElementById('desktop-config');
        cfg.textContent = JSON.stringify({
            pins: [],
            hidden_icons: [],
            icon_layout: {
                '/cgi-bin/luci/admin/status/overview': { col: 2, row: 2 }
            }
        });
        window.Desktop.init();
        var ov = document.querySelector('#desktop-icons .desktop-icon[data-url*="status/overview"]');
        assert.equal(parseInt(ov.style.left, 10), 16 + 2 * 96, 'stored position before menu action');

        // right-click the desktop surface
        var desktopEl = document.getElementById('desktop');
        desktopEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 200 }));
        var menu = document.getElementById('desktop-context-menu');
        assert.ok(menu, 'desktop context menu opened');
        var item = menu.querySelector('.context-item[data-act="rearrange"]');
        assert.ok(item, 'Rearrange Icons item present');
        assert.ok(item.textContent.indexOf('重排') !== -1 || item.textContent.indexOf('Rearrange') !== -1, 'item labeled');
        item.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        // icon back at [0,0] (re-query: renderShortcuts replaced the DOM)
        ov = document.querySelector('#desktop-icons .desktop-icon[data-url*="status/overview"]');
        assert.ok(ov, 'icon re-rendered');
        assert.equal(parseInt(ov.style.left, 10), 16, 'icon left reset to [0,0]');
        assert.equal(parseInt(ov.style.top, 10), 16, 'icon top reset to [0,0]');
        var saved = (window.__saved || []).filter(function(s) { return s.section === 'icon_layout'; });
        assert.equal(Object.keys(saved[saved.length - 1].data).length, 0, 'positions cleared via menu');
    });
});

describe('Mobile long-press icon menu (Change Icon entry)', function() {
    var origMobile, origOpen, origCfgText;

    beforeEach(function() {
        origMobile = window.LuCIDesktop.isMobile;
        window.LuCIDesktop.isMobile = function() { return true; };
        origOpen = window.WM.open;
        window.WM.open = function() {};
        origCfgText = document.getElementById('desktop-config').textContent;
        document.getElementById('desktop-config').textContent =
            JSON.stringify({ pins: [], hidden_icons: [], icon_layout: {}, theme: {} });
        showDesktopIcons(400, 300);
        window.Desktop.init();
    });

    afterEach(function() {
        window.LuCIDesktop.isMobile = origMobile;
        window.WM.open = origOpen;
        document.getElementById('desktop-config').textContent = origCfgText;
        document.querySelectorAll('#desktop-context-menu, #icon-context-menu').forEach(function(m) { m.remove(); });
        if (window.Desktop._qicons) { window.Desktop._qicons.destroy(); window.Desktop._qicons = null; }
        resetDesktopIcons();
    });

    function touch(type, el, x, y) {
        // headless firefox has no Touch/TouchEvent constructors — use a
        // plain Event with a fake TouchList (handlers only read clientX/Y)
        var ev = new Event(type, { bubbles: true, cancelable: true });
        var t = { clientX: x, clientY: y };
        Object.defineProperty(ev, 'touches', { value: [t] });
        Object.defineProperty(ev, 'targetTouches', { value: [t] });
        el.dispatchEvent(ev);
    }

    it('long-press opens the icon menu; the following tap does NOT open the app', function() {
        return new Promise(function(resolve, reject) {
            var opened = 0;
            window.WM.open = function() { opened++; };
            var icon = document.querySelector('#desktop-icons .desktop-icon');
            assert.ok(icon, 'icon rendered on mobile');
            touch('touchstart', icon, 30, 30);
            setTimeout(function() {
                try {
                    var menu = document.getElementById('icon-context-menu');
                    assert.ok(menu, 'context menu opened by long-press');
                    var change = menu.querySelector('.context-item[data-act="changeicon"]');
                    assert.ok(change, 'Change Icon entry present on mobile');
                    // the tap that follows the long-press must not open the app
                    icon.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                    assert.equal(opened, 0, 'tap after long-press suppressed');
                    resolve();
                } catch (e) { reject(e); }
            }, 650);
        });
    });

    it('a quick tap still opens the app (no long-press)', function() {
        var opened = 0;
        window.WM.open = function() { opened++; };
        var icon = document.querySelector('#desktop-icons .desktop-icon');
        touch('touchstart', icon, 30, 30);
        touch('touchend', icon, 30, 30);
        icon.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        assert.equal(opened, 1, 'tap opens the app');
    });
});
})();
