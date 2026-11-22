# Tests

> 端到端操作(换盘/启动/安装/跑测试)见 `docs/runbook.md`。

Three levels, from zero-setup to full device verification.

## Level 1 — JS unit tests (any machine, runs in CI)

Browser-based unit tests (shell/wm/taskbar/widgets/iframe-bridge/…). No
router needed — a local HTTP server + headless Firefox.

**Requirements**: Node.js ≥ 16, Firefox (any recent version), geckodriver
(≥ 0.32; must match the Firefox major version — get it from
<https://github.com/mozilla/geckodriver/releases> and put it on `PATH`).

```sh
node tests/run-headless.js        # → "Tests: N/N passed"
```

The runner starts its own HTTP server (127.0.0.1:8891), drives a fresh
headless Firefox through geckodriver, collects verdicts, and also checks
i18n consistency (dict/pot/po alignment). It exits non-zero on failure —
this is what GitHub Actions runs on every push/PR (see
`.github/workflows/tests.yml`).

### Static gates (no router, no browser)

Before the Firefox pass the runner also runs static consistency gates; each
prints its own verdict line and exits non-zero on failure:

- `widgetStyleContractCheck` — widget render idempotency: static
  presentation must be CSS-driven, only dynamic values may touch inline
  styles (`cssText +=` accumulation is banned).
- `intervalOwnerCheck` — every `setInterval`/`new Function` in a widget
  source must carry an `// interval-owner:` note naming its owner.
- `submenuHoverGraceCheck` — submenu visibility grace: the delayed-hide
  trick (`.context-submenu` stays `display:block` + `visibility:hidden`)
  must not be regressed to a plain `display:none` hide.
- `templateSyncCheck` — dual-template semantic sync: the ucode (`.ut`) and
  Lua (`.htm`) sides of header/footer/sysauth must expose the same anchors
  (asset manifests, meta tags, i18n keys, ids, curated code tokens). A
  single side only anchor fails with a human-readable diff; known
  divergences are ratcheted in `TPL_SYNC_KNOWN` with a reason each.
  `TPL_DEBUG=1` prints every ratcheted row and per-pair anchor counts.
- `cbiCacheBusterCheck` — cbi.js cache-buster (q685): every `<script src=
  ".../cbi.js">` in both header templates must carry a `?v=` parameter, and
  that parameter must be keyed on cbi.js's own file mtime (not `theme_ver`).
  Regression basis: a bare cbi.js URL is cached by the browser forever while
  luci-base rewrites the file on every firmware upgrade — a stale copy then
  breaks every form page ("cbi_update_table is not defined") until the user
  hand-clears the cache.
- `controllerIndexEnvCheck` — controller `index()` environment safety (q685):
  no bare call to a function defined in the same `files/controller/*.lua`
  inside `index()`. Regression basis: `luci.dispatcher` runs `index()` under
  `setfenv(idx, setmetatable({}, {__index = luci.dispatcher}))()`, so
  controller-module globals are invisible by bare name — a bare
  `wp_reconcile_storage()` call took the whole pagetree down with HTTP 500 on
  0.1.0-329. Use `package.loaded["luci.controller.<name>"].fn(...)` or a
  captured local instead.

Each gate is a normal function and can run standalone:
`node -e "require('./tests/run-headless.js').templateSyncCheck()"`.

Optional: with a local OpenWrt build tree, the Lua tests run too (runtime change normalization + the q685 session-mechanism unit tests (`cookieName()` HTTPS semantics, `sessionValid()` contract) + the sibling-tabs policy spec):

```sh
LEDE_ROOT=/path/to/openwrt-sdk node tests/run-headless.js
```

## Level 2 — Lua runtime tests (optional, needs an OpenWrt device)

`tests/lua/test-runtime.lua` verifies the `luci.desktop.runtime` layer on a
real router (Lua track). Copy and run over ssh:

```sh
scp tests/lua/test-runtime.lua root@<router>:/tmp/
ssh root@<router> 'lua5.1 /tmp/test-runtime.lua /'
```

Pass the theme root as argv (defaults to `.`):
`ssh root@<router> 'lua5.1 /tmp/test-runtime.lua /usr/lib/lua/luci'`
Expected: 8/8 checks pass (7 normalization + the on-device newCursor write check; on a plain host the write check prints SKIP).

## Level 3 — device probes (optional, your own routers)

`probe/` contains deployment + smoke tooling for the two real test
routers the theme is developed against. This level is **machine-specific by
design**: device addresses/ssh keys are read from `probe/.local-env`
(gitignored — copy `.local-env.example` and fill in your values).

```sh
bash probe/deploy-theme.sh 1.1    # build + deploy + smoke (package manager auto-detected)
bash probe/deploy-theme.sh 253
bash probe/theme-ctl.sh desktop|argon [1.1|253]
```

Device-level tab policy matrix (the sibling-tabs "modes" on a live page,
embed-mode bars): `node tests/tabs-matrix.js` — logs in through
`probe/lib.js` and asserts each mode: a pure firstchild aggregate's own URL
shows its children with the first child active, pages inside an aggregate
show sibling bars with themselves active, and category/plain pages plus
full-shell (non-embed) visits show no bar at all.

Device-level session-expiry mechanism (q685): `bash
tests/session-expiry-device.sh [1.1|253]` — logs in (real form POST), then
destroys the probe session out-of-band via ubus and asserts the theme
endpoints report the dead session: `uci_changes` flips `"session":false`
and the changes apply endpoint returns 401 auth; a fresh login revives it.
Zero config mutation (GETs + one guaranteed-401 POST only). Requires the
theme carrying the q685 `session` bit (>= 0.1.0-329) on the target. The
out-of-band ubus destroy goes over ssh: dev1 is keyless, dev2 (253) uses
`SSH_KEY_2` (or `PROBE_SSH_KEY`). Login is the real form POST; when a target
has a web password we do not hold (`LUCI_WEB_PW` unset) the script falls back
to an ssh-forged, probe-owned session (created and destroyed via ubus), so
the mechanism stays testable on both tracks.

Browser probes (firefox headless via geckodriver) take the router from
`PROBE_ROUTER` / `PROBE_SSH` environment variables.

### Which probe scripts are versioned?

Some ad-hoc probes are tracked, others stay local. The split is deliberate —
only device-agnostic scripts are committed:

- **Tracked** (in git, safe to share): the 22 `tests/*.js` probes and
  `probe/pw-alert-cdp.js`. They never hardcode a device or a cookie name:
  login goes through `probe/lib.js`, which reads the router from
  `probe/.local-env` (`ROUTER_1`/`ROUTER_2`/`SSH_KEY_2`) or the
  `PROBE_ROUTER`/`PROBE_SSH`/`PROBE_SSH_KEY` env overrides, and the cookie
  name from the actual `Set-Cookie` in the login response.
- **Still gitignored** (machine-specific, local only): `probe/runtime-matrix.js`,
  `probe/toast-sync.js` and the other remaining `probe/*.js`/`*.sh` entries in
  `.gitignore`.

To run any device probe, create `probe/.local-env` first (copy
`probe/.local-env.example` and fill in your own values); without it `lib.js`
falls back to `127.0.0.1` and the probes cannot log in.

### Sensitive data

Never commit a real device address, host name, password, token or key path —
public pushes are irreversible. Keep personal values in the gitignored
`probe/.local-env`, use the variables listed above, and write examples with
placeholders (`<router-ip-or-host>`, `<path-to-private-key>`, `${VAR}`) or the
RFC 5737 documentation range (`192.0.2.x`). The Level 1 runner scans every
published file and fails on a leak — see the "敏感信息与个人测试信息" section in
`AGENTS.md` for the red lines and the narrow allowlist mechanism.


## CI

`.github/workflows/tests.yml` runs Level 1 on every push and pull request:
Ubuntu, Node 20, Mozilla's official Firefox tarball + geckodriver, then
`node tests/run-headless.js`. No router, no secrets, no build tree needed.
