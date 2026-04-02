// js/canvas/renderer.js — Battle map canvas engine
// Coordinate system: all game state is in grid-cell units.
// Pixel positions are derived at render time from the viewport transform.

export const ZONE_TYPES = {
  difficult: { color: '#8B4513', label: 'Difficult Terrain' },
  fire:      { color: '#FF4500', label: 'Fire' },
  water:     { color: '#1E90FF', label: 'Water' },
  ice:       { color: '#87CEEB', label: 'Ice' },
  darkness:  { color: '#1a0a2e', label: 'Magical Darkness' },
  web:       { color: '#C0C0C0', label: 'Web' },
  poison:    { color: '#32CD32', label: 'Poison' },
};

export class Renderer {
  constructor(canvas, options = {}) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d');
    this.options = {
      role:        options.role        || 'player',  // dm | player | observer
      fitToScreen: options.fitToScreen || false,
      ...options
    };

    // Viewport state (local — not synced to other clients)
    this.zoom  = 1;
    this.panX  = 0;
    this.panY  = 0;

    // Grid config (set when map is loaded)
    this.gridConfig = null;   // { originX, originY, cellSizePx, cols, rows, confidence }

    // Game state
    this.mapImage    = null;
    this.tokens      = new Map();   // id → token object
    this.fogCells    = new Map();   // "x,y" → bool (true = revealed)
    this.zoneCells   = new Map();   // "x,y" → zone type string
    this.overlays    = [];
    this.activeTurn  = null;
    this.activeTool  = 'move';
    this.activeZoneType = 'difficult';

    // Interaction state
    this.isDragging  = false;
    this.dragStart   = { x: 0, y: 0 };
    this.selectedId  = null;
    this.hoveredCell = null;         // { x, y } grid cell under cursor
    this._dragToken  = null;
    this._painting   = false;        // fog/zone brush active
    this._paintValue = null;         // what we're painting (bool for fog, string for zone)
    this._paintBatch = {};           // cells changed this stroke, sent on mouseup
    this.eventHandlers = {};

