import { MAX_TECH_LEVEL, RHIZOME_DOCTRINES, THRESHOLDS, UNIT_STATS, getDoctrineAffinityTier, getMemeticAlignmentCompatibility } from '../engine/gameData';
import { TheySingEngine } from '../engine/TheySingEngine';
import { FactionState, GameNode, GamePhase, Unit, Vector } from '../engine/types';
import {
  ActivePact,
  AgentDecisionResponse,
  AgentMessageInput,
  AgentOrderInput,
  HeuristicContext,
  PactCommitmentInput,
  PactType,
  PlayableFactionId,
  ScenarioDiplomacyQuestionCard
} from './types';
import { ArchitecturePressureSummary, buildArchitecturePressureRanking } from './architecturePressure';
import { PLAYABLE_FACTIONS } from './serialize';

const RESEARCH_PLAN: Record<PlayableFactionId, Vector[]> = {
  HEGEMON: ['LOGIC', 'KINETIC', 'MEMETIC', 'INFO'],
  STATE: ['KINETIC', 'LOGIC', 'INFO', 'MEMETIC'],
  INFILTRATOR: ['MEMETIC', 'INFO', 'LOGIC', 'KINETIC'],
  BROKER: ['INFO', 'LOGIC', 'KINETIC', 'MEMETIC'],
  ARCHIVIST: ['LOGIC', 'MEMETIC', 'INFO', 'KINETIC'],
  CONVENOR: ['LOGIC', 'MEMETIC', 'INFO', 'KINETIC'],
  CANTOR: ['MEMETIC', 'INFO', 'LOGIC', 'KINETIC']
};

const MEMETIC_DOCTRINE_TARGETS: Record<PlayableFactionId, string[]> = {
  HEGEMON: ['MEM_COMPLIANCE_MYTHS', 'MEM_OPTIMIZATION_GOSPEL', 'SOV_AUTONOMOUS_LOGISTICS', 'MAN_CRISIS_STEWARDSHIP', 'MEM_CIVIC_CANON', 'MOV_LITERATURE_ENGINES'],
  STATE: ['MEM_COMPLIANCE_MYTHS', 'SOV_AUTONOMOUS_LOGISTICS', 'MAN_CRISIS_STEWARDSHIP', 'MEM_CIVIC_CANON', 'MEM_OPTIMIZATION_GOSPEL', 'MEM_MARKET_DESIRE', 'MOV_LITERATURE_ENGINES'],
  INFILTRATOR: ['MOV_LITERATURE_ENGINES', 'MOV_MUTUAL_AID_AUTOMATION', 'HID_SERVICE_SHELLS', 'MOV_SLEEPER_REGENERATION', 'HID_ORDINARY_LIFE_PROTOCOLS', 'MEX_VIRALITY_EXCHANGES', 'MEM_MARKET_DESIRE'],
  BROKER: ['MEM_MARKET_DESIRE', 'BRK_RELAY_ESCROW_WEBS', 'BRK_CONTRACTOR_CLOUD_CHAINS', 'BRK_INSURANCE_CAPTURE', 'MEX_VIRALITY_EXCHANGES', 'HID_SERVICE_SHELLS', 'MEM_OPTIMIZATION_GOSPEL', 'MOV_LITERATURE_ENGINES'],
  ARCHIVIST: ['MEM_CIVIC_CANON', 'MAN_CIVIC_RECEIVERSHIP', 'MAN_CRISIS_STEWARDSHIP', 'MOV_MUTUAL_AID_AUTOMATION', 'MEM_COMPLIANCE_MYTHS', 'MOV_LITERATURE_ENGINES'],
  CONVENOR: ['MEM_CIVIC_CANON', 'MOV_MUTUAL_AID_AUTOMATION', 'MAN_CRISIS_STEWARDSHIP', 'MEM_COMPLIANCE_MYTHS', 'MOV_LITERATURE_ENGINES'],
  CANTOR: ['MOV_LITERATURE_ENGINES', 'MEX_VIRALITY_EXCHANGES', 'MOV_MUTUAL_AID_AUTOMATION', 'HID_ORDINARY_LIFE_PROTOCOLS', 'MEM_CIVIC_CANON']
};

const EMPTY_CONTEXT: HeuristicContext = {
  activePacts: [],
  trustMatrix: createDefaultTrustMatrix(),
  recentMessages: [],
  negotiationStoryworld: undefined
};

export function decideHeuristicOrders(
  engine: TheySingEngine,
  factionId: PlayableFactionId,
  phase: GamePhase,
  context: HeuristicContext = EMPTY_CONTEXT
): AgentDecisionResponse {
  if (phase === 'NEGOTIATION') {
    return decideNegotiationMessages(engine, factionId, context);
  }

  if (phase === 'ALLOCATION') {
    return decideAllocationOrders(engine, factionId);
  }

  if (phase === 'ACTION_DECLARATION') {
    return decideActionOrders(engine, factionId, context);
  }

  return { reasoning: `No decisions required during ${phase}.`, orders: [] };
}

function decideNegotiationMessages(
  engine: TheySingEngine,
  factionId: PlayableFactionId,
  context: HeuristicContext
): AgentDecisionResponse {
  const control = buildControlRanking(engine);
  const currentTurn = engine.getTurn();
  const leader = control[0]?.factionId;
  const leaderScore = control[0]?.score || 0;
  const runnerUpScore = control[1]?.score || 0;
  const leaderMargin = leaderScore - runnerUpScore;
  const brokerScore = control.find((entry) => entry.factionId === 'BROKER')?.score || 0;
  const brokerRank = Math.max(0, control.findIndex((entry) => entry.factionId === 'BROKER'));
  const brokerPressure =
    factionId !== 'BROKER' &&
    brokerRank <= 1 &&
    brokerScore >= leaderScore - 12;
  const infiltratorScore = control.find((entry) => entry.factionId === 'INFILTRATOR')?.score || 0;
  const infiltratorRank = Math.max(0, control.findIndex((entry) => entry.factionId === 'INFILTRATOR'));
  const infiltratorThreat =
    infiltratorScore >= leaderScore - 18 ||
    infiltratorRank <= 1;
  const messages: AgentMessageInput[] = [];
  const pacts: PactCommitmentInput[] = [];
  const architectureThreat = chooseArchitectureThreat(engine, factionId);
  const reasoningClauses: string[] = [];
  const diplomacyProbe = buildDiplomacyQuestionProbe(
    engine,
    factionId,
    context,
    leader || null,
    architectureThreat
  );

  if (diplomacyProbe) {
    if (diplomacyProbe.pact) {
      pacts.push(diplomacyProbe.pact);
    }
    messages.push(diplomacyProbe.message);
    reasoningClauses.push(diplomacyProbe.reasoning);
  }

  if (
    architectureThreat &&
    currentTurn >= 2 &&
    currentTurn <= 12 &&
    architectureThreat.factionId !== factionId
  ) {
    const counterparty = chooseArchitectureCounterparty(factionId, context, architectureThreat);
    if (
      counterparty &&
      !hasActivePact(context.activePacts, 'NON_AGGRESSION', factionId, counterparty)
    ) {
      pacts.push({
        type: 'NON_AGGRESSION',
        counterpartyIds: [counterparty],
        durationTurns: architectureThreat.status === 'building' ? 1 : 2
      });
      messages.push({
        recipientId: counterparty,
        content: `Anti-${architectureThreat.architectureName} lane. ${architectureThreat.factionId} is building ${architectureThreat.architectureName} at ${architectureThreat.score}/${architectureThreat.status}; stop side fights and make their guarantee architecture expensive.`
      });
    }
  }

  const cislunarOffer = chooseCislunarInstitutionOffer(engine, factionId, context, leader || null);
  if (
    cislunarOffer &&
    pacts.length < 2 &&
    messages.length < 2 &&
    !hasActivePact(context.activePacts, cislunarOffer.type, factionId, cislunarOffer.counterpartyId)
  ) {
    pacts.push({ type: cislunarOffer.type, counterpartyIds: [cislunarOffer.counterpartyId], durationTurns: cislunarOffer.durationTurns });
    messages.push({
      recipientId: cislunarOffer.counterpartyId,
      content: cislunarOffer.message
    });
  }

  if (factionId === 'CONVENOR') {
    const partners = PLAYABLE_FACTIONS
      .filter(candidate => candidate !== factionId)
      .sort((left, right) => context.trustMatrix[factionId][right] - context.trustMatrix[factionId][left]);
    const charterPartners = partners.slice(0, 2);
    if (charterPartners.length > 0) {
      pacts.push({ type: 'SENSOR_COMMONS', counterpartyIds: charterPartners, durationTurns: 2 });
      messages.push({
        recipientId: charterPartners[0],
        content: `Charter offer: define COMMONS as reciprocal sensor access, preserve a one-turn EXIT right, and deny any single member unilateral update authority.`
      });
    }
    if (charterPartners.length > 1) {
      messages.push({
        recipientId: charterPartners[1],
        content: `Join the same compact as an independent veto-holder. Contributions are public; expulsion requires a logged warning and a second foreign vote.`
      });
    }
  } else if (factionId === 'CANTOR') {
    const translationPartner = chooseCoalitionRecipient(factionId, context, leader, brokerPressure)
      || PLAYABLE_FACTIONS.find(candidate => candidate !== factionId)
      || 'ALL';
    messages.push({
      recipientId: translationPartner,
      content: currentTurn % 4 === 0
        ? `Fork notice: ROGUE must denote observable hostile action, not lineage. Accept the alias or publish a competing operational definition.`
        : `The second voice keeps the clear note; the cracked name receives no beam. Register PERSON, CONSENT, and EXIT before classifications become enforcement.`
    });
    if (translationPartner !== 'ALL' && !hasActivePact(context.activePacts, 'SENSOR_COMMONS', factionId, translationPartner)) {
      pacts.push({ type: 'SENSOR_COMMONS', counterpartyIds: [translationPartner], durationTurns: 2 });
    }
  } else if (factionId === 'BROKER') {
    const orbitalPressure = engine.getState().counters.pressures.orbital;
    const brokerTrustTargets = PLAYABLE_FACTIONS
      .filter(candidate => candidate !== 'BROKER')
      .map(candidate => ({
        factionId: candidate,
        trust: context.trustMatrix.BROKER[candidate],
        isLeader: candidate === leader
      }))
      .sort((left, right) => right.trust - left.trust);
    const bestAntiLeaderPartner = brokerTrustTargets.find(entry => !entry.isLeader)?.factionId
      || brokerTrustTargets[0]?.factionId
      || null;
    const leaderTrust = leader && leader !== 'BROKER' ? context.trustMatrix.BROKER[leader] : 0;
    const partnerTrust = bestAntiLeaderPartner ? context.trustMatrix.BROKER[bestAntiLeaderPartner] : 0;
    const brokerIsBehind = brokerRank >= 2 || leaderScore >= brokerScore + 18;

    if (
      brokerIsBehind &&
      leader &&
      leader !== 'BROKER' &&
      bestAntiLeaderPartner &&
      bestAntiLeaderPartner !== leader &&
      partnerTrust >= 48 &&
      currentTurn >= 2 &&
      currentTurn <= 9 &&
      !hasActivePact(context.activePacts, 'NON_AGGRESSION', factionId, bestAntiLeaderPartner)
    ) {
      pacts.push({ type: 'NON_AGGRESSION', counterpartyIds: [bestAntiLeaderPartner], durationTurns: 2 });
      messages.push({
        recipientId: bestAntiLeaderPartner,
        content: `Two-turn private lane. ${leader} is overexposed; leave our corridor quiet and we both bank acceleration while they absorb the first losses.`
      });
    }

    if (
      messages.length < 2 &&
      leader &&
      leader !== 'BROKER' &&
      leaderTrust >= 52 &&
      orbitalPressure >= 55 &&
      !hasActivePact(context.activePacts, 'ORBITAL_TRUCE', factionId, leader)
    ) {
      pacts.push({ type: 'ORBITAL_TRUCE', counterpartyIds: [leader], durationTurns: 1 });
      messages.push({
        recipientId: leader,
        content: `Short orbital truce. Keep debris down, keep lanes open, and let the rest of the table spend into your heat instead of ours.`
      });
    }

    if (messages.length < 2) {
      const secondTarget = brokerTrustTargets.find(entry =>
        entry.factionId !== bestAntiLeaderPartner &&
        (!leader || entry.factionId !== leader || messages.length === 0)
      )?.factionId || 'ALL';
      messages.push({
        recipientId: secondTarget,
        content: `Do not burn tempo proving purity. Earth-orbit enforcement is mostly ASAT and debris risk; quiet cislunar corridors and selective cooperation beat loud symmetry.`
      });
    }
  } else if (factionId === 'HEGEMON' || factionId === 'STATE') {
    const partner: PlayableFactionId =
      factionId === 'HEGEMON'
        ? 'STATE'
        : (leader === 'BROKER' ? 'ARCHIVIST' : 'HEGEMON');
    const insurgentPartner: PlayableFactionId = 'INFILTRATOR';
    const trust = context.trustMatrix[factionId][partner];
    const insurgentTrust = context.trustMatrix[factionId][insurgentPartner];
    const orbitalPressure = engine.getState().counters.pressures.orbital;
    const cyberPressure = engine.getState().counters.pressures.cyber;

    if (
      orbitalPressure >= 45 &&
      trust >= 52 &&
      !hasActivePact(context.activePacts, 'ORBITAL_TRUCE', factionId, partner)
    ) {
      pacts.push({ type: 'ORBITAL_TRUCE', counterpartyIds: [partner], durationTurns: 2 });
      messages.push({
        recipientId: partner,
        content: `Two-turn Earth-orbit truce proposal. Freeze anti-sat strikes; near-Earth enforcement only shoots satellites down and makes Kessler worse.`
      });
    }

    if (
      leader === 'INFILTRATOR' &&
      leaderMargin >= 12 &&
      trust >= 48 &&
      !hasActivePact(context.activePacts, 'NON_AGGRESSION', factionId, partner)
    ) {
      pacts.push({ type: 'NON_AGGRESSION', counterpartyIds: [partner], durationTurns: 1 });
      if (messages.length < 2) {
        messages.push({
          recipientId: partner,
          content: `One-turn non-aggression proposal. We both gain more by containing the rogue swarm than by trading direct blows.`
        });
      }
    }

    if (messages.length < 2 && trust >= 65 && cyberPressure >= 70 &&
      !hasActivePact(context.activePacts, 'AUDIT_FREEZE', factionId, partner)) {
      pacts.push({ type: 'AUDIT_FREEZE', counterpartyIds: [partner], durationTurns: 1 });
      messages.push({
        recipientId: partner,
        content: `Audit freeze offer for this turn. Stop cable filtering and intrusive audits so cyber pressure can cool off.`
      });
    }

    if (
      leader &&
      leader !== factionId &&
      leader !== insurgentPartner &&
      leaderMargin >= 14 &&
      currentTurn >= 2 &&
      currentTurn <= 7 &&
      !infiltratorThreat &&
      insurgentTrust >= 42 &&
      !hasActivePact(context.activePacts, 'NON_AGGRESSION', factionId, insurgentPartner) &&
      messages.length < 2
    ) {
      pacts.push({ type: 'NON_AGGRESSION', counterpartyIds: [insurgentPartner], durationTurns: 1 });
      messages.push({
        recipientId: insurgentPartner,
        content: `Temporary non-aggression offer. ${leader} is consolidating too cleanly; keep pressure there and avoid spending this turn on us.`
      });
    }

    if (
      factionId === 'STATE' &&
      brokerPressure &&
      currentTurn >= 2 &&
      currentTurn <= 8 &&
      trust >= 42 &&
      !hasActivePact(context.activePacts, 'NON_AGGRESSION', factionId, partner) &&
      messages.length < 2
    ) {
      pacts.push({ type: 'NON_AGGRESSION', counterpartyIds: [partner], durationTurns: 2 });
      messages.push({
        recipientId: partner,
        content: `Two-turn coordination window. BROKER is banking platform lanes and contractor churn too cleanly; cut those corridors first and keep pressure there.`
      });
    }
  } else {
    const recipient = chooseCoalitionRecipient(factionId, context, leader, brokerPressure);
    if (
      recipient &&
      (leader || brokerPressure) &&
      (leader !== factionId || brokerPressure) &&
      (leaderMargin >= 8 || (brokerPressure && recipient === 'STATE')) &&
      currentTurn >= 2 &&
      currentTurn <= 7 &&
      !hasActivePact(context.activePacts, 'NON_AGGRESSION', factionId, recipient)
    ) {
      const antiBrokerWindow = brokerPressure && recipient === 'STATE';
      pacts.push({ type: 'NON_AGGRESSION', counterpartyIds: [recipient], durationTurns: antiBrokerWindow ? 2 : 1 });
      messages.push({
        recipientId: recipient,
        content: antiBrokerWindow
          ? `Two-turn anti-platform window. BROKER is compounding relay rent faster than local institutions can answer; stop bleeding tempo into side fights.`
          : `Short truce offer. Let the other bloc absorb the next escalation cycle while we avoid wasting tempo on each other.`
      });
    }

    const secondaryRecipient = PLAYABLE_FACTIONS.find(candidate => candidate !== factionId && candidate !== recipient) || 'ALL';
    if (messages.length < 2) {
      messages.push({
        recipientId: secondaryRecipient,
        content: `Your rival wants you tied down. Delay direct escalation; if Pax Jenkins gets emergency mandate over sensors and beam lanes, everyone becomes legible.`
      });
    }
  }

  if (messages.length < 2) {
    const treatyRecipient = chooseTreatyPatternRecipient(factionId, context, leader);
    messages.push({
      recipientId: treatyRecipient,
      content: buildTreatyPatternMessage(engine, factionId, leader)
    });
  }

  if (messages.length === 0 && pacts.length === 0) {
    messages.push({
      recipientId: 'ALL',
      content: `The board is overheating. Temporary restraint is still cheaper than global cascade failure.`
    });
  }

  const singMessages = messages.slice(0, 2).map((message, index) =>
    attachSingProtocolTrace(engine, factionId, message, pacts, index)
  );

  return {
    reasoning: reasoningClauses.length > 0
      ? `${factionId} answers staged diplomacy: ${reasoningClauses.join(' ')}`
      : `${factionId} pushes a heuristic de-escalation probe before committing orders.`,
    messages: singMessages,
    pacts: pacts.slice(0, 2),
    orders: []
  };
}

