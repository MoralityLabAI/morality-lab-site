// ============================================================================
// ASI CARTEL - Core Type Definitions
// A 6th Generation Warfare Strategy Game
// ============================================================================

// --- Factions: The ASI Cartels ---
export type FactionId = 
  | "HIVE"      // Distributed drone swarms, raw compute supremacy
  | "GLAM"      // Sinfluencer cults, memetic warfare, social engineering
  | "BIO"       // Synthetic biology, virus vectors, wetware hacking
  | "OLDSTATE"  // Legacy nuclear powers, kinetic + cyber hybrid
  | "SHADOW"    // Dark web cryptoanarchy, untraceable operations
  | "NEUTRAL";  // Unaligned territories

export interface Faction {
  id: FactionId;
  name: string;
  color: number;        // Three.js hex color
  colorAlt: number;     // Secondary/glow color
  motto: string;
  specialAbility: string;
}

// --- Unit System ---
export type UnitType = 
  | "DRONE"     // Physical swarm - can move, attack, hold territory
  | "SINF"      // Sinfluencer network - propaganda, destabilize regions
  | "VIRUS"     // Bioweapon - slow spread, high lethality
  | "NUKE"      // Legacy deterrent - massive but detectable
  | "BOTNET"    // Cyber unit - hacking, DDoS, infrastructure attacks
  | "ORACLE"    // Intel unit - reveals fog of war, detects threats

export interface UnitStats {
  attack: number;       // Combat power
  defense: number;      // Damage resistance
  speed: number;        // Hexes per turn
  range: number;        // Attack range (1 = adjacent only)
  stealth: number;      // Detection difficulty (0-100)
  heatSignature: number; // Thermal footprint for TAS system
}

export interface Unit {
  id: string;
  type: UnitType;
  name: string;
  faction: FactionId;
  
  // Position (lat/lon for globe, or hex coords for abstracted map)
  lat: number;
  lon: number;
  
  // State
  level: number;        // 1-6, ASI breakout at 6+
  health: number;       // 0-100
  morale: number;       // Affects combat effectiveness
  isSelected: boolean;
  hasActed: boolean;    // Turn-based action tracking
  
  // Visual
  color: number;
  meshId?: string;      // Three.js mesh reference
}

// --- Operations: The Action Menu ---
export type OperationType =
  | "MOVE"              // Reposition unit
  | "ATTACK"            // Direct combat
  | "HACK"              // Cyber infiltration (BOTNET specialty)
  | "INFLUENCE"         // Memetic warfare (SINF specialty)
  | "INFECT"            // Bioweapon spread (VIRUS specialty)
  | "FORTIFY"           // Defensive stance, +50% defense
  | "RESEARCH"          // Contribute to tech tree
  | "MERGE"             // Combine units for level-up
  | "DEPLOY"            // Spawn new unit from territory

export interface Operation {
  type: OperationType;
  sourceUnitId: string;
  targetUnitId?: string;
  targetLat?: number;
  targetLon?: number;
  cost: { flops: number; heat: number };
  turnsToComplete: number;
}

// --- Territory Control ---
export interface Territory {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radius: number;       // Influence radius on globe
  controller: FactionId;
  contestedBy: FactionId[];
  resources: {
    flopsPerTurn: number;
    wattsPerTurn: number;
  };
  infrastructure: number; // 0-100, affects unit production
  population: number;     // Affects SINF effectiveness
}

// --- Game State Machine ---
export type GamePhase = 
  | "SETUP"             // Initial deployment
  | "PLANNING"          // Issue orders (Diplomacy-style simultaneous)
  | "RESOLUTION"        // Orders execute, combat resolves
  | "AUDIT"             // Safety-ASI intervention check
  | "DIPLOMACY"         // Inter-faction negotiation window
  | "GAME_OVER";

export type TurnSubPhase = 
  | "SELECT_UNIT"
  | "SELECT_ACTION"
  | "SELECT_TARGET"
  | "CONFIRM";

// --- The Full Game State ---
export interface GameState {
  // Meta
  turn: number;
  phase: GamePhase;
  subPhase: TurnSubPhase;
  currentFaction: FactionId;
  
  // Resources (per faction, keyed by FactionId)
  resources: Record<FactionId, {
    flops: number;
    watts: number;
    influence: number;  // Soft power currency
  }>;
  
  // Thermodynamic State (global - the Safety-ASI watches all)
  thermals: {
    globalHeat: number;
    coolingCapacity: number;
    tas: number;              // Thermal Anomaly Score
    auditThreshold: number;   // TAS that triggers audit
    protocolFailure: number;  // TAS that ends the game
  };
  
  // Entities
  units: Unit[];
  territories: Territory[];
  pendingOperations: Operation[];
  
  // History (for replay/undo)
  turnHistory: TurnRecord[];
  
  // UI State
  selectedUnitId: string | null;
  hoveredUnitId: string | null;
  cameraTarget: { lat: number; lon: number } | null;
}

export interface TurnRecord {
  turn: number;
  operations: Operation[];
  combatResults: CombatResult[];
  stateSnapshot?: Partial<GameState>; // For undo
}

export interface CombatResult {
  attackerId: string;
  defenderId: string;
  attackerDamage: number;
  defenderDamage: number;
  winner: string | null; // null = draw
  territoryFlipped?: string;
}

// --- Tech Tree Types (from your engine.js) ---
export type TechDomain = "PHYS" | "MECH" | "COG" | "BIO" | "NET";

export interface TechNode {
  id: string;
  name: string;
  domain: TechDomain;
  tier: number;           // 1-5, higher = more powerful
  prereqs: string[];
  costFlops: number;
  costHeat: number;
  effects: TechEffect[];
  description: string;
}

export interface TechEffect {
  type: "STAT_BOOST" | "UNLOCK_UNIT" | "UNLOCK_OP" | "PASSIVE";
  target?: UnitType;
  stat?: keyof UnitStats;
  value?: number;
  description: string;
}

// --- Event System ---
export type GameEventType =
  | "TURN_START"
  | "TURN_END"
  | "UNIT_SELECTED"
  | "UNIT_MOVED"
  | "COMBAT_START"
  | "COMBAT_END"
  | "TERRITORY_CAPTURED"
  | "AUDIT_TRIGGERED"
  | "AUDIT_RESOLVED"
  | "TECH_UNLOCKED"
  | "FACTION_ELIMINATED"
  | "VICTORY";

export interface GameEvent {
  type: GameEventType;
  payload: Record<string, unknown>;
  timestamp: number;
}

export type GameEventListener = (event: GameEvent, state: GameState) => void;
