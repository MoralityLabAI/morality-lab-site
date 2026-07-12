// ============================================================================
// ASI CARTEL - UI Manager
// HUD, action menus, status displays
// ============================================================================

import { gameEngine } from '../engine/GameEngine';
import { GlobeScene } from '../three/GlobeScene';
import { GameState, Unit, OperationType } from '../data/types';
import { FACTIONS, UNIT_STATS, OPERATION_COSTS } from '../data/gameData';

export class UIManager {
  private container: HTMLElement;
  private globeScene: GlobeScene;
  
  private hudPanel!: HTMLElement;
  private unitPanel!: HTMLElement;
  private actionPanel!: HTMLElement;
  private statusBar!: HTMLElement;
  private auditModal!: HTMLElement;
  private gameOverModal!: HTMLElement;
  private endTurnBtn!: HTMLElement;
  private turnIndicator!: HTMLElement;

  constructor(container: HTMLElement, globeScene: GlobeScene) {
    this.container = container;
    this.globeScene = globeScene;
    
    this.injectStyles();
    this.createUI();
    this.subscribeToEvents();
    this.update(gameEngine.getState());
  }

  private injectStyles(): void {
    const style = document.createElement('style');
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;600&family=Orbitron:wght@400;700&display=swap');
      
      :root {
        --bg-primary: rgba(5, 8, 15, 0.92);
        --bg-secondary: rgba(15, 20, 35, 0.85);
        --border-color: rgba(60, 100, 150, 0.3);
        --text-primary: #e8eef5;
        --text-secondary: #8899aa;
        --accent-cyan: #00d4ff;
        --accent-magenta: #ff44aa;
        --accent-green: #44ff88;
        --accent-orange: #ffaa00;
        --danger: #ff4444;
        --success: #44ff88;
      }
      
      .asi-panel {
        position: absolute;
        background: var(--bg-primary);
        border: 1px solid var(--border-color);
        border-radius: 8px;
        padding: 12px 16px;
        font-family: 'JetBrains Mono', monospace;
        font-size: 12px;
        color: var(--text-primary);
        backdrop-filter: blur(10px);
        box-shadow: 0 4px 30px rgba(0, 0, 0, 0.4);
      }
      
      .asi-panel h2 {
        font-family: 'Orbitron', sans-serif;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 2px;
        text-transform: uppercase;
        color: var(--accent-cyan);
        margin: 0 0 10px 0;
        padding-bottom: 6px;
        border-bottom: 1px solid var(--border-color);
      }
      
      .hud-panel { top: 16px; left: 16px; min-width: 220px; }
      
      .resource-row {
        display: flex;
        justify-content: space-between;
        margin: 6px 0;
        padding: 4px 0;
      }
      
      .resource-label { color: var(--text-secondary); }
      .resource-value { font-weight: 600; }
      .resource-value.flops { color: var(--accent-cyan); }
      .resource-value.watts { color: var(--accent-orange); }
      .resource-value.tas { color: var(--danger); }
      .resource-value.tas.safe { color: var(--success); }
      
      .meter-bar {
        height: 4px;
        background: rgba(255,255,255,0.1);
        border-radius: 2px;
        margin-top: 4px;
        overflow: hidden;
      }
      
      .meter-fill {
        height: 100%;
        transition: width 0.3s ease;
      }
      
      .unit-panel {
        top: 16px;
        right: 16px;
        min-width: 260px;
        max-height: 55vh;
        overflow-y: auto;
      }
      
      .unit-list { display: flex; flex-direction: column; gap: 6px; }
      
      .unit-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 10px;
        background: var(--bg-secondary);
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s ease;
        border: 1px solid transparent;
      }
      
      .unit-row:hover {
        background: rgba(0, 212, 255, 0.1);
        border-color: var(--accent-cyan);
      }
      
      .unit-row.selected {
        background: rgba(0, 212, 255, 0.2);
        border-color: var(--accent-cyan);
      }
      
      .unit-row.acted { opacity: 0.5; }
      
      .unit-icon {
        width: 24px;
        height: 24px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        font-weight: bold;
      }
      
      .unit-info { flex: 1; }
      .unit-name { font-weight: 600; font-size: 11px; }
      .unit-type { font-size: 10px; color: var(--text-secondary); }
      .unit-stats { text-align: right; font-size: 10px; }
      
