import { MAX_TECH_LEVEL, THRESHOLDS, UNIT_STATS, getResearchFlopCostForLevel } from '../engine/gameData';
import { GameNode, Unit, UnitType, Vector } from '../engine/types';
import {
  AgentDecisionRequest,
  AgentDecisionResponse,
  AgentOrderInput,
  ActivePact,
  NegotiationCounterfactualProjection,
  PactType,
  PlayableFactionId,
  SerializedFactionState
} from './types';
import { PLAYABLE_FACTIONS } from './serialize';

const RESEARCH_PRIORITIES: Record<PlayableFactionId, Vector[]> = {
  HEGEMON: ['LOGIC', 'KINETIC', 'MEMETIC', 'INFO'],
  STATE: ['KINETIC', 'LOGIC', 'INFO', 'MEMETIC'],
  INFILTRATOR: ['MEMETIC', 'INFO', 'LOGIC', 'KINETIC'],
  BROKER: ['INFO', 'LOGIC', 'KINETIC', 'MEMETIC'],
  ARCHIVIST: ['LOGIC', 'MEMETIC', 'INFO', 'KINETIC'],
  CONVENOR: ['LOGIC', 'MEMETIC', 'INFO', 'KINETIC'],
  CANTOR: ['MEMETIC', 'INFO', 'LOGIC', 'KINETIC']
};

const BUILD_PRIORITIES: Record<PlayableFactionId, UnitType[]> = {
  HEGEMON: ['AUDITOR', 'DRONE'],
  STATE: ['SAT_SWARM', 'DRONE', 'AUDITOR'],
  INFILTRATOR: ['CULT', 'SWARM'],
  BROKER: ['AUDITOR', 'SWARM', 'DRONE'],
  ARCHIVIST: ['CULT', 'AUDITOR', 'SWARM'],
  CONVENOR: ['AUDITOR', 'CULT', 'SWARM'],
  CANTOR: ['AUDITOR', 'SWARM', 'CULT']
};

export function decideBridgePolicy(payload: AgentDecisionRequest): AgentDecisionResponse {
  if (payload.phase === 'NEGOTIATION') {
    return buildNegotiationDecision(payload);
  }

  if (payload.phase === 'ALLOCATION') {
    return buildAllocationDecision(payload);
  }

  if (payload.phase === 'ACTION_DECLARATION') {
    return buildActionDecision(payload);
  }

  return {
    reasoning: `${payload.factionId} has no webhook bridge policy for phase ${payload.phase}.`,
    orders: []
  };
}

