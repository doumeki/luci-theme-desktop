-- test-tabs.lua — sibling-tabs 纯聚合判据单测（Lua 轨，真代码执行）
--
-- 背景（2026-11-15，q507~q517 取证）：desktop 主题的兄弟 tab 条曾用宽松
-- 的长度守卫（先 <4 拒 3 段、后放宽成 3+ 段都画条），q507 设备实测误伤面：
-- startup / status(3 段) 各 15 条、overview 8 条、network 10 条。q508 收紧
-- 为「纯 firstchild 聚合判据」——只有 action.type==firstchild 且无
-- preferred 且无 recurse 的节点（如 admin/system/admin、admin/system/ttyd）
-- 才有 tab 条，共几种 tab 方式：
--   A 聚合自身 URL：渲染其 children，首子 active（q517 设备 embed 实测：
--     admin 聚合 5 条 active=password；ttyd 聚合 2 条 active=ttyd）；
--   B 聚合内 4 段子页：渲染兄弟 tabs，当前页 active；
--   C 分类（preferred/recurse firstchild）与普通 view 页：一律无条。
-- 本测试不 mock 算法：从 compat.lua 源码提取真实的
-- _render_sibling_tabs_ucode，在桩环境（disp/util/i18n）下对镜像设备的
-- fixture 树执行（树形依据 q514 menu.d 取证 + q517 embed 模式实测）。
-- 设备级 ucode 轨行为由 tests/tabs-matrix.js（embed 模式矩阵）覆盖；
-- 本文件尾部的 token 哨兵防止 ut/compat 两轨判据漂移。
--
-- 用法：lua5.1 tests/lua/test-tabs.lua [theme_root]
-- （run-headless.js 以仓库根调用；本地直接跑默认 '.'）

local ROOT = arg and arg[1] or '.'
local COMPAT = ROOT .. '/files/root/usr/lib/lua/luci/desktop/compat.lua'
local UT = ROOT .. '/files/usr/share/ucode/luci/template/themes/desktop/header.ut'

unpack = unpack or table.unpack  -- 兼容 5.2+ 宿主（设备 Lua 为 5.1）

-- ===== 提取被测真代码 =====

local f = assert(io.open(COMPAT, 'r'))
local src = f:read('*a')
f:close()

local s1 = src:find('local function _render_sibling_tabs_ucode', 1, true)
if not s1 then
    print('FAIL: _render_sibling_tabs_ucode not found in ' .. COMPAT)
    os.exit(1)
end
-- 函数体终止符：起始行之后第一个列 0 的 "end" 行（函数内所有 end 均缩进）
local e = src:find('\nend\n', s1, true)
assert(e, 'column-0 end terminator not found')
local fnsrc = src:sub(s1, e + 4)  -- 含结尾的 "end\n"
local loadfn = loadstring or load
local compiled, fn = pcall(function()
    return loadfn('return (function()\n' .. fnsrc .. '\nreturn _render_sibling_tabs_ucode\nend)()',
        'extracted _render_sibling_tabs_ucode')()
end)
if not compiled then
    print('FAIL: extracted function did not compile: ' .. tostring(fn))
    os.exit(1)
end

-- ===== fixture 树（q514 menu.d 取证 + q517 设备实测的镜像）=====
-- 须先于 disp 桩定义：menu_json 桩按 upvalue 引用它。

