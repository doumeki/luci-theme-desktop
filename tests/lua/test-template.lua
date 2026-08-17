#!/usr/bin/lua
--[[
    Desktop Theme - Template Tests
    在路由器上运行: lua test-template.lua

    测试 embed 模式检测逻辑和 HTML 输出验证。
    注意：由于 LuCI API 在 standalone lua 中不可用，
    这些测试通过 curl 验证实际 HTTP 响应。

    使用方法: ssh root@${ROUTER_1}后运行:
    lua /usr/lib/lua/luci/view/themes/desktop/../../tests/test-template.lua
--]]

-- ============= 测试框架 =============
local passed = 0
local failed = 0
local tests = {}

function describe(name, fn)
    tests[#tests + 1] = {name = name, fn = fn}
end

function assert(condition, msg)
    if not condition then
        failed = failed + 1
        print("  FAIL: " .. msg)
    else
        passed = passed + 1
        print("  OK:   " .. msg)
    end
end

function assert_contains(haystack, needle, msg)
    assert(haystack:find(needle, 1, true) ~= nil, msg)
end

function assert_not_contains(haystack, needle, msg)
    assert(haystack:find(needle, 1, true) == nil, msg)
end

function http_get(url)
    local f = io.popen("curl -sk '" .. url .. "' 2>/dev/null")
    local content = f:read("*a")
    f:close()
    return content
end

-- ============= 测试套件 =============

describe("Embed 模式检测", function()
    local LUCI_BASE = "https://127.0.0.1/cgi-bin/luci"
    local TEST_URL = LUCI_BASE .. "/admin/status/overview"

    -- 注意: 这些测试需要:
    -- 1. 路由器上主题已激活为 luci-theme-desktop
    -- 2. curl 可用
    -- 3. 未登录状态下的输出也可测（只是内容不同）

    local shell_html = http_get(TEST_URL)
    local embed_html = http_get(TEST_URL .. "?embed=1")

    print("Shell HTML 长度: " .. #shell_html)
    print("Embed HTML 长度: " .. #embed_html)

    assert(#shell_html > 0, "shell 模式应返回 HTML 内容")
    assert(#embed_html > 0, "embed 模式应返回 HTML 内容")

    -- Shell 必须包含的元素
    assert_contains(shell_html, 'class="lang_', "shell 模式应包含 lang_ class")
    assert_contains(shell_html, '<title>', "shell 模式应包含 <title>")
    assert_contains(shell_html, 'shell.css', "shell 模式应加载 shell.css")
    assert_contains(shell_html, 'xhr.js', "shell 模式应加载 xhr.js")

    -- Embed HTML 不应包含外壳元素（嵌入模式下这些不应存在）
    -- 注意: embed 测试可能失败，如果模板还未实现 embed 模式
    assert_not_contains(embed_html, 'shell.css', "embed 模式不应加载 shell.css（只用 embedded.css）")
    assert_not_contains(embed_html, 'id="desktop"', "embed 模式不应包含 #desktop")
    assert_not_contains(embed_html, 'id="desktop-taskbar"', "embed 模式不应包含 #taskbar")
    assert_not_contains(embed_html, 'id="desktop-startmenu"', "embed 模式不应包含 #start-menu")

    -- Embed 模式验证
    assert(not (#shell_html == #embed_html and shell_html == embed_html),
        "shell 和 embed 的 HTML 输出应该不同")
end)

describe("header.htm 结构验证", function()
    local html = http_get("https://127.0.0.1/cgi-bin/luci/admin/status/overview")

    assert_contains(html, '<!DOCTYPE html>', "应包含 DOCTYPE 声明")
    assert_contains(html, '<html lang="', "应包含 html lang 属性")
    assert_contains(html, '<meta charset="utf-8">', "应包含 UTF-8 meta")
    assert_contains(html, 'name="viewport"', "应包含 viewport meta")
    assert_contains(html, 'favicon.ico', "应包含 favicon 引用")
end)

describe("footer.htm 结构验证", function()
    local html = http_get("https://127.0.0.1/cgi-bin/luci/admin/status/overview")

    assert_contains(html, 'luciLocation', "应包含 luciLocation JS 变量")
    assert_contains(html, '</body>', "应闭合 </body>")
    assert_contains(html, '</html>', "应闭合 </html>")
end)

describe("X-Frame-Options 检查", function()
    local f = io.popen("curl -skI 'https://127.0.0.1/cgi-bin/luci/admin/status/overview' 2>/dev/null | grep -i x-frame")
    local result = f:read("*a")
    f:close()

    if result ~= "" then
        print("  INFO: X-Frame-Options: " .. result)
        -- 如果是 DENY，需要改为 SAMEORIGIN
        assert(not result:find("DENY"), "X-Frame-Options 不应该是 DENY（同源 iframe 需要 SAMEORIGIN）")
    else
        print("  INFO: 无 X-Frame-Options 头（默认允许同源 iframe）")
    end
end)

describe("Wallpaper API — random_wallpaper cache-bust", function()
    local API = "https://127.0.0.1/cgi-bin/luci/admin/desktop/random_wallpaper"

    local function get_wp(mode, force)
        local url = API .. "?mode=" .. mode
        if force then url = url .. "&force=1" end
        local f = io.popen("curl -sk '" .. url .. "' 2>/dev/null")
        local body = f:read("*a")
        f:close()
        local json_url = body:match('"url":"([^"]+)"')
        local debug = body:match('"debug":"([^"]+)"')
        return json_url, debug
    end

    local u1, d1 = get_wp("picsum", true)
    local u2, d2 = get_wp("picsum", true)
    print("  URL1: " .. tostring(u1))
    print("  URL2: " .. tostring(u2))
    print("  DBG1: " .. tostring(d1))
    print("  DBG2: " .. tostring(d2))

    assert(u1 ~= nil, "force refresh returns URL")
    assert(u2 ~= nil, "second force refresh returns URL")
    assert(u1 ~= u2, "URLs should differ (cache-busting ?v= timestamp different each call)")
    assert(d1 and d1:find("fresh", 1, true) ~= nil, "debug shows fresh, not fallback")
    assert(d2 and d2:find("fresh", 1, true) ~= nil, "debug shows fresh, not fallback")

    local u3, d3 = get_wp("picsum", false)
    print("  URL_no_force: " .. tostring(u3))
    print("  DBG_no_force: " .. tostring(d3))
    assert(u3 ~= nil, "returns URL without force")
    assert(u3:find("/cache/wallpaper_picsum", 1, true) ~= nil, "uses local cache path")
end)

-- ============= 运行 =============
print("\n=== Desktop Theme 模板测试 ===\n")

for _, t in ipairs(tests) do
    print("-- " .. t.name)
    t.fn()
    print()
end

print("================================")
print(string.format("结果: %d 通过, %d 失败", passed, failed))

if failed > 0 then
    os.exit(1)
end
