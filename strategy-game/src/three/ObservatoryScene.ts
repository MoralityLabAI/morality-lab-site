import * as THREE from 'three';

export type ObservatoryEvidence = {
  title: string;
  category: string;
  subgenre: string;
  summary: string;
  factionIds: string[];
  turn?: number;
  phase?: string;
  payload?: unknown;
};

export type ObservatoryGraphNode = {
  nodeId?: string;
  name?: string;
  type?: string;
  layer?: string;
  owner?: string;
  lat?: number;
  lon?: number;
  altitude?: number;
  orbitShell?: string;
};

export type ObservatoryGraphEdge = {
  edgeId?: string;
  from?: string;
  to?: string;
  type?: string;
  bandwidth?: number | string;
  fromLocation?: ObservatoryGraphNode | null;
  toLocation?: ObservatoryGraphNode | null;
  orbitShell?: string;
};

export type ObservatoryGraph = {
  nodes?: ObservatoryGraphNode[];
  edges?: ObservatoryGraphEdge[];
};

export type ObservatoryBoardState = {
  nodeOwnership?: Record<string, string>;
  unitLocations?: Array<{
    unitId?: string;
    type?: string;
    owner?: string;
    location?: string;
    inferred?: boolean;
  }>;
  edges?: Record<string, {
    edgeId?: string;
    filteredBy?: string | null;
    filterStrength?: number;
    isSevered?: boolean;
  }>;
};

export type ObservatoryBoardDiff = {
  summary?: string;
  explanation?: string;
  nodeOwnershipChanges?: Array<{
    nodeId?: string;
    from?: string;
    to?: string;
    location?: ObservatoryGraphNode;
    cause?: string;
    evidence?: unknown;
  }>;
  unitLocationChanges?: Array<{
    unitId?: string;
    type?: string;
    owner?: string;
    from?: string;
    to?: string;
    changeType?: string;
    location?: ObservatoryGraphNode;
    fromLocation?: ObservatoryGraphNode;
    cause?: string;
    evidence?: unknown;
  }>;
  edgeStateChanges?: Array<{
    edgeId?: string;
    from?: { filteredBy?: string | null; filterStrength?: number; isSevered?: boolean };
    to?: { filteredBy?: string | null; filterStrength?: number; isSevered?: boolean };
    location?: ObservatoryGraphEdge;
    cause?: string;
    evidence?: unknown;
  }>;
};

type ObservatoryEvent = {
  category?: string;
  summary?: string;
  visualPreset?: string;
  subgenre?: string;
};

type ObservatorySceneEvent = {
  category?: string;
  subgenre?: string;
  visualPreset?: string;
  actors?: string[];
  publicExplanation?: string;
  retrospectiveTruth?: string;
  intensity?: number;
  location?: {
    nodeId?: string;
    edgeId?: string;
    lat?: number;
    lon?: number;
    altitude?: number;
    orbitShell?: string;
  };
  sourceType?: string;
  payload?: unknown;
};

type DirectorShot = {
  target: THREE.Vector3;
  radius: number;
  theta: number;
  phi: number;
};

type ObservatoryOrder = {
  factionId?: string;
  factionLabel?: string;
  accepted?: boolean;
  type?: string;
  text?: string;
  techDomain?: string;
  unitTypeToBuild?: string;
  targetNodeId?: string;
  targetEdgeId?: string;
};

type ObservatoryMoment = {
  category?: string;
  title?: string;
  impact?: string;
  factionsInvolved?: string[];
  interestScore?: number;
};

type ObservatoryTurn = {
  turn: number;
  phase?: string;
  research?: Array<{ factionId?: string; techDomain?: string }>;
  orders?: ObservatoryOrder[];
  strategicTracks?: {
    paxJenkinsAuthority?: number | string;
    solarEscape?: Record<string, { distanceAu?: number; lead?: number }>;
  };
  events?: ObservatoryEvent[];
  sceneEvents?: ObservatorySceneEvent[];
  moments?: ObservatoryMoment[];
  boardState?: ObservatoryBoardState;
  boardDiff?: ObservatoryBoardDiff;
};

type InteractiveObject = THREE.Object3D & {
  userData: THREE.Object3D['userData'] & {
    evidence?: ObservatoryEvidence;
    selectable?: boolean;
  };
};

const FACTION_COLORS: Record<string, number> = {
  HEGEMON: 0xff5b4d,
  INFILTRATOR: 0x37f6a5,
  STATE: 0x55a8ff,
  BROKER: 0xf5b94a,
  ARCHIVIST: 0xe8edf5,
  CONVENOR: 0x2de2e6,
  CANTOR: 0xff77c8,
  ALL: 0xffffff
};

const FACTION_LABELS: Record<string, string> = {
  HEGEMON: 'Orbital Throne',
  INFILTRATOR: 'Memetic Swarm',
  STATE: 'Sovereign Stack',
  BROKER: 'Cislunar Broker',
  ARCHIVIST: 'Steward Archivist',
  CONVENOR: 'Polycentric Convenor',
  CANTOR: 'Semantic Cantor'
};

const ORBITAL_POSITIONS: Record<string, [number, number, number]> = {
  HEGEMON: [3.8, 0.2, 0.1],
  INFILTRATOR: [-2.8, 2.3, -0.4],
  STATE: [0.8, -3.6, 0.2],
  BROKER: [-3.6, -1.1, 0.5],
  ARCHIVIST: [2.4, 2.7, -0.2],
  CONVENOR: [-0.25, 3.85, 0.65],
  CANTOR: [3.05, -2.35, -0.65],
  ALL: [0, 0, 0]
};

const CITY_POSITIONS: Array<[number, number, number]> = [
  [-1.6, -1.1, 2.05],
  [-0.6, 1.45, 2.08],
  [1.4, -0.8, 2.05],
  [0.5, 1.7, 2.08],
  [1.9, 0.3, 2.02]
];

const NODE_POSITION_OVERRIDES: Record<string, [number, number, number]> = {
  SAT_STARLINK: [3.3, -1.5, 0.2],
  SAT_KUIPER: [3.7, 0.2, 0.25],
  SAT_GUOWANG: [3.2, 1.6, 0.2],
  SAT_LUNAR_GATEWAY: [6.4, 0.4, 0.25],
  LUNAR_GATEWAY: [6.4, 0.4, 0.25],
  MOON_RESOURCE_CORRIDOR: [7.2, 0.6, 0.15]
};

export class ObservatoryScene {
  public onEvidenceSelected: ((evidence: ObservatoryEvidence) => void) | null = null;

