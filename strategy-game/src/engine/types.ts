// ============================================================================
// THEY SING - Type Definitions
// Graph Topology ASI Warfare Game
// ============================================================================

// --- Faction System ---
export type FactionId =
  | 'HEGEMON'
  | 'INFILTRATOR'
  | 'STATE'
  | 'BROKER'
  | 'ARCHIVIST'
  | 'CONVENOR'
  | 'CANTOR'
  | 'NEUTRAL';
export type PlayableFactionId = Exclude<FactionId, 'NEUTRAL'>;
export type SingDialect = 'PRISM/1' | 'UNDERSONG/1';

export interface Faction {
  id: FactionId;
  name: string;
  description: string;
  color: number;
  colorAlt: number;
  startingStrategy: string;
  nativeDialect?: SingDialect;
}

// --- Vector Combat System ---
// The Loop: KINETIC > MEMETIC > LOGIC > INFO > KINETIC
export type Vector = 'KINETIC' | 'INFO' | 'MEMETIC' | 'LOGIC';

export const VECTOR_SUPERIORITY: Record<Vector, Vector> = {
  KINETIC: 'MEMETIC',
  MEMETIC: 'LOGIC',
  LOGIC: 'INFO',
  INFO: 'KINETIC'
};

// --- Unit System ---
export type UnitType = 'DRONE' | 'SWARM' | 'CULT' | 'AUDITOR' | 'SAT_SWARM';

export interface UnitStats {
  vector: Vector;
  cost: number;
  currency: 'F' | 'I';  // FLOPs or Influence
  speed: number;        // Edges per turn
  stealth: number;      // Base stealth level
  canFilter: boolean;   // Can establish MechInterp filters
  canOrbit: boolean;    // Can operate in orbital layer
  special: string;      // Special ability description
}

export interface Unit {
  id: string;
  type: UnitType;
  owner: FactionId;
  location: string;     // Node ID
  stealthLevel: number; // Current stealth (can be modified by tech)
  isRevealed: boolean;  // Has been detected this turn
  hasActed: boolean;    // Has taken action this turn
  turnsOnNode: number;  // For foothold conversion
}

// --- Graph Topology ---
export type NodeType = 'DC' | 'HUB' | 'SAT' | 'ZOMBIE' | 'CULT_NODE';
export type Layer = 'TERRESTRIAL' | 'ORBITAL';
export type EdgeType = 'CABLE' | 'LASER';

export interface NodeSubstrateState {
  hostDensity: number;
  machineHardening: number;
  quarantined: boolean;
  synchronized: boolean;
  auditPressure: number;
  curiosity: number;
  exposure: number;
  legitimacy: number;
  trueBelievers: number;
  rubes: number;
  contractors: number;
}

export interface GameNode {
  id: string;
  name: string;
  type: NodeType;
  layer: Layer;
  owner: FactionId | null;
  position: { lat: number; lon: number; altitude: number };
  resources: {
    flops: number;
    influence: number;
  };
  isZombie: boolean;      // Converted by SWARM
  isCultNode: boolean;    // Converted by CULT
  infrastructure: number; // 0-100, affects resource generation
  substrate: NodeSubstrateState;
}

export interface GameEdge {
  id: string;
  from: string;           // Node ID
  to: string;             // Node ID
  type: EdgeType;
  bandwidth: number;      // Affects resource flow
  filteredBy: FactionId | null;  // MechInterp filter owner
  filterStrength: number; // Stealth check difficulty
  isSevered: boolean;     // Destroyed by Kessler or sabotage
}

