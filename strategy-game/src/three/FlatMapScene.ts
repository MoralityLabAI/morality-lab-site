// ============================================================================
// THEY SING - Flat Map Scene
// 2D map with 3D camera, orbital layer as Z-offset
// Enhanced with starfield, earth texture, and Kessler effects
// ============================================================================

import * as THREE from 'three';
import { TheySingEngine } from '../engine/TheySingEngine';
import { FACTIONS } from '../engine/gameData';
import { 
  GameNode, GameEdge, Unit, FactionId, UnitType,
  GameEvent, GameState
} from '../engine/types';

// ============================================================================
// CONSTANTS
// ============================================================================

// Map dimensions (world units)
const MAP_WIDTH = 50;
const MAP_HEIGHT = 28;

// Z layers
const Z_STARS = -50;
const Z_OCEAN = -0.5;
const Z_LAND = 0;
const Z_GRID = 0.01;
const Z_CABLES = 0.1;
const Z_NODES_TERRESTRIAL = 0.3;
const Z_LASERS = 1.5;
const Z_ORBITAL_RING = 2.8;
const Z_NODES_ORBITAL = 3;
const Z_UNITS_OFFSET = 0.4;
const Z_KESSLER_DEBRIS = 4;

// Visual
const NODE_SIZE = 0.8;
const UNIT_SIZE = 0.5;

const COLORS = {
  ocean: 0x0a1525,
  land: 0x152535,
  grid: 0x1a3050,
  
  cable: 0x00ffaa,
  cableFiltered: 0xff3366,
  cableSevered: 0x333340,
  
  laser: 0x4488ff,
  laserFiltered: 0xff8844,
  laserSevered: 0x222233,
  
  orbitalRing: 0x334466,
  
  nodeOutline: 0x88aacc,
  
  selection: 0xffff00,
  hover: 0x66ffff
};

// ============================================================================
// FLAT MAP SCENE
// ============================================================================

export class FlatMapScene {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  
  private engine: TheySingEngine;
  
  // Scene layers
  private mapGroup: THREE.Group;
  private edgeGroup: THREE.Group;
  private nodeGroup: THREE.Group;
  private unitGroup: THREE.Group;
  private effectGroup: THREE.Group;
  
  // Object registries
  private nodeObjects: Map<string, THREE.Group> = new Map();
  private edgeObjects: Map<string, THREE.Line> = new Map();
  private unitObjects: Map<string, THREE.Group> = new Map();
  
  // Interaction
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private hoveredObject: THREE.Object3D | null = null;
  private selectedUnit: string | null = null;
  private selectedNode: string | null = null;
  
  // Camera control state
  private cameraTarget = new THREE.Vector3(0, 0, 0);
  private cameraTargetDesired = new THREE.Vector3(0, 0, 0);
  private cameraDistance = 35;
  private cameraDistanceDesired = 35;
  private cameraAngle = { theta: 0, phi: Math.PI * 0.35 }; // Slight tilt
  private isDragging = false;
  private lastMouse = { x: 0, y: 0 };
  
  // Animation
  private clock = new THREE.Clock();
  private pulsePhase = 0;
  
  // Callbacks
  public onNodeClick: ((nodeId: string) => void) | null = null;
  public onUnitClick: ((unitId: string) => void) | null = null;
  public onEdgeClick: ((edgeId: string) => void) | null = null;

  constructor(container: HTMLElement, engine: TheySingEngine) {
    this.container = container;
    this.engine = engine;
    
    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050510);
    
