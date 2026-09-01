/* cbi-compat.js — Save&Apply compatibility for old-style Lua CBI pages
 * inside the embed shell (included by both header templates, embed branch).
 *
 * luci-compat renders old Lua CBI pages with a Save & Apply button that
 * has NO name attribute (the apply flag is passed via
 * onclick="cbi_submit(this, 'cbi.apply')"). The embed shell must:
 *   - recognize that button (click interceptor) and submit it with
 *     embed=1 + a replayed cbi.apply hidden input, suppressing the
 *     native onclick (preventDefault does not stop attribute handlers —
 *     stopPropagation does)
 *   - fire L.ui.changes.apply() on the POST response page, because the
 *     compat footer's luci-loaded listener reliably misses the event on
 *     fast-boot embed pages (pending changes would never be committed)
 *   - dedupe concurrent apply triggers (a second concurrent
 *     apply_rollback is rejected by rpcd with Permission denied)
 *
 * New-style (ucode) pages keep their native flow: their button carries
 * name="cbi.apply" and the client applies changes itself. cbi Button
 * options (cert download, diagnostics…) share the cbi-button-apply
 * class but their onclick never contains 'cbi.apply' — they submit
 * natively.
 *
 * Full pitfall chain + history: HANDOVER §9.6 (internal doc).
 */
