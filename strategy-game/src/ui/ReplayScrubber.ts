// ============================================================================
// ASI CARTEL - Replay Scrubber
// Timeline scrubbing with snap-to-phase, reverse, fast-forward
// ============================================================================

import { GameState, GamePhase } from '../data/types';
import { Easing } from '../three/AnimationSystem';

interface PhaseMarker {
  turn: number;
  phase: GamePhase;
  position: number; // 0-1 along timeline
  label: string;
}

interface PlaybackState {
  isPlaying: boolean;
  speed: number; // 1 = normal, 2 = fast, -1 = reverse
  currentPosition: number; // 0-1
  targetPosition: number;
}

export class ReplayScrubber {
  private container: HTMLElement;
  private timeline: HTMLElement;
  private playhead: HTMLElement;
  private phaseMarkers: PhaseMarker[] = [];
  private playback: PlaybackState;
  private snapThreshold = 0.03; // Snap when within 3% of a phase marker
  
  private isDragging = false;
  private callbacks: {
    onSeek?: (turn: number, phase: GamePhase) => void;
    onPlay?: () => void;
    onPause?: () => void;
  } = {};

  constructor(parentContainer: HTMLElement) {
    this.container = this.createScrubberUI();
    this.timeline = this.container.querySelector('.scrubber-timeline')!;
    this.playhead = this.container.querySelector('.scrubber-playhead')!;
    
    this.playback = {
      isPlaying: false,
      speed: 1,
      currentPosition: 0,
      targetPosition: 0
    };
    
    parentContainer.appendChild(this.container);
    this.setupEventListeners();
  }

  private createScrubberUI(): HTMLElement {
    const scrubber = document.createElement('div');
    scrubber.className = 'replay-scrubber';
    scrubber.innerHTML = `
      <div class="scrubber-controls">
        <button class="scrubber-btn" data-action="rewind" title="Rewind">⏪</button>
        <button class="scrubber-btn" data-action="step-back" title="Previous Phase">◀</button>
        <button class="scrubber-btn play-btn" data-action="play" title="Play/Pause">▶</button>
        <button class="scrubber-btn" data-action="step-forward" title="Next Phase">▶</button>
        <button class="scrubber-btn" data-action="fastforward" title="Fast Forward">⏩</button>
      </div>
      <div class="scrubber-timeline-container">
        <div class="scrubber-timeline">
          <div class="scrubber-track"></div>
          <div class="scrubber-progress"></div>
          <div class="scrubber-playhead"></div>
          <div class="scrubber-markers"></div>
        </div>
        <div class="scrubber-labels"></div>
      </div>
      <div class="scrubber-info">
        <span class="scrubber-turn">Turn 1</span>
        <span class="scrubber-phase">PLANNING</span>
        <span class="scrubber-speed">1x</span>
      </div>
    `;
    
    this.injectStyles();
    return scrubber;
  }