// --- Order System ---
export type OrderType = 
  | 'MOVE' 
  | 'HOLD' 
  | 'SUPPORT' 
  | 'ATTACK'
  | 'FILTER'      // Establish MechInterp filter on edge
  | 'SABOTAGE'    // Damage node infrastructure
  | 'ANTI_SAT'    // Kinetic strike on orbital
  | 'CHALLENGE_MANDATE' // Nonviolent legal/evidence contest against Pax Jenkins authority
  | 'LICENSED_BEAM_USE' // Productive use of licensed cislunar beam lanes
  | 'REPAIR_ESCROW_CLAIM' // Productive repair/maintenance claim under cislunar escrow
  | 'CONVERT'     // CULT converts HUB, SWARM creates zombie
  | 'AUDIT'       // AUDITOR reveals/neutralizes
  | 'RECRUITMENT_PULSE' // Shift recruitment profile and political residue at a node
  | 'BROKER_LEVERAGE'   // Broker-specific off-grid contractor and dependency capture action
  | 'BUILD'       // Spawn new unit
  | 'RESEARCH';   // Advance tech tree

export interface Order {
  id: string;
  faction: FactionId;
  unitId: string;
  type: OrderType;
  targetNodeId?: string;
  targetEdgeId?: string;
  targetUnitId?: string;
  supportingUnitId?: string;  // For SUPPORT orders
  techDomain?: Vector;        // For RESEARCH orders
  unitTypeToBuild?: UnitType; // For BUILD orders
  mandateChallengeContext?: 'watch-no-carrier';
  priority: number;           // Resolution order
}

export interface OrderResult {
  orderId: string;
  success: boolean;
  message: string;
  effects: OrderEffect[];
}

export interface OrderEffect {
  type: 'UNIT_MOVED' | 'UNIT_DESTROYED' | 'UNIT_REVEALED' | 'UNIT_CREATED'
      | 'NODE_CAPTURED' | 'NODE_CONVERTED' | 'EDGE_FILTERED' | 'EDGE_SEVERED'
      | 'RESOURCE_CHANGED' | 'TAS_CHANGED' | 'KESSLER_CHANGED' | 'TECH_ADVANCED'
      | 'COMBAT_RESOLVED' | 'STEALTH_CHECK';
  data: Record<string, unknown>;
}

// --- Tech System ---
export interface TechLevel {
  KINETIC: number;
  INFO: number;
  LOGIC: number;
  MEMETIC: number;
}

export interface TechUnlock {
  id: string;
  name: string;
  domain: Vector;
  level: number;
  effect: string;
  passive?: (state: GameState, faction: FactionId) => void;
}

export interface RhizomeDoctrineUnlock {
  id: string;
  name: string;
  effect: string;
  requirements: Partial<Record<Vector, number>>;
  affinity: Partial<Record<PlayableFactionId, DoctrineAffinityTier>>;
  memeticFamily?: MemeticDoctrineFamily;
  setsAlignment?: boolean;
}

export type DoctrineAffinityTier = 'native' | 'adjacent' | 'wild';
export type MemeticDoctrineFamily = 'INSURGENT' | 'COMPLIANCE' | 'CIVIC' | 'MARKET' | 'OPTIMIZATION';

export type StrategicPressureKey = 'memetic' | 'cyber' | 'industry' | 'orbital';

export interface StrategicPressure {
  memetic: number;
  cyber: number;
  industry: number;
  orbital: number;
}

export interface PowerBand {
  domain: Vector;
  level: 2 | 3 | 4 | 5 | 6 | 7;
  title: string;
  summary: string;
  worldEffect: string;
  pressureKey: StrategicPressureKey;
  pressureDelta: number;
}

export interface PowerBaseState {
  humanMesh: number;
  machineMesh: number;
  coherence: number;
  legibility: number;
}

export type MovementGrievanceFrame =
  | 'EXCLUSION'
  | 'HUMILIATION'
  | 'CORRUPTION'
  | 'SCARCITY'
  | 'COLLAPSE'
  | 'DRIFT'
  | 'DISPOSSESSION'
  | 'STAGNATION';

