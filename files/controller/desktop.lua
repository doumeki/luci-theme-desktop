-- Desktop Theme API controller
module("luci.controller.desktop", package.seeall)

-- Runtime abstraction (Lua track vs ucode track): cookie name, apply/revert
-- mechanism, uci_changes format, rollback support — see memory theme-merge-plan.
-- NOTE: required INSIDE each function (require is idempotent via
-- package.loaded), NOT as a module-level local: on 253 (luci-lua-runtime)
-- the modulecache bytecode round-trip made a module-level local come back
-- nil inside the loaded chunk (2026-08-15: Runtime=nil crash at index()).
-- Function-body locals are created per call and are immune to that.
-- (KEEP THE TWO BRANCHES IN SYNC on this pattern.)

-- Shared sticky-note store lives in a plain JSON file (NOT UCI): notes
-- write on every keystroke, and UCI would rewrite the whole desktop
-- config each time (flash wear + quoting pitfalls). Atomic write:
-- tmp file + rename, so a crash never leaves a half-written JSON.
local STICKYSYNC_FILE = "/etc/luci-theme-desktop/stickysync.json"

local function stickysync_write(data)
    local ok = pcall(function()
        local tmp = STICKYSYNC_FILE .. ".tmp"
        local f = io.open(tmp, "w")
        if not f then return end
        f:write(data)
        f:close()
        os.rename(tmp, STICKYSYNC_FILE)
    end)
    return ok
end

function index()
    local Runtime = require "luci.desktop.runtime"
    local page = entry({"admin", "desktop"}, firstchild(), "Desktop", 99)
    page.hidden = true


    -- Unified save endpoint (REFACTOR: replaces save_widgets/save_pins/save_theme/save_hidden)
    local save_api = entry({"admin", "desktop", "save"}, call("action_save"))
    save_api.leaf = true
    save_api.sysauth = false

    local wallpaper_api = entry({"admin", "desktop", "random_wallpaper"}, call("action_random_wallpaper"))
    wallpaper_api.leaf = true
    wallpaper_api.sysauth = false

    local wp_list = entry({"admin", "desktop", "list_wallpapers"}, call("action_list_wallpapers"))
    wp_list.leaf = true
    wp_list.sysauth = false

    local wp_upload = entry({"admin", "desktop", "upload_wallpaper"}, call("action_upload_wallpaper"))
    wp_upload.leaf = true
    wp_upload.sysauth = false

    local wp_delete = entry({"admin", "desktop", "delete_wallpaper"}, call("action_delete_wallpaper"))
    wp_delete.leaf = true
    wp_delete.sysauth = false

    local wp_save = entry({"admin", "desktop", "save_to_builtin"}, call("action_save_to_builtin"))
    wp_save.leaf = true
    wp_save.sysauth = false

    local wp_check = entry({"admin", "desktop", "check_saved"}, call("action_check_saved"))
    wp_check.leaf = true
    wp_check.sysauth = false

    local wp_confirm = entry({"admin", "desktop", "confirm_wallpaper"}, call("action_confirm_wallpaper"))
    wp_confirm.leaf = true
    wp_confirm.sysauth = false

    local log_api = entry({"admin", "desktop", "log"}, call("action_log"))
    log_api.leaf = true
    log_api.sysauth = false

    -- Terminal one-click install (installable shortcut, 2026-08-16):
    -- POST install_ttyd starts a background apk/opkg install of ttyd +
    -- luci-app-ttyd; GET ttyd_status reports whether ttyd is now present.
    -- BOTH REQUIRE a valid session (root-level package management).
    local inst_api = entry({"admin", "desktop", "install_ttyd"}, call("action_install_ttyd"))
    inst_api.leaf = true
    inst_api.sysauth = false

    local ttyd_st = entry({"admin", "desktop", "ttyd_status"}, call("action_ttyd_status"))
    ttyd_st.leaf = true
    ttyd_st.sysauth = false

    local uci_changes_api = entry({"admin", "desktop", "uci_changes"}, call("action_uci_changes"))
    uci_changes_api.leaf = true
    uci_changes_api.sysauth = false

    -- Unsaved-changes viewer (tray notification → window) + server-side
    -- apply/confirm/revert. Self-contained HTML page, no LuCI framework.
    -- leaf=true only on the ucode track: the Lua runtime dispatcher breaks at
    -- the first leaf node and would shadow the apply/confirm/revert children
    -- (ucode runtime descends into children first — see Runtime.isUcode).
    local changes_page = entry({"admin", "desktop", "changes"}, call("action_changes"))
    if Runtime.isUcode() then changes_page.leaf = true end
    changes_page.sysauth = false

    local changes_apply = entry({"admin", "desktop", "changes", "apply"}, call("action_changes_apply"))
    changes_apply.leaf = true
    changes_apply.sysauth = false

    local changes_confirm = entry({"admin", "desktop", "changes", "confirm"}, call("action_changes_confirm"))
    changes_confirm.leaf = true
    changes_confirm.sysauth = false

    local changes_revert = entry({"admin", "desktop", "changes", "revert"}, call("action_changes_revert"))
    changes_revert.leaf = true
    changes_revert.sysauth = false

    -- Widget data endpoints (modern LuCI dropped luci.rpc/jsonrpc; these
    -- are version-agnostic sources for the system-info / net-traffic widgets)
    local sys_status = entry({"admin", "desktop", "system_status"}, call("action_system_status"))
    sys_status.leaf = true
    sys_status.sysauth = false

    local ifaces_api = entry({"admin", "desktop", "interfaces"}, call("action_interfaces"))
    ifaces_api.leaf = true
    ifaces_api.sysauth = false

    local bw_api = entry({"admin", "desktop", "bandwidth"}, call("action_bandwidth"))
    bw_api.leaf = true
    bw_api.sysauth = false

    local platform_api = entry({"admin", "desktop", "platform"}, call("action_platform"))
    platform_api.leaf = true
    platform_api.sysauth = false

    -- Bug-report diagnostics: one URL, paste the output into an issue.
    local diag_api = entry({"admin", "desktop", "diagnostics"}, call("action_diagnostics"))
    diag_api.leaf = true
    diag_api.sysauth = false
end

-- Status for the desktop tray: uncommitted UCI changes count + root password state.
-- Also carries the full delta list so the changes window can render from a
-- cookie-authenticated request. The window page itself is served into an
-- iframe whose request carries no cookie in Firefox (cookie partitioning),
-- so server-side rendering there sees only the anonymous session's delta —
-- which is a different view than the tray's. Rendering from this endpoint
-- keeps the window's count, list and revert target identical to the tray's.
local function json_escape(s)
    s = tostring(s or "")
    return s:gsub("\\", "\\\\"):gsub('"', '\\"'):gsub("\n", "\\n"):gsub("\r", "\\r"):gsub("\t", "\\t")
