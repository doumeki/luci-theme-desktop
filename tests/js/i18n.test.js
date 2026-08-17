/* i18n.test.js — i18n Unit Tests */

(function() {
'use strict';

var ORIG_LANG = document.documentElement.getAttribute('lang');

function setLang(lang) {
    if (lang === null) document.documentElement.removeAttribute('lang');
    else document.documentElement.setAttribute('lang', lang);
}

describe('i18n._() lookup', function() {
    afterEach(function() { setLang(ORIG_LANG); });

    it('should translate zh_Hans via zh_cn dictionary', function() {
        setLang('zh_Hans');
        assert.equal(_('Refresh'), '刷新', 'zh_Hans hits zh_cn dict');
        assert.equal(_('Close'), '关闭', 'second key also hits');
    });

    it('should fall back to English for unknown keys', function() {
        setLang('zh_Hans');
        assert.equal(_('Not A Real Key'), 'Not A Real Key', 'fallback keeps msgid');
    });

    it('should return English untouched in en environment', function() {
        setLang('en');
        assert.equal(_('Refresh'), 'Refresh');
        assert.equal(_('Close'), 'Close');
    });

    it('should return English untouched when lang attribute is missing', function() {
        setLang(null);
        assert.equal(_('Refresh'), 'Refresh');
    });

    it('zh_CN / zh_TW currently fall back to English (documented limitation)', function() {
        // getLang() only maps zh_Hans; zh_CN/zh_TW keys are not in __I18N,
        // so they fall back. Deliberate assertion of CURRENT behavior —
        // a candidate fix is mapping zh_CN/zh_TW → zh_cn in getLang().
        setLang('zh_CN');
        assert.equal(_('Refresh'), 'Refresh', 'zh_CN falls back (documented)');
        setLang('zh_TW');
        assert.equal(_('Refresh'), 'Refresh', 'zh_TW falls back (documented)');
    });
});

describe('i18n._f() formatted lookup', function() {
    afterEach(function() { setLang(ORIG_LANG); });

    it('should substitute %d and %s in English (untranslated format string)', function() {
        setLang('en');
        assert.equal(_f('Max %d instances of %s', 3, 'x'), 'Max 3 instances of x');
    });

    it('should substitute in English when no full format key exists in the dict', function() {
        // The zh_cn dict stores *fragments* ('Max ', ' instances of ') which
        // widget.js concatenates directly — no full 'Max %d instances of %s'
        // key, so _f falls back to the English format string.
        setLang('zh_Hans');
        var out = _f('Max %d instances of %s', 2, 'desktop-clock');
        assert.equal(out, 'Max 2 instances of desktop-clock', 'falls back to English');
    });

    it('zh fragment keys translate individually (widget.js:106 pattern)', function() {
        setLang('zh_Hans');
        var label = _('Max ') + 3 + _(' instances of ') + _('Desktop Clock');
        assert.equal(label, '已达最大实例数 3：桌面时钟', 'fragment concatenation');
    });
});

describe('i18n dictionary completeness', function() {
    afterEach(function() { setLang(ORIG_LANG); });

    it('every zh_cn entry is non-empty and different from its msgid', function() {
        var dict = window.__I18N['zh_cn'];
        var keys = Object.keys(dict);
        assert.ok(keys.length >= 150, 'dict has ' + keys.length + ' keys');
        var bad = [];
        keys.forEach(function(k) {
            var v = dict[k];
            if (v === undefined || v === null || v === '' || v === k) bad.push(k);
        });
        assert.equal(bad.length, 0, 'all entries translated, bad: ' + bad.join(', '));
    });

    it('_() resolves every dict key to its own value in zh', function() {
        setLang('zh_Hans');
        var dict = window.__I18N['zh_cn'];
        var unresolved = [];
        Object.keys(dict).forEach(function(k) {
            if (_(k) !== dict[k]) unresolved.push(k);
        });
        assert.equal(unresolved.length, 0, 'unresolved: ' + unresolved.join(', '));
    });
});

})();
