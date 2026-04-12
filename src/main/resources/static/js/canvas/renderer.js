// js/canvas/renderer.js — Battle map canvas engine
// Coordinate system: all game state is in grid-cell units.
// Pixel positions are derived at render time from the viewport transform.

// UUID generator that works in both secure (HTTPS/localhost) and insecure contexts.
// crypto.randomUUID() is only available in secure contexts.
function _uuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // RFC4122 v4 fallback using Math.random (sufficient for client-side overlay IDs)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

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
    this.zoom     = 1;
    this.panX     = 0;
    this.panY     = 0;
    this.rotation = 0;  // degrees: 0 | 90 | 180 | 270 (local display only)

    // Grid config (set when map is loaded)
    this.gridConfig = null;   // { originX, originY, cellSizePx, cols, rows, confidence }

    // Game state
    this.mapImage    = null;
    this.tokens      = new Map();   // id → token object
    this.fogCells    = new Map();   // "x,y" → bool (true = revealed)
    this.zoneCells   = new Map();   // "x,y" → zone type string
    this.overlays    = [];
    this.spellOverlays   = [];       // persistent AoE overlays
    this._spellPlacement = null;     // { template, phase:'origin'|'direction', originPx, previewPx, onPlaced }
    this.myTokenId   = options.myTokenId || null;  // player's own SC id — restricts drag to own token
    this.activeTurn  = null;
    this.activeTool  = 'move';
    this.activeZoneType = 'difficult';

    // Interaction state
    this.isDragging    = false;
    this.dragStart     = { x: 0, y: 0 };
    this.selectedId    = null;
    this.hoveredCell   = null;         // { x, y } grid cell under cursor
    this._dragToken    = null;
    this._painting     = false;        // fog/zone brush active
    this._paintValue   = null;         // what we're painting (bool for fog, string for zone)
    this._paintBatch   = {};           // cells changed this stroke, sent on mouseup
    this._placingTokenId = null;       // token id being placed onto the map
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

  /** Begin placement mode: next canvas click drops the token at that cell */
  startPlacement(tokenId) {
    this._placingTokenId = tokenId;
    this.canvas.style.cursor = 'crosshair';
  }

  /** Cancel an in-progress placement (e.g. Escape key) */
  cancelPlacement() {
    if (!this._placingTokenId) return;
    this._placingTokenId = null;
    this.canvas.style.cursor = this.activeTool === 'move' ? 'grab' : 'crosshair';
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

  /** Rotate the local view 90° counter-clockwise */
  rotateLeft() {
    this.rotation = (this.rotation + 270) % 360;
    this._centerMap();
  }

  /** Rotate the local view 90° clockwise */
  rotateRight() {
    this.rotation = (this.rotation + 90) % 360;
    this._centerMap();
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

  /** Add a persistent spell overlay (from DB load or WS event). Deduplicates by id. */
  addSpellOverlay(overlay) {
    if (!this.spellOverlays.find(o => o.id === overlay.id))
      this.spellOverlays.push(overlay);
  }

  /** Remove a persistent spell overlay by id. */
  removeSpellOverlay(id) {
    this.spellOverlays = this.spellOverlays.filter(o => o.id !== id);
  }

  /**
   * Begin interactive spell placement on the canvas.
   * @param {Object} template — { shape, label, color, sizeFt, visibility }
   * @param {Function} onPlaced — callback(completedOverlay)
   */
  startSpellPlacement(template, onPlaced) {
    this._spellPlacement = { template, phase: 'origin', originPx: null, previewPx: null, onPlaced };
    this.canvas.style.cursor = 'crosshair';
  }

  /** Cancel an in-progress spell placement (e.g. Escape key). */
  cancelSpellPlacement() {
    if (!this._spellPlacement) return;
    this._spellPlacement = null;
    this.canvas.style.cursor = this.activeTool === 'move' ? 'grab' : 'crosshair';
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

    // Apply local rotation around the map center (display-only, does not affect game state)
    if (this.rotation !== 0 && this.mapImage) {
      const cx = this.mapImage.width  / 2;
      const cy = this.mapImage.height / 2;
      ctx.translate(cx, cy);
      ctx.rotate(this.rotation * Math.PI / 180);
      ctx.translate(-cx, -cy);
    }

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

    // Ghost token: draw semi-transparent at hovered cell during placement
    if (this._placingTokenId && this.hoveredCell) {
      const ghost = this.tokens.get(this._placingTokenId);
      if (ghost) {
        ctx.save();
        ctx.globalAlpha = 0.5;
        this._drawSingleToken(ghost, this.hoveredCell.x, this.hoveredCell.y, m);
        ctx.restore();
      }
    }

    for (const token of this.tokens.values()) {
      if (token.x == null || token.y == null) continue;
      ctx.save();
      this._drawSingleToken(token, token.x, token.y, m);
      ctx.restore();
    }
  }

  _drawSingleToken(token, gx, gy, m) {
    const { ctx } = this;
    const { originX, originY, cellW, cellH } = m;
    const cellSize = Math.min(cellW, cellH);

    const px = originX + gx * cellW;
    const py = originY + gy * cellH;
    const r  = cellSize * 0.42;
    const cx = px + cellW / 2;
    const cy = py + cellH / 2;

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
      ctx.fillStyle    = color.text;
      ctx.font         = `bold ${Math.round(r * 0.75)}px "Cinzel", serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(_initials(token.name), cx, cy);
    }

    if (token.conditions?.length) {
      const dotR   = 3 / this.zoom;
      const gap    = 7 / this.zoom;
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
  }

  _finalizeSpellOverlay(template, originPx, direction) {
    return { id: _uuid(), ...template, origin: { x: originPx.x, y: originPx.y }, direction };
  }

  _drawOverlays() {
    // Ephemeral overlays (e.g. movement range)
    for (const overlay of this.overlays) {
      if (overlay.type === 'MOVEMENT_RANGE') this._drawMovementRange(overlay);
    }

    // Persistent spell AoE overlays
    const m = this._gridMetrics();
    if (!m) return;
    for (const overlay of this.spellOverlays) {
      this._drawSpellOverlay(overlay, m);
    }

    // Live placement preview
    if (this._spellPlacement?.previewPx) {
      const sp     = this._spellPlacement;
      const origin = sp.originPx || sp.previewPx;
      let dir = null;
      if (sp.phase === 'direction' && sp.originPx) {
        dir = Math.atan2(sp.previewPx.y - sp.originPx.y, sp.previewPx.x - sp.originPx.x) * 180 / Math.PI;
      }
      const preview = { ...sp.template, origin: { x: origin.x, y: origin.y }, direction: dir };
      this.ctx.save();
      this.ctx.globalAlpha = 0.55;
      this._drawSpellOverlay(preview, m);
      this.ctx.restore();
    }
  }

  /** Convert feet to canvas pixels using grid cell size (one cell = 5ft). */
  _feetToPx(feet, m) {
    return feet * ((m.cellW + m.cellH) / 2) / 5;
  }

  _drawSpellOverlay(overlay, m) {
    const { ctx } = this;
    const { shape, color, sizeFt, label, origin, direction } = overlay;
    if (!origin) return;

    const r   = this._feetToPx(sizeFt, m);
    const ox  = origin.x;
    const oy  = origin.y;
    const hex = color || '#e25822';

    ctx.save();
    ctx.strokeStyle = hex;
    ctx.fillStyle   = hex + '44';   // ~27% opacity fill
    ctx.lineWidth   = 2 / this.zoom;

    if (shape === 'circle') {
      ctx.beginPath();
      ctx.arc(ox, oy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

    } else if (shape === 'cube') {
      ctx.beginPath();
      ctx.rect(ox - r, oy - r, r * 2, r * 2);
      ctx.fill();
      ctx.stroke();

    } else if (shape === 'cone') {
      const d  = ((direction ?? 0) * Math.PI) / 180;
      const ha = Math.PI / 4;   // 45° half-angle → 90° total cone width (D&D 5E RAW)
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ox + r * Math.cos(d - ha), oy + r * Math.sin(d - ha));
      ctx.arc(ox, oy, r, d - ha, d + ha);
      ctx.lineTo(ox, oy);
      ctx.fill();
      ctx.stroke();

    } else if (shape === 'line') {
      const w   = this._feetToPx(5, m);   // 5ft wide (one grid cell)
      const d   = ((direction ?? 0) * Math.PI) / 180;
      const pd  = d + Math.PI / 2;
      const dx  = r * Math.cos(d),  dy = r * Math.sin(d);
      const px  = (w / 2) * Math.cos(pd), py = (w / 2) * Math.sin(pd);
      ctx.beginPath();
      ctx.moveTo(ox + px,      oy + py);
      ctx.lineTo(ox + dx + px, oy + dy + py);
      ctx.lineTo(ox + dx - px, oy + dy - py);
      ctx.lineTo(ox - px,      oy - py);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Label above the overlay origin
    if (label) {
      ctx.fillStyle    = hex;
      ctx.globalAlpha  = 0.9;
      ctx.font         = `bold ${Math.round(12 / this.zoom)}px "Cinzel", serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'bottom';
      ctx.shadowColor  = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur   = 3 / this.zoom;
      ctx.fillText(label, ox, oy - (shape === 'circle' ? r : 0) - 4 / this.zoom);
      ctx.shadowBlur   = 0;
    }

    ctx.restore();
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

    // Spell overlay placement mode
    if (this._spellPlacement) {
      const sp       = this._spellPlacement;
      const needsDir = sp.template.shape === 'cone' || sp.template.shape === 'line';
      if (sp.phase === 'origin') {
        if (!needsDir) {
          // Single-click shapes (circle, cube): complete immediately
          sp.onPlaced(this._finalizeSpellOverlay(sp.template, world, null));
          this._spellPlacement = null;
          this.canvas.style.cursor = 'grab';
        } else {
          // Directional shapes (cone, line): first click sets origin, wait for direction
          sp.originPx = world;
          sp.phase    = 'direction';
        }
      } else {
        // Second click: compute direction from origin to cursor and finalize
        const dir = Math.atan2(world.y - sp.originPx.y, world.x - sp.originPx.x) * 180 / Math.PI;
        sp.onPlaced(this._finalizeSpellOverlay(sp.template, sp.originPx, dir));
        this._spellPlacement = null;
        this.canvas.style.cursor = 'grab';
      }
      return;
    }

    // Placement mode: drop the staging token at the clicked cell
    if (this._placingTokenId && cell) {
      const token = this.tokens.get(this._placingTokenId);
      if (token) {
        token.x = cell.x;
        token.y = cell.y;
        this._emit('tokenMoved', { tokenId: this._placingTokenId, x: cell.x, y: cell.y });
      }
      this._placingTokenId = null;
      this.canvas.style.cursor = this.activeTool === 'move' ? 'grab' : 'crosshair';
      return;
    }

    if (this.activeTool === 'move') {
      const hit = this._hitTestToken(world.x, world.y);
      if (hit) {
        // DM can drag any token; players can only drag their own
        const canDrag = this.options.role === 'dm' || hit.id === this.myTokenId;
        this.selectedId = hit.id;
        this._dragToken = canDrag ? hit : null;
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

    // Track cursor position for spell overlay preview
    if (this._spellPlacement) this._spellPlacement.previewPx = world;

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

    if (this._dragToken && (this.options.role === 'dm' || this._dragToken.id === this.myTokenId)) {
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
    if (this._dragToken && (this.options.role === 'dm' || this._dragToken.id === this.myTokenId)) {
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
    let wx = (sx - this.panX) / this.zoom;
    let wy = (sy - this.panY) / this.zoom;
    // Undo rotation: apply -rotation around the map center
    if (this.rotation !== 0 && this.mapImage) {
      const cx  = this.mapImage.width  / 2;
      const cy  = this.mapImage.height / 2;
      const rad = -this.rotation * Math.PI / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const dx  = wx - cx;
      const dy  = wy - cy;
      wx = cx + dx * cos - dy * sin;
      wy = cy + dx * sin + dy * cos;
    }
    return { x: wx, y: wy };
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
    const { width: w, height: h } = this.mapImage;
    // When rotated 90°/270°, the visual bounding box is h×w instead of w×h
    const isSwapped = (this.rotation / 90) % 2 !== 0;
    const visW = isSwapped ? h : w;
    const visH = isSwapped ? w : h;
    const scaleX = this.canvas.width  / visW;
    const scaleY = this.canvas.height / visH;
    this.zoom = this.options.fitToScreen ? Math.min(scaleX, scaleY) : 1;
    // Center on the map's midpoint (invariant under rotation)
    this.panX = this.canvas.width  / 2 - (w / 2) * this.zoom;
    this.panY = this.canvas.height / 2 - (h / 2) * this.zoom;
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
