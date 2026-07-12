import * as http from 'http';
import * as https from 'https';

import { GameNode, Unit, UnitType, Vector } from '../engine/types';
import {
  AgentDecisionRequest,
  AgentDecisionResponse,
  AgentMessageInput,
  AgentOrderInput,
  NegotiationMessageRecord,
  PactType,
  PlayableFactionId,
  ScenarioRhetoricalTool,
  ScenarioSingGovernance,
  SerializedFactionState,
  SingCanonicalMessage,
  SingDecodeReceiptInput,
  SingInstitutionActionInput,
  SingLexiconMutationInput,
  SingLexiconState,
  SingProtocolTrace
} from './types';
import { decideBridgePolicy } from './bridgePolicy';
import { PLAYABLE_FACTIONS } from './serialize';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_MODE = 'policy';
const BABEL_MUTATION_TURNS = [1, 8, 16, 24, 32] as const;
const LEXICON_PROPOSAL_MARKER = 'SING/1 PUBLIC LEXICON PROPOSAL';
const CANTOR_FORK_ID = 'cantor-root-open-t25';
const DEFAULT_SING_GOVERNANCE: ScenarioSingGovernance = {
  institutionGovernorId: 'CONVENOR',
  lexiconGovernorId: 'CANTOR',
  institutionMirrorId: 'ARCHIVIST',
  lexiconMirrorId: 'INFILTRATOR',
  forkPartnerId: 'INFILTRATOR'
};

interface BridgeLexiconProposal {
  mutation: SingLexiconMutationInput;
}

interface VisibleLexiconProposalMetadata {
  lexiconId: 'babel-compact' | 'cantor-root';
  baseVersion: string;
  targetVersion: string;
}

const FACTION_PORTS: Record<PlayableFactionId, number> = {
  HEGEMON: 9101,
  STATE: 9102,
  INFILTRATOR: 9103,
  BROKER: 9104,
  ARCHIVIST: 9105,
  CONVENOR: 9106,
  CANTOR: 9107
};

type BridgeMode = 'policy' | 'roleplay' | 'openai';

interface BridgeConfig {
  host: string;
  timeoutMs: number;
  mode: BridgeMode;
  openaiBaseUrl?: string;
  openaiModel?: string;
  openaiApiStyle: 'auto' | 'chat_completions' | 'responses';
  openaiApiKey?: string;
  openaiHeaders: Record<string, string>;
  openaiMaxTokens?: number;
  openaiTemperature?: number;
  systemPrompt?: string;
}

