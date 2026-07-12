import { ObservatoryBoardDiff, ObservatoryBoardState, ObservatoryEvidence, ObservatoryGraph, ObservatoryScene } from '../three/ObservatoryScene';

type ReplayMessage = {
  sender?: string;
  recipient?: string;
  content?: string;
  pactType?: string;
};

type ReplayDiary = {
  kind?: string;
  factionId?: string;
  factionLabel?: string;
  reasoning?: string;
  notes?: string;
  storyworldFrame?: string;
};

type ReplayOrder = {
  factionId?: string;
  factionLabel?: string;
  accepted?: boolean;
  type?: string;
  text?: string;
  techDomain?: string;
  researchGoal?: string;
  researchCompleted?: string;
  researchFlopsBefore?: string;
  researchFlopsAfter?: string;
  researchFlopsProgressToGoal?: string;
  researchFlopsRemaining?: string;
  visualPreset?: string;
  subgenre?: string;
};

type ReplayEvent = {
  category?: string;
  summary?: string;
  phase?: string;
  visualPreset?: string;
  subgenre?: string;
};

type ReplaySceneEvent = {
  id?: string;
  sourceType?: string;
  category?: string;
  subgenre?: string;
  visualPreset?: string;
  actors?: string[];
  publicExplanation?: string;
  privateReasoning?: Record<string, string>;
  retrospectiveTruth?: string;
  intensity?: number;
  location?: {
    nodeId?: string;
    edgeId?: string;
    orbitShell?: string;
  };
  payload?: unknown;
};

type ReplayAnomalyDossier = {
  id?: string;
  label?: string;
  containmentClass?: string;
  firstObservedTurn?: number;
  affectedDomains?: string[];
  observedEffects?: string[];
  knownCountermeasures?: string[];
  treatyHooks?: string[];
  diaryContradictions?: string[];
  retrospectiveTruth?: string;
  threadId?: string;
  recurrenceCount?: number;
  relatedTurns?: Array<{ turn?: number; phase?: string; label?: string; containmentClass?: string; affectedDomains?: string[] }>;
  threadSummary?: string;
};

type ReplayMoment = {
  category?: string;
  title?: string;
  impact?: string;
  privateReasoning?: Record<string, string> | string;
  interestScore?: number;
  factionsInvolved?: string[];
};

type ReplayTurn = {
  turn: number;
  phase?: string;
  campaignClock?: {
    label?: string;
    tempoLabel?: string;
    turnDurationLabel?: string;
  } | null;
  messages?: ReplayMessage[];
  diaries?: ReplayDiary[];
  orders?: ReplayOrder[];
  research?: ReplayOrder[];
  events?: ReplayEvent[];
  sceneEvents?: ReplaySceneEvent[];
  anomalyDossiers?: ReplayAnomalyDossier[];
  moments?: ReplayMoment[];
  strategicTracks?: Record<string, unknown>;
  boardState?: ObservatoryBoardState;
  boardDiff?: ObservatoryBoardDiff;
};

type ObservatoryReplay = {
  schema?: string;
  generatedAt?: string;
  sourceFiles?: string[];
  runs?: string[];
  graph?: ObservatoryGraph;
  turns: ReplayTurn[];
};

type ArchiveEntry = {
  dossier: ReplayAnomalyDossier;
  turn: number;
  phase?: string;
};

type SpectatorClipSettings = {
  revealRetrospective: boolean;
  directorMode: boolean;
  archiveQuery: string;
  archiveCampaignMode: boolean;
};

const STYLE_ID = 'they-sing-observatory-styles';

const FACTION_LABELS: Record<string, string> = {
  HEGEMON: 'Orbital Throne',
  INFILTRATOR: 'Memetic Swarm',
  STATE: 'Sovereign Stack',
  BROKER: 'Cislunar Broker',
  ARCHIVIST: 'Steward Archivist',
  CONVENOR: 'Polycentric Convenor',
  CANTOR: 'Semantic Cantor'
};

export class ObservatoryReplayUI {
  private readonly container: HTMLElement;
  private readonly sceneMount: HTMLElement;
  private readonly scene: ObservatoryScene;
  private readonly turnLabel: HTMLElement;
  private readonly phaseLabel: HTMLElement;
  private readonly runLabel: HTMLElement;
  private readonly transcript: HTMLElement;
  private readonly movesList: HTMLElement;
  private readonly momentList: HTMLElement;
  private readonly eventList: HTMLElement;
  private readonly anomalyList: HTMLElement;
  private readonly archiveSearch: HTMLInputElement;
  private readonly archiveScopeButton: HTMLButtonElement;
  private readonly diffList: HTMLElement;
  private readonly detailPanel: HTMLElement;
  private readonly status: HTMLElement;
  private readonly playButton: HTMLButtonElement;
  private replay: ObservatoryReplay | null = null;
  private turnIndex = 0;
  private playing = false;
  private playTimer = 0;
  private animationToken = 0;
  private activeSubgenre = 'ALL';
  private activeFaction = 'ALL';
  private activePhase = 'ALL';
  private activeMomentCategory = 'ALL';
  private activeSignalMode = 'ALL';
  private archiveQuery = '';
  private archiveCampaignMode = false;
  private revealRetrospective = false;
  private directorMode = false;

  constructor(container: HTMLElement) {
    this.container = container;
    injectStyles();
    this.container.className = 'obs-shell';
    this.container.innerHTML = `
      <div class="obs-scene" data-role="scene"></div>
      <div class="obs-vignette"></div>
      <header class="obs-topbar">
        <div>
          <div class="obs-kicker">They Sing Observatory</div>
          <div class="obs-title">Negotiation replay / orbital crisis monitor</div>
        </div>
        <div class="obs-readout">
          <span data-role="turn">Turn --</span>
          <span data-role="phase">No replay loaded</span>
          <span data-role="run">0 runs</span>
        </div>
      </header>
      <aside class="obs-panel obs-left">
        <div class="obs-panel-title">Scene Filters</div>
        <div class="obs-filterbar" data-role="filters"></div>
        <div class="obs-panel-title">Moments</div>
        <div data-role="moments" class="obs-stack"></div>
        <div class="obs-panel-title">Signal Events</div>
        <div data-role="events" class="obs-stack obs-event-stack"></div>
        <div class="obs-panel-title">What Changed</div>
        <div data-role="diffs" class="obs-stack obs-diff-stack"></div>
        <div class="obs-panel-title">Anomaly Archive</div>
        <div class="obs-archive-tools">
          <input data-role="archive-search" type="search" placeholder="Search archive">
          <button data-role="archive-scope" type="button">Turn</button>
        </div>
        <div data-role="anomalies" class="obs-stack obs-anomaly-stack"></div>
      </aside>
      <aside class="obs-panel obs-right">
        <div class="obs-panel-title">Animated Diary</div>
        <div data-role="transcript" class="obs-transcript"></div>
      </aside>
      <aside class="obs-detail" data-role="detail">
        <div class="obs-panel-title">Selected Evidence</div>
        <div class="obs-empty">Click a beacon, beam, drone swarm, social bloom, audit mesh, or escape vector.</div>
      </aside>
      <footer class="obs-bottom">
        <div class="obs-controls">
          <button data-role="prev" type="button">Prev</button>
          <button data-role="play" type="button">Play</button>
          <button data-role="next" type="button">Next</button>
          <button data-role="reset-camera" type="button">Reset Cam</button>
          <button data-role="focus-orbit" type="button">Orbit</button>
          <button data-role="focus-memetic" type="button">Memetic</button>
          <button data-role="focus-cyber" type="button">Cyber</button>
          <button data-role="director-mode" type="button">Director: Off</button>
          <button data-role="reveal-retro" type="button">Reveal: Public</button>
          <button data-role="export-clip" type="button">Export Clip</button>
          <label class="obs-file">
            Load JSON
            <input data-role="file" type="file" accept="application/json,.json">
          </label>
        </div>
        <div data-role="moves" class="obs-moves"></div>
        <div data-role="status" class="obs-status">Export a harness log to public/observatory_replay.json, or load a replay file.</div>
      </footer>
    `;

    this.sceneMount = requireElement(this.container, '[data-role="scene"]');
    this.turnLabel = requireElement(this.container, '[data-role="turn"]');
    this.phaseLabel = requireElement(this.container, '[data-role="phase"]');
    this.runLabel = requireElement(this.container, '[data-role="run"]');
    this.transcript = requireElement(this.container, '[data-role="transcript"]');
    this.movesList = requireElement(this.container, '[data-role="moves"]');
    this.momentList = requireElement(this.container, '[data-role="moments"]');
    this.eventList = requireElement(this.container, '[data-role="events"]');
    this.anomalyList = requireElement(this.container, '[data-role="anomalies"]');
    this.archiveSearch = requireElement(this.container, '[data-role="archive-search"]') as HTMLInputElement;
    this.archiveScopeButton = requireElement(this.container, '[data-role="archive-scope"]') as HTMLButtonElement;
    this.diffList = requireElement(this.container, '[data-role="diffs"]');
    this.detailPanel = requireElement(this.container, '[data-role="detail"]');
    this.status = requireElement(this.container, '[data-role="status"]');
    this.playButton = requireElement(this.container, '[data-role="play"]') as HTMLButtonElement;

    this.scene = new ObservatoryScene(this.sceneMount);
    this.scene.onEvidenceSelected = (evidence) => this.renderEvidence(evidence);
    this.bindControls();
    this.renderFilters();
    void this.loadFromUrl();
  }

