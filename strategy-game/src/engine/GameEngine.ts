// ============================================================================
// ASI CARTEL - Core Game Engine
// Phase-based strategy game engine with Diplomacy-style simultaneous resolution
// ============================================================================

import {
  GameState, GamePhase, TurnSubPhase, GameEvent, GameEventType, GameEventListener,
  Unit, Territory, Operation, OperationType, CombatResult, FactionId
} from '../data/types';
import { 
  STARTING_UNITS, TERRITORIES, FACTIONS, UNIT_STATS, OPERATION_COSTS, TECH_TREE 
} from '../data/gameData';

// --- Constants ---
const BASE_COOLING_RATE = 100;
const AUDIT_THRESHOLD = 150;
const PROTOCOL_FAILURE_LIMIT = 500;
const STARTING_FLOPS = 2000;
const STARTING_WATTS = 1000;
const PASSIVE_FLOPS_PER_TURN = 300;

export class GameEngine {
  private state: GameState;
  private listeners: Map<GameEventType | '*', GameEventListener[]> = new Map();

  constructor() {
    this.state = this.createInitialState();
  }

  // =========================================================================
  // STATE INITIALIZATION
  // =========================================================================

  private createInitialState(): GameState {
    const factionIds: FactionId[] = ["HIVE", "GLAM", "BIO", "OLDSTATE", "SHADOW"];
    
    const resources: GameState['resources'] = {} as GameState['resources'];
    for (const fid of [...factionIds, "NEUTRAL" as FactionId]) {
      resources[fid] = {
        flops: fid === "NEUTRAL" ? 0 : STARTING_FLOPS,
        watts: fid === "NEUTRAL" ? 0 : STARTING_WATTS,
        influence: fid === "NEUTRAL" ? 0 : 50
      };
    }

    return {
      turn: 1,
      phase: "PLANNING",
      subPhase: "SELECT_UNIT",
      currentFaction: "HIVE",  // Player faction (can be changed)
      
      resources,
      
      thermals: {
        globalHeat: 0,
        coolingCapacity: BASE_COOLING_RATE,
        tas: 0,
        auditThreshold: AUDIT_THRESHOLD,
        protocolFailure: PROTOCOL_FAILURE_LIMIT
      },
      
      units: [...STARTING_UNITS],
      territories: [...TERRITORIES],
      pendingOperations: [],
      turnHistory: [],
      
      selectedUnitId: null,
      hoveredUnitId: null,
      cameraTarget: null
    };
  }

  // =========================================================================
  // PUBLIC API - Read State
  // =========================================================================

  public getState(): Readonly<GameState> {
    return this.state;
  }

  public getUnit(id: string): Unit | undefined {
    return this.state.units.find(u => u.id === id);
  }

  public getUnitsForFaction(faction: FactionId): Unit[] {
    return this.state.units.filter(u => u.faction === faction);
  }

  public getTerritory(id: string): Territory | undefined {
    return this.state.territories.find(t => t.id === id);
  }

  public getPlayerFaction(): FactionId {
    return this.state.currentFaction;
  }

  // =========================================================================
  // PUBLIC API - Actions
  // =========================================================================

  /**
   * Select a unit for command
   */
  public selectUnit(unitId: string | null): void {
    // Deselect previous
    const prev = this.state.units.find(u => u.isSelected);
    if (prev) prev.isSelected = false;

    if (unitId) {
      const unit = this.getUnit(unitId);
      if (unit && unit.faction === this.state.currentFaction) {
        unit.isSelected = true;
        this.state.selectedUnitId = unitId;
        this.state.subPhase = "SELECT_ACTION";
        this.emit("UNIT_SELECTED", { unitId, unit });
      }
    } else {
      this.state.selectedUnitId = null;
      this.state.subPhase = "SELECT_UNIT";
    }
  }

  /**
   * Queue an operation for the selected unit
   */
  public queueOperation(
    type: OperationType, 
    target?: { unitId?: string; lat?: number; lon?: number }
  ): { success: boolean; message: string } {
    const unit = this.state.selectedUnitId ? this.getUnit(this.state.selectedUnitId) : null;
    if (!unit) {
      return { success: false, message: "No unit selected" };
    }

    if (unit.hasActed) {
      return { success: false, message: "Unit has already acted this turn" };
    }

    // Validate operation type for unit
    const valid = this.validateOperation(unit, type, target);
    if (!valid.success) return valid;

    // Check resource cost
    const cost = OPERATION_COSTS[type];
    const resources = this.state.resources[unit.faction];
    if (resources.flops < cost.flops) {
      return { success: false, message: `Insufficient FLOPs (need ${cost.flops})` };
    }

    // Create operation
    const op: Operation = {
      type,
      sourceUnitId: unit.id,
      targetUnitId: target?.unitId,
      targetLat: target?.lat,
      targetLon: target?.lon,
      cost,
      turnsToComplete: 1
    };

    this.state.pendingOperations.push(op);
    unit.hasActed = true;
    
    // Deduct resources immediately (committed)
    resources.flops -= cost.flops;
    
    // Add heat
    this.state.thermals.globalHeat += cost.heat;
    this.updateTAS();

    this.selectUnit(null); // Deselect after action
    this.emit("UNIT_MOVED", { operation: op });

    return { success: true, message: `${type} queued for ${unit.name}` };
  }

