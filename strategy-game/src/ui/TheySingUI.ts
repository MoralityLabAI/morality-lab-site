// ============================================================================
// THEY SING - UI Manager
// Phase-based strategy game interface
// ============================================================================

import { TheySingEngine } from '../engine/TheySingEngine';
import { FACTIONS, UNIT_STATS, getDoctrineAffinityTier } from '../engine/gameData';
import { 
  GameState, GamePhase, FactionId, Unit, Order, OrderType,
  UnitType, Vector, GameEvent
} from '../engine/types';
import { FlatMapScene } from '../three/FlatMapScene';
import { TechTreeScene } from '../three/TechTreeScene';

// ============================================================================
// UI MANAGER CLASS
// ============================================================================

export class TheySingUI {
  private container: HTMLElement;
  private engine: TheySingEngine;
  private scene: FlatMapScene;
  private techTree: TechTreeScene | null = null;
  private currentFaction: FactionId = 'HEGEMON';
  
  // UI Elements
  private hudPanel!: HTMLElement;
  private phasePanel!: HTMLElement;
  private detailsPanel!: HTMLElement;
  private ordersPanel!: HTMLElement;
  private logPanel!: HTMLElement;
  private modalOverlay!: HTMLElement;
  private tutorialOverlay!: HTMLElement;
  private narratorPanel!: HTMLElement;
  
  // Order building state
  private pendingOrders: Order[] = [];
  private orderMode: OrderType | null = null;
  private tutorialStepIndex = 0;
  private narratorResetTimer: number | null = null;
  private narratorSuppressedUntil = 0;

  constructor(container: HTMLElement, engine: TheySingEngine, scene: FlatMapScene) {
    this.container = container;
    this.engine = engine;
    this.scene = scene;
    
    this.injectStyles();
    this.createUI();
    this.bindEvents();
    this.updateAll();
    this.primeNarrator();
    this.maybeShowTutorialOnFirstRun();
  }

  // ==========================================================================
  // STYLES
  // ==========================================================================