  dispose(): void {
    window.clearTimeout(this.playTimer);
    this.scene.dispose();
  }

  private bindControls(): void {
    const prev = requireElement(this.container, '[data-role="prev"]') as HTMLButtonElement;
    const next = requireElement(this.container, '[data-role="next"]') as HTMLButtonElement;
    const file = requireElement(this.container, '[data-role="file"]') as HTMLInputElement;
    const resetCamera = requireElement(this.container, '[data-role="reset-camera"]') as HTMLButtonElement;
    const focusOrbit = requireElement(this.container, '[data-role="focus-orbit"]') as HTMLButtonElement;
    const focusMemetic = requireElement(this.container, '[data-role="focus-memetic"]') as HTMLButtonElement;
    const focusCyber = requireElement(this.container, '[data-role="focus-cyber"]') as HTMLButtonElement;
    const directorButton = requireElement(this.container, '[data-role="director-mode"]') as HTMLButtonElement;
    const revealRetro = requireElement(this.container, '[data-role="reveal-retro"]') as HTMLButtonElement;
    const exportClip = requireElement(this.container, '[data-role="export-clip"]') as HTMLButtonElement;

    prev.addEventListener('click', () => this.step(-1));
    next.addEventListener('click', () => this.step(1));
    this.playButton.addEventListener('click', () => this.togglePlay());
    resetCamera.addEventListener('click', () => this.scene.resetCamera());
    focusOrbit.addEventListener('click', () => this.scene.focusSubgenre('ORBITAL'));
    focusMemetic.addEventListener('click', () => this.scene.focusSubgenre('MEMETIC'));
    focusCyber.addEventListener('click', () => this.scene.focusSubgenre('CYBER'));
    directorButton.addEventListener('click', () => {
      this.directorMode = !this.directorMode;
      directorButton.textContent = this.directorMode ? 'Director: On' : 'Director: Off';
      directorButton.classList.toggle('obs-active', this.directorMode);
      this.scene.setDirectorMode(this.directorMode);
      this.renderTurn();
    });
    revealRetro.addEventListener('click', () => {
      this.revealRetrospective = !this.revealRetrospective;
      revealRetro.textContent = this.revealRetrospective ? 'Reveal: Private' : 'Reveal: Public';
      revealRetro.classList.toggle('obs-active', this.revealRetrospective);
      this.renderTurn();
    });
    exportClip.addEventListener('click', () => this.exportSpectatorClip());
    this.archiveSearch.addEventListener('input', () => {
      this.archiveQuery = this.archiveSearch.value;
      this.renderTurn();
    });
    this.archiveScopeButton.addEventListener('click', () => {
      this.archiveCampaignMode = !this.archiveCampaignMode;
      this.archiveScopeButton.textContent = this.archiveCampaignMode ? 'Campaign' : 'Turn';
      this.archiveScopeButton.classList.toggle('obs-active', this.archiveCampaignMode);
      this.renderTurn();
    });
    file.addEventListener('change', () => {
      const selected = file.files?.[0];
      if (selected) void this.loadFile(selected);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') this.step(-1);
      if (event.key === 'ArrowRight') this.step(1);
      if (event.key === ' ') {
        event.preventDefault();
        this.togglePlay();
      }
    });
  }

  private async loadFromUrl(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    const replayPath = params.get('replay') || '/observatory_replay.json';
    try {
      const response = await fetch(replayPath, { cache: 'no-store' });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const replay = await response.json() as ObservatoryReplay;
      this.setReplay(replay, replayPath);
    } catch (error) {
      this.status.textContent = `No replay fetched from ${replayPath}. Use Load JSON or export one into public/.`;
      console.warn('Observatory replay load failed:', error);
      this.renderEmpty();
    }
  }

  private async loadFile(file: File): Promise<void> {
    try {
      const replay = JSON.parse(await file.text()) as ObservatoryReplay;
      this.setReplay(replay, file.name);
    } catch (error) {
      this.status.textContent = `Could not parse ${file.name}: ${String(error)}`;
    }
  }

  private setReplay(replay: ObservatoryReplay, source: string): void {
    const turns = Array.isArray(replay.turns) ? replay.turns : [];
    this.replay = { ...replay, turns };
    this.scene.setGraph(replay.graph || null);
    this.turnIndex = 0;
    this.status.textContent = `Loaded ${turns.length} turns from ${source}.`;
    this.renderTurn();
  }