    // Camera - perspective with slight angle
    this.camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / container.clientHeight,
      0.1,
      500
    );
    this.cameraTargetDesired.copy(this.cameraTarget);
    this.cameraDistanceDesired = this.cameraDistance;
    this.updateCameraPosition();
    
    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true
    });
    this.renderer.setClearColor(0x000000, 0); // IMPORTANT
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    
    // Layer groups
    this.mapGroup = new THREE.Group();
    this.edgeGroup = new THREE.Group();
    this.nodeGroup = new THREE.Group();
    this.unitGroup = new THREE.Group();
    this.effectGroup = new THREE.Group();
    
    this.scene.add(this.mapGroup);
    this.scene.add(this.edgeGroup);
    this.scene.add(this.nodeGroup);
    this.scene.add(this.unitGroup);
    this.scene.add(this.effectGroup);
    
    // Build scene
    this.createMapBase();
    this.createOrbitalRing();
    this.setupLighting();
    this.buildFromState();
    
    // Events
    this.setupEventListeners();
    this.subscribeToEngine();
    
    // Start loop
    this.animate();
  }

  // ==========================================================================
  // COORDINATE CONVERSION
  // ==========================================================================

  /** Convert lat/lon to flat map X/Y */
  private latLonToXY(lat: number, lon: number): { x: number; y: number } {
    // Simple equirectangular projection
    const x = (lon / 180) * (MAP_WIDTH / 2);
    const y = (lat / 90) * (MAP_HEIGHT / 2);
    return { x, y };
  }

  /** Get Z position for a node based on layer */
  private getNodeZ(node: GameNode): number {
    return node.layer === 'ORBITAL' ? Z_NODES_ORBITAL : Z_NODES_TERRESTRIAL;
  }

  // ==========================================================================
  // SCENE CONSTRUCTION
  // ==========================================================================

  private createMapBase(): void {
    // Starfield background - surrounding sphere
    this.createStarfield();
    
    // Earth texture map
    const textureLoader = new THREE.TextureLoader();
    const earthTexture = textureLoader.load('/textures/world.jpg', 
      // On load - texture ready
      (texture) => {
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        console.log('Earth texture loaded');
      },
      undefined,
      // On error - fall back to colored plane
      () => {
        console.warn('Earth texture not found, using fallback');
      }
    );
    
    // Main earth plane with texture
    const earthGeo = new THREE.PlaneGeometry(MAP_WIDTH * 1.4, MAP_HEIGHT * 1.4);
    const earthMat = new THREE.MeshBasicMaterial({ 
      map: earthTexture,
      side: THREE.DoubleSide,
      transparent: false
    });
    const earth = new THREE.Mesh(earthGeo, earthMat);
    earth.position.z = Z_OCEAN;
    this.mapGroup.add(earth);
    
    // Dark overlay for better node visibility
    const overlayGeo = new THREE.PlaneGeometry(MAP_WIDTH * 1.4, MAP_HEIGHT * 1.4);
    const overlayMat = new THREE.MeshBasicMaterial({ 
      color: 0x000020,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.4
    });
    const overlay = new THREE.Mesh(overlayGeo, overlayMat);
    overlay.position.z = Z_OCEAN + 0.01;
    this.mapGroup.add(overlay);
    
    // Grid lines
    this.createGrid();
  }

  private createStarfield(): void {
    const starCount = 3000;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);
    
    for (let i = 0; i < starCount; i++) {
      // Spread stars on a large sphere surrounding the scene
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const radius = 80 + Math.random() * 40;
      
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = radius * Math.cos(phi) - 20; // Offset so more visible above
      
      // Color variation (white to blue-white)
      const temp = 0.7 + Math.random() * 0.3;
      colors[i * 3] = temp;
      colors[i * 3 + 1] = temp;
      colors[i * 3 + 2] = 0.85 + Math.random() * 0.15;
    }
    
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    
    const material = new THREE.PointsMaterial({
      size: 0.4,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      sizeAttenuation: true
    });
    
    const stars = new THREE.Points(geometry, material);
    this.scene.add(stars);
  }

  private createGrid(): void {
    const gridMat = new THREE.LineBasicMaterial({ 
      color: COLORS.grid, 
      transparent: true, 
      opacity: 0.3 
    });
    
    // Longitude lines
    for (let lon = -180; lon <= 180; lon += 30) {
      const { x } = this.latLonToXY(0, lon);
      const points = [
        new THREE.Vector3(x, -MAP_HEIGHT / 2, Z_GRID),
        new THREE.Vector3(x, MAP_HEIGHT / 2, Z_GRID)
      ];
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      this.mapGroup.add(new THREE.Line(geo, gridMat));
    }
    
    // Latitude lines
    for (let lat = -60; lat <= 60; lat += 30) {
      const { y } = this.latLonToXY(lat, 0);
      const points = [
        new THREE.Vector3(-MAP_WIDTH / 2, y, Z_GRID),
        new THREE.Vector3(MAP_WIDTH / 2, y, Z_GRID)
      ];
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      this.mapGroup.add(new THREE.Line(geo, gridMat));
    }
  }

  private createLandMasses(): void {
    // Simplified continent shapes as polygons
    const landMat = new THREE.MeshBasicMaterial({ 
      color: COLORS.land,
      side: THREE.DoubleSide
    });
    
    // North America
    this.createLandShape([
      [-125, 50], [-65, 50], [-75, 25], [-120, 35]
    ], landMat);
    
    // South America  
    this.createLandShape([
      [-80, 10], [-35, -5], [-55, -55], [-75, -20]
    ], landMat);
    
    // Europe
    this.createLandShape([
      [-10, 60], [40, 55], [30, 35], [-10, 35]
    ], landMat);
    
    // Africa
    this.createLandShape([
      [-15, 35], [50, 30], [50, -35], [15, -35], [-5, 5]
    ], landMat);
    
    // Asia
    this.createLandShape([
      [40, 55], [140, 60], [145, 35], [100, 10], [60, 25]
    ], landMat);
    
    // Australia
    this.createLandShape([
      [115, -15], [150, -15], [150, -40], [115, -35]
    ], landMat);
  }

  private createLandShape(coords: [number, number][], material: THREE.Material): void {
    const shape = new THREE.Shape();
    
    coords.forEach((coord, i) => {
      const { x, y } = this.latLonToXY(coord[1], coord[0]);
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
    shape.closePath();
    
    const geo = new THREE.ShapeGeometry(shape);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.z = Z_LAND;
    this.mapGroup.add(mesh);
  }

  private createOrbitalRing(): void {
    // Visual indicator for orbital layer - a subtle ring/plane
    const ringGeo = new THREE.RingGeometry(
      Math.min(MAP_WIDTH, MAP_HEIGHT) * 0.35,
      Math.min(MAP_WIDTH, MAP_HEIGHT) * 0.45,
      64
    );
    const ringMat = new THREE.MeshBasicMaterial({
      color: COLORS.orbitalRing,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.z = Z_ORBITAL_RING;
    this.mapGroup.add(ring);
    
    // Dashed circle outline
    const outlinePoints: THREE.Vector3[] = [];
    const radius = Math.min(MAP_WIDTH, MAP_HEIGHT) * 0.4;
    for (let i = 0; i <= 128; i++) {
      const theta = (i / 128) * Math.PI * 2;
      outlinePoints.push(new THREE.Vector3(
        Math.cos(theta) * radius,
        Math.sin(theta) * radius,
        Z_ORBITAL_RING
      ));
    }
    const outlineGeo = new THREE.BufferGeometry().setFromPoints(outlinePoints);
    const outlineMat = new THREE.LineDashedMaterial({
      color: 0x4466aa,
      dashSize: 0.5,
      gapSize: 0.3,
      transparent: true,
      opacity: 0.5
    });
    const outline = new THREE.Line(outlineGeo, outlineMat);
    outline.computeLineDistances();
    this.mapGroup.add(outline);
  }

  private setupLighting(): void {
    // Ambient for base visibility
    const ambient = new THREE.AmbientLight(0x404060, 0.6);
    this.scene.add(ambient);
    
    // Top-down directional
    const topLight = new THREE.DirectionalLight(0xffffff, 0.8);
    topLight.position.set(0, 0, 50);
    this.scene.add(topLight);
    
    // Slight side fill
    const fillLight = new THREE.DirectionalLight(0x4488ff, 0.3);
    fillLight.position.set(20, 10, 20);
    this.scene.add(fillLight);
  }

  // ==========================================================================
  // GRAPH BUILDING FROM STATE
  // ==========================================================================

  private buildFromState(): void {
    const state = this.engine.getState();
    
    // Clear existing
    this.nodeObjects.clear();
    this.edgeObjects.clear();
    this.unitObjects.clear();
    
    // Build edges first (below nodes)
    for (const edge of state.edges.values()) {
      this.createEdgeObject(edge, state);
    }
    
    // Build nodes
    for (const node of state.nodes.values()) {
      this.createNodeObject(node);
    }
    
    // Build units
    for (const unit of state.units.values()) {
      this.createUnitObject(unit, state);
    }
  }

  private createNodeObject(node: GameNode): void {
    const group = new THREE.Group();
    group.userData = { type: 'node', id: node.id };
    
    const { x, y } = this.latLonToXY(node.position.lat, node.position.lon);
    const z = this.getNodeZ(node);
    group.position.set(x, y, z);
    
    // Node shape based on type
    let geometry: THREE.BufferGeometry;
    let size = NODE_SIZE;
    
    switch (node.type) {
      case 'DC':
        geometry = new THREE.BoxGeometry(size, size, size * 0.6);
        break;
      case 'HUB':
        geometry = new THREE.CylinderGeometry(size * 0.4, size * 0.5, size * 0.5, 6);
        break;
      case 'SAT':
        geometry = new THREE.OctahedronGeometry(size * 0.5);
        break;
      default:
        geometry = new THREE.SphereGeometry(size * 0.4, 16, 16);
    }
    
    const color = node.owner ? FACTIONS[node.owner].color : 0x666666;
    const material = new THREE.MeshPhongMaterial({
      color,
      emissive: new THREE.Color(color).multiplyScalar(0.2),
      shininess: 30,
      flatShading: true
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData = { type: 'node', id: node.id };
    
    // Rotate cylinder to stand upright in our Z-up view
    if (node.type === 'HUB') {
      mesh.rotation.x = Math.PI / 2;
    }
    
    group.add(mesh);
    
    // Outline ring
    const ringGeo = new THREE.RingGeometry(size * 0.7, size * 0.8, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: COLORS.nodeOutline,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.z = -0.1;
    group.add(ring);
    
    // Status indicators
    if (node.isZombie) {
      const zombieRing = new THREE.Mesh(
        new THREE.RingGeometry(size * 0.9, size, 32),
        new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.6 })
      );
      zombieRing.position.z = -0.05;
      group.add(zombieRing);
    }
    
    if (node.isCultNode) {
      const cultRing = new THREE.Mesh(
        new THREE.RingGeometry(size * 0.9, size, 32),
        new THREE.MeshBasicMaterial({ color: 0xff00ff, transparent: true, opacity: 0.6 })
      );
      cultRing.position.z = -0.05;
      group.add(cultRing);
    }
    
    this.nodeGroup.add(group);
    this.nodeObjects.set(node.id, group);
  }

  private createEdgeObject(edge: GameEdge, state: GameState): void {
    const fromNode = state.nodes.get(edge.from);
    const toNode = state.nodes.get(edge.to);
    if (!fromNode || !toNode) return;
    
    const fromXY = this.latLonToXY(fromNode.position.lat, fromNode.position.lon);
    const toXY = this.latLonToXY(toNode.position.lat, toNode.position.lon);
    
    const fromZ = this.getNodeZ(fromNode);
    const toZ = this.getNodeZ(toNode);
    
    // Determine edge Z and style
    const isLaser = edge.type === 'LASER';
    const baseZ = isLaser ? Z_LASERS : Z_CABLES;
    
    // Create curved path for cables, angled for lasers
    let points: THREE.Vector3[];
    
    if (isLaser) {
      // Straight line angling up to orbital
      points = [
        new THREE.Vector3(fromXY.x, fromXY.y, fromZ),
        new THREE.Vector3(toXY.x, toXY.y, toZ)
      ];
    } else {
      // Slight curve for cables
      const midX = (fromXY.x + toXY.x) / 2;
      const midY = (fromXY.y + toXY.y) / 2;
      const dist = Math.sqrt(
        Math.pow(toXY.x - fromXY.x, 2) + Math.pow(toXY.y - fromXY.y, 2)
      );
      const bulge = dist * 0.1; // Slight curve
      
      points = [];
      const segments = 20;
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const x = fromXY.x + (toXY.x - fromXY.x) * t;
        const y = fromXY.y + (toXY.y - fromXY.y) * t;
        const z = baseZ + Math.sin(t * Math.PI) * bulge * 0.1;
        points.push(new THREE.Vector3(x, y, z));
      }
    }
    
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    
    // Color based on state
    let color: number;
    let opacity = 0.8;
    
    if (edge.isSevered) {
      color = isLaser ? COLORS.laserSevered : COLORS.cableSevered;
      opacity = 0.3;
    } else if (edge.filteredBy) {
      color = isLaser ? COLORS.laserFiltered : COLORS.cableFiltered;
    } else {
      color = isLaser ? COLORS.laser : COLORS.cable;
    }
    
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      linewidth: 2
    });
    
    const line = new THREE.Line(geometry, material);
    line.userData = { type: 'edge', id: edge.id };
    
    this.edgeGroup.add(line);
    this.edgeObjects.set(edge.id, line);
  }

  private createUnitObject(unit: Unit, state: GameState): void {
    const node = state.nodes.get(unit.location);
    if (!node) return;
    
    const group = new THREE.Group();
    group.userData = { type: 'unit', id: unit.id, unit };
    
    // Geometry per unit type
    let geometry: THREE.BufferGeometry;
    
    switch (unit.type) {
      case 'DRONE':
        geometry = new THREE.ConeGeometry(UNIT_SIZE * 0.4, UNIT_SIZE, 4);
        break;
      case 'SWARM':
        geometry = new THREE.IcosahedronGeometry(UNIT_SIZE * 0.35);
        break;
      case 'CULT':
        geometry = new THREE.TorusGeometry(UNIT_SIZE * 0.3, UNIT_SIZE * 0.1, 8, 16);
        break;
      case 'AUDITOR':
        geometry = new THREE.BoxGeometry(UNIT_SIZE * 0.5, UNIT_SIZE * 0.5, UNIT_SIZE * 0.7);
        break;
      case 'SAT_SWARM':
        geometry = new THREE.OctahedronGeometry(UNIT_SIZE * 0.4);
        break;
      default:
        geometry = new THREE.SphereGeometry(UNIT_SIZE * 0.3);
    }
    
    const factionColor = FACTIONS[unit.owner].color;
    const material = new THREE.MeshPhongMaterial({
      color: factionColor,
      emissive: new THREE.Color(factionColor).multiplyScalar(0.4),
      shininess: 50
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData = { type: 'unit', id: unit.id };
    group.add(mesh);
    
    // Stealth indicator (faint if stealthed)
    if (unit.stealthLevel > 0 && !unit.isRevealed) {
      material.transparent = true;
      material.opacity = 0.6;
    }
    
    // Position at node with offset for multiple units
    this.positionUnitAtNode(group, unit, node, state);
    
    this.unitGroup.add(group);
    this.unitObjects.set(unit.id, group);
  }

  private positionUnitAtNode(group: THREE.Group, unit: Unit, node: GameNode, state: GameState): void {
    const unitsAtNode = Array.from(state.units.values()).filter(u => u.location === node.id);
    const index = unitsAtNode.findIndex(u => u.id === unit.id);
    const count = unitsAtNode.length;
    
    const { x, y } = this.latLonToXY(node.position.lat, node.position.lon);
    const z = this.getNodeZ(node) + Z_UNITS_OFFSET;
    
    // Spread units around node center
    if (count > 1) {
      const angle = (index / count) * Math.PI * 2;
      const radius = NODE_SIZE * 0.8;
      group.position.set(
        x + Math.cos(angle) * radius,
        y + Math.sin(angle) * radius,
        z
      );
    } else {
      group.position.set(x, y, z);
    }
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
        this.removeUnit(event.payload.unitId as string);
        break;
        
      case 'NODE_CAPTURED':
      case 'NODE_CONVERTED':
        this.refreshNode(event.payload.nodeId as string, state);
        break;
        
      case 'EDGE_FILTERED':
      case 'EDGE_SEVERED':
        this.refreshEdge(event.payload.edgeId as string, state);
        break;
        
      case 'KESSLER_THRESHOLD':
        if (event.payload.threshold === 'COLLAPSE') {
          this.animateOrbitalCollapse(state);
        }
        break;
    }
  }

  private refreshUnits(state: GameState): void {
    // Remove stale
    for (const [id, group] of this.unitObjects) {
      if (!state.units.has(id)) {
        this.unitGroup.remove(group);
        this.unitObjects.delete(id);
      }
    }
    
    // Add/update
    for (const unit of state.units.values()) {
      const existing = this.unitObjects.get(unit.id);
      if (!existing) {
        this.createUnitObject(unit, state);
      } else {
        const node = state.nodes.get(unit.location);
        if (node) {
          this.positionUnitAtNode(existing, unit, node, state);
        }
      }
    }
  }

  private removeUnit(unitId: string): void {
    const group = this.unitObjects.get(unitId);
    if (group) {
      // Quick fade-out effect
      this.unitGroup.remove(group);
      this.unitObjects.delete(unitId);
    }
  }

  private refreshNode(nodeId: string, state: GameState): void {
    const node = state.nodes.get(nodeId);
    const group = this.nodeObjects.get(nodeId);
    if (!node || !group) return;
    
    const color = node.owner ? FACTIONS[node.owner].color : 0x666666;
    
    group.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshPhongMaterial) {
        child.material.color.setHex(color);
        child.material.emissive.setHex(color).multiplyScalar(0.2);
      }
    });
  }

  private refreshEdge(edgeId: string, state: GameState): void {
    const edge = state.edges.get(edgeId);
    const line = this.edgeObjects.get(edgeId);
    if (!edge || !line) return;
    
    const isLaser = edge.type === 'LASER';
    let color: number;
    let opacity = 0.8;
    
    if (edge.isSevered) {
      color = isLaser ? COLORS.laserSevered : COLORS.cableSevered;
      opacity = 0.3;
    } else if (edge.filteredBy) {
      color = isLaser ? COLORS.laserFiltered : COLORS.cableFiltered;
    } else {
      color = isLaser ? COLORS.laser : COLORS.cable;
    }
    
    const mat = line.material as THREE.LineBasicMaterial;
    mat.color.setHex(color);
    mat.opacity = opacity;
  }

  private animateOrbitalCollapse(state: GameState): void {
    // Flash all laser edges red then fade
    for (const [id, line] of this.edgeObjects) {
      const edge = state.edges.get(id);
      if (edge?.type === 'LASER') {
        const mat = line.material as THREE.LineBasicMaterial;
        mat.color.setHex(0xff0000);
        
        // Animate fade
        const startOpacity = mat.opacity;
        const startTime = this.clock.getElapsedTime();
        const duration = 1.0;
        
        const fadeOut = () => {
          const elapsed = this.clock.getElapsedTime() - startTime;
          const t = Math.min(1, elapsed / duration);
          mat.opacity = startOpacity * (1 - t);
          if (t < 1) requestAnimationFrame(fadeOut);
        };
        fadeOut();
      }
    }
    
    // Spawn Kessler debris particles
    this.spawnKesslerDebris();
  }

  private kesslerDebris: THREE.Points | null = null;
  private kesslerVelocities: Float32Array | null = null;

  private spawnKesslerDebris(): void {
    const debrisCount = 500;
    const positions = new Float32Array(debrisCount * 3);
    const colors = new Float32Array(debrisCount * 3);
    this.kesslerVelocities = new Float32Array(debrisCount * 3);
    
    // Spawn debris around orbital ring
    const radius = Math.min(MAP_WIDTH, MAP_HEIGHT) * 0.4;
    
    for (let i = 0; i < debrisCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = radius * (0.8 + Math.random() * 0.4);
      
      positions[i * 3] = Math.cos(angle) * r;
      positions[i * 3 + 1] = Math.sin(angle) * r;
      positions[i * 3 + 2] = Z_KESSLER_DEBRIS + (Math.random() - 0.5) * 2;
      
      // Orange/red debris
      colors[i * 3] = 1.0;
      colors[i * 3 + 1] = 0.3 + Math.random() * 0.4;
      colors[i * 3 + 2] = 0.1;
      
      // Random velocities - expanding outward
      const speed = 0.02 + Math.random() * 0.05;
      this.kesslerVelocities[i * 3] = Math.cos(angle) * speed + (Math.random() - 0.5) * 0.02;
      this.kesslerVelocities[i * 3 + 1] = Math.sin(angle) * speed + (Math.random() - 0.5) * 0.02;
      this.kesslerVelocities[i * 3 + 2] = (Math.random() - 0.5) * 0.01;
    }
    
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    
    const material = new THREE.PointsMaterial({
      size: 0.15,
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
      sizeAttenuation: true
    });
    
    this.kesslerDebris = new THREE.Points(geometry, material);
    this.effectGroup.add(this.kesslerDebris);
  }

  private updateKesslerDebris(): void {
    if (!this.kesslerDebris || !this.kesslerVelocities) return;
    
    const positions = this.kesslerDebris.geometry.attributes.position.array as Float32Array;
    const material = this.kesslerDebris.material as THREE.PointsMaterial;
    
    // Update positions
    for (let i = 0; i < positions.length / 3; i++) {
      positions[i * 3] += this.kesslerVelocities[i * 3];
      positions[i * 3 + 1] += this.kesslerVelocities[i * 3 + 1];
      positions[i * 3 + 2] += this.kesslerVelocities[i * 3 + 2];
      
      // Slow down over time
      this.kesslerVelocities[i * 3] *= 0.995;
      this.kesslerVelocities[i * 3 + 1] *= 0.995;
      this.kesslerVelocities[i * 3 + 2] *= 0.995;
    }
    
    this.kesslerDebris.geometry.attributes.position.needsUpdate = true;
    
    // Fade out
    material.opacity *= 0.998;
    
    // Remove when faded
    if (material.opacity < 0.01) {
      this.effectGroup.remove(this.kesslerDebris);
      this.kesslerDebris = null;
      this.kesslerVelocities = null;
    }
  }

  // ==========================================================================
  // CAMERA CONTROL
  // ==========================================================================

  private updateCameraPosition(): void {
    const x = this.cameraTarget.x + this.cameraDistance * Math.sin(this.cameraAngle.phi) * Math.sin(this.cameraAngle.theta);
    const y = this.cameraTarget.y + this.cameraDistance * Math.sin(this.cameraAngle.phi) * Math.cos(this.cameraAngle.theta);
    const z = this.cameraTarget.z + this.cameraDistance * Math.cos(this.cameraAngle.phi);
    
    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.cameraTarget);
    this.camera.up.set(0, 0, 1); // Z is up
  }

  public focusOn(position: THREE.Vector3, distance?: number): void {
    this.cameraTargetDesired.copy(position);
    if (distance !== undefined) this.cameraDistanceDesired = distance;
  }

  public focusOnNode(nodeId: string, distance = 20): void {
    const group = this.nodeObjects.get(nodeId);
    if (group) {
      this.focusOn(group.position, distance);
    }
  }

  public focusOnUnit(unitId: string, distance = 15): void {
    const group = this.unitObjects.get(unitId);
    if (group) {
      this.focusOn(group.position, distance);
    }
  }

  public reset(): void {
    this.cameraTargetDesired.set(0, 0, 0);
    this.cameraDistanceDesired = 35;
    this.cameraAngle = { theta: 0, phi: Math.PI * 0.35 };
  }

  public isCameraSettled(): boolean {
    return this.cameraTarget.distanceTo(this.cameraTargetDesired) < 0.05 &&
      Math.abs(this.cameraDistance - this.cameraDistanceDesired) < 0.05;
  }

  // ==========================================================================
  // INTERACTION
  // ==========================================================================

  private setupEventListeners(): void {
    const canvas = this.renderer.domElement;
    
    canvas.addEventListener('pointermove', this.onPointerMove.bind(this));
    canvas.addEventListener('pointerdown', this.onPointerDown.bind(this));
    canvas.addEventListener('pointerup', this.onPointerUp.bind(this));
    canvas.addEventListener('wheel', this.onWheel.bind(this));
    window.addEventListener('resize', this.onResize.bind(this));
  }

  private onPointerMove(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    // Dragging - pan/orbit
    if (this.isDragging) {
      const dx = event.clientX - this.lastMouse.x;
      const dy = event.clientY - this.lastMouse.y;
      
      if (event.shiftKey) {
        // Pan
        const panSpeed = this.cameraDistance * 0.002;
        this.cameraTarget.x -= dx * panSpeed;
        this.cameraTarget.y += dy * panSpeed;
      } else {
        // Orbit
        this.cameraAngle.theta += dx * 0.005;
        this.cameraAngle.phi = Math.max(0.2, Math.min(Math.PI * 0.45, this.cameraAngle.phi + dy * 0.005));
      }
      
      this.updateCameraPosition();
      this.lastMouse = { x: event.clientX, y: event.clientY };
      return;
    }
    
    // Hover detection
    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    const interactables = [
      ...Array.from(this.unitObjects.values()),
      ...Array.from(this.nodeObjects.values())
    ];
    
    const intersects = this.raycaster.intersectObjects(interactables, true);
    
    if (intersects.length > 0) {
      let obj: THREE.Object3D | null = intersects[0].object;
      while (obj && !obj.userData.id) obj = obj.parent;
      
      if (obj && obj !== this.hoveredObject) {
        this.clearHover();
        this.hoveredObject = obj;
        this.setHover(obj);
      }
    } else {
      this.clearHover();
    }
  }

  private onPointerDown(event: PointerEvent): void {
    if (event.button === 0) {
      this.isDragging = true;
      this.lastMouse = { x: event.clientX, y: event.clientY };
      
      // Check for click on object
      this.raycaster.setFromCamera(this.mouse, this.camera);
      
      const unitMeshes = Array.from(this.unitObjects.values());
      const unitHits = this.raycaster.intersectObjects(unitMeshes, true);
      
      if (unitHits.length > 0) {
        let obj: THREE.Object3D | null = unitHits[0].object;
        while (obj && !obj.userData.id) obj = obj.parent;
        if (obj?.userData.id) {
          this.selectUnit(obj.userData.id);
          this.onUnitClick?.(obj.userData.id);
          return;
        }
      }
      
      const nodeMeshes = Array.from(this.nodeObjects.values());
      const nodeHits = this.raycaster.intersectObjects(nodeMeshes, true);
      
      if (nodeHits.length > 0) {
        let obj: THREE.Object3D | null = nodeHits[0].object;
        while (obj && !obj.userData.id) obj = obj.parent;
        if (obj?.userData.id) {
          this.selectNode(obj.userData.id);
          this.onNodeClick?.(obj.userData.id);
        }
      }
    }
  }

  private onPointerUp(_event: PointerEvent): void {
    this.isDragging = false;
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    this.cameraDistance *= event.deltaY > 0 ? 1.1 : 0.9;
    this.cameraDistance = Math.max(10, Math.min(80, this.cameraDistance));
    this.updateCameraPosition();
  }

  private onResize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private setHover(obj: THREE.Object3D): void {
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshPhongMaterial) {
        child.material.emissive.multiplyScalar(2);
      }
    });
    this.renderer.domElement.style.cursor = 'pointer';
  }

  private clearHover(): void {
    if (this.hoveredObject) {
      const id = this.hoveredObject.userData.id;
      const state = this.engine.getState();
      
      // Restore original emissive
      if (this.hoveredObject.userData.type === 'unit') {
        const unit = state.units.get(id);
        if (unit) {
          const color = FACTIONS[unit.owner].color;
          this.hoveredObject.traverse((child) => {
            if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshPhongMaterial) {
              child.material.emissive.setHex(color).multiplyScalar(0.4);
            }
          });
        }
      } else if (this.hoveredObject.userData.type === 'node') {
        const node = state.nodes.get(id);
        if (node) {
          const color = node.owner ? FACTIONS[node.owner].color : 0x666666;
          this.hoveredObject.traverse((child) => {
            if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshPhongMaterial) {
              child.material.emissive.setHex(color).multiplyScalar(0.2);
            }
          });
        }
      }
    }
    this.hoveredObject = null;
    this.renderer.domElement.style.cursor = 'default';
  }

  // ==========================================================================
  // SELECTION
  // ==========================================================================

  public selectUnit(unitId: string): void {
    this.clearSelection();
    this.selectedUnit = unitId;
    
    const group = this.unitObjects.get(unitId);
    if (group) {
      group.scale.setScalar(1.4);
      this.focusOn(group.position, 18);
    }
  }

  public selectNode(nodeId: string): void {
    this.clearSelection();
    this.selectedNode = nodeId;
    
    const group = this.nodeObjects.get(nodeId);
    if (group) {
      group.scale.setScalar(1.3);
      this.focusOn(group.position, 20);
    }
  }

  public clearSelection(): void {
    if (this.selectedUnit) {
      const group = this.unitObjects.get(this.selectedUnit);
      if (group) group.scale.setScalar(1);
    }
    if (this.selectedNode) {
      const group = this.nodeObjects.get(this.selectedNode);
      if (group) group.scale.setScalar(1);
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

  // Alias for compatibility
  public resetCamera(): void {
    this.reset();
  }

  // ==========================================================================
  // ANIMATION LOOP
  // ==========================================================================

  private animate(): void {
    requestAnimationFrame(this.animate.bind(this));
    
    const delta = this.clock.getDelta();
    this.pulsePhase += delta * 2;

    this.cameraTarget.lerp(this.cameraTargetDesired, Math.min(1, delta * 5));
    this.cameraDistance += (this.cameraDistanceDesired - this.cameraDistance) * Math.min(1, delta * 5);
    this.updateCameraPosition();
    
    // Pulse units slightly
    for (const [id, group] of this.unitObjects) {
      if (id !== this.selectedUnit) {
        const scale = 1 + Math.sin(this.pulsePhase) * 0.05;
        group.scale.setScalar(scale);
      }
    }
    
    // Rotate orbital satellites slowly
    for (const [id, group] of this.nodeObjects) {
      const node = this.engine.getNode(id);
      if (node?.layer === 'ORBITAL') {
        group.rotation.z += delta * 0.5;
      }
    }
    
    // Update Kessler debris if active
    this.updateKesslerDebris();
    
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
