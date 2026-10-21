# Tests

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

Each gate is a normal function and can run standalone:
`node -e "require('./tests/run-headless.js').templateSyncCheck()"`.

Optional: with a local OpenWrt build tree, the Lua runtime tests run too:

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
Expected: 7/7 checks pass.

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
