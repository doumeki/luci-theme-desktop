/* Shared probe library: geckodriver (with retry), luci login, theme assertion.
 * Usage (run from this theme git root):
 *   const lib = require('./lib.js');
 *   await lib.startGecko(); const sid = await lib.newSession();
 *   await lib.login(sid);   await lib.nav(sid, url);
 *   await lib.assertTheme(sid, 'desktop');   // fails loudly on wrong theme
 *   ... await lib.finish(sid);
 * Theme switch via: ./probe/theme-ctl.sh desktop|argon [1.1|253]  (this git root) */
'use strict';
const { spawn, execSync } = require('child_process');
const http = require('http');

const GPORT = 4444;
// Router addresses come from the environment or probe/.local-env
// (gitignored, template in .local-env.example) — never hardcode devices.
const fs = require('fs');
const path = require('path');
let localEnv = {};
try {
    const envFile = path.join(__dirname, '.local-env');
    if (fs.existsSync(envFile)) {
        fs.readFileSync(envFile, 'utf8').split(/\n/).forEach(function(line) {
            const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
            if (m) localEnv[m[1]] = m[2].replace(/^~/, process.env.HOME || '~');
        });
    }
} catch (e) {}
const ROUTER = process.env.PROBE_ROUTER || localEnv.ROUTER_1 || '127.0.0.1';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// rgb of --primary (light mode) per theme, for assertion
const THEME_RGB = { argon: '94,114,228', desktop: '40,109,49' };

/* Kill ONLY headless firefox + our own geckodriver. Never use a bare
 * '[f]irefox' pattern — it matches the user's desktop browser (learned). */
function killStale() {
    for (const pat of ['[f]irefox.*--headless', '[g]eckodriver --port']) {
        try { execSync(`pkill -9 -f '${pat}' 2>/dev/null; true`); } catch (e) {}
    }
}

function wd(method, urlPath, body, timeoutMs) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const req = http.request({ host: '127.0.0.1', port: GPORT, path: urlPath, method,
            headers: { 'Content-Type': 'application/json' } }, res => {
            let b = ''; res.on('data', d => b += d);
            res.on('end', () => resolve({ status: res.statusCode, body: b }));
        });
        req.setTimeout(timeoutMs || 30000, () => req.destroy(new Error('wd timeout')));
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

async function exec(sid, script) {
    const r = await wd('POST', `/session/${sid}/execute/sync`, { script, args: [] }, 20000);
    try { return JSON.parse(r.body).value; } catch (e) { return '?(' + r.status + ' ' + String(r.body).slice(0, 300) + ')'; }
}

async function nav(sid, url) { try { await wd('POST', `/session/${sid}/url`, { url }, 25000); } catch (e) {} }

/* geckodriver is flaky to start (port leftovers); retry with full cleanup.
 * Attempts: kill stale -> spawn -> poll /status for up to 10s. */
async function startGecko(attempts = 3) {
    let lastErr;
    for (let a = 0; a < attempts; a++) {
        killStale();
        await sleep(400);
        spawn('geckodriver', ['--port', String(GPORT)], { stdio: 'ignore' });
        for (let i = 0; i < 40; i++) {
            try { await wd('GET', '/status', null, 2000); console.log(`[lib] geckodriver up (attempt ${a + 1})`); return; }
            catch (e) { lastErr = e; await sleep(250); }
        }
        console.log(`[lib] geckodriver attempt ${a + 1} failed, retrying...`);
    }
    throw new Error(`geckodriver failed to start after ${attempts} attempts: ${lastErr && lastErr.message}`);
}

async function newSession() {
    const rs = await wd('POST', '/session', { capabilities: { alwaysMatch: { pageLoadStrategy: 'none', 'moz:firefoxOptions': { args: ['--headless', '--width=1600', '--height=900'] } } } }, 90000);
    if (!rs.body) throw new Error('no session response: ' + JSON.stringify(rs).slice(0, 200));
    const sid = JSON.parse(rs.body).value && JSON.parse(rs.body).value.sessionId;
    if (!sid) throw new Error('session create failed: ' + rs.body.slice(0, 300));
    return sid;
}