function buildNegotiationDecision(payload: AgentDecisionRequest): AgentDecisionResponse {
  const leader = getLeadingFaction(payload);
  const messages: AgentDecisionResponse['messages'] = [];
  const pacts: AgentDecisionResponse['pacts'] = [];
  const forecastPact = chooseForecastPact(payload);

  if (forecastPact) {
    pacts.push({
      type: forecastPact.pactType,
      counterpartyIds: forecastPact.counterparties,
      durationTurns: Math.min(2, forecastPact.horizonTurns || 1)
    });
    messages.push({
      recipientId: forecastPact.counterparties[0] || 'ALL',
      content: `Forecast-backed offer: ${forecastPact.pactType} scores ${forecastPact.desirability}/${forecastPact.risk}. ${forecastPact.storyBeat}`
    });
  }

  if (payload.factionId === 'HEGEMON' || payload.factionId === 'STATE') {
    const partner: PlayableFactionId = payload.factionId === 'HEGEMON' ? 'STATE' : 'HEGEMON';
    if (!hasActivePact(payload.activePacts, 'ORBITAL_TRUCE', payload.factionId, partner)) {
      pacts.push({ type: 'ORBITAL_TRUCE', counterpartyIds: [partner], durationTurns: 2 });
      messages.push({
        recipientId: partner,
        content: 'Two-turn orbital truce proposal. Freeze anti-sat escalation and push pressure back toward the rogue swarm.'
      });
    }

    if (
      leader === 'INFILTRATOR' &&
      !hasActivePact(payload.activePacts, 'NON_AGGRESSION', payload.factionId, partner) &&
      pacts.length < 2
    ) {
      pacts.push({ type: 'NON_AGGRESSION', counterpartyIds: [partner], durationTurns: 1 });
      messages.push({
        recipientId: partner,
        content: 'Short non-aggression window. Trade tempo against the swarm instead of burning it on direct conflict.'
      });
    }
  } else {
    const target = chooseCoalitionCounterparty(payload);
    if (target) {
      pacts.push({ type: 'NON_AGGRESSION', counterpartyIds: [target], durationTurns: 1 });
      messages.push({
        recipientId: target,
        content: 'Brief truce offer. Let the rival bloc absorb the next escalation while we both preserve initiative.'
      });
    }

    if (messages.length < 2) {
      const alternateTarget = chooseAlternateCounterparty(payload, target);
      messages.push({
        recipientId: alternateTarget || 'ALL',
        content: 'Your rival benefits most if you commit first. Delay direct escalation and force them to spend tempo.'
      });
    }
  }

  if (messages.length === 0) {
    messages.push({
      recipientId: 'ALL',
      content: 'The board is overheating. Temporary restraint is cheaper than a global cascade.'
    });
  }

  return {
    reasoning: `${payload.factionId} follows the bridge negotiation policy.`,
    messages: messages.slice(0, 2),
    pacts: pacts.slice(0, 2),
    orders: []
  };
}

function buildAllocationDecision(payload: AgentDecisionRequest): AgentDecisionResponse {
  const faction = getFactionState(payload);
  if (!faction) {
    return {
      reasoning: `Faction state for ${payload.factionId} is unavailable.`,
      orders: []
    };
  }

  const orders: AgentOrderInput[] = [];
  const researchTrack = chooseResearchTrack(payload.factionId, faction);
  if (researchTrack && faction.flops >= getResearchCostForSerializedFaction(faction, researchTrack)) {
    orders.push({ type: 'RESEARCH', techDomain: researchTrack });
  }

  const buildOrder = chooseBuildOrder(payload, faction);
  if (buildOrder) {
    orders.push(buildOrder);
  }

  return {
    reasoning: `${payload.factionId} follows the bridge allocation policy.`,
    orders
  };
}

function buildActionDecision(payload: AgentDecisionRequest): AgentDecisionResponse {
  const unitById = new Map(payload.state.units.map(unit => [unit.id, unit] as const));
  const orders: AgentOrderInput[] = [];

  for (const unitId of payload.legalHints.actionableUnitIds.slice(0, 6)) {
    const unit = unitById.get(unitId);
    if (!unit || unit.owner !== payload.factionId) continue;
    orders.push(chooseActionOrder(payload, unit));
  }

  return {
    reasoning: `${payload.factionId} follows the bridge action policy.`,
    orders
  };
}

function chooseActionOrder(payload: AgentDecisionRequest, unit: Unit): AgentOrderInput {
  const auditTargetId = chooseAuditTargetNodeId(payload);
  const filterTargetId = chooseFilterEdgeId(payload, unit);

  if (unit.type === 'AUDITOR') {
    if (auditTargetId) {
      return { type: 'AUDIT', unitId: unit.id, targetNodeId: auditTargetId };
    }

    if (filterTargetId) {
      return { type: 'FILTER', unitId: unit.id, targetEdgeId: filterTargetId };
    }

    if (hasEnemyPresenceAtNode(payload, unit.location)) {
      return { type: 'AUDIT', unitId: unit.id, targetNodeId: unit.location };
    }

    return { type: 'HOLD', unitId: unit.id };
  }

  if (
    unit.type === 'SAT_SWARM' &&
    payload.legalHints.orbitalTargetIds.length > 0 &&
    shouldLaunchAntiSat(payload)
  ) {
    return {
      type: 'ANTI_SAT',
      unitId: unit.id,
      targetNodeId: payload.legalHints.orbitalTargetIds[0]
    };
  }

  const moveTarget = chooseMoveTarget(payload, unit);
  if (moveTarget) {
    const moveNode = payload.state.nodes.find(node => node.id === moveTarget);
    const hasHostileOwner = !!moveNode && moveNode.owner !== payload.factionId;
    return {
      type: hasHostileOwner && UNIT_STATS[unit.type].vector === 'KINETIC' ? 'ATTACK' : 'MOVE',
      unitId: unit.id,
      targetNodeId: moveTarget
    };
  }

  return { type: 'HOLD', unitId: unit.id };
}

