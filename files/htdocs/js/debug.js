/* Debug gate: runtime console.log/debug calls are routed through DBG().
   Silent by default; enable per browser with:
     localStorage.setItem('luci-desktop-dbg','1') + reload   (sticky)
     ...?dbg=1                                               (one-shot)
   Toggle from console: DBG.set(true) / DBG.set(false)
   console.error/warn stay direct on purpose (errors must surface).
   Added in 0.1.0-248. See plans/01-console-log-dbg.md. */
(function() {
    var want = false;
    try { want = localStorage.getItem('luci-desktop-dbg') === '1'; } catch (e) {}
    if (!want) try { want = /(?:^|[?&])dbg=1(?:&|$)/.test(String(window.location.search || '')); } catch (e) {}
    window.DBG = function() {
        if (!want) return;
        try { console.log.apply(console, arguments); } catch (e) {}
    };
    window.DBG.set = function(on) {
        want = !!on;
        try { localStorage.setItem('luci-desktop-dbg', want ? '1' : '0'); } catch (e) {}
        try { console.warn('[dbg] luci-theme-desktop debug output ' + (want ? 'ON' : 'off')); } catch (e) {}
    };
})();
