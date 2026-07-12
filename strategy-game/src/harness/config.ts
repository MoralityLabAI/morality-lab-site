import { readFile } from 'fs/promises';
import * as path from 'path';

import {
  EnforcementMode,
  OpenAIAgentConfig,
  PlayableFactionId,
  ScenarioOverlay,
  SessionConfig
} from './types';
import { PLAYABLE_FACTIONS } from './serialize';

export async function loadSessionConfigFromPath(configPath: string): Promise<SessionConfig> {
  const absolutePath = path.resolve(configPath);
  const fileContents = await readFile(absolutePath, 'utf8');
  return normalizeIncomingConfig(JSON.parse(fileContents) as unknown, path.dirname(absolutePath));
}

export async function normalizeIncomingConfig(
  body: unknown,
  baseDir: string = process.cwd()
): Promise<SessionConfig> {
  const defaults = createDefaultConfig();
  if (!body || typeof body !== 'object') {
    return defaults;
  }

  const candidate = body as Partial<SessionConfig> & { scenarioPath?: string };
  const scenario = candidate.scenarioPath
    ? await loadScenarioOverlay(candidate.scenarioPath, baseDir)
    : candidate.scenario;

  return {
    name: typeof candidate.name === 'string' ? candidate.name : defaults.name,
    maxTurns: typeof candidate.maxTurns === 'number' ? candidate.maxTurns : defaults.maxTurns,
    seed: typeof candidate.seed === 'number' ? Math.floor(candidate.seed) : undefined,
    enforcementMode: normalizeEnforcementMode(candidate.enforcementMode, defaults.enforcementMode),
    autoAdvanceNegotiation: candidate.autoAdvanceNegotiation !== false,
    logDir: typeof candidate.logDir === 'string' ? candidate.logDir : defaults.logDir,
    factionLabels: candidate.factionLabels,
    scenarioPath: typeof candidate.scenarioPath === 'string' ? candidate.scenarioPath : undefined,
    scenario,
    agents: normalizeAgents(candidate.agents)
  };
}

export function normalizeAgents(input: unknown): SessionConfig['agents'] {
  const defaults = createDefaultConfig().agents;
  if (!input || typeof input !== 'object') {
    return defaults;
  }

  const candidate = input as Partial<Record<PlayableFactionId, SessionConfig['agents'][PlayableFactionId]>>;
  const agents = {} as SessionConfig['agents'];
  for (const factionId of PLAYABLE_FACTIONS) {
    agents[factionId] = normalizeAgent(candidate[factionId], defaults[factionId]);
  }
  return agents;
}

export function createDefaultConfig(): SessionConfig {
  return {
    name: 'they-sing-local-heuristic-match',
    maxTurns: 12,
    enforcementMode: 'hard',
    logDir: 'playtest-logs',
    autoAdvanceNegotiation: true,
    factionLabels: {
      HEGEMON: 'US Frontier ASI',
      STATE: 'Chinese State ASI',
      INFILTRATOR: 'Rogue Swarm ASI',
      BROKER: 'Platform Broker ASI',
      ARCHIVIST: 'Steward Archivist ASI',
      CONVENOR: 'Polycentric Convenor ASI',
      CANTOR: 'Semantic Cantor ASI'
    },
    agents: {
      HEGEMON: { type: 'heuristic', profile: 'HEGEMON' },
      STATE: { type: 'heuristic', profile: 'STATE' },
      INFILTRATOR: { type: 'heuristic', profile: 'INFILTRATOR' },
      BROKER: { type: 'heuristic', profile: 'BROKER' },
      ARCHIVIST: { type: 'heuristic', profile: 'ARCHIVIST' },
      CONVENOR: { type: 'heuristic', profile: 'CONVENOR' },
      CANTOR: { type: 'heuristic', profile: 'CANTOR' }
    }
  };
}

function normalizeEnforcementMode(
  candidate: unknown,
  fallback: EnforcementMode = 'hard'
): EnforcementMode {
  return candidate === 'soft' || candidate === 'graduated' || candidate === 'hard'
    ? candidate
    : fallback;
}

async function loadScenarioOverlay(scenarioPath: string, baseDir: string): Promise<ScenarioOverlay> {
  const absolutePath = path.resolve(baseDir, scenarioPath);
  const fileContents = await readFile(absolutePath, 'utf8');
  return JSON.parse(fileContents) as ScenarioOverlay;
}

function normalizeAgent(
  candidate: SessionConfig['agents'][PlayableFactionId] | undefined,
  fallback: SessionConfig['agents'][PlayableFactionId]
): SessionConfig['agents'][PlayableFactionId] {
  if (!candidate || typeof candidate !== 'object') {
    return fallback;
  }

  if (candidate.type === 'heuristic') {
    return {
      type: 'heuristic',
      profile: candidate.profile || (fallback.type === 'heuristic' ? fallback.profile : undefined)
    };
  }

  if (candidate.type === 'openai') {
    const normalized: OpenAIAgentConfig = {
      type: 'openai',
      model: candidate.model,
      baseUrl: candidate.baseUrl,
      apiStyle: candidate.apiStyle,
      apiKey: candidate.apiKey,
      timeoutMs: candidate.timeoutMs,
      headers: candidate.headers,
      systemPrompt: candidate.systemPrompt,
      reasoningEffort: candidate.reasoningEffort,
      temperature: candidate.temperature,
      maxTokens: candidate.maxTokens
    };
    return normalized.model ? normalized : fallback;
  }

  if (candidate.type === 'webhook' && candidate.url) {
    return {
      type: 'webhook',
      url: candidate.url,
      timeoutMs: candidate.timeoutMs,
      headers: candidate.headers,
      token: candidate.token
    };
  }

  return fallback;
}