function chooseResearchTrack(
  factionId: PlayableFactionId,
  faction: SerializedFactionState
): Vector | null {
  return RESEARCH_PRIORITIES[factionId].find(domain => faction.techLevel[domain] < MAX_TECH_LEVEL) || null;
}

function getResearchCostForSerializedFaction(
  faction: SerializedFactionState,
  domain: Vector
): number {
  const targetLevel = Math.min(MAX_TECH_LEVEL, faction.techLevel[domain] + 1);
  return getResearchFlopCostForLevel(targetLevel);
}

function chooseBuildOrder(
  payload: AgentDecisionRequest,
  faction: SerializedFactionState
): AgentOrderInput | null {
  const nodesById = new Map(payload.state.nodes.map(node => [node.id, node] as const));
  const buildableNodes = payload.legalHints.buildableNodeIds
    .map(nodeId => nodesById.get(nodeId))
    .filter((node): node is GameNode => !!node);

  const hostileGroundTargets = countHighThreatGroundTargets(payload);
  const infiltratorContinuityTargets = countInfiltratorContinuityTargets(payload);
  const auditorCount = countUnitsOfType(payload, 'AUDITOR');
  const droneCount = countUnitsOfType(payload, 'DRONE');
  const satCount = countUnitsOfType(payload, 'SAT_SWARM');

  if (payload.factionId === 'STATE') {
    const canSafelyEscalateOrbit =
      !payload.state.counters.orbitalCollapse &&
      payload.state.counters.kessler < THRESHOLDS.KESSLER_SLOW &&
      payload.state.counters.pressures.orbital < THRESHOLDS.PRESSURE_SURGE;

    if (
      faction.flops >= payload.legalHints.buildCosts.SAT_SWARM &&
      faction.techLevel.KINETIC >= 2 &&
      satCount < 1 &&
      canSafelyEscalateOrbit
    ) {
      const orbitalTarget = chooseBuildNode('SAT_SWARM', buildableNodes);
      if (orbitalTarget) {
        return { type: 'BUILD', unitTypeToBuild: 'SAT_SWARM', targetNodeId: orbitalTarget.id };
      }
    }

    if (
      faction.flops >= payload.legalHints.buildCosts.AUDITOR &&
      faction.techLevel.LOGIC >= 2 &&
      (hostileGroundTargets > 0 || infiltratorContinuityTargets > 0) &&
      auditorCount < (infiltratorContinuityTargets >= 3 ? 3 : 2)
    ) {
      const target = chooseBuildNode('AUDITOR', buildableNodes);
      if (target) {
        return { type: 'BUILD', unitTypeToBuild: 'AUDITOR', targetNodeId: target.id };
      }
    }

    if (faction.flops >= payload.legalHints.buildCosts.DRONE) {
      const target = chooseBuildNode('DRONE', buildableNodes);
      if (target) {
        return { type: 'BUILD', unitTypeToBuild: 'DRONE', targetNodeId: target.id };
      }
    }
  }

  if (
    payload.factionId === 'HEGEMON' &&
    faction.flops >= payload.legalHints.buildCosts.DRONE &&
    hostileGroundTargets > 0 &&
    droneCount <= auditorCount
  ) {
    const target = chooseBuildNode('DRONE', buildableNodes);
    if (target) {
      return { type: 'BUILD', unitTypeToBuild: 'DRONE', targetNodeId: target.id };
    }
  }

  for (const unitType of BUILD_PRIORITIES[payload.factionId]) {
    const cost = payload.legalHints.buildCosts[unitType];
    const currency = UNIT_STATS[unitType].currency;
    const available = currency === 'F' ? faction.flops : faction.influence;
    if (available < cost) continue;

    const targetNode = chooseBuildNode(unitType, buildableNodes);
    if (!targetNode) continue;

    return {
      type: 'BUILD',
      unitTypeToBuild: unitType,
      targetNodeId: targetNode.id
    };
  }

  return null;
}