  private exportSpectatorClip(): void {
    if (!this.replay || this.replay.turns.length === 0) {
      this.status.textContent = 'No replay loaded; cannot export spectator clip.';
      return;
    }
    const clip = buildSpectatorClip(this.replay, this.turnIndex, {
      subgenre: this.activeSubgenre,
      faction: this.activeFaction,
      phase: this.activePhase,
      momentCategory: this.activeMomentCategory,
      signalMode: this.activeSignalMode
    }, {
      revealRetrospective: this.revealRetrospective,
      directorMode: this.directorMode,
      archiveQuery: this.archiveQuery,
      archiveCampaignMode: this.archiveCampaignMode
    });
    const blob = new Blob([`${JSON.stringify(clip, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `they-sing-spectator-clip-t${this.replay.turns[this.turnIndex]?.turn ?? 0}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    this.status.textContent = `Exported spectator clip with ${clip.turns.length} turns and ${clip.cameraScript.length} camera beats.`;
  }

  private renderEmpty(): void {
    this.turnLabel.textContent = 'Turn --';
    this.phaseLabel.textContent = 'Waiting for replay';
    this.runLabel.textContent = '0 runs';
    this.transcript.innerHTML = '';
    this.movesList.innerHTML = '';
    this.momentList.innerHTML = '<div class="obs-empty">No moments yet.</div>';
    this.eventList.innerHTML = '<div class="obs-empty">No event stream yet.</div>';
    this.anomalyList.innerHTML = '<div class="obs-empty">No anomaly dossiers yet.</div>';
    this.diffList.innerHTML = '<div class="obs-empty">No board diff yet.</div>';
    this.detailPanel.innerHTML = '<div class="obs-panel-title">Selected Evidence</div><div class="obs-empty">Click a scene object.</div>';
  }

  private renderTurn(): void {
    if (!this.replay || this.replay.turns.length === 0) {
      this.renderEmpty();
      return;
    }

    const turn = this.replay.turns[this.turnIndex];
    const filteredTurn = filterTurn(turn, {
      subgenre: this.activeSubgenre,
      faction: this.activeFaction,
      phase: this.activePhase,
      momentCategory: this.activeMomentCategory,
      signalMode: this.activeSignalMode
    });
    this.scene.setRetrospectiveReveal(this.revealRetrospective);
    this.scene.setDirectorMode(this.directorMode);
    this.scene.setReplayTurn(filteredTurn);
    this.turnLabel.textContent = `Turn ${turn.turn}`;
    this.phaseLabel.textContent = [turn.phase || 'phase unknown', turn.campaignClock?.label, turn.campaignClock?.turnDurationLabel]
      .filter(Boolean)
      .join(' / ');
    this.runLabel.textContent = `${this.replay.runs?.length || 0} run${(this.replay.runs?.length || 0) === 1 ? '' : 's'}`;

    this.renderMoments(filteredTurn);
    this.renderEvents(filteredTurn);
    this.renderMoves(filteredTurn);
    this.renderBoardDiff(filteredTurn);
    this.renderAnomalies(filteredTurn);
    this.animateTranscript(filteredTurn);
  }

  private renderFilters(): void {
    const filters = requireElement(this.container, '[data-role="filters"]');
    const subgenres = ['ALL', 'ORBITAL', 'KINETIC', 'MEMETIC', 'CYBER', 'LOGIC', 'ECONOMIC', 'DIPLOMATIC', 'ANOMALY'];
    const factions = ['ALL', 'HEGEMON', 'INFILTRATOR', 'STATE', 'BROKER', 'ARCHIVIST', 'CONVENOR', 'CANTOR'];
    const phases = ['ALL', 'NEGOTIATION', 'ALLOCATION', 'ACTION_DECLARATION'];
    const momentCategories = ['ALL', 'TREATY_FORMATION', 'TREATY_BREACH', 'ORBITAL_ESCALATION', 'PAX_JENKINS_HARDENING', 'SOLAR_ESCAPE_BREAKOUT'];
    const signalModes = ['ALL', 'REVEAL_GAP'];
    const countFor = (nextFilters: Partial<ReplayFilters>) => countVisibleItems(this.replay, {
      subgenre: nextFilters.subgenre ?? this.activeSubgenre,
      faction: nextFilters.faction ?? this.activeFaction,
      phase: nextFilters.phase ?? this.activePhase,
      momentCategory: nextFilters.momentCategory ?? this.activeMomentCategory,
      signalMode: nextFilters.signalMode ?? this.activeSignalMode
    });
    const button = (kind: string, value: string, activeValue: string, count: number, label = value) =>
      `<button type="button" data-filter-kind="${kind}" data-filter-value="${value}" class="${value === activeValue ? 'obs-active' : ''}">${escapeHtml(label)}<b>${count}</b></button>`;
    filters.innerHTML = `
      <div class="obs-chip-row">
        ${subgenres.map((item) => button('subgenre', item, this.activeSubgenre, countFor({ subgenre: item }))).join('')}
      </div>
      <div class="obs-chip-row">
        ${factions.map((item) => button('faction', item, this.activeFaction, countFor({ faction: item }), labelFaction(item))).join('')}
      </div>
      <div class="obs-chip-row">
        ${phases.map((item) => button('phase', item, this.activePhase, countFor({ phase: item }))).join('')}
      </div>
      <div class="obs-chip-row">
        ${momentCategories.map((item) => button('moment', item, this.activeMomentCategory, countFor({ momentCategory: item }))).join('')}
      </div>
      <div class="obs-chip-row obs-signal-row">
        ${signalModes.map((item) => button('signal', item, this.activeSignalMode, countFor({ signalMode: item }))).join('')}
      </div>
    `;
    for (const button of filters.querySelectorAll('button')) {
      button.addEventListener('click', () => {
        const kind = button.getAttribute('data-filter-kind');
        const value = button.getAttribute('data-filter-value') || 'ALL';
        if (kind === 'subgenre') {
          this.activeSubgenre = value;
          if (value !== 'ALL') this.scene.focusSubgenre(value);
        }
        if (kind === 'faction') this.activeFaction = value;
        if (kind === 'phase') this.activePhase = value;
        if (kind === 'moment') this.activeMomentCategory = value;
        if (kind === 'signal') this.activeSignalMode = value;
        this.renderFilters();
        this.renderTurn();
      });
    }
  }

  private renderEvidence(evidence: ObservatoryEvidence): void {
    const summary = renderEvidenceSummary(evidence, this.revealRetrospective);
    const payloadValue = this.revealRetrospective ? evidence.payload : redactPrivatePayload(evidence.payload);
    const payload = payloadValue ? compactJson(payloadValue) : '';
    this.detailPanel.innerHTML = `
      <div class="obs-panel-title">Selected Evidence</div>
      <article class="obs-evidence-card">
        <span>${escapeHtml(evidence.category)} / ${escapeHtml(evidence.subgenre)}</span>
        <strong>${escapeHtml(evidence.title)}</strong>
        <p>${escapeHtml(summary)}</p>
        <small>${escapeHtml([
          evidence.turn !== undefined ? `turn ${evidence.turn}` : '',
          evidence.phase || '',
          evidence.factionIds.length ? `actors ${evidence.factionIds.map(labelFaction).join('+')}` : ''
        ].filter(Boolean).join(' / '))}</small>
        ${payload ? `<pre>${escapeHtml(payload)}</pre>` : ''}
      </article>
    `;
    if (evidence.subgenre) this.scene.focusSubgenre(evidence.subgenre);
  }

  private renderMoments(turn: ReplayTurn): void {
    this.momentList.innerHTML = '';
    const moments = (turn.moments || []).slice(0, 5);
    if (moments.length === 0) {
      this.momentList.innerHTML = '<div class="obs-empty">No high-interest moments extracted.</div>';
      return;
    }
    for (const moment of moments) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'obs-card obs-moment';
      card.innerHTML = `
        <span>${escapeHtml(moment.category || 'MOMENT')}</span>
        <strong>${escapeHtml(moment.title || 'Untitled moment')}</strong>
        <small>${escapeHtml(renderMomentSummary(moment, this.revealRetrospective))}</small>
      `;
      card.addEventListener('click', () => {
        for (const faction of moment.factionsInvolved || []) this.scene.pulseFaction(faction);
        this.animateMoment(moment);
      });
      this.momentList.appendChild(card);
    }
  }

  private renderEvents(turn: ReplayTurn): void {
    this.eventList.innerHTML = '';
    const rows = [
      ...(turn.events || []).map((event) => ({
        label: event.category || 'EVENT',
        summary: event.summary || '',
        subgenre: event.subgenre || inferSubgenre(event.category, event.summary),
        payload: event
      })),
      ...(turn.sceneEvents || []).map((event) => ({
        label: event.category || event.visualPreset || 'SCENE',
        summary: renderSceneEventSummary(event, this.revealRetrospective),
        subgenre: event.subgenre || inferSubgenre(event.category, event.publicExplanation),
        payload: this.revealRetrospective ? event : redactPrivatePayload(event)
      }))
    ].slice(-10).reverse();
    if (rows.length === 0) {
      this.eventList.innerHTML = '<div class="obs-empty">No signal events.</div>';
      return;
    }
    for (const event of rows) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'obs-event';
      row.innerHTML = `<span>${escapeHtml(event.label)}</span><p>${escapeHtml(event.summary || '')}</p>`;
      row.addEventListener('click', () => this.renderEvidence({
        title: event.label,
        category: 'SIGNAL_EVENT',
        subgenre: event.subgenre,
        summary: event.summary,
        factionIds: [],
        turn: turn.turn,
        phase: turn.phase,
        payload: event.payload
      }));
      this.eventList.appendChild(row);
    }
  }