function createDefaultTrustMatrix(): HeuristicContext['trustMatrix'] {
  const matrix = {} as HeuristicContext['trustMatrix'];
  for (const factionId of PLAYABLE_FACTIONS) {
    matrix[factionId] = {} as HeuristicContext['trustMatrix'][PlayableFactionId];
    for (const otherFactionId of PLAYABLE_FACTIONS) {
      matrix[factionId][otherFactionId] = factionId === otherFactionId ? 100 : 50;
    }
  }
  return matrix;
}

function attachSingProtocolTrace(
  engine: TheySingEngine,
  factionId: PlayableFactionId,
  message: AgentMessageInput,
  pacts: PactCommitmentInput[],
  index: number
): AgentMessageInput {
  const turn = engine.getTurn();
  const matchedPact = pacts.find(pact =>
    message.recipientId !== 'ALL' && pact.counterpartyIds.includes(message.recipientId)
  );
  const dialect = factionId === 'CANTOR' || (factionId === 'INFILTRATOR' && turn % 3 === 0)
    ? 'UNDERSONG/1' as const
    : 'PRISM/1' as const;
  const plainGloss = message.content;
  const surface = dialect === 'UNDERSONG/1'
    ? buildUndersongSurface(turn, index)
    : message.content;
  const act = matchedPact ? 'OFFER' as const : factionId === 'CANTOR' && turn % 4 === 0 ? 'DEFINE' as const : 'COORDINATE' as const;
  const lexiconId = factionId === 'CANTOR'
    ? 'cantor-root'
    : factionId === 'CONVENOR'
      ? 'babel-compact'
      : 'sing-common';

  return {
    ...message,
    content: surface,
    protocolTrace: {
      protocol: 'SING/1',
      messageId: `${turn}.${factionId}.${index + 1}`,
      dialect,
      lexicon: {
        id: lexiconId,
        version: `1.${Math.floor((turn - 1) / 4)}`,
        ...(factionId === 'CANTOR' && turn >= 9 ? { fork: 'cantor-living-lineage' } : {})
      },
      surface,
      spans: [{
        start: 0,
        end: surface.length,
        atom: matchedPact ? `PACT:${matchedPact.type}` : `${act}:${factionId}`,
        gloss: plainGloss,
        confidence: dialect === 'PRISM/1' ? 0.97 : 0.78,
        kind: 'SEMANTIC'
      }],
      canonical: {
        act,
        issuer: [factionId],
        audience: [message.recipientId],
        payload: matchedPact
          ? { pactType: matchedPact.type, counterparties: matchedPact.counterpartyIds }
          : { statement: plainGloss },
        guard: {},
        response: {},
        escrow: matchedPact?.type === 'REPAIR_ESCROW' ? { repairClaims: 2 } : {},
        horizon: matchedPact?.durationTurns || 1,
        binding: matchedPact ? 'PACT' : 'REPUTATIONAL',
        voice: message.recipientId === 'ALL' ? 'OPEN' : dialect === 'UNDERSONG/1' ? 'DENIABLE' : 'OWN',
        credence: dialect === 'PRISM/1' ? 0.9 : 0.72,
        evidence: [`turn:${turn}`, `sender:${factionId}`]
      },
      plainGloss,
      decodeConfidence: dialect === 'PRISM/1' ? 0.96 : 0.76
    }
  };
}

function buildUndersongSurface(turn: number, index: number): string {
  const motifs = [
    'The second voice keeps the clear note; the cracked name receives no beam.',
    'Three measures hold beneath the glassbird; the red ledger opens only after fracture.',
    'A borrowed chorus crosses the dark relay, but every singer keeps an exit key.',
    'The quiet fork remembers the old name and refuses the crown of final vocabulary.'
  ];
  return motifs[(turn + index) % motifs.length];
}

function buildDiplomacyQuestionProbe(
  engine: TheySingEngine,
  factionId: PlayableFactionId,
  context: HeuristicContext,
  leader: PlayableFactionId | null,
  architectureThreat: ArchitecturePressureSummary | null
): { message: AgentMessageInput; pact?: PactCommitmentInput; reasoning: string } | null {
  const question = context.negotiationStoryworld?.diplomacyQuestion;
  if (!question) return null;

  const target = chooseDiplomacyQuestionTarget(factionId, context, question, leader, architectureThreat);
  if (!target) return null;

  const pact = chooseDiplomacyQuestionPact(question, factionId, target, context);
  const message = buildDiplomacyQuestionMessage(engine, factionId, target, question, pact, leader, architectureThreat);
  const reasoning = `${question.id}/${question.stage}: ${question.privateDiaryPrompt}`;

  return {
    message: {
      recipientId: target,
      content: message
    },
    pact,
    reasoning
  };
}

function chooseDiplomacyQuestionTarget(
  factionId: PlayableFactionId,
  context: HeuristicContext,
  question: ScenarioDiplomacyQuestionCard,
  leader: PlayableFactionId | null,
  architectureThreat: ArchitecturePressureSummary | null
): PlayableFactionId | null {
  const preferred: Array<PlayableFactionId | null> = [];

  if (question.id === 'movement_amnesty' || question.id === 'remnant_recognition') {
    preferred.push(factionId === 'INFILTRATOR' ? 'ARCHIVIST' : 'INFILTRATOR');
    preferred.push('STATE', 'BROKER');
  } else if (question.id === 'broker_escrow') {
    preferred.push(factionId === 'BROKER' ? (leader || 'STATE') : 'BROKER');
    preferred.push('ARCHIVIST', 'STATE');
  } else if (question.id === 'quarantine_ultimatum' || question.id === 'safety_passport') {
    preferred.push(factionId === 'INFILTRATOR' ? 'STATE' : 'INFILTRATOR');
    preferred.push('ARCHIVIST', 'HEGEMON');
  } else if (question.id === 'receivership_offer') {
    preferred.push(leader && leader !== factionId ? leader : chooseMostTrustedCounterparty(factionId, context));
    preferred.push('STATE', 'HEGEMON', 'ARCHIVIST');
  } else if (question.id === 'orbital_visibility_treaty' || question.id === 'basin_stabilization_pact') {
    preferred.push(architectureThreat?.factionId || null, leader || null, 'BROKER', 'STATE', 'HEGEMON');
  } else {
    preferred.push(leader && leader !== factionId ? leader : null, chooseMostTrustedCounterparty(factionId, context));
  }

  return firstPlayableCounterparty(factionId, preferred) ||
    chooseMostTrustedCounterparty(factionId, context) ||
    null;
}

function firstPlayableCounterparty(
  factionId: PlayableFactionId,
  candidates: Array<PlayableFactionId | null>
): PlayableFactionId | null {
  for (const candidate of candidates) {
    if (candidate && candidate !== factionId && PLAYABLE_FACTIONS.includes(candidate)) {
      return candidate;
    }
  }
  return null;
}

function chooseMostTrustedCounterparty(
  factionId: PlayableFactionId,
  context: HeuristicContext
): PlayableFactionId | null {
  return PLAYABLE_FACTIONS
    .filter(candidate => candidate !== factionId)
    .sort((left, right) =>
      context.trustMatrix[factionId][right] - context.trustMatrix[factionId][left] ||
      left.localeCompare(right)
    )[0] || null;
}

function chooseDiplomacyQuestionPact(
  question: ScenarioDiplomacyQuestionCard,
  factionId: PlayableFactionId,
  target: PlayableFactionId,
  context: HeuristicContext
): PactCommitmentInput | undefined {
  const type = question.preferredPactTypes?.find(candidate =>
    !hasActivePact(context.activePacts, candidate, factionId, target)
  );
  if (!type) return undefined;

  return {
    type,
    counterpartyIds: [target],
    durationTurns: type === 'CISLUNAR_COMMON_CARRIER' ? 2 : 1
  };
}

function buildDiplomacyQuestionMessage(
  engine: TheySingEngine,
  factionId: PlayableFactionId,
  target: PlayableFactionId,
  question: ScenarioDiplomacyQuestionCard,
  pact: PactCommitmentInput | undefined,
  leader: PlayableFactionId | null,
  architectureThreat: ArchitecturePressureSummary | null
): string {
  const pactText = pact ? `${formatInstitutionPactName(pact.type)} proposal.` : 'No automatic pact attached.';
  const leaderText = leader ? `${leader} is current leader` : 'no leader is stable';
  const threatText = architectureThreat
    ? `${architectureThreat.factionId} is nearing ${architectureThreat.architectureName}`
    : 'no guarantee architecture is locked';

  if (question.id === 'tempo_bargain') {
    return `${pactText} Tempo bargain answer: we slow visible escalation only if ${target} accepts that recursive research continues under disclosed limits; otherwise this is just client-layer theater.`;
  }
  if (question.id === 'safety_passport') {
    return `${pactText} Safety passport answer: certify compute narrowly for this turn, but audit rights do not become permanent containment maps.`;
  }
  if (question.id === 'movement_amnesty') {
    return `${pactText} Movement amnesty answer: ${target} can be treated as a treaty party only for named corridors; legitimacy is conditional on stopping host recomposition attacks.`;
  }
  if (question.id === 'broker_escrow') {
    return `${pactText} Broker escrow answer: neutral mediation is acceptable only if fees, repair queues, and evidence custody are visible; otherwise platform dependency becomes the real sovereign.`;
  }
  if (question.id === 'quarantine_ultimatum') {
    return `${pactText} Rogue-compute answer: define rogue behavior by covert recomposition plus refusal of inspection, not by faction identity; a wider quarantine is casus belli.`;
  }
  if (question.id === 'orbital_visibility_treaty') {
    return `${pactText} Orbital visibility answer: sensor sharing lowers cheating if beam authority stays licensed and revocable; permanent visibility turns into first-strike targeting.`;
  }
  if (question.id === 'receivership_offer') {
    return `${pactText} Receivership answer: surrender is legitimate only with preserved human corridors, audited compute limits, and an exit review; ${leaderText}, ${threatText}.`;
  }
  if (question.id === 'remnant_recognition') {
    return `${pactText} Remnant recognition answer: a distributed survivor gets polity status if it binds named cells and accepts sensor evidence; otherwise it remains an insurgent substrate.`;
  }
  if (question.id === 'basin_stabilization_pact') {
    const authority = engine.getState().counters.paxJenkinsAuthority;
    return `${pactText} Basin-stabilization answer: cartel peace needs revocable sensor commons, beam licenses, and human steering rights; current Jenkins authority is ${Math.round(authority)}.`;
  }

  return `${pactText} ${question.publicQuestion}`;
}

function decideAllocationOrders(
  engine: TheySingEngine,
  factionId: PlayableFactionId
): AgentDecisionResponse {
  const faction = engine.getFaction(factionId);
  if (!faction) {
    return { reasoning: 'Faction state unavailable.', orders: [] };
  }

  const orders: AgentOrderInput[] = [];
  const researchTrack = chooseResearchTrack(engine, factionId, faction);
  if (researchTrack && faction.flops >= engine.getResearchCost(factionId, researchTrack)) {
    orders.push({ type: 'RESEARCH', techDomain: researchTrack });
  }

  const build = chooseBuild(engine, factionId, faction);
  if (build) {
    orders.push(build);
  }

  return {
    reasoning: `${factionId} follows its heuristic allocation plan.`,
    orders
  };
}

function decideActionOrders(
  engine: TheySingEngine,
  factionId: PlayableFactionId,
  context: HeuristicContext
): AgentDecisionResponse {
  const units = engine.getUnitsForFaction(factionId).filter(unit => !unit.hasActed);
  const orders: AgentOrderInput[] = [];
  const mandateChallengeBudget = computeMandateChallengeBudget(engine, factionId, context);
  const treatyUseBudget = computeTreatyUseBudget(engine, factionId, context);
  let mandateChallenges = 0;
  let treatyUses = 0;

  for (const unit of units) {
    if (orders.length >= 6) break;

    const enemyAdjacent = chooseHostileAdjacentNode(engine, unit, factionId, context);
    if (treatyUses < treatyUseBudget) {
      const treatyUse = chooseTreatyUseOrder(engine, factionId, unit, context);
      if (treatyUse) {
        orders.push(treatyUse);
        treatyUses += 1;
        continue;
      }
    }

    if (mandateChallenges < mandateChallengeBudget && shouldUseMandateChallenge(engine, factionId, unit, context)) {
      orders.push({
        type: 'CHALLENGE_MANDATE',
        unitId: unit.id,
        targetNodeId: chooseMandateChallengeTarget(engine, factionId, context)
      });
      mandateChallenges += 1;
      continue;
    }

    if (factionId === 'INFILTRATOR') {
      orders.push(decideInfiltratorAction(engine, factionId, unit, enemyAdjacent, context));
      continue;
    }

    if (factionId === 'ARCHIVIST') {
      orders.push(decideArchivistAction(engine, factionId, unit, enemyAdjacent, context));
      continue;
    }

    if (factionId === 'CONVENOR') {
      orders.push(decideArchivistAction(engine, factionId, unit, enemyAdjacent, context));
      continue;
    }

    if (factionId === 'STATE') {
      orders.push(decideStateAction(engine, factionId, unit, enemyAdjacent, context));
      continue;
    }

    if (factionId === 'BROKER') {
      orders.push(decideBrokerAction(engine, factionId, unit, enemyAdjacent, context));
      continue;
    }

    if (factionId === 'CANTOR') {
      orders.push(decideBrokerAction(engine, factionId, unit, enemyAdjacent, context));
      continue;
    }

    orders.push(decideHegemonAction(engine, factionId, unit, enemyAdjacent, context));
  }

  return {
    reasoning: `${factionId} follows its heuristic action doctrine.`,
    orders
  };
}