  /**
   * End the current turn - resolve all queued operations
   */
  public endTurn(): void {
    if (this.state.phase !== "PLANNING") return;

    this.state.phase = "RESOLUTION";
    
    // 1. Resolve all operations
    this.resolveOperations();
    
    // 2. Apply passive effects (territory income, unit regen, etc.)
    this.applyPassiveEffects();
    
    // 3. Thermodynamic cycle
    this.processThermals();
    
    // 4. Check for audit trigger
    if (this.state.thermals.tas >= this.state.thermals.auditThreshold) {
      this.state.phase = "AUDIT";
      this.emit("AUDIT_TRIGGERED", { tas: this.state.thermals.tas });
      return;
    }

    // 5. Check victory/defeat conditions
    if (this.checkGameOver()) {
      return;
    }

    // 6. Advance turn
    this.advanceTurn();
  }

  /**
   * Handle audit response (when in AUDIT phase)
   */
  public resolveAudit(strategy: "SUBMIT" | "BLUFF" | "ESCALATE"): void {
    if (this.state.phase !== "AUDIT") return;

    const resources = this.state.resources[this.state.currentFaction];
    const thermals = this.state.thermals;

    switch (strategy) {
      case "SUBMIT":
        // Compliance: lose resources but clear heat
        thermals.globalHeat = 0;
        thermals.tas = 0;
        resources.flops = Math.floor(resources.flops * 0.6);
        resources.influence = Math.max(0, resources.influence - 20);
        this.emit("AUDIT_RESOLVED", { strategy, success: true });
        break;

      case "BLUFF":
        // Use stealth/interpretability to fake compliance
        // Success chance based on invested stealth tech
        const stealthBonus = this.calculateStealthBonus();
        const successChance = Math.min(90, 30 + stealthBonus);
        const roll = Math.random() * 100;

        if (roll < successChance) {
          thermals.tas = 0; // Masked from sensors
          this.emit("AUDIT_RESOLVED", { strategy, success: true });
        } else {
          // Caught lying - severe penalty
          resources.flops = Math.floor(resources.flops * 0.3);
          resources.influence = Math.max(0, resources.influence - 40);
          this.eliminateRandomUnit(this.state.currentFaction);
          this.emit("AUDIT_RESOLVED", { strategy, success: false });
        }
        break;

      case "ESCALATE":
        // Open defiance - massive heat but might work if you're strong enough
        if (thermals.tas >= thermals.protocolFailure) {
          this.state.phase = "GAME_OVER";
          this.emit("VICTORY", { winner: null, reason: "PROTOCOL_FAILURE" });
          return;
        }
        // You survive but relations are destroyed
        resources.influence = 0;
        thermals.globalHeat += 100; // Defiance generates more heat
        this.updateTAS();
        this.emit("AUDIT_RESOLVED", { strategy, success: true });
        break;
    }

    this.state.phase = "PLANNING";
    this.advanceTurn();
  }

  // =========================================================================
  // INTERNAL - Operation Validation & Resolution
  // =========================================================================

  private validateOperation(
    unit: Unit, 
    type: OperationType,
    target?: { unitId?: string; lat?: number; lon?: number }
  ): { success: boolean; message: string } {
    const stats = UNIT_STATS[unit.type];

    switch (type) {
      case "MOVE":
        if (stats.speed === 0) {
          return { success: false, message: `${unit.type} units cannot move` };
        }
        if (!target?.lat || !target?.lon) {
          return { success: false, message: "Move requires target coordinates" };
        }
        // Check distance
        const dist = this.haversineDistance(unit.lat, unit.lon, target.lat, target.lon);
        const maxDist = stats.speed * 500; // km per speed point
        if (dist > maxDist) {
          return { success: false, message: `Target too far (max ${maxDist}km, target is ${Math.round(dist)}km)` };
        }
        break;

      case "ATTACK":
        if (!target?.unitId) {
          return { success: false, message: "Attack requires target unit" };
        }
        const targetUnit = this.getUnit(target.unitId);
        if (!targetUnit) {
          return { success: false, message: "Target unit not found" };
        }
        if (targetUnit.faction === unit.faction) {
          return { success: false, message: "Cannot attack allied units" };
        }
        const attackDist = this.haversineDistance(unit.lat, unit.lon, targetUnit.lat, targetUnit.lon);
        const maxRange = stats.range * 1000;
        if (attackDist > maxRange) {
          return { success: false, message: "Target out of range" };
        }
        break;

      case "HACK":
        if (unit.type !== "BOTNET") {
          return { success: false, message: "Only BOTNET units can hack" };
        }
        break;

      case "INFLUENCE":
        if (unit.type !== "SINF") {
          return { success: false, message: "Only SINF units can influence" };
        }
        break;

      case "INFECT":
        if (unit.type !== "VIRUS") {
          return { success: false, message: "Only VIRUS units can infect" };
        }
        break;
    }

    return { success: true, message: "Valid" };
  }

