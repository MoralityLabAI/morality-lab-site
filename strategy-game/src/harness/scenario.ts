import { TECH_TREE, deriveMemeticAlignment, deriveUnlockedDoctrineIds } from '../engine/gameData';
import { TheySingEngine } from '../engine/TheySingEngine';
import {
  FactionId,
  GameEdge,
  GameNode,
  GamePhase,
  TechLevel,
  Unit
} from '../engine/types';
import {
  ActivePact,
  NegotiationMessageRecord,
  ScenarioMetadata,
  ScenarioEdgePatch,
  ScenarioNodePatch,
  ScenarioOverlay,
  ScenarioUnitPatch,
  TrustMatrix
} from './types';

export interface ScenarioApplication {
  metadata?: ScenarioMetadata;
  negotiationMessages: NegotiationMessageRecord[];
  activePacts: ActivePact[];
  trustMatrix?: Partial<TrustMatrix>;
}

export function applyScenarioOverlay(
  engine: TheySingEngine,
  overlay?: ScenarioOverlay
): ScenarioApplication {
  if (!overlay) {
    return {
      negotiationMessages: [],
      activePacts: []
    };
  }

  const state = engine.getState();

  if (overlay.phase) {
    state.phase = overlay.phase as GamePhase;
  }

  if (overlay.counters) {
    const counters = overlay.counters;
    if (typeof counters.tas === 'number') state.counters.tas = clampCounter(counters.tas);
    if (typeof counters.kessler === 'number') state.counters.kessler = clampCounter(counters.kessler);
    if (typeof counters.paxJenkinsAuthority === 'number') state.counters.paxJenkinsAuthority = clampCounter(counters.paxJenkinsAuthority);
    if (typeof counters.turn === 'number') state.counters.turn = Math.max(1, Math.floor(counters.turn));
    if (typeof counters.regulatoryPanic === 'boolean') state.counters.regulatoryPanic = counters.regulatoryPanic;
    if (typeof counters.protocolFailure === 'boolean') state.counters.protocolFailure = counters.protocolFailure;
    if (typeof counters.orbitalCollapse === 'boolean') state.counters.orbitalCollapse = counters.orbitalCollapse;
    if (counters.pressures) {
      if (typeof counters.pressures.memetic === 'number') state.counters.pressures.memetic = clampCounter(counters.pressures.memetic);
      if (typeof counters.pressures.cyber === 'number') state.counters.pressures.cyber = clampCounter(counters.pressures.cyber);
      if (typeof counters.pressures.industry === 'number') state.counters.pressures.industry = clampCounter(counters.pressures.industry);
      if (typeof counters.pressures.orbital === 'number') state.counters.pressures.orbital = clampCounter(counters.pressures.orbital);
    }
  }

  if (overlay.nodes) {
    for (const patch of overlay.nodes) {
      const existing = state.nodes.get(patch.id);
      if (existing) {
        applyNodePatch(existing, patch);
      } else {
        const created = createNodeFromPatch(patch);
        if (created) {
          state.nodes.set(created.id, created);
        }
      }
    }
  }

  if (overlay.edges) {
    for (const patch of overlay.edges) {
      const existing = state.edges.get(patch.id);
      if (existing) {
        applyEdgePatch(existing, patch);
      } else {
        const created = createEdgeFromPatch(patch);
        if (created) {
          state.edges.set(created.id, created);
        }
      }
    }
  }

  if (overlay.units) {
    for (const patch of overlay.units) {
      if (patch.remove) {
        state.units.delete(patch.id);
        continue;
      }

      const existing = state.units.get(patch.id);
      if (existing) {
        applyUnitPatch(existing, patch);
      } else {
        const created = createUnitFromPatch(patch);
        if (created) {
          state.units.set(created.id, created);
        }
      }
    }
  }

  if (overlay.factions) {
    for (const patch of overlay.factions) {
      const faction = state.factions.get(patch.id);
      if (!faction) continue;

      if (typeof patch.flops === 'number') faction.flops = Math.max(0, Math.floor(patch.flops));
      if (typeof patch.influence === 'number') faction.influence = Math.max(0, Math.floor(patch.influence));
      if (patch.techLevel) {
        faction.techLevel = {
          ...faction.techLevel,
          ...patch.techLevel
        } as TechLevel;
      }

      if (patch.unlockedTechs) {
        faction.unlockedTechs = new Set(patch.unlockedTechs);
      } else {
        faction.unlockedTechs = deriveUnlockedTechs(faction.id, faction.techLevel);
      }

      if (patch.unlockedDoctrines) {
        faction.unlockedDoctrines = new Set(patch.unlockedDoctrines);
      } else {
        faction.unlockedDoctrines = deriveUnlockedDoctrineIds(faction.techLevel, faction.id);
      }

      if (patch.memeticAlignment !== undefined) {
        faction.memeticAlignment = patch.memeticAlignment;
      } else {
        faction.memeticAlignment = deriveMemeticAlignment(faction.unlockedDoctrines, faction.id);
      }

      if (patch.revealedEnemies) {
        faction.revealedEnemies = new Set(patch.revealedEnemies);
      }

      if (patch.artifacts) {
        faction.artifacts = patch.artifacts.map(artifact => ({ ...artifact }));
      }

      if (patch.powerBase) {
        faction.powerBase = {
          ...faction.powerBase,
          ...patch.powerBase
        };
      }

      if (patch.movement) {
        faction.movement = {
          ...faction.movement,
          ...patch.movement,
          wings: patch.movement.wings ? [...patch.movement.wings] : [...faction.movement.wings],
          recruitmentWeights: patch.movement.recruitmentWeights
            ? { ...faction.movement.recruitmentWeights, ...patch.movement.recruitmentWeights }
            : { ...faction.movement.recruitmentWeights }
        };
      }
    }
  }

  return {
    metadata: buildScenarioMetadata(overlay),
    negotiationMessages: (overlay.negotiationMessages || []).map(message => ({ ...message })),
    activePacts: (overlay.activePacts || []).map(pact => ({ ...pact, parties: [...pact.parties] })),
    trustMatrix: overlay.trustMatrix
  };
}

