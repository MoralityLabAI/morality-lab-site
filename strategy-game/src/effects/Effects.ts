// ============================================================================
// ASI CARTEL - Animation & Effects System
// Easing, particles, floating markers, and polish effects
// ============================================================================

import * as THREE from 'three';

// --- Easing Functions ---
export const Easing = {
  // Smooth acceleration/deceleration
  easeInOutCubic: (t: number): number => {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  },
  
  // Quick start, slow end
  easeOutQuart: (t: number): number => {
    return 1 - Math.pow(1 - t, 4);
  },
  
  // Slow start, quick end
  easeInQuart: (t: number): number => {
    return t * t * t * t;
  },
  
  // Bounce at end
  easeOutBack: (t: number): number => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  
  // Elastic bounce
  easeOutElastic: (t: number): number => {
    const c4 = (2 * Math.PI) / 3;
    return t === 0 ? 0 : t === 1 ? 1 :
      Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  
  // Smooth step (hermite)
  smoothStep: (t: number): number => {
    return t * t * (3 - 2 * t);
  },
  
  // Exponential decay
  expDecay: (t: number, decay: number = 5): number => {
    return 1 - Math.exp(-decay * t);
  }
};

// --- Tween Manager ---
interface Tween {
  id: string;
  target: any;
  property: string;
  startValue: number;
  endValue: number;
  duration: number;
  elapsed: number;
  easing: (t: number) => number;
  onUpdate?: (value: number) => void;
  onComplete?: () => void;
}

class TweenManager {
  private tweens: Map<string, Tween> = new Map();
  private idCounter = 0;

  create(
    target: any,
    property: string,
    endValue: number,
    duration: number,
    easing: (t: number) => number = Easing.easeOutQuart,
    onComplete?: () => void
  ): string {
    const id = `tween_${this.idCounter++}`;
    const startValue = this.getNestedProperty(target, property);
    
    this.tweens.set(id, {
      id,
      target,
      property,
      startValue,
      endValue,
      duration,
      elapsed: 0,
      easing,
      onComplete
    });
    
    return id;
  }

  update(deltaTime: number): void {
    for (const [id, tween] of this.tweens) {
      tween.elapsed += deltaTime;
      const progress = Math.min(tween.elapsed / tween.duration, 1);
      const easedProgress = tween.easing(progress);
      
      const value = tween.startValue + (tween.endValue - tween.startValue) * easedProgress;
      this.setNestedProperty(tween.target, tween.property, value);
      
      if (tween.onUpdate) tween.onUpdate(value);
      
      if (progress >= 1) {
        if (tween.onComplete) tween.onComplete();
        this.tweens.delete(id);
      }
    }
  }

  cancel(id: string): void {
    this.tweens.delete(id);
  }

  private getNestedProperty(obj: any, path: string): number {
    return path.split('.').reduce((o, key) => o[key], obj);
  }

  private setNestedProperty(obj: any, path: string, value: number): void {
    const keys = path.split('.');
    const last = keys.pop()!;
    const target = keys.reduce((o, key) => o[key], obj);
    target[last] = value;
  }
}

export const tweenManager = new TweenManager();

// --- Particle System ---
interface Particle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  color: THREE.Color;
  size: number;
  life: number;
  maxLife: number;
  mesh?: THREE.Mesh;
}

export class ParticleSystem {
  private particles: Particle[] = [];
  private scene: THREE.Scene;
  private geometry: THREE.SphereGeometry;
  private pool: THREE.Mesh[] = [];
  private maxPoolSize = 500;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.geometry = new THREE.SphereGeometry(0.05, 8, 8);
    
