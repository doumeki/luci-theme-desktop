'use strict';
/* Real samples from q692 run11 (theme fingerprint verified per run).
 * bootstrap  = reference theme, same DOM
 * desktop332 = the fork, same DOM, the regression under investigation
 */

const bootstrap = {
  vw: 1600, bodyFs: 13, bodyFont: '-apple-system',
  doc: { sw: 1588, cw: 1588 },
  tables: [{
    i: 0, w: 1180, parentW: 1180, rows: 142, rowH: 48, lh: 18, density: 2.7,
    clip: null,
    cols: [
      { j: 0, pct: 5, w: 56, pad: '10px 10px 9px', ws: 'normal' },
      { j: 1, pct: 6, w: 73, pad: '10px 10px 9px', ws: 'normal' },
      { j: 2, pct: 55, w: 651, pad: '10px 10px 9px', ws: 'normal' },
      { j: 3, pct: 6, w: 72, pad: '10px 10px 9px', ws: 'normal' },
      { j: 4, pct: 7, w: 87, pad: '10px 10px 9px', ws: 'normal' },
      { j: 5, pct: 21, w: 242, pad: '10px 10px 9px', ws: 'nowrap' }
    ],
    blame: []
  }]
};

const desktop332 = {
  vw: 1600, bodyFs: 16, bodyFont: '"Google Sans"',
  doc: { sw: 1588, cw: 1588 },
  tables: [{
    i: 0, w: 3216, parentW: 1180, rows: 142, rowH: 73, lh: 16.1, density: 4.5,
    clip: { tag: 'DIV', cls: 'cbi-section', ox: 'hidden', oy: 'hidden', w: 1180 },
    cols: [
      { j: 0, pct: 2, w: 56, pad: '16px', ws: 'normal' },
      { j: 1, pct: 3, w: 73, pad: '16px', ws: 'normal' },
      { j: 2, pct: 78, w: 2508, pad: '16px', ws: 'normal', bodyClip: true },
      { j: 3, pct: 4, w: 72, pad: '16px', ws: 'normal' },
      { j: 4, pct: 5, w: 87, pad: '16px', ws: 'normal' },
      { j: 5, pct: 8, w: 242, pad: '16px', ws: 'normal' }
    ],
    blame: [{ j: 2, tag: 'SPAN', cls: 'command', ws: 'nowrap', ow: 'normal', wb: 'normal', minw: '0px', score: 2508 }]
  }]
};

module.exports = { bootstrap, desktop332 };