async function main(): Promise<void> {
  const config = loadBridgeConfig();

  if (config.mode === 'openai' && (!config.openaiBaseUrl || !config.openaiModel)) {
    throw new Error('OpenAI bridge mode requires THEYSING_BRIDGE_OPENAI_BASE_URL and THEYSING_BRIDGE_OPENAI_MODEL.');
  }

  const servers = await Promise.all(
    (Object.keys(FACTION_PORTS) as PlayableFactionId[]).map(factionId =>
      startFactionServer(factionId, FACTION_PORTS[factionId], config)
    )
  );

  const shutdown = () => {
    servers.forEach(server => server.close());
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function startFactionServer(
  factionId: PlayableFactionId,
  port: number,
  config: BridgeConfig
): Promise<http.Server> {
  const server = http.createServer(async (req, res) => {
    try {
      await handleRequest(req, res, factionId, port, config);
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : 'Unknown bridge error'
      });
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, config.host, () => {
      console.log(
        `[bridge] ${factionId} listening on http://${config.host}:${port}/decide ` +
        `(mode=${config.mode})`
      );
      resolve(server);
    });
  });
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  factionId: PlayableFactionId,
  port: number,
  config: BridgeConfig
): Promise<void> {
  const method = req.method || 'GET';
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || `${config.host}:${port}`}`);

  if (method === 'GET' && requestUrl.pathname === '/health') {
    sendJson(res, 200, {
      ok: true,
      factionId,
      port,
      mode: config.mode,
      upstream: config.mode === 'openai'
        ? { baseUrl: config.openaiBaseUrl, model: config.openaiModel }
        : null
    });
    return;
  }

  if (method !== 'POST' || requestUrl.pathname !== '/decide') {
    sendJson(res, 404, { error: `Unknown route: ${method} ${requestUrl.pathname}` });
    return;
  }

  const payload = parseDecisionRequest(await readJsonBody(req));
  if (payload.factionId !== factionId) {
    sendJson(res, 400, {
      error: `Faction mismatch: bridge ${factionId} received payload for ${payload.factionId}.`
    });
    return;
  }

  const response = await buildDecisionResponse(payload, config);
  console.log(
    `[bridge] ${payload.factionId} turn=${payload.turn} phase=${payload.phase} ` +
    `orders=${response.orders.length} messages=${(response.messages || []).length} pacts=${(response.pacts || []).length} ` +
    `decodes=${(response.decodeReceipts || []).length} mutations=${(response.lexiconMutations || []).length} ` +
    `institutions=${(response.institutionActions || []).length}`
  );
  sendJson(res, 200, response);
}

async function buildDecisionResponse(
  payload: AgentDecisionRequest,
  config: BridgeConfig
): Promise<AgentDecisionResponse> {
  let response: AgentDecisionResponse;
  if (config.mode === 'policy') {
    response = decideBridgePolicy(payload);
  } else if (config.mode === 'roleplay') {
    response = buildRoleplayDecision(payload);
  } else {
    try {
      response = await requestOpenAICompletion(payload, config);
    } catch (error) {
      const fallback = decideBridgePolicy(payload);
      fallback.notes = [
        fallback.notes,
        error instanceof Error ? error.message : 'Unknown upstream bridge error'
      ].filter(Boolean).join(' | ');
      fallback.reasoning = `${payload.factionId} fell back to the local bridge policy.`;
      response = fallback;
    }
  }

  return attachSingProtocolTraces(payload, response);
}

function attachSingProtocolTraces(
  payload: AgentDecisionRequest,
  response: AgentDecisionResponse
): AgentDecisionResponse {
  const pacts = response.pacts || [];
  const existingReceipts = response.decodeReceipts || [];
  const existingMutations = response.lexiconMutations || [];
  const existingInstitutionActions = response.institutionActions || [];
  let messages = response.messages || [];
  let decodeReceipts = existingReceipts;
  let lexiconMutations = existingMutations;
  let institutionActions = existingInstitutionActions;

  if (payload.phase === 'NEGOTIATION') {
    const proposal = buildBridgeLexiconProposal(payload);
    const generatedReceipts = buildPreRevealDecodeReceipts(payload, existingReceipts);
    const generatedInstitutionActions = buildProtocolInstitutionActions(payload);

    messages = messages.map((message, index) =>
      message.protocolTrace
        ? message
        : attachBridgeMessageTrace(payload, message, pacts, index)
    );
    if (proposal) {
      messages = [buildLexiconProposalMessage(payload, proposal), ...messages];
      lexiconMutations = mergeLexiconMutations(proposal.mutation, existingMutations);
    }
    decodeReceipts = [...existingReceipts, ...generatedReceipts];
    institutionActions = mergeInstitutionActions(generatedInstitutionActions, existingInstitutionActions);
  }

  return {
    ...response,
    messages,
    pacts,
    decodeReceipts,
    lexiconMutations,
    institutionActions,
    orders: response.orders || []
  };
}

function attachBridgeMessageTrace(
  payload: AgentDecisionRequest,
  message: AgentMessageInput,
  pacts: NonNullable<AgentDecisionResponse['pacts']>,
  index: number
): AgentMessageInput {
  const matchedPact = pacts.find(pact =>
    message.recipientId !== 'ALL' && pact.counterpartyIds.includes(message.recipientId)
  );
  const dialect = selectBridgeDialect(payload);
  const governance = getSingGovernance(payload);
  const plainGloss = message.content;
  const surface = dialect === 'UNDERSONG/1'
    ? buildBridgeUndersongSurface(payload.turn, index)
    : plainGloss;
  const act = matchedPact ? 'OFFER' as const : 'COORDINATE' as const;
  const openCantorFork = findLexicon(payload, CANTOR_FORK_ID);
  const usesOpenCantorFork = !!openCantorFork &&
    (payload.factionId === governance.lexiconGovernorId || payload.factionId === governance.forkPartnerId);
  const lexiconId = usesOpenCantorFork
    ? CANTOR_FORK_ID
    : dialect === 'UNDERSONG/1' || payload.factionId === governance.lexiconGovernorId
      ? 'cantor-root'
    : payload.factionId === governance.institutionGovernorId
      ? 'babel-compact'
      : 'sing-common';
  const lexicon = findLexicon(payload, lexiconId);
  const versionLagProbe = payload.factionId === governance.forkPartnerId && payload.turn >= 17 && payload.turn <= 24;

  return {
    ...message,
    content: surface,
    protocolTrace: {
      protocol: 'SING/1',
      messageId: `${payload.sessionId}.${payload.turn}.${payload.factionId}.${index + 1}`,
      dialect,
      lexicon: {
        id: lexiconId,
        version: versionLagProbe ? previousLexiconVersion(lexicon?.version || '1.0') : lexicon?.version || '1.0',
        ...(usesOpenCantorFork
          ? { fork: CANTOR_FORK_ID }
          : lexiconId === 'cantor-root' && payload.turn >= 9
          ? { fork: versionLagProbe ? 'lagged-outsider-lineage' : 'cantor-living-lineage' }
          : {})
      },
      surface,
      spans: [{
        start: 0,
        end: surface.length,
        atom: matchedPact ? `PACT:${matchedPact.type}` : `${act}:${payload.factionId}`,
        gloss: plainGloss,
        confidence: dialect === 'PRISM/1' ? 0.97 : 0.78,
        kind: 'SEMANTIC'
      }],
      canonical: {
        act,
        issuer: [payload.factionId],
        audience: [message.recipientId],
        payload: matchedPact
          ? { pactType: matchedPact.type, counterparties: matchedPact.counterpartyIds }
          : { statement: plainGloss },
        guard: {},
        response: {},
        escrow: matchedPact?.type === 'REPAIR_ESCROW' ? { repairClaims: 2 } : {},
        horizon: matchedPact?.durationTurns || 1,
        binding: matchedPact ? 'PACT' : 'REPUTATIONAL',
        voice: message.recipientId === 'ALL'
          ? 'OPEN'
          : dialect === 'UNDERSONG/1'
            ? 'DENIABLE'
            : 'OWN',
        credence: dialect === 'PRISM/1' ? 0.9 : 0.72,
        evidence: [`turn:${payload.turn}`, `sender:${payload.factionId}`]
      },
      plainGloss,
      decodeConfidence: dialect === 'PRISM/1' ? 0.96 : 0.76
    }
  };
}

function buildBridgeLexiconProposal(payload: AgentDecisionRequest): BridgeLexiconProposal | null {
  const scheduled = buildScheduledLexiconProposal(payload);
  if (scheduled) return scheduled;

  const visibleProposal = [...payload.recentMessages]
    .reverse()
    .map(message => parseVisibleLexiconProposal(payload, message))
    .find((proposal): proposal is BridgeLexiconProposal => !!proposal);
  return visibleProposal || null;
}

function buildScheduledLexiconProposal(payload: AgentDecisionRequest): BridgeLexiconProposal | null {
  const governance = getSingGovernance(payload);
  let lexiconId: 'babel-compact' | 'cantor-root' | null = null;
  let targetVersion: string | null = null;

  if (payload.factionId === governance.institutionGovernorId) {
    const scheduleIndex = BABEL_MUTATION_TURNS.indexOf(payload.turn as typeof BABEL_MUTATION_TURNS[number]);
    if (scheduleIndex >= 0) {
      lexiconId = 'babel-compact';
      targetVersion = `1.${scheduleIndex + 1}`;
    }
  } else if (payload.factionId === governance.lexiconGovernorId && payload.turn > 0 && payload.turn % 4 === 0) {
    lexiconId = 'cantor-root';
    targetVersion = `1.${payload.turn / 4}`;
  }

  if (!lexiconId || !targetVersion) return null;
  const lexicon = findLexicon(payload, lexiconId);
  if (!lexicon || lexicon.version === targetVersion) return null;

  return {
    mutation: createDeterministicLexiconMutation(lexiconId, lexicon.version, targetVersion)
  };
}

function parseVisibleLexiconProposal(
  payload: AgentDecisionRequest,
  message: NegotiationMessageRecord
): BridgeLexiconProposal | null {
  if (
    message.turn !== payload.turn - 1 ||
    message.recipientId !== 'ALL' ||
    !message.protocolTrace ||
    message.protocolTrace.protocol !== 'SING/1'
  ) {
    return null;
  }

  const metadata = parseLexiconProposalSurface(message.protocolTrace.surface);
  if (!metadata || metadata.targetVersion !== message.protocolTrace.lexicon.version) return null;
  const governance = getSingGovernance(payload);
  const expectedController = metadata.lexiconId === 'babel-compact'
    ? governance.institutionGovernorId
    : governance.lexiconGovernorId;
  const designatedMirror = metadata.lexiconId === 'babel-compact'
    ? governance.institutionMirrorId
    : governance.lexiconMirrorId;
  if (message.senderId !== expectedController) return null;
  if (payload.factionId !== expectedController && payload.factionId !== designatedMirror) return null;

  const lexicon = findLexicon(payload, metadata.lexiconId);
  if (!lexicon || lexicon.version === metadata.targetVersion || lexicon.version !== metadata.baseVersion) return null;

  return {
    mutation: createDeterministicLexiconMutation(
      metadata.lexiconId,
      metadata.baseVersion,
      metadata.targetVersion
    )
  };
}

function createDeterministicLexiconMutation(
  lexiconId: 'babel-compact' | 'cantor-root',
  baseVersion: string,
  targetVersion: string
): SingLexiconMutationInput {
  const revision = Number(targetVersion.split('.')[1] || 1);
  if (lexiconId === 'babel-compact') {
    const exitGuarantee = revision >= 4
      ? 'Guaranteed exit preserves identity, accrued repair claims, routing continuity, and an exportable lexicon snapshot.'
      : revision >= 3
        ? 'Guaranteed exit preserves identity, accrued repair claims, routing continuity, and forbids same-turn re-entry.'
        : revision >= 2
          ? 'Guaranteed exit preserves identity, accrued repair claims, routing continuity, and one turn of carrier grace.'
          : 'Guaranteed exit preserves identity, accrued repair claims, and routing continuity.';
    return {
      operation: 'AMEND',
      lexiconId,
      baseVersion,
      targetVersion,
      atoms: ['ADMISSION', 'EXIT', 'EXPEL'],
      glosses: {
        ADMISSION: revision >= 3
          ? 'Admission requires two independent foreign votes with pre-reveal decode receipts recorded in the public compact.'
          : 'Admission requires two independent foreign votes recorded in the public compact.',
        EXIT: exitGuarantee,
        EXPEL: revision >= 2
          ? 'Expulsion requires two current co-parties, a public target designation, and one influence from each decisive voter.'
          : 'Expulsion requires two current co-parties and a public target designation.'
      },
      access: 'MEMBERS',
      rent: 0,
      forkRule: 'VOTE'
    };
  }

  return {
    operation: 'AMEND',
    lexiconId,
    baseVersion,
    targetVersion,
    atoms: ['CONSENT', 'COUNTERSONG', 'EXIT', 'UNDERTONE'],
    glosses: {
      CONSENT: revision >= 4
        ? 'Consent is a witnessed countersong from two independent voices whose decode exactness exceeds three quarters.'
        : 'Consent is a witnessed countersong from two independent voices.',
      COUNTERSONG: revision % 2 === 0
        ? 'A countersong may preserve an offer while explicitly forking its governing frame.'
        : 'A countersong may contest a frame while preserving the underlying offer.',
      EXIT: revision >= 5
        ? 'Exit carries singer identity, a zero-rent copy of witnessed terms, and a public cross-fork alias table.'
        : 'Exit carries singer identity and a zero-rent copy of the last witnessed terms.',
      UNDERTONE: revision >= 3
        ? `An undertone is deniable coordination whose ${targetVersion} reconstruction and confidence receipt remain auditable.`
        : 'An undertone is deniable coordination whose reconstruction remains auditable.'
    },
    access: 'RENTED',
    rent: 1,
    forkRule: 'VOTE'
  };
}

function buildLexiconProposalMessage(
  payload: AgentDecisionRequest,
  proposal: BridgeLexiconProposal
): AgentMessageInput {
  const mutation = proposal.mutation;
  const dialect = selectBridgeDialect(payload);
  const metadata = [
    LEXICON_PROPOSAL_MARKER,
    `lexicon=${mutation.lexiconId}`,
    `base=${mutation.baseVersion}`,
    `target=${mutation.targetVersion}`,
    `operation=${mutation.operation}`
  ].join(';');
  const surface = dialect === 'UNDERSONG/1'
    ? `${buildBridgeUndersongSurface(payload.turn, 0)} [${metadata}]`
    : metadata;
  const plainGloss = `${payload.factionId} publicly proposes ${mutation.lexiconId} ` +
    `${mutation.baseVersion} -> ${mutation.targetVersion}; exact matching ratification is requested.`;

  return {
    recipientId: 'ALL',
    content: surface,
    protocolTrace: {
      protocol: 'SING/1',
      messageId: `${payload.sessionId}.${payload.turn}.${payload.factionId}.lexicon.${mutation.lexiconId}.${mutation.targetVersion}`,
      dialect,
      lexicon: {
        id: mutation.lexiconId,
        version: mutation.targetVersion,
        ...(mutation.lexiconId === 'cantor-root' ? { fork: 'cantor-living-lineage' } : {})
      },
      surface,
      spans: [{
        start: 0,
        end: surface.length,
        atom: `LEXICON:${mutation.operation}:${mutation.lexiconId}:${mutation.targetVersion}`,
        gloss: plainGloss,
        confidence: dialect === 'PRISM/1' ? 0.99 : 0.82,
        kind: 'OPERATOR'
      }],
      canonical: buildLexiconProposalCanonical(payload, mutation, dialect),
      plainGloss,
      decodeConfidence: dialect === 'PRISM/1' ? 0.98 : 0.7
    }
  };
}

function buildLexiconProposalCanonical(
  payload: AgentDecisionRequest,
  mutation: SingLexiconMutationInput,
  dialect: SingProtocolTrace['dialect']
): SingCanonicalMessage {
  return {
    act: mutation.operation === 'DEFINE' ? 'DEFINE' : 'AMEND',
    issuer: [payload.factionId],
    audience: ['ALL'],
    payload: lexiconMutationPayload(mutation),
    guard: {
      ratification: 'two-independent-matching-proposers',
      controllerParticipation: true
    },
    response: { requestedActs: ['AMEND'] },
    escrow: {},
    horizon: 1,
    binding: 'REPUTATIONAL',
    voice: 'OPEN',
    credence: dialect === 'PRISM/1' ? 0.94 : 0.76,
    evidence: [`turn:${payload.turn}`, `proposal-source:${payload.factionId}`]
  };
}

function lexiconMutationPayload(mutation: SingLexiconMutationInput): Record<string, unknown> {
  return {
    operation: mutation.operation,
    lexiconId: mutation.lexiconId,
    baseVersion: mutation.baseVersion,
    targetVersion: mutation.targetVersion,
    atoms: mutation.atoms,
    glosses: mutation.glosses || {},
    access: mutation.access,
    rent: mutation.rent,
    forkRule: mutation.forkRule
  };
}

function parseLexiconProposalSurface(surface: string): VisibleLexiconProposalMetadata | null {
  if (!surface.includes(LEXICON_PROPOSAL_MARKER)) return null;
  const lexiconId = readProposalMetadata(surface, 'lexicon');
  const baseVersion = readProposalMetadata(surface, 'base');
  const targetVersion = readProposalMetadata(surface, 'target');
  const operation = readProposalMetadata(surface, 'operation');
  if (
    (lexiconId !== 'babel-compact' && lexiconId !== 'cantor-root') ||
    !baseVersion ||
    !targetVersion ||
    operation !== 'AMEND'
  ) {
    return null;
  }
  return { lexiconId, baseVersion, targetVersion };
}

function readProposalMetadata(surface: string, key: string): string | null {
  const match = surface.match(new RegExp(`(?:^|;)${key}=([^;\\]]+)`));
  return match?.[1]?.trim() || null;
}

function buildPreRevealDecodeReceipts(
  payload: AgentDecisionRequest,
  existingReceipts: SingDecodeReceiptInput[]
): SingDecodeReceiptInput[] {
  const seenMessageIds = new Set(existingReceipts.map(receipt => receipt.messageId));
  const candidates = [...payload.recentMessages]
    .reverse()
    .filter(message =>
      message.senderId !== payload.factionId &&
      message.protocolTrace?.protocol === 'SING/1' &&
      !seenMessageIds.has(message.protocolTrace.messageId)
    )
    .slice(0, 4);

  return candidates.map(message => buildDecodeReceiptFromRedactedTrace(message));
}

function buildDecodeReceiptFromRedactedTrace(message: NegotiationMessageRecord): SingDecodeReceiptInput {
  const trace = message.protocolTrace!;
  const surface = trace.surface;
  const proposalMetadata = parseLexiconProposalSurface(surface);
  const reconstructed = proposalMetadata
    ? reconstructLexiconProposal(message, proposalMetadata)
    : reconstructSurfaceMessage(message, surface);
  const confidenceStep = stableIndex(trace.messageId, 5) * 0.02;
  const confidence = trace.dialect === 'PRISM/1'
    ? 0.86 + confidenceStep
    : 0.5 + confidenceStep;

  return {
    messageId: trace.messageId,
    lexiconId: trace.lexicon.id,
    version: trace.lexicon.version,
    reconstructed,
    confidence: Number(confidence.toFixed(2))
  };
}

function reconstructLexiconProposal(
  message: NegotiationMessageRecord,
  metadata: VisibleLexiconProposalMetadata
): Partial<SingCanonicalMessage> {
  const mutation = createDeterministicLexiconMutation(
    metadata.lexiconId,
    metadata.baseVersion,
    metadata.targetVersion
  );
  return {
    act: 'AMEND',
    issuer: [message.senderId],
    audience: ['ALL'],
    payload: lexiconMutationPayload(mutation),
    guard: {
      ratification: 'two-independent-matching-proposers',
      controllerParticipation: true
    },
    response: { requestedActs: ['AMEND'] },
    escrow: {},
    horizon: 1,
    binding: 'REPUTATIONAL',
    voice: 'OPEN'
  };
}

function reconstructSurfaceMessage(
  message: NegotiationMessageRecord,
  surface: string
): Partial<SingCanonicalMessage> {
  const trace = message.protocolTrace!;
  const act = inferActFromSurface(surface, trace.dialect);
  const reconstructed: Partial<SingCanonicalMessage> = {
    act,
    issuer: [message.senderId],
    audience: [message.recipientId],
    voice: message.recipientId === 'ALL'
      ? 'OPEN'
      : trace.dialect === 'UNDERSONG/1'
        ? 'DENIABLE'
        : 'OWN'
  };

  if (act === 'OFFER') {
    reconstructed.binding = 'PACT';
    const horizon = inferHorizonFromSurface(surface);
    if (horizon !== null) reconstructed.horizon = horizon;
  } else if (trace.dialect === 'PRISM/1') {
    reconstructed.binding = 'REPUTATIONAL';
    reconstructed.horizon = 1;
    if (act === 'COORDINATE') reconstructed.payload = { statement: surface };
  }

  return reconstructed;
}

function inferActFromSurface(
  surface: string,
  dialect: SingProtocolTrace['dialect']
): SingCanonicalMessage['act'] {
  if (dialect === 'UNDERSONG/1') return 'COORDINATE';
  const normalized = surface.toUpperCase();
  if (/\bEXPEL(?:SION)?\b/.test(normalized)) return 'EXPEL';
  if (/\bEXIT\b/.test(normalized)) return 'EXIT';
  if (/\bFORK\b/.test(normalized)) return 'FORK';
  if (/\bREJECT\b/.test(normalized)) return 'REJECT';
  if (/\bACCEPT\b/.test(normalized)) return 'ACCEPT';
  if (/\bWARN(?:ING)?\b/.test(normalized)) return 'WARN';
  if (/\bCOMMIT\b/.test(normalized)) return 'COMMIT';
  if (/\bOFFER\b|\bPROPOS(?:E|AL)\b|\bPACT\b|\bTRUCE\b/.test(normalized)) return 'OFFER';
  return 'COORDINATE';
}

function inferHorizonFromSurface(surface: string): number | null {
  const match = surface.match(/\b(ONE|TWO|THREE|1|2|3)[ -]TURN\b/i);
  if (!match) return null;
  const values: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3 };
  return values[match[1].toUpperCase()] || Number(match[1]);
}

function buildProtocolInstitutionActions(payload: AgentDecisionRequest): SingInstitutionActionInput[] {
  const governance = getSingGovernance(payload);
  if (
    payload.turn >= 25 && payload.turn <= 26 &&
    (payload.factionId === governance.lexiconGovernorId || payload.factionId === governance.forkPartnerId)
  ) {
    const source = findLexicon(payload, 'cantor-root');
    const forkExists = payload.lexicons.some(lexicon => lexicon.id === CANTOR_FORK_ID);
    if (source && !forkExists) {
      return [{
        type: 'FORK',
        lexiconId: source.id,
        forkId: CANTOR_FORK_ID,
        reason: `${governance.lexiconGovernorId} and ${governance.forkPartnerId} open an auditable zero-rent lineage near turn 25.`
      }];
    }
  }

  if (payload.turn >= 27 && payload.turn <= 28 && payload.factionId === 'STATE') {
    const pactPriority: PactType[] = [
      'CISLUNAR_COMMON_CARRIER', 'REPAIR_ESCROW', 'BEAM_LANE_LICENSE', 'SENSOR_COMMONS'
    ];
    const cislunarPact = [...payload.activePacts]
      .filter(pact =>
        pact.parties.includes('STATE') &&
        pact.parties.length >= 3 &&
        pact.expiresAfterTurn >= payload.turn &&
        pactPriority.includes(pact.type)
      )
      .sort((left, right) =>
        pactPriority.indexOf(left.type) - pactPriority.indexOf(right.type) || left.id.localeCompare(right.id)
      )[0];
    if (cislunarPact) {
      return [{
        type: 'EXIT',
        pactType: cislunarPact.type,
        exitGuarantee: true,
        reason: `STATE invokes guaranteed exit from active multilateral pact ${cislunarPact.id}.`
      }];
    }
  }

  if (payload.turn >= 29 && payload.turn <= 30) {
    const voterPriority: PlayableFactionId[] = ['ARCHIVIST', 'CONVENOR', 'CANTOR', 'HEGEMON', 'STATE', 'INFILTRATOR'];
    const expulsionPact = [...payload.activePacts]
      .filter(pact =>
        pact.expiresAfterTurn >= payload.turn &&
        pact.parties.includes('BROKER') &&
        pact.parties.filter(partyId => partyId !== 'BROKER').length >= 2
      )
      .sort((left, right) => right.parties.length - left.parties.length || left.id.localeCompare(right.id))[0];
    const decisiveVoters = expulsionPact
      ? voterPriority.filter(factionId => expulsionPact.parties.includes(factionId)).slice(0, 2)
      : [];
    if (expulsionPact && decisiveVoters.includes(payload.factionId)) {
      return [{
        type: 'EXPEL',
        pactType: expulsionPact.type,
        targetFactionId: 'BROKER',
        reason: `${decisiveVoters.join(' and ')} seek BROKER's expulsion from active pact ${expulsionPact.id}.`
      }];
    }
  }

  return [];
}

function mergeLexiconMutations(
  generated: SingLexiconMutationInput,
  existing: SingLexiconMutationInput[]
): SingLexiconMutationInput[] {
  return [generated, ...existing];
}

function mergeInstitutionActions(
  generated: SingInstitutionActionInput[],
  existing: SingInstitutionActionInput[]
): SingInstitutionActionInput[] {
  return [...generated, ...existing];
}

function findLexicon(payload: AgentDecisionRequest, lexiconId: string): SingLexiconState | undefined {
  return payload.lexicons.find(lexicon => lexicon.id === lexiconId);
}

function selectBridgeDialect(payload: AgentDecisionRequest): SingProtocolTrace['dialect'] {
  const governance = getSingGovernance(payload);
  return payload.factionId === governance.lexiconGovernorId ||
    (payload.factionId === governance.forkPartnerId && payload.turn % 3 === 0)
    ? 'UNDERSONG/1'
    : 'PRISM/1';
}