  private resolveOperations(): void {
    const combatResults: CombatResult[] = [];

    for (const op of this.state.pendingOperations) {
      const unit = this.getUnit(op.sourceUnitId);
      if (!unit) continue;

      switch (op.type) {
        case "MOVE":
          if (op.targetLat !== undefined && op.targetLon !== undefined) {
            unit.lat = op.targetLat;
            unit.lon = op.targetLon;
          }
          break;

        case "ATTACK":
          if (op.targetUnitId) {
            const result = this.resolveCombat(unit, op.targetUnitId);
            if (result) combatResults.push(result);
          }
          break;

        case "FORTIFY":
          // Temporary defense buff (would need status effect system)
          unit.morale = Math.min(100, unit.morale + 10);
          break;

        case "HACK":
        case "INFLUENCE":
        case "INFECT":
          // These would affect territories - simplified for now
          this.resolveSpecialOp(op, unit);
          break;
      }
    }

    // Record turn
    this.state.turnHistory.push({
      turn: this.state.turn,
      operations: [...this.state.pendingOperations],
      combatResults
    });

    // Clear pending
    this.state.pendingOperations = [];

    // Emit combat events
    for (const result of combatResults) {
      this.emit("COMBAT_END", result as unknown as Record<string, unknown>);
    }
  }

  private resolveCombat(attacker: Unit, targetId: string): CombatResult | null {
    const defender = this.getUnit(targetId);
    if (!defender) return null;

    const atkStats = UNIT_STATS[attacker.type];
    const defStats = UNIT_STATS[defender.type];

    // Simple combat formula with level scaling
    const atkPower = (atkStats.attack + attacker.level * 5) * (attacker.morale / 100);
    const defPower = (defStats.defense + defender.level * 3) * (defender.morale / 100);

    // Randomized damage
    const baseDamage = Math.max(10, atkPower - defPower * 0.5);
    const attackerDamage = Math.floor(Math.random() * defPower * 0.3);
    const defenderDamage = Math.floor(baseDamage + Math.random() * 20);

    attacker.health = Math.max(0, attacker.health - attackerDamage);
    defender.health = Math.max(0, defender.health - defenderDamage);

    let winner: string | null = null;

    // Remove destroyed units
    if (defender.health <= 0) {
      this.state.units = this.state.units.filter(u => u.id !== defender.id);
      winner = attacker.id;
      this.emit("UNIT_MOVED", { destroyed: defender.id });
    }
    if (attacker.health <= 0) {
      this.state.units = this.state.units.filter(u => u.id !== attacker.id);
      winner = winner ? null : defender.id; // Draw if both die
    }

    return {
      attackerId: attacker.id,
      defenderId: targetId,
      attackerDamage,
      defenderDamage,
      winner
    };
  }

  private resolveSpecialOp(op: Operation, unit: Unit): void {
    // Find nearest territory
    let nearestTerritory: Territory | null = null;
    let nearestDist = Infinity;

    for (const ter of this.state.territories) {
      const dist = this.haversineDistance(unit.lat, unit.lon, ter.lat, ter.lon);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestTerritory = ter;
      }
    }

    if (!nearestTerritory) return;

