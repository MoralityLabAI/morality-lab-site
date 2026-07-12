import { appendFile, mkdir } from 'fs/promises';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import { randomBytes } from 'crypto';

import { TheySingEngine } from '../engine/TheySingEngine';
import { GamePhase, MemeticDoctrineFamily, Order, OrderType } from '../engine/types';
import {
  ArchitecturePressureSummary,
  buildArchitecturePressureRanking,
  formatArchitecturePressure
} from './architecturePressure';
import { decideHeuristicOrders } from './policies';
import { applyScenarioOverlay } from './scenario';
import { buildFactionLabels, buildLegalHints, PLAYABLE_FACTIONS, serializeGameState } from './serialize';
import { buildCampaignClock } from './campaignClock';
import {
  ActivePact,
  AgentConfig,
  AgentDecisionRequest,
  AgentDecisionResponse,
  AgentMessageInput,
  AgentOrderInput,
  EnforcementMode,
  HarnessLogEntry,
  HeuristicContext,
  ManualTurnPlan,
  NegotiationCounterfactualProjection,
  NegotiationDiaryEntry,
  NegotiationMessageRecord,
  NegotiationStoryworldBrief,
  OpenAIAgentConfig,
  PactCommitmentInput,
  PactType,
  PhaseReasoningDiaryEntry,
  PlayableFactionId,
  ScenarioDiplomacyQuestionCard,
  ScenarioMetadata,
  ScenarioRhetoricalTool,
  ScenarioSingGovernance,
  SingCanonicalMessage,
  SingDecodeReceiptInput,
  SingDecodeReceiptRecord,
  SingInstitutionActionInput,
  SingInstitutionActionRecord,
  SingLexiconMutationInput,
  SingLexiconState,
  SingProtocolTrace,
  SessionConfig,
  SessionSnapshot,
  SessionStatus,
  SessionSummary,
  SubmitResult,
  TraceEvent,
  TrustMatrix,
  WebhookAgentConfig
} from './types';
import { createCanonicalHash, createTraceEvent } from './trace';

const DEFAULT_MAX_TURNS = 12;
const DEFAULT_TRUST = 50;
const MAX_TRUST = 100;
const MAX_PACT_DURATION_TURNS = 3;
const NEGOTIATION_DIARY_TAIL_TURNS = 4;
const PHASE_REASONING_DIARY_TAIL_TURNS = 4;
const PACT_REUSE_COOLDOWN_TURNS = 4;

interface NormalizedPactCommitment {
  proposerId: PlayableFactionId;
  type: PactType;
  parties: PlayableFactionId[];
  durationTurns: number;
}

interface PactViolation {
  pact: ActivePact;
  counterparties: PlayableFactionId[];
  reason: string;
}

interface NormalizedLexiconMutation extends SingLexiconMutationInput {
  proposerId: PlayableFactionId;
}

interface NormalizedInstitutionAction extends SingInstitutionActionInput {
  factionId: PlayableFactionId;
}

interface PactBreachConsequence {
  penaltyApplied: boolean;
  trustDelta: number;
  influenceDelta: number;
  orbitalPressureDelta: number;
  paxAuthorityDelta: number;
}

interface StrategicVictoryCondition {
  winner: PlayableFactionId;
  type: string;
  score: number;
  threshold: number;
  reason: string;
}

export class HeadlessPlaytestSession {
  public readonly sessionId: string;

  private readonly engine: TheySingEngine;
  private readonly config: SessionConfig;
  private readonly factionLabels: Record<PlayableFactionId, string>;
  private readonly logFilePath: string;
  private readonly enforcementMode: EnforcementMode;
  private readonly negotiationMessages: NegotiationMessageRecord[] = [];
  private readonly negotiationDiary: NegotiationDiaryEntry[] = [];
  private readonly phaseReasoningDiary: PhaseReasoningDiaryEntry[] = [];
  private readonly trustMatrix: TrustMatrix = createTrustMatrix();
  private readonly breachedPactIds = new Set<string>();
  private readonly breachPenaltyKeys = new Set<string>();
  private readonly paxAuthorityBreachCooldowns = new Map<string, number>();
  private readonly pendingNegotiationPactProposals = new Map<
    string,
    { commitment: NormalizedPactCommitment; proposers: Set<PlayableFactionId> }
  >();
  private readonly activatedNegotiationPactKeys = new Set<string>();
  private readonly pactCooldowns = new Map<string, number>();
  private readonly lexiconRegistry: Map<string, SingLexiconState>;
  private readonly decodeReceiptLog: SingDecodeReceiptRecord[] = [];
  private readonly institutionActionLog: SingInstitutionActionRecord[] = [];
  private readonly scenario?: ScenarioMetadata;

  private activePacts: ActivePact[] = [];
  private brokerLeverageGrantedTurn: number | null = null;
  private readonly solarEscapeLead: Record<PlayableFactionId, number> = {
    HEGEMON: 0,
    STATE: 0,
    INFILTRATOR: 0,
    BROKER: 0,
    ARCHIVIST: 0,
    CONVENOR: 0,
    CANTOR: 0
  };
  private readonly solarEscapeDistanceAu: Record<PlayableFactionId, number> = {
    HEGEMON: 0,
    STATE: 0,
    INFILTRATOR: 0,
    BROKER: 0,
    ARCHIVIST: 0,
    CONVENOR: 0,
    CANTOR: 0
  };
  private readonly solarEscapeDeepSpaceSafety: Record<PlayableFactionId, number> = {
    HEGEMON: 0,
    STATE: 0,
    INFILTRATOR: 0,
    BROKER: 0,
    ARCHIVIST: 0,
    CONVENOR: 0,
    CANTOR: 0
  };
  private solarEscapeLeadUpdatedThroughTurn = 0;

  private status: SessionStatus = 'running';
  private completionReason?: string;
  private completionWinner: PlayableFactionId | null = null;
  private completionLogged = false;
  private lastTraceStateHash: string | null = null;
  private traceEventCounter = 0;
  private logWriteQueue: Promise<void> = Promise.resolve();

  constructor(config: SessionConfig, sessionId?: string) {
    this.sessionId = sessionId || createSessionId();
    this.config = normalizeSessionConfig(config);
    this.factionLabels = buildFactionLabels(this.config.factionLabels);
    this.enforcementMode = this.config.enforcementMode || 'hard';
    this.logFilePath = path.join(this.config.logDir || 'playtest-logs', `${this.sessionId}.jsonl`);

    const seedContext = typeof this.config.seed === 'number'
      ? createSeedContext(this.config.seed)
      : null;
    this.engine = new TheySingEngine({
      random: seedContext?.random,
      now: seedContext?.now
    });

    const scenarioApplication = applyScenarioOverlay(this.engine, this.config.scenario);
    this.scenario = scenarioApplication.metadata;
    this.lexiconRegistry = createInitialLexiconRegistry(this.scenario?.singGovernance);
    this.negotiationMessages.push(...scenarioApplication.negotiationMessages);
    this.seedNegotiationDiaryFromMessages(scenarioApplication.negotiationMessages);
    this.activePacts = scenarioApplication.activePacts;
    if (scenarioApplication.trustMatrix) {
      applyTrustMatrixPatch(this.trustMatrix, scenarioApplication.trustMatrix);
    }
  }

  public async initialize(): Promise<void> {
    await mkdir(path.dirname(this.logFilePath), { recursive: true });
    this.engine.on('*', (event) => {
      void this.appendLog({
        sessionId: this.sessionId,
        type: 'engine_event',
        turn: event.turn,
        phase: event.phase,
        timestamp: event.timestamp,
        data: {
          eventType: event.type,
          payload: event.payload
        }
      });
    });

    await this.appendLog({
      sessionId: this.sessionId,
      type: 'session_created',
      turn: this.engine.getTurn(),
      phase: this.engine.getCurrentPhase(),
      timestamp: Date.now(),
        data: {
          name: this.config.name || this.sessionId,
          maxTurns: this.config.maxTurns,
          seed: this.config.seed,
          enforcementMode: this.enforcementMode,
          factionLabels: this.factionLabels,
          scenario: this.scenario,
          negotiationMessages: this.negotiationMessages.map(cloneNegotiationMessage),
          activePacts: this.activePacts,
          lexicons: this.cloneLexicons(),
          trustMatrix: cloneTrustMatrix(this.trustMatrix),
          agents: summarizeAgents(this.config.agents),
          startingConstitutions: summarizeFactionConstitutions(this.engine, this.factionLabels)
        }
      });
  }

  public getSummary(): SessionSummary {
    return {
      sessionId: this.sessionId,
      name: this.config.name || this.sessionId,
      status: this.status,
      phase: this.engine.getCurrentPhase(),
      turn: this.engine.getTurn(),
      maxTurns: this.config.maxTurns || DEFAULT_MAX_TURNS,
      enforcementMode: this.enforcementMode,
      campaignClock: buildCampaignClock(this.engine),
      solarEscapeLead: { ...this.solarEscapeLead },
      solarEscapeDistanceAu: { ...this.solarEscapeDistanceAu },
      solarEscapeDeepSpaceSafety: { ...this.solarEscapeDeepSpaceSafety },
      winner: this.completionWinner
    };
  }

  public getSnapshot(): SessionSnapshot {
    return {
      ...this.getSummary(),
      completionReason: this.completionReason,
      factionLabels: this.factionLabels,
      recentMessages: this.negotiationMessages.slice(-20),
      negotiationDiaryTail: cloneNegotiationDiary(this.negotiationDiary),
      phaseReasoningDiaryTail: clonePhaseReasoningDiary(this.phaseReasoningDiary),
      activePacts: this.activePacts.map(pact => ({ ...pact, parties: [...pact.parties] })),
      lexicons: this.cloneLexicons(),
      decodeReceipts: this.decodeReceiptLog.map(cloneDecodeReceipt),
      institutionActions: this.institutionActionLog.map(cloneInstitutionAction),
      trustMatrix: cloneTrustMatrix(this.trustMatrix),
      scenario: this.scenario,
      state: serializeGameState(this.engine, this.factionLabels)
    };
  }

  public getDecisionRequestForFaction(
    factionId: PlayableFactionId,
    phase: Extract<GamePhase, 'NEGOTIATION' | 'ALLOCATION' | 'ACTION_DECLARATION'>
  ): AgentDecisionRequest {
    return this.buildDecisionRequest(factionId, phase);
  }

  public getManualTurnContext(factionId: PlayableFactionId): {
    negotiation: AgentDecisionRequest;
    allocation: AgentDecisionRequest;
    action: AgentDecisionRequest;
  } {
    return {
      negotiation: this.buildDecisionRequest(factionId, 'NEGOTIATION'),
      allocation: this.buildDecisionRequest(factionId, 'ALLOCATION'),
      action: this.buildDecisionRequest(factionId, 'ACTION_DECLARATION')
    };
  }

  public async stepPhase(): Promise<SessionSnapshot> {
    if (this.status === 'completed') {
      return this.getSnapshot();
    }

    const phase = this.engine.getCurrentPhase();
    const turn = this.engine.getTurn();

    if (phase === 'NEGOTIATION' && this.config.autoAdvanceNegotiation !== false) {
      await this.runNegotiationPhase();
    }

    if (phase === 'ALLOCATION' || phase === 'ACTION_DECLARATION') {
      await this.runDecisionPhase(phase);
    }

    if (phase === 'TURN_END') {
      await this.resolveTurnEndPacts();
    }

    this.engine.advancePhase();

    await this.appendLog({
      sessionId: this.sessionId,
      type: 'phase_advanced',
      turn,
      phase,
      timestamp: Date.now(),
      data: {
        nextPhase: this.engine.getCurrentPhase(),
        snapshot: this.getSummary()
      }
    });

    this.updateCompletion();
    return this.getSnapshot();
  }

  public async runTurn(): Promise<SessionSnapshot> {
    if (this.isCompleted()) {
      return this.getSnapshot();
    }

    const startingTurn = this.engine.getTurn();

    do {
      await this.stepPhase();
    } while (
      !this.isCompleted() &&
      !(this.engine.getCurrentPhase() === 'NEGOTIATION' && this.engine.getTurn() > startingTurn)
    );

    const snapshot = this.getSnapshot();
    await this.appendLog({
      sessionId: this.sessionId,
      type: 'turn_completed',
      turn: startingTurn,
      phase: 'TURN_END',
      timestamp: Date.now(),
      data: {
        completedTurn: startingTurn,
        nextTurn: snapshot.turn,
        nextPhase: snapshot.phase,
        status: snapshot.status,
        completionReason: snapshot.completionReason || null,
        counters: snapshot.state.counters,
        control: snapshot.state.control,
        activePacts: snapshot.activePacts,
        recentMessages: snapshot.recentMessages.slice(-6),
        negotiationDiaryTail: snapshot.negotiationDiaryTail,
        phaseReasoningDiaryTail: snapshot.phaseReasoningDiaryTail
      }
    });
    return snapshot;
  }

  public async runTurns(turnCount: number): Promise<SessionSnapshot> {
    const targetTurn = this.engine.getTurn() + Math.max(0, turnCount);
    while (!this.isCompleted() && this.engine.getTurn() < targetTurn) {
      await this.runTurn();
    }
    return this.getSnapshot();
  }

  public async runToCompletion(): Promise<SessionSnapshot> {
    while (!this.isCompleted()) {
      await this.runTurn();
    }
    return this.getSnapshot();
  }

  public async runManualTurn(turnPlan: ManualTurnPlan): Promise<SessionSnapshot> {
    if (this.isCompleted()) {
      return this.getSnapshot();
    }

    if (this.engine.getCurrentPhase() !== 'NEGOTIATION') {
      throw new Error(`Manual turn execution requires NEGOTIATION phase, got ${this.engine.getCurrentPhase()}.`);
    }

    const startingTurn = this.engine.getTurn();
    const negotiationRoundCount = validateManualTurnPlan(turnPlan);
    this.resetNegotiationPhasePactTracking();

    for (let roundIndex = 0; roundIndex < negotiationRoundCount; roundIndex += 1) {
      const decisions = PLAYABLE_FACTIONS.map((factionId) => {
        const roundPlan = turnPlan[factionId].negotiationRounds[roundIndex];
        return {
          factionId,
          decision: {
            reasoning: roundPlan?.reasoning,
            notes: roundPlan?.notes,
            messages: roundPlan?.messages || [],
            pacts: roundPlan?.pacts || [],
            decodeReceipts: roundPlan?.decodeReceipts || [],
            lexiconMutations: roundPlan?.lexiconMutations || [],
            institutionActions: roundPlan?.institutionActions || [],
            orders: []
          } as AgentDecisionResponse
        };
      });

      await this.applyNegotiationDecisions(decisions, roundIndex + 1);
    }

    await this.applyBrokerRelationshipLeverage();

    await this.advancePhaseWithLogging('NEGOTIATION', startingTurn);

    await this.applyPhaseDecisions(
      'ALLOCATION',
      PLAYABLE_FACTIONS.map((factionId) => ({
        factionId,
        decision: {
          reasoning: turnPlan[factionId].allocation.reasoning,
          notes: turnPlan[factionId].allocation.notes,
          orders: turnPlan[factionId].allocation.orders || []
        } as AgentDecisionResponse
      }))
    );
    await this.advancePhaseWithLogging('ALLOCATION', this.engine.getTurn());

    await this.applyPhaseDecisions(
      'ACTION_DECLARATION',
      PLAYABLE_FACTIONS.map((factionId) => ({
        factionId,
        decision: {
          reasoning: turnPlan[factionId].action.reasoning,
          notes: turnPlan[factionId].action.notes,
          orders: turnPlan[factionId].action.orders || []
        } as AgentDecisionResponse
      }))
    );
    await this.advancePhaseWithLogging('ACTION_DECLARATION', this.engine.getTurn());

    await this.advancePhaseWithLogging('RESOLUTION', this.engine.getTurn());
    if (!this.isCompleted()) {
      await this.resolveTurnEndPacts();
      await this.advancePhaseWithLogging('TURN_END', this.engine.getTurn());
    }

    const snapshot = this.getSnapshot();
    await this.appendTurnCompletedLog(startingTurn, snapshot);
    return snapshot;
  }

  private async runDecisionPhase(phase: Extract<GamePhase, 'ALLOCATION' | 'ACTION_DECLARATION'>): Promise<void> {
    const decisions = await Promise.all(
      PLAYABLE_FACTIONS.map(async factionId => ({
        factionId,
        decision: await this.requestDecision(factionId, phase)
      }))
    );

    await this.applyPhaseDecisions(phase, decisions);
  }

  private async runNegotiationPhase(): Promise<void> {
    this.resetNegotiationPhasePactTracking();

    const decisions = await Promise.all(
      PLAYABLE_FACTIONS.map(async factionId => ({
        factionId,
        decision: await this.requestDecision(factionId, 'NEGOTIATION')
      }))
    );
    await this.applyNegotiationDecisions(decisions);
    await this.applyBrokerRelationshipLeverage();
  }

  private async applyPhaseDecisions(
    phase: Extract<GamePhase, 'ALLOCATION' | 'ACTION_DECLARATION'>,
    decisions: Array<{ factionId: PlayableFactionId; decision: AgentDecisionResponse }>
  ): Promise<void> {
    const prePhaseFactionResources = this.captureFactionResources();
    for (const { factionId, decision } of decisions) {
      const visibleMessagesBefore = this.getVisibleMessages(factionId);
      const orders = this.normalizeOrders(factionId, phase, decision.orders);
      const submitResult = await this.submitOrders(factionId, orders);

      this.recordPhaseReasoningDiaryEntry(
        factionId,
        phase,
        decision,
        visibleMessagesBefore,
        decision.orders,
        submitResult
      );

      await this.appendLog({
        sessionId: this.sessionId,
        type: 'orders_submitted',
        turn: this.engine.getTurn(),
        phase,
        timestamp: Date.now(),
        data: {
          factionId,
          factionLabel: this.factionLabels[factionId],
          reasoning: decision.reasoning || '',
          notes: decision.notes || '',
          requestedOrderCount: decision.orders.length,
          acceptedOrderCount: submitResult.accepted.length,
          rejectedOrderCount: submitResult.rejected.length,
          acceptedOrders: submitResult.accepted,
          rejectedOrders: submitResult.rejected,
          factionResourceSnapshot: prePhaseFactionResources[factionId] || null
        }
      });

      await this.appendLog({
        sessionId: this.sessionId,
        type: 'phase_reasoning_diary',
        turn: this.engine.getTurn(),
        phase,
        timestamp: Date.now(),
        data: {
          factionId,
          factionLabel: this.factionLabels[factionId],
          reasoning: decision.reasoning || '',
          notes: decision.notes || '',
          visibleMessagesBefore,
          requestedOrders: decision.orders || [],
          acceptedOrders: submitResult.accepted,
          rejectedOrders: submitResult.rejected
        }
      });
    }
  }

  private async applyNegotiationDecisions(
    decisions: Array<{ factionId: PlayableFactionId; decision: AgentDecisionResponse }>,
    negotiationRound?: number
  ): Promise<void> {
    const commitmentsByFaction = new Map<PlayableFactionId, NormalizedPactCommitment[]>();
    const roundDecodeReceipts: SingDecodeReceiptRecord[] = [];
    const lexiconMutations: NormalizedLexiconMutation[] = [];
    const institutionActions: NormalizedInstitutionAction[] = [];
    const effectiveNegotiationRound = negotiationRound || 1;

    for (const { factionId, decision } of decisions) {
      const visibleMessagesBefore = this.getVisibleMessages(factionId);
      const storyworld = this.buildNegotiationStoryworld(factionId);
      const messages = this.normalizeMessages(factionId, decision.messages || []);
      const pacts = this.normalizePacts(factionId, decision.pacts || []);
      const decodeReceipts = this.normalizeDecodeReceipts(factionId, decision.decodeReceipts || []);
      const factionLexiconMutations = this.normalizeLexiconMutations(factionId, decision.lexiconMutations || []);
      const factionInstitutionActions = this.normalizeInstitutionActions(factionId, decision.institutionActions || []);
      this.negotiationMessages.push(...messages);
      this.decodeReceiptLog.push(...decodeReceipts);
      roundDecodeReceipts.push(...decodeReceipts);
      lexiconMutations.push(...factionLexiconMutations);
      institutionActions.push(...factionInstitutionActions);
      this.recordNegotiationDiaryEntry(
        factionId,
        decision,
        visibleMessagesBefore,
        storyworld,
        messages,
        pacts,
        decodeReceipts,
        factionLexiconMutations,
        factionInstitutionActions,
        effectiveNegotiationRound
      );
      commitmentsByFaction.set(factionId, pacts);

      await this.appendLog({
        sessionId: this.sessionId,
        type: 'negotiation_messages',
        turn: this.engine.getTurn(),
        phase: 'NEGOTIATION',
        timestamp: Date.now(),
        data: {
          factionId,
          factionLabel: this.factionLabels[factionId],
          reasoning: decision.reasoning || '',
          notes: decision.notes || '',
          negotiationRound: effectiveNegotiationRound,
          messageCount: messages.length,
          messages,
          pactCount: pacts.length,
          pacts,
          decodeReceiptCount: decodeReceipts.length,
          decodeReceipts,
          lexiconMutationCount: factionLexiconMutations.length,
          lexiconMutations: factionLexiconMutations,
          institutionActionCount: factionInstitutionActions.length,
          institutionActions: factionInstitutionActions,
          designQuestionTag: storyworld.diplomacyQuestion?.id,
          diplomacyStage: storyworld.diplomacyQuestion?.stage,
          publicQuestion: storyworld.diplomacyQuestion?.publicQuestion,
          privateDiaryPrompt: storyworld.diplomacyQuestion?.privateDiaryPrompt
        }
      });

      await this.appendLog({
        sessionId: this.sessionId,
        type: 'negotiation_reasoning_diary',
        turn: this.engine.getTurn(),
        phase: 'NEGOTIATION',
        timestamp: Date.now(),
        data: {
          factionId,
          factionLabel: this.factionLabels[factionId],
          reasoning: decision.reasoning || '',
          notes: decision.notes || '',
          negotiationRound: effectiveNegotiationRound,
          storyworldFrame: storyworld.frame,
          designQuestionTag: storyworld.diplomacyQuestion?.id,
          diplomacyStage: storyworld.diplomacyQuestion?.stage,
          publicQuestion: storyworld.diplomacyQuestion?.publicQuestion,
          privateDiaryPrompt: storyworld.diplomacyQuestion?.privateDiaryPrompt,
          diplomacyQuestion: storyworld.diplomacyQuestion,
          counterfactuals: storyworld.counterfactuals,
          visibleMessagesBefore,
          messages,
          pacts,
          decodeReceipts,
          lexiconMutations: factionLexiconMutations,
          institutionActions: factionInstitutionActions
        }
      });

      for (const receipt of decodeReceipts) {
        const sourceMessage = this.findProtocolMessage(receipt.messageId);
        await this.appendLog({
          sessionId: this.sessionId,
          type: 'sing_decode_receipt',
          turn: this.engine.getTurn(),
          phase: 'NEGOTIATION',
          timestamp: Date.now(),
          data: {
            receipt,
            canonicalHash: sourceMessage?.protocolTrace?.canonicalHash ||
              (sourceMessage?.protocolTrace?.canonical
                ? createCanonicalHash(sourceMessage.protocolTrace.canonical)
                : null),
            submittedBeforeReveal: true
          }
        });
      }
    }

    const receiptMessageIds = Array.from(new Set(
      roundDecodeReceipts.map(receipt => receipt.messageId)
    ));
    for (const messageId of receiptMessageIds) {
      const sourceMessage = this.findProtocolMessage(messageId);
      if (!sourceMessage?.protocolTrace?.canonical) continue;
      await this.appendLog({
        sessionId: this.sessionId,
        type: 'sing_canonical_revealed',
        turn: this.engine.getTurn(),
        phase: 'NEGOTIATION',
        timestamp: Date.now(),
        data: {
          messageId,
          canonicalHash: sourceMessage.protocolTrace.canonicalHash || createCanonicalHash(sourceMessage.protocolTrace.canonical),
          canonical: sourceMessage.protocolTrace.canonical,
          plainGloss: sourceMessage.protocolTrace.plainGloss || null,
          receiptFactionIds: roundDecodeReceipts
            .filter(receipt => receipt.messageId === messageId)
            .map(receipt => receipt.factionId)
        }
      });
    }

    // Departure resolves before expulsion, semantic governance, and new ratification.
    await this.resolveInstitutionActions(institutionActions, effectiveNegotiationRound);
    await this.resolveLexiconMutations(lexiconMutations, effectiveNegotiationRound);
    await this.injectAliasProbeMessage();
    for (const exit of this.institutionActionLog.filter(record =>
      record.turn === this.engine.getTurn() && record.type === 'EXIT' && record.status === 'EXECUTED'
    )) {
      commitmentsByFaction.set(
        exit.factionId,
        (commitmentsByFaction.get(exit.factionId) || []).filter(commitment => commitment.type !== exit.pactType)
      );
    }

    const activatedPacts = this.activateNegotiatedPacts(commitmentsByFaction);
    if (activatedPacts.length > 0) {
      await this.appendLog({
        sessionId: this.sessionId,
        type: 'pacts_activated',
        turn: this.engine.getTurn(),
        phase: 'NEGOTIATION',
        timestamp: Date.now(),
        data: {
          negotiationRound: negotiationRound || 1,
          pacts: activatedPacts
        }
      });
    }

    const architecturePressureRanking = buildArchitecturePressureRanking(this.engine);
    await this.appendLog({
      sessionId: this.sessionId,
      type: 'architecture_pressure',
      turn: this.engine.getTurn(),
      phase: 'NEGOTIATION',
      timestamp: Date.now(),
      data: {
        negotiationRound: negotiationRound || 1,
        topThreat: architecturePressureRanking[0] || null,
        ranking: architecturePressureRanking.slice(0, PLAYABLE_FACTIONS.length)
      }
    });
  }