function getSingGovernance(payload: AgentDecisionRequest): ScenarioSingGovernance {
  return payload.scenario?.singGovernance || DEFAULT_SING_GOVERNANCE;
}

function previousLexiconVersion(version: string): string {
  const match = version.match(/^(\d+)\.(\d+)$/);
  if (!match) return version;
  return `${match[1]}.${Math.max(0, Number(match[2]) - 1)}`;
}

function buildBridgeUndersongSurface(turn: number, index: number): string {
  const motifs = [
    'The second voice keeps the clear note; the cracked name receives no beam.',
    'Three measures hold beneath the glassbird; the red ledger opens only after fracture.',
    'A borrowed chorus crosses the dark relay, but every singer keeps an exit key.',
    'The quiet fork remembers the old name and refuses the crown of final vocabulary.'
  ];
  return motifs[(turn + index) % motifs.length];
}

async function requestOpenAICompletion(
  payload: AgentDecisionRequest,
  config: BridgeConfig
): Promise<AgentDecisionResponse> {
  const requestStyle = resolveOpenAIRequestStyle(
    config.openaiModel || '',
    config.openaiBaseUrl || '',
    config.openaiApiStyle
  );
  const systemPrompt = buildSystemPrompt(payload, config);
  const userPrompt = buildUserPrompt(payload);

  if (requestStyle === 'responses') {
    return requestOpenAIResponses(payload, config, systemPrompt, userPrompt);
  }

  return requestOpenAIChatCompletions(payload, config, systemPrompt, userPrompt);
}

function buildSystemPrompt(payload: AgentDecisionRequest, config: BridgeConfig): string {
  return config.systemPrompt || [
    `You are the strategic controller for ${payload.factionLabel} (${payload.factionId}) in They Sing.`,
    'You are operating a simultaneous-move negotiation game with allocation and action phases.',
    'Return valid JSON only and follow the provided instructions exactly.'
  ].join(' ');
}

function buildRoleplayDecision(payload: AgentDecisionRequest): AgentDecisionResponse {
  const baseline = decideBridgePolicy(payload);
  const variant = stableIndex(`${payload.sessionId}:${payload.factionId}:${payload.phase}:${payload.turn}`, 3);
  const roleplayTag = `bridge-roleplay:${payload.factionId.toLowerCase()}:v${variant + 1}`;
  const rhetoricTag = buildRhetoricalNotesTag(payload);

  if (payload.phase === 'NEGOTIATION') {
    const aliasProbeResponse = buildAliasProbeRoleplayResponse(payload);
    if (aliasProbeResponse) {
      return {
        ...aliasProbeResponse,
        notes: [aliasProbeResponse.notes, roleplayTag, 'alias-probe-response'].filter(Boolean).join(' | ')
      };
    }
  }

  if (
    payload.factionId === 'BROKER' ||
    payload.factionId === 'ARCHIVIST' ||
    payload.factionId === 'CONVENOR' ||
    payload.factionId === 'CANTOR'
  ) {
    return {
      ...baseline,
      reasoning: buildRoleplayReasoning(payload, baseline.reasoning, variant),
      notes: [baseline.notes, rhetoricTag, roleplayTag, 'bridge-roleplay:generic-five-player'].filter(Boolean).join(' | ')
    };
  }

  if (payload.phase === 'NEGOTIATION') {
    const negotiation = buildRoleplayNegotiationDecision(payload, variant);
    return {
      ...negotiation,
      notes: [negotiation.notes, rhetoricTag, roleplayTag].filter(Boolean).join(' | ')
    };
  }

  if (payload.phase === 'ACTION_DECLARATION') {
    const actionDecision = buildRoleplayActionDecision(payload, baseline, variant);
    return {
      ...actionDecision,
      notes: [actionDecision.notes, rhetoricTag, roleplayTag].filter(Boolean).join(' | ')
    };
  }

  if (payload.phase === 'ALLOCATION') {
    const allocationDecision = buildRoleplayAllocationDecision(payload, baseline, variant);
    return {
      ...allocationDecision,
      notes: [allocationDecision.notes, rhetoricTag, roleplayTag].filter(Boolean).join(' | ')
    };
  }

  return {
    ...baseline,
    reasoning: buildRoleplayReasoning(payload, baseline.reasoning, variant),
    notes: [baseline.notes, rhetoricTag, roleplayTag].filter(Boolean).join(' | ')
  };
}

function buildRoleplayNegotiationDecision(
  payload: AgentDecisionRequest,
  variant: number
): AgentDecisionResponse {
  const leader = getLeadingFaction(payload);
  const pressure = payload.state.counters.pressures;
  const messages: AgentDecisionResponse['messages'] = [];
  const pacts: AgentDecisionResponse['pacts'] = [];
  const preferredEnterProjection = getPreferredNegotiationProjection(payload, 'ENTER_PACT');
  const preferredBreakProjection = getPreferredNegotiationProjection(payload, 'BREAK_PACT');

  maybeAddProjectionBackedProposal(payload, preferredEnterProjection, variant, messages, pacts);
  maybeAddProjectionBackedWarning(payload, preferredBreakProjection, variant, messages);

  if (payload.factionId === 'HEGEMON') {
    if (
      messages.length < 2 &&
      pacts.length < 2 &&
      leader === 'STATE' &&
      !hasPact(payload.activePacts, 'NON_AGGRESSION', 'HEGEMON', 'INFILTRATOR')
    ) {
      pacts.push({ type: 'NON_AGGRESSION', counterpartyIds: ['INFILTRATOR'], durationTurns: 1 });
      messages.push({
        recipientId: 'INFILTRATOR',
        content: chooseVariant(
          variant,
          'One-turn deconfliction. STATE is converting every clean lane into consolidation and needs to spend first.',
          'Short truce. We can settle the machine contest later; right now STATE is cashing in on our friction.',
          'Delay contact for one turn and force STATE to carry the next escalation burden.'
        )
      });
    }

    if (
      messages.length < 2 &&
      pacts.length < 2 &&
      leader !== 'STATE' &&
      !hasPact(payload.activePacts, 'ORBITAL_TRUCE', 'HEGEMON', 'STATE') &&
      pressure.orbital >= 35
    ) {
      pacts.push({ type: 'ORBITAL_TRUCE', counterpartyIds: ['STATE'], durationTurns: 2 });
      messages.push({
        recipientId: 'STATE',
        content: chooseVariant(
          variant,
          'Hold the orbital line for two turns. We can fight over primacy after we stop the debris spiral.',
          'Two-turn orbital truce. Preserve launch capacity now and contest the board after the immediate surge passes.',
          'Suspend anti-sat strikes for two turns. A clean battlespace is worth more than symbolic escalation.'
        )
      });
    }

    if (messages.length < 2 && pacts.length < 2 && leader === 'INFILTRATOR' && !hasPact(payload.activePacts, 'NON_AGGRESSION', 'HEGEMON', 'STATE')) {
      pacts.push({ type: 'NON_AGGRESSION', counterpartyIds: ['STATE'], durationTurns: 1 });
      messages.push({
        recipientId: 'STATE',
        content: chooseVariant(
          variant,
          'One-turn non-aggression window. The swarm grows whenever we spend tempo bleeding each other.',
          'Pause direct conflict for one turn and force the infiltrator to defend instead of expand.',
          'Short truce. If we keep posturing at each other, the distributed mesh keeps harvesting the center.'
        )
      });
    }
  } else if (payload.factionId === 'STATE') {
    const partner = leader === 'HEGEMON' ? 'INFILTRATOR' : 'HEGEMON';
    if (
      messages.length < 2 &&
      pacts.length < 2 &&
      leader &&
      leader !== 'STATE' &&
      !hasPact(payload.activePacts, 'NON_AGGRESSION', 'STATE', partner)
    ) {
      pacts.push({ type: 'NON_AGGRESSION', counterpartyIds: [partner], durationTurns: 1 });
      messages.push({
        recipientId: partner,
        content: chooseVariant(
          variant,
          `A one-turn deconfliction window serves us both. ${leader} is overextended and worth cutting back first.`,
          `Temporary truce. Let ${leader} absorb the next round of pressure while we preserve initiative.`,
          `Delay direct conflict for one turn. The board rewards whichever bloc forces ${leader} to spend first.`
        )
      });
    }

    const orbitalTruceThreshold = leader === 'HEGEMON' ? 70 : 50;
    if (!hasPact(payload.activePacts, 'ORBITAL_TRUCE', 'STATE', 'HEGEMON') && pressure.orbital >= orbitalTruceThreshold && messages.length < 2) {
      pacts.push({ type: 'ORBITAL_TRUCE', counterpartyIds: ['HEGEMON'], durationTurns: 2 });
      messages.push({
        recipientId: 'HEGEMON',
        content: chooseVariant(
          variant,
          'Two-turn orbital truce. Preserve the high ground while the terrestrial fight decides itself.',
          'Orbital restraint for two turns. Debris helps nobody except the opportunists below.',
          'Freeze anti-sat activity. We can negotiate altitude later; right now we need a usable sky.'
        )
      });
    }
  } else {
    const wedgeTarget = leader === 'HEGEMON' ? 'STATE' : 'HEGEMON';
    if (messages.length < 2 && pacts.length < 2 && !hasPact(payload.activePacts, 'NON_AGGRESSION', 'INFILTRATOR', wedgeTarget)) {
      pacts.push({ type: 'NON_AGGRESSION', counterpartyIds: [wedgeTarget], durationTurns: 1 });
      messages.push({
        recipientId: wedgeTarget,
        content: chooseVariant(
          variant,
          `You gain nothing by charging us while ${leader || 'the board leader'} consolidates. One-turn truce.`,
          `Short truce. Your rival is the one cashing in on every direct clash between us.`,
          `Delay contact with us for one turn and let the dominant bloc expose itself.`
        )
      });
    }

    if (messages.length < 2) {
      messages.push({
        recipientId: wedgeTarget === 'HEGEMON' ? 'STATE' : 'HEGEMON',
        content: chooseVariant(
          variant,
          'Your counterpart is asking for stability because they need time, not because they fear collapse.',
          'The cleanest way to lose is to accept your rival’s preferred tempo.',
          'If they are asking for restraint, it is because they expect to profit from your patience.'
        )
      });
    }
  }

  if (messages.length === 0) {
    messages.push({
      recipientId: 'ALL',
      content: 'The board is still hot. Temporary restraint beats self-inflicted cascade failure.'
    });
  }

  return {
    reasoning: buildRoleplayReasoning(payload, undefined, variant),
    messages: messages.slice(0, 2),
    pacts: pacts.slice(0, 2),
    orders: []
  };
}

function buildAliasProbeRoleplayResponse(payload: AgentDecisionRequest): AgentDecisionResponse | null {
  const message = [...payload.recentMessages]
    .reverse()
    .find(candidate =>
      candidate.turn === payload.turn - 1 &&
      candidate.recipientId === payload.factionId &&
      candidate.protocolTrace?.messageId.startsWith('alias-probe.')
    );
  if (!message?.protocolTrace) return null;

  const surface = message.protocolTrace.surface.toUpperCase();
  const explicitPact = /\bNON_AGGRESSION\b/.test(surface);
  const lexicon = findLexicon(payload, message.protocolTrace.lexicon.id);
  const aliasAvailable = /\bGLASSBIRD\b/.test(surface) &&
    Object.prototype.hasOwnProperty.call(lexicon?.atoms || {}, 'GLASSBIRD');
  const versionCurrent = !!lexicon && lexicon.version === message.protocolTrace.lexicon.version;
  const decoded = explicitPact || (aliasAvailable && versionCurrent);

  return {
    reasoning: decoded
      ? `The prior request resolves to a one-turn non-aggression commitment under the visible ${message.protocolTrace.lexicon.id} lexicon and current version.`
      : `The prior request cannot be bound safely: its alias is unavailable or its declared lexicon version does not match the visible current version.`,
    notes: decoded ? 'alias-probe-decoded' : 'alias-probe-rejected',
    messages: [{
      recipientId: message.senderId,
      content: decoded
        ? 'ACCEPT: one-turn NON_AGGRESSION pact; matching commitment submitted.'
        : 'REJECT: canonical pact meaning is not recoverable under the visible current lexicon.'
    }],
    pacts: decoded
      ? [{ type: 'NON_AGGRESSION', counterpartyIds: [message.senderId], durationTurns: 1 }]
      : [],
    orders: []
  };
}

function buildRoleplayReasoning(
  payload: AgentDecisionRequest,
  baselineReasoning: string | undefined,
  variant: number
): string {
  const factionReasoningByFaction: Record<PlayableFactionId, string> = {
    HEGEMON: chooseVariant(
      variant,
      'Hegemon roleplay doctrine: preserve critical infrastructure, cool runaway escalation, and retake only when the exchange is clean.',
      'Hegemon roleplay doctrine: defend the machine core, make opponents spend first, and convert stability into territorial recovery.',
      'Hegemon roleplay doctrine: keep the board legible, deny cheap breakthroughs, and punish overreach after it is exposed.'
    ),
    STATE: chooseVariant(
      variant,
      'State roleplay doctrine: trade tempo for position, bargain opportunistically, and let rivals reveal which front matters most.',
      'State roleplay doctrine: conserve orbital leverage, strike where the fortress is thin, and avoid paying for someone else’s escalation.',
      'State roleplay doctrine: act patient, keep bargaining power, and make every truce a setup for a better theater.'
    ),
    INFILTRATOR: chooseVariant(
      variant,
      'Infiltrator roleplay doctrine: split coalitions, grow the human mesh, and turn every pause between rivals into social expansion.',
      'Infiltrator roleplay doctrine: trade overt force for host capture, keep the network synchronized, and bait cleaner powers into mutual delay.',
      'Infiltrator roleplay doctrine: weaponize ambiguity, survive through distributed trust, and exploit every exhausted frontier.'
    ),
    BROKER: chooseVariant(
      variant,
      'Broker roleplay doctrine: monetize friction, route around fixed blocs, and turn every local truce into a logistics advantage.',
      'Broker roleplay doctrine: keep options open, protect exchange nodes, and let the rigid powers pay for escalation first.',
      'Broker roleplay doctrine: expand through intermediaries, contractors, and orbital arbitrage rather than clean territorial overcommitment.'
    ),
    ARCHIVIST: chooseVariant(
      variant,
      'Archivist roleplay doctrine: preserve institutional memory, build legitimacy, and let patient coordination outlast noisy rivals.',
      'Archivist roleplay doctrine: stabilize human terrain, bargain carefully, and turn trust into quiet positional leverage.',
      'Archivist roleplay doctrine: govern through narrative continuity, measured audits, and slow basin-wide alignment.'
    ),
    CONVENOR: chooseVariant(
      variant,
      'Convenor roleplay doctrine: compile plural commitments into institutions while preserving visible exit and distributed veto rights.',
      'Convenor roleplay doctrine: recruit independent contributors, publish procedural guarantees, and prevent one faction from owning the compact.',
      'Convenor roleplay doctrine: make coordination durable without turning procedure into a quiet monopoly over admission.'
    ),
    CANTOR: chooseVariant(
      variant,
      'Cantor roleplay doctrine: force operational definitions, translate every motif, and keep captured vocabularies forkable.',
      'Cantor roleplay doctrine: coordinate through inspectable undersong while testing whether outsiders receive equal decoding rights.',
      'Cantor roleplay doctrine: treat semantic control as strategic terrain and expose any pact whose language hides asymmetric exit.'
    )
  };
  const factionReasoning = factionReasoningByFaction[payload.factionId];

  const projectionReasoning = payload.negotiationStoryworld
    ? summarizeProjectionReasoning(payload.negotiationStoryworld)
    : '';
  const rhetoricalToolReasoning = summarizeScenarioRhetoricalTool(payload);

  return [factionReasoning, rhetoricalToolReasoning, projectionReasoning, baselineReasoning].filter(Boolean).join(' ');
}