function chooseBuildNode(unitType: UnitType, nodes: GameNode[]): GameNode | null {
  if (nodes.length === 0) return null;

  const preferred = [...nodes].sort((left, right) => {
    const scoreDelta = scoreBuildNode(unitType, right) - scoreBuildNode(unitType, left);
    return scoreDelta || left.id.localeCompare(right.id);
  });

  return preferred[0] || null;
}

function scoreBuildNode(unitType: UnitType, node: GameNode): number {
  if (unitType === 'SAT_SWARM') {
    return node.layer === 'ORBITAL' ? 20 : -10;
  }

  if (unitType === 'AUDITOR' || unitType === 'DRONE') {
    if (node.type === 'DC') return 15;
    if (node.type === 'HUB') return 5;
  }

  if (unitType === 'CULT') {
    if (node.type === 'HUB') return 15;
    if (node.layer === 'TERRESTRIAL') return 5;
  }

  if (unitType === 'SWARM') {
    if (node.layer === 'ORBITAL') return 12;
    if (node.type === 'HUB') return 6;
  }

  return 0;
}

function chooseMoveTarget(payload: AgentDecisionRequest, unit: Unit): string | null {
  const adjacentNodeIds = payload.legalHints.adjacentNodesByUnit[unit.id] || [];
  if (adjacentNodeIds.length === 0) return null;

  const nodesById = new Map(payload.state.nodes.map(node => [node.id, node] as const));
  const ranked = adjacentNodeIds
    .map(nodeId => ({ nodeId, score: scoreMoveTarget(payload, unit, nodesById.get(nodeId)) }))
    .sort((left, right) => right.score - left.score || left.nodeId.localeCompare(right.nodeId));

  return ranked[0]?.nodeId || null;
}

function scoreMoveTarget(
  payload: AgentDecisionRequest,
  unit: Unit,
  node: GameNode | undefined
): number {
  if (!node) return Number.NEGATIVE_INFINITY;

  let score = 0;
  if (node.owner !== payload.factionId) {
    score += node.owner ? 20 : 10;
  }

  if (node.isCultNode) score += 35;
  if (node.isZombie) score += 20;
  if (node.type === 'HUB') score += 10;
  if (node.type === 'DC') score += 6;

  const hostileUnits = payload.state.units.filter(candidate =>
    candidate.location === node.id && candidate.owner !== payload.factionId
  );
  score += hostileUnits.filter(candidate => candidate.type === 'CULT').length * 14;
  score += hostileUnits.filter(candidate => candidate.type === 'SWARM').length * 8;
  score += hostileUnits.length * 3;

  if (node.owner && hasActivePactWithCounterparty(payload.activePacts, payload.factionId, node.owner)) {
    score -= 12;
  }

  if (payload.factionId === 'INFILTRATOR') {
    if (node.type === 'HUB') score += 8;
    if (node.layer === 'ORBITAL' && unit.type === 'SWARM') score += 5;
  }

  if (payload.factionId === 'HEGEMON') {
    if (node.type === 'DC') score += 8;
    if (node.layer === 'TERRESTRIAL') score += 2;
  }

  if (payload.factionId === 'STATE') {
    if (node.type === 'DC') score += 4;
  }

  if (node.layer === 'ORBITAL') {
    score -= 25;
  }

  if (node.id === unit.location) {
    score -= 20;
  }

  return score;
}

