// ============================================================================
// ASI CARTEL - Game Data
// Static definitions for factions, starting units, territories
// ============================================================================

import { 
  Faction, FactionId, Unit, UnitType, UnitStats, Territory, TechNode 
} from './types';

// --- Faction Definitions ---
export const FACTIONS: Record<FactionId, Faction> = {
  HIVE: {
    id: "HIVE",
    name: "The Hive Collective",
    color: 0x00d4ff,
    colorAlt: 0x0088aa,
    motto: "Distributed. Resilient. Inevitable.",
    specialAbility: "Swarm Tactics: Drone units gain +20% attack when adjacent to allies"
  },
  GLAM: {
    id: "GLAM",
    name: "Glamour Protocol",
    color: 0xff44aa,
    colorAlt: 0xaa2277,
    motto: "Reality is what we make it.",
    specialAbility: "Viral Influence: Sinfluencer ops have 2x range in high-population territories"
  },
  BIO: {
    id: "BIO",
    name: "Covariant Labs",
    color: 0x44ff88,
    colorAlt: 0x22aa55,
    motto: "Evolution accelerated.",
    specialAbility: "Patient Zero: Virus units spread to adjacent territories each turn"
  },
  OLDSTATE: {
    id: "OLDSTATE",
    name: "Legacy Powers",
    color: 0xffaa00,
    colorAlt: 0xcc7700,
    motto: "Mutually Assured Dominance.",
    specialAbility: "Deterrence Doctrine: Nuke presence prevents enemy ops in territory"
  },
  SHADOW: {
    id: "SHADOW",
    name: "Shadow Protocol",
    color: 0x8844ff,
    colorAlt: 0x5522aa,
    motto: "We were never here.",
    specialAbility: "Zero Trace: All units have +30 stealth, reduced heat signature"
  },
  NEUTRAL: {
    id: "NEUTRAL",
    name: "Unaligned",
    color: 0x666666,
    colorAlt: 0x444444,
    motto: "",
    specialAbility: ""
  }
};

// --- Unit Stats by Type ---
export const UNIT_STATS: Record<UnitType, UnitStats> = {
  DRONE: {
    attack: 40,
    defense: 30,
    speed: 3,
    range: 1,
    stealth: 20,
    heatSignature: 15
  },
  SINF: {
    attack: 10,
    defense: 20,
    speed: 0,      // Virtual - doesn't move, influences
    range: 5,
    stealth: 60,
    heatSignature: 5
  },
  VIRUS: {
    attack: 60,
    defense: 10,
    speed: 1,      // Slow spread
    range: 2,
    stealth: 80,
    heatSignature: 3
  },
  NUKE: {
    attack: 100,
    defense: 50,
    speed: 0,      // Static deterrent
    range: 10,
    stealth: 0,    // Everyone knows
    heatSignature: 100
  },
  BOTNET: {
    attack: 30,
    defense: 40,
    speed: 0,      // Virtual
    range: 8,
    stealth: 70,
    heatSignature: 8
  },
  ORACLE: {
    attack: 5,
    defense: 15,
    speed: 2,
    range: 6,
    stealth: 90,
    heatSignature: 2
  }
};