    // Pre-populate pool
    for (let i = 0; i < 100; i++) {
      this.pool.push(this.createParticleMesh());
    }
  }

  private createParticleMesh(): THREE.Mesh {
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending
    });
    const mesh = new THREE.Mesh(this.geometry, material);
    mesh.visible = false;
    this.scene.add(mesh);
    return mesh;
  }

  private getMesh(): THREE.Mesh {
    let mesh = this.pool.find(m => !m.visible);
    if (!mesh && this.pool.length < this.maxPoolSize) {
      mesh = this.createParticleMesh();
      this.pool.push(mesh);
    }
    return mesh || this.pool[0];
  }

  /**
   * Emit a burst of particles at a position
   */
  burst(
    position: THREE.Vector3,
    color: number,
    count: number = 20,
    speed: number = 2,
    lifetime: number = 1.5
  ): void {
    const baseColor = new THREE.Color(color);
    
    for (let i = 0; i < count; i++) {
      const mesh = this.getMesh();
      if (!mesh) continue;
      
      // Random direction
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const velocity = new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.sin(phi) * Math.sin(theta),
        Math.cos(phi)
      ).multiplyScalar(speed * (0.5 + Math.random() * 0.5));
      
      // Slight color variation
      const particleColor = baseColor.clone();
      particleColor.offsetHSL(
        (Math.random() - 0.5) * 0.1,
        (Math.random() - 0.5) * 0.2,
        (Math.random() - 0.5) * 0.2
      );
      
      const particle: Particle = {
        position: position.clone(),
        velocity,
        color: particleColor,
        size: 0.03 + Math.random() * 0.05,
        life: lifetime,
        maxLife: lifetime,
        mesh
      };
      
      mesh.position.copy(position);
      mesh.scale.setScalar(particle.size * 20);
      (mesh.material as THREE.MeshBasicMaterial).color.copy(particleColor);
      (mesh.material as THREE.MeshBasicMaterial).opacity = 1;
      mesh.visible = true;
      
      this.particles.push(particle);
    }
  }

  /**
   * Emit victory celebration particles
   */
  victoryBurst(position: THREE.Vector3, factionColor: number): void {
    // Main burst
    this.burst(position, factionColor, 50, 3, 2);
    
    // Secondary bursts with delays
    setTimeout(() => this.burst(position, 0xffffff, 30, 2, 1.5), 200);
    setTimeout(() => this.burst(position, factionColor, 40, 2.5, 1.8), 400);
  }

  /**
   * Continuous stream effect
   */
  stream(
    start: THREE.Vector3,
    end: THREE.Vector3,
    color: number,
    duration: number = 1
  ): void {
    const count = Math.floor(duration * 30);
    const direction = end.clone().sub(start).normalize();
    
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        const mesh = this.getMesh();
        if (!mesh) return;
        
        const t = i / count;
        const pos = start.clone().lerp(end, t);
        
        // Add slight perpendicular offset
        const perp = new THREE.Vector3(-direction.y, direction.x, 0).multiplyScalar(
          Math.sin(i * 0.5) * 0.1
        );
        pos.add(perp);
        
        const particle: Particle = {
          position: pos,
          velocity: direction.clone().multiplyScalar(0.5),
          color: new THREE.Color(color),
          size: 0.02,
          life: 0.5,
          maxLife: 0.5,
          mesh
        };
        
        mesh.position.copy(pos);
        mesh.scale.setScalar(particle.size * 20);
        (mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
        (mesh.material as THREE.MeshBasicMaterial).opacity = 1;
        mesh.visible = true;
        
        this.particles.push(particle);
      }, i * (1000 / 30));
    }
  }

  update(deltaTime: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      
      // Update position
      p.position.add(p.velocity.clone().multiplyScalar(deltaTime));
      
      // Apply gravity
      p.velocity.y -= deltaTime * 1.5;
      
      // Update life
      p.life -= deltaTime;
      
      // Update mesh
      if (p.mesh) {
        p.mesh.position.copy(p.position);
        
        // Fade out
        const lifeRatio = p.life / p.maxLife;
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = lifeRatio;
        
        // Shrink slightly
        p.mesh.scale.setScalar(p.size * 20 * (0.5 + lifeRatio * 0.5));
      }
      
      // Remove dead particles
      if (p.life <= 0) {
        if (p.mesh) p.mesh.visible = false;
        this.particles.splice(i, 1);
      }
    }
  }

  dispose(): void {
    for (const mesh of this.pool) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      this.scene.remove(mesh);
    }
    this.pool = [];
    this.particles = [];
  }
}

// --- Floating Text Markers (SC Delta style) ---
interface FloatingMarker {
  element: HTMLDivElement;
  startTime: number;
  duration: number;
  startY: number;
  targetY: number;
}

export class FloatingMarkerSystem {
  private container: HTMLElement;
  private markers: FloatingMarker[] = [];
  private camera: THREE.Camera;
  private renderer: THREE.WebGLRenderer;

  constructor(container: HTMLElement, camera: THREE.Camera, renderer: THREE.WebGLRenderer) {
    this.container = container;
    this.camera = camera;
    this.renderer = renderer;
  }

