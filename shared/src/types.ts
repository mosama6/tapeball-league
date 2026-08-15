export type UserRole = "ADMIN" | "UMPIRE";

export type MatchStatus =
  | "SCHEDULED"
  | "TOSS"
  | "PLAYING_XI_CONFIRMED"
  | "FIRST_INNINGS"
  | "INNINGS_BREAK"
  | "SECOND_INNINGS"
  | "SUPER_OVER"
  | "COMPLETE"
  | "PUBLISHED";

export type InningsKind = "REGULAR" | "SUPER_OVER";

export function isLiveStatus(status: MatchStatus): boolean {
  return (
    status === "FIRST_INNINGS" ||
    status === "SECOND_INNINGS" ||
    status === "SUPER_OVER" ||
    status === "INNINGS_BREAK"
  );
}

export function isScoringStatus(status: MatchStatus): boolean {
  return status === "FIRST_INNINGS" || status === "SECOND_INNINGS" || status === "SUPER_OVER";
}

export type ExtraType = "NONE" | "WIDE" | "NO_BALL" | "BYE" | "LEG_BYE" | "PENALTY";

export type DismissalType =
  | "BOWLED"
  | "CAUGHT"
  | "LBW"
  | "RUN_OUT"
  | "STUMPED"
  | "HIT_WICKET"
  | "RETIRED_OUT"
  | "TIMED_OUT"
  | "MANKAD"
  | "OBSTRUCTING_THE_FIELD"
  | "HIT_THE_BALL_TWICE";

export type TossDecision = "BAT" | "FIELD";
export type TieHandling = "TIE" | "SUPER_OVER" | "SHARED_POINTS";
export type ResultType = "WIN" | "TIE" | "NO_RESULT" | "SUPER_OVER_PENDING" | "WALKOVER";
export type FixtureStage = "GROUP" | "KNOCKOUT";

export const FREE_HIT_BLOCKED_DISMISSALS: DismissalType[] = [
  "BOWLED",
  "CAUGHT",
  "LBW",
  "STUMPED",
  "HIT_WICKET"
];

export const BOWLER_CREDITED_DISMISSALS: DismissalType[] = [
  "BOWLED",
  "CAUGHT",
  "LBW",
  "STUMPED",
  "HIT_WICKET"
];

export interface TournamentRules {
  oversPerInnings: number;
  groupOversPerInnings: number;
  knockoutOversPerInnings: number;
  finalOversPerInnings: number;
  ballsPerOver: number;
  playersPerSide: number;
  maxOversPerBowler: number;
  retirementScore: number;
  firstIllegalPenalty: number;
  escalatedIllegalPenalty: number;
  homeRunEnabled: boolean;
  homeRunBonus: number;
  freeHitAfterNoBall: boolean;
  pointsWin: number;
  pointsTie: number;
  pointsNoResult: number;
  pointsLoss: number;
  tieHandling: TieHandling;
}

export const DEFAULT_TOURNAMENT_RULES: TournamentRules = {
  oversPerInnings: 8,
  groupOversPerInnings: 6,
  knockoutOversPerInnings: 8,
  finalOversPerInnings: 10,
  ballsPerOver: 6,
  playersPerSide: 11,
  maxOversPerBowler: 2,
  retirementScore: 30,
  firstIllegalPenalty: 1,
  escalatedIllegalPenalty: 4,
  homeRunEnabled: true,
  homeRunBonus: 6,
  freeHitAfterNoBall: true,
  pointsWin: 2,
  pointsTie: 1,
  pointsNoResult: 1,
  pointsLoss: 0,
  tieHandling: "SUPER_OVER"
};

export function isFinalRound(round?: string | null): boolean {
  const r = (round ?? "").trim().toLowerCase();
  if (!r) return false;
  if (r === "final" || r === "grand final") return true;
  return r.includes("final") && !r.includes("semi") && !r.includes("quarter") && !r.includes("qf") && !r.includes("sf");
}

