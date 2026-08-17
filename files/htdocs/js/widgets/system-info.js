/* Widget: System Info
 *
 * Shows CPU load, memory usage, temperature and uptime on the desktop.
 * Polls LuCI status API when on router, shows mock data in dev mode.
 *
 * Reference widget for the formal Widget API (theme-widget-api，记忆库):
 *   - options schema (checkbox re-renders, color re-renders,
 *     number with apply:false stores only and throttles fetches)
 *   - async update returning a Promise (WM prevents overlap)
 */
(function() {
    'use strict';

    var lastFetch = 0;   // async-update throttle; module-level (single-instance)

    WidgetManager.register({
        id: 'system-info',
        name: _('System Info'),
        updateInterval: 3000,
        resizable: true,   // bottom-right handle drags px width/height
        defaults: {
            x: -210,
            y: 240,
            opacity: 0.6,
            clickThrough: true
        },
        // Config schema → settings panel controls. Values live in data[key].
        // clearable defaults to false (no user content) — nothing to declare.
        // accent colors the title only (--widget-accent); the CPU / Mem /
        // Up / Temp VALUES are fixed light blue in widget.css so they stay
        // readable whatever accent is picked. bg colors the card
        // (--widget-bg-color, alpha from the opacity slider). Both ride
        // WM._applyOptionStyles — widgets never write the application code
        // themselves.
        options: {
            showTemp:     { type: 'checkbox', label: _('Show temperature'), default: true },
            accent:       { type: 'color', label: _('Accent color'), default: '#ffffff' },
            bg:           { type: 'color', label: _('Card background'), default: '#0a0e14' },
            hideBgAtZero: { type: 'checkbox', label: _('Hide background at 0% opacity'), default: false },
            refresh:      { type: 'number', label: _('Refresh interval (s)'), min: 1, max: 60, step: 1, default: 3, apply: false }
        },
        render: function(el, data) {
            // Per-widget 0% policy: data.hideBgAtZero mirrors onto the
            // instance element, where widget.css drops the backdrop blur
            // for [data-opacity="0"][data-hide-bg="1"].
            if (data.hideBgAtZero) el.setAttribute('data-hide-bg', '1');
            else el.removeAttribute('data-hide-bg');
            var html =
                '<div class="widget-sysinfo">' +
                '<div class="widget-sysinfo-title">' + _('System') + '</div>' +
                '<div class="widget-sysinfo-row"><span class="label">' + _('CPU') + '</span><span class="value" id="si-cpu">--</span></div>' +
                '<div class="widget-sysinfo-row"><span class="label">' + _('Mem') + '</span><span class="value" id="si-mem">--</span></div>';
            if (data.showTemp !== false) {
                html += '<div class="widget-sysinfo-row"><span class="label">' + _('Temp') + '</span><span class="value" id="si-temp">--</span></div>';
            }
            html += '<div class="widget-sysinfo-row"><span class="label">' + _('Up') + '</span><span class="value" id="si-uptime">--</span></div>' +
                '</div>';
            el.innerHTML = html;
        },
        // Async update: return the fetch Promise. WM runs ticks without
        // overlap and swallows rejections — the catch below is the fallback
        // path (dev mode / offline), not an error surface.
        update: function(el, data) {
            // refresh option (apply:false → stored only, no re-render)
            // throttles real fetches; WM ticks still fire at updateInterval
            var minGap = (data.refresh != null ? data.refresh : 3) * 1000;
            var now = Date.now();
            if (lastFetch && now - lastFetch < minGap) return Promise.resolve();
            lastFetch = now;

            // Version-agnostic data source: the theme's own controller
            // (desktop.lua action_system_status) reads /proc directly —
            // works on any LuCI release.
            return fetch('/cgi-bin/luci/admin/desktop/system_status')
                .then(function(r) {
                    if (!r.ok) throw new Error('not on router');
                    return r.json();
                })
                .then(function(json) { updateFromJSON(el, json); })
                .catch(function() {
                    // Dev mode / offline: show mock data
                    updateMock(el);
                });
        }
    });

    function updateFromJSON(el, json) {
        // cpuusage arrives as a ready string ("37%") from the controller
        var cpu = json.cpuusage ? json.cpuusage : '--';
        var memTotal = json.memory && json.memory.total ? fmtBytes(json.memory.total) : '--';
        // Total shown is PHYSICAL memory (controller: SMBIOS dmidecode —
        // the stickered 16G; MemTotal ~15.3G is what the kernel manages
        // after reserved ranges). Falls back to MemTotal when the
        // controller predates the physical field.
        var memPhys = json.memory && json.memory.physical
            ? fmtBytes(json.memory.physical) : memTotal;
        // used = displayedTotal − MemAvailable: reclaimable page cache
        // stays inside available (never counted as used — LuCI
        // semantics), and kernel/reserved memory counts as used, so
        // used + available always adds up to the displayed total.
        // (physical falls back to MemTotal when the controller predates
        // the SMBIOS field.)
        var memUsed = (json.memory && json.memory.available && (json.memory.physical || json.memory.total))
            ? fmtBytes((json.memory.physical || json.memory.total) - json.memory.available) : '--';
        var uptime = json.uptime ? fmtUptime(json.uptime) : '--';

        setVal(el, 'si-cpu', cpu);
        setVal(el, 'si-mem', memUsed + '/' + memPhys);
        setVal(el, 'si-uptime', uptime);
        if (json.thermal && json.thermal[0]) {
            setVal(el, 'si-temp', json.thermal[0].temp);
        }
    }

    function updateMock(el) {
        setVal(el, 'si-cpu', Math.floor(Math.random() * 30 + 5) + '%');
        setVal(el, 'si-mem', '3.2G/7.8G');
        setVal(el, 'si-temp', Math.floor(Math.random() * 15 + 40) + '°C');
        setVal(el, 'si-uptime', (Math.floor(Math.random() * 72 + 1)) + 'h');
    }

    function setVal(el, id, val) {
        var span = el.querySelector('#' + id);
        if (span) span.textContent = val;
    }

    function fmtBytes(b) {
        if (b >= 1073741824) return (b / 1073741824).toFixed(1) + 'G';
        if (b >= 1048576) return (b / 1048576).toFixed(0) + 'M';
        return (b / 1024).toFixed(0) + 'K';
    }

    function fmtUptime(s) {
        var d = Math.floor(s / 86400);
        var h = Math.floor((s % 86400) / 3600);
        if (d > 0) return d + 'd ' + h + 'h';
        return h + 'h';
    }
})();
