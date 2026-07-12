// ============================================================================
// ASI CARTEL - Three.js Globe Scene Manager
// Handles 3D rendering, camera, raycasting, and unit visualization
// With smooth pan/zoom, hover highlights, and victory animations
// ============================================================================

import * as THREE from 'three';
import { gameEngine } from '../engine/GameEngine';
import { Unit, Territory, GameState } from '../data/types';
import { FACTIONS, UNIT_STATS } from '../data/gameData';
import { CameraController } from './CameraController';
import { AnimationSystem } from './AnimationSystem';

// --- Constants ---
const GLOBE_RADIUS = 10;
const CAMERA_MIN_DIST = 12;
const CAMERA_MAX_DIST = 40;
const CAMERA_LERP_SPEED = 0.08;
const GLOBE_ROTATION_SPEED = 0.0003;

interface UnitMesh {
  mesh: THREE.Mesh;
  glow: THREE.Mesh;
  ring: THREE.Mesh;
  unitId: string;
}

interface TerritoryMesh {
  mesh: THREE.Mesh;
  territoryId: string;
}

export class GlobeScene {
  // Three.js core
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  
  // Globe
  private globe!: THREE.Mesh;
  private atmosphere!: THREE.Mesh;
  private starfield!: THREE.Points;
  
  // Game objects
  private unitMeshes: Map<string, UnitMesh> = new Map();
  private territoryMeshes: Map<string, TerritoryMesh> = new Map();
  private connectionLines: THREE.Line[] = [];
  
  // Kessler debris
  private kesslerDebris?: {
    points: THREE.Points;
    velocities: Float32Array;
  };
  
  // Interaction
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;
  private frustum: THREE.Frustum;
  private frustumMatrix: THREE.Matrix4;
  
  // Camera control
  private cameraController!: CameraController;
  private isDragging: boolean = false;
  private previousMousePos: { x: number; y: number } = { x: 0, y: 0 };
  private autoRotate: boolean = true;
  
  // Animation
  private clock: THREE.Clock;
  private animationId: number = 0;
  private animationSystem!: AnimationSystem;
  
  // Hover state
  private hoveredUnitId: string | null = null;

  constructor(container: HTMLElement) {
    // Scene setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020308);
    
    // Camera
    this.camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 5, GLOBE_RADIUS * 2.5);
    
    // Renderer
    this.renderer = new THREE.WebGLRenderer({ 
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    container.appendChild(this.renderer.domElement);
    
    // Interaction utilities
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.frustum = new THREE.Frustum();
    this.frustumMatrix = new THREE.Matrix4();
    
    // Camera controller with smooth damping
    this.cameraController = new CameraController(this.camera);
    this.cameraController.setSmoothTime(0.25);
    this.cameraController.setDistanceLimits(CAMERA_MIN_DIST, CAMERA_MAX_DIST);
    
    // Clock for animations
    this.clock = new THREE.Clock();
    
    // Build scene
    this.createLighting();
    this.createStarfield();
    this.createGlobe();
    this.createAtmosphere();
    this.createKesslerDebris();
    
    // Event listeners
    this.setupEventListeners();
    
    // Initialize game objects
    this.syncWithGameState(gameEngine.getState());
    
    // Subscribe to game events
    this.subscribeToGameEvents();
    
    // Initialize animation system
    this.animationSystem = new AnimationSystem(this.scene);
    
    // Start render loop
    this.animate();
  }

  // ===========================================================================
  // SCENE CREATION
  // ===========================================================================

  private createLighting(): void {
    // Ambient for base visibility
    const ambient = new THREE.AmbientLight(0x334455, 0.4);
    this.scene.add(ambient);
    
    // Main directional (sun)
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(50, 30, 50);
    this.scene.add(sun);
    
    // Rim light for atmosphere effect
    const rim = new THREE.DirectionalLight(0x4488ff, 0.3);
    rim.position.set(-30, -10, -30);
    this.scene.add(rim);
    
    // Point light at center for inner glow
    const core = new THREE.PointLight(0x223344, 0.5, 50);
    core.position.set(0, 0, 0);
    this.scene.add(core);
  }

  private createStarfield(): void {
    const starCount = 3000;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);
    const sizes = new Float32Array(starCount);
    
    for (let i = 0; i < starCount; i++) {
      // Random position on sphere
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const radius = 150 + Math.random() * 100;
      
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = radius * Math.cos(phi);
      
      // Slight color variation (blue-white)
      const brightness = 0.5 + Math.random() * 0.5;
      colors[i * 3] = brightness;
      colors[i * 3 + 1] = brightness;
      colors[i * 3 + 2] = brightness + Math.random() * 0.2;
      
      sizes[i] = Math.random() * 2 + 0.5;
    }
    
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    
    const material = new THREE.PointsMaterial({
      size: 0.5,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      sizeAttenuation: true
    });
    
    this.starfield = new THREE.Points(geometry, material);
    this.scene.add(this.starfield);
  }