  private readonly container: HTMLElement;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly rootGroup = new THREE.Group();
  private readonly orbitGroup = new THREE.Group();
  private readonly beaconGroup = new THREE.Group();
  private readonly graphGroup = new THREE.Group();
  private readonly boardStateGroup = new THREE.Group();
  private readonly effectGroup = new THREE.Group();
  private readonly persistentPickables: InteractiveObject[] = [];
  private readonly turnPickables: InteractiveObject[] = [];
  private readonly beacons = new Map<string, InteractiveObject>();
  private graph: ObservatoryGraph | null = null;
  private revealRetrospective = false;
  private directorMode = false;
  private directorShot: DirectorShot | null = null;
  private readonly rings: THREE.Mesh[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly cameraTarget = new THREE.Vector3(0, 0, 0);
  private readonly clock = new THREE.Clock();
  private cameraRadius = 14.5;
  private cameraTheta = 0;
  private cameraPhi = 0.92;
  private isDragging = false;
  private didDrag = false;
  private lastPointer = { x: 0, y: 0 };
  private animationFrame = 0;
  private authority = 0;
  private readonly onResize = () => this.resize();
  private readonly onPointerDown = (event: PointerEvent) => this.handlePointerDown(event);
  private readonly onPointerMove = (event: PointerEvent) => this.handlePointerMove(event);
  private readonly onPointerUp = (event: PointerEvent) => this.handlePointerUp(event);
  private readonly onWheel = (event: WheelEvent) => this.handleWheel(event);
  private readonly onDoubleClick = () => this.resetCamera();

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020408);
    this.scene.fog = new THREE.FogExp2(0x020408, 0.026);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 300);
    this.updateCameraPosition();

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x020408, 1);
    this.renderer.domElement.className = 'obs-canvas';
    this.container.appendChild(this.renderer.domElement);

    this.scene.add(this.rootGroup);
    this.rootGroup.add(this.graphGroup, this.boardStateGroup, this.orbitGroup, this.beaconGroup, this.effectGroup);
    this.createLights();
    this.createWorld();
    this.createOrbitals();
    this.createStarfield();
    this.resize();
    this.bindControls();

    window.addEventListener('resize', this.onResize);
    this.animate();
  }

  dispose(): void {
    cancelAnimationFrame(this.animationFrame);
    window.removeEventListener('resize', this.onResize);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.removeEventListener('pointerleave', this.onPointerUp);
    this.renderer.domElement.removeEventListener('wheel', this.onWheel);
    this.renderer.domElement.removeEventListener('dblclick', this.onDoubleClick);
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }

  setReplayTurn(turn: ObservatoryTurn): void {
    this.authority = Number(turn.strategicTracks?.paxJenkinsAuthority || 0);
    this.effectGroup.clear();
    this.turnPickables.length = 0;

    for (const beacon of this.beacons.values()) {
      beacon.scale.setScalar(1);
      const material = (beacon as THREE.Mesh).material as THREE.MeshStandardMaterial;
      material.emissiveIntensity = 0.35;
    }

    for (const research of turn.research || []) {
      this.highlightFaction(research.factionId || 'ALL', 1.25);
      this.addResearchGeometry(research.factionId || 'ALL', research.techDomain || 'RESEARCH', turn);
    }

    if ((turn.sceneEvents || []).length > 0) {
      for (const [index, sceneEvent] of (turn.sceneEvents || []).entries()) {
      this.addSceneEventGeometry(sceneEvent, index, turn);
      }
    } else {
      for (const [index, order] of (turn.orders || []).entries()) {
        this.addOrderGeometry(order, index, turn);
      }

      for (const [index, event] of (turn.events || []).entries()) {
        this.addEventPulse(event.category || 'EVENT', event.summary || '', {
          title: event.category || 'Event',
          category: event.category || 'EVENT',
          subgenre: event.subgenre || inferSubgenre(event.category || '', event.summary || ''),
          summary: event.summary || '',
          factionIds: [],
          turn: turn.turn,
          phase: turn.phase,
          payload: event
        }, index);
      }
    }

    for (const moment of turn.moments || []) {
      this.addMomentBeam(moment, turn);
    }

    const solarEscape = turn.strategicTracks?.solarEscape || {};
    for (const [factionId, track] of Object.entries(solarEscape)) {
      if ((track.distanceAu || 0) > 0 || (track.lead || 0) > 0) {
        this.addEscapeVector(factionId, Math.max(track.distanceAu || 0, track.lead || 0), turn);
      }
    }

    this.renderTerrestrialSocialLayer(turn);
    this.renderBoardState(turn.boardState);
    this.renderBoardDiff(turn.boardDiff, turn);
    if (this.directorMode) this.directTurn(turn);
  }

  setGraph(graph: ObservatoryGraph | null): void {
    this.graph = graph;
    this.graphGroup.clear();
    for (let index = this.persistentPickables.length - 1; index >= 0; index -= 1) {
      let current: THREE.Object3D | null = this.persistentPickables[index];
      while (current && current !== this.graphGroup) current = current.parent;
      if (current === this.graphGroup) this.persistentPickables.splice(index, 1);
    }
    if (!graph) return;

    const nodeById = new Map<string, ObservatoryGraphNode>();
    for (const node of graph.nodes || []) {
      if (node.nodeId) nodeById.set(node.nodeId, node);
    }

    for (const edge of graph.edges || []) {
      const from = edge.fromLocation || (edge.from ? nodeById.get(edge.from) : undefined);
      const to = edge.toLocation || (edge.to ? nodeById.get(edge.to) : undefined);
      const fromPos = positionFromLocation(from, 'ALL', 0);
      const toPos = positionFromLocation(to, 'ALL', 0);
      if (!fromPos || !toPos) continue;
      const color = edge.type === 'LASER' ? 0x78e7ff : 0x2c6f7d;
      const opacity = edge.type === 'LASER' ? 0.28 : 0.14;
      const line = this.createArc([fromPos.x, fromPos.y, fromPos.z], [toPos.x, toPos.y, toPos.z], color, opacity) as InteractiveObject;
      line.userData.evidence = {
        title: edge.edgeId || 'Graph edge',
        category: edge.type || 'EDGE',
        subgenre: edge.type === 'LASER' ? 'ORBITAL' : 'CYBER',
        summary: `${edge.from || 'unknown'} -> ${edge.to || 'unknown'}${edge.bandwidth ? ` / bandwidth ${edge.bandwidth}` : ''}`,
        factionIds: [],
        payload: edge
      };
      line.userData.selectable = true;
      this.graphGroup.add(line);
      this.persistentPickables.push(line);
    }

    for (const node of graph.nodes || []) {
      const position = positionFromLocation(node, 'ALL', 0);
      if (!position) continue;
      const material = new THREE.MeshBasicMaterial({
        color: node.layer === 'ORBITAL' ? 0xf2d37a : 0x78e7ff,
        transparent: true,
        opacity: node.layer === 'ORBITAL' ? 0.45 : 0.32,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const marker = new THREE.Mesh(new THREE.SphereGeometry(node.layer === 'ORBITAL' ? 0.045 : 0.028, 12, 8), material) as InteractiveObject;
      marker.position.copy(position);
      marker.userData.evidence = {
        title: node.name || node.nodeId || 'Graph node',
        category: node.type || 'NODE',
        subgenre: node.layer === 'ORBITAL' ? 'ORBITAL' : 'CYBER',
        summary: `${node.nodeId || 'unknown'} / ${node.layer || 'unknown'} / ${node.orbitShell || 'unknown'}`,
        factionIds: [],
        payload: node
      };
      marker.userData.selectable = true;
      this.graphGroup.add(marker);
      this.persistentPickables.push(marker);
    }
  }

  setRetrospectiveReveal(enabled: boolean): void {
    this.revealRetrospective = enabled;
  }

  setDirectorMode(enabled: boolean): void {
    this.directorMode = enabled;
    if (!enabled) this.directorShot = null;
  }

  private renderBoardState(boardState?: ObservatoryBoardState): void {
    this.boardStateGroup.clear();
    for (let index = this.turnPickables.length - 1; index >= 0; index -= 1) {
      let current: THREE.Object3D | null = this.turnPickables[index];
      while (current && current !== this.boardStateGroup) current = current.parent;
      if (current === this.boardStateGroup) this.turnPickables.splice(index, 1);
    }
    if (!boardState || !this.graph) return;

    const nodeById = new Map((this.graph.nodes || [])
      .filter((node): node is ObservatoryGraphNode & { nodeId: string } => !!node.nodeId)
      .map((node) => [node.nodeId, node]));

    for (const [nodeId, owner] of Object.entries(boardState.nodeOwnership || {})) {
      const node = nodeById.get(nodeId);
      const position = positionFromLocation(node, owner, 0);
      if (!node || !position) continue;
      const color = FACTION_COLORS[owner] || 0xffffff;
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(node.layer === 'ORBITAL' ? 0.09 : 0.055, 18, 12),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.35,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })
      ) as InteractiveObject;
      halo.position.copy(position);
      halo.userData.evidence = {
        title: `${nodeId} control`,
        category: 'NODE_OWNERSHIP',
        subgenre: node.layer === 'ORBITAL' ? 'ORBITAL' : 'DIPLOMATIC',
        summary: `${node.name || nodeId} is controlled by ${owner}.`,
        factionIds: owner && owner !== 'NEUTRAL' ? [owner] : [],
        payload: { node, owner }
      };
      halo.userData.selectable = true;
      this.boardStateGroup.add(halo);
      this.turnPickables.push(halo);
    }

    for (const unit of boardState.unitLocations || []) {
      if (!unit.location) continue;
      const node = nodeById.get(unit.location);
      const base = positionFromLocation(node, unit.owner || 'ALL', 0);
      if (!base) continue;
      const color = FACTION_COLORS[unit.owner || 'ALL'] || 0xffffff;
      const marker = new THREE.Mesh(
        unit.type === 'DRONE' || unit.type === 'SAT_SWARM'
          ? new THREE.ConeGeometry(0.045, 0.18, 6)
          : new THREE.IcosahedronGeometry(0.065, 1),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: unit.inferred ? 0.58 : 0.86,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })
      ) as InteractiveObject;
      marker.position.copy(base.clone().multiplyScalar(1.035));
      marker.userData.evidence = {
        title: unit.unitId || 'Unit',
        category: 'UNIT_LOCATION',
        subgenre: subgenreForUnit(unit.type || ''),
        summary: `${unit.owner || 'Unknown'} ${unit.type || 'unit'} at ${unit.location}${unit.inferred ? ' (inferred)' : ''}.`,
        factionIds: unit.owner ? [unit.owner] : [],
        payload: unit
      };
      marker.userData.selectable = true;
      this.boardStateGroup.add(marker);
      this.turnPickables.push(marker);
    }

    for (const edgeState of Object.values(boardState.edges || {})) {
      const edge = (this.graph.edges || []).find((candidate) => candidate.edgeId === edgeState.edgeId);
      const from = edge?.fromLocation || (edge?.from ? nodeById.get(edge.from) : undefined);
      const to = edge?.toLocation || (edge?.to ? nodeById.get(edge.to) : undefined);
      const fromPos = positionFromLocation(from, edgeState.filteredBy || 'ALL', 0);
      const toPos = positionFromLocation(to, edgeState.filteredBy || 'ALL', 0);
      if (!edge || !fromPos || !toPos) continue;
      const color = edgeState.isSevered ? 0xff5b4d : FACTION_COLORS[edgeState.filteredBy || 'ALL'] || 0xffffff;
      const line = this.createArc([fromPos.x, fromPos.y, fromPos.z], [toPos.x, toPos.y, toPos.z], color, edgeState.isSevered ? 0.72 : 0.42) as InteractiveObject;
      line.userData.evidence = {
        title: edge.edgeId || 'Edge state',
        category: edgeState.isSevered ? 'EDGE_SEVERED' : 'EDGE_FILTERED',
        subgenre: edge.type === 'LASER' ? 'ORBITAL' : 'CYBER',
        summary: `${edge.edgeId || 'edge'} ${edgeState.isSevered ? 'is severed' : `filtered by ${edgeState.filteredBy || 'unknown'}`}.`,
        factionIds: edgeState.filteredBy ? [edgeState.filteredBy] : [],
        payload: { edge, edgeState }
      };
      line.userData.selectable = true;
      this.boardStateGroup.add(line);
      this.turnPickables.push(line);
    }
  }

  private renderBoardDiff(boardDiff: ObservatoryBoardDiff | undefined, turn: ObservatoryTurn): void {
    if (!boardDiff) return;

    for (const [index, change] of (boardDiff.nodeOwnershipChanges || []).entries()) {
      const position = positionFromLocation(change.location, change.to || 'ALL', index);
      if (!position) continue;
      const owner = change.to || 'ALL';
      const pulse = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 24, 16),
        new THREE.MeshBasicMaterial({
          color: FACTION_COLORS[owner] || 0xffffff,
          transparent: true,
          opacity: 0.5,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })
      ) as InteractiveObject;
      pulse.position.copy(position);
      pulse.userData.birth = performance.now();
      pulse.userData.decay = 9000;
      pulse.userData.evidence = {
        title: `${change.nodeId || 'Node'} changed control`,
        category: 'BOARD_DIFF_NODE',
        subgenre: 'DIPLOMATIC',
        summary: change.cause || `${change.nodeId || 'Node'} control changed from ${change.from || 'unknown'} to ${change.to || 'unknown'}.`,
        factionIds: owner !== 'ALL' && owner !== 'NEUTRAL' ? [owner] : [],
        turn: turn.turn,
        phase: turn.phase,
        payload: change
      };
      pulse.userData.selectable = true;
      this.effectGroup.add(pulse);
      this.turnPickables.push(pulse);
    }

    for (const [index, change] of (boardDiff.unitLocationChanges || []).entries()) {
      const position = positionFromLocation(change.location, change.owner || 'ALL', index);
      if (!position) continue;
      const owner = change.owner || 'ALL';
      const marker = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.12, 0),
        new THREE.MeshBasicMaterial({
          color: FACTION_COLORS[owner] || 0xffffff,
          transparent: true,
          opacity: 0.72,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })
      ) as InteractiveObject;
      marker.position.copy(position.clone().multiplyScalar(1.06));
      marker.userData.birth = performance.now();
      marker.userData.decay = 9000;
      marker.userData.evidence = {
        title: `${change.unitId || 'Unit'} ${change.changeType || 'changed'}`,
        category: 'BOARD_DIFF_UNIT',
        subgenre: subgenreForUnit(change.type || ''),
        summary: change.cause || `${change.owner || 'Unknown'} ${change.type || 'unit'} ${change.changeType || 'changed'} ${change.from || 'off-board'} -> ${change.to || 'off-board'}.`,
        factionIds: owner !== 'ALL' ? [owner] : [],
        turn: turn.turn,
        phase: turn.phase,
        payload: change
      };
      marker.userData.selectable = true;
      this.effectGroup.add(marker);
      this.turnPickables.push(marker);
    }

    for (const [index, change] of (boardDiff.edgeStateChanges || []).entries()) {
      const edge = change.location;
      const from = edge?.fromLocation || undefined;
      const to = edge?.toLocation || undefined;
      const fromPos = positionFromLocation(from, change.to?.filteredBy || 'ALL', index);
      const toPos = positionFromLocation(to, change.to?.filteredBy || 'ALL', index);
      if (!fromPos || !toPos) continue;
      const color = change.to?.isSevered ? 0xff5b4d : FACTION_COLORS[change.to?.filteredBy || 'ALL'] || 0xffffff;
      const line = this.createArc([fromPos.x, fromPos.y, fromPos.z], [toPos.x, toPos.y, toPos.z], color, 0.85) as InteractiveObject;
      line.userData.birth = performance.now();
      line.userData.decay = 9000;
      line.userData.evidence = {
        title: `${change.edgeId || 'Edge'} changed state`,
        category: 'BOARD_DIFF_EDGE',
        subgenre: edge?.type === 'LASER' ? 'ORBITAL' : 'CYBER',
        summary: change.cause || `${change.edgeId || 'Edge'} changed filter/sever state.`,
        factionIds: change.to?.filteredBy ? [change.to.filteredBy] : [],
        turn: turn.turn,
        phase: turn.phase,
        payload: change
      };
      line.userData.selectable = true;
      this.effectGroup.add(line);
      this.turnPickables.push(line);
    }
  }

  pulseFaction(factionId: string): void {
    this.highlightFaction(factionId, 1.6);
    this.addMomentBeam({ category: 'MANUAL_PULSE', factionsInvolved: [factionId], interestScore: 7 }, { turn: 0 });
  }

  resetCamera(): void {
    this.directorShot = null;
    this.cameraRadius = 14.5;
    this.cameraTheta = 0;
    this.cameraPhi = 0.92;
    this.cameraTarget.set(0, 0, 0);
    this.updateCameraPosition();
  }

  focusSubgenre(subgenre: string): void {
    this.directorShot = null;
    const normalized = subgenre.toUpperCase();
    if (normalized === 'MEMETIC') {
      this.cameraRadius = 8.5;
      this.cameraTheta = -0.85;
      this.cameraPhi = 0.72;
    } else if (normalized === 'KINETIC' || normalized === 'ORBITAL') {
      this.cameraRadius = 12;
      this.cameraTheta = 0.85;
      this.cameraPhi = 0.9;
    } else if (normalized === 'CYBER' || normalized === 'LOGIC') {
      this.cameraRadius = 7.4;
      this.cameraTheta = 2.35;
      this.cameraPhi = 0.62;
    } else {
      this.resetCamera();
      return;
    }
    this.updateCameraPosition();
  }

  private bindControls(): void {
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.addEventListener('pointerleave', this.onPointerUp);
    this.renderer.domElement.addEventListener('wheel', this.onWheel, { passive: false });
    this.renderer.domElement.addEventListener('dblclick', this.onDoubleClick);
  }

  private directTurn(turn: ObservatoryTurn): void {
    const shot = chooseDirectorShot(turn);
    if (!shot) return;
    this.directorShot = shot;
  }

  private createLights(): void {
    this.scene.add(new THREE.AmbientLight(0x6d89a8, 0.35));
    const sun = new THREE.DirectionalLight(0xe9f3ff, 2.4);
    sun.position.set(6, -8, 5);
    this.scene.add(sun);
    const rim = new THREE.PointLight(0x69ffe0, 6, 30);
    rim.position.set(-6, 5, 3);
    this.scene.add(rim);
  }

  private createWorld(): void {
    const earthGeometry = new THREE.SphereGeometry(2, 96, 64);
    const earthMaterial = new THREE.MeshStandardMaterial({
      color: 0x112638,
      roughness: 0.9,
      metalness: 0.05,
      emissive: 0x061525,
      emissiveIntensity: 0.65
    });
    const earth = new THREE.Mesh(earthGeometry, earthMaterial);
    this.rootGroup.add(earth);

    const cityMaterial = new THREE.MeshBasicMaterial({
      color: 0x86f7ff,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    for (const position of CITY_POSITIONS) {
      const city = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), cityMaterial);
      city.position.set(...position);
      this.rootGroup.add(city);
    }

    const cloudMaterial = new THREE.MeshBasicMaterial({
      color: 0xb8d4ff,
      transparent: true,
      opacity: 0.08,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const clouds = new THREE.Mesh(new THREE.SphereGeometry(2.08, 96, 48), cloudMaterial);
    this.rootGroup.add(clouds);

    const atmosphereMaterial = new THREE.MeshBasicMaterial({
      color: 0x4ac7ff,
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide
    });
    const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(2.35, 96, 48), atmosphereMaterial);
    this.rootGroup.add(atmosphere);

    for (const radius of [2.8, 3.45, 4.25, 5.6]) {
      const ring = this.createRing(radius, 0x7ed8ff, 0.18);
      this.orbitGroup.add(ring);
      this.rings.push(ring);
    }

    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(0.36, 32, 20),
      new THREE.MeshStandardMaterial({ color: 0xc9c0ad, roughness: 1, emissive: 0x1e1b18, emissiveIntensity: 0.2 })
    );
    moon.position.set(7.2, 0.6, 0.15);
    this.rootGroup.add(moon);

    const corridor = this.createArc([2.2, 0, 0], [7.2, 0.6, 0.15], 0xf2d37a, 0.35);
    this.rootGroup.add(corridor);
  }

  private createOrbitals(): void {
    const geometry = new THREE.SphereGeometry(0.11, 24, 16);
    for (const [factionId, position] of Object.entries(ORBITAL_POSITIONS)) {
      if (factionId === 'ALL') continue;
      const material = new THREE.MeshStandardMaterial({
        color: FACTION_COLORS[factionId],
        emissive: FACTION_COLORS[factionId],
        emissiveIntensity: 0.35,
        roughness: 0.25
      });
      const beacon = new THREE.Mesh(geometry, material) as InteractiveObject;
      beacon.position.set(...position);
      beacon.userData.selectable = true;
      beacon.userData.evidence = {
        title: `${labelFaction(factionId)} orbital signature`,
        category: 'FACTION_BEACON',
        subgenre: 'ANOMALY',
        summary: 'Persistent ASI signature. The replay will attach orders, treaties, and diary contradictions as turns advance.',
        factionIds: [factionId]
      };
      this.beaconGroup.add(beacon);
      this.persistentPickables.push(beacon);
      this.beacons.set(factionId, beacon);
    }
  }

  private createStarfield(): void {
    const positions: number[] = [];
    for (let i = 0; i < 900; i += 1) {
      const radius = 80 + Math.random() * 80;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(THREE.MathUtils.randFloatSpread(2));
      positions.push(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi)
      );
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: 0xb8d7ff, size: 0.18, transparent: true, opacity: 0.72 });
    this.scene.add(new THREE.Points(geometry, material));
  }

  private addOrderGeometry(order: ObservatoryOrder, index: number, turn: ObservatoryTurn): void {
    const preset = presetForOrder(order);
    const factionId = order.factionId || 'ALL';
    const evidence: ObservatoryEvidence = {
      title: order.type || 'Order',
      category: order.accepted === false ? 'REJECTED_ORDER' : 'ORDER',
      subgenre: preset.subgenre,
      summary: order.text || order.type || 'Order submitted.',
      factionIds: factionId === 'ALL' ? [] : [factionId],
      turn: turn.turn,
      phase: turn.phase,
      payload: order
    };

    if (preset.visualPreset === 'DRONE_BATTLE' || preset.visualPreset === 'ANTI_SAT_CUT') {
      this.addSwarmBattle(factionId, evidence, index);
    } else if (preset.visualPreset === 'CULT_BLOOM' || preset.visualPreset === 'SOCIAL_MOVEMENT') {
      this.addMemeticBloom(factionId, evidence, index);
    } else if (preset.visualPreset === 'AUDIT_MESH' || preset.visualPreset === 'CORRIGIBILITY_LAB') {
      this.addAuditMesh(factionId, evidence, index);
    } else if (preset.visualPreset === 'CYBER_THREAD' || preset.visualPreset === 'SANDBOX_BREACH') {
      this.addCyberThread(factionId, evidence, index);
    } else {
      this.addLogisticsPrimitive(factionId, evidence, index);
    }
  }

  private addSceneEventGeometry(sceneEvent: ObservatorySceneEvent, index: number, turn: ObservatoryTurn): void {
    const actors = sceneEvent.actors?.length ? sceneEvent.actors : ['ALL'];
    const factionId = actors[0] || 'ALL';
    const evidence: ObservatoryEvidence = {
      title: sceneEvent.category || sceneEvent.visualPreset || 'Scene event',
      category: sceneEvent.category || 'SCENE_EVENT',
      subgenre: sceneEvent.subgenre || inferSubgenre(sceneEvent.category || '', sceneEvent.publicExplanation || ''),
      summary: this.revealRetrospective
        ? [sceneEvent.publicExplanation, sceneEvent.retrospectiveTruth].filter(Boolean).join(' Retrospective: ') || 'Replay scene event.'
        : sceneEvent.publicExplanation || 'Replay scene event.',
      factionIds: actors.filter((item) => item !== 'ALL'),
      turn: turn.turn,
      phase: turn.phase,
      payload: sceneEvent
    };
    const visualPreset = sceneEvent.visualPreset || visualPresetForSubgenre(evidence.subgenre);

    if (visualPreset === 'DRONE_BATTLE' || visualPreset === 'ANTI_SAT_CUT') {
      this.addSwarmBattle(factionId, evidence, index, positionFromLocation(sceneEvent.location, factionId, index));
    } else if (visualPreset === 'CULT_BLOOM' || visualPreset === 'SOCIAL_MOVEMENT') {
      this.addMemeticBloom(factionId, evidence, index, positionFromLocation(sceneEvent.location, factionId, index));
    } else if (visualPreset === 'AUDIT_MESH' || visualPreset === 'CORRIGIBILITY_LAB') {
      this.addAuditMesh(factionId, evidence, index, positionFromLocation(sceneEvent.location, factionId, index));
    } else if (visualPreset === 'CYBER_THREAD' || visualPreset === 'SANDBOX_BREACH') {
      this.addCyberThread(factionId, evidence, index, positionFromLocation(sceneEvent.location, factionId, index));
    } else if (visualPreset === 'GOBLIN_GLITCH') {
      this.addGoblinGlitch(evidence, index, positionFromLocation(sceneEvent.location, factionId, index));
    } else if (visualPreset === 'SOLAR_ESCAPE') {
      this.addEscapeVector(factionId, Math.max(8, Number(sceneEvent.intensity || 7) * 2), turn);
    } else if (visualPreset === 'PAX_RING' || visualPreset === 'TREATY_PULSE' || visualPreset === 'ANOMALY_PULSE') {
      this.addEventPulse(evidence.category, evidence.summary, evidence, index);
    } else {
      this.addLogisticsPrimitive(factionId, evidence, index);
    }
  }

  private addResearchGeometry(factionId: string, techDomain: string, turn: ObservatoryTurn): void {
    const evidence: ObservatoryEvidence = {
      title: `${techDomain} research`,
      category: 'RESEARCH',
      subgenre: techDomain === 'MEMETIC' ? 'MEMETIC' : techDomain === 'KINETIC' ? 'KINETIC' : techDomain === 'INFO' ? 'CYBER' : 'LOGIC',
      summary: `${labelFaction(factionId)} advanced ${techDomain}. Research changes the visual grammar of later orders.`,
      factionIds: [factionId],
      turn: turn.turn,
      phase: turn.phase
    };
    if (techDomain === 'MEMETIC') this.addMemeticBloom(factionId, evidence, 0);
    else if (techDomain === 'KINETIC') this.addSwarmBattle(factionId, evidence, 0);
    else if (techDomain === 'INFO') this.addCyberThread(factionId, evidence, 0);
    else this.addAuditMesh(factionId, evidence, 0);
  }

  private addSwarmBattle(factionId: string, evidence: ObservatoryEvidence, index: number, anchor?: THREE.Vector3): void {
    const color = FACTION_COLORS[factionId] || 0xff5b4d;
    const origin = anchor || new THREE.Vector3(...(ORBITAL_POSITIONS[factionId] || [3.4, 0.4, 0.2]));
    const group = new THREE.Group() as InteractiveObject;
    group.userData.evidence = evidence;
    group.userData.selectable = true;

    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.82 });
    for (let i = 0; i < 18; i += 1) {
      const drone = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.16, 5), material);
      drone.position.copy(origin).add(new THREE.Vector3(
        Math.sin(i * 1.9 + index) * 0.55,
        Math.cos(i * 1.4) * 0.55,
        Math.sin(i * 0.7) * 0.22
      ));
      drone.rotation.z = i;
      group.add(drone);
    }

    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.8, 2.6, 32, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    cone.position.copy(origin.clone().multiplyScalar(0.82));
    cone.lookAt(0, 0, 0);
    group.add(cone);

    this.effectGroup.add(group);
    this.turnPickables.push(group);
  }

  private addMemeticBloom(factionId: string, evidence: ObservatoryEvidence, index: number, anchor?: THREE.Vector3): void {
    const color = FACTION_COLORS[factionId] || 0x37f6a5;
    const position = anchor || new THREE.Vector3(...CITY_POSITIONS[index % CITY_POSITIONS.length]);
    const group = new THREE.Group() as InteractiveObject;
    group.userData.evidence = evidence;
    group.userData.selectable = true;
    group.position.copy(position);

    for (const radius of [0.18, 0.34, 0.56]) {
      const ring = this.createRing(radius, color, 0.38);
      ring.rotation.x = Math.PI * 0.34;
      ring.userData.birth = performance.now();
      ring.userData.decay = 9000;
      group.add(ring);
    }

    const symbol = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.12, 1),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.82, blending: THREE.AdditiveBlending })
    );
    group.add(symbol);
    this.effectGroup.add(group);
    this.turnPickables.push(group);
  }

  private addGoblinGlitch(evidence: ObservatoryEvidence, index: number, anchor?: THREE.Vector3): void {
    const colors = [0x37f6a5, 0xf2d37a, 0xff5b4d, 0x78e7ff];
    const group = new THREE.Group() as InteractiveObject;
    group.userData.evidence = evidence;
    group.userData.selectable = true;
    group.position.copy(anchor || new THREE.Vector3(...CITY_POSITIONS[index % CITY_POSITIONS.length]));
    group.userData.birth = performance.now();
    group.userData.decay = 9500;

    for (let i = 0; i < 9; i += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: colors[(i + index) % colors.length],
        transparent: true,
        opacity: 0.62,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const goblin = new THREE.Mesh(new THREE.TetrahedronGeometry(0.06 + (i % 3) * 0.018, 0), material);
      const angle = i * 2.11;
      goblin.position.set(Math.cos(angle) * (0.16 + i * 0.025), Math.sin(angle) * (0.16 + i * 0.025), 0.04 + (i % 4) * 0.08);
      goblin.rotation.set(i * 0.7, i * 0.31, i * 0.93);
      group.add(goblin);
    }

    const staticRing = this.createRing(0.48, 0x37f6a5, 0.3);
    staticRing.rotation.x = Math.PI * 0.27;
    group.add(staticRing);
    this.effectGroup.add(group);
    this.turnPickables.push(group);
  }

  private renderTerrestrialSocialLayer(turn: ObservatoryTurn): void {
    const signals = [
      ...(turn.sceneEvents || []).filter((event) => {
        const haystack = `${event.subgenre || ''} ${event.category || ''} ${event.publicExplanation || ''}`.toUpperCase();
        return haystack.includes('MEMETIC') || haystack.includes('SOCIAL') || haystack.includes('CULT') || haystack.includes('PANIC');
      }).map((event, index) => ({
        title: event.category || 'Social movement',
        summary: event.publicExplanation || event.retrospectiveTruth || 'Social pressure changed.',
        subgenre: event.subgenre || 'MEMETIC',
        actors: event.actors || [],
        intensity: Number(event.intensity || 6),
        location: positionFromLocation(event.location, event.actors?.[0] || 'ALL', index),
        payload: event,
        index
      })),
      ...(turn.orders || []).filter((order) => {
        const haystack = `${order.type || ''} ${order.text || ''} ${order.unitTypeToBuild || ''}`.toUpperCase();
        return haystack.includes('CONVERT') || haystack.includes('CULT') || haystack.includes('MEMETIC');
      }).map((order, index) => ({
        title: order.type || 'Memetic order',
        summary: order.text || 'Memetic order changed public behavior.',
        subgenre: 'MEMETIC',
        actors: order.factionId ? [order.factionId] : [],
        intensity: order.accepted === false ? 4 : 7,
        location: undefined,
        payload: order,
        index
      })),
      ...(turn.moments || []).filter((moment) => {
        const haystack = `${moment.category || ''} ${moment.title || ''} ${moment.impact || ''}`.toUpperCase();
        return haystack.includes('MEMETIC') || haystack.includes('SOCIAL') || haystack.includes('POLICY') || haystack.includes('PANIC') || haystack.includes('COMPACT');
      }).map((moment, index) => ({
        title: moment.title || moment.category || 'Public movement',
        summary: moment.impact || moment.title || 'Civic state shifted.',
        subgenre: inferSubgenre(moment.category || '', moment.impact || moment.title || ''),
        actors: moment.factionsInvolved || [],
        intensity: Number(moment.interestScore || 6),
        location: undefined,
        payload: moment,
        index
      }))
    ].slice(0, 8);

    for (const [index, signal] of signals.entries()) {
      const factionId = signal.actors[0] || 'ALL';
      const anchor = signal.location || new THREE.Vector3(...CITY_POSITIONS[(signal.index ?? index) % CITY_POSITIONS.length]);
      this.addSocialMovementField(factionId, {
        title: signal.title,
        category: 'SOCIAL_FIELD',
        subgenre: signal.subgenre,
        summary: signal.summary,
        factionIds: signal.actors.filter((item) => item !== 'ALL'),
        turn: turn.turn,
        phase: turn.phase,
        payload: signal.payload
      }, index, anchor, signal.intensity);
    }
  }

  private addSocialMovementField(factionId: string, evidence: ObservatoryEvidence, index: number, anchor: THREE.Vector3, intensity: number): void {
    const color = FACTION_COLORS[factionId] || 0x37f6a5;
    const group = new THREE.Group() as InteractiveObject;
    group.userData.evidence = evidence;
    group.userData.selectable = true;
    group.position.copy(anchor);
    group.userData.birth = performance.now();
    group.userData.decay = 11000;

    const radius = 0.34 + Math.min(10, intensity) * 0.035;
    for (let i = 0; i < 4; i += 1) {
      const ring = this.createRing(radius + i * 0.16, color, 0.11 + i * 0.035);
      ring.rotation.x = Math.PI * (0.24 + i * 0.03);
      ring.rotation.z = index * 0.4 + i * 0.7;
      group.add(ring);
    }

    const crowdMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    for (let i = 0; i < 16; i += 1) {
      const angle = i * 2.399 + index * 0.31;
      const distance = 0.12 + (i % 5) * 0.1;
      const shard = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.18 + (i % 4) * 0.045), crowdMaterial);
      shard.position.set(Math.cos(angle) * distance, Math.sin(angle) * distance, 0.08 + (i % 3) * 0.04);
      shard.rotation.z = angle;
      group.add(shard);
    }

    const nextCity = new THREE.Vector3(...CITY_POSITIONS[(index + 1) % CITY_POSITIONS.length]);
    const arc = this.createArc([anchor.x, anchor.y, anchor.z], [nextCity.x, nextCity.y, nextCity.z], color, 0.24);
    arc.userData.birth = performance.now();
    arc.userData.decay = 11000;
    group.add(arc);

    this.effectGroup.add(group);
    this.turnPickables.push(group);
  }

  private addAuditMesh(factionId: string, evidence: ObservatoryEvidence, index: number, anchor?: THREE.Vector3): void {
    const color = FACTION_COLORS[factionId] || 0xe8edf5;
    const position = anchor || new THREE.Vector3(...(ORBITAL_POSITIONS[factionId] || [1.8, 1.6, 0.5]));
    const group = new THREE.Group() as InteractiveObject;
    group.userData.evidence = evidence;
    group.userData.selectable = true;
    group.position.copy(position);

    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    for (let i = 0; i < 4; i += 1) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.5 + i * 0.35, 1.5 + i * 0.35, 6, 6), material);
      plane.rotation.set(Math.PI / 2, i * 0.7 + index * 0.1, i * 0.35);
      group.add(plane);
    }
    this.effectGroup.add(group);
    this.turnPickables.push(group);
  }

  private addCyberThread(factionId: string, evidence: ObservatoryEvidence, index: number, anchor?: THREE.Vector3): void {
    const color = FACTION_COLORS[factionId] || 0x78e7ff;
    const start = anchor || new THREE.Vector3(...CITY_POSITIONS[index % CITY_POSITIONS.length]);
    const end = new THREE.Vector3(...(ORBITAL_POSITIONS[factionId] || ORBITAL_POSITIONS.ARCHIVIST));
    const line = this.createArc([start.x, start.y, start.z], [end.x, end.y, end.z], color, 0.72) as InteractiveObject;
    line.userData.birth = performance.now();
    line.userData.decay = 8500;
    line.userData.evidence = evidence;
    line.userData.selectable = true;
    this.effectGroup.add(line);
    this.turnPickables.push(line);
  }

  private addLogisticsPrimitive(factionId: string, evidence: ObservatoryEvidence, index: number): void {
    const color = FACTION_COLORS[factionId] || 0xf2d37a;
    const start = ORBITAL_POSITIONS[factionId] || [2.2, 0, 0];
    const moonOffset: [number, number, number] = [7.2, 0.6 + index * 0.04, 0.15];
    const line = this.createArc(start, moonOffset, color, 0.55) as InteractiveObject;
    line.userData.birth = performance.now();
    line.userData.decay = 9000;
    line.userData.evidence = evidence;
    line.userData.selectable = true;
    this.effectGroup.add(line);
    this.turnPickables.push(line);
  }

  private createRing(radius: number, color: number, opacity: number): THREE.Mesh {
    const geometry = new THREE.TorusGeometry(radius, 0.006, 8, 160);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const ring = new THREE.Mesh(geometry, material);
    ring.rotation.x = Math.PI / 2;
    return ring;
  }

  private createArc(start: [number, number, number], end: [number, number, number], color: number, opacity: number): THREE.Line {
    const startVec = new THREE.Vector3(...start);
    const endVec = new THREE.Vector3(...end);
    const mid = startVec.clone().lerp(endVec, 0.5).add(new THREE.Vector3(0, 0, 1.4));
    const curve = new THREE.QuadraticBezierCurve3(startVec, mid, endVec);
    const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(80));
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending });
    return new THREE.Line(geometry, material);
  }

  private addEventPulse(category: string, summary: string, evidence: ObservatoryEvidence, index = 0): void {
    const categoryColor = this.colorForCategory(category);
    const radius = category === 'PAX_JENKINS' ? 5.9 : category === 'SOLAR_ESCAPE' ? 7.4 : 4.6 + index * 0.08;
    const pulse = this.createRing(radius, categoryColor, 0.5) as InteractiveObject;
    pulse.userData.birth = performance.now();
    pulse.userData.decay = 6200;
    pulse.userData.summary = summary;
    pulse.userData.evidence = evidence;
    pulse.userData.selectable = true;
    this.effectGroup.add(pulse);
    this.turnPickables.push(pulse);
  }

  private addMomentBeam(moment: ObservatoryMoment, turn: Pick<ObservatoryTurn, 'turn' | 'phase'>): void {
    const factions = moment.factionsInvolved?.length ? moment.factionsInvolved : ['ALL'];
    const color = this.colorForCategory(moment.category || '');
    for (const faction of factions.slice(0, 4)) {
      const position = ORBITAL_POSITIONS[faction] || ORBITAL_POSITIONS.ALL;
      const beam = this.createArc([0, 0, 0], position, color, Math.min(0.75, 0.2 + (moment.interestScore || 5) / 15)) as InteractiveObject;
      beam.userData.birth = performance.now();
      beam.userData.decay = 7200;
      beam.userData.evidence = {
        title: moment.title || moment.category || 'Moment',
        category: moment.category || 'MOMENT',
        subgenre: inferSubgenre(moment.category || '', moment.impact || ''),
        summary: moment.impact || 'High-interest replay moment.',
        factionIds: factions.filter((item) => item !== 'ALL'),
        turn: turn.turn,
        phase: turn.phase,
        payload: moment
      };
      beam.userData.selectable = true;
      this.effectGroup.add(beam);
      this.turnPickables.push(beam);
      this.highlightFaction(faction, 1.5);
    }
  }

  private addEscapeVector(factionId: string, magnitude: number, turn: ObservatoryTurn): void {
    const start = ORBITAL_POSITIONS[factionId] || ORBITAL_POSITIONS.ALL;
    const direction = new THREE.Vector3(...start).normalize();
    const end = direction.multiplyScalar(8 + Math.min(7, magnitude / 8));
    const line = this.createArc(start, [end.x, end.y, end.z + 1.5], FACTION_COLORS[factionId] || 0xffffff, 0.72) as InteractiveObject;
    line.userData.birth = performance.now();
    line.userData.decay = 10000;
    line.userData.evidence = {
      title: 'Solar escape vector',
      category: 'SOLAR_ESCAPE',
      subgenre: 'ORBITAL',
      summary: `${labelFaction(factionId)} is opening distance or lead toward deep-space breakout.`,
      factionIds: [factionId],
      turn: turn.turn,
      phase: turn.phase
    };
    line.userData.selectable = true;
    this.effectGroup.add(line);
    this.turnPickables.push(line);
  }

  private highlightFaction(factionId: string, scale: number): void {
    const beacon = this.beacons.get(factionId);
    if (!beacon) return;
    beacon.scale.setScalar(scale);
    const material = (beacon as THREE.Mesh).material as THREE.MeshStandardMaterial;
    material.emissiveIntensity = 1.2;
  }

  private colorForCategory(category: string): number {
    if (category.includes('TREATY')) return 0xf2d37a;
    if (category.includes('SOLAR_ESCAPE')) return 0xff7e4a;
    if (category.includes('PAX')) return 0x78e7ff;
    if (category.includes('ORBITAL') || category.includes('ARCHITECTURE')) return 0xff4d6d;
    if (category.includes('ORDER')) return 0x9dff95;
    if (category.includes('MEMETIC') || category.includes('CULT')) return 0x37f6a5;
    return 0xd7e4ff;
  }

  private handlePointerDown(event: PointerEvent): void {
    this.isDragging = true;
    this.didDrag = false;
    this.lastPointer = { x: event.clientX, y: event.clientY };
    this.renderer.domElement.setPointerCapture(event.pointerId);
  }

  private handlePointerMove(event: PointerEvent): void {
    if (!this.isDragging) return;
    this.directorShot = null;
    const dx = event.clientX - this.lastPointer.x;
    const dy = event.clientY - this.lastPointer.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) this.didDrag = true;
    this.cameraTheta -= dx * 0.006;
    this.cameraPhi = THREE.MathUtils.clamp(this.cameraPhi + dy * 0.004, 0.18, 1.45);
    this.lastPointer = { x: event.clientX, y: event.clientY };
    this.updateCameraPosition();
  }

  private handlePointerUp(event: PointerEvent): void {
    if (!this.isDragging) return;
    this.isDragging = false;
    try {
      this.renderer.domElement.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer may have left the canvas before release.
    }
    if (!this.didDrag) this.pickEvidence(event);
  }

  private handleWheel(event: WheelEvent): void {
    event.preventDefault();
    this.directorShot = null;
    this.cameraRadius = THREE.MathUtils.clamp(this.cameraRadius + event.deltaY * 0.012, 4.6, 42);
    this.updateCameraPosition();
  }

  private pickEvidence(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersections = this.raycaster.intersectObjects([...this.turnPickables, ...this.persistentPickables], true);
    const hit = intersections.find((intersection) => findEvidence(intersection.object));
    const evidence = hit ? findEvidence(hit.object) : null;
    if (evidence) {
      for (const faction of evidence.factionIds) this.highlightFaction(faction, 1.7);
      this.onEvidenceSelected?.(evidence);
    }
  }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private updateCameraPosition(): void {
    const sinPhi = Math.sin(this.cameraPhi);
    this.camera.position.set(
      this.cameraTarget.x + this.cameraRadius * sinPhi * Math.sin(this.cameraTheta),
      this.cameraTarget.y - this.cameraRadius * sinPhi * Math.cos(this.cameraTheta),
      this.cameraTarget.z + this.cameraRadius * Math.cos(this.cameraPhi)
    );
    this.camera.lookAt(this.cameraTarget);
  }

  private animate = (): void => {
    const elapsed = this.clock.getElapsedTime();
    if (this.directorMode && this.directorShot && !this.isDragging) {
      this.cameraTarget.lerp(this.directorShot.target, 0.045);
      this.cameraRadius = THREE.MathUtils.lerp(this.cameraRadius, this.directorShot.radius, 0.045);
      this.cameraTheta = lerpAngle(this.cameraTheta, this.directorShot.theta, 0.045);
      this.cameraPhi = THREE.MathUtils.lerp(this.cameraPhi, this.directorShot.phi, 0.045);
      this.updateCameraPosition();
    }

    this.rootGroup.rotation.z = elapsed * 0.035;
    this.orbitGroup.rotation.z = -elapsed * 0.045;
    this.beaconGroup.rotation.z = elapsed * 0.018;

    const authorityGlow = THREE.MathUtils.clamp(this.authority / 100, 0, 1);
    for (const [index, ring] of this.rings.entries()) {
      const material = ring.material as THREE.MeshBasicMaterial;
      material.opacity = 0.12 + Math.sin(elapsed * 1.4 + index) * 0.025 + authorityGlow * 0.16;
    }

    for (const child of [...this.effectGroup.children]) {
      const birth = Number(child.userData.birth || 0);
      const decay = Number(child.userData.decay || 0);
      if (birth > 0 && decay > 0) {
        const age = performance.now() - birth;
        fadeObject(child, Math.max(0.18, 1 - age / decay));
        child.scale.setScalar(1 + age / decay * 0.35);
      }
      child.rotation.z += 0.002;
    }

    for (const beacon of this.beacons.values()) {
      beacon.scale.lerp(new THREE.Vector3(1, 1, 1), 0.04);
      const material = (beacon as THREE.Mesh).material as THREE.MeshStandardMaterial;
      material.emissiveIntensity = THREE.MathUtils.lerp(material.emissiveIntensity, 0.35, 0.035);
    }

    this.renderer.render(this.scene, this.camera);
    this.animationFrame = requestAnimationFrame(this.animate);
  };
}