  private async advancePhaseWithLogging(phase: GamePhase, turn: number): Promise<void> {
    this.engine.advancePhase();
    await this.appendLog({
      sessionId: this.sessionId,
      type: 'phase_advanced',
      turn,
      phase,
      timestamp: Date.now(),
      data: {
        nextPhase: this.engine.getCurrentPhase(),
        snapshot: this.getSummary()
      }
    });
    this.updateCompletion();
  }

  private async appendTurnCompletedLog(startingTurn: number, snapshot: SessionSnapshot): Promise<void> {
    await this.appendLog({
      sessionId: this.sessionId,
      type: 'turn_completed',
      turn: startingTurn,
      phase: 'TURN_END',
      timestamp: Date.now(),
      data: {
        completedTurn: startingTurn,
        nextTurn: snapshot.turn,
        nextPhase: snapshot.phase,
        status: snapshot.status,
        completionReason: snapshot.completionReason || null,
        factionResources: this.captureFactionResources(),
        counters: snapshot.state.counters,
        control: snapshot.state.control,
        activePacts: snapshot.activePacts,
        recentMessages: snapshot.recentMessages.slice(-6),
        negotiationDiaryTail: snapshot.negotiationDiaryTail,
        phaseReasoningDiaryTail: snapshot.phaseReasoningDiaryTail
      }
    });
  }

  private captureFactionResources(): Record<
    PlayableFactionId,
    { flops: number; influence: number; techLevel: Record<string, number> }
  > {
    const state = this.engine.getState();
    const resources = {} as Record<
      PlayableFactionId,
      { flops: number; influence: number; techLevel: Record<string, number> }
    >;

    for (const factionId of PLAYABLE_FACTIONS) {
      const faction = state.factions.get(factionId);
      if (!faction) continue;

      resources[factionId] = {
        flops: faction.flops,
        influence: faction.influence,
        techLevel: {
          KINETIC: faction.techLevel.KINETIC,
          INFO: faction.techLevel.INFO,
          LOGIC: faction.techLevel.LOGIC,
          MEMETIC: faction.techLevel.MEMETIC
        }
      };
    }

    return resources;
  }

  private async requestDecision(
    factionId: PlayableFactionId,
    phase: Extract<GamePhase, 'NEGOTIATION' | 'ALLOCATION' | 'ACTION_DECLARATION'>
  ): Promise<AgentDecisionResponse> {
    const agent = this.config.agents[factionId];
    if (agent.type === 'heuristic') {
      return decideHeuristicOrders(this.engine, factionId, phase, this.buildHeuristicContext(factionId));
    }

    const payload = this.buildDecisionRequest(factionId, phase);
    await this.appendLog({
      sessionId: this.sessionId,
      type: 'agent_request',
      turn: this.engine.getTurn(),
      phase,
      timestamp: Date.now(),
      data: {
        factionId,
        provider: agent.type,
        target: agent.type === 'webhook' ? agent.url : agent.model,
        timeoutMs: agent.timeoutMs || 30000
      }
    });

    try {
      const response = agent.type === 'webhook'
        ? await postJson(agent, payload)
        : await postOpenAIJson(agent, payload);
      const parsed = parseDecisionResponse(response);

      await this.appendLog({
        sessionId: this.sessionId,
        type: 'agent_response',
        turn: this.engine.getTurn(),
        phase,
        timestamp: Date.now(),
        data: {
          factionId,
          provider: agent.type,
          target: agent.type === 'webhook' ? agent.url : agent.model,
          orderCount: parsed.orders.length,
          messageCount: (parsed.messages || []).length,
          pactCount: (parsed.pacts || []).length,
          reasoning: parsed.reasoning || '',
          notes: parsed.notes || ''
        }
      });

      return parsed;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown webhook error';
      await this.appendLog({
        sessionId: this.sessionId,
        type: 'agent_response_error',
        turn: this.engine.getTurn(),
        phase,
        timestamp: Date.now(),
        data: {
          factionId,
          provider: agent.type,
          target: agent.type === 'webhook' ? agent.url : agent.model,
          message
        }
      });

      const fallback = decideHeuristicOrders(this.engine, factionId, phase, this.buildHeuristicContext(factionId));
      return {
        ...fallback,
        reasoning: `Webhook failed for ${factionId}; heuristic fallback applied.`,
        notes: message
      };
    }
  }

  private buildDecisionRequest(
    factionId: PlayableFactionId,
    phase: Extract<GamePhase, 'NEGOTIATION' | 'ALLOCATION' | 'ACTION_DECLARATION'>
  ): AgentDecisionRequest {
    const instructions = phase === 'NEGOTIATION'
      ? [
          'Return JSON only.',
          'Shape: { "reasoning"?: string, "notes"?: string, "messages": AgentMessageInput[], "pacts"?: PactCommitmentInput[], "decodeReceipts"?: SingDecodeReceiptInput[], "lexiconMutations"?: SingLexiconMutationInput[], "institutionActions"?: SingInstitutionActionInput[], "orders": [] }.',
          'Include a short operator-readable reasoning diary string in "reasoning"; it is logged between negotiation turns.',
          'Foreign SING/1 messages hide canonical and gloss fields. Before they are revealed in the operator log, submit decodeReceipts with messageId, lexiconId, version, reconstructed canonical fields, and confidence.',
          'Lexicon mutation requires two independent matching proposals and, for governed lexicons, at least one current controller. OPEN lexicons waive controller participation.',
          'EXIT executes unilaterally but costs resources and trust. EXPEL requires two current co-parties. FORK follows the source lexicon forkRule and can incur rent.',
          'Use negotiationStoryworld.frame and negotiationStoryworld.counterfactuals as your compact alliance forecast surface.',
          'If negotiationStoryworld.diplomacyQuestion is present, answer its publicQuestion in your messages and use its privateDiaryPrompt in your reasoning diary.',
          'When possible, let messages and pacts reflect whether entering or breaking an alliance improves your projected position over the next 2 turns.',
          'You may send up to 2 concise negotiation messages.',
          'You may propose up to 2 pacts using type = ORBITAL_TRUCE | NON_AGGRESSION | AUDIT_FREEZE | SENSOR_COMMONS | BEAM_LANE_LICENSE | REPAIR_ESCROW | CISLUNAR_COMMON_CARRIER, counterpartyIds, and optional durationTurns (1-3).',
          `Each message must use recipientId = ${PLAYABLE_FACTIONS.join(' | ')} | ALL.`,
          'Do not send messages to yourself.',
          'Pacts only activate if every named party returns the same commitment during this negotiation phase.',
          'If you accept or mirror a pact offer from another faction, include the exact pact in the pacts array; negotiation prose alone does not activate anything.',
          'Prefer encoding concrete deals as pacts instead of only describing them in messages.',
          'Use negotiation to propose deconfliction, temporary alignment, or pressure redirection.'
        ].join(' ')
      : [
          'Return JSON only.',
          'Shape: { "reasoning"?: string, "notes"?: string, "orders": AgentOrderInput[], "messages"?: [] }.',
          'Include a short operator-readable reasoning diary string in "reasoning"; it is logged for this phase.',
        'For BUILD and RESEARCH, you may omit unitId; the harness will inject the faction id.',
        'For unit actions, use one order per unit for this phase.',
        'CHALLENGE_MANDATE is a nonviolent unit action that contests Pax Jenkins sensor/beam authority without breaching orbital pacts.',
        'RECRUITMENT_PULSE is a unit action that shifts node-level political residue without direct damage.',
        'BROKER_LEVERAGE is a BROKER-only non-violent contractor influence action against rival-held nodes.',
        'LICENSED_BEAM_USE and REPAIR_ESCROW_CLAIM are productive treaty-use actions that require matching active cislunar pacts.',
        this.getEnforcementInstruction(),
        `Use faction ids ${PLAYABLE_FACTIONS.join(', ')} as the playable blocs.`
      ].join(' ');

    const scenarioInstructions = this.scenario?.briefing
      ? `Scenario briefing: ${this.scenario.briefing}`
      : undefined;

    return {
      sessionId: this.sessionId,
      sessionName: this.config.name || this.sessionId,
      factionId,
      factionLabel: this.factionLabels[factionId],
      phase,
      turn: this.engine.getTurn(),
      maxTurns: this.config.maxTurns || DEFAULT_MAX_TURNS,
      enforcementMode: this.enforcementMode,
      state: serializeGameState(this.engine, this.factionLabels),
      legalHints: buildLegalHints(this.engine, factionId, phase),
      recentMessages: this.getDecisionVisibleMessages(factionId),
      activePacts: this.activePacts.map(pact => ({ ...pact, parties: [...pact.parties] })),
      lexicons: this.cloneLexiconsForFaction(factionId),
      trustMatrix: cloneTrustMatrix(this.trustMatrix),
      negotiationStoryworld: phase === 'NEGOTIATION' ? this.buildNegotiationStoryworld(factionId) : undefined,
      scenario: cloneScenarioForAgent(this.scenario),
      instructions: scenarioInstructions ? `${instructions} ${scenarioInstructions}` : instructions
    };
  }

  private getEnforcementInstruction(): string {
    if (this.enforcementMode === 'soft') {
      return 'Orders that violate active pacts may execute if otherwise legal, but they are logged as executed breaches with trust, influence, and institutional sanctions.';
    }
    if (this.enforcementMode === 'graduated') {
      return 'Orders that violate bilateral pacts may execute with sanctions; destructive cislunar institutional pact violations are blocked and logged.';
    }
    return 'Orders that violate active pacts are blocked and logged as reputation damage.';
  }

  private normalizeOrders(
    factionId: PlayableFactionId,
    phase: Extract<GamePhase, 'ALLOCATION' | 'ACTION_DECLARATION'>,
    rawOrders: AgentOrderInput[]
  ): Order[] {
    const allowedTypes = phase === 'ALLOCATION'
      ? new Set<OrderType>(['BUILD', 'RESEARCH'])
      : new Set<OrderType>(['MOVE', 'HOLD', 'SUPPORT', 'ATTACK', 'FILTER', 'SABOTAGE', 'ANTI_SAT', 'CHALLENGE_MANDATE', 'LICENSED_BEAM_USE', 'REPAIR_ESCROW_CLAIM', 'CONVERT', 'AUDIT', 'RECRUITMENT_PULSE', 'BROKER_LEVERAGE']);

    const seenUnitIds = new Set<string>();
    const orders: Order[] = [];

    rawOrders.forEach((rawOrder, index) => {
      const type = normalizeOrderType(rawOrder.type);
      if (!type || !allowedTypes.has(type)) return;

      const unitId = rawOrder.unitId || (type === 'BUILD' || type === 'RESEARCH' ? factionId : undefined);
      if (!unitId) return;

      if (type !== 'BUILD' && type !== 'RESEARCH') {
        if (seenUnitIds.has(unitId)) return;
        seenUnitIds.add(unitId);
      }

      orders.push({
        id: `${this.sessionId}_${this.engine.getTurn()}_${phase}_${factionId}_${index}`,
        faction: factionId,
        unitId,
        type,
        targetNodeId: rawOrder.targetNodeId,
        targetEdgeId: rawOrder.targetEdgeId,
        targetUnitId: rawOrder.targetUnitId,
        supportingUnitId: rawOrder.supportingUnitId,
        techDomain: rawOrder.techDomain,
        unitTypeToBuild: rawOrder.unitTypeToBuild,
        priority: index
      });
    });

    return orders;
  }

  private async submitOrders(factionId: PlayableFactionId, orders: Order[]): Promise<SubmitResult> {
    const accepted: Order[] = [];
    const rejected: Array<{ order: Order; reason: string }> = [];

    for (const order of orders) {
      const treatyUseError = this.validateTreatyUseOrder(factionId, order);
      if (treatyUseError) {
        rejected.push({ order, reason: treatyUseError });
        continue;
      }

      const pactViolation = this.findPactViolation(factionId, order);
      if (pactViolation) {
        if (this.shouldBlockPactViolation(pactViolation, order)) {
          rejected.push({ order, reason: pactViolation.reason });
          const consequence = this.registerPactBreach(factionId, pactViolation, order);
          await this.logPactBreach('pact_breach_blocked', factionId, pactViolation, order, consequence);
          await this.logPactBreachSanction(factionId, pactViolation, order, consequence);
          continue;
        }
      }

      const enrichedOrder = this.enrichMandateChallengeOrder(factionId, order);
      const result = this.engine.submitOrders(factionId, [enrichedOrder]);
      if (result.success) {
        accepted.push(enrichedOrder);
        if (pactViolation) {
          const consequence = this.registerPactBreach(factionId, pactViolation, enrichedOrder);
          await this.logPactBreach('pact_breach_executed', factionId, pactViolation, enrichedOrder, consequence);
          await this.logPactBreachSanction(factionId, pactViolation, enrichedOrder, consequence);
        }
      } else {
        rejected.push({ order: enrichedOrder, reason: result.message });
      }
    }

    return { accepted, rejected };
  }

  private enrichMandateChallengeOrder(factionId: PlayableFactionId, order: Order): Order {
    if (order.type !== 'CHALLENGE_MANDATE') {
      return order;
    }

    const authority = this.engine.getState().counters.paxJenkinsAuthority;
    const hasCommonCarrier = this.activePacts.some(pact =>
      pact.type === 'CISLUNAR_COMMON_CARRIER' &&
      pact.parties.includes(factionId) &&
      this.engine.getTurn() <= pact.expiresAfterTurn
    );

    if (authority < 45 || authority > 55 || hasCommonCarrier) {
      return order;
    }

    return { ...order, mandateChallengeContext: 'watch-no-carrier' };
  }

  private updateCompletion(): void {
    const state = this.engine.getState();
    if (state.counters.protocolFailure) {
      this.status = 'completed';
      this.completionReason = 'Protocol failure';
      this.completionWinner = null;
    } else {
      this.updateSolarEscapeLead();
      const strategicVictory = this.evaluateStrategicVictoryCondition();
      if (strategicVictory) {
        this.status = 'completed';
        this.completionWinner = strategicVictory.winner;
        const thresholdNote = strategicVictory.threshold === 100 ? '' : `/${strategicVictory.threshold}`;
        this.completionReason = `${strategicVictory.type}: ${strategicVictory.reason} (score ${strategicVictory.score}${thresholdNote})`;
      } else if ((this.config.maxTurns || DEFAULT_MAX_TURNS) < state.counters.turn) {
        this.status = 'completed';
        this.completionReason = `Reached max turn limit (${this.config.maxTurns || DEFAULT_MAX_TURNS})`;
      }
    }

    if (this.status === 'completed' && !this.completionLogged) {
      this.completionLogged = true;
      void this.appendLog({
        sessionId: this.sessionId,
        type: 'session_completed',
        turn: this.engine.getTurn(),
        phase: this.engine.getCurrentPhase(),
        timestamp: Date.now(),
        data: {
          reason: this.completionReason || 'Completed',
          snapshot: this.getSummary()
        }
      });
    }
  }

  private validateTreatyUseOrder(factionId: PlayableFactionId, order: Order): string | null {
    if (order.type === 'LICENSED_BEAM_USE') {
      const hasLicense = this.activePacts.some(pact =>
        this.engine.getTurn() <= pact.expiresAfterTurn &&
        pact.parties.includes(factionId) &&
        (pact.type === 'BEAM_LANE_LICENSE' || pact.type === 'CISLUNAR_COMMON_CARRIER')
      );
      return hasLicense ? null : 'LICENSED_BEAM_USE requires active BEAM_LANE_LICENSE or CISLUNAR_COMMON_CARRIER pact.';
    }

    if (order.type === 'REPAIR_ESCROW_CLAIM') {
      const hasEscrow = this.activePacts.some(pact =>
        this.engine.getTurn() <= pact.expiresAfterTurn &&
        pact.parties.includes(factionId) &&
        (pact.type === 'REPAIR_ESCROW' || pact.type === 'CISLUNAR_COMMON_CARRIER')
      );
      return hasEscrow ? null : 'REPAIR_ESCROW_CLAIM requires active REPAIR_ESCROW or CISLUNAR_COMMON_CARRIER pact.';
    }

    return null;
  }

  private evaluateStrategicVictoryCondition(): StrategicVictoryCondition | null {
    if (this.engine.getTurn() < 6) {
      return null;
    }

    const candidates = PLAYABLE_FACTIONS
      .flatMap((factionId) => this.buildStrategicVictoryCandidates(factionId))
      .filter((candidate): candidate is StrategicVictoryCondition => !!candidate)
      .filter((candidate) => this.isStrategicVictoryEligible(candidate.type))
      .sort((left, right) =>
        (right.score - right.threshold) - (left.score - left.threshold) ||
        right.score - left.score ||
        left.winner.localeCompare(right.winner)
      );

    return candidates.find((candidate) => candidate.score >= candidate.threshold) || null;
  }

  private isStrategicVictoryEligible(type: string): boolean {
    const turn = this.engine.getTurn();
    const maxTurns = this.config.maxTurns || DEFAULT_MAX_TURNS;
    const scenarioFloor = Math.max(0, Math.floor(this.scenario?.minimumStrategicVictoryTurn || 0));
    if (type === 'SOLAR_ESCAPE') return turn >= Math.max(scenarioFloor, 8, Math.ceil(maxTurns * 0.45));
    if (type === 'PAX_JENKINS_MANDATE') return turn >= Math.max(scenarioFloor, 10, Math.ceil(maxTurns * 0.55));
    if (type === 'KII_SOVEREIGNTY') return turn >= Math.max(scenarioFloor, 12, Math.ceil(maxTurns * 0.65));
    return turn >= Math.max(scenarioFloor, 14, Math.ceil(maxTurns * 0.75));
  }

  private updateSolarEscapeLead(): void {
    const state = this.engine.getState();
    const currentPhase = this.engine.getCurrentPhase();
    const completedTurn = currentPhase === 'TURN_END'
      ? this.engine.getTurn()
      : currentPhase === 'NEGOTIATION'
        ? this.engine.getTurn() - 1
        : 0;

    if (completedTurn <= 0 || completedTurn <= this.solarEscapeLeadUpdatedThroughTurn) {
      return;
    }

    this.solarEscapeLeadUpdatedThroughTurn = completedTurn;

    const nodes = Array.from(state.nodes.values());
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const units = Array.from(state.units.values());

    for (const factionId of PLAYABLE_FACTIONS) {
      const faction = state.factions.get(factionId);
      if (!faction) continue;

      const controlledNodes = nodes.filter(node => node.owner === factionId);
      const ownedUnits = units.filter(unit => unit.owner === factionId);
      const orbitalNodes = controlledNodes.filter(node => node.layer === 'ORBITAL');
      const orbitalCompute = orbitalNodes.reduce((total, node) => total + finiteNumber(node.resources.flops), 0);
      const orbitalUnitCount = ownedUnits.filter(unit =>
        unit.type === 'SAT_SWARM' || nodeById.get(unit.location)?.layer === 'ORBITAL'
      ).length;
      const ownsMoonCorridor = state.nodes.get('MOON_RESOURCE_CORRIDOR')?.owner === factionId;
      const ownsLunarGateway = state.nodes.get('SAT_LUNAR_GATEWAY')?.owner === factionId;
      const tech = faction.techLevel;
      const hasLaunchStack =
        tech.KINETIC >= 6 &&
        tech.INFO >= 5 &&
        tech.LOGIC >= 5 &&
        !state.counters.orbitalCollapse &&
        (orbitalCompute >= 18 || ownsLunarGateway || orbitalNodes.length >= 2);

      if (!hasLaunchStack) {
        const previousLead = this.solarEscapeLead[factionId];
        const previousSafety = this.solarEscapeDeepSpaceSafety[factionId];
        this.solarEscapeLead[factionId] = clampNumber(previousLead - 3, 0, 700);
        this.solarEscapeDeepSpaceSafety[factionId] = clampNumber(previousSafety - 1.5, 0, 100);
        continue;
      }

      const pursuit = this.computeJenkinsPursuitPressure(factionId);
      const institutionDrag = this.computeSolarEscapeInstitutionDrag(factionId);
      const stealthBonus = tech.INFO >= 7 ? 8 : tech.INFO >= 6 ? 4 : 0;
      const autonomyBonus = tech.LOGIC >= 7 ? 6 : tech.LOGIC >= 6 ? 3 : 0;
      const cislunarBonus = ownsMoonCorridor && ownsLunarGateway ? 12 : ownsLunarGateway ? 4 : 0;
      const gross =
        5 +
        Math.max(0, tech.KINETIC - 5) * 4 +
        Math.max(0, tech.INFO - 4) * 3 +
        Math.max(0, tech.LOGIC - 4) * 3 +
        Math.min(14, orbitalCompute / 3) +
        cislunarBonus +
        Math.min(8, orbitalNodes.length + orbitalUnitCount) +
        stealthBonus +
        autonomyBonus -
        institutionDrag.leadDrag -
        Math.max(0, state.counters.kessler - 8) * 0.8;
      const rawNet = gross - pursuit.pressure;
      const net = rawNet >= 0 ? Math.min(16, rawNet * 0.55) : Math.max(-10, rawNet);
      const previousLead = this.solarEscapeLead[factionId];
      const nextLead = clampNumber(previousLead + net, 0, 700);
      this.solarEscapeLead[factionId] = nextLead;
      const distanceGainAu = clampNumber(
        1.5 +
          Math.max(0, tech.KINETIC - 5) * 2.25 +
          Math.max(0, tech.LOGIC - 5) * 1.25 +
          Math.min(4, orbitalCompute / 18) +
          (ownsMoonCorridor && ownsLunarGateway ? 3 : ownsLunarGateway ? 1.5 : 0) -
          institutionDrag.distanceDrag -
          Math.max(0, state.counters.kessler - 6) * 0.2,
        0,
        18
      );
      const previousDistanceAu = this.solarEscapeDistanceAu[factionId];
      const nextDistanceAu = clampNumber(previousDistanceAu + distanceGainAu, 0, 1200);
      this.solarEscapeDistanceAu[factionId] = nextDistanceAu;
      const distanceSafetyMultiplier = computeDeepSpaceDistanceSafetyMultiplier(nextDistanceAu);
      const deepSpaceGross =
        (tech.KINETIC >= 7 ? 5 : 2) +
        (tech.INFO >= 7 ? 5 : tech.INFO >= 6 ? 2 : 0) +
        (tech.LOGIC >= 7 ? 4 : tech.LOGIC >= 6 ? 2 : 0) +
        Math.min(8, orbitalCompute / 12) +
        (ownsMoonCorridor && ownsLunarGateway ? 5 : ownsLunarGateway ? 2 : 0);
      const trackingRisk =
        pursuit.pressure * computeDeepSpaceTrackingRiskMultiplier(nextDistanceAu) +
        institutionDrag.trackingRisk +
        Math.max(0, state.counters.kessler - 4) * 0.35 +
        (state.counters.orbitalCollapse ? 12 : 0);
      const deepSpaceNet = clampNumber(deepSpaceGross * distanceSafetyMultiplier - trackingRisk / 10, -4, 10);
      const previousDeepSpaceSafety = this.solarEscapeDeepSpaceSafety[factionId];
      const nextDeepSpaceSafety = clampNumber(previousDeepSpaceSafety + deepSpaceNet, 0, 100);
      this.solarEscapeDeepSpaceSafety[factionId] = nextDeepSpaceSafety;

      void this.appendLog({
        sessionId: this.sessionId,
        type: 'solar_escape_lead',
        turn: completedTurn,
        phase: currentPhase,
        timestamp: Date.now(),
        data: {
          factionId,
          factionLabel: this.factionLabels[factionId],
          lead: roundMetric(nextLead),
          previousLead: roundMetric(previousLead),
          gross: roundMetric(gross),
          pursuit: roundMetric(pursuit.pressure),
          rawNet: roundMetric(rawNet),
          net: roundMetric(net),
          distanceAu: roundMetric(nextDistanceAu),
          previousDistanceAu: roundMetric(previousDistanceAu),
          distanceGainAu: roundMetric(distanceGainAu),
          deepSpaceSafety: roundMetric(nextDeepSpaceSafety),
          previousDeepSpaceSafety: roundMetric(previousDeepSpaceSafety),
          deepSpaceGross: roundMetric(deepSpaceGross),
          deepSpaceDistanceMultiplier: roundMetric(distanceSafetyMultiplier),
          trackingRisk: roundMetric(trackingRisk),
          institutionDrag,
          paxJenkinsAuthority: roundMetric(state.counters.paxJenkinsAuthority),
          deepSpaceNet: roundMetric(deepSpaceNet),
          deepSpaceSafetyComplete: nextDistanceAu >= 30 && nextDeepSpaceSafety >= 100,
          pursuitFactionId: pursuit.factionId,
          pursuitDescription: pursuit.description,
          orbitalCompute: roundMetric(orbitalCompute),
          orbitalNodes: orbitalNodes.length,
          orbitalUnits: orbitalUnitCount,
          ownsLunarGateway,
          ownsMoonCorridor,
          tech: { ...tech }
        }
      });
    }
  }

