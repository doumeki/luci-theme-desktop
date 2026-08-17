/* Desktop Theme — Tray & Notification Manager
 *
 * Extensible system tray (taskbar-tray area).
 * Third-party modules: call TrayManager.register({...}) then TrayManager.enable(id).
 *
 * API:
 *   TrayManager.register(def)   — def: {id, icon, tooltip?, onClick?, order?}
 *   TrayManager.enable(id)      — show item in tray
 *   TrayManager.disable(id)     — remove from tray
 *   TrayManager.setIcon(id, v)  — change icon text
 *   TrayManager.setTooltip(id,v)— change tooltip
 *   TrayManager.hide/show(id)   — toggle visibility
 *   TrayManager.notify(msg,opts)— show toast notification
 *   TrayManager.bindShortcut(k,fn) — register keyboard shortcut
 *   TrayManager.unbindShortcut(id) — remove shortcut
 */
(function() {
    'use strict';

    var DESKTOP = window.LuCIDesktop;

    // Order sort: lower order = closer to clock (right side)
    function _insertSorted(trayEl, el, order) {
        var items = trayEl.querySelectorAll('.tray-item');
        for (var i = 0; i < items.length; i++) {
            var o = parseInt(items[i].getAttribute('data-order')) || 100;
            if (order < o) {
                trayEl.insertBefore(el, items[i]);
                return;
            }
        }
        trayEl.appendChild(el);
    }

    var TrayManager = {
        registry: {}, // id → {id, icon, tooltip, onClick, order}
        items: {},    // id → {id, el}
        _shortcuts: {},
        _shortcutNextId: 0,

        // ===== Tray Items =====

        register: function(def) {
            if (!def.id) throw new Error('Tray item requires an id');
            if (this.registry[def.id]) throw new Error('Tray item "' + def.id + '" already registered');

            this.registry[def.id] = {
                id: def.id,
                icon: def.icon || '?',
                tooltip: def.tooltip || '',
                onClick: def.onClick || null,
                order: def.order || 100
            };
        },

        enable: function(id) {
            var def = this.registry[id];
            if (!def) throw new Error('Tray item "' + id + '" not registered');
            if (this.items[id]) return; // already enabled — no-op instead of throw (tolerance for restore)

            var trayEl = document.getElementById('taskbar-tray');
            if (!trayEl) return;

            var el = document.createElement('span');
            el.className = 'tray-item';
            el.setAttribute('data-tray-id', id);
            el.setAttribute('data-order', def.order);
            if (def.tooltip) el.setAttribute('title', def.tooltip);

            var iconEl = document.createElement('span');
            iconEl.className = 'tray-item-icon';
            iconEl.textContent = def.icon;
            el.appendChild(iconEl);

            if (def.onClick) {
                el.style.cursor = 'pointer';
                el.addEventListener('click', function(e) {
                    e.stopPropagation();
                    def.onClick();
                });
            }

            _insertSorted(trayEl, el, def.order);
            this.items[id] = {id: id, el: el};

            DESKTOP.emit('tray-item-added', {id: id});
        },

        disable: function(id) {
            var item = this.items[id];
            if (!item) return;
            if (item.el && item.el.parentNode) {
                item.el.parentNode.removeChild(item.el);
            }
            delete this.items[id];

            DESKTOP.emit('tray-item-removed', {id: id});
        },

        hide: function(id) {
            var item = this.items[id];
            if (item && item.el) item.el.style.display = 'none';
        },

        show: function(id) {
            var item = this.items[id];
            if (item && item.el) item.el.style.display = '';
        },

        setIcon: function(id, icon) {
            var item = this.items[id];
            if (!item) return;
            var iconEl = item.el.querySelector('.tray-item-icon');
            if (iconEl) iconEl.textContent = icon;
            this.registry[id] && (this.registry[id].icon = icon);
        },

        setTooltip: function(id, tooltip) {
            var item = this.items[id];
            if (item && item.el) item.el.setAttribute('title', tooltip);
            this.registry[id] && (this.registry[id].tooltip = tooltip);
        },

        // ===== Notifications (Toast) =====

        notify: function(message, opts) {
            opts = opts || {};
            var type = opts.type || 'info';     // info | warn | error
            var duration = opts.duration || 0;  // 0 = stay until dismissed (notifications);
                                                // pass a positive value for transient feedback
            var action = opts.action || null;   // {label, onClick}
            var title = opts.title || null;     // Win10/11 style: small title above message
            var icon = opts.icon || null;       // emoji / svg string
            var suppressible = !!opts.suppressible;     // theme-level notice: per-key "do not
                                                        // show again" checkbox (suppression)
            var force = !!opts.force;
            // Per-key suppression ("Do not show again" checkbox): theme-level
            // notices only, keyed individually (NOT per category — each
            // suppressible notice is toggled separately). PERMANENT: force
            // (bell) does not re-show a suppressed notice — the only way to
            // see it again is removing the localStorage key in devtools.
            if (suppressible && opts.key && isSuppressed(opts.key)) return;

            // Dedupe: skip if a toast with the same key is still on screen.
            // An explicit re-show (bell click, opts.force) drops the
            // on-screen copy first so the notification visibly re-pops —
            // otherwise the bell appears dead while a toast sits on screen.
            if (opts.key) {
                if (force) {
                    document.querySelectorAll('.desktop-toast[data-key="' + opts.key + '"]:not(.toast-hiding)')
                        .forEach(function(t) { _dismissToast(t); });
                } else {
                    var dupes = document.querySelectorAll('.desktop-toast[data-key="' + opts.key + '"]:not(.toast-hiding)');
                    if (dupes.length > 0) return;
                }
            }

            var toast = document.createElement('div');
            toast.className = 'desktop-toast toast-' + type;
            if (opts.key) toast.setAttribute('data-key', opts.key);
            var html = '';
            if (icon) html += '<div class="toast-icon">' + icon + '</div>';
            html += '<div class="toast-body">';
            if (title) html += '<div class="toast-title">' + escapeHTML(title) + '</div>';
            html += '<div class="toast-msg">' + escapeHTML(message) + '</div>';
            if (action) html += '<div class="toast-action-row"><button class="toast-action">' + escapeHTML(action.label) + '</button></div>';
            // Theme-level notices get a per-key "Do not show again" checkbox —
            // checked = suppress THIS notice only (localStorage per key).
            if (suppressible && opts.key) {
                html += '<label class="toast-snooze">' +
                    '<input type="checkbox" class="toast-sup-cb"' + (isSuppressed(opts.key) ? ' checked' : '') + '> ' +
                    _('Do not show again') + '</label>';
            }
            html += '</div>';
            html += '<button class="toast-close">✕</button>';
            toast.innerHTML = html;

            // Stack toasts so multiple notifications never overlap
            var existing = document.querySelectorAll('.desktop-toast:not(.toast-hiding)');
            var offset = existing.length * 96;
            toast.style.bottom = 'calc(var(--taskbar-height) + ' + (12 + offset) + 'px)';

            document.body.appendChild(toast);

            // Animate in
            requestAnimationFrame(function() {
                toast.classList.add('toast-visible');
            });

            // Close button (top-right, does not trigger action).
            toast.querySelector('.toast-close').addEventListener('click', function(e) {
                e.stopPropagation();
                _dismissToast(toast);
            });

            // "Do not show again" checkbox: checking suppresses THIS notice
            // (per-key, NOT the whole category) and closes the current
            // toast; unchecking (visible when force-shown) restores it.
            // Click must not bubble into the card's action handler.
            var snoozeLabel = toast.querySelector('.toast-snooze');
            if (snoozeLabel) {
                snoozeLabel.addEventListener('click', function(e) { e.stopPropagation(); });
                snoozeLabel.querySelector('.toast-sup-cb').addEventListener('change', function(e) {
                    e.stopPropagation();
                    if (opts.key) {
                        setSuppressed(opts.key, this.checked);
                        if (this.checked) _dismissToast(toast);
                    }
                });
            }

            // The action button AND the whole card open the related window —
            // the card is styled cursor:pointer, so clicking it must do
            // something. The close button stays exclusive (stopPropagation).
            if (action) {
                var fireAction = function(e) {
                    if (e) e.stopPropagation();
                    action.onClick();
                    _dismissToast(toast);
                };
                toast.querySelector('.toast-action').addEventListener('click', fireAction);
                toast.addEventListener('click', function(e) {
                    if (e.target.closest('.toast-close')) return;
                    fireAction(e);
                });
            }

            // Auto-dismiss only for transient feedback toasts (duration > 0)
            if (duration > 0) {
                var timer = setTimeout(function() { _dismissToast(toast); }, duration);
                toast._dismissTimer = timer;
            }

            DESKTOP.emit('notification-shown', {message: message, type: type});
            document.dispatchEvent(new CustomEvent('desktop:toast-count'));
        },

        // Update the message text of a live toast (matched by key). The
        // uci-changes poller uses this to keep a visible "Unsaved Changes:
        // N" toast in sync when the server auto-applies part of a save —
        // otherwise the toast keeps advertising a stale count that no
        // longer matches the changes window it opens.
        updateMessage: function(key, message) {
            var toast = document.querySelector('.desktop-toast[data-key="' + key + '"]:not(.toast-hiding)');
            if (!toast) return false;
            var msg = toast.querySelector('.toast-msg');
            if (msg) msg.textContent = message;
            return true;
        },

        // Dismiss a live toast by key (the batch it advertised is gone).
        dismiss: function(key) {
            document.querySelectorAll('.desktop-toast[data-key="' + key + '"]:not(.toast-hiding)')
                .forEach(function(t) { _dismissToast(t); });
        },

        // Dismiss every toast currently on screen — the tray bell's
        // toggle-off. Suppressed notices stay suppressed (localStorage is
        // untouched); the bell just closes what's showing right now.
        dismissAll: function() {
            document.querySelectorAll('.desktop-toast:not(.toast-hiding)')
                .forEach(function(t) { _dismissToast(t); });
        },

        // ===== Keyboard Shortcuts =====

        bindShortcut: function(keyCombo, fn) {
            var id = 'shortcut-' + (++this._shortcutNextId);
            this._shortcuts[id] = {combo: keyCombo.toLowerCase(), fn: fn};
            return id;
        },

        unbindShortcut: function(id) {
            delete this._shortcuts[id];
        },

        _handleKeydown: function(e) {
            // Build combo string from event
            var parts = [];
            if (e.altKey) parts.push('alt');
            if (e.ctrlKey) parts.push('ctrl');
            if (e.metaKey) parts.push('meta');
            if (e.shiftKey) parts.push('shift');
            parts.push(e.key.toLowerCase());
            var combo = parts.join('+');

            var self = TrayManager;
            var keys = Object.keys(self._shortcuts);
            for (var i = 0; i < keys.length; i++) {
                var s = self._shortcuts[keys[i]];
                if (s.combo === combo) {
                    e.preventDefault();
                    s.fn();
                    return;
                }
            }
        }
    };

    // ===== Internal Helpers =====

    function _dismissToast(toast) {
        if (toast._dismissed) return;
        toast._dismissed = true;
        clearTimeout(toast._dismissTimer);
        toast.classList.remove('toast-visible');
        toast.classList.add('toast-hiding');
        document.dispatchEvent(new CustomEvent('desktop:toast-count'));
        setTimeout(function() {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 300);
    }

    function escapeHTML(str) {
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ===== Per-key suppression ("Do not show again") =====
    // Each suppressible notice stores its own key — NOT per category, so
    // e.g. "Wallpaper refresh failed" can stay silenced while "Picsum
    // unreachable" keeps popping. Legacy compat: the old shared key
    // desktop.compat_toast_dismissed (platform-compat ✕) still counts.
    function suppressKey(key) {
        return 'desktop.toast_suppressed_' + key;
    }
    function isSuppressed(key) {
        try {
            if (localStorage.getItem(suppressKey(key)) === '1') return true;
            if (key === 'platform-compat' &&
                localStorage.getItem('desktop.compat_toast_dismissed') === '1') return true; // legacy
        } catch(e) {}
        return false;
    }
    function setSuppressed(key, on) {
        try {
            if (on) localStorage.setItem(suppressKey(key), '1');
            else localStorage.removeItem(suppressKey(key));
        } catch(e) {}
    }

    // ===== Init =====
    document.addEventListener('keydown', TrayManager._handleKeydown);

    // Suppression API (read/manage per-key state; used by the toast
    // checkbox — the settings panel tab was removed 2026-08):
    // TrayManager.suppressed(key) / setSuppressed(key, bool).
    TrayManager.suppressed = isSuppressed;
    TrayManager.setSuppressed = setSuppressed;

    DESKTOP.register('tray', TrayManager);
    window.TrayManager = TrayManager;
})();
