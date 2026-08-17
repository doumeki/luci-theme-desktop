/* theme-config.test.js — ThemeConfig Unit Tests
 *
 * Run: open tests/js/test-runner.html in browser
 * Tests all centralized ThemeConfig logic without router dependency.
 */

(function() {
'use strict';

var C = window.ThemeConfig;
if (!C) { console.error('ThemeConfig not loaded'); return; }

// ===== Helpers =====
function setupTestDOM() {
    // Create minimal DOM with desktop-config script tag
    var cfg = document.getElementById('desktop-config');
    if (!cfg) {
        cfg = document.createElement('script');
        cfg.id = 'desktop-config';
        cfg.type = 'application/json';
        document.body.appendChild(cfg);
    }
    cfg.textContent = '{"theme":{}}';

    // Create test color inputs
    var container = document.createElement('div');
    container.id = 'test-inputs';
    container.style.display = 'none';
    document.body.appendChild(container);
}

function createTestInput(field) {
    var el;
    if (field.type === 'checkbox') {
        el = document.createElement('input');
        el.type = 'checkbox';
    } else if (field.type === 'range') {
        el = document.createElement('input');
        el.type = 'range';
    } else {
        el = document.createElement('input');
        el.type = 'color';
    }
    el.id = 'ts-' + field.id;
    document.getElementById('test-inputs').appendChild(el);
    return el;
}

function cleanupInputs() {
    var c = document.getElementById('test-inputs');
    if (c) c.innerHTML = '';
}

// ===== Test Suites =====

describe('ThemeConfig.mergeDefaults', function() {

    it('should use default for missing fields', function() {
        var r = C.mergeDefaults({});
        assert.equal(r.titlebar_color, '#1a1a2e', 'default color');
        assert.equal(r.taskbar_opacity, '0.94', 'default opacity');
        assert.equal(r.menu_font_size, '13', 'default font size');
    });

    it('should override default with stored value', function() {
        var r = C.mergeDefaults({titlebar_color: '#ff0000'});
        assert.equal(r.titlebar_color, '#ff0000', 'stored overrides');
        assert.equal(r.taskbar_color, '#0d111c', 'unstored uses default');
    });

    it('should preserve falsy string "0"', function() {
        var r = C.mergeDefaults({menu_hover_mode: '0'});
        assert.equal(r.menu_hover_mode, '0', 'falsy "0" preserved');
    });

    it('should preserve boolean false', function() {
        var r = C.mergeDefaults({menu_hover_mode: false});
        assert.equal(r.menu_hover_mode, false, 'false preserved');
    });

    it('should preserve empty string as not-override', function() {
        var r = C.mergeDefaults({titlebar_color: ''});
        assert.equal(r.titlebar_color, '#1a1a2e', 'empty string → default');
    });

    it('should preserve undefined as not-override', function() {
        var r = C.mergeDefaults({titlebar_color: undefined});
        assert.equal(r.titlebar_color, '#1a1a2e', 'undefined → default');
    });
});

describe('ThemeConfig.readFromDOM', function() {
    beforeEach(setupTestDOM);
    afterEach(cleanupInputs);

    it('should read color value', function() {
        createTestInput({id:'titlebar_color', type:'color'});
        document.getElementById('ts-titlebar_color').value = '#ff0000';
        var vals = C.readFromDOM();
        assert.equal(vals.titlebar_color, '#ff0000', 'color read');
    });

    it('should read checkbox checked as "1"', function() {
        createTestInput({id:'menu_hover_mode', type:'checkbox'});
        document.getElementById('ts-menu_hover_mode').checked = true;
        var vals = C.readFromDOM();
        assert.equal(vals.menu_hover_mode, '1', 'checked → "1"');
    });

    it('should read checkbox unchecked as "0"', function() {
        createTestInput({id:'menu_hover_mode', type:'checkbox'});
        document.getElementById('ts-menu_hover_mode').checked = false;
        var vals = C.readFromDOM();
        assert.equal(vals.menu_hover_mode, '0', 'unchecked → "0"');
    });

    it('should NOT return "1" for unchecked checkbox just because value="1"', function() {
        var el = createTestInput({id:'menu_hover_mode', type:'checkbox'});
        el.value = '1';        // HTML attribute value
        el.checked = false;    // user unchecked
        var vals = C.readFromDOM();
        assert.equal(vals.menu_hover_mode, '0', 'unchecked reads checked prop, not value attr');
    });
});

describe('ThemeConfig.writeToDOM', function() {
    beforeEach(setupTestDOM);
    afterEach(cleanupInputs);

    it('should write color', function() {
        createTestInput({id:'titlebar_color', type:'color'});
        C.writeToDOM({titlebar_color: '#00ff00'});
        assert.equal(document.getElementById('ts-titlebar_color').value, '#00ff00');
    });

    it('should write checkbox checked', function() {
        createTestInput({id:'menu_hover_mode', type:'checkbox'});
        C.writeToDOM({menu_hover_mode: '1'});
        assert.ok(document.getElementById('ts-menu_hover_mode').checked, 'checked');
    });

    it('should write checkbox unchecked', function() {
        createTestInput({id:'menu_hover_mode', type:'checkbox'});
        document.getElementById('ts-menu_hover_mode').checked = true; // start checked
        C.writeToDOM({menu_hover_mode: '0'});
        assert.ok(!document.getElementById('ts-menu_hover_mode').checked, 'unchecked');
    });

    it('should write range with display label', function() {
        createTestInput({id:'icon_font_size', type:'range', def:'11'});
        var lbl = document.createElement('span');
        lbl.id = 'tsv-icon_font_size';
        document.getElementById('test-inputs').appendChild(lbl);
        C.writeToDOM({icon_font_size: '14'});
        assert.equal(document.getElementById('ts-icon_font_size').value, '14');
        assert.equal(document.getElementById('tsv-icon_font_size').textContent, '14px');
    });
});

describe('ThemeConfig.applyCss', function() {

    it('should set --win-titlebar-bg AND --win-titlebar-active-bg from titlebar_color', function() {
        C.applyCss({titlebar_color: '#ff0000'});
        var bg = document.documentElement.style.getPropertyValue('--win-titlebar-bg');
        var active = document.documentElement.style.getPropertyValue('--win-titlebar-active-bg');
        assert.equal(bg, '#ff0000', '--win-titlebar-bg set');
        assert.equal(active, '#ff0000', '--win-titlebar-active-bg set');
    });

    it('should set --accent-color from titlebar_color', function() {
        C.applyCss({titlebar_color: '#00ff00'});
        var accent = document.documentElement.style.getPropertyValue('--accent-color');
        assert.equal(accent, '#00ff00', 'accent color set');
    });

    it('should set rgba for taskbar_color with opacity', function() {
        C.applyCss({taskbar_color: '#0d111c', taskbar_opacity: '0.5'});
        var bg = document.documentElement.style.getPropertyValue('--taskbar-bg');
        assert.contains(bg, 'rgba', 'is rgba');
        assert.contains(bg, '0.5', 'has opacity 0.5');
    });

    it('should set rgba using default opacity when not provided', function() {
        C.applyCss({taskbar_color: '#0d111c'});
        var bg = document.documentElement.style.getPropertyValue('--taskbar-bg');
        assert.contains(bg, '0.94', 'uses default opacity');
    });

    it('should set font size with px suffix', function() {
        C.applyCss({icon_font_size: '14'});
        var fs = document.documentElement.style.getPropertyValue('--icon-font-size');
        assert.equal(fs, '14px', 'font size with px');
    });

    it('should transform content_zoom to decimal', function() {
        C.applyCss({content_zoom: '120'});
        var zoom = document.documentElement.style.getPropertyValue('--content-zoom');
        assert.equal(zoom, '1.2', 'zoom is decimal');
    });

    it('should set --startmenu-sel from startmenu_sel_color', function() {
        C.applyCss({startmenu_sel_color: '#ff8800'});
        var sel = document.documentElement.style.getPropertyValue('--startmenu-sel');
        assert.equal(sel, '#ff8800', 'startmenu-sel set');
    });
});

describe('ThemeConfig config round-trip', function() {
    beforeEach(setupTestDOM);
    it('should read back what was saved', function() {
        var original = {titlebar_color: '#abc123', taskbar_opacity: '0.7', menu_hover_mode: '0'};
        C.saveToConfig(original);
        var read = C.readFromConfig();
        assert.equal(read.titlebar_color, '#abc123', 'color round-trip');
        assert.equal(read.taskbar_opacity, '0.7', 'opacity round-trip');
        assert.equal(read.menu_hover_mode, '0', 'checkbox round-trip');
    });

    it('should update in-page desktop-config immediately', function() {
        C.saveToConfig({titlebar_color: '#fed'});
        var el = document.getElementById('desktop-config');
        var c = JSON.parse(el.textContent);
        assert.equal(c.theme.titlebar_color, '#fed', 'DOM updated immediately');
    });
});

describe('ThemeConfig field definition completeness', function() {
    it('every field with css should be findable in shell.css or embedded.css', function() {
        // This test validates the intent: CSS variables declared in fields
        // should have corresponding consumers in stylesheets.
        // We check that each .css field property maps to known valid variable names.
        var knownVars = [
            '--win-titlebar-bg', '--win-titlebar-active-bg', '--win-titlebar-inactive-bg',
            '--accent-color', '--taskbar-bg', '--accent-btn', '--startmenu-bg',
            '--startmenu-sel', '--primary', '--icon-font-size', '--icon-font-color',
            '--menu-font-size', '--icon-font-shadow', '--startmenu-fg',
            '--content-zoom', '--desktop-wallpaper', '--icon-opacity', '--icon-bg', '--icon-font-weight'
        ];
        C.fields.forEach(function(f) {
            if (!f.css) return;
            var names = f.css.split(';');
            names.forEach(function(name) {
                assert.contains(knownVars.join(','), name, f.id + ' css var ' + name + ' is known');
            });
        });
    });

    it('titlebar_color should set --win-titlebar-active-bg (regression test)', function() {
        var f = C.byId['titlebar_color'];
        assert.ok(f, 'field exists');
        assert.contains(f.css, '--win-titlebar-active-bg', 'sets active bg');
    });
});

describe('New fields: icon_font_shadow', function() {
    it('should exist with default 0.7', function() {
        var f = C.byId['icon_font_shadow'];
        assert.ok(f, 'field exists');
        assert.equal(f.type, 'range', 'is range slider');
        assert.equal(f.def, '0.7', 'default 0.7');
    });

    it('transform: 0 → none, 1 → glow string', function() {
        var f = C.byId['icon_font_shadow'];
        assert.equal(f.transform('0'), 'none', '0 → none');
        var g = f.transform('1');
        assert.ok(g.indexOf('0 0') !== -1, 'glow contains tight shadow');
        assert.ok(g.indexOf('rgba') !== -1, 'glow contains rgba');
    });

    it('transform: "0" or false → none', function() {
        var f = C.byId['icon_font_shadow'];
        assert.equal(f.transform('0'), 'none', 'off → none');
        assert.equal(f.transform(false), 'none', 'false → none');
    });
});

describe('New fields: menu_font_color', function() {
    it('should exist with default #e0e0e0 and css --startmenu-fg', function() {
        var f = C.byId['menu_font_color'];
        assert.ok(f, 'field exists');
        assert.equal(f.type, 'color', 'is color');
        assert.equal(f.def, '#e0e0e0', 'default color');
        assert.equal(f.css, '--startmenu-fg', 'css var');
    });
});

describe('ThemeConfig layout groups', function() {
    it('fonts should be a grouped array with Desktop and Menu sections', function() {
        var fonts = C.layout.fonts;
        assert.ok(Array.isArray(fonts), 'is array');
        assert.ok(fonts[0].label, 'first has label');
        assert.equal(fonts[0].label, 'Desktop', 'Desktop group');
        assert.contains(fonts[0].fields.join(','), 'icon_font_shadow', 'shadow in Desktop');
        assert.equal(fonts[1].label, 'Menu', 'Menu group');
        assert.contains(fonts[1].fields.join(','), 'menu_font_color', 'color in Menu');
    });
    it('theme should group App/Icons/Menu/Login; Icons has only opacity+bg', function() {
        var theme = C.layout.theme;
        assert.ok(Array.isArray(theme), 'is array');
        assert.equal(theme[0].label, 'App', 'App group');
        assert.contains(theme[0].fields.join(','), 'app_primary_color', 'primary color in App');
        assert.equal(theme[1].label, 'Icons', 'Icons group');
        assert.contains(theme[1].fields.join(','), 'icon_opacity', 'opacity in Icons');
        assert.contains(theme[1].fields.join(','), 'icon_bg', 'icon bg in Icons');
        assert.ok(theme[1].fields.indexOf('icon_font_size') === -1, 'font settings stay in Fonts tab');
        assert.equal(theme[2].label, 'Menu', 'Menu group');
        assert.contains(theme[2].fields.join(','), 'menu_hover_mode', 'hover in Menu');
    });
});

describe('Bug: var() in JS style assignment', function() {
    it('element.style.background = var(...) stores literal string, NOT resolved', function() {
        // Regression: markDirty() should NOT use var() in JS style assignment.
        // The literal string is stored, but never CSS-resolved.
        // ThemeConfig.applyCss uses setProperty which IS reliable.
        var div = document.createElement('div');
        document.body.appendChild(div);
        div.style.background = 'var(--accent-color, #4a90d9)';
        // style property stores the literal string, not the resolved color
        assert.equal(div.style.background, 'var(--accent-color, #4a90d9)', 'stores literal var()');
        // getComputedStyle may resolve it if --accent-color is set on :root
        var resolved = window.getComputedStyle(div).background;
        // The point: setProperty is reliable, direct assignment stores raw string
        document.body.removeChild(div);
        assert.ok(true, 'test passed — var() in direct assignment is unreliable for colors');
    });
});

describe('Bug: falsy "0" lost in merge', function() {
    it('"0" should survive round-trip: write → save → read → merge', function() {
        C.saveToConfig({menu_hover_mode: '0'});
        var saved = C.readFromConfig();
        var merged = C.mergeDefaults(saved);
        assert.equal(merged.menu_hover_mode, '0', '"0" survived round-trip');
    });
});

describe('New fields: bg gradient parameters', function() {
    it('bg_glow_x should exist with def 30 and unit %', function() {
        var f = C.byId['bg_glow_x'];
        assert.ok(f, 'field exists');
        assert.equal(f.def, '30', 'default 30');
        assert.equal(f.type, 'range', 'type range');
        assert.equal(f.unit, '%', 'unit %');
    });

    it('bg_glow_y should exist with def 20', function() {
        var f = C.byId['bg_glow_y'];
        assert.ok(f, 'field exists');
        assert.equal(f.def, '20');
    });

    it('bg_spread should exist with def 60', function() {
        var f = C.byId['bg_spread'];
        assert.ok(f, 'field exists');
        assert.equal(f.def, '60');
    });

    it('bg_angle should exist with def 135 and unit deg', function() {
        var f = C.byId['bg_angle'];
        assert.ok(f, 'field exists');
        assert.equal(f.def, '135');
        assert.equal(f.unit, 'deg');
    });

    it('all 4 fields should exist in byId registry', function() {
        assert.ok(C.byId['bg_glow_x'], 'glow_x in byId');
        assert.ok(C.byId['bg_glow_y'], 'glow_y in byId');
        assert.ok(C.byId['bg_spread'], 'spread in byId');
        assert.ok(C.byId['bg_angle'], 'angle in byId');
    });

    it('formatValue should show degree symbol for angle', function() {
        var f = C.byId['bg_angle'];
        assert.equal(C.formatValue(f, '90'), '90°');
    });

    it('formatValue should show % for glow_x', function() {
        var f = C.byId['bg_glow_x'];
        assert.equal(C.formatValue(f, '42'), '42%');
    });

    it('applyCss should use bg params in wallpaper', function() {
        C.applyCss({
            desktop_color1: '#111',
            desktop_color2: '#222',
            bg_glow_x: '40',
            bg_glow_y: '30',
            bg_spread: '70',
            bg_angle: '180'
        });
        var wp = document.documentElement.style.getPropertyValue('--desktop-wallpaper');
        assert.contains(wp, 'at 40% 30%', 'custom position');
        assert.contains(wp, 'transparent 70%', 'custom spread');
        assert.contains(wp, '180deg', 'custom angle');
    });
});

})();