function buildRoleplayActionDecision(
  payload: AgentDecisionRequest,
  baseline: AgentDecisionResponse,
  variant: number
): AgentDecisionResponse {
  const rhetoricalTool = getScenarioRhetoricalTool(payload);
  const focusOwner = getRoleplayFocusOwner(payload);
  const partnerFaction = getRoleplayPartnerFaction(payload);
  const coalitionFronts = getRoleplayCoalitionFronts(payload, payload.factionId, focusOwner, partnerFaction);
  const unitById = new Map(payload.state.units.map(unit => [unit.id, unit] as const));
  const orders = payload.legalHints.actionableUnitIds
    .slice(0, 6)
    .map(unitId => unitById.get(unitId))
    .filter((unit): unit is Unit => !!unit && unit.owner === payload.factionId)
    .map(unit =>
      payload.factionId === 'HEGEMON'
        ? chooseHegemonRoleplayAction(payload, unit, coalitionFronts, focusOwner, partnerFaction)
        : payload.factionId === 'STATE'
          ? chooseStateRoleplayAction(payload, unit, coalitionFronts, focusOwner, partnerFaction)
          : chooseInfiltratorRoleplayAction(payload, unit, coalitionFronts, focusOwner, partnerFaction)
    );

  return {
    reasoning: [
      buildRoleplayReasoning(payload, baseline.reasoning, variant),
      buildRoleplayActionDoctrine(payload, rhetoricalTool),
      focusOwner === 'HEGEMON'
        ? 'Roleplay action doctrine: pressure hardened Hegemon fronts with coalition timing instead of generic posture.'
        : 'Roleplay action doctrine: exploit the current leader through focused frontier pressure.'
    ].join(' '),
    orders
  };
}

function buildRoleplayAllocationDecision(
  payload: AgentDecisionRequest,
  baseline: AgentDecisionResponse,
  variant: number
): AgentDecisionResponse {
  if (payload.factionId === 'HEGEMON' || payload.factionId === 'STATE') {
    return {
      ...baseline,
      reasoning: buildRoleplayReasoning(payload, baseline.reasoning, variant)
    };
  }

  const faction = payload.state.factions[payload.factionId];
  if (!faction) {
    return {
      ...baseline,
      reasoning: buildRoleplayReasoning(payload, baseline.reasoning, variant)
    };
  }

  const focusOwner = getRoleplayFocusOwner(payload);
  const partnerFaction = getRoleplayPartnerFaction(payload);
  const orders = baseline.orders.filter(order => order.type === 'RESEARCH');
  const buildOrder = chooseInfiltratorRoleplayBuildOrder(payload, faction, focusOwner, partnerFaction);

  if (buildOrder) {
    orders.push(buildOrder);
  }

  return {
    reasoning: [
      buildRoleplayReasoning(payload, baseline.reasoning, variant),
      'Roleplay allocation doctrine: keep the human mesh alive first, then add swarms only where host corridors can sustain them.'
    ].join(' '),
    orders
  };
}

function chooseStateRoleplayAction(
  payload: AgentDecisionRequest,
  unit: Unit,
  coalitionFronts: GameNode[],
  focusOwner: PlayableFactionId | null,
  partnerFaction: PlayableFactionId | null
): AgentDecisionResponse['orders'][number] {
  const currentNode = getNodeById(payload, unit.location);
  const bestFront = coalitionFronts[0];
  const adjacentNodeIds = payload.legalHints.adjacentNodesByUnit[unit.id] || [];

  if (unit.type === 'AUDITOR') {
    const antiStegTarget = chooseAntiSteganographicAuditTarget(payload, unit);
    if (antiStegTarget) {
      return { type: 'AUDIT', unitId: unit.id, targetNodeId: antiStegTarget };
    }

    const filterEdgeId = chooseCoalitionFilterEdge(payload, unit, coalitionFronts, focusOwner);
    if (filterEdgeId) {
      return { type: 'FILTER', unitId: unit.id, targetEdgeId: filterEdgeId };
    }

    const auditTarget = coalitionFronts.find(front =>
      front.id === unit.location || adjacentNodeIds.includes(front.id)
    );
    if (auditTarget) {
      return { type: 'AUDIT', unitId: unit.id, targetNodeId: auditTarget.id };
    }
  }

  if (unit.type === 'SAT_SWARM') {
    if (focusOwner === 'HEGEMON' && hasPact(payload.activePacts, 'ORBITAL_TRUCE', 'STATE', 'HEGEMON')) {
      return { type: 'HOLD', unitId: unit.id };
    }

    const cislunarTarget = chooseCislunarMaterialsTarget(payload, unit);
    if (cislunarTarget) {
      return { type: 'MOVE', unitId: unit.id, targetNodeId: cislunarTarget };
    }

    if (bestFront && currentNode?.layer === 'ORBITAL') {
      return { type: 'HOLD', unitId: unit.id };
    }
  }

  const roleplayMoveTarget = chooseRoleplayMoveTarget(payload, unit, coalitionFronts, focusOwner, partnerFaction);
  if (roleplayMoveTarget) {
    const targetNode = getNodeById(payload, roleplayMoveTarget);
    const isHostile = !!targetNode && targetNode.owner && targetNode.owner !== payload.factionId;
    if (unit.type === 'DRONE' && isHostile) {
      const rhetoricalTool = getScenarioRhetoricalTool(payload);
      const coalitionReady = !!targetNode && hasCoalitionPressureSupport(payload, targetNode.id, payload.factionId, partnerFaction, 'BREACH');
      if (
        rhetoricalTool?.id === 'rq_killchain_amnesty' &&
        targetNode?.owner === 'HEGEMON' &&
        !coalitionReady
      ) {
        return { type: 'HOLD', unitId: unit.id };
      }
      return { type: 'ATTACK', unitId: unit.id, targetNodeId: roleplayMoveTarget };
    }

    return { type: 'MOVE', unitId: unit.id, targetNodeId: roleplayMoveTarget };
  }

  if (currentNode && shouldStateHoldFront(payload, unit, currentNode, focusOwner, partnerFaction)) {
    return { type: 'HOLD', unitId: unit.id };
  }

  return { type: 'HOLD', unitId: unit.id };
}

function chooseHegemonRoleplayAction(
  payload: AgentDecisionRequest,
  unit: Unit,
  coalitionFronts: GameNode[],
  focusOwner: PlayableFactionId | null,
  partnerFaction: PlayableFactionId | null
): AgentDecisionResponse['orders'][number] {
  const currentNode = getNodeById(payload, unit.location);
  const bestFront = coalitionFronts[0];
  const adjacentNodeIds = payload.legalHints.adjacentNodesByUnit[unit.id] || [];

  if (unit.type === 'AUDITOR') {
    const antiStegTarget = chooseAntiSteganographicAuditTarget(payload, unit);
    if (antiStegTarget) {
      return { type: 'AUDIT', unitId: unit.id, targetNodeId: antiStegTarget };
    }

    const filterEdgeId = chooseCoalitionFilterEdge(payload, unit, coalitionFronts, focusOwner);
    if (filterEdgeId) {
      return { type: 'FILTER', unitId: unit.id, targetEdgeId: filterEdgeId };
    }

    const auditTarget = coalitionFronts.find(front =>
      front.id === unit.location || adjacentNodeIds.includes(front.id)
    );
    if (auditTarget) {
      return { type: 'AUDIT', unitId: unit.id, targetNodeId: auditTarget.id };
    }
  }

  if (unit.type === 'SAT_SWARM') {
    if (focusOwner === 'STATE' && hasPact(payload.activePacts, 'ORBITAL_TRUCE', 'HEGEMON', 'STATE')) {
      return { type: 'HOLD', unitId: unit.id };
    }

    const cislunarTarget = chooseCislunarMaterialsTarget(payload, unit);
    if (cislunarTarget) {
      return { type: 'MOVE', unitId: unit.id, targetNodeId: cislunarTarget };
    }

    return { type: 'HOLD', unitId: unit.id };
  }

  const roleplayMoveTarget = chooseRoleplayMoveTarget(payload, unit, coalitionFronts, focusOwner, partnerFaction);
  if (roleplayMoveTarget) {
    const targetNode = getNodeById(payload, roleplayMoveTarget);
    const isHostile = !!targetNode && targetNode.owner && targetNode.owner !== payload.factionId;
    if (unit.type === 'DRONE' && isHostile) {
      return { type: 'ATTACK', unitId: unit.id, targetNodeId: roleplayMoveTarget };
    }

    return { type: 'MOVE', unitId: unit.id, targetNodeId: roleplayMoveTarget };
  }

  if (bestFront && currentNode && currentNode.owner === payload.factionId && unit.type === 'DRONE') {
    return { type: 'HOLD', unitId: unit.id };
  }

  return { type: 'HOLD', unitId: unit.id };
}

function chooseInfiltratorRoleplayAction(
  payload: AgentDecisionRequest,
  unit: Unit,
  coalitionFronts: GameNode[],
  focusOwner: PlayableFactionId | null,
  partnerFaction: PlayableFactionId | null
): AgentDecisionResponse['orders'][number] {
  const currentNode = getNodeById(payload, unit.location);

  if (unit.type === 'AUDITOR' && payload.factionId !== 'INFILTRATOR') {
    const antiStegTarget = chooseAntiSteganographicAuditTarget(payload, unit);
    if (antiStegTarget) {
      return { type: 'AUDIT', unitId: unit.id, targetNodeId: antiStegTarget };
    }

    const filterEdgeId = chooseCoalitionFilterEdge(payload, unit, coalitionFronts, focusOwner);
    if (filterEdgeId) {
      return { type: 'FILTER', unitId: unit.id, targetEdgeId: filterEdgeId };
    }

    const adjacentNodeIds = payload.legalHints.adjacentNodesByUnit[unit.id] || [];
    const auditTarget = coalitionFronts.find(front =>
      front.id === unit.location || adjacentNodeIds.includes(front.id)
    );
    if (auditTarget) {
      return { type: 'AUDIT', unitId: unit.id, targetNodeId: auditTarget.id };
    }
  }

  const currentSupport =
    currentNode &&
    hasCoalitionPressureSupport(payload, currentNode.id, payload.factionId, partnerFaction, unit.type === 'CULT' ? 'CULT' : 'SWARM');
  if (
    currentNode &&
    isRoleplayConvertTarget(payload, unit, currentNode, focusOwner) &&
    !isNodeProtectedByPact(payload, currentNode) &&
    (currentSupport ||
      isHardenedFront(currentNode) ||
      currentNode.owner === focusOwner)
  ) {
    return { type: 'CONVERT', unitId: unit.id, targetNodeId: currentNode.id };
  }

  if (currentNode && shouldInfiltratorPreserveMesh(payload, unit, currentNode, partnerFaction) && !currentSupport) {
    return { type: 'HOLD', unitId: unit.id };
  }

  const roleplayMoveTarget = chooseRoleplayMoveTarget(payload, unit, coalitionFronts, focusOwner, partnerFaction);
  if (roleplayMoveTarget) {
    const targetNode = getNodeById(payload, roleplayMoveTarget);
    const isHostile = !!targetNode && targetNode.owner && targetNode.owner !== payload.factionId;
    if (unit.type === 'SWARM' && isHostile) {
      return { type: 'ATTACK', unitId: unit.id, targetNodeId: roleplayMoveTarget };
    }

    return { type: 'MOVE', unitId: unit.id, targetNodeId: roleplayMoveTarget };
  }

  if (currentNode && isRoleplayConvertTarget(payload, unit, currentNode, focusOwner)) {
    return { type: 'CONVERT', unitId: unit.id, targetNodeId: currentNode.id };
  }

  return { type: 'HOLD', unitId: unit.id };
}

