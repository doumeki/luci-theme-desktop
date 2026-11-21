/* wallpaper-dir.test.js — Wallpaper storage path row (0.1.0-320)
 *
 * Covers:
 *  - open() renders the storage-path row and fires the dir lookup (GET)
 *  - default mode: dir text + '(default)' marker, no Restore button
 *  - custom mode: Restore default button present, marker absent
 *  - _saveDir POSTs dir=..., reports moved/skipped counts, reloads dir + files
 *  - Change path: input prefilled; same value → reload only, no POST; Cancel restores
 *  - confirm=false blocks the POST; confirm=true posts the new dir
 *  - Restore default asks and posts the stock dir
 *  - zh_cn dict carries the new strings
 *  - toggle-close removes the panel without touching saveDesktopSection
 */
(function() {
'use strict';

var origXHR, origConfirm, xhrs, confirms, confirmAnswer, booted;

function installStubs() {
    origXHR = window.XMLHttpRequest;
    xhrs = [];
    window.XMLHttpRequest = function() {
        var x = this;
        x.open = function(method, url) { x.method = method; x.url = url; };
        x.setRequestHeader = function() {};
        x.send = function(data) { x.body = data; xhrs.push(x); };
    };
    origConfirm = window.confirm;
    confirms = [];
    confirmAnswer = true;
    window.confirm = function(msg) { confirms.push(String(msg)); return confirmAnswer; };
}

function restoreStubs() {
    window.XMLHttpRequest = origXHR;
    window.confirm = origConfirm;
    xhrs = [];
    confirms = [];
    // Toggle-close any panel still open (the second open() never commits).
    try {
        var p = document.getElementById('wallpaper-settings-panel');
        if (p) WallpaperManager.open();
        p = document.getElementById('wallpaper-settings-panel');
        if (p) p.remove();
    } catch(e) {}
}

function setupDOM() {
    var cfg = document.getElementById('desktop-config');
    if (!cfg) {
        cfg = document.createElement('script');
        cfg.id = 'desktop-config';
        cfg.type = 'application/json';
        document.head.appendChild(cfg);
    }
    cfg.textContent = JSON.stringify({
        widgets: {}, pins: [], hidden_icons: [],
        theme: { desktop_wallpaper: 'builtin' },
        wallpaper: { builtin: [], builtin_disabled: [] }
    });
}

function ensureBoot() {
    if (booted) return;
    try { LuCIDesktop.boot(); } catch(e) {}
    booted = true;
}

function findXHR(substr) {
    var out = [];
    xhrs.forEach(function(x) { if (x.url.indexOf(substr) !== -1) out.push(x); });
    return out;
}

function respond(x, json) {
    x.status = 200;
    x.responseText = json;
    x.onload();
    return x;
}

var DIR_JSON_DEFAULT = JSON.stringify({
    dir: '/www/luci-static/desktop/background/',
    custom: false,
    default: '/www/luci-static/desktop/background/'
});
var DIR_JSON_CUSTOM = JSON.stringify({
    dir: '/tmp/luciwp-test',
    custom: true,
    default: '/www/luci-static/desktop/background/'
});
var LIST_JSON = JSON.stringify({
    files: [{ name: 'a.jpg', url: '/luci-static/desktop/background/a.jpg' }]
});

function openAndRespond(custom) {
    WallpaperManager.open();
    respond(findXHR('admin/desktop/wallpaper_dir').pop(), custom ? DIR_JSON_CUSTOM : DIR_JSON_DEFAULT);
    respond(findXHR('list_wallpapers').pop(), LIST_JSON);
    return document.getElementById('wps-dir-row');
}

describe('Wallpaper storage path row (0.1.0-320)', function() {
    beforeEach(function() {
        setupDOM();
        installStubs();
        ensureBoot();
    });
    afterEach(restoreStubs);

    it('open() renders the storage-path row and fires the dir lookup', function() {
        var pnl = (function() { WallpaperManager.open(); return document.getElementById('wallpaper-settings-panel'); })();
        assert.ok(pnl, 'panel rendered');
        var rows = findXHR('admin/desktop/wallpaper_dir');
        assert.equal(rows.length, 1, 'GET wallpaper_dir fired once on open');
        assert.equal(rows[0].method, 'GET', 'dir lookup is a GET');
        respond(rows[0], DIR_JSON_DEFAULT);
        respond(findXHR('list_wallpapers').pop(), LIST_JSON);
        var row = document.getElementById('wps-dir-row');
        assert.ok(row, 'dir row exists');
        assert.contains(row.textContent, '/www/luci-static/desktop/background/', 'shows the dir');
        assert.contains(row.textContent, '(default)', 'flags the default storage');
        assert.ok(document.getElementById('wps-dir-edit'), 'Change path button present');
        assert.ok(!document.getElementById('wps-dir-reset'), 'no Restore default in default mode');
        assert.ok(document.getElementById('wps-dir-status'), 'status line exists');
    });

    it('custom dir shows Restore default and drops the default marker', function() {
        var row = openAndRespond(true);
        assert.ok(row, 'row rendered');
        assert.contains(row.textContent, '/tmp/luciwp-test', 'shows the custom dir');
        assert.notContains(row.textContent, '(default)', 'no default marker in custom mode');
        assert.ok(document.getElementById('wps-dir-reset'), 'Restore default button present');
        assert.ok(document.getElementById('wps-dir-edit'), 'Change path still present');
    });

    it('_saveDir POSTs the dir, reports counts, reloads dir + files', function() {
        openAndRespond(false);
        WallpaperManager._saveDir('/tmp/luciwp-test');
        var posts = findXHR('set_wallpaper_dir');
        assert.equal(posts.length, 1, 'set_wallpaper_dir POST fired');
        assert.equal(posts[0].method, 'POST', 'posts with method POST');
        assert.contains(String(posts[0].body), 'dir=%2Ftmp%2Fluciwp-test', 'dir sent urlencoded');
        respond(posts[0], '{"ok":true,"msg":"Storage path updated","moved":2,"skipped":1,"dir":"/tmp/luciwp-test/","custom":true}');
        var st = document.getElementById('wps-dir-status');
        assert.ok(st, 'status line present');
        assert.contains(st.textContent, 'Moved 2 image(s), skipped 1', 'migration counts rendered via _f');
        assert.contains(st.textContent, 'Storage path updated', 'backend message rendered');
        assert.ok(findXHR('admin/desktop/wallpaper_dir').length >= 2, 'dir row reloaded after save');
        assert.ok(findXHR('list_wallpapers').length >= 2, 'file list reloaded after save');
    });

    it('Change path prefills; same-value save just reloads; Cancel restores the display row', function() {
        openAndRespond(false);
        document.getElementById('wps-dir-edit').click();
        var input = document.getElementById('wps-dir-input');
        assert.ok(input, 'input rendered in edit mode');
        assert.equal(input.value, '/www/luci-static/desktop/background/', 'prefilled with current dir');
        document.getElementById('wps-dir-save').click();
        assert.equal(findXHR('set_wallpaper_dir').length, 0, 'no POST for an unchanged value');
        assert.equal(confirms.length, 0, 'no confirm for an unchanged value');
        respond(findXHR('admin/desktop/wallpaper_dir').pop(), DIR_JSON_DEFAULT);
        assert.ok(document.getElementById('wps-dir'), 'display row re-rendered');
        document.getElementById('wps-dir-edit').click();
        assert.ok(document.getElementById('wps-dir-input'), 'edit mode again');
        document.getElementById('wps-dir-cancel').click();
        respond(findXHR('admin/desktop/wallpaper_dir').pop(), DIR_JSON_DEFAULT);
        assert.ok(!document.getElementById('wps-dir-input'), 'input gone after cancel');
        assert.ok(document.getElementById('wps-dir'), 'display row restored');
    });

    it('confirm=false blocks the path switch; confirm=true posts the new dir', function() {
        openAndRespond(false);
        document.getElementById('wps-dir-edit').click();
        var input = document.getElementById('wps-dir-input');
        input.value = '/opt/wp';
        confirmAnswer = false;
        document.getElementById('wps-dir-save').click(); // confirm refused → reload, no POST
        assert.equal(confirms.length, 1, 'confirm asked once');
        assert.contains(confirms[0], 'Move existing images to the new path?', 'confirm text');
        assert.equal(findXHR('set_wallpaper_dir').length, 0, 'no POST while confirm refuses');
        respond(findXHR('admin/desktop/wallpaper_dir').pop(), DIR_JSON_DEFAULT);
        document.getElementById('wps-dir-edit').click();
        input = document.getElementById('wps-dir-input');
        input.value = '/opt/wp';
        confirmAnswer = true;
        document.getElementById('wps-dir-save').click();
        var posts = findXHR('set_wallpaper_dir');
        assert.equal(posts.length, 1, 'confirm accepts → POST fired');
        assert.contains(String(posts[0].body), 'dir=%2Fopt%2Fwp', 'new dir posted');
    });

    it('Restore default asks and posts the stock dir', function() {
        openAndRespond(true);
        document.getElementById('wps-dir-reset').click();
        var posts = findXHR('set_wallpaper_dir');
        assert.equal(posts.length, 1, 'restore POST fired');
        assert.contains(confirms.join('|'), 'Move images back to the default path?', 'restore confirm text');
        assert.contains(String(posts[0].body), 'dir=%2Fwww%2Fluci-static%2Fdesktop%2Fbackground%2F', 'stock dir posted');
    });

    it('zh_cn dict carries the storage-path strings', function() {
        var zh = window.__I18N && window.__I18N.zh_cn;
        assert.ok(zh, 'zh_cn dict present');
        var pairs = [
            ['Storage path', '存储路径'],
            ['Change path', '更改路径'],
            ['Restore default', '恢复默认'],
            ['(default)', '（默认）'],
            ['Save', '保存'],
            ['Move existing images to the new path?', '将现有图片迁移到新路径？'],
            ['Move images back to the default path?', '将图片迁回默认路径？'],
            ['Moved %d image(s), skipped %d', '已迁移 %d 张图片，跳过 %d 张']
        ];
        for (var i = 0; i < pairs.length; i++) {
            assert.ok(Object.prototype.hasOwnProperty.call(zh, pairs[i][0]), 'has key: ' + pairs[i][0]);
            assert.equal(zh[pairs[i][0]], pairs[i][1], 'zh value for ' + pairs[i][0]);
        }
    });

    it('toggle-close removes the panel without touching saveDesktopSection', function() {
        openAndRespond(false);
        var calls = 0;
        var origSave = LuCIDesktop.saveDesktopSection;
        try {
            LuCIDesktop.saveDesktopSection = function() { calls++; };
            WallpaperManager.open(); // toggle → close
            assert.ok(!document.getElementById('wallpaper-settings-panel'), 'panel removed by the second open()');
            assert.equal(calls, 0, 'commit path untouched');
        } finally {
            LuCIDesktop.saveDesktopSection = origSave;
        }
    });
});
})();