  /**
   * Show a floating +1/-1 marker at a 3D position
   */
  showDelta(
    position: THREE.Vector3,
    delta: number,
    color: string,
    label?: string
  ): void {
    // Project 3D position to screen
    const screenPos = this.projectToScreen(position);
    if (!screenPos) return;

    // Create marker element
    const marker = document.createElement('div');
    marker.className = 'floating-marker';
    marker.innerHTML = `
      <span class="marker-delta">${delta > 0 ? '+' : ''}${delta}</span>
      ${label ? `<span class="marker-label">${label}</span>` : ''}
    `;
    marker.style.cssText = `
      position: absolute;
      left: ${screenPos.x}px;
      top: ${screenPos.y}px;
      transform: translate(-50%, -50%);
      color: ${color};
      font-family: 'Orbitron', sans-serif;
      font-size: 18px;
      font-weight: 700;
      text-shadow: 0 0 10px ${color}, 0 2px 4px rgba(0,0,0,0.8);
      pointer-events: none;
      z-index: 100;
      opacity: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
    `;
    
    this.container.appendChild(marker);

    const floatingMarker: FloatingMarker = {
      element: marker,
      startTime: performance.now(),
      duration: 1500,
      startY: screenPos.y,
      targetY: screenPos.y - 60
    };

    this.markers.push(floatingMarker);
  }

  /**
   * Show resource change indicator
   */
  showResourceChange(
    position: THREE.Vector3,
    resourceType: 'flops' | 'watts' | 'influence',
    delta: number
  ): void {
    const colors: Record<string, string> = {
      flops: '#00d4ff',
      watts: '#ffaa00',
      influence: '#ff44aa'
    };
    
    const labels: Record<string, string> = {
      flops: 'FLOPs',
      watts: 'W',
      influence: 'INF'
    };

    this.showDelta(position, delta, colors[resourceType], labels[resourceType]);
  }

  /**
   * Show combat result marker
   */
  showCombatResult(position: THREE.Vector3, damage: number, isDefender: boolean): void {
    const color = isDefender ? '#ff4444' : '#ffaa00';
    this.showDelta(position, -damage, color, 'DMG');
  }

  private projectToScreen(position: THREE.Vector3): { x: number; y: number } | null {
    const vector = position.clone().project(this.camera);
    
    // Check if behind camera
    if (vector.z > 1) return null;
    
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: (vector.x * 0.5 + 0.5) * rect.width,
      y: (-vector.y * 0.5 + 0.5) * rect.height
    };
  }

  update(): void {
    const now = performance.now();
    
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const marker = this.markers[i];
      const elapsed = now - marker.startTime;
      const progress = Math.min(elapsed / marker.duration, 1);
      
      // Eased animation
      const easedProgress = Easing.easeOutQuart(progress);
      
      // Fade in quickly, fade out slowly
      let opacity: number;
      if (progress < 0.2) {
        opacity = progress / 0.2;
      } else if (progress > 0.7) {
        opacity = 1 - (progress - 0.7) / 0.3;
      } else {
        opacity = 1;
      }
      
      // Rise animation
      const y = marker.startY + (marker.targetY - marker.startY) * easedProgress;
      
      marker.element.style.top = `${y}px`;
      marker.element.style.opacity = `${opacity}`;
      
      // Scale pop effect
      const scale = progress < 0.1 ? Easing.easeOutBack(progress / 0.1) : 1;
      marker.element.style.transform = `translate(-50%, -50%) scale(${scale})`;
      
      // Remove when complete
      if (progress >= 1) {
        marker.element.remove();
        this.markers.splice(i, 1);
      }
    }
  }
}

// --- Tooltip System ---
interface TooltipData {
  title: string;
  lines: { label: string; value: string; color?: string }[];
  footer?: string;
}

