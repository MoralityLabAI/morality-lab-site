// ============================================================================
// ASI CARTEL - Tooltip System
// Hover tooltips for units, territories, and orders with microinteractions
// ============================================================================

import { Unit, Territory, OperationType } from '../data/types';
import { FACTIONS, UNIT_STATS, OPERATION_COSTS } from '../data/gameData';

interface TooltipContent {
  title: string;
  subtitle?: string;
  stats?: { label: string; value: string; color?: string }[];
  description?: string;
  faction?: string;
  factionColor?: number;
}

export class TooltipSystem {
  private container: HTMLElement;
  private tooltip: HTMLElement;
  private isVisible = false;
  private hideTimeout: number | null = null;
  private currentTarget: string | null = null;
  
  constructor(container: HTMLElement) {
    this.container = container;
    this.tooltip = this.createTooltip();
    this.container.appendChild(this.tooltip);
    this.injectStyles();
  }

  private createTooltip(): HTMLElement {
    const tooltip = document.createElement('div');
    tooltip.className = 'asi-tooltip';
    tooltip.innerHTML = `
      <div class="tooltip-header">
        <div class="tooltip-faction-bar"></div>
        <div class="tooltip-title"></div>
        <div class="tooltip-subtitle"></div>
      </div>
      <div class="tooltip-body">
        <div class="tooltip-stats"></div>
        <div class="tooltip-description"></div>
      </div>
      <div class="tooltip-arrow"></div>
    `;
    return tooltip;
  }