  private createGlobe(): void {
    const geometry = new THREE.SphereGeometry(GLOBE_RADIUS, 64, 64);
    
    // Night globe base
    const material = new THREE.MeshStandardMaterial({
      color: 0x111820,
      metalness: 0.1,
      roughness: 0.9,
      transparent: true,
      opacity: 0.98,
      emissive: new THREE.Color(0x224466),
      emissiveIntensity: 0.25
    });
    
    this.globe = new THREE.Mesh(geometry, material);
    this.scene.add(this.globe);
    
    // Load texture + city glow overlay
    const loader = new THREE.TextureLoader();
    loader.load('/textures/world.jpg', (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      
      material.map = texture;
      material.emissiveMap = texture;
      material.emissiveIntensity = 0.65;
      material.needsUpdate = true;

      // City lights glow shell
      const glowMaterial = new THREE.MeshBasicMaterial({
        map: texture,
        color: 0x66aaff,
        transparent: true,
        opacity: 0.25,
        blending: THREE.AdditiveBlending
      });

      const glowMesh = new THREE.Mesh(geometry, glowMaterial);
      glowMesh.scale.setScalar(1.001);
      this.scene.add(glowMesh);
    });
  }

  private createAtmosphere(): void {
    const geometry = new THREE.SphereGeometry(GLOBE_RADIUS * 1.02, 64, 64);
    
    // Custom shader for atmospheric glow
    const material = new THREE.ShaderMaterial({
      uniforms: {
        glowColor: { value: new THREE.Color(0x4488ff) },
        viewVector: { value: this.camera.position }
      },
      vertexShader: `
        uniform vec3 viewVector;
        varying float intensity;
        void main() {
          vec3 vNormal = normalize(normalMatrix * normal);
          vec3 vNormel = normalize(normalMatrix * viewVector);
          intensity = pow(0.7 - dot(vNormal, vNormel), 2.0);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 glowColor;
        varying float intensity;
        void main() {
          vec3 glow = glowColor * intensity;
          gl_FragColor = vec4(glow, intensity * 0.4);
        }
      `,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true
    });
    
    this.atmosphere = new THREE.Mesh(geometry, material);
    this.scene.add(this.atmosphere);
  }

  // ===========================================================================
  // KESSLER DEBRIS
  // ===========================================================================

  private createKesslerDebris(): void {
    const count = 1200;
    const inner = GLOBE_RADIUS + 1.2;
    const outer = GLOBE_RADIUS + 2.8;

    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const r = inner + Math.random() * (outer - inner);
      const t = Math.random() * Math.PI * 2;
      const p = Math.acos(2 * Math.random() - 1);

      positions[i3]     = r * Math.sin(p) * Math.cos(t);
      positions[i3 + 1] = r * Math.cos(p);
      positions[i3 + 2] = r * Math.sin(p) * Math.sin(t);

      velocities[i3]     = -Math.sin(t) * 0.002;
      velocities[i3 + 1] = (Math.random() - 0.5) * 0.0004;
      velocities[i3 + 2] =  Math.cos(t) * 0.002;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.04,
      color: 0xffaa66,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    const points = new THREE.Points(geo, mat);
    this.scene.add(points);

    this.kesslerDebris = { points, velocities };
  }

