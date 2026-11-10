/* addr-quick (0.1.0-312): the titlebar address strip becomes an app
 * search (type-to-launch).
 *
 * Click the address bar of ANY window, type a keyword ("ddns"...):
 * matching apps appear as plain-text rows (category + app name) read
 * LIVE from the dynamic menu JSON (window.LuCIMenuData, injected by
 * the desktop header on every page; same source the start menu uses).
 * Launching reuses WM.open, so single-instance/focus behavior matches
 * the start menu exactly.
 *
 * NO URL entry by design: the strip is not an address bar. Only apps
 * present in the CURRENT router's menu are offered; anything that
 * matches nothing just shows the empty notice. The candidate list is
 * re-read on every open, so per-firmware app sets are never baked in. */
(function() {
    'use strict';

    var MRU_MAX = 8;                       // recency head depth
    var MRU_KEY = 'desktop-addr-mru';
    var input = null, pop = null, winEl = null, sel = 0;
    var hits = [];   // [{hit, score, n}] in display order

    function menuData() {
        // Same multi-source probe the start menu uses.
        if (window.LuCIMenuData && window.LuCIMenuData.length) {
            return window.LuCIMenuData;
        }
        var el = document.getElementById('menu-data');
        if (el && el.textContent) {
            try {
                var d = JSON.parse(el.textContent);
                if (d && d.length) { window.LuCIMenuData = d; return d; }
            } catch (e) {}
        }
        return [];
    }

    function candidates() {
        // Flatten to launchables: direct-link categories and sub items
        // with both title and href. Nothing else is ever offered.
        var out = [], data = menuData(), i, j, cat, s;
        for (i = 0; i < data.length; i++) {
            cat = data[i];
            if (cat.subs && cat.subs.length) {
                for (j = 0; j < cat.subs.length; j++) {
                    s = cat.subs[j];
                    if (s && s.title && s.href) {
                        out.push({ cat: cat.title || '', title: s.title, href: s.href });
                    }
                }
            } else if (cat.href && cat.title) {
                out.push({ cat: '', title: cat.title, href: cat.href });
            }
        }
        return out;
    }

    function urlTail(href) {
        var p = String(href || '').split('?')[0].split('#')[0].split('/'), segs = [], i;
        for (i = 0; i < p.length; i++) if (p[i]) segs.push(p[i]);
        return segs.slice(-2).join('/').toLowerCase();
    }

    // Recency store: the list is re-read live from the menu on every
    // open, so MRU entries pointing at apps that left the firmware are
    // naturally skipped (a stale key can never resurrect an app).
    function loadMru() {
        try {
            var v = JSON.parse(window.localStorage.getItem(MRU_KEY) || '[]');
            return v instanceof Array ? v : [];
        } catch (e) { return []; }
    }

    function saveMru(list) {
        try { window.localStorage.setItem(MRU_KEY, JSON.stringify(list.slice(0, MRU_MAX))); } catch (e) {}
    }

    function mruTouch(href) {
        var v = loadMru();
        saveMru([href].concat(v.filter(function(x) { return x !== href; })));
    }

    // Default (empty query) order = recency head first, then the WHOLE
    // menu with one row per category in rotation (round-robin), so the
    // tail of the scrollable list is never a single-category wall.
    function defaultOrder(all) {
        var mru = loadMru(), head = [], used = {}, i;
        var byHref = {};
        for (i = 0; i < all.length; i++) byHref[String(all[i].href)] = all[i];
        for (i = 0; i < mru.length && head.length < MRU_MAX; i++) {
            var it = byHref[String(mru[i])];
            if (it && !used[String(it.href)]) { head.push(it); used[String(it.href)] = 1; }
        }
        var cats = [], catAt = {};
        for (i = 0; i < all.length; i++) {
            var item = all[i];
            if (used[String(item.href)]) continue;
            var cat = item.cat || '';
            if (catAt[cat] == null) {
                catAt[cat] = cats.length;
                cats.push([]);
            }
            cats[catAt[cat]].push(item);
        }
        var out = head.slice(), depth = 0, again = true;
        while (again) {
            again = false;
            for (i = 0; i < cats.length; i++) {
                if (depth < cats[i].length) { out.push(cats[i][depth]); again = true; }
            }
            depth++;
        }
        return out;
    }

    function rank(q) {
        // Plain substring scoring, menu order breaks ties. Prefix match on
        // the app title first ("ddns" hits "DDNS"), then title-contains,
        // then the last two URL path segments. Empty query = recency head
        // + category rotation over the whole menu (scrollable, no cap).
        var low = String(q || '').toLowerCase().replace(/^s+|s+$/g, '');
        var all = candidates(), out = [], i;
        if (!low) {
            var ordered = defaultOrder(all);
            for (i = 0; i < ordered.length; i++) {
                out.push({ hit: ordered[i], score: 9, n: i });
            }
            return out;
        }
        for (i = 0; i < all.length; i++) {
            var t = String(all[i].title || '').toLowerCase();
            var s = -1;
            if (t.indexOf(low) === 0) s = 0;
            else if (t.indexOf(low) > -1) s = 1;
            else if (urlTail(all[i].href).indexOf(low) > -1) s = 2;
            if (s > -1) out.push({ hit: all[i], score: s, n: i });
        }
        out.sort(function(a, b) { return a.score - b.score || a.n - b.n; });
        return out;
    }

    function renderPop(q) {
        if (!pop) return;
        pop.textContent = '';
        hits = rank(q);
        sel = 0;
        var i, row;
        if (!hits.length) {
            row = document.createElement('div');
            row.className = 'addr-quick-empty';
            row.textContent = _('No menu items');
            pop.appendChild(row);
            return;
        }
        for (i = 0; i < hits.length; i++) {
            row = document.createElement('div');
            row.className = 'addr-quick-row' + (i === sel ? ' addr-sel' : '');
            row.setAttribute('data-idx', i);
            if (hits[i].hit.cat) {
                var catEl = document.createElement('span');
                catEl.className = 'addr-quick-cat';
                catEl.textContent = hits[i].hit.cat;
                row.appendChild(catEl);
            }
            var labEl = document.createElement('span');
            labEl.className = 'addr-quick-label';
            labEl.textContent = hits[i].hit.title;
            row.appendChild(labEl);
            pop.appendChild(row);
        }
    }

    function stepSel(d) {
        if (!hits.length) return;
        sel = (sel + d + hits.length) % hits.length;
        var rows = pop ? pop.querySelectorAll('.addr-quick-row') : null;
        if (!rows) return;
        for (var i = 0; i < rows.length; i++) {
            if (i === sel) rows[i].classList.add('addr-sel');
            else rows[i].classList.remove('addr-sel');
        }
        if (rows[sel] && rows[sel].scrollIntoView) {
            try { rows[sel].scrollIntoView({ block: 'nearest' }); } catch (e) {}
        }
    }

    function positionPop() {
        if (!pop || !winEl) return;
        var addr = winEl.querySelector('.titlebar-addr');
        if (!addr) { closeEditor(); return; }
        var r = addr.getBoundingClientRect();
        var w = winEl.getBoundingClientRect();
        var left = Math.max(6, Math.round(r.left - w.left));
        var top = Math.round(r.bottom - w.top + 4);
        pop.style.left = left + 'px';
        pop.style.top = top + 'px';
        pop.style.minWidth = Math.max(220, Math.round(r.width)) + 'px';
        pop.style.maxWidth = Math.round(Math.max(260, w.width - left - 8)) + 'px';
    }

    function openEditor(addr, win) {
        if (input && winEl === win) {
            if (input.focus) input.focus();
            return;
        }
        closeEditor();
        winEl = win;
        addr.classList.add('addr-editing');
        input = document.createElement('input');
        input.type = 'text';
        input.className = 'addr-quick-input';
        input.spellcheck = false;
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('placeholder', _('Search...'));
        input.addEventListener('input', function() {
            if (input === this) renderPop(this.value);
        });
        addr.appendChild(input);
        pop = document.createElement('div');
        pop.className = 'addr-quick-pop';
        win.appendChild(pop);
        // Raise the window before showing the popup: the strip click
        // focuses the window on desktop anyway, but a mobile tap (touchend
        // path) or a non-mouse flow may not; the popup must never end up
        // painted under a neighboring window.
        if (window.WM && WM.focus && win.getAttribute) {
            var wid = win.getAttribute('data-window-id');
            if (wid !== null) { try { WM.focus(wid); } catch (e) {} }
        }
        positionPop();
        renderPop('');
        if (input.focus) input.focus();
    }

    function closeEditor() {
        if (input && input.parentNode) input.parentNode.removeChild(input);
        if (pop && pop.parentNode) pop.parentNode.removeChild(pop);
        if (winEl) {
            winEl.classList.remove('addr-quick-open');
            var a = winEl.querySelector('.titlebar-addr.addr-editing');
            if (a) a.classList.remove('addr-editing');
        }
        input = null; pop = null; winEl = null; hits = []; sel = 0;
    }

    function launch(idx) {
        if (!input) return;
        var h = (hits[idx] || {}).hit || null;
        closeEditor();   // restore the strip first; WM.open may reuse a window
        if (!h) return;
        var href = String(h.href || '');
        // Belt only: candidates already come from the router menu JSON.
        if (href.indexOf('javascript:') === 0) return;
        mruTouch(href);
        if (window.WM && WM.open) WM.open(href, h.title);
    }

    function idxOf(row) {
        var v = row ? parseInt(row.getAttribute('data-idx'), 10) : NaN;
        return isNaN(v) ? 0 : v;
    }

    document.addEventListener('click', function(e) {
        var t = e.target;
        if (!t || !t.closest) return;
        if (t.closest('.addr-quick-input')) return;
        if (t.closest('.addr-quick-pop')) {
            if (input) launch(idxOf(t.closest('.addr-quick-row')));
            return;
        }
        var addr = t.closest('.titlebar-addr');
        var win = addr ? addr.closest('.window') : null;
        if (!addr || !win) {
            if (input) closeEditor();
            return;
        }
        openEditor(addr, win);
    });

    document.addEventListener('touchend', function(e) {
        // Touch path (mobile): some titlebar touch handlers stop the
        // synthesized click, so open/launch directly from touchend.
        var t = e.target;
        if (!t || !t.closest) return;
        if (t.closest('.addr-quick-pop')) {
            if (input && t.closest('.addr-quick-row')) {
                e.preventDefault();
                launch(idxOf(t.closest('.addr-quick-row')));
            }
            return;
        }
        var addr = t.closest('.titlebar-addr');
        if (!addr) return;
        var win = addr.closest('.window');
        if (!win) return;
        if (input) return;   // already editing here
        e.preventDefault();  // no follow-up synthesized click / double-fire
        openEditor(addr, win);
    }, false);

    function outsideClose(e) {
        if (!input) return;
        if (!e.target || !e.target.closest) return;
        if (e.target.closest('.titlebar-addr') || e.target.closest('.addr-quick-pop')) return;
        closeEditor();
    }
    document.addEventListener('mousedown', outsideClose, true);
    document.addEventListener('touchstart', outsideClose, true);

    document.addEventListener('keydown', function(e) {
        if (!input) return;
        if (e.target !== input) return;
        if (e.key === 'Escape' || e.keyCode === 27) {
            e.preventDefault();
            closeEditor();
            return;
        }
        if (e.isComposing || e.keyCode === 229) return;   // IME composition
        if (e.key === 'Enter' || e.keyCode === 13) {
            e.preventDefault();
            // Enter launches the highlighted matching row only; an empty
            // query never launches (no accidental app start).
            var v = (input.value || '').replace(/^\s+|\s+$/g, '');
            if (v) launch(sel);
            return;
        }
        if (e.key === 'ArrowDown' || e.keyCode === 40) { e.preventDefault(); stepSel(1); return; }
        if (e.key === 'ArrowUp' || e.keyCode === 38) { e.preventDefault(); stepSel(-1); return; }
    }, true);
})();
