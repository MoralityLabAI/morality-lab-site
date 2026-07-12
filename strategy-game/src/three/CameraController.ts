// ============================================================================
// ASI CARTEL - Easing & Camera Controller
// Smooth pan/zoom with framerate-independent transitions
// ============================================================================

import * as THREE from 'three';

// ===========================================================================
// EASING FUNCTIONS
// ===========================================================================

export type EasingFunction = (t: number) => number;

export const Easing = {
  // Linear
  linear: (t: number) => t,
  
  // Quadratic
  easeInQuad: (t: number) => t * t,
  easeOutQuad: (t: number) => t * (2 - t),
  easeInOutQuad: (t: number) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  
  // Cubic
  easeInCubic: (t: number) => t * t * t,
  easeOutCubic: (t: number) => (--t) * t * t + 1,
  easeInOutCubic: (t: number) => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,
  
  // Quartic
  easeInQuart: (t: number) => t * t * t * t,
  easeOutQuart: (t: number) => 1 - (--t) * t * t * t,
  easeInOutQuart: (t: number) => t < 0.5 ? 8 * t * t * t * t : 1 - 8 * (--t) * t * t * t,
  
  // Exponential
  easeInExpo: (t: number) => t === 0 ? 0 : Math.pow(2, 10 * (t - 1)),
  easeOutExpo: (t: number) => t === 1 ? 1 : 1 - Math.pow(2, -10 * t),
  easeInOutExpo: (t: number) => {
    if (t === 0 || t === 1) return t;
    if (t < 0.5) return Math.pow(2, 20 * t - 10) / 2;
    return (2 - Math.pow(2, -20 * t + 10)) / 2;
  },
  
  // Elastic (bounce-like)
  easeOutElastic: (t: number) => {
    const c4 = (2 * Math.PI) / 3;
    return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  
  // Back (overshoot)
  easeOutBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  
  // Smooth step (Hermite interpolation)
  smoothStep: (t: number) => t * t * (3 - 2 * t),
  smootherStep: (t: number) => t * t * t * (t * (t * 6 - 15) + 10),
} as const;

// ===========================================================================
// TWEEN CLASS
// ===========================================================================

export interface TweenConfig<T> {
  from: T;
  to: T;
  duration: number;
  easing?: EasingFunction;
  onUpdate?: (value: T) => void;
  onComplete?: () => void;
}

export class Tween<T extends number | THREE.Vector3> {
  private from: T;
  private to: T;
  private duration: number;
  private elapsed: number = 0;
  private easing: EasingFunction;
  private onUpdate?: (value: T) => void;
  private onComplete?: () => void;
  private _isComplete: boolean = false;

  constructor(config: TweenConfig<T>) {
    this.from = config.from;
    this.to = config.to;
    this.duration = config.duration;
    this.easing = config.easing || Easing.easeOutCubic;
    this.onUpdate = config.onUpdate;
    this.onComplete = config.onComplete;
  }

  public update(delta: number): boolean {
    if (this._isComplete) return true;

    this.elapsed += delta;
    const t = Math.min(this.elapsed / this.duration, 1);
    const easedT = this.easing(t);

    let value: T;
    
    if (typeof this.from === 'number' && typeof this.to === 'number') {
      value = (this.from + (this.to - this.from) * easedT) as T;
    } else if (this.from instanceof THREE.Vector3 && this.to instanceof THREE.Vector3) {
      value = new THREE.Vector3().lerpVectors(this.from, this.to, easedT) as T;
    } else {
      value = this.to;
    }

    this.onUpdate?.(value);

    if (t >= 1) {
      this._isComplete = true;
      this.onComplete?.();
      return true;
    }

    return false;
  }

  public get isComplete(): boolean {
    return this._isComplete;
  }
}

// ===========================================================================
// CAMERA CONTROLLER
// ===========================================================================

export interface CameraState {
  position: THREE.Vector3;
  lookAt: THREE.Vector3;
  fov: number;
}

export class CameraController {
  private camera: THREE.PerspectiveCamera;
  
  // Current state
  private currentPosition: THREE.Vector3;
  private currentLookAt: THREE.Vector3;
  private currentFov: number;
  
  // Target state
  private targetPosition: THREE.Vector3;
  private targetLookAt: THREE.Vector3;
  private targetFov: number;
  
  // Interpolation state
  private positionVelocity: THREE.Vector3 = new THREE.Vector3();
  private lookAtVelocity: THREE.Vector3 = new THREE.Vector3();
  private fovVelocity: number = 0;
  
  // Configuration
  private smoothTime: number = 0.3; // Time to reach target (seconds)
  private minDistance: number = 12;
  private maxDistance: number = 40;
  private defaultFov: number = 50;
  
  // Active tweens for transitions
  private activeTween: Tween<THREE.Vector3> | null = null;
  private lookAtTween: Tween<THREE.Vector3> | null = null;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    
    this.currentPosition = camera.position.clone();
    this.currentLookAt = new THREE.Vector3(0, 0, 0);
    this.currentFov = camera.fov;
    
    this.targetPosition = camera.position.clone();
    this.targetLookAt = new THREE.Vector3(0, 0, 0);
    this.targetFov = camera.fov;
  }

  // ===========================================================================
  // SMOOTH DAMP (Framerate-independent smoothing)
  // ===========================================================================

  /**
   * SmoothDamp for vectors - framerate-independent exponential smoothing
   * Based on Game Programming Gems 4 smooth damp algorithm
   */
  private smoothDampVector(
    current: THREE.Vector3,
    target: THREE.Vector3,
    velocity: THREE.Vector3,
    smoothTime: number,
    delta: number,
    maxSpeed: number = Infinity
  ): THREE.Vector3 {
    smoothTime = Math.max(0.0001, smoothTime);
    const omega = 2 / smoothTime;
    
    const x = omega * delta;
    const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    
    const change = current.clone().sub(target);
    const originalTo = target.clone();
    
    // Clamp maximum speed
    const maxChange = maxSpeed * smoothTime;
    const sqrMag = change.lengthSq();
    if (sqrMag > maxChange * maxChange) {
      change.multiplyScalar(maxChange / Math.sqrt(sqrMag));
    }
    
    const newTarget = current.clone().sub(change);
    const temp = velocity.clone().add(change.clone().multiplyScalar(omega)).multiplyScalar(delta);
    velocity.copy(velocity.clone().sub(temp.clone().multiplyScalar(omega)).multiplyScalar(exp));
    
    const output = newTarget.clone().add(
      change.add(temp).multiplyScalar(exp)
    );
    
    // Prevent overshoot
    const origMinusCurrent = originalTo.clone().sub(current);
    const outMinusOrig = output.clone().sub(originalTo);
    if (origMinusCurrent.dot(outMinusOrig) > 0) {
      output.copy(originalTo);
      velocity.copy(outMinusOrig.divideScalar(delta));
    }
    
    return output;
  }

  /**
   * SmoothDamp for scalars
   */
  private smoothDampScalar(
    current: number,
    target: number,
    velocity: { value: number },
    smoothTime: number,
    delta: number,
    maxSpeed: number = Infinity
  ): number {
    smoothTime = Math.max(0.0001, smoothTime);
    const omega = 2 / smoothTime;
    
    const x = omega * delta;
    const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    
    let change = current - target;
    const originalTo = target;
    
    const maxChange = maxSpeed * smoothTime;
    change = Math.max(-maxChange, Math.min(maxChange, change));
    
    const newTarget = current - change;
    const temp = (velocity.value + omega * change) * delta;
    velocity.value = (velocity.value - omega * temp) * exp;
    
    let output = newTarget + (change + temp) * exp;
    
    // Prevent overshoot
    if ((originalTo - current > 0) === (output > originalTo)) {
      output = originalTo;
      velocity.value = (output - originalTo) / delta;
    }
    
    return output;
  }

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================

  /**
   * Set target position (smooth transition)
   */
  public setTarget(position: THREE.Vector3, lookAt?: THREE.Vector3): void {
    this.targetPosition.copy(position);
    if (lookAt) {
      this.targetLookAt.copy(lookAt);
    }
    this.activeTween = null;
    this.lookAtTween = null;
  }

  /**
   * Animated transition to target with explicit duration
   */
  public transitionTo(
    position: THREE.Vector3,
    lookAt: THREE.Vector3,
    duration: number = 1.0,
    easing: EasingFunction = Easing.easeInOutCubic
  ): void {
    this.activeTween = new Tween({
      from: this.currentPosition.clone(),
      to: position.clone(),
      duration,
      easing,
      onUpdate: (v) => {
        this.currentPosition.copy(v);
        this.targetPosition.copy(v);
      }
    });
    
    this.lookAtTween = new Tween({
      from: this.currentLookAt.clone(),
      to: lookAt.clone(),
      duration,
      easing,
      onUpdate: (v) => {
        this.currentLookAt.copy(v);
        this.targetLookAt.copy(v);
      }
    });
  }

  /**
   * Focus on a point with zoom
   */
  public focusOn(point: THREE.Vector3, distance?: number): void {
    const dir = point.clone().normalize();
    const dist = distance ?? this.currentPosition.distanceTo(this.targetLookAt);
    const clampedDist = THREE.MathUtils.clamp(dist, this.minDistance, this.maxDistance);
    
    this.transitionTo(
      dir.clone().multiplyScalar(clampedDist),
      point,
      0.8,
      Easing.easeOutCubic
    );
  }

  /**
   * Zoom by factor
   */
  public zoom(factor: number): void {
    const currentDist = this.targetPosition.distanceTo(this.targetLookAt);
    const newDist = THREE.MathUtils.clamp(
      currentDist * factor,
      this.minDistance,
      this.maxDistance
    );
    
    const dir = this.targetPosition.clone().sub(this.targetLookAt).normalize();
    this.targetPosition.copy(this.targetLookAt).addScaledVector(dir, newDist);
  }

  /**
   * Orbit around lookAt point
   */
  public orbit(deltaTheta: number, deltaPhi: number): void {
    const offset = this.targetPosition.clone().sub(this.targetLookAt);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    
    spherical.theta -= deltaTheta;
    spherical.phi = THREE.MathUtils.clamp(
      spherical.phi - deltaPhi,
      0.1,
      Math.PI - 0.1
    );
    
    offset.setFromSpherical(spherical);
    this.targetPosition.copy(this.targetLookAt).add(offset);
  }

  /**
   * Reset to default view
   */
  public reset(): void {
    this.transitionTo(
      new THREE.Vector3(0, 5, 25),
      new THREE.Vector3(0, 0, 0),
      1.0,
      Easing.easeInOutCubic
    );
  }

  /**
   * Get current state
   */
  public getState(): CameraState {
    return {
      position: this.currentPosition.clone(),
      lookAt: this.currentLookAt.clone(),
      fov: this.currentFov
    };
  }

  // ===========================================================================
  // UPDATE (call every frame)
  // ===========================================================================

  public update(delta: number): void {
    // Update active tweens first
    if (this.activeTween && !this.activeTween.isComplete) {
      this.activeTween.update(delta);
    }
    if (this.lookAtTween && !this.lookAtTween.isComplete) {
      this.lookAtTween.update(delta);
    }
    
    // If no active tween, use smooth damp
    if (!this.activeTween || this.activeTween.isComplete) {
      this.currentPosition = this.smoothDampVector(
        this.currentPosition,
        this.targetPosition,
        this.positionVelocity,
        this.smoothTime,
        delta
      );
    }
    
    if (!this.lookAtTween || this.lookAtTween.isComplete) {
      this.currentLookAt = this.smoothDampVector(
        this.currentLookAt,
        this.targetLookAt,
        this.lookAtVelocity,
        this.smoothTime,
        delta
      );
    }
    
    // FOV smooth damp
    const fovVel = { value: this.fovVelocity };
    this.currentFov = this.smoothDampScalar(
      this.currentFov,
      this.targetFov,
      fovVel,
      this.smoothTime,
      delta
    );
    this.fovVelocity = fovVel.value;
    
    // Apply to camera
    this.camera.position.copy(this.currentPosition);
    this.camera.lookAt(this.currentLookAt);
    
    if (Math.abs(this.camera.fov - this.currentFov) > 0.01) {
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }
  }

  // ===========================================================================
  // CONFIGURATION
  // ===========================================================================

  public setSmoothTime(time: number): void {
    this.smoothTime = Math.max(0.01, time);
  }

  public setDistanceLimits(min: number, max: number): void {
    this.minDistance = min;
    this.maxDistance = max;
  }
}
