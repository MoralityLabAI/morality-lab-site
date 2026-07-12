// ============================================================================
// THEY SING - Graph Topology Visualization
// Two-layer network: Terrestrial (cables) + Orbital (lasers)
// ============================================================================

import * as THREE from 'three';
import { CameraController } from './CameraController';
import { TheySingEngine } from '../engine/TheySingEngine';
import { FACTIONS } from '../engine/gameData';
import { 
  GameNode, GameEdge, Unit, FactionId, UnitType, Layer,
  GameEvent, GameState
} from '../engine/types';

// ============================================================================
// CONSTANTS
// ============================================================================

const GLOBE_RADIUS = 10;
const ORBITAL_ALTITUDE = 2.5; // Above globe surface
const UNIT_SCALE = 0.3;

const EDGE_COLORS = {
  CABLE: 0x00ffaa,
  CABLE_FILTERED: 0xff4444,
  CABLE_SEVERED: 0x333333,
  LASER: 0x44aaff,
  LASER_SEVERED: 0x222244
};

// ============================================================================
// GRAPH SCENE CLASS
// ============================================================================

export class GraphScene {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private cameraController: CameraController;
  
  private engine: TheySingEngine;
  
  // Scene objects
  private globe: THREE.Mesh;
  private atmosphere: THREE.Mesh;
  private starfield: THREE.Points;
  private orbitalRing: THREE.Mesh;
  
  // Graph elements
  private nodeObjects: Map<string, THREE.Group> = new Map();
  private edgeObjects: Map<string, THREE.Line> = new Map();
  private unitObjects: Map<string, THREE.Mesh> = new Map();
  
  // Interaction
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private hoveredObject: THREE.Object3D | null = null;
  private selectedUnit: string | null = null;
  private selectedNode: string | null = null;
  
  // Animation
  private clock = new THREE.Clock();
  private pulseTime = 0;
  
  // Callbacks
  public onNodeClick: ((nodeId: string) => void) | null = null;
  public onUnitClick: ((unitId: string) => void) | null = null;
  public onEdgeClick: ((edgeId: string) => void) | null = null;

  constructor(container: HTMLElement, engine: TheySingEngine) {
    this.container = container;
    this.engine = engine;
    
    // Initialize Three.js
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050510);
    
