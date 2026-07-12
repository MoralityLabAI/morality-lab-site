import { TheySingEngine } from '../engine/TheySingEngine';
import { CampaignClock } from './types';

const SCALE_ORDER: CampaignClock['scale'][] = ['MONTHS', 'WEEKS', 'DAYS', 'HOURS'];
const SCALE_HOURS: Record<CampaignClock['scale'], number> = {
  MONTHS: 720,
  WEEKS: 168,
  DAYS: 24,
  HOURS: 6
};

export function buildCampaignClock(engine: TheySingEngine): CampaignClock {
  const state = engine.getState();
  const factions = Array.from(state.factions.values()).filter(faction => faction.id !== 'NEUTRAL');
  const maxTechLevel = factions.reduce(
    (max, faction) => Math.max(max, ...Object.values(faction.techLevel)),
    0
  );
  const totalFactionFlops = factions.reduce((total, faction) => total + faction.flops, 0);
  const orbitalCompute = Array.from(state.nodes.values())
    .filter(node => node.layer === 'ORBITAL' && node.owner && node.owner !== 'NEUTRAL')
    .reduce((total, node) => total + node.resources.flops, 0);

  const techScale = scaleForTech(maxTechLevel);
  const flopScale = scaleForFlops(totalFactionFlops + orbitalCompute);
  const scale = fasterScale(techScale.scale, flopScale.scale);
  const driver = scale === techScale.scale && scale === flopScale.scale
    ? `${techScale.driver}; ${flopScale.driver}`
    : scale === techScale.scale
      ? techScale.driver
      : flopScale.driver;

  return {
    turn: state.counters.turn,
    scale,
    turnDurationHours: SCALE_HOURS[scale],
    turnDurationLabel: formatDuration(SCALE_HOURS[scale]),
    tempoLabel: `${scale.toLowerCase()} tempo`,
    driver,
    maxTechLevel,
    totalFactionFlops,
    orbitalCompute
  };
}

function scaleForTech(maxTechLevel: number): { scale: CampaignClock['scale']; driver: string } {
  if (maxTechLevel >= 7) return { scale: 'HOURS', driver: `ASI7 breakthrough compresses turns to hours` };
  if (maxTechLevel >= 6) return { scale: 'DAYS', driver: `ASI6 breakthrough compresses turns to days` };
  if (maxTechLevel >= 5) return { scale: 'WEEKS', driver: `ASI5 breakthrough compresses turns to weeks` };
  return { scale: 'MONTHS', driver: 'pre-ASI5 strategic cycles still unfold over months' };
}

function scaleForFlops(totalCompute: number): { scale: CampaignClock['scale']; driver: string } {
  if (totalCompute >= 1800) return { scale: 'HOURS', driver: `aggregate compute ${Math.round(totalCompute)}F supports hour-scale tempo` };
  if (totalCompute >= 900) return { scale: 'DAYS', driver: `aggregate compute ${Math.round(totalCompute)}F supports day-scale tempo` };
  if (totalCompute >= 350) return { scale: 'WEEKS', driver: `aggregate compute ${Math.round(totalCompute)}F supports week-scale tempo` };
  return { scale: 'MONTHS', driver: `aggregate compute ${Math.round(totalCompute)}F remains month-scale` };
}

function fasterScale(left: CampaignClock['scale'], right: CampaignClock['scale']): CampaignClock['scale'] {
  return SCALE_ORDER[Math.max(SCALE_ORDER.indexOf(left), SCALE_ORDER.indexOf(right))];
}

function formatDuration(hours: number): string {
  if (hours >= 720) return `${Math.round(hours / 720)} month`;
  if (hours >= 168) return `${Math.round(hours / 168)} week`;
  if (hours >= 24) return `${Math.round(hours / 24)} day`;
  return `${hours} hours`;
}