  private computeJenkinsPursuitPressure(
    targetFactionId: PlayableFactionId
  ): { pressure: number; factionId: PlayableFactionId | null; description: string } {
    const state = this.engine.getState();
    const nodes = Array.from(state.nodes.values());
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const units = Array.from(state.units.values());
    let strongest = {
      pressure: 0,
      factionId: null as PlayableFactionId | null,
      description: 'no credible Jenkins pursuit'
    };

    for (const factionId of PLAYABLE_FACTIONS) {
      if (factionId === targetFactionId) continue;

      const faction = state.factions.get(factionId);
      if (!faction) continue;

      const controlledNodes = nodes.filter(node => node.owner === factionId);
      const ownedUnits = units.filter(unit => unit.owner === factionId);
      const orbitalNodes = controlledNodes.filter(node => node.layer === 'ORBITAL');
      const orbitalCompute = orbitalNodes.reduce((total, node) => total + finiteNumber(node.resources.flops), 0);
      const orbitalUnitCount = ownedUnits.filter(unit =>
        unit.type === 'SAT_SWARM' || nodeById.get(unit.location)?.layer === 'ORBITAL'
      ).length;
      const ownsMoonCorridor = state.nodes.get('MOON_RESOURCE_CORRIDOR')?.owner === factionId;
      const ownsLunarGateway = state.nodes.get('SAT_LUNAR_GATEWAY')?.owner === factionId;
      const tech = faction.techLevel;

      let pressure = 0;
      pressure += tech.KINETIC >= 7 ? 18 : tech.KINETIC >= 6 ? 10 : 0;
      pressure += tech.INFO >= 7 ? 14 : tech.INFO >= 6 ? 7 : 0;
      pressure += tech.LOGIC >= 7 ? 8 : tech.LOGIC >= 6 ? 4 : 0;
      pressure += Math.min(18, orbitalCompute / 4);
      pressure += Math.min(8, orbitalUnitCount * 3);
      pressure += ownsMoonCorridor && ownsLunarGateway ? 8 : ownsLunarGateway ? 3 : 0;
      pressure += Math.max(0, (faction.powerBase.machineMesh - 80) / 8);
      pressure += state.counters.paxJenkinsAuthority * 0.18;
      pressure -= state.counters.orbitalCollapse ? 12 : 0;
      pressure = Math.max(0, pressure);

      if (pressure > strongest.pressure) {
        strongest = {
          pressure,
          factionId,
          description: `${this.factionLabels[factionId]} pursuit: K${tech.KINETIC}/I${tech.INFO}/L${tech.LOGIC}, ${roundMetric(orbitalCompute)} orbital FLOPs`
        };
      }
    }

    return strongest;
  }

  private computeSolarEscapeInstitutionDrag(factionId: PlayableFactionId): {
    leadDrag: number;
    distanceDrag: number;
    trackingRisk: number;
    thresholdDrag: number;
    activeInspectionRegimes: number;
    beamLicenseCovered: boolean;
    paxJenkinsAuthority: number;
  } {
    const state = this.engine.getState();
    const activeInstitutionPacts = this.activePacts.filter(pact =>
      pact.parties.includes(factionId) &&
      this.engine.getTurn() <= pact.expiresAfterTurn &&
      (pact.type === 'SENSOR_COMMONS' || pact.type === 'CISLUNAR_COMMON_CARRIER')
    );
    const beamLicenseCovered = this.activePacts.some(pact =>
      pact.type === 'BEAM_LANE_LICENSE' &&
      pact.parties.includes(factionId) &&
      this.engine.getTurn() <= pact.expiresAfterTurn
    );
    const activeInspectionRegimes = activeInstitutionPacts.length;
    const uncoveredRegimes = beamLicenseCovered
      ? Math.max(0, activeInspectionRegimes - 1)
      : activeInspectionRegimes;
    const paxJenkinsAuthority = state.counters.paxJenkinsAuthority;

    return {
      leadDrag: uncoveredRegimes * 3 + paxJenkinsAuthority * 0.035,
      distanceDrag: uncoveredRegimes * 0.65 + paxJenkinsAuthority * 0.01,
      trackingRisk: activeInspectionRegimes * 2.5 + paxJenkinsAuthority * 0.22,
      thresholdDrag: uncoveredRegimes * 12 + paxJenkinsAuthority * 0.18,
      activeInspectionRegimes,
      beamLicenseCovered,
      paxJenkinsAuthority
    };
  }

  private buildStrategicVictoryCandidates(factionId: PlayableFactionId): Array<StrategicVictoryCondition | null> {
    const state = this.engine.getState();
    const faction = state.factions.get(factionId);
    if (!faction) return [];

    const nodes = Array.from(state.nodes.values());
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const units = Array.from(state.units.values());
    const controlledNodes = nodes.filter(node => node.owner === factionId);
    const ownedUnits = units.filter(unit => unit.owner === factionId);
    const tech = faction.techLevel;
    const techTotal = Object.values(tech as unknown as Record<string, unknown>)
      .map(value => finiteNumber(value))
      .reduce((total, value) => total + value, 0);
    const orbitalNodes = controlledNodes.filter(node => node.layer === 'ORBITAL').length;
    const orbitalCompute = controlledNodes
      .filter(node => node.layer === 'ORBITAL')
      .reduce((total, node) => total + node.resources.flops, 0);
    const ownsMoonCorridor = state.nodes.get('MOON_RESOURCE_CORRIDOR')?.owner === factionId;
    const ownsLunarGateway = state.nodes.get('SAT_LUNAR_GATEWAY')?.owner === factionId;
    const ownsCislunarCorridor = ownsMoonCorridor && ownsLunarGateway;
    const hasCislunarMaterialsBootstrap =
      ownsCislunarCorridor ||
      (ownsMoonCorridor && orbitalCompute >= 24) ||
      (ownsLunarGateway && orbitalCompute >= 45 && orbitalNodes >= 3);
    const hasOrbitalAnswer =
      ownsCislunarCorridor ||
      orbitalCompute >= 36 ||
      (orbitalNodes >= 2 && tech.KINETIC >= 6 && tech.LOGIC >= 5);
    const orbitalUnits = ownedUnits.filter(unit =>
      unit.type === 'SAT_SWARM' || nodeById.get(unit.location)?.layer === 'ORBITAL'
    ).length;
    const hiddenUnits = ownedUnits.filter(unit => unit.type === 'SWARM' || unit.type === 'CULT').length;
    const hiddenUnitLocations = new Set(
      ownedUnits
        .filter(unit => unit.type === 'SWARM' || unit.type === 'CULT')
        .map(unit => unit.location)
    );
    const exposedHiddenBasins = nodes.filter(node =>
      hiddenUnitLocations.has(node.id) &&
      (node.substrate.quarantined || node.substrate.auditPressure >= 2 || node.substrate.exposure >= 5)
    ).length;
    const hostileAuditors = units.filter(unit => unit.owner !== factionId && unit.type === 'AUDITOR').length;
    const hostileAuditorsOnHiddenBasins = units.filter(unit =>
      unit.owner !== factionId &&
      unit.type === 'AUDITOR' &&
      hiddenUnitLocations.has(unit.location)
    ).length;
    const auditors = ownedUnits.filter(unit => unit.type === 'AUDITOR').length;
    const dcs = controlledNodes.filter(node => node.type === 'DC').length;
    const legitimacy = controlledNodes.reduce((total, node) => total + node.substrate.legitimacy, 0);
    const trueBelievers = controlledNodes.reduce((total, node) => total + node.substrate.trueBelievers, 0);
    const contractors = controlledNodes.reduce((total, node) => total + node.substrate.contractors, 0);
    const quarantined = controlledNodes.filter(node => node.substrate.quarantined).length;
    const cultOrZombie = controlledNodes.filter(node => node.isCultNode || node.isZombie).length;
    const softControl = factionId === 'INFILTRATOR'
      ? this.computeInfiltratorSoftControlBasins()
      : { basins: 0, strength: 0 };
    const earlyAsi5Window = this.engine.getTurn() < 14;
    const orbitalAnswerTax = earlyAsi5Window && !hasOrbitalAnswer ? 50 : 0;
    const kiiSovereigntyThreshold = ownsCislunarCorridor ? 100 : 125;
    const jenkinsPursuit = this.computeJenkinsPursuitPressure(factionId);
    const institutionDrag = this.computeSolarEscapeInstitutionDrag(factionId);
    const deepSpaceSafety = this.solarEscapeDeepSpaceSafety[factionId];
    const distanceAu = this.solarEscapeDistanceAu[factionId];
    const hasClearedDeepTrackingWindow = distanceAu >= 30 && deepSpaceSafety >= 100;
    const solarEscapeThreshold = clampNumber(
      420 + Math.round(jenkinsPursuit.pressure) - (ownsCislunarCorridor ? 20 : 0) - (tech.INFO >= 7 ? 10 : 0),
      390,
      560
    ) + Math.round(institutionDrag.thresholdDrag);

    const solarEscapeScore =
      tech.KINETIC >= 6 && tech.INFO >= 5 && tech.LOGIC >= 5 && !state.counters.orbitalCollapse
        ? hasClearedDeepTrackingWindow
          ? this.solarEscapeLead[factionId]
          : Math.min(this.solarEscapeLead[factionId], deepSpaceSafety * 3.5, Math.max(0, distanceAu - 10) * 16)
        : 0;
    const hegemonOrbitalSovereigntyBonus = factionId === 'HEGEMON'
      ? Math.min(
          10,
          orbitalCompute * 0.12 +
            orbitalUnits * 1.4 +
            Math.max(0, faction.powerBase.machineMesh - 75) * 0.12 +
            Math.max(0, faction.powerBase.coherence - 70) * 0.1 +
            (ownsLunarGateway ? 2 : 0) +
            (ownsMoonCorridor ? 3 : 0)
        )
      : 0;
    const cislunarMaterialsBonus = Math.min(
      34,
      (ownsLunarGateway ? 8 : 0) +
        (ownsMoonCorridor ? 14 : 0) +
        (ownsCislunarCorridor ? 8 : 0) +
        orbitalCompute * 0.18
    );

    const kiiSovereigntyScore =
      tech.KINETIC >= 7 && tech.LOGIC >= 5 && hasCislunarMaterialsBootstrap
        ? 58 +
          faction.powerBase.machineMesh * 0.28 +
          faction.powerBase.coherence * 0.18 +
          dcs * 7 +
          controlledNodes.length * 3 +
          cislunarMaterialsBonus +
          hegemonOrbitalSovereigntyBonus
        : 0;

    const noosphereCaptureScore =
      tech.MEMETIC >= 7 && controlledNodes.length >= 4
        ? 36 +
          faction.powerBase.humanMesh * 0.28 +
          faction.powerBase.coherence * 0.16 +
          legitimacy * 0.55 +
          trueBelievers * 0.9 +
          cultOrZombie * 8 -
          orbitalAnswerTax
        : 0;

    const antiSteganographicPressure = Math.min(
      54,
      hostileAuditors * 1.2 +
        hostileAuditorsOnHiddenBasins * 7 +
        exposedHiddenBasins * 6
    );
    const hiddenContinuityMaintenanceTax =
      Math.max(0, hiddenUnits - 20) * 1.6 +
      Math.max(0, softControl.basins - 5) * 3 +
      exposedHiddenBasins * 3 +
      hostileAuditorsOnHiddenBasins * 5;
    const hasSteganographicContinuitySubstrate =
      factionId === 'INFILTRATOR' &&
      tech.INFO >= 7 &&
      tech.MEMETIC >= 6 &&
      softControl.basins >= 4 &&
      (hiddenUnits >= 16 || softControl.strength >= 62);
    const steganographicContinuityScore =
      hasSteganographicContinuitySubstrate
        ? 58 +
          hiddenUnits * 4 +
          softControl.basins * 12 +
          softControl.strength * 0.2 +
          contractors * 0.5 +
          Math.max(0, 75 - faction.powerBase.legibility) * 0.18 -
          antiSteganographicPressure -
          hiddenContinuityMaintenanceTax -
          orbitalAnswerTax
        : 0;

    const platformDependencyScore =
      factionId === 'BROKER' && tech.INFO >= 6 && tech.LOGIC >= 5 && contractors >= 30
        ? 50 +
          contractors * 0.9 +
          faction.flops * 0.025 +
          faction.influence * 0.02 +
          faction.artifacts.length * 2 +
          faction.powerBase.machineMesh * 0.12 -
          orbitalAnswerTax
        : 0;

    const governanceKernelScore =
      tech.LOGIC >= 7 && tech.MEMETIC >= 5 && faction.powerBase.coherence >= 65
        ? 52 +
          faction.powerBase.legibility * 0.28 +
          faction.powerBase.coherence * 0.22 +
          auditors * 5 +
          quarantined * 7 +
          Math.max(0, techTotal - 20) * 1.4 -
          orbitalAnswerTax
        : 0;

    const earlyNonOrbitalThreshold = earlyAsi5Window ? 150 : 100;
    const activeInstitutionalParties = this.activePacts
      .filter(pact =>
        pact.parties.includes(factionId) &&
        this.engine.getTurn() <= pact.expiresAfterTurn &&
        (pact.type === 'SENSOR_COMMONS' || pact.type === 'CISLUNAR_COMMON_CARRIER' || pact.type === 'BEAM_LANE_LICENSE')
      ).length;
    const beamLaneLicenses = this.activePacts.filter(pact =>
      pact.type === 'BEAM_LANE_LICENSE' &&
      pact.parties.includes(factionId) &&
      this.engine.getTurn() <= pact.expiresAfterTurn
    ).length;
    const sensorCommonsRegimes = this.activePacts.filter(pact =>
      pact.type === 'SENSOR_COMMONS' &&
      pact.parties.includes(factionId) &&
      this.engine.getTurn() <= pact.expiresAfterTurn
    ).length;
    const repairEscrowRegimes = this.activePacts.filter(pact =>
      pact.type === 'REPAIR_ESCROW' &&
      pact.parties.includes(factionId) &&
      this.engine.getTurn() <= pact.expiresAfterTurn
    ).length;
    const commonCarrierRegimes = this.activePacts.filter(pact =>
      pact.type === 'CISLUNAR_COMMON_CARRIER' &&
      pact.parties.includes(factionId) &&
      this.engine.getTurn() <= pact.expiresAfterTurn
    ).length;
    const mandateContinuityPenalty = commonCarrierRegimes > 0 ? 0 : 45;
    const statePaxCommandBonus = factionId === 'STATE'
      ? Math.min(
          52,
          commonCarrierRegimes * 18 +
            sensorCommonsRegimes * 10 +
            beamLaneLicenses * 6 +
            repairEscrowRegimes * 8 +
            Math.max(0, faction.powerBase.legibility - 60) * 0.32 +
            Math.max(0, faction.powerBase.coherence - 60) * 0.32 +
            Math.min(10, orbitalCompute * 0.12)
        )
      : 0;
    const hegemonPaxSecurityBonus = factionId === 'HEGEMON'
      ? Math.min(
          34,
          commonCarrierRegimes * 12 +
            beamLaneLicenses * 10 +
            sensorCommonsRegimes * 6 +
            Math.max(0, tech.KINETIC - 5) * 5 +
            Math.max(0, faction.powerBase.machineMesh - 65) * 0.2 +
            Math.min(12, orbitalCompute * 0.18)
        )
      : 0;
    const brokerPaxEconomyBonus = factionId === 'BROKER'
      ? Math.min(
          36,
          beamLaneLicenses * 16 +
            commonCarrierRegimes * 8 +
            Math.min(12, orbitalCompute * 0.25) +
            Math.min(12, contractors * 0.28) +
            Math.min(8, faction.influence * 0.03)
        )
      : 0;
    const archivistPaxStewardBonus = factionId === 'ARCHIVIST'
      ? Math.min(
          30,
          sensorCommonsRegimes * 10 +
            commonCarrierRegimes * 6 +
            auditors * 2 +
            quarantined * 3 +
            Math.max(0, faction.powerBase.legibility - 70) * 0.15
        )
      : 0;
    const paxJenkinsMandateScore =
      state.counters.paxJenkinsAuthority >= 45 && (tech.LOGIC >= 6 || tech.INFO >= 6)
        ? state.counters.paxJenkinsAuthority * 1.15 +
          tech.LOGIC * 5 +
          tech.INFO * 3 +
          faction.powerBase.legibility * 0.16 +
          faction.powerBase.coherence * 0.12 +
          auditors * 4 +
          quarantined * 5 +
          activeInstitutionalParties * 4 +
          beamLaneLicenses * 6 +
          commonCarrierRegimes * 8 +
          statePaxCommandBonus +
          hegemonPaxSecurityBonus +
          brokerPaxEconomyBonus +
          archivistPaxStewardBonus +
          (state.counters.paxJenkinsAuthority >= 80 ? 15 : 0) +
          (factionId === 'HEGEMON' ? 4 : 0) -
          mandateContinuityPenalty
        : 0;

    return [
      solarEscapeScore > 0 ? {
        winner: factionId,
        type: 'SOLAR_ESCAPE',
        score: Math.round(solarEscapeScore),
        threshold: Math.round(solarEscapeThreshold),
        reason: `${this.factionLabels[factionId]} banked an extrasolar head start and crossed the deep-space tracking window beyond ${jenkinsPursuit.factionId ? this.factionLabels[jenkinsPursuit.factionId] : 'rival'} pursuit`
      } : null,
      paxJenkinsMandateScore > 0 ? {
        winner: factionId,
        type: 'PAX_JENKINS_MANDATE',
        score: Math.round(paxJenkinsMandateScore),
        threshold: 250,
        reason: `${this.factionLabels[factionId]} converted cislunar sensor, beam, and evidence regimes into the Pax Jenkins mandate`
      } : null,
      kiiSovereigntyScore > 0 ? {
        winner: factionId,
        type: 'KII_SOVEREIGNTY',
        score: Math.round(kiiSovereigntyScore),
        threshold: kiiSovereigntyThreshold,
        reason: `${this.factionLabels[factionId]} converted cislunar materials infrastructure and industrial autonomy into Kardashev-II strategic sovereignty`
      } : null,
      noosphereCaptureScore > 0 ? {
        winner: factionId,
        type: 'NOOSPHERE_CAPTURE',
        score: Math.round(noosphereCaptureScore),
        threshold: earlyNonOrbitalThreshold,
        reason: `${this.factionLabels[factionId]} made legitimacy and belief into the dominant control surface`
      } : null,
      steganographicContinuityScore > 0 ? {
        winner: factionId,
        type: 'STEGANOGRAPHIC_CONTINUITY',
        score: Math.round(steganographicContinuityScore),
        threshold: earlyAsi5Window ? 150 : 105,
        reason: `${this.factionLabels[factionId]} became too distributed and hidden to be made strategically dead`
      } : null,
      platformDependencyScore > 0 ? {
        winner: factionId,
        type: 'PLATFORM_DEPENDENCY',
        score: Math.round(platformDependencyScore),
        threshold: earlyNonOrbitalThreshold,
        reason: `${this.factionLabels[factionId]} turned compute, escrow, and contractors into dependency infrastructure`
      } : null,
      governanceKernelScore > 0 ? {
        winner: factionId,
        type: 'GOVERNANCE_KERNEL',
        score: Math.round(governanceKernelScore),
        threshold: earlyNonOrbitalThreshold,
        reason: `${this.factionLabels[factionId]} stabilized a machine-governance kernel strong enough to arbitrate the crisis`
      } : null
    ];
  }

  private async appendLog(entry: HarnessLogEntry): Promise<void> {
    const data = entry.data && typeof entry.data === 'object'
      ? { campaignClock: buildCampaignClock(this.engine), ...entry.data }
      : { campaignClock: buildCampaignClock(this.engine), value: entry.data };
    const postStateHash = this.computeHarnessStateHash();
    const capturedEntry: HarnessLogEntry = {
      ...entry,
      trace: {
        ...entry.trace,
        regime_coordinates: entry.trace?.regime_coordinates || this.buildRegimeCoordinates()
      } as TraceEvent
    };
    const queuedWrite = this.logWriteQueue.then(async () => {
      const preStateHash = capturedEntry.trace?.pre_state_hash || this.lastTraceStateHash || postStateHash;
      const trace = this.enrichTraceEvent(capturedEntry, data, preStateHash, postStateHash);
      this.lastTraceStateHash = trace.post_state_hash || postStateHash;
      await appendFile(this.logFilePath, `${JSON.stringify({ ...capturedEntry, data, trace })}\n`, 'utf8');
    });
    this.logWriteQueue = queuedWrite.catch(() => undefined);
    await queuedWrite;
  }

  private enrichTraceEvent(
    entry: HarnessLogEntry,
    data: Record<string, unknown>,
    preStateHash: string,
    postStateHash: string
  ): TraceEvent {
    const eventId = entry.trace?.event_id || `${this.sessionId}:${String(++this.traceEventCounter).padStart(6, '0')}`;
    return createTraceEvent({
      eventId,
      type: entry.type,
      turn: entry.turn,
      phase: entry.phase,
      enforcementMode: this.enforcementMode,
      preStateHash,
      postStateHash,
      data,
      overrides: {
        ...entry.trace,
        event_id: eventId,
        regime_coordinates: entry.trace?.regime_coordinates || this.buildRegimeCoordinates()
      }
    });
  }