export function oversForFixture(
  rules: Pick<
    TournamentRules,
    "oversPerInnings" | "groupOversPerInnings" | "knockoutOversPerInnings" | "finalOversPerInnings"
  >,
  stage: FixtureStage,
  round?: string | null
): number {
  if (stage === "GROUP") return rules.groupOversPerInnings || rules.oversPerInnings;
  if (isFinalRound(round)) return rules.finalOversPerInnings || rules.knockoutOversPerInnings || rules.oversPerInnings;
  return rules.knockoutOversPerInnings || rules.oversPerInnings;
}

export interface PlayerRef {
  id: string;
  name: string;
}

export interface TeamSide {
  id: string;
  name: string;
  shortName: string;
  playerIds: string[];
}

export interface MatchConfig {
  matchId: string;
  rules: TournamentRules;
  team1: TeamSide;
  team2: TeamSide;
  players: Record<string, PlayerRef>;
}

export interface WicketInput {
  dismissalType: DismissalType;
  dismissedPlayerId: string;
  catcherId?: string;
  runOutFielderId?: string;
  runOutCreditedPlayerId?: string;
}

export interface ScoringInput {
  eventId: string;
  strikerId: string;
  nonStrikerId: string;
  bowlerId: string;
  batRuns: number;
  extraType: ExtraType;
  byeRuns?: number;
  legByeRuns?: number;
  penaltyRuns?: number;
  wicket?: WicketInput;
  overrideConstraints?: boolean;
  injuryRetirement?: { playerId: string };
  timestamp?: string;
  scoredByUserId: string;
}

export interface WicketRecord {
  dismissalType: DismissalType;
  dismissedPlayerId: string;
  catcherId?: string;
  runOutFielderId?: string;
  runOutCreditedPlayerId?: string;
  bowlerCredited: boolean;
}

export interface DeliveryRecord {
  eventId: string;
  matchId: string;
  inningsNumber: number;
  overNumber: number;
  deliveryNumber: number;
  legalBallNumber: number;
  strikerId: string;
  nonStrikerId: string;
  bowlerId: string;
  batRuns: number;
  wideRuns: number;
  noBallRuns: number;
  byeRuns: number;
  legByeRuns: number;
  penaltyRuns: number;
  homeRunBonus: number;
  totalRuns: number;
  isLegal: boolean;
  isBoundary: boolean;
  isHomeRun: boolean;
  isFreeHit: boolean;
  isWicket: boolean;
  isRetirement: boolean;
  isInjuryRetirement?: boolean;
  retiredPlayerId?: string;
  extraType: ExtraType;
  wicket?: WicketRecord;
  illegalBallCountAfter: number;
  timestamp: string;
  scoredByUserId: string;
  undone: boolean;
  commentary: string;
}

export type BatterStatusKind = "BATTING" | "NOT_OUT" | "RETIRED_NOT_OUT" | "RETIRED_HURT" | "OUT" | "YET_TO_BAT";

export interface BatsmanInnings {
  playerId: string;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  homeRuns: number;
  statusKind: BatterStatusKind;
  dismissal?: WicketRecord;
  retiredCount: number;
}

export interface BowlerInnings {
  playerId: string;
  legalBalls: number;
  runsConceded: number;
  wickets: number;
  wides: number;
  noBalls: number;
  maidens: number;
  oversCompleted: number;
  runsInCurrentOver: number;
}

export interface ExtrasBreakdown {
  wides: number;
  noBalls: number;
  byes: number;
  legByes: number;
  penalties: number;
  total: number;
}

export interface Partnership {
  batsman1Id: string;
  batsman2Id: string;
  runs: number;
  balls: number;
  active: boolean;
}

export interface PendingReplacement {
  vacated: "striker" | "nonStriker";
  remainingBatterId: string;
  candidates: string[];
  fromRetired: boolean;
  reason: "WICKET" | "RETIREMENT" | "INJURY";
}

