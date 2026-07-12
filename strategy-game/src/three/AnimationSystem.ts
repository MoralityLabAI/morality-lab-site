// ============================================================================
// ASI CARTEL - Animation System
// Smooth transitions, particles, SC delta markers, victory animations
// ============================================================================

import * as THREE from 'three';
import { FactionId } from '../data/types';
import { FACTIONS } from '../data/gameData';

// --- Easing Functions (global use per polish checklist) ---
export const Easing = {
  easeOutCubic: (t: number): number => 1 - Math.pow(1 - t, 3),
  easeInCubic: (t: number): number => t * t * t,
  easeInOutCubic: (t: number): number => 
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  easeOutBack: (t: number): number => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  easeOutElastic: (t: number): number => {
    const c4 = (2 * Math.PI) / 3;
    return t === 0 ? 0 : t === 1 ? 1 :
      Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  easeOutQuart: (t: number): number => 1 - Math.pow(1 - t, 4),
  linear: (t: number): number => t
};

export type EasingFunction = keyof typeof Easing;

// --- Particle ---
interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  gravity: number;
  fadeOut: boolean;
  shrink: boolean;
}

// --- Delta Marker (floating +1/-1 text) ---
interface DeltaMarker {
  sprite: THREE.Sprite;
  startTime: number;
  duration: number;
  startPos: THREE.Vector3;
  riseHeight: number;
}

// --- Tween ---
interface Tween {
  id: string;
  startTime: number;
  duration: number;
  update: (progress: number) => void;
  onComplete?: () => void;
  easing: EasingFunction;
}

export class AnimationSystem {
  private scene: THREE.Scene;
  private particles: Particle[] = [];
  private deltaMarkers: DeltaMarker[] = [];
  private tweens: Map<string, Tween> = new Map();
  private clock: THREE.Clock;
  private particleGeometry: THREE.SphereGeometry;
  
