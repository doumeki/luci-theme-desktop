/* stickynote.test.js — Sticky Note core behaviors (7-color page model):
 *  1. render shows notes[activeColor] (content follows the SHOW color)
 *  2. color switch = switch page: each color's content is independent
 *  3. input saves to the CURRENT page's color key
 *  4. legacy {content} entries migrate into the color-keyed pages
 *  5. close marks closed (content kept), re-enable restores + clears
 */
(function() {
'use strict';

var COLORS = ['#f9e74a', '#f78b6e', '#7ec8a0', '#6eb5f7', '#c49bdb', '#f5a3c7', '#ffffff'];

function stickyConfig(entries) {
    var cfgEl = document.getElementById('desktop-config');
    var cfg = JSON.parse(cfgEl.textContent || '{}');
    cfg.stickysync = entries;
    cfgEl.textContent = JSON.stringify(cfg);
}

function noteBody(inst) { return inst.el.querySelector('.sticky-body'); }
function noteSel(inst) { return inst.el.querySelector('.sticky-color'); }
function afterSync(slot) {
    return JSON.parse(document.getElementById('desktop-config').textContent).stickysync[slot];
}

describe('Sticky note: 7-color page model', function() {
    afterEach(function() {
        WidgetManager._instancesOf('sticky-note').forEach(function(iid) { WidgetManager.disable(iid); });
    });

    it('renders notes[activeColor] — content follows the SHOW color', function() {
        stickyConfig({ 'sn-P1': { notes: { '#f9e74a': 'yellow page', '#7ec8a0': 'green page' }, activeColor: '#7ec8a0' } });
        WidgetManager.enable('sticky-note', { id: 'sn-P1' });
        var inst = WidgetManager.instances['sn-P1'];
        assert.contains(noteBody(inst).textContent || '', 'green page', 'green page shown (activeColor)');
        assert.equal(noteSel(inst).value, '#7ec8a0', 'picker shows the show color');
    });

    it('color switch changes WHICH page shows; each page keeps its own content', function() {
        stickyConfig({ 'sn-P2': { notes: { '#f9e74a': 'Y', '#7ec8a0': 'G' }, activeColor: '#7ec8a0' } });
        WidgetManager.enable('sticky-note', { id: 'sn-P2' });
        var inst = WidgetManager.instances['sn-P2'];
        assert.contains(noteBody(inst).textContent || '', 'G', 'green first');
        var sel = noteSel(inst);
        sel.value = '#f9e74a';
        sel.dispatchEvent(new Event('change'));
        assert.contains(noteBody(inst).textContent || '', 'Y', 'yellow after switch');
        sel.value = '#7ec8a0';
        sel.dispatchEvent(new Event('change'));
        assert.contains(noteBody(inst).textContent || '', 'G', 'green back, content intact');
    });

    it('input saves to the CURRENT page color key only', function() {
        stickyConfig({ 'sn-P3': { notes: { '#f9e74a': '', '#7ec8a0': 'G0' }, activeColor: '#7ec8a0' } });
        WidgetManager.enable('sticky-note', { id: 'sn-P3' });
        var inst = WidgetManager.instances['sn-P3'];
        noteBody(inst).textContent = 'G1';
        noteBody(inst).dispatchEvent(new Event('input'));
        var e = afterSync('sn-P3');
        assert.equal(e.notes['#7ec8a0'], 'G1', 'green page updated');
        assert.equal(e.notes['#f9e74a'], '', 'yellow page untouched');
    });

    it('legacy {content} entry migrates into the activeColor page', function() {
        stickyConfig({ 'sn-P4': { content: 'legacy text', activeColor: '#7ec8a0' } });
        WidgetManager.enable('sticky-note', { id: 'sn-P4' });
        var inst = WidgetManager.instances['sn-P4'];
        assert.contains(noteBody(inst).textContent || '', 'legacy text', 'content rendered');
        var e = afterSync('sn-P4');
        assert.equal(e.notes['#7ec8a0'], 'legacy text', 'content landed on the show-color page');
        assert.equal(e.content, undefined, 'legacy content field removed');
        assert.ok(e.notes, 'notes map exists');
        COLORS.forEach(function(c) { if (e.notes[c] === undefined) assert.fail('missing color key ' + c); });
    });

    it('close marks closed and keeps content; re-enable clears the marker', function() {
        stickyConfig({ 'sn-P5': { notes: { '#f9e74a': 'keep me' }, activeColor: '#f9e74a' } });
        WidgetManager.enable('sticky-note', { id: 'sn-P5' });
        var inst = WidgetManager.instances['sn-P5'];
        inst.el.querySelector('.sticky-del').click();
        var closed = afterSync('sn-P5');
        assert.equal(closed.closed, true, 'marked closed');
        assert.equal(closed.notes['#f9e74a'], 'keep me', 'content preserved');
        WidgetManager.enable('sticky-note', { id: 'sn-P5' });
        var re = afterSync('sn-P5');
        assert.ok(!re.closed, 'closed marker cleared on re-enable');
        assert.contains(noteBody(WidgetManager.instances['sn-P5']).textContent || '', 'keep me', 'content restored');
    });
});

/* Sticky note store (P2): debounced, serialized writes + pagehide flush.
 * DOM stays the per-tab source of truth (updated immediately); only the
 * backend POST is coalesced. Tests stub XMLHttpRequest and drive the
 * store through the __stickynoteStore test hook. Note: WidgetManager
 * enable/disable POSTs the widgets section itself — assertions count
 * only section=stickysync POSTs. */
describe('Sticky note store: debounced writes', function() {
    var origXHR, posts;

    // complete=true: POSTs finish synchronously (onload fired in send).
    function stubXHR(complete) {
        window.XMLHttpRequest = function() {
            var self = this;
            this.open = function(m, u, async) { self.async = async; };
            this.setRequestHeader = function() {};
            this.send = function(body) {
                posts.push({ body: body, xhr: self, async: self.async });
                if (complete && self.onload) self.onload();
            };
        };
    }

    function stickyPosts() {
        // Tolerate stray no-body GETs (e.g. probePlatform's delayed
        // fire-and-forget from another suite's boot()) — count only
        // stickysync POSTs.
        return posts.filter(function(p) { return p.body && p.body.indexOf('section=stickysync') !== -1; });
    }

    function decodedBody(p) { return decodeURIComponent(p.body); }

    function wait(ms) { return new Promise(function(res) { setTimeout(res, ms); }); }

    beforeEach(function() {
        origXHR = window.XMLHttpRequest;
        posts = [];
        window.__stickynoteStore.setDebounce(30);
        window.__stickynoteStore.reset();
    });

    afterEach(function() {
        WidgetManager._instancesOf('sticky-note').forEach(function(iid) {
            WidgetManager.disable(iid);
        });
        window.__stickynoteStore.reset();
        window.__stickynoteStore.setDebounce(500);
        window.XMLHttpRequest = origXHR;
    });

    it('coalesces a burst of inputs into ONE backend POST (latest content wins)', function() {
        stubXHR(true);
        stickyConfig({ 'sn-T1': { notes: { '#f9e74a': '' }, activeColor: '#f9e74a' } });
        WidgetManager.enable('sticky-note', { id: 'sn-T1' });
        var inst = WidgetManager.instances['sn-T1'];
        ['v0', 'v1', 'v2'].forEach(function(v) {
            noteBody(inst).textContent = v;
            noteBody(inst).dispatchEvent(new Event('input'));
        });
        assert.equal(stickyPosts().length, 0, 'nothing POSTed yet (debounced)');
        return wait(120).then(function() {
            assert.equal(stickyPosts().length, 1, 'exactly one POST for the burst');
            assert.contains(decodedBody(stickyPosts()[0]), 'v2', 'latest content wins');
        });
    });

    it('flush sends the pending write immediately and synchronously', function() {
        stubXHR(true);
        // legacy entry → enable() migrates it → schedules a write
        stickyConfig({ 'sn-T2': { content: 'legacy', activeColor: '#f9e74a' } });
        WidgetManager.enable('sticky-note', { id: 'sn-T2' });
        var inst = WidgetManager.instances['sn-T2'];
        window.__stickynoteStore.flush();
        assert.equal(stickyPosts().length, 1, 'enable-time migration write flushed');
        noteBody(inst).textContent = 'flush me';
        noteBody(inst).dispatchEvent(new Event('input'));
        var before = stickyPosts().length;
        window.__stickynoteStore.flush();
        var after = stickyPosts();
        assert.equal(after.length, before + 1, 'flush POSTs immediately');
        assert.contains(decodedBody(after[after.length - 1]), 'flush me', 'pending content sent');
        assert.equal(after[after.length - 1].async, false, 'flush is synchronous');
    });

    it('writes during an in-flight POST are re-sent after it completes (no out-of-order overwrite)', function() {
        stubXHR(false);   // POSTs complete manually
        stickyConfig({ 'sn-T3': { content: 'legacy', activeColor: '#f9e74a' } });
        WidgetManager.enable('sticky-note', { id: 'sn-T3' });
        return wait(120).then(function() {
            var first = stickyPosts();
            assert.equal(first.length, 1, 'first POST in flight');
            var inst = WidgetManager.instances['sn-T3'];
            noteBody(inst).textContent = 'after';
            noteBody(inst).dispatchEvent(new Event('input'));
            assert.equal(stickyPosts().length, 1, 'no new POST while in flight');
            first[0].xhr.onload();   // first POST completes
            var second = stickyPosts();
            assert.equal(second.length, 2, 'latest write sent right after completion');
            assert.contains(decodedBody(second[1]), 'after', 'latest map wins');
        });
    });

    it('DOM is updated immediately even though the POST is deferred', function() {
        stubXHR(true);
        stickyConfig({ 'sn-T4': { notes: { '#f9e74a': '' }, activeColor: '#f9e74a' } });
        WidgetManager.enable('sticky-note', { id: 'sn-T4' });
        var inst = WidgetManager.instances['sn-T4'];
        noteBody(inst).textContent = 'instant';
        noteBody(inst).dispatchEvent(new Event('input'));
        var e = afterSync('sn-T4');
        assert.equal(e.notes['#f9e74a'], 'instant', 'DOM reflects the write before any POST');
    });
});

/* Closed-slot resurrection guard (0.1.0-89/90 regression: a note closed on
 * one view popped back as a fresh instance on the other view's reload).
 * The two enable paths differ ON PURPOSE:
 *   - loadConfig/syncSlots pass _skipSave=true  → closed marker RESPECTED
 *   - a plain enable() (user re-open)          → closed marker CLEARED
 */
describe('Sticky note: closed-slot resurrection guard', function() {
    afterEach(function() {
        WidgetManager._instancesOf('sticky-note').forEach(function(iid) {
            WidgetManager.disable(iid);
        });
        window.__stickynoteStore.reset();
    });

    it('loadConfig restores a closed-slot config as inactive (no resurrection)', function() {
        // 真实回归场景：widgets 配置里 closed 槽是 inactive 实例（保存时的
        // active=false），loadConfig 必须 preserve 它而不是 enable 复活
        var cfgEl = document.getElementById('desktop-config');
        var cfg = JSON.parse(cfgEl.textContent || '{}');
        cfg.stickysync = { 'sn-L1': { notes: { '#f9e74a': 'gone' }, activeColor: '#f9e74a', closed: true } };
        cfg.widgets = { instances: [
            { id: 'sn-L1', typeId: 'sticky-note', active: false }
        ] };
        cfgEl.textContent = JSON.stringify(cfg);
        WidgetManager.loadConfig();
        assert.ok(!WidgetManager.instances['sn-L1'], 'closed slot not resurrected by loadConfig');
        assert.ok(WidgetManager._preservedConfigs['sn-L1'], 'restored as preserved inactive config');
    });

    it('syncSlots NEVER posts a backend save (regression: stale-list overwrite)', function() {
        // 0.1.0-128 bug: syncSlots ran ~2.5s after load and enabled missing
        // slots with _skipSave=false — the save used the CURRENT in-memory
        // list (possibly missing a widget the user enabled before the F5),
        // overwriting UCI and permanently deleting the widget.
        var posts = [];
        var origXHR = window.XMLHttpRequest;
        window.XMLHttpRequest = function() {
            this.open = function() {};
            this.setRequestHeader = function() {};
            this.send = function(body) { posts.push(body); };
        };
        try {
            stickyConfig({ 'sn-S1': { notes: { '#f9e74a': 'open' }, activeColor: '#f9e74a' } });
            WidgetManager.enable('sticky-note', { id: 'sn-S1' }, true);   // load path
            // syncSlots 是模块内闭包——通过 __stickynoteStore 的公开行为验证：
            // enable(_skipSave=true) 后没有产生 widgets POST。
            var wPosts = posts.filter(function(p) { return p.body && p.body.indexOf('section=widgets') !== -1; });
            assert.equal(wPosts.length, 0, 'load-path enable does not POST widgets');
            // disable(_skipSave=true) 同样不 POST（closed 槽同步路径）
            WidgetManager.disable('sn-S1', true);
            wPosts = posts.filter(function(p) { return p.body && p.body.indexOf('section=widgets') !== -1; });
            assert.equal(wPosts.length, 0, 'load-path disable does not POST widgets');
        } finally {
            window.XMLHttpRequest = origXHR;
        }
    });

    it('user re-open (plain enable) clears the closed marker and resurrects', function() {
        stickyConfig({ 'sn-G2': { notes: { '#f9e74a': 'back' }, activeColor: '#f9e74a', closed: true } });
        WidgetManager.enable('sticky-note', { id: 'sn-G2' });
        var inst = WidgetManager.instances['sn-G2'];
        assert.ok(inst, 'user re-open creates the instance');
        assert.contains(inst.el.querySelector('.sticky-body').textContent || '', 'back', 'content restored');
        var e = afterSync('sn-G2');
        assert.ok(!e.closed, 'closed marker cleared on re-open');
    });

    it('load path on an OPEN slot creates the instance (existence sync)', function() {
        stickyConfig({ 'sn-G3': { notes: { '#f9e74a': 'open' }, activeColor: '#f9e74a' } });
        WidgetManager.enable('sticky-note', { id: 'sn-G3' }, true);
        var inst = WidgetManager.instances['sn-G3'];
        assert.ok(inst, 'open slot created on load');
        assert.contains(inst.el.querySelector('.sticky-body').textContent || '', 'open', 'content rendered');
    });
});
})();