  private injectStyles(): void {
    if (document.getElementById('theysing-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'theysing-styles';
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&family=JetBrains+Mono:wght@400;500&display=swap');
      
      .ts-ui {
        font-family: 'JetBrains Mono', monospace;
        color: #e0e0e0;
        font-size: 13px;
        pointer-events: none;
      }
      
      .ts-ui * {
        box-sizing: border-box;
      }
      
      .ts-panel {
        background: rgba(10, 15, 25, 0.92);
        border: 1px solid rgba(60, 120, 180, 0.4);
        border-radius: 4px;
        padding: 12px;
        pointer-events: auto;
        backdrop-filter: blur(8px);
      }
      
      .ts-header {
        font-family: 'Orbitron', sans-serif;
        font-size: 11px;
        color: #4488cc;
        text-transform: uppercase;
        letter-spacing: 2px;
        margin-bottom: 10px;
        padding-bottom: 6px;
        border-bottom: 1px solid rgba(60, 120, 180, 0.3);
      }
      
      /* HUD Panel */
      .ts-hud {
        position: absolute;
        top: 10px;
        left: 10px;
        width: 330px;
        max-height: calc(100vh - 20px);
        overflow-y: auto;
      }
      
      .ts-faction-name {
        font-family: 'Orbitron', sans-serif;
        font-size: 16px;
        font-weight: 700;
        margin-bottom: 8px;
      }
      
      .ts-resources {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 8px;
        margin-bottom: 12px;
      }
      
      .ts-resource {
        background: rgba(0, 0, 0, 0.3);
        padding: 8px;
        border-radius: 3px;
      }
      
      .ts-resource-label {
        font-size: 10px;
        color: #888;
        text-transform: uppercase;
      }
      
      .ts-resource-value {
        font-size: 18px;
        font-weight: 700;
      }
      
      .ts-resource.flops .ts-resource-value { color: #44ff88; }
      .ts-resource.influence .ts-resource-value { color: #ff88ff; }
      
      /* Global Counters */
      .ts-counters {
        margin-top: 10px;
      }
      
      .ts-counter {
        margin-bottom: 8px;
      }
      
      .ts-counter-header {
        display: flex;
        justify-content: space-between;
        margin-bottom: 3px;
        font-size: 11px;
      }
      
      .ts-counter-bar {
        height: 6px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 3px;
        overflow: hidden;
      }
      
      .ts-counter-fill {
        height: 100%;
        transition: width 0.5s ease, background-color 0.3s ease;
      }
      
      .ts-counter.tas .ts-counter-fill {
        background: linear-gradient(90deg, #44ff88, #ffaa00, #ff4444);
      }
      
      .ts-counter.kessler .ts-counter-fill {
        background: linear-gradient(90deg, #4488ff, #ff4488, #ff0000);
      }

      .ts-pressure-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 8px;
        margin-top: 10px;
      }

      .ts-pressure-card {
        background: rgba(0, 0, 0, 0.28);
        border: 1px solid rgba(80, 120, 170, 0.2);
        border-radius: 4px;
        padding: 8px;
      }

      .ts-pressure-top {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: 4px;
      }

      .ts-pressure-label {
        font-size: 10px;
        color: #93a6ba;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .ts-pressure-value {
        font-size: 14px;
        font-weight: 700;
      }

      .ts-pressure-bar {
        height: 5px;
        border-radius: 999px;
        overflow: hidden;
        background: rgba(255, 255, 255, 0.08);
      }

      .ts-pressure-fill {
        height: 100%;
        transition: width 0.4s ease;
      }

      .ts-pressure-card.memetic .ts-pressure-value { color: #ff7bc9; }
      .ts-pressure-card.memetic .ts-pressure-fill { background: linear-gradient(90deg, #9f4d8a, #ff7bc9); }
      .ts-pressure-card.cyber .ts-pressure-value { color: #67e8ff; }
      .ts-pressure-card.cyber .ts-pressure-fill { background: linear-gradient(90deg, #236b8e, #67e8ff); }
      .ts-pressure-card.industry .ts-pressure-value { color: #ffcb6b; }
      .ts-pressure-card.industry .ts-pressure-fill { background: linear-gradient(90deg, #8b5a17, #ffcb6b); }
      .ts-pressure-card.orbital .ts-pressure-value { color: #9bb4ff; }
      .ts-pressure-card.orbital .ts-pressure-fill { background: linear-gradient(90deg, #31498a, #9bb4ff); }

      .ts-power-bands {
        display: grid;
        gap: 8px;
        margin-top: 10px;
      }

      .ts-power-band {
        background: rgba(0, 0, 0, 0.3);
        border-left: 3px solid rgba(255, 255, 255, 0.25);
        border-radius: 3px;
        padding: 8px 10px;
      }

      .ts-power-band.KINETIC { border-left-color: #ff6666; }
      .ts-power-band.INFO { border-left-color: #58c4ff; }
      .ts-power-band.LOGIC { border-left-color: #ffc658; }
      .ts-power-band.MEMETIC { border-left-color: #ff66cc; }

      .ts-power-band-title {
        font-size: 11px;
        font-weight: 700;
        color: #d9ebff;
        margin-bottom: 3px;
      }

      .ts-power-band-effect {
        color: #93a6ba;
        font-size: 10px;
        line-height: 1.45;
      }

      .ts-power-band-empty {
        color: #6f8397;
        font-size: 11px;
        line-height: 1.45;
      }

      .ts-doctrines {
        display: grid;
        gap: 8px;
        margin-top: 10px;
      }

      .ts-doctrine-alignment {
        color: #ffe7a8;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .ts-doctrine {
        background: rgba(155, 180, 255, 0.08);
        border-left: 3px solid #9bb4ff;
        border-radius: 3px;
        padding: 8px 10px;
      }

      .ts-doctrine-title {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        font-weight: 700;
        color: #d9ebff;
        margin-bottom: 3px;
      }

      .ts-doctrine-affinity {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 1px 6px;
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: #081019;
      }

      .ts-doctrine-affinity.native {
        background: #b5f0c7;
      }

      .ts-doctrine-affinity.adjacent {
        background: #ffe4a8;
      }

      .ts-doctrine-affinity.wild {
        background: #f5b8ff;
      }

      .ts-doctrine-effect {
        color: #93a6ba;
        font-size: 10px;
        line-height: 1.45;
      }

      .ts-doctrine-empty {
        color: #6f8397;
        font-size: 11px;
        line-height: 1.45;
      }

      .ts-powerbase-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 8px;
        margin-top: 10px;
      }

      .ts-powerbase-card {
        background: rgba(0, 0, 0, 0.28);
        border: 1px solid rgba(80, 120, 170, 0.2);
        border-radius: 4px;
        padding: 8px;
      }

      .ts-powerbase-label {
        font-size: 10px;
        color: #93a6ba;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        margin-bottom: 4px;
      }

      .ts-powerbase-value {
        font-size: 15px;
        font-weight: 700;
        color: #d9ebff;
      }
      
      /* Phase Panel */
      .ts-phase {
        position: absolute;
        top: 10px;
        left: 50%;
        transform: translateX(-50%);
        text-align: center;
        min-width: 300px;
      }
      
      .ts-turn {
        font-family: 'Orbitron', sans-serif;
        font-size: 12px;
        color: #888;
        margin-bottom: 4px;
      }
      
      .ts-phase-name {
        font-family: 'Orbitron', sans-serif;
        font-size: 20px;
        font-weight: 700;
        color: #4488ff;
        margin-bottom: 8px;
      }
      
      .ts-phase-steps {
        display: flex;
        justify-content: center;
        gap: 4px;
        margin-bottom: 10px;
      }
      
      .ts-phase-step {
        width: 50px;
        height: 4px;
        background: rgba(255, 255, 255, 0.2);
        border-radius: 2px;
      }
      
      .ts-phase-step.active {
        background: #4488ff;
      }
      
      .ts-phase-step.complete {
        background: #44ff88;
      }
      
      .ts-advance-btn {
        background: linear-gradient(135deg, #2255aa, #3366cc);
        border: 1px solid #4488ff;
        color: white;
        padding: 8px 20px;
        font-family: 'Orbitron', sans-serif;
        font-size: 12px;
        cursor: pointer;
        border-radius: 4px;
        transition: all 0.2s ease;
      }
      
      .ts-advance-btn:hover {
        background: linear-gradient(135deg, #3366cc, #4488ff);
        transform: translateY(-1px);
      }
      
      .ts-advance-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      
      /* Details Panel */
      .ts-details {
        position: absolute;
        top: 10px;
        right: 10px;
        width: 260px;
      }
      
      .ts-detail-section {
        margin-bottom: 10px;
      }
      
      .ts-detail-title {
        font-family: 'Orbitron', sans-serif;
        font-size: 14px;
        margin-bottom: 6px;
      }
      
      .ts-detail-row {
        display: flex;
        justify-content: space-between;
        padding: 4px 0;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      }
      
      .ts-detail-label {
        color: #888;
      }
      
      .ts-unit-list {
        max-height: 150px;
        overflow-y: auto;
      }
      
      .ts-unit-item {
        display: flex;
        align-items: center;
        padding: 6px;
        margin-bottom: 4px;
        background: rgba(0, 0, 0, 0.3);
        border-radius: 3px;
        cursor: pointer;
        transition: background 0.2s ease;
      }
      
      .ts-unit-item:hover {
        background: rgba(60, 120, 180, 0.3);
      }
      
      .ts-unit-item.selected {
        border: 1px solid #4488ff;
      }
      
      .ts-unit-icon {
        width: 24px;
        height: 24px;
        border-radius: 3px;
        margin-right: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
      }
      
      .ts-unit-info {
        flex: 1;
      }
      
      .ts-unit-type {
        font-size: 12px;
        font-weight: 500;
      }
      
      .ts-unit-location {
        font-size: 10px;
        color: #888;
      }
      
      /* Orders Panel */
      .ts-orders {
        position: absolute;
        bottom: 10px;
        left: 10px;
        width: 400px;
      }
      
      .ts-order-buttons {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 10px;
      }
      
      .ts-order-btn {
        padding: 6px 12px;
        background: rgba(40, 60, 80, 0.8);
        border: 1px solid rgba(60, 120, 180, 0.4);
        color: #ccc;
        font-family: 'JetBrains Mono', monospace;
        font-size: 11px;
        cursor: pointer;
        border-radius: 3px;
        transition: all 0.2s ease;
      }
      
      .ts-order-btn:hover {
        background: rgba(60, 100, 140, 0.8);
        border-color: #4488ff;
      }
      
      .ts-order-btn.active {
        background: #3366aa;
        border-color: #4488ff;
        color: white;
      }
      
      .ts-order-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
      
      .ts-pending-orders {
        max-height: 120px;
        overflow-y: auto;
      }
      
      .ts-pending-order {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 8px;
        background: rgba(0, 50, 80, 0.5);
        border-radius: 3px;
        margin-bottom: 4px;
        font-size: 11px;
      }
      
      .ts-pending-order .remove {
        color: #ff6666;
        cursor: pointer;
        padding: 0 4px;
      }
      
      .ts-submit-orders {
        margin-top: 10px;
        width: 100%;
        padding: 10px;
        background: linear-gradient(135deg, #227744, #33aa66);
        border: 1px solid #44ff88;
        color: white;
        font-family: 'Orbitron', sans-serif;
        font-size: 12px;
        cursor: pointer;
        border-radius: 4px;
      }
      
      .ts-submit-orders:hover {
        background: linear-gradient(135deg, #33aa66, #44cc88);
      }
      
      .ts-submit-orders:disabled {
        opacity: 0.4;
        background: #444;
        border-color: #666;
        cursor: not-allowed;
      }
      
      /* Log Panel */
      .ts-log {
        position: absolute;
        bottom: 10px;
        right: 10px;
        width: 320px;
        max-height: 200px;
      }
      
      .ts-log-entries {
        max-height: 160px;
        overflow-y: auto;
        font-size: 11px;
      }
      
      .ts-log-entry {
        padding: 4px 0;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      }
      
      .ts-log-entry.COMBAT { color: #ff6666; }
      .ts-log-entry.ALERT { color: #ffaa44; }
      .ts-log-entry.SYSTEM { color: #4488ff; }
      
      .ts-log-turn {
        color: #666;
        margin-right: 6px;
      }
      
      /* Modal */
      .ts-modal-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: auto;
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.3s ease;
      }
      
      .ts-modal-overlay.visible {
        opacity: 1;
        visibility: visible;
      }
      
      .ts-modal {
        background: rgba(15, 25, 40, 0.98);
        border: 2px solid #4488ff;
        border-radius: 8px;
        padding: 24px;
        max-width: 500px;
        text-align: center;
      }
      
      .ts-modal-title {
        font-family: 'Orbitron', sans-serif;
        font-size: 24px;
        margin-bottom: 16px;
      }
      
      .ts-modal-content {
        margin-bottom: 20px;
        line-height: 1.6;
      }
      
      .ts-modal-buttons {
        display: flex;
        gap: 10px;
        justify-content: center;
      }
      
      .ts-modal-btn {
        padding: 10px 24px;
        border-radius: 4px;
        font-family: 'Orbitron', sans-serif;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .ts-panel.ts-tutorial-anchor {
        position: relative;
        box-shadow: 0 0 0 2px rgba(143, 206, 255, 0.9), 0 0 28px rgba(76, 145, 255, 0.35);
      }

      .ts-panel.ts-tutorial-anchor::after {
        content: 'Tutorial focus';
        position: absolute;
        top: -11px;
        right: 10px;
        background: #9fd2ff;
        color: #07111d;
        font-size: 10px;
        font-weight: 700;
        padding: 2px 8px;
        border-radius: 999px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .ts-tutorial-overlay {
        position: absolute;
        inset: 0;
        pointer-events: auto;
        display: flex;
        align-items: center;
        justify-content: center;
        background:
          radial-gradient(circle at top, rgba(84, 141, 255, 0.18), transparent 38%),
          rgba(4, 7, 13, 0.82);
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.25s ease;
        z-index: 25;
      }

      .ts-tutorial-overlay.visible {
        opacity: 1;
        visibility: visible;
      }

      .ts-tutorial-card {
        width: min(640px, calc(100vw - 32px));
        background: linear-gradient(180deg, rgba(12, 20, 34, 0.98), rgba(7, 12, 20, 0.98));
        border: 1px solid rgba(130, 180, 255, 0.5);
        border-radius: 16px;
        padding: 24px 24px 20px;
        box-shadow: 0 18px 80px rgba(0, 0, 0, 0.45);
      }

      .ts-tutorial-top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 18px;
      }

      .ts-tutorial-kicker {
        font-size: 11px;
        color: #9fd2ff;
        text-transform: uppercase;
        letter-spacing: 0.16em;
        margin-bottom: 8px;
      }

      .ts-tutorial-title {
        font-family: 'Orbitron', sans-serif;
        font-size: 28px;
        line-height: 1.1;
        color: #f2f6ff;
      }

      .ts-tutorial-skip {
        border: 1px solid rgba(255, 210, 120, 0.8);
        background: linear-gradient(135deg, #5c3f14, #c98a27);
        color: #fff8e8;
        padding: 10px 16px;
        border-radius: 999px;
        font-family: 'Orbitron', sans-serif;
        font-size: 12px;
        letter-spacing: 0.08em;
        cursor: pointer;
        flex-shrink: 0;
      }

      .ts-tutorial-body {
        color: #d2deef;
        font-size: 14px;
        line-height: 1.7;
        margin-bottom: 14px;
      }

      .ts-tutorial-tip {
        margin-bottom: 18px;
        padding: 12px 14px;
        border-radius: 10px;
        background: rgba(76, 145, 255, 0.12);
        border: 1px solid rgba(76, 145, 255, 0.25);
        color: #bcd7ff;
        font-size: 12px;
        line-height: 1.6;
      }

      .ts-tutorial-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
      }

      .ts-tutorial-progress {
        display: flex;
        gap: 8px;
      }

      .ts-tutorial-dot {
        width: 11px;
        height: 11px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.16);
      }

      .ts-tutorial-dot.active {
        background: #9fd2ff;
        box-shadow: 0 0 14px rgba(159, 210, 255, 0.65);
      }

      .ts-tutorial-actions {
        display: flex;
        gap: 10px;
      }

      .ts-tutorial-btn {
        border-radius: 10px;
        padding: 11px 16px;
        font-family: 'Orbitron', sans-serif;
        font-size: 12px;
        cursor: pointer;
        border: 1px solid rgba(154, 180, 220, 0.35);
        color: #e4ecfa;
        background: rgba(22, 30, 45, 0.92);
      }

      .ts-tutorial-btn.primary {
        background: linear-gradient(135deg, #2159a3, #4b9bff);
        border-color: rgba(126, 185, 255, 0.8);
      }

      .ts-observer {
        position: absolute;
        left: 50%;
        bottom: 18px;
        transform: translateX(-50%);
        width: min(520px, calc(100vw - 380px));
        min-width: 320px;
        padding: 14px 16px;
        border-radius: 14px;
        border: 1px solid rgba(180, 211, 255, 0.35);
        background: linear-gradient(180deg, rgba(11, 18, 32, 0.96), rgba(7, 12, 22, 0.92));
        box-shadow: 0 10px 32px rgba(0, 0, 0, 0.35);
        pointer-events: auto;
      }

      .ts-observer-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 8px;
      }

      .ts-observer-voice {
        color: #dce9ff;
        font-family: 'Orbitron', sans-serif;
        font-size: 12px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }

      .ts-observer-tone {
        color: #91a8c7;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .ts-observer-line {
        color: #eff5ff;
        font-size: 14px;
        line-height: 1.55;
      }

      .ts-phase-tools {
        display: flex;
        justify-content: center;
        gap: 8px;
        margin-top: 10px;
      }

      .ts-phase-tool {
        border-radius: 999px;
        border: 1px solid rgba(109, 157, 226, 0.4);
        background: rgba(16, 25, 39, 0.9);
        color: #d8e6ff;
        font-size: 10px;
        padding: 6px 10px;
        cursor: pointer;
        font-family: 'Orbitron', sans-serif;
        letter-spacing: 0.06em;
      }
      
      /* Tech display */
      .ts-tech-levels {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 4px;
        margin-top: 8px;
      }
      
      .ts-tech {
        text-align: center;
        padding: 4px;
        background: rgba(0, 0, 0, 0.3);
        border-radius: 3px;
        font-size: 10px;
      }
      
      .ts-tech-label { color: #888; }
      .ts-tech-level { 
        font-size: 14px; 
        font-weight: 700;
        margin-top: 2px;
      }
      
      .ts-tech.KINETIC .ts-tech-level { color: #ff6666; }
      .ts-tech.INFO .ts-tech-level { color: #66ff66; }
      .ts-tech.LOGIC .ts-tech-level { color: #6666ff; }
      .ts-tech.MEMETIC .ts-tech-level { color: #ff66ff; }
      
      /* Scrollbar */
      .ts-ui ::-webkit-scrollbar {
        width: 6px;
      }
      .ts-ui ::-webkit-scrollbar-track {
        background: rgba(0, 0, 0, 0.3);
      }
      .ts-ui ::-webkit-scrollbar-thumb {
        background: #4488ff;
        border-radius: 3px;
      }
    `;
    document.head.appendChild(style);
  }

  // ==========================================================================
  // UI CREATION
  // ==========================================================================

  private createUI(): void {
    const wrapper = document.createElement('div');
    wrapper.className = 'ts-ui';
    wrapper.style.cssText = 'position: absolute; top: 0; left: 0; right: 0; bottom: 0;';
    
    this.hudPanel = this.createHUDPanel();
    this.phasePanel = this.createPhasePanel();
    this.detailsPanel = this.createDetailsPanel();
    this.ordersPanel = this.createOrdersPanel();
    this.logPanel = this.createLogPanel();
    this.modalOverlay = this.createModalOverlay();
    this.tutorialOverlay = this.createTutorialOverlay();
    this.narratorPanel = this.createNarratorPanel();
    
    wrapper.appendChild(this.hudPanel);
    wrapper.appendChild(this.phasePanel);
    wrapper.appendChild(this.detailsPanel);
    wrapper.appendChild(this.ordersPanel);
    wrapper.appendChild(this.narratorPanel);
    wrapper.appendChild(this.logPanel);
    wrapper.appendChild(this.modalOverlay);
    wrapper.appendChild(this.tutorialOverlay);
    
    this.container.appendChild(wrapper);
  }

  private createHUDPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'ts-panel ts-hud';
    panel.innerHTML = `
      <div class="ts-faction-name"></div>
      <div class="ts-resources">
        <div class="ts-resource flops">
          <div class="ts-resource-label">FLOPs</div>
          <div class="ts-resource-value">0</div>
        </div>
        <div class="ts-resource influence">
          <div class="ts-resource-label">Influence</div>
          <div class="ts-resource-value">0</div>
        </div>
      </div>
      <div class="ts-header">Tech Levels</div>
      <div class="ts-tech-levels">
        <div class="ts-tech KINETIC"><div class="ts-tech-label">KIN</div><div class="ts-tech-level">0</div></div>
        <div class="ts-tech INFO"><div class="ts-tech-label">INF</div><div class="ts-tech-level">0</div></div>
        <div class="ts-tech LOGIC"><div class="ts-tech-label">LOG</div><div class="ts-tech-level">0</div></div>
        <div class="ts-tech MEMETIC"><div class="ts-tech-label">MEM</div><div class="ts-tech-level">0</div></div>
      </div>
      <div class="ts-counters">
        <div class="ts-counter tas">
          <div class="ts-counter-header">
            <span>TAS (Thermal Anomaly)</span>
            <span class="ts-counter-value">0/100</span>
          </div>
          <div class="ts-counter-bar"><div class="ts-counter-fill" style="width: 0%"></div></div>
        </div>
        <div class="ts-counter kessler">
          <div class="ts-counter-header">
            <span>Kessler Risk</span>
            <span class="ts-counter-value">0/100</span>
          </div>
          <div class="ts-counter-bar"><div class="ts-counter-fill" style="width: 0%"></div></div>
        </div>
      </div>
      <div class="ts-header" style="margin-top: 14px;">World Pressure</div>
      <div class="ts-pressure-grid">
        <div class="ts-pressure-card memetic" data-pressure="memetic">
          <div class="ts-pressure-top">
            <span class="ts-pressure-label">Memetic</span>
            <span class="ts-pressure-value">0</span>
          </div>
          <div class="ts-pressure-bar"><div class="ts-pressure-fill" style="width: 0%"></div></div>
        </div>
        <div class="ts-pressure-card cyber" data-pressure="cyber">
          <div class="ts-pressure-top">
            <span class="ts-pressure-label">Cyber</span>
            <span class="ts-pressure-value">0</span>
          </div>
          <div class="ts-pressure-bar"><div class="ts-pressure-fill" style="width: 0%"></div></div>
        </div>
        <div class="ts-pressure-card industry" data-pressure="industry">
          <div class="ts-pressure-top">
            <span class="ts-pressure-label">Industry</span>
            <span class="ts-pressure-value">0</span>
          </div>
          <div class="ts-pressure-bar"><div class="ts-pressure-fill" style="width: 0%"></div></div>
        </div>
        <div class="ts-pressure-card orbital" data-pressure="orbital">
          <div class="ts-pressure-top">
            <span class="ts-pressure-label">Orbital</span>
            <span class="ts-pressure-value">0</span>
          </div>
          <div class="ts-pressure-bar"><div class="ts-pressure-fill" style="width: 0%"></div></div>
        </div>
      </div>
      <div class="ts-header" style="margin-top: 14px;">Power Base</div>
      <div class="ts-powerbase-grid">
        <div class="ts-powerbase-card" data-powerbase="humanMesh">
          <div class="ts-powerbase-label">Human Mesh</div>
          <div class="ts-powerbase-value">0</div>
        </div>
        <div class="ts-powerbase-card" data-powerbase="machineMesh">
          <div class="ts-powerbase-label">Machine Mesh</div>
          <div class="ts-powerbase-value">0</div>
        </div>
        <div class="ts-powerbase-card" data-powerbase="coherence">
          <div class="ts-powerbase-label">Coherence</div>
          <div class="ts-powerbase-value">0</div>
        </div>
        <div class="ts-powerbase-card" data-powerbase="legibility">
          <div class="ts-powerbase-label">Legibility</div>
          <div class="ts-powerbase-value">0</div>
        </div>
      </div>
      <div class="ts-header" style="margin-top: 14px;">Power Bands</div>
      <div class="ts-power-bands">
        <div class="ts-power-band-empty">Reach level 2 and 3 research bands to surface doctrine shifts here.</div>
      </div>
      <div class="ts-header" style="margin-top: 14px;">Doctrines</div>
      <div class="ts-doctrines">
        <div class="ts-doctrine-empty">Cross-track doctrine unlocks will surface here once your research stack starts braiding.</div>
      </div>
    `;
    return panel;
  }

  private createPhasePanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'ts-panel ts-phase';
    panel.innerHTML = `
      <div class="ts-turn">TURN 1</div>
      <div class="ts-phase-name">NEGOTIATION</div>
      <div class="ts-phase-steps">
        <div class="ts-phase-step active" data-phase="NEGOTIATION"></div>
        <div class="ts-phase-step" data-phase="ALLOCATION"></div>
        <div class="ts-phase-step" data-phase="ACTION_DECLARATION"></div>
        <div class="ts-phase-step" data-phase="RESOLUTION"></div>
        <div class="ts-phase-step" data-phase="TURN_END"></div>
      </div>
      <button class="ts-advance-btn">ADVANCE PHASE</button>
      <div class="ts-phase-tools">
        <button class="ts-phase-tool" data-tool="tutorial">TUTORIAL</button>
        <button class="ts-phase-tool" data-tool="reset-camera">RESET CAM</button>
      </div>
    `;
    return panel;
  }

  private createDetailsPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'ts-panel ts-details';
    panel.innerHTML = `
      <div class="ts-header">Selection</div>
      <div class="ts-detail-content">
        <p style="color: #666; font-style: italic;">Click a node or unit to view details</p>
      </div>
      <div class="ts-header" style="margin-top: 16px;">Your Units</div>
      <div class="ts-unit-list"></div>
    `;
    return panel;
  }

  private createOrdersPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'ts-panel ts-orders';
    panel.innerHTML = `
      <div class="ts-header">Orders</div>
      <div class="ts-order-buttons"></div>
      <div class="ts-header" style="margin-top: 10px;">Pending Orders</div>
      <div class="ts-pending-orders"></div>
      <button class="ts-submit-orders" disabled>SUBMIT ORDERS (0)</button>
    `;
    return panel;
  }

  private createLogPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'ts-panel ts-log';
    panel.innerHTML = `
      <div class="ts-header">Event Log</div>
      <div class="ts-log-entries"></div>
    `;
    return panel;
  }

  private createTutorialOverlay(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'ts-tutorial-overlay';
    overlay.innerHTML = `
      <div class="ts-tutorial-card">
        <div class="ts-tutorial-top">
          <div>
            <div class="ts-tutorial-kicker">New Player Briefing</div>
            <div class="ts-tutorial-title"></div>
          </div>
          <button class="ts-tutorial-skip">SKIP TUTORIAL</button>
        </div>
        <div class="ts-tutorial-body"></div>
        <div class="ts-tutorial-tip"></div>
        <div class="ts-tutorial-footer">
          <div class="ts-tutorial-progress"></div>
          <div class="ts-tutorial-actions">
            <button class="ts-tutorial-btn" data-action="back">BACK</button>
            <button class="ts-tutorial-btn primary" data-action="next">NEXT</button>
          </div>
        </div>
      </div>
    `;
    return overlay;
  }

  private createNarratorPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'ts-observer';
    panel.innerHTML = `
      <div class="ts-observer-top">
        <div class="ts-observer-voice">Observer</div>
        <div class="ts-observer-tone">anodyne feminine synth / neutral witness</div>
      </div>
      <div class="ts-observer-line">No anomaly highlighted yet. The board is waiting for someone to make the first dramatic mistake.</div>
    `;
    return panel;
  }

  private createModalOverlay(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'ts-modal-overlay';
    overlay.innerHTML = `
      <div class="ts-modal">
        <div class="ts-modal-title"></div>
        <div class="ts-modal-content"></div>
        <div class="ts-modal-buttons"></div>
      </div>
    `;
    return overlay;
  }

  // ==========================================================================
  // EVENT BINDING
  // ==========================================================================

  private bindEvents(): void {
    // Phase advance button
    const advanceBtn = this.phasePanel.querySelector('.ts-advance-btn');
    advanceBtn?.addEventListener('click', () => this.onAdvancePhase());

    this.phasePanel.querySelector('[data-tool="tutorial"]')
      ?.addEventListener('click', () => this.showTutorial(true));
    this.phasePanel.querySelector('[data-tool="reset-camera"]')
      ?.addEventListener('click', () => this.scene.resetCamera());
    
    // Submit orders button
    const submitBtn = this.ordersPanel.querySelector('.ts-submit-orders');
    submitBtn?.addEventListener('click', () => this.onSubmitOrders());

    this.tutorialOverlay.querySelector('.ts-tutorial-skip')
      ?.addEventListener('click', () => this.hideTutorial(true));
    this.tutorialOverlay.querySelector('[data-action="back"]')
      ?.addEventListener('click', () => this.stepTutorial(-1));
    this.tutorialOverlay.querySelector('[data-action="next"]')
      ?.addEventListener('click', () => this.stepTutorial(1));
    
    // Scene callbacks
    this.scene.onNodeClick = (nodeId) => this.showNodeDetails(nodeId);
    this.scene.onUnitClick = (unitId) => this.showUnitDetails(unitId);
    
    // Engine events
    this.engine.on('*', (event) => this.onEngineEvent(event));
  }

  private onEngineEvent(event: GameEvent): void {
    this.updateAll();
    this.maybeNarrateEvent(event);
    
    // Special handling
    if (event.type === 'GAME_OVER') {
      this.showGameOverModal(event.payload);
    }
  }

  private primeNarrator(): void {
    this.setNarratorLine('Observer // The board is stable for the moment. Watch the first non-player faction that decides composure is optional.');
  }

  private getTutorialSteps(): Array<{ title: string; body: string; tip: string; anchor: 'phase' | 'hud' | 'details' | 'orders' | 'log' | null; onShow?: () => void }> {
    return [
      {
        title: 'Welcome To They Sing',
        body: 'This is a phase-driven ASI strategy drama. You are usually watching from the current faction panel while rival blocs expand, infiltrate, fabricate, audit, and overheat the world.',
        tip: 'Drag to orbit the map, scroll to zoom, and tap RESET CAM if you get lost. The tutorial can always be reopened from the phase panel.',
        anchor: 'phase',
        onShow: () => this.scene.resetCamera()
      },
      {
        title: 'Read The Heat',
        body: 'The left HUD tracks your resources, tech, world pressure, and faction power base. TAS and Kessler are global danger bars; if they spike, everyone starts paying for it.',
        tip: 'High world pressure changes how stealth, conversion, production, and orbital brinkmanship behave. If you ignore the bars, the bars eventually run the game.',
        anchor: 'hud'
      },
      {
        title: 'Select, Queue, Submit',
        body: 'Click a node or unit to inspect it. In allocation you queue research and builds. In action declaration you queue movement, audits, sabotage, filters, anti-sat strikes, or conversions.',
        tip: 'Nothing happens until you submit the pending order stack. The phase button advances the whole world clock, not just your local view.',
        anchor: 'orders'
      },
      {
        title: 'Watch The Drama',
        body: 'The neutral observer panel will call out rival actions and zoom the camera onto conversions, filters, audits, combat, and other notable turns so you can follow the storyworld without reading every log line.',
        tip: 'The observer voice is calm on purpose. If it sounds composed while describing something ugly, that usually means you should look at the map immediately.',
        anchor: 'log'
      }
    ];
  }

  private maybeShowTutorialOnFirstRun(): void {
    try {
      if (window.localStorage.getItem('theysing:tutorialDismissed:v1') === '1') {
        return;
      }
    } catch {}
    this.showTutorial(false);
  }

  private showTutorial(resetStep: boolean): void {
    if (resetStep) {
      this.tutorialStepIndex = 0;
    }
    this.tutorialOverlay.classList.add('visible');
    this.renderTutorialStep();
  }

  private hideTutorial(persistDismissal: boolean): void {
    this.tutorialOverlay.classList.remove('visible');
    this.setTutorialAnchor(null);
    if (persistDismissal) {
      try {
        window.localStorage.setItem('theysing:tutorialDismissed:v1', '1');
      } catch {}
    }
  }

  private stepTutorial(direction: number): void {
    const steps = this.getTutorialSteps();
    const nextIndex = this.tutorialStepIndex + direction;
    if (nextIndex < 0) {
      return;
    }
    if (nextIndex >= steps.length) {
      this.hideTutorial(true);
      return;
    }
    this.tutorialStepIndex = nextIndex;
    this.renderTutorialStep();
  }

  private renderTutorialStep(): void {
    const steps = this.getTutorialSteps();
    const step = steps[this.tutorialStepIndex];
    if (!step) {
      return;
    }

    (this.tutorialOverlay.querySelector('.ts-tutorial-title') as HTMLElement).textContent = step.title;
    (this.tutorialOverlay.querySelector('.ts-tutorial-body') as HTMLElement).textContent = step.body;
    (this.tutorialOverlay.querySelector('.ts-tutorial-tip') as HTMLElement).textContent = step.tip;

    const progressEl = this.tutorialOverlay.querySelector('.ts-tutorial-progress') as HTMLElement;
    progressEl.innerHTML = steps.map((_, index) => `
      <div class="ts-tutorial-dot ${index === this.tutorialStepIndex ? 'active' : ''}"></div>
    `).join('');

    const backBtn = this.tutorialOverlay.querySelector('[data-action="back"]') as HTMLButtonElement;
    const nextBtn = this.tutorialOverlay.querySelector('[data-action="next"]') as HTMLButtonElement;
    backBtn.disabled = this.tutorialStepIndex === 0;
    nextBtn.textContent = this.tutorialStepIndex === steps.length - 1 ? 'DONE' : 'NEXT';

    this.setTutorialAnchor(step.anchor);
    step.onShow?.();
  }

  private setTutorialAnchor(anchor: 'phase' | 'hud' | 'details' | 'orders' | 'log' | null): void {
    [this.phasePanel, this.hudPanel, this.detailsPanel, this.ordersPanel, this.logPanel]
      .forEach(panel => panel.classList.remove('ts-tutorial-anchor'));

    if (anchor === 'phase') this.phasePanel.classList.add('ts-tutorial-anchor');
    if (anchor === 'hud') this.hudPanel.classList.add('ts-tutorial-anchor');
    if (anchor === 'details') this.detailsPanel.classList.add('ts-tutorial-anchor');
    if (anchor === 'orders') this.ordersPanel.classList.add('ts-tutorial-anchor');
    if (anchor === 'log') this.logPanel.classList.add('ts-tutorial-anchor');
  }

  private setNarratorLine(message: string): void {
    const lineEl = this.narratorPanel.querySelector('.ts-observer-line') as HTMLElement | null;
    if (lineEl) {
      lineEl.textContent = message;
    }
  }

  private maybeNarrateEvent(event: GameEvent): void {
    if (this.tutorialOverlay.classList.contains('visible') || Date.now() < this.narratorSuppressedUntil) {
      return;
    }

    const actor = this.getEventActor(event);
    if (actor && actor === this.currentFaction && event.type !== 'GAME_OVER') {
      return;
    }

    const narrative = this.buildNarration(event, actor);
    if (!narrative) {
      return;
    }

    this.setNarratorLine(narrative.line);
    this.narratorSuppressedUntil = Date.now() + 1100;
    this.focusNarrationTarget(narrative.nodeId ?? null, narrative.unitId ?? null, narrative.distance);
  }

  private getEventActor(event: GameEvent): FactionId | null {
    const directFaction = event.payload.faction;
    if (typeof directFaction === 'string') {
      return directFaction as FactionId;
    }

    const payloadUnit = event.payload.unit as Unit | undefined;
    if (payloadUnit?.owner) {
      return payloadUnit.owner;
    }

    return null;
  }

  private buildNarration(
    event: GameEvent,
    actor: FactionId | null
  ): { line: string; nodeId?: string; unitId?: string; distance?: number } | null {
    const actorLabel = actor ? FACTIONS[actor].name : 'An external process';
    switch (event.type) {
      case 'NODE_CONVERTED': {
        const nodeId = event.payload.nodeId as string | undefined;
        const type = event.payload.type as string | undefined;
        return {
          line: `Observer // ${actorLabel} just forced a ${type === 'CULT' ? 'social' : 'machine'} realignment. That node is no longer thinking its old thoughts.`,
          nodeId,
          distance: 15
        };
      }
      case 'EDGE_FILTERED': {
        const edgeId = event.payload.edgeId as string | undefined;
        const edge = edgeId ? this.engine.getState().edges.get(edgeId) : undefined;
        return edge ? {
          line: `Observer // ${actorLabel} threaded a filter into a live corridor. Expect quieter movement and sharper paranoia on that lane.`,
          nodeId: edge.from,
          distance: 18
        } : null;
      }
      case 'UNIT_CREATED': {
        const unit = event.payload.unit as Unit | undefined;
        if (!unit || unit.owner === this.currentFaction) return null;
        return {
          line: `Observer // ${actorLabel} just put fresh assets on the board. Someone believes the next turn belongs to them.`,
          unitId: unit.id,
          distance: 16
        };
      }
      case 'COMBAT_RESOLVED': {
        const nodeId = event.payload.nodeId as string | undefined;
        const result = event.payload.result as string | undefined;
        return nodeId ? {
          line: `Observer // Contact event registered. The exchange at ${this.engine.getNode(nodeId)?.name || nodeId} resolved as ${String(result || 'unknown').toLowerCase()}.`,
          nodeId,
          distance: 17
        } : null;
      }
      case 'TECH_UNLOCKED': {
        const faction = event.payload.faction as string | undefined;
        if (!faction || faction === this.currentFaction) return null;
        const tech = event.payload.tech as string | undefined;
        return {
          line: `Observer // ${FACTIONS[faction as FactionId].name} just crossed a doctrine threshold${tech ? ` with ${tech}` : ''}. Future turns will feel different now.`
        };
      }
      case 'GAME_OVER':
        return {
          line: 'Observer // The drama has reached its terminal condition. No further restraint is required.'
        };
      default:
        return null;
    }
  }

  private focusNarrationTarget(nodeId: string | null, unitId: string | null, distance = 16): void {
    if (unitId) {
      this.scene.focusOnUnit(unitId, distance);
    } else if (nodeId) {
      this.scene.focusOnNode(nodeId, distance);
    } else {
      return;
    }

    if (this.narratorResetTimer !== null) {
      window.clearTimeout(this.narratorResetTimer);
    }

    this.narratorResetTimer = window.setTimeout(() => {
      this.scene.resetCamera();
      this.narratorResetTimer = null;
    }, 2600);
  }

  // ==========================================================================
  // UPDATE METHODS
  // ==========================================================================

  public updateAll(): void {
    const state = this.engine.getState();
    this.updateHUD(state);
    this.updatePhase(state);
    this.updateUnitList(state);
    this.updateOrderButtons(state);
    this.updatePendingOrders();
    this.updateLog(state);
  }

  private updateHUD(state: GameState): void {
    const faction = state.factions.get(this.currentFaction);
    if (!faction) return;
    
    // Faction name with color
    const nameEl = this.hudPanel.querySelector('.ts-faction-name') as HTMLElement;
    const factionDef = FACTIONS[this.currentFaction];
    nameEl.textContent = factionDef.name;
    nameEl.style.color = `#${factionDef.color.toString(16).padStart(6, '0')}`;
    
    // Resources
    this.hudPanel.querySelector('.flops .ts-resource-value')!.textContent = faction.flops.toString();
    this.hudPanel.querySelector('.influence .ts-resource-value')!.textContent = faction.influence.toString();
    
    // Tech levels
    const vectors: Vector[] = ['KINETIC', 'INFO', 'LOGIC', 'MEMETIC'];
    for (const v of vectors) {
      const el = this.hudPanel.querySelector(`.ts-tech.${v} .ts-tech-level`);
      if (el) el.textContent = faction.techLevel[v].toString();
    }
    
    // Global counters
    const tas = state.counters.tas;
    const kessler = state.counters.kessler;
    
    this.hudPanel.querySelector('.tas .ts-counter-value')!.textContent = `${tas}/100`;
    const tasFill = this.hudPanel.querySelector('.tas .ts-counter-fill') as HTMLElement;
    tasFill.style.width = `${tas}%`;
    
    this.hudPanel.querySelector('.kessler .ts-counter-value')!.textContent = `${kessler}/100`;
    const kessFill = this.hudPanel.querySelector('.kessler .ts-counter-fill') as HTMLElement;
    kessFill.style.width = `${kessler}%`;

    const pressureKeys = ['memetic', 'cyber', 'industry', 'orbital'] as const;
    for (const key of pressureKeys) {
      const pressure = state.counters.pressures[key];
      const card = this.hudPanel.querySelector(`.ts-pressure-card[data-pressure="${key}"]`);
      if (!card) continue;

      const valueEl = card.querySelector('.ts-pressure-value') as HTMLElement | null;
      const fillEl = card.querySelector('.ts-pressure-fill') as HTMLElement | null;
      if (valueEl) valueEl.textContent = pressure.toString();
      if (fillEl) fillEl.style.width = `${pressure}%`;
    }

    const powerBaseKeys = ['humanMesh', 'machineMesh', 'coherence', 'legibility'] as const;
    for (const key of powerBaseKeys) {
      const card = this.hudPanel.querySelector(`.ts-powerbase-card[data-powerbase="${key}"]`);
      const valueEl = card?.querySelector('.ts-powerbase-value') as HTMLElement | null;
      if (valueEl) {
        valueEl.textContent = Math.round(faction.powerBase[key]).toString();
      }
    }

    const bandsEl = this.hudPanel.querySelector('.ts-power-bands') as HTMLElement;
    const powerBands = this.engine.getFactionPowerBands(this.currentFaction);
    bandsEl.innerHTML = powerBands.length > 0
      ? powerBands.map(band => `
        <div class="ts-power-band ${band.domain}">
          <div class="ts-power-band-title">${band.domain} L${band.level} // ${band.title}</div>
          <div class="ts-power-band-effect">${band.worldEffect}</div>
        </div>
      `).join('')
      : '<div class="ts-power-band-empty">Reach level 2 and 3 research bands to surface doctrine shifts here.</div>';

    const doctrinesEl = this.hudPanel.querySelector('.ts-doctrines') as HTMLElement;
    const doctrines = this.engine.getFactionRhizomeDoctrines(this.currentFaction);
    const alignmentBanner = faction.memeticAlignment
      ? `<div class="ts-doctrine-alignment">Memetic Constitution: ${faction.memeticAlignment.replace(/_/g, ' ')}</div>`
      : '';
    doctrinesEl.innerHTML = doctrines.length > 0
      ? `${alignmentBanner}${doctrines.map(doctrine => `
        <div class="ts-doctrine">
          <div class="ts-doctrine-title">
            <span>${doctrine.name}</span>
            <span class="ts-doctrine-affinity ${getDoctrineAffinityTier(doctrine, this.currentFaction === 'NEUTRAL' ? undefined : this.currentFaction) || 'native'}">
              ${getDoctrineAffinityTier(doctrine, this.currentFaction === 'NEUTRAL' ? undefined : this.currentFaction) || 'native'}
            </span>
          </div>
          <div class="ts-doctrine-effect">${doctrine.effect}</div>
        </div>
      `).join('')}`
      : '<div class="ts-doctrine-empty">Cross-track doctrine unlocks will surface here once your research stack starts braiding.</div>';
  }

  private updatePhase(state: GameState): void {
    const phases: GamePhase[] = ['NEGOTIATION', 'ALLOCATION', 'ACTION_DECLARATION', 'RESOLUTION', 'TURN_END'];
    const currentIdx = phases.indexOf(state.phase);
    
    this.phasePanel.querySelector('.ts-turn')!.textContent = `TURN ${state.counters.turn}`;
    this.phasePanel.querySelector('.ts-phase-name')!.textContent = state.phase.replace('_', ' ');
    
    // Update step indicators
    const steps = this.phasePanel.querySelectorAll('.ts-phase-step');
    steps.forEach((step, i) => {
      step.classList.remove('active', 'complete');
      if (i < currentIdx) step.classList.add('complete');
      if (i === currentIdx) step.classList.add('active');
    });
  }

  private updateUnitList(state: GameState): void {
    const listEl = this.detailsPanel.querySelector('.ts-unit-list')!;
    const units = Array.from(state.units.values()).filter(u => u.owner === this.currentFaction);
    
    listEl.innerHTML = units.map(unit => {
      const node = state.nodes.get(unit.location);
      const stats = UNIT_STATS[unit.type];
      const color = FACTIONS[unit.owner].color.toString(16).padStart(6, '0');
      const selected = this.scene.getSelectedUnit() === unit.id;
      
      return `
        <div class="ts-unit-item ${selected ? 'selected' : ''}" data-unit-id="${unit.id}">
          <div class="ts-unit-icon" style="background: #${color}">
            ${unit.type.charAt(0)}
          </div>
          <div class="ts-unit-info">
            <div class="ts-unit-type">${unit.type}</div>
            <div class="ts-unit-location">${node?.name || unit.location}</div>
          </div>
          <div style="font-size: 10px; color: #888">${stats.vector}</div>
        </div>
      `;
    }).join('');
    
    // Bind click events
    listEl.querySelectorAll('.ts-unit-item').forEach(el => {
      el.addEventListener('click', () => {
        const unitId = el.getAttribute('data-unit-id');
        if (unitId) {
          this.scene.selectUnit(unitId);
          this.showUnitDetails(unitId);
        }
      });
    });
  }

  private updateOrderButtons(state: GameState): void {
    const buttonsEl = this.ordersPanel.querySelector('.ts-order-buttons')!;
    const phase = state.phase;
    
    let availableOrders: { type: OrderType; label: string; phaseReq: GamePhase[] }[] = [
      { type: 'HOLD', label: 'HOLD', phaseReq: ['ACTION_DECLARATION'] },
      { type: 'MOVE', label: 'MOVE', phaseReq: ['ACTION_DECLARATION'] },
      { type: 'ATTACK', label: 'ATTACK', phaseReq: ['ACTION_DECLARATION'] },
      { type: 'FILTER', label: 'FILTER', phaseReq: ['ACTION_DECLARATION'] },
      { type: 'AUDIT', label: 'AUDIT', phaseReq: ['ACTION_DECLARATION'] },
      { type: 'ANTI_SAT', label: 'ANTI-SAT', phaseReq: ['ACTION_DECLARATION'] },
      { type: 'SABOTAGE', label: 'SABOTAGE', phaseReq: ['ACTION_DECLARATION'] },
      { type: 'CONVERT', label: 'CONVERT', phaseReq: ['ACTION_DECLARATION'] },
      { type: 'BUILD', label: 'BUILD', phaseReq: ['ALLOCATION'] },
      { type: 'RESEARCH', label: 'RESEARCH', phaseReq: ['ALLOCATION'] },
    ];
    
    buttonsEl.innerHTML = availableOrders.map(o => {
      const enabled = o.phaseReq.includes(phase);
      const active = this.orderMode === o.type;
      return `
        <button class="ts-order-btn ${active ? 'active' : ''}" 
                data-order-type="${o.type}"
                ${enabled ? '' : 'disabled'}>
          ${o.label}
        </button>
      `;
    }).join('');
    
    // Bind events
    buttonsEl.querySelectorAll('.ts-order-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.getAttribute('data-order-type') as OrderType;
        this.setOrderMode(type);
      });
    });
  }

  private updatePendingOrders(): void {
    const listEl = this.ordersPanel.querySelector('.ts-pending-orders')!;
    
    listEl.innerHTML = this.pendingOrders.map((order, i) => `
      <div class="ts-pending-order">
        <span>${order.type} - ${order.unitId || 'FACTION'} → ${order.targetNodeId || order.targetEdgeId || ''}</span>
        <span class="remove" data-index="${i}">✕</span>
      </div>
    `).join('');
    
    // Remove buttons
    listEl.querySelectorAll('.remove').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.getAttribute('data-index') || '0');
        this.pendingOrders.splice(idx, 1);
        this.updatePendingOrders();
      });
    });
    
    // Update submit button
    const submitBtn = this.ordersPanel.querySelector('.ts-submit-orders') as HTMLButtonElement;
    submitBtn.disabled = this.pendingOrders.length === 0;
    submitBtn.textContent = `SUBMIT ORDERS (${this.pendingOrders.length})`;
  }

  private updateLog(state: GameState): void {
    const logs = state.logs.slice(-20);
    const entriesEl = this.logPanel.querySelector('.ts-log-entries')!;
    
    entriesEl.innerHTML = logs.map(log => `
      <div class="ts-log-entry ${log.type}">
        <span class="ts-log-turn">[T${log.turn}]</span>
        ${log.message}
      </div>
    `).join('');
    
    entriesEl.scrollTop = entriesEl.scrollHeight;
  }

  // ==========================================================================
  // DETAILS DISPLAY
  // ==========================================================================

  private showNodeDetails(nodeId: string): void {
    const node = this.engine.getNode(nodeId);
    if (!node) return;
    
    const units = this.engine.getUnitsAtNode(nodeId);
    const adjacent = this.engine.getAdjacentNodes(nodeId);
    
    const contentEl = this.detailsPanel.querySelector('.ts-detail-content')!;
    contentEl.innerHTML = `
      <div class="ts-detail-section">
        <div class="ts-detail-title" style="color: #${(node.owner ? FACTIONS[node.owner].color : 0x666666).toString(16).padStart(6, '0')}">${node.name}</div>
        <div class="ts-detail-row"><span class="ts-detail-label">Type</span><span>${node.type}</span></div>
        <div class="ts-detail-row"><span class="ts-detail-label">Layer</span><span>${node.layer}</span></div>
        <div class="ts-detail-row"><span class="ts-detail-label">Owner</span><span>${node.owner || 'NEUTRAL'}</span></div>
        <div class="ts-detail-row"><span class="ts-detail-label">Infrastructure</span><span>${node.infrastructure}%</span></div>
        <div class="ts-detail-row"><span class="ts-detail-label">FLOPs/turn</span><span>+${node.resources.flops}</span></div>
        <div class="ts-detail-row"><span class="ts-detail-label">Influence/turn</span><span>+${node.resources.influence}</span></div>
        ${node.isZombie ? '<div style="color: #00ff00; margin-top: 8px;">⚠ ZOMBIE NODE</div>' : ''}
        ${node.isCultNode ? '<div style="color: #ff00ff; margin-top: 8px;">⚠ CULT NODE</div>' : ''}
      </div>
      <div class="ts-detail-section">
        <div style="color: #888; font-size: 11px;">Units Present: ${units.length}</div>
        <div style="color: #888; font-size: 11px;">Adjacent: ${adjacent.length} nodes</div>
      </div>
    `;
  }

  private showUnitDetails(unitId: string): void {
    const unit = this.engine.getUnit(unitId);
    if (!unit) return;
    
    const stats = UNIT_STATS[unit.type];
    const node = this.engine.getNode(unit.location);
    const factionColor = FACTIONS[unit.owner].color.toString(16).padStart(6, '0');
    
    const contentEl = this.detailsPanel.querySelector('.ts-detail-content')!;
    contentEl.innerHTML = `
      <div class="ts-detail-section">
        <div class="ts-detail-title" style="color: #${factionColor}">${unit.type}</div>
        <div class="ts-detail-row"><span class="ts-detail-label">Owner</span><span>${unit.owner}</span></div>
        <div class="ts-detail-row"><span class="ts-detail-label">Location</span><span>${node?.name || unit.location}</span></div>
        <div class="ts-detail-row"><span class="ts-detail-label">Vector</span><span>${stats.vector}</span></div>
        <div class="ts-detail-row"><span class="ts-detail-label">Stealth</span><span>${unit.stealthLevel}</span></div>
        <div class="ts-detail-row"><span class="ts-detail-label">Speed</span><span>${stats.speed}</span></div>
        <div style="margin-top: 8px; font-size: 11px; color: #888;">${stats.special}</div>
      </div>
    `;
    
    this.updateUnitList(this.engine.getState());
  }

  // ==========================================================================
  // ORDER HANDLING
  // ==========================================================================

  private setOrderMode(type: OrderType): void {
    if (this.orderMode === type) {
      this.orderMode = null;
    } else {
      this.orderMode = type;
    }
    this.updateOrderButtons(this.engine.getState());
    
    // If order needs target, wait for click
    // For now, create simple order if unit is selected
    if (this.orderMode) {
      this.createOrderForSelectedUnit();
    }
  }

  private createOrderForSelectedUnit(): void {
    const selectedUnit = this.scene.getSelectedUnit();
    const selectedNode = this.scene.getSelectedNode();
    
    if (!this.orderMode) return;
    
    // RESEARCH and BUILD don't need a unit
    if (this.orderMode === 'RESEARCH') {
      // Show tech selection modal
      this.showResearchModal();
      return;
    }
    
    if (this.orderMode === 'BUILD') {
      if (selectedNode) {
        this.showBuildModal(selectedNode);
      }
      return;
    }
    
    // Other orders need a unit
    if (!selectedUnit) {
      return;
    }
    
    const unit = this.engine.getUnit(selectedUnit);
    if (!unit || unit.owner !== this.currentFaction) return;

    if (this.orderMode === 'CONVERT' && unit.type !== 'CULT' && unit.type !== 'SWARM') {
      this.orderMode = null;
      this.updateOrderButtons(this.engine.getState());
      return;
    }

    if (this.orderMode === 'FILTER' && !UNIT_STATS[unit.type].canFilter) {
      this.orderMode = null;
      this.updateOrderButtons(this.engine.getState());
      return;
    }

    if (this.orderMode === 'ANTI_SAT' && UNIT_STATS[unit.type].vector !== 'KINETIC') {
      this.orderMode = null;
      this.updateOrderButtons(this.engine.getState());
      return;
    }

    const baseOrder: Order = {
      id: `order_${Date.now()}`,
      faction: this.currentFaction,
      unitId: selectedUnit,
      type: this.orderMode,
      priority: this.pendingOrders.length
    };

    if (this.orderMode === 'HOLD' || this.orderMode === 'CONVERT') {
      this.queueOrder(baseOrder);
    } else if (this.orderMode === 'MOVE' || this.orderMode === 'ATTACK') {
      const targetNodeId = this.getPreferredTargetNode(unit, selectedNode, this.orderMode === 'ATTACK');
      if (targetNodeId) {
        this.queueOrder({ ...baseOrder, targetNodeId });
      }
    } else if (this.orderMode === 'AUDIT') {
      this.queueOrder({ ...baseOrder, targetNodeId: selectedNode || unit.location });
    } else if (this.orderMode === 'SABOTAGE') {
      const targetNodeId = this.getPreferredTargetNode(unit, selectedNode, true, true) || unit.location;
      this.queueOrder({ ...baseOrder, targetNodeId });
    } else if (this.orderMode === 'FILTER') {
      const edge = Array.from(this.engine.getState().edges.values()).find(candidate =>
        candidate.type === 'CABLE' &&
        !candidate.isSevered &&
        (candidate.from === unit.location || candidate.to === unit.location)
      );

      if (edge) {
        this.queueOrder({ ...baseOrder, targetEdgeId: edge.id });
      }
    } else if (this.orderMode === 'ANTI_SAT') {
      const targetNodeId = this.getPreferredOrbitalTarget(selectedNode);
      if (targetNodeId) {
        this.queueOrder({ ...baseOrder, targetNodeId });
      }
    }
    
    this.orderMode = null;
    this.updateOrderButtons(this.engine.getState());
  }

  private queueOrder(order: Order): void {
    this.pendingOrders.push(order);
    this.updatePendingOrders();
  }

  private getPreferredTargetNode(
    unit: Unit,
    selectedNode: string | null,
    preferEnemy: boolean,
    allowCurrent = false
  ): string | null {
    const adjacent = this.engine.getAdjacentNodes(unit.location);
    const state = this.engine.getState();

    if (selectedNode && (adjacent.includes(selectedNode) || (allowCurrent && selectedNode === unit.location))) {
      return selectedNode;
    }

    const enemyNode = adjacent.find(nodeId => {
      const node = state.nodes.get(nodeId);
      return !!node && node.owner !== unit.owner;
    });

    if (preferEnemy && enemyNode) {
      return enemyNode;
    }

    return enemyNode || adjacent[0] || (allowCurrent ? unit.location : null);
  }

  private getPreferredOrbitalTarget(selectedNode: string | null): string | null {
    if (selectedNode) {
      const node = this.engine.getNode(selectedNode);
      if (node?.layer === 'ORBITAL') {
        return selectedNode;
      }
    }

    const orbitalNodes = Array.from(this.engine.getState().nodes.values()).filter(node => node.layer === 'ORBITAL');
    const hostile = orbitalNodes.find(node => node.owner !== this.currentFaction);
    return hostile?.id || orbitalNodes[0]?.id || null;
  }

  private showResearchModal(): void {
    // Open the tech tree constellation view
    this.openTechTree();
  }

  private openTechTree(): void {
    if (this.techTree) return; // Already open
    
    this.techTree = new TechTreeScene(this.container);
    
    this.techTree.onClose = () => {
      this.techTree?.dispose();
      this.techTree = null;
    };
    
    this.techTree.onResearch = (techId: string) => {
      // Map tech ID to domain for now
      let domain: Vector = 'KINETIC';
      if (techId.startsWith('i')) domain = 'INFO';
      else if (techId.startsWith('l')) domain = 'LOGIC';
      else if (techId.startsWith('m')) domain = 'MEMETIC';
      
      const order: Order = {
        id: `order_${Date.now()}`,
        faction: this.currentFaction,
        unitId: this.currentFaction,
        type: 'RESEARCH',
        techDomain: domain,
        priority: this.pendingOrders.length
      };
      this.pendingOrders.push(order);
      this.updatePendingOrders();
      
      // Close tech tree after selecting research
      this.techTree?.close();
    };
    
    this.techTree.open();
  }

  private showBuildModal(nodeId: string): void {
    const unitTypes: UnitType[] = ['DRONE', 'SWARM', 'CULT', 'AUDITOR', 'SAT_SWARM'];
    const faction = this.engine.getFaction(this.currentFaction);
    
    const buttons = unitTypes.map(type => {
      const stats = UNIT_STATS[type];
      const effectiveCost = this.engine.getEffectiveBuildCost(type);
      const canAfford = stats.currency === 'F' 
        ? (faction?.flops || 0) >= effectiveCost 
        : (faction?.influence || 0) >= effectiveCost;
      
      return {
        label: `${type} (${effectiveCost}${stats.currency})`,
        disabled: !canAfford,
        action: () => {
          const order: Order = {
            id: `order_${Date.now()}`,
            faction: this.currentFaction,
            unitId: this.currentFaction,
            type: 'BUILD',
            unitTypeToBuild: type,
            targetNodeId: nodeId,
            priority: this.pendingOrders.length
          };
          this.pendingOrders.push(order);
          this.updatePendingOrders();
          this.hideModal();
        }
      };
    });
    
    this.showModal('Build Unit', `Build at ${nodeId}. Industrial pressure can discount kinetic fabrication.`, buttons);
  }

  // ==========================================================================
  // PHASE HANDLING
  // ==========================================================================

  private onAdvancePhase(): void {
    this.engine.advancePhase();
    this.updateAll();
  }

  private onSubmitOrders(): void {
    if (this.pendingOrders.length === 0) return;
    
    const result = this.engine.submitOrders(this.currentFaction, this.pendingOrders);
    
    if (result.success) {
      this.pendingOrders = [];
      this.updatePendingOrders();
    } else {
      console.error('Order submission failed:', result.message);
    }
  }

  // ==========================================================================
  // MODAL
  // ==========================================================================

  private showModal(
    title: string, 
    content: string, 
    buttons: { label: string; action: () => void; disabled?: boolean }[]
  ): void {
    const modal = this.modalOverlay.querySelector('.ts-modal')!;
    modal.querySelector('.ts-modal-title')!.textContent = title;
    modal.querySelector('.ts-modal-content')!.innerHTML = content;
    
    const buttonsEl = modal.querySelector('.ts-modal-buttons')!;
    buttonsEl.innerHTML = buttons.map((b, i) => `
      <button class="ts-modal-btn" data-index="${i}" ${b.disabled ? 'disabled' : ''}
              style="background: ${i === 0 ? '#3366aa' : '#444'}; border: 1px solid ${i === 0 ? '#4488ff' : '#666'};">
        ${b.label}
      </button>
    `).join('');
    
    buttonsEl.querySelectorAll('.ts-modal-btn').forEach((btn, i) => {
      btn.addEventListener('click', () => buttons[i].action());
    });
    
    this.modalOverlay.classList.add('visible');
  }

  private hideModal(): void {
    this.modalOverlay.classList.remove('visible');
  }

  private showGameOverModal(payload: Record<string, unknown>): void {
    const reason = payload.reason as string;
    let title = 'GAME OVER';
    let message = '';
    
    if (reason === 'PROTOCOL_FAILURE') {
      title = '🛑 PROTOCOL FAILURE';
      message = 'The Thermal Anomaly Score exceeded 100. All ASI systems have been shut down by global regulatory intervention.';
    }
    
    this.showModal(title, message, [
      { label: 'NEW GAME', action: () => location.reload() }
    ]);
  }

  // ==========================================================================
  // PUBLIC API
  // ==========================================================================

  public setFaction(faction: FactionId): void {
    this.currentFaction = faction;
    this.updateAll();
  }
}
