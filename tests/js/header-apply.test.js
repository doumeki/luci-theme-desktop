/* header-apply.test.js — Lua CBI Save&Apply compat logic (header templates)
 *
 * The interceptor + apply-pending trigger live inline in the theme header
 * templates (Lua header.htm / ucode header.ut). These tests extract the
 * section from header.htm and exercise it against mock DOM:
 *   - old-style button recognition (no name, apply flag in onclick)
 *   - native onclick suppression + embed=1 submit (the double-submit fix)
 *   - the apply-pending flag → L.ui.changes.apply() trigger + dedupe
 *
 * The run-headless static check enforces that both template branches stay
 * byte-identical; this suite covers the behavior of the shared JS.
 */
(function() {
'use strict';

var APPLY_JS = null;        // full interceptor section (evals once)
var TRIGGER_JS = null;      // apply-pending IIFE only

function extract(src, marker) {
    var i = src.indexOf(marker);
    if (i < 0) return null;
    var j = src.indexOf('</script>', i);
    return src.slice(i, j);
}

// Indirect eval → `var` declarations land on window (the template code
// relies on globals: _isApplyBtn, _disableApplyBtn, _submitWithApply).
function loadApplyJs() {
    if (APPLY_JS !== null) return Promise.resolve();
    return fetch('/files/templates/header.htm')
        .then(function(r) { return r.text(); })
        .then(function(src) {
            APPLY_JS = extract(src, '/* Save & Apply feedback');
            TRIGGER_JS = extract(src, '/* Lua CBI compat footer schedules');
            if (!APPLY_JS || !TRIGGER_JS) throw new Error('header.htm section missing');
            (0, eval)(APPLY_JS);
        });
}

function makeOldStyleButton() {
    var form = document.createElement('form');
    form.setAttribute('action', '/cgi-bin/luci/admin/services/AdGuardHome/base');
    var btn = document.createElement('input');
    btn.type = 'button';
    btn.className = 'btn cbi-button cbi-button-apply';
    btn.value = 'Save & Apply';
    btn.setAttribute('onclick', "window.__nativeFired = true; /* cbi.apply */");
    form.appendChild(btn);
    document.body.appendChild(form);
    return { form: form, btn: btn };
}

function cleanupDom(el) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
}

describe('header Lua-CBI Save&Apply compat', function() {
    beforeEach(function() {
        try { sessionStorage.removeItem('desktop-apply-pending'); } catch (e) {}
        window.__nativeFired = false;
    });

    it('loads the interceptor section from header.htm', function() {
        return loadApplyJs().then(function() {
            assert.equal(typeof _isApplyBtn, 'function', '_isApplyBtn defined');
            assert.equal(typeof _disableApplyBtn, 'function', '_disableApplyBtn defined');
            assert.equal(typeof _submitWithApply, 'function', '_submitWithApply defined');
        });
    });

    it('classifies old-style, new-style and Button-option buttons', function() {
        return loadApplyJs().then(function() {
            var oldStyle = document.createElement('input');
            oldStyle.setAttribute('onclick', "cbi_submit(this, 'cbi.apply')");
            var newStyle = document.createElement('input');
            newStyle.name = 'cbi.apply';
            var btnOpt = document.createElement('input');
            btnOpt.setAttribute('onclick', ' return apply_update() ');
            var plain = document.createElement('input');
            assert.ok(_isApplyBtn(oldStyle), 'old-style (onclick cbi.apply, no name) intercepted');
            assert.ok(_isApplyBtn(newStyle), 'new-style (name=cbi.apply) intercepted');
            assert.ok(!_isApplyBtn(btnOpt), 'cbi Button option (onclick apply_update) still submits natively');
            assert.ok(!_isApplyBtn(plain), 'plain button not intercepted');
        });
    });

    it('old-style click: suppress native onclick, set flag, submit with embed=1', function() {
        return loadApplyJs().then(function() {
            var m = makeOldStyleButton();
            var submitted = [];
            m.form.submit = function() {
                submitted.push({
                    action: m.form.getAttribute('action'),
                    hasApply: !!m.form.querySelector('input[name="cbi.apply"]')
                });
            };
            m.btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            assert.ok(!window.__nativeFired, 'native onclick suppressed (stopPropagation)');
            var flag = false;
            try { flag = sessionStorage.getItem('desktop-apply-pending') === '1'; } catch (e) {}
            assert.ok(flag, 'apply-pending flag set in sessionStorage');
            assert.ok(m.btn.disabled, 'button disabled while applying');
            assert.equal(m.btn.value, 'Applying…', 'button label switches to Applying…');
            return new Promise(function(resolve) {
                setTimeout(function() {
                    assert.equal(submitted.length, 1, 'exactly one submit');
                    if (submitted.length) {
                        assert.ok(submitted[0].action.indexOf('embed=1') !== -1,
                            'submit action carries embed=1 (action=' + submitted[0].action + ')');
                        assert.ok(submitted[0].hasApply, 'hidden cbi.apply input replayed');
                    }
                    cleanupDom(m.form);
                    resolve();
                }, 300);
            });
        });
    });

    it('new-style button click: intercepted but native onclick may coexist (no flag set)', function() {
        return loadApplyJs().then(function() {
            var form = document.createElement('form');
            form.setAttribute('action', '/cgi-bin/luci/admin/services/AdGuardHome/base');
            var btn = document.createElement('input');
            btn.type = 'button';
            btn.className = 'btn cbi-button cbi-button-apply';
            btn.name = 'cbi.apply';
            btn.value = 'Save & Apply';
            form.appendChild(btn);
            document.body.appendChild(form);
            var submitted = [];
            form.submit = function() { submitted.push(form.getAttribute('action')); };
            btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            var flag = false;
            try { flag = sessionStorage.getItem('desktop-apply-pending') === '1'; } catch (e) {}
            assert.ok(!flag, 'new-style flow does not set the apply-pending flag');
            return new Promise(function(resolve) {
                setTimeout(function() {
                    assert.equal(submitted.length, 1, 'new-style still submits via the theme');
                    cleanupDom(form);
                    resolve();
                }, 300);
            });
        });
    });

    it('apply-pending trigger: fires L.ui.changes.apply once, dedupes a second call', function() {
        return loadApplyJs().then(function() {
            var applyCalls = 0;
            var mockL = { loaded: true, ui: { changes: { apply: function() { applyCalls++; } } } };
            var origL = window.L;
            window.L = mockL;
            try { sessionStorage.setItem('desktop-apply-pending', '1'); } catch (e) {}
            (0, eval)(TRIGGER_JS);
            return new Promise(function(resolve) {
                setTimeout(function() {
                    assert.equal(applyCalls, 1, 'pending apply fired exactly once');
                    // Second trigger (compat listener catching a slow boot):
                    // the dedupe wrapper must drop it.
                    window.L.ui.changes.apply(true);
                    setTimeout(function() {
                        assert.equal(applyCalls, 1, 'dedupe window drops the concurrent second apply');
                        try { sessionStorage.removeItem('desktop-apply-pending'); } catch (e) {}
                        window.L = origL;
                        resolve();
                    }, 120);
                }, 350);
            });
        });
    });

    it('apply-pending trigger: inactive without the flag', function() {
        return loadApplyJs().then(function() {
            var applyCalls = 0;
            var origL = window.L;
            window.L = { loaded: true, ui: { changes: { apply: function() { applyCalls++; } } } };
            try { sessionStorage.removeItem('desktop-apply-pending'); } catch (e) {}
            (0, eval)(TRIGGER_JS);
            return new Promise(function(resolve) {
                setTimeout(function() {
                    assert.equal(applyCalls, 0, 'no apply without the pending flag');
                    window.L = origL;
                    resolve();
                }, 350);
            });
        });
    });
});
})();