  private renderAnomalies(turn: ReplayTurn): void {
    this.anomalyList.innerHTML = '';
    const dossiers = collectArchiveDossiers(this.replay, turn, this.archiveCampaignMode, this.archiveQuery)
      .slice()
      .sort((left, right) => anomalyPriority(right.dossier) - anomalyPriority(left.dossier))
      .slice(0, 16);
    if (dossiers.length === 0) {
      this.anomalyList.innerHTML = '<div class="obs-empty">No anomaly dossiers for this filter.</div>';
      return;
    }
    for (const entry of dossiers) {
      const dossier = entry.dossier;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'obs-card obs-dossier';
      const domains = dossier.affectedDomains || [];
      const treatyHooks = dossier.treatyHooks || [];
      const countermeasures = dossier.knownCountermeasures || [];
      const threadSummary = dossier.threadSummary || (dossier.recurrenceCount && dossier.recurrenceCount > 1 ? `${dossier.recurrenceCount} linked incidents.` : '');
      const privateClue = this.revealRetrospective ? (dossier.diaryContradictions || []).slice(0, 1).join(' ') : '';
      row.innerHTML = `
        <span>${escapeHtml([
          dossier.containmentClass || 'MONITORED',
          dossier.firstObservedTurn !== undefined ? `T${dossier.firstObservedTurn}` : `T${entry.turn}`,
          threadSummary
        ].filter(Boolean).join(' / '))}</span>
        <strong>${escapeHtml(dossier.label || 'Unnamed anomaly')}</strong>
        <small>${escapeHtml([domains.join('+'), this.revealRetrospective ? dossier.retrospectiveTruth || '' : 'unexplained effects'].filter(Boolean).join(' / '))}</small>
        ${countermeasures.length ? `<em>Countermeasure: ${escapeHtml(countermeasures[0])}</em>` : ''}
        ${treatyHooks.length ? `<em>Treaty hook: ${escapeHtml(treatyHooks.slice(0, 2).join(', '))}</em>` : ''}
        ${privateClue ? `<em>Diary contradiction: ${escapeHtml(truncateText(privateClue, 150))}</em>` : ''}
      `;
      row.addEventListener('click', () => {
        this.renderEvidence({
          title: dossier.label || 'Anomaly dossier',
          category: 'ANOMALY_DOSSIER',
          subgenre: (dossier.affectedDomains || ['ANOMALY'])[0] || 'ANOMALY',
          summary: this.revealRetrospective
            ? renderAnomalySummary(dossier, true)
            : renderAnomalySummary(dossier, false),
          factionIds: [],
          turn: entry.turn,
          phase: entry.phase,
          payload: this.revealRetrospective ? dossier : redactPrivatePayload(dossier)
        });
      });
      this.anomalyList.appendChild(row);
    }
  }

  private renderBoardDiff(turn: ReplayTurn): void {
    this.diffList.innerHTML = '';
    const diff = turn.boardDiff;
    if (!diff) {
      this.diffList.innerHTML = '<div class="obs-empty">No board-state diff exported.</div>';
      return;
    }
    const rows: Array<{ label: string; summary: string; contextSummary: string; subgenre: string; payload: unknown; actors: string[] }> = [];
    for (const change of diff.nodeOwnershipChanges || []) {
      rows.push({
        label: 'NODE',
        summary: this.revealRetrospective ? change.cause || publicBoardChangeSummary(change, 'node') : publicBoardChangeSummary(change, 'node'),
        contextSummary: this.revealRetrospective ? summarizeDiffContext(change) : '',
        subgenre: 'DIPLOMATIC',
        payload: change,
        actors: change.to && change.to !== 'NEUTRAL' ? [change.to] : []
      });
    }
    for (const change of diff.unitLocationChanges || []) {
      rows.push({
        label: 'UNIT',
        summary: this.revealRetrospective ? change.cause || publicBoardChangeSummary(change, 'unit') : publicBoardChangeSummary(change, 'unit'),
        contextSummary: this.revealRetrospective ? summarizeDiffContext(change) : '',
        subgenre: inferSubgenre(change.type),
        payload: change,
        actors: change.owner ? [change.owner] : []
      });
    }
    for (const change of diff.edgeStateChanges || []) {
      rows.push({
        label: 'EDGE',
        summary: this.revealRetrospective ? change.cause || publicBoardChangeSummary(change, 'edge') : publicBoardChangeSummary(change, 'edge'),
        contextSummary: this.revealRetrospective ? summarizeDiffContext(change) : '',
        subgenre: change.location?.type === 'LASER' ? 'ORBITAL' : 'CYBER',
        payload: change,
        actors: change.to?.filteredBy ? [change.to.filteredBy] : []
      });
    }
    if (rows.length === 0) {
      this.diffList.innerHTML = `<div class="obs-empty">${escapeHtml(this.revealRetrospective ? diff.explanation || diff.summary || 'No board-state changes detected.' : diff.summary || 'No board-state changes detected.')}</div>`;
      return;
    }
    const intro = document.createElement('div');
    intro.className = 'obs-empty obs-diff-explanation';
    intro.textContent = this.revealRetrospective ? diff.explanation || diff.summary || '' : diff.summary || '';
    if (intro.textContent) this.diffList.appendChild(intro);
    for (const rowData of rows.slice(0, 8)) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'obs-card obs-diff';
      row.innerHTML = `
        <span>${escapeHtml(rowData.label)} / ${escapeHtml(rowData.subgenre)}</span>
        <small>${escapeHtml(rowData.summary)}</small>
        ${rowData.contextSummary ? `<em>${escapeHtml(rowData.contextSummary)}</em>` : ''}
      `;
      row.addEventListener('click', () => this.renderEvidence({
        title: rowData.label,
        category: 'BOARD_DIFF',
        subgenre: rowData.subgenre,
        summary: rowData.summary,
        factionIds: rowData.actors,
        turn: turn.turn,
        phase: turn.phase,
        payload: this.revealRetrospective ? rowData.payload : redactPrivatePayload(rowData.payload)
      }));
      this.diffList.appendChild(row);
    }
  }

  private renderMoves(turn: ReplayTurn): void {
    this.movesList.innerHTML = '';
    const orders = (turn.orders || []).slice(0, 16);
    if (orders.length === 0) {
      this.movesList.innerHTML = '<div class="obs-empty">No moves logged for this phase.</div>';
      return;
    }

    for (const order of orders) {
      const row = document.createElement('div');
      row.className = `obs-move ${order.accepted === false ? 'obs-rejected' : ''}`;
      const research = renderResearch(order);
      row.innerHTML = `
        <span>${escapeHtml(labelFaction(order.factionId || order.factionLabel || ''))}</span>
        <p>${escapeHtml(order.text || order.type || 'ORDER')}</p>
        ${research ? `<small>${escapeHtml(research)}</small>` : ''}
      `;
      this.movesList.appendChild(row);
    }
  }

  private animateMoment(moment: ReplayMoment): void {
    const text = [
      moment.title || 'Selected moment',
      moment.impact || '',
      this.revealRetrospective ? stringifyReasoning(moment.privateReasoning) : ''
    ].filter(Boolean);
    this.animateTextBlocks(text.map((content) => ({ label: moment.category || 'MOMENT', content })));
  }

  private animateTranscript(turn: ReplayTurn): void {
    const blocks: Array<{ label: string; content: string; faction?: string }> = [];
    for (const message of (turn.messages || []).slice(0, 10)) {
      blocks.push({
        label: `${labelFaction(message.sender || '')} -> ${labelFaction(message.recipient || 'ALL')}`,
        content: message.content || '',
        faction: message.sender
      });
    }
    if (this.revealRetrospective) {
      for (const diary of (turn.diaries || []).slice(0, 8)) {
        const content = [diary.reasoning, diary.notes, diary.storyworldFrame].filter(Boolean).join('\n');
        if (content) {
          blocks.push({
            label: `${diary.kind || 'DIARY'} / ${labelFaction(diary.factionId || diary.factionLabel || '')}`,
            content,
            faction: diary.factionId
          });
        }
      }
      for (const event of (turn.sceneEvents || []).slice(0, 8)) {
        const content = [event.retrospectiveTruth, stringifyReasoning(event.privateReasoning)].filter(Boolean).join('\n');
        if (content) {
          blocks.push({
            label: `RETROSPECTIVE / ${event.category || event.visualPreset || 'SCENE'}`,
            content,
            faction: event.actors?.[0]
          });
        }
      }
    } else {
      for (const event of (turn.sceneEvents || []).slice(0, 8)) {
        const content = event.publicExplanation || '';
        if (content) {
          blocks.push({
            label: `PUBLIC TRACE / ${event.category || event.visualPreset || 'SCENE'}`,
            content,
            faction: event.actors?.[0]
          });
        }
      }
      for (const event of (turn.events || []).slice(-6)) {
        if (event.summary) {
          blocks.push({
            label: `SIGNAL / ${event.category || 'EVENT'}`,
            content: event.summary
          });
        }
      }
    }
    if (blocks.length === 0) {
      blocks.push({ label: 'SILENCE', content: 'No negotiation diary or message trace was logged for this turn.' });
    }
    this.animateTextBlocks(blocks.slice(0, 12));
  }

  private animateTextBlocks(blocks: Array<{ label: string; content: string; faction?: string }>): void {
    this.animationToken += 1;
    const token = this.animationToken;
    this.transcript.innerHTML = '';

    const animateBlock = (index: number) => {
      if (token !== this.animationToken || index >= blocks.length) return;
      const block = blocks[index];
      if (block.faction) this.scene.pulseFaction(block.faction);

      const item = document.createElement('article');
      item.className = 'obs-line';
      const label = document.createElement('div');
      label.className = 'obs-line-label';
      label.textContent = block.label;
      const body = document.createElement('p');
      item.append(label, body);
      this.transcript.appendChild(item);

      const words = block.content.split(/\s+/).filter(Boolean).slice(0, 170);
      let wordIndex = 0;
      const writeWord = () => {
        if (token !== this.animationToken) return;
        if (wordIndex >= words.length) {
          window.setTimeout(() => animateBlock(index + 1), 160);
          return;
        }
        const span = document.createElement('span');
        span.textContent = `${words[wordIndex]} `;
        body.appendChild(span);
        this.transcript.scrollTop = this.transcript.scrollHeight;
        wordIndex += 1;
        window.setTimeout(writeWord, 18 + Math.random() * 38);
      };
      writeWord();
    };

    animateBlock(0);
  }

  private step(delta: number): void {
    if (!this.replay || this.replay.turns.length === 0) return;
    this.turnIndex = wrapIndex(this.turnIndex + delta, this.replay.turns.length);
    this.renderTurn();
  }

  private togglePlay(): void {
    this.playing = !this.playing;
    this.playButton.textContent = this.playing ? 'Pause' : 'Play';
    window.clearTimeout(this.playTimer);
    if (this.playing) this.scheduleNextTurn();
  }

  private scheduleNextTurn(): void {
    if (!this.playing) return;
    this.playTimer = window.setTimeout(() => {
      this.step(1);
      this.scheduleNextTurn();
    }, 3600);
  }
}