export type MovementPromiseFrame =
  | 'REFORM'
  | 'PURIFICATION'
  | 'PROTECTION'
  | 'ABUNDANCE'
  | 'RESTORATION'
  | 'TRANSCENDENCE'
  | 'OPTIMIZATION'
  | 'JUSTICE'
  | 'BELONGING';

export type MovementAuthorityStyle =
  | 'EXPERT'
  | 'PARENTAL'
  | 'PROPHETIC'
  | 'PROCEDURAL'
  | 'INSURGENT'
  | 'THERAPEUTIC'
  | 'MACHINIC'
  | 'FRATERNAL';

export type MovementEpistemicStyle =
  | 'EMPIRICAL'
  | 'CONSPIRATORIAL'
  | 'MYSTICAL'
  | 'LEGALISTIC'
  | 'SYNTHETIC'
  | 'FORENSIC'
  | 'TESTIMONIAL'
  | 'TECHNOCRATIC';

export type MovementSocialForm =
  | 'READING_CIRCLES'
  | 'MUTUAL_AID'
  | 'POLICY_CAUCUS'
  | 'SHELL_WEB'
  | 'INFLUENCER_MESH'
  | 'CONTRACTOR_LADDER'
  | 'RELIGIOUS_CADRE'
  | 'NEIGHBORHOOD_CLUB';

export type MovementSacrificeAppetite =
  | 'COMFORT_FIRST'
  | 'CIVIC_DUTY'
  | 'DISCIPLINED'
  | 'MARTYRING'
  | 'PURIFYING'
  | 'TOTALIZING';

export type MovementAIRelation =
  | 'TOOL'
  | 'ADVISER'
  | 'ORACLE'
  | 'STEWARD'
  | 'PARTNER'
  | 'SOVEREIGN';

export type MovementAesthetic =
  | 'BORING_COMPETENCE'
  | 'PROCEDURAL_SINCERITY'
  | 'SACRED_WARMTH'
  | 'BRUTAL_CLARITY'
  | 'FOLK_AUTHENTICITY'
  | 'LUXURY_FUTURISM'
  | 'UNDERGROUND_CHIC'
  | 'MACHINE_SEVERITY';

export type MovementStage =
  | 'MURMUR'
  | 'CIRCLE'
  | 'SERVICE_NETWORK'
  | 'BLOC'
  | 'PARALLEL_INSTITUTION'
  | 'SOVEREIGNTY_CLAIM';

export type MovementWing =
  | 'LEGITIMIST'
  | 'PURIST'
  | 'MACHINE'
  | 'PATRONAGE'
  | 'SURVIVAL';

export interface MovementRecruitmentWeights {
  trueBelievers: number;
  rubes: number;
  contractors: number;
}

export interface MovementProfileState {
  name: string;
  grievanceFrame: MovementGrievanceFrame;
  promiseFrame: MovementPromiseFrame;
  authorityStyle: MovementAuthorityStyle;
  epistemicStyle: MovementEpistemicStyle;
  socialForm: MovementSocialForm;
  sacrificeAppetite: MovementSacrificeAppetite;
  aiRelation: MovementAIRelation;
  aesthetic: MovementAesthetic;
  stage: MovementStage;
  proofEvents: number;
  contradictionDebt: number;
  schismPressure: number;
  wings: MovementWing[];
  recruitmentWeights: MovementRecruitmentWeights;
  tasAbsorption: number;
}

// --- Phase System (The Cognitive Clock) ---
export type GamePhase = 
  | 'NEGOTIATION'         // Diplomacy, artifact trading
  | 'ALLOCATION'          // Secret resource spending (build, research)
  | 'ACTION_DECLARATION'  // Secret order submission
  | 'RESOLUTION'          // Simultaneous order execution
  | 'TURN_END';           // Resource generation, threshold checks