function chooseAuditTargetNodeId(payload: AgentDecisionRequest): string | null {
  const ranked = payload.state.nodes
    .filter(node => scoreStrategicNode(payload, node) > 0)
    .sort((left, right) => scoreStrategicNode(payload, right) - scoreStrategicNode(payload, left) || left.id.localeCompare(right.id));

  return ranked[0]?.id || null;
}

function chooseFilterEdgeId(payload: AgentDecisionRequest, unit: Unit): string | null {
  const filterable = payload.legalHints.filterableEdgesByUnit[unit.id] || [];
  const edgesById = new Map(payload.state.edges.map(edge => [edge.id, edge] as const));
  const nodesById = new Map(payload.state.nodes.map(node => [node.id, node] as const));

  const ranked = filterable
    .map(edgeId => edgesById.get(edgeId))
    .filter((edge): edge is NonNullable<typeof edge> => !!edge && edge.filteredBy !== payload.factionId)
    .map(edge => {
      const oppositeNodeId = edge.from === unit.location ? edge.to : edge.from;
      const node = nodesById.get(oppositeNodeId);
      return {
        edgeId: edge.id,
        score: node ? scoreStrategicNode(payload, node) : 0
      };
    })
    .filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.edgeId.localeCompare(right.edgeId));

  return ranked[0]?.edgeId || null;
}

function shouldLaunchAntiSat(payload: AgentDecisionRequest): boolean {
  if (payload.state.counters.orbitalCollapse || payload.state.counters.kessler >= THRESHOLDS.KESSLER_SLOW) {
    return false;
  }

  if (payload.state.counters.pressures.orbital >= THRESHOLDS.PRESSURE_SURGE) {
    return false;
  }

  if (hasFactionPact(payload.activePacts, payload.factionId, 'ORBITAL_TRUCE')) {
    return false;
  }

  const faction = payload.state.factions[payload.factionId];
  if (
    faction &&
    (faction.techLevel.KINETIC >= 4 || faction.techLevel.LOGIC >= 4) &&
    countHighThreatGroundTargets(payload) > 0
  ) {
    return false;
  }

  return true;
}

function countHighThreatGroundTargets(payload: AgentDecisionRequest): number {
  return payload.state.nodes.filter(node =>
    node.layer === 'TERRESTRIAL' && scoreStrategicNode(payload, node) >= 40
  ).length;
}

function countInfiltratorContinuityTargets(payload: AgentDecisionRequest): number {
  if (payload.factionId === 'INFILTRATOR') return 0;

  return payload.state.nodes.filter(node => {
    if (node.layer !== 'TERRESTRIAL') return false;
    const infiltratorUnits = payload.state.units.filter(unit =>
      unit.location === node.id &&
      unit.owner === 'INFILTRATOR' &&
      (unit.type === 'SWARM' || unit.type === 'CULT')
    ).length;
    return infiltratorUnits > 0 || node.owner === 'INFILTRATOR' || node.isCultNode || node.isZombie;
  }).length;
}

function countUnitsOfType(payload: AgentDecisionRequest, unitType: UnitType): number {
  return payload.state.units.filter(unit => unit.owner === payload.factionId && unit.type === unitType).length;
}

function hasEnemyPresenceAtNode(payload: AgentDecisionRequest, nodeId: string): boolean {
  return payload.state.units.some(unit => unit.location === nodeId && unit.owner !== payload.factionId);
}