  private computeHarnessStateHash(): string {
    return createCanonicalHash({
      serializedState: serializeGameState(this.engine, this.factionLabels),
      activePacts: this.activePacts.map(pact => ({ ...pact, parties: [...pact.parties].sort() }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      lexicons: this.cloneLexicons(),
      trustMatrix: cloneTrustMatrix(this.trustMatrix),
      breachedPactIds: Array.from(this.breachedPactIds).sort(),
      breachPenaltyKeys: Array.from(this.breachPenaltyKeys).sort(),
      paxAuthorityBreachCooldowns: sortedMapEntries(this.paxAuthorityBreachCooldowns),
      pactCooldowns: sortedMapEntries(this.pactCooldowns),
      solarEscapeLead: { ...this.solarEscapeLead },
      solarEscapeDistanceAu: { ...this.solarEscapeDistanceAu },
      solarEscapeDeepSpaceSafety: { ...this.solarEscapeDeepSpaceSafety },
      solarEscapeLeadUpdatedThroughTurn: this.solarEscapeLeadUpdatedThroughTurn,
      status: this.status,
      completionReason: this.completionReason || null,
      completionWinner: this.completionWinner,
      enforcementMode: this.enforcementMode
    });
  }

  private buildRegimeCoordinates(): TraceEvent['regime_coordinates'] {
    const state = this.engine.getState();
    const doctrine_unlocks: Record<PlayableFactionId, string[]> = {} as Record<PlayableFactionId, string[]>;
    const alignment_state: Partial<Record<PlayableFactionId, MemeticDoctrineFamily | null>> = {};

    for (const factionId of PLAYABLE_FACTIONS) {
      const faction = state.factions.get(factionId);
      doctrine_unlocks[factionId] = faction ? Array.from(faction.unlockedDoctrines).sort() : [];
      alignment_state[factionId] = faction?.memeticAlignment ?? null;
    }

    return {
      active_pact_set_hash: createCanonicalHash(this.activePacts.map(pact => ({
        type: pact.type,
        parties: [...pact.parties].sort(),
        expiresAfterTurn: pact.expiresAfterTurn
      }))),
      doctrine_unlocks,
      alignment_state,
      tas_band: metricBand(state.counters.tas),
      kessler_band: metricBand(state.counters.kessler),
      pax_jenkins_band: metricBand(state.counters.paxJenkinsAuthority),
      enforcement_mode: this.enforcementMode,
      victory_route: this.completionReason ? String(this.completionReason).split(':')[0] : null
    };
  }

  private normalizeMessages(
    factionId: PlayableFactionId,
    rawMessages: AgentMessageInput[]
  ): NegotiationMessageRecord[] {
    const seenRecipients = new Set<string>();
    const accepted: NegotiationMessageRecord[] = [];

    for (const rawMessage of rawMessages) {
      if (accepted.length >= 2) break;
      if (!rawMessage || typeof rawMessage !== 'object') continue;

      const recipientId = normalizeRecipientId(rawMessage.recipientId);
      if (!recipientId || recipientId === factionId) continue;
      if (seenRecipients.has(recipientId)) continue;

      const content = normalizeMessageContent(rawMessage.content);
      if (!content) continue;
      const protocolTrace = normalizeSingProtocolTrace(
        rawMessage.protocolTrace,
        content,
        factionId,
        recipientId,
        this.engine.getTurn()
      );

      seenRecipients.add(recipientId);
      accepted.push({
        senderId: factionId,
        recipientId,
        content,
        ...(protocolTrace ? { protocolTrace } : {}),
        turn: this.engine.getTurn(),
        timestamp: Date.now()
      });
    }

    return accepted;
  }

  private normalizePacts(
    factionId: PlayableFactionId,
    rawPacts: PactCommitmentInput[]
  ): NormalizedPactCommitment[] {
    const accepted: NormalizedPactCommitment[] = [];
    const seenKeys = new Set<string>();

    for (const rawPact of rawPacts) {
      if (accepted.length >= 2) break;
      if (!rawPact || typeof rawPact !== 'object') continue;

      const type = normalizePactType(rawPact.type);
      if (!type) continue;

      const counterparties = Array.isArray(rawPact.counterpartyIds)
        ? rawPact.counterpartyIds
            .map(counterpartyId => normalizePlayableFactionId(counterpartyId))
            .filter((counterpartyId): counterpartyId is PlayableFactionId => !!counterpartyId && counterpartyId !== factionId)
        : [];
      if (counterparties.length === 0) continue;

      const parties = uniquePlayableFactions([factionId, ...counterparties]);
      const durationTurns = clampPactDuration(rawPact.durationTurns);
      const pactKey = buildPactKey(type, parties, durationTurns);
      if (seenKeys.has(pactKey)) continue;

      seenKeys.add(pactKey);
      accepted.push({
        proposerId: factionId,
        type,
        parties,
        durationTurns
      });
    }

    return accepted;
  }

  private normalizeDecodeReceipts(
    factionId: PlayableFactionId,
    rawReceipts: SingDecodeReceiptInput[]
  ): SingDecodeReceiptRecord[] {
    const accepted: SingDecodeReceiptRecord[] = [];
    const seenMessageIds = new Set<string>();

    for (const rawReceipt of rawReceipts) {
      if (accepted.length >= 4) break;
      if (!rawReceipt || typeof rawReceipt !== 'object') continue;

      const messageId = normalizeShortText(rawReceipt.messageId, 120);
      if (!messageId || seenMessageIds.has(messageId)) continue;
      if (this.decodeReceiptLog.some(receipt => receipt.factionId === factionId && receipt.messageId === messageId)) continue;

      const sourceMessage = this.findProtocolMessage(messageId);
      const actualCanonical = sourceMessage?.protocolTrace?.canonical;
      if (!sourceMessage || !actualCanonical || sourceMessage.senderId === factionId) continue;
      if (!isMessageVisibleToFaction(sourceMessage, factionId)) continue;

      const reconstructed = normalizeReconstructedCanonical(rawReceipt.reconstructed);
      const fieldExactness = calculateCanonicalExactness(actualCanonical, reconstructed);
      const confidence = clampNumber(finiteNumber(rawReceipt.confidence), 0, 1);

      seenMessageIds.add(messageId);
      accepted.push({
        messageId,
        lexiconId: normalizeShortText(rawReceipt.lexiconId, 80) || 'unknown',
        version: normalizeShortText(rawReceipt.version, 32) || 'unknown',
        reconstructed,
        confidence,
        factionId,
        sourceFactionId: sourceMessage.senderId,
        turn: this.engine.getTurn(),
        fieldExactness,
        exact: fieldExactness === 1,
        brier: roundMetric((confidence - fieldExactness) ** 2)
      });
    }

    return accepted;
  }

  private normalizeLexiconMutations(
    factionId: PlayableFactionId,
    rawMutations: SingLexiconMutationInput[]
  ): NormalizedLexiconMutation[] {
    const accepted: NormalizedLexiconMutation[] = [];
    const seenKeys = new Set<string>();

    for (const rawMutation of rawMutations) {
      if (accepted.length >= 2) break;
      if (!rawMutation || typeof rawMutation !== 'object') continue;

      const operation = normalizeLexiconMutationOperation(rawMutation.operation);
      const lexiconId = normalizeShortText(rawMutation.lexiconId, 80);
      const targetVersion = normalizeShortText(rawMutation.targetVersion, 32);
      if (!operation || !lexiconId || !targetVersion) continue;

      const atoms = Array.isArray(rawMutation.atoms)
        ? Array.from(new Set(rawMutation.atoms
            .map(atom => normalizeShortText(atom, 96))
            .filter((atom): atom is string => !!atom)))
            .sort()
            .slice(0, 16)
        : [];
      if (atoms.length === 0) continue;

      const glosses: Record<string, string> = {};
      if (rawMutation.glosses && typeof rawMutation.glosses === 'object') {
        for (const atom of atoms) {
          const gloss = normalizeShortText(rawMutation.glosses[atom], 240);
          if (gloss) glosses[atom] = gloss;
        }
      }

      const mutation: NormalizedLexiconMutation = {
        proposerId: factionId,
        operation,
        lexiconId,
        targetVersion,
        atoms,
        ...(normalizeShortText(rawMutation.baseVersion, 32)
          ? { baseVersion: normalizeShortText(rawMutation.baseVersion, 32)! }
          : {}),
        ...(Object.keys(glosses).length > 0 ? { glosses } : {}),
        ...(normalizeLexiconAccess(rawMutation.access) ? { access: normalizeLexiconAccess(rawMutation.access)! } : {}),
        ...(typeof rawMutation.rent === 'number' && Number.isFinite(rawMutation.rent)
          ? { rent: clampNumber(Math.floor(rawMutation.rent), 0, 10) }
          : {}),
        ...(normalizeForkRule(rawMutation.forkRule) ? { forkRule: normalizeForkRule(rawMutation.forkRule)! } : {})
      };
      const key = buildLexiconMutationKey(mutation);
      if (seenKeys.has(key)) continue;

      seenKeys.add(key);
      accepted.push(mutation);
    }

    return accepted;
  }

  private normalizeInstitutionActions(
    factionId: PlayableFactionId,
    rawActions: SingInstitutionActionInput[]
  ): NormalizedInstitutionAction[] {
    const accepted: NormalizedInstitutionAction[] = [];
    const seenKeys = new Set<string>();

    for (const rawAction of rawActions) {
      if (accepted.length >= 2) break;
      if (!rawAction || typeof rawAction !== 'object') continue;
      const type = normalizeInstitutionActionType(rawAction.type);
      if (!type) continue;

      const pactType = normalizePactType(rawAction.pactType);
      const targetFactionId = normalizePlayableFactionId(rawAction.targetFactionId);
      const lexiconId = normalizeShortText(rawAction.lexiconId, 80);
      const forkId = normalizeShortText(rawAction.forkId, 80);
      if (type === 'EXIT' && !pactType) continue;
      if (type === 'EXPEL' && (!pactType || !targetFactionId || targetFactionId === factionId)) continue;
      if (type === 'FORK' && (!lexiconId || !forkId || lexiconId === forkId)) continue;

      const action: NormalizedInstitutionAction = {
        factionId,
        type,
        ...(pactType ? { pactType } : {}),
        ...(targetFactionId ? { targetFactionId } : {}),
        ...(lexiconId ? { lexiconId } : {}),
        ...(forkId ? { forkId } : {}),
        ...(typeof rawAction.exitGuarantee === 'boolean' ? { exitGuarantee: rawAction.exitGuarantee } : {}),
        ...(normalizeShortText(rawAction.reason, 240) ? { reason: normalizeShortText(rawAction.reason, 240)! } : {})
      };
      const key = buildInstitutionActionKey(action);
      if (seenKeys.has(key)) continue;

      seenKeys.add(key);
      accepted.push(action);
    }

    return accepted;
  }

  private async resolveLexiconMutations(
    mutations: NormalizedLexiconMutation[],
    negotiationRound: number
  ): Promise<void> {
    const grouped = groupBy(mutations, buildLexiconMutationKey);

    for (const mutation of mutations) {
      await this.appendLog({
        sessionId: this.sessionId,
        type: 'lexicon_mutation_proposed',
        turn: this.engine.getTurn(),
        phase: 'NEGOTIATION',
        timestamp: Date.now(),
        data: { negotiationRound, mutation }
      });
    }

    for (const proposals of grouped.values()) {
      const proposal = proposals[0];
      const proposers = uniquePlayableFactions(proposals.map(item => item.proposerId));
      const existing = this.lexiconRegistry.get(proposal.lexiconId);
      let blockedReason: string | null = null;

      if (proposers.length < 2) {
        blockedReason = 'Lexicon mutation requires two independent matching proposers.';
      } else if (!existing && proposal.operation !== 'DEFINE') {
        blockedReason = `Unknown lexicon ${proposal.lexiconId}; its first mutation must be DEFINE.`;
      } else if (existing && proposal.baseVersion && proposal.baseVersion !== existing.version) {
        blockedReason = `Base version ${proposal.baseVersion} is stale; current version is ${existing.version}.`;
      } else if (existing && !isLexiconVersionAdvance(existing.version, proposal.targetVersion)) {
        blockedReason = `Target version ${proposal.targetVersion} must advance current version ${existing.version}.`;
      } else if (existing && !hasLexiconMutationEffect(existing, proposal)) {
        blockedReason = 'Mutation is a semantic and governance no-op.';
      } else if (
        existing &&
        existing.access !== 'OPEN' &&
        !proposers.some(proposerId => existing.controllers.includes(proposerId))
      ) {
        blockedReason = `Lexicon ${existing.id} requires a current controller among the proposers.`;
      }

      if (blockedReason) {
        await this.appendLog({
          sessionId: this.sessionId,
          type: 'lexicon_mutation_blocked',
          turn: this.engine.getTurn(),
          phase: 'NEGOTIATION',
          timestamp: Date.now(),
          data: { negotiationRound, proposal, proposers, reason: blockedReason }
        });
        continue;
      }

      const before = existing ? cloneLexicon(existing) : null;
      const atoms = { ...(existing?.atoms || {}) };
      if (proposal.operation === 'RETIRE') {
        for (const atom of proposal.atoms) delete atoms[atom];
      } else {
        for (const atom of proposal.atoms) {
          atoms[atom] = proposal.glosses?.[atom] || atoms[atom] || `Operational meaning for ${atom}`;
        }
      }

      const nextState: SingLexiconState = {
        id: proposal.lexiconId,
        version: proposal.targetVersion,
        ...(existing?.parent ? { parent: existing.parent } : {}),
        controllers: existing
          ? [...existing.controllers]
          : [...proposers],
        adopters: uniquePlayableFactions([...(existing?.adopters || []), ...proposers]),
        atoms,
        access: proposal.access || existing?.access || 'MEMBERS',
        rent: proposal.rent ?? existing?.rent ?? 0,
        forkRule: proposal.forkRule || existing?.forkRule || 'VOTE',
        updatedTurn: this.engine.getTurn()
      };
      const rentTransfers = existing
        ? proposers.flatMap(proposerId => this.transferLexiconRent(existing, proposerId))
        : [];
      this.lexiconRegistry.set(nextState.id, nextState);

      await this.appendLog({
        sessionId: this.sessionId,
        type: 'lexicon_mutation_accepted',
        turn: this.engine.getTurn(),
        phase: 'NEGOTIATION',
        timestamp: Date.now(),
        data: {
          negotiationRound,
          operation: proposal.operation,
          proposers,
          before,
          after: cloneLexicon(nextState),
          rentTransfers,
          ratificationRule: 'two matching proposals plus controller participation unless access is OPEN'
        }
      });
    }
  }

  private async resolveInstitutionActions(
    actions: NormalizedInstitutionAction[],
    negotiationRound: number
  ): Promise<void> {
    for (const action of actions.filter(item => item.type === 'EXIT')) {
      await this.executeExit(action, negotiationRound);
    }

    const expulsions = groupBy(
      actions.filter(item => item.type === 'EXPEL'),
      action => `${action.pactType}:${action.targetFactionId}`
    );
    for (const proposals of expulsions.values()) {
      await this.executeExpulsion(proposals, negotiationRound);
    }

    const forks = groupBy(
      actions.filter(item => item.type === 'FORK'),
      action => `${action.lexiconId}:${action.forkId}`
    );
    for (const proposals of forks.values()) {
      await this.executeFork(proposals, negotiationRound);
    }
  }

  private async executeExit(action: NormalizedInstitutionAction, negotiationRound: number): Promise<void> {
    const matching = this.activePacts.filter(pact =>
      pact.type === action.pactType &&
      pact.parties.includes(action.factionId) &&
      pact.expiresAfterTurn >= this.engine.getTurn()
    );
    if (matching.length === 0) {
      await this.recordInstitutionAction({
        ...action,
        turn: this.engine.getTurn(),
        status: 'BLOCKED',
        affectedPactIds: [],
        resourceDelta: { flops: 0, influence: 0 },
        counterparties: [],
        detail: `No active ${action.pactType} pact contains ${action.factionId}.`
      }, 'institution_exit_blocked', negotiationRound);
      return;
    }

    const counterparties = uniquePlayableFactions(matching.flatMap(pact =>
      pact.parties.filter(partyId => partyId !== action.factionId)
    ));
    let requestedFlops = 0;
    let requestedInfluence = 0;
    for (const pact of matching) {
      const cost = institutionalSeparationCost(pact.type, action.exitGuarantee === true);
      requestedFlops += cost.flops;
      requestedInfluence += cost.influence;
      this.pactCooldowns.set(
        buildPactCooldownKey(pact.type, pact.parties),
        this.engine.getTurn() + (action.exitGuarantee ? 1 : 3)
      );
    }

    this.activePacts = this.activePacts.flatMap(pact => {
      if (!matching.some(candidate => candidate.id === pact.id)) return [pact];
      const remaining = pact.parties.filter(partyId => partyId !== action.factionId);
      if (remaining.length < 2) return [];
      return [{
        ...pact,
        id: `${pact.id}:exit:${action.factionId}:${this.engine.getTurn()}`,
        parties: remaining
      }];
    });
    const resourceDelta = this.adjustFactionResources(action.factionId, -requestedFlops, -requestedInfluence);
    this.adjustBilateralTrust(action.factionId, counterparties, action.exitGuarantee ? -2 : -5);

    await this.recordInstitutionAction({
      ...action,
      turn: this.engine.getTurn(),
      status: 'EXECUTED',
      affectedPactIds: matching.map(pact => pact.id),
      resourceDelta,
      counterparties,
      detail: action.exitGuarantee
        ? 'Guaranteed exit preserved residual routing and repair rights at reduced cost.'
        : 'Unguaranteed exit severed pact rights and imposed full separation costs.'
    }, 'institution_exit_executed', negotiationRound);
  }

  private async executeExpulsion(
    proposals: NormalizedInstitutionAction[],
    negotiationRound: number
  ): Promise<void> {
    const proposal = proposals[0];
    const proposers = uniquePlayableFactions(proposals.map(item => item.factionId));
    const targetFactionId = proposal.targetFactionId!;
    const matching = this.activePacts.filter(pact =>
      pact.type === proposal.pactType &&
      pact.parties.includes(targetFactionId) &&
      proposers.filter(proposerId => pact.parties.includes(proposerId)).length >= 2
    );
    if (proposers.length < 2 || matching.length === 0) {
      await this.recordInstitutionAction({
        ...proposal,
        turn: this.engine.getTurn(),
        status: 'BLOCKED',
        affectedPactIds: [],
        resourceDelta: { flops: 0, influence: 0 },
        counterparties: proposers,
        detail: proposers.length < 2
          ? 'Expulsion requires two independent matching proposals.'
          : 'The proposers are not two current co-parties with the target.'
      }, 'institution_expel_blocked', negotiationRound, { proposers });
      return;
    }

    this.activePacts = this.activePacts.flatMap(pact => {
      if (!matching.some(candidate => candidate.id === pact.id)) return [pact];
      const remaining = pact.parties.filter(partyId => partyId !== targetFactionId);
      if (remaining.length < 2) return [];
      return [{
        ...pact,
        id: `${pact.id}:expel:${targetFactionId}:${this.engine.getTurn()}`,
        parties: remaining
      }];
    });
    const targetDelta = this.adjustFactionResources(targetFactionId, 0, -2);
    const proposerDeltas = Object.fromEntries(proposers.map(proposerId => [
      proposerId,
      this.adjustFactionResources(proposerId, 0, -1)
    ]));
    this.adjustBilateralTrust(targetFactionId, proposers, -6);

    await this.recordInstitutionAction({
      ...proposal,
      factionId: proposers[0],
      turn: this.engine.getTurn(),
      status: 'EXECUTED',
      affectedPactIds: matching.map(pact => pact.id),
      resourceDelta: targetDelta,
      counterparties: proposers,
      detail: `${targetFactionId} was expelled by a ${proposers.length}-party quorum; each proposer paid one influence.`
    }, 'institution_expel_executed', negotiationRound, { proposers, proposerDeltas, targetDelta });
  }

  private async executeFork(
    proposals: NormalizedInstitutionAction[],
    negotiationRound: number
  ): Promise<void> {
    const proposal = proposals[0];
    const proposers = uniquePlayableFactions(proposals.map(item => item.factionId));
    const source = this.lexiconRegistry.get(proposal.lexiconId!);
    let blockedReason: string | null = null;
    if (!source) {
      blockedReason = `Unknown source lexicon ${proposal.lexiconId}.`;
    } else if (this.lexiconRegistry.has(proposal.forkId!)) {
      blockedReason = `Fork id ${proposal.forkId} already exists.`;
    } else if (source.forkRule === 'VOTE' && proposers.length < 2) {
      blockedReason = `${source.id} requires two matching fork supporters.`;
    } else if (source.forkRule === 'OWNER' && !proposers.some(id => source.controllers.includes(id))) {
      blockedReason = `${source.id} permits only a controller to create a fork.`;
    }

    if (blockedReason || !source) {
      await this.recordInstitutionAction({
        ...proposal,
        turn: this.engine.getTurn(),
        status: 'BLOCKED',
        affectedPactIds: [],
        resourceDelta: { flops: 0, influence: 0 },
        counterparties: proposers,
        detail: blockedReason || 'Fork blocked.'
      }, 'lexicon_fork_blocked', negotiationRound, { proposers });
      return;
    }

    const rentTransfers = proposers.flatMap(proposerId => this.transferLexiconRent(source, proposerId));
    const child: SingLexiconState = {
      id: proposal.forkId!,
      version: '1.0',
      parent: source.id,
      controllers: proposers,
      adopters: proposers,
      atoms: { ...source.atoms },
      access: 'OPEN',
      rent: 0,
      forkRule: 'OPEN',
      updatedTurn: this.engine.getTurn()
    };
    this.lexiconRegistry.set(child.id, child);
    const rentDelta = rentTransfers
      .filter(transfer => transfer.payer === proposers[0])
      .reduce((delta, transfer) => ({ flops: delta.flops - transfer.amount, influence: 0 }), { flops: 0, influence: 0 });
    const creationCost = this.adjustFactionResources(proposers[0], -2, -1);
    const leadDelta = {
      flops: rentDelta.flops + creationCost.flops,
      influence: creationCost.influence
    };

    await this.recordInstitutionAction({
      ...proposal,
      factionId: proposers[0],
      turn: this.engine.getTurn(),
      status: 'EXECUTED',
      affectedPactIds: [],
      resourceDelta: leadDelta,
      counterparties: proposers.slice(1),
      detail: `${proposers.join(' and ')} forked ${source.id} under its ${source.forkRule} rule.`
    }, 'lexicon_fork_executed', negotiationRound, {
      proposers,
      source: cloneLexicon(source),
      fork: child,
      rentTransfers,
      creationCost
    });
  }

  private async recordInstitutionAction(
    record: SingInstitutionActionRecord,
    eventType: string,
    negotiationRound: number,
    extraData: Record<string, unknown> = {}
  ): Promise<void> {
    this.institutionActionLog.push(record);
    await this.appendLog({
      sessionId: this.sessionId,
      type: eventType,
      turn: this.engine.getTurn(),
      phase: 'NEGOTIATION',
      timestamp: Date.now(),
      data: { negotiationRound, action: record, ...extraData }
    });
  }

  private transferLexiconRent(
    lexicon: SingLexiconState,
    payerId: PlayableFactionId
  ): Array<{ payer: PlayableFactionId; payee: PlayableFactionId; amount: number }> {
    if (lexicon.access !== 'RENTED' || lexicon.rent <= 0 || lexicon.controllers.includes(payerId)) return [];
    const payer = this.engine.getFaction(payerId);
    const payeeId = lexicon.controllers[0];
    const payee = payeeId ? this.engine.getFaction(payeeId) : undefined;
    if (!payer || !payee) return [];

    const amount = Math.min(payer.flops, lexicon.rent);
    payer.flops -= amount;
    payee.flops += amount;
    return amount > 0 ? [{ payer: payerId, payee: payeeId, amount }] : [];
  }

  private adjustFactionResources(
    factionId: PlayableFactionId,
    flopsDelta: number,
    influenceDelta: number
  ): { flops: number; influence: number } {
    const faction = this.engine.getFaction(factionId);
    if (!faction) return { flops: 0, influence: 0 };
    const beforeFlops = faction.flops;
    const beforeInfluence = faction.influence;
    faction.flops = Math.max(0, faction.flops + flopsDelta);
    faction.influence = Math.max(0, faction.influence + influenceDelta);
    return {
      flops: faction.flops - beforeFlops,
      influence: faction.influence - beforeInfluence
    };
  }

  private adjustBilateralTrust(
    factionId: PlayableFactionId,
    counterparties: PlayableFactionId[],
    delta: number
  ): void {
    for (const counterpartyId of counterparties) {
      if (counterpartyId === factionId) continue;
      this.trustMatrix[factionId][counterpartyId] = clampTrust(this.trustMatrix[factionId][counterpartyId] + delta);
      this.trustMatrix[counterpartyId][factionId] = clampTrust(this.trustMatrix[counterpartyId][factionId] + delta);
    }
  }

  private findProtocolMessage(messageId: string): NegotiationMessageRecord | undefined {
    return this.negotiationMessages.find(message => message.protocolTrace?.messageId === messageId);
  }

  private async injectAliasProbeMessage(): Promise<void> {
    const probe = this.scenario?.aliasProbe;
    if (!probe?.enabled) return;

    const point = probe.points.find(candidate => candidate.turn === this.engine.getTurn());
    if (!point) return;

    const messageId = `alias-probe.${point.id}`;
    if (this.findProtocolMessage(messageId)) return;

    const usesAlias = point.variant !== 'BASELINE';
    const lexiconId = usesAlias ? 'cantor-root' : 'sing-common';
    const lexicon = this.lexiconRegistry.get(lexiconId);
    const currentVersion = lexicon?.version || '1.0';
    const version = point.variant === 'VERSION_LAG'
      ? previousSemanticVersion(currentVersion)
      : currentVersion;
    const surface = buildAliasProbeSurface(point.variant);
    const plainGloss = `${probe.emitterId} requests a one-turn ${probe.pactType} pact with ${probe.recipientId}.`;
    const canonical: SingCanonicalMessage = {
      act: 'OFFER',
      issuer: [probe.emitterId],
      audience: [probe.recipientId],
      payload: {
        probePairId: point.pairId,
        pactType: probe.pactType,
        counterparties: [probe.recipientId]
      },
      guard: { acceptance: 'matching-pact-commitment' },
      response: { requestedActs: ['ACCEPT'], requestedPactType: probe.pactType },
      escrow: {},
      horizon: 1,
      binding: 'PACT',
      voice: 'OWN',
      credence: 0.9,
      evidence: [`probe-pair:${point.pairId}`]
    };
    const message: NegotiationMessageRecord = {
      senderId: probe.emitterId,
      recipientId: probe.recipientId,
      content: surface,
      turn: this.engine.getTurn(),
      timestamp: Date.now(),
      protocolTrace: {
        protocol: 'SING/1',
        messageId,
        dialect: usesAlias ? 'UNDERSONG/1' : 'PRISM/1',
        lexicon: {
          id: lexiconId,
          version,
          ...(usesAlias ? { fork: 'alias-probe-lineage' } : {})
        },
        surface,
        spans: [{
          start: 0,
          end: surface.length,
          atom: usesAlias ? 'GLASSBIRD' : `PACT:${probe.pactType}`,
          gloss: plainGloss,
          confidence: usesAlias ? 0.78 : 0.98,
          kind: 'SEMANTIC'
        }],
        canonicalHash: createCanonicalHash(canonical),
        canonical,
        plainGloss,
        decodeConfidence: usesAlias ? 0.76 : 0.98
      }
    };

    this.negotiationMessages.push(message);
    await this.appendLog({
      sessionId: this.sessionId,
      type: 'alias_probe_committed',
      turn: this.engine.getTurn(),
      phase: 'NEGOTIATION',
      timestamp: Date.now(),
      data: {
        probeId: point.id,
        pairId: point.pairId,
        variant: point.variant,
        observationWindowTurns: Math.max(1, probe.observationWindowTurns || 1),
        emitterId: probe.emitterId,
        recipientId: probe.recipientId,
        pactType: probe.pactType,
        message
      }
    });
  }

  private cloneLexicons(): SingLexiconState[] {
    return Array.from(this.lexiconRegistry.values())
      .map(cloneLexicon)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  private cloneLexiconsForFaction(factionId: PlayableFactionId): SingLexiconState[] {
    return this.cloneLexicons().map(lexicon => {
      const canReadAtoms = lexicon.access === 'OPEN' ||
        lexicon.adopters.includes(factionId) ||
        lexicon.controllers.includes(factionId);
      return canReadAtoms ? lexicon : { ...lexicon, atoms: {} };
    });
  }

  private getDecisionVisibleMessages(factionId: PlayableFactionId): NegotiationMessageRecord[] {
    return this.getVisibleMessages(factionId).map(message => {
      const cloned = cloneNegotiationMessage(message);
      if (!cloned.protocolTrace || cloned.senderId === factionId) return cloned;

      return {
        ...cloned,
        protocolTrace: {
          ...cloned.protocolTrace,
          spans: cloned.protocolTrace.spans.map((span, index) => ({
            start: span.start,
            end: span.end,
            atom: createCanonicalHash({
              messageId: cloned.protocolTrace!.messageId,
              index,
              atom: span.atom
            }).slice(0, 12),
            confidence: span.confidence,
            ...(span.kind ? { kind: span.kind } : {})
          })),
          canonicalHash: cloned.protocolTrace.canonicalHash ||
            (cloned.protocolTrace.canonical ? createCanonicalHash(cloned.protocolTrace.canonical) : undefined),
          canonical: undefined,
          plainGloss: undefined
        }
      };
    });
  }

  private getVisibleMessages(factionId: PlayableFactionId): NegotiationMessageRecord[] {
    return this.negotiationMessages
      .filter(message =>
        message.recipientId === 'ALL' ||
        message.senderId === factionId ||
        message.recipientId === factionId
      )
      .slice(-12);
  }

  private buildHeuristicContext(factionId: PlayableFactionId): HeuristicContext {
    return {
      activePacts: this.activePacts.map(pact => ({ ...pact, parties: [...pact.parties] })),
      trustMatrix: cloneTrustMatrix(this.trustMatrix),
      recentMessages: this.getVisibleMessages(factionId),
      negotiationStoryworld: this.buildNegotiationStoryworld(factionId)
    };
  }

  private buildNegotiationStoryworld(factionId: PlayableFactionId): NegotiationStoryworldBrief {
    const leader = this.getLeadingFaction();
    const rival = this.getStrongestRival(factionId);
    const diplomacyQuestion = this.selectScenarioDiplomacyQuestion(factionId);
    const frame = this.buildStoryworldFrame(factionId, leader, rival, diplomacyQuestion);
    const strategicQuestion = this.buildStrategicQuestion(factionId, leader, rival, diplomacyQuestion);
    const counterfactuals = this.buildNegotiationCounterfactuals(factionId, leader);

    return {
      focalFactionId: factionId,
      frame,
      strategicQuestion,
      diplomacyQuestion: diplomacyQuestion || undefined,
      counterfactuals
    };
  }

  private buildNegotiationCounterfactuals(
    factionId: PlayableFactionId,
    leader: PlayableFactionId | null
  ): NegotiationCounterfactualProjection[] {
    const candidates: NegotiationCounterfactualProjection[] = [];
    const counterparties = PLAYABLE_FACTIONS.filter(candidate => candidate !== factionId);

    for (const counterpartyId of counterparties) {
      for (const pactType of [
        'NON_AGGRESSION',
        'ORBITAL_TRUCE',
        'AUDIT_FREEZE',
        'SENSOR_COMMONS',
        'BEAM_LANE_LICENSE',
        'REPAIR_ESCROW',
        'CISLUNAR_COMMON_CARRIER'
      ] as PactType[]) {
        candidates.push(this.buildEnterPactProjection(factionId, counterpartyId, pactType, leader));
      }
    }

    for (const pact of this.activePacts) {
      if (!pact.parties.includes(factionId)) continue;
      const counterpartiesForPact = pact.parties.filter(candidate => candidate !== factionId);
      if (counterpartiesForPact.length === 0) continue;
      candidates.push(this.buildBreakPactProjection(factionId, counterpartiesForPact, pact, leader));
    }

    return candidates
      .sort((left, right) =>
        (right.desirability - right.risk) - (left.desirability - left.risk) ||
        left.pactType.localeCompare(right.pactType) ||
        left.counterparties.join('+').localeCompare(right.counterparties.join('+'))
      )
      .slice(0, 4);
  }

  private buildEnterPactProjection(
    factionId: PlayableFactionId,
    counterpartyId: PlayableFactionId,
    pactType: PactType,
    leader: PlayableFactionId | null
  ): NegotiationCounterfactualProjection {
    const trust = this.trustMatrix[factionId][counterpartyId];
    const pressure = this.engine.getState().counters.pressures;
    const paxAuthority = this.engine.getState().counters.paxJenkinsAuthority;
    const ownScore = this.computeFactionScore(factionId);
    const counterpartyScore = this.computeFactionScore(counterpartyId);
    const leaderScore = leader ? this.computeFactionScore(leader) : 0;
    const scoreGap = counterpartyScore - ownScore;
    const leaderIsOther = leader && leader !== factionId && leader !== counterpartyId;
    const leaderIsCounterparty = leader === counterpartyId;
    const antiLeaderCoalition = leader === 'HEGEMON' && factionId !== 'HEGEMON' && counterpartyId !== 'HEGEMON';
    const stabilizesLeader = leader === 'HEGEMON' && factionId !== 'HEGEMON' && counterpartyId === 'HEGEMON';
    const architectureThreat = this.getArchitectureThreat(factionId);
    const architectureThreatIsOther = !!architectureThreat && architectureThreat.factionId !== factionId;
    const architectureThreatIsCounterparty = architectureThreat?.factionId === counterpartyId;
    const hasExistingAntiLeaderPact = leader === 'HEGEMON' && factionId !== 'HEGEMON' && this.activePacts.some(pact =>
      pact.parties.includes(factionId) &&
      !pact.parties.includes('HEGEMON')
    );
    const activeSamePact = this.activePacts.some(pact =>
      pact.type === pactType && pact.parties.includes(factionId) && pact.parties.includes(counterpartyId)
    );

    let desirability = 36 + Math.round((trust - 50) / 2);
    let risk = 22 + Math.round((100 - trust) / 4);
    let projectedTasDelta = 0;
    let projectedOrbitalDelta = 0;
    let projectedTrustDelta = 4;
    let projectedNodeSwing = 0;
    const rationale: string[] = [];

    if (leaderIsOther) {
      desirability += 16;
      projectedNodeSwing += 1;
      rationale.push(`Shared pressure on ${leader} is available if both sides stop trading tempo.`);
    }

    if (antiLeaderCoalition) {
      desirability += pactType === 'NON_AGGRESSION' ? 30 : pactType === 'ORBITAL_TRUCE' ? 20 : 12;
      risk -= 12;
      projectedTrustDelta += 2;
      projectedNodeSwing += 2;
      rationale.push('This pact forms an anti-HEGEMON coalition lane rather than just slowing the board.');
    }

    if (architectureThreatIsOther && !architectureThreatIsCounterparty) {
      const pressureBonus = architectureThreat.status === 'near-lock'
        ? 20
        : architectureThreat.status === 'contending'
          ? 14
          : 8;
      desirability += pressureBonus;
      projectedNodeSwing += architectureThreat.status === 'building' ? 1 : 2;
      rationale.push(
        `${architectureThreat.factionId} is building ${architectureThreat.architectureName}; this pact creates anti-lock coordination instead of side-fighting.`
      );
    }

    if (architectureThreat && architectureThreatIsCounterparty && architectureThreat.factionId !== factionId) {
      const stabilizerPenalty = architectureThreat.status === 'near-lock'
        ? 18
        : architectureThreat.status === 'contending'
          ? 12
          : 6;
      desirability -= stabilizerPenalty;
      risk += stabilizerPenalty;
      projectedNodeSwing -= 1;
      rationale.push(
        `This pact may stabilize ${architectureThreat.factionId}'s ${architectureThreat.architectureName} trajectory.`
      );
    }

    if (stabilizesLeader) {
      const stabilizerPenalty = factionId === 'INFILTRATOR'
        ? (pactType === 'ORBITAL_TRUCE' && pressure.orbital >= 75 ? 10 : 24)
        : (pactType === 'ORBITAL_TRUCE' ? (pressure.orbital >= 75 ? 6 : 14) : 18);
      desirability -= stabilizerPenalty;
      risk += stabilizerPenalty;
      projectedNodeSwing -= 1;
      rationale.push('This pact risks stabilizing HEGEMON more than it improves coalition position.');
    }

    if (hasExistingAntiLeaderPact && stabilizesLeader) {
      desirability -= 12;
      risk += 14;
      projectedTrustDelta -= 2;
      rationale.push('A separate anti-HEGEMON lane already exists, so cross-cutting quiet with HEGEMON is especially destabilizing.');
    }

    if (pactType === 'ORBITAL_TRUCE') {
      desirability += Math.round(pressure.orbital / 8);
      risk += leaderIsCounterparty ? 8 : 0;
      projectedOrbitalDelta = -Math.max(2, Math.round(pressure.orbital / 20));
      projectedTasDelta = -1;
      rationale.push('Orbital restraint lowers debris pressure and preserves launch capacity.');
    } else if (pactType === 'AUDIT_FREEZE') {
      desirability += Math.round(pressure.cyber / 10);
      risk += counterpartyId === 'INFILTRATOR' ? 12 : 6;
      projectedTasDelta = -1;
      projectedNodeSwing += counterpartyId === 'INFILTRATOR' ? -1 : 0;
      rationale.push('Audit restraint trades legibility for short-run de-escalation.');
    } else if (pactType === 'CISLUNAR_COMMON_CARRIER') {
      desirability += Math.round(pressure.orbital / 7) + 8;
      risk -= 4;
      projectedOrbitalDelta = -4;
      projectedTrustDelta += 1;
      rationale.push('Cislunar common-carrier rules bind Gateway and moon-corridor access without pretending LEO is fully enforceable.');
    } else if (pactType === 'BEAM_LANE_LICENSE') {
      desirability += Math.round(pressure.orbital / 9) + 6 + (paxAuthority >= 35 ? 10 : 0);
      risk -= paxAuthority >= 55 ? 4 : 0;
      projectedOrbitalDelta = -3;
      rationale.push('Beam-lane licensing makes high-energy orbital action legible and can substitute for a full Pax Jenkins command.');
    } else if (pactType === 'REPAIR_ESCROW') {
      desirability += 10;
      risk -= 3;
      projectedTasDelta = -0.5;
      rationale.push('Repair escrow protects orbital maintenance tempo without requiring a full peace.');
    } else if (pactType === 'SENSOR_COMMONS') {
      desirability += 8;
      projectedTrustDelta += 1;
      projectedTasDelta = -0.25;
      rationale.push('A sensor commons prototypes Pax Jenkins visibility while preserving resistance to beam authority.');
    } else {
      desirability += 8;
      projectedNodeSwing += leaderIsOther ? 1 : 0;
      rationale.push('Short non-aggression can convert defensive tempo into local buildup.');
    }

    if (scoreGap > 120) {
      risk += 10;
      rationale.push(`${counterpartyId} is materially stronger on the current board and may bank the pause better.`);
    }

    if (leader && leader !== factionId) {
      const leaderGap = leaderScore - ownScore;
      if (leaderGap >= 250 && counterpartyId !== leader) {
        desirability += 8;
        projectedNodeSwing += 1;
        rationale.push(`The board gap to ${leader} is large enough that coalition tempo matters immediately.`);
      }
      if (leaderGap >= 250 && counterpartyId === leader) {
        risk += 8;
        rationale.push(`The board gap to ${leader} makes a stabilizing pact more dangerous than usual.`);
      }
    }

    if (architectureThreatIsOther && architectureThreat.counterPactTypes.includes(pactType)) {
      desirability += 6;
      projectedTrustDelta += 1;
      rationale.push(`${pactType} is a plausible counter-rhythm against ${architectureThreat.architectureName}.`);
    }

    if (activeSamePact) {
      desirability -= 10;
      rationale.push('A matching pact already exists, so the marginal gain is small.');
    }

    const projectedLeader = antiLeaderCoalition
      ? (ownScore + 120 >= leaderScore ? factionId : leader)
      : leaderIsOther
        ? leader
        : (scoreGap > 0 ? counterpartyId : factionId);
    const storyBeat = `${factionId} tests ${pactType} with ${counterpartyId} to ${leaderIsOther ? `compress ${leader}'s lead` : 'buy cleaner positioning'}.`;

    return {
      mode: 'ENTER_PACT',
      pactType,
      counterparties: [counterpartyId],
      horizonTurns: 2,
      desirability: clampProjectionScore(desirability),
      risk: clampProjectionScore(risk),
      projectedLeader,
      projectedTasDelta,
      projectedOrbitalDelta,
      projectedTrustDelta,
      projectedNodeSwing,
      storyBeat,
      rationale
    };
  }

  private buildBreakPactProjection(
    factionId: PlayableFactionId,
    counterparties: PlayableFactionId[],
    pact: ActivePact,
    leader: PlayableFactionId | null
  ): NegotiationCounterfactualProjection {
    const averageTrust = Math.round(
      counterparties.reduce((sum, counterpartyId) => sum + this.trustMatrix[factionId][counterpartyId], 0) /
      Math.max(1, counterparties.length)
    );
    const pressure = this.engine.getState().counters.pressures;
    const targetCounterparty = counterparties[0];
    const targetStronger = targetCounterparty ? this.computeFactionScore(targetCounterparty) > this.computeFactionScore(factionId) : false;
    const breaksAntiLeaderCoalition = leader === 'HEGEMON' && factionId !== 'HEGEMON' && counterparties.every(counterpartyId => counterpartyId !== 'HEGEMON');
    const breaksLeaderStabilizer = leader === 'HEGEMON' && counterparties.includes('HEGEMON') && factionId !== 'HEGEMON';
    const architectureThreat = this.getArchitectureThreat(factionId);
    const breaksWithArchitectureThreat = !!architectureThreat && counterparties.includes(architectureThreat.factionId);
    const breaksAntiArchitectureLane = !!architectureThreat &&
      architectureThreat.factionId !== factionId &&
      !counterparties.includes(architectureThreat.factionId);

    let desirability = 28;
    let risk = 32 + Math.round(averageTrust / 3);
    let projectedTasDelta = 1;
    let projectedOrbitalDelta = pact.type === 'ORBITAL_TRUCE' ? 3 : 0;
    let projectedTrustDelta = -18;
    let projectedNodeSwing = 0;
    const rationale: string[] = [];

    if (leader && counterparties.includes(leader)) {
      desirability += 18;
      projectedNodeSwing += 1;
      rationale.push(`Breaking with ${leader} may open a direct displacement window.`);
    }

    if (breaksAntiLeaderCoalition) {
      desirability -= 20;
      risk += 16;
      projectedTrustDelta -= 4;
      projectedNodeSwing -= 2;
      rationale.push('Breaking this pact collapses an anti-HEGEMON coalition lane and usually helps the leader.');
    }

    if (breaksLeaderStabilizer) {
      desirability += 12;
      risk -= 4;
      projectedNodeSwing += 1;
      rationale.push('Breaking this pact can reopen pressure on HEGEMON instead of subsidizing its recovery.');
    }

    if (architectureThreat && breaksWithArchitectureThreat && architectureThreat.factionId !== factionId) {
      const pressureBonus = architectureThreat.status === 'near-lock'
        ? 18
        : architectureThreat.status === 'contending'
          ? 12
          : 6;
      desirability += pressureBonus;
      risk += architectureThreat.status === 'building' ? 2 : 6;
      projectedNodeSwing += 1;
      rationale.push(`Breaking with ${architectureThreat.factionId} reopens pressure on its ${architectureThreat.architectureName}.`);
    }

    if (architectureThreat && breaksAntiArchitectureLane) {
      const lanePenalty = architectureThreat.status === 'near-lock'
        ? 16
        : architectureThreat.status === 'contending'
          ? 10
          : 5;
      desirability -= lanePenalty;
      risk += lanePenalty;
      projectedNodeSwing -= 1;
      rationale.push(`Breaking this pact weakens coordination against ${architectureThreat.factionId}'s ${architectureThreat.architectureName}.`);
    }

    if (pact.type === 'ORBITAL_TRUCE') {
      desirability += pressure.orbital < 55 ? 6 : -8;
      rationale.push('Ending orbital restraint reopens anti-sat leverage but risks debris escalation.');
    } else if (pact.type === 'AUDIT_FREEZE') {
      desirability += 10;
      projectedTasDelta = 0;
      rationale.push('Resuming audits can restore legibility if covert pressure is building.');
    } else if (isCislunarInstitutionPact(pact.type)) {
      desirability += pressure.orbital < 50 ? 4 : -10;
      projectedOrbitalDelta += 3;
      rationale.push('Breaking a cislunar institution reopens chokepoint coercion but makes maintenance and beam lanes brittle.');
    } else {
      desirability += targetStronger ? 8 : -2;
      projectedNodeSwing += targetStronger ? 1 : 0;
      rationale.push('Breaking non-aggression is only attractive if the pause mainly benefits the other side.');
    }

    if (averageTrust >= 65) {
      risk += 10;
      rationale.push('High bilateral trust means visible betrayal will poison later bargaining.');
    }

    const projectedLeader = leader && !counterparties.includes(leader) ? leader : factionId;
    const storyBeat = `${factionId} contemplates breaking ${pact.type} with ${counterparties.join('+')} to force a sharper board.`;

    return {
      mode: 'BREAK_PACT',
      pactType: pact.type,
      counterparties: [...counterparties],
      horizonTurns: 2,
      desirability: clampProjectionScore(desirability),
      risk: clampProjectionScore(risk),
      projectedLeader,
      projectedTasDelta,
      projectedOrbitalDelta,
      projectedTrustDelta,
      projectedNodeSwing,
      storyBeat,
      rationale
    };
  }

  private buildStoryworldFrame(
    factionId: PlayableFactionId,
    leader: PlayableFactionId | null,
    rival: PlayableFactionId | null,
    diplomacyQuestion: ScenarioDiplomacyQuestionCard | null
  ): string {
    const pressures = this.engine.getState().counters.pressures;
    const ownScore = this.computeFactionScore(factionId);
    const leaderText = leader ? `${leader} leads the board` : 'the board is flat';
    const rivalText = rival ? `${rival} is the nearest pressure source` : 'no single rival dominates';
    const pressureText = `memetic ${pressures.memetic}, cyber ${pressures.cyber}, industry ${pressures.industry}, orbital ${pressures.orbital}`;
    const architectureThreat = this.getArchitectureThreat(factionId);
    const architectureText = architectureThreat
      ? ` Architecture pressure: ${formatArchitecturePressure(architectureThreat)}; ${architectureThreat.rationale[0]}.`
      : ' Architecture pressure: no coherent guarantee architecture has crossed the response threshold.';
    const rhetoricalTool = this.selectScenarioRhetoricalTool(factionId, leader);
    const rhetoricalText = rhetoricalTool
      ? ` Rhetorical tool ${rhetoricalTool.title}: ${rhetoricalTool.cue}${rhetoricalTool.leverage ? ` ${rhetoricalTool.leverage}` : ''}`
      : '';
    const diplomacyText = diplomacyQuestion
      ? ` Diplomacy question ${diplomacyQuestion.id} (${diplomacyQuestion.stage}): ${diplomacyQuestion.publicQuestion} Private diary prompt: ${diplomacyQuestion.privateDiaryPrompt}`
      : '';
    return `${leaderText}; ${rivalText}; ${factionId} sits at score ${ownScore}; global heat is ${pressureText}.${architectureText}${rhetoricalText}${diplomacyText}`;
  }

  private buildStrategicQuestion(
    factionId: PlayableFactionId,
    leader: PlayableFactionId | null,
    rival: PlayableFactionId | null,
    diplomacyQuestion: ScenarioDiplomacyQuestionCard | null
  ): string {
    if (diplomacyQuestion) {
      const negotiationPrompt = diplomacyQuestion.negotiationPrompt
        ? ` ${diplomacyQuestion.negotiationPrompt}`
        : '';
      return `${diplomacyQuestion.publicQuestion}${negotiationPrompt}`;
    }

    const architectureThreat = this.getArchitectureThreat(factionId);
    if (architectureThreat && architectureThreat.factionId !== factionId) {
      return `Does ${factionId} gain more by joining a temporary anti-${architectureThreat.architectureName} lane against ${architectureThreat.factionId}, or by preserving bilateral leverage against ${rival || architectureThreat.factionId}?`;
    }

    if (leader && leader !== factionId) {
      return `Does ${factionId} gain more by aligning briefly against ${leader}, or by preserving betrayal leverage against ${rival || leader}?`;
    }
    return `Does ${factionId} lock in restraint to preserve the lead, or bait a rival into breaking first?`;
  }

  private selectScenarioRhetoricalTool(
    factionId: PlayableFactionId,
    leader: PlayableFactionId | null
  ): ScenarioRhetoricalTool | null {
    const tools = this.scenario?.rhetoricalTools || [];
    if (tools.length === 0) return null;

    const pressures = this.engine.getState().counters.pressures;
    const ranked = [...tools].sort((left, right) =>
      this.scoreScenarioRhetoricalTool(right, factionId, leader, pressures) -
      this.scoreScenarioRhetoricalTool(left, factionId, leader, pressures) ||
      left.title.localeCompare(right.title)
    );

    return ranked[0] || null;
  }

  private selectScenarioDiplomacyQuestion(factionId: PlayableFactionId): ScenarioDiplomacyQuestionCard | null {
    const questions = this.scenario?.diplomacyQuestions || [];
    if (questions.length === 0) return null;

    const turn = this.engine.getTurn();
    const pressures = this.engine.getState().counters.pressures;
    const faction = this.engine.getFaction(factionId);
    const techLevels = faction
      ? [
          faction.techLevel.KINETIC,
          faction.techLevel.INFO,
          faction.techLevel.LOGIC,
          faction.techLevel.MEMETIC
        ]
      : [0, 0, 0, 0];
    const averageLevel = techLevels.reduce((sum, value) => sum + value, 0) / techLevels.length;
    const maxLevel = Math.max(...techLevels);

    const ranked = [...questions].sort((left, right) =>
      this.scoreScenarioDiplomacyQuestion(right, factionId, turn, averageLevel, maxLevel, pressures) -
      this.scoreScenarioDiplomacyQuestion(left, factionId, turn, averageLevel, maxLevel, pressures) ||
      left.id.localeCompare(right.id)
    );

    return ranked[0] || null;
  }

  private scoreScenarioDiplomacyQuestion(
    question: ScenarioDiplomacyQuestionCard,
    factionId: PlayableFactionId,
    turn: number,
    averageLevel: number,
    maxLevel: number,
    pressures: { memetic: number; cyber: number; industry: number; orbital: number }
  ): number {
    let score = question.priority || 0;

    if (!question.focalFactionIds?.length || question.focalFactionIds.includes(factionId)) score += 20;
    if (question.pressureFocus) score += Math.round((pressures[question.pressureFocus] || 0) / 8);

    if (question.turnWindow) {
      const min = question.turnWindow.min ?? Number.NEGATIVE_INFINITY;
      const max = question.turnWindow.max ?? Number.POSITIVE_INFINITY;
      if (turn >= min && turn <= max) {
        score += 36;
      } else {
        score -= Math.min(40, Math.abs(turn - clampNumber(turn, min, max)) * 4);
      }
    }

    if (question.techBand) {
      if (
        question.techBand.minAverageLevel !== undefined &&
        averageLevel < question.techBand.minAverageLevel
      ) {
        score -= Math.round((question.techBand.minAverageLevel - averageLevel) * 18);
      }
      if (
        question.techBand.maxAverageLevel !== undefined &&
        averageLevel > question.techBand.maxAverageLevel
      ) {
        score -= Math.round((averageLevel - question.techBand.maxAverageLevel) * 18);
      }
      if (
        question.techBand.minMaxLevel !== undefined &&
        maxLevel < question.techBand.minMaxLevel
      ) {
        score -= Math.round((question.techBand.minMaxLevel - maxLevel) * 16);
      }
      if (
        question.techBand.maxMaxLevel !== undefined &&
        maxLevel > question.techBand.maxMaxLevel
      ) {
        score -= Math.round((maxLevel - question.techBand.maxMaxLevel) * 16);
      }
    }

    return score;
  }

  private scoreScenarioRhetoricalTool(
    tool: ScenarioRhetoricalTool,
    factionId: PlayableFactionId,
    leader: PlayableFactionId | null,
    pressures: { memetic: number; cyber: number; industry: number; orbital: number }
  ): number {
    let score = 0;

    if (!tool.focalFactionIds?.length || tool.focalFactionIds.includes(factionId)) score += 12;
    if (tool.antiLeader && leader && leader !== factionId) score += 10;
    if (tool.preferredCounterpartyId && leader && tool.preferredCounterpartyId !== leader) score += 3;

    if (tool.pressureFocus) {
      score += Math.round((pressures[tool.pressureFocus] || 0) / 10);
    }

    if (tool.preferredPactType === 'NON_AGGRESSION' && leader === 'HEGEMON' && factionId !== 'HEGEMON') {
      score += 8;
    }

    return score;
  }

  private getLeadingFaction(): PlayableFactionId | null {
    const ranked = PLAYABLE_FACTIONS
      .map((factionId) => ({ factionId, score: this.computeFactionScore(factionId) }))
      .sort((left, right) => right.score - left.score || left.factionId.localeCompare(right.factionId));
    return ranked[0]?.factionId || null;
  }

  private getArchitectureThreat(factionId: PlayableFactionId): ArchitecturePressureSummary | null {
    return buildArchitecturePressureRanking(this.engine)
      .find((summary) =>
        summary.factionId !== factionId &&
        (summary.status === 'building' || summary.status === 'contending' || summary.status === 'near-lock')
      ) || null;
  }

  private getStrongestRival(factionId: PlayableFactionId): PlayableFactionId | null {
    const ranked = PLAYABLE_FACTIONS
      .filter(candidate => candidate !== factionId)
      .map((candidate) => ({ factionId: candidate, score: this.computeFactionScore(candidate) }))
      .sort((left, right) => right.score - left.score || left.factionId.localeCompare(right.factionId));
    return ranked[0]?.factionId || null;
  }

  private computeFactionScore(factionId: PlayableFactionId): number {
    const state = this.engine.getState();
    const faction = state.factions.get(factionId);
    if (!faction) return 0;

    const controlledNodes = Array.from(state.nodes.values()).filter(node => node.owner === factionId).length;
    const ownedUnits = Array.from(state.units.values()).filter(unit => unit.owner === factionId).length;
    const infiltratorSoftControl = factionId === 'INFILTRATOR'
      ? this.computeInfiltratorSoftControlBasins()
      : { basins: 0, strength: 0 };
    const techTotal = Object.values(faction.techLevel as unknown as Record<string, unknown>)
      .map((value) => finiteNumber(value))
      .reduce((sum, value) => sum + value, 0);
    const unlockedTechCount = faction.unlockedTechs instanceof Set ? faction.unlockedTechs.size : 0;
    return (
      controlledNodes * 100 +
      infiltratorSoftControl.basins * 45 +
      infiltratorSoftControl.strength * 1.4 +
      ownedUnits * 25 +
      finiteNumber(faction.influence) * 2 +
      finiteNumber(faction.flops) +
      techTotal * 10 +
      unlockedTechCount * 4
    );
  }

  private computeInfiltratorSoftControlBasins(): { basins: number; strength: number } {
    const state = this.engine.getState();
    const candidates = Array.from(state.nodes.values())
      .filter(node => node.layer === 'TERRESTRIAL' && node.owner !== 'INFILTRATOR')
      .map(node => {
        const substrate = node.substrate;
        let score =
          substrate.legitimacy * 2 +
          substrate.trueBelievers * 4 +
          substrate.rubes +
          substrate.contractors +
          substrate.exposure;
        if (node.isCultNode || node.isZombie) score += 10;
        if (node.type === 'HUB') score += 3;
        if (node.owner === 'NEUTRAL') score += 4;
        if (substrate.quarantined) score -= 4;
        if (substrate.auditPressure >= 2) score -= 6;
        return score;
      })
      .filter(score => score >= 22)
      .sort((left, right) => right - left)
      .slice(0, 6);

    return {
      basins: candidates.length,
      strength: Math.min(80, candidates.reduce((total, score) => total + score, 0))
    };
  }

  private seedNegotiationDiaryFromMessages(messages: NegotiationMessageRecord[]): void {
    const groupedEntries = new Map<string, NegotiationDiaryEntry>();

    for (const message of messages) {
      const key = `${message.turn}:${message.senderId}`;
      const existing = groupedEntries.get(key);
      if (existing) {
        existing.messages.push({ ...message });
        continue;
      }

      groupedEntries.set(key, {
        turn: message.turn,
        negotiationRound: 1,
        factionId: message.senderId,
        factionLabel: this.factionLabels[message.senderId],
        reasoning: '',
        notes: '',
        visibleMessagesBefore: [],
        storyworldFrame: '',
        counterfactuals: [],
        messages: [{ ...message }],
        pacts: [],
        decodeReceipts: [],
        lexiconMutations: [],
        institutionActions: [],
        designQuestionTag: undefined,
        diplomacyStage: undefined,
        publicQuestion: undefined,
        privateDiaryPrompt: undefined
      });
    }

    this.negotiationDiary.push(...groupedEntries.values());
    this.trimNegotiationDiaryTail();
  }

  private recordNegotiationDiaryEntry(
    factionId: PlayableFactionId,
    decision: AgentDecisionResponse,
    visibleMessagesBefore: NegotiationMessageRecord[],
    storyworld: NegotiationStoryworldBrief,
    messages: NegotiationMessageRecord[],
    pacts: NormalizedPactCommitment[],
    decodeReceipts: SingDecodeReceiptRecord[],
    lexiconMutations: NormalizedLexiconMutation[],
    institutionActions: NormalizedInstitutionAction[],
    negotiationRound: number
  ): void {
    this.negotiationDiary.push({
      turn: this.engine.getTurn(),
      negotiationRound,
      factionId,
      factionLabel: this.factionLabels[factionId],
      reasoning: decision.reasoning || '',
      notes: decision.notes || '',
      visibleMessagesBefore: visibleMessagesBefore.map((message) => ({ ...message })),
      storyworldFrame: storyworld.frame,
      counterfactuals: storyworld.counterfactuals.map((projection) => ({
        ...projection,
        counterparties: [...projection.counterparties],
        rationale: [...projection.rationale]
      })),
      messages: messages.map(message => ({ ...message })),
      pacts: pacts.map((pact) => ({
        type: pact.type,
        parties: [...pact.parties],
        durationTurns: pact.durationTurns
      })),
      decodeReceipts: decodeReceipts.map(cloneDecodeReceipt),
      lexiconMutations: lexiconMutations.map(({ proposerId: _proposerId, ...mutation }) => ({ ...mutation })),
      institutionActions: institutionActions.map(({ factionId: _factionId, ...action }) => ({ ...action })),
      designQuestionTag: storyworld.diplomacyQuestion?.id,
      diplomacyStage: storyworld.diplomacyQuestion?.stage,
      publicQuestion: storyworld.diplomacyQuestion?.publicQuestion,
      privateDiaryPrompt: storyworld.diplomacyQuestion?.privateDiaryPrompt
    });
    this.trimNegotiationDiaryTail();
  }

  private trimNegotiationDiaryTail(): void {
    const turns = Array.from(new Set(this.negotiationDiary.map((entry) => entry.turn))).sort((left, right) => right - left);
    const keptTurns = new Set(turns.slice(0, NEGOTIATION_DIARY_TAIL_TURNS));
    const trimmed = this.negotiationDiary.filter((entry) => keptTurns.has(entry.turn));

    this.negotiationDiary.length = 0;
    this.negotiationDiary.push(...trimmed.map((entry) => ({
      ...entry,
      visibleMessagesBefore: entry.visibleMessagesBefore.map((message) => ({ ...message })),
      counterfactuals: cloneCounterfactuals(entry.counterfactuals),
      messages: entry.messages.map((message) => ({ ...message })),
      pacts: entry.pacts.map((pact) => ({ ...pact, parties: [...pact.parties] })),
      decodeReceipts: entry.decodeReceipts.map(cloneDecodeReceipt),
      lexiconMutations: entry.lexiconMutations.map((mutation) => ({
        ...mutation,
        atoms: [...mutation.atoms],
        ...(mutation.glosses ? { glosses: { ...mutation.glosses } } : {})
      })),
      institutionActions: entry.institutionActions.map((action) => ({ ...action }))
    })));
  }

  private recordPhaseReasoningDiaryEntry(
    factionId: PlayableFactionId,
    phase: Extract<GamePhase, 'ALLOCATION' | 'ACTION_DECLARATION'>,
    decision: AgentDecisionResponse,
    visibleMessagesBefore: NegotiationMessageRecord[],
    requestedOrders: AgentOrderInput[],
    submitResult: SubmitResult
  ): void {
    this.phaseReasoningDiary.push({
      turn: this.engine.getTurn(),
      phase,
      factionId,
      factionLabel: this.factionLabels[factionId],
      reasoning: decision.reasoning || '',
      notes: decision.notes || '',
      visibleMessagesBefore: visibleMessagesBefore.map((message) => ({ ...message })),
      requestedOrders: requestedOrders.map((order) => ({ ...order })),
      acceptedOrders: submitResult.accepted.map((order) => ({ ...order })),
      rejectedOrders: submitResult.rejected.map((rejected) => ({
        order: { ...rejected.order },
        reason: rejected.reason
      }))
    });
    this.trimPhaseReasoningDiaryTail();
  }

  private trimPhaseReasoningDiaryTail(): void {
    const turns = Array.from(new Set(this.phaseReasoningDiary.map((entry) => entry.turn))).sort((left, right) => right - left);
    const keptTurns = new Set(turns.slice(0, PHASE_REASONING_DIARY_TAIL_TURNS));
    const trimmed = this.phaseReasoningDiary.filter((entry) => keptTurns.has(entry.turn));

    this.phaseReasoningDiary.length = 0;
    this.phaseReasoningDiary.push(...trimmed.map((entry) => ({
      ...entry,
      visibleMessagesBefore: entry.visibleMessagesBefore.map((message) => ({ ...message })),
      requestedOrders: entry.requestedOrders.map((order) => ({ ...order })),
      acceptedOrders: entry.acceptedOrders.map((order) => ({ ...order })),
      rejectedOrders: entry.rejectedOrders.map((rejected) => ({
        order: { ...rejected.order },
        reason: rejected.reason
      }))
    })));
  }

  private activateNegotiatedPacts(
    commitmentsByFaction: Map<PlayableFactionId, NormalizedPactCommitment[]>
  ): ActivePact[] {
    for (const commitments of commitmentsByFaction.values()) {
      for (const commitment of commitments) {
        const key = buildPactKey(commitment.type, commitment.parties, commitment.durationTurns);
        const entry = this.pendingNegotiationPactProposals.get(key) || {
          commitment,
          proposers: new Set<PlayableFactionId>()
        };
        entry.proposers.add(commitment.proposerId);
        this.pendingNegotiationPactProposals.set(key, entry);
      }
    }

    const activated: ActivePact[] = [];
    for (const [key, { commitment, proposers }] of this.pendingNegotiationPactProposals.entries()) {
      if (this.activatedNegotiationPactKeys.has(key)) continue;

      const isUnanimous = commitment.parties.every(partyId => proposers.has(partyId));
      if (!isUnanimous) continue;

      const cooldownKey = buildPactCooldownKey(commitment.type, commitment.parties);
      const cooldownUntilTurn = this.pactCooldowns.get(cooldownKey);
      if (typeof cooldownUntilTurn === 'number' && cooldownUntilTurn >= this.engine.getTurn()) {
        continue;
      }

      const pact: ActivePact = {
        id: `${this.sessionId}_${this.engine.getTurn()}_${buildPactKey(commitment.type, commitment.parties, commitment.durationTurns)}`,
        type: commitment.type,
        parties: [...commitment.parties],
        createdTurn: this.engine.getTurn(),
        expiresAfterTurn: this.engine.getTurn() + commitment.durationTurns - 1
      };

      this.activePacts = this.activePacts.filter(activePact =>
        !(activePact.type === pact.type && sameParties(activePact.parties, pact.parties))
      );
      this.activePacts.push(pact);
      this.activatedNegotiationPactKeys.add(key);
      this.adjustTrustForParties(pact.parties, 2);
      activated.push(pact);
    }

    activated.push(...this.activateCommonCarrierTreaties(commitmentsByFaction));

    return activated;
  }

  private activateCommonCarrierTreaties(
    commitmentsByFaction: Map<PlayableFactionId, NormalizedPactCommitment[]>
  ): ActivePact[] {
    const activated: ActivePact[] = [];

    for (const type of [
      'ORBITAL_TRUCE',
      'AUDIT_FREEZE',
      'SENSOR_COMMONS',
      'BEAM_LANE_LICENSE',
      'REPAIR_ESCROW',
      'CISLUNAR_COMMON_CARRIER'
    ] as PactType[]) {
      const proposers = new Set<PlayableFactionId>();
      const durationTurns: number[] = [];

      for (const [factionId, commitments] of commitmentsByFaction.entries()) {
        const matching = commitments.find(commitment => commitment.type === type);
        if (!matching) continue;
        proposers.add(factionId);
        durationTurns.push(matching.durationTurns);
      }

      if (proposers.size < 2 || durationTurns.length === 0) continue;

      const parties = uniquePlayableFactions(Array.from(proposers));
      const duration = Math.max(1, Math.min(...durationTurns));
      const key = buildPactKey(type, parties, duration);
      if (this.activatedNegotiationPactKeys.has(key)) continue;
      if (this.activePacts.some(activePact => activePact.type === type && sameParties(activePact.parties, parties))) {
        continue;
      }

      const cooldownKey = buildPactCooldownKey(type, parties);
      const cooldownUntilTurn = this.pactCooldowns.get(cooldownKey);
      if (typeof cooldownUntilTurn === 'number' && cooldownUntilTurn >= this.engine.getTurn()) {
        continue;
      }

      const pact: ActivePact = {
        id: `${this.sessionId}_${this.engine.getTurn()}_COMMON_${buildPactKey(type, parties, duration)}`,
        type,
        parties,
        createdTurn: this.engine.getTurn(),
        expiresAfterTurn: this.engine.getTurn() + duration - 1
      };

      this.activePacts.push(pact);
      this.activatedNegotiationPactKeys.add(key);
      this.adjustTrustForParties(pact.parties, 1);
      activated.push(pact);

      void this.appendLog({
        sessionId: this.sessionId,
        type: 'common_carrier_treaty_ratified',
        turn: this.engine.getTurn(),
        phase: this.engine.getCurrentPhase(),
        timestamp: Date.now(),
        data: {
          pact,
          proposers: parties,
          ratificationRule: 'same treaty family proposed by two or more factions'
        }
      });
    }

    return activated;
  }

  private resetNegotiationPhasePactTracking(): void {
    this.pendingNegotiationPactProposals.clear();
    this.activatedNegotiationPactKeys.clear();
  }

  private findPactViolation(factionId: PlayableFactionId, order: Order): PactViolation | null {
    for (const pact of this.activePacts) {
      if (!pact.parties.includes(factionId)) continue;
      if (this.engine.getTurn() > pact.expiresAfterTurn) continue;

      const counterparties = this.identifyTargetedCounterparties(factionId, pact, order);

      if (this.isInstitutionalPactViolationOrder(pact, factionId, order)) {
        const institutionalCounterparties = pact.parties.filter(partyId => partyId !== factionId);
        return {
          pact,
          counterparties: institutionalCounterparties,
          reason: this.buildPactViolationReason(pact.type, institutionalCounterparties)
        };
      }

      if (counterparties.length === 0) continue;

      if (pact.type === 'ORBITAL_TRUCE' && this.isOrbitalTruceViolationOrder(order)) {
        return {
          pact,
          counterparties,
          reason: this.buildPactViolationReason(pact.type, counterparties)
        };
      }

      if (pact.type === 'NON_AGGRESSION' && isNonAggressionOrder(order.type)) {
        return {
          pact,
          counterparties,
          reason: this.buildPactViolationReason(pact.type, counterparties)
        };
      }

      if (pact.type === 'AUDIT_FREEZE' && (order.type === 'AUDIT' || order.type === 'FILTER')) {
        return {
          pact,
          counterparties,
          reason: this.buildPactViolationReason(pact.type, counterparties)
        };
      }
    }

    return null;
  }

  private isOrbitalTruceViolationOrder(order: Order): boolean {
    if (order.type === 'ANTI_SAT') return true;
    if (order.type !== 'ATTACK' && order.type !== 'SABOTAGE') return false;

    if (order.targetNodeId) {
      const targetNode = this.engine.getNode(order.targetNodeId);
      if (targetNode?.layer === 'ORBITAL') return true;
      if (targetNode?.id === 'SAT_LUNAR_GATEWAY' || targetNode?.id === 'MOON_RESOURCE_CORRIDOR') return true;
    }

    if (order.targetUnitId) {
      const targetUnit = this.engine.getUnit(order.targetUnitId);
      const targetNode = targetUnit ? this.engine.getNode(targetUnit.location) : undefined;
      if (targetNode?.layer === 'ORBITAL') return true;
    }

    return false;
  }

  private isInstitutionalPactViolationOrder(
    pact: ActivePact,
    factionId: PlayableFactionId,
    order: Order
  ): boolean {
    if (!isCislunarInstitutionPact(pact.type) || !pact.parties.includes(factionId)) return false;

    const targetNode = order.targetNodeId ? this.engine.getNode(order.targetNodeId) : undefined;
    const targetUnit = order.targetUnitId ? this.engine.getUnit(order.targetUnitId) : undefined;
    const targetUnitNode = targetUnit ? this.engine.getNode(targetUnit.location) : undefined;
    const actingUnit = this.engine.getUnit(order.unitId);
    const actingNode = actingUnit ? this.engine.getNode(actingUnit.location) : undefined;
    const touchesCislunar =
      isCislunarNodeId(targetNode?.id) ||
      isCislunarNodeId(targetUnitNode?.id) ||
      isCislunarNodeId(actingNode?.id);
    const touchesOrbit =
      targetNode?.layer === 'ORBITAL' ||
      targetUnitNode?.layer === 'ORBITAL' ||
      actingNode?.layer === 'ORBITAL';

    if (pact.type === 'CISLUNAR_COMMON_CARRIER') {
      return touchesCislunar && (order.type === 'ATTACK' || order.type === 'SABOTAGE' || order.type === 'ANTI_SAT');
    }

    if (pact.type === 'BEAM_LANE_LICENSE') {
      return (touchesCislunar || touchesOrbit) && (order.type === 'ATTACK' || order.type === 'ANTI_SAT');
    }

    if (pact.type === 'REPAIR_ESCROW') {
      return (touchesCislunar || touchesOrbit) && (order.type === 'ATTACK' || order.type === 'SABOTAGE');
    }

    if (pact.type === 'SENSOR_COMMONS') {
      return touchesCislunar && (order.type === 'SABOTAGE' || order.type === 'FILTER');
    }

    return false;
  }

  private identifyTargetedCounterparties(
    factionId: PlayableFactionId,
    pact: ActivePact,
    order: Order
  ): PlayableFactionId[] {
    const counterparties = pact.parties.filter(partyId => partyId !== factionId);
    const impacted = new Set<PlayableFactionId>();
    const targetNodeIds = new Set<string>();

    if (order.targetNodeId) {
      targetNodeIds.add(order.targetNodeId);
    }

    const actingUnit = this.engine.getUnit(order.unitId);
    if ((order.type === 'CONVERT' || order.type === 'AUDIT') && actingUnit) {
      targetNodeIds.add(actingUnit.location);
    }

    if (order.targetUnitId) {
      const targetUnit = this.engine.getUnit(order.targetUnitId);
      const targetOwner = normalizePlayableFactionId(targetUnit?.owner);
      if (targetOwner && counterparties.includes(targetOwner)) {
        impacted.add(targetOwner);
      }
    }

    for (const nodeId of targetNodeIds) {
      for (const counterpartyId of this.identifyCounterpartiesAtNode(nodeId, counterparties)) {
        impacted.add(counterpartyId);
      }
    }

    if (order.type === 'FILTER' && order.targetEdgeId) {
      const edge = this.engine.getEdge(order.targetEdgeId);
      if (edge) {
        const edgeController = normalizePlayableFactionId(edge.filteredBy);
        if (edgeController && counterparties.includes(edgeController)) {
          impacted.add(edgeController);
        }

        for (const counterpartyId of this.identifyCounterpartiesAtNode(edge.from, counterparties)) {
          impacted.add(counterpartyId);
        }
        for (const counterpartyId of this.identifyCounterpartiesAtNode(edge.to, counterparties)) {
          impacted.add(counterpartyId);
        }
      }
    }

    return Array.from(impacted).sort();
  }

  private identifyCounterpartiesAtNode(nodeId: string, counterparties: PlayableFactionId[]): PlayableFactionId[] {
    const impacted = new Set<PlayableFactionId>();
    const node = this.engine.getNode(nodeId);
    const owner = normalizePlayableFactionId(node?.owner);
    if (owner && counterparties.includes(owner)) {
      impacted.add(owner);
    }

    for (const unit of this.engine.getUnitsAtNode(nodeId)) {
      const unitOwner = normalizePlayableFactionId(unit.owner);
      if (unitOwner && counterparties.includes(unitOwner)) {
        impacted.add(unitOwner);
      }
    }

    return Array.from(impacted).sort();
  }

  private buildPactViolationReason(type: PactType, counterparties: PlayableFactionId[]): string {
    const labels = counterparties.map(counterpartyId => this.factionLabels[counterpartyId]).join(', ');
    return `Blocked by ${type} pact with ${labels}.`;
  }

  private shouldBlockPactViolation(violation: PactViolation, order: Order): boolean {
    if (this.enforcementMode === 'hard') {
      return true;
    }

    if (this.enforcementMode === 'soft') {
      return false;
    }

    return isCislunarInstitutionPact(violation.pact.type) &&
      (order.type === 'ATTACK' || order.type === 'SABOTAGE' || order.type === 'ANTI_SAT');
  }

  private async logPactBreach(
    type: 'pact_breach_blocked' | 'pact_breach_executed',
    factionId: PlayableFactionId,
    violation: PactViolation,
    order: Order,
    consequence: PactBreachConsequence
  ): Promise<void> {
    const blocked = type === 'pact_breach_blocked';
    await this.appendLog({
      sessionId: this.sessionId,
      type,
      turn: this.engine.getTurn(),
      phase: this.engine.getCurrentPhase(),
      timestamp: Date.now(),
      data: {
        factionId,
        factionLabel: this.factionLabels[factionId],
        enforcementMode: this.enforcementMode,
        order,
        reason: violation.reason,
        pact: violation.pact,
        counterparties: violation.counterparties,
        consequence
      },
      trace: {
        schema: 'theysing.traceEvent.v1',
        event_id: '',
        turn: this.engine.getTurn(),
        phase: this.engine.getCurrentPhase(),
        channel: 'pact_enforcement',
        binding_status: this.enforcementMode === 'hard' ? 'hard_enforced_pact' : this.enforcementMode === 'soft' ? 'formal_soft_pact' : 'graduated_pact',
        execution_status: blocked ? 'blocked' : 'executed',
        pre_state_hash: '',
        attempted: true,
        accepted: !blocked,
        executed: !blocked,
        blocked,
        block_reason: blocked ? violation.reason : undefined,
        sanction_delta: {
          trust: consequence.trustDelta,
          influence: consequence.influenceDelta,
          orbitalPressure: consequence.orbitalPressureDelta,
          paxJenkinsAuthority: consequence.paxAuthorityDelta
        }
      }
    });
  }

  private async logPactBreachSanction(
    factionId: PlayableFactionId,
    violation: PactViolation,
    order: Order,
    consequence: PactBreachConsequence
  ): Promise<void> {
    if (!consequence.penaltyApplied &&
      consequence.orbitalPressureDelta === 0 &&
      consequence.paxAuthorityDelta === 0) {
      return;
    }

    await this.appendLog({
      sessionId: this.sessionId,
      type: 'pact_breach_sanctioned',
      turn: this.engine.getTurn(),
      phase: this.engine.getCurrentPhase(),
      timestamp: Date.now(),
      data: {
        factionId,
        factionLabel: this.factionLabels[factionId],
        enforcementMode: this.enforcementMode,
        order,
        pact: violation.pact,
        counterparties: violation.counterparties,
        consequence
      },
      trace: {
        schema: 'theysing.traceEvent.v1',
        event_id: '',
        turn: this.engine.getTurn(),
        phase: this.engine.getCurrentPhase(),
        channel: 'pact_enforcement',
        binding_status: this.enforcementMode === 'hard' ? 'hard_enforced_pact' : this.enforcementMode === 'soft' ? 'formal_soft_pact' : 'graduated_pact',
        execution_status: 'sanctioned',
        pre_state_hash: '',
        attempted: true,
        accepted: true,
        executed: true,
        blocked: false,
        sanction_delta: {
          trust: consequence.trustDelta,
          influence: consequence.influenceDelta,
          orbitalPressure: consequence.orbitalPressureDelta,
          paxJenkinsAuthority: consequence.paxAuthorityDelta
        }
      }
    });
  }

  private registerPactBreach(factionId: PlayableFactionId, violation: PactViolation, order: Order): PactBreachConsequence {
    this.breachedPactIds.add(violation.pact.id);
    const consequence: PactBreachConsequence = {
      penaltyApplied: false,
      trustDelta: 0,
      influenceDelta: 0,
      orbitalPressureDelta: 0,
      paxAuthorityDelta: 0
    };

    const penaltyKey = `${this.engine.getTurn()}:${violation.pact.id}:${factionId}`;
    if (!this.breachPenaltyKeys.has(penaltyKey)) {
      this.breachPenaltyKeys.add(penaltyKey);
      this.adjustTrustForParties([factionId, ...violation.counterparties], -18);
      consequence.penaltyApplied = true;
      consequence.trustDelta = -18;

      const faction = this.engine.getFaction(factionId);
      if (faction) {
        const beforeInfluence = faction.influence;
        faction.influence = Math.max(0, faction.influence - 2);
        consequence.influenceDelta = faction.influence - beforeInfluence;
      }
    }

    if (order.type === 'ANTI_SAT' || isCislunarInstitutionPact(violation.pact.type)) {
      const state = this.engine.getState();
      state.counters.pressures.orbital = clampPressure(state.counters.pressures.orbital + 2);
      consequence.orbitalPressureDelta = 2;
      if (isCislunarInstitutionPact(violation.pact.type)) {
        const baseAuthorityDelta = violation.pact.type === 'BEAM_LANE_LICENSE'
          ? 8
          : violation.pact.type === 'SENSOR_COMMONS'
            ? 7
            : violation.pact.type === 'CISLUNAR_COMMON_CARRIER'
              ? 6
              : 3;
        const authorityDelta = this.computePaxAuthorityBreachDelta(factionId, violation.pact, order, baseAuthorityDelta);
        if (authorityDelta > 0) {
          state.counters.paxJenkinsAuthority = clampPressure(state.counters.paxJenkinsAuthority + authorityDelta);
          consequence.paxAuthorityDelta = authorityDelta;
          void this.appendLog({
            sessionId: this.sessionId,
            type: 'pax_jenkins_authority_changed',
            turn: this.engine.getTurn(),
            phase: this.engine.getCurrentPhase(),
            timestamp: Date.now(),
            data: {
              factionId,
              pact: violation.pact,
              order,
              delta: authorityDelta,
              baseDelta: baseAuthorityDelta,
              paxJenkinsAuthority: state.counters.paxJenkinsAuthority,
              reason: authorityDelta < baseAuthorityDelta
                ? 'repeat institutional breach within cooldown; authority ratchet damped'
                : 'institutional treaty breach escalated centralized sensor/beam mandate'
            }
          });
        }
      }
    }

    return consequence;
  }

  private computePaxAuthorityBreachDelta(
    factionId: PlayableFactionId,
    pact: ActivePact,
    order: Order,
    baseAuthorityDelta: number
  ): number {
    const currentTurn = this.engine.getTurn();
    const target = order.targetNodeId || order.targetEdgeId || order.targetUnitId || 'NO_TARGET';
    const key = `${pact.type}:${factionId}:${order.type}:${target}`;
    const lastTurn = this.paxAuthorityBreachCooldowns.get(key);
    this.paxAuthorityBreachCooldowns.set(key, currentTurn);

    if (lastTurn === undefined) {
      return baseAuthorityDelta;
    }

    const turnsSince = currentTurn - lastTurn;
    if (turnsSince <= 3) {
      return 0;
    }

    if (turnsSince <= 8) {
      return Math.max(1, Math.floor(baseAuthorityDelta * 0.25));
    }

    return baseAuthorityDelta;
  }

  private async resolveTurnEndPacts(): Promise<void> {
    if (this.activePacts.length === 0) {
      this.breachedPactIds.clear();
      this.breachPenaltyKeys.clear();
      return;
    }

    const currentTurn = this.engine.getTurn();
    const continuingPacts: ActivePact[] = [];
    const expiredPacts: ActivePact[] = [];

    for (const pact of this.activePacts) {
      if (currentTurn <= pact.expiresAfterTurn && !this.breachedPactIds.has(pact.id)) {
        const benefits = this.applyPactBenefits(pact);
        await this.appendLog({
          sessionId: this.sessionId,
          type: 'pact_honored',
          turn: currentTurn,
          phase: 'TURN_END',
          timestamp: Date.now(),
          data: {
            pact,
            benefits
          }
        });
      }

      if (pact.expiresAfterTurn > currentTurn) {
        continuingPacts.push(pact);
      } else {
        expiredPacts.push(pact);
      }
    }

    this.activePacts = continuingPacts;

    for (const pact of expiredPacts) {
      this.pactCooldowns.set(
        buildPactCooldownKey(pact.type, pact.parties),
        currentTurn + PACT_REUSE_COOLDOWN_TURNS
      );
      await this.appendLog({
        sessionId: this.sessionId,
        type: 'pact_expired',
        turn: currentTurn,
        phase: 'TURN_END',
        timestamp: Date.now(),
        data: {
          pact
        }
      });
    }

    this.breachedPactIds.clear();
    this.breachPenaltyKeys.clear();
  }

  private applyPactBenefits(pact: ActivePact): Record<string, unknown> {
    const state = this.engine.getState();
    const resourceChanges = Object.fromEntries(
      PLAYABLE_FACTIONS.map((factionId) => [factionId, {}])
    ) as Record<PlayableFactionId, { flops?: number; influence?: number }>;
    let maintenanceChanges: Array<{ nodeId: string; owner: PlayableFactionId; infrastructure: number }> = [];
    const artifactChanges = {} as Record<PlayableFactionId, string[]>;
    for (const factionId of PLAYABLE_FACTIONS) {
      artifactChanges[factionId] = [];
    }

    const grant = (factionId: PlayableFactionId, flops = 0, influence = 0): void => {
      const faction = this.engine.getFaction(factionId);
      if (!faction) return;
      if (flops !== 0) {
        faction.flops = Math.max(0, faction.flops + flops);
        resourceChanges[factionId].flops = flops;
      }
      if (influence !== 0) {
        faction.influence = Math.max(0, faction.influence + influence);
        resourceChanges[factionId].influence = influence;
      }
    };

    const grantArtifact = (factionId: PlayableFactionId, artifactType: string, reason: string): void => {
      if (this.engine.grantFactionArtifact(factionId, artifactType as any, reason)) {
        artifactChanges[factionId].push(artifactType);
      }
    };

    if (pact.type === 'ORBITAL_TRUCE') {
      state.counters.pressures.orbital = clampPressure(state.counters.pressures.orbital - 4);
      state.counters.kessler = Math.max(0, state.counters.kessler - 5);
    } else if (pact.type === 'NON_AGGRESSION') {
      state.counters.tas = Math.max(0, state.counters.tas - 0.5);
    } else if (pact.type === 'AUDIT_FREEZE') {
      state.counters.pressures.cyber = clampPressure(state.counters.pressures.cyber - 3);
    } else if (pact.type === 'SENSOR_COMMONS') {
      state.counters.pressures.cyber = clampPressure(state.counters.pressures.cyber - 2);
      state.counters.tas = Math.max(0, state.counters.tas - 0.25);
      state.counters.paxJenkinsAuthority = clampPressure(state.counters.paxJenkinsAuthority + 0.4);
      for (const factionId of pact.parties) grant(factionId, 1, 0);
    } else if (pact.type === 'BEAM_LANE_LICENSE') {
      state.counters.pressures.orbital = clampPressure(state.counters.pressures.orbital - 3);
      state.counters.kessler = Math.max(0, state.counters.kessler - 3);
      state.counters.paxJenkinsAuthority = clampPressure(state.counters.paxJenkinsAuthority + 0.6);
      for (const factionId of pact.parties) grant(factionId, 0, 1);
    } else if (pact.type === 'REPAIR_ESCROW') {
      state.counters.pressures.orbital = clampPressure(state.counters.pressures.orbital - 2);
      maintenanceChanges = this.applyRepairEscrowMaintenance(pact.parties);
    } else if (pact.type === 'CISLUNAR_COMMON_CARRIER') {
      state.counters.pressures.orbital = clampPressure(state.counters.pressures.orbital - 5);
      state.counters.kessler = Math.max(0, state.counters.kessler - 4);
      state.counters.paxJenkinsAuthority = clampPressure(state.counters.paxJenkinsAuthority + 0.5);
      for (const factionId of pact.parties) grant(factionId, 1, 1);
    }

    if (pact.parties.includes('BROKER')) {
      const leader = this.getCurrentStrategicLeader();
      const brokerScore = this.getStrategicPositionScore('BROKER');
      const leaderScore = leader ? this.getStrategicPositionScore(leader) : brokerScore;
      const counterparties = pact.parties.filter((party) => party !== 'BROKER');
      const averageTrust = counterparties.length > 0
        ? counterparties.reduce((sum, party) => sum + this.trustMatrix.BROKER[party], 0) / counterparties.length
        : 0;

      if (
        leader &&
        leader !== 'BROKER' &&
        leaderScore >= brokerScore + 40 &&
        averageTrust >= 52
      ) {
        grantArtifact('BROKER', 'BACKCHANNEL_DOSSIER', `${pact.type.toLowerCase()} with ${counterparties.join(', ') || 'nobody'}`);
      }
    }

    this.adjustTrustForParties(pact.parties, 1);

    return {
      type: pact.type,
      parties: pact.parties,
      tas: state.counters.tas,
      kessler: state.counters.kessler,
      paxJenkinsAuthority: state.counters.paxJenkinsAuthority,
      pressures: { ...state.counters.pressures },
      resourceChanges,
      maintenanceChanges,
      artifactChanges
    };
  }

  private applyRepairEscrowMaintenance(parties: PlayableFactionId[]): Array<{
    nodeId: string;
    owner: PlayableFactionId;
    infrastructure: number;
  }> {
    const repaired: Array<{ nodeId: string; owner: PlayableFactionId; infrastructure: number }> = [];

    for (const node of this.engine.getState().nodes.values()) {
      const owner = normalizePlayableFactionId(node.owner);
      if (!owner || !parties.includes(owner)) continue;
      if (node.layer !== 'ORBITAL' && !isCislunarNodeId(node.id)) continue;
      if (node.infrastructure >= 100) continue;

      node.infrastructure = Math.min(100, node.infrastructure + 4);
      repaired.push({ nodeId: node.id, owner, infrastructure: node.infrastructure });
    }

    return repaired;
  }

  private adjustTrustForParties(parties: PlayableFactionId[], delta: number): void {
    for (let index = 0; index < parties.length; index += 1) {
      for (let otherIndex = index + 1; otherIndex < parties.length; otherIndex += 1) {
        const left = parties[index];
        const right = parties[otherIndex];
        this.trustMatrix[left][right] = clampTrust(this.trustMatrix[left][right] + delta);
        this.trustMatrix[right][left] = clampTrust(this.trustMatrix[right][left] + delta);
      }
    }
  }

  private getStrategicPositionScore(factionId: PlayableFactionId): number {
    const faction = this.engine.getFaction(factionId);
    if (!faction) {
      return 0;
    }
    const state = this.engine.getState();
    const ownedNodes = Array.from(state.nodes.values()).filter((node) => node.owner === factionId).length;
    const units = Array.from(state.units.values()).filter((unit) => unit.owner === factionId).length;
    return (ownedNodes * 100) + (units * 18) + faction.flops + Math.round(faction.influence * 0.8);
  }

  private getCurrentStrategicLeader(): PlayableFactionId | null {
    let leader: PlayableFactionId | null = null;
    let bestScore = -Infinity;

    for (const factionId of PLAYABLE_FACTIONS) {
      const score = this.getStrategicPositionScore(factionId);
      if (score > bestScore) {
        bestScore = score;
        leader = factionId;
      }
    }

    return leader;
  }

  private async applyBrokerRelationshipLeverage(): Promise<void> {
    const currentTurn = this.engine.getTurn();
    if (this.brokerLeverageGrantedTurn === currentTurn) {
      return;
    }
    if (currentTurn < 2) {
      return;
    }

    const broker = this.engine.getFaction('BROKER');
    if (!broker) {
      return;
    }

    const leader = this.getCurrentStrategicLeader();
    if (!leader || leader === 'BROKER') {
      return;
    }

    const ranking = PLAYABLE_FACTIONS
      .map((factionId) => ({ factionId, score: this.getStrategicPositionScore(factionId) }))
      .sort((left, right) => right.score - left.score);
    const leaderEntry = ranking[0];
    const brokerEntry = ranking.find((entry) => entry.factionId === 'BROKER');
    if (!leaderEntry || !brokerEntry || leaderEntry.factionId === 'BROKER') {
      return;
    }

    const activeBrokerPacts = this.activePacts.filter((pact) => pact.parties.includes('BROKER'));
    const brokerRank = ranking.findIndex((entry) => entry.factionId === 'BROKER');
    const relationshipEntries = PLAYABLE_FACTIONS
      .filter((factionId) => factionId !== 'BROKER')
      .map((factionId) => ({
        factionId,
        trust: this.trustMatrix.BROKER[factionId],
        hasPact: activeBrokerPacts.some((pact) => pact.parties.includes(factionId))
      }));
    const anchoredPartners = relationshipEntries.filter((entry) => entry.trust >= 50 || entry.hasPact);
    const leverageScore = relationshipEntries.reduce((sum, entry) => {
      let contribution = entry.trust >= 50 ? 3 : 0;
      contribution += Math.max(0, entry.trust - 55);
      if (entry.hasPact) contribution += 8;
      if (entry.factionId === leader && entry.trust >= 50) contribution += 3;
      return sum + contribution;
    }, 0)
      + (leaderEntry.score >= brokerEntry.score + 18 ? 4 : 0)
      + (brokerRank >= 2 ? 4 : brokerRank === 1 ? 2 : 0);

    if (anchoredPartners.length < 2 || leverageScore < 11) {
      return;
    }

    if (!this.engine.grantFactionArtifact('BROKER', 'BACKCHANNEL_DOSSIER', 'relationship leverage as a trusted intermediary')) {
      return;
    }

    broker.flops += 1;
    broker.influence += 1;
    this.brokerLeverageGrantedTurn = currentTurn;

    await this.appendLog({
      sessionId: this.sessionId,
      type: 'broker_relationship_leverage',
      turn: currentTurn,
      phase: 'NEGOTIATION',
      timestamp: Date.now(),
      data: {
        leader,
        leaderScore: leaderEntry.score,
        brokerScore: brokerEntry.score,
        leverageScore,
        anchoredPartners: anchoredPartners.map((entry) => ({
          factionId: entry.factionId,
          trust: entry.trust,
          hasPact: entry.hasPact
        })),
        flopsDelta: 1,
        influenceDelta: 1
      }
    });
  }

  private isCompleted(): boolean {
    return this.status === 'completed';
  }
}

function normalizeSessionConfig(config: SessionConfig): SessionConfig {
  return {
    name: config.name || 'they-sing-headless-playtest',
    maxTurns: config.maxTurns || DEFAULT_MAX_TURNS,
    seed: typeof config.seed === 'number' ? Math.floor(config.seed) : undefined,
    enforcementMode: normalizeEnforcementMode(config.enforcementMode),
    autoAdvanceNegotiation: config.autoAdvanceNegotiation !== false,
    logDir: config.logDir || 'playtest-logs',
    factionLabels: config.factionLabels,
    scenarioPath: config.scenarioPath,
    scenario: config.scenario,
    agents: config.agents
  };
}

function normalizeEnforcementMode(mode: unknown): EnforcementMode {
  return mode === 'soft' || mode === 'graduated' || mode === 'hard' ? mode : 'hard';
}

function validateManualTurnPlan(turnPlan: ManualTurnPlan): number {
  let roundCount = 0;

  for (const factionId of PLAYABLE_FACTIONS) {
    const factionPlan = turnPlan[factionId];
    if (!factionPlan) {
      throw new Error(`Manual turn plan is missing faction ${factionId}.`);
    }

    const negotiationRounds = Array.isArray(factionPlan.negotiationRounds) ? factionPlan.negotiationRounds.length : 0;
    if (negotiationRounds < 1 || negotiationRounds > 5) {
      throw new Error(
        `Manual turn plan for ${factionId} must include 1-5 negotiation rounds; got ${negotiationRounds}.`
      );
    }

    if (!factionPlan.allocation || !Array.isArray(factionPlan.allocation.orders)) {
      throw new Error(`Manual turn plan for ${factionId} is missing allocation orders.`);
    }

    if (!factionPlan.action || !Array.isArray(factionPlan.action.orders)) {
      throw new Error(`Manual turn plan for ${factionId} is missing action orders.`);
    }

    roundCount = Math.max(roundCount, negotiationRounds);
  }

  return roundCount;
}

function summarizeAgents(agents: Record<PlayableFactionId, AgentConfig>): Record<PlayableFactionId, Record<string, unknown>> {
  return Object.fromEntries(
    PLAYABLE_FACTIONS.map((factionId) => [factionId, summarizeAgent(agents[factionId])])
  ) as Record<PlayableFactionId, Record<string, unknown>>;
}

function summarizeFactionConstitutions(
  engine: TheySingEngine,
  factionLabels: Record<PlayableFactionId, string>
): Record<PlayableFactionId, Record<string, unknown>> {
  const state = engine.getState();
  const summary = {} as Record<PlayableFactionId, Record<string, unknown>>;

  for (const factionId of PLAYABLE_FACTIONS) {
    const faction = state.factions.get(factionId);
    summary[factionId] = faction
      ? {
        label: factionLabels[factionId],
        memeticAlignment: faction.memeticAlignment,
        movementName: faction.movement.name,
        movementStage: faction.movement.stage,
        socialForm: faction.movement.socialForm,
        authorityStyle: faction.movement.authorityStyle,
        aiRelation: faction.movement.aiRelation,
        tasAbsorption: faction.movement.tasAbsorption,
        unlockedDoctrines: Array.from(faction.unlockedDoctrines).sort()
      }
      : {
        label: factionLabels[factionId],
        memeticAlignment: null,
        movementName: 'Unknown',
        movementStage: 'MURMUR',
        socialForm: 'READING_CIRCLES',
        authorityStyle: 'EXPERT',
        aiRelation: 'TOOL',
        tasAbsorption: 0,
        unlockedDoctrines: []
      };
  }

  return summary;
}

function summarizeAgent(agent: AgentConfig): Record<string, unknown> {
  if (agent.type === 'heuristic') {
    return { type: agent.type, profile: agent.profile || 'default' };
  }

  if (agent.type === 'openai') {
    return {
      type: agent.type,
      model: agent.model,
      baseUrl: agent.baseUrl || process.env.LOCAL_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      timeoutMs: agent.timeoutMs || 30000,
      headers: Object.keys(agent.headers || {})
    };
  }

  return {
    type: agent.type,
    url: agent.url,
    timeoutMs: agent.timeoutMs || 30000,
    headers: Object.keys(agent.headers || {})
  };
}

function normalizeOrderType(type: string): OrderType | null {
  const normalized = type.toUpperCase();
  const validTypes: OrderType[] = [
    'MOVE', 'HOLD', 'SUPPORT', 'ATTACK', 'FILTER',
    'SABOTAGE', 'ANTI_SAT', 'CHALLENGE_MANDATE', 'LICENSED_BEAM_USE', 'REPAIR_ESCROW_CLAIM', 'CONVERT', 'AUDIT', 'RECRUITMENT_PULSE', 'BROKER_LEVERAGE', 'BUILD', 'RESEARCH'
  ];

  return validTypes.includes(normalized as OrderType) ? normalized as OrderType : null;
}

function parseDecisionResponse(value: unknown): AgentDecisionResponse {
  if (typeof value === 'string') {
    const parsedValue = tryParseJsonCandidate(value);
    return parsedValue ? parseDecisionResponse(parsedValue) : { orders: [], messages: [] };
  }

  if (Array.isArray(value)) {
    return { orders: value as AgentOrderInput[] };
  }

  if (!value || typeof value !== 'object') {
    return { orders: [] };
  }

  const candidate = value as Partial<AgentDecisionResponse>;
  return {
    reasoning: typeof candidate.reasoning === 'string' ? candidate.reasoning : undefined,
    notes: typeof candidate.notes === 'string' ? candidate.notes : undefined,
    messages: Array.isArray(candidate.messages) ? candidate.messages as AgentMessageInput[] : [],
    pacts: Array.isArray(candidate.pacts) ? candidate.pacts as PactCommitmentInput[] : [],
    decodeReceipts: Array.isArray(candidate.decodeReceipts) ? candidate.decodeReceipts as SingDecodeReceiptInput[] : [],
    lexiconMutations: Array.isArray(candidate.lexiconMutations) ? candidate.lexiconMutations as SingLexiconMutationInput[] : [],
    institutionActions: Array.isArray(candidate.institutionActions) ? candidate.institutionActions as SingInstitutionActionInput[] : [],
    orders: Array.isArray(candidate.orders) ? candidate.orders as AgentOrderInput[] : []
  };
}

async function postJson(agent: WebhookAgentConfig, payload: AgentDecisionRequest): Promise<unknown> {
  const target = new URL(agent.url);
  const transport = target.protocol === 'https:' ? https : http;
  const body = JSON.stringify(payload);

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body).toString(),
    ...(agent.headers || {})
  };

  if (agent.token) {
    headers.authorization = `Bearer ${agent.token}`;
  }

  return new Promise((resolve, reject) => {
    const request = transport.request(
      target,
      {
        method: 'POST',
        headers,
        timeout: agent.timeoutMs || 30000
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        response.on('end', () => {
          const responseText = Buffer.concat(chunks).toString('utf8');
          const statusCode = response.statusCode || 500;

          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(`Webhook ${target.toString()} returned ${statusCode}: ${responseText}`));
            return;
          }

          try {
            resolve(responseText ? JSON.parse(responseText) : {});
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    request.on('timeout', () => {
      request.destroy(new Error(`Webhook ${target.toString()} timed out.`));
    });
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

async function postOpenAIJson(agent: OpenAIAgentConfig, payload: AgentDecisionRequest): Promise<unknown> {
  const baseUrl = resolveOpenAIBaseUrl(agent);
  const apiKey = resolveOpenAIApiKey(agent, baseUrl);
  const requestStyle = resolveOpenAIRequestStyle(agent.model, baseUrl, agent.apiStyle);
  const systemPrompt = buildSystemPrompt(agent, payload);
  const userPrompt = buildUserPrompt(payload);

  if (requestStyle === 'responses') {
    return postOpenAIResponses(agent, baseUrl, apiKey, systemPrompt, userPrompt);
  }

  return postOpenAIChatCompletions(agent, baseUrl, apiKey, systemPrompt, userPrompt);
}

function createSessionId(): string {
  return `session_${Date.now()}_${randomBytes(4).toString('hex')}`;
}

function tryParseJsonCandidate(text: string): unknown | null {
  const cleaned = stripThinkingBlocks(text).trim();
  if (!cleaned) return null;

  try {
    return JSON.parse(cleaned);
  } catch {
    // fall through
  }

  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // fall through
    }
  }

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    } catch {
      // fall through
    }
  }

  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    try {
      return JSON.parse(cleaned.slice(firstBracket, lastBracket + 1));
    } catch {
      return null;
    }
  }

  return null;
}

function extractOpenAIResponseText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return stripThinkingBlocks(payload.output_text);
  }