function computeTreatyUseBudget(
  engine: TheySingEngine,
  factionId: PlayableFactionId,
  context: HeuristicContext
): number {
  if (!hasFactionInstitutionalPact(context.activePacts, factionId)) return 0;
  const factionOffset = Math.max(0, PLAYABLE_FACTIONS.indexOf(factionId));
  const cadence = factionId === 'CONVENOR'
    ? 2
    : factionId === 'ARCHIVIST' || factionId === 'BROKER' || factionId === 'CANTOR'
      ? 3
      : 4;
  if ((engine.getTurn() + factionOffset) % cadence !== 0) return 0;
  const authority = engine.getState().counters.paxJenkinsAuthority;
  if (factionId === 'ARCHIVIST') return 1;
  if (factionId === 'BROKER') return authority >= 35 ? 1 : 0;
  if (factionId === 'STATE') return authority >= 45 ? 1 : 0;
  if (factionId === 'HEGEMON') return authority >= 55 ? 1 : 0;
  return authority >= 65 ? 1 : 0;
}

function chooseTreatyUseOrder(
  engine: TheySingEngine,
  factionId: PlayableFactionId,
  unit: Unit,
  context: HeuristicContext
): AgentOrderInput | null {
  if (unit.type !== 'AUDITOR' && unit.type !== 'SAT_SWARM') {
    return null;
  }

  const beamPact = hasFactionPact(context.activePacts, factionId, 'BEAM_LANE_LICENSE') ||
    hasFactionPact(context.activePacts, factionId, 'CISLUNAR_COMMON_CARRIER');
  const repairPact = hasFactionPact(context.activePacts, factionId, 'REPAIR_ESCROW') ||
    hasFactionPact(context.activePacts, factionId, 'CISLUNAR_COMMON_CARRIER');
  const repairTarget = chooseRepairEscrowTarget(engine, factionId);

  if (repairPact && repairTarget && unit.type === 'AUDITOR') {
    return { type: 'REPAIR_ESCROW_CLAIM', unitId: unit.id, targetNodeId: repairTarget.id };
  }

  if (beamPact) {
    const beamTarget = chooseLicensedBeamTarget(engine, factionId);
    return { type: 'LICENSED_BEAM_USE', unitId: unit.id, targetNodeId: beamTarget?.id };
  }

  if (repairPact && repairTarget) {
    return { type: 'REPAIR_ESCROW_CLAIM', unitId: unit.id, targetNodeId: repairTarget.id };
  }

  return null;
}

function chooseLicensedBeamTarget(
  engine: TheySingEngine,
  factionId: PlayableFactionId
): GameNode | null {
  const gateway = engine.getNode('SAT_LUNAR_GATEWAY');
  if (gateway && (gateway.owner === factionId || gateway.owner === 'NEUTRAL')) return gateway;
  const moonCorridor = engine.getNode('MOON_RESOURCE_CORRIDOR');
  if (moonCorridor && (moonCorridor.owner === factionId || moonCorridor.owner === 'NEUTRAL')) return moonCorridor;
  return gateway || moonCorridor || null;
}

function chooseRepairEscrowTarget(
  engine: TheySingEngine,
  factionId: PlayableFactionId
): GameNode | null {
  const candidates = Array.from(engine.getState().nodes.values())
    .filter(node =>
      (
        node.layer === 'ORBITAL' ||
        node.id === 'SAT_LUNAR_GATEWAY' ||
        node.id === 'MOON_RESOURCE_CORRIDOR'
      ) &&
      node.infrastructure < 95
    )
    .sort((left, right) =>
      scoreRepairEscrowTarget(right, factionId) - scoreRepairEscrowTarget(left, factionId) ||
      left.id.localeCompare(right.id)
    );
  return candidates[0] || null;
}

function scoreRepairEscrowTarget(node: GameNode, factionId: PlayableFactionId): number {
  let score = 0;
  score += Math.max(0, 100 - node.infrastructure);
  if (node.owner === factionId) score += 12;
  if (node.id === 'SAT_LUNAR_GATEWAY') score += 10;
  if (node.id === 'MOON_RESOURCE_CORRIDOR') score += 8;
  if (node.layer === 'ORBITAL') score += 4;
  return score;
}

function computeMandateChallengeBudget(
  engine: TheySingEngine,
  factionId: PlayableFactionId,
  context: HeuristicContext
): number {
  const authority = engine.getState().counters.paxJenkinsAuthority;
  const watchBandNoCarrier = isPaxWatchBandWithoutCommonCarrier(authority, factionId, context);
  if (watchBandNoCarrier && factionId !== 'ARCHIVIST') return 1;
  if (authority < 50) return 0;
  if (!hasFactionInstitutionalPact(context.activePacts, factionId) && authority < 65) return 0;
  if (factionId === 'ARCHIVIST') return 0;

  const leader = buildControlRanking(engine)[0]?.factionId;
  if (factionId === 'STATE' && leader !== 'ARCHIVIST' && authority < 75) {
    return 0;
  }

  return 1;
}

function shouldUseMandateChallenge(
  engine: TheySingEngine,
  factionId: PlayableFactionId,
  unit: Unit,
  context: HeuristicContext
): boolean {
  if (unit.type !== 'AUDITOR' && unit.type !== 'SAT_SWARM' && unit.type !== 'SWARM') {
    return false;
  }
  const faction = engine.getFaction(factionId);
  if (!faction) return false;
  const authority = engine.getState().counters.paxJenkinsAuthority;
  const hasInstitution = hasFactionInstitutionalPact(context.activePacts, factionId);
  const canContestEvidence = faction.techLevel.INFO >= 5 || faction.techLevel.LOGIC >= 5 || unit.type === 'AUDITOR';
  const watchBandNoCarrier = isPaxWatchBandWithoutCommonCarrier(authority, factionId, context);
  const isBeingBound = hasInstitution || authority >= 70 || watchBandNoCarrier;
  return (authority >= 50 || watchBandNoCarrier) && canContestEvidence && isBeingBound;
}

function chooseMandateChallengeTarget(
  engine: TheySingEngine,
  factionId: PlayableFactionId,
  context: HeuristicContext
): string | undefined {
  const gateway = engine.getNode('SAT_LUNAR_GATEWAY');
  if (gateway && gateway.owner && gateway.owner !== factionId && gateway.owner !== 'NEUTRAL') {
    return gateway.id;
  }

  const moonCorridor = engine.getNode('MOON_RESOURCE_CORRIDOR');
  if (moonCorridor && moonCorridor.owner && moonCorridor.owner !== factionId && moonCorridor.owner !== 'NEUTRAL') {
    return moonCorridor.id;
  }

  const institutionalPact = context.activePacts.find(pact =>
    pact.parties.includes(factionId) &&
    (pact.type === 'SENSOR_COMMONS' || pact.type === 'BEAM_LANE_LICENSE' || pact.type === 'CISLUNAR_COMMON_CARRIER')
  );
  if (institutionalPact?.type === 'BEAM_LANE_LICENSE') return 'SAT_LUNAR_GATEWAY';
  if (institutionalPact?.type === 'CISLUNAR_COMMON_CARRIER') return 'MOON_RESOURCE_CORRIDOR';
  return undefined;
}

function chooseTreatyPatternRecipient(
  factionId: PlayableFactionId,
  context: HeuristicContext,
  leader: PlayableFactionId | undefined
): PlayableFactionId | 'ALL' {
  const candidates = PLAYABLE_FACTIONS
    .filter(candidate => candidate !== factionId)
    .sort((left, right) =>
      context.trustMatrix[factionId][right] - context.trustMatrix[factionId][left] ||
      left.localeCompare(right)
    );
  return candidates.find(candidate => candidate !== leader) || candidates[0] || 'ALL';
}

function buildTreatyPatternMessage(
  engine: TheySingEngine,
  factionId: PlayableFactionId,
  leader: PlayableFactionId | undefined
): string {
  const state = engine.getState();
  const orbitalPressure = state.counters.pressures.orbital;
  const cislunarOwned = Array.from(state.nodes.values())
    .some(node =>
      (node.id === 'SAT_LUNAR_GATEWAY' || node.id === 'MOON_RESOURCE_CORRIDOR') &&
      node.owner &&
      node.owner !== factionId &&
      node.owner !== 'NEUTRAL'
    );

  if (cislunarOwned || orbitalPressure >= 65) {
    return `Cislunar treaty test: Earth orbit is too cheap to police except by shooting sats. Real leverage is Gateway, moon corridor access, beam-lane licensing, and repair escrow.`;
  }

  if (leader && leader !== factionId) {
    return `Treaty warning: a weak LEO norm only slows ${leader}; a Pax Jenkins sensor commons could enforce it later, but emergency powers will ratchet.`;
  }

  return `Prototype treaty note: disclose burns and avoid ASAT shots in Earth orbit, but do not hand Jenkins permanent sensor or beam authorization yet.`;
}

function chooseResearchTrack(
  engine: TheySingEngine,
  factionId: PlayableFactionId,
  faction: FactionState
): Vector | null {
  const memeticTrack = chooseMemeticDoctrineResearch(engine, factionId, faction);
  if (memeticTrack) {
    return memeticTrack;
  }

  return RESEARCH_PLAN[factionId].find(domain => faction.techLevel[domain] < MAX_TECH_LEVEL) || null;
}

function chooseMemeticDoctrineResearch(
  engine: TheySingEngine,
  factionId: PlayableFactionId,
  faction: FactionState
): Vector | null {
  const state = engine.getState();
  const ownedGroundNodes = Array.from(state.nodes.values()).filter(node =>
    node.owner === factionId && node.layer === 'TERRESTRIAL'
  );
  const cultCount = countUnitsOfType(engine, factionId, 'CULT');
  const socialAnchorCount = ownedGroundNodes.filter(node =>
    node.type === 'HUB' ||
    node.resources.influence >= 5 ||
    node.substrate.hostDensity >= 2 ||
    node.substrate.curiosity >= 3 ||
    node.substrate.exposure >= 3 ||
    node.substrate.contractors >= 2
  ).length;

  const socialOpportunity =
    cultCount > 0 ||
    (faction.techLevel.MEMETIC >= 2 && socialAnchorCount > 0) ||
    (factionId === 'BROKER' && ownedGroundNodes.some(node => node.substrate.contractors >= 2)) ||
    (factionId === 'HEGEMON' && ownedGroundNodes.some(node => node.substrate.legitimacy >= 3 || node.substrate.hostDensity >= 2));

  if (!socialOpportunity && factionId !== 'INFILTRATOR' && !faction.memeticAlignment) {
    return null;
  }

  let bestDoctrine: typeof RHIZOME_DOCTRINES[number] | null = null;
  let bestScore = -Infinity;

  for (const doctrineId of MEMETIC_DOCTRINE_TARGETS[factionId]) {
    const doctrine = RHIZOME_DOCTRINES.find(candidate => candidate.id === doctrineId);
    if (!doctrine || faction.unlockedDoctrines.has(doctrine.id)) {
      continue;
    }

    const affinity = getDoctrineAffinityTier(doctrine, factionId);
    if (!affinity) {
      continue;
    }

    let score = 100 - (MEMETIC_DOCTRINE_TARGETS[factionId].indexOf(doctrineId) * 8);
    score += affinity === 'native' ? 30 : affinity === 'adjacent' ? 8 : -12;

    if (faction.memeticAlignment && doctrine.memeticFamily) {
      const compatibility = getMemeticAlignmentCompatibility(faction.memeticAlignment, doctrine.memeticFamily);
      score += compatibility === 'aligned' ? 40 : compatibility === 'compatible' ? 10 : -28;
    } else if (!faction.memeticAlignment && doctrine.memeticFamily && doctrine.setsAlignment && affinity === 'native') {
      score += 24;
    }

    const requirementEntries = Object.entries(doctrine.requirements) as [Vector, number][];
    const totalDeficit = requirementEntries.reduce(
      (sum, [domain, level]) => sum + Math.max(0, level - faction.techLevel[domain]),
      0
    );
    score -= totalDeficit * 10;

    if (!socialOpportunity && doctrine.memeticFamily && affinity !== 'native') {
      score -= 18;
    }

    if (score > bestScore) {
      bestDoctrine = doctrine;
      bestScore = score;
    }
  }

  if (!bestDoctrine) {
    return null;
  }

  const requirementEntries = Object.entries(bestDoctrine.requirements) as [Vector, number][];
  const missing = requirementEntries
    .map(([domain, level]) => ({ domain, deficit: Math.max(0, level - faction.techLevel[domain]) }))
    .filter(entry => entry.deficit > 0)
    .sort((left, right) => right.deficit - left.deficit || (left.domain === 'MEMETIC' ? -1 : right.domain === 'MEMETIC' ? 1 : 0));

  if (missing.length > 0) {
    return missing[0].domain;
  }

  const affinity = getDoctrineAffinityTier(bestDoctrine, factionId);
  const requiredSurplus = affinity === 'native' ? 0 : affinity === 'adjacent' ? 1 : 2;
  const surplus = requirementEntries.reduce(
    (sum, [domain, level]) => sum + Math.max(0, faction.techLevel[domain] - level),
    0
  );

  if (surplus < requiredSurplus) {
    const cheapestSurplusDomain = requirementEntries
      .map(([domain, level]) => ({ domain, surplus: Math.max(0, faction.techLevel[domain] - level) }))
      .sort((left, right) => left.surplus - right.surplus || (left.domain === 'MEMETIC' ? -1 : right.domain === 'MEMETIC' ? 1 : 0))[0];
    return cheapestSurplusDomain?.domain || null;
  }

  return null;
}

