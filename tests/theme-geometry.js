'use strict';
/* Driving the geometry comparison on a live page.
 *
 * Flow per page:
 *   1. measure under the real theme            -> sample
 *   2. identify the loaded theme (fingerprint) -> refuse to judge if unknown
 *   3. disable the real theme, load the reference -> measure -> baseline
 *   4. evaluate(sample, baseline) -> findings
 *
 * Run from the theme git root:
 *   PROBE_ROUTER=<router-ip> PROBE_SSH=<router-ip> node tests/theme-geometry.js
 */
const fs = require('fs');
const path = require('path');

const lib = require('../probe/lib.js');
const { EXPR, swapScript } = require('./geom/measure');
const { evaluate, summarize } = require('./geom/evaluate');

const BASE = 'http://' + lib.ROUTER;
const REF = process.env.GEOM_REF || '/luci-static/bootstrap/cascade.css';
const CACHE = process.env.GEOM_CACHE || path.join(__dirname, 'fixtures', 'geometry');

const PAGES = (process.env.GEOM_PAGES || [
  'admin/status/processes',
  'admin/status/overview',
  'admin/network/network',
  'admin/network/firewall',
  'admin/system/package-manager'
].join(',')).split(',');

/* theme + version from whatever cascade.css is loaded. bootstrap stores it at
 * /luci-static/bootstrap/cascade.css, argon/desktop at /luci-static/<t>/css/... */
function fingerprint(sample) {
  const href = (sample.css || []).find(h => /(?:^|\/)cascade\.css/.test(h)) || '';
  const m = /\/luci-static\/([^/]+)\/(?:css\/)?cascade\.css(?:\?v=([^&]+))?/.exec(href);
  return m ? { theme: m[1], version: m[2] || null, href: href } : { theme: null, version: null, href: href };
}

async function run() {
  await lib.startGecko();
  const sid = await lib.newSession();
  await lib.login(sid);

  const results = [];
  for (const rel of PAGES) {
    const url = BASE + '/cgi-bin/luci/' + rel + '?embed=1';
    await lib.nav(sid, url);
    await lib.sleep(4500);

    const sample = await lib.exec(sid, EXPR);
    const fp = fingerprint(sample);

    /* G1: never judge a sample we cannot attribute */
    if (!fp.theme) {
      results.push({ page: rel, error: 'cannot identify loaded theme', css: sample.css });
      console.log('SKIP ' + rel + ' : cannot identify loaded theme');
      continue;
    }
    if (/^bootstrap/.test(fp.theme) && !process.env.GEOM_ALLOW_REF) {
      results.push({ page: rel, error: 'page already on the reference theme', theme: fp });
      console.log('SKIP ' + rel + ' : already on ' + fp.theme + ' (switch theme first)');
      continue;
    }

    /* swap to the reference theme on the *same* DOM */
    await lib.exec(sid, swapScript(REF));
    await lib.sleep(500);
    const baseline = await lib.exec(sid, EXPR);
    const refFp = fingerprint(baseline);

    const findings = refFp.theme && refFp.theme !== fp.theme ? evaluate(sample, baseline) : evaluate(sample, null);
    const sum = summarize(findings);

    const rec = {
      page: rel, theme: fp, reference: refFp, verdict: sum.verdict,
      fail: sum.fail, note: sum.note,
      findings: findings.filter(f => f.level !== 'PASS')
    };
    results.push(rec);

    console.log(sum.verdict + ' ' + rel + ' [' + fp.theme + (fp.version ? ' v' + fp.version : '') + ']' +
      ' fail=' + sum.fail + ' note=' + sum.note);
    rec.findings.forEach(f => {
      console.log('  ' + f.level + ' ' + f.id + ' ' + f.dim + ' actual=' + f.actual + ' expect=' + f.expect);
      if (f.blame) {
        console.log('      blame ' + f.blame.tag + '.' + f.blame.cls + ' ws=' + f.blame.ws +
          ' score=' + f.blame.score);
        (f.blame.rules || []).forEach(r => {
          console.log('        rule ' + r.sel + ' => ' + JSON.stringify(r.props));
        });
      }
    });

    if (process.env.GEOM_DUMP) {
      fs.mkdirSync(CACHE, { recursive: true });
      const safe = rel.replace(/[^\w.-]+/g, '_');
      fs.writeFileSync(path.join(CACHE, safe + '.sample.json'), JSON.stringify(sample, null, 2));
      fs.writeFileSync(path.join(CACHE, safe + '.baseline.json'), JSON.stringify(baseline, null, 2));
    }

    await lib.nav(sid, url); /* restore the real theme for the next page */
  }

  try { await lib.finish(sid); } catch (e) { /* ignore */ }

  const out = process.env.GEOM_JSON ? JSON.stringify(results, null, 2) : null;
  if (out) console.log(out);
  return results.some(r => r.verdict === 'FAIL') ? 1 : 0;
}

if (require.main === module) {
  run().then(code => process.exit(code)).catch(e => {
    console.log('ERR ' + (e && e.stack || e));
    process.exit(2);
  });
}

module.exports = { run, fingerprint };