  private injectStyles(): void {
    if (document.getElementById('tooltip-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'tooltip-styles';
    style.textContent = `
      .asi-tooltip {
        position: fixed;
        z-index: 10000;
        pointer-events: none;
        opacity: 0;
        transform: translateY(8px) scale(0.95);
        transition: opacity 0.15s ease, transform 0.15s ease;
        font-family: 'JetBrains Mono', monospace;
      }
      
      .asi-tooltip.visible {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
      
      .tooltip-header {
        background: rgba(5, 8, 15, 0.98);
        border: 1px solid rgba(60, 100, 150, 0.4);
        border-bottom: none;
        border-radius: 8px 8px 0 0;
        padding: 10px 14px 8px;
        position: relative;
        overflow: hidden;
      }
      
      .tooltip-faction-bar {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 3px;
        background: var(--faction-color, #00d4ff);
      }
      
      .tooltip-title {
        font-size: 13px;
        font-weight: 600;
        color: #e8eef5;
        margin-bottom: 2px;
      }
      
      .tooltip-subtitle {
        font-size: 10px;
        color: #8899aa;
        letter-spacing: 0.5px;
      }
      
      .tooltip-body {
        background: rgba(10, 14, 25, 0.98);
        border: 1px solid rgba(60, 100, 150, 0.4);
        border-top: 1px solid rgba(60, 100, 150, 0.2);
        border-radius: 0 0 8px 8px;
        padding: 10px 14px;
        min-width: 180px;
        max-width: 280px;
      }
      
      .tooltip-stats {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px 12px;
        margin-bottom: 8px;
      }
      
      .tooltip-stat {
        display: flex;
        justify-content: space-between;
        font-size: 10px;
      }
      
      .stat-label {
        color: #667788;
      }
      
      .stat-value {
        font-weight: 600;
        color: #e8eef5;
      }
      
      .stat-value.positive { color: #44ff88; }
      .stat-value.negative { color: #ff4444; }
      .stat-value.cyan { color: #00d4ff; }
      .stat-value.orange { color: #ffaa00; }
      .stat-value.magenta { color: #ff44aa; }
      
      .tooltip-description {
        font-size: 10px;
        color: #8899aa;
        line-height: 1.4;
        border-top: 1px solid rgba(60, 100, 150, 0.2);
        padding-top: 8px;
        margin-top: 4px;
      }
      
      .tooltip-description:empty {
        display: none;
      }
      
      .tooltip-arrow {
        position: absolute;
        bottom: -6px;
        left: 50%;
        transform: translateX(-50%);
        width: 0;
        height: 0;
        border-left: 6px solid transparent;
        border-right: 6px solid transparent;
        border-top: 6px solid rgba(10, 14, 25, 0.98);
      }
      
      /* Compact variant for quick hovers */
      .asi-tooltip.compact .tooltip-body {
        padding: 6px 10px;
        min-width: 120px;
      }
      
      .asi-tooltip.compact .tooltip-stats {
        grid-template-columns: 1fr;
        gap: 4px;
      }
    `;
    document.head.appendChild(style);
  }

  // =========================================================================
  // PUBLIC API
  // =========================================================================

  /**
   * Show tooltip for a unit
   */
  public showUnitTooltip(unit: Unit, x: number, y: number): void {
    const faction = FACTIONS[unit.faction];
    const stats = UNIT_STATS[unit.type];
    
    const content: TooltipContent = {
      title: unit.name,
      subtitle: `Level ${unit.level} ${unit.type}`,
      factionColor: faction.color,
      stats: [
        { label: 'Health', value: `${unit.health}%`, color: unit.health > 50 ? 'positive' : 'negative' },
        { label: 'Morale', value: `${unit.morale}%`, color: unit.morale > 50 ? 'cyan' : 'orange' },
        { label: 'Attack', value: `${stats.attack + unit.level * 5}`, color: 'magenta' },
        { label: 'Defense', value: `${stats.defense + unit.level * 3}` },
        { label: 'Speed', value: stats.speed > 0 ? `${stats.speed}` : 'Static' },
        { label: 'Stealth', value: `${stats.stealth}%` }
      ],
      description: faction.specialAbility,
      faction: faction.name
    };
    
    this.show(content, x, y, unit.id);
  }

  /**
   * Show tooltip for a territory
   */
  public showTerritoryTooltip(territory: Territory, x: number, y: number): void {
    const faction = FACTIONS[territory.controller];
    const contested = territory.contestedBy.length > 0;
    
    const content: TooltipContent = {
      title: territory.name,
      subtitle: contested ? '⚔️ CONTESTED' : `Controlled by ${faction.name}`,
      factionColor: faction.color,
      stats: [
        { label: 'FLOPs/turn', value: `+${territory.resources.flopsPerTurn}`, color: 'cyan' },
        { label: 'Watts/turn', value: `+${territory.resources.wattsPerTurn}`, color: 'orange' },
        { label: 'Infrastructure', value: `${territory.infrastructure}%` },
        { label: 'Population', value: this.formatPopulation(territory.population) }
      ],
      description: contested 
        ? `Contested by: ${territory.contestedBy.map(f => FACTIONS[f].name).join(', ')}`
        : undefined
    };
    
    this.show(content, x, y, territory.id);
  }

  /**
   * Show tooltip for an operation
   */
  public showOperationTooltip(opType: OperationType, x: number, y: number): void {
    const cost = OPERATION_COSTS[opType];
    
    const descriptions: Record<OperationType, string> = {
      MOVE: 'Relocate unit to a new position within movement range.',
      ATTACK: 'Engage enemy unit in combat. Damage based on ATK vs DEF.',
      HACK: 'Infiltrate enemy infrastructure. Reduces territory infrastructure.',
      INFLUENCE: 'Deploy memetic warfare. Contest or capture territories.',
      INFECT: 'Release bioweapon. Spreads to adjacent territories.',
      FORTIFY: 'Defensive stance. +50% defense, recover morale.',
      RESEARCH: 'Contribute to tech tree advancement.',
      MERGE: 'Combine with adjacent allied unit to level up.',
      DEPLOY: 'Spawn new unit from controlled territory.'
    };
    
    const content: TooltipContent = {
      title: opType,
      subtitle: 'Operation',
      stats: [
        { label: 'FLOPs Cost', value: `${cost.flops}`, color: 'cyan' },
        { label: 'Heat Generated', value: `${cost.heat}`, color: 'orange' }
      ],
      description: descriptions[opType]
    };
    
    this.show(content, x, y, `op-${opType}`, true);
  }

  /**
   * Show a simple text tooltip
   */
  public showSimple(text: string, x: number, y: number): void {
    const content: TooltipContent = {
      title: text
    };
    this.show(content, x, y, 'simple', true);
  }

  /**
   * Hide the tooltip
   */
  public hide(): void {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
    }
    
    this.hideTimeout = window.setTimeout(() => {
      this.tooltip.classList.remove('visible');
      this.isVisible = false;
      this.currentTarget = null;
    }, 100);
  }

  /**
   * Immediately hide without delay
   */
  public hideImmediate(): void {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
    }
    this.tooltip.classList.remove('visible');
    this.isVisible = false;
    this.currentTarget = null;
  }