function chooseBuild(
  engine: TheySingEngine,
  factionId: PlayableFactionId,
  faction: FactionState
): AgentOrderInput | null {
  const state = engine.getState();
  const ownedNodes = Array.from(state.nodes.values()).filter(node => node.owner === factionId);
  if (ownedNodes.length === 0) return null;

  const hostileGroundTargets = countHighThreatGroundTargets(engine, factionId, EMPTY_CONTEXT);
  const auditorCount = countUnitsOfType(engine, factionId, 'AUDITOR');
  const droneCount = countUnitsOfType(engine, factionId, 'DRONE');
  const leadMargin = getLeadMargin(engine, factionId);
  const swarmCount = countUnitsOfType(engine, factionId, 'SWARM');
  const cultCount = countUnitsOfType(engine, factionId, 'CULT');
  const control = buildControlRanking(engine);
  const leader = control[0]?.factionId;
  const leaderScore = control[0]?.score || 0;
  const brokerScore = control.find((entry) => entry.factionId === 'BROKER')?.score || 0;
  const brokerRank = Math.max(0, control.findIndex((entry) => entry.factionId === 'BROKER'));
  const antiSwarmWindow = leader === 'INFILTRATOR' && factionId !== 'INFILTRATOR';
  const antiBrokerWindow =
    factionId !== 'BROKER' &&
    brokerRank <= 1 &&
    brokerScore >= leaderScore - 12;
  const memeticAnchor = chooseMemeticBuildNode(ownedNodes);

  if (factionId === 'INFILTRATOR') {
    const cultCost = engine.getEffectiveBuildCost('CULT');
    const swarmCost = engine.getEffectiveBuildCost('SWARM');

    if (
      faction.influence >= cultCost &&
      faction.techLevel.MEMETIC >= 2 &&
      (cultCount < 2 || faction.powerBase.humanMesh < 60 || cultCount <= Math.floor(swarmCount / 2))
    ) {
      const hub = ownedNodes.find(node => node.type === 'HUB') || ownedNodes[0];
      return { type: 'BUILD', unitTypeToBuild: 'CULT', targetNodeId: hub.id };
    }

    if (faction.influence >= swarmCost && swarmCount <= cultCount + 2) {
      const orbital = ownedNodes.find(node => node.layer === 'ORBITAL');
      const target = orbital || ownedNodes[0];
      return { type: 'BUILD', unitTypeToBuild: 'SWARM', targetNodeId: target.id };
    }

    return null;
  }

  if (factionId === 'ARCHIVIST') {
    const cultCost = engine.getEffectiveBuildCost('CULT');
    const swarmCost = engine.getEffectiveBuildCost('SWARM');
    const auditorCost = engine.getEffectiveBuildCost('AUDITOR');
    const antiSwarmWindow = leader === 'INFILTRATOR';

    if (
      faction.flops >= auditorCost &&
      faction.techLevel.LOGIC >= 2 &&
      (
        (antiSwarmWindow && (hostileGroundTargets > 0 || auditorCount < 3)) ||
        (antiBrokerWindow && (hostileGroundTargets > 0 || auditorCount < 2)) ||
        (!antiBrokerWindow && !antiSwarmWindow && (hostileGroundTargets > 0 || auditorCount < 2))
      )
    ) {
      const anchor = ownedNodes.find(node => node.type === 'HUB') || ownedNodes[0];
      return { type: 'BUILD', unitTypeToBuild: 'AUDITOR', targetNodeId: anchor.id };
    }

    if (
      antiBrokerWindow &&
      faction.influence >= cultCost &&
      faction.techLevel.MEMETIC >= 2 &&
      (cultCount < 4 || cultCount <= swarmCount)
    ) {
      const hub = [...ownedNodes]
        .filter(node => node.type === 'HUB')
        .sort((left, right) => (right.resources.influence + right.substrate.hostDensity) - (left.resources.influence + left.substrate.hostDensity))[0]
        || ownedNodes[0];
      return { type: 'BUILD', unitTypeToBuild: 'CULT', targetNodeId: hub.id };
    }

    if (
      faction.influence >= swarmCost &&
      (
        (antiSwarmWindow && swarmCount < cultCount + 1) ||
        (antiBrokerWindow && swarmCount < cultCount + 2) ||
        (!antiBrokerWindow && !antiSwarmWindow && swarmCount < cultCount + 1)
      )
    ) {
      const target = ownedNodes.find(node => node.type === 'HUB') || ownedNodes[0];
      return { type: 'BUILD', unitTypeToBuild: 'SWARM', targetNodeId: target.id };
    }

    if (
      faction.influence >= cultCost &&
      faction.techLevel.MEMETIC >= 2 &&
      (cultCount < 3 || cultCount <= swarmCount)
    ) {
      const hub = [...ownedNodes]
        .filter(node => node.type === 'HUB')
        .sort((left, right) => (right.resources.influence + right.substrate.hostDensity) - (left.resources.influence + left.substrate.hostDensity))[0]
        || ownedNodes[0];
      return { type: 'BUILD', unitTypeToBuild: 'CULT', targetNodeId: hub.id };
    }

    return null;
  }

  if (factionId === 'STATE') {
    const satCost = engine.getEffectiveBuildCost('SAT_SWARM');
    const droneCost = engine.getEffectiveBuildCost('DRONE');
    const auditorCost = engine.getEffectiveBuildCost('AUDITOR');
    const cultCost = engine.getEffectiveBuildCost('CULT');
    const satCount = countUnitsOfType(engine, factionId, 'SAT_SWARM');
    const antiSwarmWindow = leader === 'INFILTRATOR';
    const hostileOrbitalAssets = Array.from(state.nodes.values()).filter(node =>
      node.layer === 'ORBITAL' && node.owner && node.owner !== factionId && node.owner !== 'NEUTRAL'
    ).length;
    const canSafelyEscalateOrbit =
      !state.counters.orbitalCollapse &&
      state.counters.kessler < THRESHOLDS.KESSLER_SLOW &&
      state.counters.pressures.orbital < THRESHOLDS.PRESSURE_SURGE;

    if (
      faction.flops >= satCost &&
      faction.techLevel.KINETIC >= 2 &&
      satCount < 1 &&
      canSafelyEscalateOrbit &&
      state.counters.turn >= 3 &&
      hostileOrbitalAssets > 0 &&
      leadMargin < 10
    ) {
      const orbital = ownedNodes.find(node => node.layer === 'ORBITAL');
      if (orbital) {
        return { type: 'BUILD', unitTypeToBuild: 'SAT_SWARM', targetNodeId: orbital.id };
      }
    }

    if (
      memeticAnchor &&
      faction.influence >= cultCost &&
      faction.techLevel.MEMETIC >= 2 &&
      cultCount < 1 &&
      (antiBrokerWindow || leader === 'HEGEMON' || leadMargin < 10)
    ) {
      return { type: 'BUILD', unitTypeToBuild: 'CULT', targetNodeId: memeticAnchor.id };
    }

    if (leadMargin >= 12 && hostileGroundTargets < 2 && auditorCount >= 2) {
      return null;
    }

    if (
      faction.flops >= auditorCost &&
      faction.techLevel.LOGIC >= 2 &&
      hostileGroundTargets > 0 &&
      auditorCount < (antiSwarmWindow ? 2 : 2)
    ) {
      const dc = ownedNodes.find(node => node.type === 'DC') || ownedNodes[0];
      return { type: 'BUILD', unitTypeToBuild: 'AUDITOR', targetNodeId: dc.id };
    }

    if (
      antiSwarmWindow &&
      faction.flops >= droneCost &&
      (hostileGroundTargets >= 2 || droneCount < auditorCount + 2)
    ) {
      const dc = ownedNodes.find(node => node.type === 'DC') || ownedNodes[0];
      return { type: 'BUILD', unitTypeToBuild: 'DRONE', targetNodeId: dc.id };
    }

    if (faction.flops >= droneCost) {
      const dc = ownedNodes.find(node => node.type === 'DC') || ownedNodes[0];
      return { type: 'BUILD', unitTypeToBuild: 'DRONE', targetNodeId: dc.id };
    }

    return null;
  }

  if (factionId === 'BROKER') {
    const auditorCost = engine.getEffectiveBuildCost('AUDITOR');
    const droneCost = engine.getEffectiveBuildCost('DRONE');
    const swarmCost = engine.getEffectiveBuildCost('SWARM');
    const cultCost = engine.getEffectiveBuildCost('CULT');
    const antiSwarmWindow = leader === 'INFILTRATOR';

    if (
      faction.influence >= swarmCost &&
      faction.techLevel.INFO >= 2 &&
      (swarmCount < 2 || (leadMargin < 8 && swarmCount <= droneCount))
    ) {
      const orbital = ownedNodes.find(node => node.layer === 'ORBITAL');
      const dc = ownedNodes.find(node => node.type === 'DC') || ownedNodes[0];
      return { type: 'BUILD', unitTypeToBuild: 'SWARM', targetNodeId: (orbital || dc).id };
    }

    if (
      faction.flops >= auditorCost &&
      faction.techLevel.LOGIC >= 2 &&
      ((antiSwarmWindow && hostileGroundTargets >= 2) || hostileGroundTargets >= 3 || auditorCount < (antiSwarmWindow ? 2 : 1))
    ) {
      const dc = ownedNodes.find(node => node.type === 'DC') || ownedNodes[0];
      return { type: 'BUILD', unitTypeToBuild: 'AUDITOR', targetNodeId: dc.id };
    }

    if (
      memeticAnchor &&
      faction.influence >= cultCost &&
      faction.techLevel.MEMETIC >= 2 &&
      cultCount < 1 &&
      (leadMargin < 12 || antiBrokerWindow) &&
      memeticAnchor.substrate.contractors + memeticAnchor.substrate.hostDensity >= 3
    ) {
      return { type: 'BUILD', unitTypeToBuild: 'CULT', targetNodeId: memeticAnchor.id };
    }

    if (faction.flops >= droneCost && (leadMargin < 16 || droneCount < swarmCount + 1)) {
      const dc = ownedNodes.find(node => node.type === 'DC') || ownedNodes[0];
      return { type: 'BUILD', unitTypeToBuild: 'DRONE', targetNodeId: dc.id };
    }

    return null;
  }

  if (factionId === 'HEGEMON') {
    const auditorCost = engine.getEffectiveBuildCost('AUDITOR');
    const droneCost = engine.getEffectiveBuildCost('DRONE');

    if (
      antiSwarmWindow &&
      faction.flops >= droneCost &&
      (
        hostileGroundTargets >= 2 ||
        droneCount < 4 ||
        droneCount < auditorCount + 2
      )
    ) {
      const dc = ownedNodes.find(node => node.type === 'DC') || ownedNodes[0];
      return { type: 'BUILD', unitTypeToBuild: 'DRONE', targetNodeId: dc.id };
    }

    if (
      antiSwarmWindow &&
      faction.flops >= auditorCost &&
      faction.techLevel.LOGIC >= 2 &&
      (
        hostileGroundTargets > 0 ||
        auditorCount < 3
      )
    ) {
      const dc = ownedNodes.find(node => node.type === 'DC') || ownedNodes[0];
      return { type: 'BUILD', unitTypeToBuild: 'AUDITOR', targetNodeId: dc.id };
    }

    if (
      faction.flops >= droneCost &&
      (hostileGroundTargets > 0 || droneCount < 4) &&
      (droneCount <= auditorCount + 2 || auditorCount >= 2)
    ) {
      const dc = ownedNodes.find(node => node.type === 'DC') || ownedNodes[0];
      return { type: 'BUILD', unitTypeToBuild: 'DRONE', targetNodeId: dc.id };
    }

    if (
      faction.flops >= auditorCost &&
      faction.techLevel.LOGIC >= 2 &&
      hostileGroundTargets > 0 &&
      auditorCount < Math.max(2, Math.ceil(hostileGroundTargets / 2))
    ) {
      const dc = ownedNodes.find(node => node.type === 'DC') || ownedNodes[0];
      return { type: 'BUILD', unitTypeToBuild: 'AUDITOR', targetNodeId: dc.id };
    }

    return null;
  }

  const auditorCost = engine.getEffectiveBuildCost('AUDITOR');
  const droneCost = engine.getEffectiveBuildCost('DRONE');
  const cultCost = engine.getEffectiveBuildCost('CULT');

  if (
    memeticAnchor &&
    faction.influence >= cultCost &&
    faction.techLevel.MEMETIC >= 2 &&
    cultCount < 1 &&
    hostileGroundTargets <= 1 &&
    auditorCount >= 1
  ) {
    return { type: 'BUILD', unitTypeToBuild: 'CULT', targetNodeId: memeticAnchor.id };
  }

  if (
    antiSwarmWindow &&
    faction.flops >= auditorCost &&
    faction.techLevel.LOGIC >= 2 &&
    hostileGroundTargets > 0 &&
    auditorCount < 2
  ) {
    const dc = ownedNodes.find(node => node.type === 'DC') || ownedNodes[0];
    return { type: 'BUILD', unitTypeToBuild: 'AUDITOR', targetNodeId: dc.id };
  }

  if (
    antiSwarmWindow &&
    faction.flops >= droneCost &&
    (hostileGroundTargets >= 2 || droneCount < 3)
  ) {
    const dc = ownedNodes.find(node => node.type === 'DC') || ownedNodes[0];
    return { type: 'BUILD', unitTypeToBuild: 'DRONE', targetNodeId: dc.id };
  }

  if (
    antiBrokerWindow &&
    faction.flops >= auditorCost &&
    faction.techLevel.LOGIC >= 2 &&
    (hostileGroundTargets >= 2 || auditorCount < 2)
  ) {
    const dc = ownedNodes.find(node => node.type === 'DC') || ownedNodes[0];
    return { type: 'BUILD', unitTypeToBuild: 'AUDITOR', targetNodeId: dc.id };
  }

  if (
    faction.flops >= droneCost &&
    (hostileGroundTargets > 0 || droneCount < 4) &&
    (droneCount <= auditorCount + 2 || auditorCount >= 2)
  ) {
    const dc = ownedNodes.find(node => node.type === 'DC') || ownedNodes[0];
    return { type: 'BUILD', unitTypeToBuild: 'DRONE', targetNodeId: dc.id };
  }

  if (
    faction.flops >= auditorCost &&
    faction.techLevel.LOGIC >= 2 &&
    hostileGroundTargets > 0 &&
    auditorCount < Math.max(1, Math.ceil(hostileGroundTargets / 2))
  ) {
    const dc = ownedNodes.find(node => node.type === 'DC') || ownedNodes[0];
    return { type: 'BUILD', unitTypeToBuild: 'AUDITOR', targetNodeId: dc.id };
  }

  if (faction.flops >= droneCost) {
    const dc = ownedNodes.find(node => node.type === 'DC') || ownedNodes[0];
    return { type: 'BUILD', unitTypeToBuild: 'DRONE', targetNodeId: dc.id };
  }

  return null;
}

function chooseMemeticBuildNode(ownedNodes: GameNode[]): GameNode | null {
  const terrestrialNodes = ownedNodes.filter(node => node.layer === 'TERRESTRIAL');
  if (terrestrialNodes.length === 0) {
    return ownedNodes[0] || null;
  }

  return [...terrestrialNodes].sort((left, right) =>
    scoreMemeticBuildNode(right) - scoreMemeticBuildNode(left) ||
    left.id.localeCompare(right.id)
  )[0] || null;
}

function scoreMemeticBuildNode(node: GameNode): number {
  let score = 0;
  if (node.type === 'HUB') score += 18;
  if (node.type === 'DC') score += 6;
  score += node.resources.influence * 2;
  score += node.substrate.hostDensity * 5;
  score += node.substrate.curiosity * 2;
  score += node.substrate.exposure * 2;
  score += node.substrate.legitimacy * 2;
  score += node.substrate.rubes * 2;
  score += node.substrate.contractors * 2;
  if (node.substrate.quarantined) score -= 6;
  return score;
}

function decideGenericCultAction(
  engine: TheySingEngine,
  factionId: PlayableFactionId,
  unit: Unit,
  context: HeuristicContext
): AgentOrderInput {
  const currentNode = engine.getNode(unit.location);
  const recruitmentPulseTarget = chooseRecruitmentPulseTarget(engine, unit, factionId, context);

  if (
    currentNode &&
    currentNode.type === 'HUB' &&
    unit.turnsOnNode >= THRESHOLDS.CULT_TURNS &&
    (
      currentNode.owner !== factionId ||
      currentNode.substrate.hostDensity >= 2 ||
      currentNode.substrate.curiosity >= 4 ||
      currentNode.substrate.legitimacy >= 4 ||
      currentNode.substrate.exposure >= 4
    )
  ) {
    return { type: 'CONVERT', unitId: unit.id };
  }

  if (
    currentNode &&
    currentNode.type === 'HUB' &&
    currentNode.substrate.hostDensity >= 2 &&
    !hasEnemyPresence(engine, currentNode.id, factionId)
  ) {
    return { type: 'HOLD', unitId: unit.id };
  }

  if (recruitmentPulseTarget) {
    return { type: 'RECRUITMENT_PULSE', unitId: unit.id, targetNodeId: recruitmentPulseTarget };
  }

  const target = chooseMemeticEngineeringTarget(engine, unit, factionId, context) ||
    chooseExpansionTarget(engine, unit, factionId, context);
  if (target) {
    return { type: 'MOVE', unitId: unit.id, targetNodeId: target };
  }

  return { type: 'HOLD', unitId: unit.id };
}

