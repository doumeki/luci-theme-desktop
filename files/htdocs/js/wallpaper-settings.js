/* Desktop Theme — Wallpaper Manager
 * Upload / browse / delete / enable-disable background images for Built-in mode.
 * Changes are staged locally; OK commits, Close/X reverts.
 */
(function() {
    'use strict';

    var panel;
    var disabled = {};      // current working set
    var snapshot = {};      // snapshot at open time (for revert)

    function cloneSet(src) {
        var d = {};
        for (var k in src) { if (src[k]) d[k] = true; }
        return d;
    }

    function loadSnapshot() {
        disabled = {};
        try {
            var wps = LuCIDesktop.getSection('wallpaper');
            var list = wps.builtin_disabled || [];
            list.forEach(function(name) { disabled[name] = true; });
        } catch(e) {}
        snapshot = cloneSet(disabled);
        console.log('[wp-manager] open: snapshot ' + listKeys(snapshot));
    }

    function listKeys(obj) {
        var a = [];
        for (var k in obj) { if (obj[k]) a.push(k); }
        a.sort();
        return JSON.stringify(a);
    }

    function isDisabled(name) { return !!disabled[name]; }

    function updateCheckAll() {
        var ca = document.getElementById('wps-check-all');
        if (!ca) return;
        var all = document.querySelectorAll('.wps-cb');
        if (!all.length) return;
        var checked = 0;
        all.forEach(function(cb) { if (cb.checked) checked++; });
        ca.checked = (checked === all.length);
        ca.indeterminate = (checked > 0 && checked < all.length);
    }

    function commit() {
        var arr = [];
        for (var k in disabled) { if (disabled[k]) arr.push(k); }
        arr.sort();
        console.log('[wp-manager] commit: disabled=' + JSON.stringify(arr));
        // Update desktop-config
        try {
            var cfg = LuCIDesktop.getConfig();
            if (!cfg.wallpaper) cfg.wallpaper = {};
            cfg.wallpaper.builtin_disabled = arr;
            // Rebuild builtin list
            var allFiles = [];
            var cards = document.querySelectorAll('#wps-grid .wps-card');
            cards.forEach(function(card) {
                var name = card.getAttribute('data-name');
                if (name) allFiles.push('/luci-static/desktop/background/' + name);
            });
            var enabled = allFiles.filter(function(url) {
                return !disabled[url.split('/').pop()];
            });
            cfg.wallpaper.builtin = enabled;
            LuCIDesktop.setSectionLocal('wallpaper', cfg.wallpaper);
            // If preview shows a now-disabled image, re-pick
            var prevUrl = window.__wp_preview_url || '';
            var prevName = prevUrl.split('/').pop();
            if (prevName && disabled[prevName] && enabled.length > 0) {
                console.log('[wp-manager] preview ' + prevName + ' now disabled, re-pick');
                var newUrl = enabled[Math.floor(Math.random() * enabled.length)];
                window.__wp_preview_url = newUrl;
                var preview = document.getElementById('wp-preview-img');
                if (preview) {
                    preview.style.backgroundImage = 'url("' + newUrl + '")';
                    preview.style.backgroundSize = 'cover';
                    preview.style.backgroundPosition = 'center';
                }
            }
        } catch(e) { console.log('[wp-manager] commit error:', e.message); }
        LuCIDesktop.saveDesktopSection('settings', {builtin_disabled: JSON.stringify(arr)});
    }

    function revert() {
        disabled = cloneSet(snapshot);
        console.log('[wp-manager] revert: restored ' + listKeys(disabled));
        // Restore desktop-config to original snapshot (no UCI write)
        try {
            var arr = [];
            for (var k in snapshot) { if (snapshot[k]) arr.push(k); }
            arr.sort();
            var cfg = LuCIDesktop.getConfig();
            if (!cfg.wallpaper) cfg.wallpaper = {};
            cfg.wallpaper.builtin_disabled = arr;
            var allFiles = [];
            var cards = document.querySelectorAll('#wps-grid .wps-card');
            cards.forEach(function(card) {
                var name = card.getAttribute('data-name');
                if (name) allFiles.push('/luci-static/desktop/background/' + name);
            });
            cfg.wallpaper.builtin = allFiles.filter(function(url) {
                return !snapshot[url.split('/').pop()];
            });
            LuCIDesktop.setSectionLocal('wallpaper', cfg.wallpaper);
        } catch(e) { console.log('[wp-manager] revert error:', e.message); }
    }

    var WallpaperManager = {
        open: function() {
            if (panel) { panel.remove(); panel = null; return; }

            loadSnapshot();

            panel = document.createElement('div');
            panel.id = 'wallpaper-settings-panel';
            panel.className = 'widget-settings';
            panel.innerHTML =
                '<div class="widget-settings-header">' +
                '<h3>' + _('Wallpapers') + '</h3>' +
                '<button id="wps-close">&#x2715;</button>' +
                '</div>' +
                '<div class="widget-settings-body" style="padding:12px;min-height:260px;display:flex;flex-direction:column;' +
                'color:var(--theme-panel-fg);background:var(--theme-panel-bg);">' +
                '<div style="display:flex;gap:4px;margin-bottom:10px;border-bottom:1px solid var(--theme-panel-border);padding-bottom:8px;flex-shrink:0;">' +
                '<button class="wps-tab active" data-tab="browse" style="padding:4px 14px;border:none;border-radius:4px;font-size:12px;cursor:pointer;' +
                'background:var(--theme-panel-tab-active-bg);color:var(--theme-panel-tab-active-fg);">' + _('Browse') + '</button>' +
                '<button class="wps-tab" data-tab="upload" style="padding:4px 14px;border:none;border-radius:4px;font-size:12px;cursor:pointer;' +
                'background:transparent;color:var(--theme-panel-tab-inactive-fg);">' + _('Upload') + '</button>' +
                '<span style="flex:1;"></span>' +
                '<label style="font-size:11px;color:var(--theme-panel-muted);cursor:pointer;display:flex;align-items:center;gap:4px;">' +
                '<input type="checkbox" id="wps-check-all" style="margin:0;"> ' + _('Check all') + '</label>' +
                '</div>' +
                '<div class="wps-tab-body" data-tab="browse" id="wps-browse" style="flex:1;display:flex;flex-direction:column;min-height:0;">' +
                '<div id="wps-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;overflow:auto;flex:1;align-content:start;align-items:start;min-width:0;"></div>' +
                '<div style="display:flex;gap:8px;margin-top:10px;justify-content:flex-end;flex-shrink:0;">' +
                '<button id="wps-cancel" style="padding:6px 14px;background:transparent;color:var(--theme-panel-fg);border:1px solid var(--theme-panel-border);border-radius:4px;cursor:pointer;font-size:12px;">' + _('Cancel') + '</button>' +
                '<button id="wps-ok" style="padding:6px 14px;background:#2dce89;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;">' + _('OK') + '</button>' +
                '</div></div>' +
                '<div class="wps-tab-body" data-tab="upload" id="wps-upload" style="display:none;">' +
                '<input type="file" id="wps-file-input" accept="image/*" style="margin-bottom:8px;color:var(--theme-panel-fg);">' +
                '<button id="wps-upload-btn" style="padding:6px 14px;background:var(--theme-panel-tab-active-bg);color:var(--theme-panel-tab-active-fg);border:none;border-radius:4px;cursor:pointer;font-size:12px;">' + _('Upload') + '</button>' +
                '<span id="wps-upload-status" style="font-size:11px;color:var(--theme-panel-muted);margin-left:8px;"></span>' +
                '</div></div>';

            document.body.appendChild(panel);
            panel.style.width = '520px';
            panel.style.height = '400px';
            PanelHelper.makeMovable(panel);
            PanelHelper.makeResizable(panel);
            PanelHelper.fadeIn(panel);

            var self = this;

            // X (top-right) = same as Cancel
            panel.querySelector('#wps-close').addEventListener('click', function() {
                console.log('[wp-manager] close (X) — reverting');
                revert();
                panel.remove(); panel = null;
            });

            // Cancel (bottom) = revert + close
            panel.querySelector('#wps-cancel').addEventListener('click', function() {
                console.log('[wp-manager] Cancel — reverting');
                revert();
                panel.remove(); panel = null;
            });

            // OK (bottom-right) = commit + close
            panel.querySelector('#wps-ok').addEventListener('click', function() {
                console.log('[wp-manager] OK — committing');
                commit();
                panel.remove(); panel = null;
            });

            // Check all / Uncheck all
            var checkAll = panel.querySelector('#wps-check-all');
            checkAll.addEventListener('change', function() {
                var check = this.checked;
                console.log('[wp-manager] ' + (check ? 'check' : 'uncheck') + ' all');
                var cbs = panel.querySelectorAll('.wps-cb');
                cbs.forEach(function(cb) {
                    cb.checked = check;
                    var name = cb.getAttribute('data-name');
                    if (check) { delete disabled[name]; } else { disabled[name] = true; }
                });
            });

            // Tab switching
            var tabBtns = panel.querySelectorAll('.wps-tab');
            var tabBodies = panel.querySelectorAll('.wps-tab-body');
            tabBtns.forEach(function(btn) {
                btn.addEventListener('click', function() {
                    var t = btn.getAttribute('data-tab');
                    tabBtns.forEach(function(b) {
                        b.style.background = 'transparent'; b.style.color = '#888';
                        b.classList.remove('active');
                    });
                    btn.style.background = 'rgba(74,144,217,0.25)';
                    btn.style.color = '#fff';
                    btn.classList.add('active');
                    tabBodies.forEach(function(b) {
                        b.style.display = b.getAttribute('data-tab') === t ? '' : 'none';
                    });
                });
            });

            // Upload
            panel.querySelector('#wps-upload-btn').addEventListener('click', function() {
                var input = document.getElementById('wps-file-input');
                var status = document.getElementById('wps-upload-status');
                if (!input.files || !input.files[0]) { status.textContent = _('Select a file'); return; }
                var file = input.files[0];
                var form = new FormData();
                form.append('file', file);
                status.textContent = _('Uploading...');
                var xhr = new XMLHttpRequest();
                xhr.open('POST', '/cgi-bin/luci/admin/desktop/upload_wallpaper', true);
                xhr.onload = function() {
                    try {
                        var r = JSON.parse(xhr.responseText);
                        status.textContent = r.ok ? _('Done: ') + r.msg : _('Failed');
                        if (r.ok) { input.value = ''; self._loadFiles(); }
                    } catch(e) { status.textContent = _('Error'); }
                };
                xhr.send(form);
            });

            this._loadFiles();
        },

        _loadFiles: function() {
            var grid = document.getElementById('wps-grid');
            if (!grid) return;
            grid.innerHTML = '<span style="font-size:11px;color:var(--theme-panel-muted, #888);">' + _('Loading...') + '</span>';
            var xhr = new XMLHttpRequest();
            xhr.open('GET', '/cgi-bin/luci/admin/desktop/list_wallpapers', true);
            var self = this;
            xhr.onload = function() {
                try {
                    var r = JSON.parse(xhr.responseText);
                    if (!r.files || !r.files.length) {
                        grid.innerHTML = '<span style="font-size:11px;color:var(--theme-panel-muted, #888);">' + _('No images') + '</span>';
                        return;
                    }
                    grid.innerHTML = '';
                    r.files.forEach(function(f) {
                        var off = isDisabled(f.name);

                        var card = document.createElement('div');
                        card.className = 'wps-card';
                        card.setAttribute('data-name', f.name);
                        card.style.cssText = 'position:relative;border-radius:6px;overflow:hidden;' +
                            'border:1px solid var(--theme-panel-border, #333);cursor:pointer;';
                        card.innerHTML =
                            '<img class="wps-img" src="' + f.url + '" style="width:100%;height:105px;object-fit:cover;display:block;cursor:pointer;" ' +
                            'onerror="this.style.background=\'#222\';this.style.height=\'75px\';" loading="lazy">' +
                            // Delete button (top-right, hover only)
                            '<button class="wps-del" data-name="' + f.name + '" ' +
                            'style="position:absolute;top:2px;right:2px;width:18px;height:18px;border:none;border-radius:3px;' +
                            'background:rgba(200,40,40,0.8);color:#fff;font-size:10px;line-height:1;cursor:pointer;display:none;" ' +
                            'title="' + _('Delete') + '">&times;</button>' +
                            // Checkbox + clickable label below thumbnail
                            '<label style="display:flex;align-items:center;gap:4px;padding:2px 4px;font-size:10px;cursor:pointer;">' +
                            '<input type="checkbox" class="wps-cb" data-name="' + f.name + '" ' +
                            (off ? '' : 'checked') + ' style="margin:0;cursor:pointer;flex-shrink:0;" ' +
                            'title="' + _('Include in wallpaper rotation') + '">' +
                            '<span style="color:var(--theme-panel-muted, #aaa);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" ' +
                            'title="' + f.name + '">' + f.name + '</span></label>';

                        // Delete on hover
                        card.addEventListener('mouseenter', function() {
                            card.querySelector('.wps-del').style.display = '';
                        });
                        card.addEventListener('mouseleave', function() {
                            card.querySelector('.wps-del').style.display = 'none';
                        });

                        // Checkbox change (UI only — no save)
                        card.querySelector('.wps-cb').addEventListener('change', function(e) {
                            e.stopPropagation();
                            var name = this.getAttribute('data-name');
                            if (this.checked) {
                                delete disabled[name];
                            } else {
                                disabled[name] = true;
                            }
                            // Update check-all state
                            updateCheckAll();
                            console.log('[wp-manager] staged: ' + name + ' ' + (disabled[name] ? 'disabled' : 'enabled') +
                                        ' total_disabled=' + listKeys(disabled));
                        });

                        // Image click → preview
                        card.querySelector('.wps-img').addEventListener('click', function(e) {
                            e.stopPropagation();
                            self._preview(f.url, f.name);
                        });

                        // Delete
                        card.querySelector('.wps-del').addEventListener('click', function(e) {
                            e.stopPropagation();
                            if (confirm(_('Delete ') + f.name + _('?'))) {
                                var dx = new XMLHttpRequest();
                                dx.open('POST', '/cgi-bin/luci/admin/desktop/delete_wallpaper', true);
                                dx.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
                                dx.onload = function() { self._loadFiles(); };
                                dx.send('name=' + encodeURIComponent(f.name));
                            }
                        });

                        grid.appendChild(card);
                    });
                    updateCheckAll();
                } catch(e) { grid.innerHTML = '<span style="font-size:11px;color:var(--theme-panel-muted, #888);">' + _('Error loading files') + '</span>'; }
            };
            xhr.send();
        },

        _preview: function(url, name) {
            var overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.85);' +
                'display:flex;align-items:center;justify-content:center;flex-direction:column;cursor:pointer;';
            overlay.innerHTML =
                '<img src="' + url + '" style="max-width:90vw;max-height:80vh;border-radius:8px;box-shadow:0 8px 48px rgba(0,0,0,0.6);">' +
                '<div style="color:#ccc;font-size:12px;margin-top:8px;">' + name + '</div>' +
                '<div style="color:#888;font-size:11px;margin-top:4px;">' + _('Click anywhere to close') + '</div>';
            overlay.addEventListener('click', function() { overlay.remove(); });
            document.body.appendChild(overlay);
        }
    };

    window.WallpaperManager = WallpaperManager;
})();
