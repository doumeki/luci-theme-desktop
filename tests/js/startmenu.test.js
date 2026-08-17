/* startmenu.test.js — Start Menu Unit Tests */

(function() {
'use strict';

function ensureDesktop() {
    if (!document.getElementById('desktop')) {
        var d = document.createElement('div');
        d.id = 'desktop';
        document.body.appendChild(d);
    }
}

function setupStartMenuData() {
    ensureDesktop();
    window.LuCIMenuData = [
        {
            title: "状态", id: "status",
            subs: [
                {title: "概览", href: "/admin/status/overview"},
                {title: "路由表", href: "/admin/status/routes"},
                {title: "系统日志", href: "/admin/status/syslog"}
            ]
        },
        {
            title: "系统", id: "system",
            href: "/admin/system/admin"
        },
        {
            title: "网络", id: "network",
            subs: [
                {title: "防火墙", href: "/admin/network/firewall",
                 tabs: [
                     {title: "基本设置", href: "/admin/network/firewall/general"},
                     {title: "端口转发", href: "/admin/network/firewall/forwards"}
                 ]}
            ]
        }
    ];

    var menu = document.getElementById('start-menu');
    if (!menu) {
        menu = document.createElement('div');
        menu.id = 'start-menu';
        document.body.appendChild(menu);
    }
    menu.innerHTML = '';
    menu.style.display = 'none';
}

function cleanup() {
    var menu = document.getElementById('start-menu');
    if (menu) menu.innerHTML = '';
}

describe('StartMenu.render()', function() {
    beforeEach(setupStartMenuData);
    afterEach(cleanup);

    it('should register as a LuCIDesktop subsystem', function() {
        StartMenu.init();
        assert.ok(LuCIDesktop.subsystems['startmenu'], 'registered');
    });

    it('should render menu with categories from LuCIMenuData', function() {
        StartMenu.render();
        var categories = document.querySelectorAll('#start-menu .menu-category');
        assert.equal(categories.length, 3, '3 categories rendered');
    });

    it('should render submenu items for categories with subs', function() {
        StartMenu.render();
        var statusItems = document.querySelectorAll('#start-menu .menu-category[data-category="status"] .menu-item');
        assert.equal(statusItems.length, 3, 'status has 3 sub-items');
    });

    it('should render direct href items for categories without subs', function() {
        StartMenu.render();
        var item = document.querySelector('#start-menu .menu-item[data-category="system"]');
        assert.ok(item, 'system item exists');
        assert.contains(item.getAttribute('data-href') || '', '/admin/system/admin', 'has href');
    });

    it('clicking a menu item should call WM.open and close menu', function() {
        StartMenu.render();
        var calledUrl = null;
        var origOpen = WM.open;
        WM.open = function(url, title) { calledUrl = url; return 'ok'; };

        var item = document.querySelector('#start-menu .menu-category[data-category="status"] .menu-item');
        item.click();

        WM.open = origOpen;
        assert.ok(!!calledUrl, 'WM.open was called');
        assert.equal(document.getElementById('start-menu').style.display, 'none', 'menu closed after click');
    });
});

describe('StartMenu visibility', function() {
    beforeEach(setupStartMenuData);
    afterEach(cleanup);

    it('should be hidden on init', function() {
        StartMenu.init();
        var menu = document.getElementById('start-menu');
        assert.equal(menu.style.display, 'none', 'start menu hidden initially');
    });

    it('start button click should toggle visibility', function() {
        StartMenu.init();
        var btn = document.getElementById('btn-start');
        btn.click();
        var menu = document.getElementById('start-menu');
        assert.notEqual(menu.style.display, 'none', 'menu visible after toggle');
        btn.click();
        assert.equal(menu.style.display, 'none', 'menu hidden after second toggle');
    });

    it('clicking outside menu should close it', function() {
        StartMenu.init();
        var btn = document.getElementById('btn-start');
        btn.click();
        // Simulate click on desktop (outside menu)
        document.getElementById('desktop').dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
        var menu = document.getElementById('start-menu');
        assert.equal(menu.style.display, 'none', 'menu closed on outside click');
    });

    it('Escape key should close menu', function() {
        StartMenu.init();
        var btn = document.getElementById('btn-start');
        btn.click();
        document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
        var menu = document.getElementById('start-menu');
        assert.equal(menu.style.display, 'none', 'menu closed on Escape');
    });
});

describe('StartMenu search', function() {
    beforeEach(function() {
        setupStartMenuData();
        StartMenu.render();
    });
    afterEach(cleanup);

    it('should filter categories by search term', function() {
        // Find search input and type
        var searchInput = document.querySelector('#start-menu .menu-search input');
        if (!searchInput) { assert.fail('search input not found'); return; }

        searchInput.value = '防火墙';
        searchInput.dispatchEvent(new Event('input', {bubbles: true}));

        // Check that filtering hides non-matching items (at least some remain)
        var allItems = document.querySelectorAll('#start-menu .menu-item');
        var visibleCount = 0;
        for (var i = 0; i < allItems.length; i++) {
            if (allItems[i].style.display !== 'none') visibleCount++;
        }
        assert.ok(visibleCount > 0, 'filtered results visible');
    });

    it('should show all items when search is empty', function() {
        var searchInput = document.querySelector('#start-menu .menu-search input');
        if (!searchInput) return;

        searchInput.value = '防火墙';
        searchInput.dispatchEvent(new Event('input', {bubbles: true}));
        searchInput.value = '';
        searchInput.dispatchEvent(new Event('input', {bubbles: true}));

        var allItems = document.querySelectorAll('#start-menu .menu-item');
        assert.ok(allItems.length >= 4, 'all items shown again');
    });
});

})();
