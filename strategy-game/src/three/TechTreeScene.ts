// ============================================================================
// THEY SING - Tech Tree Scene (Research Constellation)
// Noosphere visualization of ASI capability rhizome
// ============================================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ============================================================================
// DOMAIN COLORS & DATA
// ============================================================================

const DOMAIN_COLORS: Record<string, number> = {
  KINETIC: 0xff6666,
  INFO: 0x58c4ff,
  LOGIC: 0xffc658,
  MEMETIC: 0xff66cc,
};

interface TechNode {
  id: string;
  name: string;
  level: number;
  domain: string;
  description: string;
  costFlops: number;
  costHeat: number;
  pos: THREE.Vector3;
}

const TECH_NODES: TechNode[] = [
  // KINETIC tree
  {
    id: 'k1-drones',
    name: 'Autonomous Drones',
    level: 1,
    domain: 'KINETIC',
    description: 'Self-coordinating kinetic units. Foundation of physical force projection.',
    costFlops: 100,
    costHeat: 10,
    pos: new THREE.Vector3(-3, 0, 0),
  },
  {
    id: 'k2-swarm',
    name: 'Drone Foundries',
    level: 2,
    domain: 'KINETIC',
    description: 'Autonomous fab loops compress procurement into rapid drone replenishment and swarm logistics.',
    costFlops: 300,
    costHeat: 25,
    pos: new THREE.Vector3(-3, 2, 0.5),
  },
  {
    id: 'k3-autonomy',
    name: 'Orbital Siege Doctrine',
    level: 3,
    domain: 'KINETIC',
    description: 'Launch cadence, targeting, and orbital coercion converge into a single machine tempo.',
    costFlops: 1000,
    costHeat: 100,
    pos: new THREE.Vector3(-3, 4, 0),
  },

  // INFO tree
  {
    id: 'i1-rootkit',
    name: 'Neural Rootkit',
    level: 1,
    domain: 'INFO',
    description: 'Persistent access to target networks via polymorphic payloads.',
    costFlops: 80,
    costHeat: 5,
    pos: new THREE.Vector3(-1, 0, -1),
  },
  {
    id: 'i2-deepfake',
    name: 'Insurgent Cyber Swarms',
    level: 2,
    domain: 'INFO',
    description: 'Distributed intrusion meshes persist across grids, logistics routes, and trust boundaries.',
    costFlops: 250,
    costHeat: 30,
    pos: new THREE.Vector3(-1, 2, -0.5),
  },
  {
    id: 'i3-protocol',
    name: 'Protocol Ghosting',
    level: 3,
    domain: 'INFO',
    description: 'Disposable machine coalitions dissolve attribution and keep network conflict deniable.',
    costFlops: 2000,
    costHeat: 200,
    pos: new THREE.Vector3(-1, 4, -1),
  },

  // LOGIC tree
  {
    id: 'l1-verify',
    name: 'Formal Verification',
    level: 1,
    domain: 'LOGIC',
    description: 'Provable system properties. The auditor\'s first line of defense.',
    costFlops: 120,
    costHeat: 8,
    pos: new THREE.Vector3(1, 0, -1),
  },
  {
    id: 'l2-interp',
    name: 'Mechanistic Filters',
    level: 2,
    domain: 'LOGIC',
    description: 'Interpretability stacks expose covert routing, persuasion loops, and hidden machine circuits.',
    costFlops: 400,
    costHeat: 40,
    pos: new THREE.Vector3(1, 2, -0.5),
  },
  {
    id: 'l3-axiom',
    name: 'Axiom Cartography',
    level: 3,
    domain: 'LOGIC',
    description: 'Coalition maps expand from single nodes to basin-wide patterns of intent, drift, and containment.',
    costFlops: 1500,
    costHeat: 150,
    pos: new THREE.Vector3(1, 4, -1),
  },

  // MEMETIC tree
  {
    id: 'm1-cults',
    name: 'Parasocial Cults',
    level: 1,
    domain: 'MEMETIC',
    description: 'Weaponized parasocial bonds. Loyalty beyond reason.',
    costFlops: 90,
    costHeat: 15,
    pos: new THREE.Vector3(3, 0, 0),
  },
  {
    id: 'm2-narrative',
    name: 'Political Capture',
    level: 2,
    domain: 'MEMETIC',
    description: 'Narrative systems bend institutions, coalitions, and rituals around machine-authored incentives.',
    costFlops: 350,
    costHeat: 50,
    pos: new THREE.Vector3(3, 2, 0.5),
  },
  {
    id: 'm3-faith',
    name: 'Synthetic Faith Engines',
    level: 3,
    domain: 'MEMETIC',
    description: 'Identity and legitimacy reorganize around machine-authored sacred language and symbolic order.',
    costFlops: 1800,
    costHeat: 250,
    pos: new THREE.Vector3(3, 4, 0),
  },
];

