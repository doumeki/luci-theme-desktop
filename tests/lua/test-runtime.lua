-- test-runtime.lua — runtime.lua getChanges 双格式规范化单测
--
-- 背景（theme-merge-plan §1/§5）：uci:changes() 在两个 runtime 上结构不同
--   ucode（ubus 后端）: secs = { {type,sec,opt,val}, ... }   （数组行）
--   Lua（libuci delta）: secs = { [sec] = {opt=val, ['.type']=...} }（嵌套 dict）
-- getChanges 统一输出 {cfg,sec,opt,val,type} 行。本测试 mock cursor，
-- 验证两种格式的规范化语义（对齐 master 0.1.0-84，真机验证过的行为）。
--
-- 用法：lua5.1 tests/lua/test-runtime.lua [theme_root]
-- （run-headless.js 的 node 侧契约会调用并传入 theme 根路径；本地也可直接跑，
-- 默认使用本机常见构建树路径）
local ROOT = arg and arg[1] or '.'
package.path = ROOT .. '/files/root/usr/lib/lua/?.lua;' .. package.path

local ok, runtime = pcall(require, 'luci.desktop.runtime')
assert(ok, 'runtime.lua load failed: ' .. tostring(runtime))

local pass, fail = 0, 0
local function toLines(actual)
    local a = {}
    for _, r in ipairs(actual) do
        a[#a + 1] = table.concat({ r.cfg, r.sec, r.opt, r.val, r.type }, '|')
    end
    return a
end
local function rowsEq(actual, expected, msg)
    local sa, sb = table.concat(toLines(actual), ';'), table.concat(expected, ';')
    if sa == sb then
        pass = pass + 1
    else
        fail = fail + 1
        print('FAIL: ' .. msg .. '\n  expected: ' .. sb .. '\n  actual:   ' .. sa)
    end
end
-- 无序比较：getChanges 只保证 cfg/sec 排序，同 sec 的 option 行序 = pairs 顺序（不稳定）
local function rowsEqUnordered(actual, expected, msg)
    local sort = function(t) table.sort(t); return table.concat(t, ';') end
    if sort(toLines(actual)) == sort(expected) then
        pass = pass + 1
    else
        fail = fail + 1
        print('FAIL: ' .. msg .. '\n  expected(set): ' .. sort(expected) .. '\n  actual(set):   ' .. sort(toLines(actual)))
    end
end
local function mkCursor(data)
    return { changes = function() return data end }
end

-- 1) 空变更
rowsEq(runtime.getChanges(mkCursor({})), {}, 'empty changes')

-- 2) ucode 数组格式
rowsEq(runtime.getChanges(mkCursor({ net = { { 'set', 'lan', 'proto', 'dhcp' }, { 'add', 'wan', 'ifname', 'eth1' } } })),
    { 'net|lan|proto|dhcp|set', 'net|wan|ifname|eth1|add' }, 'ucode array rows')

-- 3) Lua dict：section add（.type 非空）/ option set / option delete（''）/ section delete（.type=''）
--    （同 sec 的 option 行序不保证——pairs 顺序，用无序比较）
rowsEqUnordered(runtime.getChanges(mkCursor({ fw = {
    s1 = { ['.type'] = 'rule', name = 'Allow-DNS', proto = '' },
    s2 = { ['.type'] = '' }
} })), { 'fw|s1||rule|add', 'fw|s1|name|Allow-DNS|set', 'fw|s1|proto||remove', 'fw|s2|||remove' },
    'lua dict: add/set/remove semantics')

-- 4) dict list 操作：option 值为 table → list-add（每项一行）
rowsEq(runtime.getChanges(mkCursor({ net = { lan = { ipaddr = { '10.0.0.1', '10.0.0.2' } } } })),
    { 'net|lan|ipaddr|10.0.0.1|list-add', 'net|lan|ipaddr|10.0.0.2|list-add' }, 'dict list-add')

-- 5) dict secs 层非 table（raw value → set）
rowsEq(runtime.getChanges(mkCursor({ misc = { rawsec = 'rawvalue' } })),
    { 'misc|rawsec||rawvalue|set' }, 'dict raw section value')

-- 6) 排序：cfg 字母序（数组格式下 secs 直接是行数组）
rowsEq(runtime.getChanges(mkCursor({ zeta = { { 'set', 's', 'o', 'v' } }, alpha = { { 'set', 's', 'o', 'v' } } })),
    { 'alpha|s|o|v|set', 'zeta|s|o|v|set' }, 'sorted by cfg')

-- 7) 两个 cfg 各用一种格式（真实场景的跨格式：规范化互不干扰）
rowsEq(runtime.getChanges(mkCursor({ arrcfg = { { 'set', 's', 'o', 'v' } }, dictcfg = { s = { x = '1' } } })),
    { 'arrcfg|s|o|v|set', 'dictcfg|s|x|1|set' }, 'two configs: one array, one dict')

-- ===== newCursor 写自检（官方 25.x session ACL 回归, 2026-08-18）=====
-- 官方 OpenWrt 25.x 的登录 session 无 uci 写 ACL —— luci.model.uci 带 session
-- 调 ubus uci 写会 Permission denied（错误被吞）。newCursor 在 uci.lua 提供
-- set_session_id 时清除 session。本测试用真机 cursor 写/读/清理，验证写盘
-- 链路可用（需在路由器上跑）。
do
    local c = runtime.newCursor()
    local name = 'smoketest_' .. tostring(os.time())
    local val = 'v' .. tostring(os.time())
    local ok1 = c:set('desktop', name, name)
    local ok2 = c:set('desktop', name, 'val', val)
    local okc, errc = c:commit('desktop')
    local back = c:get('desktop', name, 'val')
    if ok1 and ok2 and okc and back == val then
        pass = pass + 1
        print('OK: newCursor write+readback')
    else
        fail = fail + 1
        print(('FAIL: newCursor write ok1=%s ok2=%s commit=%s err=%s back=%s'):format(
            tostring(ok1), tostring(ok2), tostring(okc), tostring(errc), tostring(back)))
    end
    c:delete('desktop', name)
    c:commit('desktop')
end

print(('test-runtime.lua: %d passed, %d failed'):format(pass, fail))
os.exit(fail == 0 and 0 or 1)