  private injectStyles(): void {
    if (document.getElementById('scrubber-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'scrubber-styles';
    style.textContent = `
      .replay-scrubber {
        position: absolute;
        bottom: 60px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(5, 8, 15, 0.95);
        border: 1px solid rgba(60, 100, 150, 0.3);
        border-radius: 12px;
        padding: 12px 20px;
        display: flex;
        align-items: center;
        gap: 16px;
        backdrop-filter: blur(10px);
        z-index: 100;
        font-family: 'JetBrains Mono', monospace;
      }
      
      .scrubber-controls {
        display: flex;
        gap: 4px;
      }
      
      .scrubber-btn {
        width: 32px;
        height: 32px;
        border: 1px solid rgba(60, 100, 150, 0.3);
        border-radius: 6px;
        background: rgba(15, 20, 35, 0.8);
        color: #8899aa;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.15s ease;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      
      .scrubber-btn:hover {
        background: rgba(0, 212, 255, 0.15);
        border-color: #00d4ff;
        color: #00d4ff;
      }
      
      .scrubber-btn.active {
        background: rgba(0, 212, 255, 0.25);
        border-color: #00d4ff;
        color: #00d4ff;
      }
      
      .play-btn {
        width: 40px;
        font-size: 14px;
      }
      
      .scrubber-timeline-container {
        flex: 1;
        min-width: 300px;
      }
      
      .scrubber-timeline {
        position: relative;
        height: 24px;
        cursor: pointer;
      }
      
      .scrubber-track {
        position: absolute;
        top: 50%;
        left: 0;
        right: 0;
        height: 4px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 2px;
        transform: translateY(-50%);
      }
      
      .scrubber-progress {
        position: absolute;
        top: 50%;
        left: 0;
        height: 4px;
        background: linear-gradient(90deg, #00d4ff, #ff44aa);
        border-radius: 2px;
        transform: translateY(-50%);
        width: 0%;
        transition: width 0.1s ease;
      }
      
      .scrubber-playhead {
        position: absolute;
        top: 50%;
        left: 0%;
        width: 14px;
        height: 14px;
        background: #00d4ff;
        border: 2px solid #fff;
        border-radius: 50%;
        transform: translate(-50%, -50%);
        cursor: grab;
        transition: transform 0.1s ease, box-shadow 0.15s ease;
        box-shadow: 0 0 10px rgba(0, 212, 255, 0.5);
      }
      
      .scrubber-playhead:hover {
        transform: translate(-50%, -50%) scale(1.2);
        box-shadow: 0 0 20px rgba(0, 212, 255, 0.8);
      }
      
      .scrubber-playhead.dragging {
        cursor: grabbing;
        transform: translate(-50%, -50%) scale(1.3);
      }
      
      .scrubber-markers {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        pointer-events: none;
      }
      
      .phase-marker {
        position: absolute;
        top: 50%;
        width: 8px;
        height: 8px;
        background: rgba(255, 255, 255, 0.3);
        border-radius: 50%;
        transform: translate(-50%, -50%);
        transition: all 0.15s ease;
      }
      
      .phase-marker.active {
        background: #00d4ff;
        box-shadow: 0 0 8px rgba(0, 212, 255, 0.6);
      }
      
      .phase-marker.snap-target {
        transform: translate(-50%, -50%) scale(1.5);
        background: #ff44aa;
      }
      
      .scrubber-labels {
        display: flex;
        justify-content: space-between;
        margin-top: 4px;
        font-size: 9px;
        color: #667788;
      }
      
      .scrubber-info {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 2px;
        min-width: 80px;
      }
      
      .scrubber-turn {
        font-size: 12px;
        font-weight: 600;
        color: #e8eef5;
      }
      
      .scrubber-phase {
        font-size: 9px;
        color: #00d4ff;
        letter-spacing: 1px;
      }
      
      .scrubber-speed {
        font-size: 9px;
        color: #8899aa;
      }
      
      /* Tooltip on hover */
      .scrubber-timeline::after {
        content: attr(data-tooltip);
        position: absolute;
        bottom: 100%;
        left: var(--tooltip-x, 50%);
        transform: translateX(-50%);
        background: rgba(5, 8, 15, 0.95);
        border: 1px solid rgba(60, 100, 150, 0.3);
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 10px;
        color: #e8eef5;
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.15s ease;
      }
      
      .scrubber-timeline:hover::after {
        opacity: 1;
      }
    `;
    document.head.appendChild(style);
  }

  private setupEventListeners(): void {
    // Button controls
    this.container.querySelectorAll('.scrubber-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = (e.currentTarget as HTMLElement).dataset.action;
        this.handleControlAction(action!);
      });
    });
    
    // Timeline drag
    this.timeline.addEventListener('mousedown', this.onTimelineMouseDown.bind(this));
    document.addEventListener('mousemove', this.onTimelineMouseMove.bind(this));
    document.addEventListener('mouseup', this.onTimelineMouseUp.bind(this));
    