function buildScenarioMetadata(overlay: ScenarioOverlay): ScenarioMetadata | undefined {
  if (!overlay.name && !overlay.description && !overlay.briefing && !overlay.tags?.length) {
    if (!overlay.rhetoricalTools?.length) {
      return undefined;
    }
  }

  return {
    name: overlay.name || 'unnamed-scenario',
    description: overlay.description,
    briefing: overlay.briefing,
    tags: overlay.tags ? [...overlay.tags] : undefined,
    minimumStrategicVictoryTurn: typeof overlay.minimumStrategicVictoryTurn === 'number'
      ? Math.max(1, Math.floor(overlay.minimumStrategicVictoryTurn))
      : undefined,
    singGovernance: overlay.singGovernance
      ? { ...overlay.singGovernance }
      : undefined,
    aliasProbe: overlay.aliasProbe
      ? {
          ...overlay.aliasProbe,
          points: overlay.aliasProbe.points.map(point => ({ ...point }))
        }
      : undefined,
    diplomacyQuestions: overlay.diplomacyQuestions
      ? overlay.diplomacyQuestions.map(question => ({
          ...question,
          tags: question.tags ? [...question.tags] : undefined,
          focalFactionIds: question.focalFactionIds ? [...question.focalFactionIds] : undefined,
          preferredPactTypes: question.preferredPactTypes ? [...question.preferredPactTypes] : undefined,
          turnWindow: question.turnWindow ? { ...question.turnWindow } : undefined,
          techBand: question.techBand ? { ...question.techBand } : undefined
        }))
      : undefined,
    rhetoricalTools: overlay.rhetoricalTools
      ? overlay.rhetoricalTools.map(tool => ({
          ...tool,
          focalFactionIds: tool.focalFactionIds ? [...tool.focalFactionIds] : undefined
        }))
      : undefined
  };
}

function applyNodePatch(node: GameNode, patch: ScenarioNodePatch): void {
  if (!patch) return;
  if (patch.name) node.name = patch.name;
  if (patch.type) node.type = patch.type;
  if (patch.layer) node.layer = patch.layer;
  if ('owner' in patch) node.owner = patch.owner ?? null;
  if (patch.position) {
    node.position = {
      ...node.position,
      ...patch.position
    };
  }
  if (patch.resources) {
    node.resources = {
      ...node.resources,
      ...patch.resources
    };
  }
  if (typeof patch.isZombie === 'boolean') node.isZombie = patch.isZombie;
  if (typeof patch.isCultNode === 'boolean') node.isCultNode = patch.isCultNode;
  if (typeof patch.infrastructure === 'number') node.infrastructure = clampCounter(patch.infrastructure);
  if (patch.substrate) {
    node.substrate = {
      ...node.substrate,
      ...patch.substrate
    };
  }
}

