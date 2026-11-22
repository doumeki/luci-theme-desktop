'use strict';
/* Browser-side geometry probe.
 *
 * Runs inside the page through WebDriver execute(); must be self-contained
 * (no closures, no requires). The node side injects it as:
 *     return (MEASURE)();
 *
 * Deliberately dumb: it only *measures*. All thresholds live in evaluate.js so
 * the judgement can be unit-tested without a browser or a device.
 */

function measure() {
  var px = function (v) { var n = parseFloat(v); return isFinite(n) ? Math.round(n * 10) / 10 : 0; };
  var R = function (e) {
    var r = e.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  };
  var cls = function (e) { return String(e.className || '').slice(0, 60); };

  /* every same-origin rule that currently matches the element and touches the
     geometry properties we care about - this is what turns "the cell is 2508px"
     into "this selector sets that property". */
  function rulesFor(el) {
    if (!el) return [];
    var out = [];
    var PROPS = ['white-space', 'padding', 'padding-left', 'padding-right',
      'line-height', 'font-size', 'min-width', 'max-width', 'width',
      'overflow-wrap', 'word-break', 'table-layout'];
    function walk(list, href) {
      for (var k = 0; k < list.length; k++) {
        var r = list[k];
        if (r.type === 1 && r.selectorText) {
          var hit = false;
          try { hit = el.matches(r.selectorText); } catch (e) { hit = false; }
          if (!hit) continue;
          var props = {};
          for (var p = 0; p < PROPS.length; p++) {
            var v = r.style.getPropertyValue(PROPS[p]);
            if (v) props[PROPS[p]] = v;
          }
          if (Object.keys(props).length) {
            out.push({ sel: r.selectorText.replace(/\s+/g, ' ').slice(0, 160), props: props, href: href });
          }
        } else if (r.cssRules) {
          walk(r.cssRules, href);
        }
      }
    }
    for (var i = 0; i < document.styleSheets.length; i++) {
      var ss = document.styleSheets[i];
      var href = String(ss.href || '').replace(/^https?:\/\/[^/]+/, '');
      try { if (ss.cssRules) walk(ss.cssRules, href); } catch (e) { /* opaque sheet */ }
    }
    return out.slice(-14); /* later rules win; keep the tail */
  }

  function clipAncestor(el) {
    for (var p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      var cs = getComputedStyle(p);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible')
        return {
          tag: p.tagName, cls: cls(p), ox: cs.overflowX, oy: cs.overflowY, w: R(p).w,
          /* auto/scroll is a scroll container (content reachable), hidden is a
             clip (content gone). A6 must not treat the two the same. */
          scroll: cs.overflowX === 'auto' || cs.overflowX === 'scroll'
        };
    }
    return null;
  }

  function cell(td) {
    var cs = getComputedStyle(td);
    return {
      tag: td.tagName,
      w: R(td).w,
      sw: td.scrollWidth,
      cw: td.clientWidth,
      clip: td.scrollWidth > td.clientWidth + 1,
      ws: cs.whiteSpace,
      ow: cs.overflowWrap,
      wb: cs.wordBreak,
      pad: cs.padding,
      lh: px(cs.lineHeight),
      fs: px(cs.fontSize),
      text: String(td.textContent || '').trim().length
    };
  }

  function blame(td) {
    if (!td) return null;
    var best = null;
    var all = td.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i], r = R(el), cs = getComputedStyle(el);
      var score = Math.max(el.scrollWidth, r.w);
      if (!best || score > best.score) {
        best = {
          score: score, tag: el.tagName, cls: cls(el),
          ws: cs.whiteSpace, ow: cs.overflowWrap, wb: cs.wordBreak,
          minw: cs.minWidth, fs: px(cs.fontSize), pad: cs.padding
        };
      }
    }
    if (best) best.rules = rulesFor(td);
    return best;
  }

  var tables = [];
  var nodes = document.querySelectorAll('table');
  for (var ti = 0; ti < nodes.length; ti++) {
    var t = nodes[ti];
    var rows = t.querySelectorAll('tr');
    if (!rows.length) continue;
    var csT = getComputedStyle(t);
    var tw = R(t).w || 1;
    var headRow = rows[0];
    var dataRow = rows[1] || null;
    var cols = [];
    for (var j = 0; j < headRow.children.length; j++) {
      var c = cell(headRow.children[j]);
      c.j = j;
      c.pct = Math.round((c.w / tw) * 1000) / 10;
      if (dataRow && dataRow.children[j]) c.bodyWs = cell(dataRow.children[j]).ws;
      if (c.pct >= 50 || c.clip) c.rules = rulesFor(headRow.children[j]);
      cols.push(c);
    }
    var rowH = dataRow ? R(dataRow).h : 0;
    var lh = dataRow && dataRow.children[0] ? px(getComputedStyle(dataRow.children[0]).lineHeight) : 0;
    if (!lh && dataRow && dataRow.children[0]) {
      lh = Math.round(px(getComputedStyle(dataRow.children[0]).fontSize) * 1.2);
    }

    var blames = [];
    for (var k = 0; k < cols.length; k++) {
      if (cols[k].pct <= 60 && !cols[k].clip) continue;
      var target = dataRow && dataRow.children[k] ? dataRow.children[k] : headRow.children[k];
      var b = blame(target);
      if (b) { b.j = k; blames.push(b); }
    }

    tables.push({
      i: ti,
      w: tw, sw: t.scrollWidth, cw: t.clientWidth,
      layout: csT.tableLayout, cssWidth: csT.width,
      font: csT.fontFamily.slice(0, 60),
      parentW: t.parentElement ? t.parentElement.clientWidth : 0,
      clip: clipAncestor(t),
      rows: rows.length,
      rowH: rowH, lh: lh,
      density: lh ? Math.round((rowH / lh) * 100) / 100 : 0,
      cols: cols,
      blame: blames
    });
  }

  return {
    vw: window.innerWidth,
    vh: window.innerHeight,
    url: location.pathname,
    /* only ENABLED sheets: after a swap the disabled originals stay in the DOM,
       and counting them would make the fingerprint report the wrong theme. */
    css: Array.prototype.filter.call(
      document.querySelectorAll('link[rel=stylesheet]'),
      function (l) { return !l.disabled; }
    ).map(function (l) { return l.getAttribute('href') || ''; }
    ).filter(function (h) { return h.indexOf('/luci-static/') === 0; }),
    bodyFont: getComputedStyle(document.body).fontFamily.slice(0, 60),
    bodyFs: px(getComputedStyle(document.body).fontSize),
    doc: {
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth
    },
    tables: tables
  };
}