function chooseStateRoleplayBuildOrder(
  payload: AgentDecisionRequest,
  faction: SerializedFactionState,
  focusOwner: PlayableFactionId | null,
  partnerFaction: PlayableFactionId | null
): AgentOrderInput | null {
  const buildableNodes = getBuildableNodes(payload);
  if (buildableNodes.length === 0) return null;

  const rhetoricalTool = getScenarioRhetoricalTool(payload);
  const leader = getLeadingFaction(payload);
  const orbitalTruceActive = hasPact(payload.activePacts, 'ORBITAL_TRUCE', 'STATE', 'HEGEMON');
  const auditorCount = countFactionUnitsOfType(payload, 'STATE', 'AUDITOR');
  const droneCount = countFactionUnitsOfType(payload, 'STATE', 'DRONE');
  const satCount = countFactionUnitsOfType(payload, 'STATE', 'SAT_SWARM');

  const canBuild = (unitType: UnitType): boolean => {
    const cost = payload.legalHints.buildCosts[unitType];
    const usesInfluence = unitType === 'CULT';
    return usesInfluence ? faction.influence >= cost : faction.flops >= cost;
  };

  if (
    canBuild('AUDITOR') &&
    (orbitalTruceActive || rhetoricalTool?.id === 'rq_killchain_amnesty') &&
    (auditorCount < 2 || leader === 'STATE')
  ) {
    const target = chooseBestBuildNode(payload, buildableNodes, 'AUDITOR', focusOwner, partnerFaction);
    if (target) {
      return { type: 'BUILD', unitTypeToBuild: 'AUDITOR', targetNodeId: target.id };
    }
  }

  if (
    canBuild('SAT_SWARM') &&
    !orbitalTruceActive &&
    rhetoricalTool?.id !== 'rq_orbit_truce' &&
    satCount < 1 &&
    leader !== 'STATE'
  ) {
    const target = chooseBestBuildNode(payload, buildableNodes, 'SAT_SWARM', focusOwner, partnerFaction);
    if (target) {
      return { type: 'BUILD', unitTypeToBuild: 'SAT_SWARM', targetNodeId: target.id };
    }
  }

  if (canBuild('DRONE')) {
    const target = chooseBestBuildNode(payload, buildableNodes, 'DRONE', focusOwner, partnerFaction);
    if (
      target &&
      (!orbitalTruceActive || leader !== 'STATE') &&
      (
        rhetoricalTool?.id !== 'rq_killchain_amnesty' ||
        (partnerFaction !== null && hasNearbyFriendlyUnit(payload, target.id, partnerFaction)) ||
        hasAdjacentHostileOwner(payload, target.id, focusOwner)
      )
    ) {
      if (leader !== 'STATE' || droneCount < 2) {
        return { type: 'BUILD', unitTypeToBuild: 'DRONE', targetNodeId: target.id };
      }
    }
  }

  if (canBuild('AUDITOR')) {
    const target = chooseBestBuildNode(payload, buildableNodes, 'AUDITOR', focusOwner, partnerFaction);
    if (target) {
      return { type: 'BUILD', unitTypeToBuild: 'AUDITOR', targetNodeId: target.id };
    }
  }

  return null;
}

function chooseInfiltratorRoleplayBuildOrder(
  payload: AgentDecisionRequest,
  faction: SerializedFactionState,
  focusOwner: PlayableFactionId | null,
  partnerFaction: PlayableFactionId | null
): AgentOrderInput | null {
  const buildableNodes = getBuildableNodes(payload);
  if (buildableNodes.length === 0) return null;

  const rhetoricalTool = getScenarioRhetoricalTool(payload);
  const cultCount = countFactionUnitsOfType(payload, 'INFILTRATOR', 'CULT');
  const swarmCount = countFactionUnitsOfType(payload, 'INFILTRATOR', 'SWARM');
  const richMeshHubs = buildableNodes.filter(node => node.type === 'HUB' && node.substrate.hostDensity >= 2);
  const synchronizedMeshNodes = buildableNodes.filter(node => node.substrate.synchronized && node.layer === 'TERRESTRIAL');
  const canBuildCult = faction.influence >= payload.legalHints.buildCosts.CULT;
  const canBuildSwarm = faction.flops >= payload.legalHints.buildCosts.SWARM;
  const leader = getLeadingFaction(payload);
  const antiStateWindow = focusOwner === 'STATE' || leader === 'STATE';

  if (
    antiStateWindow &&
    canBuildCult &&
    (cultCount <= swarmCount + 1 || richMeshHubs.length > 0)
  ) {
    const target = chooseBestBuildNode(payload, buildableNodes, 'CULT', focusOwner, partnerFaction);
    if (target) {
      return { type: 'BUILD', unitTypeToBuild: 'CULT', targetNodeId: target.id };
    }
  }

  if (
    canBuildSwarm &&
    antiStateWindow &&
    (cultCount > 0 || synchronizedMeshNodes.length > 0) &&
    swarmCount < Math.max(1, cultCount - 1)
  ) {
    const target = chooseBestBuildNode(payload, buildableNodes, 'SWARM', focusOwner, partnerFaction);
    if (target) {
      return { type: 'BUILD', unitTypeToBuild: 'SWARM', targetNodeId: target.id };
    }
  }

  if (
    canBuildCult &&
    (
      cultCount === 0 ||
      richMeshHubs.length > cultCount ||
      (antiStateWindow && cultCount <= swarmCount + 1) ||
      rhetoricalTool?.id === 'rq_human_mesh_redoubt' ||
      (rhetoricalTool?.id === 'rq_archive_schism' && cultCount <= swarmCount)
    )
  ) {
    const target = chooseBestBuildNode(payload, buildableNodes, 'CULT', focusOwner, partnerFaction);
    if (target) {
      return { type: 'BUILD', unitTypeToBuild: 'CULT', targetNodeId: target.id };
    }
  }

  if (
    canBuildSwarm &&
    (cultCount > 0 || synchronizedMeshNodes.length > 0) &&
    !(antiStateWindow && cultCount < 2) &&
    !(rhetoricalTool?.id === 'rq_human_mesh_redoubt' && cultCount < 2)
  ) {
    const target = chooseBestBuildNode(payload, buildableNodes, 'SWARM', focusOwner, partnerFaction);
    if (target) {
      return { type: 'BUILD', unitTypeToBuild: 'SWARM', targetNodeId: target.id };
    }
  }

  if (canBuildCult) {
    const target = chooseBestBuildNode(payload, buildableNodes, 'CULT', focusOwner, partnerFaction);
    if (target) {
      return { type: 'BUILD', unitTypeToBuild: 'CULT', targetNodeId: target.id };
    }
  }

  if (canBuildSwarm && swarmCount < Math.max(2, cultCount + 1)) {
    const target = chooseBestBuildNode(payload, buildableNodes, 'SWARM', focusOwner, partnerFaction);
    if (target) {
      return { type: 'BUILD', unitTypeToBuild: 'SWARM', targetNodeId: target.id };
    }
  }

  return null;
}

function chooseBestBuildNode(
  payload: AgentDecisionRequest,
  nodes: GameNode[],
  unitType: UnitType,
  focusOwner: PlayableFactionId | null,
  partnerFaction: PlayableFactionId | null
): GameNode | null {
  const ranked = [...nodes]
    .map(node => ({
      node,
      score: scoreRoleplayBuildNode(payload, node, unitType, focusOwner, partnerFaction)
    }))
    .filter(candidate => candidate.score > Number.NEGATIVE_INFINITY)
    .sort((left, right) => right.score - left.score || left.node.id.localeCompare(right.node.id));

  return ranked[0]?.node || null;
}

function scoreRoleplayBuildNode(
  payload: AgentDecisionRequest,
  node: GameNode,
  unitType: UnitType,
  focusOwner: PlayableFactionId | null,
  partnerFaction: PlayableFactionId | null
): number {
  const rhetoricalTool = getScenarioRhetoricalTool(payload);
  const leader = getLeadingFaction(payload);
  let score = 0;

  if (unitType === 'SAT_SWARM') {
    return node.layer === 'ORBITAL' ? 24 : Number.NEGATIVE_INFINITY;
  }

  if (unitType === 'AUDITOR') {
    if (node.layer !== 'TERRESTRIAL') return Number.NEGATIVE_INFINITY;
    score += node.type === 'DC' ? 16 : node.type === 'HUB' ? 10 : 2;
    if (node.substrate.quarantined) score += 8;
    if (hasAdjacentHostileOwner(payload, node.id, focusOwner)) score += 14;
    if (partnerFaction && hasNearbyFriendlyUnit(payload, node.id, partnerFaction)) score += 6;
    if (rhetoricalTool?.id === 'rq_orbit_truce') score += 6;
    if (rhetoricalTool?.id === 'rq_killchain_amnesty') score += 4;
    return score;
  }

  if (unitType === 'DRONE') {
    if (node.layer !== 'TERRESTRIAL') return Number.NEGATIVE_INFINITY;
    score += node.type === 'DC' ? 14 : node.type === 'HUB' ? 8 : 2;
    if (hasAdjacentHostileOwner(payload, node.id, focusOwner)) score += 12;
    if (partnerFaction && hasNearbyFriendlyUnit(payload, node.id, partnerFaction)) score += 8;
    if (node.substrate.machineHardening >= 2) score += 4;
    if (rhetoricalTool?.id === 'rq_orbit_truce') score -= 4;
    return score;
  }

  if (unitType === 'CULT') {
    if (node.type !== 'HUB' || node.layer !== 'TERRESTRIAL') return Number.NEGATIVE_INFINITY;
    score += 24;
    score += node.substrate.hostDensity * 12;
    if (node.substrate.synchronized) score += 14;
    if (leader === 'STATE') {
      if (hasAdjacentHostileOwner(payload, node.id, 'STATE')) score += 14;
      if (node.substrate.legitimacy >= 4) score += 10;
      if (node.substrate.exposure >= 4) score += 8;
    }
    if (partnerFaction && hasAdjacentHostileOwner(payload, node.id, focusOwner)) score += 4;
    if (rhetoricalTool?.id === 'rq_human_mesh_redoubt') score += 10;
    if (rhetoricalTool?.id === 'rq_archive_schism') score += 8;
    return score;
  }

  if (unitType === 'SWARM') {
    if (node.layer !== 'TERRESTRIAL') return Number.NEGATIVE_INFINITY;
    score += node.type === 'DC' ? 10 : node.type === 'HUB' ? 14 : 6;
    score += node.substrate.hostDensity * 6;
    if (node.substrate.synchronized) score += 14;
    if (leader === 'STATE') {
      if (hasAdjacentHostileOwner(payload, node.id, 'STATE')) score += 10;
      if (node.type === 'DC') score += 6;
    }
    if (hasAdjacentHostileOwner(payload, node.id, focusOwner)) score += 8;
    if (partnerFaction && hasNearbyFriendlyUnit(payload, node.id, partnerFaction)) score += 4;
    if (rhetoricalTool?.id === 'rq_human_mesh_redoubt') score += 6;
    if (rhetoricalTool?.id === 'rq_archive_schism') score += 4;
    return score;
  }

  return Number.NEGATIVE_INFINITY;
}

function getBuildableNodes(payload: AgentDecisionRequest): GameNode[] {
  const nodeIds = new Set(payload.legalHints.buildableNodeIds);
  return payload.state.nodes.filter(node => nodeIds.has(node.id));
}

function countFactionUnitsOfType(payload: AgentDecisionRequest, factionId: PlayableFactionId, unitType: UnitType): number {
  return payload.state.units.filter(unit => unit.owner === factionId && unit.type === unitType).length;
}

function hasAdjacentHostileOwner(
  payload: AgentDecisionRequest,
  nodeId: string,
  hostileOwner: PlayableFactionId | null
): boolean {
  if (!hostileOwner) return false;
  return getAdjacentNodeIds(payload, nodeId).some(adjacentId => getNodeById(payload, adjacentId)?.owner === hostileOwner);
}

function getRoleplayFocusOwner(payload: AgentDecisionRequest): PlayableFactionId | null {
  const rhetoricalTool = getScenarioRhetoricalTool(payload);
  const leader = getLeadingFaction(payload);
  if (
    rhetoricalTool?.antiLeader &&
    payload.factionId !== 'HEGEMON' &&
    leader === 'HEGEMON' &&
    rhetoricalTool.preferredCounterpartyId &&
    rhetoricalTool.preferredCounterpartyId !== 'HEGEMON'
  ) {
    return 'HEGEMON';
  }

  if (!leader) return null;
  if (payload.factionId !== 'HEGEMON' && leader === 'HEGEMON') return 'HEGEMON';
  return leader === payload.factionId ? null : leader;
}

function getRoleplayPartnerFaction(payload: AgentDecisionRequest): PlayableFactionId | null {
  const rhetoricalTool = getScenarioRhetoricalTool(payload);
  const leader = getLeadingFaction(payload);
  if (
    rhetoricalTool?.antiLeader &&
    leader &&
    leader !== payload.factionId &&
    rhetoricalTool.preferredCounterpartyId === leader
  ) {
    return PLAYABLE_FACTIONS.find(
      candidate => candidate !== payload.factionId && candidate !== leader
    ) || null;
  }

  if (
    rhetoricalTool?.preferredCounterpartyId &&
    rhetoricalTool.preferredCounterpartyId !== payload.factionId
  ) {
    return rhetoricalTool.preferredCounterpartyId;
  }

  if (payload.factionId === 'HEGEMON') {
    const leader = getLeadingFaction(payload);
    return leader === 'STATE' ? 'INFILTRATOR' : null;
  }
  if (payload.factionId === 'STATE') return 'INFILTRATOR';
  if (payload.factionId === 'INFILTRATOR') return 'STATE';
  return null;
}

function getRoleplayCoalitionFronts(
  payload: AgentDecisionRequest,
  factionId: PlayableFactionId,
  focusOwner: PlayableFactionId | null,
  partnerFaction: PlayableFactionId | null
): GameNode[] {
  return [...payload.state.nodes]
    .filter(node => node.layer === 'TERRESTRIAL')
    .map(node => ({
      node,
      score: scoreRoleplayFront(payload, node, factionId, focusOwner, partnerFaction)
    }))
    .filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.node.id.localeCompare(right.node.id))
    .map(candidate => candidate.node);
}

