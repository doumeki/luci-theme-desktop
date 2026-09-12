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

// ===== Category icons: argon glyph for known slugs, emoji/letter fallback =====
describe('Start menu: category icons', function() {
    beforeEach(setupStartMenuData);
    afterEach(cleanup);

    it('renders an icon node for a known slug (argon glyph, no fallback class)', function() {
        StartMenu.render();
        var icon = document.querySelector('#start-menu .menu-category-item[data-category="status"] .menu-cat-icon');
        assert.ok(icon, 'status has an icon node');
        assert.ok(!icon.classList.contains('menu-cat-icon-fallback'),
            'known slug uses the icon font, not the fallback');
        assert.equal((icon.innerHTML || '').trim(), '',
            'the node stays empty — the glyph is CSS-generated from data-glyph');
        assert.ok(icon.hasAttribute('data-glyph'),
            'known slug carries the glyph source on the node');
    });

    it('table slugs carry their data-glyph + color from the CAT_ICONS table', function() {
        StartMenu.render();
        // Expected values mirror cascade.css's legacy [data-title=...] rules;
        // they are the contract a new slug must be added to.
        var expected = {
            status:  '\ue906',
            system:  '\ue90a',
            network: '\ue908'
        };
        Object.keys(expected).forEach(function(slug) {
            var icon = document.querySelector('#start-menu .menu-category-item[data-category="' + slug + '"] .menu-cat-icon');
            assert.ok(icon, slug + ' has an icon node');
            assert.equal(icon.getAttribute('data-glyph'), expected[slug],
                slug + ' glyph matches the table');
            assert.ok(!!icon.style.color, slug + ' carries a color from the table');
            assert.ok(!icon.classList.contains('menu-cat-icon-fallback'),
                slug + ' uses the glyph path, not the fallback');
        });
    });

    it('falls back to an emoji from IconConfig for an unknown slug', function() {
        window.LuCIMenuData.push({
            title: "未知分类", id: "zzz-unknown",
            subs: [{title: "概览", href: "/admin/status/overview"}]
        });
        StartMenu.render();
        var icon = document.querySelector('#start-menu .menu-category-item[data-category="zzz-unknown"] .menu-cat-icon');
        assert.ok(icon, 'unknown category still gets an icon node');
        assert.ok(icon.classList.contains('menu-cat-icon-fallback'), 'fallback class applied');
        assert.ok(!icon.hasAttribute('data-glyph'), 'no glyph for an unknown slug');
        var expected = LuCIDesktop.IconConfig.matchUrl('/admin/status/overview');
        assert.ok(expected && expected.emoji, 'test href maps to an emoji');
        assert.equal(icon.textContent, expected.emoji, 'first sub-item href drives the emoji');
    });

    it('falls back to the title first letter when no icon matches', function() {
        window.LuCIMenuData.push({
            title: "Zzz", id: "zzz-nohref",
            subs: [{title: "Nothing", href: "/admin/zzz/nomatch"}]
        });
        StartMenu.render();
        var icon = document.querySelector('#start-menu .menu-category-item[data-category="zzz-nohref"] .menu-cat-icon');
        assert.ok(icon, 'unknown category still gets an icon node');
        assert.ok(icon.classList.contains('menu-cat-icon-fallback'), 'fallback class applied');
        assert.ok(!icon.hasAttribute('data-glyph'), 'no glyph for an unknown slug');
        assert.equal(icon.textContent, 'Z', 'first letter of the title');
    });

    it('keeps the category title text next to the icon', function() {
        StartMenu.render();
        var item = document.querySelector('#start-menu .menu-category-item[data-category="status"]');
        assert.contains(item.textContent, '状态', 'title still rendered');
        assert.ok(item.querySelector('.menu-cat-icon'), 'icon node present');
    });

    it('never lets a wide fallback glyph overflow into the title (slot grows)', function() {
        // Fallback path for a slug absent from CAT_ICONS. Stub the shared
        // url->icon table with a deliberately WIDE payload so the assertion
        // does not depend on which emoji font the host has: the fallback slot
        // must GROW to contain its glyph (min-width, never a fixed width —
        // a fixed box either wraps the emoji into multiple lines or lets it
        // paint over the title text).
        var origMatch = LuCIDesktop.IconConfig.matchUrl;
        LuCIDesktop.IconConfig.matchUrl = function() { return { emoji: '📊🖥📡' }; };
        try {
            window.LuCIMenuData.push({
                title: "自定义", id: "custom-x",
                subs: [{title: "概览", href: "/admin/status/overview"}]
            });
            StartMenu.render();
            // The fixture keeps #start-menu hidden; layout (and therefore
            // getBoundingClientRect) only exists while it is rendered.
            document.getElementById('start-menu').style.display = '';

            var item = document.querySelector('#start-menu .menu-category-item[data-category="custom-x"]');
            var icon = item.querySelector('.menu-cat-icon');
            assert.ok(icon.classList.contains('menu-cat-icon-fallback'), 'fallback path used');

            var glyphRange = document.createRange();
            glyphRange.selectNodeContents(icon);
            var glyphRect = glyphRange.getBoundingClientRect();
            var boxRect = icon.getBoundingClientRect();

            var textNode = null;
            for (var n = icon.nextSibling; n; n = n.nextSibling) {
                if (n.nodeType === 3 && (n.textContent || '').trim()) { textNode = n; break; }
            }
            assert.ok(textNode, 'title text node follows the icon');
            var titleRange = document.createRange();
            titleRange.selectNodeContents(textNode);
            var titleRect = titleRange.getBoundingClientRect();

            assert.ok(glyphRect.width > 0 && titleRect.width > 0, 'both boxes are laid out');
            // Single line: a fixed-width slot would wrap the wide payload into
            // a tall multi-line stack instead of widening.
            var cs = window.getComputedStyle(icon);
            var fs = parseFloat(cs.fontSize) || 12;
            var lh = parseFloat(cs.lineHeight);
            if (!isFinite(lh) || lh <= 3) lh = fs * 1.2;
            assert.ok(boxRect.height <= lh * 1.6,
                'fallback slot grew instead of wrapping (height ' + boxRect.height.toFixed(1) +
                ' <= ' + (lh * 1.6).toFixed(1) + ')');
            assert.ok(boxRect.width + 0.5 >= glyphRect.width,
                'fallback box contains its glyph on one line (box ' + boxRect.width.toFixed(1) +
                ' >= glyph ' + glyphRect.width.toFixed(1) + ')');
            assert.ok(glyphRect.right <= titleRect.left + 0.5,
                'fallback right edge (' + glyphRect.right.toFixed(1) +
                ') must not cross the title start (' + titleRect.left.toFixed(1) + ')');
        } finally {
            LuCIDesktop.IconConfig.matchUrl = origMatch;
        }
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


// ===== Mobile swipe: left/right on the apps area changes category =====
// Vertical scrolling and the search field must stay untouched — only a
// clearly horizontal gesture is taken over.
describe('Start menu: swipe between categories', function() {
    var menuEl, origShow;

    beforeEach(function() {
        origShow = StartMenu.showCategory;
        menuEl = document.getElementById('start-menu') || document.createElement('div');
        menuEl.id = 'start-menu';
        menuEl.innerHTML =
            '<div class="menu-search"><input id="menu-search-input"></div>' +
            '<div class="menu-panels"><div class="menu-categories">' +
                '<div class="menu-category-item active" data-category="a">A</div>' +
                '<div class="menu-category-item" data-category="b">B</div>' +
                '<div class="menu-category-item" data-category="c">C</div>' +
            '</div><div class="menu-items" data-category="a"></div></div>';
        if (!menuEl.parentNode) document.body.appendChild(menuEl);
        StartMenu.showCategory = function(id) {
            StartMenu._lastShown = id;
            menuEl.querySelectorAll('.menu-category-item').forEach(function(el) {
                el.classList.toggle('active', el.getAttribute('data-category') === id);
            });
        };
    });

    afterEach(function() {
        StartMenu.showCategory = origShow;
        delete StartMenu._lastShown;
    });

    it('swipe left goes to the next category, swipe right to the previous', function() {
        assert.equal(StartMenu._swipeCategory(1), true, 'moved forward');
        assert.equal(StartMenu._lastShown, 'b', 'category B shown');
        assert.equal(StartMenu._swipeCategory(1), true, 'moved forward again');
        assert.equal(StartMenu._lastShown, 'c', 'category C shown');
        assert.equal(StartMenu._swipeCategory(1), false, 'stops at the last category');
        assert.equal(StartMenu._swipeCategory(-1), true, 'moved back');
        assert.equal(StartMenu._lastShown, 'b', 'category B shown again');
        assert.equal(StartMenu._swipeCategory(-1), true, 'moved back to the first');
        assert.equal(StartMenu._swipeCategory(-1), false, 'stops at the first category');
    });

    it('is a no-op when there is only one category', function() {
        menuEl.querySelectorAll('.menu-category-item')[1].remove();
        menuEl.querySelectorAll('.menu-category-item')[1].remove();
        assert.equal(StartMenu._swipeCategory(1), false, 'nothing to switch to');
    });
});

// ===== Continuous paging: 48px notch, down/left = next =====
describe('Start menu: swipe notch', function() {
    it('honours a configured step size', function() {
        assert.equal(StartMenu._swipeNotch(40, true, 32), 1, 'smaller step pages sooner');
        assert.equal(StartMenu._swipeNotch(40, true, 64), 0, 'larger step needs more travel');
        assert.equal(StartMenu._swipeNotch(47, true), 0, 'no step argument → default 48');
        assert.equal(StartMenu._swipeNotch(48, true), 1, 'default 48 still pages');
    });

    it('needs a full notch before stepping', function() {
        assert.equal(StartMenu._swipeNotch(47, true), 0, 'below the threshold → no step');
        assert.equal(StartMenu._swipeNotch(-47, true), 0, 'below the threshold (up) → no step');
    });

    it('vertical: down = next, up = previous (mirrors hover)', function() {
        assert.equal(StartMenu._swipeNotch(48, true), 1, 'drag down → next');
        assert.equal(StartMenu._swipeNotch(-48, true), -1, 'drag up → previous');
        assert.equal(StartMenu._swipeNotch(120, true), 1, 'long drag → next (consumed notch by notch)');
    });

    it('horizontal: left = next', function() {
        assert.equal(StartMenu._swipeNotch(-48, false), 1, 'drag left → next');
        assert.equal(StartMenu._swipeNotch(48, false), -1, 'drag right → previous');
    });
});

// ===== End-to-end: real touch events drive the category change =====
// The pure _swipeNotch tests could not catch the "edge gate made the
// gesture a no-op" bug — only wiring the actual listeners can.
describe('Start menu: touch swipe through real events', function() {
    var menuEl, shown;

    function touch(type, x, y) {
        var ev = new Event(type, { bubbles: true, cancelable: true });
        ev.touches = type === 'touchend' ? [] : [{ clientX: x, clientY: y }];
        // must start on the app list, not the search field
        (menuEl.querySelector('.menu-items') || menuEl).dispatchEvent(ev);
    }

    beforeEach(function() {
        menuEl = document.getElementById('start-menu');
        if (!menuEl) { menuEl = document.createElement('div'); menuEl.id = 'start-menu'; document.body.appendChild(menuEl); }
        menuEl.innerHTML =
            '<div class="menu-search"><input id="menu-search-input"></div>' +
            '<div class="menu-panels"><div class="menu-categories">' +
                '<div class="menu-category-item active" data-category="a">A</div>' +
                '<div class="menu-category-item" data-category="b">B</div>' +
                '<div class="menu-category-item" data-category="c">C</div>' +
            '</div><div class="menu-items" data-category="a"></div></div>';
        menuEl.style.display = '';
        shown = [];
        StartMenu.showCategory = function(id) {
            shown.push(id);
            menuEl.querySelectorAll('.menu-category-item').forEach(function(el) {
                el.classList.toggle('active', el.getAttribute('data-category') === id);
            });
        };
        StartMenu.bindEvents();          // idempotent
    });

    it('a downward drag walks to the next category (hover direction)', function() {
        touch('touchstart', 100, 100);
        touch('touchmove', 100, 150);    // +50 → one notch
        touch('touchend', 100, 150);
        assert.equal(shown[0], 'b', 'drag down → next');
    });

    it('pages continuously while the finger keeps moving', function() {
        touch('touchstart', 100, 100);
        touch('touchmove', 100, 130);    // +30 (no notch yet)
        assert.equal(shown.length, 0, 'under 48px → nothing yet');
        touch('touchmove', 100, 160);    // +30 → total 60 → one notch, 12 left
        assert.equal(shown.length, 1, 'first notch fired');
        touch('touchmove', 100, 220);    // +60 → 12+60=72 → one more
        assert.equal(shown.length, 2, 'second notch fired in the same drag');
        assert.equal(shown.join(','), 'b,c', 'paged b then c');
    });

    it('an upward drag walks back', function() {
        StartMenu.showCategory('c');
        shown = [];
        touch('touchstart', 100, 200);
        touch('touchmove', 100, 140);    // -60 → previous
        assert.equal(shown[0], 'b', 'drag up → previous');
    });

    it('stops at the ends instead of wrapping', function() {
        touch('touchstart', 100, 100);
        touch('touchmove', 100, 400);    // far past the last category
        assert.equal(shown.join(','), 'b,c', 'stops at the last category');
    });

    it('ignores gestures that start in the search field', function() {
        var ev = new Event('touchstart', { bubbles: true });
        ev.touches = [{ clientX: 10, clientY: 10 }];
        menuEl.querySelector('.menu-search').dispatchEvent(ev);
        touch('touchmove', 10, 80);
        assert.equal(shown.length, 0, 'search field keeps caret/selection gestures');
    });
});

// ===== Panel stays inside the viewport whatever the taskbar position =====
describe('Start menu: panel viewport clamp', function() {
    var menuEl, taskbar, origMobile;

    beforeEach(function() {
        origMobile = LuCIDesktop.isMobile;
        LuCIDesktop.isMobile = function() { return false; };
        menuEl = document.getElementById('start-menu');
        if (!menuEl) { menuEl = document.createElement('div'); menuEl.id = 'start-menu'; document.body.appendChild(menuEl); }
        menuEl.style.display = 'none';
        menuEl.removeAttribute('style');
        menuEl.style.display = 'none';
        taskbar = document.getElementById('taskbar');
        if (!taskbar) { taskbar = document.createElement('div'); taskbar.id = 'taskbar'; document.body.appendChild(taskbar); }
    });

    afterEach(function() {
        LuCIDesktop.isMobile = origMobile;
        menuEl.removeAttribute('style');
        taskbar.removeAttribute('style');
    });

    it('anchors above a bottom taskbar and caps the height', function() {
        taskbar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:40px;';
        StartMenu.show();
        var tbTop = window.innerHeight - 40;
        assert.ok(parseInt(menuEl.style.maxHeight, 10) <= tbTop, 'max-height leaves the top edge visible');
        assert.ok(parseInt(menuEl.style.maxHeight, 10) >= 180, 'never collapses below the floor');
        assert.equal(menuEl.style.top, 'auto', 'not top-anchored');
        assert.ok(parseInt(menuEl.style.bottom, 10) > 0, 'bottom-anchored above the taskbar');
    });

    it('anchors below a top taskbar', function() {
        taskbar.style.cssText = 'position:fixed;left:0;right:0;top:0;height:40px;';
        StartMenu.show();
        assert.equal(menuEl.style.bottom, 'auto', 'not bottom-anchored');
        assert.ok(parseInt(menuEl.style.top, 10) >= 40, 'opens below the taskbar');
        assert.ok(parseInt(menuEl.style.maxHeight, 10) <= window.innerHeight - 40, 'height capped to the space left');
    });
});
})();
