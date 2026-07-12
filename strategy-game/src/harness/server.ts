import * as http from 'http';

import { createDefaultConfig, loadSessionConfigFromPath, normalizeIncomingConfig } from './config';
import { HeadlessPlaytestSession } from './HeadlessPlaytestSession';
import { PLAYABLE_FACTIONS } from './serialize';
import { ManualTurnPlan, PlayableFactionId, SessionConfig } from './types';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8787;

const sessions = new Map<string, HeadlessPlaytestSession>();

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const host = args.host || DEFAULT_HOST;
  const port = args.port ? Number(args.port) : DEFAULT_PORT;

  if (args.config) {
    const config = await loadConfigFile(args.config);
    const session = await createSession(config);
    console.log(`Loaded session ${session.getSummary().sessionId} from ${args.config}`);
  }

  const server = http.createServer(async (req, res) => {
    try {
      await handleRequest(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown server error';
      sendJson(res, 500, { error: message });
    }
  });

  server.listen(port, host, () => {
    console.log(`They Sing headless harness listening at http://${host}:${port}`);
  });
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const method = req.method || 'GET';
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || `${DEFAULT_HOST}:${DEFAULT_PORT}`}`);
  const pathname = requestUrl.pathname;

  if (method === 'GET' && pathname === '/health') {
    sendJson(res, 200, { ok: true, sessions: sessions.size });
    return;
  }

  if (method === 'GET' && pathname === '/contract/agent-webhook') {
    sendJson(res, 200, buildWebhookContract());
    return;
  }

  if (method === 'GET' && pathname === '/contract/session-config') {
    sendJson(res, 200, buildSessionConfigContract());
    return;
  }

  if (method === 'GET' && pathname === '/sessions') {
    sendJson(res, 200, { sessions: Array.from(sessions.values()).map(session => session.getSummary()) });
    return;
  }

  if (method === 'POST' && pathname === '/sessions') {
    const body = await readJsonBody(req);
    const config = await normalizeIncomingConfig(body);
    const session = await createSession(config);
    sendJson(res, 201, session.getSnapshot());
    return;
  }

  const sessionMatch = pathname.match(/^\/sessions\/([^/]+)$/);
  if (method === 'GET' && sessionMatch) {
    const session = getSessionOrThrow(sessionMatch[1]);
    sendJson(res, 200, session.getSnapshot());
    return;
  }

  const stepMatch = pathname.match(/^\/sessions\/([^/]+)\/step$/);
  if (method === 'POST' && stepMatch) {
    const session = getSessionOrThrow(stepMatch[1]);
    const snapshot = await session.stepPhase();
    sendJson(res, 200, snapshot);
    return;
  }

  const runTurnMatch = pathname.match(/^\/sessions\/([^/]+)\/run-turn$/);
  if (method === 'POST' && runTurnMatch) {
    const session = getSessionOrThrow(runTurnMatch[1]);
    const snapshot = await session.runTurn();
    sendJson(res, 200, snapshot);
    return;
  }

  const runMatch = pathname.match(/^\/sessions\/([^/]+)\/run$/);
  if (method === 'POST' && runMatch) {
    const session = getSessionOrThrow(runMatch[1]);
    const body = await readJsonBody(req);
    const requestedTurns = typeof body.turns === 'number' ? body.turns : 1;
    const snapshot = await session.runTurns(requestedTurns);
    sendJson(res, 200, snapshot);
    return;
  }

  const decisionRequestMatch = pathname.match(/^\/sessions\/([^/]+)\/decision-request$/);
  if (method === 'GET' && decisionRequestMatch) {
    const session = getSessionOrThrow(decisionRequestMatch[1]);
    const factionId = parsePlayableFactionId(requestUrl.searchParams.get('factionId'));
    const phase = parseDecisionPhase(requestUrl.searchParams.get('phase'));
    sendJson(res, 200, session.getDecisionRequestForFaction(factionId, phase));
    return;
  }

  const manualTurnContextMatch = pathname.match(/^\/sessions\/([^/]+)\/manual-turn-context$/);
  if (method === 'GET' && manualTurnContextMatch) {
    const session = getSessionOrThrow(manualTurnContextMatch[1]);
    const factionId = parsePlayableFactionId(requestUrl.searchParams.get('factionId'));
    sendJson(res, 200, session.getManualTurnContext(factionId));
    return;
  }

  const manualTurnMatch = pathname.match(/^\/sessions\/([^/]+)\/run-manual-turn$/);
  if (method === 'POST' && manualTurnMatch) {
    const session = getSessionOrThrow(manualTurnMatch[1]);
    const body = await readJsonBody(req);
    const snapshot = await session.runManualTurn(body as unknown as ManualTurnPlan);
    sendJson(res, 200, snapshot);
    return;
  }

  sendJson(res, 404, { error: `Unknown route: ${method} ${pathname}` });
}

async function createSession(config: SessionConfig): Promise<HeadlessPlaytestSession> {
  const session = new HeadlessPlaytestSession(config);
  await session.initialize();
  sessions.set(session.getSummary().sessionId, session);
  return session;
}

function getSessionOrThrow(sessionId: string): HeadlessPlaytestSession {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found.`);
  }
  return session;
}