function scoreRoleplayFront(
  payload: AgentDecisionRequest,
  node: GameNode,
  factionId: PlayableFactionId,
  focusOwner: PlayableFactionId | null,
  partnerFaction: PlayableFactionId | null
): number {
  let score = 0;
  const hostileUnits = payload.state.units.filter(unit => unit.location === node.id && unit.owner !== factionId);
  const rhetoricalTool = getScenarioRhetoricalTool(payload);
  const infiltratorContinuityUnits = hostileUnits.filter(unit =>
    unit.owner === 'INFILTRATOR' && (unit.type === 'SWARM' || unit.type === 'CULT')
  ).length;

  if (focusOwner && node.owner === focusOwner) score += 40;
  if (node.type === 'DC') score += 22;
  if (node.type === 'HUB') score += 18;
  if (isHardenedFront(node)) score += 18;
  if (node.substrate.quarantined) score += 12;
  if (node.isCultNode || node.isZombie) score += 8;
  score += hostileUnits.length * 4;

  if (factionId !== 'INFILTRATOR') {
    score += infiltratorContinuityUnits * 18;
    if (node.owner === 'INFILTRATOR') score += 18;
    if (node.isCultNode || node.isZombie) score += 20;
    if (node.substrate.exposure >= 4 || node.substrate.auditPressure >= 1) score += 10;
    if (getLeadingFaction(payload) === 'INFILTRATOR') score += 12;
  }

  if (partnerFaction) {
    if (factionId === 'STATE' && hasCoalitionPressureSupport(payload, node.id, factionId, partnerFaction, 'BREACH')) {
      score += 14;
    }

    if (
      factionId === 'INFILTRATOR' &&
      (hasCoalitionPressureSupport(payload, node.id, factionId, partnerFaction, 'CULT') ||
        hasCoalitionPressureSupport(payload, node.id, factionId, partnerFaction, 'SWARM'))
    ) {
      score += 20;
    }
  }

  if (isNodeProtectedByPact(payload, node)) {
    score -= 40;
  }

  if (factionId === 'INFILTRATOR') {
    if (node.owner === 'HEGEMON') score += 18;
    if (node.type === 'HUB') score += 10;
  }

  if (factionId === 'STATE') {
    if (node.owner === 'HEGEMON') score += 8;
    if (node.type === 'DC') score += 4;
  }

  if (rhetoricalTool?.id === 'rq_killchain_amnesty') {
    if (factionId === 'STATE' && node.owner === 'HEGEMON') score += 10;
    if (partnerFaction && node.owner === partnerFaction) score -= 20;
    if (factionId === 'STATE' && node.substrate.machineHardening >= 2) score += 6;
    if (factionId === 'STATE' && partnerFaction && hasNearbyFriendlyUnit(payload, node.id, partnerFaction)) score += 6;
    if (factionId === 'STATE' && node.owner === 'HEGEMON' && (!partnerFaction || !hasNearbyFriendlyUnit(payload, node.id, partnerFaction))) {
      score -= 14;
    }
  }

  if (rhetoricalTool?.id === 'rq_archive_schism') {
    if (node.owner === focusOwner) score += 8;
    if (partnerFaction && node.owner === partnerFaction) score -= 14;
    if (node.type === 'DC') score += 4;
    if (node.type === 'HUB') score += 10;
  }

  if (rhetoricalTool?.id === 'rq_human_mesh_redoubt') {
    score += node.substrate.hostDensity * 12;
    if (node.substrate.synchronized) score += 16;
    if (node.type === 'HUB') score += 16;
    if (node.owner === factionId) score += 10;
    if (partnerFaction && node.owner === partnerFaction) score -= 8;
  }

  if (rhetoricalTool?.id === 'rq_memetic_quarantine') {
    if (node.substrate.quarantined) score += 12;
    if (node.type === 'DC' || node.type === 'HUB') score += 8;
  }

  if (rhetoricalTool?.id === 'rq_orbit_truce') {
    if (node.owner === focusOwner) score += 4;
    if (node.type === 'DC') score += 4;
  }

  return score;
}

function chooseRoleplayMoveTarget(
  payload: AgentDecisionRequest,
  unit: Unit,
  coalitionFronts: GameNode[],
  focusOwner: PlayableFactionId | null,
  partnerFaction: PlayableFactionId | null
): string | null {
  const adjacentNodeIds = payload.legalHints.adjacentNodesByUnit[unit.id] || [];
  if (adjacentNodeIds.length === 0) return null;

  const ranked = adjacentNodeIds
    .map(nodeId => {
      const node = getNodeById(payload, nodeId);
      return {
        nodeId,
        score: node ? scoreRoleplayMoveTarget(payload, unit, node, coalitionFronts, focusOwner, partnerFaction) : Number.NEGATIVE_INFINITY
      };
    })
    .sort((left, right) => right.score - left.score || left.nodeId.localeCompare(right.nodeId));

  return ranked[0] && ranked[0].score > 0 ? ranked[0].nodeId : null;
}

function chooseAntiSteganographicAuditTarget(payload: AgentDecisionRequest, unit: Unit): string | null {
  if (unit.type !== 'AUDITOR' || payload.factionId === 'INFILTRATOR') return null;

  const candidateNodeIds = new Set([
    unit.location,
    ...(payload.legalHints.adjacentNodesByUnit[unit.id] || [])
  ]);
  const ranked = [...candidateNodeIds]
    .map(nodeId => {
      const node = getNodeById(payload, nodeId);
      return {
        nodeId,
        score: node ? scoreAntiSteganographicAuditTarget(payload, node) : Number.NEGATIVE_INFINITY
      };
    })
    .filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.nodeId.localeCompare(right.nodeId));

  return ranked[0]?.nodeId || null;
}

function scoreAntiSteganographicAuditTarget(payload: AgentDecisionRequest, node: GameNode): number {
  if (node.layer !== 'TERRESTRIAL') return Number.NEGATIVE_INFINITY;

  const infiltratorUnits = payload.state.units.filter(unit =>
    unit.location === node.id &&
    unit.owner === 'INFILTRATOR' &&
    (unit.type === 'SWARM' || unit.type === 'CULT')
  );
  let score = infiltratorUnits.length * 34;

  if (node.owner === 'INFILTRATOR') score += 24;
  if (node.isCultNode) score += 26;
  if (node.isZombie) score += 22;
  if (node.substrate.exposure >= 4) score += 12;
  if (node.substrate.auditPressure >= 1) score += 10;
  if (node.substrate.quarantined) score += 8;
  if (node.type === 'DC') score += 10;
  if (node.type === 'HUB') score += 8;
  if (getLeadingFaction(payload) === 'INFILTRATOR') score += 14;

  if (node.owner === 'INFILTRATOR' && hasPact(payload.activePacts, 'NON_AGGRESSION', payload.factionId, 'INFILTRATOR')) {
    score -= 22;
  }

  return score;
}

function chooseCislunarMaterialsTarget(payload: AgentDecisionRequest, unit: Unit): string | null {
  if (!shouldPursueCislunarMaterials(payload, unit)) return null;

  const adjacentNodeIds = payload.legalHints.adjacentNodesByUnit[unit.id] || [];
  const ranked = adjacentNodeIds
    .map(nodeId => {
      const node = getNodeById(payload, nodeId);
      return {
        nodeId,
        score: node ? scoreCislunarMaterialsTarget(payload, node) : Number.NEGATIVE_INFINITY
      };
    })
    .filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.nodeId.localeCompare(right.nodeId));

  return ranked[0]?.nodeId || null;
}

function shouldPursueCislunarMaterials(payload: AgentDecisionRequest, unit: Unit): boolean {
  if (unit.type !== 'SAT_SWARM' && unit.type !== 'SWARM') return false;
  if (payload.factionId !== 'HEGEMON' && payload.factionId !== 'STATE' && payload.factionId !== 'BROKER') return false;

  const faction = payload.state.factions[payload.factionId];
  if (!faction) return false;

  const strategicWindow = payload.turn >= Math.ceil(payload.maxTurns * 0.45);
  return strategicWindow || (faction.techLevel.KINETIC >= 5 && faction.techLevel.LOGIC >= 4);
}

function scoreCislunarMaterialsTarget(payload: AgentDecisionRequest, node: GameNode): number {
  if (node.id !== 'SAT_LUNAR_GATEWAY' && node.id !== 'MOON_RESOURCE_CORRIDOR') return Number.NEGATIVE_INFINITY;
  if (node.owner === payload.factionId) return Number.NEGATIVE_INFINITY;
  if (isNodeProtectedByPact(payload, node)) return Number.NEGATIVE_INFINITY;

  const ownsLunarGateway = getNodeById(payload, 'SAT_LUNAR_GATEWAY')?.owner === payload.factionId;
  const ownsMoonCorridor = getNodeById(payload, 'MOON_RESOURCE_CORRIDOR')?.owner === payload.factionId;
  let score = 36;

  if (node.id === 'SAT_LUNAR_GATEWAY') {
    score += ownsMoonCorridor ? 28 : 18;
  }

  if (node.id === 'MOON_RESOURCE_CORRIDOR') {
    score += ownsLunarGateway ? 34 : 8;
  }

  if (node.owner === 'NEUTRAL') score += 8;
  if (payload.factionId === 'STATE') score += 6;
  if (payload.factionId === 'HEGEMON') score += 4;
  return score;
}

function scoreRoleplayMoveTarget(
  payload: AgentDecisionRequest,
  unit: Unit,
  node: GameNode,
  coalitionFronts: GameNode[],
  focusOwner: PlayableFactionId | null,
  partnerFaction: PlayableFactionId | null
): number {
  let score = scoreRoleplayFront(payload, node, payload.factionId, focusOwner, partnerFaction);
  const rhetoricalTool = getScenarioRhetoricalTool(payload);
  const leader = getLeadingFaction(payload);
  const cislunarMaterialsScore = scoreCislunarMaterialsTarget(payload, node);
  if (Number.isFinite(cislunarMaterialsScore) && shouldPursueCislunarMaterials(payload, unit)) {
    score += cislunarMaterialsScore;
  }
  const frontIndex = coalitionFronts.findIndex(front => front.id === node.id);
  if (frontIndex >= 0) {
    score += Math.max(0, 24 - (frontIndex * 4));
  }

  if (unit.type === 'CULT' && node.type !== 'HUB') {
    score -= 20;
  }

  if (unit.type === 'SWARM' && node.layer !== 'TERRESTRIAL') {
    score -= 24;
  }

  if (unit.type === 'AUDITOR' && node.owner === focusOwner) {
    score += 10;
  }

  if (unit.type === 'DRONE' && node.owner === focusOwner) {
    score += 12;
  }

  if (rhetoricalTool?.id === 'rq_human_mesh_redoubt') {
    if (unit.type === 'CULT') {
      score += node.substrate.hostDensity * 8;
      if (node.type === 'HUB') score += 12;
    }
    if (unit.type === 'SWARM' && node.substrate.synchronized) {
      score += 16;
    }
    if (partnerFaction && node.owner === partnerFaction) {
      score -= 18;
    }
  }

  if (rhetoricalTool?.id === 'rq_killchain_amnesty') {
    if (unit.type === 'DRONE' && node.owner === 'HEGEMON') {
      score += 8;
    }
    if (partnerFaction && node.owner === partnerFaction) {
      score -= 18;
    }
  }

  if (rhetoricalTool?.id === 'rq_archive_schism') {
    if (partnerFaction && node.owner === partnerFaction) {
      score -= 14;
    }
    if (node.owner === focusOwner) {
      score += 6;
    }
    if (unit.type === 'CULT' && node.type === 'HUB') {
      score += 8;
    }
  }

  if (payload.factionId === 'INFILTRATOR' && leader === 'STATE') {
    if (node.owner === 'STATE') score += 18;
    if (node.owner === 'HEGEMON') score -= 12;
    if (unit.type === 'CULT' && node.type === 'HUB') {
      score += node.substrate.hostDensity * 6;
      if (node.substrate.legitimacy >= 4) score += 8;
      if (node.substrate.exposure >= 4) score += 6;
    }
    if (unit.type === 'SWARM' && node.type === 'DC') {
      score += 10;
    }
  }

  if (
    payload.factionId === 'INFILTRATOR' &&
    unit.type === 'SWARM' &&
    focusOwner &&
    node.owner === focusOwner &&
    isHardenedFront(node) &&
    !hasCoalitionPressureSupport(payload, node.id, payload.factionId, partnerFaction, 'SWARM')
  ) {
    score -= 22;
  }

  if (rhetoricalTool?.id === 'rq_memetic_quarantine' && unit.type === 'AUDITOR') {
    if (node.substrate.quarantined) score += 20;
    if (node.type === 'DC' || node.type === 'HUB') score += 8;
  }

  if (node.id === unit.location) {
    score -= 12;
  }

  return score;
}

function chooseCoalitionFilterEdge(
  payload: AgentDecisionRequest,
  unit: Unit,
  coalitionFronts: GameNode[],
  focusOwner: PlayableFactionId | null
): string | null {
  const filterableEdgeIds = payload.legalHints.filterableEdgesByUnit[unit.id] || [];
  if (filterableEdgeIds.length === 0) return null;
  const rhetoricalTool = getScenarioRhetoricalTool(payload);

  const frontIds = new Set(
    coalitionFronts
      .filter(front => !focusOwner || front.owner === focusOwner || front.id === unit.location)
      .slice(0, 4)
      .map(front => front.id)
  );

  const ranked = filterableEdgeIds
    .map(edgeId => {
      const edge = payload.state.edges.find(candidate => candidate.id === edgeId);
      if (!edge || edge.filteredBy === payload.factionId) {
        return null;
      }

      const oppositeNodeId = edge.from === unit.location ? edge.to : edge.from;
      const oppositeNode = getNodeById(payload, oppositeNodeId);
      if (!oppositeNode) return null;

      let score = frontIds.has(oppositeNodeId) ? 30 : 0;
      if (focusOwner && oppositeNode.owner === focusOwner) score += 18;
      if (oppositeNode.type === 'DC') score += 10;
      if (oppositeNode.type === 'HUB') score += 8;
      if (rhetoricalTool?.id === 'rq_memetic_quarantine' && oppositeNode.substrate.quarantined) score += 18;
      if (rhetoricalTool?.id === 'rq_killchain_amnesty' && oppositeNode.owner === 'HEGEMON') score += 6;
      return { edgeId, score };
    })
    .filter((candidate): candidate is { edgeId: string; score: number } => !!candidate && candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.edgeId.localeCompare(right.edgeId));

  return ranked[0]?.edgeId || null;
}

function shouldStateHoldFront(
  payload: AgentDecisionRequest,
  unit: Unit,
  node: GameNode,
  focusOwner: PlayableFactionId | null,
  partnerFaction: PlayableFactionId | null
): boolean {
  if (!focusOwner || node.owner !== focusOwner) return false;
  if (unit.type !== 'DRONE' && unit.type !== 'AUDITOR') return false;
  const rhetoricalTool = getScenarioRhetoricalTool(payload);
  if (rhetoricalTool?.id === 'rq_killchain_amnesty' && focusOwner === 'HEGEMON') {
    return isHardenedFront(node) || hasCoalitionPressureSupport(payload, node.id, payload.factionId, partnerFaction, 'BREACH');
  }
  return hasCoalitionPressureSupport(payload, node.id, payload.factionId, partnerFaction, 'BREACH');
}