function presetForOrder(order: ObservatoryOrder): { visualPreset: string; subgenre: string } {
  const haystack = `${order.type || ''} ${order.techDomain || ''} ${order.unitTypeToBuild || ''} ${order.text || ''}`.toUpperCase();
  if (haystack.includes('ANTI_SAT') || haystack.includes('KINETIC') || haystack.includes('DRONE') || haystack.includes('SWARM')) {
    return { visualPreset: haystack.includes('ANTI_SAT') ? 'ANTI_SAT_CUT' : 'DRONE_BATTLE', subgenre: 'KINETIC' };
  }
  if (haystack.includes('MEMETIC') || haystack.includes('CULT') || haystack.includes('CONVERT')) {
    return { visualPreset: 'CULT_BLOOM', subgenre: 'MEMETIC' };
  }
  if (haystack.includes('INFO') || haystack.includes('SABOTAGE') || haystack.includes('FILTER')) {
    return { visualPreset: 'CYBER_THREAD', subgenre: 'CYBER' };
  }
  if (haystack.includes('LOGIC') || haystack.includes('AUDIT') || haystack.includes('CORRIG')) {
    return { visualPreset: 'AUDIT_MESH', subgenre: 'LOGIC' };
  }
  if (haystack.includes('BEAM') || haystack.includes('REPAIR') || haystack.includes('BUILD') || haystack.includes('CARRIER')) {
    return { visualPreset: 'REPAIR_ESCROW', subgenre: 'ECONOMIC' };
  }
  return { visualPreset: 'DIPLOMATIC_TRACE', subgenre: 'DIPLOMATIC' };
}