      .action-panel {
        bottom: 100px;
        left: 50%;
        transform: translateX(-50%);
        display: none;
      }
      
      .action-panel.visible { display: block; }
      
      .action-grid { display: flex; gap: 8px; }
      
      .action-btn {
        padding: 10px 16px;
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: 6px;
        color: var(--text-primary);
        font-family: 'JetBrains Mono', monospace;
        font-size: 11px;
        cursor: pointer;
        transition: all 0.2s ease;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        min-width: 70px;
      }
      
      .action-btn:hover:not(:disabled) {
        background: rgba(0, 212, 255, 0.15);
        border-color: var(--accent-cyan);
        transform: translateY(-2px);
      }
      
      .action-btn:disabled { opacity: 0.4; cursor: not-allowed; }
      .action-cost { font-size: 9px; color: var(--text-secondary); }
      
      .status-bar {
        bottom: 16px;
        left: 50%;
        transform: translateX(-50%);
        padding: 8px 20px;
        border-radius: 20px;
        font-size: 11px;
        white-space: nowrap;
      }
      
      .end-turn-btn {
        position: absolute;
        bottom: 16px;
        right: 16px;
        padding: 12px 24px;
        background: linear-gradient(135deg, var(--accent-cyan), #0088aa);
        border: none;
        border-radius: 8px;
        color: #fff;
        font-family: 'Orbitron', sans-serif;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 1px;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: 0 4px 20px rgba(0, 212, 255, 0.3);
      }
      
      .end-turn-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 25px rgba(0, 212, 255, 0.5);
      }
      