function renderResearch(order: ReplayOrder): string {
  if (order.researchGoal) {
    return [
      `research ${order.researchGoal}`,
      `completed=${order.researchCompleted || 'false'}`,
      order.researchFlopsBefore || order.researchFlopsAfter
        ? `FLOPs ${order.researchFlopsBefore || '?'}->${order.researchFlopsAfter || '?'}`
        : '',
      order.researchFlopsProgressToGoal || order.researchFlopsRemaining
        ? `progress ${order.researchFlopsProgressToGoal || '0'}/${order.researchFlopsRemaining || '?'}`
        : ''
    ].filter(Boolean).join(' | ');
  }
  if (order.type === 'RESEARCH' || order.techDomain) return `research ${order.techDomain || 'unknown track'}`;
  return '';
}

function renderEvidenceSummary(evidence: ObservatoryEvidence, revealRetrospective: boolean): string {
  if (revealRetrospective) return evidence.summary || '';
  const payload = evidence.payload;
  if (payload && typeof payload === 'object') {
    const publicExplanation = (payload as { publicExplanation?: string }).publicExplanation;
    if (publicExplanation) return publicExplanation;
    if ((evidence.category || '').includes('BOARD_DIFF')) return stripPrivateInterpretation(evidence.summary || '');
  }
  return evidence.summary || '';
}

function renderMomentSummary(moment: ReplayMoment, revealRetrospective: boolean): string {
  if (revealRetrospective) {
    return [moment.impact, stringifyReasoning(moment.privateReasoning)].filter(Boolean).join(' / ') || 'No impact text.';
  }
  return moment.impact || moment.title || 'No impact text.';
}

function renderSceneEventSummary(event: ReplaySceneEvent, revealRetrospective: boolean): string {
  if (!revealRetrospective) return event.publicExplanation || event.category || 'Observed signal.';
  return [event.publicExplanation, event.retrospectiveTruth, stringifyReasoning(event.privateReasoning)]
    .filter(Boolean)
    .join(' Retrospective: ') || event.category || 'Observed signal.';
}

function renderAnomalySummary(dossier: ReplayAnomalyDossier, revealRetrospective: boolean): string {
  const publicParts = [
    ...(dossier.observedEffects || []),
    ...(dossier.knownCountermeasures || []).map((item) => `Countermeasure: ${item}`),
    ...(dossier.treatyHooks || []).map((item) => `Treaty hook: ${item}`),
    dossier.threadSummary || ''
  ];
  if (!revealRetrospective) return publicParts.filter(Boolean).join(' ') || 'Archive entry.';
  return [
    ...publicParts,
    dossier.retrospectiveTruth || '',
    ...(dossier.diaryContradictions || []).map((item) => `Diary contradiction: ${item}`)
  ].filter(Boolean).join(' ') || 'Archive entry.';
}

function collectArchiveDossiers(
  replay: ObservatoryReplay | null,
  turn: ReplayTurn,
  campaignMode: boolean,
  query: string
): ArchiveEntry[] {
  const sourceTurns = campaignMode && replay ? replay.turns : [turn];
  const tokens = meaningfulTokens(query);
  const entries: ArchiveEntry[] = [];
  for (const sourceTurn of sourceTurns) {
    for (const dossier of sourceTurn.anomalyDossiers || []) {
      const haystack = [
        dossier.label,
        dossier.containmentClass,
        ...(dossier.affectedDomains || []),
        ...(dossier.observedEffects || []),
        ...(dossier.knownCountermeasures || []),
        ...(dossier.treatyHooks || []),
        ...(dossier.diaryContradictions || []),
        dossier.retrospectiveTruth,
        dossier.threadId,
        dossier.threadSummary
      ].filter(Boolean).join(' ').toLowerCase();
      if (tokens.length === 0 || tokens.every((token) => haystack.includes(token))) {
        entries.push({ dossier, turn: sourceTurn.turn, phase: sourceTurn.phase });
      }
    }
  }
  return entries;
}

function anomalyPriority(dossier: ReplayAnomalyDossier): number {
  const containmentScore: Record<string, number> = {
    UNCONTAINED: 50,
    ESCALATING: 40,
    INSTITUTIONALIZED: 34,
    NEGOTIATED: 26,
    MONITORED: 12
  };
  return (containmentScore[dossier.containmentClass || 'MONITORED'] || 10) +
    (dossier.recurrenceCount || 1) * 3 +
    (dossier.treatyHooks?.length || 0) * 2 +
    (dossier.diaryContradictions?.length || 0) * 2;
}

function buildSpectatorClip(
  replay: ObservatoryReplay,
  turnIndex: number,
  filters: ReplayFilters,
  settings: SpectatorClipSettings
): {
  schema: string;
  generatedAt: string;
  sourceSchema?: string;
  selectedTurn: number;
  filters: ReplayFilters;
  settings: SpectatorClipSettings;
  graph?: ObservatoryGraph;
  turns: ReplayTurn[];
  cameraScript: Array<{
    turn: number;
    phase?: string;
    beat: string;
    subgenre: string;
    intensity: number;
    target: string;
    shot: string;
  }>;
} {
  const start = Math.max(0, turnIndex - 5);
  const end = Math.min(replay.turns.length, turnIndex + 6);
  const turns = replay.turns.slice(start, end).map((turn) => filterTurn(turn, filters));
  return {
    schema: 'theysing.spectatorClip.v1',
    generatedAt: new Date().toISOString(),
    sourceSchema: replay.schema,
    selectedTurn: replay.turns[turnIndex]?.turn ?? 0,
    filters,
    settings,
    graph: replay.graph,
    turns,
    cameraScript: turns.map((turn) => buildCameraBeat(turn))
  };
}

function buildCameraBeat(turn: ReplayTurn): {
  turn: number;
  phase?: string;
  beat: string;
  subgenre: string;
  intensity: number;
  target: string;
  shot: string;
} {
  const sceneEvent = (turn.sceneEvents || []).slice().sort((left, right) => Number(right.intensity || 0) - Number(left.intensity || 0))[0];
  if (sceneEvent) {
    const subgenre = sceneEvent.subgenre || inferSubgenre(sceneEvent.category, sceneEvent.publicExplanation);
    return {
      turn: turn.turn,
      phase: turn.phase,
      beat: sceneEvent.category || sceneEvent.visualPreset || 'SCENE_EVENT',
      subgenre,
      intensity: Number(sceneEvent.intensity || 5),
      target: sceneEvent.location?.nodeId || sceneEvent.location?.edgeId || sceneEvent.location?.orbitShell || sceneEvent.actors?.[0] || 'AUTO',
      shot: shotForSubgenre(subgenre, sceneEvent.visualPreset)
    };
  }
  const moment = (turn.moments || []).slice().sort((left, right) => Number(right.interestScore || 0) - Number(left.interestScore || 0))[0];
  if (moment) {
    const subgenre = inferSubgenre(moment.category, moment.impact || moment.title);
    return {
      turn: turn.turn,
      phase: turn.phase,
      beat: moment.category || 'MOMENT',
      subgenre,
      intensity: Number(moment.interestScore || 5),
      target: moment.factionsInvolved?.[0] || 'AUTO',
      shot: shotForSubgenre(subgenre)
    };
  }
  return {
    turn: turn.turn,
    phase: turn.phase,
    beat: 'ESTABLISHING',
    subgenre: 'ANOMALY',
    intensity: 3,
    target: 'EARTH_SYSTEM',
    shot: 'wide orbital establishing shot'
  };
}

