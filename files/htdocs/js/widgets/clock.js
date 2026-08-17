/* Widget: Desktop Clock
 *
 * Digital or analog display, selectable via mode option.
 */
(function() {
    'use strict';

    WidgetManager.register({
        id: 'desktop-clock',
        name: _('Desktop Clock'),
        updateInterval: 1000,   // top-level API field (was in defaults)
        defaults: {
            enabled: true,
            x: -210, y: 60,
            opacity: 0.7,
            clickThrough: true,
            mode: 'analog'
        },
        modes: {
            analog: _('Analog'),
            digital: _('Digital')
        },
        // clearable defaults to false (no user content) — nothing to declare.
        // Two color options, both riding WM._applyOptionStyles (declared in
        // the options schema, applied after every render — never hand-rolled
        // in the widget code): fg overrides the digits' font color
        // (--widget-fg; '' = theme default foreground), bg supplies ONE card
        // background for the whole digital face via the same color-mix chain
        // as .widget-card (opacity slider fades it; '' = theme default).
        // Analog mode draws a canvas with its own fixed palette, so both
        // options only affect digital mode.
        options: {
            fg: { type: 'color', label: _('Font color'), default: '#ffffff' },
            bg: { type: 'color', label: _('Card background'), default: '#0a0e14' },
            // Same 0% policy as the card widgets, but only the digital
            // face has a background — disabled (greyed) in analog mode.
            hideBgAtZero: {
                type: 'checkbox',
                label: _('Hide background at 0% opacity'),
                default: false,
                disabled: function(data) { return !data.mode || data.mode === 'analog'; }
            }
        },
        render: function(el, data) {
            if (!data.mode) data.mode = 'analog';
            el.setAttribute('data-mode', data.mode);
            // Mirrors data.hideBgAtZero onto the instance element; widget.css
            // drops the face's backdrop blur for [data-opacity="0"][data-hide-bg="1"].
            // Harmless in analog mode (no face), but the option is disabled there.
            if (data.hideBgAtZero) el.setAttribute('data-hide-bg', '1');
            else el.removeAttribute('data-hide-bg');
            if (data.mode === 'analog') {
                el.innerHTML = '<canvas width="160" height="160" class="analog-clock-canvas"></canvas>';
            } else {
                var now = new Date();
                // Time + date share one face container (.widget-clock-face):
                // the bg card background covers the two digit rows as a
                // single chip instead of a background per row.
                el.innerHTML =
                    '<div class="widget-clock">' +
                        '<div class="widget-clock-face">' +
                            '<div class="widget-clock-time">' + fmtTime(now) + '</div>' +
                            '<div class="widget-clock-date">' + fmtDate(now) + '</div>' +
                        '</div>' +
                    '</div>';
            }
            drawClock(el, data);
        },
        update: function(el, data) {
            if (!data.mode) data.mode = 'analog';
            if (data.mode === 'digital') {
                var now = new Date();
                var t = el.querySelector('.widget-clock-time');
                var d = el.querySelector('.widget-clock-date');
                if (t) t.textContent = fmtTime(now);
                if (d) d.textContent = fmtDate(now);
            }
            drawClock(el, data);
        }
    });

    // === Analog drawing ===
    var SIZE = 160, RADIUS = 76, CX = 80, CY = 80;

    function drawClock(el, data) {
        if (data.mode !== 'analog') return;
        var canvas = el.querySelector('canvas');
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        var now = new Date();
        var h = now.getHours() % 12, m = now.getMinutes();
        var s = now.getSeconds(), ms = now.getMilliseconds();

        ctx.clearRect(0, 0, SIZE, SIZE);

        // Outer ring
        ctx.beginPath();
        ctx.arc(CX, CY, RADIUS + 4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fill();

        // Face
        ctx.beginPath();
        ctx.arc(CX, CY, RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(20,20,35,0.85)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Hour markers
        for (var i = 0; i < 12; i++) {
            var a = (i * 30 - 90) * Math.PI / 180;
            var r1 = RADIUS - 10, r2 = RADIUS - 4;
            ctx.beginPath();
            ctx.moveTo(CX + r1 * Math.cos(a), CY + r1 * Math.sin(a));
            ctx.lineTo(CX + r2 * Math.cos(a), CY + r2 * Math.sin(a));
            ctx.strokeStyle = i % 3 === 0 ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.4)';
            ctx.lineWidth = i % 3 === 0 ? 2.5 : 1;
            ctx.lineCap = 'round';
            ctx.stroke();
        }

        // Second hand
        hand(ctx, ((s + ms/1000) * 6 - 90) * Math.PI/180, RADIUS - 18, 1, 'rgba(220,60,60,0.9)');
        // Minute hand
        hand(ctx, ((m + s/60) * 6 - 90) * Math.PI/180, RADIUS - 22, 3, 'rgba(255,255,255,0.85)');
        // Hour hand
        hand(ctx, ((h + m/60) * 30 - 90) * Math.PI/180, RADIUS - 34, 4.5, 'rgba(255,255,255,0.85)');
        // Center cap
        ctx.beginPath(); ctx.arc(CX, CY, 5, 0, Math.PI*2);
        ctx.fillStyle = 'rgba(220,60,60,0.9)'; ctx.fill();
        ctx.beginPath(); ctx.arc(CX, CY, 2.5, 0, Math.PI*2);
        ctx.fillStyle = '#fff'; ctx.fill();
    }

    function hand(ctx, angle, len, w, color) {
        ctx.beginPath();
        ctx.moveTo(CX, CY);
        ctx.lineTo(CX + len * Math.cos(angle), CY + len * Math.sin(angle));
        ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round';
        ctx.stroke();
    }

    function fmtTime(d) {
        return d.getHours().toString().padStart(2,'0') + ':' +
               d.getMinutes().toString().padStart(2,'0') + ':' +
               d.getSeconds().toString().padStart(2,'0');
    }
    function fmtDate(d) {
        return d.getFullYear() + '-' +
               (d.getMonth()+1).toString().padStart(2,'0') + '-' +
               d.getDate().toString().padStart(2,'0');
    }
})();