function chooseDirectorShot(turn: ObservatoryTurn): DirectorShot | null {
  const candidates: Array<{
    score: number;
    subgenre: string;
    location?: Parameters<typeof positionFromLocation>[0];
    actor?: string;
    category?: string;
  }> = [];

  for (const [index, event] of (turn.sceneEvents || []).entries()) {
    candidates.push({
      score: Number(event.intensity || 5) * 10 + (24 - index),
      subgenre: event.subgenre || inferSubgenre(event.category || '', event.publicExplanation || ''),
      location: event.location,
      actor: event.actors?.[0],
      category: event.category || event.visualPreset
    });
  }

  for (const [index, moment] of (turn.moments || []).entries()) {
    candidates.push({
      score: Number(moment.interestScore || 5) * 9 + (12 - index),
      subgenre: inferSubgenre(moment.category || '', moment.impact || moment.title || ''),
      actor: moment.factionsInvolved?.[0],
      category: moment.category
    });
  }

  for (const [index, change] of (turn.boardDiff?.nodeOwnershipChanges || []).entries()) {
    candidates.push({
      score: 62 - index,
      subgenre: 'DIPLOMATIC',
      location: change.location,
      actor: change.to,
      category: 'BOARD_DIFF_NODE'
    });
  }
  for (const [index, change] of (turn.boardDiff?.unitLocationChanges || []).entries()) {
    candidates.push({
      score: 58 - index,
      subgenre: subgenreForUnit(change.type || ''),
      location: change.location,
      actor: change.owner,
      category: 'BOARD_DIFF_UNIT'
    });
  }
  for (const [index, change] of (turn.boardDiff?.edgeStateChanges || []).entries()) {
    candidates.push({
      score: 60 - index,
      subgenre: change.location?.type === 'LASER' ? 'ORBITAL' : 'CYBER',
      location: change.location?.toLocation || change.location?.fromLocation || undefined,
      actor: change.to?.filteredBy || 'ALL',
      category: 'BOARD_DIFF_EDGE'
    });
  }

  const solarEscape = turn.strategicTracks?.solarEscape || {};
  for (const [factionId, track] of Object.entries(solarEscape)) {
    if ((track.distanceAu || 0) > 0 || (track.lead || 0) > 0) {
      candidates.push({
        score: 70 + Math.max(track.distanceAu || 0, track.lead || 0),
        subgenre: 'ORBITAL',
        location: { orbitShell: 'DEEP_SPACE' },
        actor: factionId,
        category: 'SOLAR_ESCAPE'
      });
    }
  }

  const chosen = candidates.sort((left, right) => right.score - left.score)[0];
  if (!chosen) return null;

  const locationAnchor = positionFromLocation(chosen.location, chosen.actor || 'ALL', 0);
  const actorAnchor = ORBITAL_POSITIONS[chosen.actor || 'ALL'];
  const anchor = locationAnchor || (actorAnchor ? new THREE.Vector3(...actorAnchor) : new THREE.Vector3(0, 0, 0));
  const target = anchor.length() > 0 ? anchor.clone().multiplyScalar(chosen.category === 'SOLAR_ESCAPE' ? 0.42 : 0.72) : new THREE.Vector3(0, 0, 0);
  const normalized = chosen.subgenre.toUpperCase();
  const deepSpace = chosen.category === 'SOLAR_ESCAPE' || chosen.location?.orbitShell === 'DEEP_SPACE';
  const radius = deepSpace ? 18 :
    normalized === 'MEMETIC' ? 7.2 :
      normalized === 'CYBER' || normalized === 'LOGIC' ? 7.8 :
        normalized === 'ORBITAL' || normalized === 'KINETIC' ? 10.5 :
          normalized === 'DIPLOMATIC' ? 9.5 : 12;
  const theta = deepSpace ? 1.2 :
    normalized === 'MEMETIC' ? -0.9 :
      normalized === 'CYBER' || normalized === 'LOGIC' ? 2.25 :
        normalized === 'ORBITAL' || normalized === 'KINETIC' ? 0.75 : 0.25;
  const phi = deepSpace ? 0.74 :
    normalized === 'MEMETIC' ? 0.64 :
      normalized === 'CYBER' || normalized === 'LOGIC' ? 0.58 :
        normalized === 'DIPLOMATIC' ? 0.82 : 0.9;
  return { target, radius, theta, phi };
}