    this._resizeObserver = new ResizeObserver(() => this._resize());
    this._resizeObserver.observe(canvas.parentElement);
    this._resize();
    this._bindInput();
    this._loop();
  }

  // ── Public API ──────────────────────────────────────────────────

  /** Load a map image URL and apply grid config */
  loadMap(imageUrl, gridConfig) {
    this.gridConfig = gridConfig;
    const img = new Image();
    img.onload = () => { this.mapImage = img; this._centerMap(); };
    img.src    = imageUrl;
  }

  /** Update grid config and re-render (used by live grid editor) */
  updateGridConfig(config) {
    this.gridConfig = config;
  }

  setTool(tool) {
    this.activeTool = tool;
    this.canvas.style.cursor = tool === 'move' ? 'grab' : 'crosshair';
  }

  setZoneType(type) {
    this.activeZoneType = type;
  }

  addToken(sc) {
    this.tokens.set(sc.id, {
      id:        sc.id,
      name:      sc.characterName,
      player:    sc.playerName,
      type:      sc.tokenType || 'PLAYER',
      speed:     sc.speed     || 30,
      x:         sc.positionX,
      y:         sc.positionY,
      currentHp: sc.currentHp,
      maxHp:     sc.maxHp,
      conditions: sc.conditions || [],
      avatarUrl: sc.avatarUrl,
      avatarImg: null,
    });
    this._loadTokenAvatar(sc.id, sc.avatarUrl);
  }

  moveToken(tokenId, x, y) {
    const token = this.tokens.get(tokenId);
    if (token) { token.x = x; token.y = y; }
  }

  updateConditions(tokenId, conditions) {
    const token = this.tokens.get(tokenId);
    if (token) token.conditions = conditions;
  }

  updateHp(tokenId, currentHp, maxHp) {
    const token = this.tokens.get(tokenId);
    if (token) { token.currentHp = currentHp; token.maxHp = maxHp; }
  }

  setActiveTurn(tokenId) {
    this.activeTurn = tokenId;
  }

  setViewport(zoom, panX, panY) {
    this.zoom = zoom;
    this.panX = panX;
    this.panY = panY;
  }

  /**
   * Zoom so that each grid square is approximately 1 physical inch on screen.
   * Uses a hidden 1in ruler element to measure CSS pixels-per-inch, then scales
   * to match. Keeps the current viewport center stable.
   */
  zoomToInch() {
    const m = this._gridMetrics();
    if (!m || !this.mapImage) return;

    // Measure CSS pixels per inch via a temporary ruler element
    const ruler = document.createElement('div');
    ruler.style.cssText = 'position:fixed;width:1in;height:0;visibility:hidden;pointer-events:none';
    document.body.appendChild(ruler);
    const pxPerInch = ruler.offsetWidth || 96;
    document.body.removeChild(ruler);

    const cellPx  = (m.cellW + m.cellH) / 2;
    const newZoom = pxPerInch / cellPx;

    // Zoom around the current canvas center so the view stays stable
    const cx = this.canvas.width  / 2;
    const cy = this.canvas.height / 2;
    const mapCx = (cx - this.panX) / this.zoom;
    const mapCy = (cy - this.panY) / this.zoom;

    this.zoom = newZoom;
    this.panX = cx - mapCx * newZoom;
    this.panY = cy - mapCy * newZoom;
  }

  /** Update fog cells — cells is an object { "x,y": true/false } */
  updateFog(cells) {
    Object.entries(cells).forEach(([key, revealed]) => {
      this.fogCells.set(key, revealed);
    });
  }

  setFogAll(revealed) {
    if (!this.gridConfig) return;
    const { cols, rows } = this.gridConfig;
    for (let x = 0; x < cols; x++) {
      for (let y = 0; y < rows; y++) {
        this.fogCells.set(`${x},${y}`, revealed);
      }
    }
  }

  /** Update zone cells — zones is an object { "x,y": zoneType } */
  updateZones(zones) {
    if (!zones) return;
    Object.entries(zones).forEach(([key, type]) => {
      if (type && type !== 'none') this.zoneCells.set(key, type);
      else this.zoneCells.delete(key);
    });
  }

  /** Clear all zone cells */
  clearZones() {
    this.zoneCells.clear();
  }

  showOverlay(overlay) {
    this.overlays.push({ ...overlay, startTime: Date.now() });
    setTimeout(() => {
      this.overlays = this.overlays.filter(o => o !== overlay);
    }, overlay.duration || 3000);
  }

  /** Register event handler: 'tokenSelected' | 'tokenMoved' | 'fogPainted' | 'zonesPainted' */
  on(event, fn) {
    if (!this.eventHandlers[event]) this.eventHandlers[event] = [];
    this.eventHandlers[event].push(fn);
  }

  destroy() {
    this._resizeObserver.disconnect();
    cancelAnimationFrame(this._rafId);
    this.canvas.removeEventListener('mousedown', this._onMouseDown);
    this.canvas.removeEventListener('mousemove', this._onMouseMove);
    this.canvas.removeEventListener('mouseup',   this._onMouseUp);
    this.canvas.removeEventListener('wheel',     this._onWheel);
  }

  // ── Render loop ─────────────────────────────────────────────────

  _loop() {
    this._rafId = requestAnimationFrame(() => this._loop());
    this._draw();
  }

  _draw() {
    const { ctx, canvas, zoom, panX, panY } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    // 1. Map image
    if (this.mapImage) {
      ctx.drawImage(this.mapImage, 0, 0);
    } else {
      ctx.fillStyle = '#050508';
      ctx.fillRect(0, 0, canvas.width / zoom, canvas.height / zoom);
    }

    // 2. Zone fills
    this._drawZones();

    // 3. Grid overlay
    if (this.gridConfig) this._drawGrid();

    // 4. Fog of War
    this._drawFog();

    // 5. Hover highlight (DM only)
    if (this.hoveredCell && this.options.role === 'dm') this._drawHover();

    // 6. Tokens
    this._drawTokens();

    // 7. Overlays
    this._drawOverlays();

    ctx.restore();
  }

  // ── Drawing helpers ─────────────────────────────────────────────

  /** Returns the natural image size (for grid panel auto-calc) */
  getImageSize() {
    return this.mapImage
      ? { width: this.mapImage.width, height: this.mapImage.height }
      : null;
  }

  /**
   * Derive pixel metrics from the current gridConfig.
   * Supports both the new margin-based format and the legacy originX/cellSizePx format.
   * Returns { originX, originY, cellW, cellH, cols, rows } or null if not ready.
   */
  _gridMetrics() {
    if (!this.gridConfig) return null;
    const cfg = this.gridConfig;

    // New margin-based format
    if (cfg.marginLeft !== undefined || cfg.marginTop !== undefined) {
      if (!this.mapImage) return null;
      const { marginLeft = 0, marginRight = 0, marginTop = 0, marginBottom = 0,
              cols = 1, rows = 1 } = cfg;
      const cellW = (this.mapImage.width  - marginLeft - marginRight) / cols;
      const cellH = (this.mapImage.height - marginTop  - marginBottom) / rows;
      return { originX: marginLeft, originY: marginTop, cellW, cellH, cols, rows };
    }

    // Legacy format: { originX, originY, cellSizePx, cols, rows }
    const { originX = 0, originY = 0, cellSizePx = 50, cols = 20, rows = 15 } = cfg;
    return { originX, originY, cellW: cellSizePx, cellH: cellSizePx, cols, rows };
  }

  _drawGrid() {
    const m = this._gridMetrics();
    if (!m) return;
    const { originX, originY, cellW, cellH, cols, rows } = m;
    const ctx = this.ctx;

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth   = 1 / this.zoom;

    for (let x = 0; x <= cols; x++) {
      const px = originX + x * cellW;
      ctx.beginPath();
      ctx.moveTo(px, originY);
      ctx.lineTo(px, originY + rows * cellH);
      ctx.stroke();
    }

    for (let y = 0; y <= rows; y++) {
      const py = originY + y * cellH;
      ctx.beginPath();
      ctx.moveTo(originX, py);
      ctx.lineTo(originX + cols * cellW, py);
      ctx.stroke();
    }

    ctx.restore();
  }

  _drawFog() {
    const m = this._gridMetrics();
    if (!m) return;
    const { originX, originY, cellW, cellH, cols, rows } = m;
    const ctx  = this.ctx;
    const isDm = this.options.role === 'dm';

    ctx.fillStyle = isDm ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.98)';

    for (let x = 0; x < cols; x++) {
      for (let y = 0; y < rows; y++) {
        const revealed = this.fogCells.get(`${x},${y}`);
        if (!revealed) {
          ctx.fillRect(
            originX + x * cellW,
            originY + y * cellH,
            cellW, cellH
          );
        }
      }
    }
  }

  _drawZones() {
    const m = this._gridMetrics();
    if (!m) return;
    const { originX, originY, cellW, cellH } = m;
    const ctx = this.ctx;

    ctx.save();
    for (const [key, type] of this.zoneCells) {
      const def = ZONE_TYPES[type];
      if (!def) continue;
      const [gx, gy] = key.split(',').map(Number);
      const px = originX + gx * cellW;
      const py = originY + gy * cellH;

      ctx.globalAlpha = 0.45;
      ctx.fillStyle   = def.color;
      ctx.fillRect(px, py, cellW, cellH);

      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = def.color;
      ctx.lineWidth   = 1 / this.zoom;
      ctx.strokeRect(px + 0.5, py + 0.5, cellW - 1, cellH - 1);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  _drawHover() {
    const m = this._gridMetrics();
    if (!m || !this.hoveredCell) return;
    const { originX, originY, cellW, cellH } = m;
    const { x, y } = this.hoveredCell;
    const ctx = this.ctx;

    let color = 'rgba(255,255,255,0.15)';
    if (this.activeTool === 'fog')  color = 'rgba(0, 120, 255, 0.25)';
    if (this.activeTool === 'zone') {
      const def = ZONE_TYPES[this.activeZoneType];
      color = def ? `${def.color}55` : 'rgba(255,120,0,0.25)';
    }

    ctx.save();
    ctx.fillStyle   = color;
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth   = 1.5 / this.zoom;
    ctx.fillRect(originX + x * cellW, originY + y * cellH, cellW, cellH);
    ctx.strokeRect(originX + x * cellW + 0.5, originY + y * cellH + 0.5, cellW - 1, cellH - 1);
    ctx.restore();
  }

  _drawTokens() {
    const { ctx } = this;
    const m = this._gridMetrics();
    if (!m) return;
    const { originX, originY, cellW, cellH } = m;
    const cellSize = Math.min(cellW, cellH);

    for (const token of this.tokens.values()) {
      if (token.x == null || token.y == null) continue;

      const px  = originX + token.x * cellW;
      const py  = originY + token.y * cellH;
      const r   = cellSize * 0.42;
      const cx  = px + cellW / 2;
      const cy  = py + cellH / 2;

      ctx.save();

      if (token.id === this.activeTurn) {
        ctx.shadowColor = '#c9a84c';
        ctx.shadowBlur  = 14 / this.zoom;
      }

      const color = this._tokenColor(token);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = color.bg;
      ctx.fill();
      ctx.strokeStyle = token.id === this.selectedId ? '#c9a84c' : color.border;
      ctx.lineWidth   = (token.id === this.selectedId ? 2.5 : 1.5) / this.zoom;
      ctx.stroke();
      ctx.shadowBlur  = 0;

      if (token.avatarImg) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r - 1 / this.zoom, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(token.avatarImg, cx - r, cy - r, r * 2, r * 2);
        ctx.restore();
      } else {
        ctx.fillStyle   = color.text;
        ctx.font        = `bold ${Math.round(r * 0.75)}px "Cinzel", serif`;
        ctx.textAlign   = 'center';
        ctx.textBaseline= 'middle';
        ctx.fillText(_initials(token.name), cx, cy);
      }

      if (token.conditions?.length) {
        const dotR = 3 / this.zoom;
        const gap  = 7 / this.zoom;
        const startX = cx - ((token.conditions.length - 1) * gap) / 2;
        token.conditions.slice(0, 4).forEach((cond, i) => {
          ctx.beginPath();
          ctx.arc(startX + i * gap, cy + r + 5 / this.zoom, dotR, 0, Math.PI * 2);
          ctx.fillStyle = _conditionColor(cond);
          ctx.fill();
        });
      }

      if (token.maxHp && token.currentHp != null) {
        const barW = cellW * 0.8;
        const barH = 3 / this.zoom;
        const barX = px + (cellW - barW) / 2;
        const barY = py + cellH - barH - 2 / this.zoom;
        const pct  = Math.max(0, Math.min(1, token.currentHp / token.maxHp));

        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(barX, barY, barW, barH);
        ctx.fillStyle = pct > 0.5 ? '#27ae60' : pct > 0.25 ? '#d68910' : '#e74c3c';
        ctx.fillRect(barX, barY, barW * pct, barH);
      }

      ctx.restore();
    }
  }

  _drawOverlays() {
    for (const overlay of this.overlays) {
      if (overlay.type === 'MOVEMENT_RANGE') {
        this._drawMovementRange(overlay);
      }
    }
  }

  _drawMovementRange(overlay) {
    const { cells, color } = overlay;
    const m = this._gridMetrics();
    if (!cells || !m) return;
    const { originX, originY, cellW, cellH } = m;
    const ctx = this.ctx;

    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle   = color || '#3498db';
    cells.forEach(([gx, gy]) => {
      ctx.fillRect(
        originX + gx * cellW,
        originY + gy * cellH,
        cellW, cellH
      );
    });
    ctx.restore();
  }

  // ── Input handling ──────────────────────────────────────────────

  _bindInput() {
    this._onMouseDown = this._handleMouseDown.bind(this);
    this._onMouseMove = this._handleMouseMove.bind(this);
    this._onMouseUp   = this._handleMouseUp.bind(this);
    this._onWheel     = this._handleWheel.bind(this);

    this.canvas.addEventListener('mousedown', this._onMouseDown);
    this.canvas.addEventListener('mousemove', this._onMouseMove);
    this.canvas.addEventListener('mouseup',   this._onMouseUp);
    this.canvas.addEventListener('wheel',     this._onWheel, { passive: false });
    this.canvas.addEventListener('mouseleave', () => { this.hoveredCell = null; });

    this.canvas.addEventListener('touchstart',  this._handleTouchStart.bind(this),  { passive: false });
    this.canvas.addEventListener('touchmove',   this._handleTouchMove.bind(this),   { passive: false });
    this.canvas.addEventListener('touchend',    this._handleTouchEnd.bind(this));
  }

  _handleMouseDown(e) {
    const world = this._screenToWorld(e.offsetX, e.offsetY);
    const cell  = this._worldToCell(world.x, world.y);

    if (this.activeTool === 'move') {
      const hit = this._hitTestToken(world.x, world.y);
      if (hit) {
        this.selectedId = hit.id;
        this._dragToken = hit;
        this._emit('tokenSelected', hit.id);
      } else {
        this.selectedId = null;
        this._dragToken  = null;
        this.isDragging  = true;
        this.dragStart   = { x: e.clientX - this.panX, y: e.clientY - this.panY };
      }
    }

    if (this.activeTool === 'fog' && this.options.role === 'dm' && cell) {
      const key     = `${cell.x},${cell.y}`;
      const current = this.fogCells.get(key);
      this._paintValue = !current;   // toggle: start painting opposite of clicked cell
      this._painting   = true;
      this._paintBatch = {};
      this._applyFogCell(cell.x, cell.y);
    }

    if (this.activeTool === 'zone' && this.options.role === 'dm' && cell) {
      const key     = `${cell.x},${cell.y}`;
      const current = this.zoneCells.get(key);
      // If clicking on same zone type, erase; otherwise paint
      this._paintValue = (current === this.activeZoneType) ? 'none' : this.activeZoneType;
      this._painting   = true;
      this._paintBatch = {};
      this._applyZoneCell(cell.x, cell.y);
    }
  }

  _handleMouseMove(e) {
    const world = this._screenToWorld(e.offsetX, e.offsetY);
    const cell  = this._worldToCell(world.x, world.y);

    // Update hover cell
    if (cell && this.gridConfig) {
      const { cols, rows } = this.gridConfig;
      this.hoveredCell = (cell.x >= 0 && cell.x < cols && cell.y >= 0 && cell.y < rows)
        ? cell : null;
    }

    if (this.isDragging) {
      this.panX = e.clientX - this.dragStart.x;
      this.panY = e.clientY - this.dragStart.y;
    }

    if (this._dragToken && this.options.role === 'dm') {
      const c = this._worldToCell(world.x, world.y);
      this._dragToken.x = c.x;
      this._dragToken.y = c.y;
    }

    if (this._painting && cell) {
      if (this.activeTool === 'fog')  this._applyFogCell(cell.x, cell.y);
      if (this.activeTool === 'zone') this._applyZoneCell(cell.x, cell.y);
    }
  }

  _handleMouseUp(e) {
    if (this._dragToken && this.options.role === 'dm') {
      const world = this._screenToWorld(e.offsetX, e.offsetY);
      const cell  = this._worldToCell(world.x, world.y);
      this._emit('tokenMoved', { tokenId: this._dragToken.id, x: cell.x, y: cell.y });
    }

    if (this._painting) {
      if (this.activeTool === 'fog' && Object.keys(this._paintBatch).length) {
        this._emit('fogPainted', { ...this._paintBatch });
      }
      if (this.activeTool === 'zone' && Object.keys(this._paintBatch).length) {
        this._emit('zonesPainted', { ...this._paintBatch });
      }
      this._painting   = false;
      this._paintValue = null;
      this._paintBatch = {};
    }

    this.isDragging = false;
    this._dragToken  = null;
  }

  _applyFogCell(x, y) {
    if (!this.gridConfig) return;
    const { cols, rows } = this.gridConfig;
    if (x < 0 || x >= cols || y < 0 || y >= rows) return;
    const key = `${x},${y}`;
    this.fogCells.set(key, this._paintValue);
    this._paintBatch[key] = this._paintValue;
  }

  _applyZoneCell(x, y) {
    if (!this.gridConfig) return;
    const { cols, rows } = this.gridConfig;
    if (x < 0 || x >= cols || y < 0 || y >= rows) return;
    const key = `${x},${y}`;
    if (this._paintValue === 'none') this.zoneCells.delete(key);
    else this.zoneCells.set(key, this._paintValue);
    this._paintBatch[key] = this._paintValue;
  }

  _handleWheel(e) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.08 : 0.92;
    const wx = (e.offsetX - this.panX) / this.zoom;
    const wy = (e.offsetY - this.panY) / this.zoom;
    this.zoom = Math.min(Math.max(this.zoom * factor, 0.2), 6);
    this.panX = e.offsetX - wx * this.zoom;
    this.panY = e.offsetY - wy * this.zoom;
  }

  _handleTouchStart(e) {
    if (e.touches.length === 2) {
      this._pinchDist = _touchDist(e.touches);
    }
  }

  _handleTouchMove(e) {
    e.preventDefault();
    if (e.touches.length === 2 && this._pinchDist) {
      const newDist  = _touchDist(e.touches);
      const factor   = newDist / this._pinchDist;
      this.zoom      = Math.min(Math.max(this.zoom * factor, 0.2), 6);
      this._pinchDist = newDist;
    }
  }

  _handleTouchEnd() { this._pinchDist = null; }

  // ── Coordinate helpers ──────────────────────────────────────────

  _screenToWorld(sx, sy) {
    return { x: (sx - this.panX) / this.zoom, y: (sy - this.panY) / this.zoom };
  }

  _worldToCell(wx, wy) {
    const m = this._gridMetrics();
    if (!m) return null;
    return {
      x: Math.floor((wx - m.originX) / m.cellW),
      y: Math.floor((wy - m.originY) / m.cellH),
    };
  }

  _hitTestToken(wx, wy) {
    const m = this._gridMetrics();
    if (!m) return null;
    const { originX, originY, cellW, cellH } = m;
    for (const token of this.tokens.values()) {
      if (token.x == null) continue;
      const tx = originX + token.x * cellW;
      const ty = originY + token.y * cellH;
      if (wx >= tx && wx < tx + cellW && wy >= ty && wy < ty + cellH) {
        return token;
      }
    }
    return null;
  }

  // ── Misc helpers ────────────────────────────────────────────────

  _resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    this.canvas.width  = parent.clientWidth;
    this.canvas.height = parent.clientHeight;
    if (this.options.fitToScreen) this._centerMap();
  }

  _centerMap() {
    if (!this.mapImage) return;
    const scaleX = this.canvas.width  / this.mapImage.width;
    const scaleY = this.canvas.height / this.mapImage.height;
    this.zoom    = this.options.fitToScreen ? Math.min(scaleX, scaleY) : 1;
    this.panX    = (this.canvas.width  - this.mapImage.width  * this.zoom) / 2;
    this.panY    = (this.canvas.height - this.mapImage.height * this.zoom) / 2;
  }

  _loadTokenAvatar(id, url) {
    if (!url) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const token = this.tokens.get(id);
      if (token) token.avatarImg = img;
    };
    img.src = url;
  }

  _tokenColor(token) {
    const colors = {
      PLAYER: { bg: '#1a3a5c', border: '#2980b9', text: '#85c1e9' },
      NPC:    { bg: '#3a1a1a', border: '#c0392b', text: '#e74c3c' },
      SUMMON: { bg: '#1a3a1a', border: '#27ae60', text: '#82e0aa' },
    };
    return colors[token.type] || colors.PLAYER;
  }

  _emit(event, data) {
    (this.eventHandlers[event] || []).forEach(fn => fn(data));
  }
}

// ── Module-level helpers ──────────────────────────────────────────

function _initials(name = '?') {
  return name.split(/[\s\/]+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
}

function _conditionColor(cond) {
  const map = {
    Slowed:        '#85c1e9',
    Restrained:    '#e59866',
    Prone:         '#aab7b8',
    Blinded:       '#8e44ad',
    Invisible:     '#7fb3d3',
    Concentrating: '#c9a84c',
    Incapacitated: '#e74c3c',
  };
  return map[cond] || '#aab7b8';
}

function _touchDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}
