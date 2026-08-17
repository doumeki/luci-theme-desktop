/* Desktop Theme Settings Panel */
(function() {
    'use strict';

    var C = window.ThemeConfig;
    if (!C) return;

    var dirty = false;
    function markDirty() {
        if (dirty) return;
        dirty = true;
        var btn = document.getElementById('ts-apply');
        if (btn) { btn.style.background = '#4a90d9'; btn.style.color = '#fff'; btn.style.border = '1px solid #3a7bc8'; btn.style.opacity = '1'; btn.textContent = _('Apply *'); }
    }
    function markClean() {
        dirty = false;
        var btn = document.getElementById('ts-apply');
        if (btn) { btn.style.background = ''; btn.style.color = 'var(--theme-panel-fg)'; btn.style.border = '1px solid var(--theme-panel-border)'; btn.style.opacity = ''; btn.textContent = _('Apply'); }
    }

    // ===== Unified field change handler =====
    function onFieldChange(el) {
        var id = el.id.replace('ts-','');
        if (el.type === 'color') {
            el.title = el.value;
            console.log('[theme] field change: ' + id + '=' + el.value + ' (color)');
        } else if (el.type === 'range') {
            var lbl = document.getElementById('tsv-' + id);
            var f = C.byId[id];
            if (lbl && f) lbl.textContent = C.formatValue(f, el.value);
            console.log('[theme] field change: ' + id + '=' + el.value + ' (range)');
        } else if (el.type === 'checkbox') {
            console.log('[theme] field change: ' + id + '=' + (el.checked ? '1' : '0') + ' (checkbox)');
        } else {
            console.log('[theme] field change: ' + id + '=' + el.value);
        }
        markDirty();
        C.applyCss(C.readFromDOM());
    }

    // ===== Field Rendering =====
    // Accepts flat arrays (['id1','id2']) or grouped arrays ([{label, fields}, ...])
    function renderFields(ids, vals) {
        var html = '';
        function renderOne(id) {
            var f = C.byId[id];
            if (!f) return;
            var v = vals[id] !== undefined ? vals[id] : f.def;

            if (f.type === 'range') {
                html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:13px;color:var(--theme-panel-fg);">' +
                    '<span style="width:120px;">' + (f.label || _('Opacity')) + '</span>' +
                    '<input type="range" id="ts-' + f.id + '" min="' + (f.min||'') +
                    '" max="' + (f.max||'') + '" step="' + (f.step||'') + '" value="' + v + '" style="flex:1;max-width:120px;">' +
                    ' <span style="font-size:11px;color:var(--theme-panel-muted);min-width:36px;" id="tsv-' + f.id + '">' + C.formatValue(f, v) + '</span></div>';
            } else if (f.type === 'color') {
                var hexVal = v || '#444';
                html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:13px;color:var(--theme-panel-fg);">' +
                    '<span style="width:120px;">' + f.label + '</span>' +
                    '<input type="color" id="ts-' + f.id + '" value="' + hexVal + '" title="' + hexVal + '" style="width:32px;height:24px;border:none;cursor:pointer;">';
                html += '</div>';
            } else if (f.type === 'checkbox') {
                html += '<div style="margin-bottom:8px;"><label style="font-size:13px;color:var(--theme-panel-fg);cursor:pointer;">' +
                    '<input type="checkbox" id="ts-' + f.id + '"' + (v === '1' || v === true ? ' checked' : '') + ' value="1" style="margin-right:6px;">' +
                    f.label + '</label></div>';
            } else if (f.type === 'select') {
                html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:13px;color:var(--theme-panel-fg);">' +
                    '<span style="width:120px;">' + f.label + '</span>' +
                    '<select id="ts-' + f.id + '" style="background:var(--theme-panel-input-bg);color:var(--theme-panel-input-fg);border:1px solid var(--theme-panel-input-border);border-radius:4px;padding:3px 6px;font-size:inherit;">';
                (f.opts || []).forEach(function(o) {
                    html += '<option value="' + o.v + '"' + (v === o.v ? ' selected' : '') + '>' + o.l + '</option>';
                });
                html += '</select>';
                if (f.id === 'desktop_wallpaper' || f.id === 'login_wallpaper') {
                    html += ' <button class="ts-wp-manage" data-id="' + f.id + '" style="font-size:10px;padding:2px 8px;background:var(--theme-panel-input-bg);color:var(--theme-panel-input-fg);border:1px solid var(--theme-panel-input-border);border-radius:3px;cursor:pointer;margin-left:4px;">' + _('Manage') + '</button>';
                    html += ' <button class="ts-wp-refresh" data-id="' + f.id + '" style="display:none;font-size:10px;padding:2px 8px;background:#4a90d9;color:#fff;border:1px solid #3a7bc8;border-radius:3px;cursor:pointer;margin-left:2px;">' + _('Refresh') + '</button>';
                }
                html += '</div>';
                if (f.id === 'desktop_wallpaper') {
                    var paChk = (vals.picsum_auto_refresh === '1' || vals.picsum_auto_refresh === true) ? ' checked' : '';
                    html += '<div class="ts-picsum-auto" style="display:none;margin:4px 0 4px 128px;">' +
                        '<input type="hidden" id="ts-picsum_auto_refresh" value="' + (vals.picsum_auto_refresh || '0') + '">' +
                        '<label style="font-size:11px;color:var(--theme-panel-muted);cursor:pointer;">' +
                        '<input type="checkbox" id="ts-picsum-auto-cb"' + paChk + '>' + _('Picsum Auto Refresh') + '</label></div>';
                }
            }
        }
        ids.forEach(function(item) {
            if (typeof item === 'string') {
                renderOne(item);
            } else if (item.label && item.fields) {
                html += '<div style="font-size:11px;color:var(--theme-panel-section-label);margin:8px 0 4px 0;border-top:1px solid var(--theme-panel-border);padding-top:6px;">' + item.label + '</div>';
                item.fields.forEach(renderOne);
            }
        });
        return html;
    }

    // ===== Tab definitions =====
    var TABS = [
        { id: 'theme',  label: _('Theme'),  fields: C.layout.theme },
        { id: 'colors', label: _('Colors'), fields: C.layout.main },
        { id: 'fonts',  label: _('Fonts'),  fields: C.layout.fonts },
        { id: 'bg',     label: _('Bg'),     fields: C.layout.bg }
    ];

    function switchTab(panel, tabId) {
        panel.querySelectorAll('.ts-tab').forEach(function(btn) {
            var active = btn.getAttribute('data-tab') === tabId;
            btn.style.background = active ? 'var(--theme-panel-tab-active-bg)' : 'transparent';
            btn.style.color = active ? 'var(--theme-panel-tab-active-fg)' : 'var(--theme-panel-tab-inactive-fg)';
        });
        panel.querySelectorAll('.ts-tab-body').forEach(function(body) {
            body.style.display = body.getAttribute('data-tab') === tabId ? '' : 'none';
        });
    }

    // ===== Open =====
    window.ThemeSettings = {
        open: function() {
            var p = document.getElementById('theme-settings-panel');
            if (p) { p.remove(); return; }

            dirty = false;
            var cfg = C.readFromConfig();
            console.log('[panel] open: wallpaper=' + cfg.desktop_wallpaper +
                        ' taskbar_color=' + cfg.taskbar_color +
                        ' wp_url=' + ((cfg.wallpaper && cfg.wallpaper.url) || '(none)'));
            var vals = C.mergeDefaults(cfg);

            // Preview does not touch desktop; no snapshot needed.
            // _applyWallpaper is called directly on Apply/OK to sync desktop.
            var wpEl = document.getElementById('desktop-wallpaper');

            // Preview helper: uses disk cache path (deterministic), optional direct URL
            function _previewWallpaper(mode, directUrl) {
                var box = document.getElementById('bg-preview-box');
                var preview = document.getElementById('wp-preview-img');
                if (!box || !preview) return;
                // Toggle class on parent box — CSS hides/shows dots declaratively
                if (mode === 'gradient') {
                    console.log('[preview] mode=gradient (hide preview, show dots)');
                    box.classList.remove('wp-remote');
                    preview.style.display = 'none';
                    window.__wp_preview_url = '';
                } else {
                    box.classList.add('wp-remote');
                    // Direct URL (from Refresh XHR): apply immediately
                    if (directUrl) {
                        window.__wp_preview_url = directUrl;
                        preview.style.display = '';
                        preview.style.backgroundImage = 'url("' + directUrl + '")';
                        preview.style.backgroundSize = 'cover';
                        preview.style.backgroundPosition = 'center';
                        return;
                    }
                    // builtin: pick from preloaded list (no XHR — instant)
                    if (mode === 'builtin') {
                        try {
                            var dc = LuCIDesktop.getSection('wallpaper');
                            console.log('[preview] builtin dc.wp.mode=' + dc.mode + ' builtin_ct=' + (dc.builtin && dc.builtin.length));
                            if (dc.builtin && dc.builtin.length > 0) {
                                var url = (dc.mode === 'builtin' && dc.url)
                                    ? dc.url
                                    : dc.builtin[Math.floor(Math.random() * dc.builtin.length)];
                                console.log('[preview] builtin url=' + url);
                                window.__wp_preview_url = url;
                                preview.style.display = '';
                                preview.style.backgroundImage = 'url("' + url + '")';
                                preview.style.backgroundSize = 'cover';
                                preview.style.backgroundPosition = 'center';
                                return;
                            }
                        } catch(e) { console.log('[preview] builtin error:', e); }
                        window.__wp_preview_url = '';
                        return;
                    }
                    // bing / picsum: _desktop.jpg on open (guaranteed by header.htm), cache after Refresh
                    var url = '/luci-static/desktop/cache/wallpaper_' + mode + '_desktop.jpg';
                    window.__wp_preview_url = url;
                    preview.style.display = '';
                    preview.style.backgroundImage = 'url("' + url + '")';
                    preview.style.backgroundSize = 'cover';
                    preview.style.backgroundPosition = 'center';
                    console.log('[preview] mode=' + mode + ' url=' + url);
                }
            }

            // Preview state machine (bing/picsum):
            //  1. _desktop.jpg exists (confirmed desktop) → preview snaps
            //     back to the desktop image — a previous Refresh is
            //     REVOKED (Refresh is only "take a look", apply decides).
            //  2. No _desktop, but a remembered first-time candidate exists
            //     (localStorage) → keep showing it, no re-download.
            //  3. Neither → download the first-time candidate and remember it.
            // Refresh (manual button) always shows the fresh image but does
            // NOT remember it — without Apply it is revoked on next open.
            function _ensurePreviewDownload(mode) {
                if (mode !== 'bing' && mode !== 'picsum') return;
                var cacheUrl = '/luci-static/desktop/cache/wallpaper_' + mode + '.jpg';
                var desktopUrl = '/luci-static/desktop/cache/wallpaper_' + mode + '_desktop.jpg';
                var memKey = '__desktop_wp_candidate_' + mode;

                // 1. Confirmed desktop image exists → snap preview back to it
                var dProbe = new Image();
                dProbe.onload = function() {
                    console.log('[preview] confirmed desktop exists, snap back');
                    _previewWallpaper(mode, desktopUrl + '?v=' + Date.now());
                    checkSavedState();
                };
                dProbe.onerror = function() {
                    // 2. Remembered first-time candidate?
                    var remembered = false;
                    try { remembered = !!localStorage.getItem(memKey); } catch(e) {}
                    if (remembered) {
                        var cProbe = new Image();
                        cProbe.onload = function() {
                            console.log('[preview] first-time candidate kept');
                            _previewWallpaper(mode, cacheUrl + '?v=' + Date.now());
                            checkSavedState();
                        };
                        cProbe.onerror = function() {
                            try { localStorage.removeItem(memKey); } catch(e) {}
                            downloadFirstCandidate();
                        };
                        cProbe.src = cacheUrl + '?v=' + Date.now();
                        return;
                    }
                    // 3. No candidate at all → download and remember
                    downloadFirstCandidate();
                };
                dProbe.src = desktopUrl + '?v=' + Date.now();

                function downloadFirstCandidate() {
                    console.log('[preview] no candidate, downloading first-time ' + mode + '...');
                    if (LuCIDesktop && LuCIDesktop.emit) LuCIDesktop.emit('toast', {msg: _('Downloading preview…'), type: 'info', duration: 4000});
                    var preview = document.getElementById('wp-preview-img');
                    if (preview) preview.classList.add('wp-loading');
                    var xhr = new XMLHttpRequest();
                    xhr.open('GET', '/cgi-bin/luci/admin/desktop/random_wallpaper?mode=' + encodeURIComponent(mode) + '&preview=1', true);
                    xhr.onload = function() {
                        if (preview) preview.classList.remove('wp-loading');
                        try {
                            if (xhr.status !== 200) {
                                if (LuCIDesktop && LuCIDesktop.emit) LuCIDesktop.emit('toast', {msg: _('Preview download failed'), type: 'warn', duration: 4000});
                                return;
                            }
                            var r = JSON.parse(xhr.responseText);
                            if (!r.url) return;
                            _previewWallpaper(mode, r.url);
                            try { localStorage.setItem(memKey, '1'); } catch(e) {}
                            if (LuCIDesktop && LuCIDesktop.emit) LuCIDesktop.emit('toast', {msg: _('Preview ready'), type: 'info', duration: 4000});
                            checkSavedState();
                        } catch(e) { console.log('[preview] download error:', e.message); }
                    };
                    xhr.onerror = function() {
                        if (preview) preview.classList.remove('wp-loading');
                        if (LuCIDesktop && LuCIDesktop.emit) LuCIDesktop.emit('toast', {msg: _('Network error, check connection'), type: 'error', duration: 4000});
                    };
                    xhr.send();
                };
            }

            // Build tab bar
            var tabBarHtml = '<div style="display:flex;gap:4px;margin-bottom:10px;border-bottom:1px solid var(--theme-panel-border);padding-bottom:8px;">';
            TABS.forEach(function(tab, i) {
                tabBarHtml += '<button class="ts-tab" data-tab="' + tab.id + '" style="' +
                    'padding:4px 14px;border:none;border-radius:4px;font-size:12px;cursor:pointer;' +
                    'color:' + (i === 0 ? 'var(--theme-panel-tab-active-fg)' : 'var(--theme-panel-tab-inactive-fg)') + ';' +
                    (i === 0 ? 'background:var(--theme-panel-tab-active-bg);' : 'background:transparent;') +
                    '">' + tab.label + '</button>';
            });
            tabBarHtml += '</div>';

            // Interactive background preview — all params set by dragging
            var gx = parseInt(vals.bg_glow_x || '30', 10);
            var gy = parseInt(vals.bg_glow_y || '20', 10);
            var gs = parseInt(vals.bg_spread || '60', 10);
            var ga = parseInt(vals.bg_angle || '135', 10);
            var gc1 = vals.desktop_color1 || '#0d1117';
            var gc2 = vals.desktop_color2 || '#1a3a5c';
            var pw = 280;
            var ratio = window.innerWidth / Math.max(1, window.innerHeight);
            var ph = Math.round(Math.min(220, Math.max(120, pw / ratio)));
            var dotSz = Math.round(gs * 1.2 + 20); // glow dot diameter
            // Handle dot: pixel offset from glow center (polar coords)
            var hDist = Math.round(gs * 0.6 + 8);
            var hRad = ga * Math.PI / 180;
            var hDx = Math.round(Math.cos(hRad) * hDist);
            var hDy = Math.round(-Math.sin(hRad) * hDist);
            // Handle position: % ref + px offset via transform
            var hTransform = 'translate(calc(' + hDx + 'px - 50%), calc(' + hDy + 'px - 50%))';
            var isRemoteWp = cfg.desktop_wallpaper !== 'gradient';
            var remoteClass = isRemoteWp ? ' wp-remote' : '';
            var bgPreviewHtml =
                '<div id="bg-preview-box" class="' + remoteClass + '" style="position:relative;width:' + pw + 'px;height:' + ph + 'px;margin:10px auto;' +
                'border-radius:8px;overflow:hidden;background:' + gc1 + ';' +
                'border:1px solid rgba(255,255,255,0.1);">' +
                '<div id="wp-preview-img" style="position:absolute;inset:0;z-index:0;' + (isRemoteWp ? '' : 'display:none;') +
                'background-size:cover;background-position:center;"></div>' +
                '<div id="bg-glow-dot" style="position:absolute;left:' + gx + '%;top:' + gy + '%;' +
                'width:' + dotSz + 'px;height:' + dotSz + 'px;border-radius:50%;' +
                'background:radial-gradient(circle,' + gc2 + ' 0%,transparent 70%);' +
                'transform:translate(-50%,-50%);cursor:grab;z-index:1;' +
                'box-shadow:0 0 8px ' + gc2 + '33;"></div>' +
                '<div id="bg-handle-dot" style="position:absolute;left:' + gx + '%;top:' + gy + '%;' +
                'width:16px;height:16px;border-radius:50%;' +
                'background:' + gc2 + ';border:2px solid #fff;' +
                'transform:' + hTransform + ';cursor:grab;z-index:5;' +
                'box-shadow:0 0 6px rgba(0,0,0,0.6);"></div>' +
                // Hidden inputs so readFromDOM / saveToConfig pick up bg params
                '<input type="hidden" id="ts-bg_glow_x" value="' + gx + '">' +
                '<input type="hidden" id="ts-bg_glow_y" value="' + gy + '">' +
                '<input type="hidden" id="ts-bg_spread" value="' + gs + '">' +
                '<input type="hidden" id="ts-bg_angle" value="' + ga + '">' +
                // Save to Built-in button (top-right of preview, only bing/picsum)
                '<button id="wp-save-btn" title="' + _('Save to Built-in') + '" ' +
                'style="position:absolute;top:4px;right:4px;z-index:10;font-size:10px;padding:2px 8px;' +
                'background:rgba(45,206,137,0.85);color:#fff;border:none;border-radius:3px;cursor:pointer;' +
                'display:' + (cfg.desktop_wallpaper === 'bing' || cfg.desktop_wallpaper === 'picsum' ? '' : 'none') + ';">' +
                _('Save') + '</button>' +
                '</div>';

            // Build tab bodies (all pre-rendered, shown/hidden by switchTab)
            var bodiesHtml = '';
            TABS.forEach(function(tab, i) {
                var display = i === 0 ? '' : 'display:none;';
                var extra = (tab.id === 'bg') ? bgPreviewHtml : '';
                bodiesHtml += '<div class="ts-tab-body" data-tab="' + tab.id + '" style="' + display + '">' +
                    renderFields(tab.fields, vals) + extra + '</div>';
            });

            var html = '<div class="widget-settings-header" style="background:var(--theme-panel-bg);color:var(--theme-panel-fg);"><h3 style="margin:0;font-size:14px;">' + _('Theme Settings') + '</h3><button id="ts-close" style="color:var(--theme-panel-muted);background:none;border:none;font-size:14px;cursor:pointer;">&#x2715;</button></div>';
            html += '<div class="widget-settings-body" style="padding:12px;min-height:220px;color:var(--theme-panel-fg);background:var(--theme-panel-bg);">';
            html += tabBarHtml;
            html += bodiesHtml;
            html += '<div style="display:flex;gap:8px;margin-top:10px;">' +
                '<button id="ts-apply" style="padding:6px 14px;color:var(--theme-panel-fg);border:1px solid var(--theme-panel-border);border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;">' + _('Apply') + '</button>' +
                '<button id="ts-ok" style="padding:6px 14px;background:#2dce89;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;">' + _('OK') + '</button>' +
                '<button id="ts-reset" style="padding:6px 14px;background:#e74c3c;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;">' + _('Defaults') + '</button>' +
                '<button id="ts-diagnostics" style="padding:6px 14px;margin-left:auto;color:var(--theme-panel-muted);border:1px solid var(--theme-panel-border);border-radius:4px;cursor:pointer;font-size:12px;">' + _('Diagnostics') + '</button>' +
                '</div></div>';

            p = document.createElement('div');
            p.id = 'theme-settings-panel';
            p.className = 'widget-settings';
            p.innerHTML = html;
            p.addEventListener('mousedown', function(e) { e.stopPropagation(); });
            document.body.appendChild(p);

            PanelHelper.makeMovable(p);
            PanelHelper.makeResizable(p);
            PanelHelper.fadeIn(p);

            // Initial wallpaper preview based on current mode
            var initialMode = cfg.desktop_wallpaper || 'gradient';
            _previewWallpaper(initialMode);
            // Panel opened with bing/picsum already selected: ensure a
            // first-time preview download happens if nothing is cached
            if (initialMode === 'bing' || initialMode === 'picsum') _ensurePreviewDownload(initialMode);

            // Check if current PREVIEW image is already saved to builtin
            function checkSavedState() {
                var saveBtn = document.getElementById('wp-save-btn');
                if (!saveBtn) return;
                var mode = (document.getElementById('ts-desktop_wallpaper') || {}).value || '';
                if (mode !== 'bing' && mode !== 'picsum') return;
                // Check the actual preview image (not cache file behind the scenes)
                // Strip any ?v= cache-buster — the check endpoint takes a filename.
                var previewFile = (window.__wp_preview_url || '').split('/').pop().split('?')[0];
                if (!previewFile) return;
                var xhr = new XMLHttpRequest();
                xhr.open('GET', '/cgi-bin/luci/admin/desktop/check_saved?mode=' + encodeURIComponent(mode) +
                         '&file=' + encodeURIComponent(previewFile), true);
                xhr.onload = function() {
                    try {
                        var r = JSON.parse(xhr.responseText);
                        if (r.saved) {
                            saveBtn.textContent = _('Saved');
                            saveBtn.style.background = 'rgba(255,255,255,0.08)';
                            saveBtn.style.color = '#888';
                            saveBtn.disabled = true;
                            saveBtn.title = _('Already in Built-in: ') + r.name;
                        } else {
                            saveBtn.textContent = _('Save');
                            saveBtn.style.background = 'rgba(45,206,137,0.85)';
                            saveBtn.style.color = '#fff';
                            saveBtn.disabled = false;
                            saveBtn.title = _('Save to Built-in');
                        }
                    } catch(e) {}
                };
                xhr.send();
            }
            checkSavedState();

            // Tab switching
            p.querySelectorAll('.ts-tab').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    switchTab(p, btn.getAttribute('data-tab'));
                });
            });

            // Wire inputs
            p.querySelectorAll('input[type=color], input[type=range]').forEach(function(el) {
                el.addEventListener('input', function() { onFieldChange(el); });
            });
            p.querySelectorAll('input[type=checkbox]').forEach(function(el) {
                el.addEventListener('change', function() { onFieldChange(el); });
            });
            // Picsum auto-refresh checkbox: sync hidden input value
            var paCb = document.getElementById('ts-picsum-auto-cb');
            if (paCb) {
                paCb.addEventListener('change', function() {
                    var hidden = document.getElementById('ts-picsum_auto_refresh');
                    if (hidden) hidden.value = paCb.checked ? '1' : '0';
                    onFieldChange(hidden);
                });
            }
            // Initial picsum auto-refresh checkbox visibility
            var wpSel = document.getElementById('ts-desktop_wallpaper');
            var paDiv = document.querySelector('.ts-picsum-auto');
            if (wpSel && paDiv) paDiv.style.display = (wpSel.value === 'picsum') ? '' : 'none';
            p.querySelectorAll('select').forEach(function(el) {
                el.addEventListener('change', function() {
                    onFieldChange(el);
                    var mode = el.value;
                    var wrapper = el.parentNode;
                    if (wrapper) {
                        var btn = wrapper.querySelector('.ts-wp-manage');
                        if (btn) btn.style.display = (mode === 'builtin') ? '' : 'none';
                        var refreshBtn = wrapper.querySelector('.ts-wp-refresh');
                        if (refreshBtn) refreshBtn.style.display = (mode === 'picsum' || mode === 'bing') ? '' : 'none';
                    }
                    // Toggle picsum auto-refresh checkbox
                    var paDiv = document.querySelector('.ts-picsum-auto');
                    if (paDiv) paDiv.style.display = (mode === 'picsum') ? '' : 'none';
                    // Toggle preview Save button
                    var saveBtn = document.getElementById('wp-save-btn');
                    if (saveBtn) {
                        saveBtn.style.display = (mode === 'bing' || mode === 'picsum') ? '' : 'none';
                        if (mode === 'bing' || mode === 'picsum') checkSavedState();
                    }
                    // Preview only — desktop unchanged until Apply
                    _previewWallpaper(mode);
                    // First-time switch to bing/picsum: download a preview
                    // in the background (only if no cached preview exists)
                    _ensurePreviewDownload(mode);
                });
            });
            p.querySelectorAll('.ts-wp-manage').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    if (window.WallpaperManager) WallpaperManager.open();
                });
                var wrapper = btn.parentNode;
                if (wrapper) {
                    var sel = wrapper.querySelector('select');
                    if (sel) btn.style.display = (sel.value === 'builtin') ? '' : 'none';
                }
            });
            p.querySelectorAll('.ts-wp-refresh').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    if (btn.disabled) return;
                    var wrapper = btn.parentNode;
                    var sel = wrapper ? wrapper.querySelector('select') : null;
                    var mode = sel ? sel.value : 'picsum';
                    console.log('[refresh] mode=' + mode + ' forcing download...');
                    btn.textContent = _('...');
                    btn.disabled = true;
                    btn.style.opacity = '0.5';
                    // Fake download progress shimmer
                    var preview = document.getElementById('wp-preview-img');
                    if (preview) preview.classList.add('wp-loading');
                    var xhr = new XMLHttpRequest();
                                        // preview=1: download to cache only — Refresh must not
                    // touch the confirmed desktop baseline until Apply/OK
                    xhr.open('GET', '/cgi-bin/luci/admin/desktop/random_wallpaper?mode=' + encodeURIComponent(mode) + '&force=1&preview=1', true);
                    xhr.onload = function() {
                        btn.textContent = _('Refresh');
                        btn.disabled = false;
                        btn.style.opacity = '';
                        if (preview) preview.classList.remove('wp-loading');
                        try {
                            if (xhr.status !== 200) {
                                console.log('[refresh] XHR failed: ' + xhr.status);
                                if (LuCIDesktop && LuCIDesktop.emit) LuCIDesktop.emit('toast', {msg: _('Refresh failed (server error)'), type: 'warn', key: 'wp-refresh-failed'});
                                return;
                            }
                            var r = JSON.parse(xhr.responseText);
                            console.log('[refresh] got url=' + (r.url || '').substring(0, 60) + ' debug=' + (r.debug || ''));
                            if (!r.url) return;
                            // Detect server-side download failure (network issue with picsum API)
                            if (r.debug && r.debug.indexOf('download=fail') !== -1) {
                                console.log('[refresh] server download failed, using cached image');
                                if (LuCIDesktop && LuCIDesktop.emit) LuCIDesktop.emit('toast', {msg: _('Picsum unreachable, showing cached image'), type: 'warn', key: 'wp-picsum-unreachable'});
                            }
                            // Update preview only — desktop-config untouched (Apply/OK handles it)
                            _previewWallpaper(mode, r.url);
                            markDirty();
                            checkSavedState();
                        } catch(e) { console.log('[refresh] error:', e.message); }
                    };
                    xhr.onerror = function() {
                        btn.textContent = _('Refresh');
                        btn.disabled = false;
                        btn.style.opacity = '';
                        if (preview) preview.classList.remove('wp-loading');
                        console.log('[refresh] network error');
                        if (LuCIDesktop && LuCIDesktop.emit) LuCIDesktop.emit('toast', {msg: _('Network error, check connection'), type: 'error'});
                    };
                    xhr.send();
                });
                // Initial visibility
                var wrapper2 = btn.parentNode;
                if (wrapper2) {
                    var sel = wrapper2.querySelector('select');
                    if (sel) btn.style.display = (sel.value === 'picsum' || sel.value === 'bing') ? '' : 'none';
                }
            });

            // Save to builtin button (preview box top-right): copies cache image to background dir
            var wpSaveBtn = document.getElementById('wp-save-btn');
            if (wpSaveBtn) {
                wpSaveBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    if (wpSaveBtn.disabled) return;
                    var mode = (document.getElementById('ts-desktop_wallpaper') || {}).value || '';
                    if (mode !== 'bing' && mode !== 'picsum') return;
                    console.log('[save-to-builtin] mode=' + mode);
                    wpSaveBtn.textContent = '...';
                    wpSaveBtn.disabled = true;
                    var xhr = new XMLHttpRequest();
                    xhr.open('POST', '/cgi-bin/luci/admin/desktop/save_to_builtin', true);
                    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
                    xhr.onload = function() {
                        try {
                            var r = JSON.parse(xhr.responseText);
                            console.log('[save-to-builtin] ok=' + r.ok + ' name=' + (r.name || r.msg || ''));
                            if (r.ok) {
                                wpSaveBtn.textContent = _('✓ Saved');
                                wpSaveBtn.style.background = 'rgba(45,206,137,0.2)';
                                wpSaveBtn.style.color = '#2dce89';
                                wpSaveBtn.style.border = '1px solid rgba(45,206,137,0.4)';
                                wpSaveBtn.disabled = true;
                                // Add to desktop-config builtin list (only if not duplicate)
                                if (!r.dup) {
                                    var c = LuCIDesktop.getConfig();
                                    if (c.wallpaper && c.wallpaper.builtin) {
                                        c.wallpaper.builtin.push(r.url);
                                        LuCIDesktop.setSectionLocal('wallpaper', c.wallpaper);
                                    }
                                }
                                if (window.LuCIDesktop && LuCIDesktop.emit) {
                                    LuCIDesktop.emit('toast', {msg: _('Saved: ') + r.name, type: 'info', key: 'wp-saved'});
                                }
                            } else {
                                // Server returned failure — keep disabled, let user retry via mode switch
                                wpSaveBtn.textContent = _('Error');
                                wpSaveBtn.style.background = 'rgba(200,40,40,0.3)';
                                wpSaveBtn.style.color = '#e74c3c';
                            }
                        } catch(e) { wpSaveBtn.textContent = _('Error'); wpSaveBtn.style.background = 'rgba(200,40,40,0.3)'; wpSaveBtn.style.color = '#e74c3c'; }
                    };
                    xhr.onerror = function() { wpSaveBtn.textContent = _('Error'); wpSaveBtn.style.background = 'rgba(200,40,40,0.3)'; wpSaveBtn.style.color = '#e74c3c'; };
                    xhr.send('mode=' + encodeURIComponent(mode));
                });
            }

            // Bg interactive preview: drag glow-dot (position) or handle-dot (spread+angle)
            // State + redraw hoisted so reset handler can access them
            var bgState = { x: gx, y: gy, spread: gs, angle: ga, c1: gc1, c2: gc2 };
            var redrawPreview;
            var applyBgState;

            var previewBox = document.getElementById('bg-preview-box');
            if (previewBox) {
                var glowDot = document.getElementById('bg-glow-dot');
                var handleDot = document.getElementById('bg-handle-dot');
                var dragTarget = null; // 'glow' or 'handle'

                applyBgState = function() {
                    var v = C.readFromDOM();
                    v.bg_glow_x = '' + bgState.x;
                    v.bg_glow_y = '' + bgState.y;
                    v.bg_spread = '' + bgState.spread;
                    v.bg_angle = '' + bgState.angle;
                    // Also pick up the latest colors from DOM
                    bgState.c1 = v.desktop_color1 || '#0d1117';
                    bgState.c2 = v.desktop_color2 || '#1a3a5c';
                    C.applyCss(v);
                    markDirty();
                }

                redrawPreview = function() {
                    var s = bgState.spread, a = bgState.angle;
                    var dotSz = Math.round(s * 1.2 + 20);
                    if (glowDot) {
                        glowDot.style.left = bgState.x + '%';
                        glowDot.style.top = bgState.y + '%';
                        glowDot.style.width = glowDot.style.height = dotSz + 'px';
                        glowDot.style.background = 'radial-gradient(circle,' + bgState.c2 + ' 0%,transparent 70%)';
                        glowDot.style.boxShadow = '0 0 8px ' + bgState.c2 + '33';
                    }
                    // Handle dot: offset from glow center via transform
                    var hDist = Math.round(s * 0.6 + 8);
                    var hRad = a * Math.PI / 180;
                    var hDx = Math.round(Math.cos(hRad) * hDist);
                    var hDy = Math.round(-Math.sin(hRad) * hDist);
                    if (handleDot) {
                        handleDot.style.left = bgState.x + '%';
                        handleDot.style.top = bgState.y + '%';
                        handleDot.style.transform = 'translate(calc(' + hDx + 'px - 50%), calc(' + hDy + 'px - 50%))';
                        handleDot.style.background = bgState.c2;
                    }
                    // Sync hidden inputs
                    ['bg_glow_x','bg_glow_y','bg_spread','bg_angle'].forEach(function(id) {
                        var el = document.getElementById('ts-' + id);
                        if (el) el.value = '' + bgState[id === 'bg_glow_x' ? 'x' : id === 'bg_glow_y' ? 'y' : id === 'bg_spread' ? 'spread' : 'angle'];
                    });
                }

                // Drag glow dot → change position
                glowDot.addEventListener('mousedown', function(e) {
                    e.preventDefault(); e.stopPropagation();
                    dragTarget = 'glow';
                });
                // Drag handle dot → change spread + angle
                handleDot.addEventListener('mousedown', function(e) {
                    e.preventDefault(); e.stopPropagation();
                    dragTarget = 'handle';
                });

                document.addEventListener('mousemove', function(e) {
                    if (!dragTarget || !previewBox) return;
                    var rect = previewBox.getBoundingClientRect();
                    var mx = e.clientX - rect.left;
                    var my = e.clientY - rect.top;

                    if (dragTarget === 'glow') {
                        bgState.x = Math.min(95, Math.max(5, Math.round(mx / rect.width * 100)));
                        bgState.y = Math.min(95, Math.max(5, Math.round(my / rect.height * 100)));
                    } else if (dragTarget === 'handle') {
                        // Compute polar coords relative to circle center (px in box)
                        var cx = bgState.x / 100 * rect.width;
                        var cy = bgState.y / 100 * rect.height;
                        var dx = mx - cx;
                        var dy = my - cy;
                        // distance → spread (clamp to reasonable range)
                        var dist = Math.round(Math.sqrt(dx*dx + dy*dy));
                        bgState.spread = Math.min(90, Math.max(30, Math.round((dist - 8) / 0.6)));
                        // angle → 0° = right, clockwise (screen Y inverted)
                        bgState.angle = Math.round(Math.atan2(-dy, dx) * 180 / Math.PI);
                        if (bgState.angle < 0) bgState.angle += 360;
                    }
                    redrawPreview();
                    applyBgState();
                });

                document.addEventListener('mouseup', function() { dragTarget = null; });

                // Sync preview when color inputs change
                ['ts-desktop_color1','ts-desktop_color2'].forEach(function(id) {
                    var el = document.getElementById(id);
                    if (el) el.addEventListener('input', function() {
                        bgState.c1 = (document.getElementById('ts-desktop_color1') || {}).value || gc1;
                        bgState.c2 = (document.getElementById('ts-desktop_color2') || {}).value || gc2;
                        redrawPreview();
                    });
                });
            }

            // Buttons
            p.querySelector('#ts-close').addEventListener('click', function() {
                var cfg = C.readFromConfig();
                var r = document.documentElement.style;
                console.log('[close] BEFORE revert: --taskbar-bg=' + r.getPropertyValue('--taskbar-bg').trim() +
                            ' --win-titlebar-bg=' + r.getPropertyValue('--win-titlebar-bg').trim() +
                            ' wallpaper=' + cfg.desktop_wallpaper +
                            ' builtin_ct=' + (cfg.builtin && cfg.builtin.length));
                C.applyCss(cfg);
                var oldWp = wpEl ? wpEl.style.backgroundImage : '';
                console.log('[close] AFTER revert: --taskbar-bg=' + r.getPropertyValue('--taskbar-bg').trim() +
                            ' wp_bg=' + oldWp.substring(0, 60));
                p.remove();
            });
            // Helper: current wallpaper mode from select + preview URL
            function _getPreviewUrl() {
                return window.__wp_preview_url || '';
            }
            function _getWallpaperMode() {
                var sel = document.getElementById('ts-desktop_wallpaper');
                return sel ? sel.value : '';
            }

            p.querySelector('#ts-apply').addEventListener('click', function() {
                var r = document.documentElement.style;
                console.log('[apply] BEFORE: --taskbar-bg=' + r.getPropertyValue('--taskbar-bg').trim() +
                            ' --win-titlebar-bg=' + r.getPropertyValue('--win-titlebar-bg').trim());
                var v = C.readFromDOM();
                C.saveToConfig(v);
                C.applyCss(v);
                var m = _getWallpaperMode();
                var u = _getPreviewUrl();
                if (m === 'builtin' && u.indexOf('/background/') === -1) u = '';
                console.log('[apply] AFTER: --taskbar-bg=' + r.getPropertyValue('--taskbar-bg').trim() +
                            ' --win-titlebar-bg=' + r.getPropertyValue('--win-titlebar-bg').trim() +
                            ' select_mode=' + m + ' preview_url=' + u);
                // bing/picsum: only confirm (cache→_desktop) when the preview
                // is NOT the confirmed desktop image (i.e. the user hit
                // Refresh and is choosing a new one). If the preview snapped
                // back to the desktop image, applying must leave the desktop
                // untouched — changing other params (fonts etc.) must never
                // swap the wallpaper behind the user's back.
                if (m === 'bing' || m === 'picsum') {
                    if (u.indexOf('_desktop.jpg') !== -1) {
                        // Preview = confirmed desktop → nothing to confirm
                        console.log('[apply] preview is desktop image, desktop unchanged');
                        LuCIDesktop._applyWallpaper({mode: m, url: u});
                        markClean();
                    } else {
                        var cx = new XMLHttpRequest();
                        cx.open('POST', '/cgi-bin/luci/admin/desktop/confirm_wallpaper', true);
                        cx.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
                        cx.onload = function() {
                            var desktopUrl = '/luci-static/desktop/cache/wallpaper_' + m + '_desktop.jpg?v=' + Date.now();
                            LuCIDesktop._applyWallpaper({mode: m, url: desktopUrl});
                            markClean();
                        };
                        cx.send('mode=' + m);
                    }
                } else {
                    LuCIDesktop._applyWallpaper({mode: m, url: u});
                    markClean();
                }
            });
            p.querySelector('#ts-ok').addEventListener('click', function() {
                if (dirty) {
                    var v = C.readFromDOM();
                    C.saveToConfig(v);
                    C.applyCss(v);
                }
                var m = _getWallpaperMode();
                var u = _getPreviewUrl();
                if (m === 'builtin' && u.indexOf('/background/') === -1) u = '';
                var r = document.documentElement.style;
                console.log('[ok] --taskbar-bg=' + r.getPropertyValue('--taskbar-bg').trim() +
                            ' select_mode=' + m + ' preview_url=' + u);
                if (m === 'bing' || m === 'picsum') {
                    if (u.indexOf('_desktop.jpg') !== -1) {
                        // Preview = confirmed desktop → desktop unchanged
                        console.log('[ok] preview is desktop image, desktop unchanged');
                        LuCIDesktop._applyWallpaper({mode: m, url: u});
                        p.remove();
                    } else {
                        var cx2 = new XMLHttpRequest();
                        cx2.open('POST', '/cgi-bin/luci/admin/desktop/confirm_wallpaper', true);
                        cx2.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
                        cx2.onload = function() {
                            var desktopUrl = '/luci-static/desktop/cache/wallpaper_' + m + '_desktop.jpg?v=' + Date.now();
                            LuCIDesktop._applyWallpaper({mode: m, url: desktopUrl});
                            p.remove();
                        };
                        cx2.send('mode=' + m);
                    }
                } else {
                    LuCIDesktop._applyWallpaper({mode: m, url: u});
                    p.remove();
                }
            });
            // Diagnostics: fetch the bug-report payload and copy to clipboard
            p.querySelector('#ts-diagnostics').addEventListener('click', function() {
                var btn = this;
                btn.disabled = true;
                var done = function(text) {
                    btn.disabled = false;
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(text).then(function() {
                            if (LuCIDesktop && LuCIDesktop.emit) LuCIDesktop.emit('toast', { msg: _('Diagnostics copied'), type: 'info', duration: 3000 });
                        }, function() { fallbackCopy(text); });
                    } else {
                        fallbackCopy(text);
                    }
                };
                var fallbackCopy = function(text) {
                    var ta = document.createElement('textarea');
                    ta.value = text;
                    ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
                    document.body.appendChild(ta);
                    ta.select();
                    try { document.execCommand('copy'); } catch (e) {}
                    ta.remove();
                    if (LuCIDesktop && LuCIDesktop.emit) LuCIDesktop.emit('toast', { msg: _('Diagnostics copied'), type: 'info', duration: 3000 });
                };
                fetch('/cgi-bin/luci/admin/desktop/diagnostics')
                    .then(function(r) { return r.text(); })
                    .then(done)
                    .catch(function() {
                        btn.disabled = false;
                        if (LuCIDesktop && LuCIDesktop.emit) LuCIDesktop.emit('toast', { msg: _('Network error, check connection'), type: 'error', duration: 4000 });
                    });
            });

            p.querySelector('#ts-reset').addEventListener('click', function() {
                var d = C.getDefaults();
                console.log('[reset] applying defaults: taskbar_color=' + d.taskbar_color);
                C.writeToDOM(d);
                C.applyCss(d);
                // Broadcast to iframes (same path as Apply)
                if (window.IframeBridge && IframeBridge.broadcastTheme) {
                    IframeBridge.broadcastTheme(d);
                }
                markDirty();
                // Reset preview state
                bgState.x = parseInt(d.bg_glow_x, 10);
                bgState.y = parseInt(d.bg_glow_y, 10);
                bgState.spread = parseInt(d.bg_spread, 10);
                bgState.angle = parseInt(d.bg_angle, 10);
                bgState.c1 = d.desktop_color1;
                bgState.c2 = d.desktop_color2;
                redrawPreview();
                // Sync wallpaper preview + button visibility with the reset
                // select values (change events don't fire on writeToDOM):
                // defaults are gradient, so the preview must snap back to
                // the gradient view and refresh/manage/save buttons hide.
                var dMode = d.desktop_wallpaper || 'gradient';
                _previewWallpaper(dMode);
                p.querySelectorAll('.ts-wp-manage').forEach(function(btn) {
                    var w = btn.parentNode;
                    var sel = w ? w.querySelector('select') : null;
                    if (sel) btn.style.display = (sel.value === 'builtin') ? '' : 'none';
                });
                p.querySelectorAll('.ts-wp-refresh').forEach(function(btn) {
                    var w = btn.parentNode;
                    var sel = w ? w.querySelector('select') : null;
                    if (sel) btn.style.display = (sel.value === 'picsum' || sel.value === 'bing') ? '' : 'none';
                });
                var paDiv = document.querySelector('.ts-picsum-auto');
                if (paDiv) paDiv.style.display = (dMode === 'picsum') ? '' : 'none';
                var saveBtn = document.getElementById('wp-save-btn');
                if (saveBtn) saveBtn.style.display = (dMode === 'bing' || dMode === 'picsum') ? '' : 'none';
                if (dMode === 'bing' || dMode === 'picsum') checkSavedState();
            });
        }
    };
})();
