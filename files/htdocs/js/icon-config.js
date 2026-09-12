/* icon-config.js — router app icon catalog (emoji + category color)
 *
 * Derived from the reference icon config (2026-08-29, 122 entries):
 *   - ICONS: id/title/category/emoji/desc for 122 router-oriented entries
 *   - CATEGORIES/COLORS: category labels and theme colors
 *   - URL_MAP: LuCI url fragment -> icon id (best-effort; unmatched urls
 *     keep the legacy first-letter SVG rendering in desktop.js)
 * Exposed as LuCIDesktop.IconConfig (no window.IconConfig global, no
 * CommonJS export — browser-only theme module).
 */
(function() {
    'use strict';

    var DESKTOP = window.LuCIDesktop;
    if (!DESKTOP) { console.error('icon-config.js: LuCIDesktop namespace not found'); return; }

    // ---------- Categories ----------
    var CATEGORIES = {
        STATUS: '状态监控',
        SYSTEM: '系统管理',
        NETWORK: '网络设置',
        SERVICES: '服务管理',
        STORAGE: '存储管理',
        VPN: 'VPN / 穿透',
        SECURITY: '安全防护',
        TOOLS: '工具助手',
        WIRELESS: '无线网络',
        LOGS: '日志监控',
        ADVANCED: '高级配置',
        DOCKER: '容器 / 虚拟化'
    };

    // ---------- Category theme colors ----------
    var COLORS = {
        [CATEGORIES.STATUS]: '#4CAF50',
        [CATEGORIES.SYSTEM]: '#2196F3',
        [CATEGORIES.NETWORK]: '#00BCD4',
        [CATEGORIES.SERVICES]: '#FF9800',
        [CATEGORIES.STORAGE]: '#9C27B0',
        [CATEGORIES.VPN]: '#3F51B5',
        [CATEGORIES.SECURITY]: '#F44336',
        [CATEGORIES.TOOLS]: '#607D8B',
        [CATEGORIES.WIRELESS]: '#009688',
        [CATEGORIES.LOGS]: '#795548',
        [CATEGORIES.ADVANCED]: '#E91E63',
        [CATEGORIES.DOCKER]: '#00ACC1'
    };

    // ---------- 122 icon entries ----------
    var ICONS = [    
        // ===== 状态监控 (1-8) =====
        { id: 'overview', title: '概览', category: CATEGORIES.STATUS, emoji: '📊', desc: '系统状态总览' },
        { id: 'traffic', title: '流量监控', category: CATEGORIES.STATUS, emoji: '📈', desc: '实时流量图表' },
        { id: 'clients', title: '设备列表', category: CATEGORIES.STATUS, emoji: '📱', desc: '在线设备管理' },
        { id: 'networkmap', title: '网络拓扑', category: CATEGORIES.STATUS, emoji: '🗺️', desc: '网络结构图' },
        { id: 'bandwidth', title: '带宽管理', category: CATEGORIES.STATUS, emoji: '📶', desc: '带宽分配与限速' },
        { id: 'connections', title: '连接追踪', category: CATEGORIES.STATUS, emoji: '🔗', desc: '活动连接列表' },
        { id: 'ping', title: '网络诊断', category: CATEGORIES.STATUS, emoji: '🏓', desc: 'Ping / Traceroute' },
        { id: 'speedtest', title: '测速', category: CATEGORIES.STATUS, emoji: '⚡', desc: '宽带速度测试' },
    
        // ===== 系统管理 (9-20) =====
        { id: 'system', title: '系统设置', category: CATEGORIES.SYSTEM, emoji: '⚙️', desc: '基础系统配置' },
        { id: 'terminal', title: '终端', category: CATEGORIES.SYSTEM, emoji: '💻', desc: 'SSH / 命令行' },
        { id: 'packages', title: '软件包', category: CATEGORIES.SYSTEM, emoji: '📦', desc: 'OPKG 包管理' },
        { id: 'startup', title: '启动项', category: CATEGORIES.SYSTEM, emoji: '🚀', desc: '开机自启服务' },
        { id: 'crontab', title: '计划任务', category: CATEGORIES.SYSTEM, emoji: '⏰', desc: '定时任务管理' },
        { id: 'fstab', title: '挂载点', category: CATEGORIES.SYSTEM, emoji: '💾', desc: '磁盘挂载管理' },
        { id: 'disk', title: '磁盘管理', category: CATEGORIES.SYSTEM, emoji: '🖥️', desc: '分区与格式化' },
        { id: 'flash', title: '固件升级', category: CATEGORIES.SYSTEM, emoji: '🔄', desc: '系统升级' },
        { id: 'backup', title: '备份/恢复', category: CATEGORIES.SYSTEM, emoji: '💾', desc: '配置备份与还原' },
        { id: 'reboot', title: '重启', category: CATEGORIES.SYSTEM, emoji: '🔄', desc: '重启设备' },
        { id: 'logout', title: '注销', category: CATEGORIES.SYSTEM, emoji: '🚪', desc: '退出登录' },
        { id: 'admin', title: '管理权', category: CATEGORIES.SYSTEM, emoji: '🔐', desc: '用户权限管理' },
    
        // ===== 网络设置 (21-34) =====
        { id: 'interfaces', title: '接口', category: CATEGORIES.NETWORK, emoji: '🌐', desc: '网络接口配置' },
        { id: 'dhcp', title: 'DHCP/DNS', category: CATEGORIES.NETWORK, emoji: '📡', desc: 'DHCP 与 DNS 服务' },
        { id: 'hosts', title: '主机名', category: CATEGORIES.NETWORK, emoji: '🏷️', desc: '主机名解析' },
        { id: 'arpbind', title: 'IP/MAC 绑定', category: CATEGORIES.NETWORK, emoji: '🔗', desc: '静态 DHCP 分配' },
        { id: 'routes', title: '静态路由', category: CATEGORIES.NETWORK, emoji: '🚏', desc: '路由表管理' },
        { id: 'firewall', title: '防火墙', category: CATEGORIES.NETWORK, emoji: '🛡️', desc: '防火墙规则' },
        { id: 'nat', title: '端口转发', category: CATEGORIES.NETWORK, emoji: '↔️', desc: 'NAT / 端口映射' },
        { id: 'qos', title: '流量整形', category: CATEGORIES.NETWORK, emoji: '📊', desc: 'QoS 服务质量' },
        { id: 'socat', title: 'Socat 转发', category: CATEGORIES.NETWORK, emoji: '🔁', desc: '端口转发工具' },
        { id: 'multipath', title: '多线负载', category: CATEGORIES.NETWORK, emoji: '🔄', desc: '多 WAN 负载均衡' },
        { id: 'bridge', title: '桥接', category: CATEGORIES.NETWORK, emoji: '🌉', desc: '网络桥接' },
        { id: 'vlan', title: 'VLAN', category: CATEGORIES.NETWORK, emoji: '🏷️', desc: '虚拟局域网' },
        { id: 'wan', title: 'WAN 设置', category: CATEGORIES.NETWORK, emoji: '📤', desc: '外网接口配置' },
        { id: 'lan', title: 'LAN 设置', category: CATEGORIES.NETWORK, emoji: '📥', desc: '内网接口配置' },
    
        // ===== 服务管理 (35-50) =====
        { id: 'adguard', title: 'AdGuard Home', category: CATEGORIES.SERVICES, emoji: '🛑', desc: '广告过滤 DNS' },
        { id: 'passwall', title: 'PassWall 2', category: CATEGORIES.SERVICES, emoji: '🌍', desc: '代理服务管理' },
        { id: 'ssr', title: 'SSR Plus+', category: CATEGORIES.SERVICES, emoji: '🔰', desc: 'ShadowSocksR 管理' },
        { id: 'unblockmusic', title: '网易云解锁', category: CATEGORIES.SERVICES, emoji: '🎵', desc: '解除歌曲限制' },
        { id: 'ddns', title: '动态 DNS', category: CATEGORIES.SERVICES, emoji: '🌍', desc: '域名动态解析' },
        { id: 'wol', title: '网络唤醒', category: CATEGORIES.SERVICES, emoji: '🔔', desc: 'Wake-on-LAN' },
        { id: 'upnp', title: 'UPnP', category: CATEGORIES.SERVICES, emoji: '📡', desc: '即插即用' },
        { id: 'kms', title: 'KMS 服务器', category: CATEGORIES.SERVICES, emoji: '🔑', desc: 'KMS 激活服务' },
        { id: 'ftp', title: 'FTP 服务器', category: CATEGORIES.SERVICES, emoji: '📁', desc: '文件传输服务' },
        { id: 'samba', title: '网络共享', category: CATEGORIES.SERVICES, emoji: '🖥️', desc: 'SMB/CIFS 共享' },
        { id: 'dlna', title: 'miniDLNA', category: CATEGORIES.SERVICES, emoji: '📺', desc: '媒体服务器' },
        { id: 'aria2', title: 'Aria2 下载', category: CATEGORIES.SERVICES, emoji: '⬇️', desc: '下载工具' },
        { id: 'rclone', title: 'Rclone 同步', category: CATEGORIES.SERVICES, emoji: '☁️', desc: '云盘同步' },
        { id: 'nfs', title: 'NFS 管理', category: CATEGORIES.SERVICES, emoji: '📁', desc: '网络文件系统' },
        // --- 代理服务新增 ---
        { id: 'proxy', title: '代理设置', category: CATEGORIES.SERVICES, emoji: '🌍', desc: '系统代理配置' },
        { id: 'bypass', title: '分流规则', category: CATEGORIES.SERVICES, emoji: '🚦', desc: '代理分流规则' },
        { id: 'dns_proxy', title: 'DNS 代理', category: CATEGORIES.SERVICES, emoji: '📡', desc: 'DNS 代理/加密' },
        { id: 'socks5', title: 'SOCKS5 代理', category: CATEGORIES.SERVICES, emoji: '🧦', desc: 'SOCKS5 代理服务' },
        { id: 'http_proxy', title: 'HTTP 代理', category: CATEGORIES.SERVICES, emoji: '🌐', desc: 'HTTP/HTTPS 代理' },
        { id: 'transparent', title: '透明代理', category: CATEGORIES.SERVICES, emoji: '🔄', desc: '透明代理设置' },
    
        // ===== 存储管理 (51-56) =====
        { id: 'fileassistant', title: '文件助手', category: CATEGORIES.STORAGE, emoji: '📂', desc: '文件管理器' },
        { id: 'smb', title: '挂载 SMB', category: CATEGORIES.STORAGE, emoji: '🔗', desc: '挂载远程共享' },
        { id: 'hd_idle', title: '硬盘休眠', category: CATEGORIES.STORAGE, emoji: '💤', desc: '硬盘节能' },
        { id: 'raid', title: 'RAID 管理', category: CATEGORIES.STORAGE, emoji: '⚙️', desc: '磁盘阵列' },
        { id: 'snapshot', title: '快照', category: CATEGORIES.STORAGE, emoji: '📷', desc: '文件系统快照' },
        { id: 'nas', title: 'NAS 设置', category: CATEGORIES.STORAGE, emoji: '🏠', desc: '私有云存储' },
    
        // ===== VPN / 穿透 (57-78) =====
        // --- VPN 核心 ---
        { id: 'vpn', title: 'VPN 管理', category: CATEGORIES.VPN, emoji: '🔒', desc: 'VPN 总览与配置' },
        { id: 'openvpn', title: 'OpenVPN', category: CATEGORIES.VPN, emoji: '🔒', desc: 'OpenVPN 服务端' },
        { id: 'wireguard', title: 'WireGuard', category: CATEGORIES.VPN, emoji: '🛡️', desc: 'WireGuard 管理' },
        { id: 'ipsec', title: 'IPSec VPN', category: CATEGORIES.VPN, emoji: '🔐', desc: 'IPSec 服务器' },
        { id: 'ocserv', title: 'OpenConnect', category: CATEGORIES.VPN, emoji: '🌐', desc: 'Cisco AnyConnect' },
        { id: 'zerotier', title: 'ZeroTier', category: CATEGORIES.VPN, emoji: '🌍', desc: 'SD-WAN 组网' },
        { id: 'tailscale', title: 'Tailscale', category: CATEGORIES.VPN, emoji: '🐍', desc: 'Tailscale 管理' },
        { id: 'softether', title: 'SoftEther', category: CATEGORIES.VPN, emoji: '🧊', desc: '多协议 VPN 服务器' },
        // --- 代理核心 ---
        { id: 'v2ray', title: 'V2Ray', category: CATEGORIES.VPN, emoji: '📡', desc: 'V2Ray 核心管理' },
        { id: 'xray', title: 'XRay', category: CATEGORIES.VPN, emoji: '☢️', desc: 'XRay 核心管理' },
        { id: 'trojan', title: 'Trojan', category: CATEGORIES.VPN, emoji: '⚔️', desc: 'Trojan 代理' },
        { id: 'hysteria', title: 'Hysteria', category: CATEGORIES.VPN, emoji: '🌀', desc: 'Hysteria 代理' },
        { id: 'tuic', title: 'TUIC', category: CATEGORIES.VPN, emoji: '🔄', desc: 'TUIC 代理' },
        { id: 'naiveproxy', title: 'NaiveProxy', category: CATEGORIES.VPN, emoji: '🛡️', desc: 'NaiveProxy 代理' },
        { id: 'brook', title: 'Brook', category: CATEGORIES.VPN, emoji: '🌊', desc: 'Brook 代理' },
        { id: 'gost', title: 'GOST', category: CATEGORIES.VPN, emoji: '⚡', desc: 'GOST 隧道转发' },
        { id: 'shadowsocks', title: 'Shadowsocks', category: CATEGORIES.VPN, emoji: '🔰', desc: 'Shadowsocks 服务端' },
        // --- 内网穿透 ---
        { id: 'frp', title: 'FRP 穿透', category: CATEGORIES.VPN, emoji: '🚇', desc: 'FRP 穿透客户端' },
        { id: 'nps', title: 'NPS 穿透', category: CATEGORIES.VPN, emoji: '🔁', desc: 'NPS 内网穿透' },
        { id: 'ngrok', title: 'Ngrok 穿透', category: CATEGORIES.VPN, emoji: '🚀', desc: 'Ngrok 隧道' },
        { id: 'cpolar', title: 'Cpolar 穿透', category: CATEGORIES.VPN, emoji: '📍', desc: 'Cpolar 内网穿透' },
        { id: 'sish', title: 'Sish 穿透', category: CATEGORIES.VPN, emoji: '🌊', desc: 'Sish 服务端' },
        { id: 'bore', title: 'Bore 穿透', category: CATEGORIES.VPN, emoji: '🕳️', desc: 'Bore 简单穿透' },
        { id: 'rathole', title: 'Rathole 穿透', category: CATEGORIES.VPN, emoji: '🕳️', desc: 'Rathole 隧道' },
    
        // ===== 安全防护 (79-84) =====
        { id: 'ids', title: '入侵检测', category: CATEGORIES.SECURITY, emoji: '🕵️', desc: 'Snort / Suricata' },
        { id: 'ips', title: '入侵防御', category: CATEGORIES.SECURITY, emoji: '🛡️', desc: 'IPS 规则管理' },
        { id: 'antivirus', title: '病毒防护', category: CATEGORIES.SECURITY, emoji: '🦠', desc: 'ClamAV 扫描' },
        { id: 'webfilter', title: '网页过滤', category: CATEGORIES.SECURITY, emoji: '🚫', desc: 'URL 过滤' },
        { id: 'cert', title: '证书管理', category: CATEGORIES.SECURITY, emoji: '📜', desc: 'SSL 证书' },
        { id: 'ssh', title: 'SSH 管理', category: CATEGORIES.SECURITY, emoji: '🔑', desc: 'SSH 密钥/配置' },
    
        // ===== 工具助手 (85-92) =====
        { id: 'calculator', title: '计算器', category: CATEGORIES.TOOLS, emoji: '🧮', desc: '网络计算器' },
        { id: 'subnet', title: '子网计算', category: CATEGORIES.TOOLS, emoji: '🧮', desc: 'CIDR 计算' },
        { id: 'timer', title: '定时器', category: CATEGORIES.TOOLS, emoji: '⏲️', desc: '倒计时/定时' },
        { id: 'scanner', title: '端口扫描', category: CATEGORIES.TOOLS, emoji: '🔍', desc: 'Nmap 扫描' },
        { id: 'sniffer', title: '抓包工具', category: CATEGORIES.TOOLS, emoji: '📦', desc: 'Tcpdump 抓包' },
        { id: 'ipcalc', title: 'IP 计算器', category: CATEGORIES.TOOLS, emoji: '🧮', desc: 'IP 地址计算' },
        { id: 'maclookup', title: 'MAC 查询', category: CATEGORIES.TOOLS, emoji: '🔍', desc: '厂商 MAC 查询' },
        { id: 'speedcheck', title: '网速测试', category: CATEGORIES.TOOLS, emoji: '⚡', desc: '多节点测速' },
    
        // ===== 无线网络 (93-100) =====
        { id: 'wifi', title: 'Wi-Fi 设置', category: CATEGORIES.WIRELESS, emoji: '📶', desc: '无线网络配置' },
        { id: 'wifi_guest', title: '访客网络', category: CATEGORIES.WIRELESS, emoji: '📶', desc: '访客 Wi-Fi' },
        { id: 'wifi_qos', title: 'Wi-Fi QoS', category: CATEGORIES.WIRELESS, emoji: '📊', desc: '无线 QoS' },
        { id: 'acs', title: '信道优化', category: CATEGORIES.WIRELESS, emoji: '📡', desc: '自动信道选择' },
        { id: 'mesh', title: 'Mesh 组网', category: CATEGORIES.WIRELESS, emoji: '🕸️', desc: 'Mesh 网络管理' },
        { id: 'wps', title: 'WPS 设置', category: CATEGORIES.WIRELESS, emoji: '🔘', desc: 'WPS 连接' },
        { id: 'radius', title: 'RADIUS', category: CATEGORIES.WIRELESS, emoji: '🔐', desc: 'Wi-Fi 认证' },
        { id: 'wifi_analyser', title: 'Wi-Fi 分析', category: CATEGORIES.WIRELESS, emoji: '📶', desc: '信号分析工具' },
    
        // ===== 日志监控 (101-106) =====
        { id: 'syslog', title: '系统日志', category: CATEGORIES.LOGS, emoji: '📋', desc: '系统日志查看' },
        { id: 'kernel_log', title: '内核日志', category: CATEGORIES.LOGS, emoji: '📋', desc: '内核日志' },
        { id: 'firewall_log', title: '防火墙日志', category: CATEGORIES.LOGS, emoji: '📋', desc: '防火墙日志' },
        { id: 'access_log', title: '访问日志', category: CATEGORIES.LOGS, emoji: '📋', desc: 'HTTP 访问日志' },
        { id: 'wireless_log', title: '无线日志', category: CATEGORIES.LOGS, emoji: '📋', desc: 'Wi-Fi 日志' },
        { id: 'vpn_log', title: 'VPN 日志', category: CATEGORIES.LOGS, emoji: '📋', desc: 'VPN 连接日志' },
    
        // ===== 高级配置 (107-112) =====
        { id: 'uci', title: 'UCI 编辑', category: CATEGORIES.ADVANCED, emoji: '✏️', desc: 'UCI 配置编辑' },
        { id: 'vlan_adv', title: 'VLAN 高级', category: CATEGORIES.ADVANCED, emoji: '⚙️', desc: '高级 VLAN' },
        { id: 'routing_adv', title: '高级路由', category: CATEGORIES.ADVANCED, emoji: '🚏', desc: '策略路由' },
        { id: 'dns_adv', title: 'DNS 高级', category: CATEGORIES.ADVANCED, emoji: '📡', desc: 'DNS 高级配置' },
        { id: 'script', title: '脚本管理', category: CATEGORIES.ADVANCED, emoji: '📜', desc: '用户脚本' },
        { id: 'debug', title: '调试工具', category: CATEGORIES.ADVANCED, emoji: '🐛', desc: '诊断调试' },
    
        // ===== 容器 / 虚拟化 (113-116) =====
        { id: 'docker', title: 'Docker', category: CATEGORIES.DOCKER, emoji: '🐳', desc: 'Docker 管理' },
        { id: 'containers', title: '容器列表', category: CATEGORIES.DOCKER, emoji: '📦', desc: '运行容器' },
        { id: 'images', title: '镜像管理', category: CATEGORIES.DOCKER, emoji: '🖼️', desc: 'Docker 镜像' },
        { id: 'lxc', title: 'LXC 容器', category: CATEGORIES.DOCKER, emoji: '📦', desc: 'LXC 容器管理' },

        // ===== 自定义链接 =====
        // Default icon for user-added custom URL shortcuts (desktop
        // right-click → Add Custom URL); also selectable in the picker.
        { id: 'link', title: '自定义链接', category: CATEGORIES.TOOLS, emoji: '🔗', desc: '自定义 URL 快捷方式' }
    ];

    // ---------- LuCI url fragment -> icon id ----------
    // Mapping lives in icon-url-map.js (loaded BEFORE this module) as a
    // plain "<url-fragment>:<icon-id>" table — edit that file to change
    // icons, no logic here. Fragments match with indexOf() against the
    // full menu href; first hit wins (order matters in the map file).
    var URL_MAP = [];
    (window.__ICON_URL_MAP_TEXT__ || '').split('\n').forEach(function(line) {
        line = line.trim();
        if (!line || line.charAt(0) === '#') return;   // blank / comment
        var i = line.indexOf(':');
        if (i > 0) URL_MAP.push([line.slice(0, i), line.slice(i + 1)]);
    });

    // ---------- Helpers ----------
    var byId = {};
    ICONS.forEach(function(icon) { byId[icon.id] = icon; });

    function matchUrl(url) {
        if (!url) return null;
        for (var i = 0; i < URL_MAP.length; i++) {
            if (url.indexOf(URL_MAP[i][0]) !== -1) {
                return byId[URL_MAP[i][1]] || null;
            }
        }
        return null;
    }

    function matchUrlFragment(url) {
        var icon = matchUrl(url);
        return icon ? icon : null;
    }

    // ---------- Expose ----------
    DESKTOP.IconConfig = {
        icons: ICONS,
        categories: CATEGORIES,
        colors: COLORS,
        getIconById: function(id) { return byId[id] || null; },
        matchUrl: matchUrlFragment,
        colorForUrl: function(url) {
            var icon = matchUrlFragment(url);
            return icon ? (COLORS[icon.category] || '#607D8B') : null;
        },
        emojiForUrl: function(url) {
            var icon = matchUrlFragment(url);
            return icon ? icon.emoji : null;
        }
    };
})();