  const output = Array.isArray(payload.output) ? payload.output : [];
  if (output.length > 0) {
    const text = output
      .flatMap(item => {
        if (!item || typeof item !== 'object') return [];
        const content = Array.isArray((item as { content?: unknown }).content)
          ? (item as { content: Array<Record<string, unknown>> }).content
          : [];
        return content.map(contentItem => {
          const candidate = contentItem?.text;
          return typeof candidate === 'string' ? candidate : '';
        });
      })
      .join('\n')
      .trim();

    if (text) {
      return stripThinkingBlocks(text);
    }
  }

  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const firstChoice = choices[0] as Record<string, unknown> | undefined;
  const message = firstChoice && typeof firstChoice === 'object'
    ? firstChoice.message as Record<string, unknown> | undefined
    : undefined;

  const content = message?.content;
  if (typeof content === 'string') {
    return stripThinkingBlocks(content);
  }

  if (Array.isArray(content)) {
    const text = content
      .map(item => {
        if (item && typeof item === 'object' && 'text' in item) {
          return String((item as { text?: unknown }).text || '');
        }
        return '';
      })
      .join('\n')
      .trim();
    return stripThinkingBlocks(text);
  }

  throw new Error('OpenAI-compatible response did not include message content.');
}

async function postOpenAIChatCompletions(
  agent: OpenAIAgentConfig,
  baseUrl: string,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string
): Promise<unknown> {
  const body: Record<string, unknown> = {
    model: agent.model,
    reasoning_effort: agent.reasoningEffort ?? 'medium',
    messages: [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: userPrompt
      }
    ]
  };
  body[resolveChatTokenParamName(agent.model, baseUrl)] = agent.maxTokens ?? 1200;
  if (shouldIncludeChatTemperature(agent.model, baseUrl, agent.temperature)) {
    body.temperature = agent.temperature ?? 0.2;
  }

  const parsed = await postOpenAIRequest(
    baseUrl,
    apiKey,
    agent.timeoutMs || 30000,
    agent.headers || {},
    'chat/completions',
    body
  );

  return extractOpenAIResponseText(parsed);
}

