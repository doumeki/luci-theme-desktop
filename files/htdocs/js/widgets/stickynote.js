/* Widget: Sticky Note
 *
 * Model: 3 FIXED SLOTS (sticky-note-1/2/3) whose identity is the slot
 * name — shared across views. The shared store (desktop.stickysync)
 * holds each slot's 7 color-keyed note pages + the SHOW color + closed
 * flag:
 *   { notes: {color: text, ...}, activeColor, closed, opacity, clickThrough }
 * activeColor (the show color) decides WHICH page is displayed: content =
 * notes[activeColor], background = activeColor. The color picker only
 * switches which page is shown — each color keeps its own content.
 * Widget configs (widgets / mobile_widgets) hold only the per-view layout
 * (x/y/w/h/mobileHidden). Closing marks the entry closed (content kept)
 * so other views hide it; re-opening clears the marker.
 */
(function() {
    'use strict';

    var COLORS = ['#f9e74a', '#f78b6e', '#7ec8a0', '#6eb5f7', '#c49bdb', '#f5a3c7', '#ffffff'];
    var COLOR_LABELS = ['Yellow', 'Coral', 'Green', 'Blue', 'Purple', 'Pink', 'White'];
    var DEFAULT_COLOR = '#f9e74a';

    // ===== Shared store (desktop.stickysync): { slot: {notes, activeColor, closed} }
    // P1: reads go through LuCIDesktop.getSection (single parse + fault
    // tolerance). P2: writes update the tab's config immediately (the DOM
    // script tag is the per-tab source of truth, so other widgets/views
    // see the change at once) but coalesce the backend POST: debounced,
    // serialized (the latest map always wins — no out-of-order overwrite
    // from concurrent requests), with a synchronous flush on pagehide so
    // a fast close/refresh never loses the last keystroke.
    var DEBOUNCE_MS = 500;
    var _pending = null;     // latest map not yet POSTed
    var _lastSent = null;    // map of the in-flight POST (flush fallback)
    var _timer = null;
    var _inFlight = false;

    function getSyncMap() {
        return LuCIDesktop.getSection('stickysync');
    }

    function writeSyncMap(map) {
        LuCIDesktop.setSectionLocal('stickysync', map);
        scheduleWrite(map);
    }

    function scheduleWrite(map) {
        _pending = map;
        if (_timer) return;            // already debouncing — latest map wins
        if (_inFlight) return;         // done() re-fires with the latest map
        _timer = setTimeout(fire, DEBOUNCE_MS);
    }

    function fire() {
        _timer = null;
        if (!_pending || _inFlight) return;
        var map = _pending;
        _pending = null;
        _lastSent = map;
        _inFlight = true;
        try {
            var xhr = LuCIDesktop.saveDesktopSection('stickysync', map);
            if (xhr) { xhr.onload = done; xhr.onerror = done; }
            else done();
        } catch (e) { done(); }
    }

    function done() {
        _inFlight = false;
        if (_pending) fire();          // writes during flight — send latest now
    }

    function flush() {
        if (_timer) { clearTimeout(_timer); _timer = null; }
        var map = _pending || (_inFlight ? _lastSent : null);
        if (!map) return;
        _pending = null;
        try { LuCIDesktop.saveDesktopSection('stickysync', map, true); } catch (e) {}
    }

    if (typeof window !== 'undefined') {
        // Fast close/refresh must not lose the debounced write.
        window.addEventListener('pagehide', flush);
        window.addEventListener('beforeunload', flush);
        // Test hook: force-flush pending writes (tests/js/stickynote.test.js).
        window.__stickynoteStore = {
            flush: flush,
            pending: function() { return !!_pending || _inFlight; },
            setDebounce: function(ms) { DEBOUNCE_MS = ms; },
            reset: function() {
                if (_timer) { clearTimeout(_timer); _timer = null; }
                _pending = null; _lastSent = null; _inFlight = false;
            }
        };
    }

    // 7 color-keyed note pages per slot.
    function newEntry() {
        var notes = {};
        COLORS.forEach(function(c) { notes[c] = ''; });
        return { notes: notes, activeColor: DEFAULT_COLOR };
    }

    // Migration: a legacy entry written by the short-lived single-content
    // model ({content}) is folded back into the color-keyed pages — the
    // content lands on the page of the color that was showing.
    function migrateEntry(e) {
        if (e && e.content !== undefined && !e.notes) {
            var notes = {};
            COLORS.forEach(function(c) { notes[c] = ''; });
            notes[e.activeColor || DEFAULT_COLOR] = e.content || '';
            e.notes = notes;
            delete e.content;
            return true;
        }
        if (e && !e.notes) {
            var n2 = {};
            COLORS.forEach(function(c) { n2[c] = ''; });
            e.notes = n2;
            return true;
        }
        return false;
    }

    // Ensure the slot has a shared entry (idempotent).
    function ensureEntry(slot, api) {
        var map = getSyncMap();
        if (!map[slot]) {
            map[slot] = newEntry();
            writeSyncMap(map);
        } else if (migrateEntry(map[slot])) {
            writeSyncMap(map);
        }
        return map[slot];
    }

    WidgetManager.register({
        id: 'sticky-note',
        name: _('Sticky Note'),
        multi: true,
        maxInstances: 3,   // 3 fixed slots — the product design
        clearable: true,
        // User-resizable via the shared _makeResizable handle (same
        // bottom-right grip + mouse/touch logic as system-info /
        // net-traffic). Size (w/h) stays per-view.
        resizable: true,
        // Style fields that live in the SHARED stickysync entry (every
        // view shows the same opacity/clickThrough). Size (w/h), scale
        // and position (x/y) stay per-view.
        sharedKeys: ['opacity', 'clickThrough'],
        defaults: {
            x: 60, y: 120,
            width: 200, height: 160,
            opacity: 0.88,
            clickThrough: false,
            scale: 1.0,
            updateInterval: 3000
        },
        data: {
            w: 200,
            h: 160,
            mobileHidden: false   // per-view: hide on small screens only
        },
        options: {
            mobileHidden: { label: _('Hide on mobile'), type: 'checkbox', default: false }
        },
        render: function(el, data, api) {
            if (data.w === undefined) data.w = 200;
            if (data.h === undefined) data.h = 160;
            if (data.mobileHidden === undefined) data.mobileHidden = false;

            var slot = api.instanceId;   // 'sticky-note-N' — the identity

            // Globally closed (on another view) → drop the local instance.
            var m0 = getSyncMap();
            if (m0[slot] && m0[slot].closed) {
                try { api.disable(); } catch (e) {}
                return;
            }

            // Hide-on-mobile is a per-view flag: the note stays fully
            // functional and visible on the other view.
            if (LuCIDesktop && typeof LuCIDesktop.isMobile === 'function' &&
                LuCIDesktop.isMobile() && data.mobileHidden) {
                el.style.display = 'none';
                el.innerHTML = '';
                return;
            }
            el.style.display = '';

            var entry = ensureEntry(slot, api);
            var c = entry.activeColor || DEFAULT_COLOR;
            var text = (entry.notes && entry.notes[c]) || '';

            var num = (slot || '').replace('sticky-note-', '') || '1';
            var title = _('Sticky ') + num;

            el.setAttribute('data-mode', 'note');
            el.style.cssText = el.style.cssText +
                'background:' + c + ';' +
                'border-radius:4px;box-shadow:2px 2px 8px rgba(0,0,0,0.3);' +
                'padding:0;overflow:hidden;' +
                'font:13px/1.4 sans-serif;color:#222;cursor:default;';

            // Shared style (opacity/clickThrough live in the stickysync
            // entry, not in the per-view config): apply here so a note
            // rendered on ANY view looks the same.
            if (entry.opacity !== undefined) {
                el.style.setProperty('--widget-bg-alpha', entry.opacity);
                el.setAttribute('data-opacity', entry.opacity);
            }
            if (entry.clickThrough !== undefined) {
                el.style.pointerEvents = entry.clickThrough ? 'none' : 'auto';
            }

            el.innerHTML =
                '<div class="sticky-header" style="display:flex;align-items:center;gap:4px;padding:4px 6px;' +
                'background:rgba(0,0,0,0.08);cursor:grab;user-select:none;">' +
                '<span class="sticky-title" style="flex:1;font-size:11px;font-weight:600;opacity:0.6;">' + title + '</span>' +
                buildColorPicker(c) +
                '<button class="sticky-del" title="' + _('Close') + '" style="background:none;border:none;' +
                'font-size:14px;cursor:pointer;opacity:0.5;line-height:1;padding:0 2px;">&times;</button>' +
                '</div>' +
                '<div class="sticky-body" contenteditable="true" style="padding:8px 10px;min-height:100px;' +
                'outline:none;word-wrap:break-word;white-space:pre-wrap;">' +
                escapeHTML(text) +
                '</div>';

            // ===== Save helper: writes the current SHOW page's content
            // (notes[activeColor]) — each color keeps its own page =====
            var body = el.querySelector('.sticky-body');
            var save = function() {
                if (!body) return;
                var map = getSyncMap();
                var e = map[slot] || newEntry();
                if (!e.notes) e.notes = {};
                e.notes[e.activeColor || DEFAULT_COLOR] = body.textContent || '';
                map[slot] = e;
                writeSyncMap(map);
            };

            if (body) {
                body.addEventListener('input', save);
                body.addEventListener('blur', function() { save(); });
                body.addEventListener('focus', function() { el.style.pointerEvents = 'auto'; });
                body.addEventListener('blur', function() {
                    if (data.clickThrough) el.style.pointerEvents = 'none';
                });
            }

            // ===== Close button (✕ marks closed; content kept) =====
            var delBtn = el.querySelector('.sticky-del');
            if (delBtn) {
                delBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    api.disable();
                });
            }

            // ===== Color picker: switches WHICH page is shown — the
            // current page's content is flushed to its own color key first,
            // then activeColor (show) moves to the picked color =====
            var sel = el.querySelector('.sticky-color');
            if (sel) {
                sel.value = c;
                sel.addEventListener('change', function(e) {
                    e.stopPropagation();
                    var map = getSyncMap();
                    var en = map[slot] || newEntry();
                    if (!en.notes) en.notes = {};
                    if (body) en.notes[en.activeColor || DEFAULT_COLOR] = body.textContent || '';
                    en.activeColor = sel.value;
                    map[slot] = en;
                    writeSyncMap(map);
                    api.rerender();
                });
                sel.addEventListener('mousedown', function(e) { e.stopPropagation(); });
            }
        },
        update: function(el, data, api) {
            var body = el.querySelector('.sticky-body');
            if (!body || !api.instanceId) return;
            var map = getSyncMap();
            var entry = map[api.instanceId];
            if (!entry) return;
            if (!entry.notes) entry.notes = {};
            var key = entry.activeColor || DEFAULT_COLOR;
            var current = body.textContent || '';
            if (current !== (entry.notes[key] || '')) {
                entry.notes[key] = current;
                map[api.instanceId] = entry;
                writeSyncMap(map);
            }
        },
        destroy: function(el, data, api) {
            // Content is written on every input/blur — nothing to flush.
        },
        onEnable: function(inst) {
            // Re-opening clears the global closed marker so other views
            // reconcile the note back.
            if (!inst || !inst.id) return;
            var map = getSyncMap();
            var e = map[inst.id];
            if (e && e.closed) {
                delete e.closed;
                map[inst.id] = e;
                writeSyncMap(map);
            }
        },
        onDisable: function(inst) {
            // ✕ / toggle-off keeps the content (original design: "X closes,
            // data preserved") and marks the note closed GLOBALLY — other
            // views hide it instead of resurrecting it.
            if (!inst || !inst.id) return;
            var map = getSyncMap();
            var e = map[inst.id];
            if (e) { e.closed = true; map[inst.id] = e; writeSyncMap(map); }
        },
        onClear: function(cfg) {
            // The ONLY way to permanently delete a slot's content.
            if (!cfg || !cfg.id) return;
            var map = getSyncMap();
            if (map[cfg.id]) {
                delete map[cfg.id];
                writeSyncMap(map);
            }
        },
        restoreShared: function(inst) {
            // Pull shared style (opacity/clickThrough) from the stickysync
            // entry into this instance BEFORE render — every view must show
            // the same style even when the note was last styled elsewhere.
            if (!inst || !inst.id) return;
            var map = getSyncMap();
            var e = map[inst.id];
            if (!e) return;
            if (e.opacity !== undefined && inst.opacity !== e.opacity) {
                inst.opacity = e.opacity;
                inst.el.style.setProperty('--widget-bg-alpha', e.opacity);
                inst.el.setAttribute('data-opacity', e.opacity);
            }
            if (e.clickThrough !== undefined && inst.clickThrough !== e.clickThrough) {
                inst.clickThrough = e.clickThrough;
                inst.el.style.pointerEvents = e.clickThrough ? 'none' : 'auto';
            }
        },
        onStyleChange: function(inst, key, value) {
            // Forward a shared style change (setOpacity/setClickThrough)
            // into the stickysync entry so all views agree.
            if (!inst || !inst.id) return;
            var map = getSyncMap();
            var e = map[inst.id];
            if (!e) { e = newEntry(); map[inst.id] = e; }
            e[key] = value;
            map[inst.id] = e;
            writeSyncMap(map);
        }
    });

    function buildColorPicker(current) {
        var h = '<select class="sticky-color" style="font-size:10px;padding:1px 2px;' +
            'background:rgba(255,255,255,0.5);border:1px solid rgba(0,0,0,0.15);' +
            'border-radius:2px;cursor:pointer;max-width:60px;">';
        COLORS.forEach(function(c, i) {
            h += '<option value="' + c + '"' + (c === current ? ' selected' : '') +
                 ' style="background:' + c + ';">' + _(COLOR_LABELS[i]) + '</option>';
        });
        h += '</select>';
        return h;
    }

    function escapeHTML(s) {
        var d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    // ===== Lightweight view sync (replaces the v3 reconcile) =====
    // Fixed 3 slots; the shared entry's closed flag IS the global open
    // state. On view load: create instances for OPEN slots missing here,
    // remove instances whose slot is CLOSED globally.
    // IMPORTANT (0.1.0-128 bugfix): enable/disable here must NOT trigger a
    // backend save (_skipSave=true / no-op). This runs ~2.5s after page
    // load with the CURRENT in-memory instance list — if the freshly
    // restored view is incomplete (a widget the user enabled before the
    // F5 is still loading, or its UCI row raced the page render), the save
    // would overwrite UCI with the stale list and PERMANENTLY delete the
    // widget (real bug: net-traffic vanished on 1.1 after F5). Restoring a
    // missing slot is idempotent layout work — the next real user action
    // persists it.
    function syncSlots() {
        if (!window.WidgetManager || !WidgetManager.registry['sticky-note']) return false;
        var map = getSyncMap();
        var changed = false;
        for (var n = 1; n <= 3; n++) {
            var iid = 'sticky-note-' + n;
            var entry = map[iid];
            var inst = WidgetManager.instances[iid];
            if (entry && entry.closed && inst) {
                try { WidgetManager.disable(iid, true); changed = true; } catch (e) {}
            } else if (entry && !entry.closed && !inst) {
                // Globally open but absent here → create. Local preserved
                // config (if any) is only a layout cache: enable({id}) picks
                // it up and restores the saved position/size. A note
                // re-opened on another view must reappear here too.
                try {
                    WidgetManager.enable('sticky-note', {
                        id: iid,
                        data: { w: 200, h: 160 },
                        x: 60 + (n - 1) * 40,
                        y: 120 + (n - 1) * 40
                    }, true);
                    changed = true;
                } catch (e) {}
            }
        }
        return changed;
    }

    var _attempts = 0;
    function trySync() {
        if (!window.WidgetManager || !WidgetManager.instances) {
            if (++_attempts < 20) setTimeout(trySync, 500);
            return;
        }
        syncSlots();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { setTimeout(trySync, 2500); });
    } else {
        setTimeout(trySync, 2500);
    }
})();
