/* Widget: Network Traffic
 *
 * Real-time per-interface bandwidth (rx/tx rates, 1s polling).
 *
 * Data source — the theme controller, no nlbwmon required:
 *   GET /cgi-bin/luci/admin/desktop/bandwidth
 *       → { iface: { rx: <cumulative rx bytes>, tx: <cumulative tx bytes>,
 *                    phy: <physical NIC or not> }, ... }
 *     (controller reads /proc/net/dev + /sys/class/net/<n>/device;
 *     sysauth=false like /interfaces so widget requests work regardless
 *     of cookie partitioning)
 * The widget holds the previous sample and diffs cumulative bytes against
 * elapsed time for the current rate. The first tick after load / iface
 * switch only records the baseline (shows "--").
 * Iface auto-picks sort physical NICs first (no names hardcoded), then
 * cumulative traffic — dummy/docker virtual ifaces never win.
 */
(function() {
    'use strict';

    var IGNORE_IFACES = { lo: 1 };   // loopback is noise for a traffic widget

    var prevSample = null;   // { iface, rx, tx, t } — baseline for diffing

    // Best iface = sort by (physical NIC first, then cumulative traffic):
    // virtual ifaces (dummy0/docker0 — no /sys/class/net/<n>/device) sit at
    // zero and would show "--" forever; the first /proc/net/dev name often
    // lands on one. No interface names are hardcoded — `phy` comes from the
    // endpoint. Ties fall back to list order.
    function ifaceScore(c) {
        return (c && c.phy ? 1 : 0) * 1e15 + (c ? c.rx + c.tx : 0);
    }

    function pickBest(data, all) {
        var best = null, bestScore = -1;
        for (var n in all) {
            if (!all.hasOwnProperty(n) || IGNORE_IFACES[n]) continue;
            var score = ifaceScore(all[n]);
            if (score > bestScore) { bestScore = score; best = n; }
        }
        if (best) data.iface = best;
        return best;
    }

    // The default iface ('wan') may not exist on the device (real names
    // like pppoe-wan / br-lan). When the current iface is missing from the
    // endpoint response, auto-adopt the best iface once. Only while the
    // iface is still the 'wan' placeholder: an explicitly chosen iface is
    // the user's intent — respect it even when it's momentarily silent.
    function pickRealIface(data, all) {
        var real = Object.keys(all || {}).filter(function(n) { return n && !IGNORE_IFACES[n]; });
        if (!real.length) return false;
        if (real.indexOf(data.iface) !== -1) return false;   // chosen iface exists — fine
        if (data.iface !== 'wan') return false;              // user picked something else — respect it
        return pickBest(data, all) !== null;
    }

    // Correct a legacy bad pick once: a non-physical iface (dummy0/docker0
    // — no /sys/class/net/<n>/device) that still reads zero while any
    // physical NIC has traffic. These were never chosen by the user (the
    // old auto-adopt landed on them), so swap to the best NIC and persist.
    function isZeroNonPhy(c) { return c && !c.phy && (c.rx + c.tx) === 0; }
    function hasPhyTraffic(all) {
        for (var n in all) {
            if (!all.hasOwnProperty(n) || IGNORE_IFACES[n]) continue;
            var c = all[n];
            if (c && c.phy && (c.rx + c.tx) > 0) return true;
        }
        return false;
    }

    // Diff the previous cumulative sample against the current one. Returns
    // null (renders "--") until a valid baseline exists.
    function selfDiff(data, cur) {
        var now = Date.now() / 1000;
        var prev = prevSample;
        prevSample = { iface: data.iface, rx: cur.rx, tx: cur.tx, t: now };
        if (!prev || prev.iface !== data.iface) return null;   // baseline only
        var dt = now - prev.t;
        if (dt <= 0 || cur.rx < prev.rx || cur.tx < prev.tx) return null;   // no data / counter reset
        return { rx: (cur.rx - prev.rx) / dt, tx: (cur.tx - prev.tx) / dt };   // bytes/s
    }

    function fmtRate(bytesPerSec) {
        if (bytesPerSec == null || isNaN(bytesPerSec)) return '--';
        var v = bytesPerSec * 8;   // bits/s
        if (v >= 1e6) return (v / 1e6).toFixed(1) + ' Mb/s';
        if (v >= 1e3) return (v / 1e3).toFixed(0) + ' kb/s';
        return v.toFixed(0) + ' b/s';
    }

    function renderRate(el, rate) {
        var rxEl = el.querySelector('.nt-rx');
        var txEl = el.querySelector('.nt-tx');
        if (rxEl) rxEl.textContent = fmtRate(rate ? rate.rx : null);
        if (txEl) txEl.textContent = fmtRate(rate ? rate.tx : null);
    }

    // Picker options, sorted by the SAME rule as auto-adopt (ifaceScore:
    // physical NICs first, then cumulative traffic). Without the sort the
    // dropdown mirrors /proc/net/dev order — dummy0/docker0 alphabetically
    // precede real NICs and would sit on top. Falls back to the plain
    // iface list (unordered) if bandwidth data is unavailable.
    function loadIfaceList() {
        return fetch('/cgi-bin/luci/admin/desktop/bandwidth')
            .then(function(r) { return r.json(); })
            .then(function(all) {
                var names = [];
                for (var n in all) {
                    if (!all.hasOwnProperty(n) || IGNORE_IFACES[n]) continue;
                    names.push(n);
                }
                names.sort(function(a, b) { return ifaceScore(all[b]) - ifaceScore(all[a]); });
                var out = {};
                names.forEach(function(n) { out[n] = n; });
                return out;
            })
            .catch(function() {
                return fetch('/cgi-bin/luci/admin/desktop/interfaces')
                    .then(function(r) { return r.json(); }).then(function(list) {
                    if (!list || !list.length) return null;
                    var out = {};
                    list.forEach(function(name) { if (!IGNORE_IFACES[name]) out[name] = name; });
                    return out;
                });
            });
    }

    WidgetManager.register({
        id: 'net-traffic',
        name: _('Network Traffic'),
        updateInterval: 1000,
        resizable: true,   // bottom-right handle drags px width/height
        // clearable defaults to false (no user content) — nothing to declare
        defaults: {
            x: -240,
            y: 120,
            opacity: 0.85,
            clickThrough: false,
            scale: 1.0
        },
        // Interface picker: static options render immediately; loadOptions
        // replaces them with the live net.devices list once the panel opens.
        // accent colors the text (title + rates via --widget-accent); bg
        // colors the card (--widget-bg-color, alpha from the opacity
        // slider). Both ride WM._applyOptionStyles. Order matches
        // system-info (accent before bg).
        options: {
            accent:       { type: 'color', label: _('Accent color'), default: '#ffffff' },
            bg:           { type: 'color', label: _('Card background'), default: '#0a0e14' },
            hideBgAtZero: { type: 'checkbox', label: _('Hide background at 0% opacity'), default: false },
            iface: {
                type: 'select',
                label: _('Interface'),
                options: { wan: 'WAN', lan: 'LAN' },
                loadOptions: loadIfaceList,
                default: 'wan'
            }
        },
        render: function(el, data) {
            el.setAttribute('data-mode', 'traffic');
            // Per-widget 0% policy: mirrors data.hideBgAtZero onto the
            // instance element (CSS: [data-opacity="0"][data-hide-bg="1"]).
            if (data.hideBgAtZero) el.setAttribute('data-hide-bg', '1');
            else el.removeAttribute('data-hide-bg');
            // Fixed 190px default for the non-resizable case only. A
            // resizable instance gets its px size from the user's drag
            // (config width, restored by enable) — appending width here
            // would override it on every re-render (option change, iface
            // switch) and undo the resize.
            if (!this.resizable) el.style.cssText = el.style.cssText + 'width:190px;';
            prevSample = null;   // iface/render changed — restart diffing
            el.innerHTML =
                '<div class="widget-card">' +
                    '<div class="widget-card-title">' + _('Network Traffic') +
                        ' <span class="nt-iface">' + (data.iface || '') + '</span></div>' +
                    '<div class="widget-card-row"><span class="label nt-rx-label">&#8595; ' +
                        _('Download') + '</span><span class="value nt-rx">--</span></div>' +
                    '<div class="widget-card-row"><span class="label nt-tx-label">&#8593; ' +
                        _('Upload') + '</span><span class="value nt-tx">--</span></div>' +
                '</div>';
        },
        // Async update: return the fetch Promise. WM prevents overlapping
        // ticks and swallows rejections — the catch is the offline fallback.
        update: function(el, data, api) {
            if (!data.iface) return Promise.resolve();
            return fetch('/cgi-bin/luci/admin/desktop/bandwidth')
                .then(function(r) { return r.json(); })
                .then(function(all) {
                    var cur = all && all[data.iface];
                    // Unknown iface (default 'wan' often doesn't exist on
                    // the device): adopt the busiest real interface once.
                    if (!cur && pickRealIface(data, all)) {
                        prevSample = null;
                        if (api && api.saveConfig) api.saveConfig();
                        cur = all[data.iface];
                    }
                    // Legacy auto-adopt could pin a non-physical iface
                    // (dummy0/docker0) with zero traffic. Correct it once
                    // when a physical NIC is actually carrying traffic.
                    if (cur && isZeroNonPhy(cur) && hasPhyTraffic(all)) {
                        pickBest(data, all);
                        prevSample = null;
                        if (api && api.saveConfig) api.saveConfig();
                        cur = all[data.iface];
                    }
                    if (!cur) { renderRate(el, null); return; }
                    renderRate(el, selfDiff(data, cur));
                })
                .catch(function() {
                    renderRate(el, null);
                });
        }
    });
})();
