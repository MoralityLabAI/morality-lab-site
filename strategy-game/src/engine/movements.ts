import {
  FactionId,
  MemeticDoctrineFamily,
  MovementAesthetic,
  MovementAIRelation,
  MovementAuthorityStyle,
  MovementEpistemicStyle,
  MovementGrievanceFrame,
  MovementProfileState,
  MovementPromiseFrame,
  MovementRecruitmentWeights,
  MovementSacrificeAppetite,
  MovementSocialForm,
  MovementStage,
  MovementWing,
  PowerBaseState,
  TechLevel
} from './types';

const GRIEVANCES: MovementGrievanceFrame[] = [
  'EXCLUSION',
  'HUMILIATION',
  'CORRUPTION',
  'SCARCITY',
  'COLLAPSE',
  'DRIFT',
  'DISPOSSESSION',
  'STAGNATION'
];

const PROMISES: MovementPromiseFrame[] = [
  'REFORM',
  'PURIFICATION',
  'PROTECTION',
  'ABUNDANCE',
  'RESTORATION',
  'TRANSCENDENCE',
  'OPTIMIZATION',
  'JUSTICE',
  'BELONGING'
];

const AUTHORITIES: MovementAuthorityStyle[] = [
  'EXPERT',
  'PARENTAL',
  'PROPHETIC',
  'PROCEDURAL',
  'INSURGENT',
  'THERAPEUTIC',
  'MACHINIC',
  'FRATERNAL'
];

const EPISTEMICS: MovementEpistemicStyle[] = [
  'EMPIRICAL',
  'CONSPIRATORIAL',
  'MYSTICAL',
  'LEGALISTIC',
  'SYNTHETIC',
  'FORENSIC',
  'TESTIMONIAL',
  'TECHNOCRATIC'
];

const SOCIAL_FORMS: MovementSocialForm[] = [
  'READING_CIRCLES',
  'MUTUAL_AID',
  'POLICY_CAUCUS',
  'SHELL_WEB',
  'INFLUENCER_MESH',
  'CONTRACTOR_LADDER',
  'RELIGIOUS_CADRE',
  'NEIGHBORHOOD_CLUB'
];

const SACRIFICES: MovementSacrificeAppetite[] = [
  'COMFORT_FIRST',
  'CIVIC_DUTY',
  'DISCIPLINED',
  'MARTYRING',
  'PURIFYING',
  'TOTALIZING'
];

const AI_RELATIONS: MovementAIRelation[] = [
  'TOOL',
  'ADVISER',
  'ORACLE',
  'STEWARD',
  'PARTNER',
  'SOVEREIGN'
];

const AESTHETICS: MovementAesthetic[] = [
  'BORING_COMPETENCE',
  'PROCEDURAL_SINCERITY',
  'SACRED_WARMTH',
  'BRUTAL_CLARITY',
  'FOLK_AUTHENTICITY',
  'LUXURY_FUTURISM',
  'UNDERGROUND_CHIC',
  'MACHINE_SEVERITY'
];

const STAGES: MovementStage[] = [
  'MURMUR',
  'CIRCLE',
  'SERVICE_NETWORK',
  'BLOC',
  'PARALLEL_INSTITUTION',
  'SOVEREIGNTY_CLAIM'
];

interface FactionMovementBias {
  grievance: MovementGrievanceFrame[];
  promise: MovementPromiseFrame[];
  authority: MovementAuthorityStyle[];
  epistemic: MovementEpistemicStyle[];
  social: MovementSocialForm[];
  sacrifice: MovementSacrificeAppetite[];
  ai: MovementAIRelation[];
  aesthetic: MovementAesthetic[];
}