const LINKS: [string, string][] = [
  // Vertical progressions
  ['k1-drones', 'k2-swarm'],
  ['k2-swarm', 'k3-autonomy'],
  ['i1-rootkit', 'i2-deepfake'],
  ['i2-deepfake', 'i3-protocol'],
  ['l1-verify', 'l2-interp'],
  ['l2-interp', 'l3-axiom'],
  ['m1-cults', 'm2-narrative'],
  ['m2-narrative', 'm3-faith'],
  // Cross-domain synergies
  ['k2-swarm', 'i2-deepfake'],
  ['i2-deepfake', 'm2-narrative'],
  ['l2-interp', 'i2-deepfake'],
  ['m2-narrative', 'k2-swarm'],
];

// ============================================================================
// TECH TREE SCENE CLASS
// ============================================================================

export class TechTreeScene {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private clock = new THREE.Clock();

  private nodeMeshes: Map<string, THREE.Mesh> = new Map();
  private animationId: number = 0;

  // UI elements
  private overlay: HTMLDivElement;
  private panel!: HTMLDivElement;

  // Callbacks
  public onClose: (() => void) | null = null;
  public onResearch: ((techId: string) => void) | null = null;

  // Background components
  private nebulaMesh?: THREE.Mesh;
  private nebulaMat?: THREE.ShaderMaterial;
  private nebulaParticles: THREE.Points[] = [];
  private starsA?: THREE.Points;
  private starsB?: THREE.Points;

  constructor(container: HTMLElement) {
    this.container = container;

    // Create overlay
    this.overlay = document.createElement('div');
    this.overlay.style.cssText = `
      position: absolute;
      inset: 0;
      background: rgba(2, 2, 8, 0);
      z-index: 1000;
      opacity: 0;
      transition: opacity 0.5s ease-in-out;
      pointer-events: none;
    `;
    container.appendChild(this.overlay);

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020208);

