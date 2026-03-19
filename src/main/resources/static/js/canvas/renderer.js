// js/canvas/renderer.js — Battle map canvas engine
// Coordinate system: all game state is in grid-cell units.
// Pixel positions are derived at render time from the viewport transform.

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
    this.gridConfig = null;   // { originX, originY, cellSizePx, cols, rows }

    // Game state
    this.mapImage    = null;
    this.tokens      = new Map();   // id → token object
    this.fogCells    = new Map();   // "x,y" → bool (true = revealed)
    this.zones       = [];
    this.overlays    = [];
    this.activeTurn  = null;
    this.activeTool  = 'move';

    // Interaction state
    this.isDragging  = false;
    this.dragStart   = { x: 0, y: 0 };
    this.selectedId  = null;
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

  setTool(tool) {
    this.activeTool = tool;
    this.canvas.style.cursor = tool === 'move' ? 'grab' : 'crosshair';
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

  showOverlay(overlay) {
    this.overlays.push({ ...overlay, startTime: Date.now() });
    setTimeout(() => {
      this.overlays = this.overlays.filter(o => o !== overlay);
    }, overlay.duration || 3000);
  }

  /** Register event handler: 'tokenSelected' | 'tokenMoved' */
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

    // 2. Zones
    this._drawZones();

    // 3. Grid overlay
    if (this.gridConfig) this._drawGrid();

    // 4. Fog of War (players & observer only — DM sees a dim overlay)
    this._drawFog();

    // 5. Tokens
    this._drawTokens();

    // 6. Overlays (AoE, movement range, etc.)
    this._drawOverlays();

    ctx.restore();
  }

  // ── Drawing helpers ─────────────────────────────────────────────

  _drawGrid() {
    const { originX, originY, cellSizePx, cols, rows } = this.gridConfig;
    const ctx = this.ctx;

    ctx.save();
    ctx.strokeStyle = 'rgba(201, 168, 76, 0.18)';
    ctx.lineWidth   = 0.5 / this.zoom;

    for (let x = 0; x <= cols; x++) {
      const px = originX + x * cellSizePx;
      ctx.beginPath();
      ctx.moveTo(px, originY);
      ctx.lineTo(px, originY + rows * cellSizePx);
      ctx.stroke();
    }

    for (let y = 0; y <= rows; y++) {
      const py = originY + y * cellSizePx;
      ctx.beginPath();
      ctx.moveTo(originX, py);
      ctx.lineTo(originX + cols * cellSizePx, py);
      ctx.stroke();
    }

    ctx.restore();
  }

  _drawFog() {
    if (!this.gridConfig) return;
    const { originX, originY, cellSizePx, cols, rows } = this.gridConfig;
    const ctx  = this.ctx;
    const isDm = this.options.role === 'dm';

    // DM: very dim veil over hidden cells; others: full black
    ctx.fillStyle = isDm ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.98)';

    for (let x = 0; x < cols; x++) {
      for (let y = 0; y < rows; y++) {
        const revealed = this.fogCells.get(`${x},${y}`);
        if (!revealed) {
          ctx.fillRect(
            originX + x * cellSizePx,
            originY + y * cellSizePx,
            cellSizePx, cellSizePx
          );
        }
      }
    }
  }

  _drawTokens() {
    const { ctx }      = this;
    const cellSize     = this.gridConfig?.cellSizePx || 50;
    const { originX = 0, originY = 0 } = this.gridConfig || {};

    for (const token of this.tokens.values()) {
      if (token.x == null || token.y == null) continue;

      const px  = originX + token.x * cellSize;
      const py  = originY + token.y * cellSize;
      const r   = cellSize * 0.42;
      const cx  = px + cellSize / 2;
      const cy  = py + cellSize / 2;

      ctx.save();

      // Glow ring for active turn
      if (token.id === this.activeTurn) {
        ctx.shadowColor = '#c9a84c';
        ctx.shadowBlur  = 14 / this.zoom;
      }

      // Token circle
      const color = this._tokenColor(token);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = color.bg;
      ctx.fill();
      ctx.strokeStyle = token.id === this.selectedId ? '#c9a84c' : color.border;
      ctx.lineWidth   = (token.id === this.selectedId ? 2.5 : 1.5) / this.zoom;
      ctx.stroke();
      ctx.shadowBlur  = 0;

      // Token avatar or initials
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

      // Condition dot cluster (small dots below token)
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

      // HP bar under token (if HP tracked)
      if (token.maxHp && token.currentHp != null) {
        const barW = cellSize * 0.8;
        const barH = 3 / this.zoom;
        const barX = px + (cellSize - barW) / 2;
        const barY = py + cellSize - barH - 2 / this.zoom;
        const pct  = Math.max(0, Math.min(1, token.currentHp / token.maxHp));

        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(barX, barY, barW, barH);
        ctx.fillStyle = pct > 0.5 ? '#27ae60' : pct > 0.25 ? '#d68910' : '#e74c3c';
        ctx.fillRect(barX, barY, barW * pct, barH);
      }

      ctx.restore();
    }
  }

  _drawZones() {
    for (const zone of this.zones) {
      const { points, color, label } = zone;
      if (!points?.length) continue;
      const ctx = this.ctx;
      const cellSize = this.gridConfig?.cellSizePx || 50;
      const { originX = 0, originY = 0 } = this.gridConfig || {};

      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle   = color || 'rgba(255, 120, 0, 0.4)';
      ctx.beginPath();
      points.forEach(([gx, gy], i) => {
        const px = originX + gx * cellSize;
        const py = originY + gy * cellSize;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha  = 0.8;
      ctx.strokeStyle  = color || 'rgba(255,120,0,0.8)';
      ctx.lineWidth    = 1.5 / this.zoom;
      ctx.stroke();
      ctx.restore();
    }
  }

  _drawOverlays() {
    // Placeholder — AoE, movement range, death effects go here
    for (const overlay of this.overlays) {
      if (overlay.type === 'MOVEMENT_RANGE') {
        this._drawMovementRange(overlay);
      }
    }
  }

  _drawMovementRange(overlay) {
    const { cells, color } = overlay;
    if (!cells || !this.gridConfig) return;
    const { originX, originY, cellSizePx } = this.gridConfig;
    const ctx = this.ctx;

    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle   = color || '#3498db';
    cells.forEach(([gx, gy]) => {
      ctx.fillRect(
        originX + gx * cellSizePx,
        originY + gy * cellSizePx,
        cellSizePx, cellSizePx
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

    // Touch support (pinch to zoom)
    this.canvas.addEventListener('touchstart',  this._handleTouchStart.bind(this),  { passive: false });
    this.canvas.addEventListener('touchmove',   this._handleTouchMove.bind(this),   { passive: false });
    this.canvas.addEventListener('touchend',    this._handleTouchEnd.bind(this));
  }

  _handleMouseDown(e) {
    const world = this._screenToWorld(e.offsetX, e.offsetY);

    if (this.activeTool === 'move') {
      // Check if clicking on a token
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
  }

  _handleMouseMove(e) {
    if (this.isDragging) {
      this.panX = e.clientX - this.dragStart.x;
      this.panY = e.clientY - this.dragStart.y;
    }

    if (this._dragToken && this.options.role === 'dm') {
      const world = this._screenToWorld(e.offsetX, e.offsetY);
      const cell  = this._worldToCell(world.x, world.y);
      this._dragToken.x = cell.x;
      this._dragToken.y = cell.y;
    }
  }

  _handleMouseUp(e) {
    if (this._dragToken && this.options.role === 'dm') {
      const world = this._screenToWorld(e.offsetX, e.offsetY);
      const cell  = this._worldToCell(world.x, world.y);
      this._emit('tokenMoved', { tokenId: this._dragToken.id, x: cell.x, y: cell.y });
      // ws.send is called by the game view that listens to 'tokenMoved'
    }
    this.isDragging = false;
    this._dragToken  = null;
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

  // Simple pinch-to-zoom
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
    if (!this.gridConfig) return { x: 0, y: 0 };
    const { originX, originY, cellSizePx } = this.gridConfig;
    return {
      x: Math.floor((wx - originX) / cellSizePx),
      y: Math.floor((wy - originY) / cellSizePx),
    };
  }

  _hitTestToken(wx, wy) {
    if (!this.gridConfig) return null;
    const { originX, originY, cellSizePx } = this.gridConfig;
    for (const token of this.tokens.values()) {
      if (token.x == null) continue;
      const tx = originX + token.x * cellSizePx;
      const ty = originY + token.y * cellSizePx;
      if (wx >= tx && wx < tx + cellSizePx && wy >= ty && wy < ty + cellSizePx) {
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