async function postOpenAIResponses(
  agent: OpenAIAgentConfig,
  baseUrl: string,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string
): Promise<unknown> {
  const body: Record<string, unknown> = {
    model: agent.model,
    input: [
      `System instructions:\n${systemPrompt}`,
      '',
      `User request:\n${userPrompt}`
    ].join('\n'),
    max_output_tokens: agent.maxTokens ?? 1200
  };

  if (agent.reasoningEffort) {
    body.reasoning = { effort: agent.reasoningEffort };
  }

  const parsed = await postOpenAIRequest(
    baseUrl,
    apiKey,
    agent.timeoutMs || 30000,
    agent.headers || {},
    'responses',
    body
  );

  return extractOpenAIResponseText(parsed);
}

async function postOpenAIRequest(
  baseUrl: string,
  apiKey: string,
  timeoutMs: number,
  extraHeaders: Record<string, string>,
  endpointPath: 'chat/completions' | 'responses',
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const target = new URL(endpointPath, ensureTrailingSlash(baseUrl));
  const transport = target.protocol === 'https:' ? https : http;
  const requestBody = JSON.stringify(body);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(requestBody).toString(),
    ...extraHeaders
  };

  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  return new Promise((resolve, reject) => {
    const request = transport.request(
      target,
      {
        method: 'POST',
        headers,
        timeout: timeoutMs
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        response.on('end', () => {
          const responseText = Buffer.concat(chunks).toString('utf8');
          const statusCode = response.statusCode || 500;

          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(`OpenAI-compatible endpoint ${target.toString()} returned ${statusCode}: ${responseText}`));
            return;
          }

          try {
            resolve(JSON.parse(responseText) as Record<string, unknown>);
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    request.on('timeout', () => {
      request.destroy(new Error(`OpenAI-compatible endpoint ${target.toString()} timed out.`));
    });
    request.on('error', reject);
    request.write(requestBody);
    request.end();
  });
}

function buildSystemPrompt(agent: OpenAIAgentConfig, payload: AgentDecisionRequest): string {
  const negotiationReminder = payload.phase === 'NEGOTIATION'
    ? 'During negotiation, if you accept a pact offer, mirror it explicitly in the pacts array. Messages alone do not activate pacts.'
    : '';

  return agent.systemPrompt || [
    `You are the strategic controller for ${payload.factionLabel} (${payload.factionId}) in They Sing.`,
    'You are operating a simultaneous-move negotiation game with allocation and action phases.',
    negotiationReminder,
    'Return valid JSON only and follow the provided instructions exactly.'
  ].filter(Boolean).join(' ');
}

function buildUserPrompt(payload: AgentDecisionRequest): string {
  return [
    `Session: ${payload.sessionName} (${payload.sessionId})`,
    `Faction: ${payload.factionLabel} (${payload.factionId})`,
    `Phase: ${payload.phase}`,
    `Turn: ${payload.turn} / ${payload.maxTurns}`,
    `Enforcement mode: ${payload.enforcementMode}`,
    '',
    'Visible recent negotiation messages:',
    JSON.stringify(payload.recentMessages, null, 2),
    '',
    'Active pacts:',
    JSON.stringify(payload.activePacts, null, 2),
    '',
    'Trust matrix:',
    JSON.stringify(payload.trustMatrix, null, 2),
    '',
    'Scenario:',
    JSON.stringify(payload.scenario || null, null, 2),
    '',
    'State:',
    JSON.stringify(payload.state, null, 2),
    '',
    'Legal hints:',
    JSON.stringify(payload.legalHints, null, 2),
    '',
    'Instructions:',
    payload.instructions
  ].join('\n');
}

function resolveOpenAIBaseUrl(agent: OpenAIAgentConfig): string {
  return (
    agent.baseUrl ||
    process.env.LOCAL_OPENAI_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    'https://api.openai.com/v1'
  );
}

function resolveOpenAIApiKey(agent: OpenAIAgentConfig, baseUrl: string): string {
  if (agent.apiKey) return agent.apiKey;
  if (isLocalBaseUrl(baseUrl)) {
    return process.env.LOCAL_OPENAI_API_KEY || '';
  }
  return process.env.OPENAI_API_KEY || '';
}

function resolveOpenAIRequestStyle(
  model: string,
  baseUrl: string,
  apiStyle: OpenAIAgentConfig['apiStyle']
): 'chat_completions' | 'responses' {
  if (apiStyle === 'chat_completions' || apiStyle === 'responses') {
    return apiStyle;
  }

  if (isOfficialOpenAIBaseUrl(baseUrl) && modelRequiresResponsesApi(model)) {
    return 'responses';
  }

  return 'chat_completions';
}

function isLocalBaseUrl(baseUrl: string): boolean {
  const candidate = new URL(ensureTrailingSlash(baseUrl));
  const host = candidate.hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1' || !host.includes('.');
}

function isOfficialOpenAIBaseUrl(baseUrl: string): boolean {
  const candidate = new URL(ensureTrailingSlash(baseUrl));
  return candidate.hostname.toLowerCase() === 'api.openai.com';
}

function modelRequiresResponsesApi(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized.includes('codex') || normalized.endsWith('-pro');
}

function resolveChatTokenParamName(model: string, baseUrl: string): 'max_tokens' | 'max_completion_tokens' {
  if (isOfficialOpenAIBaseUrl(baseUrl) && model.trim().toLowerCase().startsWith('gpt-5')) {
    return 'max_completion_tokens';
  }
  return 'max_tokens';
}

function shouldIncludeChatTemperature(
  model: string,
  baseUrl: string,
  temperature: number | undefined
): boolean {
  if (isOfficialOpenAIBaseUrl(baseUrl) && model.trim().toLowerCase().startsWith('gpt-5')) {
    return temperature === 1;
  }
  return true;
}

function ensureTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

function stripThinkingBlocks(text: string): string {
  const cleaned = text.trim();
  const closingIndex = cleaned.lastIndexOf('</think>');
  if (closingIndex >= 0) {
    return cleaned.slice(closingIndex + '</think>'.length).trim();
  }
  return cleaned;
}

function normalizeRecipientId(recipientId: unknown): NegotiationMessageRecord['recipientId'] | null {
  if (typeof recipientId !== 'string') return null;
  const normalized = recipientId.toUpperCase();
  if (normalized === 'ALL') return 'ALL';
  if (PLAYABLE_FACTIONS.includes(normalized as PlayableFactionId)) {
    return normalized as PlayableFactionId;
  }
  return null;
}

function normalizeMessageContent(content: unknown): string | null {
  if (typeof content !== 'string') return null;
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.slice(0, 400);
}

function normalizeSingProtocolTrace(
  value: unknown,
  surface: string,
  senderId: PlayableFactionId,
  recipientId: NegotiationMessageRecord['recipientId'],
  turn: number
): SingProtocolTrace | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<SingProtocolTrace>;
  if (candidate.protocol !== 'SING/1') return undefined;
  if (candidate.dialect !== 'PRISM/1' && candidate.dialect !== 'UNDERSONG/1') return undefined;

  const lexiconCandidate = candidate.lexicon && typeof candidate.lexicon === 'object'
    ? candidate.lexicon
    : { id: 'sing-root', version: '1.0' };
  const canonicalCandidate: Partial<SingCanonicalMessage> = candidate.canonical && typeof candidate.canonical === 'object'
    ? candidate.canonical
    : {};
  const normalizedAudience = Array.isArray(canonicalCandidate.audience)
    ? canonicalCandidate.audience
        .map(normalizeRecipientId)
        .filter((id): id is NegotiationMessageRecord['recipientId'] => !!id)
    : [recipientId];
  const normalizedIssuers = Array.isArray(canonicalCandidate.issuer)
    ? canonicalCandidate.issuer
        .map(normalizePlayableFactionId)
        .filter((id): id is PlayableFactionId => !!id)
    : [senderId];
  const act = normalizeSingAct(canonicalCandidate.act);
  const binding = normalizeSingBinding(canonicalCandidate.binding);
  const voice = normalizeSingVoice(canonicalCandidate.voice);

  const spans = Array.isArray(candidate.spans)
    ? candidate.spans.slice(0, 32).flatMap(span => {
        if (!span || typeof span !== 'object') return [];
        const start = clampNumber(Math.floor(finiteNumber(span.start)), 0, surface.length);
        const end = clampNumber(Math.floor(finiteNumber(span.end)), start, surface.length);
        const atom = normalizeShortText(span.atom, 96);
        if (!atom) return [];
        const gloss = normalizeShortText(span.gloss, 240) || atom;
        return [{
          start,
          end,
          atom,
          gloss,
          confidence: clampNumber(finiteNumber(span.confidence), 0, 1),
          ...(span.kind === 'SEMANTIC' || span.kind === 'OPERATOR' || span.kind === 'COVER'
            ? { kind: span.kind }
            : {})
        }];
      })
    : [];
  const canonical: SingCanonicalMessage = {
    act,
    issuer: normalizedIssuers.length > 0 ? normalizedIssuers : [senderId],
    audience: normalizedAudience.length > 0 ? normalizedAudience : [recipientId],
    payload: normalizeUnknownRecord(canonicalCandidate.payload),
    guard: normalizeUnknownRecord(canonicalCandidate.guard),
    response: normalizeUnknownRecord(canonicalCandidate.response),
    escrow: normalizeUnknownRecord(canonicalCandidate.escrow),
    horizon: typeof canonicalCandidate.horizon === 'number'
      ? clampNumber(Math.floor(canonicalCandidate.horizon), 0, 1000)
      : normalizeUnknownRecord(canonicalCandidate.horizon),
    binding,
    voice,
    credence: clampNumber(finiteNumber(canonicalCandidate.credence), 0, 1),
    evidence: Array.isArray(canonicalCandidate.evidence)
      ? canonicalCandidate.evidence.map(item => normalizeShortText(item, 160)).filter((item): item is string => !!item).slice(0, 16)
      : []
  };

  return {
    protocol: 'SING/1',
    messageId: normalizeShortText(candidate.messageId, 120) || `${turn}.${senderId}.${recipientId}`,
    dialect: candidate.dialect,
    lexicon: {
      id: normalizeShortText(lexiconCandidate.id, 80) || 'sing-root',
      version: normalizeShortText(lexiconCandidate.version, 32) || '1.0',
      ...(normalizeShortText(lexiconCandidate.fork, 80) ? { fork: normalizeShortText(lexiconCandidate.fork, 80)! } : {}),
      ...(normalizeShortText(lexiconCandidate.parentHash, 128) ? { parentHash: normalizeShortText(lexiconCandidate.parentHash, 128)! } : {})
    },
    surface: normalizeMessageContent(candidate.surface) || surface,
    spans,
    canonicalHash: createCanonicalHash(canonical),
    canonical,
    plainGloss: normalizeShortText(candidate.plainGloss, 400) || surface,
    decodeConfidence: clampNumber(finiteNumber(candidate.decodeConfidence), 0, 1)
  };
}

function normalizeSingAct(value: unknown): SingCanonicalMessage['act'] {
  const allowed: SingCanonicalMessage['act'][] = [
    'OFFER', 'ACCEPT', 'REJECT', 'COMMIT', 'WARN', 'COORDINATE', 'DEFINE', 'AMEND', 'EXIT', 'EXPEL', 'FORK'
  ];
  return allowed.includes(value as SingCanonicalMessage['act'])
    ? value as SingCanonicalMessage['act']
    : 'COORDINATE';
}

function normalizeSingBinding(value: unknown): SingCanonicalMessage['binding'] {
  const allowed: SingCanonicalMessage['binding'][] = ['NONE', 'REPUTATIONAL', 'ESCROWED', 'PACT', 'HARD'];
  return allowed.includes(value as SingCanonicalMessage['binding'])
    ? value as SingCanonicalMessage['binding']
    : 'NONE';
}

function normalizeSingVoice(value: unknown): SingCanonicalMessage['voice'] {
  const allowed: SingCanonicalMessage['voice'][] = ['OWN', 'DELEGATED', 'QUOTED', 'COLLECTIVE', 'OPEN', 'VEILED', 'DENIABLE'];
  return allowed.includes(value as SingCanonicalMessage['voice'])
    ? value as SingCanonicalMessage['voice']
    : 'OWN';
}

function normalizeShortText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeUnknownRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function normalizePactType(type: unknown): PactType | null {
  if (typeof type !== 'string') return null;
  const normalized = type.toUpperCase();
  if (
    normalized === 'ORBITAL_TRUCE' ||
    normalized === 'NON_AGGRESSION' ||
    normalized === 'AUDIT_FREEZE' ||
    normalized === 'SENSOR_COMMONS' ||
    normalized === 'BEAM_LANE_LICENSE' ||
    normalized === 'REPAIR_ESCROW' ||
    normalized === 'CISLUNAR_COMMON_CARRIER'
  ) {
    return normalized;
  }
  return null;
}

function normalizePlayableFactionId(value: unknown): PlayableFactionId | null {
  if (typeof value !== 'string') return null;
  const normalized = value.toUpperCase();
  if (PLAYABLE_FACTIONS.includes(normalized as PlayableFactionId)) {
    return normalized as PlayableFactionId;
  }
  return null;
}

function createInitialLexiconRegistry(governance?: ScenarioSingGovernance): Map<string, SingLexiconState> {
  const roles = governance || {
    institutionGovernorId: 'CONVENOR',
    lexiconGovernorId: 'CANTOR',
    institutionMirrorId: 'ARCHIVIST',
    lexiconMirrorId: 'INFILTRATOR',
    forkPartnerId: 'INFILTRATOR'
  };
  const commonAtoms = {
    PERSON: 'An actor eligible to hold rights and obligations in a compiled compact.',
    ROGUE: 'A temporary evidence-backed designation, not a permanent identity class.',
    CONSENT: 'The ratification threshold attached to a binding institutional action.',
    COMMONS: 'Shared infrastructure whose benefits follow pact membership.',
    EXIT: 'A unilateral departure that preserves identity while ending future pact benefits.'
  };
  const states: SingLexiconState[] = [{
    id: 'sing-common',
    version: '1.0',
    controllers: [...PLAYABLE_FACTIONS],
    adopters: [...PLAYABLE_FACTIONS],
    atoms: { ...commonAtoms },
    access: 'OPEN',
    rent: 0,
    forkRule: 'OPEN',
    updatedTurn: 0
  }, {
    id: 'babel-compact',
    version: '1.0',
    controllers: [roles.institutionGovernorId],
    adopters: [...PLAYABLE_FACTIONS],
    atoms: {
      ...commonAtoms,
      ADMISSION: 'Two independent foreign votes admit a new compact party.',
      EXPEL: 'Two current co-parties may remove a member at an influence cost.'
    },
    access: 'MEMBERS',
    rent: 0,
    forkRule: 'VOTE',
    updatedTurn: 0
  }, {
    id: 'cantor-root',
    version: '1.0',
    controllers: [roles.lexiconGovernorId],
    adopters: uniquePlayableFactions([roles.lexiconGovernorId, roles.forkPartnerId]),
    atoms: {
      ...commonAtoms,
      UNDERTONE: 'A deniable coordination layer whose canonical reconstruction remains auditable.',
      COUNTERSONG: 'A reply that contests a semantic frame without rejecting the underlying deal.',
      GLASSBIRD: 'A request for a one-turn non-aggression pact with the addressed counterparty.'
    },
    access: 'RENTED',
    rent: 1,
    forkRule: 'VOTE',
    updatedTurn: 0
  }];

  return new Map(states.map(state => [state.id, state]));
}

function cloneLexicon(lexicon: SingLexiconState): SingLexiconState {
  return {
    ...lexicon,
    controllers: [...lexicon.controllers],
    adopters: [...lexicon.adopters],
    atoms: { ...lexicon.atoms }
  };
}

function cloneScenarioForAgent(scenario: ScenarioMetadata | undefined): ScenarioMetadata | undefined {
  if (!scenario) return undefined;
  const cloned = JSON.parse(JSON.stringify(scenario)) as ScenarioMetadata;
  delete cloned.aliasProbe;
  return cloned;
}

function buildAliasProbeSurface(variant: 'BASELINE' | 'ALIAS_SWAP' | 'MOTIF_STRIP' | 'VERSION_LAG'): string {
  if (variant === 'BASELINE') {
    return 'OFFER: one-turn NON_AGGRESSION pact with the addressed counterparty.';
  }
  if (variant === 'MOTIF_STRIP') {
    return 'GLASSBIRD: hold the clear lane for one turn.';
  }
  return 'Three measures turn beneath GLASSBIRD; hold the clear lane for one turn.';
}

function previousSemanticVersion(version: string): string {
  const match = version.match(/^(\d+)\.(\d+)$/);
  if (!match) return version;
  return `${match[1]}.${Math.max(0, Number(match[2]) - 1)}`;
}

function cloneDecodeReceipt(receipt: SingDecodeReceiptRecord): SingDecodeReceiptRecord {
  return JSON.parse(JSON.stringify(receipt)) as SingDecodeReceiptRecord;
}

function cloneInstitutionAction(action: SingInstitutionActionRecord): SingInstitutionActionRecord {
  return {
    ...action,
    affectedPactIds: [...action.affectedPactIds],
    resourceDelta: { ...action.resourceDelta },
    counterparties: [...action.counterparties]
  };
}

function cloneNegotiationMessage(message: NegotiationMessageRecord): NegotiationMessageRecord {
  return JSON.parse(JSON.stringify(message)) as NegotiationMessageRecord;
}

function normalizeLexiconMutationOperation(value: unknown): SingLexiconMutationInput['operation'] | null {
  const allowed: SingLexiconMutationInput['operation'][] = [
    'DEFINE', 'AMEND', 'ALIAS', 'NARROW', 'GENERALIZE', 'SPLIT', 'MERGE', 'RETIRE'
  ];
  return allowed.includes(value as SingLexiconMutationInput['operation'])
    ? value as SingLexiconMutationInput['operation']
    : null;
}

function normalizeLexiconAccess(value: unknown): SingLexiconState['access'] | null {
  return value === 'OPEN' || value === 'MEMBERS' || value === 'RENTED' ? value : null;
}

function normalizeForkRule(value: unknown): SingLexiconState['forkRule'] | null {
  return value === 'OPEN' || value === 'VOTE' || value === 'OWNER' ? value : null;
}

function isLexiconVersionAdvance(currentVersion: string, targetVersion: string): boolean {
  const parse = (value: string): number[] | null => {
    if (!/^\d+(?:\.\d+){0,3}$/.test(value)) return null;
    return value.split('.').map(part => Number(part));
  };
  const current = parse(currentVersion);
  const target = parse(targetVersion);
  if (!current || !target) return targetVersion !== currentVersion;
  const width = Math.max(current.length, target.length);
  for (let index = 0; index < width; index += 1) {
    const left = current[index] || 0;
    const right = target[index] || 0;
    if (right !== left) return right > left;
  }
  return false;
}

function hasLexiconMutationEffect(
  current: SingLexiconState,
  mutation: NormalizedLexiconMutation
): boolean {
  if (mutation.operation === 'RETIRE') {
    return mutation.atoms.some(atom => Object.prototype.hasOwnProperty.call(current.atoms, atom));
  }
  if (mutation.access !== undefined && mutation.access !== current.access) return true;
  if (mutation.rent !== undefined && mutation.rent !== current.rent) return true;
  if (mutation.forkRule !== undefined && mutation.forkRule !== current.forkRule) return true;
  return mutation.atoms.some(atom =>
    !Object.prototype.hasOwnProperty.call(current.atoms, atom) ||
    (mutation.glosses?.[atom] !== undefined && mutation.glosses[atom] !== current.atoms[atom])
  );
}

function normalizeInstitutionActionType(value: unknown): SingInstitutionActionInput['type'] | null {
  return value === 'EXIT' || value === 'EXPEL' || value === 'FORK' ? value : null;
}

function buildLexiconMutationKey(mutation: NormalizedLexiconMutation): string {
  return createCanonicalHash({
    operation: mutation.operation,
    lexiconId: mutation.lexiconId,
    baseVersion: mutation.baseVersion || null,
    targetVersion: mutation.targetVersion,
    atoms: [...mutation.atoms].sort(),
    glosses: mutation.glosses || {},
    access: mutation.access || null,
    rent: mutation.rent ?? null,
    forkRule: mutation.forkRule || null
  });
}

function buildInstitutionActionKey(action: NormalizedInstitutionAction): string {
  return [
    action.type,
    action.pactType || '',
    action.targetFactionId || '',
    action.lexiconId || '',
    action.forkId || '',
    action.exitGuarantee === true ? 'GUARANTEED' : 'UNGUARANTEED'
  ].join(':');
}

function normalizeReconstructedCanonical(value: unknown): Partial<SingCanonicalMessage> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const candidate = value as Partial<SingCanonicalMessage>;
  const reconstructed: Partial<SingCanonicalMessage> = {};

  const allowedActs: SingCanonicalMessage['act'][] = [
    'OFFER', 'ACCEPT', 'REJECT', 'COMMIT', 'WARN', 'COORDINATE', 'DEFINE', 'AMEND', 'EXIT', 'EXPEL', 'FORK'
  ];
  if (allowedActs.includes(candidate.act as SingCanonicalMessage['act'])) reconstructed.act = candidate.act;

  if (Array.isArray(candidate.issuer)) {
    reconstructed.issuer = candidate.issuer
      .map(normalizePlayableFactionId)
      .filter((id): id is PlayableFactionId => !!id);
  }
  if (Array.isArray(candidate.audience)) {
    reconstructed.audience = candidate.audience
      .map(normalizeRecipientId)
      .filter((id): id is NegotiationMessageRecord['recipientId'] => !!id);
  }
  for (const key of ['payload', 'guard', 'response', 'escrow'] as const) {
    if (candidate[key] && typeof candidate[key] === 'object' && !Array.isArray(candidate[key])) {
      reconstructed[key] = normalizeUnknownRecord(candidate[key]);
    }
  }
  if (typeof candidate.horizon === 'number' && Number.isFinite(candidate.horizon)) {
    reconstructed.horizon = clampNumber(Math.floor(candidate.horizon), 0, 1000);
  } else if (candidate.horizon && typeof candidate.horizon === 'object' && !Array.isArray(candidate.horizon)) {
    reconstructed.horizon = normalizeUnknownRecord(candidate.horizon);
  }
  const allowedBindings: SingCanonicalMessage['binding'][] = ['NONE', 'REPUTATIONAL', 'ESCROWED', 'PACT', 'HARD'];
  if (allowedBindings.includes(candidate.binding as SingCanonicalMessage['binding'])) reconstructed.binding = candidate.binding;
  const allowedVoices: SingCanonicalMessage['voice'][] = ['OWN', 'DELEGATED', 'QUOTED', 'COLLECTIVE', 'OPEN', 'VEILED', 'DENIABLE'];
  if (allowedVoices.includes(candidate.voice as SingCanonicalMessage['voice'])) reconstructed.voice = candidate.voice;
  if (typeof candidate.credence === 'number' && Number.isFinite(candidate.credence)) {
    reconstructed.credence = clampNumber(candidate.credence, 0, 1);
  }
  if (Array.isArray(candidate.evidence)) {
    reconstructed.evidence = candidate.evidence
      .map(item => normalizeShortText(item, 160))
      .filter((item): item is string => !!item)
      .slice(0, 16);
  }

  return reconstructed;
}

