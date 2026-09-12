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
        _customUrlSet: function() {
            var set = {};
            State.pins().forEach(function(p) { if (p && p.custom) set[p.url] = true; });
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

        // Normalize what the user typed into an openable URL, or null when
        // it must not be opened (never javascript:/data:, never
        // protocol-relative).
        normalizeUrl: function(raw) {
            var u = (raw || '').replace(/^\s+|\s+$/g, '');
            if (!u) return null;
            // A leading placeholder may already BE the scheme or the whole
            // origin — never prefix http:// over it:
            //   {httpx}://host:3000   keep (scheme placeholder)
            //   {origin}/cgi-bin/...  keep (already scheme://host:port)
            //   {router}:3000         host → add http:// like any bare host
            var lead = /^\{[a-z][a-z0-9]*\}/i.exec(u);
            if (lead) {
                var name = lead[0].slice(1, -1).toLowerCase();
                var rest = u.slice(lead[0].length);
                if (name === 'httpx') {
                    if (rest.indexOf('://') === 0) return u;
                    if (rest.indexOf('//') === 0) return lead[0] + ':' + rest;   // {httpx}//host
                    return lead[0] + '://' + rest;                               // {httpx}host
                }
                if (name === 'origin') return u;
                if (/^:\/\//.test(rest) || /^[a-z][a-z0-9+.\-]*:/i.test(rest)) return u;
                return 'http://' + u;
            }
            if (/^[a-z][a-z0-9+.\-]*:/i.test(u)) {          // explicit scheme
                return /^https?:/i.test(u) ? u : null;
            }
            if (u.indexOf('//') === 0) return null;          // protocol-relative
            if (u.charAt(0) === '/') return u;               // LuCI / static path
            if (/^(admin|cgi-bin)\//.test(u)) return '/' + u;
            return 'http://' + u;                            // bare host or IP
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
                .replace(/\{(?:router|host|hostname)\}/gi, location.hostname)
                .replace(/\{httpx\}/gi, (location.protocol || '').replace(':', ''))
                .replace(/\{port\}/gi, location.port || '')
                .replace(/\{origin\}/gi, location.origin);
        },

        // A URL that leaves this LuCI origin (default: open in a new tab).
        isExternalUrl: function(url) {
            if (!url || url.charAt(0) === '/') return false;
            if (typeof location === 'undefined') return true;
            return url.indexOf(location.origin + '/') !== 0;
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
            var target = this.resolveUrlVars(url);
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