function parsePlayableFactionId(value: string | null): PlayableFactionId {
  if (value && PLAYABLE_FACTIONS.includes(value as PlayableFactionId)) {
    return value as PlayableFactionId;
  }
  throw new Error(`Invalid factionId: ${value || 'missing'}`);
}

function parseDecisionPhase(value: string | null): 'NEGOTIATION' | 'ALLOCATION' | 'ACTION_DECLARATION' {
  if (value === 'NEGOTIATION' || value === 'ALLOCATION' || value === 'ACTION_DECLARATION') {
    return value;
  }
  throw new Error(`Invalid phase: ${value || 'missing'}`);
}

function buildWebhookContract(): Record<string, unknown> {
  return {
    method: 'POST',
    description: 'Outbound webhook fired by the harness for each playable faction during NEGOTIATION, ALLOCATION, and ACTION_DECLARATION.',
    requestShape: {
      sessionId: 'string',
      sessionName: 'string',
      factionId: PLAYABLE_FACTIONS.join(' | '),
      factionLabel: 'string',
      phase: 'NEGOTIATION | ALLOCATION | ACTION_DECLARATION',
      turn: 'number',
      maxTurns: 'number',
      state: 'serialized match state',
      legalHints: 'action and build hints',
      scenario: 'optional scenario metadata and briefing',
      recentMessages: 'visible negotiation transcript; foreign SING/1 canonical and gloss fields are redacted before decode receipt submission',
      activePacts: 'currently active negotiated pacts',
      lexicons: 'current lexicon versions, controllers, adopters, access, rent, and fork rules',
      trustMatrix: 'current bilateral trust scores',
      negotiationStoryworld: 'for NEGOTIATION, a short frame plus counterfactual alliance enter/break projections',
      instructions: 'JSON-only response contract'
    },
    responseShape: {
      reasoning: 'optional string; recommended for all phases because it is captured in the reasoning diary',
      notes: 'optional string',
      messages: [
        {
          recipientId: `${PLAYABLE_FACTIONS.join(' | ')} | ALL`,
          content: 'string'
        }
      ],
      pacts: [
        {
          type: 'ORBITAL_TRUCE | NON_AGGRESSION | AUDIT_FREEZE',
          counterpartyIds: [PLAYABLE_FACTIONS.join(' | ')],
          durationTurns: 'optional 1-3'
        }
      ],
      decodeReceipts: [{
        messageId: 'foreign SING/1 message id',
        lexiconId: 'claimed lexicon id',
        version: 'claimed version',
        reconstructed: 'partial canonical message reconstructed before reveal',
        confidence: '0-1'
      }],
      lexiconMutations: [{
        operation: 'DEFINE | AMEND | ALIAS | NARROW | GENERALIZE | SPLIT | MERGE | RETIRE',
        lexiconId: 'string',
        baseVersion: 'optional string',
        targetVersion: 'string',
        atoms: ['string'],
        access: 'optional OPEN | MEMBERS | RENTED',
        rent: 'optional 0-10',
        forkRule: 'optional OPEN | VOTE | OWNER'
      }],
      institutionActions: [{
        type: 'EXIT | EXPEL | FORK',
        pactType: 'required for EXIT/EXPEL',
        targetFactionId: 'required for EXPEL',
        lexiconId: 'required for FORK',
        forkId: 'required for FORK',
        exitGuarantee: 'optional boolean',
        reason: 'optional string'
      }],
      orders: [
        {
          type: 'MOVE | HOLD | SUPPORT | ATTACK | FILTER | SABOTAGE | ANTI_SAT | CHALLENGE_MANDATE | LICENSED_BEAM_USE | REPAIR_ESCROW_CLAIM | CONVERT | AUDIT | RECRUITMENT_PULSE | BROKER_LEVERAGE | BUILD | RESEARCH',
          unitId: 'optional string',
          targetNodeId: 'optional string',
          targetEdgeId: 'optional string',
          techDomain: 'optional KINETIC | INFO | LOGIC | MEMETIC',
          unitTypeToBuild: 'optional DRONE | SWARM | CULT | AUDITOR | SAT_SWARM'
        }
      ]
    }
  };
}