      .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.8);
        display: none;
        align-items: center;
        justify-content: center;
        z-index: 1000;
      }
      
      .modal-overlay.visible { display: flex; }
      
      .modal-content {
        background: var(--bg-primary);
        border: 2px solid var(--danger);
        border-radius: 12px;
        padding: 24px 32px;
        text-align: center;
        max-width: 420px;
      }
      
      .modal-title {
        font-family: 'Orbitron', sans-serif;
        font-size: 16px;
        color: var(--danger);
        margin-bottom: 16px;
        letter-spacing: 2px;
      }
      
      .modal-text {
        color: var(--text-secondary);
        margin-bottom: 20px;
        line-height: 1.6;
        font-size: 12px;
      }
      
      .modal-buttons { display: flex; gap: 12px; justify-content: center; }
      
      .modal-btn {
        padding: 10px 18px;
        border: 1px solid var(--border-color);
        border-radius: 6px;
        background: var(--bg-secondary);
        color: var(--text-primary);
        font-family: 'JetBrains Mono', monospace;
        font-size: 11px;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      
      .modal-btn:hover {
        background: rgba(255, 68, 68, 0.2);
        border-color: var(--danger);
      }
      
      .modal-btn.submit { border-color: var(--success); }
      .modal-btn.submit:hover { background: rgba(68, 255, 136, 0.2); }
      .modal-btn.bluff { border-color: var(--accent-cyan); }
      .modal-btn.bluff:hover { background: rgba(0, 212, 255, 0.2); }
      .modal-btn.escalate { border-color: var(--danger); background: rgba(255, 68, 68, 0.3); }
      
      .turn-indicator {
        position: absolute;
        top: 16px;
        left: 50%;
        transform: translateX(-50%);
        font-family: 'Orbitron', sans-serif;
        font-size: 13px;
        color: var(--text-primary);
        letter-spacing: 2px;
        background: var(--bg-primary);
        padding: 8px 16px;
        border-radius: 20px;
        border: 1px solid var(--border-color);
      }
      
      .phase-badge {
        display: inline-block;
        padding: 2px 8px;
        background: rgba(0, 212, 255, 0.2);
        border-radius: 4px;
        font-size: 9px;
        margin-left: 10px;
        color: var(--accent-cyan);
      }

      .unit-panel::-webkit-scrollbar { width: 6px; }
      .unit-panel::-webkit-scrollbar-track { background: transparent; }
      .unit-panel::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 3px; }
    `;
    document.head.appendChild(style);
  }

  private createUI(): void {
    this.turnIndicator = document.createElement('div');
    this.turnIndicator.className = 'turn-indicator';
    this.container.appendChild(this.turnIndicator);

    this.hudPanel = document.createElement('div');
    this.hudPanel.className = 'asi-panel hud-panel';
    this.hudPanel.innerHTML = `
      <h2>CARTEL STATUS</h2>
      <div class="resource-row">
        <span class="resource-label">FLOPs</span>
        <span class="resource-value flops" id="flops-value">0</span>
      </div>
      <div class="resource-row">
        <span class="resource-label">Watts</span>
        <span class="resource-value watts" id="watts-value">0</span>
      </div>
      <div class="resource-row">
        <span class="resource-label">Influence</span>
        <span class="resource-value" id="influence-value">0</span>
      </div>
      <div style="margin-top: 12px; padding-top: 8px; border-top: 1px solid var(--border-color);">
        <div class="resource-row">
          <span class="resource-label">TAS</span>
          <span class="resource-value tas safe" id="tas-value">0</span>
        </div>
        <div class="meter-bar">
          <div class="meter-fill" id="tas-meter" style="width: 0%; background: var(--success);"></div>
        </div>
        <div class="resource-row" style="margin-top: 8px;">
          <span class="resource-label">Heat</span>
          <span class="resource-value" id="heat-value">0</span>
        </div>
        <div class="resource-row">
          <span class="resource-label">Cooling</span>
          <span class="resource-value" id="cooling-value">0</span>
        </div>
      </div>
    `;
    this.container.appendChild(this.hudPanel);

    this.unitPanel = document.createElement('div');
    this.unitPanel.className = 'asi-panel unit-panel';
    this.unitPanel.innerHTML = `<h2>YOUR UNITS</h2><div class="unit-list" id="unit-list"></div>`;
    this.container.appendChild(this.unitPanel);

    this.actionPanel = document.createElement('div');
    this.actionPanel.className = 'asi-panel action-panel';
    this.actionPanel.id = 'action-panel';
    this.actionPanel.innerHTML = `<h2>OPERATIONS</h2><div class="action-grid" id="action-grid"></div>`;
    this.container.appendChild(this.actionPanel);

    this.statusBar = document.createElement('div');
    this.statusBar.className = 'asi-panel status-bar';
    this.statusBar.textContent = 'Select a unit to issue orders.';
    this.container.appendChild(this.statusBar);

    this.endTurnBtn = document.createElement('button');
    this.endTurnBtn.className = 'end-turn-btn';
    this.endTurnBtn.textContent = 'END TURN';
    this.endTurnBtn.onclick = () => gameEngine.endTurn();
    this.container.appendChild(this.endTurnBtn);

    this.auditModal = this.createAuditModal();
    this.container.appendChild(this.auditModal);

    this.gameOverModal = this.createGameOverModal();
    this.container.appendChild(this.gameOverModal);
  }

  private createAuditModal(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-content">
        <div class="modal-title">⚠ SAFETY-ASI AUDIT</div>
        <div class="modal-text">
          Your thermal signature has exceeded acceptable levels.<br>
          The global safety consortium demands an explanation.
        </div>
        <div class="modal-buttons">
          <button class="modal-btn submit" data-action="SUBMIT">
            COMPLY<br><small>Lose 40% FLOPs</small>
          </button>
          <button class="modal-btn bluff" data-action="BLUFF">
            DECEIVE<br><small>Use SAE cloak</small>
          </button>
          <button class="modal-btn escalate" data-action="ESCALATE">
            DEFY<br><small>High risk</small>
          </button>
        </div>
      </div>
    `;
    
    overlay.querySelectorAll('.modal-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = (btn as HTMLElement).dataset.action as "SUBMIT" | "BLUFF" | "ESCALATE";
        gameEngine.resolveAudit(action);
      });
    });
    
    return overlay;
  }

  private createGameOverModal(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'gameover-modal';
    overlay.innerHTML = `
      <div class="modal-content">
        <div class="modal-title" id="gameover-title">GAME OVER</div>
        <div class="modal-text" id="gameover-text">The game has ended.</div>
        <div class="modal-buttons">
          <button class="modal-btn" onclick="location.reload()">RESTART</button>
        </div>
      </div>
    `;
    return overlay;
  }

  private update(state: GameState): void {
    this.updateHUD(state);
    this.updateUnitList(state);
    this.updateActionPanel(state);
    this.updateTurnIndicator(state);
    this.updateModals(state);
  }

  private updateHUD(state: GameState): void {
    const faction = state.currentFaction;
    const res = state.resources[faction];
    const thermals = state.thermals;
    
    const flopsEl = document.getElementById('flops-value');
    const wattsEl = document.getElementById('watts-value');
    const influenceEl = document.getElementById('influence-value');
    const tasEl = document.getElementById('tas-value');
    const tasMeter = document.getElementById('tas-meter');
    const heatEl = document.getElementById('heat-value');
    const coolingEl = document.getElementById('cooling-value');
    
    if (flopsEl) flopsEl.textContent = res.flops.toLocaleString();
    if (wattsEl) wattsEl.textContent = res.watts.toLocaleString();
    if (influenceEl) influenceEl.textContent = res.influence.toString();
    
    if (tasEl) {
      tasEl.textContent = Math.floor(thermals.tas).toString();
      const isSafe = thermals.tas < thermals.auditThreshold * 0.7;
      tasEl.className = `resource-value tas ${isSafe ? 'safe' : ''}`;
    }
    
    if (tasMeter) {
      const pct = Math.min(100, (thermals.tas / thermals.auditThreshold) * 100);
      tasMeter.style.width = `${pct}%`;
      tasMeter.style.background = pct > 70 ? 'var(--danger)' : pct > 40 ? 'var(--accent-orange)' : 'var(--success)';
    }
    
    if (heatEl) heatEl.textContent = Math.floor(thermals.globalHeat).toString();
    if (coolingEl) coolingEl.textContent = thermals.coolingCapacity.toString();
  }

  private updateUnitList(state: GameState): void {
    const listEl = document.getElementById('unit-list');
    if (!listEl) return;
    
    const playerUnits = state.units.filter(u => u.faction === state.currentFaction);
    
    listEl.innerHTML = playerUnits.map(unit => {
      const faction = FACTIONS[unit.faction];
      const stats = UNIT_STATS[unit.type];
      const selected = unit.id === state.selectedUnitId;
      
      return `
        <div class="unit-row ${selected ? 'selected' : ''} ${unit.hasActed ? 'acted' : ''}" 
             data-unit-id="${unit.id}">
          <div class="unit-icon" style="background: #${faction.color.toString(16).padStart(6, '0')}">
            L${unit.level}
          </div>
          <div class="unit-info">
            <div class="unit-name">${unit.name}</div>
            <div class="unit-type">${unit.type} · ATK ${stats.attack} · DEF ${stats.defense}</div>
          </div>
          <div class="unit-stats">
            <div>HP ${unit.health}%</div>
            <div style="color: var(--text-secondary)">MOR ${unit.morale}%</div>
          </div>
        </div>
      `;
    }).join('');
    
    listEl.querySelectorAll('.unit-row').forEach(row => {
      row.addEventListener('click', () => {
        const unitId = (row as HTMLElement).dataset.unitId;
        if (unitId) {
          gameEngine.selectUnit(unitId);
          this.globeScene.focusOnUnit(unitId);
        }
      });
    });
  }

  private updateActionPanel(state: GameState): void {
    const panel = document.getElementById('action-panel');
    const grid = document.getElementById('action-grid');
    if (!panel || !grid) return;
    
    const selectedUnit = state.selectedUnitId ? 
      state.units.find(u => u.id === state.selectedUnitId) : null;
    
    if (!selectedUnit || selectedUnit.hasActed) {
      panel.classList.remove('visible');
      return;
    }
    
    panel.classList.add('visible');
    
    const unitType = selectedUnit.type;
    const stats = UNIT_STATS[unitType];
    const resources = state.resources[state.currentFaction];
    
    const actions: { type: OperationType; label: string; available: boolean }[] = [];
    
    if (stats.speed > 0) {
      actions.push({ type: 'MOVE', label: 'MOVE', available: true });
    }
    
    actions.push({ type: 'ATTACK', label: 'ATTACK', available: true });
    actions.push({ type: 'FORTIFY', label: 'FORTIFY', available: true });
    
    if (unitType === 'BOTNET') actions.push({ type: 'HACK', label: 'HACK', available: true });
    if (unitType === 'SINF') actions.push({ type: 'INFLUENCE', label: 'INFLUENCE', available: true });
    if (unitType === 'VIRUS') actions.push({ type: 'INFECT', label: 'INFECT', available: true });
    
    grid.innerHTML = actions.map(action => {
      const cost = OPERATION_COSTS[action.type];
      const canAfford = resources.flops >= cost.flops;
      const disabled = !action.available || !canAfford;
      
      return `
        <button class="action-btn" data-action="${action.type}" ${disabled ? 'disabled' : ''}>
          ${action.label}
          <span class="action-cost">${cost.flops} F / ${cost.heat} H</span>
        </button>
      `;
    }).join('');
    
    grid.querySelectorAll('.action-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const actionType = (btn as HTMLElement).dataset.action as OperationType;
        this.handleAction(actionType, state);
      });
    });
  }

  private handleAction(actionType: OperationType, state: GameState): void {
    if (actionType === 'MOVE') {
      const unit = state.units.find(u => u.id === state.selectedUnitId);
      if (unit) {
        const result = gameEngine.queueOperation('MOVE', {
          lat: unit.lat + (Math.random() - 0.5) * 5,
          lon: unit.lon + (Math.random() - 0.5) * 5
        });
        this.statusBar.textContent = result.message;
      }
    } else if (actionType === 'ATTACK') {
      const unit = state.units.find(u => u.id === state.selectedUnitId);
      if (unit) {
        const enemies = state.units.filter(u => u.faction !== state.currentFaction);
        if (enemies.length > 0) {
          const result = gameEngine.queueOperation('ATTACK', { unitId: enemies[0].id });
          this.statusBar.textContent = result.message;
        } else {
          this.statusBar.textContent = 'No enemies in range.';
        }
      }
    } else {
      const result = gameEngine.queueOperation(actionType);
      this.statusBar.textContent = result.message;
    }
  }

  private updateTurnIndicator(state: GameState): void {
    this.turnIndicator.innerHTML = `TURN ${state.turn} <span class="phase-badge">${state.phase}</span>`;
  }

  private updateModals(state: GameState): void {
    this.auditModal.classList.toggle('visible', state.phase === 'AUDIT');
    this.gameOverModal.classList.toggle('visible', state.phase === 'GAME_OVER');
  }

  private subscribeToEvents(): void {
    gameEngine.on('*', (_event, state) => {
      this.update(state);
    });
    
    gameEngine.on('TURN_START', (event) => {
      this.statusBar.textContent = `Turn ${event.payload.turn} begins. Issue your orders.`;
    });
    
    gameEngine.on('COMBAT_END', (event) => {
      const winner = event.payload.winner;
      this.statusBar.textContent = winner ? `Combat resolved. Victor: ${winner}` : 'Mutual destruction!';
    });
    
    gameEngine.on('TERRITORY_CAPTURED', (event) => {
      this.statusBar.textContent = `Territory ${event.payload.territoryId} captured!`;
    });
    
    gameEngine.on('VICTORY', (event) => {
      const title = document.getElementById('gameover-title');
      const text = document.getElementById('gameover-text');
      const reason = event.payload.reason as string;
      const winner = event.payload.winner as string | null;
      
      if (title && text) {
        if (reason === 'PROTOCOL_FAILURE') {
          title.textContent = 'PROTOCOL FAILURE';
          title.style.color = 'var(--danger)';
          text.textContent = 'The Safety-ASI has terminated all cartel operations.';
        } else if (reason === 'ASI_ACHIEVED') {
          const isPlayer = winner === gameEngine.getState().currentFaction;
          title.textContent = isPlayer ? 'VICTORY' : 'DEFEAT';
          title.style.color = isPlayer ? 'var(--success)' : 'var(--danger)';
          text.textContent = `${FACTIONS[winner as keyof typeof FACTIONS]?.name || 'Unknown'} has achieved ASI.`;
        } else if (reason === 'PLAYER_ELIMINATED') {
          title.textContent = 'ELIMINATED';
          title.style.color = 'var(--danger)';
          text.textContent = 'Your cartel has been destroyed.';
        }
      }
    });
  }
}