  // Object pools for performance
  private particlePool: THREE.Mesh[] = [];
  private maxPoolSize = 200;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.clock = new THREE.Clock();
    this.particleGeometry = new THREE.SphereGeometry(0.05, 8, 8);
  }

  // =========================================================================
  // TWEEN SYSTEM
  // =========================================================================

  public tween(
    id: string,
    duration: number,
    update: (progress: number) => void,
    options: {
      easing?: EasingFunction;
      onComplete?: () => void;
    } = {}
  ): void {
    // Cancel existing tween with same ID
    this.cancelTween(id);
    
    this.tweens.set(id, {
      id,
      startTime: this.clock.getElapsedTime(),
      duration,
      update,
      onComplete: options.onComplete,
      easing: options.easing || 'easeOutCubic'
    });
  }

  public cancelTween(id: string): void {
    this.tweens.delete(id);
  }

  // Convenience: tween a Vector3
  public tweenVector3(
    id: string,
    target: THREE.Vector3,
    from: THREE.Vector3,
    to: THREE.Vector3,
    duration: number,
    easing: EasingFunction = 'easeOutCubic',
    onComplete?: () => void
  ): void {
    const startClone = from.clone();
    const endClone = to.clone();
    
    this.tween(id, duration, (progress) => {
      target.lerpVectors(startClone, endClone, progress);
    }, { easing, onComplete });
  }

  // Convenience: tween a scalar
  public tweenValue(
    id: string,
    initial: number,
    final: number,
    duration: number,
    onUpdate: (value: number) => void,
    easing: EasingFunction = 'easeOutCubic',
    onComplete?: () => void
  ): void {
    this.tween(id, duration, (progress) => {
      const value = initial + (final - initial) * progress;
      onUpdate(value);
    }, { easing, onComplete });
  }

  // =========================================================================
  // PARTICLE SYSTEM
  // =========================================================================

  private getParticleMesh(color: number): THREE.Mesh {
    // Try to reuse from pool
    if (this.particlePool.length > 0) {
      const mesh = this.particlePool.pop()!;
      (mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
      (mesh.material as THREE.MeshBasicMaterial).opacity = 1;
      mesh.scale.setScalar(1);
      mesh.visible = true;
      return mesh;
    }
    
    // Create new
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 1
    });
    return new THREE.Mesh(this.particleGeometry, material);
  }

  private returnToPool(mesh: THREE.Mesh): void {
    mesh.visible = false;
    if (this.particlePool.length < this.maxPoolSize) {
      this.particlePool.push(mesh);
    } else {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  }

  /**
   * Spawn a burst of particles at a position
   */
  public particleBurst(
    position: THREE.Vector3,
    color: number,
    count: number = 20,
    options: {
      speed?: number;
      life?: number;
      gravity?: number;
      fadeOut?: boolean;
      shrink?: boolean;
      spread?: number;
    } = {}
  ): void {
    const {
      speed = 2,
      life = 1.5,
      gravity = -1,
      fadeOut = true,
      shrink = true,
      spread = Math.PI * 2
    } = options;

    for (let i = 0; i < count; i++) {
      const mesh = this.getParticleMesh(color);
      mesh.position.copy(position);
      
      // Random velocity in hemisphere/sphere
      const theta = Math.random() * spread;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = speed * (0.5 + Math.random() * 0.5);
      
      const velocity = new THREE.Vector3(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi) * 0.5 + r * 0.5, // Bias upward
        r * Math.sin(phi) * Math.sin(theta)
      );
      
      this.scene.add(mesh);
      
      this.particles.push({
        mesh,
        velocity,
        life,
        maxLife: life,
        gravity,
        fadeOut,
        shrink
      });
    }
  }

  /**
   * Spawn faction-colored celebration particles
   */
  public victoryBurst(position: THREE.Vector3, faction: FactionId): void {
    const factionData = FACTIONS[faction];
    const primaryColor = factionData.color;
    const secondaryColor = factionData.colorAlt;
    
    // Big initial burst
    this.particleBurst(position, primaryColor, 40, {
      speed: 4,
      life: 2,
      gravity: -0.5
    });
    
    // Delayed secondary burst
    setTimeout(() => {
      this.particleBurst(position, secondaryColor, 30, {
        speed: 3,
        life: 1.5,
        gravity: -0.8
      });
    }, 200);
    
    // Trailing sparkles
    setTimeout(() => {
      this.particleBurst(position, 0xffffff, 15, {
        speed: 2,
        life: 1,
        gravity: -0.3
      });
    }, 400);
  }

  /**
   * Continuous particle trail (for moving units)
   */
  public spawnTrailParticle(position: THREE.Vector3, color: number): void {
    const mesh = this.getParticleMesh(color);
    mesh.position.copy(position);
    mesh.scale.setScalar(0.5);
    
    this.scene.add(mesh);
    
    this.particles.push({
      mesh,
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 0.2,
        Math.random() * 0.3,
        (Math.random() - 0.5) * 0.2
      ),
      life: 0.5,
      maxLife: 0.5,
      gravity: 0,
      fadeOut: true,
      shrink: true
    });
  }

  // =========================================================================
  // DELTA MARKERS (+1/-1 floating text)
  // =========================================================================

  /**
   * Create a floating delta marker (e.g., "+1" or "-1" for territory changes)
   */
  public createDeltaMarker(
    position: THREE.Vector3,
    delta: number,
    faction: FactionId
  ): void {
    const factionData = FACTIONS[faction];
    const isPositive = delta > 0;
    
    // Create canvas for text
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    
    // Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw text
    ctx.font = 'bold 48px Orbitron, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Glow effect
    ctx.shadowColor = `#${factionData.color.toString(16).padStart(6, '0')}`;
    ctx.shadowBlur = 10;
    
    // Text color
    ctx.fillStyle = isPositive ? '#44ff88' : '#ff4444';
    ctx.fillText(`${isPositive ? '+' : ''}${delta}`, 64, 32);
    
    // Create sprite
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 1
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(1.5, 0.75, 1);
    sprite.position.copy(position);
    
    this.scene.add(sprite);
    
    this.deltaMarkers.push({
      sprite,
      startTime: this.clock.getElapsedTime(),
      duration: 2,
      startPos: position.clone(),
      riseHeight: 2
    });
    
    // Optional: particle burst at marker location
    this.particleBurst(position, factionData.color, 10, {
      speed: 1,
      life: 0.8,
      gravity: -0.5
    });
  }

  // =========================================================================
  // HIGHLIGHT EFFECTS
  // =========================================================================

  /**
   * Create a pulsing highlight ring around a position
   */
  public createHighlightRing(
    position: THREE.Vector3,
    color: number,
    duration: number = 1
  ): THREE.Mesh {
    const geometry = new THREE.RingGeometry(0.3, 0.4, 32);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide
    });
    
    const ring = new THREE.Mesh(geometry, material);
    ring.position.copy(position);
    ring.lookAt(0, 0, 0); // Face outward from globe center
    
    this.scene.add(ring);
    
    // Animate scale and fade
    const startScale = 0.5;
    const endScale = 2;
    
    this.tween(`highlight-${Date.now()}`, duration, (progress) => {
      const scale = startScale + (endScale - startScale) * progress;
      ring.scale.setScalar(scale);
      material.opacity = 0.8 * (1 - progress);
    }, {
      easing: 'easeOutCubic',
      onComplete: () => {
        this.scene.remove(ring);
        geometry.dispose();
        material.dispose();
      }
    });
    
    return ring;
  }

  /**
   * Create a subtle glow pulse effect
   */
  public pulseGlow(
    mesh: THREE.Mesh,
    intensity: number = 0.5,
    duration: number = 0.3
  ): void {
    const material = mesh.material as THREE.MeshStandardMaterial;
    if (!material.emissive) return;
    
    const originalIntensity = material.emissiveIntensity;
    const peakIntensity = originalIntensity + intensity;
    
    // Pulse up
    this.tweenValue(
      `glow-${mesh.uuid}`,
      originalIntensity,
      peakIntensity,
      duration / 2,
      (value) => { material.emissiveIntensity = value; },
      'easeOutCubic',
      () => {
        // Pulse down
        this.tweenValue(
          `glow-${mesh.uuid}-down`,
          peakIntensity,
          originalIntensity,
          duration / 2,
          (value) => { material.emissiveIntensity = value; },
          'easeInCubic'
        );
      }
    );
  }

  // =========================================================================
  // UPDATE LOOP
  // =========================================================================

  public update(deltaTime: number): void {
    const currentTime = this.clock.getElapsedTime();
    
    // Update tweens
    for (const [id, tween] of this.tweens) {
      const elapsed = currentTime - tween.startTime;
      const rawProgress = Math.min(1, elapsed / tween.duration);
      const easedProgress = Easing[tween.easing](rawProgress);
      
      tween.update(easedProgress);
      
      if (rawProgress >= 1) {
        if (tween.onComplete) tween.onComplete();
        this.tweens.delete(id);
      }
    }
    
    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      
      // Apply velocity and gravity
      p.velocity.y += p.gravity * deltaTime;
      p.mesh.position.add(p.velocity.clone().multiplyScalar(deltaTime));
      
      // Decrease life
      p.life -= deltaTime;
      const lifeRatio = p.life / p.maxLife;
      
      // Fade and shrink
      if (p.fadeOut) {
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = lifeRatio;
      }
      if (p.shrink) {
        p.mesh.scale.setScalar(lifeRatio);
      }
      
      // Remove dead particles
      if (p.life <= 0) {
        this.returnToPool(p.mesh);
        this.particles.splice(i, 1);
      }
    }
    
    // Update delta markers
    for (let i = this.deltaMarkers.length - 1; i >= 0; i--) {
      const marker = this.deltaMarkers[i];
      const elapsed = currentTime - marker.startTime;
      const progress = Math.min(1, elapsed / marker.duration);
      
      // Rise animation with easing
      const easedProgress = Easing.easeOutCubic(progress);
      marker.sprite.position.y = marker.startPos.y + marker.riseHeight * easedProgress;
      
      // Fade out in second half
      if (progress > 0.5) {
        const fadeProgress = (progress - 0.5) * 2;
        (marker.sprite.material as THREE.SpriteMaterial).opacity = 1 - fadeProgress;
      }
      
      // Remove completed markers
      if (progress >= 1) {
        this.scene.remove(marker.sprite);
        (marker.sprite.material as THREE.SpriteMaterial).dispose();
        this.deltaMarkers.splice(i, 1);
      }
    }
  }

  // =========================================================================
  // CLEANUP
  // =========================================================================

  public dispose(): void {
    // Clear all particles
    for (const p of this.particles) {
      this.scene.remove(p.mesh);
      (p.mesh.material as THREE.Material).dispose();
    }
    this.particles = [];
    
    // Clear pool
    for (const mesh of this.particlePool) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.particlePool = [];
    
    // Clear markers
    for (const marker of this.deltaMarkers) {
      this.scene.remove(marker.sprite);
      (marker.sprite.material as THREE.SpriteMaterial).dispose();
    }
    this.deltaMarkers = [];
    
    // Clear tweens
    this.tweens.clear();
    
    this.particleGeometry.dispose();
  }
}