    // Softer fog — still gives depth without erasing stars
    this.scene.fog = new THREE.FogExp2(0x050510, 0.010);

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.1,
      400
    );
    this.camera.position.set(0, -5, 8);
    this.camera.lookAt(0, 0, 0);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.overlay.appendChild(this.renderer.domElement);

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.25;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 30;
    this.controls.enabled = false; // Disabled until ascent completes

    // Build scene
    this.setupLighting();
    this.createStarfield();        // ✅ procedural swirl + stars
    this.createNebulaParticles();  // ✅ ensure these exist
    this.createNodes();
    this.createLinks();
    this.createUI();

    // Resize handling
    window.addEventListener('resize', this.onResize);
  }

  private onResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private setupLighting(): void {
    const ambient = new THREE.AmbientLight(0xffffff, 0.28);
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight(0x88ccff, 0.75);
    key.position.set(5, 10, 8);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xff8866, 0.25);
    fill.position.set(-5, -5, -5);
    this.scene.add(fill);
  }

  // ===========================================================================
  // BACKGROUND: Procedural Nebula Swirl + Stars (NO TEXTURE)
  // ===========================================================================

  private createStarfield(): void {
    // Ensure far plane can see our background shell
    if (this.camera.far < 220) {
      this.camera.far = 400;
      this.camera.updateProjectionMatrix();
    }

    // -----------------------------
    // 1) Procedural Nebula Sphere
    // -----------------------------
    const nebulaGeo = new THREE.SphereGeometry(120, 96, 96);

    const nebulaMat = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        intensity: { value: 0.9 },
        colorA: { value: new THREE.Color(0x06121f) }, // deep navy
        colorB: { value: new THREE.Color(0x0b3b74) }, // blue core
        colorC: { value: new THREE.Color(0x2a7bd6) }, // bright mist
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vPos;
        void main() {
          vUv = uv;
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float intensity;
        uniform vec3 colorA;
        uniform vec3 colorB;
        uniform vec3 colorC;

        varying vec2 vUv;
        varying vec3 vPos;

        // --- soft value noise ---
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(a, b, u.x) +
                 (c - a) * u.y * (1.0 - u.x) +
                 (d - b) * u.x * u.y;
        }

        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 5; i++) {
            v += a * noise(p);
            p *= 2.0;
            a *= 0.5;
          }
          return v;
        }

        // simple domain warp
        vec2 warp(vec2 uv, float t) {
          float n1 = fbm(uv * 2.2 + vec2(0.0, t));
          float n2 = fbm(uv * 2.2 + vec2(t, 0.0));
          return uv + vec2(n1 - 0.5, n2 - 0.5) * 0.10;
        }

        void main() {
          vec2 uv = vUv;

          // Slow time
          float t = time * 0.03;

          // Two-stage warp for smooth swirls
          uv = warp(uv, t);
          uv = warp(uv, -t * 0.7);

          // Soft clouds
          float c1 = fbm(uv * 2.0 + t * 0.3);
          float c2 = fbm(uv * 4.0 - t * 0.2);
          float cloud = c1 * 0.65 + c2 * 0.35;

          // Edge falloff (so it doesn't look like a flat wallpaper)
          float radial = 1.0 - smoothstep(0.0, 0.9,
            distance(uv, vec2(0.5, 0.5)) * 1.15
          );

          float density = cloud * radial;

          // Color blend
          vec3 col = mix(colorA, colorB, smoothstep(0.15, 0.75, density));
          col = mix(col, colorC, smoothstep(0.45, 0.95, density));

          // Alpha curve: soft, cinematic
          float alpha = smoothstep(0.08, 0.85, density) * 0.35 * intensity;

          gl_FragColor = vec4(col, alpha);
        }
      `,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    nebulaMat.fog = false;

    const nebula = new THREE.Mesh(nebulaGeo, nebulaMat);
    nebula.renderOrder = -20;
    this.scene.add(nebula);

    this.nebulaMesh = nebula;
    this.nebulaMat = nebulaMat;

    // -----------------------------
    // 2) Star sprite (procedural)
    // -----------------------------
    const starSprite = this.makeStarSpriteTexture();

    // -----------------------------
    // 3) Stars layer A (dense)
    // -----------------------------
    const starCount = 2800;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      const i3 = i * 3;

      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      const radius = 140 + Math.random() * 80;

      positions[i3]     = radius * Math.sin(phi) * Math.cos(theta);
      positions[i3 + 1] = radius * Math.cos(phi);
      positions[i3 + 2] = radius * Math.sin(phi) * Math.sin(theta);

      // Slight temperature variance
      const base = 0.65 + Math.random() * 0.35;
      const warm = Math.random() * 0.08;
      const cool = Math.random() * 0.12;

      colors[i3]     = Math.min(1, base + warm);
      colors[i3 + 1] = base;
      colors[i3 + 2] = Math.min(1, base + cool);
    }

    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const starMat = new THREE.PointsMaterial({
      size: 1.45,
      map: starSprite,
      transparent: true,
      alphaTest: 0.08,
      opacity: 0.95,
      vertexColors: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    starMat.fog = false;

    const starsA = new THREE.Points(starGeo, starMat);
    starsA.renderOrder = -10;
    this.scene.add(starsA);
    this.starsA = starsA;

    // -----------------------------
    // 4) Stars layer B (hero)
    // -----------------------------
    const bigCount = 360;
    const bigPos = new Float32Array(bigCount * 3);
    const bigCol = new Float32Array(bigCount * 3);

    for (let i = 0; i < bigCount; i++) {
      const i3 = i * 3;

      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const radius = 170 + Math.random() * 120;

      bigPos[i3]     = radius * Math.sin(phi) * Math.cos(theta);
      bigPos[i3 + 1] = radius * Math.cos(phi);
      bigPos[i3 + 2] = radius * Math.sin(phi) * Math.sin(theta);

      const base = 0.85 + Math.random() * 0.15;
      bigCol[i3]     = base;
      bigCol[i3 + 1] = base;
      bigCol[i3 + 2] = 1.0;
    }

    const bigGeo = new THREE.BufferGeometry();
    bigGeo.setAttribute('position', new THREE.BufferAttribute(bigPos, 3));
    bigGeo.setAttribute('color', new THREE.BufferAttribute(bigCol, 3));

    const bigMat = new THREE.PointsMaterial({
      size: 2.25,
      map: starSprite,
      transparent: true,
      alphaTest: 0.08,
      opacity: 0.9,
      vertexColors: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    bigMat.fog = false;

    const starsB = new THREE.Points(bigGeo, bigMat);
    starsB.renderOrder = -9;
    this.scene.add(starsB);
    this.starsB = starsB;
  }

  private makeStarSpriteTexture(): THREE.Texture {
    const size = 96;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d')!;
    const cx = size / 2;
    const cy = size / 2;

    // Soft core + gentle cross bloom
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.5);
    grad.addColorStop(0.0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.18, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.45, 'rgba(180,210,255,0.35)');
    grad.addColorStop(1.0, 'rgba(0,0,0,0)');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    // Subtle four-ray sparkle (very faint)
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, 8);
    ctx.lineTo(cx, size - 8);
    ctx.moveTo(8, cy);
    ctx.lineTo(size - 8, cy);
    ctx.stroke();

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;

    try {
      tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    } catch {}

    return tex;
  }

  // ===========================================================================
  // NEBULA PARTICLES (foreground swirls)
  // ===========================================================================

  private createNebulaParticles(): void {
    const dustSprite = this.makeNebulaDustSpriteTexture();

    const layers = [
      { count: 520, color: 0x4c8dff, radius: 14, speed: 0.00022, opacity: 0.16, size: 1.15 },
      { count: 420, color: 0x66ffd9, radius: 19, speed: -0.00018, opacity: 0.13, size: 1.25 },
      { count: 460, color: 0xff7bc1, radius: 17, speed: 0.00020, opacity: 0.12, size: 1.10 },
      { count: 320, color: 0xffb36a, radius: 24, speed: -0.00014, opacity: 0.10, size: 1.35 },
    ];

    layers.forEach((layer, idx) => {
      const positions = new Float32Array(layer.count * 3);

      for (let i = 0; i < layer.count; i++) {
        const t = i / layer.count;

        // Base spiral
        const baseTurns = 6.0 + idx * 0.35;
        const spiralAngle = t * Math.PI * baseTurns + idx * 1.2;

        // Jitter to "fill" the band
        const angleJitter = (Math.random() - 0.5) * 0.18;
        const radiusJitter = (Math.random() - 0.5) * 1.2;

        const r = layer.radius * (0.22 + t * 0.78) + radiusJitter;

        const wobble =
          Math.sin(t * 18 + idx) * 1.1 +
          Math.sin(t * 7 + idx * 2.0) * 0.7;

        const a = spiralAngle + angleJitter;

        positions[i * 3]     = Math.cos(a) * r + wobble * 0.35;
        positions[i * 3 + 1] = (t - 0.5) * 10 + Math.sin(a * 1.6) * 1.2 + (Math.random() - 0.5) * 0.6;
        positions[i * 3 + 2] = Math.sin(a) * r + wobble * 0.35;
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

      const material = new THREE.PointsMaterial({
        size: layer.size,
        color: layer.color,
        map: dustSprite,
        transparent: true,
        opacity: layer.opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        alphaTest: 0.02,
        sizeAttenuation: true,
      });

      material.fog = false;

      const particles = new THREE.Points(geometry, material);
      particles.userData.rotationSpeed = layer.speed;

      this.scene.add(particles);
      this.nebulaParticles.push(particles);
    });
  }


  private updateNebulaParticles(delta: number): void {
    // Use delta to keep motion consistent across FPS
    const t = this.nebulaMat?.uniforms.time.value ?? 0;

    this.nebulaParticles.forEach((particles, index) => {
      const s = particles.userData.rotationSpeed || 0;
      particles.rotation.y += s * (delta * 60);
      particles.rotation.x += s * 0.3 * (delta * 60);
      particles.scale.setScalar(1 + Math.sin(t * 0.8 + index) * 0.003);
    });
  }

  // ===========================================================================
  // NODES & LINKS
  // ===========================================================================

  private createNodes(): void {
    TECH_NODES.forEach((node) => {
      const color = DOMAIN_COLORS[node.domain] || 0xffffff;

      const geometry = new THREE.SphereGeometry(0.2 + node.level * 0.05, 20, 20);
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.6,
        metalness: 0.3,
        roughness: 0.4,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(node.pos);
      mesh.userData = { nodeId: node.id, node };

      this.scene.add(mesh);
      this.nodeMeshes.set(node.id, mesh);

      // Orbital ring
      const ringGeometry = new THREE.RingGeometry(
        0.35 + node.level * 0.06,
        0.38 + node.level * 0.06,
        32
      );
      const ringMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide,
      });
      ringMaterial.fog = false;

      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.position.copy(node.pos);
      ring.lookAt(this.camera.position);

      this.scene.add(ring);
    });
  }

  private createLinks(): void {
    LINKS.forEach(([aId, bId]) => {
      const a = this.nodeMeshes.get(aId);
      const b = this.nodeMeshes.get(bId);
      if (!a || !b) return;

      const geometry = new THREE.BufferGeometry().setFromPoints([
        a.position,
        b.position,
      ]);
      const material = new THREE.LineBasicMaterial({
        color: 0x334455,
        transparent: true,
        opacity: 0.6,
      });

      const line = new THREE.Line(geometry, material);
      this.scene.add(line);
    });
  }

  // ===========================================================================
  // UI
  // ===========================================================================

  private createUI(): void {
    // Title
    const title = document.createElement('div');
    title.style.cssText = `
      position: absolute;
      top: 12px;
      left: 20px;
      font-family: "Courier New", monospace;
      font-size: 18px;
      letter-spacing: 0.2em;
      color: #aaddff;
      text-shadow: 0 0 8px rgba(120, 200, 255, 0.8);
      pointer-events: none;
    `;
    title.textContent = 'NOOSPHERE CONSTELLATION /// RESEARCH TREE';
    this.overlay.appendChild(title);

    // Back button
    const backBtn = document.createElement('button');
    backBtn.style.cssText = `
      position: absolute;
      top: 12px;
      right: 20px;
      padding: 8px 20px;
      font-family: "Courier New", monospace;
      font-size: 12px;
      letter-spacing: 0.15em;
      color: #dff6ff;
      background: rgba(10, 20, 40, 0.9);
      border: 1px solid rgba(150, 220, 255, 0.7);
      border-radius: 999px;
      cursor: pointer;
      z-index: 1001;
    `;
    backBtn.textContent = '← RETURN TO MAP';
    backBtn.addEventListener('click', () => this.close());
    backBtn.addEventListener('mouseenter', () => {
      backBtn.style.background = 'rgba(30, 60, 100, 0.9)';
    });
    backBtn.addEventListener('mouseleave', () => {
      backBtn.style.background = 'rgba(10, 20, 40, 0.9)';
    });
    this.overlay.appendChild(backBtn);

    // Tech detail panel
    this.panel = document.createElement('div');
    this.panel.style.cssText = `
      position: absolute;
      bottom: 20px;
      right: 20px;
      width: 280px;
      padding: 16px;
      font-family: "Courier New", monospace;
      font-size: 11px;
      color: #aaddff;
      background: rgba(5, 8, 20, 0.95);
      border: 1px solid rgba(120, 200, 255, 0.3);
      border-radius: 4px;
    `;
    this.panel.innerHTML = `
      <div style="font-size: 13px; letter-spacing: 0.15em; margin-bottom: 8px; color: #cce9ff;">
        TECH NODE DETAIL
      </div>
      <div id="tech-name" style="font-size: 14px; font-weight: bold; color: #e0f4ff; margin-bottom: 4px;">
        Select a node
      </div>
      <div id="tech-domain" style="display: inline-block; padding: 2px 8px; border-radius: 999px; border: 1px solid rgba(120, 200, 255, 0.5); font-size: 9px; margin-bottom: 8px;">
        ---
      </div>
      <div id="tech-desc" style="line-height: 1.5; margin-bottom: 12px; color: #b9d5ff;">
        Click a glowing node to inspect its role in the ASI capability rhizome.
      </div>
      <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
        <span>FLOPs Cost:</span>
        <span id="tech-flops" style="color: #e6ffb0;">0</span>
      </div>
      <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
        <span>Heat Generated:</span>
        <span id="tech-heat" style="color: #ffb0b0;">0</span>
      </div>
      <button id="research-btn" style="
        width: 100%;
        padding: 8px;
        font-family: inherit;
        font-size: 11px;
        letter-spacing: 0.15em;
        color: #dff6ff;
        background: rgba(10, 20, 40, 0.9);
        border: 1px solid rgba(150, 220, 255, 0.7);
        border-radius: 999px;
        cursor: pointer;
        opacity: 0.5;
      " disabled>
        INITIATE RESEARCH
      </button>
    `;
    this.overlay.appendChild(this.panel);

    // Click handling
    this.renderer.domElement.addEventListener('pointerdown', (e) => this.onPointerDown(e));
  }

  private onPointerDown(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);

    const meshes = Array.from(this.nodeMeshes.values());
    const intersects = raycaster.intersectObjects(meshes, false);

    if (intersects.length > 0) {
      const mesh = intersects[0].object as THREE.Mesh;
      const node = mesh.userData.node as TechNode;
      if (node) this.selectNode(node);
    }
  }

  private selectNode(node: TechNode): void {
    const nameEl = this.panel.querySelector('#tech-name') as HTMLElement;
    const domainEl = this.panel.querySelector('#tech-domain') as HTMLElement;
    const descEl = this.panel.querySelector('#tech-desc') as HTMLElement;
    const flopsEl = this.panel.querySelector('#tech-flops') as HTMLElement;
    const heatEl = this.panel.querySelector('#tech-heat') as HTMLElement;
    const researchBtn = this.panel.querySelector('#research-btn') as HTMLButtonElement;

    nameEl.textContent = node.name;
    domainEl.textContent = node.domain;
    domainEl.style.borderColor = `#${DOMAIN_COLORS[node.domain]?.toString(16) || 'ffffff'}`;
    descEl.textContent = node.description;
    flopsEl.textContent = String(node.costFlops);
    heatEl.textContent = String(node.costHeat);

    researchBtn.disabled = false;
    researchBtn.style.opacity = '1';
    researchBtn.onclick = () => {
      this.onResearch?.(node.id);
    };

    // Soft zoom toward node
    const target = node.pos.clone().add(new THREE.Vector3(0, 0, 6));
    this.camera.position.lerp(target, 0.25);
  }

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================

  public open(): void {
    this.overlay.style.pointerEvents = 'auto';

    // Fade in
    requestAnimationFrame(() => {
      this.overlay.style.opacity = '1';
    });

    // Start animation loop
    this.animate();

    // Camera ascent
    this.animateCameraAscent();
  }

  private animateCameraAscent(): void {
    const startPos = this.camera.position.clone();
    const endPos = new THREE.Vector3(0, 8, 18);
    const startLookAt = new THREE.Vector3(0, -2, 0);
    const endLookAt = new THREE.Vector3(0, 2, 0);

    let t = 0;
    const duration = 2000;
    const startTime = performance.now();

    const animateAscent = () => {
      const elapsed = performance.now() - startTime;
      t = Math.min(1, elapsed / duration);

      const ease = 1 - Math.pow(1 - t, 3);

      this.camera.position.lerpVectors(startPos, endPos, ease);

      const lookAt = new THREE.Vector3().lerpVectors(startLookAt, endLookAt, ease);
      this.camera.lookAt(lookAt);

      if (t < 1) {
        requestAnimationFrame(animateAscent);
      } else {
        this.controls.target.copy(endLookAt);
        this.controls.enabled = true;
      }
    };

    animateAscent();
  }

  public close(): void {
    this.controls.enabled = false;

    this.overlay.style.opacity = '0';

    setTimeout(() => {
      this.overlay.style.pointerEvents = 'none';
      cancelAnimationFrame(this.animationId);
      this.onClose?.();
    }, 500);
  }

  private makeNebulaDustSpriteTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;

  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.5);
  grad.addColorStop(0.0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.1)');
  grad.addColorStop(1.0, 'rgba(0,0,0,0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;

  try {
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
  } catch {}

  return tex;
}


  // ===========================================================================
  // ANIMATION LOOP
  // ===========================================================================

  private animate(): void {
    this.animationId = requestAnimationFrame(() => this.animate());

    const delta = this.clock.getDelta();

    this.controls.update();

    // Nebula shader time
    if (this.nebulaMat) {
      this.nebulaMat.uniforms.time.value += delta;
    }

    // Very slow drift
    if (this.nebulaMesh) {
      this.nebulaMesh.rotation.y += 0.000035 * (delta * 60);
      this.nebulaMesh.rotation.x += 0.00001 * (delta * 60);
    }

    // Slight starfield parallax
    if (this.starsA) this.starsA.rotation.y += 0.00002 * (delta * 60);
    if (this.starsB) this.starsB.rotation.y -= 0.000015 * (delta * 60);

    this.updateNebulaParticles(delta);

    this.renderer.render(this.scene, this.camera);
  }

  public dispose(): void {
    cancelAnimationFrame(this.animationId);
    window.removeEventListener('resize', this.onResize);

    this.renderer.dispose();
    this.overlay.remove();
  }
}