export class TooltipSystem {
  private container: HTMLElement;
  private tooltip: HTMLDivElement;
  private isVisible = false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.tooltip = this.createTooltip();
    this.container.appendChild(this.tooltip);
  }

  private createTooltip(): HTMLDivElement {
    const tooltip = document.createElement('div');
    tooltip.className = 'asi-tooltip';
    tooltip.style.cssText = `
      position: absolute;
      background: rgba(5, 8, 15, 0.95);
      border: 1px solid rgba(0, 212, 255, 0.4);
      border-radius: 8px;
      padding: 12px 16px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: #e8eef5;
      pointer-events: none;
      z-index: 200;
      opacity: 0;
      transform: translateY(10px);
      transition: opacity 0.15s ease, transform 0.15s ease;
      backdrop-filter: blur(10px);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
      max-width: 280px;
    `;
    return tooltip;
  }

  show(x: number, y: number, data: TooltipData): void {
    // Build content
    let html = `
      <div style="font-family: 'Orbitron', sans-serif; font-size: 12px; color: #00d4ff; margin-bottom: 8px; letter-spacing: 1px;">
        ${data.title}
      </div>
    `;
    
    for (const line of data.lines) {
      html += `
        <div style="display: flex; justify-content: space-between; margin: 4px 0;">
          <span style="color: #8899aa;">${line.label}</span>
          <span style="color: ${line.color || '#e8eef5'}; font-weight: 600;">${line.value}</span>
        </div>
      `;
    }
    
    if (data.footer) {
      html += `
        <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.1); color: #8899aa; font-size: 10px;">
          ${data.footer}
        </div>
      `;
    }
    
    this.tooltip.innerHTML = html;
    
    // Position (offset from cursor)
    const rect = this.container.getBoundingClientRect();
    const tooltipRect = this.tooltip.getBoundingClientRect();
    
    let posX = x + 15;
    let posY = y + 15;
    
    // Keep on screen
    if (posX + tooltipRect.width > rect.width) {
      posX = x - tooltipRect.width - 15;
    }
    if (posY + tooltipRect.height > rect.height) {
      posY = y - tooltipRect.height - 15;
    }
    
    this.tooltip.style.left = `${posX}px`;
    this.tooltip.style.top = `${posY}px`;
    this.tooltip.style.opacity = '1';
    this.tooltip.style.transform = 'translateY(0)';
    this.isVisible = true;
  }

  hide(): void {
    if (!this.isVisible) return;
    this.tooltip.style.opacity = '0';
    this.tooltip.style.transform = 'translateY(10px)';
    this.isVisible = false;
  }

  updatePosition(x: number, y: number): void {
    if (!this.isVisible) return;
    
    const rect = this.container.getBoundingClientRect();
    const tooltipRect = this.tooltip.getBoundingClientRect();
    
    let posX = x + 15;
    let posY = y + 15;
    
    if (posX + tooltipRect.width > rect.width) {
      posX = x - tooltipRect.width - 15;
    }
    if (posY + tooltipRect.height > rect.height) {
      posY = y - tooltipRect.height - 15;
    }
    
    this.tooltip.style.left = `${posX}px`;
    this.tooltip.style.top = `${posY}px`;
  }
}

// --- Glow Effect for Meshes ---
export function addGlowEffect(
  mesh: THREE.Mesh,
  color: number,
  intensity: number = 0.5,
  scale: number = 1.2
): THREE.Mesh {
  const glowGeometry = mesh.geometry.clone();
  const glowMaterial = new THREE.ShaderMaterial({
    uniforms: {
      glowColor: { value: new THREE.Color(color) },
      intensity: { value: intensity },
      time: { value: 0 }
    },
    vertexShader: `
      varying vec3 vNormal;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position * ${scale.toFixed(2)}, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 glowColor;
      uniform float intensity;
      uniform float time;
      varying vec3 vNormal;
      void main() {
        float glow = pow(0.8 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.0);
        float pulse = 0.8 + 0.2 * sin(time * 3.0);
        gl_FragColor = vec4(glowColor, glow * intensity * pulse);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    depthWrite: false
  });
  
  const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
  glowMesh.position.copy(mesh.position);
  glowMesh.rotation.copy(mesh.rotation);
  
  return glowMesh;
}

// --- Screen Shake ---
export class ScreenShake {
  private intensity = 0;
  private decay = 5;
  private offset = new THREE.Vector3();

  trigger(intensity: number = 0.3): void {
    this.intensity = intensity;
  }

  update(deltaTime: number, camera: THREE.Camera): void {
    if (this.intensity > 0.001) {
      // Random offset
      this.offset.set(
        (Math.random() - 0.5) * this.intensity,
        (Math.random() - 0.5) * this.intensity,
        0
      );
      
      camera.position.add(this.offset);
      
      // Decay
      this.intensity *= Math.exp(-this.decay * deltaTime);
    }
  }
}
