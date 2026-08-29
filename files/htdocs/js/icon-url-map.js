/* icon-url-map.js — app URL -> icon id mapping table
 *
 * One entry per line:  <url-fragment>:<icon-id>
 *   - the fragment is matched with indexOf() against the full LuCI menu
 *     href (e.g. "/cgi-bin/luci/admin/status/overview")
 *   - first hit wins: put LONGER / more specific fragments BEFORE shorter
 *     ones that would shadow them (e.g. /nas/cifsd before /nas/cifs)
 *   - lines starting with '#' are comments; blank lines are ignored
 *   - icon ids must exist in icon-config.js (LuCIDesktop.IconConfig)
 *
 * Remapped 2026-08-29 against the REAL menu tree dumped from both
 * routers (58 identical entries on 1.1 and 253) + common paths of
 * other installs. Edit this file to adjust an icon — no JS logic touch.
 */
(function() {
    'use strict';
    window.__ICON_URL_MAP_TEXT__ = [
        // ===== 控制 (control) =====
        '/control/appfilter:webfilter',      // OpenAppFilter -> 网页过滤
        '/control/timewol:wol',              // 定时网络唤醒

        // ===== NAS / 存储 =====
        '/nas/cifsd:samba',                  // ksmbd 服务端 (longer first!)
        '/nas/cifs:smb',                     // SMB 挂载
        '/nas/aria2:aria2',
        '/nas/fileassistant:fileassistant',
        '/nas/hd_idle:hd_idle',
        '/nas/minidlna:dlna',
        '/nas/nfs:nfs',
        '/nas/vsftpd:ftp',

        // ===== 网络 =====
        '/network/arpbind:arpbind',
        '/network/dhcp:dhcp',
        '/network/diagnostics:ping',         // 网络诊断
        '/network/firewall/forwards:nat',    // 端口转发 (longer first!)
        '/network/firewall:firewall',
        '/network/hosts:hosts',
        '/network/network:interfaces',
        '/network/routes:routes',
        '/network/socat:socat',
        '/network/qos:qos',
        '/network/wireguard:wireguard',
        '/network/wifi:wifi',
        '/network/switch:vlan',
        '/network/mwan3:multipath',

        // ===== 流量统计 (nlbw) =====
        '/nlbw/display:bandwidth',
        '/nlbw/usage:bandwidth',
        '/nlbw/realtime:traffic',
        '/nlbw/netdata:traffic',
        '/nlbw/tcpdump:sniffer',

        // ===== 服务 =====
        '/services/passwall2/shunt_rules:bypass',   // 分流规则 (longer first!)
        '/services/AdGuardHome:adguard',
        '/services/adguardhome:adguard',
        '/services/ddns:ddns',
        '/services/passwall2:passwall',
        '/services/passwall:passwall',
        '/services/shadowsocksr:ssr',
        '/services/ssr:ssr',
        '/services/unblockneteasemusic:unblockmusic',
        '/services/unblockmusic:unblockmusic',
        '/services/upnp:upnp',
        '/services/vlmcsd:kms',              // KMS 服务器
        '/services/kms:kms',
        '/services/wol:wol',
        '/services/ttyd/ttyd:terminal',
        '/services/aria2:aria2',
        '/services/fileassistant:fileassistant',
        '/services/openvpn:openvpn',
        '/services/ocserv:ocserv',
        '/services/zerotier:zerotier',
        '/services/tailscale:tailscale',
        '/services/vsftpd:ftp',
        '/services/samba4:samba',
        '/services/samba:samba',
        '/services/minidlna:dlna',
        '/services/rclone:rclone',
        '/services/nfs:nfs',
        '/services/hd_idle:hd_idle',
        '/services/mwan3:multipath',
        '/services/mwan:multipath',

        // ===== 代理 / VPN 内核 (122-icon catalog) =====
        '/services/v2ray:v2ray',
        '/services/xray:xray',
        '/services/trojan:trojan',
        '/services/hysteria:hysteria',
        '/services/tuic:tuic',
        '/services/naiveproxy:naiveproxy',
        '/services/brook:brook',
        '/services/gost:gost',
        '/services/shadowsocks:shadowsocks',
        '/services/softether:softether',
        '/services/socks5:socks5',
        '/services/frp:frp',
        '/services/nps:nps',
        '/services/ngrok:ngrok',

        // ===== 状态 =====
        '/status/dmesg:kernel_log',
        '/status/iptables:firewall_log',
        '/status/overview:overview',
        '/status/routes:routes',
        '/status/syslog:syslog',
        '/status/wireguard:wireguard',

        // ===== 系统 =====
        '/system/admin:admin',
        '/system/crontab:crontab',
        '/system/diskman:disk',
        '/system/filetransfer:fileassistant',
        '/system/flashops:flash',
        '/system/flash:flash',
        '/system/fstab:fstab',
        '/system/packages:packages',
        '/system/opkg:packages',
        '/system/reboot:reboot',
        '/system/startup:startup',
        '/system/system:system',
        '/system/terminal:terminal',
        '/system/ttyd/ttyd:terminal',
        '/system/backup:backup',
        '/system/uci:uci',
        '/system/fileassistant:fileassistant',

        // ===== VPN =====
        '/vpn/ipsec-server:ipsec',
        '/vpn/ocserv:ocserv',
        '/vpn/zerotier:zerotier',

        // ===== 容器 =====
        '/docker:docker'
    ].join('\n');
})();
