-- LuCI Desktop Theme — Version Compatibility Layer
--
-- Abstracts differences between Lua-based (pre-24.10) and ucode-based
-- (24.10+) LuCI dispatchers. Exposes a single render_menu_json(category)
-- that outputs the menu tree as a JSON string in the format expected
-- by the desktop shell's LuCIMenuData.
--
-- Copyright 2026 DMKLIGHT
-- Licensed under the Apache License v2.0

module("luci.desktop.compat", package.seeall)

local disp = require "luci.dispatcher"
local i18n = require "luci.i18n"
local util = require "luci.util"


-- ===== Helpers =====

local function json_escape(s)
    return (s:gsub('\\', '\\\\')
             :gsub('"', '\\"')
             :gsub('\n', '\\n')
             :gsub('\r', '\\r')
             :gsub('\t', '\\t'))
end

local function tr(title)
    return util.striptags(i18n.translate(title))
end

-- Convert a ucode action object to a URL path prefix (string segments).
-- Returns the action.path split into segments, or nil if not navigable.
local function action_segments(action)
    if type(action) ~= "table" then return nil end
    if action.type == "firstchild" then return nil end
    if not action.path then return nil end
    local segs = {}
    for s in action.path:gmatch("[^/]+") do
        segs[#segs + 1] = s
    end
    if #segs == 0 then return nil end
    return segs
end

-- Build a URL from tree path segments.
-- Path segments from tree traversal take priority; action.path is a fallback.
local function tree_url(category, parent_name, child_name, node)
    -- If we have tree-path segments, use those directly
    if child_name then
        return disp.build_url(category, parent_name, child_name)
    elseif parent_name then
        return disp.build_url(category, parent_name)
    end
    -- Fallback: action.path for orphan nodes
    local segs = action_segments(node and node.action)
        or action_segments(node and node.wildcardaction)
    if segs then
        return disp.build_url(unpack(segs))
    end
    return nil
end


-- ===== Old Lua dispatcher (pre-24.10) =====

local function render_lua(category)
    local tree = disp.node()
    local childs = disp.node_childs(tree)

    -- Drill into single top-level node (admin) to get real categories
    if #childs == 1 and tree.nodes[childs[1]] then
        tree = tree.nodes[childs[1]]
        childs = disp.node_childs(tree)
    end

    local parts = {}
    for _, r in ipairs(childs) do
        local nnode = tree.nodes[r]
        if nnode.title and nnode.title ~= "" and r ~= "logout" then
            local entry = {
                title = json_escape(tr(nnode.title)),
                id    = json_escape(r),
            }

            local grandchildren = disp.node_childs(nnode)
            if #grandchildren > 0 then
                local subs = {}
                for _, s in ipairs(grandchildren) do
                    local snode = nnode.nodes[s]
                    if snode.title and snode.title ~= "" and not snode.hidden then
                        subs[#subs + 1] = string.format(
                            '{"title":"%s","href":"%s"}',
                            json_escape(tr(snode.title)),
                            json_escape(disp.build_url(category, r, s)))
                    end
                end
                if #subs > 0 then
                    entry.subs = "[" .. table.concat(subs, ",") .. "]"
                end
            else
                entry.href = json_escape(disp.build_url(category, r))
            end

            local e = string.format('{"title":"%s","id":"%s"', entry.title, entry.id)
            if entry.subs then
                e = e .. ',"subs":' .. entry.subs
            elseif entry.href then
                e = e .. ',"href":"' .. entry.href .. '"'
            end
            e = e .. "}"
            parts[#parts + 1] = e
        end
    end

    return "[" .. table.concat(parts, ",") .. "]"
end


-- ===== New ucode dispatcher (24.10+) =====

local function render_ucode(category)
    local tree = disp.menu_json()

    -- Drill into the category path segment (e.g. "admin")
    if tree.children and tree.children[category] then
        tree = tree.children[category]
    end

    local function sorted_children(node)
        if not node.children then return {} end
        local items = {}
        for name, child in pairs(node.children) do
            if child.satisfied ~= false and child.title and child.title ~= "" then
                items[#items + 1] = { name = name, node = child }
            end
        end
        table.sort(items, function(a, b)
            return (a.node.order or 100) < (b.node.order or 100)
        end)
        return items
    end

    local parts = {}
    local top_items = sorted_children(tree)

    for _, item in ipairs(top_items) do
        if item.name ~= "logout" then
            local node = item.node
            local entry = {
                title = json_escape(tr(node.title)),
                id    = json_escape(item.name),
            }

            local function build_entry(cat, parent_name, child_name, child_node)
                local child_subs = sorted_children(child_node)
                if #child_subs > 0 then
                    -- This node has children: recurse
                    local sub_parts = {}
                    for _, gci in ipairs(child_subs) do
                        local href = tree_url(cat, parent_name, gci.name, gci.node)
                        if href then
                            sub_parts[#sub_parts + 1] = string.format(
                                '{"title":"%s","href":"%s"}',
                                json_escape(tr(gci.node.title)),
                                json_escape(href))
                        end
                    end
                    if #sub_parts > 0 then
                        return string.format(
                            '{"title":"%s","id":"%s","subs":[%s]}',
                            json_escape(tr(child_node.title)),
                            json_escape(child_name),
                            table.concat(sub_parts, ","))
                    end
                end
                -- Leaf node
                local href = tree_url(cat, parent_name, child_name, child_node)
                if href then
                    return string.format(
                        '{"title":"%s","href":"%s"}',
                        json_escape(tr(child_node.title)),
                        json_escape(href))
                end
                return nil
            end

            local sub_items = sorted_children(node)
            if #sub_items > 0 then
                local subs = {}
                for _, si in ipairs(sub_items) do
                    local entry = build_entry(category, item.name, si.name, si.node)
                    if entry then
                        subs[#subs + 1] = entry
                    end
                end
                if #subs > 0 then
                    entry.subs = "[" .. table.concat(subs, ",") .. "]"
                else
                    entry.href = json_escape(tree_url(category, item.name, nil, node) or "")
                end
            else
                local href = tree_url(category, item.name, nil, node)
                if href then
                    entry.href = json_escape(href)
                end
            end

            local e = string.format('{"title":"%s","id":"%s"', entry.title, entry.id)
            if entry.subs then
                e = e .. ',"subs":' .. entry.subs
            elseif entry.href then
                e = e .. ',"href":"' .. entry.href .. '"'
            end
            e = e .. "}"
            parts[#parts + 1] = e
        end
    end

    return "[" .. table.concat(parts, ",") .. "]"
end


-- ===== Sibling tabs (embedded mode) =====

local function _render_sibling_tabs_ucode(request, pcdata_fn)
    local tree = disp.menu_json()
    local parent = tree

    -- Walk to the parent of the current page
    for i = 1, #request - 1 do
        if parent.children and parent.children[request[i]] then
            parent = parent.children[request[i]]
        else
            return ""
        end
    end

    local current = request[#request]
    local siblings = {}
    for name, child in pairs(parent.children or {}) do
        if child.satisfied ~= false and child.title and child.title ~= "" then
            siblings[#siblings + 1] = {name = name, title = child.title, order = child.order or 100}
        end
    end
    if #siblings <= 1 then return "" end

    table.sort(siblings, function(a, b) return a.order < b.order end)

    local segs = {}
    for i = 1, #request - 1 do segs[#segs + 1] = request[i] end

    local parts = {'<ul class="tabs">'}
    for _, sib in ipairs(siblings) do
        local active = (sib.name == current) and ' active' or ''
        local href = disp.build_url(unpack(segs), sib.name)
        parts[#parts + 1] = string.format(
            '<li class="tabmenu-item-%s%s"><a href="%s">%s</a></li>',
            sib.name, active,
            pcdata_fn and pcdata_fn(href) or href,
            util.striptags(i18n.translate(sib.title)))
    end
    parts[#parts + 1] = '</ul>'
    return table.concat(parts)
end

local function _render_sibling_tabs_lua(request, write_fn, pcdata_fn)
    local parent = disp.node()
    for i = 1, #request - 1 do
        if parent and parent.nodes then
            parent = parent.nodes[request[i]]
        else
            parent = nil
            break
        end
    end
    if not parent then return "" end

    local siblings = disp.node_childs(parent)
    if #siblings <= 1 then return "" end

    local prefix = table.concat(request, "/", 1, #request - 1)
    local parts = {'<ul class="tabs">'}
    for _, t in ipairs(siblings) do
        local tnode = parent.nodes[t]
        if tnode and tnode.title and tnode.title ~= "" then
            local active = (t == request[#request]) and ' active' or ''
            local href = disp.build_url(prefix .. "/" .. t)  -- old API: string arg
            parts[#parts + 1] = string.format(
                '<li class="tabmenu-item-%s%s"><a href="%s">%s</a></li>',
                t, active,
                pcdata_fn and pcdata_fn(href) or href,
                util.striptags(i18n.translate(tnode.title)))
        end
    end
    parts[#parts + 1] = '</ul>'
    return table.concat(parts)
end

-- Public dispatcher for sibling tabs. Detects LuCI version automatically.
-- Returns HTML string or "".
function render_sibling_tabs(request, write_fn, pcdata_fn)
    if not request or #request < 4 then return "" end
    if disp.menu_json then
        return _render_sibling_tabs_ucode(request, pcdata_fn)
    else
        return _render_sibling_tabs_lua(request, write_fn, pcdata_fn)
    end
end


-- ===== Public API =====

-- Detect dispatcher version and return menu JSON string.
-- category: the URL path segment (e.g. "admin").
-- Returns a JSON array string matching LuCIMenuData format.
function render_menu_json(category)
    if not category then return "[]" end

    if disp.menu_json then
        return render_ucode(category)
    else
        return render_lua(category)
    end
end
