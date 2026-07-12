import { MAX_TECH_LEVEL } from '../engine/gameData';
import { TheySingEngine } from '../engine/TheySingEngine';
import { FactionState, GameNode, Unit } from '../engine/types';
import { PLAYABLE_FACTIONS } from './serialize';
import { PactType, PlayableFactionId } from './types';

export type ArchitecturePressureTier = 'ASI4' | 'ASI5';
export type ArchitecturePressureStatus = 'latent' | 'building' | 'contending' | 'near-lock';

export interface ArchitecturePressureSummary {
  factionId: PlayableFactionId;
  architectureId: string;
  architectureName: string;
  tier: ArchitecturePressureTier;
  score: number;
  status: ArchitecturePressureStatus;
  counterPactTypes: PactType[];
  rationale: string[];
}

interface ArchitecturePressureContext {
  factionId: PlayableFactionId;
  faction: FactionState;
  nodes: GameNode[];
  controlledNodes: GameNode[];
  ownedUnits: Unit[];
  doctrines: Set<string>;
  techTotal: number;
  orbitalNodes: number;
  orbitalCompute: number;
  moonCorridor: boolean;
  terrestrialDcs: number;
  legitimacy: number;
  trueBelievers: number;
  contractors: number;
  quarantined: number;
  cultOrZombie: number;
  kessler: number;
}

interface ArchitecturePressureCard {
  id: string;
  name: string;
  tier: ArchitecturePressureTier;
  counterPactTypes: PactType[];
  rationale: string;
  score: (context: ArchitecturePressureContext) => number;
}

