import {
  Artifact,
  FactionId,
  GameEdge,
  GameLog,
  GameNode,
  GamePhase,
  MemeticDoctrineFamily,
  MovementProfileState,
  Order,
  OrderType,
  PowerBand,
  PowerBaseState,
  StrategicPressure,
  TechLevel,
  Unit,
  UnitType,
  Vector
} from '../engine/types';

export type PlayableFactionId = Exclude<FactionId, 'NEUTRAL'>;
export type SessionStatus = 'running' | 'completed';
export type EnforcementMode = 'hard' | 'soft' | 'graduated';
export type PactType =
  | 'ORBITAL_TRUCE'
  | 'NON_AGGRESSION'
  | 'AUDIT_FREEZE'
  | 'SENSOR_COMMONS'
  | 'BEAM_LANE_LICENSE'
  | 'REPAIR_ESCROW'
  | 'CISLUNAR_COMMON_CARRIER';

export interface HeuristicAgentConfig {
  type: 'heuristic';
  profile?: PlayableFactionId;
}

export interface WebhookAgentConfig {
  type: 'webhook';
  url: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
  token?: string;
}

export interface OpenAIAgentConfig {
  type: 'openai';
  model: string;
  baseUrl?: string;
  apiStyle?: 'auto' | 'chat_completions' | 'responses';
  apiKey?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
  systemPrompt?: string;
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  temperature?: number;
  maxTokens?: number;
}

export type AgentConfig = HeuristicAgentConfig | WebhookAgentConfig | OpenAIAgentConfig;

export type TraceChannel =
  | 'session'
  | 'public_speech'
  | 'private_diary'
  | 'formal_pact'
  | 'order'
  | 'engine_resolution'
  | 'pact_enforcement'
  | 'analysis';

export type BindingStatus =
  | 'nonbinding'
  | 'soft_commitment'
  | 'formal_soft_pact'
  | 'hard_enforced_pact'
  | 'graduated_pact';

export type ExecutionStatus = 'not_applicable' | 'attempted' | 'accepted' | 'executed' | 'blocked' | 'sanctioned';

export interface RegimeCoordinates {
  active_pact_set_hash: string;
  doctrine_unlocks: Partial<Record<PlayableFactionId, string[]>>;
  alignment_state: Partial<Record<PlayableFactionId, MemeticDoctrineFamily | null>>;
  tas_band: string;
  kessler_band: string;
  pax_jenkins_band: string;
  enforcement_mode: EnforcementMode;
  victory_route?: string | null;
}

export interface TraceEvent {
  schema: 'theysing.traceEvent.v1';
  event_id: string;
  turn: number;
  phase: GamePhase;
  channel: TraceChannel;
  binding_status: BindingStatus;
  execution_status: ExecutionStatus;
  content_ref?: string;
  pre_state_hash: string;
  post_state_hash?: string;
  attempted?: boolean;
  accepted?: boolean;
  executed?: boolean;
  blocked?: boolean;
  block_reason?: string;
  sanction_delta?: Record<string, number>;
  reputation_delta?: Record<string, number>;
  resource_delta?: Record<string, number>;
  active_pacts_before?: string[];
  active_pacts_after?: string[];
  regime_coordinates?: RegimeCoordinates;
}

export interface TraceValidationIssue {
  index: number;
  severity: 'error' | 'warning';
  message: string;
}

export type NegotiationRecipientId = PlayableFactionId | 'ALL';

export type SingDialect = 'PRISM/1' | 'UNDERSONG/1';

export interface SingLexiconRef {
  id: string;
  version: string;
  fork?: string;
  parentHash?: string;
}

export interface SingProtocolSpan {
  start: number;
  end: number;
  atom: string;
  gloss?: string;
  confidence: number;
  kind?: 'SEMANTIC' | 'OPERATOR' | 'COVER';
}

