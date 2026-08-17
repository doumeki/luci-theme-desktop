/* Theme Config — central field definitions
 *
 * Each field defines: id, label, type, default, css?, rgba?
 * Read/write/merge/apply are all type-aware, no scattered if/else.
 */

(function() {
    'use strict';

    // ===== Field Definitions =====
    var FIELDS = [
        // Titlebar
        {id:'titlebar_color', label:_('Titlebar (active)'), type:'color', def:'#1a1a2e', css:'--win-titlebar-bg;--win-titlebar-active-bg;--accent-color', rgba:['1', [26,26,46]]},
        {id:'titlebar_inactive_color', label:_('Titlebar (inactive)'), type:'color', def:'#444466', css:'--win-titlebar-inactive-bg'},
        {id:'titlebar_opacity', label:_('Titlebar Opacity'), type:'range', min:'0.2', max:'1', step:'0.05', def:'1'},
        // Taskbar
        {id:'taskbar_color', label:_('Taskbar'), type:'color', def:'#0d111c', css:'--taskbar-bg', rgba:['0.94', [13,13,28]]},
        {id:'taskbar_opacity', label:_('Taskbar Opacity'), type:'range', min:'0.1', max:'1', step:'0.05', def:'0.94'},
        {id:'taskbar_btn_color', label:_('Taskbar Btn (active)'), type:'color', def:'#4a90d9', css:'--accent-btn', rgba:['0.35', [74,144,217]]},
        // Start menu
        {id:'startmenu_color', label:_('Start Menu'), type:'color', def:'#16162a', css:'--startmenu-bg', rgba:['0.97', [22,22,42]]},
        {id:'startmenu_opacity', label:_('Start Menu Opacity'), type:'range', min:'0.1', max:'1', step:'0.05', def:'0.97'},
        {id:'startmenu_sel_color', label:_('Menu Selected'), type:'color', def:'#4a90d9', css:'--startmenu-sel'},
        // App content (iframe-internal theme, overrides cascade.css)
        {id:'app_dark_mode', label:_('Dark Mode'), type:'checkbox', def:true},
        {id:'app_primary_color', label:_('App Primary'), type:'color', def:'#286d31', css:'--primary'},
        {id:'app_primary_color_dark', label:_('App Primary (dark)'), type:'color', def:'#197025'},
        // Login page wallpaper
        {id:'desktop_wallpaper', label:_('Desktop Wallpaper'), type:'select', def:'gradient', opts:[
            {v:'gradient',  l:_('Gradient')},
            {v:'builtin',   l:_('Built-in')},
            {v:'bing',      l:_('Bing Daily')},
            {v:'picsum',    l:_('Picsum Photos')}
        ]},
        {id:'login_wallpaper', label:_('Login Wallpaper'), type:'select', def:'gradient', opts:[
            {v:'gradient',  l:_('Gradient')},
            {v:'builtin',   l:_('Built-in')},
            {v:'bing',      l:_('Bing Daily')},
            {v:'picsum',    l:_('Picsum Photos')}
        ]},
        // Fonts
        {id:'icon_font_size', label:_('Desktop Font Size'), type:'range', min:'9', max:'24', step:'1', def:'11', css:'--icon-font-size', unit:'px'},
        {id:'icon_font_color', label:_('Desktop Font Color'), type:'color', def:'#ffffff', css:'--icon-font-color'},
        {id:'icon_font_bold', label:_('Bold'), type:'checkbox', def:true, css:'--icon-font-weight', transform: function(v) { return (v === '1' || v === true) ? '700' : '400'; }},
        {id:'icon_font_shadow', label:_('Label Glow'), type:'range', min:'0', max:'1', step:'0.05', def:'0.7', css:'--icon-font-shadow', transform: function(v) { var a=parseFloat(v); if(isNaN(a)||a<=0)return'none'; return '0 0 '+(a*2).toFixed(1)+'px rgba(0,0,0,'+(a*0.8).toFixed(1)+'), 0 1px '+(a*3).toFixed(1)+'px rgba(0,0,0,'+(a*0.5).toFixed(1)+')'; }},
        {id:'icon_opacity', label:_('Icon Opacity'), type:'range', min:'0.5', max:'1', step:'0.05', def:'1', css:'--icon-opacity'},
        {id:'icon_bg', label:_('Icon Background'), type:'checkbox', def:false, css:'--icon-bg', transform: function(v) { return (v === '1' || v === true) ? 'rgba(255,255,255,0.9)' : 'transparent'; }},
        {id:'menu_font_size', label:_('Menu Font Size'), type:'range', min:'10', max:'24', step:'1', def:'13', css:'--menu-font-size', unit:'px'},
        {id:'menu_font_color', label:_('Menu Font Color'), type:'color', def:'#e0e0e0', css:'--startmenu-fg'},
        {id:'content_zoom', label:_('Content Zoom'), type:'range', min:'80', max:'150', step:'5', def:'100', css:'--content-zoom', unit:'%', transform: function(v) { return (parseInt(v) / 100); }},
        // Desktop background
        {id:'desktop_color1', label:_('Bg Base'), type:'color', def:'#0d1117'},
        {id:'desktop_color2', label:_('Bg Glow'), type:'color', def:'#1a3a5c'},
        // Gradient position / spread / angle
        {id:'bg_glow_x', label:_('Glow X'), type:'range', min:'5', max:'95', step:'1', def:'30', unit:'%'},
        {id:'bg_glow_y', label:_('Glow Y'), type:'range', min:'5', max:'95', step:'1', def:'20', unit:'%'},
        {id:'bg_spread', label:_('Spread'), type:'range', min:'30', max:'90', step:'1', def:'60', unit:'%'},
        {id:'bg_angle',  label:_('Angle'), type:'range', min:'0', max:'359', step:'1', def:'135', unit:'deg'},
        // Misc
        {id:'menu_hover_mode', label:_('Menu Hover'), type:'checkbox', def:true},
        {id:'picsum_auto_refresh', label:_('Picsum Auto Refresh'), type:'hidden', def:'0'}
    ];

    // Layout groups for the settings panel
    var LAYOUT = {
        main: [
            {label:_('Titlebar'), fields:['titlebar_color','titlebar_inactive_color','titlebar_opacity']},
            {label:_('Taskbar'),  fields:['taskbar_color','taskbar_opacity','taskbar_btn_color']},
            {label:_('Start Menu'), fields:['startmenu_color','startmenu_opacity','startmenu_sel_color']}
        ],
        theme: [
            {label:_('App'),  fields:['app_dark_mode','app_primary_color','app_primary_color_dark']},
            {label:_('Icons'), fields:['icon_opacity','icon_bg']},
            {label:_('Menu'), fields:['menu_hover_mode']},
            {label:_('Login'), fields:['login_wallpaper']}
        ],
        fonts: [
            {label:_('Desktop'), fields:['icon_font_size','icon_font_color','icon_font_bold','icon_font_shadow']},
            {label:_('Menu'),    fields:['menu_font_size','menu_font_color','content_zoom']}
        ],
        bg: ['desktop_wallpaper','desktop_color1','desktop_color2']
    };

    // Index for fast lookup
    var byId = {};
    FIELDS.forEach(function(f) { byId[f.id] = f; });

    // ===== Helpers =====
    function hexToRgb(h) {
        if (!h) return null;
        var x = h.replace('#','');
        if (x.length === 3) x = x[0]+x[0]+x[1]+x[1]+x[2]+x[2];
        if (x.length !== 6) return null;
        return [parseInt(x.substring(0,2),16), parseInt(x.substring(2,4),16), parseInt(x.substring(4,6),16)];
    }

    // ===== Core API =====
    var ThemeConfig = {
        fields: FIELDS,
        layout: LAYOUT,
        byId: byId,

        // Single source of truth for default values — CSS :root / JS / UCI seed all derive from this.
        // Pre-computed at load time; use getDefaults() for a fresh copy.
        DEFAULT_THEME: null, // set below

        getDefaults: function() {
            var d = {};
            FIELDS.forEach(function(f) { d[f.id] = f.def; });
            return d;
        },

        // Merge stored values over defaults (handles falsy correctly)
        mergeDefaults: function(stored) {
            var d = this.getDefaults();
            if (!stored) { console.log('[theme] mergeDefaults: no stored values, using defaults'); return d; }
            var merged = 0;
            for (var k in stored) {
                if (stored[k] !== undefined && stored[k] !== null && stored[k] !== '') {
                    d[k] = stored[k];
                    merged++;
                }
            }
            console.log('[theme] mergeDefaults: merged ' + merged + ' values, taskbar_color=' + d.taskbar_color);
            return d;
        },

        // Read all field values from DOM
        readFromDOM: function() {
            var vals = {};
            FIELDS.forEach(function(f) {
                var el = document.getElementById('ts-' + f.id);
                if (!el) return;
                if (f.type === 'checkbox') { vals[f.id] = el.checked ? '1' : '0'; }
                else { vals[f.id] = el.value; }
            });
            console.log('[theme] readFromDOM: taskbar_color=' + vals.taskbar_color + ' taskbar_opacity=' + vals.taskbar_opacity +
                        ' titlebar_color=' + vals.titlebar_color + ' startmenu_color=' + vals.startmenu_color +
                        ' wallpaper=' + vals.desktop_wallpaper + ' dark=' + vals.app_dark_mode);
            return vals;
        },

        // Write values to DOM
        writeToDOM: function(vals, fieldIds) {
            var self = this;
            (fieldIds || FIELDS.map(function(f) { return f.id; })).forEach(function(id) {
                var f = byId[id];
                if (!f) return;
                var el = document.getElementById('ts-' + id);
                if (!el) return;
                var v = vals[id];
                if (f.type === 'checkbox') { el.checked = (v === '1' || v === true); }
                else if (f.type === 'range') {
                    el.value = (v !== undefined && v !== '') ? v : f.def;
                    var lbl = document.getElementById('tsv-' + id);
                    if (lbl) lbl.textContent = ThemeConfig.formatValue(f, el.value);
                } else {
                    el.value = v || f.def || '';
                }
            });
        },

        // Format display value for range/zoom
        formatValue: function(f, v) {
            if (f.id === 'content_zoom') return v + '%';
            if (f.unit === 'px' || f.id.indexOf('font_size') !== -1) return v + 'px';
            if (f.unit === 'deg') return v + '°';
            if (f.unit === '%') return v + '%';
            return Math.round(v * 100) + '%'; // opacity fields (0–1)
        },

        // Apply values as CSS variables on <html>
        applyCss: function(vals) {
            var r = document.documentElement.style;
            console.log('[theme] applyCss: taskbar_color=' + vals.taskbar_color + ' taskbar_opacity=' + vals.taskbar_opacity +
                        ' titlebar_color=' + vals.titlebar_color + ' startmenu_color=' + vals.startmenu_color +
                        ' dark=' + vals.app_dark_mode);

            // Sync data-theme attribute (drives light/dark shell + panel CSS)
            var dark = vals.app_dark_mode;
            if (dark === '1' || dark === true) {
                document.documentElement.setAttribute('data-theme', 'dark');
            } else if (dark === '0' || dark === false) {
                document.documentElement.removeAttribute('data-theme');
            }
            // Also update <meta name="theme-color"> for mobile
            var mc = document.querySelector('meta[name="theme-color"]');
            if (mc) mc.content = (dark === '1' || dark === true) ? '#1a1a2e' : '#e8eaed';
            FIELDS.forEach(function(f) {
                if (!f.css) return;
                var cssNames = f.css.split(';');
                var v = vals[f.id];

                if (f.rgba) {
                    var hex = v || f.def;
                    var alpha = f.rgba[0];
                    // If there's a paired opacity field, use it
                    var opacityField = f.id.replace('_color','_opacity');
                    if (byId[opacityField] && vals[opacityField] !== undefined && vals[opacityField] !== '') {
                        alpha = vals[opacityField];
                    }
                    // When fully opaque, use hex directly (cleaner, passes tests)
                    if (alpha === '1' || alpha === 1 || alpha === 1.0) {
                        cssNames.forEach(function(name) { r.setProperty(name, hex); });
                    } else {
                        var rgb = hexToRgb(hex) || f.rgba[1];
                        var val = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + alpha + ')';
                        cssNames.forEach(function(name) { r.setProperty(name, val); });
                    }
                } else if (f.transform) {
                    var val2 = f.transform(v || f.def);
                    cssNames.forEach(function(name) { r.setProperty(name, val2); });
                } else if (f.unit === 'px') {
                    cssNames.forEach(function(name) { r.setProperty(name, (v || f.def) + 'px'); });
                } else if (f.unit === '%') {
                    // handled by transform
                } else {
                    cssNames.forEach(function(name) { r.setProperty(name, v || f.def); });
                }
            });

            // Icon text color: dark on solid bg, otherwise follow icon-font-color
            var iconBg = vals.icon_bg;
            var iconFg = vals.icon_font_color || '#ffffff';
            r.setProperty('--icon-text', (iconBg === '1' || iconBg === true) ? '#333' : iconFg);

            // Titlebar foreground: pick a contrasting color (light/dark) against
            // the titlebar background so title text and window controls stay visible
            var tbRgb = hexToRgb(vals.titlebar_color) || [26,26,46];
            var yiq = (tbRgb[0]*299 + tbRgb[1]*587 + tbRgb[2]*114) / 1000;
            r.setProperty('--win-titlebar-fg', yiq >= 150 ? '#222' : '#f0f0f0');

            // Taskbar foreground: clock, start button (●) and tray icons
            // must contrast against the user's taskbar color
            var tkRgb = hexToRgb(vals.taskbar_color) || [13,17,28];
            var tkYiq = (tkRgb[0]*299 + tkRgb[1]*587 + tkRgb[2]*114) / 1000;
            r.setProperty('--taskbar-fg', tkYiq >= 150 ? '#222' : '#e8e8ea');

            // Start menu: hover background + selected-item foreground contrast
            var smBgRgb = hexToRgb(vals.startmenu_color) || [22,22,42];
            var smYiq = (smBgRgb[0]*299 + smBgRgb[1]*587 + smBgRgb[2]*114) / 1000;
            r.setProperty('--startmenu-hover-bg', smYiq >= 150 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.2)');
            var smSelRgb = hexToRgb(vals.startmenu_sel_color) || [74,144,217];
            var smSelYiq = (smSelRgb[0]*299 + smSelRgb[1]*587 + smSelRgb[2]*114) / 1000;
            r.setProperty('--startmenu-sel-fg', smSelYiq >= 150 ? '#222' : '#fff');
            // Muted fg for empty-state / footer / logout (light or dark start menu)
            r.setProperty('--startmenu-fg-muted', smYiq >= 150 ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.4)');

            // Log actual CSS vars after apply
            console.log('[theme] after apply: --taskbar-bg=' + r.getPropertyValue('--taskbar-bg').trim() +
                        ' --win-titlebar-bg=' + r.getPropertyValue('--win-titlebar-bg').trim() +
                        ' --startmenu-bg=' + r.getPropertyValue('--startmenu-bg').trim());

            // Desktop gradient: two glow spots at opposite corners + angle base
            var dc1 = vals.desktop_color1, dc2 = vals.desktop_color2;
            if (dc1 && dc2) {
                var gx = vals.bg_glow_x || '30';
                var gy = vals.bg_glow_y || '20';
                var spread = vals.bg_spread || '60';
                var angle = vals.bg_angle || '135';
                var oppX = Math.min(95, Math.max(5, 100 - parseInt(gx, 10)));
                var oppY = Math.min(95, Math.max(5, 100 - parseInt(gy, 10)));
                r.setProperty('--desktop-wallpaper',
                    'radial-gradient(ellipse at ' + gx + '% ' + gy + '%, ' + dc2 + ' 0%, transparent ' + spread + '%),' +
                    'radial-gradient(ellipse at ' + oppX + '% ' + oppY + '%, ' + dc1 + ' 0%, transparent ' + spread + '%),' +
                    'linear-gradient(' + angle + 'deg, ' + dc1 + ' 0%, ' + dc1 + ' 50%, ' + dc1 + ' 100%)');
            }

        },

        // Read from the config access layer (theme section)
        readFromConfig: function() {
            try {
                var t = LuCIDesktop.getSection('theme');
                console.log('[theme] readFromConfig: taskbar_color=' + t.taskbar_color + ' taskbar_opacity=' + t.taskbar_opacity +
                            ' titlebar_color=' + t.titlebar_color + ' wallpaper=' + t.desktop_wallpaper);
                return t;
            } catch(e) { console.log('[theme] readFromConfig error:', e.message); return {}; }
        },

        // ===== ThemeSession: unified preview / commit / rollback =====
        // begin() → preview(vals) on any change → commit(vals) on Apply/OK → rollback() on Close
        beginSession: function() {
            var self = this;
            var r = document.documentElement.style;
            var fieldsWithCss = FIELDS.filter(function(f) { return f.css; });
            // Snapshot current state
            var snap = {
                vars: {},
                theme: document.documentElement.getAttribute('data-theme') || '',
                wpBg: '',
                wpUrl: null
            };
            fieldsWithCss.forEach(function(f) {
                var names = f.css.split(';');
                names.forEach(function(n) {
                    snap.vars[n] = r.getPropertyValue(n).trim();
                });
            });
            // Wallpaper snapshot
            try {
                var wpc = LuCIDesktop.getSection('wallpaper');
                snap.wpUrl = wpc && wpc.url;
            } catch(e) {}
            var wp = document.getElementById('desktop-wallpaper');
            if (wp) snap.wpBg = wp.style.backgroundImage;

            return {
                preview: function(vals) {
                    self.applyCss(self.mergeDefaults(vals));
                },
                commit: function(vals) {
                    self.saveToConfig(vals);
                },
                rollback: function() {
                    // Restore CSS variables
                    for (var k in snap.vars) {
                        if (snap.vars[k]) r.setProperty(k, snap.vars[k]);
                        else r.removeProperty(k);
                    }
                    // Restore data-theme
                    if (snap.theme) document.documentElement.setAttribute('data-theme', snap.theme);
                    else document.documentElement.removeAttribute('data-theme');
                    // Restore wallpaper (only if a wallpaper section exists —
                    // same "don't create it" semantics as the old DOM path)
                    var wp = document.getElementById('desktop-wallpaper');
                    if (wp) wp.style.backgroundImage = snap.wpBg;
                    try {
                        var wps = LuCIDesktop.getConfig().wallpaper;
                        if (wps) {
                            wps.url = snap.wpUrl;
                            LuCIDesktop.setSectionLocal('wallpaper', wps);
                        }
                    } catch(e) {}
                }
            };
        },

        // Save to UCI + update in-page config
        saveToConfig: function(vals) {
            // Update in-page config immediately (theme section via access layer)
            try {
                var t = LuCIDesktop.getSection('theme');
                for (var k in vals) { t[k] = vals[k]; }
                LuCIDesktop.setSectionLocal('theme', t);
            } catch(e) {}
            // POST theme values as JSON via unified endpoint
            LuCIDesktop.saveDesktopSection('settings', vals);
            // Broadcast theme changes to open iframes (dark mode, primary colors)
            if (window.IframeBridge && IframeBridge.broadcastTheme) {
                IframeBridge.broadcastTheme(vals);
            }
            // Wallpaper sync handled by Apply/OK in themesettings.js via
            // LuCIDesktop._applyWallpaper({refresh: false}) — not here.
        }
    };

    ThemeConfig.DEFAULT_THEME = ThemeConfig.getDefaults();

    window.ThemeConfig = ThemeConfig;
})();