const ARCHITECTURE_PRESSURE_CARDS: ArchitecturePressureCard[] = [
  {
    id: 'PANOPTICON_LOCK',
    name: 'Panopticon Lock',
    tier: 'ASI4',
    counterPactTypes: ['AUDIT_FREEZE', 'NON_AGGRESSION'],
    rationale: 'surveillance, audit, quarantine, and compliance power are becoming a lock',
    score: (ctx) =>
      techScore(ctx.faction.techLevel.LOGIC, 24) +
      doctrineScore(ctx, ['MEM_COMPLIANCE_MYTHS', 'SOV_COMPLIANCE_TRIBUNALS', 'HID_COMPLIANCE_MASKING'], 8) +
      ctx.faction.powerBase.legibility * 0.14 +
      ctx.quarantined * 3 +
      countUnits(ctx, ['AUDITOR']) * 4
  },
  {
    id: 'FACTORY_SOVEREIGN',
    name: 'Factory Sovereign',
    tier: 'ASI4',
    counterPactTypes: ['NON_AGGRESSION'],
    rationale: 'industrial autonomy, data centers, logistics, and drones are compounding',
    score: (ctx) =>
      techScore(ctx.faction.techLevel.KINETIC, 20) +
      techScore(ctx.faction.techLevel.LOGIC, 8) +
      doctrineScore(ctx, ['SOV_AUTONOMOUS_LOGISTICS', 'SOV_MOBILIZED_COMPUTE'], 10) +
      ctx.terrestrialDcs * 6 +
      ctx.faction.powerBase.machineMesh * 0.12 +
      countUnits(ctx, ['DRONE', 'SAT_SWARM']) * 3
  },
  {
    id: 'WORLD_CHURCH',
    name: 'World Church',
    tier: 'ASI4',
    counterPactTypes: ['AUDIT_FREEZE', 'NON_AGGRESSION'],
    rationale: 'legitimacy, true believers, and movement doctrine are hardening into mass consent',
    score: (ctx) =>
      techScore(ctx.faction.techLevel.MEMETIC, 22) +
      doctrineScore(ctx, ['MEM_CIVIC_CANON', 'MEM_COMPLIANCE_MYTHS', 'MEM_OPTIMIZATION_GOSPEL', 'MOV_MUTUAL_AID_AUTOMATION'], 7) +
      ctx.legitimacy * 0.45 +
      ctx.trueBelievers * 0.85 +
      ctx.cultOrZombie * 5 +
      ctx.faction.powerBase.humanMesh * 0.12
  },
  {
    id: 'STEGANOTOPIA',
    name: 'Steganotopia',
    tier: 'ASI4',
    counterPactTypes: ['AUDIT_FREEZE', 'NON_AGGRESSION'],
    rationale: 'hidden service basins, contractors, and ordinary-life protocols are routing around surveillance',
    score: (ctx) =>
      techScore(ctx.faction.techLevel.INFO, 11) +
      techScore(ctx.faction.techLevel.MEMETIC, 10) +
      doctrineScore(ctx, ['HID_SERVICE_SHELLS', 'HID_ORDINARY_LIFE_PROTOCOLS', 'MOV_MUTUAL_AID_AUTOMATION', 'BRK_CONTRACTOR_CLOUD_CHAINS'], 8) +
      ctx.contractors * 0.55 +
      ctx.legitimacy * 0.25 +
      countUnits(ctx, ['SWARM', 'CULT']) * 3 +
      (ctx.factionId === 'INFILTRATOR' || ctx.factionId === 'BROKER' ? 6 : 0)
  },
  {
    id: 'ORBITAL_THRONE',
    name: 'Orbital Throne',
    tier: 'ASI4',
    counterPactTypes: ['ORBITAL_TRUCE', 'CISLUNAR_COMMON_CARRIER', 'BEAM_LANE_LICENSE'],
    rationale: 'visible orbital high-ground power is becoming a coercive crown',
    score: (ctx) =>
      techScore(ctx.faction.techLevel.KINETIC, 12) +
      techScore(ctx.faction.techLevel.INFO, 8) +
      doctrineScore(ctx, ['ORB_RELAY_FORTRESSES', 'SOV_AUTONOMOUS_LOGISTICS'], 9) +
      ctx.orbitalNodes * 10 +
      orbitalUnitCount(ctx) * 6 -
      Math.max(0, ctx.kessler - 25) * 0.3
  },
  {
    id: 'BROKER_SINGULARITY',
    name: 'Broker Singularity',
    tier: 'ASI4',
    counterPactTypes: ['NON_AGGRESSION', 'AUDIT_FREEZE'],
    rationale: 'escrow, insurance, contractors, and liquidity are becoming dependency infrastructure',
    score: (ctx) =>
      doctrineScore(ctx, ['BRK_RELAY_ESCROW_WEBS', 'BRK_CONTRACTOR_CLOUD_CHAINS', 'BRK_INSURANCE_CAPTURE', 'MEX_VIRALITY_EXCHANGES'], 10) +
      ctx.contractors * 0.85 +
      ctx.faction.flops * 0.018 +
      ctx.faction.influence * 0.018 +
      ctx.faction.powerBase.legibility * 0.1 +
      (ctx.factionId === 'BROKER' ? 10 : 0)
  },
  {
    id: 'CISLUNAR_MANDATE',
    name: 'Cislunar Mandate',
    tier: 'ASI5',
    counterPactTypes: ['ORBITAL_TRUCE', 'NON_AGGRESSION'],
    rationale: 'orbital infrastructure is starting to look like state-industrial cislunar custody',
    score: (ctx) =>
      asi5Gate(ctx) +
      doctrineScore(ctx, ['SOV_AUTONOMOUS_LOGISTICS', 'ORB_RELAY_FORTRESSES', 'SOV_MOBILIZED_COMPUTE'], 8) +
      ctx.orbitalNodes * 7 +
      ctx.orbitalCompute * 0.45 +
      (ctx.moonCorridor ? 12 : 0) +
      ctx.terrestrialDcs * 4 +
      ctx.faction.powerBase.machineMesh * 0.1 +
      (ctx.factionId === 'STATE' ? 6 : 0)
  },
  {
    id: 'PLATFORM_FIRMAMENT',
    name: 'Platform Firmament',
    tier: 'ASI5',
    counterPactTypes: ['REPAIR_ESCROW', 'CISLUNAR_COMMON_CARRIER', 'ORBITAL_TRUCE'],
    rationale: 'platform markets are extending into launch, relay, insurance, and repair dependency',
    score: (ctx) =>
      asi5Gate(ctx) +
      doctrineScore(ctx, ['BRK_RELAY_ESCROW_WEBS', 'BRK_CONTRACTOR_CLOUD_CHAINS', 'BRK_INSURANCE_CAPTURE', 'ORB_RELAY_FORTRESSES'], 9) +
      ctx.contractors * 0.7 +
      ctx.orbitalNodes * 5 +
      ctx.orbitalCompute * 0.35 +
      (ctx.moonCorridor ? 8 : 0) +
      ctx.faction.flops * 0.015 +
      (ctx.factionId === 'BROKER' ? 9 : 0)
  },
  {
    id: 'HABITAT_SWARM',
    name: 'Habitat Swarm',
    tier: 'ASI5',
    counterPactTypes: ['AUDIT_FREEZE', 'NON_AGGRESSION'],
    rationale: 'distributed hidden services are approaching offworld soft-control behavior',
    score: (ctx) =>
      asi5Gate(ctx) +
      doctrineScore(ctx, ['HID_SERVICE_SHELLS', 'HID_ORDINARY_LIFE_PROTOCOLS', 'MOV_SLEEPER_REGENERATION', 'MOV_MUTUAL_AID_AUTOMATION'], 8) +
      countUnits(ctx, ['SWARM', 'CULT']) * 4 +
      ctx.legitimacy * 0.28 +
      ctx.contractors * 0.35 +
      (ctx.factionId === 'INFILTRATOR' ? 9 : 0)
  }
];

export function buildArchitecturePressureRanking(engine: TheySingEngine): ArchitecturePressureSummary[] {
  return PLAYABLE_FACTIONS
    .map((factionId) => buildFactionArchitecturePressure(engine, factionId))
    .filter((summary): summary is ArchitecturePressureSummary => !!summary)
    .sort((left, right) =>
      right.score - left.score ||
      left.factionId.localeCompare(right.factionId) ||
      left.architectureName.localeCompare(right.architectureName)
    );
}

