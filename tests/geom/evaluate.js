'use strict';
/* Pure judgement layer for geometry samples.
 *
 * No browser, no device, no fs: (sample, baseline) -> findings.
 * This file is what the L1 unit test exercises; the probe only produces the
 * sample, so a threshold change is reviewable in a diff of fixture JSON.
 */

const T = {
  ratioMax: 1.05,      /* table / parent.clientWidth */
  colMaxPct: 60,       /* single column share of table width */
  colDeltaPct: 15,     /* divergence from the reference theme (percentage points) */
  colHardPct: 75,      /* absolute ceiling: above this a column eats the row */
  densityMax: 3.2,     /* row height / line height  (bootstrap 2.7, desktop 4.5) */
  padDeltaPx: 4,       /* per-side padding drift vs reference */
  fsLow: 0.85,         /* body font-size ratio vs reference */
  fsHigh: 1.15,
  driftMax: 0.25,      /* row-count drift that invalidates a comparison */
  tableMax: 3          /* only the first N tables are judged */
};

function round(n, d) {
  const p = Math.pow(10, d == null ? 2 : d);
  return Math.round(n * p) / p;
}

function ratio(a, b) { return b ? round(a / b, 2) : 0; }

/* row count moves with device state (processes, leases, logs); a comparison
   across two different row counts is a NOTE, never a verdict. */
function drift(sample, base) {
  if (!base || !base.rows || !sample.rows) return 0;
  return Math.abs(sample.rows - base.rows) / base.rows;
}