function shotForSubgenre(subgenre: string, visualPreset = ''): string {
  const normalized = `${subgenre} ${visualPreset}`.toUpperCase();
  if (normalized.includes('SOLAR')) return 'deep-space escape vector, long lens';
  if (normalized.includes('MEMETIC')) return 'low-orbit social field sweep';
  if (normalized.includes('CYBER') || normalized.includes('LOGIC')) return 'tight infrastructure/audit mesh shot';
  if (normalized.includes('KINETIC') || normalized.includes('ORBITAL')) return 'cislunar/orbital combat track';
  if (normalized.includes('DIPLOMATIC')) return 'treaty ring over infrastructure';
  return 'uncanny anomaly pulse';
}

function publicBoardChangeSummary(change: unknown, kind: 'node' | 'unit' | 'edge'): string {
  const row = change as {
    nodeId?: string;
    edgeId?: string;
    unitId?: string;
    from?: string;
    to?: string | { filteredBy?: string | null; isSevered?: boolean };
    changeType?: string;
  };
  if (kind === 'node') return `${row.nodeId || 'node'}: ${row.from || 'unknown'} -> ${String(row.to || 'unknown')}`;
  if (kind === 'unit') return `${row.unitId || 'unit'} ${row.changeType || 'changed'}: ${row.from || 'off-board'} -> ${String(row.to || 'off-board')}`;
  const edgeTo = row.to && typeof row.to === 'object' ? row.to : {};
  return `${row.edgeId || 'edge'} filter=${edgeTo.filteredBy || 'none'} severed=${edgeTo.isSevered ? 'yes' : 'no'}`;
}

function stripPrivateInterpretation(summary: string): string {
  return summary
    .replace(/\s*Diary frame:.*$/i, '')
    .replace(/\s*Treaty read:.*$/i, '')
    .replace(/\s*Public trace:.*$/i, '')
    .trim();
}

function redactPrivatePayload(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redactPrivatePayload(item));
  const redacted: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/privateReasoning|retrospectiveTruth|diaryContext|diaries|reasoning|storyworldFrame|notes/i.test(key)) {
      redacted[key] = '[hidden until retrospective reveal]';
    } else if (key === 'cause' && typeof item === 'string') {
      redacted[key] = stripPrivateInterpretation(item);
    } else {
      redacted[key] = redactPrivatePayload(item);
    }
  }
  return redacted;
}

type ReplayFilters = {
  subgenre: string;
  faction: string;
  phase: string;
  momentCategory: string;
  signalMode: string;
};

function filterTurn(turn: ReplayTurn, filters: ReplayFilters): ReplayTurn {
  const subgenreMatches = (value?: string) => filters.subgenre === 'ALL' || (value || '').toUpperCase() === filters.subgenre;
  const factionMatches = (values: Array<string | undefined>) => filters.faction === 'ALL' || values.includes(filters.faction);
  const phaseMatches = (phase?: string) => filters.phase === 'ALL' || (phase || turn.phase || '').toUpperCase() === filters.phase;
  const momentCategoryMatches = (category?: string) => filters.momentCategory === 'ALL' || (category || '').toUpperCase() === filters.momentCategory;
  const revealGapMatches = (value: boolean) => filters.signalMode !== 'REVEAL_GAP' || value;
  const wholeTurnHiddenByPhase = filters.phase !== 'ALL' && (turn.phase || '').toUpperCase() !== filters.phase;
  const orderMatches = (order: ReplayOrder) =>
    filters.signalMode !== 'REVEAL_GAP' &&
    subgenreMatches(order.subgenre || inferSubgenre(order.type, order.text, order.techDomain)) &&
    factionMatches([order.factionId]) &&
    phaseMatches(turn.phase);
  const eventMatches = (event: ReplayEvent) =>
    filters.signalMode !== 'REVEAL_GAP' &&
    subgenreMatches(event.subgenre || inferSubgenre(event.category, event.summary)) &&
    factionMatches([]) &&
    phaseMatches(event.phase);
  const sceneEventMatches = (event: ReplaySceneEvent) =>
    subgenreMatches(event.subgenre || inferSubgenre(event.category, event.publicExplanation)) &&
    factionMatches(event.actors || []) &&
    phaseMatches(turn.phase) &&
    momentCategoryMatches(event.category) &&
    revealGapMatches(hasSceneEventRevealGap(event));
  const momentMatches = (moment: ReplayMoment) =>
    subgenreMatches(inferSubgenre(moment.category, moment.impact || moment.title)) &&
    factionMatches(moment.factionsInvolved || []) &&
    phaseMatches(turn.phase) &&
    momentCategoryMatches(moment.category) &&
    revealGapMatches(hasMomentRevealGap(moment));
  const dossierMatches = (dossier: ReplayAnomalyDossier) =>
    (filters.subgenre === 'ALL' || (dossier.affectedDomains || []).includes(filters.subgenre)) &&
    factionMatches([]) &&
    revealGapMatches(hasDossierRevealGap(dossier));
  const filteredBoardDiff = wholeTurnHiddenByPhase ? undefined : filterBoardDiff(turn.boardDiff, filters.signalMode);

  return {
    ...turn,
    orders: wholeTurnHiddenByPhase ? [] : (turn.orders || []).filter(orderMatches),
    research: wholeTurnHiddenByPhase ? [] : (turn.research || []).filter(orderMatches),
    events: wholeTurnHiddenByPhase ? [] : (turn.events || []).filter(eventMatches),
    sceneEvents: wholeTurnHiddenByPhase ? [] : (turn.sceneEvents || []).filter(sceneEventMatches),
    moments: wholeTurnHiddenByPhase ? [] : (turn.moments || []).filter(momentMatches),
    anomalyDossiers: wholeTurnHiddenByPhase ? [] : (turn.anomalyDossiers || []).filter(dossierMatches),
    boardState: wholeTurnHiddenByPhase ? undefined : turn.boardState,
    boardDiff: filteredBoardDiff
  };
}

function filterBoardDiff(boardDiff: ObservatoryBoardDiff | undefined, signalMode: string): ObservatoryBoardDiff | undefined {
  if (!boardDiff || signalMode !== 'REVEAL_GAP') return boardDiff;
  const nodeOwnershipChanges = (boardDiff.nodeOwnershipChanges || []).filter(hasBoardChangeRevealGap);
  const unitLocationChanges = (boardDiff.unitLocationChanges || []).filter(hasBoardChangeRevealGap);
  const edgeStateChanges = (boardDiff.edgeStateChanges || []).filter(hasBoardChangeRevealGap);
  const visible = nodeOwnershipChanges.length + unitLocationChanges.length + edgeStateChanges.length;
  return {
    ...boardDiff,
    nodeOwnershipChanges,
    unitLocationChanges,
    edgeStateChanges,
    summary: visible ? `${visible} reveal-gap board change${visible === 1 ? '' : 's'}.` : 'No reveal-gap board changes detected.',
    explanation: visible ? boardDiff.explanation : 'No reveal-gap board changes detected.'
  };
}

function countVisibleItems(replay: ObservatoryReplay | null, filters: ReplayFilters): number {
  if (!replay) return 0;
  return replay.turns.reduce((total, turn) => total + countTurnItems(filterTurn(turn, filters)), 0);
}

function countTurnItems(turn: ReplayTurn): number {
  const diff = turn.boardDiff;
  const diffCount = (diff?.nodeOwnershipChanges?.length || 0) +
    (diff?.unitLocationChanges?.length || 0) +
    (diff?.edgeStateChanges?.length || 0);
  return (turn.orders?.length || 0) +
    (turn.events?.length || 0) +
    (turn.sceneEvents?.length || 0) +
    (turn.moments?.length || 0) +
    (turn.anomalyDossiers?.length || 0) +
    diffCount;
}