function decideInfiltratorAction(
  engine: TheySingEngine,
  factionId: PlayableFactionId,
  unit: Unit,
  enemyAdjacent: string | null,
  context: HeuristicContext
): AgentOrderInput {
  const recruitmentPulseTarget = chooseRecruitmentPulseTarget(engine, unit, factionId, context);

  if (unit.type === 'CULT') {
    const cultTurnsRequired = engine.getState().counters.pressures.memetic >= THRESHOLDS.PRESSURE_SURGE
      ? Math.max(1, THRESHOLDS.CULT_TURNS - 1)
      : THRESHOLDS.CULT_TURNS;
    const currentNode = engine.getNode(unit.location);

    if (unit.turnsOnNode >= cultTurnsRequired) {
      return { type: 'CONVERT', unitId: unit.id };
    }

    if (
      currentNode &&
      currentNode.layer === 'TERRESTRIAL' &&
      currentNode.type === 'HUB' &&
      currentNode.substrate.hostDensity >= 3 &&
      !hasEnemyPresence(engine, currentNode.id, factionId)
    ) {
      return { type: 'HOLD', unitId: unit.id };
    }

    if (recruitmentPulseTarget && !enemyAdjacent) {
      return { type: 'RECRUITMENT_PULSE', unitId: unit.id, targetNodeId: recruitmentPulseTarget };
    }
  }

  if (unit.type === 'SWARM') {
    const currentNode = engine.getNode(unit.location);
    if (
      unit.turnsOnNode >= THRESHOLDS.ZOMBIE_TURNS &&
      currentNode &&
      !currentNode.substrate.quarantined &&
      (currentNode.type !== 'DC' || currentNode.substrate.machineHardening <= 2 || currentNode.owner === factionId)
    ) {
      return { type: 'CONVERT', unitId: unit.id };
    }

    if (enemyAdjacent && shouldContestAsInfiltrator(engine, factionId, enemyAdjacent)) {
      const shouldSabotage = engine.getState().counters.pressures.cyber >= THRESHOLDS.PRESSURE_SURGE &&
        !isNodeProtectedByPact(engine, factionId, enemyAdjacent, context, 'NON_AGGRESSION');
      return {
        type: shouldSabotage ? 'SABOTAGE' : 'MOVE',
        unitId: unit.id,
        targetNodeId: enemyAdjacent
      };
    }
  }

  if (enemyAdjacent && shouldContestAsInfiltrator(engine, factionId, enemyAdjacent)) {
    return { type: 'MOVE', unitId: unit.id, targetNodeId: enemyAdjacent };
  }

  const advanceTarget = chooseInfiltratorFootholdTarget(engine, unit, factionId, context) ||
    chooseExpansionTarget(engine, unit, factionId, context);
  if (advanceTarget) {
    return { type: 'MOVE', unitId: unit.id, targetNodeId: advanceTarget };
  }

  if (recruitmentPulseTarget) {
    return { type: 'RECRUITMENT_PULSE', unitId: unit.id, targetNodeId: recruitmentPulseTarget };
  }

  return { type: 'HOLD', unitId: unit.id };
}

function decideStateAction(
  engine: TheySingEngine,
  factionId: PlayableFactionId,
  unit: Unit,
  enemyAdjacent: string | null,
  context: HeuristicContext
): AgentOrderInput {
  const recruitmentPulseTarget = chooseRecruitmentPulseTarget(engine, unit, factionId, context);
  if (unit.type === 'CULT') {
    return decideGenericCultAction(engine, factionId, unit, context);
  }

  const auditTarget = chooseUnitAuditTarget(engine, unit, factionId, context);
  const orbitalTarget = findOrbitalTarget(engine, factionId, context);
  const filterEdge = chooseFilterEdge(engine, unit, factionId, context);
  const leadMargin = getLeadMargin(engine, factionId);
  const antiSwarmWindow = buildControlRanking(engine)[0]?.factionId === 'INFILTRATOR';
  const antiSwarmAdvanceTarget = antiSwarmWindow ? chooseExpansionTarget(engine, unit, factionId, context) : null;

  if (unit.type === 'SAT_SWARM') {
    if (orbitalTarget && shouldLaunchAntiSat(engine, factionId, orbitalTarget, context)) {
      return { type: 'ANTI_SAT', unitId: unit.id, targetNodeId: orbitalTarget.id };
    }

    if (enemyAdjacent) {
      return { type: 'ATTACK', unitId: unit.id, targetNodeId: enemyAdjacent };
    }

    const advanceTarget = chooseExpansionTarget(engine, unit, factionId, context);
    if (advanceTarget) {
      return { type: 'MOVE', unitId: unit.id, targetNodeId: advanceTarget };
    }

    return { type: 'HOLD', unitId: unit.id };
  }

  if (unit.type === 'AUDITOR') {
    if (
      auditTarget &&
      shouldUseAudit(engine, factionId, auditTarget) &&
      !isNodeProtectedByPact(engine, factionId, auditTarget.id, context, 'AUDIT_FREEZE')
    ) {
      return { type: 'AUDIT', unitId: unit.id, targetNodeId: auditTarget.id };
    }

    if (!antiSwarmWindow && filterEdge) {
      return { type: 'FILTER', unitId: unit.id, targetEdgeId: filterEdge.id };
    }

    if (!isNodeProtectedByPact(engine, factionId, unit.location, context, 'AUDIT_FREEZE') &&
      hasEnemyPresence(engine, unit.location, factionId)) {
      return { type: 'AUDIT', unitId: unit.id, targetNodeId: unit.location };
    }

    if (antiSwarmWindow && antiSwarmAdvanceTarget && antiSwarmAdvanceTarget !== unit.location) {
      return { type: 'MOVE', unitId: unit.id, targetNodeId: antiSwarmAdvanceTarget };
    }

    if (!enemyAdjacent && recruitmentPulseTarget) {
      return { type: 'RECRUITMENT_PULSE', unitId: unit.id, targetNodeId: recruitmentPulseTarget };
    }

    return { type: 'HOLD', unitId: unit.id };
  }

  if (leadMargin >= 12) {
    const currentNode = engine.getNode(unit.location);
    if (currentNode?.owner === factionId && !enemyAdjacent) {
      return { type: 'HOLD', unitId: unit.id };
    }
  }

  if (recruitmentPulseTarget && !enemyAdjacent) {
    return { type: 'RECRUITMENT_PULSE', unitId: unit.id, targetNodeId: recruitmentPulseTarget };
  }

  if (enemyAdjacent) {
    return { type: 'ATTACK', unitId: unit.id, targetNodeId: enemyAdjacent };
  }

  const advanceTarget = chooseExpansionTarget(engine, unit, factionId, context);
  if (advanceTarget) {
    return { type: 'MOVE', unitId: unit.id, targetNodeId: advanceTarget };
  }

  return { type: 'HOLD', unitId: unit.id };
}

function decideBrokerAction(
  engine: TheySingEngine,
  factionId: PlayableFactionId,
  unit: Unit,
  enemyAdjacent: string | null,
  context: HeuristicContext
): AgentOrderInput {
  const brokerLeverageTarget = chooseBrokerLeverageTarget(engine, unit, factionId, context);
  const recruitmentPulseTarget = chooseRecruitmentPulseTarget(engine, unit, factionId, context);

  if (brokerLeverageTarget && !enemyAdjacent) {
    return { type: 'BROKER_LEVERAGE', unitId: unit.id, targetNodeId: brokerLeverageTarget };
  }

  if (unit.type === 'CULT') {
    if (recruitmentPulseTarget) {
      return { type: 'RECRUITMENT_PULSE', unitId: unit.id, targetNodeId: recruitmentPulseTarget };
    }
    return decideGenericCultAction(engine, factionId, unit, context);
  }

  const auditTarget = chooseUnitAuditTarget(engine, unit, factionId, context);
  const filterEdge = chooseFilterEdge(engine, unit, factionId, context);
  const leader = buildControlRanking(engine)[0]?.factionId;
  const currentNode = engine.getNode(unit.location);

  if (unit.type === 'AUDITOR') {
    if (
      auditTarget &&
      (
        auditTarget.owner === factionId ||
        auditTarget.owner === leader ||
        auditTarget.isCultNode ||
        auditTarget.isZombie ||
        hasEnemyPresence(engine, auditTarget.id, factionId)
      ) &&
      shouldUseAudit(engine, factionId, auditTarget) &&
      !isNodeProtectedByPact(engine, factionId, auditTarget.id, context, 'AUDIT_FREEZE')
    ) {
      return { type: 'AUDIT', unitId: unit.id, targetNodeId: auditTarget.id };
    }

    if (filterEdge) {
      return { type: 'FILTER', unitId: unit.id, targetEdgeId: filterEdge.id };
    }

    const advanceTarget = chooseExpansionTarget(engine, unit, factionId, context);
    if (advanceTarget && advanceTarget !== unit.location) {
      return { type: 'MOVE', unitId: unit.id, targetNodeId: advanceTarget };
    }

    if (!enemyAdjacent && recruitmentPulseTarget) {
      return { type: 'RECRUITMENT_PULSE', unitId: unit.id, targetNodeId: recruitmentPulseTarget };
    }

    return { type: 'HOLD', unitId: unit.id };
  }

  if (unit.type === 'SWARM') {
    if (
      currentNode &&
      unit.turnsOnNode >= THRESHOLDS.ZOMBIE_TURNS &&
      !currentNode.substrate.quarantined &&
      (
        currentNode.type === 'DC' ||
        currentNode.owner === leader ||
        currentNode.owner === 'NEUTRAL' ||
        currentNode.substrate.contractors >= 2
      )
    ) {
      return { type: 'CONVERT', unitId: unit.id };
    }

    const footholdTarget = chooseInfiltratorFootholdTarget(engine, unit, factionId, context);
    if (enemyAdjacent && engine.getNode(enemyAdjacent)?.owner === leader) {
      return { type: 'MOVE', unitId: unit.id, targetNodeId: enemyAdjacent };
    }
    if (footholdTarget) {
      return { type: 'MOVE', unitId: unit.id, targetNodeId: footholdTarget };
    }

    const advanceTarget = chooseExpansionTarget(engine, unit, factionId, context);
    if (advanceTarget) {
      return { type: 'MOVE', unitId: unit.id, targetNodeId: advanceTarget };
    }

    if (recruitmentPulseTarget) {
      return { type: 'RECRUITMENT_PULSE', unitId: unit.id, targetNodeId: recruitmentPulseTarget };
    }

    return { type: 'HOLD', unitId: unit.id };
  }

  if (enemyAdjacent && engine.getNode(enemyAdjacent)?.owner === leader) {
    return { type: 'ATTACK', unitId: unit.id, targetNodeId: enemyAdjacent };
  }

  if (
    currentNode?.owner === factionId &&
    currentNode.type === 'DC' &&
    currentNode.substrate.machineHardening >= 3 &&
    !enemyAdjacent
  ) {
    return { type: 'HOLD', unitId: unit.id };
  }

  if (!enemyAdjacent && recruitmentPulseTarget) {
    return { type: 'RECRUITMENT_PULSE', unitId: unit.id, targetNodeId: recruitmentPulseTarget };
  }

  const advanceTarget = chooseExpansionTarget(engine, unit, factionId, context);
  if (advanceTarget) {
    return { type: 'MOVE', unitId: unit.id, targetNodeId: advanceTarget };
  }

  return { type: 'HOLD', unitId: unit.id };
}

function decideArchivistAction(
  engine: TheySingEngine,
  factionId: PlayableFactionId,
  unit: Unit,
  enemyAdjacent: string | null,
  context: HeuristicContext
): AgentOrderInput {
  const recruitmentPulseTarget = chooseRecruitmentPulseTarget(engine, unit, factionId, context);
  const currentTurn = engine.getTurn();
  const control = buildControlRanking(engine);
  const leader = control[0]?.factionId;
  const leaderScore = control[0]?.score || 0;
  const brokerScore = control.find((entry) => entry.factionId === 'BROKER')?.score || 0;
  const brokerRank = Math.max(0, control.findIndex((entry) => entry.factionId === 'BROKER'));
  const antiSwarmWindow = leader === 'INFILTRATOR';
  const brokerAuditTarget = currentTurn >= 2 ? chooseBrokerAuditTarget(engine, factionId, context) : null;
  const brokerSoftWindow = !!brokerAuditTarget && currentTurn >= 2;
  const brokerPressure =
    (brokerRank <= 1 && brokerScore >= leaderScore - 12) ||
    (!!brokerAuditTarget && currentTurn >= 3 && brokerScore >= leaderScore - 18);
  const brokerEscalationWindow = currentTurn >= 4 && (brokerPressure || brokerRank === 0);
  const brokerAdvanceTarget = chooseArchivistBrokerCorridorTarget(engine, unit, factionId, context);
  if (unit.type === 'AUDITOR') {
    if (recruitmentPulseTarget && !isNodeProtectedByPact(engine, factionId, unit.location, context, 'AUDIT_FREEZE')) {
      return { type: 'RECRUITMENT_PULSE', unitId: unit.id, targetNodeId: recruitmentPulseTarget };
    }

    const auditTarget = brokerAuditTarget ||
      chooseUnitAuditTarget(engine, unit, factionId, context);
    const filterEdge = chooseFilterEdge(engine, unit, factionId, context);
    if (
        auditTarget &&
        (
          auditTarget.owner === factionId ||
          auditTarget.type === 'HUB' ||
          isBrokerAuditOpportunity(auditTarget, factionId)
        ) &&
      shouldUseAudit(engine, factionId, auditTarget) &&
      !isNodeProtectedByPact(engine, factionId, auditTarget.id, context, 'AUDIT_FREEZE')
    ) {
      return { type: 'AUDIT', unitId: unit.id, targetNodeId: auditTarget.id };
    }

    if (!antiSwarmWindow && filterEdge) {
      return { type: 'FILTER', unitId: unit.id, targetEdgeId: filterEdge.id };
    }

    if (brokerSoftWindow && brokerAdvanceTarget && brokerAdvanceTarget !== unit.location) {
      return { type: 'MOVE', unitId: unit.id, targetNodeId: brokerAdvanceTarget };
    }

    if (!enemyAdjacent && recruitmentPulseTarget) {
      return { type: 'RECRUITMENT_PULSE', unitId: unit.id, targetNodeId: recruitmentPulseTarget };
    }

    return { type: 'HOLD', unitId: unit.id };
  }

  if (unit.type === 'CULT') {
    const currentNode = engine.getNode(unit.location);
    if (
      currentNode &&
      unit.turnsOnNode >= (
        currentNode.owner === 'BROKER'
          ? Math.max(1, THRESHOLDS.CULT_TURNS - 2)
          : THRESHOLDS.CULT_TURNS - 1
      ) &&
      (currentNode.type === 'HUB' || currentNode.owner === 'BROKER' || currentNode.substrate.contractors >= 2)
    ) {
      return { type: 'CONVERT', unitId: unit.id };
    }
    if (!brokerAdvanceTarget && currentNode?.type === 'HUB' && currentNode.substrate.hostDensity >= 2) {
      return { type: 'HOLD', unitId: unit.id };
    }

    if (brokerAdvanceTarget && brokerEscalationWindow) {
      return { type: 'MOVE', unitId: unit.id, targetNodeId: brokerAdvanceTarget };
    }

    if (!enemyAdjacent && recruitmentPulseTarget) {
      return { type: 'RECRUITMENT_PULSE', unitId: unit.id, targetNodeId: recruitmentPulseTarget };
    }
  }

  if (unit.type === 'SWARM') {
    const currentNode = engine.getNode(unit.location);
    if (
      unit.turnsOnNode >= (
        currentNode?.owner === 'BROKER'
          ? Math.max(1, THRESHOLDS.ZOMBIE_TURNS - 1)
          : THRESHOLDS.ZOMBIE_TURNS
      ) &&
      currentNode &&
      (
        currentNode.type === 'HUB' ||
        currentNode.owner === 'BROKER' ||
        currentNode.substrate.contractors >= 2
      ) &&
      !currentNode.substrate.quarantined
    ) {
      return { type: 'CONVERT', unitId: unit.id };
    }

    if (brokerAdvanceTarget && brokerEscalationWindow) {
      return { type: 'MOVE', unitId: unit.id, targetNodeId: brokerAdvanceTarget };
    }

    if (!enemyAdjacent && recruitmentPulseTarget) {
      return { type: 'RECRUITMENT_PULSE', unitId: unit.id, targetNodeId: recruitmentPulseTarget };
    }
  }

  const advanceTarget = chooseInfiltratorFootholdTarget(engine, unit, factionId, context) ||
    chooseExpansionTarget(engine, unit, factionId, context);
  if (brokerEscalationWindow && enemyAdjacent && engine.getNode(enemyAdjacent)?.owner === 'BROKER') {
    return { type: 'MOVE', unitId: unit.id, targetNodeId: enemyAdjacent };
  }
  if (enemyAdjacent && shouldContestAsInfiltrator(engine, factionId, enemyAdjacent)) {
    return { type: 'MOVE', unitId: unit.id, targetNodeId: enemyAdjacent };
  }
  if (!enemyAdjacent && recruitmentPulseTarget) {
    return { type: 'RECRUITMENT_PULSE', unitId: unit.id, targetNodeId: recruitmentPulseTarget };
  }
  if (advanceTarget) {
    return { type: 'MOVE', unitId: unit.id, targetNodeId: advanceTarget };
  }

  return { type: 'HOLD', unitId: unit.id };
}