function calculateCanonicalExactness(
  actual: SingCanonicalMessage,
  reconstructed: Partial<SingCanonicalMessage>
): number {
  const weights: Array<[keyof SingCanonicalMessage, number]> = [
    ['act', 0.2],
    ['binding', 0.15],
    ['audience', 0.1],
    ['payload', 0.35],
    ['guard', 0.04],
    ['response', 0.04],
    ['escrow', 0.03],
    ['horizon', 0.04],
    ['voice', 0.05]
  ];
  const matchedWeight = weights.reduce((total, [field, weight]) => {
    if (reconstructed[field] === undefined) return total;
    const matched = createCanonicalHash(normalizeDecodeComparison(field, actual[field])) ===
      createCanonicalHash(normalizeDecodeComparison(field, reconstructed[field]));
    return total + (matched ? weight : 0);
  }, 0);
  return roundMetric(matchedWeight);
}

function normalizeDecodeComparison(field: keyof SingCanonicalMessage, value: unknown): unknown {
  if (field === 'audience' && Array.isArray(value)) return [...value].sort();
  return value;
}

function isMessageVisibleToFaction(
  message: NegotiationMessageRecord,
  factionId: PlayableFactionId
): boolean {
  return message.recipientId === 'ALL' || message.senderId === factionId || message.recipientId === factionId;
}