end
function action_uci_changes()
    local Runtime = require "luci.desktop.runtime"
    local rows = Runtime.getChanges()
    local count = #rows

    local no_password = false
    pcall(function()
        local sys = require "luci.sys"
        if sys.process.info("uid") == 0 and sys.user.getuser("root")
           and not sys.user.getpasswd("root") then
            no_password = true
        end
    end)

    luci.http.prepare_content("application/json")
    local parts = {}
    for _, e in ipairs(rows) do
        parts[#parts + 1] = '{"cfg":"' .. json_escape(e.cfg) .. '","sec":"' .. json_escape(e.sec)
            .. '","opt":"' .. json_escape(e.opt) .. '","val":"' .. json_escape(e.val)
            .. '","type":"' .. json_escape(e.type) .. '"}'
    end
    luci.http.write('{"count":' .. count .. ',"no_password":' .. (no_password and "true" or "false")
        .. ',"list":[' .. table.concat(parts, ",") .. ']}')
end

-- Widget data: CPU/memory/temperature/uptime for the system-info widget.
-- Version-agnostic: reads /proc directly instead of depending on a LuCI
-- release's status API shape. CPU% math mirrors the stock overview page.
function action_system_status()
    luci.http.prepare_content("application/json")
    local sys = require "luci.sys"

    -- CPU usage: 100 − idle% from busybox top (same as luci-mod-admin-full).
    -- sys.exec keeps the trailing newline — strip it or textContent-based
    -- widgets would render "5\n%" on two lines.
    local cpu_usage = ((sys.exec("expr 100 - $(top -n 1 | grep -E '^CPU:' | awk -F '%' '{print$4}' | awk -F ' ' '{print$2}' | awk '{print int($1 + 0.5)}')") or "6"):gsub("%s+", "")) .. "%"

    -- Load average: first three fields of /proc/loadavg
    local loadavg = { 0, 0, 0 }
    local la = sys.exec("head -n1 /proc/loadavg")
    if la then
        local i = 1
        for v in la:gmatch("%S+") do
            if i > 3 then break end
            loadavg[i] = tonumber(v) or 0
            i = i + 1
        end
    end

    -- Memory (kB → bytes). The widget computes used = total − `available`
    -- (real allocatable memory: free + reclaimable page cache) — NOT
    -- `free`, which ignores the cache and would over-report usage.
    local memtotal, memfree, memavail = 0, 0, 0
    for line in io.lines("/proc/meminfo") do
        local k, v = line:match("^(%w+):%s*(%d+) kB")
        if k == "MemTotal" then memtotal = v * 1024
        elseif k == "MemFree" then memfree = v * 1024
        elseif k == "MemAvailable" then memavail = v * 1024 end
    end

    -- Physical memory: SMBIOS (dmidecode -t 17) reports the firmware's
    -- declared DIMM sizes — the only source that reads the stickered
    -- total (16G here, where MemTotal is ~15.3G: kernel image, page
    -- tables, BIOS/firmware reserved ranges never appear in meminfo).
    -- dmidecode is not a base package → fall back to the /proc/iomem
    -- System RAM sum (what the kernel actually maps as RAM), then
    -- MemTotal. Cached in /tmp — this handler runs on a 3s poll.
    local physmem = 0
    local function load_physical_memory()
        local f = io.open("/tmp/desktop_phys_mem", "r")
        if f then
            local v = f:read("*n"); f:close()
            if v and v > 0 then return v end
        end
        local p = io.popen("dmidecode -t 17 2>/dev/null")
        if p then
            for line in p:lines() do
                -- NOTE: Lua patterns have no alternation — [MG]B, not (MB|GB)
                local sz, unit = line:match("^%s*Size:%s*(%d+)%s*([MG]B)")
                if sz then
                    if unit == "GB" then sz = sz * 1024 end
                    physmem = physmem + sz * 1024 * 1024
                end
            end
            p:close()
        end
        if physmem <= 0 then
            for line in io.lines("/proc/iomem") do
                local lo, hi = line:match("^%s*(%x+)-(%x+).*System RAM")
                if lo then
                    physmem = physmem + tonumber("0x" .. hi) - tonumber("0x" .. lo) + 1
                end
            end
        end
        if physmem <= 0 then physmem = memtotal end
        local w = io.open("/tmp/desktop_phys_mem", "w")
        if w then w:write(physmem); w:close() end
        return physmem
    end
    physmem = load_physical_memory()

    -- Temperature: first readable thermal zone (x86 often only has one)
    local thermal = {}
    for i = 0, 9 do
        local fp = io.open("/sys/class/thermal/thermal_zone" .. i .. "/temp")
        if fp then
            local raw = fp:read("*l")
            fp:close()
            local t = raw and tonumber(raw)
            if t then
                thermal[1] = { temp = string.format("%.1f", t / 1000) .. "°C" }
                break
            end
        end
    end

    luci.http.write_json({
        cpuusage = cpu_usage,
        loadavg  = loadavg,
        memory   = { total = memtotal, free = memfree, available = memavail, physical = physmem },
        thermal  = thermal,
        uptime   = sys.uptime() or 0
    })
end

-- Widget data: real interface names for the net-traffic interface picker.
function action_interfaces()
    luci.http.prepare_content("application/json")
    local ifaces = {}
    for line in io.lines("/proc/net/dev") do
        local name = line:match("^%s*([%w%.%-]+):")
        if name and name ~= "lo" then ifaces[#ifaces + 1] = name end
    end
    luci.http.write_json(ifaces)
end

-- Widget data: cumulative rx/tx bytes per interface, straight from
-- /proc/net/dev. The widget diffs two samples for the rate — no nlbwmon
-- needed (the device may not have it installed).
-- /proc/net/dev row layout: "name: rx_bytes rx_pkts errs drop fifo frame
-- compressed multicast tx_bytes tx_pkts ..." — rx_bytes is field 1 and
-- tx_bytes field 9 of the numeric list.
-- Each entry also carries `phy`: whether the iface is a physical NIC
-- (/sys/class/net/<iface>/device exists — dummy0/docker0/bridges lack it).
-- The widget prefers physical NICs without hardcoding any names.
function action_bandwidth()
    luci.http.prepare_content("application/json")
    local out = {}
    for line in io.lines("/proc/net/dev") do
        local name = line:match("^%s*([%w%.%-]+):")
        if name then
            local rest = line:match("^%s*[%w%.%-]+:%s*(.*)$")
            local nums = {}
            if rest then
                for v in rest:gmatch("%d+") do nums[#nums + 1] = tonumber(v) end
            end
            if nums[1] and nums[9] then
                local f = io.open("/sys/class/net/" .. name .. "/device")
                local phy = f ~= nil
                if f then f:close() end
                out[name] = { rx = nums[1], tx = nums[9], phy = phy }
            end
        end
    end
    luci.http.write_json(out)
end

-- One-line environment summary for the save audit log (failure context).
local function env_brief()
    pcall(function()
        local Runtime = require "luci.desktop.runtime"
        local sys = require "luci.sys"
        local rel = (sys.exec("grep DISTRIB_DESCRIPTION /etc/openwrt_release 2>/dev/null") or ""):gsub("[%s']", "")
        local ver = (sys.exec("cat /www/luci-static/desktop/version.txt 2>/dev/null") or ""):gsub("%s+", "")
        return (Runtime.isUcode() and "ucode" or "lua") .. " | " .. rel .. " | theme " .. ver
    end)
    return "?"
end

-- Full diagnostics for bug reports (GET /admin/desktop/diagnostics).
-- Small, read-only, no sensitive data (no IPs, no credentials) — paste the
-- output straight into a GitHub issue.
function action_diagnostics()
    local out = {}
    local function add(k, v)
        out[#out + 1] = k .. ": " .. tostring(v or "(none)")
    end
    pcall(function()
        local f = io.open("/etc/openwrt_release", "r")
        if f then
            for line in f:lines() do
                local k, v = line:match("^([A-Z_]+)='(.*)'$")
                if k and v then out[#out + 1] = k .. "=" .. v end
            end
            f:close()
        end
    end)
    pcall(function()
        local Runtime = require "luci.desktop.runtime"
        local sys = require "luci.sys"
        add("arch", (sys.exec("uname -m") or ""):gsub("%s+", ""))
        add("kernel", (sys.exec("uname -r") or ""):gsub("%s+", ""))
        add("luci_runtime", Runtime.isUcode() and "ucode" or "lua")
        add("theme_version", (sys.exec("cat /www/luci-static/desktop/version.txt 2>/dev/null") or ""):gsub("%s+", ""))
        add("uci_set_session_id", (sys.exec("grep -c set_session_id /usr/lib/lua/luci/model/uci.lua 2>/dev/null") or ""):gsub("%s+", ""))
        add("desktop_config_version", (sys.exec("uci get desktop.settings.config_version 2>/dev/null") or ""):gsub("%s+", ""))
    end)
    pcall(function()
        local f = io.open("/var/log/desktop-save.log", "r")
        if f then
            local lines = {}
            for line in f:lines() do
                lines[#lines + 1] = line
                if #lines > 5 then table.remove(lines, 1) end
            end
            f:close()
            if #lines > 0 then
                out[#out + 1] = "save_log_tail:"
                for _, l in ipairs(lines) do out[#out + 1] = "  " .. l end
            end
        end
    end)
    out[#out + 1] = "generated: " .. os.date("%Y-%m-%d %H:%M:%S")
    -- not persisted to disk: the output already includes the save-log tail,
    -- and the full audit log is available at /var/log/desktop-save.log
    luci.http.prepare_content("text/plain; charset=utf-8")
    luci.http.write(table.concat(out, "\n"))
end

function action_save()
    local section = luci.http.formvalue("section") or ""
    local data    = luci.http.formvalue("data") or ""
    local uci     = require("luci.desktop.runtime").newCursor()

    -- Save audit log + write-back verification. 2026-08-18: on official
    -- OpenWrt 25.x the ubus session ACL silently denied uci writes
    -- (Permission denied swallowed by uci.lua) — saves "succeeded" but UCI
    -- was never touched. Every save now checks each set/commit result and
    -- READS BACK the stored value; failures are logged to
    -- /var/log/desktop-save.log and returned as {"ok":false} instead of
    -- pretending success.
    local function slog(msg, level)
        pcall(function()
            local f = io.open("/var/log/desktop-save.log", "a")
            if f then
                -- rotate: keep the file bounded (a few hundred KB max)
                local sz = f:seek("end")
                if sz and sz > 262144 then
                    f:close()
                    os.remove("/var/log/desktop-save.log")
                    f = io.open("/var/log/desktop-save.log", "a")
                end
                if f then
                    f:write(os.date("%Y-%m-%d %H:%M:%S") .. " [" .. (level or "info") .. "] " .. msg .. "\n")
                    f:close()
                end
            end
        end)
    end

    local ok = true
    local failmsg = nil
    local function check(okv, errv, what)
        if ok and not okv then
            ok = false
            failmsg = tostring(errv or what)
            slog(what .. " FAILED: " .. tostring(errv), "error")
        end
    end

    local set_keys = {}
    if section == "settings" then
        local okv, vals = pcall(luci.jsonc and luci.jsonc.parse or luci.json.parse, data)
        if okv and type(vals) == "table" then
            for k, v in pairs(vals) do
                check(uci:set("desktop", "settings", k, v), nil, "settings." .. k)
                set_keys[#set_keys + 1] = k
            end
        else
            check(false, "settings json parse failed", "settings.parse")
        end
    elseif section == "widgets" then
        if not uci:get("desktop", "widgets") then
            check(uci:set("desktop", "widgets", "widgets"), nil, "widgets.section")
        end
        check(uci:set("desktop", "widgets", "config", data), nil, "widgets.config")
    elseif section == "pins" then
        if not uci:get("desktop", "pins") then
            check(uci:set("desktop", "pins", "pins"), nil, "pins.section")
        end
        check(uci:set("desktop", "pins", "items", data), nil, "pins.items")
    elseif section == "hidden" then
        if not uci:get("desktop", "hidden") then
            check(uci:set("desktop", "hidden", "hidden"), nil, "hidden.section")
        end
        check(uci:set("desktop", "hidden", "items", data), nil, "hidden.items")
    elseif section == "mobile_widgets" then
        if not uci:get("desktop", "mobile_widgets") then
            check(uci:set("desktop", "mobile_widgets", "mobile_widgets"), nil, "mobile_widgets.section")
        end
        check(uci:set("desktop", "mobile_widgets", "config", data), nil, "mobile_widgets.config")
    elseif section == "mobile_pins" then
        if not uci:get("desktop", "mobile_pins") then
            check(uci:set("desktop", "mobile_pins", "mobile_pins"), nil, "mobile_pins.section")
        end
        check(uci:set("desktop", "mobile_pins", "items", data), nil, "mobile_pins.items")
    elseif section == "stickysync" then
        check(stickysync_write(data), "stickysync write", "stickysync")
    else
        check(false, "unknown section " .. section, "section")
    end

    if ok and section ~= "stickysync" then
        check(uci:commit("desktop"), nil, "commit")
        -- read-back: the write only counts when the value is actually there
        if ok then
            if section == "settings" then
                for i = 1, #set_keys do
                    local back = uci:get("desktop", "settings", set_keys[i])
                    if back == nil then
                        ok = false
                        failmsg = "readback settings." .. set_keys[i]
                        slog("READBACK FAIL settings." .. set_keys[i] .. " -> nil", "error")
                    end
                end
            else
                local opt = (section == "widgets" or section == "mobile_widgets") and "config" or "items"
                local back = uci:get("desktop", section, opt)
                if back ~= data then
                    ok = false
                    failmsg = "readback mismatch"
                    slog("READBACK FAIL " .. section .. "." .. opt .. " got=[" .. tostring(back) .. "]", "error")
                end
            end
        end
    end

    if ok then
        slog("OK section=" .. section .. " len=" .. #data)
    else
        slog("ENV " .. tostring(env_brief()), "error")
    end

    luci.http.prepare_content("application/json")
    if ok then
        luci.http.write('{"ok":true}')
    else
        luci.http.write('{"ok":false,"msg":"' .. tostring(failmsg or "save failed") .. '"}')
    end
end

-- Write timestamped line to UI log file
local function server_log(msg)
    pcall(function()
        local fp = io.open("/var/log/desktop-ui.log", "a")
        if fp then
            fp:write(os.date("%Y-%m-%d %H:%M:%S") .. " [server] " .. msg .. "\n")
            fp:close()
        end
    end)
end

function action_random_wallpaper()
    local mode    = luci.http.formvalue("mode") or "builtin"
    local force   = luci.http.formvalue("force") or ""
    -- preview=1: download to cache only, do NOT touch the confirmed
    -- desktop baseline (_desktop.jpg) — the settings panel preview
    -- must not change the desktop until the user applies it.
    local preview = luci.http.formvalue("preview") or ""
    local fs    = require "nixio.fs"
    local CACHE_DIR  = "/www/luci-static/desktop/cache/"
    local CACHE_TTL  = 0      -- no cache, always fetch fresh
    local log = {}

    -- === bing / picsum: check disk cache first ===
    if mode == "bing" or mode == "picsum" then
        local dst = CACHE_DIR .. "wallpaper_" .. mode .. ".jpg"
        local st  = fs.stat(dst)
        local age = st and (os.time() - st.mtime) or nil

        log[#log + 1] = "mode=" .. mode
        log[#log + 1] = "force=" .. tostring(force ~= "")
        log[#log + 1] = "cache=" .. tostring(st ~= nil and ("yes age=" .. (age or "?") .. "s") or "no")

        -- Current desktop wallpaper from UCI
        local uci = require("luci.desktop.runtime").newCursor()
        local cur_mode = uci:get("desktop", "settings", "desktop_wallpaper") or "gradient"
        log[#log + 1] = "uci_desktop_wp=" .. cur_mode

        -- Cache is fresh and not forced: return directly — NO download
        if st and age and age < CACHE_TTL and force ~= "1" then
            local cache_url = "/luci-static/desktop/cache/wallpaper_" .. mode .. ".jpg?v=" .. os.time()
            server_log("random_wallpaper mode=" .. mode .. " action=cache_hit age=" .. age .. "s")
            log[#log + 1] = "action=cache_hit"
            log[#log + 1] = "url=" .. cache_url
            luci.http.prepare_content("application/json")
            luci.http.write('{"url":"' .. cache_url .. '","cached":true,"debug":"' .. table.concat(log, " | ") .. '"}')
            return
        end

        -- Need to download
        log[#log + 1] = "action=download"
        if force == "1" then
            log[#log + 1] = "reason=forced"
            server_log("random_wallpaper mode=" .. mode .. " action=download reason=forced age=" .. (age or 0) .. "s")
        elseif not st then
            log[#log + 1] = "reason=no_cache"
            server_log("random_wallpaper mode=" .. mode .. " action=download reason=no_cache")
        else
            log[#log + 1] = "reason=stale age=" .. (age or "?") .. "s"
            server_log("random_wallpaper mode=" .. mode .. " action=download reason=stale age=" .. (age or 0) .. "s")
        end

        -- Get remote URL
        if force == "1" then
            os.execute("rm -f /var/run/desktop_" .. mode .. ".url 2>/dev/null")
            os.execute("rm -f /var/run/desktop_" .. mode .. ".ts 2>/dev/null")
        end
        local p = io.popen("/usr/libexec/desktop/online_wallpaper " .. mode)
        local remote_url = nil
        if p then
            remote_url = p:read("*a"):gsub("%s+", "")
            p:close()
        end
        log[#log + 1] = "remote=" .. (remote_url ~= "" and remote_url or "empty")
        server_log("random_wallpaper mode=" .. mode .. " remote=" .. (remote_url ~= "" and remote_url:sub(1,80) or "empty"))

        -- Download to cache
        if remote_url and remote_url ~= "" then
            os.execute("mkdir -p " .. CACHE_DIR .. " 2>/dev/null")
            local tmp = CACHE_DIR .. "wallpaper_" .. mode .. "_" .. tostring(os.time()) .. ".jpg.tmp"
            local ret = os.execute("/usr/bin/curl -fksL --max-time 15 -o " .. tmp .. " '" .. remote_url .. "' 2>/dev/null")
            server_log("random_wallpaper mode=" .. mode .. " curl_exit=" .. tostring(ret) .. " remote=" .. remote_url:sub(1,80))
            if ret == 0 then
                os.execute("/bin/mv " .. tmp .. " " .. dst .. " 2>/dev/null")
                -- Keep _desktop.jpg in sync so the settings preview and F5
                -- show the wallpaper currently on the desktop (same as confirm_wallpaper).
                -- preview=1 skips this: the confirmed desktop baseline must
                -- only change when the user applies (confirm_wallpaper).
                if preview ~= "1" then
                    os.execute("/bin/cp " .. dst .. " " .. CACHE_DIR .. "wallpaper_" .. mode .. "_desktop.jpg 2>/dev/null")
                end
                local cache_url = "/luci-static/desktop/cache/wallpaper_" .. mode .. ".jpg?v=" .. os.time()
                log[#log + 1] = "download=ok"
                log[#log + 1] = "url=" .. cache_url
                luci.http.prepare_content("application/json")
                luci.http.write('{"url":"' .. cache_url .. '","debug":"' .. table.concat(log, " | ") .. '"}')
                return
            else
                os.execute("rm -f " .. tmp .. " 2>/dev/null")
                log[#log + 1] = "download=fail curl_exit=" .. tostring(ret)
                server_log("random_wallpaper mode=" .. mode .. " action=download_fail curl_exit=" .. tostring(ret))
            end
        end

        -- Fallback: return existing preview file (even if stale) or default
        local f = io.open(dst, "r")
        if f then
            f:close()
            local cache_url = "/luci-static/desktop/cache/wallpaper_" .. mode .. ".jpg"
            log[#log + 1] = "fallback=existing_cache"
            log[#log + 1] = "url=" .. cache_url
            server_log("random_wallpaper mode=" .. mode .. " fallback=existing_cache url=" .. cache_url)
            luci.http.prepare_content("application/json")
            luci.http.write('{"url":"' .. cache_url .. '","debug":"' .. table.concat(log, " | ") .. '"}')
            return
        end
        local fallback = "/luci-static/desktop/img/bg1.jpg"
        log[#log + 1] = "fallback=default"
        log[#log + 1] = "url=" .. fallback
        server_log("random_wallpaper mode=" .. mode .. " fallback=default bg1")
        luci.http.prepare_content("application/json")
        luci.http.write('{"url":"' .. fallback .. '","debug":"' .. table.concat(log, " | ") .. '"}')
        return
    end

    -- === builtin: pick random from background dir ===
    local bg_dir = "/www/luci-static/desktop/background/"
    local imgs = {}
    local iter = fs.glob(bg_dir .. "*")
    if iter then
        while true do
            local f = iter()
            if not f then break end
            local bn = fs.basename(f)
            if bn then
                local ext = bn:match("%.([%w]+)$")
                if ext and (ext == "jpg" or ext == "jpeg" or ext == "png" or ext == "gif" or ext == "webp") then
                    imgs[#imgs + 1] = "/luci-static/desktop/background/" .. bn
                end
            end
        end
    end
    local url = "/luci-static/desktop/img/bg1.jpg"
    if #imgs > 0 then
        local idx = nil
        local f = io.open("/dev/urandom", "rb")
        if f then
            local b1, b2 = string.byte(f:read(2), 1, 2)
            f:close()
            if b1 and b2 then idx = ((b1 * 256 + b2) % #imgs) + 1 end
        end
        if not idx then
            math.randomseed(os.time())
            math.random(); math.random(); math.random()
            idx = math.random(#imgs)
        end
        url = imgs[idx]
    end
    log[#log + 1] = "mode=builtin"
    log[#log + 1] = "url=" .. url
    luci.http.prepare_content("application/json")
    luci.http.write('{"url":"' .. url .. '","debug":"' .. table.concat(log, " | ") .. '"}')
end

function action_list_wallpapers()
    local fs   = require "nixio.fs"
    local bg_dir = "/www/luci-static/desktop/background/"
    local files = {}

    pcall(function()
        local iter = fs.glob(bg_dir .. "*")
        if iter then
            while true do
                local f = iter()
                if not f then break end
                local name = fs.basename(f)
                if name then
                    local ext = name:match("%.([%w]+)$")
                    if ext and (ext == "jpg" or ext == "jpeg" or ext == "png" or ext == "gif" or ext == "webp") then
                        local stat = fs.stat(f)
                        files[#files + 1] = {
                            name = name,
                            size = stat and stat.size or 0,
                            url = "/luci-static/desktop/background/" .. name
                        }
                    end
                end
            end
        end
    end)
    table.sort(files, function(a, b) return a.name < b.name end)
    local r = '{"files":['
    for i, f in ipairs(files) do
        if i > 1 then r = r .. ',' end
        r = r .. '{"name":"' .. f.name .. '","size":' .. f.size .. ',"url":"' .. f.url .. '"}'
    end
    r = r .. ']}'
    luci.http.prepare_content("application/json")
    luci.http.write(r)
end

function action_upload_wallpaper()
    local bg_dir = "/www/luci-static/desktop/background/"
    local file_name = nil
    local file_data = {}

    luci.http.setfilehandler(function(meta, chunk, eof)
        if meta and meta.file then
            file_name = meta.file:gsub("[\\/]",""):gsub("[^%w%.%-_]", "_"):gsub("%.%.+","."):gsub("^%.","")
            if file_name == "" then file_name = "upload.jpg" end
        end
        if chunk then
            table.insert(file_data, chunk)
        end
        if eof then
            local name = file_name or "upload.jpg"
            local raw = table.concat(file_data)
            if #raw > 0 then
                local fp = io.open(bg_dir .. name, "wb")
                if fp then fp:write(raw); fp:close() end
            end
        end
    end)

    -- Trigger parsing by reading the form (LuCI auto-parses on formvalue call)
    luci.http.formvalue("file")

    luci.http.prepare_content("application/json")
    if file_name then
        luci.http.write('{"ok":true,"msg":"' .. file_name .. '"}')
    else
        luci.http.write('{"ok":false,"msg":"No file"}')
    end
end

function action_delete_wallpaper()
    local fs = require "nixio.fs"
    local name = luci.http.formvalue("name") or ""
    -- Only allow deleting from background dir, no path traversal
    name = name:gsub("[\\/]","")
    if name ~= "" then
        local fp = "/www/luci-static/desktop/background/" .. name
        if fs.access(fp) then
            os.remove(fp)
        end
    end
    luci.http.prepare_content("application/json")
    luci.http.write('{"ok":true}')
end

-- findmd5: check if file exists in search_dir by size + md5
-- Returns matching basename (without path) if found, nil otherwise
local function findmd5(file_path, search_dir)
    local st = require("nixio.fs").stat(file_path)
    if not st or st.size <= 0 then return nil end
    local pipe = io.popen(
        "src_md5=$(md5sum " .. file_path .. " | cut -d' ' -f1); " ..
        "for f in $(find " .. search_dir .. " -maxdepth 1 -name '*.jpg' -size " .. st.size .. "c 2>/dev/null); do " ..
        "  if [ \"$(md5sum \"$f\" | cut -d' ' -f1)\" = \"$src_md5\" ]; then basename \"$f\"; break; fi; " ..
        "done 2>/dev/null")
    if pipe then
        local name = pipe:read("*a"):gsub("%s+","")
        pipe:close()
        if name ~= "" then return name end
    end
    return nil
end

function action_save_to_builtin()
    local mode = luci.http.formvalue("mode") or ""
    local cache_file = "/www/luci-static/desktop/cache/wallpaper_" .. mode .. ".jpg"
    local bg_dir = "/www/luci-static/desktop/background/"

    os.execute("mkdir -p " .. bg_dir .. " 2>/dev/null")

    local ok = false
    local msg = ""
    local existing_name = nil
    local dst_name = nil
    local f = io.open(cache_file, "r")
    if not f then
        msg = "No cached image for " .. mode
        server_log("save_to_builtin mode=" .. mode .. " error=no_cache")
    else
        f:close()
        existing_name = findmd5(cache_file, bg_dir)

        if existing_name then
            ok = true
            msg = existing_name .. " (already exists)"
            server_log("save_to_builtin mode=" .. mode .. " action=dup name=" .. existing_name)
        else
            local ts = os.date("%Y%m%d_%H%M%S") .. "_" .. math.random(1000,9999)
            dst_name = mode .. "_" .. ts .. ".jpg"
            local dst_file = bg_dir .. dst_name
            local ret = os.execute("/bin/cp " .. cache_file .. " " .. dst_file .. " 2>/dev/null")
            if ret == 0 then
                ok = true
                msg = dst_name
                server_log("save_to_builtin mode=" .. mode .. " action=saved name=" .. dst_name)
            else
                msg = "Copy failed"
                server_log("save_to_builtin mode=" .. mode .. " action=copy_fail")
            end
        end
    end

    luci.http.prepare_content("application/json")
    if ok then
        if existing_name then
            luci.http.write('{"ok":true,"name":"' .. existing_name .. '","url":"/luci-static/desktop/background/' .. existing_name .. '","dup":true}')
        else
            luci.http.write('{"ok":true,"name":"' .. dst_name .. '","url":"/luci-static/desktop/background/' .. dst_name .. '"}')
        end
    else
        luci.http.write('{"ok":false,"msg":"' .. msg .. '"}')
    end
end

-- Lightweight check: is the current cache image already saved to builtin?
function action_check_saved()
    local mode = luci.http.formvalue("mode") or ""
    local file = luci.http.formvalue("file") or ""
    -- Use specified file if provided, otherwise fall back to cache file
    local check_file
    if file ~= "" then
        check_file = "/www/luci-static/desktop/cache/" .. file
    else
        check_file = "/www/luci-static/desktop/cache/wallpaper_" .. mode .. ".jpg"
    end
    local bg_dir = "/www/luci-static/desktop/background/"
    local saved = false
    local name = findmd5(check_file, bg_dir) or ""
    if name ~= "" then saved = true end

    luci.http.prepare_content("application/json")
    luci.http.write('{"saved":' .. (saved and 'true' or 'false') .. ',"name":"' .. name .. '"}')
    server_log("check_saved mode=" .. mode .. " saved=" .. tostring(saved) .. " name=" .. name)
end

-- Confirm desktop wallpaper: copy cache to a separate desktop file
-- so Refresh can update cache without changing the confirmed desktop.
function action_confirm_wallpaper()
    local mode = luci.http.formvalue("mode") or ""
    local cache = "/www/luci-static/desktop/cache/wallpaper_" .. mode .. ".jpg"
    local desktop = "/www/luci-static/desktop/cache/wallpaper_" .. mode .. "_desktop.jpg"
    local ret = os.execute("/bin/cp " .. cache .. " " .. desktop .. " 2>/dev/null")
    server_log("confirm_wallpaper mode=" .. mode .. " ok=" .. tostring(ret == 0))
    luci.http.prepare_content("application/json")
    luci.http.write('{"ok":' .. (ret == 0 and 'true' or 'false') .. '}')
end

-- Fire-and-forget UI log (boot diagnostics → /var/log/desktop-ui.log)
function action_log()
    local lines = luci.http.formvalue("lines") or ""
    local logfile = "/var/log/desktop-ui.log"
    if lines ~= "" then
        local fp = io.open(logfile, "a")
        if fp then
            fp:write(lines)
            fp:close()
        end
    end
    luci.http.prepare_content("application/json")
    luci.http.write('{"ok":true}')
end

-- Platform probe: binary availability + thermal zones + top format + version.
-- The frontend alerts on degraded dependencies and logs the picture once per
-- session (theme-compat-doc Part A，记忆库，见 HANDOVER §0).
function action_platform()
    local Runtime = require "luci.desktop.runtime"
    luci.http.prepare_content("application/json")
    local sys = require "luci.sys"
    local info = {}

    info.arch = (sys.exec("uname -m") or "unknown"):gsub("%s+", "")

    -- Binary availability: curl for online wallpapers, dmidecode for the
    -- sticker RAM total. Both optional (fallbacks exist) — reported so the
    -- frontend can tell the user what degraded.
    local function has_bin(name)
        local p = io.popen("command -v " .. name .. " >/dev/null 2>&1 && echo yes || echo no")
        local ok = p and (p:read("*l") or "") == "yes"
        if p then p:close() end
        return ok
    end
    info.dmidecode = has_bin("dmidecode")
    info.curl = has_bin("curl")

    -- Thermal zones (0 = no readable temp; common on x86 desktops)
    local zones = 0
    for i = 0, 9 do
        local fp = io.open("/sys/class/thermal/thermal_zone" .. i .. "/temp")
        if fp then zones = zones + 1; fp:close() end
    end
    info.thermal_zones = zones

    -- CPU% pipeline (action_system_status) depends on busybox top emitting
    -- a '^CPU:' line containing a number — verify the format survived this
    -- build's busybox config (it varies per target).
    local top_line = sys.exec("top -n 1 2>/dev/null | grep -E '^CPU:' | head -1") or ""
    info.top_cpu_ok = top_line:find("%d") ~= nil

    -- Installed version (postinst writes version.txt)
    local vf = io.open("/www/luci-static/desktop/version.txt", "r")
    info.version = vf and vf:read("*l") or "unknown"
    if vf then vf:close() end

    -- LuCI runtime identity (Runtime.isUcode — abstraction layer probe;
    -- also lets the frontend/platform log tell the tracks apart).
    info.runtime = Runtime.isUcode() and "ucode" or "lua"

    luci.http.write_json(info)
end

-- ===========================================================================
-- Unsaved-changes viewer + apply/confirm/revert
--
-- LuCI 26 removed the /admin/uci/changes page and the official modal needs
-- a live LuCI page to open in — invisible when no app window is focused.
-- The tray notification therefore opens THIS standalone page (no LuCI
-- framework, fully self-contained) and all mutations run server-side here
-- (the page has no token to offer, and the official endpoints need one).
-- The apply flow mirrors official uci.uc: uci apply with a 90s rollback
-- window, then the page confirms within ~1.2s; if the device goes
-- unreachable (e.g. IP change) the confirm fails and uci rolls back.
--
-- SECURITY: mutations require a VALID LuCI session — apply/revert/confirm
-- verify the sysauth_http cookie via ubus session get and reject anything
-- else. All values interpolated into shell commands are sanitized: sid is
-- stripped to hex only, config names to [%w_], tokens to hex.
-- ===========================================================================

local function changes_escape(s)
    s = tostring(s or "")
    s = s:gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;"):gsub('"', "&quot;")
    return s
end

-- The row/group HTML previously rendered here is now produced client-side in
-- action_changes' page JS (rowHtml), fed by action_uci_changes' "list" field
-- — see the comment there about iframe cookie partitioning.

-- ubus_cli / session_valid moved to luci.desktop.runtime (Runtime.ubusCli /
-- Runtime.sessionValid) — identical on both tracks, single source now.

-- GET /admin/desktop/changes — standalone HTML page listing pending changes
function action_changes()
    local i18n = require("luci.i18n")
    local t = function(k) return i18n.translate(k) end

    local uci = require("luci.desktop.runtime").newCursor()
    local page_lang = uci:get("luci", "main", "lang") or "en"
    -- The entry list is NOT rendered server-side: the iframe request carries
    -- no cookie under Firefox cookie partitioning, so uci:changes() here only
    -- sees the anonymous session's delta (e.g. 1 of 4 entries). The page JS
    -- fetches /admin/desktop/uci_changes instead, which runs with the real
    -- session cookie, and renders the exact same list the tray counted.
    -- Rendering from that endpoint also makes Revert hit the same delta the
    -- user sees on screen.

    luci.http.prepare_content("text/html; charset=UTF-8")
    luci.http.write([[
<!DOCTYPE html>
<html lang="]] .. (page_lang or "en") .. [[">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>]] .. changes_escape(t("Unsaved Changes")) .. [[</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Segoe UI",system-ui,sans-serif;background:#f4f5f7;color:#333;padding:16px;min-height:100vh;font-size:13px}
.changes-header{display:flex;align-items:center;gap:8px;margin-bottom:14px}
h1{font-size:15px;font-weight:600;flex:1}
.count{background:#d9534f;color:#fff;border-radius:9px;font-size:11px;padding:1px 8px;font-weight:600}
.cfg{margin-bottom:10px}
.cfg h5{font-size:12px;font-weight:600;color:#888;margin:0 0 4px}
.chg{font-family:ui-monospace,Consolas,monospace;font-size:12px;padding:3px 8px;margin:2px 0;border-radius:3px;white-space:pre-wrap;word-break:break-all}
.chg b{font-weight:600}
.chg code{font-family:inherit}
.chg.add{background:#e8f5e9;color:#2e7d32}
.chg.set{background:#e3f2fd;color:#1565c0}
.chg.rem{background:#ffebee;color:#c62828}
.chg.other{background:#f5f5f5;color:#555}
.empty{text-align:center;color:#999;padding:40px 0;font-size:13px}
.changes-actions{position:sticky;bottom:0;background:#f4f5f7;padding-top:10px;display:flex;gap:8px;align-items:center;border-top:1px solid #e0e0e0;margin-top:14px}
button{border:none;border-radius:4px;padding:7px 14px;font-size:13px;cursor:pointer;font-weight:600}
#apply{background:#4a90d9;color:#fff}
#revert{background:#d9534f;color:#fff}
button:disabled{opacity:.5;cursor:default}
#status{margin-left:auto;font-size:12px;color:#666;white-space:nowrap}
</style>
</head>
<body>
<div class="changes-header"><h1>]] .. changes_escape(t("Unsaved Changes")) .. [[</h1><span class="count" id="count">–</span></div>
<div id="list"></div>
<div class="changes-actions">
<button id="apply">]] .. changes_escape(t("Save & Apply")) .. [[</button>
<button id="revert">]] .. changes_escape(t("Revert")) .. [[</button>
<span id="status"></span>
</div>
<script>
(function() {
    var txt = {
        applying: ']] .. changes_escape(t("Applying")) .. [[…',
        reverting: ']] .. changes_escape(t("Reverting")) .. [[…',
        done: ']] .. changes_escape(t("Saved")) .. [[',
        reverted: ']] .. changes_escape(t("Reverted")) .. [[',
        failed: ']] .. changes_escape(t("Failed")) .. [[',
        network: ']] .. changes_escape(t("Network error")) .. [[',
        confirmFail: ']] .. changes_escape(t("Failed")) .. [[ (auto-rollback)',
        empty: ']] .. changes_escape(t("There are no pending changes.")) .. [[',
        loadFailed: ']] .. changes_escape(t("Failed")) .. [[: load'
    };
    function esc(s) {
        var d = document.createElement('div');
        d.textContent = s == null ? '' : String(s);
        return d.innerHTML;
    }
    function rowHtml(e) {
        var cfg = esc(e.cfg), sec = esc(e.sec), opt = esc(e.opt), val = esc(e.val), t = e.type || '';
        if (t === 'add') return '<div class="chg add"><code>uci add ' + cfg + ' <b>' + sec + '</b></code></div>';
        if (t === 'set') {
            if (opt) return '<div class="chg set"><code>uci set ' + cfg + '.<b>' + sec + '</b>.<b>' + opt + '</b> = ' + val + '</code></div>';
            return '<div class="chg set"><code>uci set ' + cfg + '.<b>' + sec + '</b> = ' + val + '</code></div>';
        }
        if (t === 'remove' || t === 'del') {
            if (opt) return '<div class="chg rem"><code>uci del ' + cfg + '.<b>' + sec + '</b>.<b>' + opt + '</b></code></div>';
            return '<div class="chg rem"><code>uci del ' + cfg + '.<b>' + sec + '</b></code></div>';
        }
        if (t === 'list-add') return '<div class="chg set"><code>uci add_list ' + cfg + '.<b>' + sec + '</b>.<b>' + opt + '</b> = ' + val + '</code></div>';
        if (t === 'list-del') return '<div class="chg rem"><code>uci del_list ' + cfg + '.<b>' + sec + '</b>.<b>' + opt + '</b> = ' + val + '</code></div>';
        if (t === 'rename') return '<div class="chg other"><code>uci rename ' + cfg + '.<b>' + sec + '</b> ' + opt + ' = ' + val + '</code></div>';
        if (t === 'order') return '<div class="chg other"><code>uci reorder ' + cfg + '.<b>' + sec + '</b> = ' + val + '</code></div>';
        return '<div class="chg other"><code>' + esc(t + ' ' + e.cfg + ' ' + e.sec + ' ' + e.opt + ' ' + e.val) + '</code></div>';
    }
    function renderList(j) {
        var listEl = document.getElementById('list');
        var countEl = document.getElementById('count');
        var list = j.list || [];
        countEl.textContent = String(list.length);
        if (!list.length) {
            listEl.innerHTML = '<div class="empty">' + esc(txt.empty) + '</div>';
            // Nothing pending — the window has no content left (e.g. right
            // after a Revert reloads it). Ask the desktop shell to close the
            // window instead of showing an empty page. Harmless when opened
            // directly (no listener on the other side).
            try { window.parent.postMessage({type: 'desktop-app-close'}, '*'); } catch (e) {}
            return;
        }
        var out = '';
        var cur = null;
        for (var i = 0; i < list.length; i++) {
            var e = list[i];
            if (e.cfg !== cur) { cur = e.cfg; out += '<div class="cfg"><h5># /etc/config/' + esc(cur) + '</h5>'; }
            out += rowHtml(e);
        }
        listEl.innerHTML = out;
    }
    var x = new XMLHttpRequest();
    x.open('GET', '/cgi-bin/luci/admin/desktop/uci_changes', true);
    x.onload = function() {
        try { renderList(JSON.parse(x.responseText)); }
        catch (e) { document.getElementById('list').innerHTML = '<div class="empty">' + esc(txt.loadFailed) + '</div>'; }
    };
    x.onerror = function() { document.getElementById('list').innerHTML = '<div class="empty">' + esc(txt.loadFailed) + '</div>'; };
    x.send();
    var btnApply = document.getElementById('apply');
    var btnRevert = document.getElementById('revert');
    var st = document.getElementById('status');
    var busy = false;
    function notifyShell(type) {
        try { window.parent.postMessage({ type: 'desktop-app-save', submitType: type }, '*'); } catch (e) {}
    }
    function reloadSoon() { setTimeout(function() { location.reload(); }, 900); }
    function lock() { busy = true; btnApply.disabled = true; btnRevert.disabled = true; }
    function unlock() { busy = false; btnApply.disabled = false; btnRevert.disabled = false; }
    btnApply.onclick = function() {
        if (busy) return;
        lock(); st.textContent = txt.applying;
        var x = new XMLHttpRequest();
        x.open('POST', '/cgi-bin/luci/admin/desktop/changes/apply', true);
        x.onload = function() {
            var r = null;
            try { r = JSON.parse(x.responseText); } catch (e) {}
            if (r && r.ok) {
                // Keep the rollback window armed briefly, then confirm —
                // if the device went unreachable the confirm fails and
                // uci rolls back automatically.
                setTimeout(function() {
                    var c = new XMLHttpRequest();
                    c.open('POST', '/cgi-bin/luci/admin/desktop/changes/confirm?token=' + r.token, true);
                    c.onload = function() {
                        notifyShell('apply');
                        st.textContent = txt.done;
                        reloadSoon();
                    };
                    c.onerror = function() {
                        st.textContent = txt.confirmFail;
                        setTimeout(function() { location.reload(); }, 1500);
                    };
                    c.send();
                }, 1200);
            } else {
                st.textContent = txt.failed; unlock();
            }
        };
        x.onerror = function() { st.textContent = txt.network; unlock(); };
        x.send();
    };
    btnRevert.onclick = function() {
        if (busy) return;
        lock(); st.textContent = txt.reverting;
        var x = new XMLHttpRequest();
        x.open('POST', '/cgi-bin/luci/admin/desktop/changes/revert', true);
        x.onload = function() {
            var r = null;
            try { r = JSON.parse(x.responseText); } catch (e) {}
            if (r && r.ok) { notifyShell('revert'); st.textContent = txt.reverted; reloadSoon(); }
            else { st.textContent = txt.failed; unlock(); }
        };
        x.onerror = function() { st.textContent = txt.network; unlock(); };
        x.send();
    };
})();
</script>
</body>
</html>]])
end

-- POST /admin/desktop/changes/apply — uci apply (ucode: 90s rollback window;
-- Lua track: cursor commit + luci-reload). Mechanism lives in Runtime.apply.
function action_changes_apply()
    local Runtime = require "luci.desktop.runtime"
    local sid = (luci.http.getcookie(Runtime.cookieName()) or ""):gsub("[^%x]", "")
    luci.http.prepare_content("application/json")
    if not Runtime.sessionValid(sid) then
        luci.http.status(401)
        luci.http.write('{"ok":false,"msg":"auth"}')
        return
    end

    local r = Runtime.apply(sid)
    if not r.ok then
        luci.http.write('{"ok":false}')
        return
    end
    if r.token then
        luci.http.write('{"ok":true,"token":"' .. r.token .. '"}')
    else
        luci.http.write('{"ok":true}')
    end
end

-- POST /admin/desktop/changes/confirm?token=... — validate + uci confirm
-- (rollback token only exists on the ucode track; Lua track never gets here
-- because apply returns no token — the frontend skips confirm).
function action_changes_confirm()
    local Runtime = require "luci.desktop.runtime"
    local token = (luci.http.formvalue("token") or ""):gsub("[^%x]", "")
    luci.http.prepare_content("application/json")
    local ok = Runtime.confirm(token)
    luci.http.write(ok and '{"ok":true}' or '{"ok":false}')
end

-- POST /admin/desktop/changes/revert — revert every config with changes
-- (mechanism lives in Runtime.revert).
function action_changes_revert()
    local Runtime = require "luci.desktop.runtime"
    local sid = (luci.http.getcookie(Runtime.cookieName()) or ""):gsub("[^%x]", "")
    luci.http.prepare_content("application/json")
    if not Runtime.sessionValid(sid) then
        luci.http.status(401)
        luci.http.write('{"ok":false,"msg":"auth"}')
        return
    end

    local r = Runtime.revert(sid)
    luci.http.write(r.ok and '{"ok":true}' or '{"ok":false}')
end

-- ===== Terminal one-click install (installable shortcut, 2026-08-16) =====
-- POST /admin/desktop/install_ttyd — start a BACKGROUND install of ttyd +
-- luci-app-ttyd (the Terminal shortcut's runtime). apk (ImmortalWrt 25.12+)
-- or opkg (legacy) based on the device. Returns started/already/failed.
-- The install runs detached (nohup) because it downloads packages and can
-- exceed the CGI timeout; the frontend polls ttyd_status.
function action_install_ttyd()
    local Runtime = require "luci.desktop.runtime"
    local sid = (luci.http.getcookie(Runtime.cookieName()) or ""):gsub("[^%x]", "")
    luci.http.prepare_content("application/json")
    if not Runtime.sessionValid(sid) then
        luci.http.status(401)
        luci.http.write('{"ok":false,"msg":"auth"}')
        return
    end

    -- Already installed? (menu tree may lag behind the package manager)
    local present = false
    pcall(function()
        local f = io.open("/usr/bin/ttyd", "r")
        if f then f:close() present = true end
    end)
    if present then
        luci.http.write('{"ok":true,"already":true}')
        return
    end

    -- Detect package manager and fire the install detached
    local pm = "opkg"
    pcall(function()
        local f = io.popen("command -v apk 2>/dev/null")
        if f then local v = f:read("*a"); f:close(); if v ~= "" then pm = "apk" end end
    end)
    local cmd
    if pm == "apk" then
        cmd = "apk add --allow-untrusted ttyd luci-app-ttyd >/tmp/ttyd-install.log 2>&1"
    else
        cmd = "opkg install ttyd luci-app-ttyd >/tmp/ttyd-install.log 2>&1"
    end
    local ok = os.execute("nohup sh -c '" .. cmd .. "' >/dev/null 2>&1 &")
    luci.http.write(ok and '{"ok":true,"started":true}' or '{"ok":false}')
end

-- GET /admin/desktop/ttyd_status — is ttyd installed yet? Frontend polls
-- this every 2s while an install is in flight, then reloads on success.
function action_ttyd_status()
    local Runtime = require "luci.desktop.runtime"
    local sid = (luci.http.getcookie(Runtime.cookieName()) or ""):gsub("[^%x]", "")
    luci.http.prepare_content("application/json")
    if not Runtime.sessionValid(sid) then
        luci.http.status(401)
        luci.http.write('{"ok":false,"msg":"auth"}')
        return
    end

    local present = false
    pcall(function()
        local f = io.open("/usr/bin/ttyd", "r")
        if f then f:close() present = true end
    end)
    luci.http.write(present and '{"installed":true}' or '{"installed":false}')
end
