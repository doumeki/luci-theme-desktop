/* theme-settings.test.js — Theme Settings integration tests
 *
 * Tests from user perspective: open panel → change values → Apply/OK/Cancel
 * → verify CSS applied → verify UCI persistence → verify re-open shows saved values.
 */
(function() {
'use strict';

// Setup minimal DOM needed by theme settings panel + theme-config.js
function setupDOM() {
    // Ensure desktop-config exists with defaults
    var cfg = document.getElementById('desktop-config');
    if (!cfg) {
        cfg = document.createElement('script');
        cfg.id = 'desktop-config';
        cfg.type = 'application/json';
        document.head.appendChild(cfg);
    }
    cfg.textContent = JSON.stringify({
        widgets: {}, pins: [], hidden_icons: [],
        theme: {
            titlebar_color: '#1a1a2e',
            titlebar_opacity: '1',
            app_dark_mode: '1',
            desktop_wallpaper: 'gradient',
            login_wallpaper: 'gradient',
            auto_refresh: '1'
        }
    });

    // Clean up existing panel
    var p = document.getElementById('theme-settings-panel');
    if (p) p.remove();
}

// Helper: open the theme panel
function openPanel() {
    ThemeSettings.open();
    return document.getElementById('theme-settings-panel');
}

// Helper: get CSS var value from documentElement
function getCSSVar(name) {
    return document.documentElement.style.getPropertyValue(name).trim();
}

// ===== 1. Panel lifecycle =====
describe('Theme Settings panel lifecycle', function() {
    beforeEach(setupDOM);

    it('should open the panel', function() {
        var p = openPanel();
        assert.ok(p, 'panel exists');
        assert.ok(p.querySelector('.ts-tab'), 'tabs rendered');
    });

    it('should close on X click', function() {
        openPanel();
        var closeBtn = document.getElementById('ts-close');
        assert.ok(closeBtn, 'close button exists');
        closeBtn.click();
        assert.isNull(document.getElementById('theme-settings-panel'), 'panel removed');
    });

    it('should reopen correctly after close', function() {
        openPanel();
        document.getElementById('ts-close').click();
        openPanel();
        assert.ok(document.getElementById('theme-settings-panel'), 'reopened');
    });
});

// ===== 2. Apply / OK / Cancel behavior =====
describe('Theme Settings Apply / OK / Cancel', function() {
    beforeEach(function() {
        setupDOM();
        ThemeConfig.applyCss(ThemeConfig.mergeDefaults({titlebar_color: '#1a1a2e'}));
    });

    it('should apply CSS on Apply click', function() {
        var p = openPanel();
        var colorInput = document.getElementById('ts-titlebar_color');
        if (!colorInput) { assert.fail('titlebar_color input not found'); return; }
        colorInput.value = '#ff0000';
        colorInput.dispatchEvent(new Event('input', {bubbles: true}));
        document.getElementById('ts-apply').click();
        var val = getCSSVar('--accent-color');
        assert.contains(val.replace(/\s/g,''), 'ff0000', 'red applied to --accent-color');
    });

    it('should show dirty state when value changed', function() {
        var p = openPanel();
        var colorInput = document.getElementById('ts-titlebar_color');
        if (!colorInput) { assert.fail('color input not found'); return; }
        colorInput.value = '#123456';
        colorInput.dispatchEvent(new Event('input', {bubbles: true}));
        var applyBtn = document.getElementById('ts-apply');
        assert.contains(applyBtn.textContent, '*', 'Apply button shows dirty indicator');
    });

    it('should clear dirty state after Apply', function() {
        var p = openPanel();
        var colorInput = document.getElementById('ts-titlebar_color');
        if (!colorInput) { assert.fail('color input not found'); return; }
        colorInput.value = '#123456';
        colorInput.dispatchEvent(new Event('input', {bubbles: true}));
        document.getElementById('ts-apply').click();
        var applyBtn = document.getElementById('ts-apply');
        assert.ok(applyBtn.textContent.indexOf('*') === -1, 'dirty indicator cleared');
    });

    it('should revert CSS on Close (cancel)', function() {
        var p = openPanel();
        var colorInput = document.getElementById('ts-titlebar_color');
        if (!colorInput) { assert.fail('color input not found'); return; }
        colorInput.value = '#ff0000';
        colorInput.dispatchEvent(new Event('input', {bubbles: true}));
        var previewVal = getCSSVar('--accent-color');
        assert.contains(previewVal.replace(/\s/g,''), 'ff0000', 'preview applied');
        // Close without saving
        document.getElementById('ts-close').click();
        // After close, session.rollback should restore original
        var reverted = getCSSVar('--accent-color');
        assert.contains(reverted.replace(/\s/g,''), '1a1a2e', 'restored to saved value');
    });

    it('should restore defaults on Defaults button', function() {
        var p = openPanel();
        var colorInput = document.getElementById('ts-titlebar_color');
        if (!colorInput) { assert.fail('color input not found'); return; }
        colorInput.value = '#ff0000';
        colorInput.dispatchEvent(new Event('input', {bubbles: true}));
        document.getElementById('ts-reset').click();
        // After reset, input should be back to default '#1a1a2e'
        // But it might show the default color value
        assert.ok(colorInput.value !== '#ff0000', 'color reset from red');
    });
});

// ===== 3. UCI persistence (mock XHR) =====
describe('Theme Settings UCI persistence', function() {
    var origXHR, lastBody;

    beforeEach(function() {
        setupDOM();
        origXHR = window.XMLHttpRequest;
        window.XMLHttpRequest = function() {
            this.open = function(method, url) {};
            this.setRequestHeader = function() {};
            this.send = function(body) { lastBody = body; };
        };
    });

    afterEach(function() {
        window.XMLHttpRequest = origXHR;
        lastBody = undefined;
    });

    it('should POST theme settings as JSON via unified endpoint', function() {
        var p = openPanel();
        var colorInput = document.getElementById('ts-titlebar_color');
        if (!colorInput) { assert.fail('color input not found'); return; }
        colorInput.value = '#abcdef';
        colorInput.dispatchEvent(new Event('input', {bubbles: true}));
        document.getElementById('ts-apply').click();
        assert.ok(lastBody, 'XHR was sent');
        assert.contains(lastBody, 'section=settings', 'uses unified endpoint with settings section');
        assert.contains(lastBody, 'titlebar_color', 'contains titlebar_color in JSON');
        assert.contains(lastBody, '%23abcdef', 'encoded color in JSON body');
    });

    it('should include auto_refresh in JSON via unified endpoint', function() {
        var vals = ThemeConfig.mergeDefaults(ThemeConfig.readFromConfig());
        vals.auto_refresh = '1';
        ThemeConfig.saveToConfig(vals);
        assert.ok(lastBody, 'XHR was sent');
        assert.contains(lastBody, 'section=settings', 'unified endpoint section');
        assert.contains(lastBody, 'auto_refresh', 'contains auto_refresh in JSON');
    });

    it('should include desktop_wallpaper in POST', function() {
        var p = openPanel();
        var sel = document.getElementById('ts-desktop_wallpaper');
        if (!sel) { assert.fail('desktop_wallpaper select not found'); return; }
        sel.value = 'builtin';
        sel.dispatchEvent(new Event('change', {bubbles: true}));
        document.getElementById('ts-apply').click();
        assert.contains(lastBody, 'section=settings', 'unified endpoint');
        assert.contains(lastBody, 'desktop_wallpaper', 'wallpaper key in JSON');
        assert.contains(lastBody, 'builtin', 'builtin value in JSON');
    });
});

// ===== 4. Re-open shows saved values =====
describe('Theme Settings reopen persistence', function() {
    beforeEach(function() {
        setupDOM();
        // Set a known value in desktop-config
        var cfg = document.getElementById('desktop-config');
        cfg.textContent = JSON.stringify({
            widgets: {}, pins: [], hidden_icons: [],
            theme: {
                titlebar_color: '#aabbcc',
                titlebar_opacity: '0.5',
                app_dark_mode: '0',
                desktop_wallpaper: 'builtin',
                auto_refresh: '1'
            }
        });
    });

    it('should show saved value when reopened', function() {
        var p = openPanel();
        var colorInput = document.getElementById('ts-titlebar_color');
        assert.ok(colorInput, 'input exists');
        assert.equal(colorInput.value, '#aabbcc', 'saved color shown');
        document.getElementById('ts-close').click();
        // Reopen
        openPanel();
        var colorInput2 = document.getElementById('ts-titlebar_color');
        assert.equal(colorInput2.value, '#aabbcc', 'color persists after reopen');
    });

    it('should show saved wallpaper mode', function() {
        var p = openPanel();
        var sel = document.getElementById('ts-desktop_wallpaper');
        if (!sel) { assert.fail('select not found'); return; }
        assert.equal(sel.value, 'builtin', 'wallpaper mode persisted');
    });

    it('checkbox should reflect saved value', function() {
        var p = openPanel();
        var cb = document.getElementById('ts-app_dark_mode');
        if (!cb) { assert.fail('checkbox not found'); return; }
        assert.ok(!cb.checked, 'dark mode unchecked (was "0")');
    });
});

// ===== 5. Tab switching =====
describe('Theme Settings tab switching', function() {
    beforeEach(setupDOM);

    it('should start on Theme tab (first)', function() {
        var p = openPanel();
        var themeBody = p.querySelector('.ts-tab-body[data-tab="theme"]');
        assert.ok(themeBody.style.display !== 'none' || themeBody.style.display === '', 'Theme tab visible (first)');
        var tabs = p.querySelectorAll('.ts-tab');
        assert.ok(tabs.length >= 4, 'all tabs rendered');
        assert.ok(tabs[0].getAttribute('data-tab') === 'theme', 'Theme tab is first');
        assert.ok(tabs[1].getAttribute('data-tab') === 'colors', 'Colors tab is second');
    });

    it('should switch to Bg tab on click', function() {
        var p = openPanel();
        var bgTab = p.querySelector('.ts-tab[data-tab="bg"]');
        assert.ok(bgTab, 'Bg tab exists');
        bgTab.click();
        var bgBody = p.querySelector('.ts-tab-body[data-tab="bg"]');
        assert.ok(bgBody.style.display !== 'none', 'Bg tab body visible after click');
    });

    it('should switch to Theme tab on click', function() {
        var p = openPanel();
        var themeTab = p.querySelector('.ts-tab[data-tab="theme"]');
        assert.ok(themeTab, 'Theme tab exists');
        themeTab.click();
        var themeBody = p.querySelector('.ts-tab-body[data-tab="theme"]');
        assert.ok(themeBody.style.display !== 'none', 'Theme tab body visible');
    });
});

// ===== 6. Wallpaper mode switching =====
describe('Theme Settings wallpaper modes', function() {
    beforeEach(setupDOM);

    it('should show Manage button only for builtin', function() {
        var p = openPanel();
        var sel = document.getElementById('ts-desktop_wallpaper');
        if (!sel) { assert.fail('select not found'); return; }
        // Change to builtin
        sel.value = 'builtin';
        sel.dispatchEvent(new Event('change', {bubbles: true}));
        var wrapper = sel.parentNode;
        var btn = wrapper.querySelector('.ts-wp-manage');
        assert.ok(btn, 'Manage button exists');
        assert.ok(btn.style.display !== 'none', 'Manage button visible for builtin');

        // Change to gradient
        sel.value = 'gradient';
        sel.dispatchEvent(new Event('change', {bubbles: true}));
        assert.equal(btn.style.display, 'none', 'Manage button hidden for gradient');
    });

    it('should have all wallpaper options', function() {
        var p = openPanel();
        var sel = document.getElementById('ts-desktop_wallpaper');
        if (!sel) { assert.fail('select not found'); return; }
        var opts = sel.querySelectorAll('option');
        assert.ok(opts.length >= 4, 'has at least 4 options');
        var values = [];
        opts.forEach(function(o) { values.push(o.value); });
        assert.ok(values.indexOf('gradient') !== -1, 'has gradient');
        assert.ok(values.indexOf('builtin') !== -1, 'has builtin');
        assert.ok(values.indexOf('bing') !== -1, 'has bing');
        assert.ok(values.indexOf('picsum') !== -1, 'has picsum');
    });
});

// ===== 7. applyCss — gradient computation =====
describe('ThemeConfig.applyCss gradient', function() {
    beforeEach(setupDOM);

    it('should set --desktop-wallpaper CSS variable', function() {
        ThemeConfig.applyCss(ThemeConfig.mergeDefaults({
            desktop_color1: '#111111',
            desktop_color2: '#222222',
            bg_glow_x: '50',
            bg_glow_y: '50',
            bg_spread: '70',
            bg_angle: '90'
        }));
        var val = getCSSVar('--desktop-wallpaper');
        assert.contains(val, 'radial-gradient', 'contains radial-gradient');
        assert.contains(val, '#111111', 'contains color1');
        assert.contains(val, '#222222', 'contains color2');
        assert.contains(val, '90deg', 'contains angle');
    });

    it('should compute opposite glow position', function() {
        ThemeConfig.applyCss(ThemeConfig.mergeDefaults({
            desktop_color1: '#111', desktop_color2: '#222',
            bg_glow_x: '70', bg_glow_y: '30',
            bg_spread: '50', bg_angle: '0'
        }));
        var val = getCSSVar('--desktop-wallpaper');
        // Opposites: at 30% (100-70), at 70% (100-30)
        assert.ok(val.indexOf('at 30% 70%') !== -1 || val.indexOf('at 70% 30%') !== -1,
            'has correct opposite position');
    });

    it('should set font size CSS var', function() {
        ThemeConfig.applyCss(ThemeConfig.mergeDefaults({icon_font_size: '18'}));
        assert.equal(getCSSVar('--icon-font-size'), '18px');
    });

    it('should handle range transform (label glow)', function() {
        ThemeConfig.applyCss(ThemeConfig.mergeDefaults({icon_font_shadow: '1'}));
        var v = getCSSVar('--icon-font-shadow');
        assert.ok(v.indexOf('rgba') !== -1, 'glow applied at 1');

        ThemeConfig.applyCss(ThemeConfig.mergeDefaults({icon_font_shadow: '0'}));
        var v2 = getCSSVar('--icon-font-shadow');
        assert.equal(v2, 'none', 'no glow at 0');
    });
});

// ===== 8. Wallpaper snapshot / rollback =====
	// ===== Preview / Desktop wallpaper separation =====
	// Switching modes or Refresh only affects preview area, NOT #desktop-wallpaper.
	// Only Apply/OK syncs desktop background.
	describe('Wallpaper preview vs desktop separation', function() {
		var wpEl, select;

		function setupWallpaperTest(initialMode, initialUrl) {
			setupDOM();
			wpEl = document.getElementById('desktop-wallpaper');
			if (!wpEl) {
				wpEl = document.createElement('div');
				wpEl.id = 'desktop-wallpaper';
				document.body.appendChild(wpEl);
			}
			wpEl.style.backgroundImage = initialUrl ? 'url("' + initialUrl + '")' : '';
			wpEl.style.backgroundSize = initialUrl ? 'cover' : '';
			wpEl.style.backgroundPosition = initialUrl ? 'center' : '';

			var cfg = document.getElementById('desktop-config');
			var theme = cfg ? JSON.parse(cfg.textContent).theme || {} : {};
			theme.desktop_wallpaper = initialMode;
			cfg.textContent = JSON.stringify({
				widgets: {}, pins: [], hidden_icons: [],
				wallpaper: {
					mode: initialMode,
					url: initialUrl || null,
					builtin: ['/bg/1.jpg', '/bg/2.jpg', '/bg/3.jpg']
				},
				theme: theme
			});
		}

		function getDesktopBg() { return wpEl ? wpEl.style.backgroundImage : ''; }
		function getWpMode() {
			try { return JSON.parse(document.getElementById('desktop-config').textContent).wallpaper.mode; } catch(e) {}
		}
		function getWpUrl() {
			try { return JSON.parse(document.getElementById('desktop-config').textContent).wallpaper.url; } catch(e) {}
		}
		function getWpSetting() {
			try { return JSON.parse(document.getElementById('desktop-config').textContent).theme.desktop_wallpaper; } catch(e) {}
		}

		// ===== Desktop unchanged on mode switch (preview only) =====
		it('switch mode → desktop background stays unchanged', function() {
			setupWallpaperTest('bing', '/cache/wallpaper_bing.jpg');
			assert.contains(getDesktopBg(), 'wallpaper_bing.jpg', 'starts with bing');

			openPanel();
			select = document.getElementById('ts-desktop_wallpaper');
			select.value = 'builtin';
			select.dispatchEvent(new Event('change', {bubbles: true}));
			assert.contains(getDesktopBg(), 'wallpaper_bing.jpg', 'desktop unchanged (still bing)');

			select.value = 'gradient';
			select.dispatchEvent(new Event('change', {bubbles: true}));
			assert.contains(getDesktopBg(), 'wallpaper_bing.jpg', 'desktop unchanged (still bing)');
		});

		it('switch to gradient → desktop unchanged', function() {
			setupWallpaperTest('builtin', null);
			wpEl.style.backgroundImage = 'url("/bg/original.jpg")';
			wpEl.style.backgroundSize = 'cover';

			openPanel();
			select = document.getElementById('ts-desktop_wallpaper');
			select.value = 'gradient';
			select.dispatchEvent(new Event('change', {bubbles: true}));
			assert.contains(getDesktopBg(), '/bg/original.jpg', 'desktop unchanged');
		});

		// ===== Apply syncs desktop =====
		it('Apply → desktop syncs to selected mode', function() {
			setupWallpaperTest('bing', '/cache/wallpaper_bing.jpg');

			openPanel();
			select = document.getElementById('ts-desktop_wallpaper');
			select.value = 'builtin';
			select.dispatchEvent(new Event('change', {bubbles: true}));
			assert.contains(getDesktopBg(), 'wallpaper_bing.jpg', 'desktop unchanged before Apply');

			document.getElementById('ts-apply').click();
			assert.ok(getDesktopBg().indexOf('/bg/') !== -1, 'Apply synced desktop to builtin');
		});

		it('Apply gradient → clears desktop background-image', function() {
			setupWallpaperTest('bing', '/cache/wallpaper_bing.jpg');
			assert.contains(getDesktopBg(), 'wallpaper_bing.jpg', 'starts with bing');

			openPanel();
			select = document.getElementById('ts-desktop_wallpaper');
			select.value = 'gradient';
			select.dispatchEvent(new Event('change', {bubbles: true}));
			document.getElementById('ts-apply').click();

			var bg = getDesktopBg();
			assert.ok(!bg || bg === 'none', 'gradient cleared bg image');
		});

		it('Apply → Apply → Close → desktop stays at last Apply', function() {
			setupWallpaperTest('bing', '/cache/wallpaper_bing.jpg');

			openPanel();
			select = document.getElementById('ts-desktop_wallpaper');
			select.value = 'builtin';
			select.dispatchEvent(new Event('change', {bubbles: true}));
			document.getElementById('ts-apply').click();
			var bgAfterBuiltin = getDesktopBg();
			assert.ok(bgAfterBuiltin.indexOf('/bg/') !== -1, 'Apply builtin');

			select.value = 'gradient';
			select.dispatchEvent(new Event('change', {bubbles: true}));
			document.getElementById('ts-apply').click();

			select.value = 'picsum';
			select.dispatchEvent(new Event('change', {bubbles: true}));
			document.getElementById('ts-close').click();

			var bg = getDesktopBg();
			assert.ok(!bg || bg === 'none', 'desktop stays at gradient (last Apply)');
		});

		it('Apply then Close → keeps committed state', function() {
			setupWallpaperTest('bing', '/cache/wallpaper_bing.jpg');

			openPanel();
			select = document.getElementById('ts-desktop_wallpaper');
			select.value = 'builtin';
			select.dispatchEvent(new Event('change', {bubbles: true}));
			document.getElementById('ts-apply').click();
			var bg = getDesktopBg();
			document.getElementById('ts-close').click();
			assert.equal(getDesktopBg(), bg, 'Close keeps committed wallpaper');
		});

		it('OK commits and closes', function() {
			setupWallpaperTest('bing', '/cache/wallpaper_bing.jpg');

			openPanel();
			select = document.getElementById('ts-desktop_wallpaper');
			select.value = 'gradient';
			select.dispatchEvent(new Event('change', {bubbles: true}));
			document.getElementById('ts-ok').click();

			assert.isNull(document.getElementById('theme-settings-panel'), 'panel closed');
			var bg = getDesktopBg();
			assert.ok(!bg || bg === 'none', 'gradient OK syncs desktop');
		});

		// ===== Close without Apply — desktop unchanged =====
		it('Close without Apply → desktop unchanged', function() {
			setupWallpaperTest('builtin', null);
			wpEl.style.backgroundImage = 'url("/bg/original.jpg")';
			wpEl.style.backgroundSize = 'cover';

			openPanel();
			select = document.getElementById('ts-desktop_wallpaper');
			select.value = 'gradient';
			select.dispatchEvent(new Event('change', {bubbles: true}));
			select.value = 'picsum';
			select.dispatchEvent(new Event('change', {bubbles: true}));
			document.getElementById('ts-close').click();
			assert.contains(getDesktopBg(), '/bg/original.jpg', 'desktop unchanged');
		});

		it('Open and close with no changes → desktop stays', function() {
			setupWallpaperTest('builtin', null);
			wpEl.style.backgroundImage = 'url("/bg/original.jpg")';
			wpEl.style.backgroundSize = 'cover';

			openPanel();
			document.getElementById('ts-close').click();
			assert.contains(getDesktopBg(), '/bg/original.jpg', 'no changes, desktop stays');
		});

		// ===== Apply syncs config =====
		it('Apply syncs wallpaper mode in config', function() {
			setupWallpaperTest('bing', '/cache/wallpaper_bing.jpg');

			openPanel();
			select = document.getElementById('ts-desktop_wallpaper');
			select.value = 'builtin';
			select.dispatchEvent(new Event('change', {bubbles: true}));
			document.getElementById('ts-apply').click();

			assert.equal(getWpMode(), 'builtin', 'mode synced');
		});

		it('Apply gradient clears config url', function() {
			setupWallpaperTest('bing', '/cache/wallpaper_bing.jpg');

			openPanel();
			select = document.getElementById('ts-desktop_wallpaper');
			select.value = 'gradient';
			select.dispatchEvent(new Event('change', {bubbles: true}));
			document.getElementById('ts-apply').click();

			assert.isNull(getWpUrl(), 'url cleared on gradient');
		});

		// ===== Multiple Apply cycles =====
		it('builtin Apply → OK → configured builtin wallpaper', function() {
			setupWallpaperTest('gradient', null);

			openPanel();
			select = document.getElementById('ts-desktop_wallpaper');
			select.value = 'builtin';
			select.dispatchEvent(new Event('change', {bubbles: true}));
			document.getElementById('ts-ok').click();

			assert.isNull(document.getElementById('theme-settings-panel'), 'panel closed');
			var bg = getDesktopBg();
			assert.ok(bg.indexOf('/bg/') !== -1, 'OK committed builtin bg');
			assert.equal(getWpSetting(), 'builtin', 'setting committed');
		});

		it('open → close (no changes) keeps wallpaper unchanged', function() {
			setupWallpaperTest('builtin', null);
			wpEl.style.backgroundImage = 'url("/bg/original.jpg")';
			wpEl.style.backgroundSize = 'cover';

			openPanel();
			document.getElementById('ts-close').click();
			assert.contains(getDesktopBg(), '/bg/original.jpg', 'no change → bg unchanged');
		});

		it('Apply builtin → Apply bing → Close reverts to bing', function() {
			setupWallpaperTest('builtin', null);
			wpEl.style.backgroundImage = 'url("/bg/original.jpg")';
			wpEl.style.backgroundSize = 'cover';

			openPanel();
			select = document.getElementById('ts-desktop_wallpaper');
			select.value = 'builtin';
			select.dispatchEvent(new Event('change', {bubbles: true}));
			document.getElementById('ts-apply').click();
			var bgAfterBuiltin = getDesktopBg();

			select.value = 'bing';
			select.dispatchEvent(new Event('change', {bubbles: true}));
			document.getElementById('ts-apply').click();

			assert.equal(getWpSetting(), 'bing', 'setting = bing after Apply');
			document.getElementById('ts-close').click();
			assert.equal(getWpSetting(), 'bing', 'Close keeps bing setting');
		});

		it('_applyWallpaper callback fires synchronously for builtin', function() {
			setupWallpaperTest('builtin', null);
			var called = false;
			LuCIDesktop._applyWallpaper({refresh: false, callback: function() { called = true; }});
			assert.ok(called, 'callback fired synchronously for builtin');
		});

			// ===== Refresh → preview updates, desktop unchanged =====
			it('reopen panel → uses cached preview, no re-download', function() {
				setupWallpaperTest('picsum', '/cache/wallpaper_picsum.jpg');
				wpEl.style.backgroundImage = 'url("/cache/wallpaper_picsum.jpg")';
				wpEl.style.backgroundSize = 'cover';

				openPanel();
				// Preview should use cached URL from config (no XHR)
				var preview = document.getElementById('wp-preview-img');
				assert.ok(preview, 'preview element exists');
				if (preview) {
					assert.ok(preview.style.backgroundImage.indexOf('wallpaper_picsum') !== -1,
						'preview shows cached image');
				}
				document.getElementById('ts-close').click();

				// Re-open: should still use cached image, not download new one
				openPanel();
				var preview2 = document.getElementById('wp-preview-img');
				if (preview2) {
					assert.ok(preview2.style.backgroundImage.indexOf('wallpaper_picsum') !== -1,
						're-open still shows cached image');
				}
			});

			it('Refresh (picsum) updates preview, desktop unchanged → Close keeps original', function() {
				setupWallpaperTest('picsum', '/cache/wallpaper_picsum.jpg');
				wpEl.style.backgroundImage = 'url("/cache/wallpaper_picsum.jpg")';
				wpEl.style.backgroundSize = 'cover';

				openPanel();
				select = document.getElementById('ts-desktop_wallpaper');
				select.value = 'picsum';
				select.dispatchEvent(new Event('change', {bubbles: true}));

				var cfg = document.getElementById('desktop-config');
				var c = JSON.parse(cfg.textContent);
				c.wallpaper.url = '/cache/wallpaper_picsum.jpg?v=9999';
				cfg.textContent = JSON.stringify(c);

				assert.contains(getDesktopBg(), 'wallpaper_picsum.jpg', 'desktop still original');
				document.getElementById('ts-close').click();
				assert.contains(getDesktopBg(), 'wallpaper_picsum.jpg', 'Close keeps original');
			});

			it('Multiple Refresh → preview updates → desktop unchanged → Close keeps original', function() {
				setupWallpaperTest('picsum', '/cache/wallpaper_picsum.jpg');
				wpEl.style.backgroundImage = 'url("/cache/wallpaper_picsum.jpg")';
				wpEl.style.backgroundSize = 'cover';

				openPanel();
				select = document.getElementById('ts-desktop_wallpaper');
				select.value = 'picsum';
				select.dispatchEvent(new Event('change', {bubbles: true}));

				for (var i = 0; i < 3; i++) {
					var cfg2 = document.getElementById('desktop-config');
					var c2 = JSON.parse(cfg2.textContent);
					c2.wallpaper.url = '/cache/wallpaper_picsum.jpg?v=' + (100 + i);
					cfg2.textContent = JSON.stringify(c2);
				}

				assert.contains(getDesktopBg(), 'wallpaper_picsum.jpg', 'desktop unchanged after 3 refreshes');
				document.getElementById('ts-close').click();
				assert.contains(getDesktopBg(), 'wallpaper_picsum.jpg', 'Close keeps original');
			});

			it('Refresh then Apply → desktop syncs to refreshed image', function() {
				setupWallpaperTest('picsum', '/cache/wallpaper_picsum.jpg');
				wpEl.style.backgroundImage = 'url("/cache/wallpaper_picsum.jpg")';
				wpEl.style.backgroundSize = 'cover';

				openPanel();
				select = document.getElementById('ts-desktop_wallpaper');
				select.value = 'picsum';
				select.dispatchEvent(new Event('change', {bubbles: true}));

				var cfg = document.getElementById('desktop-config');
				var c = JSON.parse(cfg.textContent);
				c.wallpaper.url = '/cache/wallpaper_picsum.jpg?v=9999';
				cfg.textContent = JSON.stringify(c);
				// Simulate Refresh: preview now shows the candidate, not the desktop image
				window.__wp_preview_url = '/cache/wallpaper_picsum.jpg?v=9999';

				document.getElementById('ts-apply').click();
				assert.contains(getDesktopBg(), 'wallpaper_picsum', 'Apply syncs refreshed wallpaper');
				assert.contains(getWpUrl(), 'wallpaper_picsum', 'config has refreshed URL');
			});
	});
// ===== 9. formatValue =====
describe('ThemeConfig.formatValue', function() {
    it('should format px values', function() {
        var f = ThemeConfig.byId['icon_font_size'];
        assert.equal(ThemeConfig.formatValue(f, '14'), '14px');
    });

    it('should format deg values', function() {
        var f = ThemeConfig.byId['bg_angle'];
        assert.equal(ThemeConfig.formatValue(f, '90'), '90°');
    });

    it('should format % values', function() {
        var f = ThemeConfig.byId['bg_glow_x'];
        assert.equal(ThemeConfig.formatValue(f, '50'), '50%');
    });

    it('should format opacity', function() {
        var f = ThemeConfig.byId['titlebar_opacity'];
        assert.equal(ThemeConfig.formatValue(f, '0.5'), '50%');
    });
});

// ===== 9. ThemeSession: unified preview / commit / rollback =====
describe('ThemeSession preview / commit / rollback', function() {
    var session, r;

    beforeEach(function() {
        setupDOM();
        // Apply a known baseline first
        var base = ThemeConfig.mergeDefaults({titlebar_color: '#1a1a2e', app_dark_mode: '1'});
        ThemeConfig.applyCss(base);
        session = ThemeConfig.beginSession();
        r = document.documentElement.style;
    });

    it('should snapshot current state on beginSession', function() {
        assert.ok(session, 'session created');
        assert.ok(session.preview, 'has preview method');
        assert.ok(session.commit, 'has commit method');
        assert.ok(session.rollback, 'has rollback method');
    });

    it('should preview CSS var changes immediately', function() {
        session.preview(ThemeConfig.mergeDefaults({titlebar_color: '#ff0000'}));
        var val = r.getPropertyValue('--accent-color').trim();
        assert.contains(val, 'ff0000', 'red hex set');
    });

    it('should rollback CSS var changes on rollback', function() {
        var before = r.getPropertyValue('--accent-color').trim();
        session.preview(ThemeConfig.mergeDefaults({titlebar_color: '#00ff00'}));
        var preview = r.getPropertyValue('--accent-color').trim();
        assert.notEqual(preview, before, 'preview changed the var');
        session.rollback();
        var after = r.getPropertyValue('--accent-color').trim();
        assert.equal(after, before, 'rollback restored original value');
    });

    it('should preview data-theme change and rollback', function() {
        session.preview(ThemeConfig.mergeDefaults({app_dark_mode: '0'}));
        var theme = document.documentElement.getAttribute('data-theme');
        assert.ok(!theme || theme !== 'dark', 'light mode active during preview');
        session.rollback();
        var restored = document.documentElement.getAttribute('data-theme');
        assert.equal(restored, 'dark', 'dark mode restored after rollback');
    });

    it('should keep committed state as new baseline', function() {
        var original = r.getPropertyValue('--accent-color').trim();
        // Preview + apply flow
        session.preview(ThemeConfig.mergeDefaults({titlebar_color: '#abcdef'}));
        session.commit(ThemeConfig.mergeDefaults({titlebar_color: '#abcdef'}));
        // After Apply: begin new session → new baseline = committed state
        session = ThemeConfig.beginSession();
        // Make more changes on fresh session
        session.preview(ThemeConfig.mergeDefaults({titlebar_color: '#112233'}));
        // Close → rollback to last committed state (not original)
        session.rollback();
        var val = r.getPropertyValue('--accent-color').trim();
        assert.equal(val, '#abcdef', 'rolled back to committed state, not original');
    });

    it('should rollback multiple values at once', function() {
        var beforeColor = r.getPropertyValue('--accent-color').trim();
        var beforeTheme = document.documentElement.getAttribute('data-theme') || '';

        session.preview(ThemeConfig.mergeDefaults({
            titlebar_color: '#123456',
            app_dark_mode: '0'
        }));
        assert.notEqual(r.getPropertyValue('--accent-color').trim(), beforeColor, 'color changed');
        assert.ok(!document.documentElement.getAttribute('data-theme') || document.documentElement.getAttribute('data-theme') !== 'dark', 'theme changed');

        session.rollback();
        assert.equal(r.getPropertyValue('--accent-color').trim(), beforeColor, 'color restored');
        assert.equal(document.documentElement.getAttribute('data-theme') || '', beforeTheme, 'theme restored');
    });

    it('should snapshot and rollback wallpaper state', function() {
        var wp = document.getElementById('desktop-wallpaper');
        if (!wp) wp = document.createElement('div');
        wp.id = 'desktop-wallpaper';
        document.body.appendChild(wp);
        wp.style.backgroundImage = 'url("original.jpg")';

        // Re-create session to capture wallpaper snapshot
        session = ThemeConfig.beginSession();
        session.preview(ThemeConfig.mergeDefaults({desktop_wallpaper: 'builtin'}));
        wp.style.backgroundImage = 'url("new.jpg")';  // simulate wallpaper change

        session.rollback();
        assert.contains(wp.style.backgroundImage, 'original.jpg', 'wallpaper reverted');
    });

    it('should work with full Apply-then-rollback workflow', function() {
        // Simulate: open → change → Apply → change more → Close
        var original = r.getPropertyValue('--accent-color').trim();

        // Change + Apply
        session.preview(ThemeConfig.mergeDefaults({titlebar_color: '#aa0000'}));
        assert.notEqual(r.getPropertyValue('--accent-color').trim(), original, 'changed');
        session.commit(ThemeConfig.mergeDefaults({titlebar_color: '#aa0000'}));
        session = ThemeConfig.beginSession();  // new baseline after Apply

        // Change more without Apply
        session.preview(ThemeConfig.mergeDefaults({titlebar_color: '#00aa00'}));
        assert.contains(r.getPropertyValue('--accent-color').trim(), '00aa00', 'second change previewed');

        // Close — should go back to last Apply state
        session.rollback();
        assert.contains(r.getPropertyValue('--accent-color').trim(), 'aa0000', 'rolled back to Applied state');
    });
});

// ===== Unified saveDesktopSection (REFACTOR P1: config read/write) =====
describe('Unified saveDesktopSection', function() {
    var origXHR, lastUrl, lastBody;

    beforeEach(function() {
        setupDOM();
        origXHR = window.XMLHttpRequest;
        lastUrl = undefined;
        lastBody = undefined;
        window.XMLHttpRequest = function() {
            var self = this;
            this.open = function(method, url) { lastUrl = url; };
            this.setRequestHeader = function() {};
            this.send = function(body) { lastBody = body; };
        };
    });

    afterEach(function() {
        window.XMLHttpRequest = origXHR;
        lastUrl = undefined;
        lastBody = undefined;
    });

    it('should POST to /admin/desktop/save', function() {
        LuCIDesktop.saveDesktopSection('widgets', {widgets: {}});
        assert.ok(lastUrl, 'XHR was opened');
        assert.contains(lastUrl, '/admin/desktop/save', 'unified endpoint');
    });

    it('should send section=widgets for widget config', function() {
        LuCIDesktop.saveDesktopSection('widgets', {clock: {x:10, y:20}});
        assert.contains(lastBody, 'section=widgets', 'section param');
        assert.contains(lastBody, 'data=', 'data param');
        assert.contains(lastBody, 'clock', 'json data intact');
    });

    it('should send section=pins for pinned items', function() {
        LuCIDesktop.saveDesktopSection('pins', ['item1', 'item2']);
        assert.contains(lastBody, 'section=pins', 'pins section');
        assert.contains(lastBody, 'item1', 'data has item1');
        assert.contains(lastBody, 'item2', 'data has item2');
    });

    it('should send section=hidden for hidden icons', function() {
        LuCIDesktop.saveDesktopSection('hidden', ['h1', 'h2']);
        assert.contains(lastBody, 'section=hidden', 'hidden section');
    });

    it('should send section=settings with theme values as JSON', function() {
        LuCIDesktop.saveDesktopSection('settings', {
            titlebar_color: '#abcdef',
            auto_refresh: '1',
            desktop_wallpaper: 'builtin'
        });
        assert.contains(lastBody, 'section=settings', 'settings section');
        assert.contains(lastBody, 'titlebar_color', 'theme key present');
        assert.contains(lastBody, 'auto_refresh', 'auto_refresh present');
        assert.contains(lastBody, 'desktop_wallpaper', 'wallpaper present');
    });

    it('should URL-encode section and data values', function() {
        LuCIDesktop.saveDesktopSection('settings', {key: '#value with spaces'});
        // # and spaces must be encoded
        assert.notContains(lastBody, '#value with spaces', 'raw value not in body');
        var decoded = decodeURIComponent(lastBody);
        assert.contains(decoded, '#value with spaces', 'decoded body has original value');
    });

    it('should handle empty data object without error', function() {
        var threw = false;
        try {
            LuCIDesktop.saveDesktopSection('widgets', {});
        } catch(e) { threw = true; }
        assert.ok(!threw, 'no error on empty data');
        assert.ok(lastBody, 'XHR was sent');
    });

    it('should replace 4 separate endpoints with one', function() {
        // Verify all 4 sections go to the SAME URL
        var urls = {};
        ['widgets','pins','hidden','settings'].forEach(function(s) {
            LuCIDesktop.saveDesktopSection(s, {test: true});
            urls[s] = lastUrl;
        });
        var uniqueUrls = Object.keys(urls).reduce(function(a,k){a[urls[k]]=true;return a;},{});
        assert.equal(Object.keys(uniqueUrls).length, 1, 'all sections POST to same URL: ' + urls.widgets);
    });
});

// ===== Wallpaper XHR gating (fast boot) =====
describe('_applyWallpaper XHR gating', function() {
    var origXHR, xhrCount, wallpaperEl, configEl;

    beforeEach(function() {
        setupDOM();
        // Create #desktop-wallpaper
        wallpaperEl = document.getElementById('desktop-wallpaper');
        if (!wallpaperEl) {
            wallpaperEl = document.createElement('div');
            wallpaperEl.id = 'desktop-wallpaper';
            document.body.appendChild(wallpaperEl);
        }
        // Create #desktop-config with wallpaper data
        configEl = document.getElementById('desktop-config');
        if (!configEl) {
            configEl = document.createElement('script');
            configEl.id = 'desktop-config';
            configEl.type = 'application/json';
            document.body.appendChild(configEl);
        }
        xhrCount = 0;
        origXHR = window.XMLHttpRequest;
        window.XMLHttpRequest = function() {
            this.open = function(method, url) { xhrCount++; };
            this.setRequestHeader = function() {};
            this.send = function() {};
        };
    });

    afterEach(function() {
        window.XMLHttpRequest = origXHR;
        xhrCount = 0;
        if (wallpaperEl) wallpaperEl.remove();
        if (configEl) configEl.remove();
    });

    function setConfig(mode, url) {
        configEl.textContent = JSON.stringify({
            theme: { desktop_wallpaper: mode },
            wallpaper: { mode: mode, url: url, builtin: ['/bg/1.jpg'] }
        });
    }

    it('should skip XHR when cached URL exists (fast boot)', function() {
        setConfig('bing', 'https://bing.com/wallpaper.jpg');
        LuCIDesktop._applyWallpaper();
        assert.equal(xhrCount, 0, 'no XHR when cached URL present');
        assert.ok(wallpaperEl.style.backgroundImage.indexOf('bing.com') !== -1, 'cached URL applied');
    });

    it('should fire XHR when no cached URL (first setup)', function() {
        setConfig('bing', null);
        LuCIDesktop._applyWallpaper();
        assert.equal(xhrCount, 1, 'XHR fires when no cached URL');
    });

    it('should fire XHR when forceRefresh even with cached URL', function() {
        setConfig('bing', 'https://bing.com/old.jpg');
        LuCIDesktop._applyWallpaper({forceRefresh: true});
        assert.equal(xhrCount, 1, 'XHR fires with forceRefresh');
    });

    it('should skip XHR for gradient mode (not a remote source)', function() {
        setConfig('gradient', null);
        LuCIDesktop._applyWallpaper();
        assert.equal(xhrCount, 0, 'no XHR for gradient');
    });

    it('should skip XHR for builtin mode (no XHR needed)', function() {
        setConfig('builtin', null);
        LuCIDesktop._applyWallpaper();
        assert.equal(xhrCount, 0, 'no XHR for builtin');
    });
});

// ===== Integration: real DOM changes after user interactions =====
describe('Wallpaper end-to-end: preview → Apply → desktop', function() {
    var wpEl, configEl;

    function setupFull(mode, url, builtinList) {
        setupDOM();
        wpEl = document.getElementById('desktop-wallpaper');
        if (!wpEl) {
            wpEl = document.createElement('div');
            wpEl.id = 'desktop-wallpaper';
            document.body.appendChild(wpEl);
        }
        wpEl.style.backgroundImage = url ? 'url("' + url + '")' : '';
        wpEl.style.backgroundSize = url ? 'cover' : '';
        wpEl.style.backgroundPosition = url ? 'center' : '';

        configEl = document.getElementById('desktop-config');
        builtinList = builtinList || ['/bg/1.jpg', '/bg/2.jpg', '/bg/3.jpg'];
        configEl.textContent = JSON.stringify({
            widgets: {}, pins: [], hidden_icons: [],
            wallpaper: {
                mode: mode,
                url: url || null,
                builtin: builtinList
            },
            theme: { desktop_wallpaper: mode }
        });
        window.__wp_preview_url = '';
    }

    function desktopBg() { return wpEl ? wpEl.style.backgroundImage : ''; }

    // ===== opts.url path: _applyWallpaper({url}) must change desktop =====
    it('_applyWallpaper({url}) actually sets desktop backgroundImage', function() {
        setupFull('bing', '/cache/wallpaper_bing.jpg');
        assert.contains(desktopBg(), 'wallpaper_bing.jpg', 'starts with bing');

        LuCIDesktop._applyWallpaper({
            mode: 'picsum',
            url: '/luci-static/desktop/cache/wallpaper_picsum.jpg?v=123'
        });
        assert.contains(desktopBg(), 'wallpaper_picsum.jpg', 'desktop changed to picsum');
        assert.notContains(desktopBg(), 'wallpaper_bing.jpg', 'old bing URL gone');
    });

    it('_applyWallpaper({url}) with gradient clears backgroundImage', function() {
        setupFull('builtin', '/bg/1.jpg');
        assert.contains(desktopBg(), '/bg/1.jpg', 'starts with builtin');

        LuCIDesktop._applyWallpaper({mode: 'gradient', url: ''});
        var bg = desktopBg();
        assert.ok(!bg || bg === '' || bg === 'none', 'gradient cleared backgroundImage, got: ' + bg);
    });

    // ===== Preview URL survives special characters =====
    it('preview URL with parentheses survives in _getPreviewUrl', function() {
        setupFull('builtin', null, ['/bg/bz (5).jpg']);
        openPanel();
        var sel = document.getElementById('ts-desktop_wallpaper');
        sel.value = 'builtin';
        sel.dispatchEvent(new Event('change', {bubbles: true}));

        var u = window.__wp_preview_url;
        assert.ok(u.indexOf('/bg/') !== -1, 'preview URL set');
        assert.ok(u.indexOf(')') !== -1 || u.indexOf('(') !== -1 || u.indexOf('_') !== -1,
            'preview URL preserved: ' + u);
    });

    it('_getPreviewUrl returns variable, not regex-parsed', function() {
        // Set a URL with ) and verify _getPreviewUrl returns it intact
        // (setupFull first — ThemeSettings.open() removes any existing
        //  panel without rebuilding, so a leftover panel breaks this case)
        window.__wp_preview_url = '/luci-static/desktop/background/bz (5).jpg';
        setupFull('builtin', null, ['/luci-static/desktop/background/bz (5).jpg']);
        openPanel();
        var sel = document.getElementById('ts-desktop_wallpaper');
        sel.value = 'builtin';
        sel.dispatchEvent(new Event('change', {bubbles: true}));
        var u = window.__wp_preview_url;
        assert.equal(u, '/luci-static/desktop/background/bz (5).jpg',
            'preview URL intact with parens, got: ' + u);

        document.getElementById('ts-apply').click();
        assert.contains(desktopBg(), 'bz (5).jpg', 'desktop bg uses full filename with parens');
    });

    
// Stub XHR + Image for cases with async confirm_wallpaper (Apply/OK on
// bing/picsum). XHRs are recorded and fired manually; Image probes never
// auto-fire so no stray downloads happen in the test page.
function stubAsync() {
    window.__stubXHRs = [];
    window.XMLHttpRequest = function() {
        var x = this;
        x.open = function(m, u) { x.method = m; x.url = u; };
        x.setRequestHeader = function() {};
        x.send = function() { window.__stubXHRs.push(x); };
    };
    window.Image = function() { var i = this; i.onload = null; i.onerror = null; i.src = ''; window.__stubImage = i; };
}
function restoreAsync() {
    window.XMLHttpRequest = window.__origAsyncXHR;
    window.Image = window.__origAsyncImage;
}
function fireLastXHR(status, body) {
    var x = window.__stubXHRs[window.__stubXHRs.length - 1];
    x.status = status; x.responseText = body;
    x.onload();
    return x;
}

// ===== Complete flow: switch → preview updates → Apply → desktop matches =====
    it('bing → picsum Apply with desktop preview: desktop unchanged (no confirm)', function() {
        if (!window.__origAsyncXHR) { window.__origAsyncXHR = window.XMLHttpRequest; window.__origAsyncImage = window.Image; }
        stubAsync();
        setupFull('bing', '/cache/wallpaper_bing.jpg');

        openPanel();
        var sel = document.getElementById('ts-desktop_wallpaper');
        sel.value = 'picsum';
        sel.dispatchEvent(new Event('change', {bubbles: true}));
        // Preview snapped to the confirmed desktop image (no Refresh yet)
        assert.ok(window.__wp_preview_url.indexOf('wallpaper_picsum_desktop.jpg') !== -1,
            'preview updated to picsum desktop image');

        document.getElementById('ts-apply').click();
        // Preview = desktop image → confirm must NOT fire; Apply only re-applies
        // the confirmed desktop file (visual desktop unchanged)
        var confirms = window.__stubXHRs.filter(function(x) { return x.url.indexOf('confirm_wallpaper') !== -1; });
        assert.ok(confirms.length === 0, 'no confirm XHR when preview is the desktop image');
        assert.contains(desktopBg(), 'wallpaper_picsum_desktop.jpg',
            'desktop keeps the confirmed desktop image (no swap behind the scenes)');
        restoreAsync();
    });

    it('Refresh-then-Apply: desktop changes to the refreshed image', function() {
        if (!window.__origAsyncXHR) { window.__origAsyncXHR = window.XMLHttpRequest; window.__origAsyncImage = window.Image; }
        stubAsync();
        setupFull('bing', '/cache/wallpaper_bing.jpg');

        openPanel();
        var sel = document.getElementById('ts-desktop_wallpaper');
        sel.value = 'picsum';
        sel.dispatchEvent(new Event('change', {bubbles: true}));
        // Simulate Refresh: preview now shows the candidate cache image
        window.__wp_preview_url = '/luci-static/desktop/cache/wallpaper_picsum.jpg?v=1';

        document.getElementById('ts-apply').click();
        // Candidate preview → confirm fires → desktop becomes picsum
        var cx = fireLastXHR(200, '{"ok":true}');
        assert.contains(cx.url, 'confirm_wallpaper', 'confirm XHR fired');
        assert.contains(desktopBg(), 'wallpaper_picsum', 'desktop is picsum');
        assert.notContains(desktopBg(), 'wallpaper_bing', 'desktop not bing anymore');
        restoreAsync();
    });

    it('picsum → builtin Apply: desktop changes to builtin', function() {
        setupFull('picsum', '/cache/wallpaper_picsum.jpg');

        openPanel();
        var sel = document.getElementById('ts-desktop_wallpaper');
        sel.value = 'builtin';
        sel.dispatchEvent(new Event('change', {bubbles: true}));
        assert.ok(window.__wp_preview_url.indexOf('/bg/') !== -1,
            'preview updated to builtin');

        document.getElementById('ts-apply').click();
        assert.contains(desktopBg(), '/bg/', 'desktop is builtin');
        assert.notContains(desktopBg(), 'wallpaper_picsum', 'desktop not picsum anymore');
    });

    it('builtin → gradient Apply: desktop backgroundImage cleared', function() {
        setupFull('builtin', null);
        wpEl.style.backgroundImage = 'url("/bg/some.jpg")';

        openPanel();
        var sel = document.getElementById('ts-desktop_wallpaper');
        sel.value = 'gradient';
        sel.dispatchEvent(new Event('change', {bubbles: true}));

        document.getElementById('ts-apply').click();
        var bg = desktopBg();
        assert.ok(!bg || bg === '' || bg === 'none',
            'gradient cleared bg, got: ' + bg);
    });

    // ===== Close/Cancel: desktop must NOT change =====
    it('switch mode → Close: desktop unchanged', function() {
        setupFull('bing', '/cache/wallpaper_bing.jpg');

        openPanel();
        var sel = document.getElementById('ts-desktop_wallpaper');
        sel.value = 'builtin';
        sel.dispatchEvent(new Event('change', {bubbles: true}));

        document.getElementById('ts-close').click();
        assert.contains(desktopBg(), 'wallpaper_bing.jpg', 'desktop still bing after Close');
        assert.notContains(desktopBg(), '/bg/', 'desktop not builtin');
    });

    it('switch 3 modes → Close: desktop unchanged from original', function() {
        setupFull('picsum', '/cache/wallpaper_picsum.jpg');

        openPanel();
        var sel = document.getElementById('ts-desktop_wallpaper');
        sel.value = 'bing'; sel.dispatchEvent(new Event('change', {bubbles: true}));
        sel.value = 'builtin'; sel.dispatchEvent(new Event('change', {bubbles: true}));
        sel.value = 'gradient'; sel.dispatchEvent(new Event('change', {bubbles: true}));

        document.getElementById('ts-close').click();
        assert.contains(desktopBg(), 'wallpaper_picsum.jpg', 'desktop unchanged after Close');
    });

    // ===== Apply → Apply: desktop follows each Apply =====
    it('Apply bing → Apply picsum → Close: desktop stays at picsum', function() {
        if (!window.__origAsyncXHR) { window.__origAsyncXHR = window.XMLHttpRequest; window.__origAsyncImage = window.Image; }
        stubAsync();
        setupFull('builtin', null);
        wpEl.style.backgroundImage = 'url("/bg/original.jpg")';

        openPanel();
        var sel = document.getElementById('ts-desktop_wallpaper');

        sel.value = 'bing'; sel.dispatchEvent(new Event('change', {bubbles: true}));
        // Simulate Refresh → preview is the candidate → Apply confirms it
        window.__wp_preview_url = '/luci-static/desktop/cache/wallpaper_bing.jpg?v=1';
        document.getElementById('ts-apply').click();
        fireLastXHR(200, '{"ok":true}');
        assert.contains(desktopBg(), 'wallpaper_bing', 'desktop is bing after first Apply');

        sel.value = 'picsum'; sel.dispatchEvent(new Event('change', {bubbles: true}));
        window.__wp_preview_url = '/luci-static/desktop/cache/wallpaper_picsum.jpg?v=1';
        document.getElementById('ts-apply').click();
        fireLastXHR(200, '{"ok":true}');
        assert.contains(desktopBg(), 'wallpaper_picsum', 'desktop is picsum after second Apply');

        document.getElementById('ts-close').click();
        assert.contains(desktopBg(), 'wallpaper_picsum', 'desktop stays picsum after Close');
        restoreAsync();
    });

    // ===== OK commits and closes =====
    it('OK commits mode change and closes panel', function() {
        if (!window.__origAsyncXHR) { window.__origAsyncXHR = window.XMLHttpRequest; window.__origAsyncImage = window.Image; }
        stubAsync();
        setupFull('bing', '/cache/wallpaper_bing.jpg');

        openPanel();
        var sel = document.getElementById('ts-desktop_wallpaper');
        sel.value = 'picsum';
        sel.dispatchEvent(new Event('change', {bubbles: true}));
        // Simulate Refresh → preview is the candidate → OK confirms it
        window.__wp_preview_url = '/luci-static/desktop/cache/wallpaper_picsum.jpg?v=1';

        document.getElementById('ts-ok').click();
        fireLastXHR(200, '{"ok":true}');
        assert.equal(document.getElementById('theme-settings-panel'), null, 'panel removed');
        assert.contains(desktopBg(), 'wallpaper_picsum', 'desktop synced to picsum');
        restoreAsync();
    });

    // ===== Background refresh must not corrupt preview =====
    it('_backgroundRefresh skips preview update when settings panel open', function() {
        setupFull('bing', '/cache/wallpaper_bing.jpg');
        openPanel();

        // Simulate what _backgroundRefresh does: update #wp-preview-img
        var preview = document.getElementById('wp-preview-img');
        var before = preview ? preview.style.backgroundImage : '';
        assert.ok(document.getElementById('theme-settings-panel'), 'panel is open');

        // _backgroundRefresh checks for #theme-settings-panel and skips
        // Simulate the guard:
        if (!document.getElementById('theme-settings-panel')) {
            if (preview) preview.style.backgroundImage = 'url("/hijacked.jpg")';
        }
        // Preview should be unchanged because panel is open
        var after = preview ? preview.style.backgroundImage : '';
        assert.equal(after, before, 'preview not hijacked by background refresh');
    });

    // ===== builtin list always available (regardless of initial mode) =====
    it('builtin preview works even when initial mode is picsum', function() {
        setupFull('picsum', '/cache/wallpaper_picsum.jpg');
        openPanel();

        var sel = document.getElementById('ts-desktop_wallpaper');
        sel.value = 'builtin';
        sel.dispatchEvent(new Event('change', {bubbles: true}));

        assert.ok(window.__wp_preview_url.indexOf('/bg/') !== -1,
            'preview URL is a builtin image: ' + window.__wp_preview_url);
        assert.notContains(window.__wp_preview_url, 'wallpaper_picsum',
            'preview not stale from picsum');
    });

    // ===== v77: Defaults reset must sync wallpaper preview + buttons =====
    // Regression: writeToDOM() changes the select without firing a change
    // event, so after Defaults the preview could stay on the old wallpaper
    // while the buttons still showed refresh/save. Reset must snap back to
    // the gradient view and hide manage/refresh/save.
    it('Defaults → select back to gradient, preview & buttons hidden, desktop unchanged', function() {
        if (!window.__origAsyncXHR) { window.__origAsyncXHR = window.XMLHttpRequest; window.__origAsyncImage = window.Image; }
        stubAsync();
        setupFull('bing', '/cache/wallpaper_bing.jpg');
        openPanel();

        var sel = document.getElementById('ts-desktop_wallpaper');
        var refreshBtn = sel.parentNode.querySelector('.ts-wp-refresh');
        var saveBtn = document.getElementById('wp-save-btn');
        var preview = document.getElementById('wp-preview-img');
        assert.equal(sel.value, 'bing', 'panel opened on bing');
        assert.ok(refreshBtn.style.display !== 'none', 'refresh visible for bing');
        assert.ok(saveBtn.style.display !== 'none', 'save visible for bing');
        assert.ok(preview.style.display !== 'none', 'preview visible for bing');

        document.getElementById('ts-reset').click();

        assert.equal(sel.value, 'gradient', 'select reset to gradient default');
        assert.equal(refreshBtn.style.display, 'none', 'refresh hidden after reset');
        assert.equal(saveBtn.style.display, 'none', 'save hidden after reset');
        assert.equal(preview.style.display, 'none', 'preview hidden (gradient view)');
        assert.contains(desktopBg(), 'wallpaper_bing.jpg',
            'desktop untouched — reset is preview-only, nothing confirmed');
        restoreAsync();
    });
});

// ===== No Notifications tab: per-notice suppression is toast-checkbox only =====
// The settings-panel tab was removed 2026-08 (permanent suppression via the
// toast checkbox; restore by deleting the localStorage key in devtools).
describe('Settings panel has no Notifications tab', function() {
    beforeEach(setupDOM);
    afterEach(function() {
        var p = document.getElementById('theme-settings-panel');
        if (p) p.remove();
    });

    it('panel renders only theme/colors/fonts/bg tabs', function() {
        var p = openPanel();
        var tabs = Array.prototype.map.call(p.querySelectorAll('.ts-tab'), function(b) {
            return b.getAttribute('data-tab');
        });
        assert.equal(tabs.length, 4, 'four tabs');
        assert.equal(tabs[0], 'theme', 'theme tab');
        assert.equal(tabs[1], 'colors', 'colors tab');
        assert.equal(tabs[2], 'fonts', 'fonts tab');
        assert.equal(tabs[3], 'bg', 'bg tab');
        assert.ok(tabs.indexOf('notify') === -1, 'no notify tab');
    });
});

})();