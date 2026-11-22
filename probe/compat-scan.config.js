/* compat-scan.config.js — knobs for probe/compat-scan.js (L3 wide scan).
 *
 * GATE RULE (fixed, do not soften): a new firmware must produce a contract
 * profile (cookie name / cbi.js / xhr.js / ui.js / cbi.css hashes / menu hash /
 * track dirs) BEFORE it may stand in for a representative device. An unknown
 * profile => auto-escalate to the L4 hot pack + store a baseline; never "just
 * run it as 1.1/253" — the overview-blank case (2026-11-15) is exactly the
 * new-generation trap this rule exists for.
 *
 * Ratchet: every real-world incident adds a detector or an expectation here.
 * pollExpect stays record-only until thresholds are calibrated on 1.1 + 253.
 */
'use strict';

module.exports = {
    /* page visit budget */
    installMs: 2500,      // wait before installing traps (pageLoadStrategy=none)
    dwellMs: 9000,        // observation window for errors / poll / failed XHRs
    probeTimeoutMs: 20000,// lib.exec per-call timeout (geckodriver)
    slowMs: 16000,        // total page ms above this => 'slow' (page itself slow)
    maxPages: 90,         // hard cap on harvested pages per run

    /* subresource HEAD probe */
    resProbeCap: 40,      // max unique subresources probed per page

    /* skip rules: page paths matching these are not visited at all.
     * reason is mandatory — a skip without a reason is a hole. */
    skip: [
        // { match: 'admin/reboot', reason: 'destructive' },
        // { match: 'admin/system/flash', reason: 'destructive' },
        /* q685 dev1 (25.12.5): the stock nftables page calls fs.exec_direct()
         * -> /cgi-bin/cgi-exec, but this firmware's rpcd ACL grants cgi-io
         * "exec" only to package-manager commands. Verified device-side, not
         * theme-side: even command=/bin/echo returns 403 "Access to command
         * denied by ACL" with a fresh root login session. Page still renders;
         * the rules table is simply empty. Re-check when the ACL grants change. */
        { match: 'admin/status/nftables/iptables', reason: 'device ACL: cgi-exec exec denied for all commands (stock fs.js, verified /bin/echo 403)' },
    ],

    /* poll expectations: path regex -> 'poll' | 'none'.
     * 'poll'  = expect >=2 requests to the same URL within dwell (auto-refresh alive)
     * 'none'  = expect no repeating request (poll here would be a bug/leak)
     * Enforced only when pollExpectEnforced=true; until then recorded. */
    pollExpectEnforced: false,
    pollExpect: {
        'admin/status/overview$': 'poll',
        'admin/status/realtime': 'poll',
        'admin/desktop/changes$': 'none'
    },

    /* iframe-face sampling: pages opened through the real window manager
     * (WM.open + frame switch) — the face users actually see. The two
    * historical traps split across faces: poll-stub on top-level, cookie/
     * partitioning in iframes; one face cannot cover the other. */
    iframeSample: [
        'admin/status/overview',
        'admin/system/admin/password',
        'admin/system/system',
        'admin/network/network'
    ],

    /* geometry probe (q695): pages that render a real table. Absolute
     * invariants only (container fit / column share / clipped overflow), so no
     * reference run is needed; one extra exec per page. */
    geometryPages: [
        'admin/status/processes',
        'admin/status/overview',
        'admin/network/network',
        'admin/network/dhcp',
        'admin/network/firewall',
        'admin/status/routes',
        'admin/system/package-manager'
    ],

    /* 390px mobile sampling: count of pages drawn from the harvest */
    mobileCount: 8,    mobileRect: { width: 390, height: 844 },
    desktopRect: { width: 1600, height: 900 },

    /* menu-harvest fallback if DOM harvest comes up short */
    seedPaths: [
        'admin/status/overview', 'admin/status/realtime',
        'admin/system/system', 'admin/system/admin/status',
        'admin/system/admin/password', 'admin/system/startup',
        'admin/network/network', 'admin/network/wireless',
        'admin/network/dhcp', 'admin/network/firewall'
    ]
};
