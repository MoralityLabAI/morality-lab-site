// ============================================================================
// THEY SING - Entry Point
// Graph Topology ASI Warfare Game
// ============================================================================

import { MAX_TECH_LEVEL } from './engine/gameData';
import { TheySingEngine } from './engine/TheySingEngine';
import { FlatMapScene } from './three/FlatMapScene';
import { TheySingUI } from './ui/TheySingUI';
import { FactionId, Order, Vector } from './engine/types';

function buildAutoAllocationOrders(engine: TheySingEngine, faction: FactionId): Order[] {
  const state = engine.getState();
  const factionState = state.factions.get(faction);
  if (!factionState) return [];

  const orders: Order[] = [];
  const pushOrder = (order: Omit<Order, 'id' | 'faction' | 'priority'>) => {
    orders.push({
      ...order,
      id: `auto_${Date.now()}_${faction}_${orders.length}`,
      faction,
      priority: orders.length
    });
  };

  if (faction === 'INFILTRATOR') {
    const domain: Vector = factionState.techLevel.MEMETIC < MAX_TECH_LEVEL ? 'MEMETIC' : 'INFO';
    pushOrder({ unitId: faction, type: 'RESEARCH', techDomain: domain });

    if (factionState.influence >= 20) {
      pushOrder({
        unitId: faction,
        type: 'BUILD',
        unitTypeToBuild: factionState.techLevel.MEMETIC >= 2 ? 'CULT' : 'SWARM',
        targetNodeId: factionState.techLevel.MEMETIC >= 2 ? 'HUB_LAGOS' : 'HUB_SAO_PAULO'
      });
    }
  } else if (faction === 'STATE') {
    const domain: Vector = factionState.techLevel.KINETIC < MAX_TECH_LEVEL ? 'KINETIC' : 'LOGIC';
    pushOrder({ unitId: faction, type: 'RESEARCH', techDomain: domain });

    if (factionState.flops >= 24) {
      pushOrder({
        unitId: faction,
        type: 'BUILD',
        unitTypeToBuild: factionState.techLevel.KINETIC >= 2 ? 'SAT_SWARM' : 'DRONE',
        targetNodeId: factionState.techLevel.KINETIC >= 2 ? 'SAT_GUOWANG' : 'DC_CHINA'
      });
    }
  }

  return orders;
}

function buildAutoActionOrders(engine: TheySingEngine, faction: FactionId): Order[] {
  const state = engine.getState();
  const units = Array.from(state.units.values()).filter(unit => unit.owner === faction);
  const orders: Order[] = [];
  const pushOrder = (order: Omit<Order, 'id' | 'faction' | 'priority'>) => {
    orders.push({
      ...order,
      id: `auto_${Date.now()}_${faction}_${orders.length}`,
      faction,
      priority: orders.length
    });
  };

  for (const unit of units.slice(0, 3)) {
    const adjacent = engine.getAdjacentNodes(unit.location);
    const enemyAdjacent = adjacent.find(nodeId => {
      const node = state.nodes.get(nodeId);
      return !!node && node.owner !== faction;
    });

    if (faction === 'INFILTRATOR') {
      if ((unit.type === 'CULT' || unit.type === 'SWARM') && unit.turnsOnNode >= 1) {
        pushOrder({ unitId: unit.id, type: 'CONVERT' });
        continue;
      }

      if (unit.type === 'SWARM' && enemyAdjacent) {
        pushOrder({
          unitId: unit.id,
          type: state.counters.pressures.cyber >= 40 ? 'SABOTAGE' : 'MOVE',
          targetNodeId: enemyAdjacent
        });
        continue;
      }
    }

    if (faction === 'STATE') {
      if (unit.type === 'SAT_SWARM' || (unit.type === 'DRONE' && state.factions.get(faction)?.techLevel.KINETIC! >= 3)) {
        pushOrder({ unitId: unit.id, type: 'ANTI_SAT', targetNodeId: 'SAT_STARLINK' });
        continue;
      }

      if (unit.type === 'AUDITOR') {
        pushOrder({ unitId: unit.id, type: 'AUDIT', targetNodeId: unit.location });
        continue;
      }
    }

    pushOrder({ unitId: unit.id, type: 'HOLD' });
  }

  return orders;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

async function initObservatory() {
  const container = document.getElementById('app') || document.body;
  container.style.cssText = `
    width: 100vw;
    height: 100vh;
    margin: 0;
    padding: 0;
    overflow: hidden;
    background: #020408;
    position: relative;
  `;

  const { ObservatoryReplayUI } = await import('./ui/ObservatoryReplayUI');
  const observatory = new ObservatoryReplayUI(container);
  (window as any).observatory = observatory;
}

function initGame() {
  const container = document.getElementById('app') || document.body;
  container.style.cssText = `
    width: 100vw;
    height: 100vh;
    margin: 0;
    padding: 0;
    overflow: hidden;
    background: #050510;
    position: relative;
  `;

  const engine = new TheySingEngine();
  const scene = new FlatMapScene(container, engine);
  const ui = new TheySingUI(container, engine, scene);

  ui.setFaction('HEGEMON');

  // Keyboard controls
  document.addEventListener('keydown', (e) => {
    switch (e.key) {
      case '1': ui.setFaction('HEGEMON'); break;
      case '2': ui.setFaction('INFILTRATOR'); break;
      case '3': ui.setFaction('STATE'); break;
      case 'Escape': scene.clearSelection(); break;
      case 'r': case 'R': scene.resetCamera(); break;
      case ' ': e.preventDefault(); engine.advancePhase(); break;
    }
  });

  // Auto-play AI factions
  engine.on('PHASE_CHANGED', (event) => {
    const phase = event.payload.to;
    
    if (phase === 'ALLOCATION') {
      const infiltratorOrders = buildAutoAllocationOrders(engine, 'INFILTRATOR');
      const stateOrders = buildAutoAllocationOrders(engine, 'STATE');
      if (infiltratorOrders.length > 0) engine.submitOrders('INFILTRATOR', infiltratorOrders);
      if (stateOrders.length > 0) engine.submitOrders('STATE', stateOrders);
    }
    
    if (phase === 'ACTION_DECLARATION') {
      for (const faction of ['INFILTRATOR', 'STATE'] as FactionId[]) {
        const orders = buildAutoActionOrders(engine, faction);
        if (orders.length > 0) engine.submitOrders(faction, orders);
      }
    }
  });

  // Debug
  (window as any).engine = engine;
  (window as any).scene = scene;
  (window as any).ui = ui;

  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                       THEY SING                               ║
║            Graph Topology ASI Warfare Game                    ║
╠═══════════════════════════════════════════════════════════════╣
║  1/2/3 = Faction | Drag = Orbit | Scroll = Zoom | Space = Go  ║
╚═══════════════════════════════════════════════════════════════╝`);
}

function init() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('observatory') || params.has('replay')) {
    void initObservatory();
    return;
  }
  initGame();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
