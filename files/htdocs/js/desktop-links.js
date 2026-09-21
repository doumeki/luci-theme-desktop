/* Desktop Theme - Custom URL shortcuts + ghost-clean exemption
 *
 * A custom link is a pin with custom:true — same storage as a pinned menu
 * item, but the URL is NOT in the LuCI menu tree. Every menu-driven cleanup
 * must skip it (see _customUrlSet / cleanGhostApps), otherwise the user's
 * own shortcut is deleted as a "ghost" on the next page load.
 */
(function() {
    'use strict';

    var DESKTOP = window.LuCIDesktop;
    if (!DESKTOP) { console.error('desktop-links.js: LuCIDesktop namespace not found'); return; }
    var State = DESKTOP.desktopState;

    // 'example.com:3000' is a host:port, not an explicit scheme. Without
    // this distinction the old scheme regex classified such links as
    // 'example.com:' and rejected them (or prefixed them as http:// at save
    // time). Keep the distinction in one place, used by normalizeUrl() and
    // the open-time prefix logic.
    function hostPortLike(u) {
        return /^[a-z0-9][a-z0-9.\-]*:\d+(?:[\/?#]|$)/i.test(u || '');
    }
    function explicitScheme(u) {
        if (!u || hostPortLike(u)) return null;
        return /^([a-z][a-z0-9+.\-]*):/i.exec(u);
    }

    var links = {
        // Build the set of URLs registered in the LuCI menu tree.
        menuUrls: function() {
            var data = window.LuCIMenuData;
            var urls = {};
            if (!data) return urls;
            data.forEach(function(cat) {
                if (cat.subs) {
                    cat.subs.forEach(function(sub) {
                        if (sub.href) urls[sub.href] = true;
                    });
                }
                if (cat.href) urls[cat.href] = true;
            });
            return urls;
        },

        // URLs of user-added custom links (pins marked custom:true). They
        // are NOT in the LuCI menu tree, so every menu-driven cleanup must
        // skip them — otherwise the user's own link is deleted as a
        // "ghost" on the next page load.
        //
        // icon_layout is shared between desktop and mobile, but pins are
        // separate (pins vs mobile_pins). Read BOTH lists: a custom link
        // created on the desktop must keep its icon/position when the page
        // boots in mobile mode, and vice versa. Reading only State.pins()
        // made a mobile visit prune the desktop custom-link layout entry.
        _customUrlSet: function() {
            var set = {};
            var add = function(list) {
                if (!list || typeof list.forEach !== 'function') return;
                list.forEach(function(p) {
                    if (p && p.custom && p.url) set[p.url] = true;
                });
            };
            try {
                var c = DESKTOP.getConfig();
                add(c.pins);
                add(c.mobile_pins);
            } catch(e) {}
            add(State.pins());   // live writer wins if a save is in flight
            return set;
        },

        // Remove pins/hidden entries whose URL no longer exists in the menu tree.
        // Prevents "ghost icons" from uninstalled/deleted apps.
        cleanGhostApps: function() {
            var validUrls = this.menuUrls();
            if (Object.keys(validUrls).length === 0) {
                console.log('[ghost-clean] no menu data, skip');
                return;
            }
            var customUrls = this._customUrlSet();
            var pinnedItems = State.pins();
            var hiddenIcons = State.hidden();
            var iconLayout = State.layout();

            // Clean pinned items (array of {url, title})
            var removedPins = [];
            var oldPinLen = pinnedItems.length;
            State.setPins(pinnedItems.filter(function(p) {
                if (p.custom) return true;   // user's own link — never a ghost
                if (!validUrls[p.url]) {
                    removedPins.push(p.url);
                    console.log('[ghost-clean] pin ghost: ' + p.url + ' title="' + p.title + '"');
                    return false;
                }
                return true;
            }));
            if (removedPins.length > 0) {
                console.log('[ghost-clean] removed ' + removedPins.length + ' pins: ' + removedPins.join(', '));
                State.savePins();
            }

            // Clean hidden icons (array of URL strings)
            var removedHidden = [];
            var oldHiddenLen = hiddenIcons.length;
            State.setHidden(hiddenIcons.filter(function(h) {
                if (customUrls[h]) return true;   // hiding a custom link is valid
                if (!validUrls[h]) {
                    removedHidden.push(h);
                    console.log('[ghost-clean] hidden ghost: ' + h);
                    return false;
                }
                return true;
            }));
            if (removedHidden.length > 0) {
                console.log('[ghost-clean] removed ' + removedHidden.length + ' hidden: ' + removedHidden.join(', '));
                State.saveHidden();
            }

            // Clean icon layout entries (position + choice) for urls that
            // no longer exist in the menu tree.
            var removedLayout = 0;
            Object.keys(iconLayout).forEach(function(u) {
                if (customUrls[u]) return;   // position/icon of a custom link
                if (!validUrls[u]) {
                    delete iconLayout[u];
                    removedLayout++;
                    console.log('[ghost-clean] icon layout ghost: ' + u);
                }
            });
            if (removedLayout > 0) {
                console.log('[ghost-clean] removed ' + removedLayout + ' icon layout entries');
                State.saveIconLayout();
            }

            if (removedPins.length === 0 && removedHidden.length === 0) {
                console.log('[ghost-clean] all clean, no ghosts (checked ' + oldPinLen + ' pins + ' + oldHiddenLen + ' hidden)');
            }
        },

        // ===== Custom URL shortcuts =====

        // Validate and store what the user typed. Bare hosts are stored
        // exactly as typed — the automatic http:// prefix is applied only
        // at OPEN time (openTarget), so the edit dialog no longer rewrites
        // the user's input. Use a leading {noproto} marker to disable even
        // that open-time prefix.
        //
        // Still refuses javascript:/data:/vbscript:/file: and bare
        // protocol-relative URLs (the noproto marker is the explicit,
        // auditable opt-in for special cases).
        normalizeUrl: function(raw) {
            var u = (raw || '').replace(/^\s+|\s+$/g, '');
            if (!u) return null;
            // A leading placeholder may already BE the scheme or the whole
            // origin — never prefix http:// over it:
            //   {httpx}://host:3000   keep (scheme placeholder)
            //   {origin}/cgi-bin/...  keep (already scheme://host:port)
            //   {router}:3000         host → add http:// like any bare host
            //   {noproto}//host:3000  keep verbatim (no http:// at open)
            var lead = /^\{[a-z][a-z0-9]*\}/i.exec(u);
            if (lead) {
                var name = lead[0].slice(1, -1).toLowerCase();
                var rest = u.slice(lead[0].length);
                if (name === 'noproto') {
                    if (!rest || /^(javascript|data|vbscript|file):/i.test(rest)) return null;
                    return lead[0] + rest;
                }
                if (name === 'httpx') {
                    if (rest.indexOf('://') === 0) return u;
                    if (rest.indexOf('//') === 0) return lead[0] + ':' + rest;   // {httpx}//host
                    return lead[0] + '://' + rest;                               // {httpx}host
                }
                if (name === 'origin') return u;
                if (/^:\/\//.test(rest) || explicitScheme(rest)) return u;
                return 'http://' + u;
            }
            if (explicitScheme(u)) {                         // real scheme (not host:port)
                return /^https?:/i.test(u) ? u : null;
            }
            if (u.indexOf('//') === 0) return null;          // protocol-relative
            if (u.charAt(0) === '/') return u;               // LuCI / static path
            if (/^(admin|cgi-bin)\//.test(u)) return '/' + u;
            return u;                                        // bare host/IP: store verbatim
        },

        // Placeholders in a custom URL, resolved at OPEN time — one
        // shortcut then keeps working whether the router is reached by host
        // name or by IP (the URL is STORED as typed, never expanded):
        //   {router} → location.hostname  (router.example | 192.0.2.1)
        //   {httpx}  → http | https       (the scheme in use right now)
        //   {port}   → location.port      (LuCI's own port; '' for 80/443)
        //   {origin} → location.origin    (scheme://host:port)
        // e.g. {httpx}://{router}:300 reaches a service on the router
        // whatever name the shell happened to be opened with.
        // {host} / {hostname} are accepted as aliases of {router}.
        resolveUrlVars: function(url) {
            if (!url || url.indexOf('{') === -1) return url;
            if (typeof location === 'undefined') return url;
            return url
                .replace(/\{noproto\}/gi, '')
                .replace(/\{(?:router|host|hostname)\}/gi, location.hostname)
                .replace(/\{httpx\}/gi, (location.protocol || '').replace(':', ''))
                .replace(/\{port\}/gi, location.port || '')
                .replace(/\{origin\}/gi, location.origin);
        },

        // A URL that leaves this LuCI origin (default: open in a new tab).
        // {noproto} is a storage marker, not part of the target — strip it
        // before deciding, otherwise it always looks like a non-local URL.
        isExternalUrl: function(url) {
            var u = (url || '').replace(/^\{noproto\}/i, '');
            if (!u) return false;
            // A single leading slash is a same-origin LuCI path; a double
            // slash is protocol-relative and therefore external unless its
            // resolved origin matches the current one.
            if (u.charAt(0) === '/' && u.charAt(1) !== '/') return false;
            if (typeof location === 'undefined') return true;
            if (u.indexOf('//') === 0) u = (location.protocol || 'http:') + u;
            return u.indexOf(location.origin + '/') !== 0;
        },

        addCustomUrl: function(title, url, newTab) {
            var name = (title || '').replace(/^\s+|\s+$/g, '') || url;
            var pinnedItems = State.pins();
            var entry = null;
            for (var i = 0; i < pinnedItems.length; i++) {
                if (pinnedItems[i].url === url) { entry = pinnedItems[i]; break; }
            }
            if (entry) {
                entry.title = name;
                entry.custom = true;
                entry.newTab = !!newTab;
            } else {
                entry = { url: url, title: name, custom: true, newTab: !!newTab };
                pinnedItems.push(entry);
            }
            State.savePins();
            this.renderShortcuts();
            return entry;
        },

        // Open a shortcut: a custom link flagged newTab leaves the shell
        // (external sites refuse framing), everything else opens as a
        // desktop window like any app. {host}-style placeholders expand
        // here, against the address the shell was opened with.
        openShortcut: function(url, title) {
            // Prefix only the OPEN target, never the stored URL. This keeps
            // the edit dialog faithful to what the user typed while links
            // like 'example.com:3000' still open as http://example.com:3000.
            // {noproto} is the explicit opt-out.
            var noProto = /^\{noproto\}/i.test(url || '');
            var target = this.resolveUrlVars(url);
            if (!noProto && target && target.charAt(0) !== '/' && !explicitScheme(target)) {
                target = 'http://' + target;
            }
            var pinnedItems = State.pins();
            for (var i = 0; i < pinnedItems.length; i++) {
                var p = pinnedItems[i];
                if (p.url === url && p.custom && p.newTab) {
                    window.open(target, '_blank', 'noopener');
                    return;
                }
            }
            WM.open(target, title);
        },

        editCustomUrl: function(url) {
            var pinnedItems = State.pins();
            for (var i = 0; i < pinnedItems.length; i++) {
                if (pinnedItems[i].url === url && pinnedItems[i].custom) {
                    this._showLinkDialog(pinnedItems[i]);
                    return;
                }
            }
        },

        // Editing a link's URL must not lose what is keyed by the URL: the
        // icon the user picked, the desktop grid cell and the hidden state
        // all live in icon_layout / hidden_icons. Without this the icon
        // reverted to the default (and the stale entry was pruned later as
        // a ghost).
        _moveLinkMeta: function(oldUrl, newUrl) {
            if (!oldUrl || !newUrl || oldUrl === newUrl) return;
            var iconLayout = State.layout();
            if (iconLayout[oldUrl]) {
                iconLayout[newUrl] = iconLayout[oldUrl];
                delete iconLayout[oldUrl];
                State.saveIconLayout();
            }
            var hiddenIcons = State.hidden();
            var hi = hiddenIcons.indexOf(oldUrl);
            if (hi !== -1) {
                hiddenIcons.splice(hi, 1);
                if (hiddenIcons.indexOf(newUrl) === -1) hiddenIcons.push(newUrl);
                State.saveHidden();
            }
        }
    };

    DESKTOP.desktopLinks = links;
})();