    // Timeline hover for tooltip
    this.timeline.addEventListener('mousemove', (e) => {
      if (this.isDragging) return;
      const rect = this.timeline.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const turn = Math.floor(x * this.getTotalTurns()) + 1;
      this.timeline.dataset.tooltip = `Turn ${turn}`;
      this.timeline.style.setProperty('--tooltip-x', `${x * 100}%`);
    });
  }

  private handleControlAction(action: string): void {
    switch (action) {
      case 'rewind':
        this.seekToPosition(0);
        break;
      case 'step-back':
        this.stepToPhase(-1);
        break;
      case 'play':
        this.togglePlayback();
        break;
      case 'step-forward':
        this.stepToPhase(1);
        break;
      case 'fastforward':
        this.cycleSpeed();
        break;
    }
  }

  private onTimelineMouseDown(e: MouseEvent): void {
    this.isDragging = true;
    this.playhead.classList.add('dragging');
    this.seekToMouse(e);
  }

  private onTimelineMouseMove(e: MouseEvent): void {
    if (!this.isDragging) return;
    this.seekToMouse(e);
  }

  private onTimelineMouseUp(): void {
    if (!this.isDragging) return;
    this.isDragging = false;
    this.playhead.classList.remove('dragging');
    
    // Snap to nearest phase if close
    this.snapToNearestPhase();
  }

  private seekToMouse(e: MouseEvent): void {
    const rect = this.timeline.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    this.seekToPosition(x);
  }

  private seekToPosition(position: number): void {
    this.playback.currentPosition = position;
    this.playback.targetPosition = position;
    this.updateUI();
    
    // Calculate turn and phase from position
    const { turn, phase } = this.positionToTurnPhase(position);
    
    if (this.callbacks.onSeek) {
      this.callbacks.onSeek(turn, phase);
    }
  }

  private snapToNearestPhase(): void {
    const markers = this.phaseMarkers;
    let nearestMarker: PhaseMarker | null = null;
    let nearestDist = Infinity;
    
    for (const marker of markers) {
      const dist = Math.abs(marker.position - this.playback.currentPosition);
      if (dist < this.snapThreshold && dist < nearestDist) {
        nearestDist = dist;
        nearestMarker = marker;
      }
    }
    
    if (nearestMarker) {
      this.seekToPosition(nearestMarker.position);
    }
  }

  private stepToPhase(direction: number): void {
    const markers = this.phaseMarkers;
    const currentPos = this.playback.currentPosition;
    
    // Find current marker index
    let currentIndex = -1;
    for (let i = 0; i < markers.length; i++) {
      if (Math.abs(markers[i].position - currentPos) < 0.01) {
        currentIndex = i;
        break;
      }
    }
    
    // Move to next/previous
    const targetIndex = Math.max(0, Math.min(markers.length - 1, 
      currentIndex === -1 ? (direction > 0 ? 0 : markers.length - 1) : currentIndex + direction
    ));
    
    if (markers[targetIndex]) {
      this.animateToPosition(markers[targetIndex].position);
    }
  }

  private animateToPosition(target: number): void {
    const start = this.playback.currentPosition;
    const duration = 300; // ms
    const startTime = performance.now();
    
    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      const eased = Easing.easeOutCubic(progress);
      
      this.playback.currentPosition = start + (target - start) * eased;
      this.updateUI();
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        const { turn, phase } = this.positionToTurnPhase(target);
        if (this.callbacks.onSeek) {
          this.callbacks.onSeek(turn, phase);
        }
      }
    };
    
    requestAnimationFrame(animate);
  }

  private togglePlayback(): void {
    this.playback.isPlaying = !this.playback.isPlaying;
    
    const playBtn = this.container.querySelector('.play-btn')!;
    playBtn.textContent = this.playback.isPlaying ? '⏸' : '▶';
    playBtn.classList.toggle('active', this.playback.isPlaying);
    
    if (this.playback.isPlaying) {
      if (this.callbacks.onPlay) this.callbacks.onPlay();
      this.runPlayback();
    } else {
      if (this.callbacks.onPause) this.callbacks.onPause();
    }
  }

  private cycleSpeed(): void {
    const speeds = [1, 2, 4, -1];
    const currentIndex = speeds.indexOf(this.playback.speed);
    this.playback.speed = speeds[(currentIndex + 1) % speeds.length];
    this.updateSpeedDisplay();
  }

  private runPlayback(): void {
    if (!this.playback.isPlaying) return;
    
    const step = 0.002 * this.playback.speed;
    this.playback.currentPosition = Math.max(0, Math.min(1, 
      this.playback.currentPosition + step
    ));
    
    this.updateUI();
    
    // Check if we've hit a phase marker
    const { turn, phase } = this.positionToTurnPhase(this.playback.currentPosition);
    if (this.callbacks.onSeek) {
      this.callbacks.onSeek(turn, phase);
    }
    
    // Stop at end
    if (this.playback.currentPosition >= 1 || this.playback.currentPosition <= 0) {
      this.playback.isPlaying = false;
      const playBtn = this.container.querySelector('.play-btn')!;
      playBtn.textContent = '▶';
      playBtn.classList.remove('active');
      return;
    }
    
    requestAnimationFrame(() => this.runPlayback());
  }

  // =========================================================================
  // PUBLIC API
  // =========================================================================

  /**
   * Update scrubber with current game state
   */
  public syncWithGameState(state: GameState): void {
    // Rebuild phase markers from turn history
    this.phaseMarkers = [];
    const totalTurns = Math.max(state.turn, state.turnHistory.length + 1);
    
    for (let t = 1; t <= totalTurns; t++) {
      const position = (t - 1) / Math.max(1, totalTurns - 1);
      this.phaseMarkers.push({
        turn: t,
        phase: 'PLANNING',
        position,
        label: `T${t}`
      });
    }
    
    // Current position based on current turn
    this.playback.currentPosition = (state.turn - 1) / Math.max(1, totalTurns - 1);
    
    this.renderPhaseMarkers();
    this.updateUI();
  }

  /**
   * Set callback handlers
   */
  public onSeek(callback: (turn: number, phase: GamePhase) => void): void {
    this.callbacks.onSeek = callback;
  }

  public onPlay(callback: () => void): void {
    this.callbacks.onPlay = callback;
  }

  public onPause(callback: () => void): void {
    this.callbacks.onPause = callback;
  }

  // =========================================================================
  // PRIVATE HELPERS
  // =========================================================================

  private getTotalTurns(): number {
    return Math.max(1, this.phaseMarkers.length);
  }

  private positionToTurnPhase(position: number): { turn: number; phase: GamePhase } {
    const totalTurns = this.getTotalTurns();
    const turn = Math.max(1, Math.min(totalTurns, Math.floor(position * totalTurns) + 1));
    return { turn, phase: 'PLANNING' };
  }

  private renderPhaseMarkers(): void {
    const markersContainer = this.container.querySelector('.scrubber-markers')!;
    const labelsContainer = this.container.querySelector('.scrubber-labels')!;
    
    markersContainer.innerHTML = '';
    labelsContainer.innerHTML = '';
    
    for (const marker of this.phaseMarkers) {
      // Marker dot
      const dot = document.createElement('div');
      dot.className = 'phase-marker';
      dot.style.left = `${marker.position * 100}%`;
      markersContainer.appendChild(dot);
    }
    
    // Labels (only show a subset to avoid crowding)
    const labelInterval = Math.ceil(this.phaseMarkers.length / 10);
    for (let i = 0; i < this.phaseMarkers.length; i += labelInterval) {
      const marker = this.phaseMarkers[i];
      const label = document.createElement('span');
      label.textContent = marker.label;
      label.style.position = 'absolute';
      label.style.left = `${marker.position * 100}%`;
      label.style.transform = 'translateX(-50%)';
      labelsContainer.appendChild(label);
    }
  }

  private updateUI(): void {
    // Update playhead position
    const pct = this.playback.currentPosition * 100;
    this.playhead.style.left = `${pct}%`;
    
    // Update progress bar
    const progress = this.container.querySelector('.scrubber-progress') as HTMLElement;
    progress.style.width = `${pct}%`;
    
    // Update info display
    const { turn, phase } = this.positionToTurnPhase(this.playback.currentPosition);
    const turnEl = this.container.querySelector('.scrubber-turn')!;
    const phaseEl = this.container.querySelector('.scrubber-phase')!;
    turnEl.textContent = `Turn ${turn}`;
    phaseEl.textContent = phase;
    
    // Highlight active marker
    const markers = this.container.querySelectorAll('.phase-marker');
    markers.forEach((marker, i) => {
      const isActive = Math.abs(this.phaseMarkers[i].position - this.playback.currentPosition) < 0.01;
      marker.classList.toggle('active', isActive);
    });
  }

  private updateSpeedDisplay(): void {
    const speedEl = this.container.querySelector('.scrubber-speed')!;
    const speed = this.playback.speed;
    speedEl.textContent = speed === -1 ? '⏪ REV' : `${speed}x`;
  }
}