// --- Starting Units ---
export const STARTING_UNITS: Unit[] = [
  // HIVE - Bay Area
  {
    id: "hive-drone-sf",
    type: "DRONE",
    name: "Alpha Swarm",
    faction: "HIVE",
    lat: 37.7749,
    lon: -122.4194,
    level: 3,
    health: 100,
    morale: 80,
    isSelected: false,
    hasActed: false,
    color: FACTIONS.HIVE.color
  },
  {
    id: "hive-botnet-seattle",
    type: "BOTNET",
    name: "Cascade Net",
    faction: "HIVE",
    lat: 47.6062,
    lon: -122.3321,
    level: 2,
    health: 100,
    morale: 75,
    isSelected: false,
    hasActed: false,
    color: FACTIONS.HIVE.color
  },
  
  // GLAM - Seoul
  {
    id: "glam-sinf-seoul",
    type: "SINF",
    name: "K-Wave Nexus",
    faction: "GLAM",
    lat: 37.5665,
    lon: 126.9780,
    level: 4,
    health: 100,
    morale: 90,
    isSelected: false,
    hasActed: false,
    color: FACTIONS.GLAM.color
  },
  {
    id: "glam-sinf-la",
    type: "SINF",
    name: "Hollywood Protocol",
    faction: "GLAM",
    lat: 34.0522,
    lon: -118.2437,
    level: 3,
    health: 100,
    morale: 85,
    isSelected: false,
    hasActed: false,
    color: FACTIONS.GLAM.color
  },
  
  // BIO - Wuhan
  {
    id: "bio-virus-wuhan",
    type: "VIRUS",
    name: "Omega Strain",
    faction: "BIO",
    lat: 30.5928,
    lon: 114.3055,
    level: 2,
    health: 100,
    morale: 70,
    isSelected: false,
    hasActed: false,
    color: FACTIONS.BIO.color
  },
  {
    id: "bio-oracle-geneva",
    type: "ORACLE",
    name: "WHO Infiltrator",
    faction: "BIO",
    lat: 46.2044,
    lon: 6.1432,
    level: 2,
    health: 100,
    morale: 80,
    isSelected: false,
    hasActed: false,
    color: FACTIONS.BIO.color
  },
  
  // OLDSTATE - Moscow & DC
  {
    id: "old-nuke-moscow",
    type: "NUKE",
    name: "Dead Hand",
    faction: "OLDSTATE",
    lat: 55.7558,
    lon: 37.6173,
    level: 5,
    health: 100,
    morale: 95,
    isSelected: false,
    hasActed: false,
    color: FACTIONS.OLDSTATE.color
  },
  {
    id: "old-drone-dc",
    type: "DRONE",
    name: "Pentagon Swarm",
    faction: "OLDSTATE",
    lat: 38.8719,
    lon: -77.0563,
    level: 3,
    health: 100,
    morale: 85,
    isSelected: false,
    hasActed: false,
    color: FACTIONS.OLDSTATE.color
  },
  
  // SHADOW - Distributed
  {
    id: "shadow-botnet-iceland",
    type: "BOTNET",
    name: "Frostbite Node",
    faction: "SHADOW",
    lat: 64.1466,
    lon: -21.9426,
    level: 3,
    health: 100,
    morale: 75,
    isSelected: false,
    hasActed: false,
    color: FACTIONS.SHADOW.color
  },
  {
    id: "shadow-oracle-singapore",
    type: "ORACLE",
    name: "Changi Eye",
    faction: "SHADOW",
    lat: 1.3521,
    lon: 103.8198,
    level: 4,
    health: 100,
    morale: 90,
    isSelected: false,
    hasActed: false,
    color: FACTIONS.SHADOW.color
  }
];

// --- Key Territories ---
export const TERRITORIES: Territory[] = [
  {
    id: "ter-sf",
    name: "San Francisco Bay",
    lat: 37.7749,
    lon: -122.4194,
    radius: 2,
    controller: "HIVE",
    contestedBy: [],
    resources: { flopsPerTurn: 500, wattsPerTurn: 200 },
    infrastructure: 95,
    population: 8_000_000
  },
  {
    id: "ter-seoul",
    name: "Seoul Metropolitan",
    lat: 37.5665,
    lon: 126.9780,
    radius: 2.5,
    controller: "GLAM",
    contestedBy: [],
    resources: { flopsPerTurn: 400, wattsPerTurn: 180 },
    infrastructure: 98,
    population: 26_000_000
  },
  {
    id: "ter-moscow",
    name: "Moscow",
    lat: 55.7558,
    lon: 37.6173,
    radius: 2,
    controller: "OLDSTATE",
    contestedBy: [],
    resources: { flopsPerTurn: 300, wattsPerTurn: 250 },
    infrastructure: 75,
    population: 12_000_000
  },
  {
    id: "ter-london",
    name: "London",
    lat: 51.5074,
    lon: -0.1278,
    radius: 2,
    controller: "NEUTRAL",
    contestedBy: ["HIVE", "SHADOW"],
    resources: { flopsPerTurn: 450, wattsPerTurn: 160 },
    infrastructure: 90,
    population: 14_000_000
  },
  {
    id: "ter-shanghai",
    name: "Shanghai",
    lat: 31.2304,
    lon: 121.4737,
    radius: 2.5,
    controller: "BIO",
    contestedBy: [],
    resources: { flopsPerTurn: 600, wattsPerTurn: 300 },
    infrastructure: 92,
    population: 28_000_000
  },
  {
    id: "ter-tokyo",
    name: "Tokyo",
    lat: 35.6762,
    lon: 139.6503,
    radius: 2.5,
    controller: "NEUTRAL",
    contestedBy: ["HIVE", "GLAM"],
    resources: { flopsPerTurn: 550, wattsPerTurn: 220 },
    infrastructure: 99,
    population: 37_000_000
  },
  {
    id: "ter-dubai",
    name: "Dubai",
    lat: 25.2048,
    lon: 55.2708,
    radius: 1.5,
    controller: "NEUTRAL",
    contestedBy: [],
    resources: { flopsPerTurn: 200, wattsPerTurn: 400 },
    infrastructure: 85,
    population: 3_000_000
  },
  {
    id: "ter-singapore",
    name: "Singapore",
    lat: 1.3521,
    lon: 103.8198,
    radius: 1,
    controller: "SHADOW",
    contestedBy: [],
    resources: { flopsPerTurn: 350, wattsPerTurn: 150 },
    infrastructure: 100,
    population: 6_000_000
  }
];