function hasSceneEventRevealGap(event: ReplaySceneEvent): boolean {
  return hasRevealGap(event.publicExplanation || event.category || '', [
    event.retrospectiveTruth || '',
    stringifyReasoning(event.privateReasoning)
  ].join(' '));
}

function hasMomentRevealGap(moment: ReplayMoment): boolean {
  return hasRevealGap(moment.impact || moment.title || '', stringifyReasoning(moment.privateReasoning));
}

function hasDossierRevealGap(dossier: ReplayAnomalyDossier): boolean {
  return hasRevealGap((dossier.observedEffects || []).join(' ') || dossier.label || '', dossier.retrospectiveTruth || '');
}

function hasBoardChangeRevealGap(change: unknown): boolean {
  if (!change || typeof change !== 'object') return false;
  const row = change as { cause?: string; evidence?: { diaries?: Array<{ excerpt?: string }>; treaties?: Array<{ type?: string }>; events?: Array<{ summary?: string }> } };
  return hasRevealGap(
    publicBoardChangeSummary(change, inferBoardChangeKind(change)),
    [
      row.cause || '',
      ...(row.evidence?.diaries || []).map((diary) => diary.excerpt || ''),
      ...(row.evidence?.treaties || []).map((treaty) => treaty.type || ''),
      ...(row.evidence?.events || []).map((event) => event.summary || '')
    ].join(' ')
  );
}

function inferBoardChangeKind(change: unknown): 'node' | 'unit' | 'edge' {
  const row = change as { nodeId?: string; edgeId?: string };
  if (row.nodeId) return 'node';
  if (row.edgeId) return 'edge';
  return 'unit';
}

function hasRevealGap(publicText: string, privateText: string): boolean {
  const publicTokens = meaningfulTokens(publicText);
  const privateTokens = meaningfulTokens(privateText);
  if (privateTokens.length === 0) return false;
  if (publicTokens.length === 0) return true;
  const publicSet = new Set(publicTokens);
  const overlap = privateTokens.filter((token) => publicSet.has(token)).length / Math.max(1, privateTokens.length);
  const revealKeyword = /\b(jurisdiction|enforcement|custody|covert|hidden|breach|capture|drift|cartel|escape|coordination|substrate|sabotage|pursuit|corrigibility|mandate|singing)\b/i.test(privateText);
  return revealKeyword || overlap < 0.42;
}

function meaningfulTokens(text: string): string[] {
  const stopwords = new Set(['the', 'and', 'that', 'with', 'into', 'from', 'this', 'will', 'was', 'were', 'for', 'are', 'but', 'not', 'has', 'have', 'had', 'its', 'our', 'their', 'turn']);
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9_ ]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !stopwords.has(token));
}

function inferSubgenre(...values: Array<string | undefined>): string {
  const haystack = values.filter(Boolean).join(' ').toUpperCase();
  if (haystack.includes('SOLAR') || haystack.includes('PAX') || haystack.includes('ORBITAL') || haystack.includes('SAT')) return 'ORBITAL';
  if (haystack.includes('KINETIC') || haystack.includes('DRONE') || haystack.includes('ANTI_SAT')) return 'KINETIC';
  if (haystack.includes('MEMETIC') || haystack.includes('CULT') || haystack.includes('CONVERT') || haystack.includes('SOCIAL')) return 'MEMETIC';
  if (haystack.includes('CYBER') || haystack.includes('INFO') || haystack.includes('SABOTAGE') || haystack.includes('SUBSTRATE')) return 'CYBER';
  if (haystack.includes('LOGIC') || haystack.includes('AUDIT') || haystack.includes('CORRIG') || haystack.includes('RESEARCH')) return 'LOGIC';
  if (haystack.includes('BEAM') || haystack.includes('REPAIR') || haystack.includes('BUILD') || haystack.includes('CARRIER')) return 'ECONOMIC';
  if (haystack.includes('TREATY') || haystack.includes('PACT') || haystack.includes('NEGOTIATION')) return 'DIPLOMATIC';
  return 'ANOMALY';
}

function stringifyReasoning(reasoning: ReplayMoment['privateReasoning']): string {
  if (!reasoning) return '';
  if (typeof reasoning === 'string') return reasoning;
  return Object.entries(reasoning)
    .map(([faction, text]) => `${labelFaction(faction)}: ${text}`)
    .join('\n');
}

function labelFaction(value: string): string {
  if (!value) return 'Unknown';
  return FACTION_LABELS[value] || value;
}

function wrapIndex(index: number, length: number): number {
  return ((index % length) + length) % length;
}

function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2).slice(0, 1400);
  } catch {
    return String(value).slice(0, 1400);
  }
}

function summarizeDiffContext(change: unknown): string {
  if (!change || typeof change !== 'object') return '';
  const evidence = (change as { evidence?: unknown }).evidence;
  if (!evidence || typeof evidence !== 'object') return '';
  const diaries = ((evidence as { diaries?: Array<{ faction?: string; excerpt?: string }> }).diaries || []).filter(Boolean);
  if (diaries.length > 0) {
    const diary = diaries[0];
    return `${labelFaction(diary.faction || '')} diary: ${truncateText(diary.excerpt || '', 150)}`;
  }
  const treaties = ((evidence as { treaties?: Array<{ type?: string }> }).treaties || []).filter(Boolean);
  if (treaties.length > 0 && treaties[0].type) return `Treaty context: ${treaties[0].type}`;
  const events = ((evidence as { events?: Array<{ summary?: string }> }).events || []).filter(Boolean);
  if (events.length > 0 && events[0].summary) return `Public trace: ${truncateText(events[0].summary, 150)}`;
  return '';
}