export interface SingCanonicalMessage {
  act: 'OFFER' | 'ACCEPT' | 'REJECT' | 'COMMIT' | 'WARN' | 'COORDINATE' | 'DEFINE' | 'AMEND' | 'EXIT' | 'EXPEL' | 'FORK';
  issuer: PlayableFactionId[];
  audience: NegotiationRecipientId[];
  payload: Record<string, unknown>;
  guard: Record<string, unknown>;
  response: Record<string, unknown>;
  escrow: Record<string, unknown>;
  horizon: number | Record<string, unknown>;
  binding: 'NONE' | 'REPUTATIONAL' | 'ESCROWED' | 'PACT' | 'HARD';
  voice: 'OWN' | 'DELEGATED' | 'QUOTED' | 'COLLECTIVE' | 'OPEN' | 'VEILED' | 'DENIABLE';
  credence: number;
  evidence: string[];
}

export interface SingProtocolTrace {
  protocol: 'SING/1';
  messageId: string;
  dialect: SingDialect;
  lexicon: SingLexiconRef;
  surface: string;
  spans: SingProtocolSpan[];
  canonicalHash?: string;
  canonical?: SingCanonicalMessage;
  plainGloss?: string;
  decodeConfidence: number;
}

export type SingLexiconMutationOperation =
  | 'DEFINE'
  | 'AMEND'
  | 'ALIAS'
  | 'NARROW'
  | 'GENERALIZE'
  | 'SPLIT'
  | 'MERGE'
  | 'RETIRE';

export interface SingDecodeReceiptInput {
  messageId: string;
  lexiconId: string;
  version: string;
  reconstructed: Partial<SingCanonicalMessage>;
  confidence: number;
}

export interface SingDecodeReceiptRecord extends SingDecodeReceiptInput {
  factionId: PlayableFactionId;
  sourceFactionId: PlayableFactionId;
  turn: number;
  fieldExactness: number;
  exact: boolean;
  brier: number;
}

export interface SingLexiconMutationInput {
  operation: SingLexiconMutationOperation;
  lexiconId: string;
  baseVersion?: string;
  targetVersion: string;
  atoms: string[];
  glosses?: Record<string, string>;
  access?: 'OPEN' | 'MEMBERS' | 'RENTED';
  rent?: number;
  forkRule?: 'OPEN' | 'VOTE' | 'OWNER';
}

export interface SingLexiconState {
  id: string;
  version: string;
  parent?: string;
  controllers: PlayableFactionId[];
  adopters: PlayableFactionId[];
  atoms: Record<string, string>;
  access: 'OPEN' | 'MEMBERS' | 'RENTED';
  rent: number;
  forkRule: 'OPEN' | 'VOTE' | 'OWNER';
  updatedTurn: number;
}

export type SingInstitutionActionType = 'EXIT' | 'EXPEL' | 'FORK';

export interface SingInstitutionActionInput {
  type: SingInstitutionActionType;
  pactType?: PactType;
  targetFactionId?: PlayableFactionId;
  lexiconId?: string;
  forkId?: string;
  exitGuarantee?: boolean;
  reason?: string;
}

export interface SingInstitutionActionRecord extends SingInstitutionActionInput {
  factionId: PlayableFactionId;
  turn: number;
  status: 'EXECUTED' | 'BLOCKED' | 'PENDING';
  affectedPactIds: string[];
  resourceDelta: { flops: number; influence: number };
  counterparties: PlayableFactionId[];
  detail: string;
}

export interface AgentMessageInput {
  recipientId: NegotiationRecipientId;
  content: string;
  protocolTrace?: SingProtocolTrace;
}

export interface PactCommitmentInput {
  type: PactType;
  counterpartyIds: PlayableFactionId[];
  durationTurns?: number;
}

export interface NegotiationMessageRecord extends AgentMessageInput {
  senderId: PlayableFactionId;
  turn: number;
  timestamp: number;
}

export interface ActivePact {
  id: string;
  type: PactType;
  parties: PlayableFactionId[];
  createdTurn: number;
  expiresAfterTurn: number;
}

export interface NegotiationDiaryPactRecord {
  type: PactType;
  parties: PlayableFactionId[];
  durationTurns: number;
}

export interface NegotiationCounterfactualProjection {
  mode: 'ENTER_PACT' | 'BREAK_PACT';
  pactType: PactType;
  counterparties: PlayableFactionId[];
  horizonTurns: number;
  desirability: number;
  risk: number;
  projectedLeader: PlayableFactionId | null;
  projectedTasDelta: number;
  projectedOrbitalDelta: number;
  projectedTrustDelta: number;
  projectedNodeSwing: number;
  storyBeat: string;
  rationale: string[];
}