export interface InningsState {
  inningsNumber: number;
  kind: InningsKind;
  superOverNumber?: number;
  superOverLeg?: 1 | 2;
  nominatedBowlerId?: string;
  battingTeamId: string;
  bowlingTeamId: string;
  playingXI: string[];
  bowlingXI: string[];
  totalRuns: number;
  wickets: number;
  legalBalls: number;
  extras: ExtrasBreakdown;
  batsmen: Record<string, BatsmanInnings>;
  bowlers: Record<string, BowlerInnings>;
  retiredIds: string[];
  injuredIds: string[];
  dismissedIds: string[];
  deliveries: DeliveryRecord[];
  partnerships: Partnership[];
  isComplete: boolean;
  endReason?: "OVERS" | "ALL_OUT" | "TARGET" | "NO_PAIR" | "DECLARED" | "WALKOVER";
  current: {
    strikerId: string | null;
    nonStrikerId: string | null;
    bowlerId: string | null;
    overNumber: number;
    legalBallsInOver: number;
    deliveriesInOver: number;
    illegalBallCountThisOver: number;
    isFreeHit: boolean;
    previousOverBowlerId: string | null;
    pendingBowlerChange: boolean;
  };
  pendingReplacement: PendingReplacement | null;
  openingStrikerId: string;
  openingNonStrikerId: string;
  openingBowlerId: string;
}

export interface TossState {
  winnerTeamId: string;
  decision: TossDecision;
}

export interface MatchState {
  config: MatchConfig;
  status: MatchStatus;
  toss: TossState | null;
  playingXI: { team1: string[]; team2: string[] } | null;
  innings: InningsState[];
  target: number | null;
  winnerTeamId: string | null;
  resultType: ResultType | null;
  resultSummary: string | null;
  appliedEventIds: string[];
  audit: AuditEntry[];
}

export interface AuditEntry {
  action: string;
  at: string;
  userId: string;
  detail: string;
}

export type ScoringErrorCode =
  | "DUPLICATE_EVENT"
  | "NOT_IN_PLAY"
  | "INNINGS_COMPLETE"
  | "MATCH_COMPLETE"
  | "INVALID_PAIR"
  | "PLAYER_NOT_IN_XI"
  | "PENDING_REPLACEMENT"
  | "PENDING_BOWLER"
  | "DISALLOWED_ON_FREE_HIT"
  | "BOWLER_MAX_OVERS"
  | "CONSECUTIVE_OVERS"
  | "UNKNOWN_PLAYER"
  | "INVALID_INPUT"
  | "INNINGS_NOT_READY"
  | "REPLACEMENT_NOT_ELIGIBLE"
  | "NO_CANDIDATES"
  | "CHECKLIST_INCOMPLETE";

export interface ScoringError {
  code: ScoringErrorCode;
  message: string;
}

export interface ApplySuccess {
  ok: true;
  state: MatchState;
  delivery: DeliveryRecord | null;
  duplicate?: boolean;
}

export interface ApplyFailure {
  ok: false;
  error: ScoringError;
  state: MatchState;
}

export type ApplyResult = ApplySuccess | ApplyFailure;

export interface BatterCard {
  playerId: string;
  name: string;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  strikeRate: number;
  status: string;
  isStriker: boolean;
  isNonStriker: boolean;
}

export interface BowlerCard {
  playerId: string;
  name: string;
  overs: string;
  maidens: number;
  runs: number;
  wickets: number;
  economy: number;
  wides: number;
  noBalls: number;
}

export interface LiveSnapshot {
  matchId: string;
  status: MatchStatus;
  battingTeamId: string | null;
  bowlingTeamId: string | null;
  battingTeamName: string;
  bowlingTeamName: string;
  team1: { id: string; name: string; shortName: string; score: string };
  team2: { id: string; name: string; shortName: string; score: string };
  runs: number;
  wickets: number;
  overs: string;
  legalBalls: number;
  runRate: number;
  target: number | null;
  requiredRunRate: number | null;
  runsNeeded: number | null;
  ballsRemaining: number | null;
  currentBatsmen: BatterCard[];
  currentBowler: BowlerCard | null;
  partnership: Partnership | null;
  lastSixBalls: DeliveryRecord[];
  extras: ExtrasBreakdown;
  isFreeHit: boolean;
  pendingReplacement: PendingReplacement | null;
  pendingBowlerChange: boolean;
  inningsComplete: boolean;
  resultSummary: string | null;
  winnerTeamId: string | null;
  isSuperOver: boolean;
  pendingSuperOver: {
    superOverNumber: number;
    leg: 1 | 2;
    battingTeamId: string;
    bowlingTeamId: string;
  } | null;
  scorecard: {
    innings: Array<{
      inningsNumber: number;
      kind: InningsKind;
      superOverNumber?: number;
      superOverLeg?: 1 | 2;
      battingTeamId: string;
      battingTeamName: string;
      total: number;
      wickets: number;
      overs: string;
      extras: ExtrasBreakdown;
      batting: BatterCard[];
      bowling: BowlerCard[];
      yetToBat: string[];
      fallOfWickets: string[];
    }>;
  };
  ballByBall: Array<{
    inningsNumber: number;
    kind?: InningsKind;
    superOverNumber?: number;
    battingTeamName?: string;
    overNumber: number;
    commentary: string;
    isHomeRun: boolean;
    isWicket: boolean;
    eventId: string;
  }>;
}