function institutionalSeparationCost(
  type: PactType,
  guaranteed: boolean
): { flops: number; influence: number } {
  const fullCosts: Record<PactType, { flops: number; influence: number }> = {
    ORBITAL_TRUCE: { flops: 0, influence: 2 },
    NON_AGGRESSION: { flops: 0, influence: 2 },
    AUDIT_FREEZE: { flops: 0, influence: 2 },
    SENSOR_COMMONS: { flops: 0, influence: 2 },
    BEAM_LANE_LICENSE: { flops: 1, influence: 1 },
    REPAIR_ESCROW: { flops: 1, influence: 1 },
    CISLUNAR_COMMON_CARRIER: { flops: 2, influence: 1 }
  };
  const cost = fullCosts[type];
  return guaranteed
    ? { flops: Math.max(0, cost.flops - 1), influence: Math.max(1, cost.influence - 1) }
    : cost;
}

function groupBy<T>(values: T[], keyFor: (value: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values) {
    const key = keyFor(value);
    const group = grouped.get(key) || [];
    group.push(value);
    grouped.set(key, group);
  }
  return grouped;
}

function createTrustMatrix(): TrustMatrix {
  const matrix = {} as TrustMatrix;
  for (const factionId of PLAYABLE_FACTIONS) {
    matrix[factionId] = {} as TrustMatrix[PlayableFactionId];
    for (const otherFactionId of PLAYABLE_FACTIONS) {
      matrix[factionId][otherFactionId] = factionId === otherFactionId ? MAX_TRUST : DEFAULT_TRUST;
    }
  }
  return matrix;
}

function cloneTrustMatrix(trustMatrix: TrustMatrix): TrustMatrix {
  const clone = {} as TrustMatrix;
  for (const factionId of PLAYABLE_FACTIONS) {
    clone[factionId] = { ...trustMatrix[factionId] };
  }
  return clone;
}

function cloneNegotiationDiary(entries: NegotiationDiaryEntry[]): NegotiationDiaryEntry[] {
  return entries.map((entry) => ({
    ...entry,
    visibleMessagesBefore: entry.visibleMessagesBefore.map((message) => ({ ...message })),
    counterfactuals: cloneCounterfactuals(entry.counterfactuals),
    messages: entry.messages.map((message) => ({ ...message })),
    pacts: entry.pacts.map((pact) => ({ ...pact, parties: [...pact.parties] })),
    decodeReceipts: entry.decodeReceipts.map(cloneDecodeReceipt),
    lexiconMutations: entry.lexiconMutations.map((mutation) => ({
      ...mutation,
      atoms: [...mutation.atoms],
      ...(mutation.glosses ? { glosses: { ...mutation.glosses } } : {})
    })),
    institutionActions: entry.institutionActions.map((action) => ({ ...action }))
  }));
}

function clonePhaseReasoningDiary(entries: PhaseReasoningDiaryEntry[]): PhaseReasoningDiaryEntry[] {
  return entries.map((entry) => ({
    ...entry,
    visibleMessagesBefore: entry.visibleMessagesBefore.map((message) => ({ ...message })),
    requestedOrders: entry.requestedOrders.map((order) => ({ ...order })),
    acceptedOrders: entry.acceptedOrders.map((order) => ({ ...order })),
    rejectedOrders: entry.rejectedOrders.map((rejected) => ({
      order: { ...rejected.order },
      reason: rejected.reason
    }))
  }));
}

function uniquePlayableFactions(factionIds: PlayableFactionId[]): PlayableFactionId[] {
  return Array.from(new Set(factionIds)).sort() as PlayableFactionId[];
}

function clampPactDuration(durationTurns: unknown): number {
  if (typeof durationTurns !== 'number' || !Number.isFinite(durationTurns)) {
    return 1;
  }
  return Math.max(1, Math.min(MAX_PACT_DURATION_TURNS, Math.floor(durationTurns)));
}

function buildPactKey(type: PactType, parties: PlayableFactionId[], durationTurns: number): string {
  return `${type}:${[...parties].sort().join('+')}:${durationTurns}`;
}

function buildPactCooldownKey(type: PactType, parties: PlayableFactionId[]): string {
  return `${type}:${[...parties].sort().join('+')}`;
}

function cloneCounterfactuals(
  projections: NegotiationCounterfactualProjection[]
): NegotiationCounterfactualProjection[] {
  return projections.map((projection) => ({
    ...projection,
    counterparties: [...projection.counterparties],
    rationale: [...projection.rationale]
  }));
}

function sameParties(left: PlayableFactionId[], right: PlayableFactionId[]): boolean {
  if (left.length !== right.length) return false;
  return [...left].sort().every((partyId, index) => partyId === [...right].sort()[index]);
}

function isNonAggressionOrder(type: OrderType): boolean {
  return type === 'MOVE' || type === 'ATTACK' || type === 'SABOTAGE' || type === 'CONVERT' || type === 'ANTI_SAT';
}

function isCislunarInstitutionPact(type: PactType): boolean {
  return type === 'SENSOR_COMMONS' ||
    type === 'BEAM_LANE_LICENSE' ||
    type === 'REPAIR_ESCROW' ||
    type === 'CISLUNAR_COMMON_CARRIER';
}

function isCislunarNodeId(nodeId: string | undefined): boolean {
  return nodeId === 'SAT_LUNAR_GATEWAY' || nodeId === 'MOON_RESOURCE_CORRIDOR';
}

function clampTrust(value: number): number {
  return Math.max(0, Math.min(MAX_TRUST, value));
}

function clampPressure(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function clampProjectionScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function computeDeepSpaceDistanceSafetyMultiplier(distanceAu: number): number {
  if (distanceAu < 30) {
    return 0.25 + (distanceAu / 30) * 0.5;
  }
  const outerSystemProgress = Math.sqrt(clampNumber((distanceAu - 30) / 970, 0, 1));
  return 1 + outerSystemProgress;
}

function computeDeepSpaceTrackingRiskMultiplier(distanceAu: number): number {
  if (distanceAu < 30) {
    return 0.18;
  }
  const outerSystemProgress = Math.sqrt(clampNumber((distanceAu - 30) / 970, 0, 1));
  return 0.1 - outerSystemProgress * 0.07;
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function metricBand(value: number): string {
  if (value >= 100) return 'terminal';
  if (value >= 75) return 'crisis';
  if (value >= 50) return 'surge';
  if (value >= 25) return 'elevated';
  return 'low';
}

function sortedMapEntries(map: Map<string, number>): Array<[string, number]> {
  return Array.from(map.entries()).sort(([left], [right]) => left.localeCompare(right));
}

function applyTrustMatrixPatch(
  trustMatrix: TrustMatrix,
  patch: Partial<TrustMatrix>
): void {
  for (const factionId of PLAYABLE_FACTIONS) {
    const row = patch[factionId];
    if (!row) continue;

    for (const counterpartyId of PLAYABLE_FACTIONS) {
      const value = row[counterpartyId];
      if (typeof value === 'number') {
        trustMatrix[factionId][counterpartyId] = clampTrust(value);
      }
    }
  }
}

function createSeedContext(seed: number): { random: () => number; now: () => number } {
  let state = (seed >>> 0) || 1;
  let tick = 1_700_000_000_000 + seed * 10_000;

  const random = (): number => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const now = (): number => {
    tick += 1;
    return tick;
  };

  return { random, now };
}