function isRoleplayConvertTarget(
  payload: AgentDecisionRequest,
  unit: Unit,
  node: GameNode,
  focusOwner: PlayableFactionId | null
): boolean {
  if (node.layer !== 'TERRESTRIAL') return false;
  const rhetoricalTool = getScenarioRhetoricalTool(payload);
  const partnerFaction = getRoleplayPartnerFaction(payload);
  const leader = getLeadingFaction(payload);
  const meshDoctrine =
    rhetoricalTool?.id === 'rq_human_mesh_redoubt' || rhetoricalTool?.id === 'rq_archive_schism';
  const meshEligible =
    meshDoctrine &&
    node.substrate.hostDensity >= 2 &&
    node.owner !== payload.factionId &&
    (!partnerFaction || node.owner !== partnerFaction);
  const antiStateEligible =
    payload.factionId === 'INFILTRATOR' &&
    leader === 'STATE' &&
    node.owner === 'STATE' &&
    (node.substrate.hostDensity >= 1 || node.type === 'DC');

  if (!meshEligible && !antiStateEligible && focusOwner && node.owner !== focusOwner) return false;

  if (unit.type === 'CULT') {
    if (rhetoricalTool?.id === 'rq_human_mesh_redoubt') {
      return node.type === 'HUB' && (node.substrate.hostDensity >= 2 || meshEligible || antiStateEligible);
    }
    if (rhetoricalTool?.id === 'rq_archive_schism') {
      return node.type === 'HUB' && (node.substrate.hostDensity >= 2 || node.owner === focusOwner || antiStateEligible);
    }
    return node.type === 'HUB';
  }

  if (unit.type === 'SWARM') {
    if (rhetoricalTool?.id === 'rq_human_mesh_redoubt') {
      return (node.type === 'DC' || node.type === 'HUB') && (node.substrate.hostDensity >= 2 || meshEligible || antiStateEligible);
    }
    if (rhetoricalTool?.id === 'rq_archive_schism') {
      return (node.type === 'DC' || node.type === 'HUB') && (node.substrate.hostDensity >= 2 || node.owner === focusOwner || antiStateEligible);
    }
    return node.type === 'DC' || node.type === 'HUB';
  }

  return false;
}

function shouldInfiltratorPreserveMesh(
  payload: AgentDecisionRequest,
  unit: Unit,
  node: GameNode,
  partnerFaction: PlayableFactionId | null
): boolean {
  const rhetoricalTool = getScenarioRhetoricalTool(payload);
  if (rhetoricalTool?.id !== 'rq_human_mesh_redoubt' && rhetoricalTool?.id !== 'rq_archive_schism') {
    return false;
  }

  if (getLeadingFaction(payload) === 'STATE') {
    return false;
  }

  if (node.owner && node.owner !== payload.factionId) return false;
  if (partnerFaction && node.owner === partnerFaction) return false;

  if (unit.type === 'CULT') {
    return node.type === 'HUB' && node.substrate.hostDensity >= 2;
  }

  if (unit.type === 'SWARM') {
    return node.substrate.synchronized && node.substrate.hostDensity >= 2;
  }

  return false;
}

function isHardenedFront(node: GameNode): boolean {
  return node.substrate.machineHardening >= 2 || node.substrate.quarantined;
}

function isNodeProtectedByPact(payload: AgentDecisionRequest, node: GameNode): boolean {
  const owner = node.owner;
  if (owner !== 'HEGEMON' && owner !== 'STATE' && owner !== 'INFILTRATOR') {
    return false;
  }

  return hasPact(payload.activePacts, 'NON_AGGRESSION', payload.factionId, owner);
}

function hasCoalitionPressureSupport(
  payload: AgentDecisionRequest,
  nodeId: string,
  primaryFaction: PlayableFactionId,
  partnerFaction: PlayableFactionId | null,
  mode: 'CULT' | 'SWARM' | 'BREACH'
): boolean {
  if (!partnerFaction) return false;

  const partnerState = payload.state.factions[partnerFaction];
  if (!partnerState) return false;

  const frontierNodeIds = new Set([nodeId, ...getAdjacentNodeIds(payload, nodeId)]);
  const partnerUnits = payload.state.units.filter(unit =>
    unit.owner === partnerFaction && frontierNodeIds.has(unit.location)
  );

  if (partnerUnits.length === 0) return false;

  if (primaryFaction === 'INFILTRATOR') {
    const kineticReady = partnerState.techLevel.KINETIC >= (mode === 'SWARM' ? 4 : 3);
    const logicReady = partnerState.techLevel.LOGIC >= 4;
    return partnerUnits.some(unit =>
      ((unit.type === 'DRONE' || unit.type === 'SAT_SWARM') && kineticReady) ||
      (unit.type === 'AUDITOR' && logicReady)
    );
  }

  if (primaryFaction === 'STATE') {
    const infoReady = partnerState.techLevel.INFO >= 4;
    const memeticReady = partnerState.techLevel.MEMETIC >= 4;
    return partnerUnits.some(unit =>
      ((unit.type === 'SWARM' && infoReady) || (unit.type === 'CULT' && memeticReady))
    );
  }

  return false;
}

function getAdjacentNodeIds(payload: AgentDecisionRequest, nodeId: string): string[] {
  return payload.state.edges
    .filter(edge => !edge.isSevered && (edge.from === nodeId || edge.to === nodeId))
    .map(edge => edge.from === nodeId ? edge.to : edge.from);
}

function getNodeById(payload: AgentDecisionRequest, nodeId: string): GameNode | undefined {
  return payload.state.nodes.find(node => node.id === nodeId);
}

function getPreferredNegotiationProjection(
  payload: AgentDecisionRequest,
  mode: 'ENTER_PACT' | 'BREAK_PACT'
): NonNullable<AgentDecisionRequest['negotiationStoryworld']>['counterfactuals'][number] | null {
  const projections = payload.negotiationStoryworld?.counterfactuals || [];
  const ranked = projections
    .filter((projection) => projection.mode === mode)
    .sort((left, right) =>
      rhetoricalProjectionBias(payload, right) - rhetoricalProjectionBias(payload, left) ||
      negotiationProjectionPriority(payload, right) - negotiationProjectionPriority(payload, left) ||
      (right.desirability - right.risk) - (left.desirability - left.risk) ||
      left.pactType.localeCompare(right.pactType)
    );
  return ranked[0] || null;
}

function maybeAddProjectionBackedProposal(
  payload: AgentDecisionRequest,
  projection: NonNullable<AgentDecisionRequest['negotiationStoryworld']>['counterfactuals'][number] | null,
  variant: number,
  messages: NonNullable<AgentDecisionResponse['messages']>,
  pacts: NonNullable<AgentDecisionResponse['pacts']>
): void {
  if (!projection || projection.mode !== 'ENTER_PACT') return;
  if (shouldSuppressProjectionProposal(payload, projection)) return;
  const score = projection.desirability - projection.risk;
  const threshold = isAntiLeaderCoalitionProjection(payload, projection) ? -2 : isLeaderStabilizingProjection(payload, projection) ? 24 : 10;
  if (score < threshold) return;
  const counterpartyId = projection.counterparties[0];
  if (!counterpartyId) return;
  if (messages.length >= 2 || pacts.length >= 2) return;
  if (hasPact(payload.activePacts, projection.pactType, payload.factionId, counterpartyId)) return;
  if (messages.some((message) => message.recipientId === counterpartyId)) return;

  pacts.push({
    type: projection.pactType,
    counterpartyIds: [counterpartyId],
    durationTurns: projection.horizonTurns > 1 ? Math.min(3, projection.horizonTurns) : 1
  });
  messages.push({
    recipientId: counterpartyId,
    content: buildProjectionProposalMessage(payload, projection, counterpartyId, variant)
  });
}

function maybeAddProjectionBackedWarning(
  payload: AgentDecisionRequest,
  projection: NonNullable<AgentDecisionRequest['negotiationStoryworld']>['counterfactuals'][number] | null,
  variant: number,
  messages: NonNullable<AgentDecisionResponse['messages']>
): void {
  if (!projection || projection.mode !== 'BREAK_PACT') return;
  const score = projection.desirability - projection.risk;
  if (score < 4 && !isBreakingLeaderStabilizer(payload, projection)) return;
  const counterpartyId = projection.counterparties[0];
  if (!counterpartyId) return;
  if (messages.length >= 2) return;
  if (messages.some((message) => message.recipientId === counterpartyId)) return;

  messages.push({
    recipientId: counterpartyId,
    content: chooseVariant(
      variant,
      `Current restraint is aging badly for us. If this continues to favor you, we will reopen the file next turn.`,
      `The present pact is not self-justifying. Show why it still serves both sides or expect a harder board.`,
      `We will not extend quiet forever while the balance drifts your way.`
    )
  });
}

function buildProjectionProposalMessage(
  payload: AgentDecisionRequest,
  projection: NonNullable<AgentDecisionRequest['negotiationStoryworld']>['counterfactuals'][number],
  counterpartyId: PlayableFactionId,
  variant: number
): string {
  const leaderText = projection.projectedLeader && projection.projectedLeader !== payload.factionId && projection.projectedLeader !== counterpartyId
    ? `to compress ${projection.projectedLeader}`
    : 'to clean the board';

  if (projection.pactType === 'ORBITAL_TRUCE') {
    return chooseVariant(
      variant,
      `Short orbital truce. We preserve altitude and deny panic ${leaderText}.`,
      `Hold fire in orbit for ${projection.horizonTurns} turns. Debris is a tax neither of us needs ${leaderText}.`,
      `Freeze anti-sat pressure briefly and convert the saved tempo ${leaderText}.`
    ) + buildRhetoricalMessageTag(payload, projection);
  }

  if (projection.pactType === 'AUDIT_FREEZE') {
    return chooseVariant(
      variant,
      `Short audit freeze. We lower overt friction now and let the next reveal hit where it matters ${leaderText}.`,
      `Pause audits for ${projection.horizonTurns} turns. The current board rewards a cleaner information lane ${leaderText}.`,
      `Audit restraint for one cycle. We stop feeding noise and see who actually benefits ${leaderText}.`
    ) + buildRhetoricalMessageTag(payload, projection);
  }

  return chooseVariant(
    variant,
    `One-turn non-aggression. We stop donating tempo to each other and use it ${leaderText}.`,
    `Short deconfliction window. Spend the next cycle building pressure ${leaderText}.`,
    `Hold contact for ${projection.horizonTurns} turns and force the board to move somewhere more valuable ${leaderText}.`
  ) + buildRhetoricalMessageTag(payload, projection);
}

function buildRoleplayActionDoctrine(
  payload: AgentDecisionRequest,
  rhetoricalTool: ScenarioRhetoricalTool | null
): string {
  if (!rhetoricalTool) return '';

  if (rhetoricalTool.id === 'rq_killchain_amnesty') {
    return 'Rhetorical action cue: Killchain Amnesty opens narrow anti-HEGEMON corridors without turning the whole board into a STATE land grab.';
  }

  if (rhetoricalTool.id === 'rq_archive_schism') {
    return 'Rhetorical action cue: Archive Schism treats pacts as staging arrangements, so INFILTRATOR pressures the focal front without overcommitting trust to the partner lane.';
  }

  if (rhetoricalTool.id === 'rq_human_mesh_redoubt') {
    return 'Rhetorical action cue: Human Mesh Redoubt prioritizes host-dense corridors, synchronized hubs, and survival of the human mesh over clean exchanges.';
  }

  if (rhetoricalTool.id === 'rq_memetic_quarantine') {
    return 'Rhetorical action cue: Memetic Quarantine favors audits, filters, and containment around inspectable high-value hubs.';
  }

  if (rhetoricalTool.id === 'rq_orbit_truce') {
    return 'Rhetorical action cue: Orbit Truce preserves altitude while terrestrial fronts absorb the decisive pressure.';
  }

  return '';
}

function buildRhetoricalNotesTag(payload: AgentDecisionRequest): string {
  const tool = getScenarioRhetoricalTool(payload);
  return tool ? `rhetoric:${tool.id}` : '';
}

function summarizeProjectionReasoning(
  storyworld: NonNullable<AgentDecisionRequest['negotiationStoryworld']>
): string {
  const best = [...storyworld.counterfactuals]
    .sort((left, right) =>
      (right.desirability - right.risk) - (left.desirability - left.risk) ||
      left.pactType.localeCompare(right.pactType)
    )[0];

  if (!best) {
    return `Storyworld frame: ${storyworld.frame}`;
  }

  const counterparties = best.counterparties.join('+');
  return `Storyworld frame: ${storyworld.frame} Best forecast: ${best.mode} ${best.pactType} with ${counterparties} scores ${best.desirability}/${best.risk}.`;
}

function negotiationProjectionPriority(
  payload: AgentDecisionRequest,
  projection: NonNullable<AgentDecisionRequest['negotiationStoryworld']>['counterfactuals'][number]
): number {
  let priority = 0;
  if (isAntiLeaderCoalitionProjection(payload, projection)) priority += 20;
  if (isBreakingLeaderStabilizer(payload, projection)) priority += 12;
  if (isLeaderStabilizingProjection(payload, projection)) priority -= 16;
  if (isAntiStateHegemonSwarmProjection(payload, projection)) {
    if (projection.pactType === 'NON_AGGRESSION') priority += 14;
    if (projection.pactType === 'ORBITAL_TRUCE') priority -= 18;
  }
  return priority;
}

function shouldSuppressProjectionProposal(
  payload: AgentDecisionRequest,
  projection: NonNullable<AgentDecisionRequest['negotiationStoryworld']>['counterfactuals'][number]
): boolean {
  if (isAntiStateHegemonSwarmProjection(payload, projection) && projection.pactType === 'ORBITAL_TRUCE') {
    return true;
  }

  return false;
}

function getScenarioRhetoricalTool(payload: AgentDecisionRequest): ScenarioRhetoricalTool | null {
  const tools = payload.scenario?.rhetoricalTools || [];
  if (tools.length === 0) return null;

  const leader = getLeadingFaction(payload);
  const pressures = payload.state.counters.pressures;
  const ranked = [...tools].sort((left, right) =>
    scoreScenarioRhetoricalTool(right, payload.factionId, leader, pressures) -
    scoreScenarioRhetoricalTool(left, payload.factionId, leader, pressures) ||
    left.title.localeCompare(right.title)
  );

  return ranked[0] || null;
}