async function login(sid) {
    if (process.env.PROBE_SSH) {
        // No LuCI password needed: forge a ubus session over ssh (the
        // router's own ubus daemon) and inject it as the sysauth cookie.
        // PROBE_SSH=<host> PROBE_SSH_KEY=<keyfile> (optional).
        const host = process.env.PROBE_SSH;
        const key = process.env.PROBE_SSH_KEY ? `-i ${process.env.PROBE_SSH_KEY}` : '';
        const create = execSync(`ssh ${key} root@${host} "ubus call session create '{\\"timeout\\":900}'"`, { encoding: 'utf8' });
        const tok = JSON.parse(create).ubus_rpc_session;
        execSync(`ssh ${key} root@${host} "ubus call session set '{\\"ubus_rpc_session\\":\\"${tok}\\",\\"values\\":{\\"token\\":\\"${tok}\\",\\"username\\":\\"root\\"}}'"`);
        await nav(sid, `http://${ROUTER}/cgi-bin/luci/`);
        await sleep(1500);
        // Lua runtime (luci-lua-runtime, e.g. 2.253) authenticates via the
        // plain `sysauth` cookie — sysauth_http is the ucode runtime's
        // name. PROBE_SSH targets the Lua runtime, so inject `sysauth`.
        await wd('POST', `/session/${sid}/cookie`, { cookie: { name: 'sysauth', value: tok, path: '/', httpOnly: true } });
        // Re-navigate WITH the cookie: the first nav rendered the
        // unauthenticated bootstrap page; the shell only renders after a
        // request that carries the session cookie.
        await nav(sid, `http://${ROUTER}/cgi-bin/luci/`);
        await sleep(2500);
        return;
    }
    const raw = execSync(`curl -s -c - -o /dev/null -d "luci_username=root&luci_password=" http://${ROUTER}/cgi-bin/luci/`, { encoding: 'utf8' });
    const cm = raw.match(/(sysauth_http)\t(\S+)/);
    if (!cm) throw new Error('login failed: no sysauth cookie obtained');
    await nav(sid, `http://${ROUTER}/cgi-bin/luci/`);
    await sleep(1500);
    await wd('POST', `/session/${sid}/cookie`, { cookie: { name: cm[1], value: cm[2], path: '/', httpOnly: true } });
    await nav(sid, `http://${ROUTER}/cgi-bin/luci/`);
    await sleep(2500);
}

/* Normalize #rrggbb or rgb(r,g,b) to 'r,g,b'. */
function norm(v) {
    const s = String(v).trim();
    const hex = s.match(/^#?([0-9a-f]{6})$/i);
    if (hex) {
        const n = parseInt(hex[1], 16);
        return [n >> 16 & 255, n >> 8 & 255, n & 255].join(',');
    }
    return s.replace(/[^\d,]/g, '');
}

/* Read the --primary variable and map it to a theme name. */
async function theme(sid) {
    const v = await exec(sid, `return (function(){var cs=getComputedStyle(document.documentElement);return (cs.getPropertyValue('--primary')||'').trim();})()`);
    const rgb = norm(v);
    for (const t in THEME_RGB) if (rgb === THEME_RGB[t]) return t;
    return 'unknown:' + v;
}

/* Fail loudly if the page is not rendered with the expected theme. */
async function assertTheme(sid, want) {
    const got = await theme(sid);
    if (got !== want) throw new Error(`theme mismatch: want ${want}, got ${got} — run ./theme-ctl.sh ${want} first?`);
}

async function finish(sid) {
    await wd('DELETE', '/session/' + sid, null, 5000).catch(() => {});
    killStale();
}

module.exports = { sleep, exec, nav, startGecko, newSession, login, theme, assertTheme, finish, ROUTER };
