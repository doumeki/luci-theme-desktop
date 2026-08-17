/* Panel Helper — draggable & resizable settings panels
 *
 * Usage:
 *   PanelHelper.makeMovable(panel);  // drag by header
 *   PanelHelper.makeResizable(panel); // resize by bottom-right corner
 */
(function() {
    'use strict';

    var DESKTOP = window.LuCIDesktop;

    window.PanelHelper = {
        makeMovable: function(panel) {
            var header = panel.querySelector('.widget-settings-header');
            if (!header) return;
            header.style.cursor = 'move';
            header.addEventListener('mousedown', function(e) {
                if (e.target.tagName === 'BUTTON') return;
                var sx = e.clientX, sy = e.clientY;
                var rect = panel.getBoundingClientRect();
                var ox = rect.left, oy = rect.top;
                panel.style.transform = 'none';
                panel.style.left = ox + 'px';
                panel.style.top = oy + 'px';
                // Unified overlay prevents iframes from stealing events
                DESKTOP.showDragOverlay({cursor: 'move'});
                function move(ev) { panel.style.left = (ox + ev.clientX - sx) + 'px'; panel.style.top = (oy + ev.clientY - sy) + 'px'; }
                function up() { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); DESKTOP.hideDragOverlay(); }
                document.addEventListener('mousemove', move);
                document.addEventListener('mouseup', up);
            });
        },

        makeResizable: function(panel, minW, minH) {
            minW = minW || 340;
            minH = minH || 200;
            // Resize handle — large hit area, tiny grip hint at the very corner
            var handle = document.createElement('div');
            handle.style.cssText = 'position:absolute;bottom:0;right:0;width:28px;height:28px;cursor:se-resize;' +
                'border-radius:0 0 4px 0;';
            panel.style.position = 'fixed';
            panel.appendChild(handle);
            handle.addEventListener('mousedown', function(e) {
                e.stopPropagation();
                e.preventDefault();
                var sx = e.clientX, sy = e.clientY;
                var ow = panel.offsetWidth, oh = panel.offsetHeight;
                // Prevent iframes from stealing mouse events during resize
                DESKTOP.showDragOverlay({cursor: 'se-resize'});
                function move(ev) {
                    panel.style.width = DESKTOP.clamp(ow + ev.clientX - sx, minW, Infinity) + 'px';
                    panel.style.height = DESKTOP.clamp(oh + ev.clientY - sy, minH, Infinity) + 'px';
                }
                function up() {
                    document.removeEventListener('mousemove', move);
                    document.removeEventListener('mouseup', up);
                    DESKTOP.hideDragOverlay();
                }
                document.addEventListener('mousemove', move);
                document.addEventListener('mouseup', up);
            });
        },

        fadeIn: function(panel) {
            panel.style.opacity = '0';
            panel.style.transition = 'opacity 0.2s';
            requestAnimationFrame(function() { panel.style.opacity = '1'; });
        }
    };
})();