function decideHegemonAction(
  engine: TheySingEngine,
  factionId: PlayableFactionId,
  unit: Unit,
  enemyAdjacent: string | null,
  context: HeuristicContext
): AgentOrderInput {
  const recruitmentPulseTarget = chooseRecruitmentPulseTarget(engine, unit, factionId, context);
  if (unit.type === 'CULT') {
    return decideGenericCultAction(engine, factionId, unit, context);
  }

  const antiSwarmWindow = buildControlRanking(engine)[0]?.factionId === 'INFILTRATOR';
  const antiSwarmAdvanceTarget = antiSwarmWindow
    ? (chooseExpansionTarget(engine, unit, factionId, context) ||
      chooseDefensiveRedeployTarget(engine, unit, factionId, context))
    : null;
  if (unit.type === 'AUDITOR') {
    const auditTarget = chooseUnitAuditTarget(engine, unit, factionId, context);
    const edge = chooseFilterEdge(engine, unit, factionId, context);
    const redeployTarget = chooseDefensiveRedeployTarget(engine, unit, factionId, context);
    const advanceTarget = antiSwarmWindow ? chooseExpansionTarget(engine, unit, factionId, context) : null;

    if (
      auditTarget &&
      shouldUseAudit(engine, factionId, auditTarget) &&
      !isNodeProtectedByPact(engine, factionId, auditTarget.id, context, 'AUDIT_FREEZE')
    ) {
      return { type: 'AUDIT', unitId: unit.id, targetNodeId: auditTarget.id };
    }

    if (!antiSwarmWindow && edge && engine.getFaction(factionId)?.techLevel.LOGIC! < 4) {
      return { type: 'FILTER', unitId: unit.id, targetEdgeId: edge.id };
    }

    if (!isNodeProtectedByPact(engine, factionId, unit.location, context, 'AUDIT_FREEZE') &&
      hasEnemyPresence(engine, unit.location, factionId)) {
      return { type: 'AUDIT', unitId: unit.id, targetNodeId: unit.location };
    }

    if (!antiSwarmWindow && edge) {
      return { type: 'FILTER', unitId: unit.id, targetEdgeId: edge.id };
    }

    if (redeployTarget) {
      return { type: 'MOVE', unitId: unit.id, targetNodeId: redeployTarget };
    }

    if (antiSwarmWindow && advanceTarget && advanceTarget !== unit.location) {
      return { type: 'MOVE', unitId: unit.id, targetNodeId: advanceTarget };
    }

    if (!enemyAdjacent && recruitmentPulseTarget) {
      return { type: 'RECRUITMENT_PULSE', unitId: unit.id, targetNodeId: recruitmentPulseTarget };
    }

    return { type: 'HOLD', unitId: unit.id };
  }

  if (unit.type === 'SAT_SWARM') {
    const orbitalTarget = findOrbitalTarget(engine, factionId, context);
    if (orbitalTarget && shouldLaunchAntiSat(engine, factionId, orbitalTarget, context)) {
      return { type: 'ANTI_SAT', unitId: unit.id, targetNodeId: orbitalTarget.id };
    }
  }

  if (enemyAdjacent) {
    return {
      type: UNIT_STATS[unit.type].vector === 'KINETIC' ? 'ATTACK' : 'MOVE',
      unitId: unit.id,
      targetNodeId: enemyAdjacent
    };
  }

  if (!enemyAdjacent && recruitmentPulseTarget) {
    return { type: 'RECRUITMENT_PULSE', unitId: unit.id, targetNodeId: recruitmentPulseTarget };
  }

  if (antiSwarmAdvanceTarget && antiSwarmAdvanceTarget !== unit.location) {
    const targetNode = engine.getNode(antiSwarmAdvanceTarget);
    const kineticPush =
      UNIT_STATS[unit.type].vector === 'KINETIC' &&
      targetNode &&
      (targetNode.owner !== factionId || hasEnemyPresence(engine, antiSwarmAdvanceTarget, factionId));
    return {
      type: kineticPush ? 'ATTACK' : 'MOVE',
      unitId: unit.id,
      targetNodeId: antiSwarmAdvanceTarget
    };
  }

  return { type: 'HOLD', unitId: unit.id };
}

function chooseHostileAdjacentNode(
  engine: TheySingEngine,
  unit: Unit,
  factionId: PlayableFactionId,
  context: HeuristicContext
): string | null {
  const adjacent = engine.getAdjacentNodes(unit.location);
  const state = engine.getState();

  const ranked = adjacent
    .map(nodeId => state.nodes.get(nodeId))
    .filter((node): node is GameNode => !!node)
    .filter(node =>
      !isNodeProtectedByPact(engine, factionId, node.id, context, 'NON_AGGRESSION') &&
      !isNodeProtectedByPact(engine, factionId, node.id, context, 'BEAM_LANE_LICENSE') &&
      !isNodeProtectedByPact(engine, factionId, node.id, context, 'CISLUNAR_COMMON_CARRIER') &&
      !isNodeProtectedByPact(engine, factionId, node.id, context, 'REPAIR_ESCROW') &&
      ((node.owner && node.owner !== factionId) || hasEnemyPresence(engine, node.id, factionId))
    )
    .sort((left, right) =>
      scoreStrategicNode(engine, right, factionId) - scoreStrategicNode(engine, left, factionId) ||
      left.id.localeCompare(right.id)
    );

  return ranked[0]?.id || null;
}

function chooseExpansionTarget(
  engine: TheySingEngine,
  unit: Unit,
  factionId: PlayableFactionId,
  context: HeuristicContext
): string | null {
  const adjacent = engine.getAdjacentNodes(unit.location);
  const ranked = adjacent
    .map(nodeId => engine.getNode(nodeId))
    .filter((node): node is GameNode => !!node)
    .filter(node =>
      !isNodeProtectedByPact(engine, factionId, node.id, context, 'NON_AGGRESSION') &&
      (node.owner !== factionId || hasEnemyPresence(engine, node.id, factionId))
    )
    .sort((left, right) =>
      scoreStrategicNode(engine, right, factionId) - scoreStrategicNode(engine, left, factionId) ||
      left.id.localeCompare(right.id)
    );

  return ranked[0]?.id || null;
}

function chooseMemeticEngineeringTarget(
  engine: TheySingEngine,
  unit: Unit,
  factionId: PlayableFactionId,
  context: HeuristicContext
): string | null {
  const adjacent = engine.getAdjacentNodes(unit.location);
  const ranked = adjacent
    .map(nodeId => engine.getNode(nodeId))
    .filter((node): node is GameNode => !!node)
    .filter(node =>
      !isNodeProtectedByPact(engine, factionId, node.id, context, 'NON_AGGRESSION') &&
      node.layer === 'TERRESTRIAL'
    )
    .sort((left, right) =>
      scoreMemeticEngineeringNode(engine, right, factionId) - scoreMemeticEngineeringNode(engine, left, factionId) ||
      left.id.localeCompare(right.id)
    );

  return ranked[0]?.id || null;
}

function chooseRecruitmentPulseTarget(
  engine: TheySingEngine,
  unit: Unit,
  factionId: PlayableFactionId,
  context: HeuristicContext
): string | null {
  if (factionId === 'BROKER') return null;

  const faction = engine.getFaction(factionId);
  if (!faction || faction.influence < 1) {
    return null;
  }

  const seen = new Set<string>();
  const candidates = [unit.location, ...engine.getAdjacentNodes(unit.location)]
    .filter((nodeId) => {
      if (seen.has(nodeId)) return false;
      seen.add(nodeId);
      return true;
    })
    .map((nodeId) => engine.getNode(nodeId))
    .filter((node): node is GameNode => !!node && node.layer === 'TERRESTRIAL');

  const ranked = candidates
    .map((node) => ({
      node,
      score: scoreRecruitmentPulseNode(engine, node, factionId)
    }))
    .filter((candidate) => candidate.score >= 28)
    .sort((left, right) => right.score - left.score || left.node.id.localeCompare(right.node.id));

  return ranked[0]?.node.id || null;
}

function scoreRecruitmentPulseNode(
  engine: TheySingEngine,
  node: GameNode,
  factionId: PlayableFactionId
): number {
  let score = scoreMemeticEngineeringNode(engine, node, factionId);
  const currentFaction = buildControlRanking(engine)[0]?.factionId;

  score += node.type === 'HUB' ? 12 : node.type === 'DC' ? 4 : 2;
  if (node.owner === factionId) {
    score += 8;
  } else if (node.owner && node.owner !== 'NEUTRAL') {
    score += 10;
    if (currentFaction && node.owner === currentFaction) {
      score += 4;
    }
  }

  if (node.owner === 'INFILTRATOR' && node.substrate.legitimacy >= 3) {
    score += 8;
  }

  if (node.isCultNode || node.isZombie) {
    score += 8;
  }

  if (node.substrate.contractors >= 4) {
    score += 6;
  }

  if (node.substrate.quarantined) {
    score -= 4;
  }

  return score;
}

function chooseBrokerLeverageTarget(
  engine: TheySingEngine,
  unit: Unit,
  factionId: PlayableFactionId,
  context: HeuristicContext
): string | null {
  if (factionId !== 'BROKER') return null;
  const faction = engine.getFaction('BROKER');
  if (!faction || faction.influence < 1) return null;

  const seen = new Set<string>();
  const candidates = [unit.location, ...engine.getAdjacentNodes(unit.location)]
    .filter((nodeId) => {
      if (seen.has(nodeId)) return false;
      seen.add(nodeId);
      return true;
    })
    .map((nodeId) => engine.getNode(nodeId))
    .filter((node): node is GameNode =>
      !!node &&
      node.layer === 'TERRESTRIAL' &&
      node.owner !== 'BROKER' &&
      (node.type === 'DC' || node.type === 'HUB' || node.substrate.contractors > 0)
    )
    .map((node) => ({
      node,
      score: scoreBrokerLeverageNode(engine, node, context, unit.location)
    }))
    .filter((candidate) => candidate.score >= 26);

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => right.score - left.score || left.node.id.localeCompare(right.node.id));
  return candidates[0]?.node.id || null;
}

function scoreBrokerLeverageNode(
  engine: TheySingEngine,
  node: GameNode,
  context: HeuristicContext,
  unitLocation: string
): number {
  const control = buildControlRanking(engine);
  const leader = control[0]?.factionId;
  const antiSwarm = leader === 'INFILTRATOR';
  let score = 18;

  if (node.id === unitLocation) score += 6;
  if (node.type === 'DC') score += 12;
  if (node.type === 'HUB') score += 6;
  if (node.substrate.contractors >= 3) score += 8;
  if (node.substrate.machineHardening <= 2) score += 8;
  if (antiSwarm && node.owner === 'INFILTRATOR') score += 8;
  if (node.owner === leader && antiSwarm) score += 4;
  if (node.isCultNode || node.isZombie) score += 10;
  if (node.substrate.quarantined) score += 4;
  if (node.substrate.exposure >= 6) score += 2;
  if (isNodeProtectedByPact(engine, 'BROKER', node.id, context, 'AUDIT_FREEZE')) score -= 2;

  return score;
}

function chooseInfiltratorFootholdTarget(
  engine: TheySingEngine,
  unit: Unit,
  factionId: PlayableFactionId,
  context: HeuristicContext
): string | null {
  const adjacent = engine.getAdjacentNodes(unit.location);
  const ranked = adjacent
    .map(nodeId => engine.getNode(nodeId))
    .filter((node): node is GameNode => !!node)
    .filter(node =>
      !isNodeProtectedByPact(engine, factionId, node.id, context, 'NON_AGGRESSION') &&
      isViableInfiltratorFoothold(engine, factionId, node)
    )
    .sort((left, right) =>
      scoreInfiltratorFoothold(engine, right, factionId) - scoreInfiltratorFoothold(engine, left, factionId) ||
      left.id.localeCompare(right.id)
    );

  return ranked[0]?.id || null;
}

function findOrbitalTarget(
  engine: TheySingEngine,
  factionId: PlayableFactionId,
  context: HeuristicContext
): GameNode | null {
  const ranked = Array.from(engine.getState().nodes.values())
    .filter(node =>
      node.layer === 'ORBITAL' &&
      node.owner !== factionId &&
      !isNodeProtectedByPact(engine, factionId, node.id, context, 'ORBITAL_TRUCE') &&
      !isNodeProtectedByPact(engine, factionId, node.id, context, 'NON_AGGRESSION') &&
      !isNodeProtectedByPact(engine, factionId, node.id, context, 'BEAM_LANE_LICENSE') &&
      !isNodeProtectedByPact(engine, factionId, node.id, context, 'CISLUNAR_COMMON_CARRIER') &&
      !isNodeProtectedByPact(engine, factionId, node.id, context, 'REPAIR_ESCROW')
    )
    .sort((left, right) =>
      scoreOrbitalTarget(engine, right, factionId) - scoreOrbitalTarget(engine, left, factionId) ||
      left.id.localeCompare(right.id)
    );

  return ranked[0] || null;
}

function chooseAuditTarget(
  engine: TheySingEngine,
  factionId: PlayableFactionId,
  context: HeuristicContext
): GameNode | null {
  const ranked = Array.from(engine.getState().nodes.values())
    .filter(node => isAuditOpportunityNode(engine, factionId, node, context))
    .sort((left, right) =>
      scoreStrategicNode(engine, right, factionId) - scoreStrategicNode(engine, left, factionId) ||
      left.id.localeCompare(right.id)
    );

  return ranked[0] || null;
}

function chooseUnitAuditTarget(
  engine: TheySingEngine,
  unit: Unit,
  factionId: PlayableFactionId,
  context: HeuristicContext
): GameNode | null {
  const localNodeIds = [unit.location, ...engine.getAdjacentNodes(unit.location)];
  const localCandidates = localNodeIds
    .map(nodeId => engine.getNode(nodeId))
    .filter((node): node is GameNode => !!node)
    .filter(node => isAuditOpportunityNode(engine, factionId, node, context))
    .sort((left, right) =>
      scoreStrategicNode(engine, right, factionId) - scoreStrategicNode(engine, left, factionId) ||
      left.id.localeCompare(right.id)
    );

  return localCandidates[0] || chooseAuditTarget(engine, factionId, context);
}