local TREE = {
    -- build_pagetree() 的根节点形态（dispatcher.uc: tree action=firstchild）
    action = { type = 'firstchild' },
    children = {
        admin = { children = {
            system = {
                action = { type = 'firstchild', preferred = 'system', recurse = true },
                children = {
                    startup = { action = { type = 'view', path = 'system/startup' }, title = 'Startup', order = 60 },
                    loaded = { action = { type = 'view', path = 'system/loaded' }, title = 'Loaded Modules', order = 70 },
                    admin = {
                        action = { type = 'firstchild' },
                        title = 'Administration',
                        order = 2,
                        children = {
                            password = { action = { type = 'view', path = 'system/password' }, title = 'Router Password', order = 10 },
                            dropbear = { action = { type = 'view', path = 'system/dropbear' }, title = 'SSH Access', order = 20 },
                            sshkeys = { action = { type = 'view', path = 'system/sshkeys' }, title = 'SSH-Keys', order = 30 },
                            uhttpd = { action = { type = 'view', path = 'system/uhttpd' }, title = 'HTTP(S) Access', order = 40 },
                            repokeys = { action = { type = 'view', path = 'system/repokeys' }, title = 'Repository Keys', order = 50 },
                        },
                    },
                    ttyd = {
                        action = { type = 'firstchild' },
                        title = 'Terminal',
                        order = 50,
                        children = {
                            ttyd = { action = { type = 'view', path = 'ttyd' }, title = 'Terminal', order = 10 },
                            config = { action = { type = 'view', path = 'ttyd/config' }, title = 'Settings', order = 20 },
                        },
                    },
                    ttyd1 = {  -- fixture：3 段深度、仅 1 个 satisfied 子的纯聚合
                        action = { type = 'firstchild' }, title = 'SoloDeep', order = 55,
                        children = {
                            one = { action = { type = 'view', path = 'x/one' }, title = 'One', order = 10 },
                        },
                    },
                    mixed = {  -- fixture：unsatisfied 子被排除
                        action = { type = 'firstchild' }, title = 'Mixed', order = 58,
                        children = {
                            a = { action = { type = 'view' }, title = 'A', order = 10, satisfied = false },
                            b = { action = { type = 'view' }, title = 'B', order = 20 },
                            c = { action = { type = 'view' }, title = 'C', order = 30 },
                        },
                    },
                    plugagg = {  -- fixture：recurse-only 聚合（分类形态）
                        action = { type = 'firstchild', recurse = true }, title = 'Plugouts', order = 80,
                        children = {
                            plug = { action = { type = 'view', path = 'system/plug' }, title = 'Plug', order = 10 },
                        },
                    },
                },
            },
            status = {
                action = { type = 'firstchild', preferred = 'overview', recurse = true },
                title = 'Status', order = 10,
                children = {
                    overview = { action = { type = 'view', path = 'status/overview' }, title = 'Overview', order = 10 },
                },
            },
            network = {
                action = { type = 'firstchild', recurse = true },
                title = 'Network', order = 60,
                children = {
                    network = { action = { type = 'view', path = 'network/network' }, title = 'Interfaces', order = 10 },
                },
            },
            solo = {  -- fixture：仅 1 个子（2 段深度聚合）
                action = { type = 'firstchild' }, title = 'Solo', order = 70,
                children = {
                    only = { action = { type = 'view', path = 'x/only' }, title = 'Only', order = 10 },
                },
            },
            empty = {  -- fixture：唯一子 unsatisfied
                action = { type = 'firstchild' }, title = 'Empty', order = 80,
                children = {
                    x = { action = { type = 'view' }, title = 'Hidden', order = 10, satisfied = false },
                },
            },
            -- fixture：alias 入口（passwall 形态）。别名到首子，children 是真页面。
            services = {
                action = { type = 'firstchild', recurse = true },
                title = 'Services', order = 90,
                children = {
                    passwall = {
                        action = { type = 'alias', path = 'admin/services/passwall/settings' },
                        title = 'PassWall', order = 30,
                        children = {
                            settings = { action = { type = 'view' }, title = 'Basic Settings', order = 1 },
                            node_list = { action = { type = 'view' }, title = 'Node List', order = 2 },
                            node_subscribe = { action = { type = 'view' }, title = 'Node Subscribe', order = 3 },
                        },
                    },
                    soloalias = {
                        action = { type = 'alias' }, title = 'SoloAlias', order = 40,
                        children = { only = { action = { type = 'view' }, title = 'Only', order = 1 } },
                    },
                    barealias = { action = { type = 'alias' }, title = 'BareAlias', order = 50 },
                },
            },
        }},
    },
}

-- ===== 桩环境（被提取函数按全局查找 disp/util/i18n/unpack）=====
-- build_url 桩：段拼接；真实 LuCI 会带 /cgi-bin/luci 前缀，这里只断言段。

disp = {
    menu_json = function() return TREE end,
    build_url = function(...) return '/' .. table.concat({ ... }, '/') end,
}
util = { striptags = function(s) return s end }
i18n = { translate = function(s) return s end }

-- ===== 断言工具 =====

local pass, fail = 0, 0
local function ok(cond, msg)
    if cond then
        pass = pass + 1
    else
        fail = fail + 1
        print('FAIL: ' .. msg)
    end
end
local function eq(actual, expected, msg)
    if actual == expected then
        pass = pass + 1
    else
        fail = fail + 1
        print(('FAIL: %s\n  expected: %s\n  actual:   %s'):format(msg, tostring(expected), tostring(actual)))
    end
end
local function count(s, needle)
    local n, p = 0, 1
    while true do
        local i = s:find(needle, p, true)
        if not i then return n end
        n = n + 1
        p = i + #needle
    end