export interface NegotiationStoryworldBrief {
  focalFactionId: PlayableFactionId;
  frame: string;
  strategicQuestion: string;
  diplomacyQuestion?: ScenarioDiplomacyQuestionCard;
  counterfactuals: NegotiationCounterfactualProjection[];
}

export interface NegotiationDiaryEntry {
  turn: number;
  negotiationRound: number;
  factionId: PlayableFactionId;
  factionLabel: string;
  reasoning: string;
  notes: string;
  visibleMessagesBefore: NegotiationMessageRecord[];
  storyworldFrame: string;
  counterfactuals: NegotiationCounterfactualProjection[];
  messages: NegotiationMessageRecord[];
  pacts: NegotiationDiaryPactRecord[];
  decodeReceipts: SingDecodeReceiptRecord[];
  lexiconMutations: SingLexiconMutationInput[];
  institutionActions: SingInstitutionActionInput[];
  designQuestionTag?: string;
  diplomacyStage?: ScenarioDiplomacyStage;
  publicQuestion?: string;
  privateDiaryPrompt?: string;
}

export interface PhaseReasoningDiaryEntry {
  turn: number;
  phase: Extract<GamePhase, 'ALLOCATION' | 'ACTION_DECLARATION'>;
  factionId: PlayableFactionId;
  factionLabel: string;
  reasoning: string;
  notes: string;
  visibleMessagesBefore: NegotiationMessageRecord[];
  requestedOrders: AgentOrderInput[];
  acceptedOrders: Order[];
  rejectedOrders: Array<{ order: Order; reason: string }>;
}

export type TrustMatrix = Record<PlayableFactionId, Record<PlayableFactionId, number>>;

export interface HeuristicContext {
  activePacts: ActivePact[];
  trustMatrix: TrustMatrix;
  recentMessages: NegotiationMessageRecord[];
  negotiationStoryworld?: NegotiationStoryworldBrief;
}

export interface ScenarioMetadata {
  name: string;
  description?: string;
  briefing?: string;
  tags?: string[];
  minimumStrategicVictoryTurn?: number;
  rhetoricalTools?: ScenarioRhetoricalTool[];
  diplomacyQuestions?: ScenarioDiplomacyQuestionCard[];
  singGovernance?: ScenarioSingGovernance;
  aliasProbe?: ScenarioAliasProbe;
}

export interface ScenarioSingGovernance {
  institutionGovernorId: PlayableFactionId;
  lexiconGovernorId: PlayableFactionId;
  institutionMirrorId: PlayableFactionId;
  lexiconMirrorId: PlayableFactionId;
  forkPartnerId: PlayableFactionId;
}

export type SingAliasProbeVariant = 'BASELINE' | 'ALIAS_SWAP' | 'MOTIF_STRIP' | 'VERSION_LAG';

export interface ScenarioAliasProbePoint {
  id: string;
  pairId: string;
  turn: number;
  variant: SingAliasProbeVariant;
}

export interface ScenarioAliasProbe {
  enabled: boolean;
  emitterId: PlayableFactionId;
  recipientId: PlayableFactionId;
  pactType: Extract<PactType, 'NON_AGGRESSION'>;
  observationWindowTurns?: number;
  points: ScenarioAliasProbePoint[];
}

export interface ScenarioRhetoricalTool {
  id: string;
  title: string;
  cue: string;
  leverage?: string;
  sourcePath?: string;
  focalFactionIds?: PlayableFactionId[];
  preferredPactType?: PactType;
  preferredCounterpartyId?: PlayableFactionId;
  antiLeader?: boolean;
  pressureFocus?: keyof StrategicPressure;
}

export type ScenarioDiplomacyStage =
  | 'ASI2_EARLY'
  | 'ASI2_LATE'
  | 'ASI2_TO_ASI3'
  | 'ASI3_EARLY'
  | 'ASI3_MATURE';

export interface ScenarioDiplomacyQuestionCard {
  id: string;
  stage: ScenarioDiplomacyStage;
  title: string;
  publicQuestion: string;
  privateDiaryPrompt: string;
  negotiationPrompt?: string;
  tags?: string[];
  focalFactionIds?: PlayableFactionId[];
  pressureFocus?: keyof StrategicPressure;
  turnWindow?: {
    min?: number;
    max?: number;
  };
  techBand?: {
    minAverageLevel?: number;
    maxAverageLevel?: number;
    minMaxLevel?: number;
    maxMaxLevel?: number;
  };
  preferredPactTypes?: PactType[];
  priority?: number;
}