(function() {
'use strict';

function isApplyBtn(btn) {
    if (btn && btn.name === 'cbi.apply') return true;
    /* Old Lua CBI footer buttons (luci-compat) carry no name — the
       apply flag is passed via onclick="cbi_submit(this, 'cbi.apply')". */
    var oc = (btn && btn.getAttribute) ? (btn.getAttribute('onclick') || '') : '';
    return oc.indexOf('cbi.apply') !== -1;
}

function disableApplyBtn(form, btn) {
    var b = (form && form.querySelector) ? (form.querySelector('input[name="cbi.apply"]') || btn) : btn;
    if (!b || b.disabled) return;
    b.disabled = true;
    b.value = _('Applying…');
}

/* form.submit() drops the triggering button's name/value, so the
   server would not see cbi.apply. Replay it as a hidden input.
   `applyValue` is the ORIGINAL button value captured before the
   button label was changed to 'Applying…' — replaying the mutated
   label would send garbage to the server. Also force embed=1 into
   the action so the POST response renders in embedded mode (not the
   desktop shell, whose bounce script would abort the apply XHR). */
function submitWithApply(form, btn, applyValue) {
    var hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.name = 'cbi.apply';
    hidden.value = applyValue || (btn && btn.value) || 'Save & Apply';
    form.appendChild(hidden);
    var action = form.getAttribute('action') || '';
    if (action.indexOf('embed=') === -1) {
        form.action = action + (action.indexOf('?') === -1 ? '?' : '&') + 'embed=1';
    }
    form.submit();
}

document.addEventListener('click', function(e) {
    var btn = e.target.closest ? e.target.closest('.cbi-button-apply') : null;
    if (!btn || btn.disabled || !isApplyBtn(btn)) return;
    e.preventDefault();
    /* Old-style Lua CBI buttons (no name) carry their submit in an
       onclick attribute handler — preventDefault does not stop
       attribute handlers, so the native cbi_submit() would fire a
       second, embed-less submit whose shell response bounces the
       iframe. Stop propagation so only our controlled submit
       (embed=1 + cbi.apply) happens. */
    if (!btn.name) {
        e.stopPropagation();
        /* Remember the pending save&apply so the response page can
           fire L.ui.changes.apply() itself — the compat footer's
           luci-loaded listener reliably misses the event on
           fast-boot embed pages (see runApplyPending below). */
        try { sessionStorage.setItem('desktop-apply-pending', '1'); } catch (err) {}
    }
    var applyValue = btn.value; /* capture BEFORE disableApplyBtn mutates it */
    disableApplyBtn(btn.form, btn);
    setTimeout(function() {
        if (btn.form) submitWithApply(btn.form, btn, applyValue);
    }, 120);
}, true);

document.addEventListener('submit', function(e) {
    var form = e.target;
    if (e.defaultPrevented || !form || form.tagName !== 'FORM') return;
    var sub = e.submitter;
    // Notify the desktop shell immediately so it re-checks status
    // (save/apply feedback without waiting for the poll)
    try {
        var msg = {type: 'desktop-app-save'};
        var btnCls = e.submitter ? (e.submitter.className || '') : '';
        if (/reset/.test(btnCls)) msg.submitType = 'revert';
        else if (/save/.test(btnCls)) msg.submitType = 'save';
        else if (/apply/.test(btnCls)) msg.submitType = 'apply';
        // uci apply/revert pages: shell should close this window after submit
        if (location.pathname.indexOf('/uci/') !== -1) msg.isUci = true;
        window.parent.postMessage(msg, location.origin);
    } catch (err) {}
    // Fill empty redir fields so LuCI redirects back here after
    // apply/revert instead of navigating to a blank URL
    var redir = form.querySelector('input[name="redir"]');
    if (redir && !redir.value) redir.value = window.location.href;
    // Force embed=1 into the action for ANY submit from an embedded
    // page (native submits like cbi 'Save' or uci 'Save & Apply').
    // Without it the POST response renders the desktop shell, whose
    // bounce script aborts the apply_xhr flow.
    var action = form.getAttribute('action') || '';
    if (action.indexOf('embed=') === -1) {
        form.action = action + (action.indexOf('?') === -1 ? '?' : '&') + 'embed=1';
    }
    if (!sub || !isApplyBtn(sub)) return;
    e.preventDefault();
    var applyValue = sub.value; /* capture BEFORE disableApplyBtn mutates it */
    disableApplyBtn(form, sub);
    setTimeout(function() {
        submitWithApply(form, sub, applyValue);
    }, 120);
}, true);

/* Apply-pending trigger: runs when the old-style interceptor submitted a
   save&apply (the sessionStorage flag was set by the click handler).
   Waits for the LuCI client (luci-loaded listener + 100ms poll fallback,
   because the event can fire before this script attaches on fast-boot
   embed pages), then fires L.ui.changes.apply(true). Dedupes concurrent
   triggers with an 8s window wrapper installed only while the flag
   context is active (new-style pages are unaffected). Auto-runs at load;
   exposed for tests via LuCIDesktop.cbiCompat. */
function runApplyPending() {
    var pending = false;
    try { pending = sessionStorage.getItem('desktop-apply-pending') === '1'; } catch (err) {}
    if (!pending) return;
    var done = false;
    function wrapApply() {
        try {
            if (!window.L || !L.ui || !L.ui.changes || typeof L.ui.changes.apply !== 'function') return;
            if (L.ui.changes.apply.__desktopDeduped) return;
            var _orig = L.ui.changes.apply;
            var _last = 0;
            L.ui.changes.apply = function() {
                var now = Date.now();
                if (now - _last < 8000) return;
                _last = now;
                return _orig.apply(this, arguments);
            };
            L.ui.changes.apply.__desktopDeduped = true;
        } catch (err) {}
    }
    function maybeApply() {
        if (done) return;
        try {
            if (window.L && L.ui && L.ui.changes && typeof L.ui.changes.apply === 'function') {
                done = true;
                try { sessionStorage.removeItem('desktop-apply-pending'); } catch (err) {}
                wrapApply();
                L.ui.changes.apply(true);
            }
        } catch (err) {}
    }
    document.addEventListener('luci-loaded', maybeApply);
    var tries = 0;
    var iv = setInterval(function() {
        tries++;
        if (window.L && L.loaded) {
            clearInterval(iv);
            maybeApply();
        }
        else if (tries > 100) {
            clearInterval(iv);
            done = true;
            try { sessionStorage.removeItem('desktop-apply-pending'); } catch (err) {}
        }
    }, 100);
}

runApplyPending();

window.LuCIDesktop = window.LuCIDesktop || {};
window.LuCIDesktop.cbiCompat = {
    isApplyBtn: isApplyBtn,
    disableApplyBtn: disableApplyBtn,
    submitWithApply: submitWithApply,
    runApplyPending: runApplyPending
};
})();
