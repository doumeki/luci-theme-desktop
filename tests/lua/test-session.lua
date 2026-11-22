-- test-session.lua — q685 会话机制单测(cookieName HTTPS 语义 + sessionValid 契约)
--
-- 根因背景(q685,dev1 实锤):ucode dispatcher 在 HTTPS 下把会话 cookie
-- 名换成 sysauth_https(dispatcher.uc:963:getenv('HTTPS')=='on'),主题端点
-- 必须镜像同一规则。原 cookieName() 恒返回 sysauth_http → https 访问下
-- apply/revert/ttyd_status/uci_changes 的会话查询全部读空 →
-- "Session expired. Please log in again." 且 https 重新登录永不自愈。
--
-- sessionValid 是 uci_changes "session" 位(q685 修复 C)与 shell 死会话
-- toast(q685 修复 D)的语义基础:ubus session get 有 "token" → 活会话。
--
-- 用法:lua5.1 tests/lua/test-session.lua [theme_root]
-- (run-headless.js 传 theme 仓根路径;也可直接单跑)

local ROOT = arg and arg[1] or '.'
package.path = ROOT .. '/files/root/usr/lib/lua/?.lua;' .. package.path

local ok, runtime = pcall(require, 'luci.desktop.runtime')
assert(ok, 'runtime.lua load failed: ' .. tostring(runtime))

local pass, fail = 0, 0
local function check(cond, msg)
    if cond then
        pass = pass + 1
    else
        fail = fail + 1
        print('FAIL: ' .. msg)
    end
end

local origIsUcode = runtime.isUcode
local origUbusCli = runtime.ubusCli
local origLuci = _G.luci

-- ============ cookieName() ============
-- 1) Lua 轨:恒 sysauth(19.07 dispatcher 不区分 scheme),HTTPS 与否都一样
runtime.isUcode = function() return false end
_G.luci = { http = { getenv = function(k) return k == 'HTTPS' and 'on' or nil end } }
check(runtime.cookieName() == 'sysauth',
    'lua track + HTTPS on: cookieName should be "sysauth", got ' .. tostring(runtime.cookieName()))

-- 2) ucode 轨 + 无 HTTPS:sysauth_http
runtime.isUcode = function() return true end
_G.luci = { http = { getenv = function() return nil end } }
check(runtime.cookieName() == 'sysauth_http', 'ucode + no HTTPS: expected sysauth_http')

-- 3) ucode 轨 + HTTPS=on:sysauth_https(镜像 dispatcher.uc:963)
_G.luci = { http = { getenv = function(k) return k == 'HTTPS' and 'on' or nil end } }
check(runtime.cookieName() == 'sysauth_https', 'ucode + HTTPS on: expected sysauth_https')

-- 4) ucode 轨 + HTTPS=on + luci.http 缺失:pcall 兜底回落 sysauth_http,不崩
_G.luci = nil
local okc, name = pcall(runtime.cookieName)
check(okc, 'ucode + HTTPS + no luci.http: cookieName must not throw')
check(name == 'sysauth_http',
    'ucode + HTTPS + no luci.http: expected fallback sysauth_http, got ' .. tostring(name))

-- ============ sessionValid() ============
-- 5) 短 sid 直接 false,且不触发 ubus 调用
local calls = 0
runtime.ubusCli = function() calls = calls + 1; return '{}' end
check(runtime.sessionValid('short') == false, 'sessionValid(<16 chars) must be false')
check(calls == 0, 'sessionValid(<16 chars) must not call ubus')

-- 6) ubus session get 带 token → true
runtime.ubusCli = function() calls = calls + 1; return '{"session":{"token":"deadbeef","timeout":1}}' end
check(runtime.sessionValid('0123456789abcdef0123456789abcdef') == true,
    'sessionValid: token present -> true')

-- 7) 无 token(会话已 destroy/不存在)→ false
runtime.ubusCli = function() calls = calls + 1; return '{}' end
check(runtime.sessionValid('0123456789abcdef0123456789abcdef') == false,
    'sessionValid: no token -> false')
check(calls == 2, 'sessionValid calls ubus exactly once per check (got ' .. calls .. ')')

-- 还原桩
runtime.isUcode = origIsUcode
runtime.ubusCli = origUbusCli
_G.luci = origLuci

print(string.format('session unit tests: %d passed, %d failed', pass, fail))
os.exit(fail > 0 and 1 or 0)
