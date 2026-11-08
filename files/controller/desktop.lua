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

    -- Task manager (v1: read-only process list; "end task" is out of scope).
    -- Same reachability contract as system_status: unauthenticated render;
    -- the page's own XHRs run with the real session cookie.
    local tasklist_api = entry({"admin", "desktop", "tasklist"}, call("action_tasklist"))
    tasklist_api.leaf = true
    tasklist_api.sysauth = false

    local taskmgr_page = entry({"admin", "desktop", "taskmgr"}, call("action_taskmgr"))
    taskmgr_page.leaf = true
    taskmgr_page.sysauth = false

    -- One-process detail (cmdline / open files / sockets / io) for the
    -- taskmgr drawer; fetched on demand, never part of the 4s snapshot.
    local procdetail_api = entry({"admin", "desktop", "proc_detail"}, call("action_proc_detail"))
    procdetail_api.leaf = true
    procdetail_api.sysauth = false

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
    -- Lua CBI / client-side pending changes are keyed by the login
    -- session — the anonymous cursor cannot see them (verified on-device
    -- 2026-08-31: plain Save leaves the delta in the rpcd session,
    -- anonymous `uci changes` returns {}). Query with the session first;
    -- fall back to the anonymous cursor if the session query is denied
    -- (official 25.x sessions lack the uci ACL; uci.lua builds without
    -- set_session_id behave anonymously either way).
    local rows
    local sid = (luci.http.getcookie(Runtime.cookieName()) or ""):gsub("[^%x]", "")
    local ok, sessRows = pcall(function()
        local c = require("luci.model.uci").cursor()
        if c.set_session_id and sid ~= "" then
            c:set_session_id(sid)
        end
        return Runtime.getChanges(c)
    end)
    if ok and type(sessRows) == "table" then
        rows = sessRows
    else
        rows = Runtime.getChanges()
    end
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

    -- Temperature: SAME source as the Status overview's CPU-info row.
    -- That row is fed by the firmware's /sbin/cpuinfo script, which reads
    --   `sensors coretemp-*` → first "Package id |Core" reading (Intel)
    --   `sensors k*temp-*`   → Tdie (AMD)
    -- so speak the same pipeline first; without the `sensors` binary
    -- (VMs, busybox-only images) fall back to the sysfs CPU-zone
    -- preference below — the first readable zone is often the board/ACPI
    -- sensor (acpitz), which reads well below the CPU (e.g. 27.8°C vs
    -- 43°C on an Intel box). CPU zones: x86_pkg_temp (Intel),
    -- cpu-thermal/tsens (ARM SoCs). Fall back to the first readable zone
    -- when no CPU-named zone exists (AMD k10temp etc.).
    local thermal = {}
    local temp_first = nil
    local stemp = sys.exec(
        "sensors 'coretemp-*' 2>/dev/null | grep -E 'Package id |Core ' " ..
        "| grep -Eo '\\+[0-9.]*°C' | head -n1 | tr -d '+'")
    if not (stemp and #stemp > 0) then
        stemp = sys.exec(
            "sensors 'k*temp-*' 2>/dev/null | awk '/Tdie/ {print $2}' " ..
            "| head -n1 | tr -d '+'")
    end
    stemp = stemp and stemp:match("^%s*(.-)%s*$") or ""
    if #stemp > 0 then
        if not stemp:find("°C$") then stemp = stemp .. "°C" end
        thermal[1] = { temp = stemp }
    end
    if not thermal[1] then
        for i = 0, 9 do
            local zpath = "/sys/class/thermal/thermal_zone" .. i
            local fp = io.open(zpath .. "/temp")
            if fp then
                local raw = fp:read("*l")
                fp:close()
                local t = raw and tonumber(raw)
                if t then
                    if not temp_first then temp_first = t end
                    local tf = io.open(zpath .. "/type")
                    local ztype = tf and (tf:read("*l") or "") or ""
                    if tf then tf:close() end
                    local zl = ztype:lower()
                    if zl:find("pkg") or zl:find("cpu") or zl:find("tsens") then
                        thermal[1] = { temp = string.format("%.1f", t / 1000) .. "°C" }
                        break
                    end
                end
            end
        end
        if not thermal[1] and temp_first then
            thermal[1] = { temp = string.format("%.1f", temp_first / 1000) .. "°C" }
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

-- Interface metadata for the net-traffic widget: IPv4 address + uptime
-- for the selected netdev. /proc/net/dev lists physical/device names, while
-- ubus network.interface returns logical-interface records with
-- ipv4-address, uptime, l3_device and device. Map both l3_device and the
-- underlying device so selecting eth3 (WAN physical port) still shows the
-- WAN IP/uptime from the pppoe-wan logical record.
local function iface_meta_map()
    local map = {}
    local raw = ""
    local p = io.popen("ubus call network.interface dump 2>/dev/null")
    if p then raw = p:read("*a") or ""; p:close() end
    if raw == "" then return map end
    local jsonc = luci.jsonc or luci.json
    if not jsonc then return map end
    local ok, parsed = pcall(jsonc.parse, raw)
    if not ok or type(parsed) ~= "table" then return map end
    local list = parsed["interface"]
    if type(list) ~= "table" then return map end
    for _, rec in ipairs(list) do
        if type(rec) == "table" then
            local ip = nil
            local addrs = rec["ipv4-address"]
            if type(addrs) == "table" and type(addrs[1]) == "table" then
                ip = addrs[1].address
            end
            local info = { ip = ip, uptime = tonumber(rec.uptime) }
            local function put(name)
                if name and name ~= "" and not map[name] then map[name] = info end
            end
            put(rec.l3_device)
            put(rec.device)
        end
    end
    return map
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
    local meta = iface_meta_map()
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
                local m = meta[name]
                out[name] = {
                    rx = nums[1], tx = nums[9], phy = phy,
                    ip = m and m.ip or nil,
                    uptime = m and m.uptime or nil
                }
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
    elseif section == "icon_layout" then
        -- Icon layout (desktop only): JSON map url -> {icon, desktop:
        -- {col,row}, mobile:{col,row}} — position + icon choice together,
        -- mobile slot reserved for a future mobile layout.
        if not uci:get("desktop", "icon_layout") then
            check(uci:set("desktop", "icon_layout", "icon_layout"), nil, "icon_layout.section")
        end
        check(uci:set("desktop", "icon_layout", "items", data), nil, "icon_layout.items")
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
            -- Contract (shell.js bg-refresh guard): cached:true == "this is NOT
            -- a fresh download". The old wallpaper stays on the desktop as the
            -- OLD image: no re-apply, no confirm_wallpaper POST, no fake
            -- "confirm ok" in the log. Fallback must honor it like cache_hit.
            luci.http.write('{"url":"' .. cache_url .. '","cached":true,"debug":"' .. table.concat(log, " | ") .. '"}')
            return
        end
        local fallback = "/luci-static/desktop/img/bg1.jpg"
        log[#log + 1] = "fallback=default"
        log[#log + 1] = "url=" .. fallback
        server_log("random_wallpaper mode=" .. mode .. " fallback=default bg1")
        luci.http.prepare_content("application/json")
        -- Same contract: default bg1 is also not a fresh mode image.
        luci.http.write('{"url":"' .. fallback .. '","cached":true,"debug":"' .. table.concat(log, " | ") .. '"}')
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
    -- 0.1.0-261: the client passes the basename of the image it previews
    -- (check_saved already works the same way). Restrict to whitelisted
    -- cache names so the source can never leave the cache dir; anything
    -- else falls back to the mode's raw cache file (previous behavior).
    local file = luci.http.formvalue("file") or ""
    local src = "wallpaper_" .. mode .. ".jpg"
    -- Lua patterns have NO alternation (|): the previous regex-shaped match
    -- could never fire, so src always fell back to the mode's raw cache and
    -- the saved image differed from the one the preview showed. Enumerate
    -- the legal cache names explicitly instead.
    if file == "wallpaper_bing.jpg" or file == "wallpaper_bing_desktop.jpg" or
       file == "wallpaper_picsum.jpg" or file == "wallpaper_picsum_desktop.jpg" then
        src = file
    end
    local cache_file = "/www/luci-static/desktop/cache/" .. src
    local bg_dir = "/www/luci-static/desktop/background/"
    server_log("save_to_builtin mode=" .. mode .. " file=[" .. file .. "] src=" .. src)

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
    server_log("check_saved mode=" .. mode .. " file=[" .. file .. "] saved=" .. tostring(saved) .. " name=" .. name)
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

-- ===========================================================================
-- Task manager (v1, read-only — "end task" is deliberately out of scope).
-- GET /admin/desktop/taskmgr — standalone HTML page, opened from the
-- taskbar's right-click menu; modeled on action_changes (no LuCI framework,
-- style+script inlined, data fetched by its own XHR).
-- GET /admin/desktop/tasklist — its data feed. /proc parsing only (io.*):
-- no LuCI API surface involved, so it behaves identically on the Lua and
-- ucode tracks (same rationale as server_log's io.open usage). CPU% is NOT
-- computed here: the page diffs per-process jiffies and the /proc/stat
-- corpus total between two polls — these are cumulative values (like the
-- bandwidth endpoint reports), not deltas.
-- ===========================================================================

local function taskmgr_collect()
    local procs = {}

    -- uid -> name, read once per request
    local passwd = {}
    local pw = io.open("/etc/passwd")
    if pw then
        for line in pw:lines() do
            local user, uid = line:match("^([^:]+):[^:]*:(%d+):")
            if user then passwd[tonumber(uid)] = user end
        end
        pw:close()
    end

    local ls = io.popen("ls /proc")
    if ls then
        for name in ls:lines() do
            local pid = tonumber(name)
            if pid then
                local p = { pid = pid, jf = 0, vsz_kb = 0, rss_kb = 0,
                            state = "?", comm = tostring(pid), user = "?" }

                local st = io.open("/proc/" .. pid .. "/stat")
                if st then
                    local stat_s = st:read("*a") or ""
                    st:close()
                    -- comm may itself contain parens/spaces: the greedy
                    -- capture runs up to the LAST ")" (space + state field
                    -- always follows it, per proc(5)).
                    local comm, rest = stat_s:match("^%d+%s+%((.*)%) (.*)$")
                    if comm then
                        p.comm = comm
                        local n, tok = 0, {}
                        for tk in rest:gmatch("%S+") do
                            n = n + 1
                            tok[n] = tk
                        end
                        -- tok[i] is /proc stat field i+2:
                        p.state = tok[1] or "?"                          --  3: state
                        p.jf = (tonumber(tok[12]) or 0) + (tonumber(tok[13]) or 0)  -- 14/15: utime+stime
                        p.vsz_kb = math.floor((tonumber(tok[21]) or 0) / 1024)      -- 23: vsize
                        p.rss_kb = math.floor((tonumber(tok[22]) or 0) * 4)         -- 24: rss pages (4096-byte pages on every OpenWrt target)
                    end
                end

                local cm = io.open("/proc/" .. pid .. "/cmdline")
                if cm then
                    local c = cm:read("*a") or ""
                    cm:close()
                    -- executable path = argv[0] (bytes up to the first
                    -- NUL; what follows — NULs joined with spaces — is the
                    -- arg tail in cmd). Kernel threads have no cmdline.
                    local path = c:match("^([^%z]+)")
                    if path then
                        path = path:gsub("^%s+", ""):gsub("%s+$", "")
                        if path ~= "" then p.path = path end
                    end
                    c = c:gsub("%z+", " "):gsub("^%s+", ""):gsub("%s+$", "")
                    if c ~= "" then p.cmd = c end
                end
                if not p.cmd then p.cmd = "[" .. p.comm .. "]" end

                local sz = io.open("/proc/" .. pid .. "/status")
                if sz then
                    for line in sz:lines() do
                        local euid = line:match("^Uid:%s+%d+%s+(%d+)")
                        if euid then
                            p.user = passwd[tonumber(euid)] or ("uid " .. euid)
                            break
                        end
                    end
                    sz:close()
                end

                procs[#procs + 1] = p
            end
        end
        ls:close()
    end

    -- cumulative-since-boot sort: historically CPU-hungry first, until the
    -- page has its own diff data and re-sorts by CPU%
    table.sort(procs, function(a, b) return a.jf > b.jf end)

    -- first /proc/stat line: cumulative ticks across ALL cores — the
    -- denominator the page diffs per-process jiffies against
    local ticks = 0
    local ps = io.open("/proc/stat")
    if ps then
        local cpu = ps:read("*l") or ""
        ps:close()
        if cpu:sub(1, 4) == "cpu " then
            for v in cpu:gmatch("%d+") do ticks = ticks + (tonumber(v) or 0) end
        end
    end

    local mem_total, mem_avail = 0, 0
    local mi = io.open("/proc/meminfo")
    if mi then
        local free, buff, cache
        for line in mi:lines() do
            if mem_total == 0 and line:match("^MemTotal:") then
                mem_total = tonumber(line:match("MemTotal:%s+(%d+)")) or 0
            elseif line:match("^MemAvailable:") then
                mem_avail = tonumber(line:match("MemAvailable:%s+(%d+)")) or 0
                break
            elseif line:match("^MemFree:") then
                free = tonumber(line:match("MemFree:%s+(%d+)")) or 0
            elseif line:match("^Buffers:") then
                buff = tonumber(line:match("Buffers:%s+(%d+)")) or 0
            elseif line:match("^Cached:") then
                cache = tonumber(line:match("Cached:%s+(%d+)")) or 0
            end
        end
        -- pre-3.14 kernels lack MemAvailable
        if mem_avail == 0 then mem_avail = (free or 0) + (buff or 0) + (cache or 0) end
        mi:close()
    end

    return procs, ticks, mem_total, mem_avail
end

-- GET /admin/desktop/tasklist -- listening sockets snapshot for the
-- task manager's ports section. busybox netstat -tulnp, one spawn per poll
-- (same cadence as the /proc scan; a few ms at most). Row shapes verified
-- live 2026-11-01 (busybox 1.36 on a real device):
--   tcp  0 0 0.0.0.0:53    0.0.0.0:* LISTEN 21775/dnsmasq
--   udp  0 0 0.0.0.0:53    0.0.0.0:*         21775/dnsmasq   (no State)
--   IPv6 rows keep proto tcp/udp with local ":::5000" (host "::", port 5000)
--   kernel-owned sockets show "-" as PID/Program
local function taskmgr_ports()
    local ports = {}
    local ns = io.popen("netstat -tulnp 2>/dev/null")
    if not ns then return ports end
    for line in ns:lines() do
        local proto = line:match("^(tcp)%s+") or line:match("^(udp)%s+")
        if proto then
            local body = line:match("^%S+%s+%d+%s+%d+%s+(.+)$")
            if body then
                local tok, n = {}, 0
                for tk in body:gmatch("%S+") do
                    n = n + 1
                    tok[n] = tk
                end
                -- tcp row: local foreign LISTEN pid/prog ; udp: local foreign pid/prog
                if n >= 3 then
                    local who = tok[n]
                    local raw_pid, raw_prog = who:match("^(%d+)/(.+)$")
                    local prog
                    if raw_prog then
                        -- busybox may append a trailing ":"/whitespace; keep
                        -- the reveal-able name only (dnsmasq_acl_d, cname ids,
                        -- kernel "-" rows keep proc=nil and group as unknown)
                        prog = raw_prog:gsub("%s+$", ""):gsub(":$", "")
                    end
                    local addr, service = tok[1]:match("^(.+):(%d+)$")
                    if addr and service then
                        if addr == "" then addr = "*" end
                        ports[#ports + 1] = {
                            proto = proto,
                            addr = addr,
                            port = tonumber(service),
                            pid = raw_pid and tonumber(raw_pid) or nil,
                            proc = (prog and prog ~= "" and prog ~= "-") and prog or nil
                        }
                    end
                end
            end
        end
    end
    ns:close()
    return ports
end

-- GET /admin/desktop/tasklist — snapshot feed for the taskmgr page
function action_tasklist()
    local procs, ticks, mem_total, mem_avail = taskmgr_collect()
    local ports = taskmgr_ports()
    luci.http.prepare_content("application/json")
    luci.http.write_json({
        ok = true,
        list = procs,
        ticks_total = ticks,
        mem_total_kb = mem_total,
        mem_avail_kb = mem_avail,
        ports = ports
    })
end

-- GET /admin/desktop/proc_detail?pid=N[&env=1] — one-process detail for the
-- task manager drawer. Read-only and defensive: every file is optional on a
-- locked-down box, so a missing /proc entry just leaves that field out.
local function proc_slurp(path)
    local f = io.open(path)
    if not f then return nil end
    local s = f:read("*a")
    f:close()
    return s
end

local function proc_link(path)
    local h = io.popen("readlink " .. path .. " 2>/dev/null")
    if not h then return nil end
    local v = h:read("*l")
    h:close()
    return v
end

local function proc_detail(pid, want_env)
    local base = "/proc/" .. pid
    local stat = proc_slurp(base .. "/stat")
    if not stat then return nil end

    local d = { pid = pid }

    local st = proc_slurp(base .. "/status")
    if st then
        d.name = st:match("^Name:%s*([^\n]+)")
        d.state = st:match("^State:%s*(%S+)")
        d.ppid = tonumber(st:match("^PPid:%s*(%d+)"))
        d.threads = tonumber(st:match("^Threads:%s*(%d+)"))
        d.uid = tonumber(st:match("^Uid:%s*(%d+)"))
        d.gid = tonumber(st:match("^Gid:%s*(%d+)"))
        d.vsz_kb = tonumber(st:match("^VmSize:%s*(%d+)%s*kB"))
        d.rss_kb = tonumber(st:match("^VmRSS:%s*(%d+)%s*kB"))
        d.vmpeak_kb = tonumber(st:match("^VmPeak:%s*(%d+)%s*kB"))
        d.swap_kb = tonumber(st:match("^VmSwap:%s*(%d+)%s*kB"))
        d.ctxt_switches = tonumber(st:match("^voluntary_ctxt_switches:%s*(%d+)"))
    end

    -- stat field N lives at tok[N-2] because state (3) is tok[1]
    local _, rest = stat:match("^(%d+)%s+%((.*)%) (.*)$")
    if rest then
        local tok = {}
        for tk in rest:gmatch("%S+") do tok[#tok + 1] = tk end
        d.utime = tonumber(tok[12]) or 0
        d.stime = tonumber(tok[13]) or 0
        d.nice = tonumber(tok[17])
        d.start_ticks = tonumber(tok[20])
    end

    local pstat = proc_slurp("/proc/stat")
    local btime = pstat and tonumber(pstat:match("btime%s+(%d+)"))
    if btime and d.start_ticks then
        -- USER_HZ is 100 on every OpenWrt target
        d.started_epoch = btime + math.floor(d.start_ticks / 100)
    end

    local cl = proc_slurp(base .. "/cmdline")
    if cl and cl ~= "" then
        local args = {}
        for a in cl:gmatch("([^%z]+)") do args[#args + 1] = a end
        d.args = args
        d.cmdline = table.concat(args, " ")
    end

    d.exe = proc_link(base .. "/exe")
    d.cwd = proc_link(base .. "/cwd")

    local ios = proc_slurp(base .. "/io")
    if ios then
        d.io = {
            rchar = tonumber(ios:match("rchar:%s*(%d+)")),
            wchar = tonumber(ios:match("wchar:%s*(%d+)")),
            read_bytes = tonumber(ios:match("read_bytes:%s*(%d+)")),
            write_bytes = tonumber(ios:match("write_bytes:%s*(%d+)"))
        }
    end

    -- open files: one shell pass over the numeric fd entries
    local fds = {}
    local h = io.popen("for f in " .. base .. "/fd/*; do printf '%s\\t%s\\n' \"${f##*/}\" \"$(readlink \"$f\")\"; done 2>/dev/null")
    if h then
        for line in h:lines() do
            local fd, target = line:match("^(%d+)\t(.*)$")
            if fd and target and target ~= "" then
                local kind = "file"
                if target:match("^socket:%[") then kind = "socket"
                elseif target:match("^pipe:%[") then kind = "pipe"
                elseif target:match("^anon_inode:") then kind = "anon"
                end
                fds[#fds + 1] = { fd = tonumber(fd), type = kind, target = target }
            end
        end
        h:close()
    end
    table.sort(fds, function(a, b) return a.fd < b.fd end)
    d.fds = fds
    d.fd_count = #fds

    -- sockets owned by this pid: busybox netstat already decodes addresses
    -- and states; -a is required or LISTEN sockets (dnsmasq's :53) are missing
    local socks = {}
    local ns = io.popen("netstat -tunap 2>/dev/null")
    if ns then
        for line in ns:lines() do
            local proto = line:match("^(tcp)%s+") or line:match("^(udp)%s+")
            if proto then
                local body = line:match("^%S+%s+%d+%s+%d+%s+(.+)$")
                if body then
                    local tok, n = {}, 0
                    for tk in body:gmatch("%S+") do
                        n = n + 1
                        tok[n] = tk
                    end
                    local who = tok[n] or ""
                    local lpid = who:match("^(%d+)/")
                    if lpid and tonumber(lpid) == pid then
                        local state = ""
                        if proto == "tcp" and n >= 4 then state = tok[n - 1] end
                        socks[#socks + 1] = {
                            proto = proto,
                            local_addr = tok[1] or "",
                            remote_addr = tok[2] or "",
                            state = state
                        }
                    end
                end
            end
        end
        ns:close()
    end
    d.sockets = socks

    if want_env then
        local ev = proc_slurp(base .. "/environ")
        if ev then
            local envs = {}
            for kv in ev:gmatch("([^%z]+)") do envs[#envs + 1] = kv end
            d.env = envs
        end
    end

    return d
end

function action_proc_detail()
    local pid = tonumber(luci.http.formvalue("pid") or "")
    luci.http.prepare_content("application/json")
    if not pid or pid < 1 then
        luci.http.write_json({ ok = false, err = "bad pid" })
        return
    end
    local d = proc_detail(pid, luci.http.formvalue("env") == "1")
    if not d then
        luci.http.write_json({ ok = false, err = "no such process" })
        return
    end
    d.ok = true
    luci.http.write_json(d)
end

-- GET /admin/desktop/taskmgr — standalone task manager page
function action_taskmgr()
    local i18n = require("luci.i18n")
    local t = function(k) return i18n.translate(k) end

    local uci = require("luci.desktop.runtime").newCursor()
    local page_lang = uci:get("luci", "main", "lang") or "en"

    luci.http.header("Cache-Control", "no-store")
    luci.http.prepare_content("text/html; charset=UTF-8")
    luci.http.write([[<!DOCTYPE html>
<html lang="]] .. (page_lang or "en") .. [[">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Cache-Control" content="no-store">
<title>]] .. changes_escape(t("Task Manager")) .. [[</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Segoe UI",system-ui,sans-serif;background:#f4f5f7;color:#333;padding:16px;min-height:100vh;font-size:13px}
body{position:relative}
.tm-header{display:flex;align-items:center;gap:8px;margin-bottom:12px}
h1{font-size:15px;font-weight:600;flex:1;white-space:nowrap}
.count{background:#1565c0;color:#fff;border-radius:9px;font-size:11px;padding:1px 8px;font-weight:600;white-space:nowrap}
.err{color:#c62828;font-size:11px;white-space:nowrap}
#filter{border:1px solid #d3d7db;border-radius:4px;padding:4px 8px;font-size:12px;width:140px;background:#fff;color:#333}
#filter:focus{border-color:#4a90d9;outline:none}
#gear{border:none;background:transparent;font-size:15px;line-height:1;color:#666;cursor:pointer;padding:2px 5px;border-radius:4px}
#gear:hover{background:#e8eaed;color:#333}
#panel{position:absolute;right:16px;top:50px;background:#fff;border:1px solid #e0e4e8;border-radius:8px;padding:12px 14px;box-shadow:0 8px 28px rgba(0,0,0,.14);z-index:10;min-width:230px}
.set-h{font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.4px;margin:2px 0 6px}
.set-row{display:flex;align-items:center;gap:8px;margin:8px 0;font-size:12px}
.set-row span{flex:1}
.set-row select{border:1px solid #d3d7db;border-radius:4px;padding:3px 6px;font-size:12px;background:#fff;color:#333}
#set-interval:disabled{opacity:.5}
#set-cols label{display:flex;align-items:center;gap:6px;font-size:12px;padding:2px 0;cursor:pointer}
#set-cols input[type=checkbox]{accent-color:#4a90d9}
td.c-path{overflow:hidden;text-overflow:ellipsis;color:#666}
.col-off{display:none}
thead th span.drag{position:absolute;top:0;right:0;width:9px;height:100%;cursor:col-resize;z-index:2}
thead th span.drag::before{content:'';position:absolute;top:50%;right:4px;width:2px;height:16px;margin-top:-8px;background:transparent;border-radius:1px}
thead th span.drag:hover{background:rgba(74,144,217,.08)}
thead th span.drag:hover::before{background:#4a90d9}
thead th span.drag.drag-active{background:rgba(74,144,217,.15)}
thead th span.drag.drag-active::before{background:#4a90d9}
body.col-resizing{cursor:col-resize;user-select:none}
.mon-row{display:flex;gap:10px;margin-bottom:12px}
.mon{flex:1;min-width:0;background:#fff;border:1px solid #e0e4e8;border-radius:6px;padding:10px 12px}
.mon-label{font-size:11px;font-weight:600;color:#777;text-transform:uppercase;letter-spacing:.4px}
.mon-foot{display:flex;align-items:flex-end;gap:8px;margin-top:4px}
.mon-val{font-size:20px;font-weight:600;line-height:1.2}
canvas{margin-left:auto;flex:none}
.table-wrap{border:1px solid #e0e4e8;border-radius:6px;overflow:auto;background:#fff}
table{width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed}
thead th{position:sticky;top:0;background:#f8f9fa;font-size:11px;color:#666;text-align:left;padding:6px 10px;border-bottom:1px solid #e0e4e8;font-weight:600;z-index:1}
thead th{cursor:pointer;user-select:none}
thead th:hover{background:#eef1f4}
tbody td{padding:4px 10px;border-bottom:1px solid #f0f2f4;white-space:nowrap}
tbody tr:last-child td{border-bottom:none}
tbody tr:hover{background:#eef3fa}
th.num,td.num{text-align:right;font-variant-numeric:tabular-nums}
td.name{max-width:180px;overflow:hidden;text-overflow:ellipsis}
td.state-z{color:#c62828;font-weight:600}
tr.zombie{background:#fff3e0}
.pk{display:inline-block;background:#eef3fa;border:1px solid #d9e3ee;border-radius:4px;font-size:11px;padding:1px 8px;margin:1px 5px 1px 0;font-variant-numeric:tabular-nums;white-space:nowrap}
.pk .p{color:#1565c0;font-weight:600}
.pk.more{cursor:pointer;color:#1565c0;background:#e8f1fd;border-color:#c9dbf2;font-weight:600}
.pk.more:hover{background:#dbe9fb}
#tbl td.c-ports{white-space:normal}
tbody tr.sel{background:#e8f1fd}
#dr{position:fixed;top:0;right:0;bottom:0;width:440px;max-width:94vw;background:#fff;border-left:1px solid #e0e4e8;box-shadow:-8px 0 24px rgba(0,0,0,.12);display:flex;flex-direction:column;z-index:30}
#dr[hidden]{display:none}
.dr-head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid #eef1f4}
#dr-title{flex:1;font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#dr-close{border:none;background:transparent;font-size:18px;line-height:1;color:#666;cursor:pointer;padding:0 4px}
#dr-close:hover{color:#333}
.dr-body{overflow:auto;padding:10px 14px 24px;font-size:12px}
.dr-sec{margin-bottom:14px}
.dr-sec h3{font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:#888;margin:0 0 6px;font-weight:600}
.dr-kv{display:grid;grid-template-columns:104px 1fr;gap:3px 8px}
.dr-kv div:nth-child(odd){color:#777}
.dr-kv div{overflow-wrap:anywhere}
.dr-cmd{background:#f6f8fa;border:1px solid #e6eaee;border-radius:4px;padding:6px 8px;font-family:ui-monospace,Consolas,monospace;font-size:11px;white-space:pre-wrap;word-break:break-all;max-height:120px;overflow:auto}
.dr-tbl{width:100%;border-collapse:collapse;table-layout:fixed}
.dr-tbl td{padding:2px 4px;border-bottom:1px solid #f2f4f6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dr-tbl td.fd{width:44px;color:#999;text-align:right}
.dr-tbl td.ty{width:56px;color:#777}
.dr-tbl td.st{width:86px;color:#777}
.dr-empty{color:#999;padding:2px 0}
.dr-btn{border:1px solid #d3d7db;background:#fff;border-radius:4px;padding:3px 10px;font-size:12px;cursor:pointer;color:#333}
.dr-btn:hover{background:#f2f5f8}
</style>
</head>
<body>
<div class="tm-header"><h1>]] .. changes_escape(t("Task Manager")) .. [[</h1><input id="filter" type="search" placeholder="]] .. changes_escape(t("Filter")) .. [["><span class="err" id="err"></span><span class="count" id="count">–</span><button id="gear" title="]] .. changes_escape(t("Settings")) .. [[">⚙</button></div>
<div id="panel" hidden>
<div class="set-row"><span>]] .. changes_escape(t("Refresh interval")) .. [[</span><select id="set-interval"><option value="2000">2 s</option><option value="4000">4 s</option><option value="8000">8 s</option><option value="15000">15 s</option><option value="30000">30 s</option></select></div>
<div class="set-h">]] .. changes_escape(t("Columns")) .. [[</div>
<div id="set-cols"></div>
</div>
<div class="mon-row">
<div class="mon">
<div class="mon-label">]] .. changes_escape(t("CPU")) .. [[</div>
<div class="mon-foot"><div class="mon-val" id="cpu-val">–</div><canvas id="cpu-graph" width="150" height="38"></canvas></div>
</div>
<div class="mon">
<div class="mon-label">]] .. changes_escape(t("Memory")) .. [[</div>
<div class="mon-foot"><div class="mon-val" id="mem-val">–</div><canvas id="mem-graph" width="150" height="38"></canvas></div>
</div>
</div>
<div class="table-wrap"><table id="tbl">
<thead><tr><th data-key="pid">]] .. changes_escape(t("PID")) .. [[</th><th data-key="process">]] .. changes_escape(t("Process")) .. [[</th><th data-key="path">]] .. changes_escape(t("Path")) .. [[</th><th data-key="user">]] .. changes_escape(t("User")) .. [[</th><th data-key="state">]] .. changes_escape(t("Status")) .. [[</th><th class="num" data-key="cpu">]] .. changes_escape(t("CPU")) .. [[</th><th class="num" data-key="memory">]] .. changes_escape(t("Memory")) .. [[</th><th data-key="ports">]] .. changes_escape(t("Listening ports")) .. [[</th></tr></thead>
<tbody id="tbody"><tr><td colspan="8">–</td></tr></tbody>
</table></div>
<div id="dr" hidden>
<div class="dr-head"><span id="dr-title"></span><button id="dr-close" title="]] .. changes_escape(t("Close")) .. [[">×</button></div>
<div class="dr-body" id="dr-body"></div>
</div>
<script>
(function() {
    var txt = {
        tasks: ']] .. changes_escape(t("%d processes")) .. [[',
        failed: ']] .. changes_escape(t("Load failed")) .. [[',
        paused: ']] .. changes_escape(t("Auto Refresh: OFF")) .. [[',
        kernel: ']] .. changes_escape(t("Kernel sockets")) .. [[',
        overview: ']] .. changes_escape(t("Overview")) .. [[',
        cmdline: ']] .. changes_escape(t("Command line")) .. [[',
        files: ']] .. changes_escape(t("Open files")) .. [[',
        socks: ']] .. changes_escape(t("Sockets")) .. [[',
        noData: ']] .. changes_escape(t("No data")) .. [[',
        noProc: ']] .. changes_escape(t("Process is gone")) .. [[',
        showEnv: ']] .. changes_escape(t("Show environment")) .. [[',
        env: ']] .. changes_escape(t("Environment")) .. [[',
        parentPid: ']] .. changes_escape(t("Parent PID")) .. [[',
        threads: ']] .. changes_escape(t("Threads")) .. [[',
        started: ']] .. changes_escape(t("Start time")) .. [[',
        nice: ']] .. changes_escape(t("Nice")) .. [[',
        cpuTime: ']] .. changes_escape(t("CPU time")) .. [[',
        ioRead: ']] .. changes_escape(t("I/O read")) .. [[',
        ioWrite: ']] .. changes_escape(t("I/O write")) .. [[',
        cwd: ']] .. changes_escape(t("Working directory")) .. [[',
        exe: ']] .. changes_escape(t("Executable")) .. [[',
        local: ']] .. changes_escape(t("Local")) .. [[',
        remote: ']] .. changes_escape(t("Remote")) .. [[',
        state: ']] .. changes_escape(t("State")) .. [['
    };
    function esc(s) {
        var d = document.createElement('div');
        d.textContent = s == null ? '' : String(s);
        return d.innerHTML;
    }
    var prev = null;            // {ticks: N, jf: {pid: jiffies}}
    var last = null;            // computed snapshot (rows get _pct), re-rendered on sort/filter
    var selectedPid = null;     // row whose detail drawer is open
    var envShown = false;
    var cpuArr = [], memArr = [];
    var MAX = 60;
    var sort = { key: 'cpu', dir: -1 };   // default: CPU% descending (Windows style)
    var filter = '';
    var lastDragEnd = 0;   // suppresses the sort-click that follows a resize drag
    // 'fit' = columns share the window width (percentage widths, re-flow on
    // resize); 'px' = exact widths, entered on the first drag or when the
    // stored widths differ from the defaults
    var MODE = 'fit';
    // user preferences, persisted in the iframe's localStorage — the
    // server keeps no state for this page.
    var INTERVALS = [2000, 4000, 8000, 15000, 30000];
    var W_MIN = 40, W_MAX = 640;
    var LIST_LIMIT = 3;         // chips per row before collapsing
    var openPids = {};          // expanded rows, kept across polls ('k' = kernel tail row)
    var DEF_W = { pid: 60, process: 140, path: 200, user: 80, state: 60, cpu: 80, memory: 110, ports: 220 };
    var cfg = {
        interval: 4000,
        cols: { pid: 1, process: 1, user: 1, state: 1, path: 1, cpu: 1, memory: 1, ports: 1 },
        w: { pid: 60, process: 140, path: 200, user: 80, state: 60, cpu: 80, memory: 110, ports: 220 }
    };
    var tbl = document.getElementById('tbl');
    (function() {
        var o = null;
        try { o = JSON.parse(localStorage.getItem('desktop.taskmgr') || 'null'); } catch (e) { o = null; }
        if (!o || typeof o !== 'object') return;
        if (o.interval && INTERVALS.indexOf(+o.interval) !== -1) cfg.interval = +o.interval;
        if (o.cols && typeof o.cols === 'object') {
            for (var k in cfg.cols) {
                if (o.cols[k] !== undefined) cfg.cols[k] = o.cols[k] ? 1 : 0;
            }
        }
        if (o.w && typeof o.w === 'object') {
            // older builds stored blanket defaults; a map identical to DEF_W
            // means "never actually resized", so keep auto-fit
            var same = true;
            for (var wchk in DEF_W) {
                if (o.w[wchk] !== undefined && o.w[wchk] !== DEF_W[wchk]) { same = false; break; }
            }
            MODE = same ? 'fit' : 'px';
            for (var wk in DEF_W) {
                if (typeof o.w[wk] === 'number' && o.w[wk] >= W_MIN && o.w[wk] <= W_MAX) {
                    cfg.w[wk] = Math.round(o.w[wk]);
                }
            }
        }
        // the name column is the identity of a row: always on
        cfg.cols.process = 1;
    })();
    // the global auto-refresh switch (taskbar, bottom-right) owns the
    // cadence: this page follows it instead of keeping a second switch
    var autoOn = true;
    (function() {
        try {
            if (window.parent && window.parent !== window) {
                var pb = window.parent.document.getElementById('btn-auto-refresh');
                if (pb && pb.classList) autoOn = pb.classList.contains('on');
            }
        } catch (e) {}
    })();
    function saveCfg() {
        try {
            // while in fit mode the default map is not "user widths": storing
            // it would flip the next load into px mode for no reason
            var o = { interval: cfg.interval, cols: cfg.cols };
            if (MODE === 'px') o.w = cfg.w;
            localStorage.setItem('desktop.taskmgr', JSON.stringify(o));
        } catch (e) {}
    }

    function cmpStr(a, b) {
        var x = String(a == null ? '' : a).toLowerCase();
        var y = String(b == null ? '' : b).toLowerCase();
        return x < y ? -1 : (x > y ? 1 : 0);
    }
    // ascending comparators; dir multiplies
    var cmp = {
        pid:     function(a, b) { return a.pid - b.pid; },
        process: function(a, b) { return cmpStr(a.comm, b.comm); },
        path:    function(a, b) { return cmpStr(a.path, b.path); },
        user:    function(a, b) { return cmpStr(a.user, b.user); },
        state:   function(a, b) { return cmpStr(a.state, b.state); },
        cpu:     function(a, b) { return (a._pct || 0) - (b._pct || 0); },
        memory:  function(a, b) { return (a.rss_kb || 0) - (b.rss_kb || 0); },
        ports:   function(a, b) { return (a._np || 0) - (b._np || 0); }
    };

    function draw(id, arr, color) {
        var cv = document.getElementById(id);
        if (!cv || !cv.getContext) return;
        var ctx = cv.getContext('2d');
        ctx.clearRect(0, 0, cv.width, cv.height);
        if (arr.length < 2) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        var steps = Math.max(arr.length, MAX) - 1;
        for (var i = 0; i < arr.length; i++) {
            var x = cv.width - 1 - (arr.length - 1 - i) * (cv.width - 2) / steps;
            var v = Math.max(0, Math.min(100, arr[i]));
            var y = cv.height - 1.5 - (v / 100) * (cv.height - 3);
            if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.stroke();
    }

    function fmtMb(kb) {
        var mb = (kb || 0) / 1024;
        return (mb < 100 ? mb.toFixed(1) : String(Math.round(mb))) + ' MB';
    }

    // diff vs the previous poll, paint the monitors, remember the snapshot.
    // self-owned cadence: stops when the window is closed (iframe gone) or
    // hidden/minimized (document.hidden), never occupies a shell timer.
    function compute(j) {
        var dT = (prev && j.ticks_total > prev.ticks) ? (j.ticks_total - prev.ticks) : 0;
        var busy = null;
        var jfMap = {};
        var list = j.list.slice(0);
        for (var i = 0; i < list.length; i++) {
            var p = list[i];
            if (dT > 0) {
                var pct = Math.max(0, p.jf - (prev.jf[p.pid] || 0)) * 100 / dT;
                p._pct = pct;
                busy = (busy || 0) + pct;
            }
            jfMap[p.pid] = p.jf;
        }
        var memTotal = j.mem_total_kb || 0, memAvail = j.mem_avail_kb || 0;
        var memPct = memTotal > 0 ? (memTotal - memAvail) * 100 / memTotal : null;
        if (busy !== null) {
            cpuArr.push(busy);
            if (cpuArr.length > MAX) cpuArr.shift();
        }
        if (memPct !== null) {
            memArr.push(memPct);
            if (memArr.length > MAX) memArr.shift();
        }
        document.getElementById('cpu-val').textContent =
            busy === null ? '–' : busy.toFixed(0) + '%';
        document.getElementById('mem-val').textContent =
            memPct === null ? '–' : memPct.toFixed(0) + '%';
        if (memTotal > 0) {
            document.getElementById('mem-val').title =
                fmtMb(memTotal - memAvail) + ' / ' + fmtMb(memTotal);
        }
        draw('cpu-graph', cpuArr, '#4a90d9');
        draw('mem-graph', memArr, '#2e7d32');
        prev = { ticks: j.ticks_total || 0, jf: jfMap };
        last = { list: list, ports: j.ports || [] };
    }

    // filter -> sort -> paint (re-run on every poll, and on live
    // filter input / header clicks / column toggles without refetching)
    function fmtAddr(p) {
        var a = p.addr || '';
        var isV6 = a.indexOf(':') !== -1;
        return (isV6 ? '[' + a + ']' : a) + ':' + (p.port != null ? p.port : '?');
    }
    // sockets are attached to rows per process in render(); pid is the join
    // key (netstat program names can differ from the /proc comm), and
    // pid-less kernel sockets aggregate on an em-dash tail row
    function render() {
        if (!last) return;
        var all = last.ports || [];
        var allByPid = {};   // pid -> every socket of that pid
        var hitByPid = {};   // pid -> sockets that themselves hit the filter
        var kernHit = [];    // pid-less sockets that hit the filter
        var i, pt;
        for (i = 0; i < all.length; i++) {
            pt = all[i];
            if (pt.pid != null) {
                if (!allByPid[pt.pid]) allByPid[pt.pid] = [];
                allByPid[pt.pid].push(pt);
            }
        }
        for (i = 0; i < all.length; i++) {
            pt = all[i];
            if (filter) {
                // a socket matches when its own details hit the filter:
                // program name, address, port number or pid
                var pn = String(pt.port == null ? '' : pt.port);
                var pd = String(pt.pid == null ? '' : pt.pid);
                var phit = String(pt.proc || '').toLowerCase().indexOf(filter) !== -1
                    || String(pt.addr || '').toLowerCase().indexOf(filter) !== -1
                    || pn.indexOf(filter) !== -1
                    || pd.indexOf(filter) !== -1;
                if (!phit) continue;
            }
            if (pt.pid != null) {
                if (!hitByPid[pt.pid]) hitByPid[pt.pid] = [];
                hitByPid[pt.pid].push(pt);
            } else {
                kernHit.push(pt);
            }
        }
        // chip html is rebuilt on every render (poll / filter / sort /
        // column toggle) from `last.ports` so no refetch is needed
        function chipHtml(ports) {
            ports = ports.slice(0).sort(function(a, b) {
                return cmpStr(String(a.addr), String(b.addr))
                    || ((a.port || 0) - (b.port || 0))
                    || cmpStr(String(a.proto), String(b.proto));
            });
            var h = '';
            for (var c = 0; c < ports.length; c++) {
                h += '<span class="pk"><span class="p">' + esc(ports[c].proto)
                    + '</span> ' + esc(fmtAddr(ports[c])) + '</span>';
            }
            return h;
        }
        // collapsed view: up to LIST_LIMIT chips, then a "+N" chip that
        // expands the row (the "-" chip collapses it back); openPids keeps
        // user intent across polls and re-sorts
        function portsCell(mp, key) {
            if (mp.length > LIST_LIMIT) {
                if (openPids[key]) {
                    return chipHtml(mp)
                        + '<span class="pk more" data-k="' + key + '">-</span>';
                }
                return chipHtml(mp.slice(0, LIST_LIMIT))
                    + '<span class="pk more" data-k="' + key + '">+'
                    + (mp.length - LIST_LIMIT) + '</span>';
            }
            return chipHtml(mp);
        }
        var v = last.list;
        for (i = 0; i < v.length; i++) {
            var q = v[i];
            var fieldHit = true;
            if (filter) {
                fieldHit = String(q.pid).indexOf(filter) !== -1
                    || String(q.comm || '').toLowerCase().indexOf(filter) !== -1
                    || String(q.user || '').toLowerCase().indexOf(filter) !== -1
                    || String(q.cmd || '').toLowerCase().indexOf(filter) !== -1
                    || String(q.path || '').toLowerCase().indexOf(filter) !== -1;
            }
            // one rule for every query: the port column always shows what
            // this pid owns; the filter only decides which rows stay visible
            var mp = allByPid[q.pid] || [];
            q._chips = mp;
            q._np = mp.length;
            // a row stays visible when its own fields match the filter OR
            // when one of its sockets matches
            var hs = hitByPid[q.pid];
            q._keep = fieldHit || (hs && hs.length > 0);
        }
        if (filter) {
            v = v.filter(function(p) { return p._keep; });
        }
        var c = cmp[sort.key];
        v = v.slice(0).sort(function(a, b) { return c(a, b) * sort.dir; });
        var out = '';
        for (var k = 0; k < v.length; k++) {
            var q = v[k];
            var cell = q._pct === undefined ? '–' : q._pct.toFixed(1) + '%';
            out += '<tr data-pid="' + q.pid + '"' + (q.state === 'Z' ? ' class="zombie"' : '') + '>'
                + '<td class="c-pid">' + String(q.pid) + '</td>'
                + '<td class="c-process name" title="' + esc(q.cmd || q.comm || '') + '">' + esc(q.comm || q.cmd || '?') + '</td>'
                + '<td class="c-path" title="' + esc(q.path || '') + '">' + esc(q.path || '–') + '</td>'
                + '<td class="c-user">' + esc(q.user || '?') + '</td>'
                + '<td class="c-state' + (q.state === 'Z' ? ' state-z' : '') + '">' + esc(q.state || '?') + '</td>'
                + '<td class="c-cpu num">' + cell + '</td>'
                + '<td class="c-memory num">' + fmtMb(q.rss_kb) + '</td>'
                + '<td class="c-ports">' + portsCell(q._chips || [], String(q.pid)) + '</td>'
                + '</tr>';
        }
        // kernel-owned sockets (pid unknown) get their own tail row
        if (kernHit.length) {
            out += '<tr>'
                + '<td class="c-pid">—</td>'
                + '<td class="c-process name">' + esc(txt.kernel) + '</td>'
                + '<td class="c-path">—</td>'
                + '<td class="c-user">—</td>'
                + '<td class="c-state">—</td>'
                + '<td class="c-cpu num">—</td>'
                + '<td class="c-memory num">—</td>'
                + '<td class="c-ports">' + portsCell(kernHit, 'k') + '</td>'
                + '</tr>';
        }
        if (!v.length && !kernHit.length) {
            var ncols = 0;
            for (var m in cfg.cols) if (cfg.cols[m]) ncols++;
            out = '<tr><td colspan="' + ncols + '">–</td></tr>';
        }
        document.getElementById('tbody').innerHTML = out;
        if (selectedPid) {
            var selTr = document.querySelector('#tbody tr[data-pid="' + selectedPid + '"]');
            if (selTr) selTr.className += ' sel';
        }
        document.getElementById('count').textContent =
            txt.tasks.replace('%d', v.length);
        paintHdr();
        paintCols();
    }

    // clickable column headers (arrow appended to the server-baked label)
    var hdr = {};
    (function() {
        var ths = document.querySelectorAll('thead th[data-key]');
        for (var i = 0; i < ths.length; i++) {
            (function(th) {
                var key = th.getAttribute('data-key');
                hdr[key] = th.textContent;
                // header content becomes [label span][drag handle]; paintHdr
                // then only rewrites the label and never wipes the handle
                th.textContent = '';
                var lbl = document.createElement('span');
                lbl.className = 'lbl';
                lbl.textContent = hdr[key];
                th.appendChild(lbl);
                th.addEventListener('click', function() {
                    if (Date.now() - lastDragEnd < 250) return;   // that was a drag, not a sort click
                    if (sort.key === key) {
                        sort.dir = -sort.dir;
                    } else {
                        sort.key = key;
                        sort.dir = (key === 'cpu' || key === 'memory' || key === 'pid') ? -1 : 1;
                    }
                    render();
                });
            })(ths[i]);
        }
    })();
    function paintHdr() {
        var ths = document.querySelectorAll('thead th[data-key]');
        for (var i = 0; i < ths.length; i++) {
            var key = ths[i].getAttribute('data-key');
            var arrow = (key === sort.key) ? (sort.dir < 0 ? ' ↓' : ' ↑') : '';
            var lbl = ths[i].querySelector('span.lbl');
            if (lbl) lbl.textContent = hdr[key] + arrow;
        }
    }
    // column visibility: idempotent class toggling on th + td
    function paintCols() {
        var ths = document.querySelectorAll('thead th[data-key]');
        for (var i = 0; i < ths.length; i++) {
            var key = ths[i].getAttribute('data-key');
            ths[i].classList.toggle('col-off', !cfg.cols[key]);
        }
        var tbody = document.getElementById('tbody');
        for (var ck in cfg.cols) {
            var tds = tbody.querySelectorAll('td.c-' + ck);
            for (var j = 0; j < tds.length; j++) {
                tds[j].classList.toggle('col-off', !cfg.cols[ck]);
            }
        }
        applyWidths();   // hidden columns drop out of the table width
    }

    // ---- resizable columns ----------------------------------------------
    // th widths are explicit px (layout is fixed), the table width equals
    // the visible sum, and the wrapper scrolls horizontally. Drag the
    // handle at a header's right edge; double-click resets that column.
    function widthOf(key) {
        var w = cfg.w[key];
        return (w && w >= W_MIN && w <= W_MAX) ? w : DEF_W[key];
    }
    function applyWidths() {
        if (!tbl) return;
        var ths = document.querySelectorAll('thead th[data-key]');
        if (MODE === 'fit') {
            // share the window width, keeping the designed proportions;
            // percentage widths re-flow on their own when the window resizes
            var parts = {};
            var sum = 0;
            for (var i = 0; i < ths.length; i++) {
                var key = ths[i].getAttribute('data-key');
                if (cfg.cols[key]) { parts[key] = DEF_W[key]; sum += DEF_W[key]; }
            }
            if (!sum) return;
            // visible columns share the width by designed proportion; the
            // LAST visible one gets no explicit width and therefore absorbs
            // the exact remainder — the table always really reaches the
            // right edge, no rounding residue at the end
            var vis = [];
            for (var i = 0; i < ths.length; i++) {
                var k3 = ths[i].getAttribute('data-key');
                if (cfg.cols[k3]) vis.push(ths[i]);
            }
            for (var j = 0; j < ths.length; j++) {
                var k2 = ths[j].getAttribute('data-key');
                if (vis.indexOf(ths[j]) === -1) { ths[j].style.width = ''; continue; }
            }
            for (var j3 = 0; j3 < vis.length - 1; j3++) {
                var k4 = vis[j3].getAttribute('data-key');
                vis[j3].style.width = ((DEF_W[k4] * 100 / sum).toFixed(2) + '%');
            }
            if (vis.length) vis[vis.length - 1].style.width = '';
            tbl.style.width = '';
            return;
        }
        var sum2 = 0;
        for (var i2 = 0; i2 < ths.length; i2++) {
            var key2 = ths[i2].getAttribute('data-key');
            var w2 = widthOf(key2);
            ths[i2].style.width = w2 + 'px';
            if (cfg.cols[key2]) sum2 += w2;
        }
        tbl.style.width = sum2 ? (sum2 + 'px') : '';
    }
    (function() {
        if (!tbl) return;
        var ths = document.querySelectorAll('thead th[data-key]');
        for (var i = 0; i < ths.length; i++) {
            (function(th) {
                var key = th.getAttribute('data-key');
                var h = document.createElement('span');
                h.className = 'drag';
                h.addEventListener('mousedown', function(ev) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    if (MODE === 'fit') {
                        // first user drag: freeze the rendered auto-fit layout
                        // into exact px (hidden columns fall back to their
                        // default width if re-shown later)
                        var all = document.querySelectorAll('thead th[data-key]');
                        for (var wk = 0; wk < all.length; wk++) {
                            var k2 = all[wk].getAttribute('data-key');
                            cfg.w[k2] = cfg.cols[k2]
                                ? Math.round(all[wk].getBoundingClientRect().width)
                                : DEF_W[k2];
                        }
                        MODE = 'px';
                        applyWidths();
                        saveCfg();
                    }
                    var sx = ev.clientX, sw = widthOf(key);
                    h.classList.add('drag-active');
                    document.body.classList.add('col-resizing');
                    function moving(e2) {
                        var w = Math.max(W_MIN, Math.min(W_MAX, sw + e2.clientX - sx));
                        if (cfg.w[key] !== w) {
                            cfg.w[key] = w;
                            applyWidths();
                        }
                    }
                    function done() {
                        document.removeEventListener('mousemove', moving);
                        document.removeEventListener('mouseup', done);
                        h.classList.remove('drag-active');
                        document.body.classList.remove('col-resizing');
                        lastDragEnd = Date.now();   // the synthetic click right after must not re-sort
                        saveCfg();
                    }
                    document.addEventListener('mousemove', moving);
                    document.addEventListener('mouseup', done);
                });
                h.addEventListener('dblclick', function(ev) {
                    ev.preventDefault();
                    delete cfg.w[key];
                    saveCfg();
                    applyWidths();
                });
                th.appendChild(h);
            })(ths[i]);
        }
        applyWidths();
    })();

    var fEl = document.getElementById('filter');
    if (fEl) fEl.addEventListener('input', function() {
        filter = String(fEl.value || '').trim().toLowerCase();
        render();
    });

    // "+N" expands / collapsed "-" re-folds one port cell; delegation on the
    // table body survives row html rewrites. A plain click on any other part
    // of a row (or a right click) opens the per-process detail drawer.
    document.getElementById('tbody').addEventListener('click', function(ev) {
        var t = ev.target;
        if (t && t.classList && t.classList.contains('more')) {
            var k = t.getAttribute('data-k');
            if (!k) return;
            if (openPids[k]) delete openPids[k];
            else openPids[k] = 1;
            render();
            return;
        }
        var tr = t && t.closest ? t.closest('tr') : null;
        var pid = tr && tr.getAttribute('data-pid');
        if (pid) openDetail(parseInt(pid, 10));
    });
    document.getElementById('tbody').addEventListener('contextmenu', function(ev) {
        var tr = ev.target && ev.target.closest ? ev.target.closest('tr') : null;
        var pid = tr && tr.getAttribute('data-pid');
        if (!pid) return;
        ev.preventDefault();
        openDetail(parseInt(pid, 10));
    });

    // ---- per-process detail drawer -------------------------------------
    var dr = document.getElementById('dr');
    var drBody = document.getElementById('dr-body');
    var drTitle = document.getElementById('dr-title');
    function fmtBytes(n) {
        if (n == null) return '–';
        var u = ['B', 'KB', 'MB', 'GB', 'TB'], i = 0, v = n;
        while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
        return (i === 0 ? Math.round(v) : v.toFixed(v < 10 ? 1 : 0)) + ' ' + u[i];
    }
    function fmtDur(s) {
        if (s == null || s < 0) return '–';
        s = Math.round(s);
        var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
        if (d) return d + 'd ' + h + 'h';
        if (h) return h + 'h ' + m + 'm';
        if (m) return m + 'm ' + (s % 60) + 's';
        return s + 's';
    }
    function fmtTime(epoch) {
        if (!epoch) return '–';
        var t = new Date(epoch * 1000);
        var p = function(n) { return (n < 10 ? '0' : '') + n; };
        return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate())
            + ' ' + p(t.getHours()) + ':' + p(t.getMinutes());
    }
    function kv(k, v) {
        return '<div>' + esc(k) + '</div><div>' + v + '</div>';
    }
    function renderDetail(d) {
        if (!d || !d.ok) {
            drBody.innerHTML = '<div class="dr-empty">' + esc(txt.noProc) + '</div>';
            return;
        }
        drTitle.textContent = 'PID ' + d.pid + ' · ' + (d.name || '?');
        var h = '<div class="dr-sec"><h3>' + esc(txt.overview) + '</h3><div class="dr-kv">'
            + kv('PID', String(d.pid))
            + kv(txt.parentPid, d.ppid == null ? '–' : String(d.ppid))
            + kv(txt.threads, d.threads == null ? '–' : String(d.threads))
            + kv(txt.started, esc(fmtTime(d.started_epoch)))
            + kv(txt.cpuTime, esc(fmtDur(((d.utime || 0) + (d.stime || 0)) / 100)))
            + kv(txt.nice, d.nice == null ? '–' : String(d.nice))
            + kv('VSZ', esc(fmtBytes((d.vsz_kb || 0) * 1024)))
            + kv('RSS', esc(fmtBytes((d.rss_kb || 0) * 1024)))
            + kv(txt.ioRead, d.io && d.io.read_bytes != null ? esc(fmtBytes(d.io.read_bytes)) : '–')
            + kv(txt.ioWrite, d.io && d.io.write_bytes != null ? esc(fmtBytes(d.io.write_bytes)) : '–')
            + kv(txt.cwd, esc(d.cwd || '–'))
            + kv(txt.exe, esc(d.exe || '–'))
            + '</div></div>';
        h += '<div class="dr-sec"><h3>' + esc(txt.cmdline) + '</h3><div class="dr-cmd">'
            + esc(d.cmdline || ('[' + (d.name || '') + ']')) + '</div></div>';
        h += '<div class="dr-sec"><h3>' + esc(txt.files) + ' (' + (d.fd_count || 0) + ')</h3>';
        if (!d.fds || !d.fds.length) {
            h += '<div class="dr-empty">' + esc(txt.noData) + '</div>';
        } else {
            h += '<table class="dr-tbl">';
            var lim = Math.min(d.fds.length, 200);
            for (var i = 0; i < lim; i++) {
                var f = d.fds[i];
                h += '<tr><td class="fd">' + f.fd + '</td><td class="ty">' + esc(f.type)
                    + '</td><td title="' + esc(f.target) + '">' + esc(f.target) + '</td></tr>';
            }
            h += '</table>';
            if (d.fds.length > lim) {
                h += '<div class="dr-empty">+' + (d.fds.length - lim) + '</div>';
            }
        }
        h += '</div>';
        h += '<div class="dr-sec"><h3>' + esc(txt.socks) + ' (' + (d.sockets ? d.sockets.length : 0) + ')</h3>';
        if (!d.sockets || !d.sockets.length) {
            h += '<div class="dr-empty">' + esc(txt.noData) + '</div>';
        } else {
            h += '<table class="dr-tbl"><tbody>';
            var sl = Math.min(d.sockets.length, 200);
            for (var s = 0; s < sl; s++) {
                var so = d.sockets[s];
                h += '<tr title="' + esc(so.proto + ' ' + so.local_addr + ' -> ' + so.remote_addr + ' ' + (so.state || '')) + '">'
                    + '<td class="ty">' + esc(so.proto) + '</td>'
                    + '<td>' + esc(so.local_addr) + '</td>'
                    + '<td>' + esc(so.remote_addr) + '</td>'
                    + '<td class="st">' + esc(so.state || '') + '</td></tr>';
            }
            h += '</tbody></table>';
        }
        h += '</div>';
        if (!envShown) {
            h += '<div class="dr-sec"><button class="dr-btn" id="dr-env">' + esc(txt.showEnv) + '</button></div>';
        } else if (d.env && d.env.length) {
            h += '<div class="dr-sec"><h3>' + esc(txt.env) + ' (' + d.env.length + ')</h3><div class="dr-cmd">'
                + esc(d.env.join('\n')) + '</div></div>';
        }
        drBody.innerHTML = h;
        var envBtn = document.getElementById('dr-env');
        if (envBtn) envBtn.addEventListener('click', function() {
            envShown = true;
            fetchDetail();
        });
    }
    function fetchDetail() {
        if (!selectedPid) return;
        var x = new XMLHttpRequest();
        x.open('GET', '/cgi-bin/luci/admin/desktop/proc_detail?pid=' + selectedPid + (envShown ? '&env=1' : ''), true);
        x.onload = function() {
            if (!selectedPid) return;
            var j = null;
            try { j = JSON.parse(x.responseText); } catch (e) {}
            renderDetail(j || { ok: false });
        };
        x.onerror = function() {
            drBody.innerHTML = '<div class="dr-empty">' + esc(txt.failed) + '</div>';
        };
        x.send();
    }
    function openDetail(pid) {
        selectedPid = pid;
        envShown = false;
        dr.hidden = false;
        render();
        fetchDetail();
    }
    function closeDetail() {
        selectedPid = null;
        envShown = false;
        dr.hidden = true;
        render();
    }
    document.getElementById('dr-close').addEventListener('click', closeDetail);
    document.addEventListener('keydown', function(ev) {
        if (ev.key === 'Escape' && selectedPid) closeDetail();
    });

    var gear = document.getElementById('gear');
    var panel = document.getElementById('panel');
    if (gear && panel) {
        gear.addEventListener('click', function() {
            panel.hidden = !panel.hidden;
        });
        document.addEventListener('mousedown', function(e) {
            if (panel.hidden) return;
            if (e.target === gear || panel.contains(e.target)) return;
            panel.hidden = true;
        });
    }

    var sel = document.getElementById('set-interval');
    var errEl = document.getElementById('err');
    function paintPaused() {
        if (errEl) errEl.textContent = autoOn ? '' : txt.paused;
    }
    paintPaused();
    if (sel) sel.disabled = !autoOn;
    // the shell rebroadcasts the taskbar switch to every iframe on toggle;
    // this page has no switch of its own and just follows the global one
    window.addEventListener('message', function(ev) {
        var d = ev.data;
        if (!d || d.type !== 'set-auto-refresh') return;
        autoOn = !!d.on;
        if (sel) sel.disabled = !autoOn;
        armPoll();
        if (autoOn) poll();
        paintPaused();
    });
    // a tab restored from the back/forward cache still runs its old
    // script and old timers: reload once so a stale snapshot cannot
    // masquerade as a live one after the toggle was turned off
    window.addEventListener('pageshow', function(ev) {
        if (ev.persisted) location.reload();
    });

    if (sel) {
        sel.value = String(cfg.interval);
        sel.addEventListener('change', function() {
            var v = parseInt(sel.value, 10);
            if (INTERVALS.indexOf(v) === -1) v = 4000;
            cfg.interval = v;
            saveCfg();
            armPoll();
            if (autoOn) poll();
        });
    }
    (function() {
        var box = document.getElementById('set-cols');
        if (!box) return;
        var ths = document.querySelectorAll('thead th[data-key]');
        for (var i = 0; i < ths.length; i++) {
            var key = ths[i].getAttribute('data-key');
            var lab = document.createElement('label');
            var chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.checked = !!cfg.cols[key];
            // the name column is forced on — a table without rows' identity
            // reads as an empty page
            chk.disabled = (key === 'process');
            lab.appendChild(chk);
            lab.appendChild(document.createTextNode(
                String(hdr[key] || key).replace(/ [↑↓]$/, '')));
            box.appendChild(lab);
            (function(chk2, key2) {
                chk2.addEventListener('change', function() {
                    cfg.cols[key2] = chk2.checked ? 1 : 0;
                    saveCfg();
                    render();
                });
            })(chk, key);
        }
    })();

    var tpid = null;
    var painted = false;   // the first snapshot always paints, even with the global switch off
    function armPoll() {
        if (tpid) clearInterval(tpid);
        tpid = null;
        // the global auto-refresh switch stops the cadence entirely: no timer
        // while off, and the snapshot stays frozen until re-enabled
        if (!autoOn) return;
        tpid = setInterval(poll, cfg.interval);
    }

    function poll() {
        if (document.hidden) return;
        var x = new XMLHttpRequest();
        x.open('GET', '/cgi-bin/luci/admin/desktop/tasklist', true);
        x.onload = function() {
            // a request already in flight when the switch went OFF: drop it,
            // the whole page stays frozen (data, order, graphs) until re-enabled
            // (the very first snapshot still paints, so a page opened while
            // the switch is off is not left blank)
            if (!autoOn && painted) return;
            var j = null;
            try { j = JSON.parse(x.responseText); } catch (e) {}
            if (!j || !j.list) {
                document.getElementById('err').textContent = txt.failed;
                return;
            }
            compute(j);
            render();
            painted = true;
            paintPaused();
            if (selectedPid) fetchDetail();
        };
        x.onerror = function() {
            document.getElementById('err').textContent = txt.failed;
        };
        x.send();
    }
    armPoll();
    poll();
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