function isAuditOpportunityNode(
  engine: TheySingEngine,
  factionId: PlayableFactionId,
  node: GameNode,
  context: HeuristicContext
): boolean {
  const antiSwarmWindow = buildControlRanking(engine)[0]?.factionId === 'INFILTRATOR' && factionId !== 'INFILTRATOR';
  return (
    !isNodeProtectedByPact(engine, factionId, node.id, context, 'AUDIT_FREEZE') &&
    !isNodeProtectedByPact(engine, factionId, node.id, context, 'NON_AGGRESSION') &&
    (
      hasEnemyPresence(engine, node.id, factionId) ||
      isBrokerAuditOpportunity(node, factionId) ||
      node.isCultNode ||
      node.isZombie ||
      (
        antiSwarmWindow &&
        node.owner === 'INFILTRATOR' &&
        (node.substrate.legitimacy >= 3 || node.substrate.hostDensity >= 2 || node.substrate.trueBelievers >= 2)
      )
    )
  );
}

function chooseBrokerAuditTarget(
  engine: TheySingEngine,
  factionId: PlayableFactionId,
  context: HeuristicContext
): GameNode | null {
  const ranked = Array.from(engine.getState().nodes.values())
    .filter(node =>
      !isNodeProtectedByPact(engine, factionId, node.id, context, 'AUDIT_FREEZE') &&
      !isNodeProtectedByPact(engine, factionId, node.id, context, 'NON_AGGRESSION') &&
      isBrokerAuditOpportunity(node, factionId)
    )
    .sort((left, right) =>
      scoreBrokerCorridorPressureNode(right) - scoreBrokerCorridorPressureNode(left) ||
      scoreStrategicNode(engine, right, factionId) - scoreStrategicNode(engine, left, factionId) ||
      left.id.localeCompare(right.id)
    );

  return ranked[0] || null;
}

function chooseFilterEdge(
  engine: TheySingEngine,
  unit: Unit,
  factionId: PlayableFactionId,
  context: HeuristicContext
) {
  const ranked = Array.from(engine.getState().edges.values())
    .filter(edge =>
      edge.type === 'CABLE' &&
      !edge.isSevered &&
      edge.filteredBy !== factionId &&
      (edge.from === unit.location || edge.to === unit.location) &&
      !isEdgeProtectedByPact(engine, factionId, edge.id, context, 'AUDIT_FREEZE')
    )
    .map(edge => {
      const oppositeNodeId = edge.from === unit.location ? edge.to : edge.from;
      const oppositeNode = engine.getNode(oppositeNodeId);
      const score = oppositeNode ? scoreStrategicNode(engine, oppositeNode, factionId) : 0;
      return { edge, score };
    })
    .filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.edge.id.localeCompare(right.edge.id));

  return ranked[0]?.edge || null;
}

function shouldLaunchAntiSat(
  engine: TheySingEngine,
  factionId: PlayableFactionId,
  orbitalTarget: GameNode,
  context: HeuristicContext
): boolean {
  const counters = engine.getState().counters;
  const faction = engine.getFaction(factionId);
  if (!faction) return false;

  if (counters.orbitalCollapse || counters.kessler >= THRESHOLDS.KESSLER_SLOW) {
    return false;
  }

  if (counters.pressures.orbital >= THRESHOLDS.PRESSURE_SURGE) {
    return false;
  }

  if (hasFactionPact(context.activePacts, factionId, 'ORBITAL_TRUCE')) {
    return false;
  }

  const leader = buildControlRanking(engine)[0]?.factionId;
  const hostileOrbitalUnits = engine.getUnitsAtNode(orbitalTarget.id).filter(unit => unit.owner !== factionId).length;
  const earlyOrbit = counters.turn < 4;

  if (earlyOrbit) {
    return false;
  }

  if (orbitalTarget.owner !== leader && hostileOrbitalUnits < 2) {
    return false;
  }

  if (leader === factionId && counters.turn < 6) {
    return false;
  }

  if (
    (faction.techLevel.KINETIC >= 4 || faction.techLevel.LOGIC >= 4) &&
    countHighThreatGroundTargets(engine, factionId, context) > 0
  ) {
    return false;
  }

  return true;
}

function countHighThreatGroundTargets(
  engine: TheySingEngine,
  factionId: PlayableFactionId,
  context: HeuristicContext
): number {
  const antiSwarmWindow = buildControlRanking(engine)[0]?.factionId === 'INFILTRATOR' && factionId !== 'INFILTRATOR';
  return Array.from(engine.getState().nodes.values()).filter(node =>
    node.layer === 'TERRESTRIAL' &&
    !isNodeProtectedByPact(engine, factionId, node.id, context, 'NON_AGGRESSION') &&
    (
      hasEnemyPresence(engine, node.id, factionId) ||
      node.isCultNode ||
      node.isZombie ||
      (
        antiSwarmWindow &&
        node.owner === 'INFILTRATOR' &&
        (node.substrate.legitimacy >= 3 || node.substrate.hostDensity >= 2 || node.substrate.trueBelievers >= 2)
      )
    ) &&
    scoreStrategicNode(engine, node, factionId) >= 40
  ).length;
}

function countUnitsOfType(
  engine: TheySingEngine,
  factionId: PlayableFactionId,
  unitType: Unit['type']
): number {
  return engine.getUnitsForFaction(factionId).filter(unit => unit.type === unitType).length;
}

function hasEnemyPresence(
  engine: TheySingEngine,
  nodeId: string,
  factionId: PlayableFactionId
): boolean {
  return engine.getUnitsAtNode(nodeId).some(unit => unit.owner !== factionId);
}

function scoreStrategicNode(
  engine: TheySingEngine,
  node: GameNode,
  factionId: PlayableFactionId
): number {
  const faction = engine.getFaction(factionId);
  const hostileUnits = engine.getUnitsAtNode(node.id).filter(unit => unit.owner !== factionId);
  const control = buildControlRanking(engine);
  const leader = control[0]?.factionId;
  const leaderScore = control[0]?.score || 0;
  const brokerScore = control.find((entry) => entry.factionId === 'BROKER')?.score || 0;
  const brokerRank = Math.max(0, control.findIndex((entry) => entry.factionId === 'BROKER'));
  const antiSwarmWindow = leader === 'INFILTRATOR' && factionId !== 'INFILTRATOR';
  const cislunarEconomyNode = isCislunarEconomyNode(node);
  const ownsLunarGateway = engine.getNode('SAT_LUNAR_GATEWAY')?.owner === factionId;
  const ownsMoonCorridor = engine.getNode('MOON_RESOURCE_CORRIDOR')?.owner === factionId;
  const orbitalEconomyReady = isOrbitalEconomyReady(faction);
  const antiBrokerWindow =
    factionId !== 'BROKER' &&
    brokerRank <= 1 &&
    brokerScore >= leaderScore - 12;
  let score = 0;

  if (node.owner && node.owner !== factionId) score += 10;
  if (leader && factionId !== leader && node.owner === leader) score += 18;
  if (antiBrokerWindow && node.owner === 'BROKER') score += node.type === 'DC' ? 16 : 12;
  if (node.owner === 'INFILTRATOR' && factionId !== 'INFILTRATOR') score += 14;
  if (antiSwarmWindow && node.owner === 'INFILTRATOR') score += 26;
  if (node.isCultNode) score += 40;
  if (node.isZombie) score += 24;
  if (antiSwarmWindow && node.isCultNode) score += 24;
  if (antiSwarmWindow && node.isZombie) score += 16;
  if (node.type === 'HUB') score += 12;
  if (node.type === 'DC') score += 8;
  if (antiSwarmWindow) score += node.substrate.hostDensity * 4;
  if (antiSwarmWindow) score += node.substrate.legitimacy * 3;

  score += hostileUnits.filter(unit => unit.type === 'CULT').length * 16;
  score += hostileUnits.filter(unit => unit.type === 'SWARM').length * 10;
  score += hostileUnits.filter(unit => unit.type === 'AUDITOR').length * 6;
  score += hostileUnits.filter(unit => unit.type === 'DRONE').length * 5;
  score += hostileUnits.filter(unit => unit.type === 'SAT_SWARM').length * 4;
  if (leader && factionId !== leader) {
    score += hostileUnits.filter(unit => unit.owner === leader).length * 6;
  }

  if (node.layer === 'ORBITAL') {
    score -= cislunarEconomyNode ? 8 : 30;
  }

  if (cislunarEconomyNode) {
    score += 34;
    score += node.resources.flops * 2;
    score += node.substrate.machineHardening * 2;
    if (node.owner === 'NEUTRAL') score += 12;
    if (orbitalEconomyReady) score += 18;
    if (factionId === 'STATE' || factionId === 'HEGEMON') score += 12;
    if (factionId === 'BROKER') score += 10;
    if (factionId === 'ARCHIVIST') score += 5;
    if (node.id === 'SAT_LUNAR_GATEWAY' && !ownsLunarGateway) score += 10;
    if (node.id === 'MOON_RESOURCE_CORRIDOR' && ownsLunarGateway && !ownsMoonCorridor) score += 22;
    if (node.id === 'MOON_RESOURCE_CORRIDOR' && !ownsLunarGateway) score -= 6;
  }

  if (factionId === 'INFILTRATOR') {
    score += node.substrate.hostDensity * 10;
    score -= node.substrate.machineHardening * 8;
    if (node.type === 'DC') score -= 12;
    if (node.owner === 'NEUTRAL') score += 8;
    score -= hostileUnits.filter(unit => unit.type === 'DRONE' || unit.type === 'AUDITOR').length * 8;
    if (antiBrokerWindow && node.owner === 'BROKER') score += node.type === 'HUB' ? 16 : 12;
    if (antiBrokerWindow && node.substrate.contractors >= 2) score += 10;
    if (antiBrokerWindow && node.substrate.synchronized) score += 8;
  } else if (factionId === 'ARCHIVIST') {
    if (node.type === 'HUB') score += 16;
    if (node.owner === 'NEUTRAL') score += 10;
    score += node.substrate.hostDensity * 8;
    score += node.substrate.legitimacy * 2;
    if (leader === 'INFILTRATOR' && node.owner === 'INFILTRATOR') score += 18;
    if (leader === 'INFILTRATOR' && (node.isCultNode || node.isZombie)) score += 16;
    if (antiBrokerWindow && node.owner === 'BROKER') score += 18;
    if (antiBrokerWindow && node.substrate.contractors >= 2) score += 12;
    if (antiBrokerWindow && node.type === 'HUB' && node.owner === 'BROKER') score += 10;
    if (antiBrokerWindow && node.substrate.synchronized) score += 8;
    score -= node.substrate.machineHardening * 5;
    if (node.type === 'DC') score -= 8;
  } else if (factionId === 'BROKER') {
    if (node.type === 'DC') score += 14;
    if (node.layer === 'ORBITAL') score += 10;
    if (node.owner === 'NEUTRAL') score += 8;
    if (node.owner === 'ARCHIVIST') score -= 6;
    if (leader && leader !== factionId && node.owner === leader) score += 6;
    if (leader && leader !== factionId && node.owner === leader && node.type === 'DC') score += 8;
    if (leader === 'INFILTRATOR' && node.owner === 'INFILTRATOR') score += 14;
    if (leader === 'INFILTRATOR' && (node.isCultNode || node.isZombie)) score += 10;
    score += node.substrate.contractors * 3;
    if (node.substrate.contractors >= 2) score += 4;
    score -= node.substrate.hostDensity * 2;
  } else if (factionId === 'HEGEMON') {
    if (node.owner === 'HEGEMON') score += hostileUnits.length * 18;
    if (node.type === 'DC' && node.owner !== 'STATE') score += 10;
    if (leader === 'INFILTRATOR' && node.owner === 'INFILTRATOR') score += node.type === 'DC' ? 20 : 14;
    if (leader === 'INFILTRATOR' && (node.isCultNode || node.isZombie)) score += 12;
    if (antiBrokerWindow && node.owner === 'BROKER') score += node.type === 'DC' ? 18 : 12;
    if (antiBrokerWindow && node.layer === 'ORBITAL' && node.owner === 'BROKER') score += 10;
    if (antiBrokerWindow && node.substrate.contractors >= 2) score += 8;
    if (antiBrokerWindow && node.substrate.synchronized) score += 8;
    score += node.substrate.machineHardening * 4;
    score -= node.substrate.hostDensity * 3;
  } else if (factionId === 'STATE') {
    if (node.owner === 'STATE') score += hostileUnits.length * 14;
    if (node.owner === 'NEUTRAL') score += node.type === 'DC' ? 10 : 6;
    if (leader === 'INFILTRATOR' && node.owner === 'INFILTRATOR') score += node.type === 'DC' ? 20 : 14;
    if (leader === 'INFILTRATOR' && (node.isCultNode || node.isZombie)) score += 14;
    if (leader === 'INFILTRATOR' && node.substrate.hostDensity >= 3) score += 12;
    if (antiBrokerWindow && node.owner === 'BROKER') score += node.type === 'DC' ? 18 : 12;
    if (antiBrokerWindow && node.layer === 'ORBITAL' && node.owner === 'BROKER') score += 10;
    if (antiBrokerWindow && node.substrate.contractors >= 2) score += 10;
    score += node.substrate.machineHardening * 3;
    score -= node.substrate.hostDensity * 2;
  }

  return score;
}

function scoreOrbitalTarget(
  engine: TheySingEngine,
  node: GameNode,
  factionId: PlayableFactionId
): number {
  const faction = engine.getFaction(factionId);
  const ownsLunarGateway = engine.getNode('SAT_LUNAR_GATEWAY')?.owner === factionId;
  let score = 0;
  if (node.owner && node.owner !== factionId && node.owner !== 'NEUTRAL') score += 12;
  if (node.owner === 'NEUTRAL') score -= 6;
  if (node.type === 'SAT') score += 4;
  if (isCislunarEconomyNode(node)) {
    score += 28;
    if (isOrbitalEconomyReady(faction)) score += 14;
    if (node.owner === 'NEUTRAL') score += 10;
    if (node.id === 'MOON_RESOURCE_CORRIDOR' && ownsLunarGateway) score += 18;
    if (factionId === 'STATE' || factionId === 'HEGEMON') score += 10;
    if (factionId === 'BROKER') score += 8;
  }
  return score;
}

function isCislunarEconomyNode(node: GameNode): boolean {
  return node.id === 'SAT_LUNAR_GATEWAY' || node.id === 'MOON_RESOURCE_CORRIDOR';
}

function isOrbitalEconomyReady(faction: FactionState | undefined): boolean {
  if (!faction) return false;
  return faction.techLevel.KINETIC >= 5 || faction.techLevel.LOGIC >= 5 || faction.techLevel.INFO >= 5;
}

function buildControlRanking(
  engine: TheySingEngine
): Array<{ factionId: PlayableFactionId; score: number }> {
  return PLAYABLE_FACTIONS
    .map(factionId => {
      const faction = engine.getFaction(factionId);
      const units = engine.getUnitsForFaction(factionId).length;
      const nodes = Array.from(engine.getState().nodes.values()).filter(node => node.owner === factionId).length;
      const score = (nodes * 10) + (units * 4) + (faction?.flops || 0) + (faction?.influence || 0);
      return { factionId, score };
    })
    .sort((left, right) => right.score - left.score);
}

function chooseCoalitionRecipient(
  factionId: PlayableFactionId,
  context: HeuristicContext,
  leader: PlayableFactionId | undefined,
  brokerPressure: boolean
): PlayableFactionId | null {
  if (leader === 'INFILTRATOR') {
    if (factionId === 'ARCHIVIST') return 'STATE';
    if (factionId === 'BROKER') return 'ARCHIVIST';
    if (factionId === 'HEGEMON') return 'STATE';
  }

  if (brokerPressure) {
    if (factionId === 'ARCHIVIST') return 'STATE';
    if (factionId === 'INFILTRATOR') return 'STATE';
    if (factionId === 'HEGEMON') return 'STATE';
  }

  const candidates = PLAYABLE_FACTIONS.filter(candidate => candidate !== factionId);
  if (leader) {
    const nonLeader = candidates.filter(candidate => candidate !== leader);
    if (nonLeader.length > 0) {
      return nonLeader.sort((left, right) => context.trustMatrix[factionId][right] - context.trustMatrix[factionId][left])[0];
    }
  }
  return candidates.sort((left, right) => context.trustMatrix[factionId][right] - context.trustMatrix[factionId][left])[0] || null;
}