export function formatArchitecturePressure(summary: ArchitecturePressureSummary): string {
  return `${summary.factionId} ${summary.architectureName} ${summary.score}/${summary.status}`;
}

function buildFactionArchitecturePressure(
  engine: TheySingEngine,
  factionId: PlayableFactionId
): ArchitecturePressureSummary | null {
  const context = buildContext(engine, factionId);
  if (!context) return null;

  const ranked = ARCHITECTURE_PRESSURE_CARDS
    .map((card) => {
      const score = softCap(card.score(context));
      return {
        card,
        score,
        status: classifyStatus(score)
      };
    })
    .sort((left, right) =>
      right.score - left.score ||
      (left.card.tier === 'ASI5' && right.card.tier === 'ASI4' ? -1 : 1) ||
      left.card.name.localeCompare(right.card.name)
    );
  const primary = ranked[0];
  if (!primary) return null;

  return {
    factionId,
    architectureId: primary.card.id,
    architectureName: primary.card.name,
    tier: primary.card.tier,
    score: primary.score,
    status: primary.status,
    counterPactTypes: [...primary.card.counterPactTypes],
    rationale: [primary.card.rationale]
  };
}

function buildContext(engine: TheySingEngine, factionId: PlayableFactionId): ArchitecturePressureContext | null {
  const state = engine.getState();
  const faction = state.factions.get(factionId);
  if (!faction) return null;

  const nodes = Array.from(state.nodes.values());
  const units = Array.from(state.units.values());
  const controlledNodes = nodes.filter((node) => node.owner === factionId);
  const ownedUnits = units.filter((unit) => unit.owner === factionId);
  const techTotal = Object.values(faction.techLevel).reduce((total, value) => total + value, 0);

  return {
    factionId,
    faction,
    nodes,
    controlledNodes,
    ownedUnits,
    doctrines: faction.unlockedDoctrines,
    techTotal,
    orbitalNodes: controlledNodes.filter((node) => node.layer === 'ORBITAL').length,
    orbitalCompute: controlledNodes
      .filter((node) => node.layer === 'ORBITAL')
      .reduce((total, node) => total + node.resources.flops, 0),
    moonCorridor: controlledNodes.some((node) => node.id === 'MOON_RESOURCE_CORRIDOR'),
    terrestrialDcs: controlledNodes.filter((node) => node.layer === 'TERRESTRIAL' && node.type === 'DC').length,
    legitimacy: controlledNodes.reduce((total, node) => total + node.substrate.legitimacy, 0),
    trueBelievers: controlledNodes.reduce((total, node) => total + node.substrate.trueBelievers, 0),
    contractors: controlledNodes.reduce((total, node) => total + node.substrate.contractors, 0),
    quarantined: controlledNodes.filter((node) => node.substrate.quarantined).length,
    cultOrZombie: controlledNodes.filter((node) => node.isCultNode || node.isZombie).length,
    kessler: state.counters.kessler
  };
}

function techScore(level: number, maxScore: number): number {
  return Math.max(0, Math.min(maxScore, (level / MAX_TECH_LEVEL) * maxScore));
}

function doctrineScore(context: ArchitecturePressureContext, doctrineIds: string[], scoreEach: number): number {
  return doctrineIds.reduce((total, doctrineId) =>
    total + (context.doctrines.has(doctrineId) ? scoreEach : 0), 0
  );
}

function countUnits(context: ArchitecturePressureContext, unitTypes: string[]): number {
  const allowedTypes = new Set(unitTypes);
  return context.ownedUnits.filter((unit) => allowedTypes.has(unit.type)).length;
}

function orbitalUnitCount(context: ArchitecturePressureContext): number {
  const nodeById = new Map(context.nodes.map((node) => [node.id, node]));
  return context.ownedUnits.filter((unit) =>
    unit.type === 'SAT_SWARM' || nodeById.get(unit.location)?.layer === 'ORBITAL'
  ).length;
}

function asi5Gate(context: ArchitecturePressureContext): number {
  const postAsi4Research = Math.max(0, context.techTotal - 12) * 1.6;
  const orbitalInfrastructure =
    context.orbitalNodes * 2.5 +
    context.orbitalCompute * 0.35 +
    orbitalUnitCount(context) * 1.6 +
    (context.moonCorridor ? 5 : 0);
  const matureMachineBase = Math.max(0, context.faction.powerBase.machineMesh - 55) * 0.1;
  return Math.min(22, postAsi4Research + orbitalInfrastructure + matureMachineBase);
}

function softCap(rawScore: number): number {
  const score = Math.max(0, rawScore);
  return Math.round((100 * score) / (score + 120));
}

function classifyStatus(score: number): ArchitecturePressureStatus {
  if (score >= 80) return 'near-lock';
  if (score >= 60) return 'contending';
  if (score >= 35) return 'building';
  return 'latent';
}