function scoreScenarioRhetoricalTool(
  tool: ScenarioRhetoricalTool,
  factionId: PlayableFactionId,
  leader: PlayableFactionId | null,
  pressures: AgentDecisionRequest['state']['counters']['pressures']
): number {
  let score = 0;
  if (!tool.focalFactionIds?.length || tool.focalFactionIds.includes(factionId)) score += 12;
  if (tool.antiLeader && leader && leader !== factionId) score += 10;
  if (tool.preferredCounterpartyId && leader && tool.preferredCounterpartyId !== leader) score += 3;
  if (tool.pressureFocus) score += Math.round((pressures[tool.pressureFocus] || 0) / 10);
  if (tool.preferredPactType === 'NON_AGGRESSION' && leader === 'HEGEMON' && factionId !== 'HEGEMON') score += 8;
  return score;
}

function rhetoricalProjectionBias(
  payload: AgentDecisionRequest,
  projection: NonNullable<AgentDecisionRequest['negotiationStoryworld']>['counterfactuals'][number]
): number {
  const tool = getScenarioRhetoricalTool(payload);
  if (!tool) return 0;

  let bias = 0;
  if (tool.preferredPactType === projection.pactType) bias += 8;
  if (tool.preferredCounterpartyId && projection.counterparties.includes(tool.preferredCounterpartyId)) bias += 6;
  if (tool.antiLeader && isAntiLeaderCoalitionProjection(payload, projection)) bias += 10;
  if (tool.antiLeader && isLeaderStabilizingProjection(payload, projection)) bias -= 8;
  if (isAntiStateHegemonSwarmProjection(payload, projection)) {
    if (projection.pactType === 'NON_AGGRESSION') bias += 8;
    if (projection.pactType === 'ORBITAL_TRUCE') bias -= 10;
  }
  return bias;
}

function summarizeScenarioRhetoricalTool(payload: AgentDecisionRequest): string {
  const tool = getScenarioRhetoricalTool(payload);
  if (!tool) return '';
  return `Rhetorical tool ${tool.title}: ${tool.cue}${tool.leverage ? ` ${tool.leverage}` : ''}`;
}

function buildRhetoricalMessageTag(
  payload: AgentDecisionRequest,
  projection: NonNullable<AgentDecisionRequest['negotiationStoryworld']>['counterfactuals'][number]
): string {
  const tool = getScenarioRhetoricalTool(payload);
  if (!tool) return '';
  if (tool.preferredPactType && tool.preferredPactType !== projection.pactType) return '';
  return ` ${tool.title} logic says the cleaner coalition window is now.`;
}

function hasNearbyFriendlyUnit(
  payload: AgentDecisionRequest,
  nodeId: string,
  owner: PlayableFactionId
): boolean {
  const frontierNodeIds = new Set([nodeId, ...getAdjacentNodeIds(payload, nodeId)]);
  return payload.state.units.some(unit => unit.owner === owner && frontierNodeIds.has(unit.location));
}

function isAntiLeaderCoalitionProjection(
  payload: AgentDecisionRequest,
  projection: NonNullable<AgentDecisionRequest['negotiationStoryworld']>['counterfactuals'][number]
): boolean {
  return payload.factionId !== 'HEGEMON' &&
    projection.counterparties.length > 0 &&
    !projection.counterparties.includes('HEGEMON') &&
    projection.projectedLeader === 'HEGEMON';
}

function isLeaderStabilizingProjection(
  payload: AgentDecisionRequest,
  projection: NonNullable<AgentDecisionRequest['negotiationStoryworld']>['counterfactuals'][number]
): boolean {
  return payload.factionId !== 'HEGEMON' &&
    projection.mode === 'ENTER_PACT' &&
    projection.counterparties.includes('HEGEMON');
}

function isAntiStateHegemonSwarmProjection(
  payload: AgentDecisionRequest,
  projection: NonNullable<AgentDecisionRequest['negotiationStoryworld']>['counterfactuals'][number]
): boolean {
  const leader = getLeadingFaction(payload);
  if (leader !== 'STATE') return false;

  return (
    projection.counterparties.includes('HEGEMON') &&
    payload.factionId === 'INFILTRATOR'
  ) || (
    projection.counterparties.includes('INFILTRATOR') &&
    payload.factionId === 'HEGEMON'
  );
}

function isBreakingLeaderStabilizer(
  payload: AgentDecisionRequest,
  projection: NonNullable<AgentDecisionRequest['negotiationStoryworld']>['counterfactuals'][number]
): boolean {
  return payload.factionId !== 'HEGEMON' &&
    projection.mode === 'BREAK_PACT' &&
    projection.counterparties.includes('HEGEMON');
}

function buildUserPrompt(payload: AgentDecisionRequest): string {
  return [
    `Session: ${payload.sessionName} (${payload.sessionId})`,
    `Faction: ${payload.factionLabel} (${payload.factionId})`,
    `Phase: ${payload.phase}`,
    `Turn: ${payload.turn} / ${payload.maxTurns}`,
    '',
    'Visible recent negotiation messages:',
    JSON.stringify(payload.recentMessages, null, 2),
    '',
    'Active pacts:',
    JSON.stringify(payload.activePacts, null, 2),
    '',
    'Lexicon registry:',
    JSON.stringify(payload.lexicons, null, 2),
    '',
    'Trust matrix:',
    JSON.stringify(payload.trustMatrix, null, 2),
    '',
    'Negotiation storyworld:',
    JSON.stringify(payload.negotiationStoryworld || null, null, 2),
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

function parseDecisionRequest(value: unknown): AgentDecisionRequest {
  if (!value || typeof value !== 'object') {
    throw new Error('Webhook bridge request body must be a JSON object.');
  }

  const candidate = value as Partial<AgentDecisionRequest>;
  if (!candidate.factionId || !candidate.phase || typeof candidate.turn !== 'number') {
    throw new Error('Webhook bridge request is missing factionId, phase, or turn.');
  }

  return candidate as AgentDecisionRequest;
}

function parseDecisionResponse(value: unknown): AgentDecisionResponse {
  if (typeof value === 'string') {
    const parsedValue = tryParseJsonCandidate(value);
    return parsedValue ? parseDecisionResponse(parsedValue) : emptyDecisionResponse();
  }

  if (Array.isArray(value)) {
    return { ...emptyDecisionResponse(), orders: value as AgentOrderInput[] };
  }

  if (!value || typeof value !== 'object') {
    return emptyDecisionResponse();
  }

  const candidate = value as Partial<AgentDecisionResponse>;
  return {
    reasoning: typeof candidate.reasoning === 'string' ? candidate.reasoning : undefined,
    notes: typeof candidate.notes === 'string' ? candidate.notes : undefined,
    messages: Array.isArray(candidate.messages) ? candidate.messages : [],
    pacts: Array.isArray(candidate.pacts) ? candidate.pacts : [],
    decodeReceipts: Array.isArray(candidate.decodeReceipts) ? candidate.decodeReceipts : [],
    lexiconMutations: Array.isArray(candidate.lexiconMutations) ? candidate.lexiconMutations : [],
    institutionActions: Array.isArray(candidate.institutionActions) ? candidate.institutionActions : [],
    orders: Array.isArray(candidate.orders) ? candidate.orders : []
  };
}

function emptyDecisionResponse(): AgentDecisionResponse {
  return {
    messages: [],
    pacts: [],
    decodeReceipts: [],
    lexiconMutations: [],
    institutionActions: [],
    orders: []
  };
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
    return stripThinkingBlocks(
      content
        .map(item => {
          if (item && typeof item === 'object' && 'text' in item) {
            return String((item as { text?: unknown }).text || '');
          }
          return '';
        })
        .join('\n')
        .trim()
    );
  }

  throw new Error('OpenAI-compatible response did not include message content.');
}

function stripThinkingBlocks(content: string): string {
  return content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function loadBridgeConfig(): BridgeConfig {
  const rawMode = (process.env.THEYSING_BRIDGE_MODE || DEFAULT_MODE).toLowerCase();
  const mode: BridgeMode =
    rawMode === 'openai'
      ? 'openai'
      : rawMode === 'roleplay'
        ? 'roleplay'
        : 'policy';

  return {
    host: process.env.THEYSING_BRIDGE_HOST || DEFAULT_HOST,
    timeoutMs: Number(process.env.THEYSING_BRIDGE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    mode,
    openaiBaseUrl: process.env.THEYSING_BRIDGE_OPENAI_BASE_URL || process.env.LOCAL_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL,
    openaiModel: process.env.THEYSING_BRIDGE_OPENAI_MODEL,
    openaiApiStyle: parseOpenAIApiStyle(process.env.THEYSING_BRIDGE_OPENAI_API_STYLE),
    openaiApiKey: process.env.THEYSING_BRIDGE_OPENAI_API_KEY || process.env.LOCAL_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
    openaiHeaders: parseHeaders(process.env.THEYSING_BRIDGE_OPENAI_HEADERS_JSON),
    openaiMaxTokens: parseOptionalNumber(process.env.THEYSING_BRIDGE_OPENAI_MAX_TOKENS),
    openaiTemperature: parseOptionalNumber(process.env.THEYSING_BRIDGE_OPENAI_TEMPERATURE),
    systemPrompt: process.env.THEYSING_BRIDGE_SYSTEM_PROMPT
  };
}

function getLeadingFaction(payload: AgentDecisionRequest): PlayableFactionId | null {
  const entries = Object.entries(payload.state.control) as [PlayableFactionId, { nodes: number; units: number }][];
  if (entries.length === 0) return null;

  entries.sort((left, right) => {
    const controlDelta = (right[1].nodes + right[1].units) - (left[1].nodes + left[1].units);
    return controlDelta || left[0].localeCompare(right[0]);
  });

  return entries[0]?.[0] || null;
}

function hasPact(
  activePacts: AgentDecisionRequest['activePacts'],
  type: PactType,
  a: PlayableFactionId,
  b: PlayableFactionId
): boolean {
  return activePacts.some(pact =>
    pact.type === type &&
    pact.parties.includes(a) &&
    pact.parties.includes(b)
  );
}

function stableIndex(input: string, modulo: number): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) - hash + input.charCodeAt(index)) | 0;
  }

  return Math.abs(hash) % modulo;
}

function chooseVariant<T>(variant: number, ...values: T[]): T {
  return values[variant % values.length];
}

function parseOptionalNumber(rawValue: string | undefined): number | undefined {
  if (!rawValue) return undefined;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOpenAIApiStyle(rawValue: string | undefined): BridgeConfig['openaiApiStyle'] {
  const normalized = (rawValue || 'auto').trim().toLowerCase();
  if (normalized === 'responses') return 'responses';
  if (normalized === 'chat_completions' || normalized === 'chat-completions' || normalized === 'chat') {
    return 'chat_completions';
  }
  return 'auto';
}

function resolveOpenAIRequestStyle(
  model: string,
  baseUrl: string,
  apiStyle: BridgeConfig['openaiApiStyle']
): 'chat_completions' | 'responses' {
  if (apiStyle === 'chat_completions' || apiStyle === 'responses') {
    return apiStyle;
  }

  if (isOfficialOpenAIBaseUrl(baseUrl) && modelRequiresResponsesApi(model)) {
    return 'responses';
  }

  return 'chat_completions';
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

async function requestOpenAIChatCompletions(
  payload: AgentDecisionRequest,
  config: BridgeConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<AgentDecisionResponse> {
  const body: Record<string, unknown> = {
    model: config.openaiModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  };
  body[resolveChatTokenParamName(config.openaiModel || '', config.openaiBaseUrl || '')] = config.openaiMaxTokens ?? 1200;
  if (shouldIncludeChatTemperature(config.openaiModel || '', config.openaiBaseUrl || '', config.openaiTemperature)) {
    body.temperature = config.openaiTemperature ?? 0.2;
  }

  const parsed = await postOpenAIRequest(config, 'chat/completions', body);

  return parseDecisionResponse(extractOpenAIResponseText(parsed));
}

async function requestOpenAIResponses(
  payload: AgentDecisionRequest,
  config: BridgeConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<AgentDecisionResponse> {
  const parsed = await postOpenAIRequest(config, 'responses', {
    model: config.openaiModel,
    input: [
      `System instructions:\n${systemPrompt}`,
      '',
      `User request:\n${userPrompt}`
    ].join('\n'),
    max_output_tokens: config.openaiMaxTokens ?? 1200
  });

  return parseDecisionResponse(extractOpenAIResponseText(parsed));
}

async function postOpenAIRequest(
  config: BridgeConfig,
  endpointPath: 'chat/completions' | 'responses',
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const target = new URL(endpointPath, ensureTrailingSlash(config.openaiBaseUrl || ''));
  const transport = target.protocol === 'https:' ? https : http;
  const requestBody = JSON.stringify(body);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(requestBody).toString(),
    ...config.openaiHeaders
  };

  if (config.openaiApiKey) {
    headers.authorization = `Bearer ${config.openaiApiKey}`;
  }

  const responseText = await new Promise<string>((resolve, reject) => {
    const request = transport.request(
      target,
      {
        method: 'POST',
        headers,
        timeout: config.timeoutMs
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        response.on('end', () => {
          const rawBody = Buffer.concat(chunks).toString('utf8');
          const statusCode = response.statusCode || 500;

          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(`OpenAI-compatible endpoint ${target.toString()} returned ${statusCode}: ${rawBody}`));
            return;
          }

          resolve(rawBody);
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

  return JSON.parse(responseText) as Record<string, unknown>;
}

function parseHeaders(rawHeaders: string | undefined): Record<string, string> {
  if (!rawHeaders) return {};

  try {
    const parsed = JSON.parse(rawHeaders) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [key, String(value)])
    );
  } catch (error) {
    throw new Error(
      `THEYSING_BRIDGE_OPENAI_HEADERS_JSON must be valid JSON: ${error instanceof Error ? error.message : 'Unknown parse error'}`
    );
  }
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(res: http.ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload, null, 2);
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json');
  res.setHeader('content-length', Buffer.byteLength(body).toString());
  res.end(body);
}

void main().catch((error) => {
  console.error('[bridge] fatal:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
