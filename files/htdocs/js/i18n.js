/* i18n — Multi-language support
 *
 * Usage: _('English string') → translated string (or English if not found)
 * Language auto-detected from <html lang="..."> attribute.
 *
 * Translation dictionaries are keyed by language code.
 * English is the default (msgid) - no dictionary needed.
 */

(function() {
    'use strict';

    // Click events sometimes target a text node (Firefox) — Text has no
    // closest(), which breaks every e.target.closest() handler. Delegate
    // to the parent element instead.
    if (window.Text && !Text.prototype.closest) {
        Text.prototype.closest = function(sel) {
            return this.parentElement ? this.parentElement.closest(sel) : null;
        };
    }

    window.__I18N = {
        'zh_cn': {
            // ===== theme-config.js =====
            'Titlebar (active)': '标题栏（活动）',
            'Titlebar (inactive)': '标题栏（非活动）',
            'Titlebar Opacity': '标题栏透明度',
            'Taskbar': '任务栏',
            'Taskbar Opacity': '任务栏透明度',
            'Taskbar Btn (active)': '任务栏按钮（活动）',
            'Start Menu': '开始菜单',
            'Start Menu Opacity': '开始菜单透明度',
            'Menu Selected': '菜单选中项',
            'Dark Mode': '深色模式',
            'App Primary': '亮色系主色调',
            'App Primary (dark)': '暗色系主色调',
            'Desktop Wallpaper': '桌面壁纸',
            'Gradient': '渐变',
            'Built-in': '内置',
            'Bing Daily': '必应每日',
            'Picsum Photos': 'Picsum 照片',
            'Login Wallpaper': '登录页壁纸',
            'Desktop Font Size': '桌面字体大小',
            'Desktop Font Color': '桌面字体颜色',
            'Bold': '粗体',
            'Label Glow': '标签发光',
            'Icon Opacity': '图标透明度',
            'Icon Background': '图标背景',
            'Menu Font Size': '菜单字体大小',
            'Menu Font Color': '菜单字体颜色',
            'Content Zoom': '内容缩放',
            'Bg Base': '背景底色',
            'Bg Glow': '背景光晕',
            'Glow X': '光晕 X',
            'Glow Y': '光晕 Y',
            'Go to password configuration...': '前往密码配置...',
            'Do not show again': '不再提醒',
            'Max instances warning': '实例数量上限提示',
            'Picsum unreachable': 'Picsum 无法访问',
            'Platform compatibility warnings': '平台兼容性警告',
            'Wallpaper refresh failed': '壁纸刷新失败',
            'Wallpaper saved to built-in': '壁纸已保存到内置图库',
            'Spread': '扩散',
            'Angle': '角度',
            'Menu Hover': '菜单悬停切换',
            'Auto Refresh': '自动刷新',
            'Picsum Auto Refresh': '登录刷新',
            // Layout section labels
            'Titlebar': '标题栏',
            'Desktop': '桌面',
            'App': '色系',
            'Icons': '图标',
            'Menu': '菜单',
            'Login': '登录',

            // ===== themesettings.js =====
            'Apply': '应用',
            'Apply *': '应用 *',
            'Opacity': '透明度',
            'Manage': '管理',
            'Refresh': '刷新',
            'Colors': '颜色',
            'Fonts': '字体',
            'Bg': '背景',
            'Theme': '主题',
            'Save to Built-in': '保存到内置',
            'Save': '保存',
            'Theme Settings': '主题设置',
            'OK': '确定',
            'Defaults': '默认值',
            'Diagnostics': '诊断信息',
            'Diagnostics copied': '诊断信息已复制',
            'Saved': '已保存',
            'Refresh failed (server error)': '刷新失败（服务器错误）',
            'Picsum unreachable, showing cached image': 'Picsum 不可达，显示缓存图片',
            'Network error, check connection': '网络错误，请检查连接',
            'Downloading preview…': '正在下载预览…',
            'Preview ready': '预览已就绪',
            'Preview download failed': '预览下载失败',
            'Saved: ': '已保存: ',
            'Error': '错误',
            'Already in Built-in: ': '已在内置中: ',
            '✓ Saved': '✓ 已保存',

            // ===== widget.js =====
            'Desktop Widgets': '桌面组件',
            'No widgets registered.': '没有注册的组件。',
            'Click-through': '点击穿透',
            'Hide background at 0% opacity': '透明度 0% 时隐藏背景',
            'Close': '关闭',
            'Permanently delete all content in this note': '永久删除此便签中的所有内容',
            'Clear': '清空',
            'Clear data': '清空数据',
            'PERMANENTLY DELETE all content in ': '永久删除 ',
            '?\n\nThis cannot be undone.': ' 中的所有内容？\n\n此操作不可撤销。',

            // ===== wallpaper-settings.js =====
            'Wallpapers': '壁纸管理',
            'Browse': '浏览',
            'Upload': '上传',
            'Check all': '全选',
            'Cancel': '取消',
            'Select a file': '选择一个文件',
            'Uploading...': '上传中...',
            'Done: ': '完成: ',
            'Failed': '失败',
            'Loading...': '加载中...',
            'No images': '没有图片',
            'Delete': '删除',
            'Include in wallpaper rotation': '包含在壁纸轮播中',
            'Delete ': '删除 ',
            '?': '？',
            'Error loading files': '加载文件出错',
            'Click anywhere to close': '点击任意位置关闭',

            // ===== desktop.js =====
            'Status': '状态',
            'Terminal': '终端',
            'System': '系统',
            'Firewall': '防火墙',
            'Open': '打开',
            'Hide': '隐藏',
            'Hide this icon?': '隐藏此图标？',
            'Install': '安装',
            'Missing luci-lua-runtime — install to enable theme features': '缺少 luci-lua-runtime — 安装后主题功能可用',
            'then refresh': '然后刷新页面',
            'Install failed': '安装失败',
            'Installing Terminal…': '正在安装终端…',
            'Not installed': '未安装',
            'Rename': '重命名',
            'Unpin': '取消固定',
            'New name:': '新名称：',
            'Widgets': '组件',
            'Theme settings loading...': '主题设置加载中...',

            // ===== wm.js =====
            'Untitled': '无标题',
            'Applying…': '正在应用…',
            'Minimize': '最小化',
            'Maximize': '最大化',

            // ===== startmenu.js =====
            'No menu items': '没有菜单项',
            'Search...': '搜索...',
            'Desktop Theme v': 'Desktop 主题 v',
            'Exit': '退出',
            'Logout': '退出登录',
            'Are you sure you want to logout?': '确定要退出吗？',
            'Pin to Desktop': '固定到桌面',
            'Desktop label:': '桌面标签：',

            // ===== taskbar.js =====
            'Auto Refresh: ON': '自动刷新：开',
            'Auto Refresh: OFF': '自动刷新：关',
            'Window': '窗口',

            // ===== uci indicator =====
            'Unsaved Changes': '未保存的配置',
            'No password set!': '未设置密码！',

            // ===== platform compatibility probe (shell.js) =====
            'Platform compatibility': '平台兼容性提示',
            'Physical RAM shown as estimate (dmidecode missing)': '物理内存显示为估算值（缺少 dmidecode）',
            'Online wallpaper unavailable (curl missing)': '在线壁纸不可用（缺少 curl）',
            'CPU usage may be inaccurate on this build': '此固件上 CPU 占用率可能不准',
            'Password': '密码',
            'Username': '用户名',
            'Please log in.': '请登录。',
            'Invalid username and/or password! Please try again.': '用户名或密码错误！请重试。',
            'Security': '安全',
            'View': '查看',
            'Set password': '设置密码',
            'Configuration': '配置',
            'Reverted': '已放弃',

            // ===== widgets/stickynote.js =====
            'Sticky Note': '便签',
            'Yellow': '黄色',
            'Coral': '珊瑚色',
            'Green': '绿色',
            'Blue': '蓝色',
            'Purple': '紫色',
            'Pink': '粉色',
            'White': '白色',
            'Sticky ': '便签 ',

            // ===== widgets/clock.js =====
            'Desktop Clock': '桌面时钟',
            'Analog': '指针',
            'Digital': '数字',

            // ===== widgets/system-info.js =====
            'System Info': '系统信息',
            'CPU': '处理器',
            'Mem': '内存',
            'Temp': '温度',
            'Up': '运行',
            'Show temperature': '显示温度',
            'Accent color': '强调色',
            'Font color': '字体颜色',
            'Card background': '卡片背景',
            'Refresh interval (s)': '刷新间隔（秒）',
            'Resize': '调整大小',
            'd ': '天 ',
            'h': '时',

            // ===== widgets/net-traffic.js =====
            'Network Traffic': '网络流量',
            'Interface': '接口',
            'Download': '下载',

            // ===== tray.js =====
            'Tray item requires an id': '托盘项需要 id',
            'Tray item "': '托盘项 "',
            'There is no password set on this router. Please configure a root password to protect the web interface.': '路由器尚未设置密码。请配置 root 密码以保护 Web 界面。',
            '" already registered': '" 已注册',
            '" not registered': '" 未注册',

            // ===== widget error messages =====
            'Widget requires an id': '组件需要 id',
            'Widget requires a render function': '组件需要 render 函数',
            'Widget "': '组件 "',
            '" already registered': '" 已注册',
            '" not registered': '" 未注册',
            'Max ': '已达最大实例数 ',
            ' instances of ': '：',
        }
    };

    // Language detection
    function getLang() {
        var html = document.documentElement;
        var lang = html.getAttribute('lang') || html.getAttribute('data-lang') || '';
        if (!lang) return '';
        lang = lang.replace(/-/g, '_');
        // LuCI >= 23.05 reports zh_Hans / zh_Hant; our dictionary is keyed zh_cn
        if (lang === 'zh_Hans') lang = 'zh_cn';
        return lang;
    }

    // Translation lookup — returns translation or the original English string
    window._ = function(text) {
        var lang = getLang();
        if (!lang || lang === 'en' || lang === 'en_US') return text;
        var dict = window.__I18N[lang];
        if (!dict) return text;
        return (dict.hasOwnProperty(text) && dict[text] !== undefined) ? dict[text] : text;
    };

    // Formatted translation: _f('Max %d instances of %s', max, name)
    window._f = function(text) {
        var translated = window._(text);
        var args = Array.prototype.slice.call(arguments, 1);
        return translated.replace(/%[ds]/g, function() { return args.length ? String(args.shift()) : ''; });
    };

    console.log('[i18n] lang=' + (getLang() || '(default en)') + ' strings=' +
        Object.keys((window.__I18N[getLang()] || {})).length);
})();