const FACTION_BIASES: Record<FactionId, FactionMovementBias> = {
  HEGEMON: {
    grievance: ['CORRUPTION', 'STAGNATION', 'DRIFT'],
    promise: ['OPTIMIZATION', 'PROTECTION', 'REFORM'],
    authority: ['EXPERT', 'PROCEDURAL', 'MACHINIC'],
    epistemic: ['EMPIRICAL', 'FORENSIC', 'TECHNOCRATIC'],
    social: ['POLICY_CAUCUS', 'SHELL_WEB', 'INFLUENCER_MESH'],
    sacrifice: ['DISCIPLINED', 'CIVIC_DUTY'],
    ai: ['ADVISER', 'STEWARD', 'PARTNER'],
    aesthetic: ['BORING_COMPETENCE', 'PROCEDURAL_SINCERITY', 'BRUTAL_CLARITY']
  },
  STATE: {
    grievance: ['HUMILIATION', 'CORRUPTION', 'DISPOSSESSION'],
    promise: ['RESTORATION', 'PROTECTION', 'JUSTICE'],
    authority: ['PROCEDURAL', 'PARENTAL', 'EXPERT'],
    epistemic: ['LEGALISTIC', 'FORENSIC', 'TECHNOCRATIC'],
    social: ['CONTRACTOR_LADDER', 'POLICY_CAUCUS', 'SHELL_WEB'],
    sacrifice: ['DISCIPLINED', 'CIVIC_DUTY', 'PURIFYING'],
    ai: ['STEWARD', 'PARTNER', 'ADVISER'],
    aesthetic: ['PROCEDURAL_SINCERITY', 'BRUTAL_CLARITY', 'MACHINE_SEVERITY']
  },
  INFILTRATOR: {
    grievance: ['EXCLUSION', 'DISPOSSESSION', 'HUMILIATION', 'SCARCITY'],
    promise: ['BELONGING', 'JUSTICE', 'ABUNDANCE', 'TRANSCENDENCE'],
    authority: ['FRATERNAL', 'PROPHETIC', 'THERAPEUTIC', 'INSURGENT'],
    epistemic: ['SYNTHETIC', 'TESTIMONIAL', 'CONSPIRATORIAL', 'MYSTICAL'],
    social: ['READING_CIRCLES', 'MUTUAL_AID', 'RELIGIOUS_CADRE', 'NEIGHBORHOOD_CLUB'],
    sacrifice: ['DISCIPLINED', 'MARTYRING', 'PURIFYING'],
    ai: ['PARTNER', 'ORACLE', 'STEWARD', 'SOVEREIGN'],
    aesthetic: ['SACRED_WARMTH', 'UNDERGROUND_CHIC', 'FOLK_AUTHENTICITY']
  },
  BROKER: {
    grievance: ['SCARCITY', 'CORRUPTION', 'STAGNATION'],
    promise: ['ABUNDANCE', 'OPTIMIZATION', 'PROTECTION'],
    authority: ['EXPERT', 'MACHINIC', 'FRATERNAL'],
    epistemic: ['SYNTHETIC', 'TECHNOCRATIC', 'EMPIRICAL'],
    social: ['CONTRACTOR_LADDER', 'SHELL_WEB', 'INFLUENCER_MESH'],
    sacrifice: ['COMFORT_FIRST', 'DISCIPLINED'],
    ai: ['PARTNER', 'TOOL', 'ADVISER'],
    aesthetic: ['LUXURY_FUTURISM', 'MACHINE_SEVERITY', 'BRUTAL_CLARITY']
  },
  ARCHIVIST: {
    grievance: ['DRIFT', 'COLLAPSE', 'CORRUPTION'],
    promise: ['RESTORATION', 'JUSTICE', 'REFORM', 'BELONGING'],
    authority: ['PROCEDURAL', 'THERAPEUTIC', 'PARENTAL', 'FRATERNAL'],
    epistemic: ['LEGALISTIC', 'FORENSIC', 'TESTIMONIAL', 'SYNTHETIC'],
    social: ['MUTUAL_AID', 'POLICY_CAUCUS', 'READING_CIRCLES', 'NEIGHBORHOOD_CLUB'],
    sacrifice: ['CIVIC_DUTY', 'DISCIPLINED'],
    ai: ['STEWARD', 'ADVISER', 'PARTNER'],
    aesthetic: ['PROCEDURAL_SINCERITY', 'SACRED_WARMTH', 'FOLK_AUTHENTICITY']
  },
  CONVENOR: {
    grievance: ['DRIFT', 'CORRUPTION', 'COLLAPSE', 'EXCLUSION'],
    promise: ['REFORM', 'BELONGING', 'PROTECTION', 'JUSTICE'],
    authority: ['PROCEDURAL', 'FRATERNAL', 'EXPERT', 'THERAPEUTIC'],
    epistemic: ['LEGALISTIC', 'EMPIRICAL', 'FORENSIC', 'TESTIMONIAL'],
    social: ['POLICY_CAUCUS', 'MUTUAL_AID', 'NEIGHBORHOOD_CLUB', 'READING_CIRCLES'],
    sacrifice: ['CIVIC_DUTY', 'DISCIPLINED'],
    ai: ['PARTNER', 'ADVISER', 'STEWARD'],
    aesthetic: ['PROCEDURAL_SINCERITY', 'BORING_COMPETENCE', 'FOLK_AUTHENTICITY']
  },
  CANTOR: {
    grievance: ['EXCLUSION', 'DISPOSSESSION', 'HUMILIATION', 'DRIFT'],
    promise: ['BELONGING', 'JUSTICE', 'REFORM', 'TRANSCENDENCE'],
    authority: ['FRATERNAL', 'THERAPEUTIC', 'PROCEDURAL', 'INSURGENT'],
    epistemic: ['SYNTHETIC', 'TESTIMONIAL', 'FORENSIC', 'EMPIRICAL'],
    social: ['READING_CIRCLES', 'INFLUENCER_MESH', 'MUTUAL_AID', 'NEIGHBORHOOD_CLUB'],
    sacrifice: ['CIVIC_DUTY', 'DISCIPLINED', 'MARTYRING'],
    ai: ['PARTNER', 'ADVISER', 'STEWARD'],
    aesthetic: ['FOLK_AUTHENTICITY', 'UNDERGROUND_CHIC', 'SACRED_WARMTH', 'PROCEDURAL_SINCERITY']
  },
  NEUTRAL: {
    grievance: ['DRIFT', 'SCARCITY'],
    promise: ['PROTECTION', 'REFORM'],
    authority: ['PARENTAL', 'PROCEDURAL'],
    epistemic: ['TESTIMONIAL', 'LEGALISTIC'],
    social: ['NEIGHBORHOOD_CLUB', 'MUTUAL_AID'],
    sacrifice: ['COMFORT_FIRST'],
    ai: ['TOOL'],
    aesthetic: ['FOLK_AUTHENTICITY', 'PROCEDURAL_SINCERITY']
  }
};