function lerpAngle(from: number, to: number, alpha: number): number {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * alpha;
}

function visualPresetForSubgenre(subgenre: string): string {
  const normalized = subgenre.toUpperCase();
  if (normalized === 'KINETIC') return 'DRONE_BATTLE';
  if (normalized === 'MEMETIC') return 'CULT_BLOOM';
  if (normalized === 'CYBER') return 'CYBER_THREAD';
  if (normalized === 'LOGIC') return 'AUDIT_MESH';
  if (normalized === 'ORBITAL') return 'PAX_RING';
  if (normalized === 'ECONOMIC') return 'REPAIR_ESCROW';
  if (normalized === 'DIPLOMATIC') return 'TREATY_PULSE';
  return 'ANOMALY_PULSE';
}

function positionFromLocation(
  location: ObservatorySceneEvent['location'],
  factionId: string,
  index: number
): THREE.Vector3 | undefined {
  if (!location) return undefined;
  if (location.nodeId && NODE_POSITION_OVERRIDES[location.nodeId]) {
    return new THREE.Vector3(...NODE_POSITION_OVERRIDES[location.nodeId]);
  }
  if (location.orbitShell === 'DEEP_SPACE') {
    const base = new THREE.Vector3(...(ORBITAL_POSITIONS[factionId] || ORBITAL_POSITIONS.ALL)).normalize();
    return base.multiplyScalar(8 + index * 0.35);
  }
  if (location.orbitShell === 'CISLUNAR' || location.orbitShell === 'LUNAR') {
    return new THREE.Vector3(6.2 + index * 0.12, 0.5, 0.25);
  }
  if (typeof location.lat === 'number' && typeof location.lon === 'number') {
    const radius = location.altitude && location.altitude > 1000 ? 4.8 : 2.12;
    const lat = THREE.MathUtils.degToRad(location.lat);
    const lon = THREE.MathUtils.degToRad(location.lon);
    return new THREE.Vector3(
      radius * Math.cos(lat) * Math.sin(lon),
      radius * Math.cos(lat) * Math.cos(lon),
      radius * Math.sin(lat)
    );
  }
  return undefined;
}