end

local pcdata_hits
local function call(request)
    pcdata_hits = {}
    return fn(request, function(h)
        pcdata_hits[#pcdata_hits + 1] = h
        return h
    end)
end

-- ===== A 聚合自身 URL（children 条，首子 active）=====

local a1 = call({ 'admin', 'system', 'admin' })
ok(a1:find('<ul class="tabs">', 1, true), 'A1 admin 聚合自身 URL 出 tab 条')
eq(count(a1, '<li class="tabmenu-item-'), 5, 'A1 admin 聚合 5 个 tab（q517 实测）')
ok(a1:find('tabmenu-item-password active', 1, true), 'A1 首子 password active（order 最小）')
ok(not a1:find('tabmenu-item-dropbear active', 1, true), 'A1 非首子不 active')
ok(a1:find('href="/admin/system/admin/password"', 1, true), 'A1 href 下钻首子（4 段）')
ok(a1:find('href="/admin/system/admin/repokeys"', 1, true), 'A1 href 兄弟全带 4 段路径')
ok(a1:find('Router Password', 1, true), 'A1 标题经 i18n/striptags 链')
ok(a1:find('password', 1, true) < a1:find('dropbear', 1, true), 'A1 排序按 order')
eq(#pcdata_hits, 5, 'A1 pcdata 对每个 href 各调一次')
eq(pcdata_hits[1], '/admin/system/admin/password', 'A1 pcdata 收到完整 href')

local a2 = call({ 'admin', 'system', 'ttyd' })
eq(count(a2, '<li class="tabmenu-item-'), 2, 'A2 ttyd 聚合自身 URL 2 个 tab（q517 实测）')
ok(a2:find('tabmenu-item-ttyd active', 1, true), 'A2 首子 ttyd active')

-- ===== B 聚合内 4 段子页（兄弟条，当前页 active）=====

local b1 = call({ 'admin', 'system', 'admin', 'dropbear' })
eq(count(b1, '<li class="tabmenu-item-'), 5, 'B1 dropbear 兄弟条 5 tab')
ok(b1:find('tabmenu-item-dropbear active', 1, true), 'B1 当前页 dropbear active')
ok(b1:find('href="/admin/system/admin/sshkeys"', 1, true), 'B1 href 走父聚合 4 段')

local b2 = call({ 'admin', 'system', 'admin', 'password' })
ok(b2:find('tabmenu-item-password active', 1, true), 'B2 password 页 active=password')

local b3 = call({ 'admin', 'system', 'ttyd', 'ttyd' })
eq(count(b3, '<li class="tabmenu-item-'), 2, 'B3 ttyd/ttyd 兄弟条 2 tab（q517 实测）')
ok(b3:find('tabmenu-item-ttyd active', 1, true), 'B3 当前页 active')

-- ===== C 分类/普通页无条（q507 误伤回归）=====

eq(call({ 'admin', 'system' }), '', 'C1 system 分类自身 URL 无条')
eq(call({ 'admin', 'status' }), '', 'C2 status 分类自身 URL 无条')
eq(call({ 'admin', 'network' }), '', 'C3 network 分类自身 URL 无条')
eq(call({ 'admin', 'system', 'startup' }), '', 'C4 startup 普通页无条（q507 15 条误伤回归）')
eq(call({ 'admin', 'system', 'loaded' }), '', 'C5 system 第二个普通页无条')
eq(call({ 'admin', 'status', 'overview' }), '', 'C6 overview 普通页无条')
eq(call({ 'admin', 'network', 'network' }), '', 'C7 network/network 普通页无条')

-- ===== D 判据边界 =====

-- D1 recurse-only 聚合自身 URL 与 4 段子页均无条（branch2 recurse 拒绝）
eq(call({ 'admin', 'system', 'plugagg' }), '', 'D1a recurse 聚合自身 URL 无条')
eq(call({ 'admin', 'system', 'plugagg', 'plug' }), '', 'D1b recurse 聚合 4 段子页无条')
-- D2 preferred+recurse 分类的 3 段子页无条
eq(call({ 'admin', 'status', 'overview' }), '', 'D2 preferred 分类 3 段子页无条')
-- D3 单 satisfied 子聚合不条
eq(call({ 'admin', 'solo' }), '', 'D3a 单子聚合自身 URL 无条')
eq(call({ 'admin', 'solo', 'only' }), '', 'D3b 单子聚合 3 段子页无条')
eq(call({ 'admin', 'system', 'ttyd1' }), '', 'D3c 3 段深度单子聚合自身 URL 无条')
eq(call({ 'admin', 'system', 'ttyd1', 'one' }), '', 'D3d 3 段深度单子聚合 4 段子页无条')
-- D4 唯一子 unsatisfied
eq(call({ 'admin', 'empty' }), '', 'D4a 全 unsatisfied 聚合自身 URL 无条')
eq(call({ 'admin', 'empty', 'x' }), '', 'D4b unsatisfied 子页无条')
-- D5 unsatisfied 子被排除、其余正常
local d5 = call({ 'admin', 'system', 'mixed' })
eq(count(d5, '<li class="tabmenu-item-'), 2, 'D5a unsatisfied 子不入条')
ok(not d5:find('tabmenu-item-a"', 1, true), 'D5b unsatisfied 子 a 无 tab')
ok(d5:find('tabmenu-item-b active', 1, true), 'D5c 首个 satisfied 子 active')
local d5b = call({ 'admin', 'system', 'mixed', 'c' })
ok(d5b:find('tabmenu-item-c active', 1, true), 'D5d mixed 内子页 active=c')
-- D6 守卫与 walk 失败（compat 的 #request<2 守卫镜像 header.ut）
eq(call({ 'admin' }), '', 'D6a 单段路径无条')
eq(call({}), '', 'D6b 空 request 无条（守卫）')
eq(call({ 'admin', 'system', 'nope' }), '', 'D6c walk 失败（未知 3 段）')
eq(call({ 'admin', 'system', 'admin', 'nope' }), '', 'D6d walk 失败（未知 4 段）')

-- ===== E alias 入口（passwall 形态：alias 到首子 + 多子页面）=====

local e1 = call({ 'admin', 'services', 'passwall', 'settings' })
eq(count(e1, '<li class="tabmenu-item-'), 3, 'E1 alias 入口子页出 3 个 tab（passwall 复现）')
ok(e1:find('tabmenu-item-settings active', 1, true), 'E1 当前页 settings active')
ok(e1:find('href="/admin/services/passwall/node_list"', 1, true), 'E1 兄弟 href 走 alias 父级')
local e2 = call({ 'admin', 'services', 'passwall', 'node_list' })
ok(e2:find('tabmenu-item-node_list active', 1, true), 'E2 切到 node_list 后 active 跟随')
eq(call({ 'admin', 'services', 'passwall' }), '', 'E3 alias 入口自身 URL 由服务端重定向，不出条')
eq(call({ 'admin', 'services' }), '', 'E4 分类（recurse firstchild）无条')
eq(call({ 'admin', 'services', 'soloalias', 'only' }), '', 'E5 alias 单子不出条')
eq(call({ 'admin', 'services', 'barealias' }), '', 'E6 无子 alias 不出条')

-- ===== S 两轨判据 token 哨兵（防 ut/compat 漂移，与 templateSyncCheck 同思路）=====

ok(src:find('#request < 2', 1, true), 'S compat 空/单段守卫在位')
ok(src:find('PURE firstchild aggregates', 1, true), 'S compat 判据注释在位')
ok(src:find('not na.preferred and not na.recurse', 1, true), 'S compat branch1 纯聚合条件')
ok(src:find('pa.type == "firstchild" and not pa.preferred and not pa.recurse', 1, true), 'S compat branch2 纯聚合条件')
ok(src:find('or pa.type == "alias"', 1, true), 'S compat branch2 alias 入口条件')
ok(src:find('#request >= 4', 1, true), 'S compat 4 段兄弟分支')

local uf = assert(io.open(UT, 'r'))
local ut = uf:read('*a')
uf:close()
ok(ut:find('render_sibling_tabs', 1, true), 'S ut render_sibling_tabs 在位')
ok(ut:find('length(request_path) < 2', 1, true), 'S ut 空/单段守卫在位')
ok(ut:find('PURE firstchild aggregates', 1, true), 'S ut 判据注释在位')
ok(ut:find('!na.preferred && !na.recurse', 1, true), 'S ut branch1 纯聚合条件')
ok(ut:find("pa.type == 'firstchild' && !pa.preferred && !pa.recurse", 1, true), 'S ut branch2 纯聚合条件')
ok(ut:find("pa.type == 'alias'", 1, true), 'S ut branch2 alias 入口条件')
ok(ut:find('length(request_path) >= 4', 1, true), 'S ut 4 段兄弟分支')

print(('test-tabs.lua: %d passed, %d failed'):format(pass, fail))
os.exit(fail == 0 and 0 or 1)