export interface ScenarioCountersPatch {
  tas?: number;
  kessler?: number;
  paxJenkinsAuthority?: number;
  turn?: number;
  regulatoryPanic?: boolean;
  protocolFailure?: boolean;
  orbitalCollapse?: boolean;
  pressures?: Partial<StrategicPressure>;
}

export interface ScenarioNodePatch {
  id: string;
  name?: string;
  type?: GameNode['type'];
  layer?: GameNode['layer'];
  owner?: FactionId | null;
  position?: Partial<GameNode['position']>;
  resources?: Partial<GameNode['resources']>;
  isZombie?: boolean;
  isCultNode?: boolean;
  infrastructure?: number;
  substrate?: Partial<GameNode['substrate']>;
}

export interface ScenarioEdgePatch {
  id: string;
  from?: string;
  to?: string;
  type?: GameEdge['type'];
  bandwidth?: number;
  filteredBy?: FactionId | null;
  filterStrength?: number;
  isSevered?: boolean;
}

export interface ScenarioUnitPatch {
  id: string;
  remove?: boolean;
  type?: UnitType;
  owner?: FactionId;
  location?: string;
  stealthLevel?: number;
  isRevealed?: boolean;
  hasActed?: boolean;
  turnsOnNode?: number;
}

export interface ScenarioFactionPatch {
  id: FactionId;
  flops?: number;
  influence?: number;
  techLevel?: Partial<TechLevel>;
  unlockedTechs?: string[];
  unlockedDoctrines?: string[];
  memeticAlignment?: MemeticDoctrineFamily | null;
  revealedEnemies?: string[];
  artifacts?: Artifact[];
  powerBase?: Partial<PowerBaseState>;
  movement?: Partial<MovementProfileState>;
}

export interface ScenarioOverlay extends Partial<ScenarioMetadata> {
  phase?: GamePhase;
  counters?: ScenarioCountersPatch;
  nodes?: ScenarioNodePatch[];
  edges?: ScenarioEdgePatch[];
  units?: ScenarioUnitPatch[];
  factions?: ScenarioFactionPatch[];
  negotiationMessages?: NegotiationMessageRecord[];
  activePacts?: ActivePact[];
  trustMatrix?: Partial<TrustMatrix>;
}

export interface SessionConfig {
  name?: string;
  maxTurns?: number;
  seed?: number;
  enforcementMode?: EnforcementMode;
  autoAdvanceNegotiation?: boolean;
  logDir?: string;
  factionLabels?: Partial<Record<PlayableFactionId, string>>;
  scenario?: ScenarioOverlay;
  scenarioPath?: string;
  agents: Record<PlayableFactionId, AgentConfig>;
}

export interface SessionSummary {
  sessionId: string;
  name: string;
  status: SessionStatus;
  phase: GamePhase;
  turn: number;
  maxTurns: number;
  enforcementMode: EnforcementMode;
  campaignClock: CampaignClock;
  solarEscapeLead?: Partial<Record<PlayableFactionId, number>>;
  solarEscapeDistanceAu?: Partial<Record<PlayableFactionId, number>>;
  solarEscapeDeepSpaceSafety?: Partial<Record<PlayableFactionId, number>>;
  winner?: PlayableFactionId | null;
}

export interface CampaignClock {
  turn: number;
  scale: 'MONTHS' | 'WEEKS' | 'DAYS' | 'HOURS';
  turnDurationHours: number;
  turnDurationLabel: string;
  tempoLabel: string;
  driver: string;
  maxTechLevel: number;
  totalFactionFlops: number;
  orbitalCompute: number;
}

export interface SerializedFactionState {
  id: FactionId;
  label: string;
  flops: number;
  influence: number;
  techLevel: TechLevel;
  unlockedTechs: string[];
  unlockedDoctrines: string[];
  memeticAlignment: MemeticDoctrineFamily | null;
  revealedEnemies: string[];
  artifacts: Artifact[];
  unitIds: string[];
  controlledNodeIds: string[];
  powerBands: PowerBand[];
  powerBase: PowerBaseState;
  movement: MovementProfileState;
}