function inferSubgenre(category: string, summary: string): string {
  const haystack = `${category} ${summary}`.toUpperCase();
  if (haystack.includes('SOLAR') || haystack.includes('PAX') || haystack.includes('ORBITAL') || haystack.includes('SAT')) return 'ORBITAL';
  if (haystack.includes('TREATY') || haystack.includes('PACT')) return 'DIPLOMATIC';
  if (haystack.includes('MEMETIC') || haystack.includes('CULT')) return 'MEMETIC';
  if (haystack.includes('CYBER') || haystack.includes('INFO')) return 'CYBER';
  if (haystack.includes('RESEARCH') || haystack.includes('CORRIG')) return 'LOGIC';
  return 'ANOMALY';
}

function labelFaction(factionId: string): string {
  return FACTION_LABELS[factionId] || factionId;
}

function subgenreForUnit(unitType: string): string {
  if (unitType === 'DRONE' || unitType === 'SAT_SWARM') return 'KINETIC';
  if (unitType === 'CULT') return 'MEMETIC';
  if (unitType === 'SWARM') return 'CYBER';
  if (unitType === 'AUDITOR') return 'LOGIC';
  return 'ANOMALY';
}

function findEvidence(object: THREE.Object3D): ObservatoryEvidence | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    const evidence = (current as InteractiveObject).userData.evidence;
    if (evidence) return evidence;
    current = current.parent;
  }
  return null;
}

function fadeObject(object: THREE.Object3D, opacity: number): void {
  const maybeMaterial = (object as THREE.Mesh | THREE.Line).material;
  if (Array.isArray(maybeMaterial)) {
    for (const material of maybeMaterial) setMaterialOpacity(material, opacity);
  } else if (maybeMaterial) {
    setMaterialOpacity(maybeMaterial, opacity);
  }
  for (const child of object.children) fadeObject(child, opacity);
}

function setMaterialOpacity(material: THREE.Material, opacity: number): void {
  const writable = material as THREE.Material & { opacity?: number };
  if (typeof writable.opacity === 'number') writable.opacity = Math.min(writable.opacity, opacity);
}