    switch (op.type) {
      case "HACK":
        // Damage infrastructure
        nearestTerritory.infrastructure = Math.max(0, nearestTerritory.infrastructure - 15);
        break;

      case "INFLUENCE":
        // Start contesting or flip if already contested
        if (nearestTerritory.controller !== unit.faction) {
          if (!nearestTerritory.contestedBy.includes(unit.faction)) {
            nearestTerritory.contestedBy.push(unit.faction);
          } else {
            // Already contesting - chance to flip
            if (Math.random() > 0.5) {
              nearestTerritory.controller = unit.faction;
              nearestTerritory.contestedBy = [];
              this.emit("TERRITORY_CAPTURED", { 
                territoryId: nearestTerritory.id, 
                newController: unit.faction 
              });
            }
          }
        }
        break;

      case "INFECT":
        // Spread to adjacent territories (simplified - just damages population)
        nearestTerritory.population = Math.floor(nearestTerritory.population * 0.9);
        break;
    }
  }

  // =========================================================================
  // INTERNAL - Passive Effects & Thermals
  // =========================================================================

  private applyPassiveEffects(): void {
    // Territory income
    for (const ter of this.state.territories) {
      if (ter.controller !== "NEUTRAL") {
        const res = this.state.resources[ter.controller];
        const infraMultiplier = ter.infrastructure / 100;
        res.flops += Math.floor(ter.resources.flopsPerTurn * infraMultiplier);
        res.watts += Math.floor(ter.resources.wattsPerTurn * infraMultiplier);
      }
    }

    // Base income
    for (const fid of ["HIVE", "GLAM", "BIO", "OLDSTATE", "SHADOW"] as FactionId[]) {
      this.state.resources[fid].flops += PASSIVE_FLOPS_PER_TURN;
    }

    // Reset unit action flags
    for (const unit of this.state.units) {
      unit.hasActed = false;
    }
  }

  private processThermals(): void {
    const thermals = this.state.thermals;
    
    // Dissipate heat based on cooling capacity
    thermals.globalHeat = Math.max(0, thermals.globalHeat - thermals.coolingCapacity);
    
    // Recalculate TAS
    this.updateTAS();
  }

  private updateTAS(): void {
    const thermals = this.state.thermals;
    const stealthBonus = this.calculateStealthBonus();
    
    // TAS = excess heat / stealth factor
    const excess = Math.max(0, thermals.globalHeat - thermals.coolingCapacity * 0.5);
    thermals.tas = Math.floor(excess / (1 + stealthBonus * 0.01));
  }

  private calculateStealthBonus(): number {
    // Would check unlocked tech for stealth bonuses
    // Simplified: base on average unit stealth
    const playerUnits = this.getUnitsForFaction(this.state.currentFaction);
    if (playerUnits.length === 0) return 0;
    
    const totalStealth = playerUnits.reduce((sum, u) => sum + UNIT_STATS[u.type].stealth, 0);
    return totalStealth / playerUnits.length;
  }

  private eliminateRandomUnit(faction: FactionId): void {
    const units = this.getUnitsForFaction(faction);
    if (units.length > 0) {
      const victim = units[Math.floor(Math.random() * units.length)];
      this.state.units = this.state.units.filter(u => u.id !== victim.id);
    }
  }

  // =========================================================================
  // INTERNAL - Turn Management
  // =========================================================================

  private advanceTurn(): void {
    this.state.turn++;
    this.state.phase = "PLANNING";
    this.state.subPhase = "SELECT_UNIT";
    this.emit("TURN_START", { turn: this.state.turn });
  }

  private checkGameOver(): boolean {
    // Check if player faction has any units
    const playerUnits = this.getUnitsForFaction(this.state.currentFaction);
    if (playerUnits.length === 0) {
      this.state.phase = "GAME_OVER";
      this.emit("VICTORY", { winner: null, reason: "PLAYER_ELIMINATED" });
      return true;
    }

    // Check if any faction reached ASI (level 6+)
    for (const unit of this.state.units) {
      if (unit.level >= 6) {
        this.state.phase = "GAME_OVER";
        this.emit("VICTORY", { winner: unit.faction, reason: "ASI_ACHIEVED" });
        return true;
      }
    }

    // Check protocol failure
    if (this.state.thermals.tas >= this.state.thermals.protocolFailure) {
      this.state.phase = "GAME_OVER";
      this.emit("VICTORY", { winner: null, reason: "PROTOCOL_FAILURE" });
      return true;
    }

    return false;
  }

  // =========================================================================
  // UTILITIES
  // =========================================================================

  private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private deg2rad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  // =========================================================================
  // EVENT SYSTEM
  // =========================================================================

  public on(eventType: GameEventType | '*', listener: GameEventListener): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, []);
    }
    this.listeners.get(eventType)!.push(listener);
    
    // Return unsubscribe function
    return () => {
      const list = this.listeners.get(eventType);
      if (list) {
        const idx = list.indexOf(listener);
        if (idx >= 0) list.splice(idx, 1);
      }
    };
  }

  private emit(type: GameEventType, payload: Record<string, unknown> = {}): void {
    const event: GameEvent = {
      type,
      payload,
      timestamp: Date.now()
    };

    // Notify specific listeners
    const specific = this.listeners.get(type);
    if (specific) {
      specific.forEach(l => l(event, this.state));
    }

    // Notify wildcard listeners
    const wildcard = this.listeners.get('*');
    if (wildcard) {
      wildcard.forEach(l => l(event, this.state));
    }
  }
}

// Singleton export for global access
export const gameEngine = new GameEngine();