  // =========================================================================
  // PRIVATE METHODS
  // =========================================================================

  private show(
    content: TooltipContent, 
    x: number, 
    y: number, 
    targetId: string,
    compact = false
  ): void {
    // Cancel pending hide
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
    
    // Skip if same target
    if (this.currentTarget === targetId && this.isVisible) {
      this.updatePosition(x, y);
      return;
    }
    
    this.currentTarget = targetId;
    
    // Update content
    const titleEl = this.tooltip.querySelector('.tooltip-title') as HTMLElement;
    const subtitleEl = this.tooltip.querySelector('.tooltip-subtitle') as HTMLElement;
    const statsEl = this.tooltip.querySelector('.tooltip-stats') as HTMLElement;
    const descEl = this.tooltip.querySelector('.tooltip-description') as HTMLElement;
    const factionBar = this.tooltip.querySelector('.tooltip-faction-bar') as HTMLElement;
    
    titleEl.textContent = content.title;
    subtitleEl.textContent = content.subtitle || '';
    
    if (content.factionColor) {
      factionBar.style.setProperty('--faction-color', `#${content.factionColor.toString(16).padStart(6, '0')}`);
      factionBar.style.display = 'block';
    } else {
      factionBar.style.display = 'none';
    }
    
    if (content.stats && content.stats.length > 0) {
      statsEl.innerHTML = content.stats.map(stat => `
        <div class="tooltip-stat">
          <span class="stat-label">${stat.label}</span>
          <span class="stat-value ${stat.color || ''}">${stat.value}</span>
        </div>
      `).join('');
      statsEl.style.display = 'grid';
    } else {
      statsEl.style.display = 'none';
    }
    
    descEl.textContent = content.description || '';
    
    // Apply compact mode
    this.tooltip.classList.toggle('compact', compact);
    
    // Position and show
    this.updatePosition(x, y);
    this.tooltip.classList.add('visible');
    this.isVisible = true;
  }

  private updatePosition(x: number, y: number): void {
    const rect = this.tooltip.getBoundingClientRect();
    const padding = 12;
    
    // Default: above cursor, centered
    let left = x - rect.width / 2;
    let top = y - rect.height - padding;
    
    // Clamp to viewport
    if (left < padding) left = padding;
    if (left + rect.width > window.innerWidth - padding) {
      left = window.innerWidth - rect.width - padding;
    }
    if (top < padding) {
      // Flip below cursor
      top = y + padding;
    }
    
    this.tooltip.style.left = `${left}px`;
    this.tooltip.style.top = `${top}px`;
  }

  private formatPopulation(pop: number): string {
    if (pop >= 1_000_000_000) return `${(pop / 1_000_000_000).toFixed(1)}B`;
    if (pop >= 1_000_000) return `${(pop / 1_000_000).toFixed(1)}M`;
    if (pop >= 1_000) return `${(pop / 1_000).toFixed(1)}K`;
    return pop.toString();
  }
}