function evaluate(sample, base, opts) {
  const o = Object.assign({}, T, opts || {});
  const out = [];
  if (!sample || !sample.tables || !sample.tables.length) return out;
  const tables = sample.tables.slice(0, o.tableMax);
  const baseTables = (base && base.tables) || [];

  tables.forEach((t, idx) => {
    const b = baseTables[idx] || null;
    const d = drift(t, b);
    /* content drift downgrades anything that depends on content */
    const soft = d > o.driftMax;

    /* A1 - container adaptation. Independent of baseline: a table must fit
       the box it lives in, or the page is broken by definition. */
    const r = ratio(t.w, t.parentW);
    out.push({
      id: 'GEO-A1', dim: 'container-fit', table: t.i,
      actual: r, expect: '<= ' + o.ratioMax,
      level: r > o.ratioMax ? 'FAIL' : 'PASS',
      detail: 'table ' + t.w + 'px in parent ' + t.parentW + 'px'
    });

    /* A2 - single column share. A wide column is normal (routes, package
       lists and dashboard progress bars all run 63-70% under bootstrap), so
       the hard verdict needs a real anomaly: the share is extreme, or the
       table already fails A1. Everything else is a NOTE - a fitting table with
       one dominant column is content shape, not a broken layout. */
    if (t.cols && t.cols.length) {
      const worst = t.cols.reduce((a, c) => (c.pct > a.pct ? c : a), t.cols[0]);
      const refCol = b && b.cols ? b.cols.find(c => c.j === worst.j) : null;
      const delta = refCol ? round(worst.pct - refCol.pct, 1) : null;
      const a1Fail = r > o.ratioMax;
      const hard = worst.pct > o.colHardPct || (a1Fail && worst.pct > o.colMaxPct);
      const suspicious = worst.pct > o.colMaxPct || (delta !== null && delta > o.colDeltaPct);
      out.push({
        id: 'GEO-A2', dim: 'column-share', table: t.i, col: worst.j,
        actual: worst.pct + '%',
        expect: '<= ' + o.colHardPct + '% (or <= ' + o.colMaxPct + '% with the table fitting)',
        level: hard ? 'FAIL' : (suspicious ? 'NOTE' : 'PASS'),
        detail: 'widest column ' + worst.j + ' at ' + worst.w + 'px' +
          (refCol ? ' (reference ' + refCol.pct + '%, delta ' + (delta > 0 ? '+' : '') + delta + 'pp)' : '') +
          (a1Fail ? ' [table also fails A1]' : ''),
        blame: (t.blame || []).find(x => x.j === worst.j) || null
      });
    }

    /* A3 - row density. NOTE only: a row's height is set by its tallest cell,
       and control-bearing cells (action buttons) are legitimately taller than
       text lines. The Processes row measures 73px = ~40px button + padding,
       not text overflow - so this is a reference difference, not breakage. */
    if (t.density) {
      out.push({
        id: 'GEO-A3', dim: 'row-density', table: t.i,
        actual: t.density, expect: '<= ' + o.densityMax + ' (informational)',
        level: t.density > o.densityMax ? 'NOTE' : 'PASS',
        detail: 'row ' + t.rowH + 'px / line-height ' + t.lh + 'px (includes control height)'
      });
    }

    /* A5 - horizontal overflow that actually reaches the viewport */
    const overflow = sample.doc.sw > sample.doc.cw + 1;
    out.push({
      id: 'GEO-A5', dim: 'doc-overflow', table: t.i,
      actual: sample.doc.sw - sample.doc.cw, expect: '<= 0',
      level: overflow ? 'FAIL' : 'PASS',
      detail: 'doc ' + sample.doc.sw + ' / ' + sample.doc.cw
    });

    /* A6 - the trap: overflow hidden by an ancestor reads as "no overflow".
       Distinguish a real clip (content unreachable -> FAIL) from a scroll
       container (content reachable -> NOTE: still over-wide, but not lost). */
    if (t.clip && r > o.ratioMax) {
      const hidden = !t.clip.scroll && t.clip.ox === 'hidden';
      out.push({
        id: 'GEO-A6', dim: hidden ? 'clipped-overflow' : 'scrollable-overflow', table: t.i,
        actual: (hidden ? 'clipped by ' : 'scrolls in ') +
          t.clip.tag + '.' + t.clip.cls + ' (' + t.clip.ox + ')',
        expect: hidden ? 'overflow must be visible or handled' : 'scroll container is acceptable, table should still fit',
        level: hidden ? 'FAIL' : 'NOTE',
        detail: 'A5 would pass here; the table is ' + r + 'x its container' +
          (hidden ? ' and hidden' : ', reachable only by horizontal scrolling')
      });
    }

    /* A4 / C1 - reference-relative, NOTE only */
    if (b) {
      const pads = ['top', 'right', 'bottom', 'left'];
      const cur = (t.cols[0] && t.cols[0].pad) || '';
      const ref = (b.cols[0] && b.cols[0].pad) || '';
      const c = cur.split(' ').map(parseFloat), f = ref.split(' ').map(parseFloat);
      const worstPad = pads.map((_, i) => Math.abs((c[i] || c[0] || 0) - (f[i] || f[0] || 0)))
        .reduce((a, n) => Math.max(a, n), 0);
      out.push({
        id: 'GEO-A4', dim: 'cell-padding', table: t.i,
        actual: cur, expect: ref + ' (+/- ' + o.padDeltaPx + 'px)',
        level: worstPad > o.padDeltaPx ? 'NOTE' : 'PASS',
        detail: 'max per-side drift ' + round(worstPad, 1) + 'px'
      });

      const fr = ratio(sample.bodyFs, base.bodyFs);
      out.push({
        id: 'GEO-C1', dim: 'font-size', table: t.i,
        actual: fr, expect: o.fsLow + '..' + o.fsHigh,
        level: (fr < o.fsLow || fr > o.fsHigh) ? 'NOTE' : 'PASS',
        detail: sample.bodyFs + 'px vs reference ' + base.bodyFs + 'px'
      });

      if (soft) {
        out.push({
          id: 'GEO-DRIFT', dim: 'content-drift', table: t.i,
          actual: d, expect: '<= ' + o.driftMax,
          level: 'NOTE',
          detail: 'row count ' + t.rows + ' vs baseline ' + b.rows +
            ' - content-dependent checks downgraded'
        });
      }
    }
  });

  return out;
}

function summarize(findings) {
  const fail = findings.filter(f => f.level === 'FAIL').length;
  const note = findings.filter(f => f.level === 'NOTE').length;
  return { fail, note, verdict: fail ? 'FAIL' : 'PASS' };
}

module.exports = { evaluate, summarize, T };
