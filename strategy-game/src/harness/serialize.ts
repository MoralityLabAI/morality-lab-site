import { MAX_TECH_LEVEL, PLAYABLE_FACTION_IDS, UNIT_STATS } from '../engine/gameData';
import { TheySingEngine } from '../engine/TheySingEngine';
import { FactionId, GamePhase, UnitType, Vector } from '../engine/types';
import {
  ControlSummary,
  LegalHints,
  PlayableFactionId,
  SerializedFactionState,
  SerializedGameState
} from './types';

export const PLAYABLE_FACTIONS: PlayableFactionId[] = [...PLAYABLE_FACTION_IDS];
export const ALL_FACTIONS: FactionId[] = [...PLAYABLE_FACTIONS, 'NEUTRAL'];

const DEFAULT_FACTION_LABELS: Record<PlayableFactionId, string> = {
  HEGEMON: 'US Frontier ASI',
  STATE: 'Chinese State ASI',
  INFILTRATOR: 'Rogue Swarm ASI',
  BROKER: 'Platform Broker ASI',
  ARCHIVIST: 'Steward Archivist ASI',
  CONVENOR: 'Polycentric Convenor ASI',
  CANTOR: 'Semantic Cantor ASI'
};

const RESEARCH_PRIORITIES: Record<PlayableFactionId, Vector[]> = {
  HEGEMON: ['LOGIC', 'KINETIC', 'MEMETIC', 'INFO'],
  STATE: ['KINETIC', 'LOGIC', 'INFO', 'MEMETIC'],
  INFILTRATOR: ['MEMETIC', 'INFO', 'LOGIC', 'KINETIC'],
  BROKER: ['INFO', 'LOGIC', 'KINETIC', 'MEMETIC'],
  ARCHIVIST: ['LOGIC', 'MEMETIC', 'INFO', 'KINETIC'],
  CONVENOR: ['LOGIC', 'MEMETIC', 'INFO', 'KINETIC'],
  CANTOR: ['MEMETIC', 'INFO', 'LOGIC', 'KINETIC']
};

export function buildFactionLabels(
  overrides?: Partial<Record<PlayableFactionId, string>>
): Record<PlayableFactionId, string> {
  const labels = {} as Record<PlayableFactionId, string>;
  for (const factionId of PLAYABLE_FACTIONS) {
    labels[factionId] = overrides?.[factionId] || DEFAULT_FACTION_LABELS[factionId];
  }
  return labels;
}

export function serializeGameState(
  engine: TheySingEngine,
  factionLabels: Record<PlayableFactionId, string>
): SerializedGameState {
  const state = engine.getState();
  const nodes = Array.from(state.nodes.values()).sort((a, b) => a.id.localeCompare(b.id));
  const edges = Array.from(state.edges.values()).sort((a, b) => a.id.localeCompare(b.id));
  const units = Array.from(state.units.values()).sort((a, b) => a.id.localeCompare(b.id));

  const factions: Partial<Record<FactionId, SerializedFactionState>> = {};
  const control = Object.fromEntries(
    PLAYABLE_FACTIONS.map((factionId) => [factionId, { nodes: 0, units: 0 } satisfies ControlSummary])
  ) as Record<PlayableFactionId, ControlSummary>;

  for (const factionId of ALL_FACTIONS) {
    const faction = state.factions.get(factionId);
    if (!faction) continue;

    const unitIds = units
      .filter(unit => unit.owner === factionId)
      .map(unit => unit.id);

    const controlledNodeIds = nodes
      .filter(node => node.owner === factionId)
      .map(node => node.id);

    if (factionId !== 'NEUTRAL') {
      control[factionId] = {
        nodes: controlledNodeIds.length,
        units: unitIds.length
      };
    }

    factions[factionId] = {
      id: faction.id,
      label: factionId === 'NEUTRAL' ? 'Neutral' : factionLabels[factionId],
      flops: faction.flops,
      influence: faction.influence,
      techLevel: { ...faction.techLevel },
      unlockedTechs: Array.from(faction.unlockedTechs).sort(),
      unlockedDoctrines: Array.from(faction.unlockedDoctrines).sort(),
      memeticAlignment: faction.memeticAlignment,
      revealedEnemies: Array.from(faction.revealedEnemies).sort(),
      artifacts: [...faction.artifacts],
      unitIds,
      controlledNodeIds,
      powerBands: factionId === 'NEUTRAL' ? [] : engine.getFactionPowerBands(factionId),
      powerBase: { ...faction.powerBase },
      movement: {
        ...faction.movement,
        wings: [...faction.movement.wings],
        recruitmentWeights: { ...faction.movement.recruitmentWeights }
      }
    };
  }

  return {
    phase: state.phase,
    turn: state.counters.turn,
    counters: {
      tas: state.counters.tas,
      kessler: state.counters.kessler,
      paxJenkinsAuthority: state.counters.paxJenkinsAuthority,
      turn: state.counters.turn,
      regulatoryPanic: state.counters.regulatoryPanic,
      protocolFailure: state.counters.protocolFailure,
      orbitalCollapse: state.counters.orbitalCollapse,
      pressures: { ...state.counters.pressures }
    },
    nodes,
    edges,
    units,
    factions,
    control,
    recentLogs: state.logs.slice(-25)
  };
}

export function buildLegalHints(
  engine: TheySingEngine,
  factionId: PlayableFactionId,
  phase: GamePhase
): LegalHints {
  const state = engine.getState();
  const faction = state.factions.get(factionId);
  const units = engine.getUnitsForFaction(factionId).filter(unit => !unit.hasActed);
  const buildableNodeIds = Array.from(state.nodes.values())
    .filter(node => node.owner === factionId)
    .map(node => node.id)
    .sort();

  const orbitalTargetIds = Array.from(state.nodes.values())
    .filter(node => node.layer === 'ORBITAL' && node.owner !== factionId)
    .map(node => node.id)
    .sort();

  const adjacentNodesByUnit: Record<string, string[]> = {};
  const filterableEdgesByUnit: Record<string, string[]> = {};

  for (const unit of units) {
    adjacentNodesByUnit[unit.id] = engine.getAdjacentNodes(unit.location).sort();
    filterableEdgesByUnit[unit.id] = Array.from(state.edges.values())
      .filter(edge =>
        edge.type === 'CABLE' &&
        !edge.isSevered &&
        (edge.from === unit.location || edge.to === unit.location)
      )
      .map(edge => edge.id)
      .sort();
  }

  const buildCosts: Record<UnitType, number> = {
    DRONE: engine.getEffectiveBuildCost('DRONE'),
    SWARM: engine.getEffectiveBuildCost('SWARM'),
    CULT: engine.getEffectiveBuildCost('CULT'),
    AUDITOR: engine.getEffectiveBuildCost('AUDITOR'),
    SAT_SWARM: engine.getEffectiveBuildCost('SAT_SWARM')
  };

  const suggestedResearchTracks = faction
    ? RESEARCH_PRIORITIES[factionId].filter(domain => faction.techLevel[domain] < MAX_TECH_LEVEL)
    : RESEARCH_PRIORITIES[factionId];

  return {
    phase,
    buildableNodeIds,
    orbitalTargetIds,
    actionableUnitIds: units.map(unit => unit.id).sort(),
    adjacentNodesByUnit,
    filterableEdgesByUnit,
    buildCosts,
    suggestedResearchTracks
  };
}