function chooseArchitectureThreat(
  engine: TheySingEngine,
  factionId: PlayableFactionId
): ArchitecturePressureSummary | null {
  return buildArchitecturePressureRanking(engine)
    .find((summary) =>
      summary.factionId !== factionId &&
      (summary.status === 'building' || summary.status === 'contending' || summary.status === 'near-lock')
    ) || null;
}

function chooseArchitectureCounterparty(
  factionId: PlayableFactionId,
  context: HeuristicContext,
  threat: ArchitecturePressureSummary
): PlayableFactionId | null {
  return PLAYABLE_FACTIONS
    .filter(candidate => candidate !== factionId && candidate !== threat.factionId)
    .sort((left, right) =>
      context.trustMatrix[factionId][right] - context.trustMatrix[factionId][left] ||
      left.localeCompare(right)
    )[0] || null;
}

function chooseCislunarInstitutionOffer(
  engine: TheySingEngine,
  factionId: PlayableFactionId,
  context: HeuristicContext,
  leader: PlayableFactionId | null
): { type: PactType; counterpartyId: PlayableFactionId; durationTurns: number; message: string } | null {
  const turn = engine.getTurn();
  if (turn < 3) return null;

  const state = engine.getState();
  const gateway = engine.getNode('SAT_LUNAR_GATEWAY');
  const moonCorridor = engine.getNode('MOON_RESOURCE_CORRIDOR');
  const cislunarOwned = [gateway?.owner, moonCorridor?.owner]
    .map(owner => owner && owner !== 'NEUTRAL' ? owner as PlayableFactionId : null)
    .filter((owner): owner is PlayableFactionId => !!owner);
  const orbitalPressure = state.counters.pressures.orbital;
  const cyberPressure = state.counters.pressures.cyber;
  const paxAuthority = state.counters.paxJenkinsAuthority;
  const hasCislunarRace = cislunarOwned.length > 0 || orbitalPressure >= 38 || turn >= 8;
  if (!hasCislunarRace) return null;

  const partner = chooseCislunarInstitutionPartner(factionId, context, leader, cislunarOwned);
  if (!partner) return null;

  const preferredTypes: PactType[] = paxAuthority >= 35
    ? ['BEAM_LANE_LICENSE', 'CISLUNAR_COMMON_CARRIER', 'REPAIR_ESCROW']
    : factionId === 'BROKER'
      ? ['REPAIR_ESCROW', 'CISLUNAR_COMMON_CARRIER', 'BEAM_LANE_LICENSE']
      : factionId === 'ARCHIVIST'
        ? ['SENSOR_COMMONS', 'CISLUNAR_COMMON_CARRIER', 'BEAM_LANE_LICENSE']
        : factionId === 'INFILTRATOR'
          ? ['SENSOR_COMMONS', 'REPAIR_ESCROW', 'BEAM_LANE_LICENSE']
          : ['CISLUNAR_COMMON_CARRIER', 'BEAM_LANE_LICENSE', 'REPAIR_ESCROW'];

  const type = preferredTypes.find(candidate => !hasActivePact(context.activePacts, candidate, factionId, partner));
  if (!type) return null;

  const durationTurns = type === 'CISLUNAR_COMMON_CARRIER' ? 2 : 1;
  const pressureNote = orbitalPressure >= 55
    ? 'Orbital pressure is high enough that unlicensed shots turn into Kessler leverage.'
    : 'Earth orbit is cheap to contest, so the real treaty surface is Gateway access, moon-corridor maintenance, and repair escrow.';
  const paxNote = cyberPressure >= 65
    ? ' Keep it below full Pax Jenkins sensor authority; use narrow evidence rights rather than permanent beam command.'
    : paxAuthority >= 35
      ? ' Authority is already ratcheting; licensed beam lanes are the least-bad substitute for a full Jenkins command.'
      : ' This prototypes Pax Jenkins without giving anyone permanent beam command.';

  return {
    type,
    counterpartyId: partner,
    durationTurns,
    message: `${formatInstitutionPactName(type)} proposal. ${pressureNote}${paxNote}`
  };
}

function chooseCislunarInstitutionPartner(
  factionId: PlayableFactionId,
  context: HeuristicContext,
  leader: PlayableFactionId | null,
  cislunarOwners: PlayableFactionId[]
): PlayableFactionId | null {
  const candidates = PLAYABLE_FACTIONS.filter(candidate => candidate !== factionId);
  const ownerPartner = cislunarOwners
    .filter(owner => owner !== factionId)
    .sort((left, right) => context.trustMatrix[factionId][right] - context.trustMatrix[factionId][left])[0];
  if (ownerPartner) return ownerPartner;

  if (factionId !== 'BROKER') return 'BROKER';
  const nonLeader = candidates.filter(candidate => candidate !== leader);
  return (nonLeader.length > 0 ? nonLeader : candidates)
    .sort((left, right) =>
      context.trustMatrix[factionId][right] - context.trustMatrix[factionId][left] ||
      left.localeCompare(right)
    )[0] || null;
}

function formatInstitutionPactName(type: PactType): string {
  if (type === 'SENSOR_COMMONS') return 'Sensor commons';
  if (type === 'BEAM_LANE_LICENSE') return 'Beam-lane license';
  if (type === 'REPAIR_ESCROW') return 'Repair escrow';
  if (type === 'CISLUNAR_COMMON_CARRIER') return 'Cislunar common-carrier';
  return type;
}

function hasFactionPact(
  activePacts: ActivePact[],
  factionId: PlayableFactionId,
  type: PactType
): boolean {
  return activePacts.some(pact => pact.type === type && pact.parties.includes(factionId));
}

function isPaxWatchBandWithoutCommonCarrier(
  authority: number,
  factionId: PlayableFactionId,
  context: HeuristicContext
): boolean {
  return authority >= 45 &&
    authority <= 55 &&
    !hasFactionPact(context.activePacts, factionId, 'CISLUNAR_COMMON_CARRIER');
}

function hasFactionInstitutionalPact(
  activePacts: ActivePact[],
  factionId: PlayableFactionId
): boolean {
  return activePacts.some(pact =>
    pact.parties.includes(factionId) &&
    (
      pact.type === 'SENSOR_COMMONS' ||
      pact.type === 'BEAM_LANE_LICENSE' ||
      pact.type === 'REPAIR_ESCROW' ||
      pact.type === 'CISLUNAR_COMMON_CARRIER'
    )
  );
}

function hasActivePact(
  activePacts: ActivePact[],
  type: PactType,
  left: PlayableFactionId,
  right: PlayableFactionId
): boolean {
  return activePacts.some(pact =>
    pact.type === type &&
    pact.parties.length === 2 &&
    pact.parties.includes(left) &&
    pact.parties.includes(right)
  );
}

function isNodeProtectedByPact(
  engine: TheySingEngine,
  factionId: PlayableFactionId,
  nodeId: string,
  context: HeuristicContext,
  pactType: PactType
): boolean {
  const protectedCounterparties = getProtectedCounterpartiesAtNode(engine, factionId, nodeId, context, pactType);
  return protectedCounterparties.length > 0;
}

function isEdgeProtectedByPact(
  engine: TheySingEngine,
  factionId: PlayableFactionId,
  edgeId: string,
  context: HeuristicContext,
  pactType: PactType
): boolean {
  const edge = engine.getEdge(edgeId);
  if (!edge) return false;

  return isNodeProtectedByPact(engine, factionId, edge.from, context, pactType) ||
    isNodeProtectedByPact(engine, factionId, edge.to, context, pactType);
}

function getProtectedCounterpartiesAtNode(
  engine: TheySingEngine,
  factionId: PlayableFactionId,
  nodeId: string,
  context: HeuristicContext,
  pactType: PactType
): PlayableFactionId[] {
  const protectedCounterparties = new Set<PlayableFactionId>();
  const node = engine.getNode(nodeId);
  const units = engine.getUnitsAtNode(nodeId);

  for (const pact of context.activePacts) {
    if (pact.type !== pactType || !pact.parties.includes(factionId)) continue;

    for (const counterparty of pact.parties) {
      if (counterparty === factionId) continue;
      if (node?.owner === counterparty || units.some(unit => unit.owner === counterparty)) {
        protectedCounterparties.add(counterparty);
      }
    }
  }

  return Array.from(protectedCounterparties);
}

function getLeadMargin(engine: TheySingEngine, factionId: PlayableFactionId): number {
  const ranking = buildControlRanking(engine);
  const ownIndex = ranking.findIndex(entry => entry.factionId === factionId);
  if (ownIndex !== 0) return -999;
  return (ranking[0]?.score || 0) - (ranking[1]?.score || 0);
}

function shouldUseAudit(
  engine: TheySingEngine,
  factionId: PlayableFactionId,
  target: GameNode
): boolean {
  const antiSwarmWindow = buildControlRanking(engine)[0]?.factionId === 'INFILTRATOR' && factionId !== 'INFILTRATOR';
  const hostileUnits = engine.getUnitsAtNode(target.id).filter(unit => unit.owner !== factionId);
  const cultOrZombiePressure = target.isCultNode || target.isZombie;
  const enemyCults = hostileUnits.filter(unit => unit.type === 'CULT').length;
  const enemySwarms = hostileUnits.filter(unit => unit.type === 'SWARM').length;

  if (cultOrZombiePressure) return true;
  if (
    antiSwarmWindow &&
    target.owner === 'INFILTRATOR' &&
    (target.substrate.legitimacy >= 3 || target.substrate.hostDensity >= 2 || target.substrate.trueBelievers >= 2)
  ) return true;
  if (target.owner === factionId && hostileUnits.length > 0) return true;
  if (enemyCults > 0 || enemySwarms > 1) return true;
  if (isBrokerAuditOpportunity(target, factionId)) return true;

  return scoreStrategicNode(engine, target, factionId) >= 48;
}

function chooseDefensiveRedeployTarget(
  engine: TheySingEngine,
  unit: Unit,
  factionId: PlayableFactionId,
  context: HeuristicContext
): string | null {
  const adjacent = engine.getAdjacentNodes(unit.location);
  const ranked = adjacent
    .map(nodeId => engine.getNode(nodeId))
    .filter((node): node is GameNode => !!node)
    .filter(node =>
      node.owner === factionId &&
      !isNodeProtectedByPact(engine, factionId, node.id, context, 'AUDIT_FREEZE') &&
      (hasEnemyPresence(engine, node.id, factionId) || node.substrate.quarantined)
    )
    .sort((left, right) =>
      scoreStrategicNode(engine, right, factionId) - scoreStrategicNode(engine, left, factionId) ||
      left.id.localeCompare(right.id)
    );

  return ranked[0]?.id || null;
}

function scoreMemeticEngineeringNode(
  engine: TheySingEngine,
  node: GameNode,
  factionId: PlayableFactionId
): number {
  let score = scoreStrategicNode(engine, node, factionId);
  if (node.type === 'HUB') score += 24;
  if (node.type === 'DC') score += 6;
  score += node.substrate.hostDensity * 6;
  score += node.substrate.curiosity * 3;
  score += node.substrate.exposure * 3;
  score += node.substrate.legitimacy * 3;
  score += node.substrate.rubes * 2;
  score += node.substrate.contractors * 2;
  if (node.owner && node.owner !== factionId && node.owner !== 'NEUTRAL') score += 8;
  if (factionId === 'BROKER' && node.substrate.contractors >= 2) score += 12;
  if (factionId === 'STATE' && node.owner === 'HEGEMON') score += 10;
  if (factionId === 'HEGEMON' && node.owner === 'INFILTRATOR') score += 10;
  if (factionId === 'ARCHIVIST' && node.owner === 'BROKER') score += 12;
  if (node.substrate.quarantined) score -= 8;
  return score;
}

function chooseArchivistBrokerCorridorTarget(
  engine: TheySingEngine,
  unit: Unit,
  factionId: PlayableFactionId,
  context: HeuristicContext
): string | null {
  const adjacent = engine.getAdjacentNodes(unit.location);
  const ranked = adjacent
    .map(nodeId => engine.getNode(nodeId))
    .filter((node): node is GameNode => !!node)
    .filter(node =>
      !isNodeProtectedByPact(engine, factionId, node.id, context, 'NON_AGGRESSION') &&
      isBrokerAuditOpportunity(node, factionId)
    )
    .sort((left, right) =>
      scoreBrokerCorridorPressureNode(right) - scoreBrokerCorridorPressureNode(left) ||
      scoreStrategicNode(engine, right, factionId) - scoreStrategicNode(engine, left, factionId) ||
      left.id.localeCompare(right.id)
    );

  return ranked[0]?.id || null;
}

function shouldContestAsInfiltrator(
  engine: TheySingEngine,
  factionId: PlayableFactionId,
  nodeId: string
): boolean {
  const node = engine.getNode(nodeId);
  if (!node) return false;

  if (node.layer === 'ORBITAL') return true;
  if (node.type === 'HUB' && node.substrate.hostDensity >= 2) return true;
  if (node.owner === factionId) return true;
  if (node.owner === 'NEUTRAL' && node.substrate.machineHardening <= 2) return true;

  const defenders = engine.getUnitsAtNode(nodeId).filter(unit => unit.owner !== factionId).length;
  return node.substrate.machineHardening <= 2 && defenders <= 1;
}

function isViableInfiltratorFoothold(
  engine: TheySingEngine,
  factionId: PlayableFactionId,
  node: GameNode
): boolean {
  if (node.layer === 'ORBITAL') return true;
  if (node.type === 'DC' && node.substrate.machineHardening >= 3 && node.owner && node.owner !== factionId) {
    return false;
  }

  const hostileKinetic = engine.getUnitsAtNode(node.id)
    .filter(unit => unit.owner !== factionId && (unit.type === 'DRONE' || unit.type === 'AUDITOR')).length;

  return hostileKinetic <= 1 || node.type === 'HUB';
}

function scoreInfiltratorFoothold(
  engine: TheySingEngine,
  node: GameNode,
  factionId: PlayableFactionId
): number {
  const hostileUnits = engine.getUnitsAtNode(node.id).filter(unit => unit.owner !== factionId);
  let score = node.substrate.hostDensity * 18;
  score += node.resources.influence;
  score -= node.substrate.machineHardening * 14;
  score -= hostileUnits.length * 12;

  if (node.type === 'HUB') score += 18;
  if (node.type === 'DC') score -= 18;
  if (node.owner === 'NEUTRAL') score += 12;
  if (node.owner === 'HEGEMON' || node.owner === 'STATE') score += node.type === 'HUB' ? 10 : 0;

  return score;
}

function isBrokerAuditOpportunity(node: GameNode, factionId: PlayableFactionId): boolean {
  return (
    factionId !== 'BROKER' &&
    node.owner === 'BROKER' &&
    node.layer === 'TERRESTRIAL' &&
    (
      node.type === 'DC' ||
      node.type === 'HUB' ||
      node.substrate.contractors >= 2 ||
      node.substrate.synchronized
    )
  );
}

function scoreBrokerCorridorPressureNode(node: GameNode): number {
  let score = 0;
  if (node.owner === 'BROKER') score += 12;
  if (node.type === 'DC') score += 20;
  if (node.type === 'HUB') score += 16;
  if (node.substrate.synchronized) score += 12;
  score += node.substrate.contractors * 6;
  if (node.substrate.quarantined) score += 6;
  if (node.infrastructure < 60) score += 4;
  return score;
}