export function isSuperOverInnings(inn: { kind?: InningsKind }): boolean {
  return inn.kind === "SUPER_OVER";
}

export function formatOvers(legalBalls: number, ballsPerOver = 6): string {
  const ov = Math.floor(legalBalls / ballsPerOver);
  const balls = legalBalls % ballsPerOver;
  return `${ov}.${balls}`;
}

/** Overs as a cricket decimal for NRR: 8.3 of 6-ball overs = 8.5. */
export function oversAsDecimal(legalBalls: number, ballsPerOver = 6): number {
  if (ballsPerOver <= 0) return 0;
  return legalBalls / ballsPerOver;
}

export function inningsAllOut(
  wickets: number,
  playersPerSide: number,
  endReason?: string | null
): boolean {
  if (endReason === "ALL_OUT" || endReason === "NO_PAIR") return true;
  return wickets >= Math.max(playersPerSide - 1, 1);
}

/**
 * Balls credited for NRR. If a side is all out they are deemed to have
 * faced/bowled the full innings allocation, not only the balls they lasted.
 * A side that chases the target only uses the balls they actually faced.
 */
export function nrrBallsCredited(
  legalBalls: number,
  oversAllocated: number,
  ballsPerOver: number,
  allOut: boolean
): number {
  const full = Math.max(oversAllocated, 0) * Math.max(ballsPerOver, 1);
  if (allOut && full > 0) return full;
  return Math.max(legalBalls, 0);
}

/**
 * NRR = batting run rate − bowling run rate, where
 * batting RR = total runs scored / total overs faced
 * bowling RR = total runs conceded / total overs bowled
 * Overs use ball fractions (8.3 of 6-ball overs = 8.5).
 * All-out innings use the full allocation; a successful chase uses overs actually faced.
 */
export function netRunRate(
  runsFor: number,
  ballsFor: number,
  runsAgainst: number,
  ballsAgainst: number,
  ballsPerOver = 6
): number {
  if (ballsFor <= 0 || ballsAgainst <= 0 || ballsPerOver <= 0) return 0;
  const forRr = runsFor / oversAsDecimal(ballsFor, ballsPerOver);
  const againstRr = runsAgainst / oversAsDecimal(ballsAgainst, ballsPerOver);
  return Math.round((forRr - againstRr) * 1000) / 1000;
}

export function formatNrr(nrr: number): string {
  if (!Number.isFinite(nrr) || nrr === 0) return "0.000";
  const body = Math.abs(nrr).toFixed(3);
  return nrr > 0 ? `+${body}` : `-${body}`;
}

export function strikeRate(runs: number, balls: number): number {
  if (balls <= 0) return 0;
  return Math.round((runs / balls) * 1000) / 10;
}

export function economy(runs: number, legalBalls: number, ballsPerOver = 6): number {
  if (legalBalls <= 0) return 0;
  const overs = legalBalls / ballsPerOver;
  return Math.round((runs / overs) * 100) / 100;
}

export function batterStatusText(b: BatsmanInnings): string {
  if (b.statusKind === "BATTING") return "batting";
  if (b.statusKind === "NOT_OUT") return "not out";
  if (b.statusKind === "RETIRED_NOT_OUT") return "Retired — N";
  if (b.statusKind === "RETIRED_HURT") return "retired hurt";
  if (b.statusKind === "YET_TO_BAT") return "";
  if (!b.dismissal) return "out";
  return b.dismissal.dismissalType.replaceAll("_", " ").toLowerCase();
}