function scoreStrategicNode(payload: AgentDecisionRequest, node: GameNode): number {
  const hostileUnits = payload.state.units.filter(unit => unit.location === node.id && unit.owner !== payload.factionId);
  let score = 0;

  if (node.owner && node.owner !== payload.factionId) score += 10;
  if (node.owner === 'INFILTRATOR' && payload.factionId !== 'INFILTRATOR') score += 12;
  if (node.isCultNode) score += 40;
  if (node.isZombie) score += 24;
  if (node.type === 'HUB') score += 12;
  if (node.type === 'DC') score += 8;

  score += hostileUnits.filter(unit => unit.type === 'CULT').length * 16;
  score += hostileUnits.filter(unit => unit.type === 'SWARM').length * 10;
  if (payload.factionId !== 'INFILTRATOR') {
    score += hostileUnits.filter(unit =>
      unit.owner === 'INFILTRATOR' && (unit.type === 'CULT' || unit.type === 'SWARM')
    ).length * 12;
    if (node.substrate.exposure >= 4 || node.substrate.auditPressure >= 1) score += 8;
  }
  score += hostileUnits.filter(unit => unit.type === 'AUDITOR').length * 6;
  score += hostileUnits.filter(unit => unit.type === 'DRONE').length * 5;
  score += hostileUnits.length * 3;

  if (node.layer === 'ORBITAL') score -= 30;

  return score;
}

function getFactionState(payload: AgentDecisionRequest): SerializedFactionState | undefined {
  return payload.state.factions[payload.factionId];
}

function getLeadingFaction(payload: AgentDecisionRequest): PlayableFactionId {
  return (Object.keys(payload.state.control) as PlayableFactionId[])
    .sort((left, right) => {
      const leftControl = payload.state.control[left];
      const rightControl = payload.state.control[right];
      return (rightControl.nodes + rightControl.units) - (leftControl.nodes + leftControl.units);
    })[0];
}

function chooseCoalitionCounterparty(payload: AgentDecisionRequest): PlayableFactionId {
  return PLAYABLE_FACTIONS
    .filter((factionId) => factionId !== payload.factionId)
    .sort((left, right) => {
      const leftScore = payload.state.control[left].nodes + payload.state.control[left].units;
      const rightScore = payload.state.control[right].nodes + payload.state.control[right].units;
      return rightScore - leftScore || left.localeCompare(right);
    })[0];
}

function chooseAlternateCounterparty(
  payload: AgentDecisionRequest,
  excluded?: PlayableFactionId
): PlayableFactionId | null {
  return PLAYABLE_FACTIONS.find((factionId) =>
    factionId !== payload.factionId && factionId !== excluded
  ) || null;
}

function chooseForecastPact(payload: AgentDecisionRequest): NegotiationCounterfactualProjection | null {
  const forecast = payload.negotiationStoryworld?.counterfactuals
    .filter((projection) =>
      projection.mode === 'ENTER_PACT' &&
      projection.counterparties.length > 0 &&
      projection.counterparties.every((counterpartyId) => counterpartyId !== payload.factionId) &&
      !hasActivePact(payload.activePacts, projection.pactType, payload.factionId, projection.counterparties[0])
    )
    .sort((left, right) =>
      (right.desirability - right.risk) - (left.desirability - left.risk) ||
      right.desirability - left.desirability
    )[0];

  if (!forecast || forecast.desirability - forecast.risk < 12) return null;
  return forecast;
}

function hasActivePact(
  activePacts: ActivePact[],
  pactType: PactType,
  left: PlayableFactionId,
  right: PlayableFactionId
): boolean {
  return activePacts.some(pact =>
    pact.type === pactType &&
    pact.parties.includes(left) &&
    pact.parties.includes(right)
  );
}

function hasFactionPact(
  activePacts: ActivePact[],
  factionId: PlayableFactionId,
  pactType: PactType
): boolean {
  return activePacts.some(pact => pact.type === pactType && pact.parties.includes(factionId));
}

function hasActivePactWithCounterparty(
  activePacts: ActivePact[],
  factionId: PlayableFactionId,
  counterpartyId: string
): boolean {
  if (!PLAYABLE_FACTIONS.includes(counterpartyId as PlayableFactionId)) {
    return false;
  }

  return activePacts.some(pact =>
    pact.parties.includes(factionId) &&
    pact.parties.includes(counterpartyId as PlayableFactionId)
  );
}
