-- Runtime abstraction for luci-theme-desktop.
--
-- 双分支合并计划阶段 1（记忆库 theme-merge-plan）：把 controller 的
-- Lua-track vs ucode-track 平台适配点收敛于此，controller 代码保持
-- runtime 无关。加载路径 /usr/lib/lua/luci/desktop/runtime.lua
-- （与 compat.lua 同目录，两 runtime 共享）。
--
-- 适配点来源：阶段 0 双机矩阵实测（probe/runtime-matrix.js）——
-- cookie 名、apply/revert 机制、uci_changes 内部格式、leaf 策略。
--
-- NOTE: 必须是 module() 风格（与 compat.lua 一致），不能用
-- "local M = {} ... return M" 裸模块风格——253（luci-lua-runtime）的
-- modulecache（ccache）字节码缓存对裸模块执行异常（require 返回 nil，
-- 2026-08-15 实锤：module 风格 compat.lua 正常、裸模块 runtime.lua 在
-- CGI 进程里 require 返回 nil；rm modulecache 后正常）。
module("luci.desktop.runtime", package.seeall)

-- ============ 能力检测（缓存） ============
-- ucode runtime：dispatcher.context.request_path 存在（LuCI 26 ucode
-- dispatcher）；Lua runtime：context 只有 request/path（HANDOVER 首页
-- 判定坑即此差异的实证）。检测基于 runtime 自身 API 形状——合并后
-- 单包双装（两机都有 .ut 模板）依然成立，不能用文件存在性检测。
local _isUcode = nil
function isUcode()
    if _isUcode ~= nil then return _isUcode end
    _isUcode = false
    pcall(function()
        local d = require("luci.dispatcher")
        if d and d.context and d.context.request_path ~= nil then
            _isUcode = true
        end
    end)
    return _isUcode
end

-- Lua track 的会话 cookie 名是 sysauth；ucode track 是 sysauth_http
-- （阶段 0 矩阵：lib.js/deploy-smoke 双路径实锤）。
function cookieName()
    return isUcode() and "sysauth_http" or "sysauth"
end

-- ucode track 的 uci apply 支持 90s rollback 窗口；Lua track（老 uci 包）
-- 的 ubus apply 全部 No response，只能 cursor commit + luci-reload。
function supportsRollback()
    return isUcode()
end

-- ============ uci ============
-- 两 runtime 的 luci.model.uci cursor 用法一致（阶段 0 矩阵：action_save
-- 两分支逐字相同）。
-- ⚠️ 官方 OpenWrt 25.x（2026-08-18 1.1 实锤）：登录 session 的 ubus ACL
-- 没有 uci 写权限 —— luci.model.uci 带着 session 调 ubus uci
-- set/add/commit 返回 Permission denied（err=6），错误被 uci.lua 包装吞掉，
-- 保存"返回成功"但 UCI 从未写入（widgets/pins/settings/mobile_* 全挂，
-- 便笺走文件写入不受影响）。清除 session 后匿名 ubus 调用放行（本地
-- root 语义）——所有 UCI 写操作必须走本函数。
-- 仅当 uci.lua 提供 set_session_id 时清除（26.180+；24.10 的 26.159 没有
-- 该函数，且匿名调用同样放行 —— 253 不受影响）。
function newCursor()
    local c = require("luci.model.uci").cursor()
    if c.set_session_id then
        c:set_session_id(nil)
    end
    return c
end