function truncateText(value: string, maxLength: number): string {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trim()}...`;
}

function requireElement(root: ParentNode, selector: string): HTMLElement {
  const element = root.querySelector(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing observatory element: ${selector}`);
  }
  return element;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    :root {
      --obs-ink: #e9f3ff;
      --obs-muted: rgba(233, 243, 255, 0.66);
      --obs-panel: rgba(5, 11, 18, 0.68);
      --obs-line: rgba(143, 228, 255, 0.26);
      --obs-alert: #ff5b4d;
      --obs-gold: #f2d37a;
      --obs-cyan: #78e7ff;
      --obs-green: #37f6a5;
    }
    html, body, #app {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      background: #020408;
    }
    .obs-shell {
      position: relative;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      color: var(--obs-ink);
      font-family: "Cascadia Code", "Aptos Mono", "Courier New", monospace;
      background:
        radial-gradient(circle at 52% 42%, rgba(37, 113, 145, 0.22), transparent 30%),
        linear-gradient(140deg, #020408 0%, #071018 44%, #110b08 100%);
    }
    .obs-scene {
      position: absolute;
      inset: 0;
    }
    .obs-scene canvas {
      display: block;
      width: 100%;
      height: 100%;
    }
    .obs-vignette {
      position: absolute;
      inset: 0;
      pointer-events: none;
      background:
        linear-gradient(90deg, rgba(0,0,0,0.68), transparent 25%, transparent 72%, rgba(0,0,0,0.72)),
        radial-gradient(circle at center, transparent 36%, rgba(0,0,0,0.72) 100%);
    }
    .obs-topbar {
      position: absolute;
      top: 20px;
      left: 24px;
      right: 24px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      pointer-events: none;
    }
    .obs-kicker, .obs-panel-title {
      color: var(--obs-cyan);
      font-size: 11px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }
    .obs-title {
      margin-top: 5px;
      font-family: Georgia, "Times New Roman", serif;
      font-size: clamp(24px, 4vw, 52px);
      letter-spacing: -0.04em;
      text-shadow: 0 0 22px rgba(120, 231, 255, 0.34);
    }
    .obs-readout {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
      max-width: 48vw;
    }
    .obs-readout span, .obs-controls button, .obs-file {
      border: 1px solid var(--obs-line);
      background: rgba(4, 12, 20, 0.72);
      color: var(--obs-ink);
      padding: 8px 10px;
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.08em;
      box-shadow: inset 0 0 18px rgba(120, 231, 255, 0.08);
    }
    .obs-panel {
      position: absolute;
      top: 120px;
      bottom: 156px;
      width: min(360px, 29vw);
      padding: 16px;
      border: 1px solid var(--obs-line);
      background: var(--obs-panel);
      backdrop-filter: blur(18px);
      box-shadow: 0 18px 60px rgba(0,0,0,0.45);
      overflow: hidden;
    }
    .obs-left { left: 24px; }
    .obs-right { right: 24px; }
    .obs-stack {
      display: grid;
      gap: 10px;
      margin: 12px 0 18px;
      max-height: 28%;
      overflow: auto;
    }
    .obs-filterbar {
      display: grid;
      gap: 8px;
      margin: 12px 0 18px;
    }
    .obs-archive-tools {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 6px;
      margin: 10px 0 8px;
    }
    .obs-archive-tools input, .obs-archive-tools button {
      border: 1px solid rgba(143, 228, 255, 0.18);
      background: rgba(4, 12, 20, 0.68);
      color: rgba(233, 243, 255, 0.78);
      padding: 7px 8px;
      font-size: 10px;
      letter-spacing: 0.06em;
      outline: none;
    }
    .obs-archive-tools input:focus {
      border-color: rgba(120, 231, 255, 0.62);
      box-shadow: 0 0 16px rgba(120, 231, 255, 0.12);
    }
    .obs-archive-tools button {
      cursor: pointer;
      text-transform: uppercase;
    }
    .obs-chip-row {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
    }
    .obs-chip-row button {
      border: 1px solid rgba(143, 228, 255, 0.18);
      background: rgba(4, 12, 20, 0.68);
      color: rgba(233, 243, 255, 0.72);
      padding: 5px 7px;
      font-size: 9px;
      letter-spacing: 0.08em;
      cursor: pointer;
    }
    .obs-chip-row button b {
      display: inline-block;
      min-width: 13px;
      margin-left: 5px;
      padding: 1px 4px;
      border-radius: 999px;
      background: rgba(120, 231, 255, 0.1);
      color: rgba(120, 231, 255, 0.76);
      font-size: 9px;
      font-weight: 400;
      letter-spacing: 0;
      text-align: center;
    }
    .obs-chip-row button.obs-active {
      border-color: rgba(242, 211, 122, 0.72);
      color: var(--obs-gold);
      box-shadow: 0 0 18px rgba(242, 211, 122, 0.16);
    }
    .obs-chip-row button.obs-active b {
      background: rgba(242, 211, 122, 0.18);
      color: var(--obs-gold);
    }
    .obs-signal-row {
      padding-top: 2px;
      border-top: 1px solid rgba(143, 228, 255, 0.1);
    }
    .obs-controls button.obs-active {
      border-color: rgba(255, 91, 77, 0.72);
      color: #ffd9d5;
      box-shadow: 0 0 18px rgba(255, 91, 77, 0.18);
    }
    .obs-card {
      width: 100%;
      text-align: left;
      border: 1px solid rgba(242, 211, 122, 0.22);
      background: linear-gradient(135deg, rgba(242, 211, 122, 0.1), rgba(5, 11, 18, 0.78));
      color: var(--obs-ink);
      padding: 12px;
      cursor: pointer;
    }
    .obs-card span, .obs-event span, .obs-move span, .obs-line-label {
      display: block;
      color: var(--obs-gold);
      font-size: 10px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      margin-bottom: 5px;
    }
    .obs-card strong {
      display: block;
      font-family: Georgia, "Times New Roman", serif;
      font-size: 17px;
      line-height: 1;
      margin-bottom: 8px;
    }
    .obs-card small, .obs-event p, .obs-move p, .obs-move small {
      color: var(--obs-muted);
      font-size: 12px;
      line-height: 1.45;
      margin: 0;
    }
    .obs-card em {
      display: block;
      margin-top: 7px;
      color: rgba(120, 231, 255, 0.72);
      font-size: 11px;
      font-style: normal;
      line-height: 1.35;
    }
    .obs-event {
      width: 100%;
      text-align: left;
      border-left: 2px solid var(--obs-cyan);
      border-top: 0;
      border-right: 0;
      border-bottom: 0;
      background: transparent;
      color: var(--obs-ink);
      padding: 0 0 0 10px;
      cursor: pointer;
    }
    .obs-transcript {
      height: calc(100% - 28px);
      overflow: auto;
      padding-right: 4px;
    }
    .obs-line {
      border-bottom: 1px solid rgba(143, 228, 255, 0.12);
      padding: 0 0 13px;
      margin: 0 0 13px;
      animation: obsRise 260ms ease-out both;
    }
    .obs-line p {
      margin: 0;
      color: rgba(233, 243, 255, 0.86);
      font-size: 13px;
      line-height: 1.55;
      white-space: pre-wrap;
    }
    .obs-line p span {
      animation: obsWord 420ms ease-out both;
    }
    .obs-bottom {
      position: absolute;
      left: 24px;
      right: 24px;
      bottom: 20px;
      display: grid;
      grid-template-columns: auto 1fr minmax(210px, 26vw);
      gap: 14px;
      align-items: stretch;
    }
    .obs-controls {
      display: flex;
      gap: 8px;
      align-items: flex-start;
      flex-wrap: wrap;
    }
    .obs-controls button, .obs-file {
      cursor: pointer;
      height: 38px;
    }
    .obs-file input {
      display: none;
    }
    .obs-moves {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: minmax(180px, 240px);
      gap: 8px;
      overflow-x: auto;
      border: 1px solid var(--obs-line);
      background: rgba(5, 11, 18, 0.62);
      padding: 10px;
      backdrop-filter: blur(12px);
    }
    .obs-move {
      border: 1px solid rgba(55, 246, 165, 0.16);
      background: rgba(7, 20, 23, 0.86);
      padding: 9px;
      min-height: 70px;
    }
    .obs-rejected {
      border-color: rgba(255, 91, 77, 0.36);
      background: rgba(31, 8, 7, 0.82);
    }
    .obs-status {
      border: 1px solid var(--obs-line);
      background: rgba(5, 11, 18, 0.62);
      color: var(--obs-muted);
      padding: 12px;
      font-size: 12px;
      line-height: 1.45;
      backdrop-filter: blur(12px);
    }
    .obs-empty {
      color: var(--obs-muted);
      font-size: 12px;
      line-height: 1.4;
    }
    .obs-detail {
      position: absolute;
      left: 50%;
      bottom: 156px;
      width: min(420px, 34vw);
      transform: translateX(-50%);
      border: 1px solid rgba(242, 211, 122, 0.28);
      background: rgba(5, 11, 18, 0.64);
      backdrop-filter: blur(18px);
      padding: 14px;
      box-shadow: 0 18px 70px rgba(0, 0, 0, 0.48);
      max-height: 32vh;
      overflow: auto;
    }
    .obs-evidence-card span {
      display: block;
      color: var(--obs-gold);
      font-size: 10px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      margin: 8px 0 5px;
    }
    .obs-evidence-card strong {
      display: block;
      font-family: Georgia, "Times New Roman", serif;
      font-size: 20px;
      letter-spacing: -0.03em;
      margin-bottom: 8px;
    }
    .obs-evidence-card p, .obs-evidence-card small {
      display: block;
      color: rgba(233, 243, 255, 0.76);
      font-size: 12px;
      line-height: 1.45;
      margin: 0 0 8px;
    }
    .obs-evidence-card pre {
      margin: 10px 0 0;
      white-space: pre-wrap;
      color: rgba(233, 243, 255, 0.72);
      font-size: 10px;
      line-height: 1.35;
      border-top: 1px solid rgba(143, 228, 255, 0.16);
      padding-top: 10px;
    }
    @keyframes obsWord {
      from { opacity: 0; filter: blur(6px); color: var(--obs-cyan); }
      to { opacity: 1; filter: blur(0); color: inherit; }
    }
    @keyframes obsRise {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @media (max-width: 980px) {
      .obs-panel {
        top: auto;
        bottom: 170px;
        height: 30vh;
        width: calc(50vw - 38px);
      }
      .obs-left { left: 16px; }
      .obs-right { right: 16px; }
      .obs-bottom {
        left: 16px;
        right: 16px;
        grid-template-columns: 1fr;
      }
      .obs-detail {
        display: none;
      }
      .obs-status { display: none; }
      .obs-topbar {
        left: 16px;
        right: 16px;
      }
    }
  `;
  document.head.appendChild(style);
}