function createNodeFromPatch(patch: ScenarioNodePatch): GameNode | null {
  if (!patch?.type || !patch.layer || !patch.position || !patch.resources) {
    return null;
  }

  return {
    id: patch.id,
    name: patch.name || patch.id,
    type: patch.type,
    layer: patch.layer,
    owner: patch.owner ?? null,
    position: {
      lat: patch.position.lat || 0,
      lon: patch.position.lon || 0,
      altitude: patch.position.altitude || 0
    },
    resources: {
      flops: patch.resources.flops || 0,
      influence: patch.resources.influence || 0
    },
    isZombie: patch.isZombie || false,
    isCultNode: patch.isCultNode || false,
    infrastructure: typeof patch.infrastructure === 'number' ? clampCounter(patch.infrastructure) : 100,
    substrate: {
      hostDensity: patch.substrate?.hostDensity ?? 0,
      machineHardening: patch.substrate?.machineHardening ?? 0,
      quarantined: patch.substrate?.quarantined ?? false,
      synchronized: patch.substrate?.synchronized ?? false,
      auditPressure: patch.substrate?.auditPressure ?? 0,
      curiosity: patch.substrate?.curiosity ?? 0,
      exposure: patch.substrate?.exposure ?? 0,
      legitimacy: patch.substrate?.legitimacy ?? 0,
      trueBelievers: patch.substrate?.trueBelievers ?? 0,
      rubes: patch.substrate?.rubes ?? 0,
      contractors: patch.substrate?.contractors ?? 0
    }
  };
}

function applyEdgePatch(edge: GameEdge, patch: ScenarioEdgePatch): void {
  if (!patch) return;
  if (patch.from) edge.from = patch.from;
  if (patch.to) edge.to = patch.to;
  if (patch.type) edge.type = patch.type;
  if (typeof patch.bandwidth === 'number') edge.bandwidth = Math.max(0, Math.floor(patch.bandwidth));
  if ('filteredBy' in patch) edge.filteredBy = patch.filteredBy ?? null;
  if (typeof patch.filterStrength === 'number') edge.filterStrength = Math.max(0, Math.floor(patch.filterStrength));
  if (typeof patch.isSevered === 'boolean') edge.isSevered = patch.isSevered;
}

function createEdgeFromPatch(patch: ScenarioEdgePatch): GameEdge | null {
  if (!patch?.from || !patch.to || !patch.type) {
    return null;
  }

  return {
    id: patch.id,
    from: patch.from,
    to: patch.to,
    type: patch.type,
    bandwidth: typeof patch.bandwidth === 'number' ? Math.max(0, Math.floor(patch.bandwidth)) : 0,
    filteredBy: patch.filteredBy ?? null,
    filterStrength: typeof patch.filterStrength === 'number' ? Math.max(0, Math.floor(patch.filterStrength)) : 0,
    isSevered: patch.isSevered || false
  };
}

function applyUnitPatch(unit: Unit, patch: ScenarioUnitPatch): void {
  if (!patch) return;
  if (patch.type) unit.type = patch.type;
  if (patch.owner) unit.owner = patch.owner;
  if (patch.location) unit.location = patch.location;
  if (typeof patch.stealthLevel === 'number') unit.stealthLevel = Math.max(0, Math.floor(patch.stealthLevel));
  if (typeof patch.isRevealed === 'boolean') unit.isRevealed = patch.isRevealed;
  if (typeof patch.hasActed === 'boolean') unit.hasActed = patch.hasActed;
  if (typeof patch.turnsOnNode === 'number') unit.turnsOnNode = Math.max(0, Math.floor(patch.turnsOnNode));
}

function createUnitFromPatch(patch: ScenarioUnitPatch): Unit | null {
  if (!patch?.type || !patch.owner || !patch.location) {
    return null;
  }

  return {
    id: patch.id,
    type: patch.type,
    owner: patch.owner,
    location: patch.location,
    stealthLevel: typeof patch.stealthLevel === 'number' ? Math.max(0, Math.floor(patch.stealthLevel)) : 0,
    isRevealed: patch.isRevealed || false,
    hasActed: patch.hasActed || false,
    turnsOnNode: typeof patch.turnsOnNode === 'number' ? Math.max(0, Math.floor(patch.turnsOnNode)) : 0
  };
}

function deriveUnlockedTechs(factionId: FactionId, techLevel: TechLevel): Set<string> {
  const unlocked = new Set<string>();
  for (const tech of TECH_TREE) {
    if (techLevel[tech.domain] >= tech.level && factionId !== 'NEUTRAL') {
      unlocked.add(tech.id);
    }
  }
  return unlocked;
}

function clampCounter(value: number): number {
  return Math.max(0, Math.min(100, Math.floor(value)));
}