  // ===========================================================================
  // GAME OBJECT MANAGEMENT
  // ===========================================================================

  private syncWithGameState(state: GameState): void {
    // Sync units
    const currentUnitIds = new Set(state.units.map(u => u.id));
    
    // Remove deleted units
    for (const [id, unitMesh] of this.unitMeshes) {
      if (!currentUnitIds.has(id)) {
        this.scene.remove(unitMesh.mesh);
        this.scene.remove(unitMesh.glow);
        this.scene.remove(unitMesh.ring);
        this.unitMeshes.delete(id);
      }
    }
    
    // Add/update units
    for (const unit of state.units) {
      if (!this.unitMeshes.has(unit.id)) {
        this.createUnitMesh(unit);
      } else {
        this.updateUnitMesh(unit);
      }
    }
    
    // Sync territories
    for (const territory of state.territories) {
      if (!this.territoryMeshes.has(territory.id)) {
        this.createTerritoryMesh(territory);
      } else {
        this.updateTerritoryMesh(territory);
      }
    }
  }

  private createUnitMesh(unit: Unit): void {
    const pos = this.latLonToVector3(unit.lat, unit.lon, GLOBE_RADIUS + 0.15);
    const faction = FACTIONS[unit.faction];
    const stats = UNIT_STATS[unit.type];
    
    // Main mesh - size based on level
    const size = 0.12 + unit.level * 0.04;
    const geometry = this.getUnitGeometry(unit.type, size);
    
    const material = new THREE.MeshStandardMaterial({
      color: 0x2b2f3a,
      metalness: 0.6,
      roughness: 0.35,
      emissive: new THREE.Color(faction.color),
      emissiveIntensity: 0.15
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(pos);
    mesh.lookAt(0, 0, 0);
    mesh.rotateX(Math.PI / 2);
    mesh.userData = { unitId: unit.id, type: 'unit' };
    this.scene.add(mesh);

    // StarCraft-style faction trim plate
    const trimMat = new THREE.MeshStandardMaterial({
      color: faction.color,
      emissive: faction.color,
      emissiveIntensity: 0.8,
      metalness: 0.2,
      roughness: 0.25
    });

    const trim = new THREE.Mesh(
      new THREE.BoxGeometry(size * 0.25, size * 1.2, size * 0.25),
      trimMat
    );
    trim.position.set(size * 0.6, 0, 0);
    mesh.add(trim);
    
    // Glow effect
    const glowGeometry = new THREE.SphereGeometry(size * 1.5, 16, 16);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: faction.color,
      transparent: true,
      opacity: 0.2,
      side: THREE.BackSide
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    glow.position.copy(pos);
    this.scene.add(glow);
    
    // Selection ring (hidden by default)
    const ringGeometry = new THREE.RingGeometry(size * 1.8, size * 2.2, 32);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.position.copy(pos);
    ring.lookAt(0, 0, 0);
    this.scene.add(ring);
    
    this.unitMeshes.set(unit.id, { mesh, glow, ring, unitId: unit.id });
  }

  private getUnitGeometry(type: string, size: number): THREE.BufferGeometry {
    switch (type) {
      case 'DRONE':
        return new THREE.OctahedronGeometry(size, 0);
      case 'SINF':
        return new THREE.TorusGeometry(size * 0.8, size * 0.3, 8, 16);
      case 'VIRUS':
        return new THREE.IcosahedronGeometry(size, 0);
      case 'NUKE':
        return new THREE.ConeGeometry(size, size * 2, 8);
      case 'BOTNET':
        return new THREE.BoxGeometry(size, size, size);
      case 'ORACLE':
        return new THREE.TetrahedronGeometry(size, 0);
      default:
        return new THREE.SphereGeometry(size, 16, 16);
    }
  }

  private updateUnitMesh(unit: Unit): void {
    const unitMesh = this.unitMeshes.get(unit.id);
    if (!unitMesh) return;
    
    const pos = this.latLonToVector3(unit.lat, unit.lon, GLOBE_RADIUS + 0.15);
    
    // Smooth position lerp
    unitMesh.mesh.position.lerp(pos, 0.1);
    unitMesh.glow.position.lerp(pos, 0.1);
    unitMesh.ring.position.lerp(pos, 0.1);
    
    // Selection state
    const ringMat = unitMesh.ring.material as THREE.MeshBasicMaterial;
    ringMat.opacity = unit.isSelected ? 0.8 : 0;
    
    // Health-based glow intensity
    const glowMat = unitMesh.glow.material as THREE.MeshBasicMaterial;
    glowMat.opacity = 0.1 + (unit.health / 100) * 0.2;
  }

  private createTerritoryMesh(territory: Territory): void {
    const pos = this.latLonToVector3(territory.lat, territory.lon, GLOBE_RADIUS + 0.02);
    const faction = FACTIONS[territory.controller];
    
    // Territory indicator ring
    const geometry = new THREE.RingGeometry(
      territory.radius * 0.3,
      territory.radius * 0.35,
      32
    );
    
    const material = new THREE.MeshBasicMaterial({
      color: faction.color,
      transparent: true,
      opacity: territory.controller === 'NEUTRAL' ? 0.1 : 0.3,
      side: THREE.DoubleSide
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(pos);
    mesh.lookAt(0, 0, 0);
    mesh.userData = { territoryId: territory.id, type: 'territory' };
    this.scene.add(mesh);
    
    this.territoryMeshes.set(territory.id, { mesh, territoryId: territory.id });
  }

  private updateTerritoryMesh(territory: Territory): void {
    const terMesh = this.territoryMeshes.get(territory.id);
    if (!terMesh) return;
    
    const faction = FACTIONS[territory.controller];
    const mat = terMesh.mesh.material as THREE.MeshBasicMaterial;
    mat.color.setHex(faction.color);
    mat.opacity = territory.controller === 'NEUTRAL' ? 0.1 : 0.3;
    
    // Pulse if contested
    if (territory.contestedBy.length > 0) {
      const pulse = Math.sin(this.clock.getElapsedTime() * 3) * 0.2 + 0.3;
      mat.opacity = pulse;
    }
  }

  // ===========================================================================
  // COORDINATE CONVERSION
  // ===========================================================================

  private latLonToVector3(lat: number, lon: number, radius: number): THREE.Vector3 {
    const phi = THREE.MathUtils.degToRad(90 - lat);
    const theta = THREE.MathUtils.degToRad(lon + 180);
    
    return new THREE.Vector3(
      -radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.sin(theta)
    );
  }

  private vector3ToLatLon(vec: THREE.Vector3): { lat: number; lon: number } {
    const normalized = vec.clone().normalize();
    const lat = 90 - THREE.MathUtils.radToDeg(Math.acos(normalized.y));
    const lon = THREE.MathUtils.radToDeg(Math.atan2(normalized.z, -normalized.x)) - 180;
    return { lat, lon };
  }

  // ===========================================================================
  // CAMERA CONTROL
  // ===========================================================================

  public focusOnUnit(unitId: string): void {
    const unitMesh = this.unitMeshes.get(unitId);
    if (!unitMesh) return;
    
    const pos = unitMesh.mesh.position.clone();
    this.cameraController.focusOn(pos, GLOBE_RADIUS * 2);
    this.autoRotate = false;
  }

  public focusOnLatLon(lat: number, lon: number): void {
    const pos = this.latLonToVector3(lat, lon, GLOBE_RADIUS);
    this.cameraController.focusOn(pos, GLOBE_RADIUS * 2);
    this.autoRotate = false;
  }

  public resetCamera(): void {
    this.cameraController.reset();
    this.autoRotate = true;
  }

  public getCameraController(): CameraController {
    return this.cameraController;
  }

  public getAnimationSystem(): AnimationSystem {
    return this.animationSystem;
  }

  public getHoveredUnitId(): string | null {
    return this.hoveredUnitId;
  }

  // ===========================================================================
  // RAYCASTING & INTERACTION
  // ===========================================================================

  private updateFrustum(): void {
    this.frustumMatrix.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse
    );
    this.frustum.setFromProjectionMatrix(this.frustumMatrix);
  }

  public raycastUnits(screenX: number, screenY: number): string | null {
    this.mouse.x = (screenX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(screenY / window.innerHeight) * 2 + 1;
    
    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    const meshes = Array.from(this.unitMeshes.values()).map(um => um.mesh);
    const intersects = this.raycaster.intersectObjects(meshes, false);
    
    if (intersects.length > 0) {
      return intersects[0].object.userData.unitId as string;
    }
    return null;
  }

  public raycastGlobe(screenX: number, screenY: number): { lat: number; lon: number } | null {
    this.mouse.x = (screenX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(screenY / window.innerHeight) * 2 + 1;
    
    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    const intersects = this.raycaster.intersectObject(this.globe, false);
    
    if (intersects.length > 0) {
      return this.vector3ToLatLon(intersects[0].point);
    }
    return null;
  }

  // ===========================================================================
  // EVENT HANDLING
  // ===========================================================================

  private setupEventListeners(): void {
    const canvas = this.renderer.domElement;
    
    canvas.addEventListener('pointerdown', this.onPointerDown.bind(this));
    canvas.addEventListener('pointermove', this.onPointerMove.bind(this));
    canvas.addEventListener('pointerup', this.onPointerUp.bind(this));
    canvas.addEventListener('wheel', this.onWheel.bind(this));
    
    window.addEventListener('resize', this.onResize.bind(this));
  }

  private onPointerDown(e: PointerEvent): void {
    this.isDragging = true;
    this.previousMousePos = { x: e.clientX, y: e.clientY };
    this.autoRotate = false;
    
    // Check for unit click
    const unitId = this.raycastUnits(e.clientX, e.clientY);
    if (unitId) {
      gameEngine.selectUnit(unitId);
      this.focusOnUnit(unitId);
    }
  }

  private onPointerMove(e: PointerEvent): void {
    // Handle hover detection when not dragging
    if (!this.isDragging) {
      this.handleHover(e.clientX, e.clientY);
      return;
    }
    
    const deltaX = e.clientX - this.previousMousePos.x;
    const deltaY = e.clientY - this.previousMousePos.y;
    
    // Orbit camera around globe using controller
    this.cameraController.orbit(deltaX * 0.005, deltaY * 0.005);
    
    this.previousMousePos = { x: e.clientX, y: e.clientY };
  }

  private handleHover(x: number, y: number): void {
    const unitId = this.raycastUnits(x, y);
    
    // Clear previous hover highlight
    if (this.hoveredUnitId && this.hoveredUnitId !== unitId) {
      const prevMesh = this.unitMeshes.get(this.hoveredUnitId);
      if (prevMesh) {
        const mat = prevMesh.mesh.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 0.15;
      }
      this.hoveredUnitId = null;
    }
    
    // Apply new hover with pulse
    if (unitId && unitId !== this.hoveredUnitId) {
      const unitMesh = this.unitMeshes.get(unitId);
      if (unitMesh) {
        this.animationSystem.pulseGlow(unitMesh.mesh, 0.6, 0.2);
        const mat = unitMesh.mesh.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 0.8;
        this.hoveredUnitId = unitId;
      }
    }
  }

  private onPointerUp(_e: PointerEvent): void {
    this.isDragging = false;
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const zoomFactor = 1 + e.deltaY * 0.001;
    this.cameraController.zoom(zoomFactor);
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ===========================================================================
  // GAME EVENT SUBSCRIPTION
  // ===========================================================================

  private subscribeToGameEvents(): void {
    gameEngine.on('*', (_event, state) => {
      this.syncWithGameState(state);
    });
    
    gameEngine.on('UNIT_SELECTED', (event, _state) => {
      const unitId = event.payload.unitId as string;
      if (unitId) {
        this.focusOnUnit(unitId);
      }
    });
    
    gameEngine.on('TERRITORY_CAPTURED', (event, state) => {
      const territoryId = event.payload.territoryId as string;
      const newController = event.payload.newController as string;
      const territory = state.territories.find(t => t.id === territoryId);
      
      if (territory) {
        const pos = this.latLonToVector3(territory.lat, territory.lon, GLOBE_RADIUS + 0.3);
        const faction = FACTIONS[newController as keyof typeof FACTIONS];
        
        // Victory burst particles
        this.animationSystem.victoryBurst(pos, newController as any);
        
        // Delta marker showing +1 territory
        this.animationSystem.createDeltaMarker(pos, 1, newController as any);
        
        // Highlight ring
        this.animationSystem.createHighlightRing(pos, faction.color, 1.5);
      }
    });
    
    gameEngine.on('COMBAT_END', (event, state) => {
      const winnerId = event.payload.winner as string | null;
      if (winnerId) {
        const winner = state.units.find(u => u.id === winnerId);
        if (winner) {
          const pos = this.latLonToVector3(winner.lat, winner.lon, GLOBE_RADIUS + 0.2);
          this.animationSystem.particleBurst(pos, FACTIONS[winner.faction].color, 15);
        }
      }
    });
  }

  // ===========================================================================
  // ANIMATION LOOP
  // ===========================================================================

  private animate(): void {
    this.animationId = requestAnimationFrame(this.animate.bind(this));
    
    const delta = this.clock.getDelta();
    const elapsed = this.clock.getElapsedTime();
    
    // Auto-rotate globe
    if (this.autoRotate) {
      this.globe.rotation.y += GLOBE_ROTATION_SPEED;
    }
    
    // Update camera with framerate-independent smoothing
    this.cameraController.update(delta);
    
    // Update atmosphere shader
    const atmoMat = this.atmosphere.material as THREE.ShaderMaterial;
    atmoMat.uniforms.viewVector.value.copy(this.camera.position);

    // Update Kessler debris
    if (this.kesslerDebris) {
      const posAttr = this.kesslerDebris.points.geometry
        .attributes.position as THREE.BufferAttribute;
      const vel = this.kesslerDebris.velocities;
      for (let i = 0; i < vel.length; i += 3) {
        posAttr.array[i]     += vel[i];
        posAttr.array[i + 1] += vel[i + 1];
        posAttr.array[i + 2] += vel[i + 2];
      }
      posAttr.needsUpdate = true;
    }
    
    // Animate unit meshes
    for (const [_id, unitMesh] of this.unitMeshes) {
      // Pulse glow
      const scale = 1 + Math.sin(elapsed * 2) * 0.1;
      unitMesh.glow.scale.setScalar(scale);
      
      // Rotate selection ring
      unitMesh.ring.rotation.z += delta * 0.5;
    }
    
    // Update frustum for culling
    this.updateFrustum();
    
    // Cull objects outside frustum
    for (const [_id, unitMesh] of this.unitMeshes) {
      const inFrustum = this.frustum.containsPoint(unitMesh.mesh.position);
      unitMesh.mesh.visible = inFrustum;
      unitMesh.glow.visible = inFrustum;
      unitMesh.ring.visible = inFrustum;
    }
    
    // Starfield subtle rotation
    this.starfield.rotation.y += GLOBE_ROTATION_SPEED * 0.1;
    
    // Update animation system (particles, tweens, delta markers)
    this.animationSystem.update(delta);
    
    this.renderer.render(this.scene, this.camera);
  }

  // ===========================================================================
  // CLEANUP
  // ===========================================================================

  public dispose(): void {
    cancelAnimationFrame(this.animationId);
    
    // Dispose geometries and materials
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        if (Array.isArray(object.material)) {
          object.material.forEach(m => m.dispose());
        } else {
          object.material.dispose();
        }
      }
    });
    
    this.renderer.dispose();
  }
}
