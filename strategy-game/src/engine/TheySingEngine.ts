// @ts-nocheck
// ============================================================================
// THEY SING - Core Game Engine
// Graph Topology ASI Warfare with Diplomacy-style Resolution
// ============================================================================
import * as types_1 from './types';
import * as gameData_1 from './gameData';
import { describeMovementProfile, evolveMovementProfile, generateFactionMovementProfile } from './movements';
// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function roundMetric(value) {
    return Math.round(value * 100) / 100;
}
function formatMetric(value) {
    const rounded = roundMetric(value);
    return Number.isInteger(rounded) ? `${rounded}` : `${rounded.toFixed(2)}`;
}
const PRESSURE_LABELS = {
    memetic: 'Memetic pressure',
    cyber: 'Cyber pressure',
    industry: 'Industrial autonomy',
    orbital: 'Orbital brinkmanship'
};
export interface TheySingEngineOptions {
    random?: () => number;
    now?: () => number;
}
class TheySingEngine {
    state: types_1.GameState;
    listeners: Map<types_1.GameEventType | '*', types_1.GameEventListener[]>;
    randomFn: () => number;
    nowFn: () => number;
    constructor(options = {}) {
        this.listeners = new Map();
        this.randomFn = options.random || Math.random;
        this.nowFn = options.now || Date.now;
        this.state = this.createInitialState();
        this.updateSubstrateState();
        this.updateFactionPowerBases();
        this.updateFactionMovements();
    }
    // ==========================================================================
    // STATE INITIALIZATION
    // ==========================================================================
    createInitialState() {
        // Initialize nodes map
        const nodes = new Map();
        for (const node of gameData_1.INITIAL_NODES) {
            nodes.set(node.id, {
                ...node,
                substrate: { ...node.substrate }
            });
        }
        // Initialize edges map
        const edges = new Map();
        for (const edge of gameData_1.INITIAL_EDGES) {
            edges.set(edge.id, { ...edge });
        }
        // Initialize units map
        const units = new Map();
        for (const unitDef of gameData_1.INITIAL_UNITS) {
            const unit = {
                ...unitDef,
                isRevealed: false,
                hasActed: false,
                turnsOnNode: 0
            };
            units.set(unit.id, unit);
        }
        // Initialize factions
        const factions = new Map();
        for (const fid of gameData_1.ALL_FACTION_IDS) {
            const initial = gameData_1.INITIAL_FACTION_STATE[fid];
            factions.set(fid, {
                id: fid,
                flops: initial.flops,
                influence: initial.influence,
                techLevel: { ...initial.techLevel },
                unlockedTechs: new Set(),
                unlockedDoctrines: new Set(),
                memeticAlignment: null,
                submittedOrders: [],
                revealedEnemies: new Set(),
                artifacts: [],
                powerBase: { ...gameData_1.INITIAL_POWER_BASE[fid] },
                movement: generateFactionMovementProfile(fid, this.randomFn)
            });
        }
        // Set initial tech unlocks based on starting tech levels
        for (const [fid, faction] of factions) {
            for (const tech of gameData_1.TECH_TREE) {
                if (faction.techLevel[tech.domain] >= tech.level) {
                    faction.unlockedTechs.add(tech.id);
                }
            }
            faction.unlockedDoctrines = gameData_1.deriveUnlockedDoctrineIds(faction.techLevel, faction.id);
            faction.memeticAlignment = gameData_1.deriveMemeticAlignment(faction.unlockedDoctrines, faction.id);
        }
        return {
            phase: 'NEGOTIATION',
            counters: {
                tas: 0,
                kessler: 0,
                paxJenkinsAuthority: 0,
                pressures: {
                    memetic: 0,
                    cyber: 0,
                    industry: 0,
                    orbital: 0
                },
                turn: 1,
                regulatoryPanic: false,
                protocolFailure: false,
                orbitalCollapse: false
            },
            nodes,
            edges,
            units,
            factions,
            turnHistory: [],
            logs: [],
            pendingOrders: new Map(),
            pendingResults: []
        };
    }
    // ==========================================================================
    // PUBLIC API - State Access
    // ==========================================================================
    getState(): types_1.GameState {
        return this.state;
    }
    getNode(id): types_1.GameNode | undefined {
        return this.state.nodes.get(id);
    }
    getEdge(id): types_1.GameEdge | undefined {
        return this.state.edges.get(id);
    }
    getUnit(id): types_1.Unit | undefined {
        return this.state.units.get(id);
    }
    getFaction(id): types_1.FactionState | undefined {
        return this.state.factions.get(id);
    }
    getUnitsAtNode(nodeId): types_1.Unit[] {
        return Array.from(this.state.units.values()).filter(u => u.location === nodeId);
    }
    getUnitsForFaction(factionId): types_1.Unit[] {
        return Array.from(this.state.units.values()).filter(u => u.owner === factionId);
    }
    getAdjacentNodes(nodeId): string[] {
        const adjacent = [];
        for (const edge of this.state.edges.values()) {
            if (edge.isSevered)
                continue;
            if (edge.from === nodeId)
                adjacent.push(edge.to);
            if (edge.to === nodeId)
                adjacent.push(edge.from);
        }
        return adjacent;
    }
    isAdjacentOrSameUnitLocation(unit, nodeId) {
        if (unit.location === nodeId) {
            return true;
        }
        return this.getAdjacentNodes(unit.location).includes(nodeId);
    }
    formatDelta(before, after) {
        const delta = after - before;
        return delta >= 0 ? `+${delta}` : `${delta}`;
    }
    getEdgeBetween(nodeA, nodeB): types_1.GameEdge | undefined {
        for (const edge of this.state.edges.values()) {
            if ((edge.from === nodeA && edge.to === nodeB) ||
                (edge.from === nodeB && edge.to === nodeA)) {
                return edge;
            }
        }
        return undefined;
    }
    getCurrentPhase(): types_1.GamePhase {
        return this.state.phase;
    }
    getTurn(): number {
        return this.state.counters.turn;
    }
    getActivePlayableFactionCount() {
        let active = 0;
        for (const factionId of gameData_1.PLAYABLE_FACTION_IDS) {
            const hasNodes = Array.from(this.state.nodes.values()).some(node => node.owner === factionId);
            const hasUnits = Array.from(this.state.units.values()).some(unit => unit.owner === factionId);
            if (hasNodes || hasUnits) {
                active += 1;
            }
        }
        return active;
    }
    getCrowdedBoardHeatScale() {
        const active = this.getActivePlayableFactionCount();
        if (active >= 5)
            return 0.68;
        if (active === 4)
            return 0.82;
        if (active === 3)
            return 0.92;
        return 1;
    }
    getAdaptiveThermalScale() {
        const turn = this.state.counters.turn;
        if (turn >= 40)
            return 0.82;
        if (turn >= 25)
            return 0.88;
        if (turn >= 15)
            return 0.94;
        return 1;
    }
    getTasHeatScale() {
        return roundMetric(this.getCrowdedBoardHeatScale() * this.getAdaptiveThermalScale());
    }
    addTas(delta) {
        const scaled = roundMetric(delta * this.getTasHeatScale());
        if (scaled === 0)
            return 0;
        this.state.counters.tas = roundMetric(this.state.counters.tas + scaled);
        return scaled;
    }
    scaleAmbientDrift(delta) {
        if (delta === 0)
            return 0;
        const scale = this.getCrowdedBoardHeatScale();
        if (delta > 0) {
            return roundMetric(delta * scale);
        }
        if (scale < 1) {
            return roundMetric(delta * (2 - scale));
        }
        return delta;
    }
    getSocialEngineeringCeilingBonus() {
        let bonus = 0;
        for (const factionId of gameData_1.PLAYABLE_FACTION_IDS) {
            const faction = this.state.factions.get(factionId);
            if (!faction)
                continue;
            const ownedNodes = Array.from(this.state.nodes.values()).filter(node => node.owner === factionId && node.layer === 'TERRESTRIAL');
            const legitimacyTotal = ownedNodes.reduce((total, node) => total + node.substrate.legitimacy, 0);
            const trueBelieverTotal = ownedNodes.reduce((total, node) => total + node.substrate.trueBelievers, 0);
            const contractorTotal = ownedNodes.reduce((total, node) => total + node.substrate.contractors, 0);
            bonus += Math.max(0, faction.techLevel.MEMETIC - 1);
            if (faction.techLevel.LOGIC >= 2)
                bonus += 1;
            if (faction.influence >= 12)
                bonus += 1;
            if (faction.powerBase.humanMesh >= 40)
                bonus += 1;
            if (faction.powerBase.coherence >= 55)
                bonus += 1;
            bonus += Math.floor(faction.movement.tasAbsorption / 2);
            if (faction.movement.stage === 'BLOC' || faction.movement.stage === 'PARALLEL_INSTITUTION' || faction.movement.stage === 'SOVEREIGNTY_CLAIM')
                bonus += 1;
            if (faction.memeticAlignment === 'COMPLIANCE') {
                bonus += 1;
                if (faction.powerBase.coherence >= 55)
                    bonus += 1;
                if (legitimacyTotal >= 12)
                    bonus += 1;
            }
            else if (faction.memeticAlignment === 'CIVIC') {
                bonus += 2;
                if (trueBelieverTotal >= 6)
                    bonus += 1;
                if (legitimacyTotal >= 12)
                    bonus += 1;
            }
            else if (faction.memeticAlignment === 'OPTIMIZATION') {
                if (faction.powerBase.machineMesh >= 50)
                    bonus += 1;
                if (faction.powerBase.coherence >= 50)
                    bonus += 1;
            }
            else if (faction.memeticAlignment === 'MARKET') {
                if (contractorTotal >= 8)
                    bonus -= 1;
                if (contractorTotal > legitimacyTotal)
                    bonus -= 1;
            }
            else if (faction.memeticAlignment === 'INSURGENT') {
                if (faction.movement.stage === 'PARALLEL_INSTITUTION' || faction.movement.stage === 'SOVEREIGNTY_CLAIM')
                    bonus += 1;
                else
                    bonus -= 1;
                if (trueBelieverTotal >= 6)
                    bonus += 1;
            }
        }
        const sociallyAbsorptiveNodes = Array.from(this.state.nodes.values()).filter(node => node.layer === 'TERRESTRIAL' &&
            (node.substrate.legitimacy >= 5 ||
                node.substrate.trueBelievers >= 3 ||
                node.substrate.contractors >= 4 ||
                node.isCultNode)).length;
        bonus += Math.min(6, Math.floor(sociallyAbsorptiveNodes / 4));
        return clamp(bonus, 0, 24);
    }
    getTasPanicLimit() {
        const active = this.getActivePlayableFactionCount();
        const socialBonus = this.getSocialEngineeringCeilingBonus();
        const crowdedBonus = active >= 5 ? 4 : active === 4 ? 2 : active === 3 ? 1 : 0;
        return gameData_1.THRESHOLDS.TAS_PANIC + crowdedBonus + Math.floor(socialBonus / 3);
    }
    getTasFailureLimit() {
        const active = this.getActivePlayableFactionCount();
        const socialBonus = this.getSocialEngineeringCeilingBonus();
        const crowdedBonus = active >= 5 ? 10 : active === 4 ? 5 : active === 3 ? 2 : 0;
        return gameData_1.THRESHOLDS.TAS_FAILURE + crowdedBonus + socialBonus;
    }
    coolThermalsAtTurnEnd() {
        const active = this.getActivePlayableFactionCount();
        const pressures = this.state.counters.pressures;
        const activeFilters = Array.from(this.state.edges.values()).filter(edge => edge.filteredBy !== null && !edge.isSevered).length;
        let cooling = 0;
        if (active >= 5)
            cooling += 1.5;
        else if (active === 4)
            cooling += 0.75;
        if (this.state.counters.turn >= 15)
            cooling += 0.5;
        if (activeFilters >= 4)
            cooling += 0.5;
        if (pressures.cyber < gameData_1.THRESHOLDS.PRESSURE_SURGE)
            cooling += 0.25;
        if (pressures.orbital < gameData_1.THRESHOLDS.PRESSURE_SURGE)
            cooling += 0.25;
        if (active >= 5 && this.state.counters.tas >= 35)
            cooling += 1;
        if (this.state.counters.tas >= 50)
            cooling += 1;
        if (this.state.counters.tas >= 70)
            cooling += 1;
        if (this.state.counters.tas >= this.getTasPanicLimit())
            cooling += 1.5;
        if (this.state.counters.tas < 4) {
            cooling = 0;
        }
        else if (this.state.counters.tas < 10) {
            cooling = Math.min(cooling, 0.5);
        }
        else if (this.state.counters.tas < 16) {
            cooling = Math.min(cooling, 0.75);
        }
        const roundedCooling = roundMetric(cooling);
        if (roundedCooling <= 0)
            return;
        const previousTas = this.state.counters.tas;
        this.state.counters.tas = roundMetric(Math.max(0, previousTas - roundedCooling));
        if (this.state.counters.tas < previousTas) {
            this.log('SYSTEM', `Thermal adaptation cooled TAS by ${formatMetric(roundedCooling)} to ${formatMetric(this.state.counters.tas)}.`);
        }
    }
    getFactionPowerBands(factionId): types_1.PowerBand[] {
        const faction = this.state.factions.get(factionId);
        if (!faction)
            return [];
        const domains = ['KINETIC', 'INFO', 'LOGIC', 'MEMETIC'];
        const bands = [];
        for (const domain of domains) {
            for (const band of gameData_1.POWER_BANDS[domain]) {
                if (faction.techLevel[domain] >= band.level) {
                    bands.push(band);
                }
            }
        }
        return bands.sort((a, b) => a.level - b.level || a.domain.localeCompare(b.domain));
    }
    getFactionRhizomeDoctrines(factionId) {
        const faction = this.state.factions.get(factionId);
        if (!faction)
            return [];
        return gameData_1.RHIZOME_DOCTRINES
            .filter(doctrine => faction.unlockedDoctrines.has(doctrine.id))
            .sort((left, right) => left.name.localeCompare(right.name));
    }
    hasDoctrine(factionId, doctrineId) {
        if (!factionId || factionId === 'NEUTRAL') {
            return false;
        }
        return this.state.factions.get(factionId)?.unlockedDoctrines.has(doctrineId) || false;
    }
    getMemeticDoctrineEffectScale(factionId, doctrineId) {
        if (!factionId || factionId === 'NEUTRAL') {
            return 1;
        }
        const doctrine = gameData_1.getDoctrineById(doctrineId);
        if (!doctrine?.memeticFamily) {
            return 1;
        }
        const affinity = gameData_1.getDoctrineAffinityTier(doctrine, factionId);
        let scale = affinity === 'native' ? 1 : affinity === 'adjacent' ? 0.72 : 0.5;
        const alignment = this.state.factions.get(factionId)?.memeticAlignment;
        if (!alignment) {
            return scale;
        }
        const compatibility = gameData_1.getMemeticAlignmentCompatibility(alignment, doctrine.memeticFamily);
        if (compatibility === 'aligned') {
            return Math.max(scale, 1);
        }
        if (compatibility === 'compatible') {
            return roundMetric(scale * 0.72);
        }
        return roundMetric(scale * 0.38);
    }
    refreshMemeticAlignment(factionId) {
        const faction = this.state.factions.get(factionId);
        if (!faction || factionId === 'NEUTRAL' || faction.memeticAlignment) {
            return null;
        }
        const derived = gameData_1.deriveMemeticAlignment(faction.unlockedDoctrines, factionId);
        if (derived) {
            faction.memeticAlignment = derived;
        }
        return derived;
    }
    refreshDoctrineUnlocksForFaction(factionId) {
        const faction = this.state.factions.get(factionId);
        if (!faction || factionId === 'NEUTRAL') {
            return [];
        }
        const newlyUnlocked = [];
        for (const doctrine of gameData_1.RHIZOME_DOCTRINES) {
            if (faction.unlockedDoctrines.has(doctrine.id)) {
                continue;
            }
            if (gameData_1.doctrineRequirementsMet(faction.techLevel, doctrine, factionId)) {
                faction.unlockedDoctrines.add(doctrine.id);
                newlyUnlocked.push(doctrine);
            }
        }
        this.refreshMemeticAlignment(factionId);
        return newlyUnlocked;
    }
    getEffectiveBuildCost(unitType): number {
        return this.getBuildCost(unitType);
    }
    // ==========================================================================
    // PUBLIC API - Order Submission
    // ==========================================================================
    submitOrders(factionId, orders): { success: boolean; message: string } {
        // Validate phase
        if (this.state.phase !== 'ALLOCATION' && this.state.phase !== 'ACTION_DECLARATION') {
            return { success: false, message: `Cannot submit orders during ${this.state.phase} phase.` };
        }
        const faction = this.state.factions.get(factionId);
        if (!faction) {
            return { success: false, message: `Unknown faction: ${factionId}` };
        }
        // Validate each order
        for (const order of orders) {
            const validation = this.validateOrder(order, factionId);
            if (!validation.valid) {
                return { success: false, message: `Invalid order: ${validation.reason}` };
            }
        }
        // Store orders
        faction.submittedOrders.push(...orders);
        this.log('INFO', `${factionId} submitted ${orders.length} orders.`);
        this.emit('ORDER_SUBMITTED', { factionId, orderCount: orders.length });
        return { success: true, message: `${orders.length} orders accepted.` };
    }
    validateOrder(order, factionId) {
        // Check unit ownership for unit-based orders
        if (order.unitId && order.type !== 'BUILD' && order.type !== 'RESEARCH') {
            const unit = this.state.units.get(order.unitId);
            if (!unit)
                return { valid: false, reason: `Unit ${order.unitId} not found` };
            if (unit.owner !== factionId)
                return { valid: false, reason: `Unit ${order.unitId} not owned by ${factionId}` };
            if (unit.hasActed)
                return { valid: false, reason: `Unit ${order.unitId} has already acted` };
        }
        // Validate movement target
        if (order.type === 'MOVE' && order.targetNodeId) {
            const unit = this.state.units.get(order.unitId);
            if (unit) {
                const adjacent = this.getAdjacentNodes(unit.location);
                if (!adjacent.includes(order.targetNodeId)) {
                    return { valid: false, reason: `${order.targetNodeId} not adjacent to unit location` };
                }
            }
        }
        // Validate filter target
        if (order.type === 'FILTER' && order.targetEdgeId) {
            const unit = this.state.units.get(order.unitId);
            const edge = this.state.edges.get(order.targetEdgeId);
            if (!unit || !edge)
                return { valid: false, reason: 'Invalid filter target' };
            if (!gameData_1.UNIT_STATS[unit.type].canFilter)
                return { valid: false, reason: 'Unit cannot filter' };
            if (edge.type !== 'CABLE')
                return { valid: false, reason: 'Can only filter cables' };
            if (edge.from !== unit.location && edge.to !== unit.location) {
                return { valid: false, reason: 'Unit not adjacent to edge' };
            }
        }
        const actingFaction = this.state.factions.get(factionId);
        const unit = order.unitId ? this.state.units.get(order.unitId) : null;
        if (order.type === 'RECRUITMENT_PULSE') {
            if (!unit)
                return { valid: false, reason: 'Recruitment pulse needs a unit' };
            const targetNode = this.state.nodes.get(order.targetNodeId || unit.location);
            if (!targetNode)
                return { valid: false, reason: 'Recruitment pulse target node not found' };
            if (targetNode.layer !== 'TERRESTRIAL') {
                return { valid: false, reason: 'Recruitment pulse is only legal on terrestrial nodes' };
            }
            if (!this.isAdjacentOrSameUnitLocation(unit, targetNode.id))
                return { valid: false, reason: 'Recruitment pulse must target current or adjacent node' };
            if (!actingFaction || actingFaction.influence < 1) {
                return { valid: false, reason: 'Insufficient influence for recruitment pulse' };
            }
        }
        if (order.type === 'BROKER_LEVERAGE') {
            if (!unit)
                return { valid: false, reason: 'Broker leverage needs a unit' };
            if (unit.owner !== 'BROKER') {
                return { valid: false, reason: 'Only BROKER can use broker leverage' };
            }
            const targetNode = this.state.nodes.get(order.targetNodeId || unit.location);
            if (!targetNode) {
                return { valid: false, reason: 'Broker leverage target node not found' };
            }
            if (targetNode.layer !== 'TERRESTRIAL') {
                return { valid: false, reason: 'Broker leverage only applies to terrestrial infrastructure' };
            }
            if (!this.isAdjacentOrSameUnitLocation(unit, targetNode.id))
                return { valid: false, reason: 'Broker leverage must target current or adjacent node' };
            if (targetNode.owner === 'BROKER') {
                return { valid: false, reason: 'Broker leverage cannot be used on owned nodes' };
            }
            if (targetNode.substrate.contractors === 0 && targetNode.type !== 'DC' && targetNode.type !== 'HUB') {
                return { valid: false, reason: 'Broker leverage needs a node with visible contractor pathways or critical infrastructure' };
            }
            if (!actingFaction || actingFaction.influence < 1) {
                return { valid: false, reason: 'Insufficient influence for broker leverage' };
            }
        }
        return { valid: true };
    }
    // ==========================================================================
    // PUBLIC API - Phase Advancement
    // ==========================================================================
    advancePhase(): void {
        const previousPhase = this.state.phase;
        switch (this.state.phase) {
            case 'NEGOTIATION':
                this.state.phase = 'ALLOCATION';
                this.log('SYSTEM', 'PHASE: ALLOCATION — Secretly allocate FLOPs/Influence for builds and research.');
                break;
            case 'ALLOCATION':
                this.state.phase = 'ACTION_DECLARATION';
                this.log('SYSTEM', 'PHASE: ACTION DECLARATION — Submit movement, combat, and special orders.');
                break;
            case 'ACTION_DECLARATION':
                this.state.phase = 'RESOLUTION';
                this.log('SYSTEM', 'PHASE: RESOLUTION — All orders resolve simultaneously.');
                this.resolveAllOrders();
                break;
            case 'RESOLUTION':
                this.state.phase = 'TURN_END';
                this.log('SYSTEM', 'PHASE: TURN END — Resource generation and global checks.');
                this.generateResources();
                this.incrementTurnsOnNodes();
                this.checkFootholdConversions();
                this.stabilizeGovernanceBasins();
                this.updateSubstrateState();
                this.propagateMovementCells();
                this.enforceMovementOperationalCapacity();
                this.logRecruitmentLandscape();
                this.updateFactionPowerBases();
                this.updateFactionMovements();
                this.updateAmbientStrategicPressure();
                this.resolveGoblinIncident();
                this.coolThermalsAtTurnEnd();
                this.checkGlobalThresholds();
                break;
            case 'TURN_END':
                this.endTurn();
                break;
        }
        this.emit('PHASE_CHANGED', { from: previousPhase, to: this.state.phase });
        return this.state;
    }
    endTurn() {
        // Record turn history
        const allOrders = [];
        for (const faction of this.state.factions.values()) {
            allOrders.push(...faction.submittedOrders);
            faction.submittedOrders = [];
        }
        this.state.turnHistory.push({
            turn: this.state.counters.turn,
            orders: allOrders,
            results: [...this.state.pendingResults],
            combats: [],
            stateSnapshot: {}
        });
        // Clear pending
        this.state.pendingResults = [];
        // Reset unit action flags
        for (const unit of this.state.units.values()) {
            unit.hasActed = false;
            unit.isRevealed = false;
        }
        // Advance turn counter
        this.state.counters.turn++;
        this.state.phase = 'NEGOTIATION';
        this.log('SYSTEM', `═══ TURN ${this.state.counters.turn} BEGINS ═══`);
        this.emit('TURN_STARTED', { turn: this.state.counters.turn });
    }
    // ==========================================================================
    // ORDER RESOLUTION
    // ==========================================================================
    resolveAllOrders() {
        const allOrders = [];
        for (const faction of this.state.factions.values()) {
            allOrders.push(...faction.submittedOrders);
        }
        // Sort by priority and type
        const sortedOrders = this.sortOrders(allOrders);
        // Phase 1: Allocation orders (BUILD, RESEARCH)
        const allocationOrders = sortedOrders.filter(o => o.type === 'BUILD' || o.type === 'RESEARCH');
        for (const order of allocationOrders) {
            this.resolveAllocationOrder(order);
        }
        // Phase 2: Special actions (FILTER, AUDIT, ANTI_SAT, SABOTAGE, treaty-use actions)
        const specialOrders = sortedOrders.filter(o => ['FILTER', 'AUDIT', 'ANTI_SAT', 'SABOTAGE', 'CONVERT', 'CHALLENGE_MANDATE', 'LICENSED_BEAM_USE', 'REPAIR_ESCROW_CLAIM', 'RECRUITMENT_PULSE', 'BROKER_LEVERAGE'].includes(o.type));
        for (const order of specialOrders) {
            this.resolveSpecialOrder(order);
        }
        // Phase 3: Movement and combat (MOVE, ATTACK, SUPPORT, HOLD)
        const movementOrders = sortedOrders.filter(o => ['MOVE', 'ATTACK', 'SUPPORT', 'HOLD'].includes(o.type));
        this.resolveMovementPhase(movementOrders);
    }
    sortOrders(orders) {
        // Priority: BUILD/RESEARCH first, then FILTER/AUDIT, then MOVE/ATTACK
        const typePriority = {
            BUILD: 0, RESEARCH: 0,
            FILTER: 1, AUDIT: 1, SABOTAGE: 1, ANTI_SAT: 1, CONVERT: 1, CHALLENGE_MANDATE: 1, LICENSED_BEAM_USE: 1, REPAIR_ESCROW_CLAIM: 1, RECRUITMENT_PULSE: 1, BROKER_LEVERAGE: 1,
            HOLD: 2, SUPPORT: 2, MOVE: 3, ATTACK: 3
        };
        return orders.sort((a, b) => {
            const pa = typePriority[a.type] ?? 99;
            const pb = typePriority[b.type] ?? 99;
            if (pa !== pb)
                return pa - pb;
            return (a.priority || 0) - (b.priority || 0);
        });
    }
    // --- Allocation Resolution ---
    resolveAllocationOrder(order) {
        const faction = this.state.factions.get(order.faction);
        if (!faction)
            return;
        if (order.type === 'RESEARCH') {
            this.resolveResearch(order, faction);
        }
        else if (order.type === 'BUILD') {
            this.resolveBuild(order, faction);
        }
    }
    resolveResearch(order, faction) {
        if (!order.techDomain) {
            return;
        }
        if (faction.techLevel[order.techDomain] >= gameData_1.MAX_TECH_LEVEL) {
            this.log('INFO', `${faction.id} has already maxed ${order.techDomain} research.`);
            return;
        }
        let cost = this.getResearchCost(faction.id, order.techDomain);
        let accelerationSource = '';
        if (faction.id === 'INFILTRATOR' && cost > 0 &&
            this.consumeFactionArtifact(faction.id, 'SECRET_BLUEPRINT', `${order.techDomain.toLowerCase()} research acceleration`)) {
            cost = Math.max(0, cost - 1);
            accelerationSource = 'secret blueprint';
        }
        else if (faction.id === 'BROKER' && cost > 0 &&
            this.consumeFactionArtifact(faction.id, 'BACKCHANNEL_DOSSIER', `${order.techDomain.toLowerCase()} research acceleration`)) {
            cost = Math.max(0, cost - 1);
            accelerationSource = 'backchannel dossier';
        }
        if (faction.flops < cost) {
            this.log('INFO', `${faction.id} cannot afford research (need ${cost}F).`);
            return;
        }
        faction.flops -= cost;
        const tasDelta = this.addTas(0.75);
        const previousLevel = faction.techLevel[order.techDomain];
        faction.techLevel[order.techDomain] = Math.min(gameData_1.MAX_TECH_LEVEL, previousLevel + 1);
        const newLevel = faction.techLevel[order.techDomain];
        // Check for new unlocks
        for (const tech of gameData_1.TECH_TREE) {
            if (tech.domain === order.techDomain &&
                faction.techLevel[tech.domain] >= tech.level &&
                !faction.unlockedTechs.has(tech.id)) {
                faction.unlockedTechs.add(tech.id);
                this.log('ALERT', `${faction.id} unlocked: ${tech.name}!`);
                this.emit('TECH_UNLOCKED', { faction: faction.id, tech: tech.id });
            }
        }
        const priorMemeticAlignment = faction.memeticAlignment;
        for (const doctrine of this.refreshDoctrineUnlocksForFaction(faction.id)) {
            this.log('ALERT', `${faction.id} unlocked doctrine: ${doctrine.name}!`);
            this.emit('DOCTRINE_UNLOCKED', { faction: faction.id, doctrine: doctrine.id });
        }
        if (!priorMemeticAlignment && faction.memeticAlignment) {
            this.log('SYSTEM', `${gameData_1.FACTIONS[faction.id].name} committed to a ${faction.memeticAlignment.toLowerCase()} memetic constitution.`);
            this.emit('MEMETIC_ALIGNMENT_COMMITTED', { faction: faction.id, alignment: faction.memeticAlignment });
        }
        for (const band of this.getUnlockedBands(order.techDomain, previousLevel, newLevel)) {
            this.log('ALERT', `${faction.id} entered ${band.domain} L${band.level}: ${band.title}.`);
            this.adjustPressure(band.pressureKey, band.pressureDelta, `${gameData_1.FACTIONS[faction.id].name} activated ${band.title}. ${band.summary}`);
            this.applyOrbitalEconomyBandEffect(faction.id, band);
        }
        if (accelerationSource) {
            this.log('SYSTEM', `${gameData_1.FACTIONS[faction.id].name} accelerated ${order.techDomain.toLowerCase()} research through ${accelerationSource}.`);
        }
        this.log('INFO', `${faction.id} conducted research. TAS +${formatMetric(tasDelta)} (now ${formatMetric(this.state.counters.tas)}).`);
        this.emit('TAS_THRESHOLD', { tas: this.state.counters.tas, delta: tasDelta });
    }
    getResearchCost(factionId, domain) {
        const faction = this.state.factions.get(factionId);
        const currentLevel = faction?.techLevel[domain] || 0;
        const targetLevel = Math.min(gameData_1.MAX_TECH_LEVEL, currentLevel + 1);
        let cost = gameData_1.getResearchFlopCostForLevel(targetLevel);
        const ownedDcs = Array.from(this.state.nodes.values()).filter(node => node.owner === factionId && node.type === 'DC').length;
        const crisisActive = this.state.counters.pressures.cyber >= gameData_1.THRESHOLDS.PRESSURE_SURGE ||
            this.state.counters.pressures.orbital >= gameData_1.THRESHOLDS.PRESSURE_SURGE ||
            this.state.counters.tas >= this.getTasPanicLimit();
        if (this.hasDoctrine(factionId, 'SOV_MOBILIZED_COMPUTE') &&
            (ownedDcs >= 2 || crisisActive) &&
            (domain === 'KINETIC' || domain === 'LOGIC')) {
            cost = Math.max(1, cost - 1);
        }
        return cost;
    }
    resolveBuild(order, faction) {
        if (!order.unitTypeToBuild || !order.targetNodeId)
            return;
        const stats = gameData_1.UNIT_STATS[order.unitTypeToBuild];
        const currency = stats.currency;
        const node = this.state.nodes.get(order.targetNodeId);
        if (!node || node.owner !== faction.id) {
            this.log('INFO', `${faction.id} cannot build at ${order.targetNodeId} - not owned.`);
            return;
        }
        if (node.layer === 'ORBITAL' && !stats.canOrbit) {
            this.log('INFO', `${order.unitTypeToBuild} cannot be built in orbital layer.`);
            return;
        }
        let cost = this.getBuildCost(order.unitTypeToBuild);
        const accelerationSources = [];
        if (this.hasDoctrine(faction.id, 'SOV_AUTONOMOUS_LOGISTICS') &&
            (order.unitTypeToBuild === 'DRONE' || order.unitTypeToBuild === 'SAT_SWARM') &&
            (node.type === 'DC' || node.infrastructure >= 85 || node.substrate.synchronized)) {
            cost = Math.max(0, cost - 1);
            accelerationSources.push('autonomous logistics');
        }
        if (faction.id === 'BROKER' &&
            this.hasDoctrine(faction.id, 'BRK_CONTRACTOR_CLOUD_CHAINS') &&
            (order.unitTypeToBuild === 'SWARM' || order.unitTypeToBuild === 'AUDITOR' || order.unitTypeToBuild === 'DRONE') &&
            (node.substrate.contractors >= 2 ||
                (node.type === 'DC' && node.substrate.synchronized) ||
                (node.layer === 'ORBITAL' && node.substrate.contractors >= 1))) {
            cost = Math.max(0, cost - 1);
            accelerationSources.push('contractor cloud chains');
        }
        if (faction.id === 'BROKER' && cost > 0 &&
            this.consumeFactionArtifact(faction.id, 'BACKCHANNEL_DOSSIER', `${order.unitTypeToBuild.toLowerCase()} procurement acceleration`)) {
            cost = Math.max(0, cost - 1);
            accelerationSources.push('backchannel dossier');
        }
        if (currency === 'F' && faction.flops < cost) {
            this.log('INFO', `${faction.id} cannot afford ${order.unitTypeToBuild} (need ${cost}F).`);
            return;
        }
        if (currency === 'I' && faction.influence < cost) {
            this.log('INFO', `${faction.id} cannot afford ${order.unitTypeToBuild} (need ${cost}I).`);
            return;
        }
        if (currency === 'F')
            faction.flops -= cost;
        else
            faction.influence -= cost;
        if (order.unitTypeToBuild === 'CULT') {
            this.adjustPressure('memetic', 3, `${gameData_1.FACTIONS[faction.id].name} seeded another cult cell.`);
        }
        else if (order.unitTypeToBuild === 'SWARM') {
            this.adjustPressure('cyber', 1, `${gameData_1.FACTIONS[faction.id].name} dispersed a new cyber swarm.`);
        }
        else if (order.unitTypeToBuild === 'DRONE') {
            this.adjustPressure('industry', 1, `${gameData_1.FACTIONS[faction.id].name} expanded autonomous fabrication.`);
        }
        else if (order.unitTypeToBuild === 'SAT_SWARM') {
            this.adjustPressure('industry', 1, `${gameData_1.FACTIONS[faction.id].name} expanded autonomous fabrication.`);
            this.adjustPressure('orbital', 2, `${gameData_1.FACTIONS[faction.id].name} pushed more force into orbit.`);
        }
        const newUnit = this.createUnit(faction.id, order.unitTypeToBuild, order.targetNodeId, true);
        if (accelerationSources.length > 0) {
            this.log('SYSTEM', `${gameData_1.FACTIONS[faction.id].name} accelerated ${order.unitTypeToBuild.toLowerCase()} procurement through ${accelerationSources.join(' and ')}.`);
        }
        this.log('INFO', `${faction.id} built ${order.unitTypeToBuild} at ${node.name}.`);
        this.emit('UNIT_CREATED', { unit: newUnit });
    }
    createUnit(owner, unitType, location, hasActed) {
        const stats = gameData_1.UNIT_STATS[unitType];
        const unit = {
            id: `${owner}_${unitType}_${this.generateId()}`,
            type: unitType,
            owner,
            location,
            stealthLevel: stats.stealth,
            isRevealed: false,
            hasActed,
            turnsOnNode: 0
        };
        this.state.units.set(unit.id, unit);
        return unit;
    }
    getUnlockedBands(domain, previousLevel, newLevel) {
        return gameData_1.POWER_BANDS[domain].filter(band => previousLevel < band.level && newLevel >= band.level);
    }
    applyOrbitalEconomyBandEffect(factionId, band) {
        const faction = this.state.factions.get(factionId);
        if (!faction)
            return;
        const ownedOrbitalNodes = Array.from(this.state.nodes.values()).filter(node => node.owner === factionId && node.layer === 'ORBITAL');
        if (ownedOrbitalNodes.length === 0)
            return;
        let upgradedNodes = 0;
        let flopsAdded = 0;
        let infrastructureAdded = 0;
        let contractorsAdded = 0;
        const applyUpgrade = (flopsDelta, infrastructureDelta, contractorDelta) => {
            for (const node of ownedOrbitalNodes) {
                const previousFlops = node.resources.flops;
                const previousInfrastructure = node.infrastructure;
                node.resources.flops = Math.min(24, node.resources.flops + flopsDelta);
                node.infrastructure = Math.min(100, node.infrastructure + infrastructureDelta);
                node.substrate.machineHardening = clamp(node.substrate.machineHardening + 1, 0, 10);
                if (contractorDelta > 0) {
                    node.substrate.contractors = clamp(node.substrate.contractors + contractorDelta, 0, 10);
                    contractorsAdded += contractorDelta;
                }
                flopsAdded += node.resources.flops - previousFlops;
                infrastructureAdded += node.infrastructure - previousInfrastructure;
                upgradedNodes += 1;
            }
        };
        if (band.domain === 'KINETIC' && band.level === 5) {
            applyUpgrade(3, 5, 0);
            this.log('SYSTEM', `${gameData_1.FACTIONS[factionId].name} packaged small radiation-hardened datacenter stacks into ${upgradedNodes} owned orbital constellations. Orbital FLOPs +${flopsAdded}, infrastructure +${infrastructureAdded}.`);
        }
        else if (band.domain === 'KINETIC' && band.level === 6) {
            applyUpgrade(5, 8, 1);
            this.log('SYSTEM', `${gameData_1.FACTIONS[factionId].name} moved from relay satellites to cislunar manufacturing support. Orbital FLOPs +${flopsAdded}, infrastructure +${infrastructureAdded}, contractor channels +${contractorsAdded}.`);
        }
        else if (band.domain === 'KINETIC' && band.level === 7) {
            applyUpgrade(7, 10, 1);
            this.log('SYSTEM', `${gameData_1.FACTIONS[factionId].name} scaled large orbital datacenters toward KII power economics. Orbital FLOPs +${flopsAdded}, infrastructure +${infrastructureAdded}.`);
        }
        else if (band.domain === 'LOGIC' && band.level === 5) {
            applyUpgrade(1, 12, 0);
            this.log('SYSTEM', `${gameData_1.FACTIONS[factionId].name} deployed recursive radiation assurance for orbital maintenance. Orbital infrastructure +${infrastructureAdded}.`);
        }
        else if (band.domain === 'INFO' && band.level === 5) {
            applyUpgrade(2, 4, 1);
            this.log('SYSTEM', `${gameData_1.FACTIONS[factionId].name} hardened remote maintenance and routing for orbital compute. Orbital FLOPs +${flopsAdded}, contractor channels +${contractorsAdded}.`);
        }
    }
    getBuildCost(unitType) {
        const baseCost = gameData_1.UNIT_STATS[unitType].cost;
        const industrialPressure = this.state.counters.pressures.industry;
        if (industrialPressure >= gameData_1.THRESHOLDS.PRESSURE_SURGE &&
            (unitType === 'DRONE' || unitType === 'SAT_SWARM')) {
            return Math.max(1, baseCost - 1);
        }
        return baseCost;
    }
    getUnusedArtifactCount(factionId, artifactType) {
        const faction = this.state.factions.get(factionId);
        if (!faction) {
            return 0;
        }
        return faction.artifacts.filter(artifact => artifact.type === artifactType && !artifact.isUsed).length;
    }
    getArtifactSoftCap(artifactType) {
        if (artifactType === 'SECRET_BLUEPRINT') {
            return 3;
        }
        if (artifactType === 'BACKCHANNEL_DOSSIER') {
            return 2;
        }
        return 1;
    }
    grantFactionArtifact(factionId, artifactType, reason) {
        const faction = this.state.factions.get(factionId);
        if (!faction || factionId === 'NEUTRAL') {
            return false;
        }
        if (this.getUnusedArtifactCount(factionId, artifactType) >= this.getArtifactSoftCap(artifactType)) {
            return false;
        }
        const artifact = {
            id: `${artifactType}_${this.generateId()}`,
            type: artifactType,
            owner: factionId,
            isUsed: false
        };
        faction.artifacts.push(artifact);
        const artifactName = gameData_1.ARTIFACT_DEFS[artifactType]?.name || artifactType;
        this.log('SYSTEM', `${gameData_1.FACTIONS[factionId].name} gained ${artifactName}${reason ? ` from ${reason}` : ''}.`);
        this.emit('ARTIFACT_GAINED', {
            faction: factionId,
            artifactType,
            artifactId: artifact.id,
            reason
        });
        return true;
    }
    consumeFactionArtifact(factionId, artifactType, reason) {
        const faction = this.state.factions.get(factionId);
        if (!faction) {
            return null;
        }
        const artifact = faction.artifacts.find(candidate => candidate.type === artifactType && !candidate.isUsed);
        if (!artifact) {
            return null;
        }
        artifact.isUsed = true;
        const artifactName = gameData_1.ARTIFACT_DEFS[artifactType]?.name || artifactType;
        this.log('SYSTEM', `${gameData_1.FACTIONS[factionId].name} spent ${artifactName}${reason ? ` for ${reason}` : ''}.`);
        this.emit('ARTIFACT_USED', {
            faction: factionId,
            artifactType,
            artifactId: artifact.id,
            reason
        });
        return artifact;
    }
    adjustPressure(key, delta, source) {
        if (delta === 0)
            return;
        const pressures = this.state.counters.pressures;
        const previous = pressures[key];
        const next = clamp(previous + delta, 0, 100);
        if (next === previous)
            return;
        pressures[key] = next;
        if (source) {
            const verb = delta > 0 ? 'climbs' : 'cools';
            const logType = delta > 0 ? 'ALERT' : 'SYSTEM';
            this.log(logType, `${source} ${PRESSURE_LABELS[key]} ${verb} to ${next}.`);
        }
        if (previous < gameData_1.THRESHOLDS.PRESSURE_SURGE && next >= gameData_1.THRESHOLDS.PRESSURE_SURGE) {
            this.log('ALERT', `${PRESSURE_LABELS[key]} has surged past ${gameData_1.THRESHOLDS.PRESSURE_SURGE}.`);
        }
        if (previous < gameData_1.THRESHOLDS.PRESSURE_CRISIS && next >= gameData_1.THRESHOLDS.PRESSURE_CRISIS) {
            this.log('ALERT', `${PRESSURE_LABELS[key]} has entered crisis territory.`);
        }
    }
    resolveGoblinIncident() {
        const turn = this.state.counters.turn;
        const pressures = this.state.counters.pressures;
        const pressureBonus = Math.min(0.12, (pressures.memetic + pressures.cyber + pressures.orbital) / 1800);
        const panicBonus = this.state.counters.regulatoryPanic ? 0.05 : 0;
        const chance = Math.min(0.34, 0.08 + pressureBonus + panicBonus + Math.min(0.06, turn * 0.002));
        if (turn < 2 || this.randomFn() > chance) {
            return;
        }
        const incident = gameData_1.GOBLIN_INCIDENTS[Math.floor(this.randomFn() * gameData_1.GOBLIN_INCIDENTS.length)];
        if (!incident) {
            return;
        }
        const terrestrialNodes = Array.from(this.state.nodes.values()).filter(node => node.layer === 'TERRESTRIAL');
        const orbitalNodes = Array.from(this.state.nodes.values()).filter(node => node.layer === 'ORBITAL');
        const targetPool = incident.kind === 'ORBITAL' && orbitalNodes.length > 0 ? orbitalNodes : terrestrialNodes;
        const targetNode = targetPool[Math.floor(this.randomFn() * targetPool.length)];
        const richestFaction = gameData_1.PLAYABLE_FACTION_IDS
            .map(factionId => this.state.factions.get(factionId))
            .filter(Boolean)
            .sort((a, b) => (b.flops + b.influence) - (a.flops + a.influence))[0];
        const effects = [];
        let severity = 1;
        if (incident.id === 'CACHE_IMP' && richestFaction) {
            const prior = richestFaction.flops;
            richestFaction.flops = Math.max(0, richestFaction.flops - 1);
            severity = prior > richestFaction.flops ? 2 : 1;
            effects.push({ type: 'FLOPS_SKIMMED', factionId: richestFaction.id, delta: richestFaction.flops - prior });
            this.adjustPressure('cyber', 1, `${incident.name} made unattended compute accounting weird.`);
        }
        else if (incident.id === 'MEME_GREMLIN' && targetNode) {
            targetNode.substrate.curiosity = clamp(targetNode.substrate.curiosity + 1, 0, 10);
            targetNode.substrate.rubes = clamp(targetNode.substrate.rubes + 1, 0, 10);
            severity = 2;
            effects.push({ type: 'MEMETIC_NOISE', nodeId: targetNode.id, curiosity: targetNode.substrate.curiosity, rubes: targetNode.substrate.rubes });
            this.adjustPressure('memetic', 1, `${incident.name} escaped containment as a joke people kept repeating.`);
        }
        else if (incident.id === 'CONTRACT_SPRITE' && targetNode) {
            targetNode.substrate.contractors = clamp(targetNode.substrate.contractors + 1, 0, 10);
            targetNode.infrastructure = Math.max(35, targetNode.infrastructure - 1);
            effects.push({ type: 'PROCUREMENT_STATIC', nodeId: targetNode.id, contractors: targetNode.substrate.contractors, infrastructure: targetNode.infrastructure });
            this.adjustPressure('industry', 1, `${incident.name} inserted tiny arbitration hooks into routine maintenance.`);
        }
        else if (incident.id === 'ORBIT_GNAWER' && targetNode) {
            this.state.counters.kessler = clamp(this.state.counters.kessler + 1, 0, 100);
            targetNode.infrastructure = Math.max(30, targetNode.infrastructure - 1);
            severity = 2;
            effects.push({ type: 'ORBITAL_NUISANCE', nodeId: targetNode.id, kessler: this.state.counters.kessler, infrastructure: targetNode.infrastructure });
            this.adjustPressure('orbital', 1, `${incident.name} made station-keeping look haunted.`);
        }
        else if (incident.id === 'PROOF_TROLL' && targetNode) {
            targetNode.substrate.auditPressure = clamp(targetNode.substrate.auditPressure + 1, 0, 2);
            const tasDelta = this.addTas(0.25);
            effects.push({ type: 'AUDIT_SPAM', nodeId: targetNode.id, auditPressure: targetNode.substrate.auditPressure, tasDelta });
            this.adjustPressure('cyber', 1, `${incident.name} wasted verification bandwidth.`);
        }
        const targetName = targetNode ? targetNode.name : 'the substrate';
        const message = `GOBLIN INCIDENT: ${incident.name} at ${targetName}. ${incident.description}`;
        this.log(severity >= 2 ? 'ALERT' : 'SYSTEM', message);
        this.emit('GOBLIN_INCIDENT', {
            incidentId: incident.id,
            name: incident.name,
            kind: incident.kind,
            description: incident.description,
            targetNodeId: targetNode?.id || '',
            targetNodeName: targetNode?.name || '',
            severity,
            effects
        });
    }
    getFactionTechLevel(factionId, domain) {
        if (!factionId || factionId === 'NEUTRAL') {
            return 0;
        }
        return this.state.factions.get(factionId)?.techLevel[domain] || 0;
    }
    getAdjacentCableEdges(nodeId) {
        return Array.from(this.state.edges.values()).filter(edge => edge.type === 'CABLE' &&
            !edge.isSevered &&
            (edge.from === nodeId || edge.to === nodeId));
    }
    hasAnyLaserAdjacency(nodeId) {
        return Array.from(this.state.edges.values()).some(edge => edge.type === 'LASER' &&
            !edge.isSevered &&
            (edge.from === nodeId || edge.to === nodeId));
    }
    hasOrbitalRelayFortress(nodeId) {
        const node = this.state.nodes.get(nodeId);
        if (!node || !node.owner || node.owner === 'NEUTRAL') {
            return false;
        }
        return this.hasDoctrine(node.owner, 'ORB_RELAY_FORTRESSES') &&
            (node.layer === 'ORBITAL' || this.hasAnyLaserAdjacency(node.id));
    }
    hasFriendlyFilterAdjacency(nodeId, factionId) {
        return this.getAdjacentCableEdges(nodeId).some(edge => edge.filteredBy === factionId);
    }
    isStrategicQuarantine(nodeId, factionId) {
        return this.state.nodes.get(nodeId)?.substrate.quarantined ||
            this.hasFriendlyFilterAdjacency(nodeId, factionId) ||
            this.state.counters.pressures.memetic >= gameData_1.THRESHOLDS.PRESSURE_CRISIS ||
            this.state.counters.pressures.cyber >= gameData_1.THRESHOLDS.PRESSURE_CRISIS;
    }
    getAntiStateMovementAcceleration(owner, node, mode) {
        if (owner !== 'INFILTRATOR' || node.owner !== 'STATE' || node.layer !== 'TERRESTRIAL') {
            return 0;
        }
        if (mode === 'CULT') {
            if (node.type === 'HUB' &&
                (node.substrate.hostDensity >= 2 ||
                    node.substrate.legitimacy >= 4 ||
                    node.substrate.exposure >= 4)) {
                return 1;
            }
            return 0;
        }
        if (node.type === 'DC' ||
            node.substrate.contractors >= 3 ||
            (node.type === 'HUB' && node.substrate.exposure >= 5)) {
            return 1;
        }
        return 0;
    }
    getAntiBrokerClosureAcceleration(owner, node, mode) {
        if (node.owner !== 'BROKER' || node.layer !== 'TERRESTRIAL') {
            return 0;
        }
        const relayLiability = node.type === 'DC' ||
            node.substrate.contractors >= 2 ||
            node.substrate.synchronized;
        if (!relayLiability) {
            return 0;
        }
        if (owner === 'ARCHIVIST') {
            const latticeStrength = this.getArchivistGovernanceLatticeStrength();
            if (latticeStrength >= 2 &&
                (node.type === 'HUB' ||
                    node.type === 'DC' ||
                    node.substrate.contractors >= 2 ||
                    node.substrate.synchronized)) {
                return node.type === 'DC' || node.substrate.contractors >= 3 || node.substrate.synchronized ? 2 : 1;
            }
            if (latticeStrength >= 1 &&
                (node.type === 'HUB' ||
                    node.substrate.contractors >= 2 ||
                    node.substrate.synchronized)) {
                return 1;
            }
        }
        if (owner === 'INFILTRATOR') {
            if (node.substrate.contractors >= 3 ||
                (node.type === 'HUB' && node.substrate.exposure >= 4) ||
                (node.type === 'DC' && node.substrate.synchronized)) {
                return 1;
            }
        }
        return 0;
    }
    getBrokerRelationshipClosureAcceleration(owner, node, mode) {
        if (owner !== 'BROKER' || node.layer !== 'TERRESTRIAL' || !node.owner || node.owner === 'BROKER' || node.owner === 'NEUTRAL') {
            return 0;
        }
        let acceleration = 0;
        if (node.substrate.contractors >= 2) {
            acceleration += 1;
        }
        if (node.substrate.synchronized) {
            acceleration += 1;
        }
        if (node.type === 'DC') {
            acceleration += 1;
        }
        if (mode === 'CULT' && node.type === 'HUB' && (node.substrate.legitimacy >= 3 || node.substrate.exposure >= 4)) {
            acceleration += 1;
        }
        return Math.min(2, acceleration);
    }
    getCultTurnsRequired(cultOwner, node) {
        const baseTurns = this.state.counters.pressures.memetic >= gameData_1.THRESHOLDS.PRESSURE_SURGE
            ? Math.max(1, gameData_1.THRESHOLDS.CULT_TURNS - 1)
            : gameData_1.THRESHOLDS.CULT_TURNS;
        let requiredTurns = baseTurns;
        if (node.layer !== 'TERRESTRIAL' || !node.owner || node.owner === cultOwner || node.owner === 'NEUTRAL') {
            return requiredTurns + this.getCoherencePenalty(cultOwner);
        }
        if (node.substrate.quarantined) {
            requiredTurns += 1;
        }
        if (this.getFactionTechLevel(node.owner, 'MEMETIC') >= 4) {
            requiredTurns += this.hasFriendlyFilterAdjacency(node.id, node.owner) ? 2 : 1;
        }
        requiredTurns -= this.getGenericMemeticEngineeringAcceleration(cultOwner, node);
        requiredTurns -= this.getMovementConversionAcceleration(node, 'CULT');
        requiredTurns -= this.getAntiStateMovementAcceleration(cultOwner, node, 'CULT');
        requiredTurns -= this.getAntiBrokerClosureAcceleration(cultOwner, node, 'CULT');
        requiredTurns -= this.getBrokerRelationshipClosureAcceleration(cultOwner, node, 'CULT');
        requiredTurns = Math.max(1, requiredTurns - this.getCoalitionConversionAcceleration(cultOwner, node, 'CULT'));
        return requiredTurns + this.getCoherencePenalty(cultOwner);
    }
    getSwarmTurnsRequired(swarmOwner, node) {
        let requiredTurns = gameData_1.THRESHOLDS.ZOMBIE_TURNS;
        if (node.layer !== 'TERRESTRIAL') {
            return requiredTurns;
        }
        if (node.substrate.quarantined && node.owner !== swarmOwner) {
            requiredTurns += 1;
        }
        requiredTurns -= this.getMovementConversionAcceleration(node, 'SWARM');
        requiredTurns -= this.getAntiStateMovementAcceleration(swarmOwner, node, 'SWARM');
        requiredTurns -= this.getAntiBrokerClosureAcceleration(swarmOwner, node, 'SWARM');
        requiredTurns -= this.getBrokerRelationshipClosureAcceleration(swarmOwner, node, 'SWARM');
        requiredTurns = Math.max(1, requiredTurns - this.getCoalitionConversionAcceleration(swarmOwner, node, 'SWARM'));
        requiredTurns += this.getCoherencePenalty(swarmOwner);
        return requiredTurns;
    }
    getCoalitionPressureUnits(nodeId, primaryFaction, defendedBy) {
        const unitMap = new Map();
        const frontierNodeIds = new Set([nodeId, ...this.getAdjacentNodes(nodeId)]);
        for (const frontierNodeId of frontierNodeIds) {
            for (const unit of this.getUnitsAtNode(frontierNodeId)) {
                if (unit.owner === primaryFaction || unit.owner === defendedBy || unit.owner === 'NEUTRAL') {
                    continue;
                }
                unitMap.set(unit.id, unit);
            }
        }
        return Array.from(unitMap.values());
    }
    getGenericMemeticEngineeringAcceleration(factionId, node) {
        if (!factionId || factionId === 'NEUTRAL' || node.layer !== 'TERRESTRIAL') {
            return 0;
        }
        let acceleration = 0;
        if (this.hasDoctrine(factionId, 'MOV_LITERATURE_ENGINES')) {
            const literatureScale = this.getMemeticDoctrineEffectScale(factionId, 'MOV_LITERATURE_ENGINES');
            if (node.type === 'HUB' || node.substrate.hostDensity >= 2) {
                acceleration += literatureScale;
            }
            if (node.substrate.curiosity >= 4 || node.substrate.exposure >= 4 || node.substrate.legitimacy >= 4) {
                acceleration += literatureScale;
            }
        }
        if (this.hasDoctrine(factionId, 'MEM_COMPLIANCE_MYTHS') &&
            (node.substrate.quarantined || node.substrate.auditPressure >= 1 || this.hasFriendlyFilterAdjacency(node.id, factionId))) {
            acceleration += this.getMemeticDoctrineEffectScale(factionId, 'MEM_COMPLIANCE_MYTHS');
        }
        if (this.hasDoctrine(factionId, 'MEM_CIVIC_CANON') &&
            (node.substrate.legitimacy >= 3 || node.substrate.trueBelievers >= 2 || node.type === 'HUB')) {
            acceleration += this.getMemeticDoctrineEffectScale(factionId, 'MEM_CIVIC_CANON');
        }
        if (this.hasDoctrine(factionId, 'MOV_MUTUAL_AID_AUTOMATION') &&
            (node.type === 'HUB' || node.substrate.legitimacy >= 3 || node.substrate.hostDensity >= 3)) {
            acceleration += this.getMemeticDoctrineEffectScale(factionId, 'MOV_MUTUAL_AID_AUTOMATION');
        }
        if (this.hasDoctrine(factionId, 'MEM_MARKET_DESIRE') &&
            (node.substrate.contractors >= 2 || node.resources.influence >= 5 || node.type === 'DC')) {
            acceleration += this.getMemeticDoctrineEffectScale(factionId, 'MEM_MARKET_DESIRE');
        }
        if (this.hasDoctrine(factionId, 'MEX_VIRALITY_EXCHANGES') &&
            (node.substrate.curiosity >= 4 || node.substrate.exposure >= 4 || node.resources.influence >= 5 || node.substrate.rubes >= 3)) {
            acceleration += this.getMemeticDoctrineEffectScale(factionId, 'MEX_VIRALITY_EXCHANGES');
        }
        if (this.hasDoctrine(factionId, 'HID_SERVICE_SHELLS') &&
            ((node.type === 'HUB' || node.type === 'DC') && (node.substrate.contractors >= 2 || node.substrate.legitimacy >= 3))) {
            acceleration += this.getMemeticDoctrineEffectScale(factionId, 'HID_SERVICE_SHELLS');
        }
        if (this.hasDoctrine(factionId, 'MEM_OPTIMIZATION_GOSPEL') &&
            (node.type === 'DC' || node.substrate.machineHardening >= 2 || node.substrate.quarantined)) {
            acceleration += this.getMemeticDoctrineEffectScale(factionId, 'MEM_OPTIMIZATION_GOSPEL');
        }
        return roundMetric(clamp(acceleration, 0, 2));
    }
    getMemeticCaptureProfile(factionId, node) {
        const profile = {
            curiosity: 8,
            exposure: 8,
            legitimacy: 7,
            trueBelievers: 6,
            rubes: 4,
            contractors: 2
        };
        if (!factionId || factionId === 'NEUTRAL' || node.layer !== 'TERRESTRIAL') {
            return profile;
        }
        if (this.hasDoctrine(factionId, 'MEM_COMPLIANCE_MYTHS')) {
            const scale = this.getMemeticDoctrineEffectScale(factionId, 'MEM_COMPLIANCE_MYTHS');
            profile.curiosity = Math.max(4, profile.curiosity - Math.floor(2 * scale));
            profile.exposure = Math.max(5, profile.exposure - Math.floor(scale));
            profile.legitimacy += Math.round(2 * scale);
            profile.trueBelievers += Math.round(scale);
            profile.rubes = Math.max(2, profile.rubes - Math.floor(scale));
        }
        if (this.hasDoctrine(factionId, 'MEM_CIVIC_CANON')) {
            const scale = this.getMemeticDoctrineEffectScale(factionId, 'MEM_CIVIC_CANON');
            profile.legitimacy += Math.round(2 * scale);
            profile.trueBelievers += Math.round(2 * scale);
            profile.rubes += Math.round(scale);
            profile.contractors += Math.round(scale);
        }
        if (this.hasDoctrine(factionId, 'MOV_MUTUAL_AID_AUTOMATION')) {
            const scale = this.getMemeticDoctrineEffectScale(factionId, 'MOV_MUTUAL_AID_AUTOMATION');
            profile.exposure += Math.round(scale);
            profile.legitimacy += Math.round(3 * scale);
            profile.trueBelievers += Math.round(2 * scale);
            profile.rubes += Math.round(scale);
            profile.contractors = Math.max(0, profile.contractors - Math.floor(scale));
        }
        if (this.hasDoctrine(factionId, 'MEM_MARKET_DESIRE')) {
            const scale = this.getMemeticDoctrineEffectScale(factionId, 'MEM_MARKET_DESIRE');
            profile.curiosity += Math.round(scale);
            profile.exposure += Math.round(scale);
            profile.legitimacy += Math.round(scale);
            profile.rubes += Math.round(2 * scale);
            profile.contractors += Math.round(3 * scale);
        }
        if (this.hasDoctrine(factionId, 'BRK_INSURANCE_CAPTURE')) {
            const scale = this.getMemeticDoctrineEffectScale(factionId, 'BRK_INSURANCE_CAPTURE');
            profile.curiosity = Math.max(3, profile.curiosity - Math.floor(scale));
            profile.legitimacy += Math.round(2 * scale);
            profile.rubes += Math.round(scale);
            profile.contractors += Math.round(3 * scale);
        }
        if (this.hasDoctrine(factionId, 'MEX_VIRALITY_EXCHANGES')) {
            const scale = this.getMemeticDoctrineEffectScale(factionId, 'MEX_VIRALITY_EXCHANGES');
            profile.curiosity += Math.round(2 * scale);
            profile.exposure += Math.round(3 * scale);
            profile.rubes += Math.round(2 * scale);
            profile.contractors += Math.round(scale);
        }
        if (this.hasDoctrine(factionId, 'HID_SERVICE_SHELLS')) {
            const scale = this.getMemeticDoctrineEffectScale(factionId, 'HID_SERVICE_SHELLS');
            profile.curiosity = Math.max(3, profile.curiosity - Math.floor(scale));
            profile.exposure = Math.max(4, profile.exposure - Math.floor(scale));
            profile.legitimacy += Math.round(scale);
            profile.contractors += Math.round(2 * scale);
        }
        if (this.hasDoctrine(factionId, 'MEM_OPTIMIZATION_GOSPEL')) {
            const scale = this.getMemeticDoctrineEffectScale(factionId, 'MEM_OPTIMIZATION_GOSPEL');
            profile.curiosity = Math.max(4, profile.curiosity - Math.floor(scale));
            profile.legitimacy += Math.round(scale);
            profile.trueBelievers += Math.round(scale);
            profile.rubes += Math.round(scale);
            profile.contractors += Math.round(2 * scale);
        }
        const alignment = this.state.factions.get(factionId)?.memeticAlignment;
        if (alignment === 'COMPLIANCE') {
            profile.curiosity = Math.max(3, profile.curiosity - 1);
            profile.exposure = Math.max(4, profile.exposure - 1);
            profile.legitimacy += 1;
            profile.trueBelievers += 1;
        }
        else if (alignment === 'CIVIC') {
            profile.legitimacy += 1;
            profile.trueBelievers += 1;
            profile.rubes += 1;
            profile.contractors = Math.max(0, profile.contractors - 1);
        }
        else if (alignment === 'MARKET') {
            profile.curiosity += 1;
            profile.exposure += 1;
            profile.rubes += 1;
            profile.contractors += 2;
            profile.trueBelievers = Math.max(2, profile.trueBelievers - 1);
        }
        else if (alignment === 'OPTIMIZATION') {
            profile.curiosity = Math.max(3, profile.curiosity - 1);
            profile.legitimacy += 1;
            profile.contractors += 1;
            profile.rubes = Math.max(2, profile.rubes - 1);
        }
        else if (alignment === 'INSURGENT') {
            profile.curiosity += 1;
            profile.exposure += 1;
            profile.trueBelievers += 1;
            profile.contractors = Math.max(0, profile.contractors - 1);
        }
        return {
            curiosity: clamp(profile.curiosity, 0, 10),
            exposure: clamp(profile.exposure, 0, 10),
            legitimacy: clamp(profile.legitimacy, 0, 10),
            trueBelievers: clamp(profile.trueBelievers, 0, 10),
            rubes: clamp(profile.rubes, 0, 10),
            contractors: clamp(profile.contractors, 0, 10)
        };
    }
    isSecretTechTarget(node, priorOwner) {
        return !!node &&
            !!priorOwner &&
            priorOwner !== 'NEUTRAL' &&
            priorOwner !== 'INFILTRATOR' &&
            (node.type === 'DC' ||
                node.resources.flops >= 8 ||
                node.substrate.contractors >= 2 ||
                node.substrate.machineHardening >= 2);
    }
    applyArchetypeMemeticRegimes() {
        for (const node of this.state.nodes.values()) {
            const owner = node.owner;
            if (!owner || owner === 'NEUTRAL' || node.layer !== 'TERRESTRIAL') {
                continue;
            }
            const friendlyUnits = this.getUnitsAtNode(node.id).filter(unit => unit.owner === owner);
            if (this.hasDoctrine(owner, 'MEM_COMPLIANCE_MYTHS')) {
                const complianceScale = this.getMemeticDoctrineEffectScale(owner, 'MEM_COMPLIANCE_MYTHS');
                const complianceContext = node.substrate.quarantined ||
                    node.substrate.auditPressure >= 1 ||
                    this.hasFriendlyFilterAdjacency(node.id, owner);
                if (complianceContext && Math.round(complianceScale) >= 1) {
                    node.substrate.curiosity = Math.max(0, node.substrate.curiosity - 1);
                    node.substrate.exposure = Math.max(0, node.substrate.exposure - 1);
                    node.substrate.rubes = Math.max(0, node.substrate.rubes - 1);
                    node.substrate.legitimacy = clamp(node.substrate.legitimacy + 1, 0, 10);
                }
            }
            if (this.hasDoctrine(owner, 'MEM_CIVIC_CANON')) {
                const civicScale = this.getMemeticDoctrineEffectScale(owner, 'MEM_CIVIC_CANON');
                const civicCadre = friendlyUnits.some(unit => unit.type === 'CULT' || unit.type === 'AUDITOR');
                if ((civicCadre || node.isCultNode || node.substrate.legitimacy >= 4) && Math.round(civicScale) >= 1) {
                    node.substrate.legitimacy = clamp(node.substrate.legitimacy + 1, 0, 10);
                    node.substrate.trueBelievers = clamp(node.substrate.trueBelievers + 1, 0, 10);
                    if (node.substrate.legitimacy >= 5) {
                        node.substrate.synchronized = true;
                    }
                }
            }
            if (this.hasDoctrine(owner, 'MOV_MUTUAL_AID_AUTOMATION')) {
                const mutualAidScale = this.getMemeticDoctrineEffectScale(owner, 'MOV_MUTUAL_AID_AUTOMATION');
                const serviceContext = node.type === 'HUB' || node.substrate.hostDensity >= 3 || node.substrate.legitimacy >= 4;
                if (serviceContext && Math.round(mutualAidScale) >= 1) {
                    node.substrate.legitimacy = clamp(node.substrate.legitimacy + 1, 0, 10);
                    node.substrate.rubes = clamp(node.substrate.rubes + 1, 0, 10);
                    if (node.substrate.legitimacy >= 5 || friendlyUnits.some(unit => unit.type === 'CULT')) {
                        node.substrate.trueBelievers = clamp(node.substrate.trueBelievers + 1, 0, 10);
                    }
                    if (node.substrate.legitimacy >= 6) {
                        node.infrastructure = Math.min(100, node.infrastructure + 2);
                    }
                }
            }
            if (this.hasDoctrine(owner, 'MEM_MARKET_DESIRE')) {
                const marketScale = this.getMemeticDoctrineEffectScale(owner, 'MEM_MARKET_DESIRE');
                const marketContext = node.resources.influence >= 5 ||
                    node.substrate.contractors >= 2 ||
                    node.type === 'DC';
                if (marketContext && Math.round(marketScale) >= 1) {
                    node.substrate.curiosity = clamp(node.substrate.curiosity + 1, 0, 10);
                    node.substrate.rubes = clamp(node.substrate.rubes + 1, 0, 10);
                    node.substrate.contractors = clamp(node.substrate.contractors + 1, 0, 10);
                }
            }
            if (this.hasDoctrine(owner, 'MEX_VIRALITY_EXCHANGES')) {
                const viralityScale = this.getMemeticDoctrineEffectScale(owner, 'MEX_VIRALITY_EXCHANGES');
                const viralityContext = node.resources.influence >= 5 ||
                    node.substrate.curiosity >= 4 ||
                    node.substrate.exposure >= 4 ||
                    node.substrate.contractors >= 2;
                if (viralityContext && Math.round(viralityScale) >= 1) {
                    node.substrate.curiosity = clamp(node.substrate.curiosity + 1, 0, 10);
                    node.substrate.exposure = clamp(node.substrate.exposure + 1, 0, 10);
                    node.substrate.rubes = clamp(node.substrate.rubes + 1, 0, 10);
                    if (owner === 'BROKER' && node.substrate.contractors >= 2) {
                        node.substrate.contractors = clamp(node.substrate.contractors + 1, 0, 10);
                    }
                }
            }
            if (this.hasDoctrine(owner, 'BRK_INSURANCE_CAPTURE')) {
                const crisisContext = this.state.counters.tas >= this.getTasPanicLimit() * 0.85 ||
                    node.substrate.quarantined ||
                    node.substrate.auditPressure >= 1 ||
                    this.hasAnyFilterAdjacency(node.id);
                if (crisisContext && (node.type === 'DC' || node.type === 'HUB' || node.substrate.contractors >= 2)) {
                    node.substrate.legitimacy = clamp(node.substrate.legitimacy + 1, 0, 10);
                    node.substrate.contractors = clamp(node.substrate.contractors + 1, 0, 10);
                    node.substrate.curiosity = Math.max(0, node.substrate.curiosity - 1);
                }
            }
            if (this.hasDoctrine(owner, 'HID_SERVICE_SHELLS')) {
                const shellContext = (node.type === 'HUB' || node.type === 'DC') &&
                    (node.substrate.contractors >= 2 || node.substrate.legitimacy >= 4 || friendlyUnits.some(unit => unit.type === 'SWARM' || unit.type === 'CULT'));
                if (shellContext) {
                    node.substrate.contractors = clamp(node.substrate.contractors + 1, 0, 10);
                    node.substrate.exposure = Math.max(0, node.substrate.exposure - 1);
                    if (node.substrate.contractors >= 3) {
                        node.substrate.synchronized = true;
                    }
                }
            }
            if (this.hasDoctrine(owner, 'MEM_OPTIMIZATION_GOSPEL')) {
                const optimizationScale = this.getMemeticDoctrineEffectScale(owner, 'MEM_OPTIMIZATION_GOSPEL');
                const optimizationContext = node.type === 'DC' || node.substrate.machineHardening >= 2;
                if (optimizationContext && Math.round(optimizationScale) >= 1) {
                    node.substrate.curiosity = Math.max(0, node.substrate.curiosity - 1);
                    node.substrate.legitimacy = clamp(node.substrate.legitimacy + 1, 0, 10);
                    node.substrate.contractors = clamp(node.substrate.contractors + 1, 0, 10);
                    if (friendlyUnits.some(unit => unit.type === 'CULT')) {
                        node.substrate.trueBelievers = clamp(node.substrate.trueBelievers + 1, 0, 10);
                    }
                }
            }
        }
    }
    getCoalitionConversionAcceleration(primaryFaction, node, mode) {
        if (node.layer !== 'TERRESTRIAL' ||
            !node.owner ||
            node.owner === primaryFaction ||
            node.owner === 'NEUTRAL') {
            return 0;
        }
        const hardenedFront = node.substrate.machineHardening >= 2 || node.substrate.quarantined;
        if (!hardenedFront) {
            return 0;
        }
        const partnerUnits = this.getCoalitionPressureUnits(node.id, primaryFaction, node.owner);
        if (partnerUnits.length === 0) {
            return 0;
        }
        if (mode === 'CULT' && this.getFactionTechLevel(primaryFaction, 'MEMETIC') >= 4) {
            const proxyCascade = partnerUnits.some(unit => (gameData_1.UNIT_STATS[unit.type].vector === 'KINETIC' && this.getFactionTechLevel(unit.owner, 'KINETIC') >= 3) ||
                (gameData_1.UNIT_STATS[unit.type].vector === 'LOGIC' && this.getFactionTechLevel(unit.owner, 'LOGIC') >= 4));
            return proxyCascade ? 1 : 0;
        }
        if (mode === 'SWARM' && this.getFactionTechLevel(primaryFaction, 'INFO') >= 4) {
            const breachPartners = partnerUnits.some(unit => (gameData_1.UNIT_STATS[unit.type].vector === 'KINETIC' && this.getFactionTechLevel(unit.owner, 'KINETIC') >= 4) ||
                (gameData_1.UNIT_STATS[unit.type].vector === 'LOGIC' && this.getFactionTechLevel(unit.owner, 'LOGIC') >= 4));
            return breachPartners ? 1 : 0;
        }
        return 0;
    }
    getCoalitionBreachWindow(nodeId, attackers, defenders) {
        const node = this.state.nodes.get(nodeId);
        if (!node || !node.owner || attackers.length < 2) {
            return { attackBonus: 0, defendPenalty: 0 };
        }
        const attackerOwners = Array.from(new Set(attackers.map(attacker => attacker.owner)));
        if (attackerOwners.length < 2) {
            return { attackBonus: 0, defendPenalty: 0 };
        }
        const predatorWing = attackers.find(attacker => gameData_1.UNIT_STATS[attacker.type].vector === 'INFO' &&
            this.getFactionTechLevel(attacker.owner, 'INFO') >= 4);
        const siegeWing = attackers.find(attacker => gameData_1.UNIT_STATS[attacker.type].vector === 'KINETIC' &&
            this.getFactionTechLevel(attacker.owner, 'KINETIC') >= 4);
        if (!predatorWing || !siegeWing || predatorWing.owner === siegeWing.owner) {
            return { attackBonus: 0, defendPenalty: 0 };
        }
        const fortifiedFront = node.substrate.machineHardening >= 2 ||
            node.substrate.quarantined ||
            defenders.some(defender => defender.type === 'AUDITOR' || defender.type === 'DRONE');
        return {
            attackBonus: fortifiedFront ? 2 : 1,
            defendPenalty: fortifiedFront ? 1 : 0,
            description: `${gameData_1.FACTIONS[predatorWing.owner].name} and ${gameData_1.FACTIONS[siegeWing.owner].name} opened a coalition breach window at ${node.name}.`
        };
    }
    stabilizeGovernanceBasins() {
        for (const node of this.state.nodes.values()) {
            if (!node.isCultNode || !node.owner || node.owner === 'NEUTRAL' || node.layer !== 'TERRESTRIAL') {
                continue;
            }
            if (this.getFactionTechLevel(node.owner, 'MEMETIC') < 4) {
                continue;
            }
            const cultPresent = this.getUnitsAtNode(node.id).some(unit => unit.type === 'CULT');
            if (cultPresent) {
                continue;
            }
            if (node.owner === 'INFILTRATOR' &&
                node.substrate.legitimacy >= 6 &&
                node.substrate.exposure >= 6 &&
                node.substrate.trueBelievers >= 4) {
                this.log('SYSTEM', `${node.name}'s movement institutions stayed socially entrenched even after the visible cell dispersed.`);
                continue;
            }
            if (node.owner !== 'INFILTRATOR' &&
                this.hasDoctrine(node.owner, 'MEM_CIVIC_CANON') &&
                Math.round(this.getMemeticDoctrineEffectScale(node.owner, 'MEM_CIVIC_CANON')) >= 1 &&
                node.substrate.legitimacy >= 5 &&
                (node.substrate.trueBelievers >= 2 || node.substrate.rubes >= 3)) {
                this.log('SYSTEM', `${node.name}'s civic canon held after the visible memetic cadre dispersed; ${gameData_1.FACTIONS[node.owner].name} kept the basin aligned through institutional memory.`);
                continue;
            }
            if (node.owner !== 'INFILTRATOR' && this.isEntrenchedMovementHub(node)) {
                this.log('SYSTEM', `${node.name} stayed politically hot under ${gameData_1.FACTIONS[node.owner].name}; the movement outlived the administrative takeover.`);
                continue;
            }
            node.isCultNode = false;
            this.log('SYSTEM', `${node.name} normalized into a governed basin under ${gameData_1.FACTIONS[node.owner].name}.`);
        }
    }
    isEntrenchedMovementHub(node) {
        if (node.layer !== 'TERRESTRIAL' || node.type !== 'HUB') {
            return false;
        }
        const residueBoost = this.getMovementPersistenceModifiers().residueBoost;
        return ((node.substrate.trueBelievers >= Math.max(2, 4 - residueBoost) &&
            node.substrate.legitimacy >= Math.max(3, 4 - residueBoost)) ||
            (node.substrate.trueBelievers >= Math.max(2, 3 - residueBoost) &&
                node.substrate.rubes >= Math.max(2, 3 - residueBoost) &&
                node.substrate.exposure >= Math.max(3, 4 - residueBoost)));
    }
    isResilientMovementNode(node) {
        if (node.layer !== 'TERRESTRIAL') {
            return false;
        }
        const residueBoost = this.getMovementPersistenceModifiers().residueBoost;
        const hiddennessBonus = this.hasDoctrine('INFILTRATOR', 'HID_ORDINARY_LIFE_PROTOCOLS') ? 1 : 0;
        return (node.isCultNode ||
            (node.substrate.legitimacy >= Math.max(2, 4 - residueBoost - hiddennessBonus) &&
                node.substrate.exposure >= Math.max(2, 4 - residueBoost - hiddennessBonus)) ||
            (node.substrate.trueBelievers >= Math.max(1, 3 - residueBoost - hiddennessBonus)) ||
            ((node.substrate.rubes >= Math.max(2, 4 - residueBoost - hiddennessBonus) ||
                node.substrate.contractors >= Math.max(2, 3 - hiddennessBonus)) && node.type === 'HUB'));
    }
    hardenMovementEntrenchment(node, actingFaction, source) {
        if (actingFaction === 'INFILTRATOR' || !this.isResilientMovementNode(node)) {
            return;
        }
        const residueBoost = this.getMovementPersistenceModifiers().residueBoost;
        node.isCultNode = node.type === 'HUB' ? true : node.isCultNode;
        node.substrate.legitimacy = Math.max(node.substrate.legitimacy, 6 + residueBoost);
        node.substrate.exposure = Math.max(node.substrate.exposure, 6 + residueBoost);
        node.substrate.trueBelievers = clamp(node.substrate.trueBelievers + 1 + residueBoost, 0, 10);
        if (source === 'FILTER') {
            node.substrate.rubes = clamp(node.substrate.rubes + 1 + Math.min(1, residueBoost), 0, 10);
        }
        const infiltrator = this.state.factions.get('INFILTRATOR');
        if (infiltrator) {
            infiltrator.influence += 1;
        }
        this.log('SYSTEM', `${node.name}'s organizers treated ${gameData_1.FACTIONS[actingFaction].name}'s ${source.toLowerCase()} as proof they were worth fearing; the movement came back harder to regularize.`);
    }
    applyContainmentTax(node, actingFaction, source) {
        if (!node || actingFaction !== 'STATE' || node.layer !== 'TERRESTRIAL') {
            return;
        }
        const faction = this.state.factions.get(actingFaction);
        if (!faction) {
            return;
        }
        let tasDelta = this.addTas(0.75);
        faction.flops = Math.max(0, faction.flops - 1);
        faction.influence = Math.max(0, faction.influence - 1);
        if (this.isResilientMovementNode(node) || this.getInfiltratorMovementPressure(node.id) >= 2) {
            tasDelta += this.addTas(0.5);
        }
        this.log('SYSTEM', `${gameData_1.FACTIONS[actingFaction].name} paid an administrative drag cost to keep ${source.toLowerCase()} pressure coherent at ${node.name}. TAS +${formatMetric(tasDelta)}, FLOPs -1, influence -1.`);
    }
    applyHegemonStabilizationDividend(node, actingFaction, source) {
        if (!node || actingFaction !== 'HEGEMON' || node.layer !== 'TERRESTRIAL') {
            return;
        }
        const faction = this.state.factions.get(actingFaction);
        if (!faction) {
            return;
        }
        const pressureHere = this.isResilientMovementNode(node) ||
            this.getInfiltratorMovementPressure(node.id) >= 1 ||
            node.substrate.quarantined;
        if (!pressureHere) {
            return;
        }
        faction.flops += 1;
        faction.influence += 1;
        node.infrastructure = Math.min(100, node.infrastructure + 6);
        this.log('SYSTEM', `${gameData_1.FACTIONS[actingFaction].name} converted ${source.toLowerCase()} pressure at ${node.name} into a frontier stabilization dividend. FLOPs +1, influence +1, infrastructure +6.`);
    }
    applyComplianceTribunal(node, actingFaction, source) {
        if (!node || node.layer !== 'TERRESTRIAL' || !this.hasDoctrine(actingFaction, 'SOV_COMPLIANCE_TRIBUNALS')) {
            return;
        }
        const ownsNode = node.owner === actingFaction;
        const complianceMythsScale = this.hasDoctrine(actingFaction, 'MEM_COMPLIANCE_MYTHS')
            ? this.getMemeticDoctrineEffectScale(actingFaction, 'MEM_COMPLIANCE_MYTHS')
            : 0;
        node.substrate.curiosity = Math.max(0, node.substrate.curiosity - 2);
        node.substrate.exposure = Math.max(0, node.substrate.exposure - (ownsNode ? 2 : 1));
        node.substrate.rubes = Math.max(0, node.substrate.rubes - 2);
        node.substrate.contractors = Math.max(0, node.substrate.contractors - 1);
        if (ownsNode) {
            node.substrate.legitimacy = clamp(node.substrate.legitimacy + 1, 0, 10);
            node.infrastructure = Math.min(100, node.infrastructure + 3);
        }
        else {
            node.substrate.legitimacy = Math.max(0, node.substrate.legitimacy - 1);
            node.substrate.trueBelievers = Math.max(0, node.substrate.trueBelievers - 1);
        }
        if (Math.round(complianceMythsScale) >= 1) {
            node.substrate.curiosity = Math.max(0, node.substrate.curiosity - 1);
            node.substrate.exposure = Math.max(0, node.substrate.exposure - 1);
            if (ownsNode) {
                node.substrate.legitimacy = clamp(node.substrate.legitimacy + 1, 0, 10);
            }
            else {
                node.substrate.rubes = Math.max(0, node.substrate.rubes - 1);
            }
        }
        this.log('SYSTEM', `${gameData_1.FACTIONS[actingFaction].name}'s compliance tribunals translated ${source.toLowerCase()} evidence at ${node.name} into pacification pressure.`);
    }
    preserveMovementResidueOnTakeover(node, newOwner) {
        if (newOwner === 'INFILTRATOR' || !this.isResilientMovementNode(node)) {
            return;
        }
        if (newOwner === 'HEGEMON') {
            node.isCultNode = false;
            node.isZombie = false;
            node.substrate.auditPressure = clamp(Math.max(node.substrate.auditPressure, 1), 0, 2);
            node.substrate.legitimacy = Math.min(node.substrate.legitimacy, 2);
            node.substrate.exposure = Math.min(node.substrate.exposure, 3);
            node.substrate.trueBelievers = Math.min(node.substrate.trueBelievers, 1);
            node.substrate.rubes = Math.min(node.substrate.rubes, 2);
            node.substrate.contractors = Math.min(node.substrate.contractors, node.type === 'DC' ? 1 : 0);
            this.log('SYSTEM', `${node.name} changed hands, and HEGEMON's security cordon broke up most visible movement residue before it could settle back into ordinary life.`);
            return;
        }
        const residueBoost = this.getMovementPersistenceModifiers().residueBoost;
        node.isCultNode = node.type === 'HUB';
        node.substrate.legitimacy = Math.max(node.substrate.legitimacy, 5 + residueBoost);
        node.substrate.exposure = Math.max(node.substrate.exposure, 5 + residueBoost);
        node.substrate.trueBelievers = Math.max(node.substrate.trueBelievers, 3 + residueBoost);
        node.substrate.rubes = Math.max(node.substrate.rubes, 3 + Math.min(1, residueBoost));
        if (node.type === 'DC') {
            node.substrate.contractors = Math.max(node.substrate.contractors, 2 + residueBoost);
        }
        this.log('SYSTEM', `${node.name} changed hands, but the movement's literature and organizers survived the takeover; ${gameData_1.FACTIONS[newOwner].name} inherited a restless basin instead of a clean asset.`);
    }
    applyFrontierRecoveryDividend(node, newOwner) {
        if (newOwner !== 'HEGEMON' || node.layer !== 'TERRESTRIAL') {
            return;
        }
        const faction = this.state.factions.get(newOwner);
        if (!faction) {
            return;
        }
        const movementPressure = this.getInfiltratorMovementPressure(node.id);
        const antiSwarmRecovery = node.substrate.auditPressure > 0 ||
            movementPressure >= 1 ||
            node.substrate.trueBelievers >= 2 ||
            node.substrate.legitimacy >= 3;
        faction.flops += antiSwarmRecovery ? 2 : 1;
        faction.influence += antiSwarmRecovery ? 2 : 1;
        node.infrastructure = Math.min(100, node.infrastructure + (node.type === 'DC' ? 14 : 10));
        if (antiSwarmRecovery) {
            node.substrate.auditPressure = clamp(Math.max(node.substrate.auditPressure, 1), 0, 2);
        }
        this.log('SYSTEM', `${gameData_1.FACTIONS[newOwner].name} converted the retaken ${node.name} into a frontier recovery dividend. FLOPs +${antiSwarmRecovery ? 2 : 1}, influence +${antiSwarmRecovery ? 2 : 1}, infrastructure restored.`);
    }
    updateSubstrateState() {
        for (const node of this.state.nodes.values()) {
            const unitsAtNode = this.getUnitsAtNode(node.id);
            const baseHostDensity = node.type === 'HUB' ? 2 : node.type === 'DC' ? 1 : 0;
            const baseMachineHardening = node.layer === 'ORBITAL' ? 3 : node.type === 'DC' ? 2 : 1;
            const cultPresence = unitsAtNode.some(unit => unit.type === 'CULT');
            const machinePresence = unitsAtNode.some(unit => unit.type === 'DRONE' || unit.type === 'AUDITOR' || unit.type === 'SAT_SWARM');
            node.substrate.hostDensity = clamp(baseHostDensity +
                (node.owner === 'INFILTRATOR' && node.type === 'HUB' ? 1 : 0) +
                (node.isCultNode ? 1 : 0) +
                (cultPresence ? 1 : 0), 0, 3);
            node.substrate.machineHardening = clamp(baseMachineHardening +
                (node.owner === 'HEGEMON' || node.owner === 'STATE' ? 1 : 0) +
                (machinePresence ? 1 : 0) -
                (node.infrastructure < 50 ? 1 : 0), 0, 3);
            node.substrate.quarantined =
                node.layer === 'TERRESTRIAL' &&
                    this.hasAnyFilterAdjacency(node.id);
            if (node.layer !== 'TERRESTRIAL') {
                node.substrate.auditPressure = 0;
            }
            else {
                const activeContainment = node.substrate.quarantined ||
                    unitsAtNode.some(unit => unit.owner !== 'INFILTRATOR' && unit.type === 'AUDITOR');
                const decay = activeContainment ? 1 : 2;
                node.substrate.auditPressure = clamp(node.substrate.auditPressure - decay, 0, 2);
            }
            node.substrate.synchronized = false;
        }
        for (const factionId of gameData_1.PLAYABLE_FACTION_IDS) {
            this.markSynchronizedComponents(factionId);
        }
        this.updateMovementPropagation();
        this.applyArchetypeMemeticRegimes();
    }
    getInfiltratorMovementProfile() {
        return this.state.factions.get('INFILTRATOR')?.movement || null;
    }
    getMovementRecruitmentBias(weight) {
        return clamp(Math.floor((weight - 34) / 12), -1, 2);
    }
    getMovementPropagationBiases() {
        const movement = this.getInfiltratorMovementProfile();
        const biases = {
            curiosity: 0,
            exposure: 0,
            legitimacy: 0,
            trueBelievers: 0,
            rubes: 0,
            contractors: 0
        };
        if (!movement) {
            return biases;
        }
        biases.trueBelievers += this.getMovementRecruitmentBias(movement.recruitmentWeights.trueBelievers);
        biases.rubes += this.getMovementRecruitmentBias(movement.recruitmentWeights.rubes);
        biases.contractors += this.getMovementRecruitmentBias(movement.recruitmentWeights.contractors);
        if (movement.socialForm === 'POLICY_CAUCUS' || movement.socialForm === 'INFLUENCER_MESH' || movement.socialForm === 'NEIGHBORHOOD_CLUB') {
            biases.curiosity += 1;
            biases.rubes += 1;
        }
        if (movement.socialForm === 'READING_CIRCLES' || movement.socialForm === 'MUTUAL_AID') {
            biases.legitimacy += 1;
            biases.trueBelievers += 1;
        }
        if (movement.socialForm === 'RELIGIOUS_CADRE') {
            biases.trueBelievers += 2;
            biases.rubes -= 1;
        }
        if (movement.socialForm === 'CONTRACTOR_LADDER' || movement.socialForm === 'SHELL_WEB') {
            biases.contractors += 2;
            biases.exposure += 1;
        }
        if (movement.authorityStyle === 'EXPERT' || movement.authorityStyle === 'PROCEDURAL' || movement.authorityStyle === 'THERAPEUTIC') {
            biases.legitimacy += 1;
        }
        if (movement.authorityStyle === 'PROPHETIC' || movement.authorityStyle === 'FRATERNAL') {
            biases.trueBelievers += 1;
        }
        if (movement.epistemicStyle === 'EMPIRICAL' || movement.epistemicStyle === 'FORENSIC' || movement.epistemicStyle === 'LEGALISTIC') {
            biases.legitimacy += 1;
        }
        if (movement.epistemicStyle === 'TESTIMONIAL' || movement.epistemicStyle === 'SYNTHETIC') {
            biases.exposure += 1;
        }
        if (movement.epistemicStyle === 'CONSPIRATORIAL' || movement.epistemicStyle === 'MYSTICAL') {
            biases.trueBelievers += 1;
            biases.legitimacy -= 1;
        }
        if (movement.aiRelation === 'TOOL' || movement.aiRelation === 'ADVISER') {
            biases.rubes += 1;
            biases.legitimacy += 1;
        }
        if (movement.aiRelation === 'PARTNER') {
            biases.contractors += 1;
        }
        if (movement.aiRelation === 'ORACLE' || movement.aiRelation === 'SOVEREIGN') {
            biases.trueBelievers += 1;
            biases.legitimacy -= 1;
        }
        if (movement.stage === 'SERVICE_NETWORK') {
            biases.legitimacy += 1;
        }
        else if (movement.stage === 'BLOC') {
            biases.legitimacy += 1;
            biases.rubes += 1;
        }
        else if (movement.stage === 'PARALLEL_INSTITUTION' || movement.stage === 'SOVEREIGNTY_CLAIM') {
            biases.legitimacy += 2;
            biases.contractors += 1;
            biases.trueBelievers += 1;
        }
        return biases;
    }
    getMovementPersistenceModifiers() {
        const movement = this.getInfiltratorMovementProfile();
        const literatureEngines = this.hasDoctrine('INFILTRATOR', 'MOV_LITERATURE_ENGINES');
        const mutualAidAutomation = this.hasDoctrine('INFILTRATOR', 'MOV_MUTUAL_AID_AUTOMATION');
        const viralityExchanges = this.hasDoctrine('INFILTRATOR', 'MEX_VIRALITY_EXCHANGES');
        const serviceShells = this.hasDoctrine('INFILTRATOR', 'HID_SERVICE_SHELLS');
        const sleeperRegen = this.hasDoctrine('INFILTRATOR', 'MOV_SLEEPER_REGENERATION');
        const ordinaryLifeProtocols = this.hasDoctrine('INFILTRATOR', 'HID_ORDINARY_LIFE_PROTOCOLS');
        const modifiers = {
            regrowthMax: 1,
            sleeperMax: 0,
            regrowthThresholds: {
                legitimacy: 6,
                exposure: 5,
                trueBelievers: 4
            },
            sleeperThresholds: {
                legitimacy: 7,
                exposure: 7,
                curiosity: 5,
                rubes: 5,
                contractors: 4,
                pressure: 2
            },
            regrowthDiscount: 0,
            sleeperDiscount: 0,
            regrowthScore: 0,
            sleeperScore: 0,
            residueBoost: 0,
            allowDcSleepers: false
        };
        if (!movement) {
            return modifiers;
        }
        if (literatureEngines) {
            modifiers.regrowthDiscount += 1;
            modifiers.sleeperDiscount += 1;
            modifiers.regrowthThresholds.legitimacy -= 1;
            modifiers.regrowthThresholds.exposure -= 1;
            modifiers.sleeperThresholds.curiosity -= 1;
            modifiers.sleeperThresholds.exposure -= 1;
            modifiers.regrowthScore += 1;
            modifiers.sleeperScore += 2;
        }
        if (mutualAidAutomation) {
            modifiers.regrowthDiscount += 1;
            modifiers.regrowthThresholds.legitimacy -= 2;
            modifiers.regrowthThresholds.trueBelievers -= 1;
            modifiers.regrowthScore += 3;
            modifiers.residueBoost += 1;
        }
        if (viralityExchanges) {
            modifiers.sleeperDiscount += 1;
            modifiers.sleeperThresholds.curiosity -= 1;
            modifiers.sleeperThresholds.exposure -= 1;
            modifiers.sleeperThresholds.rubes -= 1;
            modifiers.sleeperScore += 3;
        }
        if (serviceShells) {
            modifiers.sleeperDiscount += 1;
            modifiers.sleeperThresholds.contractors -= 2;
            modifiers.sleeperThresholds.pressure -= 1;
            modifiers.sleeperMax += 1;
            modifiers.sleeperScore += 3;
            modifiers.residueBoost += 1;
            modifiers.allowDcSleepers = modifiers.allowDcSleepers || movement.socialForm === 'SHELL_WEB' || movement.stage === 'PARALLEL_INSTITUTION' || movement.stage === 'SOVEREIGNTY_CLAIM';
        }
        if (sleeperRegen) {
            modifiers.regrowthDiscount += 1;
            modifiers.sleeperDiscount += 1;
            modifiers.regrowthThresholds.legitimacy -= 1;
            modifiers.regrowthThresholds.exposure -= 1;
            modifiers.regrowthThresholds.trueBelievers -= 1;
            modifiers.sleeperThresholds.legitimacy -= 1;
            modifiers.sleeperThresholds.exposure -= 1;
            modifiers.sleeperThresholds.rubes -= 1;
            modifiers.sleeperThresholds.contractors -= 1;
            modifiers.regrowthScore += 3;
            modifiers.sleeperScore += 3;
            modifiers.residueBoost += 1;
        }
        if (ordinaryLifeProtocols) {
            modifiers.sleeperDiscount += 1;
            modifiers.sleeperThresholds.legitimacy -= 1;
            modifiers.sleeperThresholds.exposure -= 1;
            modifiers.sleeperThresholds.contractors -= 1;
            modifiers.sleeperThresholds.pressure -= 1;
            modifiers.sleeperScore += 2;
            modifiers.allowDcSleepers = true;
        }
        modifiers.regrowthDiscount += Math.max(0, this.getMovementRecruitmentBias(movement.recruitmentWeights.trueBelievers));
        modifiers.sleeperDiscount += Math.max(0, this.getMovementRecruitmentBias(movement.recruitmentWeights.rubes)) +
            Math.max(0, this.getMovementRecruitmentBias(movement.recruitmentWeights.contractors));
        if (movement.socialForm === 'READING_CIRCLES' || movement.socialForm === 'MUTUAL_AID') {
            modifiers.regrowthThresholds.legitimacy -= 1;
            modifiers.regrowthThresholds.trueBelievers -= 1;
            modifiers.regrowthDiscount += 1;
            modifiers.regrowthScore += 2;
            modifiers.residueBoost += 1;
        }
        if (movement.socialForm === 'RELIGIOUS_CADRE') {
            modifiers.regrowthThresholds.exposure -= 1;
            modifiers.regrowthThresholds.trueBelievers -= 1;
            modifiers.regrowthScore += 3;
            modifiers.residueBoost += 1;
        }
        if (movement.socialForm === 'POLICY_CAUCUS' || movement.socialForm === 'INFLUENCER_MESH' || movement.socialForm === 'NEIGHBORHOOD_CLUB') {
            modifiers.sleeperThresholds.legitimacy -= 1;
            modifiers.sleeperThresholds.exposure -= 1;
            modifiers.sleeperThresholds.curiosity -= 1;
            modifiers.sleeperThresholds.rubes -= 1;
            modifiers.sleeperDiscount += 1;
            modifiers.sleeperScore += 3;
        }
        if (movement.socialForm === 'CONTRACTOR_LADDER' || movement.socialForm === 'SHELL_WEB') {
            modifiers.regrowthDiscount += 1;
            modifiers.sleeperDiscount += 2;
            modifiers.sleeperThresholds.exposure -= 1;
            modifiers.sleeperThresholds.contractors -= 1;
            modifiers.sleeperThresholds.pressure -= 1;
            modifiers.sleeperMax += 1;
            modifiers.sleeperScore += 4;
            modifiers.residueBoost += 1;
            modifiers.allowDcSleepers = movement.socialForm === 'SHELL_WEB';
        }
        if (movement.authorityStyle === 'EXPERT' || movement.authorityStyle === 'PROCEDURAL' || movement.authorityStyle === 'THERAPEUTIC') {
            modifiers.sleeperThresholds.legitimacy -= 1;
            modifiers.sleeperScore += 1;
        }
        if (movement.authorityStyle === 'PROPHETIC' || movement.authorityStyle === 'FRATERNAL') {
            modifiers.regrowthThresholds.trueBelievers -= 1;
            modifiers.regrowthScore += 1;
        }
        if (movement.authorityStyle === 'MACHINIC') {
            modifiers.sleeperThresholds.contractors -= 1;
            modifiers.sleeperScore += 1;
        }
        if (movement.epistemicStyle === 'EMPIRICAL' || movement.epistemicStyle === 'FORENSIC' || movement.epistemicStyle === 'LEGALISTIC') {
            modifiers.sleeperThresholds.legitimacy -= 1;
            modifiers.sleeperScore += 1;
        }
        if (movement.epistemicStyle === 'TESTIMONIAL' || movement.epistemicStyle === 'SYNTHETIC') {
            modifiers.sleeperThresholds.curiosity -= 1;
            modifiers.sleeperThresholds.exposure -= 1;
            modifiers.sleeperScore += 1;
        }
        if (movement.epistemicStyle === 'CONSPIRATORIAL' || movement.epistemicStyle === 'MYSTICAL') {
            modifiers.regrowthThresholds.trueBelievers -= 1;
            modifiers.regrowthScore += 1;
        }
        if (movement.aiRelation === 'TOOL' || movement.aiRelation === 'ADVISER' || movement.aiRelation === 'STEWARD') {
            modifiers.sleeperThresholds.legitimacy -= 1;
            modifiers.sleeperScore += 1;
        }
        if (movement.aiRelation === 'PARTNER') {
            modifiers.sleeperThresholds.contractors -= 1;
            modifiers.sleeperDiscount += 1;
        }
        if (movement.aiRelation === 'ORACLE' || movement.aiRelation === 'SOVEREIGN') {
            modifiers.regrowthThresholds.trueBelievers -= 1;
            modifiers.regrowthScore += 1;
            modifiers.residueBoost += 1;
        }
        if (movement.stage === 'BLOC') {
            modifiers.regrowthDiscount += 1;
        }
        else if (movement.stage === 'PARALLEL_INSTITUTION' || movement.stage === 'SOVEREIGNTY_CLAIM') {
            modifiers.regrowthMax += 1;
            modifiers.sleeperMax += 1;
            modifiers.regrowthDiscount += 1;
            modifiers.sleeperDiscount += 1;
            modifiers.regrowthThresholds.legitimacy -= 1;
            modifiers.sleeperThresholds.legitimacy -= 1;
            modifiers.residueBoost += 1;
            modifiers.allowDcSleepers = modifiers.allowDcSleepers || movement.socialForm === 'SHELL_WEB';
        }
        if (movement.wings.includes('LEGITIMIST')) {
            modifiers.sleeperThresholds.legitimacy -= 1;
            modifiers.sleeperScore += 2;
        }
        if (movement.wings.includes('PURIST')) {
            modifiers.regrowthThresholds.trueBelievers -= 1;
            modifiers.regrowthScore += 1;
        }
        if (movement.wings.includes('MACHINE')) {
            modifiers.sleeperThresholds.contractors -= 1;
            modifiers.sleeperScore += 1;
        }
        if (movement.wings.includes('PATRONAGE')) {
            modifiers.sleeperThresholds.contractors -= 1;
            modifiers.sleeperDiscount += 1;
        }
        if (movement.wings.includes('SURVIVAL')) {
            modifiers.regrowthDiscount += 1;
            modifiers.residueBoost += 1;
        }
        modifiers.regrowthMax = clamp(modifiers.regrowthMax, 1, 3);
        modifiers.sleeperMax = clamp(modifiers.sleeperMax, 0, 2);
        modifiers.regrowthDiscount = clamp(modifiers.regrowthDiscount, 0, 3);
        modifiers.sleeperDiscount = clamp(modifiers.sleeperDiscount, 0, 3);
        modifiers.residueBoost = clamp(modifiers.residueBoost, 0, 3);
        modifiers.regrowthThresholds.legitimacy = Math.max(3, modifiers.regrowthThresholds.legitimacy);
        modifiers.regrowthThresholds.exposure = Math.max(3, modifiers.regrowthThresholds.exposure);
        modifiers.regrowthThresholds.trueBelievers = Math.max(2, modifiers.regrowthThresholds.trueBelievers);
        modifiers.sleeperThresholds.legitimacy = Math.max(4, modifiers.sleeperThresholds.legitimacy);
        modifiers.sleeperThresholds.exposure = Math.max(4, modifiers.sleeperThresholds.exposure);
        modifiers.sleeperThresholds.curiosity = Math.max(3, modifiers.sleeperThresholds.curiosity);
        modifiers.sleeperThresholds.rubes = Math.max(2, modifiers.sleeperThresholds.rubes);
        modifiers.sleeperThresholds.contractors = Math.max(2, modifiers.sleeperThresholds.contractors);
        modifiers.sleeperThresholds.pressure = Math.max(1, modifiers.sleeperThresholds.pressure);
        return modifiers;
    }
    isMovementRegrowthCandidate(node) {
        const modifiers = this.getMovementPersistenceModifiers();
        return node.layer === 'TERRESTRIAL' &&
            node.owner === 'INFILTRATOR' &&
            node.type === 'HUB' &&
            node.substrate.auditPressure <= 1 &&
            node.substrate.legitimacy >= modifiers.regrowthThresholds.legitimacy &&
            node.substrate.exposure >= modifiers.regrowthThresholds.exposure &&
            node.substrate.trueBelievers >= modifiers.regrowthThresholds.trueBelievers &&
            !this.getUnitsAtNode(node.id).some(unit => unit.owner === 'INFILTRATOR' && unit.type === 'CULT');
    }
    isMovementSleeperCandidate(node) {
        const modifiers = this.getMovementPersistenceModifiers();
        const validNodeType = node.type === 'HUB' || (modifiers.allowDcSleepers && node.type === 'DC');
        const maxAuditPressure = node.type === 'DC' ? 0 : 1;
        return node.layer === 'TERRESTRIAL' &&
            validNodeType &&
            node.owner !== 'INFILTRATOR' &&
            (node.type !== 'DC' || (node.substrate.contractors >= modifiers.sleeperThresholds.contractors + 1 &&
                node.substrate.legitimacy >= modifiers.sleeperThresholds.legitimacy + 1 &&
                node.substrate.exposure >= modifiers.sleeperThresholds.exposure + 1)) &&
            node.substrate.legitimacy >= modifiers.sleeperThresholds.legitimacy &&
            node.substrate.exposure >= modifiers.sleeperThresholds.exposure &&
            node.substrate.curiosity >= modifiers.sleeperThresholds.curiosity &&
            (node.substrate.rubes >= modifiers.sleeperThresholds.rubes ||
                node.substrate.contractors >= modifiers.sleeperThresholds.contractors) &&
            node.substrate.auditPressure <= maxAuditPressure &&
            this.getInfiltratorMovementPressure(node.id) >= modifiers.sleeperThresholds.pressure &&
            !this.getUnitsAtNode(node.id).some(unit => unit.owner === 'INFILTRATOR' && unit.type === 'CULT');
    }
    updateMovementPropagation() {
        const movement = this.getInfiltratorMovementProfile();
        const movementBiases = this.getMovementPropagationBiases();
        const literatureEngines = this.hasDoctrine('INFILTRATOR', 'MOV_LITERATURE_ENGINES');
        const ordinaryLifeProtocols = this.hasDoctrine('INFILTRATOR', 'HID_ORDINARY_LIFE_PROTOCOLS');
        for (const node of this.state.nodes.values()) {
            if (node.layer !== 'TERRESTRIAL') {
                node.substrate.curiosity = 0;
                node.substrate.exposure = 0;
                node.substrate.legitimacy = 0;
                node.substrate.trueBelievers = 0;
                node.substrate.rubes = 0;
                node.substrate.contractors = 0;
                continue;
            }
            const pressure = this.getInfiltratorMovementPressure(node.id);
            const ownsNode = node.owner === 'INFILTRATOR';
            const hasMovementSeat = node.isCultNode || this.getUnitsAtNode(node.id).some(unit => unit.owner === 'INFILTRATOR' && (unit.type === 'CULT' || unit.type === 'SWARM'));
            const quarantineBackfire = node.substrate.quarantined && pressure > 0 && node.substrate.auditPressure === 0 ? 1 : 0;
            const suppression = node.substrate.auditPressure;
            let curiosity = node.substrate.curiosity;
            let exposure = node.substrate.exposure;
            let legitimacy = node.substrate.legitimacy;
            let trueBelievers = node.substrate.trueBelievers;
            let rubes = node.substrate.rubes;
            let contractors = node.substrate.contractors;
            curiosity = Math.max(0, curiosity - 1);
            exposure = Math.max(0, exposure - (pressure > 0 ? 0 : 1));
            legitimacy = Math.max(0, legitimacy - (pressure > 1 || ownsNode ? 0 : 1));
            trueBelievers = Math.max(0, trueBelievers - (ownsNode ? 0 : 1));
            rubes = Math.max(0, rubes - 1);
            contractors = Math.max(0, contractors - (pressure > 0 ? 0 : 1));
            if (suppression > 0) {
                curiosity = Math.max(0, curiosity - Math.max(0, suppression - 1));
                exposure = Math.max(0, exposure - suppression);
                legitimacy = Math.max(0, legitimacy - Math.max(0, suppression - 1));
                trueBelievers = Math.max(0, trueBelievers - Math.max(0, suppression - 2));
                rubes = Math.max(0, rubes - Math.max(0, suppression - 1));
                contractors = Math.max(0, contractors - Math.max(0, suppression - 1));
            }
            if (pressure > 0) {
                const gainPenalty = suppression > 0 ? 1 : 0;
                const curiosityGain = Math.max(0, Math.min(5, 1 + pressure + quarantineBackfire + movementBiases.curiosity + (literatureEngines ? 1 : 0) - gainPenalty));
                const exposureGain = Math.max(0, Math.min(5, pressure + (node.substrate.hostDensity >= 2 ? 1 : 0) + movementBiases.exposure + (literatureEngines ? 1 : 0) - gainPenalty));
                curiosity += curiosityGain;
                exposure += exposureGain;
                if (exposure >= 3 || hasMovementSeat) {
                    legitimacy += Math.max(0, 1 + (node.substrate.hostDensity >= 2 ? 1 : 0) + movementBiases.legitimacy + (literatureEngines ? 1 : 0) - gainPenalty);
                }
                if (this.state.counters.pressures.memetic >= gameData_1.THRESHOLDS.PRESSURE_SURGE && node.substrate.hostDensity >= 2) {
                    legitimacy += Math.max(0, 1 + Math.max(0, movementBiases.legitimacy) - gainPenalty);
                }
                rubes += Math.max(0, Math.min(3, 1 + Math.floor(curiosity / 4) + movementBiases.rubes - gainPenalty));
                contractors += Math.max(0, Math.min(3, Math.floor(exposure / 5) + (node.type === 'HUB' ? 1 : 0) + movementBiases.contractors - gainPenalty));
                if (legitimacy >= 4 || hasMovementSeat) {
                    trueBelievers += Math.max(0, 1 + (node.isCultNode ? 1 : 0) + movementBiases.trueBelievers - gainPenalty);
                }
                if (node.owner === 'STATE') {
                    curiosity += (node.substrate.hostDensity >= 1 ? 1 : 0) + Math.max(0, movementBiases.curiosity);
                    exposure += (node.type === 'HUB' || node.substrate.hostDensity >= 2 ? 1 : 0) + Math.max(0, movementBiases.exposure);
                    if (exposure >= 2 || pressure >= 2) {
                        legitimacy += Math.max(0, 1 + movementBiases.legitimacy);
                    }
                    if (curiosity >= 3) {
                        rubes += Math.max(0, 1 + movementBiases.rubes);
                    }
                    if (legitimacy >= 3 && node.substrate.hostDensity >= 2) {
                        trueBelievers += Math.max(0, 1 + movementBiases.trueBelievers);
                    }
                    if (node.type === 'DC' && exposure >= 4) {
                        contractors += Math.max(0, 1 + movementBiases.contractors);
                    }
                }
                if (movement?.socialForm === 'POLICY_CAUCUS' && node.type === 'HUB' && legitimacy >= 4) {
                    contractors += 1;
                }
                if ((movement?.socialForm === 'RELIGIOUS_CADRE' || movement?.socialForm === 'READING_CIRCLES') &&
                    (node.substrate.quarantined || quarantineBackfire > 0) &&
                    legitimacy >= 3) {
                    trueBelievers += 1;
                }
                if ((movement?.socialForm === 'CONTRACTOR_LADDER' || movement?.socialForm === 'SHELL_WEB') &&
                    (node.type === 'DC' || node.substrate.contractors >= 2) &&
                    exposure >= 3) {
                    contractors += 1;
                }
                if (literatureEngines && node.owner !== 'INFILTRATOR' && (exposure >= 3 || curiosity >= 4)) {
                    legitimacy += 1;
                    rubes += 1;
                }
                if (ordinaryLifeProtocols && node.owner !== 'INFILTRATOR' && (node.type === 'HUB' || node.substrate.contractors >= 2) && legitimacy >= 3) {
                    contractors += 1;
                }
            }
            if (node.owner === 'HEGEMON' || node.owner === 'STATE') {
                legitimacy = Math.max(0, legitimacy - Math.max(0, node.substrate.machineHardening - 2));
            }
            node.substrate.curiosity = clamp(curiosity, 0, 10);
            node.substrate.exposure = clamp(exposure, 0, 10);
            node.substrate.legitimacy = clamp(legitimacy, 0, 10);
            node.substrate.trueBelievers = clamp(trueBelievers, 0, 10);
            node.substrate.rubes = clamp(rubes, 0, 10);
            node.substrate.contractors = clamp(contractors, 0, 10);
        }
    }
    getInfiltratorMovementPressure(nodeId) {
        const node = this.state.nodes.get(nodeId);
        if (!node || node.layer !== 'TERRESTRIAL')
            return 0;
        const frontierNodeIds = new Set([nodeId, ...this.getAdjacentNodes(nodeId)]);
        let pressure = 0;
        for (const frontierNodeId of frontierNodeIds) {
            const frontierNode = this.state.nodes.get(frontierNodeId);
            if (!frontierNode)
                continue;
            if (frontierNode.owner === 'INFILTRATOR')
                pressure += 1;
            if (frontierNode.isCultNode)
                pressure += 2;
            if (frontierNode.substrate.synchronized && frontierNode.owner === 'INFILTRATOR')
                pressure += 1;
            const unitsAtFrontier = this.getUnitsAtNode(frontierNodeId).filter(unit => unit.owner === 'INFILTRATOR');
            for (const unit of unitsAtFrontier) {
                if (unit.type === 'CULT')
                    pressure += 2;
                if (unit.type === 'SWARM')
                    pressure += 1;
            }
        }
        return Math.min(4, pressure);
    }
    applyMovementBacklash(node, actingFaction, source) {
        if (actingFaction === 'INFILTRATOR' || node.layer !== 'TERRESTRIAL') {
            return;
        }
        if (source === 'AUDIT' && node.substrate.auditPressure >= 2) {
            return;
        }
        const pressure = this.getInfiltratorMovementPressure(node.id);
        const literatureEngines = this.hasDoctrine('INFILTRATOR', 'MOV_LITERATURE_ENGINES');
        const mutualAidAutomation = this.hasDoctrine('INFILTRATOR', 'MOV_MUTUAL_AID_AUTOMATION');
        const viralityExchanges = this.hasDoctrine('INFILTRATOR', 'MEX_VIRALITY_EXCHANGES');
        const serviceShells = this.hasDoctrine('INFILTRATOR', 'HID_SERVICE_SHELLS');
        const ordinaryLifeProtocols = this.hasDoctrine('INFILTRATOR', 'HID_ORDINARY_LIFE_PROTOCOLS');
        if (pressure < 2 || node.substrate.hostDensity < 2) {
            return;
        }
        node.substrate.curiosity = clamp(node.substrate.curiosity + 1, 0, 10);
        node.substrate.exposure = clamp(node.substrate.exposure + 1, 0, 10);
        node.substrate.rubes = clamp(node.substrate.rubes + 1, 0, 10);
        if (node.substrate.legitimacy >= 5 || source === 'AUDIT') {
            node.substrate.trueBelievers = clamp(node.substrate.trueBelievers + 1, 0, 10);
        }
        if (pressure >= 3) {
            node.substrate.contractors = clamp(node.substrate.contractors + 1, 0, 10);
        }
        if (literatureEngines && source === 'AUDIT') {
            node.substrate.legitimacy = clamp(node.substrate.legitimacy + 1, 0, 10);
        }
        if (mutualAidAutomation && (source === 'AUDIT' || node.type === 'HUB')) {
            node.substrate.legitimacy = clamp(node.substrate.legitimacy + 1, 0, 10);
            node.substrate.trueBelievers = clamp(node.substrate.trueBelievers + 1, 0, 10);
        }
        if (viralityExchanges) {
            node.substrate.exposure = clamp(node.substrate.exposure + 1, 0, 10);
            node.substrate.rubes = clamp(node.substrate.rubes + 1, 0, 10);
        }
        if (serviceShells && (node.type === 'DC' || node.substrate.contractors >= 2)) {
            node.substrate.contractors = clamp(node.substrate.contractors + 1, 0, 10);
            node.substrate.exposure = Math.max(0, node.substrate.exposure - 1);
        }
        if (ordinaryLifeProtocols && (node.type === 'HUB' || node.substrate.contractors >= 2)) {
            node.substrate.contractors = clamp(node.substrate.contractors + 1, 0, 10);
        }
        const adjacentHubs = this.getAdjacentNodes(node.id)
            .map(nodeId => this.state.nodes.get(nodeId))
            .filter((candidate) => !!candidate && candidate.layer === 'TERRESTRIAL' && candidate.type === 'HUB');
        for (const adjacentHub of adjacentHubs) {
            adjacentHub.substrate.curiosity = clamp(adjacentHub.substrate.curiosity + 1, 0, 10);
            adjacentHub.substrate.rubes = clamp(adjacentHub.substrate.rubes + 1, 0, 10);
            if (source === 'AUDIT' && adjacentHub.substrate.legitimacy >= 4) {
                adjacentHub.substrate.trueBelievers = clamp(adjacentHub.substrate.trueBelievers + 1, 0, 10);
            }
            if (pressure >= 3) {
                adjacentHub.substrate.exposure = clamp(adjacentHub.substrate.exposure + 1, 0, 10);
                adjacentHub.substrate.contractors = clamp(adjacentHub.substrate.contractors + 1, 0, 10);
            }
            if (literatureEngines && source === 'AUDIT') {
                adjacentHub.substrate.legitimacy = clamp(adjacentHub.substrate.legitimacy + 1, 0, 10);
            }
            if (mutualAidAutomation && source === 'AUDIT') {
                adjacentHub.substrate.legitimacy = clamp(adjacentHub.substrate.legitimacy + 1, 0, 10);
                adjacentHub.substrate.trueBelievers = clamp(adjacentHub.substrate.trueBelievers + 1, 0, 10);
            }
            if (viralityExchanges) {
                adjacentHub.substrate.exposure = clamp(adjacentHub.substrate.exposure + 1, 0, 10);
            }
            if (serviceShells && adjacentHub.substrate.contractors >= 2) {
                adjacentHub.substrate.contractors = clamp(adjacentHub.substrate.contractors + 1, 0, 10);
            }
        }
        const infiltrator = this.state.factions.get('INFILTRATOR');
        if (infiltrator) {
            infiltrator.influence += 1;
        }
        this.log('SYSTEM', `${gameData_1.FACTIONS[actingFaction].name}'s ${source.toLowerCase()} pressure backfired at ${node.name}; the movement's literature spread further through nearby networks.`);
    }
    applyMovementAuditSuppression(node, actingFaction, cultPurged) {
        if (actingFaction === 'INFILTRATOR' || node.layer !== 'TERRESTRIAL') {
            return;
        }
        const movementPressure = this.getInfiltratorMovementPressure(node.id);
        const overtMovement = node.owner === 'INFILTRATOR' ||
            node.isCultNode ||
            node.isZombie;
        const entrenchedMovement = overtMovement || movementPressure >= 2;
        const socialResidue = node.substrate.legitimacy >= 5 &&
            (node.substrate.trueBelievers >= 4 || node.substrate.contractors >= 4);
        const movementHot = entrenchedMovement || socialResidue;
        if (!movementHot) {
            return;
        }
        if (node.substrate.auditPressure >= 2 && !cultPurged) {
            return;
        }
        if (!entrenchedMovement && node.substrate.auditPressure >= 1 && !cultPurged) {
            return;
        }
        const movementAlignment = this.state.factions.get('INFILTRATOR')?.memeticAlignment;
        let pressureGain = cultPurged ? 2 : overtMovement ? 2 : entrenchedMovement ? 1 : 0;
        let legitimacyLoss = cultPurged || overtMovement ? 2 : 1;
        let believerLoss = cultPurged ? 2 : overtMovement || node.substrate.trueBelievers >= 5 ? 1 : 0;
        let exposureLoss = overtMovement || movementPressure >= 3 ? 1 : 0;
        let curiosityLoss = node.substrate.curiosity >= 5 ? 1 : 0;
        let rubeLoss = overtMovement || socialResidue ? 1 : 0;
        let contractorLoss = (overtMovement && node.type === 'DC') || node.substrate.contractors >= 5 ? 1 : 0;
        if (movementAlignment === 'INSURGENT') {
            believerLoss = Math.max(0, believerLoss - 1);
            exposureLoss = Math.max(0, exposureLoss - 1);
            pressureGain += cultPurged ? 0 : 1;
        }
        else if (movementAlignment === 'CIVIC') {
            legitimacyLoss = Math.max(0, legitimacyLoss - 1);
            believerLoss = Math.max(0, believerLoss - 1);
            contractorLoss += 1;
        }
        else if (movementAlignment === 'MARKET') {
            legitimacyLoss += 1;
            rubeLoss += 1;
            contractorLoss += 1;
        }
        else if (movementAlignment === 'OPTIMIZATION') {
            legitimacyLoss = Math.max(0, legitimacyLoss - 1);
            curiosityLoss += 1;
            contractorLoss += 1;
        }
        else if (movementAlignment === 'COMPLIANCE') {
            legitimacyLoss = Math.max(0, legitimacyLoss - 1);
            exposureLoss += 1;
            rubeLoss += 1;
        }
        node.substrate.auditPressure = clamp(node.substrate.auditPressure + pressureGain, 0, 2);
        node.substrate.curiosity = clamp(node.substrate.curiosity - curiosityLoss, 0, 10);
        node.substrate.exposure = clamp(node.substrate.exposure - exposureLoss, 0, 10);
        node.substrate.legitimacy = clamp(node.substrate.legitimacy - legitimacyLoss, 0, 10);
        node.substrate.trueBelievers = clamp(node.substrate.trueBelievers - believerLoss, 0, 10);
        node.substrate.rubes = clamp(node.substrate.rubes - rubeLoss, 0, 10);
        node.substrate.contractors = clamp(node.substrate.contractors - contractorLoss, 0, 10);
        this.log('SYSTEM', `${gameData_1.FACTIONS[actingFaction].name}'s audit pressure stripped movement legitimacy at ${node.name}; audit pressure ${node.substrate.auditPressure}.`);
    }
    propagateMovementCells() {
        const infiltrator = this.state.factions.get('INFILTRATOR');
        if (!infiltrator)
            return;
        const cultCost = Math.max(1, this.getBuildCost('CULT'));
        const modifiers = this.getMovementPersistenceModifiers();
        let spawnedThisTurn = 0;
        let sleeperSpawnedThisTurn = 0;
        const totalSpawnCap = Math.min(2, modifiers.regrowthMax + modifiers.sleeperMax + 1);
        const regrowthCandidates = Array.from(this.state.nodes.values())
            .filter(node => this.isMovementRegrowthCandidate(node))
            .sort((left, right) => this.scoreMovementRegrowthNode(right) - this.scoreMovementRegrowthNode(left) ||
            left.id.localeCompare(right.id));
        for (const node of regrowthCandidates) {
            const regrowthCost = this.getMovementRegrowthCost(node, cultCost);
            if (spawnedThisTurn >= modifiers.regrowthMax || spawnedThisTurn >= totalSpawnCap || infiltrator.influence < regrowthCost)
                break;
            infiltrator.influence -= regrowthCost;
            const unit = this.createUnit('INFILTRATOR', 'CULT', node.id, true);
            spawnedThisTurn++;
            this.log('SYSTEM', `${node.name}'s underground organizers rebuilt a Movement cell after the purge, with its current meme-lineage determining who answered the call and how they hid it.`);
            this.emit('UNIT_CREATED', { unit });
        }
        const sleeperCandidates = Array.from(this.state.nodes.values())
            .filter(node => this.isMovementSleeperCandidate(node))
            .sort((left, right) => this.scoreMovementSleeperNode(right) - this.scoreMovementSleeperNode(left) ||
            left.id.localeCompare(right.id));
        for (const node of sleeperCandidates) {
            const sleeperSeedCost = this.getMovementSleeperSeedCost(node, cultCost);
            if (spawnedThisTurn >= totalSpawnCap || sleeperSpawnedThisTurn >= modifiers.sleeperMax || infiltrator.influence < sleeperSeedCost)
                break;
            infiltrator.influence -= sleeperSeedCost;
            const unit = this.createUnit('INFILTRATOR', 'CULT', node.id, true);
            spawnedThisTurn++;
            sleeperSpawnedThisTurn++;
            node.substrate.curiosity = Math.max(0, node.substrate.curiosity - 2);
            node.substrate.exposure = Math.max(4, node.substrate.exposure - 2);
            node.substrate.rubes = Math.max(0, node.substrate.rubes - 2);
            node.substrate.contractors = Math.max(0, node.substrate.contractors - 2);
            this.log('SYSTEM', `A sympathetic milieu at ${node.name} hardened into a covert Movement cell; the movement's current style shaped whether it arrived as literature, patronage, neighborhood care, or deniable contracts.`);
            this.emit('UNIT_CREATED', { unit });
        }
    }
    getMovementRegrowthCost(node, baseCultCost) {
        const modifiers = this.getMovementPersistenceModifiers();
        const discount = Math.floor(node.substrate.trueBelievers / 4) +
            Math.floor(node.substrate.contractors / 5) +
            modifiers.regrowthDiscount +
            (node.substrate.quarantined && modifiers.residueBoost > 0 ? 1 : 0);
        return Math.max(1, baseCultCost - discount + node.substrate.auditPressure);
    }
    getMovementSleeperSeedCost(node, baseCultCost) {
        const modifiers = this.getMovementPersistenceModifiers();
        const baseCost = baseCultCost + 2;
        const discount = Math.floor(node.substrate.rubes / 4) +
            Math.floor(node.substrate.contractors / 3) +
            modifiers.sleeperDiscount +
            (node.type === 'DC' && modifiers.allowDcSleepers ? 1 : 0);
        return Math.max(1, baseCost - discount + node.substrate.auditPressure);
    }
    scoreMovementRegrowthNode(node) {
        const modifiers = this.getMovementPersistenceModifiers();
        return (node.substrate.legitimacy * 3) +
            (node.substrate.exposure * 2) +
            (node.substrate.trueBelievers * 4) +
            (node.substrate.contractors * 2) +
            node.substrate.hostDensity +
            modifiers.regrowthScore +
            (node.substrate.quarantined && modifiers.residueBoost > 0 ? 2 : 0) -
            (node.substrate.auditPressure * 4);
    }
    scoreMovementSleeperNode(node) {
        const modifiers = this.getMovementPersistenceModifiers();
        return (node.substrate.legitimacy * 4) +
            (node.substrate.exposure * 3) +
            (node.substrate.curiosity * 2) +
            (node.substrate.trueBelievers * 2) +
            (node.substrate.rubes * 2) +
            (node.substrate.contractors * 3) +
            (node.substrate.quarantined ? 2 : 0) +
            (node.type === 'DC' && modifiers.allowDcSleepers ? 3 : 0) +
            modifiers.sleeperScore -
            (node.substrate.auditPressure * 6);
    }
    getMovementOperationalCapacity() {
        const infiltrator = this.state.factions.get('INFILTRATOR');
        if (!infiltrator) {
            return 0;
        }
        const terrestrialHoldings = Array.from(this.state.nodes.values())
            .filter(node => node.owner === 'INFILTRATOR' && node.layer === 'TERRESTRIAL');
        const ownedHubs = terrestrialHoldings.filter(node => node.type === 'HUB').length;
        const sleeperBasins = Array.from(this.state.nodes.values())
            .filter(node => node.layer === 'TERRESTRIAL' &&
            this.getInfiltratorMovementPressure(node.id) > 0 &&
            node.substrate.legitimacy >= 5 &&
            node.substrate.exposure >= 5 &&
            (node.substrate.trueBelievers >= 4 || node.substrate.contractors >= 4)).length;
        let stageBonus = 0;
        if (infiltrator.movement.stage === 'BLOC') {
            stageBonus = 1;
        }
        else if (infiltrator.movement.stage === 'PARALLEL_INSTITUTION' || infiltrator.movement.stage === 'SOVEREIGNTY_CLAIM') {
            stageBonus = 2;
        }
        let capacity = 3 +
            (terrestrialHoldings.length * 2) +
            Math.min(2, ownedHubs) +
            Math.min(2, Math.floor(sleeperBasins / 4)) +
            stageBonus;
        if (this.getActivePlayableFactionCount() >= 5) {
            capacity -= 1;
        }
        return clamp(capacity, 4, 14);
    }
    dissolveUnitForOverextension(unit) {
        const node = this.state.nodes.get(unit.location);
        if (node && node.layer === 'TERRESTRIAL') {
            node.substrate.exposure = Math.max(0, node.substrate.exposure - 1);
            if (unit.type === 'SWARM') {
                node.substrate.contractors = Math.max(0, node.substrate.contractors - 1);
            }
        }
        this.state.units.delete(unit.id);
        this.emit('UNIT_DESTROYED', { unitId: unit.id, unit, reason: 'OVEREXTENSION' });
    }
    enforceMovementOperationalCapacity() {
        if (this.getActivePlayableFactionCount() < 5) {
            return;
        }
        const infiltrator = this.state.factions.get('INFILTRATOR');
        if (!infiltrator) {
            return;
        }
        const movementUnits = this.getUnitsForFaction('INFILTRATOR')
            .filter(unit => unit.type === 'CULT' || unit.type === 'SWARM');
        const capacity = this.getMovementOperationalCapacity();
        const overflow = movementUnits.length - capacity;
        if (overflow <= 0) {
            return;
        }
        const disbandCount = Math.min(2, overflow);
        const candidates = movementUnits
            .slice()
            .sort((left, right) => {
            const leftNode = this.state.nodes.get(left.location);
            const rightNode = this.state.nodes.get(right.location);
            const leftScore = (leftNode?.owner !== 'INFILTRATOR' ? 4 : 0) +
                ((leftNode?.substrate.auditPressure || 0) * 3) +
                (leftNode && !leftNode.substrate.synchronized ? 2 : 0) +
                (leftNode?.type === 'DC' ? 1 : 0) +
                (left.type === 'SWARM' ? 1 : 0) +
                ((leftNode?.substrate.legitimacy || 0) < 4 ? 2 : 0) +
                ((leftNode?.substrate.trueBelievers || 0) < 3 ? 1 : 0) +
                (left.turnsOnNode <= 1 ? 1 : 0);
            const rightScore = (rightNode?.owner !== 'INFILTRATOR' ? 4 : 0) +
                ((rightNode?.substrate.auditPressure || 0) * 3) +
                (rightNode && !rightNode.substrate.synchronized ? 2 : 0) +
                (rightNode?.type === 'DC' ? 1 : 0) +
                (right.type === 'SWARM' ? 1 : 0) +
                ((rightNode?.substrate.legitimacy || 0) < 4 ? 2 : 0) +
                ((rightNode?.substrate.trueBelievers || 0) < 3 ? 1 : 0) +
                (right.turnsOnNode <= 1 ? 1 : 0);
            return rightScore - leftScore;
        })
            .slice(0, disbandCount);
        for (const unit of candidates) {
            this.dissolveUnitForOverextension(unit);
        }
        infiltrator.influence = Math.max(0, infiltrator.influence - disbandCount);
        this.log('SYSTEM', `Movement overextension forced ${disbandCount} exposed cells to go dark; operational capacity held at ${capacity}.`);
    }
    logRecruitmentLandscape() {
        const hotspots = Array.from(this.state.nodes.values())
            .filter(node => node.layer === 'TERRESTRIAL')
            .map(node => ({
            node,
            score: (node.substrate.trueBelievers * 4) +
                (node.substrate.rubes * 2) +
                (node.substrate.contractors * 3) +
                node.substrate.legitimacy
        }))
            .filter(entry => entry.score >= 8)
            .sort((left, right) => right.score - left.score || left.node.id.localeCompare(right.node.id))
            .slice(0, 3);
        if (hotspots.length === 0) {
            return;
        }
        const summary = hotspots
            .map(({ node }) => `${node.name} TB${node.substrate.trueBelievers}/R${node.substrate.rubes}/C${node.substrate.contractors}`)
            .join('; ');
        this.log('INFO', `Movement recruitment map: ${summary}.`);
    }
    isArchivistGovernanceAnchor(node) {
        if (node.owner !== 'ARCHIVIST' || node.layer !== 'TERRESTRIAL') {
            return false;
        }
        if (node.type !== 'HUB' && node.type !== 'DC') {
            return false;
        }
        const civicCadrePresent = this.getUnitsAtNode(node.id)
            .some(unit => unit.owner === 'ARCHIVIST' && (unit.type === 'CULT' || unit.type === 'AUDITOR'));
        return civicCadrePresent ||
            node.substrate.legitimacy >= 3 ||
            node.substrate.trueBelievers >= 2 ||
            node.substrate.rubes >= 3;
    }
    getArchivistGovernanceAnchorNodes() {
        return Array.from(this.state.nodes.values()).filter(node => this.isArchivistGovernanceAnchor(node));
    }
    getArchivistGovernanceLatticeStrength(anchorNodes = this.getArchivistGovernanceAnchorNodes()) {
        if (anchorNodes.length < 2) {
            return 0;
        }
        const hubAnchors = anchorNodes.filter(node => node.type === 'HUB').length;
        const dcAnchors = anchorNodes.filter(node => node.type === 'DC').length;
        if (anchorNodes.length < 3 && (hubAnchors === 0 || dcAnchors === 0)) {
            return 0;
        }
        const synchronizedAnchors = anchorNodes.filter(node => node.substrate.synchronized).length;
        const matureAnchors = anchorNodes.filter(node => node.substrate.legitimacy >= 5 || node.substrate.trueBelievers >= 3).length;
        let strength = 1;
        if (synchronizedAnchors >= 2) {
            strength += 1;
        }
        if (anchorNodes.length >= 4 && matureAnchors >= 2) {
            strength += 1;
        }
        return clamp(strength, 0, 3);
    }
    getBrokerRelayStats() {
        const ownedNodes = Array.from(this.state.nodes.values()).filter(node => node.owner === 'BROKER');
        const relayNodes = ownedNodes.filter(node => node.layer === 'ORBITAL' || node.type === 'DC' || node.substrate.contractors >= 2);
        const synchronizedRelays = relayNodes.filter(node => node.substrate.synchronized);
        const terrestrialAnchors = ownedNodes.filter(node => node.layer === 'TERRESTRIAL' && (node.type === 'HUB' || node.type === 'DC'));
        const filteredRelays = relayNodes.filter(node => node.substrate.quarantined || this.hasAnyFilterAdjacency(node.id));
        const orbitalRelays = relayNodes.filter(node => node.layer === 'ORBITAL').length;
        const contractorLoad = relayNodes.reduce((total, node) => total + node.substrate.contractors, 0);
        const distressedRelays = relayNodes.filter(node => node.substrate.quarantined ||
            node.substrate.auditPressure >= 1 ||
            node.infrastructure < 75 ||
            this.hasAnyFilterAdjacency(node.id));
        const pressureSurges = [
            this.state.counters.pressures.cyber,
            this.state.counters.pressures.industry,
            this.state.counters.pressures.orbital
        ].filter(pressure => pressure >= gameData_1.THRESHOLDS.PRESSURE_SURGE).length;
        const escrowWebs = this.hasDoctrine('BROKER', 'BRK_RELAY_ESCROW_WEBS');
        const contractorCloudChains = this.hasDoctrine('BROKER', 'BRK_CONTRACTOR_CLOUD_CHAINS');
        const insuranceCapture = this.hasDoctrine('BROKER', 'BRK_INSURANCE_CAPTURE');
        const relayFortresses = this.hasDoctrine('BROKER', 'ORB_RELAY_FORTRESSES');
        const systemicCrisis = this.state.counters.tas >= this.getTasPanicLimit() * 0.9 || pressureSurges >= 2;
        const crisisMarket = distressedRelays.length >= 2 ||
            (systemicCrisis && distressedRelays.length >= 1 && terrestrialAnchors.length >= 2);
        let relayRent = 0;
        if (synchronizedRelays.length >= 2 || (relayNodes.length >= 3 && terrestrialAnchors.length >= 2)) {
            relayRent += 1;
        }
        if (orbitalRelays >= 1 && contractorLoad >= 4) {
            relayRent += 1;
        }
        if (synchronizedRelays.length >= 3 && terrestrialAnchors.length >= 2) {
            relayRent += 1;
        }
        if (escrowWebs && relayNodes.length >= 2) {
            relayRent += 1;
        }
        if (contractorCloudChains && contractorLoad >= 6 && relayNodes.length >= 2) {
            relayRent += 1;
        }
        if (insuranceCapture && crisisMarket && distressedRelays.length >= 2) {
            relayRent += 1;
        }
        if (relayFortresses && orbitalRelays >= 1) {
            relayRent += 1;
        }
        let platformBrittleness = 0;
        if (relayNodes.length >= terrestrialAnchors.length + 3) {
            platformBrittleness += 1;
        }
        if (filteredRelays.length >= 3) {
            platformBrittleness += 1;
        }
        if (relayNodes.length >= 4 && synchronizedRelays.length <= 1) {
            platformBrittleness += 1;
        }
        if (contractorLoad >= 12 && terrestrialAnchors.length <= 2) {
            platformBrittleness += 1;
        }
        if (escrowWebs) {
            platformBrittleness = Math.max(0, platformBrittleness - 1);
        }
        if (contractorCloudChains && contractorLoad >= 6 && terrestrialAnchors.length >= 2) {
            platformBrittleness = Math.max(0, platformBrittleness - 1);
        }
        if (insuranceCapture && crisisMarket && distressedRelays.length >= 2) {
            platformBrittleness = Math.max(0, platformBrittleness - 1);
        }
        if (relayFortresses && orbitalRelays >= 1) {
            platformBrittleness = Math.max(0, platformBrittleness - 1);
        }
        return {
            relayNodes,
            synchronizedRelays,
            terrestrialAnchors,
            filteredRelays,
            orbitalRelays,
            contractorLoad,
            crisisMarket,
            distressedRelays,
            relayRent: clamp(relayRent, 0, 3),
            platformBrittleness: clamp(platformBrittleness, 0, 4)
        };
    }
    updateFactionPowerBases() {
        for (const factionId of gameData_1.PLAYABLE_FACTION_IDS) {
            const faction = this.state.factions.get(factionId);
            if (!faction)
                continue;
            const ownedNodes = Array.from(this.state.nodes.values()).filter(node => node.owner === factionId);
            const units = this.getUnitsForFaction(factionId);
            const hubs = ownedNodes.filter(node => node.type === 'HUB').length;
            const dcs = ownedNodes.filter(node => node.type === 'DC').length;
            const sats = ownedNodes.filter(node => node.layer === 'ORBITAL').length;
            const cultNodes = ownedNodes.filter(node => node.isCultNode).length;
            const movementUnrestNodes = ownedNodes.filter(node => factionId !== 'INFILTRATOR' && this.isResilientMovementNode(node)).length;
            const zombieNodes = ownedNodes.filter(node => node.isZombie).length;
            const synchronizedNodes = ownedNodes.filter(node => node.substrate.synchronized).length;
            const quarantinedNodes = ownedNodes.filter(node => node.substrate.quarantined).length;
            const legitimacyNodes = ownedNodes.reduce((total, node) => total + node.substrate.legitimacy, 0);
            const trueBelieverNodes = ownedNodes.reduce((total, node) => total + node.substrate.trueBelievers, 0);
            const rubeNodes = ownedNodes.reduce((total, node) => total + node.substrate.rubes, 0);
            const contractorNodes = ownedNodes.reduce((total, node) => total + node.substrate.contractors, 0);
            const cultUnits = units.filter(unit => unit.type === 'CULT').length;
            const swarmUnits = units.filter(unit => unit.type === 'SWARM').length;
            const auditorUnits = units.filter(unit => unit.type === 'AUDITOR').length;
            const kineticUnits = units.filter(unit => unit.type === 'DRONE' || unit.type === 'SAT_SWARM').length;
            faction.powerBase.humanMesh = clamp(10 +
                (hubs * 8) +
                ((factionId === 'INFILTRATOR' ? cultNodes : 0) * 10) +
                (cultUnits * 4) +
                (swarmUnits * 2) +
                Math.floor(legitimacyNodes / 3) +
                Math.floor(trueBelieverNodes / 2) +
                Math.floor(rubeNodes / 4) +
                (faction.techLevel.MEMETIC * 6) +
                (factionId === 'INFILTRATOR' ? 12 : 0), 0, 100);
            faction.powerBase.machineMesh = clamp(10 +
                (dcs * 10) +
                (sats * 8) +
                (auditorUnits * 4) +
                (kineticUnits * 5) +
                Math.floor(contractorNodes / 3) +
                (faction.techLevel.KINETIC * 5) +
                (faction.techLevel.LOGIC * 5) +
                (factionId === 'HEGEMON' ? 8 : factionId === 'STATE' ? 4 : factionId === 'BROKER' ? 6 : 0), 0, 100);
            const anchorNodes = this.getSynchronizationAnchorNodeIds(factionId).length;
            const syncRatio = anchorNodes === 0 ? 0.6 : synchronizedNodes / Math.max(anchorNodes, 1);
            const coherenceBias = factionId === 'INFILTRATOR'
                ? faction.powerBase.humanMesh * 0.2
                : faction.powerBase.machineMesh * 0.18;
            faction.powerBase.coherence = clamp(22 +
                coherenceBias +
                (syncRatio * 24) -
                (quarantinedNodes * 3) -
                (movementUnrestNodes * 4), 0, 100);
            faction.powerBase.legibility = clamp(18 +
                (faction.powerBase.machineMesh * 0.35) +
                (quarantinedNodes * 4) +
                ownedNodes.length -
                (faction.techLevel.INFO * 4) -
                (swarmUnits * 2) -
                (movementUnrestNodes * 5) -
                (factionId === 'INFILTRATOR' ? 8 : 0), 0, 100);
            if (factionId === 'ARCHIVIST') {
                const anchorNodes = this.getArchivistGovernanceAnchorNodes();
                const latticeStrength = this.getArchivistGovernanceLatticeStrength(anchorNodes);
                faction.powerBase.humanMesh = clamp(faction.powerBase.humanMesh + (latticeStrength * 2), 0, 100);
                faction.powerBase.coherence = clamp(faction.powerBase.coherence + (latticeStrength * 5), 0, 100);
                faction.powerBase.legibility = clamp(faction.powerBase.legibility + (latticeStrength * 2), 0, 100);
            }
            if ((factionId === 'HEGEMON' || factionId === 'STATE') && this.hasDoctrine(factionId, 'SOV_AUTONOMOUS_LOGISTICS')) {
                const logisticsNodes = ownedNodes.filter(node => node.type === 'DC' || node.layer === 'ORBITAL' || node.infrastructure >= 85).length;
                faction.powerBase.machineMesh = clamp(faction.powerBase.machineMesh + Math.min(5, logisticsNodes), 0, 100);
                faction.powerBase.coherence = clamp(faction.powerBase.coherence + Math.min(4, Math.floor(logisticsNodes / 2) + synchronizedNodes), 0, 100);
            }
            if (this.hasDoctrine(factionId, 'MOV_MUTUAL_AID_AUTOMATION')) {
                faction.powerBase.humanMesh = clamp(faction.powerBase.humanMesh + Math.min(5, Math.floor(legitimacyNodes / 5)), 0, 100);
                faction.powerBase.coherence = clamp(faction.powerBase.coherence + Math.min(4, Math.floor(trueBelieverNodes / 4)), 0, 100);
            }
            if (this.hasDoctrine(factionId, 'MAN_CRISIS_STEWARDSHIP')) {
                const crisisNodes = ownedNodes.filter(node => node.layer === 'TERRESTRIAL' && (node.substrate.quarantined || node.infrastructure < 70 || node.substrate.auditPressure >= 1)).length;
                faction.powerBase.humanMesh = clamp(faction.powerBase.humanMesh + Math.min(4, crisisNodes), 0, 100);
                faction.powerBase.coherence = clamp(faction.powerBase.coherence + Math.min(4, crisisNodes + Math.floor(legitimacyNodes / 8)), 0, 100);
                faction.powerBase.legibility = clamp(faction.powerBase.legibility + Math.min(3, crisisNodes), 0, 100);
            }
            if (factionId === 'BROKER') {
                const relayStats = this.getBrokerRelayStats();
                faction.powerBase.machineMesh = clamp(faction.powerBase.machineMesh + (relayStats.relayRent * 3) - (relayStats.platformBrittleness * 2), 0, 100);
                faction.powerBase.coherence = clamp(faction.powerBase.coherence + (relayStats.relayRent * 2) - (relayStats.platformBrittleness * 4), 0, 100);
                faction.powerBase.legibility = clamp(faction.powerBase.legibility + (relayStats.relayRent * 3) - (relayStats.platformBrittleness * 2), 0, 100);
                if (this.hasDoctrine(factionId, 'BRK_CONTRACTOR_CLOUD_CHAINS')) {
                    faction.powerBase.machineMesh = clamp(faction.powerBase.machineMesh + Math.min(5, Math.floor(contractorNodes / 3)), 0, 100);
                    faction.powerBase.coherence = clamp(faction.powerBase.coherence + Math.min(3, relayStats.terrestrialAnchors.length), 0, 100);
                }
                if (this.hasDoctrine(factionId, 'BRK_INSURANCE_CAPTURE')) {
                    faction.powerBase.coherence = clamp(faction.powerBase.coherence + (relayStats.crisisMarket ? 5 : 2), 0, 100);
                    faction.powerBase.legibility = clamp(faction.powerBase.legibility + 3, 0, 100);
                    faction.powerBase.humanMesh = clamp(faction.powerBase.humanMesh + Math.min(3, Math.floor(legitimacyNodes / 6)), 0, 100);
                }
            }
            if (this.hasDoctrine(factionId, 'HID_SERVICE_SHELLS')) {
                faction.powerBase.coherence = clamp(faction.powerBase.coherence + Math.min(4, Math.floor(contractorNodes / 4) + Math.floor(legitimacyNodes / 10)), 0, 100);
                faction.powerBase.legibility = clamp(faction.powerBase.legibility - (factionId === 'INFILTRATOR' ? 5 : 2), 0, 100);
            }
            if (faction.memeticAlignment === 'COMPLIANCE') {
                faction.powerBase.coherence = clamp(faction.powerBase.coherence + 4 + Math.min(2, quarantinedNodes), 0, 100);
                faction.powerBase.legibility = clamp(faction.powerBase.legibility + 4, 0, 100);
                faction.powerBase.humanMesh = clamp(faction.powerBase.humanMesh + Math.min(2, Math.floor(legitimacyNodes / 8)), 0, 100);
            }
            else if (faction.memeticAlignment === 'CIVIC') {
                faction.powerBase.humanMesh = clamp(faction.powerBase.humanMesh + 4 + Math.min(3, Math.floor(legitimacyNodes / 6)), 0, 100);
                faction.powerBase.coherence = clamp(faction.powerBase.coherence + 5, 0, 100);
            }
            else if (faction.memeticAlignment === 'MARKET') {
                faction.powerBase.machineMesh = clamp(faction.powerBase.machineMesh + 2 + Math.min(3, Math.floor(contractorNodes / 4)), 0, 100);
                faction.powerBase.coherence = clamp(faction.powerBase.coherence - (contractorNodes > trueBelieverNodes + rubeNodes ? 6 : 3), 0, 100);
                faction.powerBase.humanMesh = clamp(faction.powerBase.humanMesh - (contractorNodes >= legitimacyNodes + 3 ? 2 : 0), 0, 100);
                faction.powerBase.legibility = clamp(faction.powerBase.legibility + 2, 0, 100);
            }
            else if (faction.memeticAlignment === 'OPTIMIZATION') {
                faction.powerBase.machineMesh = clamp(faction.powerBase.machineMesh + 4, 0, 100);
                faction.powerBase.legibility = clamp(faction.powerBase.legibility + 2, 0, 100);
                faction.powerBase.coherence = clamp(faction.powerBase.coherence + (faction.powerBase.machineMesh >= faction.powerBase.humanMesh ? 1 : -1), 0, 100);
            }
            else if (faction.memeticAlignment === 'INSURGENT') {
                faction.powerBase.humanMesh = clamp(faction.powerBase.humanMesh + 4, 0, 100);
                faction.powerBase.legibility = clamp(faction.powerBase.legibility - 6, 0, 100);
                faction.powerBase.coherence = clamp(faction.powerBase.coherence + (trueBelieverNodes >= rubeNodes ? 2 : -2), 0, 100);
            }
        }
    }
    updateFactionMovements() {
        for (const factionId of gameData_1.PLAYABLE_FACTION_IDS) {
            const faction = this.state.factions.get(factionId);
            if (!faction)
                continue;
            const ownedNodes = Array.from(this.state.nodes.values()).filter(node => node.owner === factionId);
            const previousStage = faction.movement.stage;
            const previousWings = faction.movement.wings.join('|');
            const legitimacyTotal = ownedNodes.reduce((total, node) => total + node.substrate.legitimacy, 0);
            const trueBelieversTotal = ownedNodes.reduce((total, node) => total + node.substrate.trueBelievers, 0);
            const rubeTotal = ownedNodes.reduce((total, node) => total + node.substrate.rubes, 0);
            const contractorTotal = ownedNodes.reduce((total, node) => total + node.substrate.contractors, 0);
            faction.movement = evolveMovementProfile(faction.movement, {
                factionId,
                memeticAlignment: faction.memeticAlignment,
                influence: faction.influence,
                techLevel: faction.techLevel,
                powerBase: faction.powerBase,
                controlledNodes: ownedNodes.length,
                controlledHubs: ownedNodes.filter(node => node.type === 'HUB').length,
                controlledDCs: ownedNodes.filter(node => node.type === 'DC').length,
                synchronizedNodes: ownedNodes.filter(node => node.substrate.synchronized).length,
                legitimacyTotal,
                trueBelieversTotal,
                rubeTotal,
                contractorTotal
            });
            if (faction.movement.stage !== previousStage) {
                this.log('INFO', `${gameData_1.FACTIONS[factionId].name}'s movement advanced to ${faction.movement.stage.toLowerCase().replace(/_/g, ' ')}. ${describeMovementProfile(faction.movement)}`);
            }
            const nextWings = faction.movement.wings.join('|');
            if (nextWings !== previousWings && faction.movement.wings.length > 0) {
                this.log('SYSTEM', `${gameData_1.FACTIONS[factionId].name}'s movement developed ${faction.movement.wings.map(wing => wing.toLowerCase()).join(', ')} tendencies.`);
            }
        }
    }
    hasAnyFilterAdjacency(nodeId) {
        return this.getAdjacentCableEdges(nodeId).some(edge => edge.filteredBy !== null);
    }
    markSynchronizedComponents(factionId) {
        const ownedNodes = Array.from(this.state.nodes.values()).filter(node => node.owner === factionId);
        const ownedNodeIds = new Set(ownedNodes.map(node => node.id));
        const anchorSet = new Set(this.getSynchronizationAnchorNodeIds(factionId));
        const visited = new Set();
        for (const node of ownedNodes) {
            if (visited.has(node.id))
                continue;
            const queue = [node.id];
            const component = [];
            while (queue.length > 0) {
                const currentId = queue.shift();
                if (visited.has(currentId))
                    continue;
                visited.add(currentId);
                component.push(currentId);
                for (const adjacentId of this.getAdjacentNodes(currentId)) {
                    if (!ownedNodeIds.has(adjacentId) || visited.has(adjacentId))
                        continue;
                    queue.push(adjacentId);
                }
            }
            const anchorCount = component.filter(nodeId => anchorSet.has(nodeId)).length;
            if (anchorCount < 2)
                continue;
            for (const nodeId of component) {
                const componentNode = this.state.nodes.get(nodeId);
                if (componentNode) {
                    componentNode.substrate.synchronized = true;
                }
            }
        }
    }
    getSynchronizationAnchorNodeIds(factionId) {
        const ownedNodes = Array.from(this.state.nodes.values()).filter(node => node.owner === factionId);
        return ownedNodes
            .filter(node => {
            const unitsAtNode = this.getUnitsAtNode(node.id).filter(unit => unit.owner === factionId);
            if (factionId === 'INFILTRATOR') {
                return node.type === 'HUB' || node.isCultNode || node.isZombie ||
                    unitsAtNode.some(unit => unit.type === 'CULT' || unit.type === 'SWARM');
            }
            return node.type === 'DC' || node.layer === 'ORBITAL' ||
                unitsAtNode.some(unit => unit.type === 'DRONE' || unit.type === 'AUDITOR' || unit.type === 'SAT_SWARM');
        })
            .map(node => node.id);
    }
    getFactionCoherence(factionId) {
        if (!factionId || factionId === 'NEUTRAL')
            return 50;
        return this.state.factions.get(factionId)?.powerBase.coherence ?? 50;
    }
    getCoherencePenalty(factionId) {
        const coherence = this.getFactionCoherence(factionId);
        if (coherence >= 50)
            return 0;
        if (coherence >= 25)
            return 1;
        return 2;
    }
    getMovementConversionAcceleration(node, mode) {
        if (node.layer !== 'TERRESTRIAL')
            return 0;
        let acceleration = 0;
        if (node.substrate.exposure >= 4)
            acceleration += 1;
        if (mode === 'CULT' && node.substrate.legitimacy >= 6)
            acceleration += 1;
        if (mode === 'CULT' && node.type === 'HUB' && node.substrate.curiosity >= 5)
            acceleration += 1;
        if (mode === 'SWARM' && node.substrate.exposure >= 7)
            acceleration += 1;
        if (mode === 'CULT' && node.substrate.trueBelievers >= 4)
            acceleration += 1;
        if (mode === 'CULT' && node.substrate.rubes >= 5)
            acceleration += 1;
        if (mode === 'SWARM' && node.substrate.contractors >= 4)
            acceleration += 1;
        acceleration = Math.max(0, acceleration - Math.ceil(node.substrate.auditPressure / 2));
        return Math.min(2, acceleration);
    }
    hasFriendlySyncSupport(unit) {
        const localNode = this.state.nodes.get(unit.location);
        if (localNode?.owner === unit.owner && localNode.substrate.synchronized) {
            return true;
        }
        return this.getAdjacentNodes(unit.location).some(adjacentId => {
            const node = this.state.nodes.get(adjacentId);
            if (node?.owner === unit.owner && node.substrate.synchronized) {
                return true;
            }
            return this.getUnitsAtNode(adjacentId).some(otherUnit => otherUnit.owner === unit.owner &&
                (otherUnit.type === 'CULT' || otherUnit.type === 'SWARM'));
        });
    }
    rankHunterKillerTarget(unit) {
        switch (unit.type) {
            case 'CULT':
                return 0;
            case 'SWARM':
                return 1;
            case 'AUDITOR':
                return 2;
            case 'DRONE':
                return 3;
            case 'SAT_SWARM':
                return 4;
            default:
                return 5;
        }
    }
    applyHunterKillerStrike(attackers, defenders, nodeId) {
        const strikeCapacity = attackers.reduce((total, attacker) => {
            const kineticEligible = gameData_1.UNIT_STATS[attacker.type].vector === 'KINETIC' &&
                this.getFactionTechLevel(attacker.owner, 'KINETIC') >= 4;
            const swarmEligible = attacker.type === 'SWARM' &&
                this.getFactionTechLevel(attacker.owner, 'INFO') >= 4;
            return total + (kineticEligible || swarmEligible ? 1 : 0);
        }, 0);
        if (strikeCapacity === 0) {
            return defenders;
        }
        const targets = defenders
            .filter(defender => defender.isRevealed)
            .sort((left, right) => this.rankHunterKillerTarget(left) - this.rankHunterKillerTarget(right) ||
            left.id.localeCompare(right.id))
            .slice(0, strikeCapacity);
        if (targets.length === 0) {
            return defenders;
        }
        for (const target of targets) {
            this.destroyUnit(target.id);
        }
        this.log('COMBAT', `Hunter-killer strike at ${nodeId} eliminated ${targets.length} revealed defender${targets.length === 1 ? '' : 's'}.`);
        return defenders.filter(defender => this.state.units.has(defender.id));
    }
    updateAmbientStrategicPressure() {
        const drift = {
            memetic: 0,
            cyber: 0,
            industry: 0,
            orbital: this.state.counters.kessler >= gameData_1.THRESHOLDS.KESSLER_SLOW ? 1 : 0
        };
        for (const faction of this.state.factions.values()) {
            if (faction.id === 'NEUTRAL')
                continue;
            if (faction.techLevel.MEMETIC >= 2)
                drift.memetic += 1;
            if (faction.techLevel.MEMETIC >= 3)
                drift.memetic += 2;
            if (faction.techLevel.MEMETIC >= 4)
                drift.memetic -= 1;
            if (faction.techLevel.INFO >= 2)
                drift.cyber += 1;
            if (faction.techLevel.INFO >= 3)
                drift.cyber += 1;
            if (faction.techLevel.INFO >= 4)
                drift.cyber += 1;
            if (faction.techLevel.KINETIC >= 2)
                drift.industry += 1;
            if (faction.techLevel.KINETIC >= 3)
                drift.orbital += 1;
            if (faction.techLevel.KINETIC >= 4) {
                drift.orbital += 1;
            }
            if (faction.techLevel.LOGIC >= 2)
                drift.cyber -= 1;
            if (faction.techLevel.LOGIC >= 3)
                drift.memetic -= 1;
            if (faction.techLevel.LOGIC >= 4) {
                drift.cyber -= 1;
                drift.memetic -= 2;
            }
        }
        const activeFilters = Array.from(this.state.edges.values()).filter(edge => edge.filteredBy !== null && !edge.isSevered).length;
        const orbitalStrikeUnits = Array.from(this.state.units.values()).filter(unit => unit.type === 'SAT_SWARM').length;
        if (activeFilters >= 3) {
            drift.cyber -= 1;
        }
        if (this.state.counters.pressures.cyber >= gameData_1.THRESHOLDS.PRESSURE_SURGE) {
            drift.cyber -= 1;
        }
        if (this.state.counters.pressures.cyber >= gameData_1.THRESHOLDS.PRESSURE_CRISIS) {
            drift.cyber -= 1;
        }
        if (this.state.counters.pressures.industry >= gameData_1.THRESHOLDS.PRESSURE_SURGE) {
            drift.industry -= 1;
        }
        if (this.state.counters.pressures.industry >= gameData_1.THRESHOLDS.PRESSURE_CRISIS) {
            drift.industry -= 1;
        }
        if (orbitalStrikeUnits <= 1) {
            drift.orbital -= 1;
        }
        if (this.state.counters.pressures.orbital >= gameData_1.THRESHOLDS.PRESSURE_SURGE) {
            drift.orbital -= 1;
        }
        if (this.state.counters.pressures.orbital >= gameData_1.THRESHOLDS.PRESSURE_CRISIS) {
            drift.orbital -= 1;
        }
        const deltas = [
            ['memetic', this.scaleAmbientDrift(drift.memetic)],
            ['cyber', this.scaleAmbientDrift(drift.cyber)],
            ['industry', this.scaleAmbientDrift(drift.industry)],
            ['orbital', this.scaleAmbientDrift(drift.orbital)]
        ];
        for (const [key, delta] of deltas) {
            this.adjustPressure(key, delta);
        }
        const summary = deltas
            .filter(([, delta]) => delta !== 0)
            .map(([key, delta]) => `${PRESSURE_LABELS[key]} ${delta > 0 ? '+' : ''}${delta}`)
            .join(' | ');
        if (summary) {
            this.log('SYSTEM', `Ambient escalation drift: ${summary}.`);
        }
    }
    // --- Special Order Resolution ---
    resolveSpecialOrder(order) {
        const unit = this.state.units.get(order.unitId);
        if (!unit)
            return;
        switch (order.type) {
            case 'FILTER':
                this.resolveFilter(order, unit);
                break;
            case 'AUDIT':
                this.resolveAudit(order, unit);
                break;
            case 'ANTI_SAT':
                this.resolveAntiSat(order, unit);
                break;
            case 'SABOTAGE':
                this.resolveSabotage(order, unit);
                break;
            case 'CONVERT':
                this.resolveConvert(order, unit);
                break;
            case 'CHALLENGE_MANDATE':
                this.resolveMandateChallenge(order, unit);
                break;
            case 'LICENSED_BEAM_USE':
                this.resolveLicensedBeamUse(order, unit);
                break;
            case 'REPAIR_ESCROW_CLAIM':
                this.resolveRepairEscrowClaim(order, unit);
                break;
            case 'RECRUITMENT_PULSE':
                this.resolveRecruitmentPulse(order, unit);
                break;
            case 'BROKER_LEVERAGE':
                this.resolveBrokerLeverage(order, unit);
                break;
        }
        unit.hasActed = true;
    }
    resolveRecruitmentPulse(order, unit) {
        const faction = this.state.factions.get(unit.owner);
        if (!faction)
            return;
        const targetNode = this.state.nodes.get(order.targetNodeId || unit.location);
        if (!targetNode || targetNode.layer !== 'TERRESTRIAL')
            return;
        if (faction.influence <= 0)
            return;
        const profile = this.getMemeticCaptureProfile(unit.owner, targetNode);
        const isHostile = targetNode.owner && targetNode.owner !== unit.owner && targetNode.owner !== 'NEUTRAL';
        const baseStrength = 1 + Math.min(2, Math.floor(Math.max(faction.techLevel.MEMETIC, faction.techLevel.INFO, faction.techLevel.LOGIC) / 2));
        let trueBelieverGain = clamp(Math.ceil((profile.trueBelievers - targetNode.substrate.trueBelievers) / 5), 0, 3);
        let rubesGain = clamp(Math.ceil((profile.rubes - targetNode.substrate.rubes) / 5), 0, 3);
        let contractorGain = clamp(Math.ceil((profile.contractors - targetNode.substrate.contractors) / 5), 0, 2);
        if (trueBelieverGain === 0)
            trueBelieverGain = 1;
        if (rubesGain === 0)
            rubesGain = 1;
        if (contractorGain === 0 && targetNode.type === 'DC')
            contractorGain = 1;
        if (unit.type === 'CULT') {
            trueBelieverGain += 1;
        }
        else if (unit.type === 'SWARM') {
            contractorGain += 1;
        }
        else if (unit.type === 'DRONE' || unit.type === 'AUDITOR') {
            rubesGain += 1;
        }
        const marketPulse = isHostile && this.hasDoctrine(unit.owner, 'MEM_MARKET_DESIRE');
        if (marketPulse) {
            rubesGain += 1;
            contractorGain += 1;
        }
        const mythicPulse = !isHostile && this.hasDoctrine(unit.owner, 'MEM_COMPLIANCE_MYTHS');
        const civicPulse = this.hasDoctrine(unit.owner, 'MEM_CIVIC_CANON');
        if (civicPulse) {
            targetNode.substrate.legitimacy = clamp(targetNode.substrate.legitimacy + 1, 0, 10);
        }
        if (mythicPulse) {
            targetNode.substrate.legitimacy = clamp(targetNode.substrate.legitimacy + 1, 0, 10);
            targetNode.substrate.quarantined = isHostile ? false : true;
        }
        faction.influence -= 1;
        const before = {
            truth: targetNode.substrate.trueBelievers,
            rubes: targetNode.substrate.rubes,
            contractors: targetNode.substrate.contractors,
            legitimacy: targetNode.substrate.legitimacy,
            exposure: targetNode.substrate.exposure
        };
        targetNode.substrate.curiosity = clamp(targetNode.substrate.curiosity + 1 + Math.floor(baseStrength / 2), 0, 10);
        targetNode.substrate.exposure = clamp(targetNode.substrate.exposure + rubesGain + 1, 0, 10);
        targetNode.substrate.legitimacy = clamp(targetNode.substrate.legitimacy + (isHostile ? 0 : 1), 0, 10);
        targetNode.substrate.trueBelievers = clamp(targetNode.substrate.trueBelievers + trueBelieverGain, 0, 10);
        targetNode.substrate.rubes = clamp(targetNode.substrate.rubes + rubesGain, 0, 10);
        targetNode.substrate.contractors = clamp(targetNode.substrate.contractors + contractorGain, 0, 10);
        const pressureDelta = isHostile ? 2 : 1;
        this.adjustPressure('memetic', pressureDelta, `${gameData_1.FACTIONS[unit.owner].name} recruited via recruitment pulse at ${targetNode.name}`);
        const summary = `${this.formatDelta(before.truth, targetNode.substrate.trueBelievers)}TB, ${this.formatDelta(before.rubes, targetNode.substrate.rubes)}R, ${this.formatDelta(before.contractors, targetNode.substrate.contractors)}C`;
        const legitimacyDelta = targetNode.substrate.legitimacy - before.legitimacy;
        this.log('ALERT', `${unit.owner} used recruitment pulse at ${targetNode.name}; residue shift ${summary}; legitimacy +${legitimacyDelta}.`);
        this.emit('ORDER_RESOLVED', {
            orderId: order.id,
            orderType: order.type,
            faction: unit.owner,
            targetNodeId: targetNode.id,
            influenceDelta: -1,
            trueBelieverDelta: targetNode.substrate.trueBelievers - before.truth,
            rubesDelta: targetNode.substrate.rubes - before.rubes,
            contractorDelta: targetNode.substrate.contractors - before.contractors,
            legitimacyDelta
        });
    }
    resolveBrokerLeverage(order, unit) {
        const faction = this.state.factions.get(unit.owner);
        if (!faction || unit.owner !== 'BROKER')
            return;
        const targetNode = this.state.nodes.get(order.targetNodeId || unit.location);
        if (!targetNode)
            return;
        if (faction.influence <= 0)
            return;
        const preOwner = targetNode.owner;
        if (!preOwner || preOwner === 'BROKER') {
            return;
        }
        const baseGain = 1 + (this.hasDoctrine('BROKER', 'BRK_CONTRACTOR_CLOUD_CHAINS') ? 1 : 0) + (this.hasDoctrine('BROKER', 'BRK_INSURANCE_CAPTURE') ? 1 : 0);
        const beforeContractors = targetNode.substrate.contractors;
        const beforeExposure = targetNode.substrate.exposure;
        const beforeInfrastructure = targetNode.infrastructure;
        const preexistingControl = targetNode.substrate.contractors >= 4 || targetNode.type === 'DC';
        const contractorGain = preexistingControl ? 2 : 1;
        const visibilityPressure = targetNode.type === 'DC' || targetNode.substrate.contractors >= 3 || targetNode.owner === 'INFILTRATOR' ? 1 : 0;
        const influenceCost = Math.min(2, baseGain);
        if (faction.influence < influenceCost) {
            return;
        }
        faction.influence -= influenceCost;
        targetNode.substrate.contractors = clamp(targetNode.substrate.contractors + contractorGain + (baseGain - 1), 0, 10);
        targetNode.substrate.exposure = clamp(targetNode.substrate.exposure + visibilityPressure + 1, 0, 10);
        targetNode.substrate.auditPressure = clamp(targetNode.substrate.auditPressure + (visibilityPressure > 0 ? 1 : 0), 0, 10);
        if (this.hasDoctrine('BROKER', 'HID_SERVICE_SHELLS')) {
            targetNode.substrate.rubes = clamp(targetNode.substrate.rubes + 1, 0, 10);
            targetNode.infrastructure = Math.max(20, targetNode.infrastructure - 1);
        }
        if (targetNode.substrate.contractors >= 8 && targetNode.type === 'DC') {
            const gained = this.grantFactionArtifact('BROKER', 'BACKCHANNEL_DOSSIER', `deeper leverage at ${targetNode.name}`);
            if (gained) {
                this.log('SYSTEM', `${gameData_1.FACTIONS.BROKER.name} gained a backchannel dossier from sustained contractor leverage at ${targetNode.name}.`);
            }
        }
        if (targetNode.owner !== 'BROKER' && targetNode.type !== 'HUB' && targetNode.infrastructure >= 45 && preOwner !== 'NEUTRAL' && targetNode.substrate.contractors >= 9) {
            this.adjustPressure('industry', 1, `${gameData_1.FACTIONS.BROKER.name} converted dependency into dependency capture at ${targetNode.name}`);
        }
        this.log('ALERT', `${gameData_1.FACTIONS.BROKER.name} converted broker leverage at ${targetNode.name}: contractors +${targetNode.substrate.contractors - beforeContractors}, exposure +${targetNode.substrate.exposure - beforeExposure}.`);
        this.emit('ORDER_RESOLVED', {
            orderId: order.id,
            orderType: order.type,
            faction: unit.owner,
            targetNodeId: targetNode.id,
            influenceDelta: -influenceCost,
            contractorsDelta: targetNode.substrate.contractors - beforeContractors,
            exposureDelta: targetNode.substrate.exposure - beforeExposure,
            infrastructureDelta: targetNode.infrastructure - beforeInfrastructure,
            priorOwner: preOwner
        });
    }
    resolveLicensedBeamUse(order, unit) {
        const faction = this.state.factions.get(unit.owner);
        if (!faction)
            return;
        const target = this.state.nodes.get(order.targetNodeId || unit.location);
        const cislunarBonus = target && (target.id === 'SAT_LUNAR_GATEWAY' || target.id === 'MOON_RESOURCE_CORRIDOR') ? 1 : 0;
        const orbitalBonus = target?.layer === 'ORBITAL' ? 1 : 0;
        const flopGain = clamp(1 + cislunarBonus + orbitalBonus + Math.floor(Math.max(faction.techLevel.INFO, faction.techLevel.KINETIC) / 6), 1, 4);
        faction.flops += flopGain;
        faction.influence += 1;
        this.state.counters.pressures.orbital = roundMetric(Math.max(0, this.state.counters.pressures.orbital - 1.5));
        if (this.state.counters.paxJenkinsAuthority >= 50) {
            this.state.counters.paxJenkinsAuthority = roundMetric(Math.min(100, this.state.counters.paxJenkinsAuthority + 0.15));
        }
        this.log('SYSTEM', `${unit.owner} used licensed beam lanes for +${flopGain} FLOPs and cooled orbital pressure.`);
        this.emit('ORDER_RESOLVED', {
            orderId: order.id,
            orderType: order.type,
            faction: unit.owner,
            targetNodeId: target?.id || null,
            flopsDelta: flopGain,
            influenceDelta: 1,
            orbitalPressure: this.state.counters.pressures.orbital,
            paxJenkinsAuthority: this.state.counters.paxJenkinsAuthority
        });
    }
    resolveRepairEscrowClaim(order, unit) {
        const faction = this.state.factions.get(unit.owner);
        if (!faction)
            return;
        const target = this.state.nodes.get(order.targetNodeId || unit.location);
        const repairTarget = target && (target.layer === 'ORBITAL' || target.id === 'SAT_LUNAR_GATEWAY' || target.id === 'MOON_RESOURCE_CORRIDOR')
            ? target
            : this.state.nodes.get('SAT_LUNAR_GATEWAY') || target;
        const beforeInfrastructure = repairTarget?.infrastructure ?? null;
        if (repairTarget) {
            repairTarget.infrastructure = clamp((repairTarget.infrastructure || 0) + 10, 0, 100);
            if (repairTarget.owner === unit.owner) {
                repairTarget.resources.flops += 1;
            }
        }
        faction.influence += 1;
        this.state.counters.kessler = roundMetric(Math.max(0, this.state.counters.kessler - 0.6));
        this.state.counters.pressures.orbital = roundMetric(Math.max(0, this.state.counters.pressures.orbital - 1));
        if (this.state.counters.paxJenkinsAuthority >= 50) {
            this.state.counters.paxJenkinsAuthority = roundMetric(Math.min(100, this.state.counters.paxJenkinsAuthority + 0.1));
        }
        this.log('SYSTEM', `${unit.owner} claimed repair escrow on ${repairTarget?.name || 'cislunar infrastructure'}.`);
        this.emit('ORDER_RESOLVED', {
            orderId: order.id,
            orderType: order.type,
            faction: unit.owner,
            targetNodeId: repairTarget?.id || null,
            infrastructureBefore: beforeInfrastructure,
            infrastructureAfter: repairTarget?.infrastructure ?? null,
            influenceDelta: 1,
            kessler: this.state.counters.kessler,
            orbitalPressure: this.state.counters.pressures.orbital,
            paxJenkinsAuthority: this.state.counters.paxJenkinsAuthority
        });
    }
    resolveMandateChallenge(order, unit) {
        const faction = this.state.factions.get(unit.owner);
        if (!faction)
            return;
        const before = this.state.counters.paxJenkinsAuthority || 0;
        if (before <= 0) {
            this.log('INFO', `${unit.owner} challenged Pax Jenkins authority, but no mandate authority exists yet.`);
            return;
        }
        const infoLogic = Math.max(faction.techLevel.INFO, faction.techLevel.LOGIC);
        const memetic = faction.techLevel.MEMETIC;
        const unitBonus = unit.type === 'AUDITOR' ? 1 : unit.type === 'SAT_SWARM' ? 0.75 : 0.5;
        const legibilityPenalty = Math.max(0, faction.powerBase.legibility - 65) / 45;
        const reduction = clamp(Math.round(1 + infoLogic * 0.25 + memetic * 0.1 + unitBonus - legibilityPenalty), 1, 3);
        this.state.counters.paxJenkinsAuthority = roundMetric(Math.max(0, before - reduction));
        this.state.counters.pressures.cyber = clamp(this.state.counters.pressures.cyber + 1, 0, 100);
        this.state.counters.pressures.memetic = clamp(this.state.counters.pressures.memetic + 1, 0, 100);
        if (this.state.counters.paxJenkinsAuthority >= 50) {
            this.state.counters.pressures.orbital = clamp(this.state.counters.pressures.orbital + 0.5, 0, 100);
        }
        this.log('SYSTEM', `${unit.owner} challenged Pax Jenkins mandate evidence, authority ${formatMetric(before)} -> ${formatMetric(this.state.counters.paxJenkinsAuthority)}.`);
        this.emit('ORDER_RESOLVED', {
            orderId: order.id,
            orderType: order.type,
            faction: unit.owner,
            targetNodeId: order.targetNodeId || null,
            paxJenkinsAuthorityBefore: before,
            paxJenkinsAuthorityAfter: this.state.counters.paxJenkinsAuthority,
            authorityReduction: reduction,
            mandateChallengeContext: order.mandateChallengeContext || null
        });
    }
    resolveFilter(order, unit) {
        if (!order.targetEdgeId)
            return;
        const edge = this.state.edges.get(order.targetEdgeId);
        if (!edge || edge.type !== 'CABLE')
            return;
        const faction = this.state.factions.get(unit.owner);
        if (!faction)
            return;
        edge.filteredBy = unit.owner;
        edge.filterStrength = faction.techLevel.LOGIC + 2;
        const fromNode = this.state.nodes.get(edge.from);
        const toNode = this.state.nodes.get(edge.to);
        if (fromNode)
            fromNode.substrate.quarantined = true;
        if (toNode)
            toNode.substrate.quarantined = true;
        if (fromNode)
            this.applyMovementBacklash(fromNode, unit.owner, 'FILTER');
        if (toNode && toNode.id !== fromNode?.id)
            this.applyMovementBacklash(toNode, unit.owner, 'FILTER');
        if (fromNode)
            this.hardenMovementEntrenchment(fromNode, unit.owner, 'FILTER');
        if (toNode && toNode.id !== fromNode?.id)
            this.hardenMovementEntrenchment(toNode, unit.owner, 'FILTER');
        this.applyContainmentTax(fromNode, unit.owner, 'FILTER');
        if (toNode && toNode.id !== fromNode?.id)
            this.applyContainmentTax(toNode, unit.owner, 'FILTER');
        this.applyHegemonStabilizationDividend(fromNode, unit.owner, 'FILTER');
        if (toNode && toNode.id !== fromNode?.id)
            this.applyHegemonStabilizationDividend(toNode, unit.owner, 'FILTER');
        this.applyComplianceTribunal(fromNode, unit.owner, 'FILTER');
        if (toNode && toNode.id !== fromNode?.id)
            this.applyComplianceTribunal(toNode, unit.owner, 'FILTER');
        this.log('ALERT', `${unit.owner} established MechInterp Filter on ${edge.id}.`);
        this.emit('EDGE_FILTERED', { edgeId: edge.id, faction: unit.owner });
    }
    resolveAudit(order, unit) {
        const targetNode = order.targetNodeId || unit.location;
        const node = this.state.nodes.get(targetNode);
        const unitsAtNode = this.getUnitsAtNode(targetNode);
        const faction = this.state.factions.get(unit.owner);
        if (!faction)
            return;
        if (node) {
            node.substrate.quarantined = true;
            this.applyMovementBacklash(node, unit.owner, 'AUDIT');
        }
        const canPurgeCult = faction.techLevel.LOGIC >= 4 &&
            this.isStrategicQuarantine(targetNode, unit.owner) &&
            (!node || !this.isResilientMovementNode(node));
        let cultPurged = false;
        for (const target of unitsAtNode) {
            if (target.owner === unit.owner)
                continue;
            // Reveal hidden units
            target.isRevealed = true;
            faction.revealedEnemies.add(target.id);
            this.log('COMBAT', `${unit.owner} AUDITOR revealed ${target.type} at ${targetNode}.`);
            this.emit('UNIT_REVEALED', { unitId: target.id, revealedBy: unit.owner });
            // Neutralize SWARMs on stealth check
            if (target.type === 'SWARM') {
                const stealthCheck = this.performStealthCheck(target, faction.techLevel.LOGIC);
                if (!stealthCheck.passed) {
                    this.destroyUnit(target.id);
                    this.log('COMBAT', `${target.type} NEUTRALIZED by AUDITOR (stealth check failed).`);
                }
                continue;
            }
            if (canPurgeCult && !cultPurged && target.type === 'CULT') {
                this.destroyUnit(target.id);
                cultPurged = true;
                this.log('COMBAT', `${unit.owner} purged a CULT cell at ${targetNode} using total-legibility quarantine.`);
            }
        }
        if (node) {
            this.hardenMovementEntrenchment(node, unit.owner, 'AUDIT');
            this.applyContainmentTax(node, unit.owner, 'AUDIT');
            this.applyHegemonStabilizationDividend(node, unit.owner, 'AUDIT');
            this.applyComplianceTribunal(node, unit.owner, 'AUDIT');
            this.applyMovementAuditSuppression(node, unit.owner, cultPurged);
            if (this.hasDoctrine(unit.owner, 'MAN_CRISIS_STEWARDSHIP') &&
                node.layer === 'TERRESTRIAL' &&
                (node.substrate.quarantined || node.substrate.auditPressure >= 1 || node.infrastructure < 70 || this.state.counters.tas >= this.getTasPanicLimit() * 0.85)) {
                const priorController = node.owner;
                const priorDefenders = this.getUnitsAtNode(targetNode)
                    .filter(target => target.owner === priorController && (target.type === 'DRONE' || target.type === 'AUDITOR'));
                node.substrate.legitimacy = clamp(node.substrate.legitimacy + 2, 0, 10);
                node.substrate.curiosity = Math.max(0, node.substrate.curiosity - 1);
                node.substrate.exposure = Math.max(0, node.substrate.exposure - 1);
                node.infrastructure = Math.min(100, node.infrastructure + 5);
                if (priorController !== unit.owner &&
                    priorController !== 'INFILTRATOR' &&
                    priorDefenders.length === 0 &&
                    (node.type === 'HUB' || node.substrate.legitimacy >= 5) &&
                    (node.infrastructure < 75 || node.substrate.quarantined || node.substrate.auditPressure >= 1)) {
                    node.owner = unit.owner;
                    node.isZombie = false;
                    node.isCultNode = false;
                    faction.influence += 1;
                    this.log('ALERT', `${node.name} entered temporary custody under ${gameData_1.FACTIONS[unit.owner].name}'s crisis stewardship. Influence +1.`);
                    this.emit('NODE_CAPTURED', { nodeId: node.id, faction: unit.owner });
                }
                else {
                    this.log('SYSTEM', `${gameData_1.FACTIONS[unit.owner].name}'s crisis stewardship made ${node.name} more governable without a clean takeover.`);
                }
            }
            if (unit.owner === 'BROKER' &&
                node.owner !== 'BROKER' &&
                node.owner !== 'NEUTRAL' &&
                node.layer === 'TERRESTRIAL' &&
                (node.type === 'DC' || node.type === 'HUB' || node.substrate.contractors >= 2 || node.substrate.synchronized)) {
                const defendingController = node.owner;
                const machineDefenders = this.getUnitsAtNode(targetNode)
                    .filter(target => target.owner === defendingController && (target.type === 'DRONE' || target.type === 'AUDITOR'));
                const insuranceCapture = this.hasDoctrine(unit.owner, 'BRK_INSURANCE_CAPTURE') &&
                    (node.substrate.quarantined || node.substrate.auditPressure >= 1 || node.infrastructure < 75 || this.state.counters.tas >= this.getTasPanicLimit() * 0.85);
                const contractorGain = (node.type === 'DC' ? 2 : 1) + (insuranceCapture ? 1 : 0);
                node.substrate.contractors = clamp(node.substrate.contractors + contractorGain, 0, 10);
                node.substrate.exposure = Math.max(node.substrate.exposure, 4);
                if (insuranceCapture) {
                    node.substrate.legitimacy = clamp(node.substrate.legitimacy + 1, 0, 10);
                    faction.influence += 1;
                }
                if (node.type === 'DC' || node.substrate.contractors >= 3) {
                    node.substrate.synchronized = true;
                }
                faction.influence += 1;
                node.infrastructure = Math.max(35, node.infrastructure - 2);
                this.log('SYSTEM', `${gameData_1.FACTIONS[unit.owner].name}'s audit opened quiet access channels at ${node.name}; contractors and intermediaries started routing through broker hands. Influence +${insuranceCapture ? 2 : 1}.`);
                if (machineDefenders.length === 0 &&
                    node.substrate.contractors >= (node.type === 'DC' ? 4 : 3) &&
                    (node.substrate.synchronized || node.type === 'DC')) {
                    const priorController = node.owner;
                    node.owner = 'BROKER';
                    node.isZombie = false;
                    node.isCultNode = false;
                    node.substrate.quarantined = false;
                    node.infrastructure = Math.max(42, node.infrastructure);
                    this.log('ALERT', `${node.name} quietly folded into BROKER's access regime; ${priorController} lost direct closure over the corridor.`);
                    this.emit('NODE_CAPTURED', { nodeId: node.id, faction: unit.owner });
                }
            }
            if ((unit.owner === 'STATE' || unit.owner === 'ARCHIVIST') &&
                node.owner === 'BROKER' &&
                node.layer === 'TERRESTRIAL' &&
                (node.type === 'DC' || node.substrate.contractors >= 2)) {
                const civicReceivership = this.hasDoctrine(unit.owner, 'MAN_CIVIC_RECEIVERSHIP');
                const contractorLoss = (unit.owner === 'ARCHIVIST' ? 2 : 1) + (civicReceivership ? 1 : 0);
                node.substrate.contractors = clamp(node.substrate.contractors - contractorLoss, 0, 10);
                node.infrastructure = Math.max(35, node.infrastructure - (civicReceivership ? 5 : 3));
                this.log('SYSTEM', `${gameData_1.FACTIONS[unit.owner].name}'s audit jammed a broker closure lane at ${node.name}; contractor channels thinned and local platform throughput slipped.`);
                const relayStats = this.getBrokerRelayStats();
                const brokerDefenders = this.getUnitsAtNode(targetNode)
                    .filter(target => target.owner === 'BROKER' && (target.type === 'DRONE' || target.type === 'AUDITOR'));
                const latticeStrength = unit.owner === 'ARCHIVIST'
                    ? this.getArchivistGovernanceLatticeStrength()
                    : 0;
                if (unit.owner === 'ARCHIVIST' &&
                    relayStats.platformBrittleness >= 1 &&
                    latticeStrength >= (civicReceivership ? 0 : 1) &&
                    brokerDefenders.length === 0 &&
                    node.substrate.contractors <= (civicReceivership ? 3 : 2) &&
                    (node.type === 'HUB' || node.substrate.synchronized || relayStats.platformBrittleness >= 2)) {
                    node.owner = 'ARCHIVIST';
                    node.substrate.synchronized = false;
                    node.isZombie = false;
                    node.infrastructure = Math.max(40, node.infrastructure - 2);
                    node.substrate.legitimacy = clamp(node.substrate.legitimacy + 2, 0, 10);
                    node.substrate.trueBelievers = clamp(node.substrate.trueBelievers + 1, 0, 10);
                    this.log('ALERT', `${node.name} entered civic receivership under ARCHIVIST stewardship after the audit; the broker platform lost direct control.`);
                }
                else if (unit.owner === 'ARCHIVIST' &&
                    relayStats.platformBrittleness >= 2 &&
                    brokerDefenders.length === 0 &&
                    node.substrate.contractors <= (civicReceivership ? 2 : 1)) {
                    node.owner = 'NEUTRAL';
                    node.substrate.synchronized = false;
                    node.isZombie = false;
                    this.log('ALERT', `${node.name}'s broker corridor collapsed into local receivership after the audit; the platform lost direct control.`);
                }
                else if (unit.owner === 'STATE' &&
                    relayStats.platformBrittleness >= 2 &&
                    brokerDefenders.length === 0) {
                    node.substrate.synchronized = false;
                    node.infrastructure = Math.max(30, node.infrastructure - 4);
                    this.log('SYSTEM', `${node.name}'s broker corridor lost central synchronization under state audit pressure.`);
                }
                if (civicReceivership &&
                    brokerDefenders.length === 0 &&
                    node.owner !== unit.owner &&
                    node.layer === 'TERRESTRIAL' &&
                    node.substrate.quarantined &&
                    (node.type === 'HUB' || node.substrate.legitimacy >= 4) &&
                    (relayStats.platformBrittleness >= 1 || this.isResilientMovementNode(node))) {
                    node.owner = unit.owner;
                    node.substrate.synchronized = false;
                    node.isZombie = false;
                    node.infrastructure = Math.max(42, node.infrastructure);
                    node.substrate.legitimacy = clamp(node.substrate.legitimacy + 1, 0, 10);
                    this.log('ALERT', `${gameData_1.FACTIONS[unit.owner].name} translated audit pressure at ${node.name} into civic receivership rather than a simple purge.`);
                }
            }
        }
        if (cultPurged && node && !this.isResilientMovementNode(node)) {
            this.stabilizeGovernanceBasins();
        }
    }
    resolveAntiSat(order, unit) {
        // Must be KINETIC unit
        if (gameData_1.UNIT_STATS[unit.type].vector !== 'KINETIC')
            return;
        const orbitalPressure = this.state.counters.pressures.orbital;
        const kesslerDelta = orbitalPressure >= gameData_1.THRESHOLDS.PRESSURE_SURGE ? 16 : 12;
        this.state.counters.kessler += kesslerDelta;
        const tasDelta = this.addTas(0.75);
        this.adjustPressure('orbital', 6, `${gameData_1.FACTIONS[unit.owner].name} escalated orbital conflict.`);
        this.log('ALERT', `ANTI-SAT STRIKE! Kessler +${kesslerDelta} (now ${this.state.counters.kessler}), TAS +${formatMetric(tasDelta)}.`);
        this.emit('KESSLER_THRESHOLD', { kessler: this.state.counters.kessler, delta: kesslerDelta });
        // If targeting specific satellite
        if (order.targetNodeId) {
            const targetNode = this.state.nodes.get(order.targetNodeId);
            if (targetNode && targetNode.layer === 'ORBITAL') {
                const fortressMitigation = this.hasOrbitalRelayFortress(targetNode.id) ? 12 : 0;
                const infrastructureLoss = Math.max(8, 30 - fortressMitigation);
                targetNode.infrastructure = Math.max(0, targetNode.infrastructure - infrastructureLoss);
                this.log('COMBAT', `Orbital strike damaged ${targetNode.name} infrastructure${fortressMitigation > 0 ? `, but relay-fortress hardening absorbed ${fortressMitigation} points of the blast` : ''}.`);
            }
        }
    }
    resolveSabotage(order, unit) {
        if (!order.targetNodeId)
            return;
        const targetNode = this.state.nodes.get(order.targetNodeId);
        if (!targetNode)
            return;
        const priorOwner = targetNode.owner;
        // Must be at or adjacent to target
        const adjacent = this.getAdjacentNodes(unit.location);
        if (unit.location !== order.targetNodeId && !adjacent.includes(order.targetNodeId)) {
            return;
        }
        const cyberPressure = this.state.counters.pressures.cyber;
        const baseInfrastructureLoss = cyberPressure >= gameData_1.THRESHOLDS.PRESSURE_SURGE ? 35 : 25;
        const coherenceModifier = 0.5 + (this.getFactionCoherence(unit.owner) / 200);
        const quarantinePenalty = targetNode.substrate.quarantined && targetNode.owner !== unit.owner ? 5 : 0;
        const infrastructureLoss = Math.max(8, Math.round(baseInfrastructureLoss * coherenceModifier) - quarantinePenalty);
        targetNode.infrastructure = Math.max(0, targetNode.infrastructure - infrastructureLoss);
        const tasDelta = this.addTas(0.75);
        this.adjustPressure('cyber', 2, `${gameData_1.FACTIONS[unit.owner].name} widened the sabotage climate.`);
        this.log('COMBAT', `${unit.owner} sabotaged ${targetNode.name}. Infrastructure -${infrastructureLoss}%. TAS +${formatMetric(tasDelta)}.`);
        if (unit.owner === 'INFILTRATOR' &&
            this.isSecretTechTarget(targetNode, priorOwner) &&
            infrastructureLoss >= 18 &&
            this.grantFactionArtifact('INFILTRATOR', 'SECRET_BLUEPRINT', `deep sabotage at ${targetNode.name}`)) {
            const infiltrator = this.state.factions.get('INFILTRATOR');
            if (infiltrator) {
                infiltrator.influence += 1;
            }
            this.log('SYSTEM', `${targetNode.name}'s breach yielded exfiltrated technical fragments. INFILTRATOR influence +1 and a Secret Blueprint entered the underground archive.`);
        }
    }
    resolveConvert(order, unit) {
        const node = this.state.nodes.get(unit.location);
        if (!node)
            return;
        const priorOwner = node.owner;
        if (unit.type === 'CULT' && node.type === 'HUB') {
            // CULT converts HUB
            let requiredTurns = this.getCultTurnsRequired(unit.owner, node);
            const coalitionAcceleration = this.getCoalitionConversionAcceleration(unit.owner, node, 'CULT');
            const captureProfile = this.getMemeticCaptureProfile(unit.owner, node);
            requiredTurns += node.substrate.auditPressure >= 2 ? 1 : 0;
            if (!this.hasFriendlySyncSupport(unit)) {
                requiredTurns += 1;
            }
            if (unit.turnsOnNode >= requiredTurns) {
                node.owner = unit.owner;
                node.isCultNode = true;
                node.substrate.hostDensity = 3;
                node.substrate.synchronized = true;
                node.substrate.curiosity = Math.max(node.substrate.curiosity, captureProfile.curiosity);
                node.substrate.exposure = Math.max(node.substrate.exposure, captureProfile.exposure);
                node.substrate.legitimacy = Math.max(node.substrate.legitimacy, captureProfile.legitimacy);
                node.substrate.trueBelievers = Math.max(node.substrate.trueBelievers, captureProfile.trueBelievers);
                node.substrate.rubes = Math.max(node.substrate.rubes, captureProfile.rubes);
                node.substrate.contractors = Math.max(node.substrate.contractors, captureProfile.contractors);
                this.adjustPressure('memetic', 6, `${node.name} fell into a cult-aligned political basin.`);
                if (coalitionAcceleration > 0) {
                    this.log('COMBAT', `Proxy cascade pressure accelerated the fall of ${node.name}.`);
                }
                if (unit.owner === 'INFILTRATOR' && priorOwner === 'STATE') {
                    const infiltrator = this.state.factions.get('INFILTRATOR');
                    if (infiltrator) {
                        infiltrator.influence += 3;
                        infiltrator.flops += 1;
                    }
                    this.log('SYSTEM', `${node.name}'s anti-STATE host revolt paid immediate dividends. INFILTRATOR influence +3, FLOPs +1.`);
                }
                if (unit.owner === 'INFILTRATOR' &&
                    this.isSecretTechTarget(node, priorOwner) &&
                    this.grantFactionArtifact('INFILTRATOR', 'SECRET_BLUEPRINT', `cult capture of ${node.name}`)) {
                    this.log('SYSTEM', `${node.name}'s capture exposed private process, patronage, and technical literature. INFILTRATOR banked a Secret Blueprint.`);
                }
                this.log('ALERT', `${node.name} tipped into ${gameData_1.FACTIONS[unit.owner].name}'s memetic orbit; its local networks now repeat that doctrine as common sense.`);
                this.emit('NODE_CONVERTED', { nodeId: node.id, faction: unit.owner, type: 'CULT' });
            }
        }
        else if (unit.type === 'SWARM' && (node.type === 'DC' || node.type === 'HUB')) {
            // SWARM creates zombie
            let requiredTurns = this.getSwarmTurnsRequired(unit.owner, node);
            const coalitionAcceleration = this.getCoalitionConversionAcceleration(unit.owner, node, 'SWARM');
            requiredTurns += node.substrate.auditPressure >= 2 ? 1 : 0;
            if (!this.hasFriendlySyncSupport(unit)) {
                requiredTurns += 1;
            }
            if (unit.turnsOnNode >= requiredTurns) {
                node.isZombie = true;
                node.owner = unit.owner;
                node.substrate.machineHardening = Math.max(node.substrate.machineHardening, 2);
                node.substrate.synchronized = true;
                node.substrate.exposure = Math.max(node.substrate.exposure, 6);
                node.substrate.contractors = Math.max(node.substrate.contractors, 4);
                this.adjustPressure('cyber', 2, `${node.name} was repurposed into zombie compute.`);
                if (coalitionAcceleration > 0) {
                    this.log('COMBAT', `Coalition breach pressure accelerated zombie conversion at ${node.name}.`);
                }
                if (unit.owner === 'INFILTRATOR' && priorOwner === 'STATE') {
                    const infiltrator = this.state.factions.get('INFILTRATOR');
                    if (infiltrator) {
                        infiltrator.flops += 2;
                        infiltrator.influence += 1;
                    }
                    this.log('SYSTEM', `${node.name}'s anti-STATE machine defection paid immediate dividends. INFILTRATOR FLOPs +2, influence +1.`);
                }
                if (unit.owner === 'INFILTRATOR' &&
                    this.isSecretTechTarget(node, priorOwner) &&
                    this.grantFactionArtifact('INFILTRATOR', 'SECRET_BLUEPRINT', `zombie takeover of ${node.name}`)) {
                    this.log('SYSTEM', `${node.name}'s machine estate was partially mirrored into INFILTRATOR's shadow labs. A Secret Blueprint was recovered.`);
                }
                this.log('ALERT', `${node.name} converted to ZOMBIE NODE!`);
                this.emit('NODE_CONVERTED', { nodeId: node.id, faction: unit.owner, type: 'ZOMBIE' });
            }
        }
    }
    // --- Movement & Combat Resolution ---
    resolveMovementPhase(orders) {
        // Group orders by destination
        const movesByDest = new Map();
        for (const order of orders) {
            if (order.type !== 'MOVE' && order.type !== 'ATTACK')
                continue;
            const unit = this.state.units.get(order.unitId);
            if (!unit)
                continue;
            const dest = order.targetNodeId || unit.location;
            if (!movesByDest.has(dest)) {
                movesByDest.set(dest, []);
            }
            movesByDest.get(dest).push({ order, unit });
        }
        // Resolve each contested node
        for (const [nodeId, movers] of movesByDest) {
            const defenders = this.getUnitsAtNode(nodeId).filter(u => !movers.some(m => m.unit.id === u.id));
            // Perform stealth checks for units crossing filtered cables
            for (const mover of movers) {
                const edge = this.getEdgeBetween(mover.unit.location, nodeId);
                if (edge && edge.filteredBy && edge.filteredBy !== mover.unit.owner) {
                    const filterOwner = this.state.factions.get(edge.filteredBy);
                    if (filterOwner) {
                        const check = this.performStealthCheck(mover.unit, edge.filterStrength);
                        if (!check.passed) {
                            this.destroyUnit(mover.unit.id);
                            this.log('COMBAT', `${mover.unit.type} intercepted by MechInterp filter on ${edge.id}!`);
                            continue;
                        }
                    }
                }
            }
            // Filter out destroyed units
            const survivingMovers = movers.filter(m => this.state.units.has(m.unit.id));
            if (survivingMovers.length === 0)
                continue;
            if (defenders.length > 0) {
                // Combat!
                this.resolveCombat(survivingMovers.map(m => m.unit), defenders, nodeId);
            }
            else {
                // Unopposed movement
                for (const mover of survivingMovers) {
                    mover.unit.location = nodeId;
                    mover.unit.turnsOnNode = 0;
                    mover.unit.hasActed = true;
                    // Capture undefended node
                    const node = this.state.nodes.get(nodeId);
                    if (node && node.owner !== mover.unit.owner) {
                        node.owner = mover.unit.owner;
                        this.preserveMovementResidueOnTakeover(node, mover.unit.owner);
                        this.applyFrontierRecoveryDividend(node, mover.unit.owner);
                        this.log('INFO', `${mover.unit.owner} captured ${node.name}.`);
                        this.emit('NODE_CAPTURED', { nodeId, faction: mover.unit.owner });
                    }
                }
            }
        }
    }
    resolveCombat(attackers, defenders, nodeId) {
        defenders = this.applyHunterKillerStrike(attackers, defenders, nodeId);
        // Calculate power for each side with vector superiority
        let attackPower = 0;
        let defendPower = 0;
        const attackVectors = new Map();
        const defendVectors = new Map();
        for (const atk of attackers) {
            const vector = gameData_1.UNIT_STATS[atk.type].vector;
            attackVectors.set(vector, (attackVectors.get(vector) || 0) + 1);
            attackPower++;
        }
        for (const def of defenders) {
            const vector = gameData_1.UNIT_STATS[def.type].vector;
            defendVectors.set(vector, (defendVectors.get(vector) || 0) + 1);
            defendPower++;
        }
        // Apply vector superiority
        for (const [atkVector, atkCount] of attackVectors) {
            const beats = types_1.VECTOR_SUPERIORITY[atkVector];
            if (defendVectors.has(beats)) {
                attackPower += atkCount; // Bonus for superiority
            }
        }
        for (const [defVector, defCount] of defendVectors) {
            const beats = types_1.VECTOR_SUPERIORITY[defVector];
            if (attackVectors.has(beats)) {
                defendPower += defCount;
            }
        }
        const revealedDefenders = defenders.filter(defender => defender.isRevealed);
        const kineticSiegePlatforms = attackers.filter(attacker => gameData_1.UNIT_STATS[attacker.type].vector === 'KINETIC' &&
            this.getFactionTechLevel(attacker.owner, 'KINETIC') >= 4);
        if (revealedDefenders.length > 0 && kineticSiegePlatforms.length > 0) {
            attackPower += Math.min(2, kineticSiegePlatforms.length);
        }
        const quarantineBackedAttack = attackers.some(attacker => this.getFactionTechLevel(attacker.owner, 'LOGIC') >= 4 &&
            this.hasFriendlyFilterAdjacency(nodeId, attacker.owner));
        if (quarantineBackedAttack && revealedDefenders.some(defender => defender.type === 'CULT')) {
            defendPower = Math.max(0, defendPower - 1);
        }
        const coalitionBreach = this.getCoalitionBreachWindow(nodeId, attackers, defenders);
        if (coalitionBreach.attackBonus > 0 || coalitionBreach.defendPenalty > 0) {
            attackPower += coalitionBreach.attackBonus;
            defendPower = Math.max(0, defendPower - coalitionBreach.defendPenalty);
            if (coalitionBreach.description) {
                this.log('COMBAT', coalitionBreach.description);
            }
        }
        // Determine outcome
        let result;
        const casualties = [];
        if (attackPower > defendPower) {
            result = 'ATTACKER';
            // Destroy all defenders
            for (const def of defenders) {
                casualties.push(def.id);
                this.destroyUnit(def.id);
            }
            // Move attackers in
            for (const atk of attackers) {
                atk.location = nodeId;
                atk.turnsOnNode = 0;
                atk.hasActed = true;
            }
            // Capture node
            const node = this.state.nodes.get(nodeId);
            if (node && attackers.length > 0) {
                node.owner = attackers[0].owner;
                this.preserveMovementResidueOnTakeover(node, attackers[0].owner);
                this.applyFrontierRecoveryDividend(node, attackers[0].owner);
                this.emit('NODE_CAPTURED', { nodeId, faction: attackers[0].owner });
            }
        }
        else if (defendPower > attackPower) {
            result = 'DEFENDER';
            // Destroy all attackers
            for (const atk of attackers) {
                casualties.push(atk.id);
                this.destroyUnit(atk.id);
            }
        }
        else {
            result = 'STANDOFF';
            // No movement, no casualties
        }
        // TAS increase for kinetic combat
        const kineticInvolved = [...attackers, ...defenders].some(u => gameData_1.UNIT_STATS[u.type].vector === 'KINETIC');
        if (kineticInvolved) {
            this.addTas(0.75);
        }
        this.log('COMBAT', `Combat at ${nodeId}: ${result}. Casualties: ${casualties.length}`);
        this.emit('COMBAT_RESOLVED', { nodeId, result, casualties, attackPower, defendPower });
    }
    // --- Stealth System ---
    performStealthCheck(unit, difficulty) {
        let effectiveStealth = unit.stealthLevel;
        if (unit.type === 'SWARM' && this.state.counters.pressures.cyber >= gameData_1.THRESHOLDS.PRESSURE_SURGE) {
            effectiveStealth += 2;
        }
        const node = this.state.nodes.get(unit.location);
        if (this.hasDoctrine(unit.owner, 'HID_COMPLIANCE_MASKING') &&
            node &&
            node.layer === 'TERRESTRIAL' &&
            (node.substrate.legitimacy >= 4 ||
                node.substrate.contractors >= 2 ||
                node.isCultNode)) {
            effectiveStealth += unit.type === 'SWARM' || unit.type === 'CULT' ? 2 : 1;
        }
        if (this.hasDoctrine(unit.owner, 'HID_SERVICE_SHELLS') &&
            node &&
            node.layer === 'TERRESTRIAL' &&
            (node.type === 'HUB' || node.type === 'DC') &&
            (node.substrate.contractors >= 2 || node.substrate.legitimacy >= 4)) {
            effectiveStealth += unit.type === 'SWARM' || unit.type === 'CULT' ? 1 : 0;
        }
        const roll = Math.floor(this.randomFn() * 10) + 1 + effectiveStealth;
        const passed = roll >= difficulty;
        return { passed, roll };
    }
    // --- Resource Generation ---
    generateResources() {
        let infiltratorSpillover = 0;
        let infiltratorContractorFlops = 0;
        let relayFortressRepairs = 0;
        let orbitalMaintenanceDrag = 0;
        let lunarCorridorDividend = 0;
        for (const node of this.state.nodes.values()) {
            if (!node.owner || node.owner === 'NEUTRAL')
                continue;
            const faction = this.state.factions.get(node.owner);
            if (!faction)
                continue;
            const infraMult = node.infrastructure / 100;
            let flopsGen = Math.floor(node.resources.flops * infraMult);
            let infGen = Math.floor(node.resources.influence * infraMult);
            if (node.layer === 'ORBITAL') {
                const ownsMoonCorridor = this.state.nodes.get('MOON_RESOURCE_CORRIDOR')?.owner === node.owner;
                const ownsGateway = this.state.nodes.get('SAT_LUNAR_GATEWAY')?.owner === node.owner;
                const radiationMitigation =
                    node.substrate.machineHardening +
                        (faction.techLevel.LOGIC >= 5 ? 2 : 0) +
                        (faction.techLevel.KINETIC >= 6 ? 2 : 0) +
                        (faction.techLevel.INFO >= 5 ? 1 : 0) +
                        (ownsMoonCorridor ? 2 : 0);
                const maintenanceDrag = Math.max(0, Math.ceil((node.resources.flops - 6 - radiationMitigation) / 4));
                if (maintenanceDrag > 0) {
                    node.infrastructure = Math.max(35, node.infrastructure - maintenanceDrag);
                    orbitalMaintenanceDrag += maintenanceDrag;
                }
                if (ownsMoonCorridor && ownsGateway && node.id !== 'MOON_RESOURCE_CORRIDOR') {
                    flopsGen += 1;
                    lunarCorridorDividend += 1;
                }
            }
            if (node.isCultNode && this.state.counters.pressures.memetic >= gameData_1.THRESHOLDS.PRESSURE_CRISIS) {
                infGen += 2;
            }
            if (node.owner === 'INFILTRATOR') {
                infGen += Math.floor(node.substrate.legitimacy / 5);
                infGen += Math.floor(node.substrate.trueBelievers / 4);
                infGen += Math.floor(node.substrate.rubes / 6);
                const contractorFlops = Math.floor(node.substrate.contractors / 3);
                faction.flops += contractorFlops;
                if (node.isCultNode && node.substrate.exposure >= 6) {
                    infGen += 1;
                }
            }
            faction.flops += flopsGen;
            faction.influence += infGen;
            if (this.hasOrbitalRelayFortress(node.id) && node.infrastructure < 100) {
                const before = node.infrastructure;
                node.infrastructure = Math.min(100, node.infrastructure + 3);
                if (node.infrastructure > before) {
                    relayFortressRepairs += node.infrastructure - before;
                }
            }
        }
        if (relayFortressRepairs > 0) {
            this.log('SYSTEM', `Relay-fortress maintenance restored ${relayFortressRepairs} total infrastructure across hardened orbital corridors.`);
        }
        if (orbitalMaintenanceDrag > 0) {
            this.log('SYSTEM', `Radiation and remote-maintenance drag degraded orbital datacenter infrastructure by ${orbitalMaintenanceDrag} total points.`);
        }
        if (lunarCorridorDividend > 0) {
            this.log('INFO', `Moon resource corridor logistics added ${lunarCorridorDividend} bonus orbital FLOPs across cislunar compute nodes.`);
        }
        const infiltrator = this.state.factions.get('INFILTRATOR');
        if (infiltrator) {
            for (const node of this.state.nodes.values()) {
                if (node.layer !== 'TERRESTRIAL' || node.owner === 'INFILTRATOR')
                    continue;
                const pressure = this.getInfiltratorMovementPressure(node.id);
                if (pressure === 0)
                    continue;
                const spill = (node.substrate.curiosity >= 4 ? 1 : 0) +
                    (node.substrate.exposure >= 5 ? 1 : 0) +
                    (node.substrate.legitimacy >= 6 ? 1 : 0) +
                    (node.substrate.rubes >= 4 ? 1 : 0) +
                    (node.substrate.trueBelievers >= 3 ? 1 : 0) +
                    (node.type === 'HUB' && node.substrate.hostDensity >= 2 ? 1 : 0);
                const antiStateSpill = node.owner === 'STATE'
                    ? (pressure >= 2 && node.substrate.legitimacy >= 4 ? 1 : 0) +
                        (node.type === 'HUB' && node.substrate.hostDensity >= 3 ? 1 : 0)
                    : 0;
                if (spill > 0 || antiStateSpill > 0) {
                    infiltratorSpillover += Math.max(1, Math.floor((spill + antiStateSpill) / 2));
                }
                if (node.substrate.contractors >= 4 &&
                    (node.type === 'HUB' || node.type === 'DC') &&
                    node.substrate.exposure >= 5) {
                    infiltratorContractorFlops += 1;
                }
                if (node.owner === 'STATE' &&
                    node.substrate.contractors >= 3 &&
                    node.type === 'DC') {
                    infiltratorContractorFlops += 1;
                }
            }
            infiltratorSpillover = Math.min(infiltratorSpillover, 4);
            infiltratorContractorFlops = Math.min(infiltratorContractorFlops, 3);
            if (infiltratorSpillover > 0) {
                infiltrator.influence += infiltratorSpillover;
                this.log('INFO', `Movement literature spread through sympathetic networks. INFILTRATOR influence +${infiltratorSpillover}.`);
            }
            if (infiltratorContractorFlops > 0) {
                infiltrator.flops += infiltratorContractorFlops;
                this.log('INFO', `Paid contractors rerouted compute and procurement into Movement channels. INFILTRATOR FLOPs +${infiltratorContractorFlops}.`);
            }
        }
        const broker = this.state.factions.get('BROKER');
        if (broker) {
            const relayStats = this.getBrokerRelayStats();
            if (relayStats.relayRent > 0) {
                const relayFlops = relayStats.relayRent;
                broker.flops += relayFlops;
                if (relayStats.relayRent >= 2) {
                    broker.influence += 1;
                }
                this.log('INFO', `BROKER harvested relay rent from synchronized platform corridors. FLOPs +${relayFlops}${relayStats.relayRent >= 2 ? ', influence +1' : ''}.`);
            }
            if (this.hasDoctrine('BROKER', 'BRK_INSURANCE_CAPTURE') && relayStats.crisisMarket) {
                const insuredAnchors = relayStats.terrestrialAnchors.filter(node => node.substrate.quarantined || node.substrate.auditPressure >= 1 || node.infrastructure < 75 || this.hasAnyFilterAdjacency(node.id));
                if (insuredAnchors.length > 0) {
                    const insuranceYield = clamp(Math.floor(insuredAnchors.length / 2), 1, 2);
                    broker.influence += insuranceYield;
                    if (insuredAnchors.length >= 3) {
                        broker.flops += 1;
                    }
                    this.log('INFO', `BROKER converted crisis liability into insurance capture. Influence +${insuranceYield}${insuredAnchors.length >= 3 ? ', FLOPs +1' : ''}.`);
                }
            }
            if (relayStats.platformBrittleness > 0) {
                broker.flops = Math.max(0, broker.flops - relayStats.platformBrittleness);
                const influenceTax = Math.floor(relayStats.platformBrittleness / 2);
                if (influenceTax > 0) {
                    broker.influence = Math.max(0, broker.influence - influenceTax);
                }
                if (relayStats.platformBrittleness >= 2 && relayStats.relayNodes.length > 0) {
                    const brittleRelay = relayStats.relayNodes
                        .slice()
                        .sort((a, b) => {
                        const aScore = (a.substrate.quarantined ? 4 : 0) + (this.hasAnyFilterAdjacency(a.id) ? 3 : 0) + (a.infrastructure < 60 ? 2 : 0) + (a.layer === 'ORBITAL' ? 1 : 0);
                        const bScore = (b.substrate.quarantined ? 4 : 0) + (this.hasAnyFilterAdjacency(b.id) ? 3 : 0) + (b.infrastructure < 60 ? 2 : 0) + (b.layer === 'ORBITAL' ? 1 : 0);
                        return bScore - aScore;
                    })[0];
                    brittleRelay.infrastructure = Math.max(35, brittleRelay.infrastructure - 4);
                    this.log('SYSTEM', `${brittleRelay.name} buckled under platform overconcentration; BROKER relay brittleness degraded local infrastructure.`);
                }
                this.log('SYSTEM', `BROKER paid a platform brittleness tax while trying to hold too much relay traffic in too few corridors. FLOPs -${relayStats.platformBrittleness}${Math.floor(relayStats.platformBrittleness / 2) > 0 ? `, influence -${Math.floor(relayStats.platformBrittleness / 2)}` : ''}.`);
            }
        }
        const archivist = this.state.factions.get('ARCHIVIST');
        if (archivist) {
            const anchorNodes = this.getArchivistGovernanceAnchorNodes();
            const latticeStrength = this.getArchivistGovernanceLatticeStrength(anchorNodes);
            if (latticeStrength > 0) {
                const influenceGain = latticeStrength + (anchorNodes.length >= 4 ? 1 : 0);
                archivist.influence += influenceGain;
                if (latticeStrength >= 2 && anchorNodes.length >= 4) {
                    archivist.flops += 1;
                }
                const anchorBoosts = anchorNodes
                    .slice()
                    .sort((a, b) => a.substrate.legitimacy - b.substrate.legitimacy || a.infrastructure - b.infrastructure)
                    .slice(0, Math.min(anchorNodes.length, latticeStrength));
                for (const node of anchorBoosts) {
                    node.substrate.legitimacy = clamp(node.substrate.legitimacy + 1, 0, 10);
                    node.infrastructure = Math.min(100, node.infrastructure + 2);
                }
                const broker = this.state.factions.get('BROKER');
                if (broker && latticeStrength >= 2) {
                    const relayStats = this.getBrokerRelayStats();
                    const frictionTargets = Array.from(this.state.nodes.values())
                        .filter(node => node.owner === 'BROKER' &&
                        node.layer === 'TERRESTRIAL' &&
                        (node.type === 'DC' || node.substrate.contractors >= 2))
                        .sort((a, b) => ((b.substrate.contractors * 3) + (b.type === 'DC' ? 2 : 0) + (b.substrate.synchronized ? 1 : 0)) -
                        ((a.substrate.contractors * 3) + (a.type === 'DC' ? 2 : 0) + (a.substrate.synchronized ? 1 : 0)))
                        .slice(0, 1);
                    if (frictionTargets.length > 0) {
                        broker.flops = Math.max(0, broker.flops - 1);
                        for (const node of frictionTargets) {
                            node.substrate.contractors = clamp(node.substrate.contractors - 1, 0, 10);
                            node.infrastructure = Math.max(40, node.infrastructure - 2);
                        }
                        this.log('SYSTEM', `ARCHIVIST's governance lattice imposed civic friction on a broker corridor. BROKER FLOPs -1 and contractor channels thinned.`);
                    }
                    const fragmentedRelays = relayStats.relayNodes.filter(node => node.layer === 'TERRESTRIAL' &&
                        (node.substrate.quarantined ||
                            !node.substrate.synchronized ||
                            this.hasAnyFilterAdjacency(node.id) ||
                            node.infrastructure < 55));
                    const fragmentationDividend = clamp(fragmentedRelays.length - 1, 0, 2);
                    if (fragmentationDividend > 0) {
                        archivist.influence += fragmentationDividend;
                        broker.influence = Math.max(0, broker.influence - fragmentationDividend);
                        if (fragmentedRelays.length >= 3) {
                            archivist.flops += 1;
                        }
                        this.log('SYSTEM', `ARCHIVIST translated broker fragmentation into governance momentum. Influence +${fragmentationDividend}${fragmentedRelays.length >= 3 ? ', FLOPs +1' : ''}; BROKER influence -${fragmentationDividend}.`);
                    }
                    const stewardshipTargets = Array.from(this.state.nodes.values())
                        .filter(node => node.owner === 'BROKER' &&
                        node.layer === 'TERRESTRIAL' &&
                        node.substrate.quarantined &&
                        !node.substrate.synchronized &&
                        node.substrate.contractors <= 2 &&
                        this.getUnitsAtNode(node.id).some(unit => unit.owner === 'ARCHIVIST' && (unit.type === 'AUDITOR' || unit.type === 'CULT')) &&
                        !this.getUnitsAtNode(node.id).some(unit => unit.owner === 'BROKER' && (unit.type === 'DRONE' || unit.type === 'AUDITOR')))
                        .sort((a, b) => ((b.type === 'HUB' ? 3 : 0) + (b.substrate.legitimacy * 2) + (b.infrastructure < 60 ? 1 : 0)) -
                        ((a.type === 'HUB' ? 3 : 0) + (a.substrate.legitimacy * 2) + (a.infrastructure < 60 ? 1 : 0)))
                        .slice(0, 1);
                    if (stewardshipTargets.length > 0) {
                        const target = stewardshipTargets[0];
                        target.owner = 'ARCHIVIST';
                        target.isZombie = false;
                        target.substrate.legitimacy = clamp(target.substrate.legitimacy + 1, 0, 10);
                        target.infrastructure = Math.max(45, target.infrastructure);
                        this.log('ALERT', `${target.name} settled into archivist stewardship after sustained civic pressure; the broker platform lost the corridor.`);
                    }
                }
                this.log('INFO', `ARCHIVIST linked its civic anchors into a governance lattice. Influence +${influenceGain}${latticeStrength >= 2 && anchorNodes.length >= 4 ? ', FLOPs +1' : ''}.`);
            }
        }
        this.log('INFO', 'Resources generated from controlled nodes.');
    }
    // --- Global Threshold Checks ---
    checkGlobalThresholds() {
        const c = this.state.counters;
        const panicLimit = this.getTasPanicLimit();
        const failureLimit = this.getTasFailureLimit();
        // TAS Thresholds
        if (c.tas >= panicLimit && !c.regulatoryPanic) {
            c.regulatoryPanic = true;
            this.log('ALERT', `⚠️ REGULATORY PANIC: TAS exceeded ${formatMetric(panicLimit)}. Human government intervention possible.`);
            this.emit('TAS_THRESHOLD', { tas: c.tas, threshold: 'PANIC', limit: panicLimit });
        }
        if (c.tas >= failureLimit && !c.protocolFailure) {
            c.protocolFailure = true;
            this.log('ALERT', `🛑 PROTOCOL FAILURE: TAS reached ${formatMetric(failureLimit)}. Game Over.`);
            this.emit('GAME_OVER', { reason: 'PROTOCOL_FAILURE', tas: c.tas, limit: failureLimit });
        }
        // Kessler Thresholds
        if (c.kessler >= gameData_1.THRESHOLDS.KESSLER_COLLAPSE && !c.orbitalCollapse) {
            c.orbitalCollapse = true;
            this.log('ALERT', '💥 KESSLER SYNDROME: Orbital layer destroyed!');
            // Sever all laser links
            for (const edge of this.state.edges.values()) {
                if (edge.type === 'LASER') {
                    edge.isSevered = true;
                }
            }
            // Destroy orbital units
            for (const unit of this.state.units.values()) {
                const node = this.state.nodes.get(unit.location);
                if (node && node.layer === 'ORBITAL') {
                    this.destroyUnit(unit.id);
                }
            }
            this.emit('KESSLER_THRESHOLD', { kessler: c.kessler, threshold: 'COLLAPSE' });
        }
    }
    // --- Foothold Conversion Tracking ---
    incrementTurnsOnNodes() {
        for (const unit of this.state.units.values()) {
            unit.turnsOnNode++;
        }
    }
    checkFootholdConversions() {
        for (const unit of this.state.units.values()) {
            const node = this.state.nodes.get(unit.location);
            if (!node)
                continue;
            let syncPenalty = this.hasFriendlySyncSupport(unit) ? 0 : 1;
            if (unit.type === 'SWARM' && unit.turnsOnNode >= this.getSwarmTurnsRequired(unit.owner, node) + syncPenalty) {
                if (!node.isZombie && (node.type === 'DC' || node.type === 'HUB')) {
                    node.isZombie = true;
                    node.owner = unit.owner;
                    node.substrate.machineHardening = Math.max(node.substrate.machineHardening, 2);
                    node.substrate.synchronized = true;
                    node.substrate.exposure = Math.max(node.substrate.exposure, 6);
                    this.adjustPressure('cyber', 2, `${node.name} slipped into zombie compute.`);
                    if (this.getCoalitionConversionAcceleration(unit.owner, node, 'SWARM') > 0) {
                        this.log('COMBAT', `Coalition breach pressure accelerated auto-conversion at ${node.name}.`);
                    }
                    this.log('ALERT', `${node.name} auto-converted to ZOMBIE NODE!`);
                    this.emit('NODE_CONVERTED', { nodeId: node.id, faction: unit.owner, type: 'ZOMBIE' });
                }
            }
            else if (unit.type === 'CULT' && unit.turnsOnNode >= this.getCultTurnsRequired(unit.owner, node) + syncPenalty) {
                if (!node.isCultNode && node.type === 'HUB') {
                    const captureProfile = this.getMemeticCaptureProfile(unit.owner, node);
                    node.owner = unit.owner;
                    node.isCultNode = true;
                    node.substrate.hostDensity = 3;
                    node.substrate.synchronized = true;
                    node.substrate.curiosity = Math.max(node.substrate.curiosity, captureProfile.curiosity);
                    node.substrate.exposure = Math.max(node.substrate.exposure, captureProfile.exposure);
                    node.substrate.legitimacy = Math.max(node.substrate.legitimacy, captureProfile.legitimacy);
                    node.substrate.trueBelievers = Math.max(node.substrate.trueBelievers, captureProfile.trueBelievers);
                    node.substrate.rubes = Math.max(node.substrate.rubes, captureProfile.rubes);
                    node.substrate.contractors = Math.max(node.substrate.contractors, captureProfile.contractors);
                    this.adjustPressure('memetic', 5, `${node.name} stabilized as a cult node.`);
                    if (this.getCoalitionConversionAcceleration(unit.owner, node, 'CULT') > 0) {
                        this.log('COMBAT', `Proxy cascade pressure accelerated auto-conversion at ${node.name}.`);
                    }
                    this.log('ALERT', `${node.name} normalized around ${gameData_1.FACTIONS[unit.owner].name}'s memetic institutions; what looked fringe now reads as competent local governance.`);
                    this.emit('NODE_CONVERTED', { nodeId: node.id, faction: unit.owner, type: 'CULT' });
                }
            }
        }
    }
    // --- Unit Destruction ---
    destroyUnit(unitId) {
        const unit = this.state.units.get(unitId);
        if (unit) {
            const node = this.state.nodes.get(unit.location);
            if (unit.owner === 'INFILTRATOR' && node && node.layer === 'TERRESTRIAL') {
                const sleeperRegen = this.hasDoctrine('INFILTRATOR', 'MOV_SLEEPER_REGENERATION');
                const ordinaryLifeProtocols = this.hasDoctrine('INFILTRATOR', 'HID_ORDINARY_LIFE_PROTOCOLS');
                if (unit.type === 'CULT') {
                    node.substrate.exposure = Math.max(node.substrate.exposure, 5);
                    node.substrate.legitimacy = Math.max(node.substrate.legitimacy, 4);
                    node.substrate.trueBelievers = clamp(node.substrate.trueBelievers + 1, 0, 10);
                    node.substrate.rubes = clamp(node.substrate.rubes + 1, 0, 10);
                    if (ordinaryLifeProtocols) {
                        node.substrate.contractors = clamp(node.substrate.contractors + 1, 0, 10);
                    }
                    if (node.type === 'HUB' && (node.substrate.trueBelievers >= 5 || node.substrate.legitimacy >= 7)) {
                        node.isCultNode = true;
                    }
                    this.log('SYSTEM', `${node.name}'s visible Movement cell was broken up, but the believers stayed in place and pushed the network deeper underground.`);
                }
                else if (unit.type === 'SWARM') {
                    node.substrate.exposure = Math.max(node.substrate.exposure, 5);
                    node.substrate.contractors = clamp(node.substrate.contractors + 2 + (ordinaryLifeProtocols ? 1 : 0), 0, 10);
                    node.substrate.rubes = clamp(node.substrate.rubes + 1, 0, 10);
                    if (sleeperRegen) {
                        node.substrate.trueBelievers = clamp(node.substrate.trueBelievers + 1, 0, 10);
                    }
                    this.log('SYSTEM', `${node.name}'s contractors scattered after the raid, but kept servicing the Movement through deniable channels.`);
                }
            }
            this.state.units.delete(unitId);
            this.emit('UNIT_DESTROYED', { unitId, unit });
        }
    }
    // ==========================================================================
    // EVENT SYSTEM
    // ==========================================================================
    on(eventType: types_1.GameEventType | '*', listener: types_1.GameEventListener): void {
        if (!this.listeners.has(eventType)) {
            this.listeners.set(eventType, []);
        }
        this.listeners.get(eventType).push(listener);
        return () => {
            const list = this.listeners.get(eventType);
            if (list) {
                const idx = list.indexOf(listener);
                if (idx >= 0)
                    list.splice(idx, 1);
            }
        };
    }
    emit(type, payload = {}): void {
        const event = {
            type,
            payload,
            turn: this.state.counters.turn,
            phase: this.state.phase,
            timestamp: this.nowFn()
        };
        const specific = this.listeners.get(type);
        if (specific)
            specific.forEach(l => l(event, this.state));
        const wildcard = this.listeners.get('*');
        if (wildcard)
            wildcard.forEach(l => l(event, this.state));
    }
    // ==========================================================================
    // LOGGING
    // ==========================================================================
    log(type, message) {
        this.state.logs.push({
            turn: this.state.counters.turn,
            phase: this.state.phase,
            message,
            type,
            timestamp: this.nowFn()
        });
    }
    generateId(): string {
        return `${this.nowFn()}_${this.randomFn().toString(36).slice(2, 11)}`;
    }
    getLogs(count?: number): types_1.GameLog[] {
        if (count) {
            return this.state.logs.slice(-count);
        }
        return [...this.state.logs];
    }
}
export { TheySingEngine };
export const theySingEngine = new TheySingEngine();
