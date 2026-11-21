'use strict';
/* L1 unit test for the judgement layer - no browser, no device.
 *
 * Fixtures are real samples: the fork's Processes page (the bug) and the same
 * page under the reference theme, both captured with a verified CSS fingerprint.
 *
 * Run standalone:  node tests/geom/evaluate.test.js
 * Also usable from run-headless.js via require(...).run()
 */
const assert = require('assert');
const { evaluate, summarize } = require('./evaluate');
const { bootstrap, desktop332 } = require('./fixtures');

function byId(fs) { const m = {}; fs.forEach(f => { m[f.id] = f; }); return m; }

const checks = [];
function check(name, fn) { checks.push({ name, fn }); }

/* 1. reference theme must be clean */
check('reference theme is clean', () => {
  const f = byId(evaluate(bootstrap, bootstrap));
  assert.strictEqual(f['GEO-A1'].level, 'PASS', 'reference must fit its container');
  assert.strictEqual(f['GEO-A2'].level, 'PASS', 'reference widest column is 55%');
  assert.strictEqual(f['GEO-A3'].level, 'PASS', 'reference density 2.7');
  assert.strictEqual(summarize(Object.values(f)).verdict, 'PASS');
});

/* 2. the regression must be caught, with the right dimension each time */
check('desktop-332 regression is caught', () => {
  const fs = evaluate(desktop332, bootstrap);
  const f = byId(fs);
  assert.strictEqual(f['GEO-A1'].level, 'FAIL', 'A1 container fit');
  assert.strictEqual(f['GEO-A1'].actual, 2.73);
  assert.strictEqual(f['GEO-A2'].level, 'FAIL', 'A2 column share');
  assert.strictEqual(f['GEO-A2'].col, 2);
  assert.strictEqual(f['GEO-A3'].level, 'NOTE', 'A3 row density is informational');
  assert.strictEqual(f['GEO-A5'].level, 'PASS', 'document overflow is genuinely 0');
  assert.strictEqual(f['GEO-A6'].level, 'FAIL', 'A6 must expose the clipped overflow');
  assert.strictEqual(f['GEO-A4'].level, 'NOTE', 'padding drift is a note');
  assert.strictEqual(f['GEO-C1'].level, 'NOTE', 'font size drift is a note');
  assert.ok(f['GEO-A2'].blame, 'A2 carries the blaming element');
  assert.strictEqual(f['GEO-A2'].blame.ws, 'nowrap');
  assert.strictEqual(summarize(fs).verdict, 'FAIL');
});

/* 3. only A5 passing is not enough: this is the false-green case that started it */
check('A5 true green does not mask A6', () => {
  const fs = evaluate(desktop332, null); /* no baseline at all */
  const f = byId(fs);
  assert.strictEqual(f['GEO-A5'].level, 'PASS');
  assert.strictEqual(f['GEO-A6'].level, 'FAIL', 'absolute checks still catch it');
  assert.strictEqual(summarize(fs).verdict, 'FAIL');
});

/* 4. content drift is reported, but never softens the structural checks */
check('content drift is reported, structural checks hold', () => {
  const drifted = JSON.parse(JSON.stringify(desktop332));
  drifted.tables[0].rows = 60; /* 60 vs 142 = 58% drift */
  const f = byId(evaluate(drifted, bootstrap));
  assert.strictEqual(f['GEO-A2'].level, 'FAIL', 'A2 is content-independent now');
  assert.strictEqual(f['GEO-A3'].level, 'NOTE', 'A3 stays informational');
  assert.strictEqual(f['GEO-A1'].level, 'FAIL', 'A1 is content-independent');
  assert.strictEqual(f['GEO-A6'].level, 'FAIL', 'A6 is content-independent');
  assert.strictEqual(f['GEO-DRIFT'].level, 'NOTE');
});

/* 5. a legitimately wide table under a scrolling container is not an error:
      A6 only fires when the table is clipped, not when it scrolls */
check('scrolling container is not a clip', () => {
  const scrolled = JSON.parse(JSON.stringify(desktop332));
  scrolled.tables[0].clip = null;
  const f = byId(evaluate(scrolled, null));
  assert.strictEqual(f['GEO-A6'], undefined, 'no clip -> no A6');
  assert.strictEqual(f['GEO-A1'].level, 'FAIL', 'A1 still reports the ratio');
});

/* 6. a scroll container is not a clip: NOTE, not FAIL (q693 real sample:
      .main-right{overflow:auto} reaches the content, it just hides the width) */
check('scroll container is a NOTE, not a FAIL', () => {
  const scrolled = JSON.parse(JSON.stringify(desktop332));
  scrolled.tables[0].clip = { tag: 'DIV', cls: 'main-right', ox: 'auto', oy: 'auto', w: 1564, scroll: true };
  const f = byId(evaluate(scrolled, bootstrap));
  assert.strictEqual(f['GEO-A6'].level, 'NOTE');
  assert.strictEqual(f['GEO-A6'].dim, 'scrollable-overflow');
});

/* 7. a naturally dominant column is not a regression: overview/routes/package
      pages run 63-70% under bootstrap too. A fitting table with one dominant
      column is a NOTE; only an extreme share (or a table that fails A1) is a
      hard failure. */
check('a wide column in a fitting table is only a NOTE', () => {
  const s = JSON.parse(JSON.stringify(desktop332));
  s.tables[0].w = 1564;              /* table fits its container */
  s.tables[0].parentW = 1564;
  s.tables[0].cols[2].pct = 67;
  s.tables[0].cols[2].w = 1100;
  const b = JSON.parse(JSON.stringify(bootstrap));
  b.tables[0].cols[2].pct = 64;
  const f = byId(evaluate(s, b));
  assert.strictEqual(f['GEO-A2'].level, 'NOTE', '67% with the table fitting is informational');
  assert.ok(/delta \+3pp/.test(f['GEO-A2'].detail));
});

function run() {
  const failures = [];
  checks.forEach(c => {
    try { c.fn(); } catch (e) { failures.push(c.name + ' => ' + e.message); }
  });
  return { passed: checks.length - failures.length, total: checks.length, failures };
}

module.exports = { run };

if (require.main === module) {
  const r = run();
  if (r.failures.length) {
    console.log('geom evaluate: FAIL ' + r.passed + '/' + r.total);
    r.failures.forEach(f => console.log('  ' + f));
    process.exit(1);
  }
  console.log('geom evaluate: ' + r.passed + '/' + r.total + ' ok');
}
