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

## CI

`.github/workflows/tests.yml` runs Level 1 on every push and pull request:
Ubuntu, Node 20, Mozilla's official Firefox tarball + geckodriver, then
`node tests/run-headless.js`. No router, no secrets, no build tree needed.