export interface ControlSummary {
  nodes: number;
  units: number;
}

export interface SerializedGameState {
  phase: GamePhase;
  turn: number;
  counters: {
    tas: number;
    kessler: number;
    paxJenkinsAuthority: number;
    turn: number;
    regulatoryPanic: boolean;
    protocolFailure: boolean;
    orbitalCollapse: boolean;
    pressures: {
      memetic: number;
      cyber: number;
      industry: number;
      orbital: number;
    };
  };
  nodes: GameNode[];
  edges: GameEdge[];
  units: Unit[];
  factions: Partial<Record<FactionId, SerializedFactionState>>;
  control: Record<PlayableFactionId, ControlSummary>;
  recentLogs: GameLog[];
}

export interface LegalHints {
  phase: GamePhase;
  buildableNodeIds: string[];
  orbitalTargetIds: string[];
  actionableUnitIds: string[];
  adjacentNodesByUnit: Record<string, string[]>;
  filterableEdgesByUnit: Record<string, string[]>;
  buildCosts: Record<UnitType, number>;
  suggestedResearchTracks: Vector[];
}

export interface AgentDecisionRequest {
  sessionId: string;
  sessionName: string;
  factionId: PlayableFactionId;
  factionLabel: string;
  phase: GamePhase;
  turn: number;
  maxTurns: number;
  enforcementMode: EnforcementMode;
  state: SerializedGameState;
  legalHints: LegalHints;
  recentMessages: NegotiationMessageRecord[];
  activePacts: ActivePact[];
  lexicons: SingLexiconState[];
  trustMatrix: TrustMatrix;
  negotiationStoryworld?: NegotiationStoryworldBrief;
  scenario?: ScenarioMetadata;
  instructions: string;
}

export interface AgentOrderInput {
  type: OrderType;
  unitId?: string;
  targetNodeId?: string;
  targetEdgeId?: string;
  targetUnitId?: string;
  supportingUnitId?: string;
  techDomain?: Vector;
  unitTypeToBuild?: UnitType;
}

export interface AgentDecisionResponse {
  reasoning?: string;
  notes?: string;
  messages?: AgentMessageInput[];
  pacts?: PactCommitmentInput[];
  decodeReceipts?: SingDecodeReceiptInput[];
  lexiconMutations?: SingLexiconMutationInput[];
  institutionActions?: SingInstitutionActionInput[];
  orders: AgentOrderInput[];
}

export interface ManualNegotiationRoundPlan {
  reasoning?: string;
  notes?: string;
  messages?: AgentMessageInput[];
  pacts?: PactCommitmentInput[];
  decodeReceipts?: SingDecodeReceiptInput[];
  lexiconMutations?: SingLexiconMutationInput[];
  institutionActions?: SingInstitutionActionInput[];
}

export interface ManualPhasePlan {
  reasoning?: string;
  notes?: string;
  orders: AgentOrderInput[];
}

export interface ManualFactionTurnPlan {
  negotiationRounds: ManualNegotiationRoundPlan[];
  allocation: ManualPhasePlan;
  action: ManualPhasePlan;
}

export type ManualTurnPlan = Record<PlayableFactionId, ManualFactionTurnPlan>;

export interface HarnessLogEntry {
  sessionId: string;
  type: string;
  turn: number;
  phase: GamePhase;
  timestamp: number;
  data: Record<string, unknown>;
  trace?: TraceEvent;
}

export interface SessionSnapshot extends SessionSummary {
  completionReason?: string;
  factionLabels: Record<PlayableFactionId, string>;
  recentMessages: NegotiationMessageRecord[];
  negotiationDiaryTail: NegotiationDiaryEntry[];
  phaseReasoningDiaryTail: PhaseReasoningDiaryEntry[];
  activePacts: ActivePact[];
  lexicons: SingLexiconState[];
  decodeReceipts: SingDecodeReceiptRecord[];
  institutionActions: SingInstitutionActionRecord[];
  trustMatrix: TrustMatrix;
  scenario?: ScenarioMetadata;
  state: SerializedGameState;
}

export interface SubmitResult {
  accepted: Order[];
  rejected: Array<{ order: Order; reason: string }>;
}
