/* tray.test.js — TrayManager Unit Tests */

(function() {
'use strict';

function setupTrayDOM() {
    var tray = document.getElementById('taskbar-tray');
    if (!tray) {
        tray = document.createElement('div');
        tray.id = 'taskbar-tray';
        var taskbar = document.getElementById('taskbar');
        if (!taskbar) {
            taskbar = document.createElement('div');
            taskbar.id = 'taskbar';
            document.body.appendChild(taskbar);
        }
        taskbar.appendChild(tray);
    }
    // Keep existing clock/show-desktop, just clear tray items
    var items = tray.querySelectorAll('.tray-item');
    items.forEach(function(el) { el.remove(); });

    // Reset state
    TrayManager.items = {};
    TrayManager.registry = {};
}

describe('TrayManager.register(def)', function() {
    beforeEach(setupTrayDOM);

    it('should register a tray item definition', function() {
        TrayManager.register({
            id: 'test-icon',
            icon: '🔒',
            tooltip: 'Test Tooltip'
        });
        assert.ok(TrayManager.registry['test-icon'], 'registered');
        assert.equal(TrayManager.registry['test-icon'].icon, '🔒');
    });

    it('should reject missing id', function() {
        var threw = false;
        try { TrayManager.register({icon: 'X'}); } catch(e) { threw = true; }
        assert.ok(threw, 'should throw on missing id');
    });

    it('should reject duplicate id', function() {
        TrayManager.register({id: 'dup', icon: 'A'});
        var threw = false;
        try { TrayManager.register({id: 'dup', icon: 'B'}); } catch(e) { threw = true; }
        assert.ok(threw, 'should throw on duplicate');
    });

    it('should set order default to 100', function() {
        TrayManager.register({id: 'ord', icon: 'O'});
        assert.equal(TrayManager.registry['ord'].order, 100);
    });
});

describe('TrayManager.enable/disable', function() {
    beforeEach(function() {
        setupTrayDOM();
        TrayManager.register({id: 'en-icon', icon: '🔔', tooltip: 'Alerts'});
    });

    it('should add tray item to DOM when enabled', function() {
        TrayManager.enable('en-icon');
        var el = document.querySelector('.tray-item[data-tray-id="en-icon"]');
        assert.ok(el, 'element in DOM');
        assert.ok(el.querySelector('.tray-item-icon'), 'has icon');
    });

    it('should display icon text', function() {
        TrayManager.enable('en-icon');
        var el = document.querySelector('.tray-item[data-tray-id="en-icon"] .tray-item-icon');
        assert.contains(el.textContent, '🔔', 'icon displayed');
    });

    it('should set tooltip title attribute', function() {
        TrayManager.enable('en-icon');
        var el = document.querySelector('.tray-item[data-tray-id="en-icon"]');
        assert.equal(el.getAttribute('title'), 'Alerts', 'tooltip set');
    });

    it('should call onClick when clicked', function() {
        var clicked = false;
        TrayManager.register({
            id: 'click-test',
            icon: 'X',
            onClick: function() { clicked = true; }
        });
        TrayManager.enable('click-test');
        var el = document.querySelector('.tray-item[data-tray-id="click-test"]');
        el.click();
        assert.ok(clicked, 'onClick called');
    });

    it('should remove from DOM when disabled', function() {
        TrayManager.enable('en-icon');
        TrayManager.disable('en-icon');
        assert.isNull(document.querySelector('.tray-item[data-tray-id="en-icon"]'), 'removed');
    });

    it('should throw if enabling unregistered id', function() {
        var threw = false;
        try { TrayManager.enable('nope'); } catch(e) { threw = true; }
        assert.ok(threw, 'should throw');
    });
});

describe('TrayManager.setIcon/setTooltip/hide/show', function() {
    beforeEach(function() {
        setupTrayDOM();
        TrayManager.register({id: 'mut', icon: 'A', tooltip: 'Before'});
        TrayManager.enable('mut');
    });

    it('should update icon', function() {
        TrayManager.setIcon('mut', 'B');
        var iconEl = document.querySelector('.tray-item[data-tray-id="mut"] .tray-item-icon');
        assert.equal(iconEl.textContent, 'B', 'icon updated');
    });

    it('should update tooltip', function() {
        TrayManager.setTooltip('mut', 'After');
        var el = document.querySelector('.tray-item[data-tray-id="mut"]');
        assert.equal(el.getAttribute('title'), 'After', 'tooltip updated');
    });

    it('should hide item', function() {
        TrayManager.hide('mut');
        var el = document.querySelector('.tray-item[data-tray-id="mut"]');
        assert.equal(el.style.display, 'none', 'hidden');
    });

    it('should show hidden item', function() {
        TrayManager.hide('mut');
        TrayManager.show('mut');
        var el = document.querySelector('.tray-item[data-tray-id="mut"]');
        assert.notEqual(el.style.display, 'none', 'visible');
    });
});

describe('Notification (toast)', function() {
    beforeEach(function() {
        setupTrayDOM();
        var existing = document.querySelectorAll('.desktop-toast');
        existing.forEach(function(t) { t.remove(); });
    });

    it('should show a toast notification', function() {
        TrayManager.notify('Hello World');
        var toast = document.querySelector('.desktop-toast');
        assert.ok(toast, 'toast exists');
        assert.contains(toast.textContent, 'Hello World', 'message shown');
    });

    it('should show a toast', function() {
        TrayManager.notify('Test', {duration: 50});
        var toast = document.querySelector('.desktop-toast');
        assert.ok(toast, 'toast exists immediately');
        assert.contains(toast.textContent, 'Test', 'message shown');
        // Clean up and pass
        if (toast && toast.parentNode) toast.parentNode.removeChild(toast);

    });

    it('should support type: error styling', function() {
        TrayManager.notify('Error!', {type: 'error'});
        var toast = document.querySelector('.desktop-toast');
        assert.ok(toast.classList.contains('toast-error'), 'error class');
    });
});

// ===== Per-notice suppression ("Do not show again" checkbox) =====
// Theme-level notices carry suppressible:true — the toast renders a
// checkbox; checking suppresses THIS notice ONLY (per key, not per
// category). System warnings and feedback toasts never render it.
describe('Per-notice suppression (suppressible)', function() {
    var K1 = 'desktop.toast_suppressed_wp-refresh-failed';
    var K2 = 'desktop.toast_suppressed_wp-picsum-unreachable';
    beforeEach(function() {
        try { localStorage.removeItem(K1); localStorage.removeItem(K2); } catch(e) {}
        document.querySelectorAll('.desktop-toast').forEach(function(t) { t.remove(); });
    });
    afterEach(function() {
        try { localStorage.removeItem(K1); localStorage.removeItem(K2); } catch(e) {}
        document.querySelectorAll('.desktop-toast').forEach(function(t) { t.remove(); });
    });

    it('suppressible toast renders the "Do not show again" checkbox', function() {
        TrayManager.notify('Refresh failed', { key: 'wp-refresh-failed', suppressible: true });
        var cb = document.querySelector('.desktop-toast .toast-sup-cb');
        assert.ok(cb, 'checkbox rendered');
        assert.ok(!cb.checked, 'unchecked by default');
    });

    it('checking the box suppresses THIS notice and closes the toast', function() {
        TrayManager.notify('Refresh failed', { key: 'wp-refresh-failed', suppressible: true });
        var cb = document.querySelector('.desktop-toast .toast-sup-cb');
        cb.checked = true;
        cb.dispatchEvent(new Event('change'));
        assert.equal(localStorage.getItem(K1), '1', 'per-key suppression persisted');
        assert.ok(!document.querySelector('.desktop-toast:not(.toast-hiding)'), 'toast closed on check');
        // 再次 notify（非 force）→ 被抑制不弹（旧的隐藏 toast 不算）
        TrayManager.notify('Refresh failed again', { key: 'wp-refresh-failed', suppressible: true });
        assert.ok(!document.querySelector('.desktop-toast:not(.toast-hiding)'), 'suppressed notice does not re-pop');
    });

    it('suppression is PER NOTICE — another key still pops', function() {
        localStorage.setItem(K1, '1');
        TrayManager.notify('Picsum unreachable', { key: 'wp-picsum-unreachable', suppressible: true });
        var t = document.querySelector('.desktop-toast');
        assert.ok(t, 'unrelated notice still pops');
        assert.contains(t.textContent, 'Picsum unreachable', 'its own message');
    });

    it('force does NOT re-show a suppressed notice (permanent, bell review)', function() {
        localStorage.setItem(K1, '1');
        TrayManager.notify('Refresh failed', { key: 'wp-refresh-failed', suppressible: true, force: true });
        assert.ok(!document.querySelector('.desktop-toast:not(.toast-hiding)'),
            'bell (force) cannot re-show a suppressed notice');
    });

    it('system warnings (no suppressible) never render the checkbox', function() {
        TrayManager.notify('No password set!', { key: 'password', type: 'error' });
        assert.ok(!document.querySelector('.desktop-toast .toast-sup-cb'), 'no checkbox for system warnings');
    });

    it('feedback toasts (duration>0) never render the checkbox', function() {
        TrayManager.notify('Preview ready', { key: 'wp-preview', duration: 4000 });
        assert.ok(!document.querySelector('.desktop-toast .toast-sup-cb'), 'no checkbox for feedback');
    });
});

describe('Keyboard shortcuts', function() {
    it('should register a shortcut', function() {
        var fired = false;
        TrayManager.bindShortcut('Alt+X', function() { fired = true; });
        assert.ok(true, 'registered without error');
    });

    it('should fire callback on matching key combo', function() {
        var fired = false;
        TrayManager.bindShortcut('Escape', function() { fired = true; });

        var evt = new KeyboardEvent('keydown', {key: 'Escape', bubbles: true});
        document.dispatchEvent(evt);

        assert.ok(fired, 'shortcut fired');
    });

    it('should not fire for non-matching key', function() {
        var fired = false;
        TrayManager.bindShortcut('Alt+Z', function() { fired = true; });

        var evt = new KeyboardEvent('keydown', {key: 'Escape', bubbles: true});
        document.dispatchEvent(evt);

        assert.ok(!fired, 'did not fire');
    });

    it('should support unbind', function() {
        var count = 0;
        var id = TrayManager.bindShortcut('F1', function() { count++; });

        document.dispatchEvent(new KeyboardEvent('keydown', {key: 'F1', bubbles: true}));
        assert.equal(count, 1, 'fired once');

        TrayManager.unbindShortcut(id);
        document.dispatchEvent(new KeyboardEvent('keydown', {key: 'F1', bubbles: true}));
        assert.equal(count, 1, 'not fired after unbind');
    });
});

})();