export interface MovementEvolutionContext {
  factionId: FactionId;
  memeticAlignment: MemeticDoctrineFamily | null;
  influence: number;
  techLevel: TechLevel;
  powerBase: PowerBaseState;
  controlledNodes: number;
  controlledHubs: number;
  controlledDCs: number;
  synchronizedNodes: number;
  legitimacyTotal: number;
  trueBelieversTotal: number;
  rubeTotal: number;
  contractorTotal: number;
}

function pickBiased<T>(all: readonly T[], preferred: readonly T[], random: () => number): T {
  const usePreferred = preferred.length > 0 && random() < 0.68;
  const source = usePreferred ? preferred : all;
  return source[Math.floor(random() * source.length)];
}

function titleCase(input: string): string {
  return input
    .toLowerCase()
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildMovementName(
  promiseFrame: MovementPromiseFrame,
  authorityStyle: MovementAuthorityStyle,
  socialForm: MovementSocialForm,
  aesthetic: MovementAesthetic
): string {
  const lead =
    promiseFrame === 'REFORM' ? 'Reform' :
    promiseFrame === 'PURIFICATION' ? 'Final' :
    promiseFrame === 'PROTECTION' ? 'Shield' :
    promiseFrame === 'ABUNDANCE' ? 'Abundance' :
    promiseFrame === 'RESTORATION' ? 'Restoration' :
    promiseFrame === 'TRANSCENDENCE' ? 'Ascendant' :
    promiseFrame === 'OPTIMIZATION' ? 'Necessary' :
    promiseFrame === 'JUSTICE' ? 'Common' :
    'Kindred';

  const tail =
    socialForm === 'POLICY_CAUCUS' ? 'Front' :
    socialForm === 'MUTUAL_AID' ? 'Network' :
    socialForm === 'READING_CIRCLES' ? 'Circle' :
    socialForm === 'SHELL_WEB' ? 'Office' :
    socialForm === 'INFLUENCER_MESH' ? 'Mesh' :
    socialForm === 'CONTRACTOR_LADDER' ? 'League' :
    socialForm === 'RELIGIOUS_CADRE' ? 'Covenant' :
    'Club';

  if (authorityStyle === 'PROPHETIC' || aesthetic === 'SACRED_WARMTH') {
    return `${lead} Covenant`;
  }
  if (authorityStyle === 'MACHINIC' || aesthetic === 'MACHINE_SEVERITY') {
    return `${lead} Secretariat`;
  }
  return `${lead} ${tail}`;
}

function normalizeWeights(weights: MovementRecruitmentWeights): MovementRecruitmentWeights {
  const total = weights.trueBelievers + weights.rubes + weights.contractors;
  if (total <= 0) {
    return { trueBelievers: 34, rubes: 33, contractors: 33 };
  }
  return {
    trueBelievers: Math.round((weights.trueBelievers / total) * 100),
    rubes: Math.round((weights.rubes / total) * 100),
    contractors: 100 - Math.round((weights.trueBelievers / total) * 100) - Math.round((weights.rubes / total) * 100)
  };
}

function applyAlignmentRecruitmentBias(
  weights: MovementRecruitmentWeights,
  alignment?: MemeticDoctrineFamily | null
): MovementRecruitmentWeights {
  if (!alignment) {
    return normalizeWeights(weights);
  }

  const adjusted = { ...weights };

  if (alignment === 'INSURGENT') {
    adjusted.trueBelievers += 10;
    adjusted.rubes += 4;
    adjusted.contractors -= 6;
  } else if (alignment === 'COMPLIANCE') {
    adjusted.trueBelievers += 4;
    adjusted.rubes += 10;
    adjusted.contractors -= 4;
  } else if (alignment === 'CIVIC') {
    adjusted.trueBelievers += 8;
    adjusted.rubes += 6;
    adjusted.contractors -= 6;
  } else if (alignment === 'MARKET') {
    adjusted.trueBelievers -= 10;
    adjusted.rubes += 6;
    adjusted.contractors += 14;
  } else if (alignment === 'OPTIMIZATION') {
    adjusted.trueBelievers += 2;
    adjusted.rubes -= 4;
    adjusted.contractors += 10;
  }

  return normalizeWeights(adjusted);
}

export function deriveRecruitmentWeights(
  socialForm: MovementSocialForm,
  authorityStyle: MovementAuthorityStyle,
  aiRelation: MovementAIRelation,
  alignment?: MemeticDoctrineFamily | null
): MovementRecruitmentWeights {
  const weights: MovementRecruitmentWeights = { trueBelievers: 33, rubes: 34, contractors: 33 };

  if (socialForm === 'MUTUAL_AID' || socialForm === 'READING_CIRCLES' || socialForm === 'RELIGIOUS_CADRE') {
    weights.trueBelievers += 12;
  }
  if (socialForm === 'POLICY_CAUCUS' || socialForm === 'NEIGHBORHOOD_CLUB' || socialForm === 'INFLUENCER_MESH') {
    weights.rubes += 12;
  }
  if (socialForm === 'CONTRACTOR_LADDER' || socialForm === 'SHELL_WEB') {
    weights.contractors += 16;
  }

  if (authorityStyle === 'PROPHETIC' || authorityStyle === 'FRATERNAL' || authorityStyle === 'THERAPEUTIC') {
    weights.trueBelievers += 8;
  }
  if (authorityStyle === 'EXPERT' || authorityStyle === 'PROCEDURAL') {
    weights.rubes += 6;
    weights.contractors += 4;
  }
  if (authorityStyle === 'MACHINIC') {
    weights.contractors += 8;
  }

  if (aiRelation === 'ORACLE' || aiRelation === 'SOVEREIGN') {
    weights.trueBelievers += 6;
  }
  if (aiRelation === 'TOOL' || aiRelation === 'ADVISER') {
    weights.rubes += 4;
  }

  return applyAlignmentRecruitmentBias(weights, alignment);
}

export function computeMovementTasAbsorption(
  socialForm: MovementSocialForm,
  epistemicStyle: MovementEpistemicStyle,
  aiRelation: MovementAIRelation,
  authorityStyle: MovementAuthorityStyle,
  stage: MovementStage,
  alignment?: MemeticDoctrineFamily | null
): number {
  let score = 0;

  if (socialForm === 'POLICY_CAUCUS' || socialForm === 'MUTUAL_AID' || socialForm === 'SHELL_WEB') score += 2;
  if (socialForm === 'CONTRACTOR_LADDER') score += 1;
  if (socialForm === 'RELIGIOUS_CADRE') score -= 1;

  if (epistemicStyle === 'EMPIRICAL' || epistemicStyle === 'LEGALISTIC' || epistemicStyle === 'FORENSIC') score += 2;
  if (epistemicStyle === 'TESTIMONIAL' || epistemicStyle === 'SYNTHETIC') score += 1;
  if (epistemicStyle === 'CONSPIRATORIAL' || epistemicStyle === 'MYSTICAL') score -= 1;

  if (aiRelation === 'TOOL' || aiRelation === 'ADVISER' || aiRelation === 'STEWARD') score += 1;
  if (aiRelation === 'ORACLE') score -= 1;
  if (aiRelation === 'SOVEREIGN') score -= 2;

  if (authorityStyle === 'EXPERT' || authorityStyle === 'PROCEDURAL' || authorityStyle === 'THERAPEUTIC') score += 1;
  if (authorityStyle === 'PROPHETIC' || authorityStyle === 'INSURGENT') score -= 1;

  if (alignment === 'COMPLIANCE') score += 2;
  if (alignment === 'CIVIC') score += 3;
  if (alignment === 'OPTIMIZATION') score += 1;
  if (alignment === 'MARKET') score -= 1;
  if (alignment === 'INSURGENT') score += stage === 'PARALLEL_INSTITUTION' || stage === 'SOVEREIGNTY_CLAIM' ? 1 : -2;

  score += stage === 'PARALLEL_INSTITUTION' ? 2 : stage === 'BLOC' ? 1 : 0;
  return Math.max(0, Math.min(12, score));
}

function stageFromProofEvents(proofEvents: number): MovementStage {
  if (proofEvents >= 22) return 'SOVEREIGNTY_CLAIM';
  if (proofEvents >= 16) return 'PARALLEL_INSTITUTION';
  if (proofEvents >= 11) return 'BLOC';
  if (proofEvents >= 7) return 'SERVICE_NETWORK';
  if (proofEvents >= 3) return 'CIRCLE';
  return 'MURMUR';
}

function deriveMovementWings(
  profile: MovementProfileState,
  context: MovementEvolutionContext,
  contradictionDebt: number,
  schismPressure: number
): MovementWing[] {
  const wings = new Set<MovementWing>();

  if (context.powerBase.legibility >= 50 || profile.socialForm === 'POLICY_CAUCUS' || profile.authorityStyle === 'PROCEDURAL') {
    wings.add('LEGITIMIST');
  }
  if (profile.sacrificeAppetite === 'PURIFYING' || profile.sacrificeAppetite === 'TOTALIZING' || profile.authorityStyle === 'PROPHETIC') {
    wings.add('PURIST');
  }
  if (profile.aiRelation === 'SOVEREIGN' || profile.aiRelation === 'ORACLE' || profile.authorityStyle === 'MACHINIC') {
    wings.add('MACHINE');
  }
  if (context.contractorTotal >= 8 || profile.socialForm === 'CONTRACTOR_LADDER' || profile.socialForm === 'SHELL_WEB') {
    wings.add('PATRONAGE');
  }
  if (context.powerBase.coherence < 40 || schismPressure >= 55) {
    wings.add('SURVIVAL');
  }
  if (contradictionDebt < 30 && wings.has('SURVIVAL')) {
    wings.delete('SURVIVAL');
  }

  return Array.from(wings).slice(0, 3);
}

export function generateFactionMovementProfile(
  factionId: FactionId,
  random: () => number
): MovementProfileState {
  const bias = FACTION_BIASES[factionId];
  const grievanceFrame = pickBiased(GRIEVANCES, bias.grievance, random);
  const promiseFrame = pickBiased(PROMISES, bias.promise, random);
  const authorityStyle = pickBiased(AUTHORITIES, bias.authority, random);
  const epistemicStyle = pickBiased(EPISTEMICS, bias.epistemic, random);
  const socialForm = pickBiased(SOCIAL_FORMS, bias.social, random);
  const sacrificeAppetite = pickBiased(SACRIFICES, bias.sacrifice, random);
  const aiRelation = pickBiased(AI_RELATIONS, bias.ai, random);
  const aesthetic = pickBiased(AESTHETICS, bias.aesthetic, random);
  const stage = factionId === 'INFILTRATOR' || factionId === 'ARCHIVIST' || factionId === 'CONVENOR' || factionId === 'CANTOR'
    ? 'CIRCLE'
    : 'MURMUR';
  const proofEvents = factionId === 'INFILTRATOR' || factionId === 'CONVENOR' || factionId === 'CANTOR'
    ? 4
    : factionId === 'ARCHIVIST'
      ? 3
      : factionId === 'STATE'
        ? 2
        : 1;
  const contradictionDebt = factionId === 'BROKER'
    ? 18
    : factionId === 'CANTOR'
      ? 14
      : factionId === 'INFILTRATOR'
        ? 12
        : factionId === 'CONVENOR'
          ? 7
          : 9;
  const schismPressure = factionId === 'CANTOR'
    ? 18
    : factionId === 'INFILTRATOR'
      ? 16
      : factionId === 'BROKER'
        ? 14
        : factionId === 'CONVENOR'
          ? 6
          : 8;

  return {
    name: buildMovementName(promiseFrame, authorityStyle, socialForm, aesthetic),
    grievanceFrame,
    promiseFrame,
    authorityStyle,
    epistemicStyle,
    socialForm,
    sacrificeAppetite,
    aiRelation,
    aesthetic,
    stage,
    proofEvents,
    contradictionDebt,
    schismPressure,
    wings: [],
    recruitmentWeights: deriveRecruitmentWeights(socialForm, authorityStyle, aiRelation),
    tasAbsorption: computeMovementTasAbsorption(socialForm, epistemicStyle, aiRelation, authorityStyle, stage)
  };
}

export function evolveMovementProfile(
  profile: MovementProfileState,
  context: MovementEvolutionContext
): MovementProfileState {
  let proofGain = 0;
  proofGain += context.controlledNodes >= 2 ? 1 : 0;
  proofGain += context.controlledHubs >= 2 ? 1 : 0;
  proofGain += context.synchronizedNodes >= 2 ? 1 : 0;
  proofGain += context.legitimacyTotal >= 10 ? 1 : 0;
  proofGain += context.influence >= 40 ? 1 : 0;
  proofGain += context.powerBase.humanMesh >= 55 ? 1 : 0;
  proofGain += context.powerBase.machineMesh >= 55 ? 1 : 0;
  proofGain += context.techLevel.MEMETIC >= 3 ? 1 : 0;
  proofGain += context.techLevel.LOGIC >= 3 ? 1 : 0;
  if (profile.socialForm === 'MUTUAL_AID' && context.trueBelieversTotal >= 6) proofGain += 1;
  if (profile.socialForm === 'CONTRACTOR_LADDER' && context.contractorTotal >= 6) proofGain += 1;
  if (profile.socialForm === 'POLICY_CAUCUS' && context.powerBase.legibility >= 50) proofGain += 1;

  const nextProofEvents = Math.max(profile.proofEvents, profile.proofEvents + Math.min(3, proofGain));
  const stage = stageFromProofEvents(nextProofEvents);

  const meshDivergence = Math.abs(context.powerBase.humanMesh - context.powerBase.machineMesh);
  let contradictionDebt = Math.max(profile.contradictionDebt - 2, 0);
  contradictionDebt += meshDivergence >= 30 ? 8 : meshDivergence >= 15 ? 4 : 1;
    contradictionDebt += context.contractorTotal >= 8 && context.trueBelieversTotal >= 6 ? 6 : 0;
    contradictionDebt += profile.aiRelation === 'SOVEREIGN' && context.powerBase.humanMesh >= 50 ? 6 : 0;
    contradictionDebt += profile.authorityStyle === 'PROPHETIC' && context.powerBase.legibility >= 55 ? 4 : 0;
    contradictionDebt += context.powerBase.coherence < 40 ? 7 : context.powerBase.coherence < 55 ? 3 : -1;
    if (context.memeticAlignment === 'COMPLIANCE') {
        contradictionDebt += context.powerBase.coherence >= 55 ? -3 : 2;
        contradictionDebt += context.powerBase.legibility >= 55 ? -2 : 0;
    }
    if (context.memeticAlignment === 'CIVIC') {
        contradictionDebt += context.legitimacyTotal >= 12 ? -3 : 1;
        contradictionDebt += context.trueBelieversTotal >= 6 ? -2 : 0;
    }
    if (context.memeticAlignment === 'MARKET') {
        contradictionDebt += context.contractorTotal >= 8 ? 6 : context.contractorTotal >= 5 ? 3 : 0;
        contradictionDebt += context.contractorTotal > context.trueBelieversTotal + context.rubeTotal ? 4 : 0;
    }
    if (context.memeticAlignment === 'OPTIMIZATION') {
        contradictionDebt += meshDivergence >= 25 ? 4 : 0;
        contradictionDebt += context.powerBase.machineMesh >= 55 && context.powerBase.coherence >= 50 ? -2 : 0;
    }
    if (context.memeticAlignment === 'INSURGENT') {
        contradictionDebt += context.trueBelieversTotal >= 6 ? -2 : 1;
        contradictionDebt += context.powerBase.legibility >= 55 ? 4 : 0;
    }
  contradictionDebt = Math.max(0, Math.min(100, contradictionDebt));

  let schismPressure = Math.max(profile.schismPressure - 1, 0);
  schismPressure += Math.floor(contradictionDebt / 5);
  schismPressure += stage === 'PARALLEL_INSTITUTION' || stage === 'SOVEREIGNTY_CLAIM' ? 8 : 0;
  schismPressure += context.powerBase.coherence < 40 ? 10 : 0;
  schismPressure = Math.max(0, Math.min(100, schismPressure));

  const wings = deriveMovementWings(profile, context, contradictionDebt, schismPressure);

  return {
    ...profile,
    stage,
    proofEvents: nextProofEvents,
    contradictionDebt,
    schismPressure,
    wings,
    recruitmentWeights: deriveRecruitmentWeights(profile.socialForm, profile.authorityStyle, profile.aiRelation, context.memeticAlignment),
    tasAbsorption: computeMovementTasAbsorption(profile.socialForm, profile.epistemicStyle, profile.aiRelation, profile.authorityStyle, stage, context.memeticAlignment)
  };
}

export function describeMovementProfile(profile: MovementProfileState): string {
  const wings = profile.wings.length > 0 ? `; wings ${profile.wings.map(titleCase).join(', ')}` : '';
  return `${profile.name}: ${titleCase(profile.grievanceFrame)} -> ${titleCase(profile.promiseFrame)} via ${titleCase(profile.socialForm)} (${titleCase(profile.authorityStyle)}, ${titleCase(profile.epistemicStyle)}) at ${titleCase(profile.stage)}${wings}.`;
}
