/* header-apply.test.js — Lua CBI Save&Apply compat (files/htdocs/js/cbi-compat.js)
 *
 * The interceptor + apply-pending trigger live in cbi-compat.js (loaded
 * by the test runner; the header templates include it in the embed
 * branch). Tests exercise the module API and the real document-level
 * listeners:
 *   - old-style button recognition (no name, apply flag in onclick)
 *   - native onclick suppression + embed=1 submit (the double-submit fix)
 *   - the apply-pending flag → L.ui.changes.apply() trigger + dedupe
 *
 * run-headless statically verifies the module invariants and that both
 * header branches include it; this suite covers the behavior.
 */
(function() {
'use strict';

function CBI() {
    return window.LuCIDesktop && LuCIDesktop.cbiCompat;
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

describe('cbi-compat: Lua CBI Save&Apply compat', function() {
    beforeEach(function() {
        try { sessionStorage.removeItem('desktop-apply-pending'); } catch (e) {}
        window.__nativeFired = false;
    });

    it('exposes the compat API', function() {
        assert.ok(CBI(), 'LuCIDesktop.cbiCompat loaded');
        assert.equal(typeof CBI().isApplyBtn, 'function', 'isApplyBtn');
        assert.equal(typeof CBI().disableApplyBtn, 'function', 'disableApplyBtn');
        assert.equal(typeof CBI().submitWithApply, 'function', 'submitWithApply');
        assert.equal(typeof CBI().runApplyPending, 'function', 'runApplyPending');
    });

    it('classifies old-style, new-style and Button-option buttons', function() {
        var oldStyle = document.createElement('input');
        oldStyle.setAttribute('onclick', "cbi_submit(this, 'cbi.apply')");
        var newStyle = document.createElement('input');
        newStyle.name = 'cbi.apply';
        var btnOpt = document.createElement('input');
        btnOpt.setAttribute('onclick', ' return apply_update() ');
        var plain = document.createElement('input');
        assert.ok(CBI().isApplyBtn(oldStyle), 'old-style (onclick cbi.apply, no name) intercepted');
        assert.ok(CBI().isApplyBtn(newStyle), 'new-style (name=cbi.apply) intercepted');
        assert.ok(!CBI().isApplyBtn(btnOpt), 'cbi Button option (onclick apply_update) still submits natively');
        assert.ok(!CBI().isApplyBtn(plain), 'plain button not intercepted');
    });

    it('old-style click: suppress native onclick, set flag, submit with embed=1', function() {
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

    it('intercepts an apply button WITHOUT the cbi-button-apply class (attribute fallback)', function() {
        var form = document.createElement('form');
        form.setAttribute('action', '/cgi-bin/luci/admin/services/AdGuardHome/base');
        var btn = document.createElement('input');
        btn.type = 'button';
        btn.value = 'Save & Apply';
        /* No cbi-button-apply class — a future luci-compat could drop it. */
        btn.setAttribute('onclick', "cbi_submit(this, 'cbi.apply')");
        form.appendChild(btn);
        document.body.appendChild(form);
        var submitted = [];
        form.submit = function() { submitted.push(1); };
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return new Promise(function(resolve) {
            setTimeout(function() {
                assert.equal(submitted.length, 1, 'class-less apply button still intercepted and submitted');
                cleanupDom(form);
                resolve();
            }, 300);
        });
    });

    it('class-less button that merely mentions cbi.apply is NOT hijacked', function() {
        var form = document.createElement('form');
        form.setAttribute('action', '/cgi-bin/luci/admin/x');
        var btn = document.createElement('input');
        btn.type = 'button';
        btn.value = 'Custom';
        /* No class; cbi.apply appears only in a comment — a custom
           button that must keep submitting natively. */
        btn.setAttribute('onclick', "window.__nativeFired = true; /* cbi.apply */");
        form.appendChild(btn);
        document.body.appendChild(form);
        var submitted = [];
        form.submit = function() { submitted.push(1); };
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        assert.ok(window.__nativeFired, 'custom button native onclick still runs');
        return new Promise(function(resolve) {
            setTimeout(function() {
                assert.equal(submitted.length, 0, 'custom button NOT intercepted');
                cleanupDom(form);
                resolve();
            }, 300);
        });
    });

    it('new-style button click: intercepted but no apply-pending flag', function() {
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

    it('apply-pending trigger: fires L.ui.changes.apply once, dedupes a second call', function() {
        var applyCalls = 0;
        var origL = window.L;
        window.L = { loaded: true, ui: { changes: { apply: function() { applyCalls++; } } } };
        try { sessionStorage.setItem('desktop-apply-pending', '1'); } catch (e) {}
        CBI().runApplyPending();
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

    it('apply-pending trigger: inactive without the flag', function() {
        var applyCalls = 0;
        var origL = window.L;
        window.L = { loaded: true, ui: { changes: { apply: function() { applyCalls++; } } } };
        try { sessionStorage.removeItem('desktop-apply-pending'); } catch (e) {}
        CBI().runApplyPending();
        return new Promise(function(resolve) {
            setTimeout(function() {
                assert.equal(applyCalls, 0, 'no apply without the pending flag');
                window.L = origL;
                resolve();
            }, 350);
        });
    });
});
})();
