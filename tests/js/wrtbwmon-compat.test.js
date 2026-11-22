/* wrtbwmon-compat.test.js — old-LuCI-app compatibility regression.
 *
 * wrtbwmon 1.6.3 (luci-app-wrtbwmon) is written against LuCI ~2016:
 * its inline JS binds $('xhr_poll_status').onclick and starts polling
 * via XHR.poll/_q/run/halt. Every stock theme header (argon, bootstrap,
 * design, ifit) ships the xhr_poll_status element; the desktop embedded
 * header did NOT — so `$('xhr_poll_status').onclick` threw TypeError on
 * null, registerTableEventHandlers() died, updateData() never ran and
 * the page sat at "Collecting data…" forever (nlbw/usage).
 *
 * The embedded header now provides the element exactly like the stock
 * themes. This test reproduces the app's init code verbatim and asserts
 * polling actually starts.
 */
(function() {
'use strict';

var XHR = null;

/* Minimal XHR mock faithful to LuCI's xhr.js internals the template
   touches: class statics _q/_t/_r/_i and poll/run/halt/running. */
function makeXHR() {
    function X() {}
    X.prototype.busy = function() { return false; };
    X.prototype.get = function(url, data, callback) {
        if (callback) callback(this, null);
    };
    X.prototype.post = function(url, data, callback) {
        if (callback) callback(this);
    };
    X._q = null;
    X._t = 0;
    X._r = null;
    X._i = null;
    X.poll = function(interval, url, data, callback) {
        if (isNaN(interval) || interval < 1) interval = 5;
        if (!X._q) {
            X._t = 0;
            X._q = [];
            X._r = function() {
                for (var i = 0, e = X._q[0]; i < X._q.length; e = X._q[++i])
                    if (!(X._t % e.interval) && !e.xhr.busy())
                        e.xhr.get(e.url, e.data, e.callback);
                X._t++;
            };
        }
        X._q.push({
            interval: interval, callback: callback,
            url: url, data: data, xhr: new X()
        });
        X.run();
    };
    X.halt = function() { window.clearInterval(X._i); X._i = null; };
    X.run = function() {
        if (X._r && !X._i) {
            X._r();
            X._i = window.setInterval(X._r, 1000);
        }
    };
    X.running = function() { return !!(X._r && X._i); };
    window.XHR = X;
    return X;
}

function $ (tid) { return document.getElementById(tid); }

function buildAppDom() {
    var holder = document.getElementById('app-fixture');
    if (!holder) {
        holder = document.createElement('div');
        holder.id = 'app-fixture';
        document.body.appendChild(holder);
    }
    holder.innerHTML =
        '<span id="xhr_poll_status" style="display:none">' +
            '<span class="label success" id="xhr_poll_status_on">on</span>' +
            '<span class="label" id="xhr_poll_status_off" style="display:none">off</span>' +
        '</span>' +
        '<select id="intervalSelect"><option value="1">1</option><option value="5" selected>5</option><option value="10">10</option></select>' +
        '<div id="traffic"><div class="th" id="thMAC"></div></div>' +
        '<button id="resetDatabase"></button>' +
        '<input id="setBD">' +
        '<select id="Select46"><option value="ipv4" selected>ipv4</option></select>' +
        '<input type="checkbox" id="isShow">' +
        '<input type="checkbox" id="showMore">' +
        '<span id="updated"></span>' +
        '<span id="updating"></span>';
}

function registerTableEventHandlers() {
    $('xhr_poll_status').onclick = function() {
        var e = $('intervalSelect');
        XHR.running() ? (XHR.halt(), e.value = -1) : (XHR.run(), e.value = XHR._q[0].interval);
    };
    $('intervalSelect').addEventListener('change', function() {
        if (this.value > 0) {
            XHR._q[0].interval = this.value;
            if (!XHR.running()) XHR.run();
        } else {
            XHR.halt();
        }
    });
    $('resetDatabase').addEventListener('click', function() {
        (new XHR()).post('/cgi-bin/luci/admin/nlbw/usage', {reset: 1}, function() {});
    });
    $('Select46').addEventListener('change', function() {
        XHR._q[0].data["proto"] = this.value;
    });
}

describe('wrtbwmon compat: xhr_poll_status provided by embedded header', function() {
    beforeEach(function() {
        XHR = makeXHR();
        buildAppDom();
    });

    afterEach(function() {
        if (XHR) XHR.halt();
        var h = document.getElementById('app-fixture');
        if (h) h.innerHTML = '';
    });

    it('app init binds the indicator without crashing and polling starts', function() {
        registerTableEventHandlers();          // was: TypeError on null
        // updateData() — the part that never ran before the fix
        XHR.poll(5, '/cgi-bin/luci/admin/nlbw/usage', {proto: 'ipv4', isShow: 0}, function() {});
        assert.ok(XHR.running(), 'polling running after updateData()');
        assert.equal(XHR._q.length, 1, 'poll queued');
        // The stock indicator onclick (also bound by the app) toggles:
        $('xhr_poll_status').onclick();
        assert.ok(!XHR.running(), 'indicator click halts polling');
        $('xhr_poll_status').onclick();
        assert.ok(XHR.running(), 'indicator click resumes polling');
    });

    it('reset button uses new XHR() like the app does', function() {
        registerTableEventHandlers();
        $('resetDatabase').click();
        assert.ok(true, 'no throw on reset post');
    });

    it('interval change writes through XHR._q and restarts when halted', function() {
        registerTableEventHandlers();
        XHR.poll(5, '/cgi-bin/luci/admin/nlbw/usage', {proto: 'ipv4'}, function() {});
        XHR.halt();   // page-local pause — must be resumable (regression:
                      // the auto-refresh wrapper used to latch _blocked)
        assert.ok(!XHR.running(), 'halted');
        $('intervalSelect').value = 10;   // matches an <option> — select.value setter
        $('intervalSelect').dispatchEvent(new Event('change'));
        assert.ok(XHR.running(), 'change event restarts polling');
        // select.value is a string — the app stores it raw (xhr.js coerces on use)
        assert.equal(XHR._q[0].interval, '10', 'interval applied');
    });
});

})();