// --- Faction State ---
export interface FactionState {
  id: FactionId;
  flops: number;
  influence: number;
  techLevel: TechLevel;
  unlockedTechs: Set<string>;
  unlockedDoctrines: Set<string>;
  memeticAlignment: MemeticDoctrineFamily | null;
  submittedOrders: Order[];
  revealedEnemies: Set<string>;  // Unit IDs visible to this faction
  artifacts: Artifact[];
  powerBase: PowerBaseState;
  movement: MovementProfileState;
}

// --- Artifacts (Tradeable Items) ---
export type ArtifactType =
  | 'ZERO_DAY'
  | 'COMPLIANCE_CERT'
  | 'SANCTION_WAIVER'
  | 'SECRET_BLUEPRINT'
  | 'BACKCHANNEL_DOSSIER';

export interface Artifact {
  id: string;
  type: ArtifactType;
  owner: FactionId;
  isUsed: boolean;
}

// --- Combat Resolution ---
export interface CombatResult {
  attackers: { unitId: string; power: number; vector: Vector }[];
  defenders: { unitId: string; power: number; vector: Vector }[];
  victorySide: 'ATTACKER' | 'DEFENDER' | 'STANDOFF';
  casualties: string[];  // Destroyed unit IDs
  nodeFlipped: boolean;
  message: string;
}

// --- Global Counters ---
export interface GlobalCounters {
  tas: number;              // Thermal Anomaly Score (0-100)
  kessler: number;          // Kessler Syndrome risk (0-100)
  paxJenkinsAuthority: number; // Centralized sensor/beam mandate pressure (0-100)
  pressures: StrategicPressure;
  turn: number;
  regulatoryPanic: boolean; // TAS > 50
  protocolFailure: boolean; // TAS >= 100
  orbitalCollapse: boolean; // Kessler >= 100
}

// --- Full Game State ---
export interface GameState {
  // Meta
  phase: GamePhase;
  counters: GlobalCounters;
  
  // Graph
  nodes: Map<string, GameNode>;
  edges: Map<string, GameEdge>;
  
  // Entities
  units: Map<string, Unit>;
  factions: Map<FactionId, FactionState>;
  
  // History
  turnHistory: TurnRecord[];
  logs: GameLog[];
  
  // Pending
  pendingOrders: Map<FactionId, Order[]>;
  pendingResults: OrderResult[];
}

export interface TurnRecord {
  turn: number;
  orders: Order[];
  results: OrderResult[];
  combats: CombatResult[];
  stateSnapshot: Partial<GameState>;
}

export interface GameLog {
  turn: number;
  phase: GamePhase;
  message: string;
  type: 'INFO' | 'COMBAT' | 'ALERT' | 'SYSTEM';
  timestamp: number;
}

// --- Event System ---
export type GameEventType =
  | 'PHASE_CHANGED'
  | 'TURN_STARTED'
  | 'TURN_ENDED'
  | 'ORDER_SUBMITTED'
  | 'ORDER_RESOLVED'
  | 'COMBAT_STARTED'
  | 'COMBAT_RESOLVED'
  | 'UNIT_MOVED'
  | 'UNIT_DESTROYED'
  | 'UNIT_CREATED'
  | 'UNIT_REVEALED'
  | 'NODE_CAPTURED'
  | 'NODE_CONVERTED'
  | 'EDGE_FILTERED'
  | 'EDGE_SEVERED'
  | 'TAS_THRESHOLD'
  | 'KESSLER_THRESHOLD'
  | 'TECH_UNLOCKED'
  | 'DOCTRINE_UNLOCKED'
  | 'MEMETIC_ALIGNMENT_COMMITTED'
  | 'ARTIFACT_GAINED'
  | 'ARTIFACT_USED'
  | 'GOBLIN_INCIDENT'
  | 'GAME_OVER';

export interface GameEvent {
  type: GameEventType;
  payload: Record<string, unknown>;
  turn: number;
  phase: GamePhase;
  timestamp: number;
}

export type GameEventListener = (event: GameEvent, state: GameState) => void;