-- ============ uci_changes 统一行 ============
-- ucode（ubus 后端）：secs = { {type,sec,opt,val}, ... }（数组行）
-- Lua（libuci delta 文件）：secs = { [sec] = {opt=val, ['.type']=...} }（嵌套 dict）
-- 统一输出 {cfg,sec,opt,val,type} 行——与 master 0.1.0-84 的规范化
-- 行为逐字对齐（该版本真机验证过：add/remove/list-add/set 语义 + 排序）。
function getChanges(cursor)
    local rows = {}
    local uci = cursor or newCursor()
    local function add(cfg, sec, opt, val, typ)
        rows[#rows + 1] = { cfg = cfg, sec = sec, opt = opt, val = val, type = typ }
    end
    for cfg, secs in pairs(uci:changes()) do
        -- ucode runtime (ubus backend): secs = { {type,sec,opt,val}, ... }
        if type(next(secs)) == "number" then
            for _, o in ipairs(secs) do
                add(cfg, o[2] or "", o[3] or "", o[4] or "", o[1] or "")
            end
        else
            -- Lua runtime (libuci delta files): secs = { [sec] = {opt=val,...} }
            for sec, opts in pairs(secs) do
                if type(opts) ~= "table" then
                    add(cfg, sec, "", tostring(opts), "set")
                else
                    local stype = opts['.type']
                    if stype and stype ~= "" then
                        add(cfg, sec, "", stype, "add")          -- section added
                    elseif stype == "" then
                        add(cfg, sec, "", "", "remove")          -- section deleted
                    end
                    for opt, v in pairs(opts) do
                        if opt:sub(1, 1) ~= "." then             -- skip .type/.name
                            if type(v) == "table" then
                                for _, item in ipairs(v) do
                                    add(cfg, sec, opt, item, "list-add")
                                end
                            elseif v == "" then
                                add(cfg, sec, opt, "", "remove") -- option deleted
                            else
                                add(cfg, sec, opt, v, "set")
                            end
                        end
                    end
                end
            end
        end
    end
    table.sort(rows, function(a, b)
        if a.cfg == b.cfg then return tostring(a.sec) < tostring(b.sec) end
        return a.cfg < b.cfg
    end)
    return rows
end

-- ============ apply / revert / confirm ============
-- apply：ucode = ubus uci apply（90s rollback + token 注册）；Lua = cursor
-- commit + /sbin/luci-reload（官方 LuCI 流程）。返回 {ok=bool, token=string?}。
function apply(sid)
    if supportsRollback() then
        local json = ubusCli("uci apply '{\"ubus_rpc_session\":\"" .. sid .. "\",\"timeout\":90,\"rollback\":true}'")
        -- ubus CLI prints an error object (non-empty JSON) on failure; a
        -- successful apply prints nothing.
        local jsonc = luci.jsonc or luci.json
        local ok_parse, parsed = pcall(jsonc.parse, json)
        local ok = (json == "" or (ok_parse and type(parsed) ~= "table"))
        if not ok then return { ok = false } end
        -- Register the rollback token (same shape as official uci.uc) so the
        -- confirm endpoint can validate within the 90s window. os.time() keeps
        -- it unique even when math.random isn't seeded per-request.
        local token = string.format("%08x%08x", os.time(), math.random(0x7fffffff))
        ubusCli("session set '{\"ubus_rpc_session\":\"00000000000000000000000000000000\",\"values\":{\"rollback\":{\"token\":\""
            .. token .. "\",\"session\":\"" .. sid .. "\",\"timeout\":" .. (os.time() + 90) .. "}}}'")
        return { ok = true, token = token }
    end
    -- Lua track: commit via cursor, reload services (same primitives as the
    -- official LuCI uci page).
    local uci = newCursor()
    local reload = {}
    for cfg in pairs(uci:changes()) do
        reload[#reload + 1] = cfg
        uci:load(cfg)
        uci:commit(cfg)
        uci:unload(cfg)
    end
    if #reload > 0 then
        os.execute("/sbin/luci-reload " .. table.concat(reload, " ") .. " >/dev/null 2>&1")
    end
    return { ok = true }
end

-- revert：ucode = util.ubus 直调 uci revert（带 session）；Lua = cursor load/revert/unload。
function revert(sid)
    if supportsRollback() then
        -- Use util.ubus directly, NOT the ubus CLI: the CLI's pretty-printed
        -- JSON puts a newline between the array brackets, and Lua patterns
        -- can't span the two "[" reliably — string-scanning that output
        -- silently matched nothing, so revert did nothing while reporting
        -- ok:true (historical lesson, kept verbatim from the ucode track).
        local util = require("luci.util")
        local ret = util.ubus("uci", "changes", { ubus_rpc_session = sid })
        local ok = true
        if type(ret) == "table" and type(ret.changes) == "table" then
            for cfg in pairs(ret.changes) do
                -- Success comes back as a bare nil; a failure carries an
                -- errno in the second return value (ubus_return in luci.util).
                local _, err = util.ubus("uci", "revert", { ubus_rpc_session = sid, config = cfg })
                if err then ok = false end
            end
        end
        return { ok = ok }
    end
    local uci = newCursor()
    local ok = true
    for cfg in pairs(uci:changes()) do
        local r = pcall(function()
            uci:load(cfg)
            uci:revert(cfg)
            uci:unload(cfg)
        end)
        if not r then ok = false end
    end
    return { ok = ok }
end

-- confirm：校验 rollback token 并确认（仅 ucode track 有意义；调用方按
-- supportsRollback() 决定是否调用，Lua 侧不注册 token）。
function confirm(token)
    local raw = ubusCli("session get '{\"ubus_rpc_session\":\"00000000000000000000000000000000\",\"keys\":[\"rollback\"]}'")
    local ok = false
    local rt = raw:match('"token"%s*:%s*"([%x]+)"')
    local rs = raw:match('"session"%s*:%s*"([%x]+)"')
    local rto = raw:match('"timeout"%s*:%s*(%d+)')
    if rt and rt == token and rs and rto and tonumber(rto) > os.time() then
        local out = ubusCli("uci confirm '{\"ubus_rpc_session\":\"" .. rs .. "\"}'")
        ok = (out == "")
        if ok then
            ubusCli("session set '{\"ubus_rpc_session\":\"00000000000000000000000000000000\",\"values\":{\"rollback\":{}}}'")
        end
    end
    return ok
end

-- ============ 工具（两分支逐字相同，统一于此） ============
-- Run a ubus CLI call; returns raw output. Command strings are built
-- from sanitized values only (hex / [%w_]) — see callers.
function ubusCli(args_json)
    local p = io.popen("ubus call " .. args_json .. " 2>&1")
    local out = p and p:read("*a") or ""
    if p then p:close() end
    return out
end

-- Validate the LuCI session cookie: must resolve to a real session with a
-- token (same shape the dispatcher requires for logged-in pages).
function sessionValid(sid)
    if not sid or #sid < 16 then return false end
    local raw = ubusCli("session get '{\"ubus_rpc_session\":\"" .. sid .. "\"}'")
    return raw:find('"token"%s*:%s*"') ~= nil
end
