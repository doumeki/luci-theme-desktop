/* Desktop Theme - Desktop state store
 *
 * Owns the three module-level mutable stores shared by the desktop icon
 * rendering, the context menus and the custom-URL helpers:
 *   pinnedItems  (UCI desktop.pins / mobile_pins)
 *   hiddenIcons  (UCI desktop.hidden / mobile_hidden)
 *   iconLayout   (UCI desktop.icon_layout)
 * plus their load / save / normalize / migration.
 *
 * Other modules read and write them through LuCIDesktop.desktopState
 * accessors (pins()/setPins(), hidden()/setHidden(), layout()/setLayout())
 * so a reassignment in load()/cleanGhostApps() is never hidden behind a
 * stale closed-over reference.
 */
(function() {
    'use strict';

    var DESKTOP = window.LuCIDesktop;
    if (!DESKTOP) { console.error('desktop-state.js: LuCIDesktop namespace not found'); return; }

    var pinnedItems = [];
    var hiddenIcons = [];
    // Icon layout (UCI desktop.icon_layout): url -> {
    //   icon:    user-chosen icon id (optional; overrides the automatic
    //            url->icon mapping from icon-url-map.js, which serves as
    //            the default when unset — not persisted, follows updates)
    //   desktop: {col, row} grid cell indices on the desktop
    //   mobile:  {col, row} reserved for a future mobile layout
    // }
    var iconLayout = {};

    // ===== Config (all UCI-based, no localStorage) =====
    // Mobile and desktop keep SEPARATE pin/widget configs (mobile_pins etc.)
    function configSection(base) {
        return LuCIDesktop.isMobile() ? 'mobile_' + base : base;
    }

    // Normalize an icon layout entry to v2 shape:
    //   {col,row,icon} (v1) -> {icon, desktop:{col,row}, mobile:{col,row}}
    function normalizeLayout(map) {
        var out = {};
        Object.keys(map || {}).forEach(function(u) {
            var e = map[u] || {};
            var entry = {};
            if (e.icon) entry.icon = e.icon;
            if (e.desktop && typeof e.desktop.col === 'number') {
                entry.desktop = { col: e.desktop.col, row: e.desktop.row };
            } else if (typeof e.col === 'number') {
                entry.desktop = { col: e.col, row: e.row || 0 };
            }
            if (e.mobile && typeof e.mobile.col === 'number') {
                entry.mobile = { col: e.mobile.col, row: e.mobile.row };
            }
            if (Object.keys(entry).length > 0) out[u] = entry;
        });
        return out;
    }

    function loadConfig() {
        try {
            var c = LuCIDesktop.getConfig();
            if (LuCIDesktop.isMobile()) {
                if (c.mobile_pins) pinnedItems = c.mobile_pins;
                if (c.mobile_hidden) hiddenIcons = c.mobile_hidden;
                // The icon layout (user icon choice + positions) is SHARED
                // across desktop and mobile — saved under plain
                // 'icon_layout' (the mobile slot lives inside each entry).
                // Without this, a mobile icon choice vanished on reload.
                if (c.icon_layout && typeof c.icon_layout === 'object') {
                    iconLayout = normalizeLayout(c.icon_layout);
                }
            } else {
                if (c.pins) pinnedItems = c.pins;
                if (c.hidden_icons) hiddenIcons = c.hidden_icons;
                if (c.icon_layout && typeof c.icon_layout === 'object') {
                    iconLayout = normalizeLayout(c.icon_layout);
                } else {
                    // One-time migration: legacy icon_positions + icon_choices
                    // merge into the single icon_layout map.
                    var legacy = {};
                    if (c.icon_positions && typeof c.icon_positions === 'object') {
                        Object.keys(c.icon_positions).forEach(function(u) {
                            legacy[u] = { desktop: { col: c.icon_positions[u].col, row: c.icon_positions[u].row } };
                        });
                    }
                    if (c.icon_choices && typeof c.icon_choices === 'object') {
                        Object.keys(c.icon_choices).forEach(function(u) {
                            legacy[u] = legacy[u] || {};
                            legacy[u].icon = c.icon_choices[u];
                        });
                    }
                    iconLayout = normalizeLayout(legacy);
                    if (Object.keys(iconLayout).length > 0) saveIconLayout();
                }
            }
        } catch(e) {}
    }

    // INVARIANT: every store has TWO sources of truth — the module-level
    // variable above and the per-tab #desktop-config JSON (the DOM/cache
    // that loadConfig() reads back). Every save MUST write the store back
    // to the tab state (setSectionLocal, no POST) BEFORE the backend POST,
    // otherwise a later load()/reloadConfig() resurrects the stale DOM
    // value and the next save persists it over UCI.
    function savePins() {
        try { LuCIDesktop.setSectionLocal(configSection('pins'), pinnedItems); } catch(e) {}
        LuCIDesktop.saveDesktopSection(configSection('pins'), pinnedItems);
    }

    // Icon layout persistence (drag position + icon choice, one map).
    // icon_layout is a desktop-only UCI section but a SHARED map (the
    // mobile slot lives inside each entry), so it is not configSection()'d.
    function saveIconLayout() {
        try { LuCIDesktop.setSectionLocal('icon_layout', iconLayout); } catch(e) {}
        LuCIDesktop.saveDesktopSection('icon_layout', iconLayout);
    }

    function saveHidden() {
        // Update in-page config immediately (DOM only — backend POST below).
        // NOTE: the API section and the DOM/config key DIFFER on desktop
        // ("hidden" vs "hidden_icons") — do not collapse them to one name.
        try {
            if (LuCIDesktop.isMobile()) LuCIDesktop.setSectionLocal('mobile_hidden', hiddenIcons);
            else LuCIDesktop.setSectionLocal('hidden_icons', hiddenIcons);
        } catch(e) {}
        LuCIDesktop.saveDesktopSection(configSection('hidden'), hiddenIcons);
    }

    DESKTOP.desktopState = {
        // Live stores — mutate in place or reassign via the setters.
        pins: function() { return pinnedItems; },
        setPins: function(v) { pinnedItems = v; },
        hidden: function() { return hiddenIcons; },
        setHidden: function(v) { hiddenIcons = v; },
        layout: function() { return iconLayout; },
        setLayout: function(v) { iconLayout = v; },

        configSection: configSection,
        normalizeLayout: normalizeLayout,
        load: loadConfig,
        savePins: savePins,
        saveHidden: saveHidden,
        saveIconLayout: saveIconLayout
    };
})();
