/* quantum-icons.js — quantum-snap icon dragging for the desktop
 *
 * Grid-snap drag for #desktop-icons .desktop-icon (absolute-positioned).
 * Adapted from the reference QuantumIcons engine (2026-08-29) for the
 * theme's own constraints:
 *   - rectangular grid cells (gridW x gridH), theme layout is 96x90
 *   - DRAG THRESHOLD: a press without real movement never prevents the
 *     default — click (select), dblclick (open), contextmenu all keep
 *     working. Only once the pointer moves beyond the threshold does the
 *     drag take over (and a trailing click is suppressed).
 *   - persistence is delegated to the caller via onPositionChange —
 *     this engine NEVER touches localStorage (theme config is UCI-based).
 *   - overlay/style class names use a q- prefix (no theme collisions).
 * Exposed as LuCIDesktop.QuantumIcons.
 */
(function() {
    'use strict';

    var DESKTOP = window.LuCIDesktop;
    if (!DESKTOP) { console.error('quantum-icons.js: LuCIDesktop namespace not found'); return; }

    function QuantumIcons(options) {
        options = options || {};
        this.config = {
            containerSelector: options.containerSelector || '#desktop-icons',
            iconSelector: options.iconSelector || '.desktop-icon',
            gridW: options.gridW || 96,           // cell width (px)
            gridH: options.gridH || 90,           // cell height (px)
            marginLeft: options.marginLeft || 16,
            marginTop: options.marginTop || 16,
            dragThreshold: options.dragThreshold || 5,   // px before drag engages
            gridColor: options.gridColor || 'rgba(255,255,255,0.15)',
            activeColor: options.activeColor || 'rgba(255,255,255,0.25)',
            onPositionChange: options.onPositionChange || null,
            enabled: options.enabled !== false
        };

        this.container = document.querySelector(this.config.containerSelector);
        if (!this.container) {
            console.warn('[QuantumIcons] desktop icon container not found');
            return;
        }

        this.gridCols = 0;
        this.gridRows = 0;
        this.isDragging = false;
        this.dragTarget = null;
        this.overlay = null;
        this.cells = [];

        this.init();
    }

    QuantumIcons.prototype = {
        init: function() {
            var self = this;

            // Grid overlay (pointer-events none, sits above icons)
            this.overlay = document.createElement('div');
            this.overlay.className = 'q-icon-grid-overlay';
            this.overlay.style.cssText =
                'position:absolute;top:0;left:0;width:100%;height:100%;' +
                'pointer-events:none;z-index:50;overflow:hidden;';
            // The overlay is absolutely positioned, so it needs a positioned
            // ancestor. The theme's #desktop-icons is already absolute
            // (inset:0) — DO NOT touch its position: overriding it with
            // 'relative' collapses the inset:0 sizing to content height
            // (32px), which made the grid 1 row tall and clamps every icon
            // to row 0 (only horizontal drag worked; 2026-08-29).
            if (getComputedStyle(this.container).position === 'static') {
                this.container.style.position = 'relative';
            }
            this.container.appendChild(this.overlay);

            this.injectStyles();
            this.buildGrid();
            this.bindEvents();

            // Rebuild on window resize (debounced). Named handler so
            // destroy() can remove it.
            var resizeTimer;
            this._onResize = function() {
                clearTimeout(resizeTimer);
                resizeTimer = setTimeout(function() { self.refresh(); }, 200);
            };
            window.addEventListener('resize', this._onResize);

            // Rebuild after renderShortcuts replaces container.innerHTML
            // (renderShortcuts wipes our overlay — refresh() recreates it).
            this._onRendered = function() {
                self.refresh();
            };
            document.addEventListener('desktop-icons-rendered', this._onRendered);

            console.log('[QuantumIcons] init ok: grid=' + this.gridCols + 'x' + this.gridRows +
                ' icons=' + this.container.querySelectorAll(this.config.iconSelector).length);
        },

        injectStyles: function() {
            if (document.getElementById('q-icon-grid-styles')) return;
            var style = document.createElement('style');
            style.id = 'q-icon-grid-styles';
            style.textContent =
                '.q-icon-grid-overlay .q-icon-cell{' +
                    'position:absolute;background-color:transparent;border:none;' +
                    'box-sizing:border-box;pointer-events:none;' +
                    'transition:background-color 0.12s ease,border-color 0.12s ease;' +
                    'border-radius:4px;' +
                '}' +
                '.q-icon-grid-overlay .q-icon-cell.visible{' +
                    'background-color:' + this.config.gridColor + ';' +
                    'border:1px solid rgba(255,255,255,0.3);' +
                '}' +
                '.q-icon-grid-overlay .q-icon-cell.active{' +
                    'background-color:' + this.config.activeColor + ' !important;' +
                    'border:2px solid rgba(255,255,255,0.6) !important;' +
                    'box-shadow:inset 0 0 30px rgba(255,255,255,0.1);' +
                '}' +
                '.desktop-icon.q-dragging{' +
                    'z-index:100 !important;opacity:0.9;cursor:grabbing;' +
                    'filter:drop-shadow(0 8px 24px rgba(0,0,0,0.6));' +
                    'transition:left 0.12s cubic-bezier(0.34,1.56,0.64,1),' +
                                'top 0.12s cubic-bezier(0.34,1.56,0.64,1);' +
                '}';
            document.head.appendChild(style);
        },

        // Rebuild grid + overlay + realign icons (call after re-render).
        refresh: function() {
            if (!this.overlay || !this.overlay.parentNode) {
                this.container.appendChild(this.overlay);
            }
            this.buildGrid();
        },

        buildGrid: function() {
            var rect = this.container.getBoundingClientRect();
            var w = rect.width || window.innerWidth;
            var h = rect.height || window.innerHeight;

            this.gridCols = Math.max(1, Math.floor((w - this.config.marginLeft) / this.config.gridW));
            this.gridRows = Math.max(1, Math.floor((h - this.config.marginTop) / this.config.gridH));

            this.overlay.innerHTML = '';
            this.cells = [];
            var fragment = document.createDocumentFragment();

            for (var row = 0; row < this.gridRows; row++) {
                this.cells[row] = [];
                for (var col = 0; col < this.gridCols; col++) {
                    var cell = document.createElement('div');
                    cell.className = 'q-icon-cell';
                    cell.dataset.col = col;
                    cell.dataset.row = row;
                    cell.style.left = (this.config.marginLeft + col * this.config.gridW) + 'px';
                    cell.style.top = (this.config.marginTop + row * this.config.gridH) + 'px';
                    cell.style.width = this.config.gridW + 'px';
                    cell.style.height = this.config.gridH + 'px';
                    fragment.appendChild(cell);
                    this.cells[row][col] = cell;
                }
            }
            this.overlay.appendChild(fragment);

            this.alignIconsToGrid();
        },

        alignIconsToGrid: function() {
            var self = this;
            var iconEls = this.container.querySelectorAll(this.config.iconSelector);
            iconEls.forEach(function(el) {
                var left = parseFloat(el.style.left) || 0;
                var top = parseFloat(el.style.top) || 0;
                var col = Math.round((left - self.config.marginLeft) / self.config.gridW);
                var row = Math.round((top - self.config.marginTop) / self.config.gridH);
                var clamped = self.snapIconToGrid(el, col, row, true);
                // Icon sat OUTSIDE the visible grid (e.g. the desktop was
                // shrunk after a maximized window or a resolution change).
                // Persist the clamped cell so it stays visible after a
                // reload too — otherwise renderShortcuts would re-place it
                // off-screen on every boot.
                if (clamped.col !== col || clamped.row !== row) {
                    if (typeof self.config.onPositionChange === 'function') {
                        self.config.onPositionChange(el, clamped.col, clamped.row);
                    }
                }
            });
        },

        snapIconToGrid: function(el, col, row, silent) {
            var clampedCol = Math.max(0, Math.min(this.gridCols - 1, col));
            var clampedRow = Math.max(0, Math.min(this.gridRows - 1, row));

            el.style.left = (this.config.marginLeft + clampedCol * this.config.gridW) + 'px';
            el.style.top = (this.config.marginTop + clampedRow * this.config.gridH) + 'px';
            el.dataset.col = clampedCol;
            el.dataset.row = clampedRow;

            if (!silent && typeof this.config.onPositionChange === 'function') {
                this.config.onPositionChange(el, clampedCol, clampedRow);
            }
            return { col: clampedCol, row: clampedRow };
        },

        getGridFromPoint: function(clientX, clientY) {
            var rect = this.container.getBoundingClientRect();
            var x = clientX - rect.left;
            var y = clientY - rect.top;
            var col = Math.floor((x - this.config.marginLeft) / this.config.gridW);
            var row = Math.floor((y - this.config.marginTop) / this.config.gridH);
            col = Math.max(0, Math.min(this.gridCols - 1, col));
            row = Math.max(0, Math.min(this.gridRows - 1, row));
            return { col: col, row: row };
        },

        updateGridVisibility: function(show, col, row) {
            for (var r = 0; r < this.gridRows; r++) {
                for (var c = 0; c < this.gridCols; c++) {
                    this.cells[r][c].classList.remove('visible', 'active');
                }
            }
            if (!show || col === undefined || row === undefined) return;

            var neighbors = [[0,0],[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
            for (var i = 0; i < neighbors.length; i++) {
                var nr = row + neighbors[i][0];
                var nc = col + neighbors[i][1];
                if (nr >= 0 && nr < this.gridRows && nc >= 0 && nc < this.gridCols) {
                    this.cells[nr][nc].classList.add('visible');
                }
            }
            if (row >= 0 && row < this.gridRows && col >= 0 && col < this.gridCols) {
                this.cells[row][col].classList.add('active');
            }
        },

        bindEvents: function() {
            var self = this;
            var container = this.container;
            var iconSelector = this.config.iconSelector;

            // ---- Suppress the click/dblclick that follows a real drag ----
            // Capture-phase listener: desktop.js listens for click (select)
            // and dblclick (open) on the container; after a drag we must
            // swallow both so dropping an icon never opens/selelects it.
            this._suppressClick = function(e) {
                if (self._justDragged) {
                    e.stopPropagation();
                    e.preventDefault();
                    self._justDragged = false;
                }
            };
            container.addEventListener('click', this._suppressClick, true);
            container.addEventListener('dblclick', this._suppressClick, true);

            // ---- Mouse ----
            this._onMouseDown = function(e) {
                if (self.config.enabled === false) return;
                var icon = e.target.closest(iconSelector);
                if (!icon) return;
                if (e.button !== 0) return;
                // interactive elements inside an icon stay clickable
                if (e.target.closest('a, button')) return;
                self._press(icon, e.clientX, e.clientY, e);
            };
            container.addEventListener('mousedown', this._onMouseDown);

            // ---- Touch (kept for parity; mobile CSS grid layout means the
            // desktop does not instantiate the engine on mobile) ----
            this._onTouchStart = function(e) {
                if (self.config.enabled === false) return;
                var icon = e.target.closest(iconSelector);
                if (!icon) return;
                var touch = e.touches[0];
                if (!touch) return;
                if (e.target.closest('a, button')) return;
                self._press(icon, touch.clientX, touch.clientY, e, true);
            };
            container.addEventListener('touchstart', this._onTouchStart, { passive: false });
        },

        _press: function(icon, clientX, clientY, e, isTouch) {
            var self = this;
            if (this.isDragging) return;
            console.log('[QuantumIcons] mousedown icon=' + (icon.getAttribute('data-url') || '?') +
                ' enabled=' + this.config.enabled + ' at=' + clientX + ',' + clientY);

            // Remember the cell the icon started from — the drop-swap
            // logic moves an occupying icon back here. Read BEFORE any
            // snap updates dataset.col/row during the drag.
            this._startCol = parseInt(icon.dataset.col, 10) || 0;
            this._startRow = parseInt(icon.dataset.row, 10) || 0;

            // Phase 1: arm — do NOT preventDefault yet (click/dblclick must
            // survive for presses that never become drags).
            var startX = clientX;
            var startY = clientY;
            var engaged = false;

            var onMove = function(ev) {
                if (self.isDragging && self.dragTarget !== icon) return;
                var cx = ev.clientX !== undefined ? ev.clientX : (ev.touches && ev.touches[0].clientX);
                var cy = ev.clientY !== undefined ? ev.clientY : (ev.touches && ev.touches[0].clientY);
                if (cx === undefined) return;

                if (!engaged) {
                    var dx = cx - startX;
                    var dy = cy - startY;
                    if (Math.abs(dx) < self.config.dragThreshold &&
                        Math.abs(dy) < self.config.dragThreshold) return;
                    // threshold crossed → take over the gesture
                    engaged = true;
                    console.log('[QuantumIcons] drag engaged (dx=' + (cx - startX) + ',dy=' + (cy - startY) + ')');
                    self.isDragging = true;
                    self.dragTarget = icon;
                    var rect = icon.getBoundingClientRect();
                    self._dragOffsetX = startX - rect.left;
                    self._dragOffsetY = startY - rect.top;
                    icon.classList.add('q-dragging');
                    var pos = self.getGridFromPoint(startX, startY);
                    self.updateGridVisibility(true, pos.col, pos.row);
                    if (ev.cancelable) ev.preventDefault();
                }

                var containerRect = self.container.getBoundingClientRect();
                var x = cx - containerRect.left - self._dragOffsetX;
                var y = cy - containerRect.top - self._dragOffsetY;
                var col = Math.round((x - self.config.marginLeft) / self.config.gridW);
                var row = Math.round((y - self.config.marginTop) / self.config.gridH);
                var clampedCol = Math.max(0, Math.min(self.gridCols - 1, col));
                var clampedRow = Math.max(0, Math.min(self.gridRows - 1, row));
                self.snapIconToGrid(icon, clampedCol, clampedRow, true);
                self.updateGridVisibility(true, clampedCol, clampedRow);
                if (ev.cancelable) ev.preventDefault();
            };

            var cleanup = function() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onEnd);
                document.removeEventListener('touchmove', onMove);
                document.removeEventListener('touchend', onEnd);
                document.removeEventListener('touchcancel', onEnd);
            };
            self._dragCleanup = cleanup;

            var onEnd = function(ev) {
                cleanup();
                self._dragCleanup = null;

                if (!engaged) return;    // plain press — leave click intact

                self.isDragging = false;
                icon.classList.remove('q-dragging');
                icon.style.zIndex = '';
                self.updateGridVisibility(false);

                var col = parseInt(icon.dataset.col) || 0;
                var row = parseInt(icon.dataset.row) || 0;
                var startCol = self._startCol || 0;
                var startRow = self._startRow || 0;

                // Drop-swap: if another icon already sits on the target
                // cell, move it to the dragged icon's ORIGINAL cell so
                // icons never stack (both positions are reported through
                // onPositionChange so the caller persists both).
                var occupant = null;
                self.container.querySelectorAll(self.config.iconSelector).forEach(function(other) {
                    if (other === icon || occupant) return;
                    if (parseInt(other.dataset.col, 10) === col &&
                        parseInt(other.dataset.row, 10) === row) {
                        occupant = other;
                    }
                });
                if (occupant) {
                    // Animated swap: let the displaced icon glide to the
                    // dragged icon's old cell (same quantum bounce easing
                    // as the drag), then drop the transient transition.
                    occupant.style.transition =
                        'left 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), ' +
                        'top 0.18s cubic-bezier(0.34, 1.56, 0.64, 1)';
                    self.snapIconToGrid(occupant, startCol, startRow, true);
                    setTimeout(function() {
                        occupant.style.transition = '';
                    }, 240);
                    console.log('[QuantumIcons] swap: ' + (occupant.getAttribute('data-url') || '?') +
                        ' -> ' + startCol + ',' + startRow);
                    if (typeof self.config.onPositionChange === 'function') {
                        self.config.onPositionChange(occupant, startCol, startRow);
                    }
                }

                console.log('[QuantumIcons] drag end col=' + col + ' row=' + row +
                    ' left=' + icon.style.left + ' top=' + icon.style.top);
                if (typeof self.config.onPositionChange === 'function') {
                    self.config.onPositionChange(icon, col, row);
                }
                // swallow the click/dblclick pair following this drag
                self._justDragged = true;
                setTimeout(function() { self._justDragged = false; }, 350);
                self.dragTarget = null;
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onEnd);
            if (isTouch) {
                document.addEventListener('touchmove', onMove, { passive: false });
                document.addEventListener('touchend', onEnd);
                document.addEventListener('touchcancel', onEnd);
            }
        },

        // Programmatic reset (context menu "reset layout" could call this)
        resetPositions: function() {
            var self = this;
            var perRow = this.gridCols;
            var idx = 0;
            var iconEls = this.container.querySelectorAll(this.config.iconSelector);
            iconEls.forEach(function(el) {
                var col = idx % perRow;
                var row = Math.floor(idx / perRow);
                self.snapIconToGrid(el, col, row, true);
                idx++;
            });
        },

        destroy: function() {
            if (this.overlay && this.overlay.parentNode) {
                this.overlay.parentNode.removeChild(this.overlay);
            }
            // Full listener cleanup — a destroyed engine must never answer
            // another mousedown / drag / re-render (tests re-init Desktop
            // repeatedly; leaks here caused multiple engines to react to
            // one drag and duplicate UCI saves).
            if (this._onMouseDown) this.container.removeEventListener('mousedown', this._onMouseDown);
            if (this._onTouchStart) this.container.removeEventListener('touchstart', this._onTouchStart);
            if (this._suppressClick) {
                this.container.removeEventListener('click', this._suppressClick, true);
                this.container.removeEventListener('dblclick', this._suppressClick, true);
            }
            if (this._onRendered) document.removeEventListener('desktop-icons-rendered', this._onRendered);
            if (this._onResize) window.removeEventListener('resize', this._onResize);
            if (this._dragCleanup) {
                this._dragCleanup();
                this._dragCleanup = null;
            }
            var iconEls = this.container.querySelectorAll(this.config.iconSelector);
            iconEls.forEach(function(el) {
                el.classList.remove('q-dragging');
                el.style.zIndex = '';
            });
            this.isDragging = false;
            this.dragTarget = null;
            this.overlay = null;
        }
    };

    DESKTOP.QuantumIcons = QuantumIcons;
})();