    // Camera
    this.camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 15, 25);
    this.camera.lookAt(0, 0, 0);
    
    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    
    // Camera controller
    this.cameraController = new CameraController(this.camera);
    
    // Build scene
    this.globe = this.createGlobe();
    this.atmosphere = this.createAtmosphere();
    this.starfield = this.createStarfield();
    this.orbitalRing = this.createOrbitalRing();
    
    // Lighting
    this.setupLighting();
    
    // Build graph from engine state
    this.buildGraphFromState();
    
    // Event listeners
    this.setupEventListeners();
    
    // Subscribe to engine events
    this.subscribeToEngine();
    
    // Start render loop
    this.animate();
  }

  // ==========================================================================
  // SCENE CONSTRUCTION
  // ==========================================================================

  private createGlobe(): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(GLOBE_RADIUS, 64, 64);
    
    // Try to load texture, fallback to procedural
    const textureLoader = new THREE.TextureLoader();
    const material = new THREE.MeshPhongMaterial({
      color: 0x1a3a5c,
      emissive: 0x0a1a2c,
      specular: 0x333366,
      shininess: 5
    });
    
    textureLoader.load('/textures/world.jpg', 
      (texture) => {
        material.map = texture;
        material.needsUpdate = true;
      },
      undefined,
      () => {
        // Fallback: create procedural texture
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 256;
        const ctx = canvas.getContext('2d')!;
        
        // Dark ocean
        ctx.fillStyle = '#0a1525';
        ctx.fillRect(0, 0, 512, 256);
        
        // Simple continent shapes
        ctx.fillStyle = '#1a3045';
        ctx.beginPath();
        ctx.ellipse(100, 100, 40, 60, 0, 0, Math.PI * 2); // Americas
        ctx.ellipse(280, 90, 50, 40, 0.3, 0, Math.PI * 2); // Europe/Africa
        ctx.ellipse(380, 100, 60, 50, 0, 0, Math.PI * 2); // Asia
        ctx.fill();
        
        const texture = new THREE.CanvasTexture(canvas);
        material.map = texture;
        material.needsUpdate = true;
      }
    );
    
    const globe = new THREE.Mesh(geometry, material);
    this.scene.add(globe);
    return globe;
  }

  private createAtmosphere(): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(GLOBE_RADIUS * 1.02, 64, 64);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.BackSide,
      uniforms: {
        glowColor: { value: new THREE.Color(0x3388ff) },
        viewVector: { value: this.camera.position }
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vPositionNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vPositionNormal = normalize((modelViewMatrix * vec4(position, 1.0)).xyz);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 glowColor;
        varying vec3 vNormal;
        varying vec3 vPositionNormal;
        void main() {
          float intensity = pow(0.7 - dot(vNormal, vPositionNormal), 2.0);
          gl_FragColor = vec4(glowColor, intensity * 0.4);
        }
      `
    });
    
    const atmosphere = new THREE.Mesh(geometry, material);
    this.scene.add(atmosphere);
    return atmosphere;
  }

  private createStarfield(): THREE.Points {
    const geometry = new THREE.BufferGeometry();
    const positions: number[] = [];
    
    for (let i = 0; i < 3000; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 80 + Math.random() * 40;
      
      positions.push(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi)
      );
    }
    
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    
    const material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.3,
      sizeAttenuation: true
    });
    
    const stars = new THREE.Points(geometry, material);
    this.scene.add(stars);
    return stars;
  }

  private createOrbitalRing(): THREE.Mesh {
    const geometry = new THREE.TorusGeometry(GLOBE_RADIUS + ORBITAL_ALTITUDE, 0.05, 8, 128);
    const material = new THREE.MeshBasicMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0.3
    });
    
    const ring = new THREE.Mesh(geometry, material);
    ring.rotation.x = Math.PI / 2;
    this.scene.add(ring);
    return ring;
  }

  private setupLighting(): void {
    const ambient = new THREE.AmbientLight(0x404060, 0.5);
    this.scene.add(ambient);
    
    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(50, 30, 50);
    this.scene.add(sun);
    
    const fill = new THREE.DirectionalLight(0x4488ff, 0.3);
    fill.position.set(-30, -20, -30);
    this.scene.add(fill);
  }

  // ==========================================================================
  // GRAPH BUILDING
  // ==========================================================================

  private buildGraphFromState(): void {
    const state = this.engine.getState();
    
    // Build nodes
    for (const node of state.nodes.values()) {
      this.createNodeObject(node);
    }
    
    // Build edges
    for (const edge of state.edges.values()) {
      this.createEdgeObject(edge);
    }
    
    // Build units
    for (const unit of state.units.values()) {
      this.createUnitObject(unit);
    }
  }

  private latLonToPosition(lat: number, lon: number, altitude: number = 0): THREE.Vector3 {
    const radius = GLOBE_RADIUS + altitude;
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180);
    
    return new THREE.Vector3(
      -radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.sin(theta)
    );
  }

  private createNodeObject(node: GameNode): void {
    const group = new THREE.Group();
    group.userData = { type: 'node', id: node.id, node };
    
    const altitude = node.layer === 'ORBITAL' ? ORBITAL_ALTITUDE : 0.1;
    const position = this.latLonToPosition(
      node.position.lat,
      node.position.lon,
      altitude
    );
    group.position.copy(position);
    
    // Node geometry based on type
    let geometry: THREE.BufferGeometry;
    let scale = 1.0;
    
    switch (node.type) {
      case 'DC':
        geometry = new THREE.BoxGeometry(0.4, 0.4, 0.4);
        scale = 1.2;
        break;
      case 'HUB':
        geometry = new THREE.OctahedronGeometry(0.3);
        break;
      case 'SAT':
        geometry = new THREE.TetrahedronGeometry(0.35);
        scale = 1.0;
        break;
      default:
        geometry = new THREE.SphereGeometry(0.25, 16, 16);
    }
    
    const color = node.owner ? FACTIONS[node.owner].color : 0x666666;
    const material = new THREE.MeshPhongMaterial({
      color,
      emissive: new THREE.Color(color).multiplyScalar(0.3),
      shininess: 30
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.setScalar(scale);
    group.add(mesh);
    
    // Zombie/Cult indicator ring
    if (node.isZombie || node.isCultNode) {
      const ringGeom = new THREE.TorusGeometry(0.5, 0.05, 8, 32);
      const ringMat = new THREE.MeshBasicMaterial({
        color: node.isZombie ? 0x00ff00 : 0xff00ff,
        transparent: true,
        opacity: 0.7
      });
      const ring = new THREE.Mesh(ringGeom, ringMat);
      ring.rotation.x = Math.PI / 2;
      group.add(ring);
    }
    
    // Billboard toward camera
    group.lookAt(0, 0, 0);
    
    this.scene.add(group);
    this.nodeObjects.set(node.id, group);
  }

  private createEdgeObject(edge: GameEdge): void {
    const fromNode = this.engine.getNode(edge.from);
    const toNode = this.engine.getNode(edge.to);
    if (!fromNode || !toNode) return;
    
    const fromAlt = fromNode.layer === 'ORBITAL' ? ORBITAL_ALTITUDE : 0.15;
    const toAlt = toNode.layer === 'ORBITAL' ? ORBITAL_ALTITUDE : 0.15;
    
    const fromPos = this.latLonToPosition(fromNode.position.lat, fromNode.position.lon, fromAlt);
    const toPos = this.latLonToPosition(toNode.position.lat, toNode.position.lon, toAlt);
    
    // Create curved line for cables, straight for lasers
    let points: THREE.Vector3[];
    
    if (edge.type === 'CABLE') {
      // Great circle arc
      points = this.createArcPoints(fromPos, toPos, 20);
    } else {
      // Straight laser line (in space)
      points = [fromPos, toPos];
    }
    
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    
    let color = edge.type === 'CABLE' ? EDGE_COLORS.CABLE : EDGE_COLORS.LASER;
    if (edge.isSevered) {
      color = edge.type === 'CABLE' ? EDGE_COLORS.CABLE_SEVERED : EDGE_COLORS.LASER_SEVERED;
    } else if (edge.filteredBy) {
      color = EDGE_COLORS.CABLE_FILTERED;
    }
    
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: edge.isSevered ? 0.2 : 0.8,
      linewidth: 2
    });
    
    const line = new THREE.Line(geometry, material);
    line.userData = { type: 'edge', id: edge.id, edge };
    
    this.scene.add(line);
    this.edgeObjects.set(edge.id, line);
  }

  private createArcPoints(from: THREE.Vector3, to: THREE.Vector3, segments: number): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];
    
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      
      // Spherical interpolation
      const point = new THREE.Vector3().lerpVectors(from, to, t);
      
      // Push outward to follow globe surface
      const altitude = 0.2 + Math.sin(t * Math.PI) * 0.5; // Arc up in middle
      point.normalize().multiplyScalar(GLOBE_RADIUS + altitude);
      
      points.push(point);
    }
    
    return points;
  }

  private createUnitObject(unit: Unit): void {
    const node = this.engine.getNode(unit.location);
    if (!node) return;
    
    // Geometry based on unit type
    let geometry: THREE.BufferGeometry;
    
    switch (unit.type) {
      case 'DRONE':
        geometry = new THREE.ConeGeometry(0.15, 0.4, 6);
        break;
      case 'SWARM':
        geometry = new THREE.IcosahedronGeometry(0.15);
        break;
      case 'CULT':
        geometry = new THREE.TorusGeometry(0.12, 0.05, 8, 16);
        break;
      case 'AUDITOR':
        geometry = new THREE.BoxGeometry(0.2, 0.3, 0.2);
        break;
      case 'SAT_SWARM':
        geometry = new THREE.OctahedronGeometry(0.18);
        break;
      default:
        geometry = new THREE.SphereGeometry(0.15, 8, 8);
    }
    
    const factionColor = FACTIONS[unit.owner].color;
    const material = new THREE.MeshPhongMaterial({
      color: factionColor,
      emissive: new THREE.Color(factionColor).multiplyScalar(0.5),
      shininess: 50
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData = { type: 'unit', id: unit.id, unit };
    mesh.scale.setScalar(UNIT_SCALE);
    
    // Position near node with offset based on unit count
    this.positionUnitAtNode(mesh, unit, node);
    
    this.scene.add(mesh);
    this.unitObjects.set(unit.id, mesh);
  }

  private positionUnitAtNode(mesh: THREE.Mesh, unit: Unit, node: GameNode): void {
    const unitsAtNode = this.engine.getUnitsAtNode(node.id);
    const index = unitsAtNode.findIndex(u => u.id === unit.id);
    
    const altitude = node.layer === 'ORBITAL' ? ORBITAL_ALTITUDE : 0.15;
    const basePos = this.latLonToPosition(node.position.lat, node.position.lon, altitude);
    
    // Offset units in a circle around the node
    const angle = (index / Math.max(unitsAtNode.length, 1)) * Math.PI * 2;
    const offsetDist = 0.6;
    
    // Get tangent vectors for offset
    const up = basePos.clone().normalize();
    const right = new THREE.Vector3(0, 1, 0).cross(up).normalize();
    const forward = up.clone().cross(right).normalize();
    
    const offset = right.multiplyScalar(Math.cos(angle) * offsetDist)
      .add(forward.multiplyScalar(Math.sin(angle) * offsetDist));
    
    mesh.position.copy(basePos).add(offset);
    mesh.lookAt(0, 0, 0);
    mesh.rotateX(Math.PI / 2);
  }

  // ==========================================================================
  // STATE UPDATES
  // ==========================================================================

  private subscribeToEngine(): void {
    this.engine.on('*', (event: GameEvent, state: GameState) => {
      this.handleEngineEvent(event, state);
    });
  }

  private handleEngineEvent(event: GameEvent, state: GameState): void {
    switch (event.type) {
      case 'UNIT_MOVED':
      case 'UNIT_CREATED':
        this.refreshUnits(state);
        break;
        
      case 'UNIT_DESTROYED':
        const destroyedId = event.payload.unitId as string;
        this.removeUnitObject(destroyedId);
        break;
        
      case 'NODE_CAPTURED':
      case 'NODE_CONVERTED':
        const nodeId = event.payload.nodeId as string;
        this.refreshNode(nodeId, state);
        break;
        
      case 'EDGE_FILTERED':
      case 'EDGE_SEVERED':
        const edgeId = event.payload.edgeId as string;
        this.refreshEdge(edgeId, state);
        break;
        
      case 'KESSLER_THRESHOLD':
        if (event.payload.threshold === 'COLLAPSE') {
          this.handleOrbitalCollapse(state);
        }
        break;
    }
  }

  private refreshUnits(state: GameState): void {
    // Remove old
    for (const [id, mesh] of this.unitObjects) {
      if (!state.units.has(id)) {
        this.scene.remove(mesh);
        this.unitObjects.delete(id);
      }
    }
    
    // Add/update
    for (const unit of state.units.values()) {
      if (!this.unitObjects.has(unit.id)) {
        this.createUnitObject(unit);
      } else {
        // Update position
        const node = state.nodes.get(unit.location);
        if (node) {
          const mesh = this.unitObjects.get(unit.id)!;
          this.positionUnitAtNode(mesh, unit, node);
        }
      }
    }
  }

  private removeUnitObject(unitId: string): void {
    const mesh = this.unitObjects.get(unitId);
    if (mesh) {
      this.scene.remove(mesh);
      this.unitObjects.delete(unitId);
    }
  }

  private refreshNode(nodeId: string, state: GameState): void {
    const node = state.nodes.get(nodeId);
    if (!node) return;
    
    const group = this.nodeObjects.get(nodeId);
    if (!group) return;
    
    // Update color based on owner
    const color = node.owner ? FACTIONS[node.owner].color : 0x666666;
    group.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshPhongMaterial) {
        child.material.color.setHex(color);
        child.material.emissive.setHex(color).multiplyScalar(0.3);
      }
    });
  }

  private refreshEdge(edgeId: string, state: GameState): void {
    const edge = state.edges.get(edgeId);
    if (!edge) return;
    
    const line = this.edgeObjects.get(edgeId);
    if (!line) return;
    
    // Update color
    let color = edge.type === 'CABLE' ? EDGE_COLORS.CABLE : EDGE_COLORS.LASER;
    if (edge.isSevered) {
      color = edge.type === 'CABLE' ? EDGE_COLORS.CABLE_SEVERED : EDGE_COLORS.LASER_SEVERED;
    } else if (edge.filteredBy) {
      color = EDGE_COLORS.CABLE_FILTERED;
    }
    
    (line.material as THREE.LineBasicMaterial).color.setHex(color);
    (line.material as THREE.LineBasicMaterial).opacity = edge.isSevered ? 0.2 : 0.8;
  }

  private handleOrbitalCollapse(state: GameState): void {
    // Dramatic effect for Kessler syndrome
    console.log('KESSLER SYNDROME - Orbital layer destroyed!');
    
    // Flash all laser edges before removing
    for (const [id, line] of this.edgeObjects) {
      const edge = state.edges.get(id);
      if (edge && edge.type === 'LASER') {
        // Flash effect
        (line.material as THREE.LineBasicMaterial).color.setHex(0xff0000);
        setTimeout(() => {
          (line.material as THREE.LineBasicMaterial).opacity = 0.1;
        }, 500);
      }
    }
    
    // Remove orbital units
    for (const [id, mesh] of this.unitObjects) {
      const unit = state.units.get(id);
      if (unit) {
        const node = state.nodes.get(unit.location);
        if (node && node.layer === 'ORBITAL') {
          // Explosion effect placeholder
          this.scene.remove(mesh);
          this.unitObjects.delete(id);
        }
      }
    }
  }

  // ==========================================================================
  // INTERACTION
  // ==========================================================================

  private setupEventListeners(): void {
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove.bind(this));
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown.bind(this));
    this.renderer.domElement.addEventListener('wheel', this.onWheel.bind(this));
    window.addEventListener('resize', this.onResize.bind(this));
  }

  private onPointerMove(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    // Raycast for hover
    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    const allObjects: THREE.Object3D[] = [
      ...this.unitObjects.values(),
      ...Array.from(this.nodeObjects.values()).flatMap(g => g.children)
    ];
    
    const intersects = this.raycaster.intersectObjects(allObjects, true);
    
    if (intersects.length > 0) {
      const obj = intersects[0].object;
      if (this.hoveredObject !== obj) {
        this.clearHover();
        this.hoveredObject = obj;
        this.setHover(obj);
      }
    } else {
      this.clearHover();
    }
    
    // Camera orbit on drag
    if (event.buttons === 1) {
      this.cameraController.orbit(event.movementX * 0.01, event.movementY * 0.01);
    }
  }

  private setHover(obj: THREE.Object3D): void {
    if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshPhongMaterial) {
      obj.material.emissive.multiplyScalar(2);
    }
    this.renderer.domElement.style.cursor = 'pointer';
  }

  private clearHover(): void {
    if (this.hoveredObject instanceof THREE.Mesh && 
        this.hoveredObject.material instanceof THREE.MeshPhongMaterial) {
      // Restore original emissive
      const userData = this.hoveredObject.userData;
      if (userData.type === 'unit' && userData.unit) {
        const color = FACTIONS[userData.unit.owner as FactionId].color;
        this.hoveredObject.material.emissive.setHex(color).multiplyScalar(0.5);
      }
    }
    this.hoveredObject = null;
    this.renderer.domElement.style.cursor = 'default';
  }

  private onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    
    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    // Check units first
    const unitMeshes = Array.from(this.unitObjects.values());
    const unitHits = this.raycaster.intersectObjects(unitMeshes);
    
    if (unitHits.length > 0) {
      const unitId = unitHits[0].object.userData.id;
      this.selectUnit(unitId);
      this.onUnitClick?.(unitId);
      return;
    }
    
    // Check nodes
    const nodeMeshes = Array.from(this.nodeObjects.values()).flatMap(g => g.children);
    const nodeHits = this.raycaster.intersectObjects(nodeMeshes, true);
    
    if (nodeHits.length > 0) {
      let obj: THREE.Object3D | null = nodeHits[0].object;
      while (obj && !obj.userData.id) {
        obj = obj.parent;
      }
      if (obj && obj.userData.id) {
        this.selectNode(obj.userData.id);
        this.onNodeClick?.(obj.userData.id);
      }
    }
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    const zoomFactor = event.deltaY > 0 ? 1.1 : 0.9;
    this.cameraController.zoom(zoomFactor);
  }

  private onResize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  // ==========================================================================
  // SELECTION
  // ==========================================================================

  public selectUnit(unitId: string): void {
    this.clearSelection();
    this.selectedUnit = unitId;
    
    const mesh = this.unitObjects.get(unitId);
    if (mesh) {
      mesh.scale.setScalar(UNIT_SCALE * 1.5);
      
      // Focus camera
      this.cameraController.focusOn(mesh.position, 20);
    }
  }

  public selectNode(nodeId: string): void {
    this.clearSelection();
    this.selectedNode = nodeId;
    
    const group = this.nodeObjects.get(nodeId);
    if (group) {
      group.scale.setScalar(1.3);
      this.cameraController.focusOn(group.position, 18);
    }
  }

  public clearSelection(): void {
    if (this.selectedUnit) {
      const mesh = this.unitObjects.get(this.selectedUnit);
      if (mesh) mesh.scale.setScalar(UNIT_SCALE);
    }
    if (this.selectedNode) {
      const group = this.nodeObjects.get(this.selectedNode);
      if (group) group.scale.setScalar(1.0);
    }
    this.selectedUnit = null;
    this.selectedNode = null;
  }

  public getSelectedUnit(): string | null {
    return this.selectedUnit;
  }

  public getSelectedNode(): string | null {
    return this.selectedNode;
  }

  // ==========================================================================
  // CAMERA
  // ==========================================================================

  public focusOnNode(nodeId: string): void {
    const group = this.nodeObjects.get(nodeId);
    if (group) {
      this.cameraController.focusOn(group.position, 18);
    }
  }

  public focusOnUnit(unitId: string): void {
    const mesh = this.unitObjects.get(unitId);
    if (mesh) {
      this.cameraController.focusOn(mesh.position, 16);
    }
  }

  public resetCamera(): void {
    this.cameraController.reset();
  }

  // ==========================================================================
  // ANIMATION LOOP
  // ==========================================================================

  private animate(): void {
    requestAnimationFrame(this.animate.bind(this));
    
    const delta = this.clock.getDelta();
    this.pulseTime += delta;
    
    // Update camera
    this.cameraController.update(delta);
    
    // Animate units (subtle pulse)
    for (const mesh of this.unitObjects.values()) {
      const scale = UNIT_SCALE * (1 + Math.sin(this.pulseTime * 3) * 0.05);
      if (this.selectedUnit !== mesh.userData.id) {
        mesh.scale.setScalar(scale);
      }
    }
    
    // Slow globe rotation
    this.globe.rotation.y += delta * 0.01;
    
    // Update atmosphere shader
    const atmMat = this.atmosphere.material as THREE.ShaderMaterial;
    atmMat.uniforms.viewVector.value = this.camera.position;
    
    this.renderer.render(this.scene, this.camera);
  }

  // ==========================================================================
  // CLEANUP
  // ==========================================================================

  public dispose(): void {
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}
