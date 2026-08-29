/* icon-picker.js — desktop icon chooser modal (right-click "Change icon")
 *
 * Adapted from the reference picker (2026-08-29) with theme integration:
 *   - data source is the FULL LuCIDesktop.IconConfig catalog (122 icons)
 *   - DOM is built on demand (single overlay instance), styled via
 *     files/htdocs/css/icon-picker.css using theme CSS variables
 *   - selection is reported back through options.onSelect(iconId) — the
 *     caller (desktop.js) persists it to UCI desktop.icon_choices
 *
 * Usage:
 *   LuCIDesktop.IconPicker.open({
 *       url: '/cgi-bin/luci/admin/status/overview',
 *       currentId: 'overview',          // pre-selected icon id (or null)
 *       onSelect: function(iconId) {}   // called on confirm; null = nothing
 *   });
 */
(function() {
    'use strict';

    var DESKTOP = window.LuCIDesktop;
    if (!DESKTOP) { console.error('icon-picker.js: LuCIDesktop namespace not found'); return; }

    var overlay = null;      // single modal instance
    var state = null;        // current picker session

    function esc(s) {
        var d = document.createElement('div');
        d.textContent = s == null ? '' : String(s);
        return d.innerHTML;
    }

    function build() {
        overlay = document.createElement('div');
        overlay.className = 'icon-picker-overlay';
        overlay.innerHTML =
            '<div class="icon-picker-panel" role="dialog" aria-modal="true">' +
                '<div class="icon-picker-header">' +
                    '<span class="icon-picker-title">🎨 ' + (DESKTOP._t ? DESKTOP._t('Change Icon') : 'Change Icon') +
                        ' <small>' + (DESKTOP._t ? DESKTOP._t('Click an icon to select') : 'Click an icon to select') + '</small></span>' +
                    '<button class="icon-picker-close" aria-label="close">✕</button>' +
                '</div>' +
                '<div class="icon-picker-search"><input type="text" placeholder="🔍 ' +
                    (DESKTOP._t ? DESKTOP._t('Search icon name or ID...') : 'Search icon name or ID...') + '" /></div>' +
                '<div class="icon-picker-tabs"></div>' +
                '<div class="icon-picker-grid-wrap"><div class="icon-picker-grid"></div></div>' +
                '<div class="icon-picker-footer">' +
                    '<span class="icon-picker-current">' + (DESKTOP._t ? DESKTOP._t('Current:') : 'Current:') + ' <strong></strong></span>' +
                    '<div class="icon-picker-actions">' +
                        '<button class="icon-picker-btn icon-picker-cancel">' + (DESKTOP._t ? DESKTOP._t('Cancel') : 'Cancel') + '</button>' +
                        '<button class="icon-picker-btn icon-picker-primary icon-picker-confirm">✓ ' + (DESKTOP._t ? DESKTOP._t('Confirm') : 'Confirm') + '</button>' +
                    '</div>' +
                '</div>' +
            '</div>';
        document.body.appendChild(overlay);
        return overlay;
    }

    function catalog() {
        return (DESKTOP.IconConfig && DESKTOP.IconConfig.icons) || [];
    }

    function categoriesOf() {
        var seen = [], out = [];
        catalog().forEach(function(ic) {
            if (seen.indexOf(ic.category) === -1) { seen.push(ic.category); out.push(ic.category); }
        });
        return out;
    }

    function renderTabs(container) {
        var cats = ['all'].concat(categoriesOf());
        container.innerHTML = '';
        cats.forEach(function(cat) {
            var btn = document.createElement('button');
            btn.className = 'icon-picker-tab' + (cat === state.category ? ' active' : '');
            btn.dataset.category = cat;
            btn.textContent = cat === 'all' ? '📌 ' + (DESKTOP._t ? DESKTOP._t('All') : 'All') : cat;
            btn.addEventListener('click', function() {
                state.category = cat;
                container.querySelectorAll('.icon-picker-tab').forEach(function(b) { b.classList.toggle('active', b === btn); });
                renderGrid();
            });
            container.appendChild(btn);
        });
    }

    function renderGrid() {
        var grid = overlay.querySelector('.icon-picker-grid');
        var list = catalog().filter(function(ic) {
            if (state.category !== 'all' && ic.category !== state.category) return false;
            if (state.query) {
                var q = state.query.toLowerCase();
                if (ic.id.toLowerCase().indexOf(q) === -1 &&
                    ic.title.toLowerCase().indexOf(q) === -1 &&
                    ic.emoji.indexOf(q) === -1) return false;
            }
            return true;
        });

        if (list.length === 0) {
            grid.innerHTML = '<div class="icon-picker-empty">🔍 ' + (DESKTOP._t ? DESKTOP._t('No matching icons') : 'No matching icons') + '</div>';
            return;
        }

        var html = '';
        list.forEach(function(ic) {
            html += '<div class="icon-picker-option' + (ic.id === state.selectedId ? ' selected' : '') + '" data-id="' + esc(ic.id) + '">' +
                '<span class="icon-picker-emoji">' + ic.emoji + '</span>' +
                '<span class="icon-picker-title">' + esc(ic.title) + '</span>' +
                '<span class="icon-picker-id">' + esc(ic.id) + '</span>' +
            '</div>';
        });
        grid.innerHTML = html;

        grid.querySelectorAll('.icon-picker-option').forEach(function(el) {
            el.addEventListener('click', function() {
                state.selectedId = el.dataset.id;
                grid.querySelectorAll('.icon-picker-option').forEach(function(o) { o.classList.toggle('selected', o === el); });
                var found = findIcon(state.selectedId);
                if (found) {
                    overlay.querySelector('.icon-picker-current strong').textContent = found.emoji + ' ' + found.title;
                }
            });
        });
    }

    function findIcon(id) {
        var list = catalog();
        for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
        return null;
    }

    function open(options) {
        options = options || {};
        var icons = catalog();
        if (icons.length === 0) { console.warn('[IconPicker] no icon catalog'); return; }

        // Rebuild if the singleton was removed from the DOM (e.g. tests
        // or a framework that clears body) — open() must never target a
        // detached node.
        if (!overlay || !document.body.contains(overlay)) {
            overlay = build();
        }
        state = {
            url: options.url || '',
            currentId: options.currentId || null,
            selectedId: options.currentId || null,
            category: 'all',
            query: '',
            onSelect: options.onSelect || null
        };

        var current = findIcon(state.currentId);
        overlay.querySelector('.icon-picker-current strong').textContent =
            current ? current.emoji + ' ' + current.title : '—';
        overlay.querySelector('.icon-picker-search input').value = '';

        renderTabs(overlay.querySelector('.icon-picker-tabs'));
        renderGrid();

        overlay.classList.add('open');
        setTimeout(function() {
            var inp = overlay.querySelector('.icon-picker-search input');
            if (inp && inp.focus) inp.focus();
        }, 60);
    }

    function close() {
        if (overlay) overlay.classList.remove('open');
        state = null;
    }

    function confirm() {
        if (!state) return;
        var id = state.selectedId;
        var fn = state.onSelect;
        close();
        if (fn) fn(id);
    }

    // ---- events (bound once) ----
    document.addEventListener('click', function(e) {
        if (!overlay || !state) return;
        if (e.target === overlay) close();                       // backdrop
        else if (e.target.closest('.icon-picker-close')) close();
        else if (e.target.closest('.icon-picker-cancel')) close();
        else if (e.target.closest('.icon-picker-confirm')) confirm();
    });

    document.addEventListener('keydown', function(e) {
        if (!overlay || !state || !overlay.classList.contains('open')) return;
        if (e.key === 'Escape') close();
        else if (e.key === 'Enter') confirm();
    });

    document.addEventListener('input', function(e) {
        if (!overlay || !state) return;
        if (e.target.closest('.icon-picker-search')) {
            state.query = e.target.value;
            renderGrid();
        }
    }, true);

    DESKTOP.IconPicker = { open: open, close: close };
})();