/* expression handed to WebDriver's execute() */
const EXPR = 'return (' + measure.toString() + ')();';

/* In-page stylesheet swap: identical DOM, only the theme changes.
 * `href` is the reference theme's cascade.css (full path, not a base). */
function swap(href) {
  var links = Array.prototype.slice.call(document.querySelectorAll('link[rel=stylesheet]'));
  return new Promise(function (resolve) {
    var done = function () {
      window.requestAnimationFrame(function () {
        void document.body.offsetHeight; /* force reflow */
        resolve(true);
      });
    };
    var ref = document.getElementById('__geom_ref');
    links.forEach(function (l) { l.disabled = true; });
    if (!ref) {
      ref = document.createElement('link');
      ref.rel = 'stylesheet';
      ref.id = '__geom_ref';
      ref.href = href;
      ref.onload = function () { setTimeout(done, 150); };
      ref.onerror = function () { setTimeout(done, 500); };
      document.head.appendChild(ref);
    } else {
      ref.href = href;
      ref.disabled = false;
      ref.onload = function () { setTimeout(done, 150); };
      setTimeout(done, 400);
    }
  });
}

function swapScript(href) {
  return 'return (' + swap.toString() + ')(' + JSON.stringify(href) + ');';
}

module.exports = { measure, EXPR, swap, swapScript };
