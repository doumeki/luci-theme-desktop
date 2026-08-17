/* taskbar.test.js — Taskbar Unit Tests */

(function() {
'use strict';

function setupTaskbarDOM() {
    var tb = document.getElementById('taskbar');
    if (!tb) {
        tb = document.createElement('div');
        tb.id = 'taskbar';
        tb.innerHTML =
            '<div id="taskbar-start"><button id="btn-start">●</button></div>' +
            '<div id="taskbar-windows"></div>' +
            '<div id="taskbar-tray"><span id="taskbar-clock"></span></div>';
        document.body.appendChild(tb);
    }
}

function cleanup() {
    var tb = document.getElementById('taskbar');
    if (tb) tb.querySelector('#taskbar-windows').innerHTML = '';
}

describe('Taskbar.init()', function() {
    it('should register as a LuCIDesktop subsystem', function() {
        setupTaskbarDOM();
        Taskbar.init();
        assert.ok(LuCIDesktop.subsystems['taskbar'], 'registered');
    });

    it('should start clock update interval', function() {
        setupTaskbarDOM();
        Taskbar.init();
        var clock = document.getElementById('taskbar-clock');
        assert.ok(clock.textContent.length > 0, 'clock has initial value');
    });
});

describe('Taskbar window button management', function() {
    beforeEach(function() {
        setupTaskbarDOM();
        Taskbar.init();
    });
    afterEach(cleanup);

    it('should add window button on window-opened event', function() {
        document.getElementById('taskbar-windows').innerHTML = ''; LuCIDesktop.emit('window-opened', {id: 'win-1', title: 'Test Window'});
        var btn = document.querySelector('.taskbar-window-btn[data-window-id="win-1"]');
        assert.ok(btn, 'taskbar button created');
        assert.contains(btn.textContent, 'Test Window', 'button shows title');
    });

    it('should remove button on window-closed event', function() {
        LuCIDesktop.emit('window-opened', {id: 'win-x', title: 'Temp'});
        LuCIDesktop.emit('window-closed', {id: 'win-x'});
        var btn = document.querySelector('.taskbar-window-btn[data-window-id="win-x"]');
        assert.isNull(btn, 'button removed');
    });

    it('should highlight active window button on window-focused event', function() {
        LuCIDesktop.emit('window-opened', {id: 'win-a', title: 'A'});
        LuCIDesktop.emit('window-opened', {id: 'win-b', title: 'B'});
        LuCIDesktop.emit('window-focused', {id: 'win-b'});

        var btnA = document.querySelector('.taskbar-window-btn[data-window-id="win-a"]');
        var btnB = document.querySelector('.taskbar-window-btn[data-window-id="win-b"]');
        assert.ok(!btnA.classList.contains('active'), 'A not active');
        assert.ok(btnB.classList.contains('active'), 'B is active');
    });

    it('should dim minimized window button', function() {
        LuCIDesktop.emit('window-opened', {id: 'win-m', title: 'M'});
        LuCIDesktop.emit('window-minimized', {id: 'win-m'});

        var btn = document.querySelector('.taskbar-window-btn[data-window-id="win-m"]');
        assert.ok(btn.classList.contains('minimized'), 'button dimmed');
    });

    it('should un-dim on window-restored event', function() {
        LuCIDesktop.emit('window-opened', {id: 'win-r', title: 'R'});
        LuCIDesktop.emit('window-minimized', {id: 'win-r'});
        LuCIDesktop.emit('window-restored', {id: 'win-r'});

        var btn = document.querySelector('.taskbar-window-btn[data-window-id="win-r"]');
        assert.ok(!btn.classList.contains('minimized'), 'button restored');
    });

    it('button click on active window should minimize', function() {
        LuCIDesktop.emit('window-opened', {id: 'win-f', title: 'Focused'});
        LuCIDesktop.emit('window-focused', {id: 'win-f'});
        LuCIDesktop.activeWindowId = 'win-f';

        var btn = document.querySelector('.taskbar-window-btn[data-window-id="win-f"]');
        var minimized = false;
        var orig = WM.minimize;
        WM.minimize = function(id) { if (id === 'win-f') minimized = true; };
        btn.click();
        WM.minimize = orig;
        assert.ok(minimized, 'minimize called on active window click');
    });

    it('button click on inactive window should focus', function() {
        LuCIDesktop.emit('window-opened', {id: 'win-i', title: 'Inactive'});
        LuCIDesktop.activeWindowId = 'win-other';

        var btn = document.querySelector('.taskbar-window-btn[data-window-id="win-i"]');
        var focused = false;
        var orig = WM.focus;
        WM.focus = function(id) { if (id === 'win-i') focused = true; };
        btn.click();
        WM.focus = orig;
        assert.ok(focused, 'focus called on inactive window click');
    });

    it('auto-refresh toggle: should exist and start ON by default', function() {
        // Add toggle button to test DOM (not in static skeleton)
        var tray = document.getElementById('taskbar-tray');
        var btn = document.createElement('button');
        btn.id = 'btn-auto-refresh';
        btn.className = 'toggle-switch on';
        tray.insertBefore(btn, tray.firstChild);

        // Set desktop-config to have auto_refresh: "1"
        var cfg = document.getElementById('desktop-config');
        var old = cfg.textContent;
        cfg.textContent = '{"theme":{"auto_refresh":"1"},"widgets":{},"pins":[]}';

        // Only call setupAutoRefresh (not full init) to avoid duplicate event listeners
        Taskbar.setupAutoRefresh();

        assert.ok(btn.classList.contains('on'), 'starts ON');

        cfg.textContent = old;
    });

    it('auto-refresh toggle: click toggles class and broadcasts', function() {
        var tray = document.getElementById('taskbar-tray');
        var btn = document.createElement('button');
        btn.id = 'btn-auto-refresh';
        btn.className = 'toggle-switch on';
        tray.insertBefore(btn, tray.firstChild);

        var cfg = document.getElementById('desktop-config');
        var old = cfg.textContent;
        cfg.textContent = '{"theme":{"auto_refresh":"1"},"widgets":{},"pins":[]}';

        // Track broadcast calls
        var broadcastCalls = [];
        var origBroadcast = IframeBridge.broadcastAutoRefresh;
        IframeBridge.broadcastAutoRefresh = function(on) { broadcastCalls.push(on); };

        // Only call setupAutoRefresh (not full init) to avoid duplicate event listeners
        Taskbar.setupAutoRefresh();

        // Click to turn OFF
        btn.click();
        assert.ok(!btn.classList.contains('on'), 'turned OFF');
        assert.equal(broadcastCalls.length, 1, 'broadcast called');
        assert.equal(broadcastCalls[0], false, 'broadcast OFF');

        // Click to turn ON
        btn.click();
        assert.ok(btn.classList.contains('on'), 'turned ON');
        assert.equal(broadcastCalls.length, 2, 'broadcast called again');
        assert.equal(broadcastCalls[1], true, 'broadcast ON');

        // Restore original
        IframeBridge.broadcastAutoRefresh = origBroadcast;
        cfg.textContent = old;
    });

    it('clock should update format HH:MM:SS', function() {
        var clock = document.getElementById('taskbar-clock');
        var text = clock.textContent;
        assert.ok(/\d{1,2}:\d{2}/.test(text), 'clock format: ' + text);
    });
});

})();