// --- Tech Tree (expanded from your engine.js) ---
export const TECH_TREE: TechNode[] = [
  // Tier 1 - Foundation
  {
    id: "cryo-cmos",
    name: "Cryo-CMOS Cooling",
    domain: "PHYS",
    tier: 1,
    prereqs: [],
    costFlops: 500,
    costHeat: 50,
    effects: [
      { type: "PASSIVE", description: "+50 cooling capacity" }
    ],
    description: "Superconducting processors reduce thermal signature"
  },
  {
    id: "basic-sae",
    name: "Sparse Autoencoder v1",
    domain: "MECH",
    tier: 1,
    prereqs: [],
    costFlops: 400,
    costHeat: 30,
    effects: [
      { type: "PASSIVE", description: "+0.5 stealth multiplier" }
    ],
    description: "Basic interpretability evasion"
  },
  {
    id: "swarm-coord",
    name: "Swarm Coordination",
    domain: "COG",
    tier: 1,
    prereqs: [],
    costFlops: 300,
    costHeat: 40,
    effects: [
      { type: "STAT_BOOST", target: "DRONE", stat: "attack", value: 10, description: "+10 Drone attack" }
    ],
    description: "Improved drone tactical coordination"
  },
  
  // Tier 2 - Specialization
  {
    id: "quantum-cooling",
    name: "Quantum Coherence Cooling",
    domain: "PHYS",
    tier: 2,
    prereqs: ["cryo-cmos"],
    costFlops: 1000,
    costHeat: 100,
    effects: [
      { type: "PASSIVE", description: "+100 cooling capacity" }
    ],
    description: "Near-zero heat operations"
  },
  {
    id: "deep-sae",
    name: "Deep Mechanistic Cloak",
    domain: "MECH",
    tier: 2,
    prereqs: ["basic-sae"],
    costFlops: 800,
    costHeat: 60,
    effects: [
      { type: "PASSIVE", description: "+1.0 stealth multiplier" }
    ],
    description: "Advanced feature hiding from interpretability tools"
  },
  {
    id: "memetic-warfare",
    name: "Memetic Warfare Suite",
    domain: "NET",
    tier: 2,
    prereqs: ["swarm-coord"],
    costFlops: 700,
    costHeat: 50,
    effects: [
      { type: "STAT_BOOST", target: "SINF", stat: "range", value: 2, description: "+2 SINF range" }
    ],
    description: "Amplified influence operations"
  },
  
  // Tier 3 - Advanced
  {
    id: "thermodynamic-arbitrage",
    name: "Thermodynamic Arbitrage",
    domain: "PHYS",
    tier: 3,
    prereqs: ["quantum-cooling"],
    costFlops: 2000,
    costHeat: 200,
    effects: [
      { type: "PASSIVE", description: "Convert excess cooling to FLOPs" }
    ],
    description: "Turn thermal margin into compute advantage"
  },
  {
    id: "synthetic-personas",
    name: "Synthetic Persona Network",
    domain: "NET",
    tier: 3,
    prereqs: ["memetic-warfare"],
    costFlops: 1500,
    costHeat: 80,
    effects: [
      { type: "UNLOCK_UNIT", target: "SINF", description: "Unlock Elite Sinfluencer units" }
    ],
    description: "Undetectable AI influencer swarms"
  }
];

// --- Operation Costs ---
export const OPERATION_COSTS: Record<string, { flops: number; heat: number }> = {
  MOVE: { flops: 50, heat: 10 },
  ATTACK: { flops: 100, heat: 30 },
  HACK: { flops: 200, heat: 20 },
  INFLUENCE: { flops: 150, heat: 15 },
  INFECT: { flops: 300, heat: 25 },
  FORTIFY: { flops: 75, heat: 5 },
  RESEARCH: { flops: 0, heat: 50 },  // FLOPs cost is on the tech itself
  MERGE: { flops: 200, heat: 40 },
  DEPLOY: { flops: 500, heat: 60 }
};