function buildSessionConfigContract(): Record<string, unknown> {
  return {
    sessionConfigShape: {
      name: 'optional string',
      maxTurns: 'optional number',
      seed: 'optional number',
      enforcementMode: 'optional hard | soft | graduated',
      logDir: 'optional string',
      autoAdvanceNegotiation: 'optional boolean',
      factionLabels: 'optional labels per playable faction',
      scenarioPath: 'optional path to a scenario JSON file',
      scenario: 'optional inline scenario overlay',
      agents: {
        HEGEMON: 'heuristic | webhook | openai',
        STATE: 'heuristic | webhook | openai',
        INFILTRATOR: 'heuristic | webhook | openai',
        BROKER: 'heuristic | webhook | openai',
        ARCHIVIST: 'heuristic | webhook | openai',
        CONVENOR: 'heuristic | webhook | openai',
        CANTOR: 'heuristic | webhook | openai'
      }
    },
    scenarioShape: {
      name: 'optional string',
      description: 'optional string',
      briefing: 'optional string appended to agent instructions',
      phase: 'optional NEGOTIATION | ALLOCATION | ACTION_DECLARATION | RESOLUTION | TURN_END',
      counters: 'optional global counter overrides',
      nodes: 'optional node patches or additions',
      edges: 'optional edge patches or additions',
      units: 'optional unit patches/additions/removals',
      factions: 'optional faction resource or tech patches',
      negotiationMessages: 'optional preloaded transcript entries',
      activePacts: 'optional active pact list',
      trustMatrix: 'optional bilateral trust override'
    },
    openaiAgentExample: {
      type: 'openai',
      model: 'Qwen/Qwen2.5-32B-Instruct',
      baseUrl: 'http://snacksack:8000/v1',
      timeoutMs: 120000,
      temperature: 0.2,
      maxTokens: 1200
    },
    notes: [
      'If baseUrl points at a local OpenAI-compatible server, the Authorization header is omitted when no apiKey is configured.',
      'Use /contract/agent-webhook for the webhook request/response shape.',
      'Negotiated pacts activate only when every named party returns the same pact commitment during the NEGOTIATION phase.',
      'Foreign protocol traces must be decoded from their surface before reveal; executable exit, expulsion, mutation, and fork attempts are logged with material deltas.'
    ]
  };
}

async function loadConfigFile(configPath: string): Promise<SessionConfig> {
  return loadSessionConfigFromPath(configPath);
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;

    const [rawKey, inlineValue] = token.slice(2).split('=');
    if (inlineValue !== undefined) {
      args[rawKey] = inlineValue;
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      args[rawKey] = next;
      index += 1;
    } else {
      args[rawKey] = 'true';
    }
  }

  return args;
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  const rawBody = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(rawBody) as Record<string, unknown>;
}

function sendJson(res: http.ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload, null, 2);
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-length', Buffer.byteLength(body).toString());
  res.end(body);
}

void main();
