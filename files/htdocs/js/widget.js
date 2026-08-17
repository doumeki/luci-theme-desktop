/* Desktop Theme - Widget Manager
 *
 * Pluggable desktop widget system. Multi-instance: each enable() call
 * creates a unique instance (e.g. sticky-note-1, sticky-note-2).
 *
 * Lifecycle: register → enable → render → (update*) → disable → destroy
 * Disable preserves config in _preservedConfigs so data survives close/toggle-off.
 *
 * Widget API (see theme-widget-api，记忆库):
 *   register({ id, name, multi, maxInstances, updateInterval, clearable,
 *              modes, data, defaults, options, render(el,data,api),
 *              update(el,data,api), destroy(el,data,api) })
 *   - options: config schema → settings panel controls (text/number/color/
 *     checkbox/select); values stored in data[key]; opt.apply === false
 *     stores without re-rendering
 *   - api: { instanceId, typeId, data, rerender(), saveConfig(), disable() }
 *   - update may return a Promise (async); ticks don't overlap
 */
(function() {
    'use strict';

    var DESKTOP = window.LuCIDesktop;

    // Derive readable widget foreground colors from the card background
    // (WCAG relative luminance). Light bg → dark text; dark bg → light
    // text. Also returns the border tint and the text-shadow color
    // (inverse of the fg, so the shadow helps exactly when the card is
    // semi-transparent over a light wallpaper). Exposed as CSS variables
    // on the widget instance; widgets only declare `bg`/`accent` options
    // and never compute colors themselves.
    function deriveWidgetColors(bgHex) {
        var m = /^#?([0-9a-f]{6})$/i.exec(bgHex || '');
        if (!m) return null;
        var lin = function(c) {
            return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        };
        var r = parseInt(m[1].substr(0, 2), 16) / 255;
        var g = parseInt(m[1].substr(2, 2), 16) / 255;
        var b = parseInt(m[1].substr(4, 2), 16) / 255;
        var Y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
        var dark = Y > 0.35;   // perceptually light background
        return {
            fg:     dark ? '#101418' : '#f5f7fa',
            border: dark ? 'rgba(16, 20, 24, 0.22)' : 'rgba(245, 247, 250, 0.22)',
            shadow: dark ? 'rgba(255, 255, 255, 0.35)' : 'rgba(0, 0, 0, 0.45)'
        };
    }
    var WidgetManager = {
        registry: {},         // typeId → {id, name, defaults, render, update, destroy}
        instances: {},        // instanceId → {id, typeId, el, x, y, opacity, clickThrough, data}
        _preservedConfigs: {},// instanceId → saved config for disabled-but-preserved instances
        _nextNum: {},         // typeId → next instance number
        _dragging: null,

        // ===== Registration =====
        register: function(def) {
            if (!def.id) throw new Error('Widget requires an id');
            if (!def.render) throw new Error('Widget requires a render function');
            if (this.registry[def.id]) throw new Error('Widget "' + def.id + '" already registered');
            this.registry[def.id] = {
                id: def.id,
                name: def.name || def.id,
                multi: def.multi === true,       // default false: single-instance (opt-in)
                maxInstances: def.maxInstances || 3,
                defaults: Object.assign({ x: 100, y: 100, opacity: 0.7, clickThrough: true, scale: 1.0 }, def.defaults || {}),
                render: def.render,
                update: def.update || null,
                destroy: def.destroy || null,
                onEnable: def.onEnable || null,
                onDisable: def.onDisable || null,
                onClear: def.onClear || null,
                data: def.data || null,
                modes: def.modes || null,
                // "Clear data" only for widgets that hold user content
                // (stickynote). Opt-in, NOT opt-out: with the old
                // `!== false` default every new widget silently showed a
                // meaningless Clear button and had to remember to opt out
                // (system-info shipped that bug). Widgets with user
                // content declare `clearable: true` explicitly.
                clearable: def.clearable === true,
                // User-resizable px size (bottom-right handle, _makeResizable).
                // Also opt-in: without it enable() adds no handle and the
                // widget keeps its content-sized box.
                resizable: def.resizable === true,
                updateInterval: def.updateInterval || (def.defaults && def.defaults.updateInterval) || null,  // top-level, legacy defaults compatible; stored cfg wins
                options: def.options || null,              // config schema → settings panel controls
                // Shared-style plumbing: keys a widget keeps in its own
                // shared store (not per-view config) + hooks to sync them.
                sharedKeys: def.sharedKeys || null,
                restoreShared: def.restoreShared || null,
                onStyleChange: def.onStyleChange || null
            };
        },

        // ===== Instance ID helpers =====
        // Generate next instance ID. Prefers reusing a preserved (closed) slot
        // so re-enabling fills the gap instead of creating a new number.
        _nextInstanceId: function(typeId) {
            var def = this.registry[typeId];
            var max = def.maxInstances || 3;

            // Find a preserved config to reuse
            for (var n = 1; n <= max; n++) {
                var candidate = typeId + '-' + n;
                if (this._preservedConfigs[candidate] && !this.instances[candidate]) {
                    return candidate;
                }
            }

            // No preserved slot — find first unused number
            if (!this._nextNum[typeId]) this._nextNum[typeId] = 1;
            for (var n = this._nextNum[typeId]; n <= max; n++) {
                var candidate = typeId + '-' + n;
                if (!this.instances[candidate] && !this._preservedConfigs[candidate]) {
                    this._nextNum[typeId] = n + 1;
                    return candidate;
                }
            }
            // All slots full — return max slot (caller should check before enable)
            return typeId + '-' + max;
        },

        // List all instance IDs for a given widget type
        _instancesOf: function(typeId) {
            var ids = [];
            for (var iid in this.instances) {
                if (this.instances.hasOwnProperty(iid) && this.instances[iid].typeId === typeId) {
                    ids.push(iid);
                }
            }
            return ids;
        },

        // Total count (active + preserved) for a type
        _totalCount: function(typeId) {
            var active = this._instancesOf(typeId).length;
            var preserved = 0;
            for (var iid in this._preservedConfigs) {
                if (this._preservedConfigs.hasOwnProperty(iid) && this._preservedConfigs[iid].typeId === typeId) {
                    preserved++;
                }
            }
            return active + preserved;
        },

        // ===== Lifecycle =====
        enable: function(typeId, overrides, _skipSave) {
            var def = this.registry[typeId];
            if (!def) throw new Error('Widget "' + typeId + '" not registered');

            if (!def.multi && this._instancesOf(typeId).length > 0) {
                console.log('[widget] enable ' + typeId + ' — already active (single-instance)');
                return;
            }

            var activeCount = this._instancesOf(typeId).length;
            var max = def.maxInstances || 3;
            if (def.multi && activeCount >= max && !(overrides && overrides.id && this._preservedConfigs[overrides.id])) {
                console.log('[widget] enable ' + typeId + ' — max ' + max + ' instances reached');
                if (window.LuCIDesktop && LuCIDesktop.emit) {
                    LuCIDesktop.emit('toast', {msg: _('Max ') + max + _(' instances of ') + _(def.name), type: 'warn', key: 'widget-max'});
                }
                return;
            }

            var instanceId = (overrides && overrides.id) ? overrides.id : this._nextInstanceId(typeId);
            if (this.instances[instanceId]) throw new Error('Instance "' + instanceId + '" already enabled');

            var preserved = this._preservedConfigs[instanceId];
            if (preserved) {
                overrides = Object.assign({}, preserved, overrides || {});
                delete this._preservedConfigs[instanceId];
                console.log('[widget] enable ' + instanceId + ' — restored preserved config');
            }

            var cfg = Object.assign({}, def.defaults, overrides || {});
            var x = cfg.x, y = cfg.y;
            if (x < 0) x = window.innerWidth + x;
            if (y < 0) y = window.innerHeight - 44 + y;
            if (cfg.instanceOffset) { x += cfg.instanceOffset.x || 0; y += cfg.instanceOffset.y || 0; }

            var el = document.createElement('div');
            el.className = 'widget-instance widget-' + typeId;
            el.setAttribute('data-widget-id', instanceId);
            el.setAttribute('data-opacity', cfg.opacity);
            el.style.cssText =
                'position:absolute;left:' + x + 'px;top:' + y + 'px;' +
                '--widget-bg-alpha:' + cfg.opacity + ';' +
                'pointer-events:' + (cfg.clickThrough ? 'none' : 'auto') + ';' +
                'transform:scale(' + cfg.scale + ');';
            // User-resized size (resizable widgets): px dims from config.
            // Legacy widgets (sticky-note) stored size in data.w/data.h —
            // lift those to the top-level width/height the resizer owns.
            if (!cfg.width && cfg.data && cfg.data.w) cfg.width = cfg.data.w;
            if (!cfg.height && cfg.data && cfg.data.h) cfg.height = cfg.data.h;
            if (cfg.width) el.style.width = cfg.width + 'px';
            if (cfg.height) el.style.height = cfg.height + 'px';
            cfg.x = x; cfg.y = y;

            var inst = {
                id: instanceId, typeId: typeId, el: el,
                x: x, y: y,
                _pctX: (x / window.innerWidth * 100),
                _pctY: Math.max(0, y / (window.innerHeight - 44) * 100),
                opacity: cfg.opacity, clickThrough: cfg.clickThrough, scale: cfg.scale,
                width: cfg.width, height: cfg.height,
                // Deep-copy the declared data: Object.assign only copies the
                // top level, so nested objects (e.g. sticky-note's notes map)
                // were shared across instances — typing in one note then
                // saving wrote the same content into every instance.
                data: Object.assign({},
                    JSON.parse(JSON.stringify(def.data || {})),
                    {mode: cfg.mode},
                    JSON.parse(JSON.stringify(cfg.data || {}))),
                _timer: null
            };

            // Merge option defaults for keys not present (first enable or old
            // saved data without the option keys)
            if (def.options) {
                Object.keys(def.options).forEach(function(k) {
                    if (inst.data[k] === undefined) inst.data[k] = def.options[k].default;
                });
            }

            var layer = this._getLayer();
            layer.appendChild(el);
            inst._api = this._makeApi(inst);
            // onEnable BEFORE render: a re-opened note must clear its global
            // closed marker first, otherwise render's closed check would
            // immediately disable the fresh instance again. But only for a
            // USER re-open (settings toggle / switcher): a loadConfig
            // restore (_skipSave) is not a re-open — it must respect the
            // global closed flag, which render's closed check enforces.
            if (def && def.onEnable && !_skipSave) { def.onEnable.call(def, inst); }
            // Shared style store (sharedKeys): pull the current values in
            // BEFORE render so the freshly created instance shows the same
            // opacity/clickThrough as every other view.
            if (def && def.sharedKeys && def.restoreShared) { def.restoreShared.call(def, inst); }
            this._render(def, el, inst.data, inst._api);

            if (def.update) {
                // updateInterval: stored per-instance config wins, then the
                // top-level declaration, then 5000ms default
                var interval = (cfg.updateInterval != null) ? cfg.updateInterval :
                    (def.updateInterval || 5000);
                var tick = function() {
                    // Async updates (update returning a Promise) must not
                    // overlap — skip ticks while one is in flight
                    if (inst._updating) return;
                    var p = def.update.call(def, inst.el, inst.data, inst._api);
                    if (p && typeof p.then === 'function') {
                        inst._updating = true;
                        p.catch(function() {}).then(function() { inst._updating = false; });
                    }
                };
                tick();   // first data immediately — don't wait one interval
                inst._timer = setInterval(tick, interval);
            }

            this._makeDraggable(el, instanceId);
            this._makeResizable(el, instanceId, def);
            this.instances[instanceId] = inst;
            var self = this;
            setTimeout(function() { self._clampOne(inst); }, 50);
            if (!_skipSave) this.saveConfig();
            DESKTOP.emit('widget-enabled', {id: instanceId, typeId: typeId});
            console.log('[widget] enable ' + instanceId + ' total=' + this._instancesOf(typeId).length);
        },

        disable: function(instanceId, _skipSave) {
            var inst = this.instances[instanceId];
            if (!inst) return;
            var def = this.registry[inst.typeId];

            if (inst._timer) { clearInterval(inst._timer); inst._timer = null; }
            if (def && def.destroy) { def.destroy.call(def, inst.el, inst.data, inst._api); }
            if (def && def.onDisable) { def.onDisable.call(def, inst); }
            if (inst.el && inst.el.parentNode) { inst.el.parentNode.removeChild(inst.el); }

            // Preserve config before removing instance (mark inactive)
            this._preservedConfigs[instanceId] = this._buildConfig(inst, false);
            console.log('[widget] disable ' + instanceId + ' — config preserved');

            delete this.instances[instanceId];
            // _skipSave: restore-time sync (stickynote syncSlots) must not
            // persist — the in-memory list can be momentarily incomplete
            // and would overwrite UCI (widget-vanishing bug, 0.1.0-128).
            if (!_skipSave) this.saveConfig();
            DESKTOP.emit('widget-disabled', {id: instanceId, typeId: inst.typeId});
        },

        // Disable ALL instances of a type (for backward compat / clear)
        disableAll: function(typeId) {
            var self = this;
            this._instancesOf(typeId).forEach(function(iid) { self.disable(iid); });
        },

        // Per-instance API context passed as 3rd arg to render/update/destroy.
        // One object per instance, created at enable time (inst._api).
        // Uniform render entry: def.render + post-render hooks shared by
        // every widget (currently: applying the `bg` card-background option).
        // Widgets must never call def.render directly — going through here
        // guarantees option-driven presentation stays consistent.
        _render: function(def, el, data, api) {
            def.render.call(def, el, data, api);
            this._applyOptionStyles(def, el, data);
            // render() replaces innerHTML, which wipes the resize handle
            // (a direct child of the instance element). Re-attach it —
            // otherwise the first re-render (option change) silently
            // removes the user's ability to resize.
            if (def.resizable && !el.querySelector('.widget-resize-handle')) {
                this._makeResizable(el, el.getAttribute('data-widget-id'), def);
            }
        },

        // Options with a `style` mapping are applied to the widget element
        // after every render (and cleared when the option is unset).
        // Currently:
        //   bg — card background, applied to the card shell directly
        //   accent — card font accent, exposed as the --widget-accent CSS
        //            variable (title, values and other accentable text all
        //            follow it; see widget.css var(--widget-accent))
        //   fg — font color override, exposed as --widget-fg (replaces the
        //        theme default foreground for this instance's subtree)
        // Widgets declare the options (bg: {...}, accent: {...}, fg: {...})
        // and never write the application code themselves. Widgets that
        // don't declare them (stickynote has its own color system) are
        // never touched.
        _applyOptionStyles: function(def, el, data) {
            if (!def.options) return;
            // Option defaults are the SINGLE source of truth shared with the
            // settings panel swatch (val || opt.default || '#000000'). An
            // empty data value must render the same color the swatch shows —
            // previously it removed the variable, so e.g. an unset accent
            // showed blue #4a90d9 in the panel but currentColor (white) on
            // the card until the user re-picked it. Widgets with an empty
            // default ('' = intentionally unset) still fall back to CSS.
            if (def.options.bg) {
                // Background color as a CSS variable: widget.css consumes
                // it in the color-mix chain alongside --widget-bg-alpha,
                // so the opacity slider fades a custom background too.
                // Set on the root; nested card shells inherit and consume it.
                if (data.bg) el.style.setProperty('--widget-bg-color', data.bg);
                else if (def.options.bg.default) el.style.setProperty('--widget-bg-color', def.options.bg.default);
                else el.style.removeProperty('--widget-bg-color');
            }
            if (def.options.accent) {
                // Accent color: title and values follow --widget-accent
                // (widget.css var(--widget-accent)). Empty data applies the
                // declared default so panel swatch and card agree.
                if (data.accent) el.style.setProperty('--widget-accent', data.accent);
                else if (def.options.accent.default) el.style.setProperty('--widget-accent', def.options.accent.default);
                else el.style.removeProperty('--widget-accent');
            }
            if (def.options.fg) {
                // Font color: overrides --widget-fg (theme default) for this
                // instance's subtree — any text using var(--widget-fg)
                // follows it. Empty data applies the declared default (same
                // as the panel swatch), else restores the theme default.
                if (data.fg) el.style.setProperty('--widget-fg', data.fg);
                else if (def.options.fg.default) el.style.setProperty('--widget-fg', def.options.fg.default);
                else el.style.removeProperty('--widget-fg');
            }
            // Background-aware foreground: when the card bg is a solid
            // color, derive --widget-fg (light bg → dark text, dark bg →
            // light text) plus the border tint and the text-shadow color
            // (inverse of the fg — helps exactly when the card is
            // semi-transparent over a light wallpaper). A widget that
            // declares an fg option owns its font color (the fg block above
            // already applied the user value or its default) — derivation
            // only fills the gaps for widgets without fg (net-traffic,
            // system-info). --widget-shadow-color is deliberately NOT
            // touched: it is the CARD drop shadow (box-shadow), not text.
            var bgHex = data.bg || (def.options.bg && def.options.bg.default) || '';
            var fgOwned = !!(def.options.fg && (data.fg || def.options.fg.default));
            var derived = deriveWidgetColors(bgHex);
            if (derived) {
                // Re-derive on EVERY render: a value that lingers on the
                // element from a previous bg would freeze the old color
                // (dark→light bg leaves white text behind = text melts into
                // the card). The old guard checked the inline style instead.
                if (!fgOwned) {
                    el.style.setProperty('--widget-fg', derived.fg);
                }
                el.style.setProperty('--widget-border', derived.border);
                // Text shadow follows the BACKGROUND (dark card → dark
                // shadow under white text; light card → light shadow under
                // dark text). A user-picked fg may invert the pairing, but
                // that is the user's own contrast choice.
                el.style.setProperty('--widget-text-shadow-color', derived.shadow);
            } else {
                // No usable bg hex (widget without a bg option, e.g.
                // stickynote): keep theme defaults, still clear tints so
                // a previously-derived style never lingers after re-render.
                if (!def.options.fg) el.style.removeProperty('--widget-fg');
                el.style.removeProperty('--widget-border');
                el.style.removeProperty('--widget-text-shadow-color');
            }
            if (def.options.accent) {
                // Accent color: title and values follow --widget-accent.
                // Empty data applies the declared default — the settings
                // panel swatch shows (val || default), so the card must
                // render the same color (parity). A value EQUAL to the
                // declared default counts as "not customized" and follows
                // the (derived) foreground instead.
                if (data.accent) {
                    if (data.accent !== def.options.accent.default) {
                        el.style.setProperty('--widget-accent', data.accent);
                    } else {
                        el.style.removeProperty('--widget-accent');
                    }
                } else if (def.options.accent.default) {
                    el.style.setProperty('--widget-accent', def.options.accent.default);
                } else {
                    el.style.removeProperty('--widget-accent');
                }
            }
        },

        _makeApi: function(inst) {
            var self = this;
            var def = this.registry[inst.typeId];
            return {
                instanceId: inst.id,
                typeId: inst.typeId,
                data: inst.data,
                // Official re-render entry point (widgets must NOT look up
                // WidgetManager.registry[typeId].render themselves)
                rerender: function() { self._render(def, inst.el, inst.data, inst._api); },
                saveConfig: function() { self.saveConfig(); },
                disable: function() { self.disable(inst.id); }
            };
        },

        _buildConfig: function(inst, active) {
            var def = this.registry[inst.typeId];
            var extra = {};
            for (var k in inst.data) {
                if (inst.data.hasOwnProperty(k) && k !== 'mode') extra[k] = inst.data[k];
            }
            var cfg = {
                id: inst.id,
                typeId: inst.typeId,
                x: inst.x, y: inst.y,
                opacity: inst.opacity, clickThrough: inst.clickThrough,
                scale: inst.scale, mode: inst.data.mode,
                width: inst.width, height: inst.height,
                data: extra,
                active: active !== false
            };
            // sharedKeys: style fields owned by the widget's SHARED store
            // (e.g. sticky-note's opacity/clickThrough live in the
            // stickysync entry, not in the per-view config). Drop them
            // from the per-view copy so views can't diverge.
            if (def && def.sharedKeys) {
                for (var i = 0; i < def.sharedKeys.length; i++) {
                    delete cfg[def.sharedKeys[i]];
                }
            }
            return cfg;
        },

        clearPreserved: function(instanceId) {
            var cfg = this._preservedConfigs[instanceId];
            if (cfg) {
                var def = this.registry[cfg.typeId];
                // Clear is the ONLY way to permanently delete widget data
                // (disable/toggle-off preserves it). Widgets holding shared
                // store entries (sticky-note) hook here to delete them.
                if (def && def.onClear) { def.onClear.call(def, cfg); }
            }
            delete this._preservedConfigs[instanceId];
            this.saveConfig();
            console.log('[widget] clearPreserved ' + instanceId);
        },

        // ===== Per-instance controls =====
        setOpacity: function(instanceId, value) {
            var inst = this.instances[instanceId];
            if (!inst) return;
            // `|| 0.7` would turn a real 0 into the default (0 is falsy) —
            // the slider could never reach "fully transparent". Only
            // NaN gets the default.
            var v = parseFloat(value);
            inst.opacity = Math.max(0, Math.min(1.0, isNaN(v) ? 0.7 : v));
            // Background alpha only — the widget's TEXT stays fully
            // opaque (see widget.css background: color-mix chain).
            inst.el.style.setProperty('--widget-bg-alpha', inst.opacity);
            // Mirror onto data-opacity so CSS can hide a fully
            // transparent widget when the "hide at 0%" preference is on.
            inst.el.setAttribute('data-opacity', inst.opacity);
            this.saveConfig();
            // Widgets with a SHARED style store (sharedKeys) forward the
            // change there so every view sees the same value.
            var def = this.registry[inst.typeId];
            if (def && def.sharedKeys && def.onStyleChange) {
                def.onStyleChange.call(def, inst, 'opacity', inst.opacity);
            }
        },
        setClickThrough: function(instanceId, bool) {
            var inst = this.instances[instanceId];
            if (!inst) return;
            inst.clickThrough = !!bool;
            inst.el.style.pointerEvents = inst.clickThrough ? 'none' : 'auto';
            this.saveConfig();
            var def = this.registry[inst.typeId];
            if (def && def.sharedKeys && def.onStyleChange) {
                def.onStyleChange.call(def, inst, 'clickThrough', inst.clickThrough);
            }
        },
        setMode: function(instanceId, mode) {
            var inst = this.instances[instanceId];
            var def = this.registry[inst.typeId];
            if (!inst || !def) return;
            inst.data.mode = mode;
            this._render(def, inst.el, inst.data, inst._api);
            this.saveConfig();
            // Rebuild the settings body so option disabled states that
            // depend on the mode re-evaluate (clock's hideBgAtZero).
            this.refreshSettings();
        },
        setScale: function(instanceId, value) {
            var inst = this.instances[instanceId];
            if (!inst) return;
            inst.scale = Math.max(0.5, Math.min(2.0, parseFloat(value) || 1.0));
            inst.el.style.transform = 'scale(' + inst.scale + ')';
            this.saveConfig();
        },
        setPosition: function(instanceId, x, y) {
            var inst = this.instances[instanceId];
            if (!inst) return;
            inst.x = Math.max(0, x); inst.y = Math.max(0, y);
            inst._pctX = inst.x / window.innerWidth * 100;
            inst._pctY = Math.max(0, inst.y / (window.innerHeight - 44) * 100);
            inst.el.style.left = inst.x + 'px';
            inst.el.style.top = inst.y + 'px';
            this.saveConfig();
        },

        // ===== Config persistence =====
        saveConfig: function() { this._saveToUCI(); },

        loadConfig: function() {
            var data = null;
            try {
                var cfg = (window.LuCIDesktop && LuCIDesktop.getConfig) ? LuCIDesktop.getConfig() : {};
                // Mobile and desktop keep SEPARATE widget configs
                var key = (window.LuCIDesktop && LuCIDesktop.isMobile()) ? 'mobile_widgets' : 'widgets';
                if (cfg[key]) data = cfg[key];
            } catch(e) {}
            if (!data || !data.instances) return;

            var self = this;
            var failed = 0;   // restore failures — see saveConfig guard below
            data.instances.forEach(function(cfg) {
                // Unregistered type (script failed to load / legacy type):
                // count as a restore failure so the write-back below does
                // NOT overwrite the UCI config and erase the widget.
                if (!self.registry[cfg.typeId] && !self.registry[cfg.id]) { failed++; return; }
                var typeId = cfg.typeId || cfg.id;  // backward compat: old format had typeId == id
                if (!self.registry[typeId]) { failed++; return; }

                // Normalize: ensure cfg has typeId and unique id
                if (!cfg.typeId) cfg.typeId = typeId;
                // Old single-ID format: 'sticky-note' → 'sticky-note-1'
                if (cfg.id === typeId) {
                    cfg.id = typeId + '-1';
                }

                // If already enabled (duplicate), store as preserved
                if (self.instances[cfg.id]) return;

                // Only re-enable if it was active when saved
                if (cfg.active !== false) {
                    try { self.enable(typeId, cfg, true); } catch(e) {
                        console.log('[widget] loadConfig error for ' + cfg.id + ': ' + e.message);
                        failed++;
                    }
                } else {
                    self._preservedConfigs[cfg.id] = cfg;
                }
            });

            // NO write-back here (removed 2026-08): the old code saved the
            // restored list right after boot, racing the user's own saves —
            // the boot POST (STALE data, without the widget the user just
            // enabled) could land on the server AFTER the user's POST and
            // overwrite it, so a widget enabled then F5'd vanished from UCI
            // (real bug on 1.1 mobile track, fixed by removing the write-
            // back + serializing _saveToUCI). Normalization is idempotent
            // and happens in memory on every load; nothing needs persisting.
            console.log('[widget] loadConfig: ' + Object.keys(self.instances).length + ' active, ' +
                        Object.keys(self._preservedConfigs).length + ' preserved' +
                        (failed ? ', ' + failed + ' restore FAILED (config kept)' : ''));
        },

        _saveToUCI: function() {
            var data = {instances: []};
            var self = this;

            // Active instances
            for (var iid in this.instances) {
                if (this.instances.hasOwnProperty(iid)) {
                    data.instances.push(this._buildConfig(this.instances[iid], true));
                }
            }

            // Preserved configs
            for (var pid in this._preservedConfigs) {
                if (this._preservedConfigs.hasOwnProperty(pid)) {
                    data.instances.push(this._preservedConfigs[pid]);
                }
            }

            // Update in-page config + POST via the unified access layer
            // (setSection = setSectionLocal DOM write + saveDesktopSection).
            // Single POST only — setSection already persists; the extra
            // saveDesktopSection below was a redundant duplicate (removed
            // 2026-08) that fired two fire-and-forget XHRs per save.
            var key = (LuCIDesktop.isMobile() ? 'mobile_widgets' : 'widgets');
            this._sendSave(key, data);

            console.log('[widget] _saveToUCI: ' + data.instances.length + ' total (active=' +
                        Object.keys(this.instances).length + ' preserved=' + Object.keys(this._preservedConfigs).length + ')');
        },

        // Serialized save (sticky-note pattern, 2026-08): per-view saves
        // must not race each other. Without this, two fire-and-forget POSTs
        // (e.g. boot restore write-back + user enable) could arrive out of
        // order and the STALE one would win — the newer widget vanished
        // from UCI on the next F5 (real bug on 1.1 mobile track). While a
        // POST is in flight the latest data is parked and sent on done().
        // The DOM write (setSectionLocal) ALWAYS happens synchronously —
        // the desktop-config tag is the single-page source of truth, so a
        // parked save must still be visible to loadConfig/re-renders; only
        // the backend POST is serialized.
        _sendSave: function(key, data) {
            var self = this;
            try { LuCIDesktop.setSectionLocal(key, data); } catch(e) {}
            if (this._saveBusy) {
                this._savePending = { key: key, data: data };
                return;
            }
            this._saveBusy = true;
            var done = function() {
                self._saveBusy = false;
                if (self._savePending) {
                    var p = self._savePending;
                    self._savePending = null;
                    self._sendSave(p.key, p.data);
                }
            };
            try {
                var xhr = LuCIDesktop.saveDesktopSection(key, data);
                if (xhr) { xhr.onload = done; xhr.onerror = done; }
                else done();
            } catch(e) { done(); }
        },

        // ===== Settings panel =====
        openSettings: function() {
            var existing = document.getElementById('widget-settings');
            if (existing) existing.remove();

            var panel = document.createElement('div');
            panel.id = 'widget-settings';
            panel.className = 'widget-settings';
            panel.innerHTML = this._buildSettingsHTML();
            panel.addEventListener('mousedown', function(e) { e.stopPropagation(); });
            PanelHelper.makeMovable(panel);
            PanelHelper.makeResizable(panel);
            document.body.appendChild(panel);
            PanelHelper.fadeIn(panel);
            this._bindSettingsEvents(panel);
        },

        closeSettings: function() {
            var panel = document.getElementById('widget-settings');
            if (panel) panel.remove();
        },

        refreshSettings: function() {
            var panel = document.getElementById('widget-settings');
            if (!panel) return;
            // Rebuild body content in-place, preserve header
            var body = panel.querySelector('.widget-settings-body');
            if (!body) return;
            body.innerHTML = '';  // clear old content
            // Rebuild HTML for the body only and rebind
            // _buildSettingsHTML returns full HTML; extract just the body portion
            var full = this._buildSettingsHTML();
            var tmp = document.createElement('div');
            tmp.innerHTML = full;
            var newBody = tmp.querySelector('.widget-settings-body');
            if (newBody) {
                body.innerHTML = newBody.innerHTML;
                this._bindSettingsEvents(panel);
            }
        },

        _buildSettingsHTML: function() {
            var self = this;
            var html = '<div class="widget-settings-header"><h3>' + _('Desktop Widgets') + '</h3>' +
                '<button class="btn-close-settings">✕</button></div>';

            var regIds = Object.keys(this.registry);
            // Tab bar: one tab per REGISTERED widget type — a new widget
            // gets its tab automatically on registration (no hardcoded
            // type list). The active tab lives in _activeSettingsTab and
            // is re-applied on every bind (open + refresh).
            html += '<div class="widget-settings-tabs">';
            regIds.forEach(function(typeId) {
                html += '<button type="button" class="widget-settings-tab" data-tab="' + typeId + '">' +
                    _(self.registry[typeId].name) + '</button>';
            });
            html += '</div><div class="widget-settings-body">';

            if (regIds.length === 0) {
                html += '<p class="widget-settings-empty">No widgets registered.</p>';
            }

            regIds.forEach(function(typeId) {
                var def = self.registry[typeId];
                // Pane content stays in the DOM (visibility toggled via
                // .widget-tab-pane) so async option fills and tests that
                // query hidden panes keep working.
                html += '<div class="widget-tab-pane" data-pane-type="' + typeId + '">';
                var activeIds = self._instancesOf(typeId);
                var preservedIds = [];
                for (var pid in self._preservedConfigs) {
                    if (self._preservedConfigs.hasOwnProperty(pid) && self._preservedConfigs[pid].typeId === typeId) {
                        preservedIds.push(pid);
                    }
                }

                if (def.multi) {
                    // === Multi-instance: fixed slots (1..max), no Add button ===
                    var max = def.maxInstances || 3;
                    html += '<div class="widget-type-group" style="margin-bottom:8px;">' +
                        '<div style="font-size:13px;font-weight:600;color:var(--theme-panel-fg);padding:4px 0;">' +
                        _(def.name) + '</div>';

                    for (var n = 1; n <= max; n++) {
                        var iid = typeId + '-' + n;
                        var inst = self.instances[iid];
                        var cfg = self._preservedConfigs[iid];
                        if (inst) {
                            html += self._buildInstanceRow(typeId, iid, inst, true);
                        } else if (cfg) {
                            html += self._buildInstanceRow(typeId, iid, cfg, false);
                        } else {
                            html += self._buildEmptyRow(typeId, iid);
                        }
                    }
                    // Shared controls for all instances of this type
                    var firstActive = activeIds[0] ? self.instances[activeIds[0]] : null;
                    var sharedOpacity = firstActive ? firstActive.opacity : def.defaults.opacity;
                    var sharedCT = firstActive ? firstActive.clickThrough : def.defaults.clickThrough;
                    if (activeIds.length > 0) {
                        html += '<div class="widget-shared-controls" data-type="' + typeId +
                            '" style="display:flex;align-items:center;gap:8px;padding:4px 8px 4px 26px;font-size:11px;color:var(--theme-panel-muted);">' +
                            '<input type="range" class="widget-opacity-all" min="0" max="1" step="0.05" ' +
                            'value="' + sharedOpacity + '" style="width:80px;" title="' + _('Opacity') + '">' +
                            '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;">' +
                            '<input type="checkbox" class="widget-ct-all"' + (sharedCT ? ' checked' : '') + '>' + _('Click-through') + '</label>' +
                            '</div>';
                    }
                    // Options schema — type-level config, applies to all active instances
                    if (def.options && activeIds.length > 0) {
                        html += self._buildOptionsHTML(def, activeIds);
                    }
                    html += '</div>';
                } else {
                    // === Single-instance layout (no ×, no instance row) ===
                    var iid = activeIds[0];
                    var inst = iid ? self.instances[iid] : null;
                    var hasPreserved = preservedIds.length > 0;
                    var enabled = !!inst;
                    var opacity = inst ? inst.opacity : def.defaults.opacity;
                    var ct = inst ? inst.clickThrough : def.defaults.clickThrough;

                    html += '<div class="widget-settings-item" data-widget-id="' + typeId +
                        '" data-instance="' + (iid || '') + '" data-type="' + typeId + '">' +
                        '<label class="widget-toggle">' +
                        '<input type="checkbox" class="widget-enable-cb"' + (enabled ? ' checked' : '') + '>' +
                        '<span>' + _(def.name) + '</span></label>';

                    if (enabled) {
                        html += '<div style="display:flex;align-items:center;gap:8px;padding:4px 0 4px 26px;font-size:11px;color:var(--theme-panel-muted);">' +
                            '<input type="range" class="widget-opacity" min="0" max="1" step="0.05" value="' + opacity + '" style="width:80px;" title="' + _('Opacity') + '">' +
                            '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;">' +
                            '<input type="checkbox" class="widget-ct"' + (ct ? ' checked' : '') + '>' + _('Click-through') + '</label>';
                        if (def.modes) {
                            html += '<select class="widget-mode" style="font-size:11px;padding:1px 3px;">';
                            Object.keys(def.modes).forEach(function(m) {
                                html += '<option value="' + m + '"' + (m === inst.data.mode ? ' selected' : '') + '>' + _(def.modes[m]) + '</option>';
                            });
                            html += '</select>';
                        }
                        html += '</div>';
                    }

                    // Clear data if preserved — skipped for widgets with no
                    // user content (declare clearable:false, e.g. clock)
                    if (hasPreserved && def.clearable !== false) {
                        html += '<div style="margin-top:4px;margin-left:26px;">' +
                            '<button class="wps-clear-data" data-instance="' + preservedIds[0] +
                            '" style="font-size:10px;padding:2px 8px;background:#e74c3c;color:#fff;' +
                            'border:none;border-radius:3px;cursor:pointer;">' + _('Clear data') + '</button></div>';
                    }

                    // Options schema
                    if (def.options && inst) {
                        html += self._buildOptionsHTML(def, [iid]);
                    }

                    html += '</div>';
                }

                html += '</div>';   // close .widget-tab-pane
            });

            html += '</div>';
            return html;
        },

        // Show the active settings tab. Defaults to _activeSettingsTab
        // (remembered across refreshes — and panel re-opens) or the first
        // registered widget. Hidden panes stay in the DOM (display:none),
        // so loadOptions fills and tests querying them keep working.
        _applyActiveSettingsTab: function(panel) {
            var regIds = Object.keys(this.registry);
            var active = this._activeSettingsTab;
            if (regIds.indexOf(active) === -1) active = regIds[0] || null;
            this._activeSettingsTab = active;
            panel.querySelectorAll('.widget-settings-tab').forEach(function(btn) {
                btn.classList.toggle('active', btn.getAttribute('data-tab') === active);
            });
            panel.querySelectorAll('.widget-tab-pane').forEach(function(pane) {
                pane.style.display = (pane.getAttribute('data-pane-type') === active) ? '' : 'none';
            });
        },

        _buildInstanceRow: function(typeId, instanceId, obj, active) {
            var def = this.registry[typeId];
            var num = '';
            if (instanceId.indexOf(typeId + '-') === 0) num = instanceId.substring(typeId.length + 1);
            var label = _(def.name) + ' ' + num;

            var html = '<div class="widget-instance-row" data-instance="' + instanceId +
                '" data-type="' + typeId + '" style="display:flex;align-items:center;gap:4px;' +
                'padding:6px 8px;margin:1px 0;border-radius:6px;' +
                'background:' + (active ? 'rgba(74,144,217,0.08)' : 'rgba(255,255,255,0.02)') + ';">' +
                '<input type="checkbox" class="widget-enable-cb"' + (active ? ' checked' : '') +
                ' style="flex-shrink:0;margin:0;">' +
                '<span style="flex:1;font-size:12px;color:var(--theme-panel-fg);' + (active ? '' : 'opacity:0.5;') + '">' +
                label + '</span>';

            if (active) {
                html += '<button class="wps-close-instance" data-instance="' + instanceId +
                    '" title="' + _('Close') + '" style="background:none;border:none;font-size:14px;' +
                    'cursor:pointer;opacity:0.4;line-height:1;padding:0 2px;color:var(--theme-panel-fg);">&times;</button>';
            } else {
                html += '<button class="wps-clear-data" data-instance="' + instanceId +
                    '" title="' + _('Permanently delete all content in this note') + '" style="font-size:10px;padding:1px 6px;' +
                    'background:#e74c3c;color:#fff;border:none;border-radius:3px;cursor:pointer;">' + _('Clear') + '</button>';
            }

            html += '</div>';
            return html;
        },

        _buildEmptyRow: function(typeId, instanceId) {
            var num = '';
            if (instanceId.indexOf(typeId + '-') === 0) num = instanceId.substring(typeId.length + 1);
            var label = _(this.registry[typeId].name) + ' ' + num;
            return '<div class="widget-instance-row" data-instance="' + instanceId +
                '" data-type="' + typeId + '" style="margin:2px 0;border-radius:6px;' +
                'background:rgba(255,255,255,0.02);padding:6px 8px;' +
                'display:flex;align-items:center;gap:4px;">' +
                '<input type="checkbox" class="widget-enable-cb" style="flex-shrink:0;margin:0;">' +
                '<span style="flex:1;font-size:12px;color:var(--theme-panel-muted);">' + label + '</span>' +
                '</div>';
        },

        // Settings panel controls generated from the widget's options schema.
        // Values live in each instance's data[key]; controls show the first
        // active instance's value and writes apply to all active instances
        // (type-level config).
        _buildOptionsHTML: function(def, activeIds) {
            var self = this;
            var inst = this.instances[activeIds[0]];
            var html = '<div class="widget-options" data-type="' + def.id +
                '" style="margin:4px 0 4px 26px;display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--theme-panel-muted);">';
            Object.keys(def.options).forEach(function(key) {
                var opt = def.options[key];
                var val = inst.data[key];
                var label = (opt.label != null) ? _(opt.label) : key;
                switch (opt.type) {
                    case 'number':
                        html += '<label style="display:flex;align-items:center;gap:6px;"><span style="flex:1;">' + label + '</span>' +
                            '<input type="number" data-option-key="' + key + '"' +
                            (opt.min != null ? ' min="' + opt.min + '"' : '') +
                            (opt.max != null ? ' max="' + opt.max + '"' : '') +
                            ' step="' + (opt.step != null ? opt.step : 1) + '"' +
                            ' value="' + (val === undefined || val === null ? '' : val) + '"' +
                            ' style="width:70px;"></label>';
                        break;
                    case 'checkbox':
                        // opt.disabled: static boolean or a function of the
                        // instance data (e.g. clock's hideBgAtZero only
                        // applies in digital mode).
                        var disabled = typeof opt.disabled === 'function'
                            ? opt.disabled(inst.data) : !!opt.disabled;
                        html += '<label style="display:flex;align-items:center;gap:6px;' +
                            (disabled ? 'opacity:0.5;cursor:not-allowed;' : 'cursor:pointer;') + '">' +
                            '<input type="checkbox" data-option-key="' + key + '"' + (val ? ' checked' : '') +
                            (disabled ? ' disabled' : '') + '>' + label + '</label>';
                        break;
                    case 'select':
                        html += '<label style="display:flex;align-items:center;gap:6px;"><span style="flex:1;">' + label + '</span>' +
                            '<select data-option-key="' + key + '"' + (opt.loadOptions ? ' data-load-options="1"' : '') + '>';
                        var listed = false;
                        Object.keys(opt.options || {}).forEach(function(v) {
                            if (String(val) === v) listed = true;
                            html += '<option value="' + v + '"' + (String(val) === v ? ' selected' : '') + '>' + _(opt.options[v]) + '</option>';
                        });
                        // The persisted value may not be in the static list
                        // (dynamic ifaces like pppoe-wan vs the {wan,lan}
                        // placeholder). Without this fallback the select
                        // silently shows the FIRST option — and the async
                        // fill later reads that wrong value as "current",
                        // so the user's choice is lost on every panel open.
                        if (val !== undefined && val !== null && val !== '' && !listed) {
                            html += '<option value="' + String(val) + '" selected>' + String(val) + '</option>';
                        }
                        html += '</select></label>';
                        break;
                    case 'color':
                        html += '<label style="display:flex;align-items:center;gap:6px;"><span style="flex:1;">' + label + '</span>' +
                            '<input type="color" data-option-key="' + key + '" value="' + (val || opt.default || '#000000') + '"></label>';
                        break;
                    default: // text
                        html += '<label style="display:flex;align-items:center;gap:6px;"><span style="flex:1;">' + label + '</span>' +
                            '<input type="text" data-option-key="' + key + '" value="' +
                            (val === undefined || val === null ? '' : String(val).replace(/"/g, '&quot;')) +
                            '" style="width:120px;"></label>';
                }
            });
            html += '</div>';
            return html;
        },

        _bindSettingsEvents: function(panel) {
            var self = this;
            panel.querySelector('.btn-close-settings').addEventListener('click', function() { self.closeSettings(); });

            // Tab switching (one tab per registered widget type)
            panel.querySelectorAll('.widget-settings-tab').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    self._activeSettingsTab = btn.getAttribute('data-tab');
                    self._applyActiveSettingsTab(panel);
                });
            });

            // Enable/disable toggle (per instance or single-instance)
            panel.querySelectorAll('.widget-enable-cb').forEach(function(cb) {
                cb.addEventListener('change', function() {
                    var row = cb.closest('.widget-instance-row') || cb.closest('.widget-settings-item');
                    var iid = row.getAttribute('data-instance');
                    var typeId = row.getAttribute('data-type');
                    if (cb.checked) {
                        if (iid) { self.enable(typeId, {id: iid}); }
                        else { self.enable(typeId); }
                    } else {
                        if (iid) { self.disable(iid); }
                    }
                    self.refreshSettings();
                });
            });

            // Close instance (disable)
            panel.querySelectorAll('.wps-close-instance').forEach(function(btn) {
                btn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var iid = btn.getAttribute('data-instance');
                    self.disable(iid);
                    self.refreshSettings();
                });
            });

            // Clear preserved data
            panel.querySelectorAll('.wps-clear-data').forEach(function(btn) {
                btn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var iid = btn.getAttribute('data-instance');
                    if (confirm(_('PERMANENTLY DELETE all content in ') + iid + _('?\n\nThis cannot be undone.'))) {
                        self.clearPreserved(iid);
                        self.refreshSettings();
                    }
                });
            });

            // Options schema controls (data-option-key)
            panel.querySelectorAll('[data-option-key]').forEach(function(input) {
                var evt = (input.tagName === 'SELECT' || input.type === 'checkbox') ? 'change' : 'input';
                input.addEventListener(evt, function() {
                    var group = input.closest('.widget-options');
                    if (!group) return;
                    var typeId = group.getAttribute('data-type');
                    var key = input.getAttribute('data-option-key');
                    var def = self.registry[typeId];
                    if (!def || !def.options || !def.options[key]) return;
                    var v;
                    if (input.type === 'checkbox') v = input.checked;
                    else if (input.type === 'number') v = (input.value === '') ? null : parseFloat(input.value);
                    else v = input.value;
                    self._instancesOf(typeId).forEach(function(iid) {
                        var inst = self.instances[iid];
                        if (inst) inst.data[key] = v;
                    });
                    self.saveConfig();
                    // Default: re-render the widget so the change applies.
                    // opt.apply === false means "store only" (e.g. interval
                    // tweaks picked up by the next update tick).
                    if (!(def.options[key].apply === false)) {
                        self._instancesOf(typeId).forEach(function(iid) {
                            var inst = self.instances[iid];
                            if (inst) self._render(def, inst.el, inst.data, inst._api);
                        });
                    }
                });
            });

            // Shared opacity slider (applies to all instances of type)
            panel.querySelectorAll('.widget-opacity-all').forEach(function(slider) {
                slider.addEventListener('input', function() {
                    var typeId = slider.closest('.widget-shared-controls').getAttribute('data-type');
                    var val = parseFloat(slider.value);
                    self._instancesOf(typeId).forEach(function(iid) { self.setOpacity(iid, val); });
                });
            });

            // Shared click-through toggle (applies to all instances of type)
            panel.querySelectorAll('.widget-ct-all').forEach(function(cb) {
                cb.addEventListener('change', function() {
                    var typeId = cb.closest('.widget-shared-controls').getAttribute('data-type');
                    self._instancesOf(typeId).forEach(function(iid) { self.setClickThrough(iid, cb.checked); });
                });
            });

            // Per-instance opacity slider
            panel.querySelectorAll('.widget-opacity').forEach(function(slider) {
                slider.addEventListener('input', function() {
                    var row = slider.closest('.widget-instance-row') || slider.closest('.widget-settings-item');
                    var iid = row.getAttribute('data-instance');
                    if (iid) self.setOpacity(iid, parseFloat(slider.value));
                });
            });

            // Dynamic select options (loadOptions): fill asynchronously
            // after the panel opens, keeping the current selection.
            // A rejected/null load keeps the static options untouched.
            panel.querySelectorAll('select[data-option-key][data-load-options]').forEach(function(sel) {
                var group = sel.closest('.widget-options');
                if (!group) return;
                var def = self.registry[group.getAttribute('data-type')];
                var opt = def && def.options && def.options[sel.getAttribute('data-option-key')];
                if (!opt || typeof opt.loadOptions !== 'function') return;
                Promise.resolve(opt.loadOptions()).then(function(list) {
                    if (!list || typeof list !== 'object') return;
                    var cur = sel.value;
                    var html = '';
                    var listed = false;
                    Object.keys(list).forEach(function(v) {
                        if (String(cur) === v) listed = true;
                        html += '<option value="' + v + '"' + (String(cur) === v ? ' selected' : '') + '>' + list[v] + '</option>';
                    });
                    // Current value absent from the live list (ppp iface
                    // down, interface momentarily missing): keep it as a
                    // selected entry instead of falling back to the first.
                    if (cur && !listed) {
                        html += '<option value="' + String(cur) + '" selected>' + String(cur) + '</option>';
                    }
                    sel.innerHTML = html;
                    if (cur && listed) sel.value = cur;
                }).catch(function() { /* keep static options on failure */ });
            });

            // Mode selector
            panel.querySelectorAll('.widget-mode').forEach(function(sel) {
                sel.addEventListener('change', function() {
                    var row = sel.closest('.widget-instance-row') || sel.closest('.widget-settings-item');
                    var iid = row.getAttribute('data-instance');
                    if (iid) self.setMode(iid, sel.value);
                });
            });

            // Click-through toggle
            panel.querySelectorAll('.widget-ct').forEach(function(cb) {
                cb.addEventListener('change', function() {
                    var row = cb.closest('.widget-instance-row') || cb.closest('.widget-settings-item');
                    var iid = row.getAttribute('data-instance');
                    if (iid) self.setClickThrough(iid, cb.checked);
                });
            });

            panel.addEventListener('keydown', function(e) { if (e.key === 'Escape') self.closeSettings(); });

            // Show the restored (or default) active tab. Runs on every
            // bind — open AND refresh (rebuild) — so the pane display
            // state and tab highlight always match _activeSettingsTab.
            self._applyActiveSettingsTab(panel);
        },

        // ===== Dragging =====
        _makeDraggable: function(el, id) {
            el.style.cursor = 'grab';
            if (!DESKTOP || !DESKTOP.isMobile()) return;
            // Mobile: long-press (500ms) enters drag mode; short taps keep
            // normal interaction (editing a sticky note etc.)
            var longTimer = null, dragging = false, sx = 0, sy = 0, inst = null;
            el.addEventListener('touchstart', function(e) {
                if (e.touches.length !== 1) return;
                inst = WidgetManager.instances[id];
                if (!inst) return;
                sx = e.touches[0].clientX; sy = e.touches[0].clientY;
                longTimer = setTimeout(function() {
                    dragging = true;
                    el.classList.add('widget-dragging');
                    el.style.pointerEvents = 'auto';
                }, 500);
            }, {passive: true});
            el.addEventListener('touchmove', function(e) {
                if (!dragging || !inst) return;
                e.preventDefault();
                var dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
                WidgetManager.setPosition(id, inst.x + dx, inst.y + dy);
                sx = e.touches[0].clientX; sy = e.touches[0].clientY;
            }, {passive: false});
            var endDrag = function() {
                if (longTimer) { clearTimeout(longTimer); longTimer = null; }
                if (dragging) {
                    dragging = false;
                    el.classList.remove('widget-dragging');
                    WidgetManager.saveConfig();
                    inst = null;
                }
            };
            el.addEventListener('touchend', endDrag);
            el.addEventListener('touchcancel', endDrag);
        },

        // ===== Resizing =====
        // Opt-in per widget (def.resizable): bottom-right handle that
        // drags the instance's px width/height. Desktop: mousedown chain
        // on document (like the drag); mobile: direct touch — the handle's
        // touchstart stopPropagation keeps the long-press widget drag from
        // starting too. Sizes persist via _buildConfig width/height.
        // clickThrough widgets are pointer-events:none, but the handle
        // forces pointer-events:auto (CSS), so it stays grabbable.
        //
        // Drag floors are the card's NATURAL content size, measured at drag
        // start (fill-height rule temporarily off, restored before paint).
        // A fixed floor breaks the cards: system-info is ~4 rows (~130px,
        // a 120px floor clips its rows) while net-traffic is 2 rows (~90px,
        // a 120px floor dead-ends in empty card). Falls back to 140×120
        // for resizable widgets without a .widget-card/.widget-sysinfo.
        _makeResizable: function(el, id, def) {
            if (!def.resizable) return;
            el.setAttribute('data-resizable', '1');
            var handle = document.createElement('div');
            handle.className = 'widget-resize-handle';
            handle.title = _('Resize');
            el.appendChild(handle);

            var inst = null, active = false, startW = 0, startH = 0, sx = 0, sy = 0;
            var minW = 140, minH = 120;
            var applySize = function(cx, cy) {
                if (!inst) return;
                var w = Math.max(minW, Math.round(startW + (cx - sx)));
                var h = Math.max(minH, Math.round(startH + (cy - sy)));
                inst.width = w; inst.height = h;
                inst.el.style.width = w + 'px';
                inst.el.style.height = h + 'px';
            };
            var end = function() {
                if (!active) return;
                active = false;
                WidgetManager.saveConfig();
            };
            var onMove = function(e) { applySize(e.clientX, e.clientY); };
            var onUp = function() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                end();
            };
            var begin = function(cx, cy) {
                inst = WidgetManager.instances[id];
                if (!inst) return;
                var card = el.querySelector('.widget-card, .widget-sysinfo');
                minW = 140; minH = 120;
                if (card) {
                    var oldD = card.style.display, oldW = card.style.width, oldH = card.style.height;
                    // inline-block: width:auto is shrink-to-fit content —
                    // as a block it fills the (already resized) parent, so
                    // the floor would lock to the CURRENT width and the
                    // card could never shrink again after widening.
                    card.style.display = 'inline-block';
                    card.style.width = 'auto';
                    card.style.height = 'auto';
                    if (card.offsetWidth > 0) minW = card.offsetWidth;
                    if (card.offsetHeight > 0) minH = card.offsetHeight;
                    card.style.display = oldD;
                    card.style.width = oldW;
                    card.style.height = oldH;
                }
                active = true;
                startW = inst.width || inst.el.offsetWidth || 200;
                startH = inst.height || inst.el.offsetHeight || 150;
                sx = cx; sy = cy;
            };
            handle.addEventListener('mousedown', function(e) {
                if (e.button !== 0) return;
                e.stopPropagation(); e.preventDefault();
                begin(e.clientX, e.clientY);
                if (!active) return;
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
            handle.addEventListener('touchstart', function(e) {
                e.stopPropagation(); e.preventDefault();
                if (e.touches.length !== 1) return;
                begin(e.touches[0].clientX, e.touches[0].clientY);
            }, {passive: false});
            handle.addEventListener('touchmove', function(e) {
                if (!active) return;
                e.preventDefault(); e.stopPropagation();
                applySize(e.touches[0].clientX, e.touches[0].clientY);
            }, {passive: false});
            handle.addEventListener('touchend', end);
            handle.addEventListener('touchcancel', end);
        },

        _getLayer: function() {
            var layer = document.getElementById('widget-layer');
            if (!layer) {
                layer = document.createElement('div');
                layer.id = 'widget-layer';
                var desktop = document.getElementById('desktop');
                if (desktop) { desktop.appendChild(layer); } else { document.body.appendChild(layer); }
            }
            return layer;
        },

        init: function() { window.addEventListener('resize', this._clampOnResize.bind(this)); },

        _clampOne: function(inst) {
            if (!inst || !inst.el) return;
            var w = inst.el.offsetWidth || 160, h = inst.el.offsetHeight || 200;
            var margin = 20;
            var maxX = Math.max(margin, window.innerWidth - w - margin);
            var maxY = Math.max(margin, window.innerHeight - 44 - h - margin);
            var x = Math.max(0, Math.min(inst.x, maxX));
            var y = Math.max(0, Math.min(inst.y, maxY));
            if (x !== inst.x || y !== inst.y) { inst.x = x; inst.y = y;
                inst.el.style.left = x + 'px'; inst.el.style.top = y + 'px'; }
        },

        _clampOnResize: function() {
            var self = this;
            for (var iid in this.instances) {
                if (this.instances.hasOwnProperty(iid)) self._clampOne(self.instances[iid]);
            }
        },

        _loadAll: function() { this.loadConfig(); }
    };

    var dragState = null;
    document.addEventListener('mousedown', function(e) {
        var widgetEl = e.target.closest('.widget-instance');
        if (!widgetEl) return;
        var iid = widgetEl.getAttribute('data-widget-id');
        var inst = WidgetManager.instances[iid];
        if (!inst) return;
        dragState = { id: iid, startX: e.clientX, startY: e.clientY, origX: inst.x, origY: inst.y };
        widgetEl.style.pointerEvents = 'auto';
    });
    document.addEventListener('mousemove', function(e) {
        if (!dragState) return;
        var dx = e.clientX - dragState.startX, dy = e.clientY - dragState.startY;
        WidgetManager.setPosition(dragState.id, dragState.origX + dx, dragState.origY + dy);
    });
    document.addEventListener('mouseup', function() {
        if (!dragState) return;
        var inst = WidgetManager.instances[dragState.id];
        if (inst && inst.clickThrough) inst.el.style.pointerEvents = 'none';
        dragState = null;
        WidgetManager.saveConfig();
    });

    DESKTOP.register('widget', WidgetManager);
    window.WidgetManager = WidgetManager;
})();
