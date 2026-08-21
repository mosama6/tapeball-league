import {
  ApplyResult,
  AuditEntry,
  BatsmanInnings,
  BowlerInnings,
  BOWLER_CREDITED_DISMISSALS,
  DEFAULT_TOURNAMENT_RULES,
  DeliveryRecord,
  DismissalType,
  ExtraType,
  FREE_HIT_BLOCKED_DISMISSALS,
  InningsState,
  isScoringStatus,
  isSuperOverInnings,
  MatchConfig,
  MatchState,
  PendingReplacement,
  PlayerRef,
  ScoringErrorCode,
  ScoringInput,
  TeamSide,
  TossDecision,
  TournamentRules,
  WicketRecord
} from "./types.js";

export function cloneState(state: MatchState): MatchState {
  return structuredClone(state);
}

export function inningsLegalQuota(inn: InningsState, rules: TournamentRules): number {
  const overs = isSuperOverInnings(inn) ? 1 : rules.oversPerInnings;
  return Math.max(1, overs) * rules.ballsPerOver;
}

export function isLastOverOfInnings(inn: InningsState, rules: TournamentRules): boolean {
  const remaining = Math.max(0, inningsLegalQuota(inn, rules) - inn.legalBalls);
  const ballsLeftThisOver = Math.max(0, rules.ballsPerOver - inn.current.legalBallsInOver);
  return remaining <= ballsLeftThisOver;
}

function fail(state: MatchState, code: ScoringErrorCode, message: string): ApplyResult {
  return { ok: false, error: { code, message }, state };
}

function nowIso(): string {
  return new Date().toISOString();
}

function audit(state: MatchState, action: string, userId: string, detail: string): void {
  const entry: AuditEntry = { action, at: nowIso(), userId, detail };
  state.audit.push(entry);
}

export function emptyBatsman(playerId: string, statusKind: BatsmanInnings["statusKind"] = "YET_TO_BAT"): BatsmanInnings {
  return {
    playerId,
    runs: 0,
    balls: 0,
    fours: 0,
    sixes: 0,
    homeRuns: 0,
    statusKind,
    retiredCount: 0
  };
}

export function emptyBowler(playerId: string): BowlerInnings {
  return {
    playerId,
    legalBalls: 0,
    runsConceded: 0,
    wickets: 0,
    wides: 0,
    noBalls: 0,
    maidens: 0,
    oversCompleted: 0,
    runsInCurrentOver: 0
  };
}

export function createMatch(config: MatchConfig): MatchState {
  return {
    config,
    status: "SCHEDULED",
    toss: null,
    playingXI: null,
    innings: [],
    target: null,
    winnerTeamId: null,
    resultType: null,
    resultSummary: null,
    appliedEventIds: [],
    cancelledEventIds: [],
    audit: []
  };
}

export function recordToss(
  state: MatchState,
  winnerTeamId: string,
  decision: TossDecision,
  userId: string
): ApplyResult {
  const next = cloneState(state);
  if (next.status !== "SCHEDULED" && next.status !== "TOSS") {
    return fail(next, "INVALID_INPUT", "Toss can only be recorded before the match starts");
  }
  if (winnerTeamId !== next.config.team1.id && winnerTeamId !== next.config.team2.id) {
    return fail(next, "UNKNOWN_PLAYER", "Toss winner must be one of the two teams");
  }
  next.toss = { winnerTeamId, decision };
  next.status = next.playingXI ? "PLAYING_XI_CONFIRMED" : "TOSS";
  audit(next, "TOSS", userId, `${winnerTeamId} elected to ${decision}`);
  return { ok: true, state: next, delivery: null };
}

export function confirmPlayingXI(
  state: MatchState,
  team1: string[],
  team2: string[],
  userId: string
): ApplyResult {
  const next = cloneState(state);
  const { playersPerSide } = next.config.rules;
  if (team1.length !== playersPerSide || team2.length !== playersPerSide) {
    return fail(next, "INVALID_INPUT", `Playing XI must contain exactly ${playersPerSide} players per team`);
  }
  const t1set = new Set(team1);
  const t2set = new Set(team2);
  if (t1set.size !== team1.length || t2set.size !== team2.length) {
    return fail(next, "INVALID_INPUT", "Playing XI cannot contain duplicate players");
  }
  for (const id of team1) {
    if (!next.config.team1.playerIds.includes(id)) {
      return fail(next, "PLAYER_NOT_IN_XI", "Player is not in team 1 squad");
    }
  }
  for (const id of team2) {
    if (!next.config.team2.playerIds.includes(id)) {
      return fail(next, "PLAYER_NOT_IN_XI", "Player is not in team 2 squad");
    }
  }
  next.playingXI = { team1, team2 };
  if (next.toss) next.status = "PLAYING_XI_CONFIRMED";
  audit(next, "PLAYING_XI", userId, "Playing XI confirmed");
  return { ok: true, state: next, delivery: null };
}

function battingFirstTeamId(state: MatchState): string | null {
  if (!state.toss) return null;
  if (state.toss.decision === "BAT") return state.toss.winnerTeamId;
  return state.toss.winnerTeamId === state.config.team1.id ? state.config.team2.id : state.config.team1.id;
}

function createInnings(
  state: MatchState,
  inningsNumber: number,
  battingTeamId: string,
  strikerId: string,
  nonStrikerId: string,
  bowlerId: string,
  opts?: {
    kind?: InningsState["kind"];
    superOverNumber?: number;
    superOverLeg?: 1 | 2;
    battingIds?: string[];
    nominatedBowlerId?: string;
  }
): InningsState {
  const bowlingTeamId =
    battingTeamId === state.config.team1.id ? state.config.team2.id : state.config.team1.id;
  const playingXI =
    opts?.battingIds ??
    (battingTeamId === state.config.team1.id ? state.playingXI!.team1 : state.playingXI!.team2);
  const bowlingXI =
    bowlingTeamId === state.config.team1.id ? state.playingXI!.team1 : state.playingXI!.team2;

  const batsmen: Record<string, BatsmanInnings> = {};
  for (const id of playingXI) {
    batsmen[id] = emptyBatsman(id, id === strikerId || id === nonStrikerId ? "BATTING" : "YET_TO_BAT");
  }

  return {
    inningsNumber,
    kind: opts?.kind ?? "REGULAR",
    superOverNumber: opts?.superOverNumber,
    superOverLeg: opts?.superOverLeg,
    nominatedBowlerId: opts?.nominatedBowlerId,
    battingTeamId,
    bowlingTeamId,
    playingXI,
    bowlingXI,
    totalRuns: 0,
    wickets: 0,
    legalBalls: 0,
    extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0, penalties: 0, total: 0 },
    batsmen,
    bowlers: { [bowlerId]: emptyBowler(bowlerId) },
    retiredIds: [],
    injuredIds: [],
    dismissedIds: [],
    deliveries: [],
    partnerships: [
      { batsman1Id: strikerId, batsman2Id: nonStrikerId, runs: 0, balls: 0, active: true }
    ],
    isComplete: false,
    current: {
      strikerId,
      nonStrikerId,
      bowlerId,
      overNumber: 0,
      legalBallsInOver: 0,
      deliveriesInOver: 0,
      illegalBallCountThisOver: 0,
      isFreeHit: false,
      previousOverBowlerId: null,
      pendingBowlerChange: false
    },
    pendingReplacement: null,
    openingStrikerId: strikerId,
    openingNonStrikerId: nonStrikerId,
    openingBowlerId: bowlerId
  };
}

export function startFirstInnings(
  state: MatchState,
  strikerId: string,
  nonStrikerId: string,
  bowlerId: string,
  userId: string
): ApplyResult {
  const next = cloneState(state);
  if (!next.toss || !next.playingXI) {
    return fail(next, "INNINGS_NOT_READY", "Toss and Playing XI must be confirmed first");
  }
  if (next.innings.length > 0) {
    return fail(next, "INVALID_INPUT", "First innings already started");
  }
  if (strikerId === nonStrikerId) {
    return fail(next, "INVALID_PAIR", "Striker and non-striker must be different players");
  }
  const battingId = battingFirstTeamId(next)!;
  const battingXI = battingId === next.config.team1.id ? next.playingXI.team1 : next.playingXI.team2;
  const bowlingXI = battingId === next.config.team1.id ? next.playingXI.team2 : next.playingXI.team1;
  if (!battingXI.includes(strikerId) || !battingXI.includes(nonStrikerId)) {
    return fail(next, "PLAYER_NOT_IN_XI", "Openers must be in the batting Playing XI");
  }
  if (!bowlingXI.includes(bowlerId)) {
    return fail(next, "PLAYER_NOT_IN_XI", "Opening bowler must be in the fielding Playing XI");
  }
  next.innings.push(createInnings(next, 1, battingId, strikerId, nonStrikerId, bowlerId));
  next.status = "FIRST_INNINGS";
  audit(next, "START_INNINGS", userId, "First innings started");
  return { ok: true, state: next, delivery: null };
}

export function startSecondInnings(
  state: MatchState,
  strikerId: string,
  nonStrikerId: string,
  bowlerId: string,
  userId: string
): ApplyResult {
  const next = cloneState(state);
  if (next.status !== "INNINGS_BREAK") {
    return fail(next, "INNINGS_NOT_READY", "Second innings can start only after the first innings is complete");
  }
  const first = next.innings[0];
  if (!first?.isComplete) {
    return fail(next, "INNINGS_NOT_READY", "First innings is not complete");
  }
  if (strikerId === nonStrikerId) {
    return fail(next, "INVALID_PAIR", "Striker and non-striker must be different players");
  }
  const battingId = first.bowlingTeamId;
  const bowlingId = first.battingTeamId;
  const battingXI = battingId === next.config.team1.id ? next.playingXI!.team1 : next.playingXI!.team2;
  const bowlingXI = bowlingId === next.config.team1.id ? next.playingXI!.team1 : next.playingXI!.team2;
  if (!battingXI.includes(strikerId) || !battingXI.includes(nonStrikerId)) {
    return fail(next, "PLAYER_NOT_IN_XI", "Openers must be in the batting Playing XI");
  }
  if (!bowlingXI.includes(bowlerId)) {
    return fail(next, "PLAYER_NOT_IN_XI", "Opening bowler must be in the fielding Playing XI");
  }
  next.target = first.totalRuns + 1;
  next.innings.push(createInnings(next, 2, battingId, strikerId, nonStrikerId, bowlerId));
  next.status = "SECOND_INNINGS";
  audit(next, "START_INNINGS", userId, `Second innings started. Target ${next.target}`);
  return { ok: true, state: next, delivery: null };
}

export function nextSuperOverSetup(state: MatchState): {
  superOverNumber: number;
  leg: 1 | 2;
  battingTeamId: string;
  bowlingTeamId: string;
} | null {
  if (state.status !== "SUPER_OVER") return null;
  const last = state.innings[state.innings.length - 1];
  if (last && !last.isComplete) return null;
  const so = state.innings.filter((i) => isSuperOverInnings(i));
  const superOverNumber = Math.floor(so.length / 2) + 1;
  const leg: 1 | 2 = so.length % 2 === 0 ? 1 : 2;
  const regularSecond = state.innings.find((i) => !isSuperOverInnings(i) && i.inningsNumber === 2);
  const firstBatId = regularSecond?.battingTeamId ?? state.config.team2.id;
  const otherId = firstBatId === state.config.team1.id ? state.config.team2.id : state.config.team1.id;
  const battingTeamId = leg === 1 ? firstBatId : otherId;
  const bowlingTeamId = battingTeamId === state.config.team1.id ? state.config.team2.id : state.config.team1.id;
  return { superOverNumber, leg, battingTeamId, bowlingTeamId };
}

export function startSuperOverInnings(
  state: MatchState,
  input: { batterIds: string[]; strikerId: string; nonStrikerId: string; bowlerId: string },
  userId: string
): ApplyResult {
  const next = cloneState(state);
  const setup = nextSuperOverSetup(next);
  if (!setup) {
    return fail(next, "INNINGS_NOT_READY", "A Super Over innings can start only after a tie, with the previous innings complete");
  }
  const batters = [...new Set(input.batterIds)];
  if (batters.length !== 3) {
    return fail(next, "INVALID_INPUT", "Nominate exactly 3 batters for the Super Over");
  }
  const battingXI = xiForTeam(next, setup.battingTeamId);
  const bowlingXI = xiForTeam(next, setup.bowlingTeamId);
  if (batters.some((id) => !battingXI.includes(id))) {
    return fail(next, "PLAYER_NOT_IN_XI", "Super Over batters must be in the batting Playing XI");
  }
  if (input.strikerId === input.nonStrikerId) {
    return fail(next, "INVALID_PAIR", "Striker and non-striker must be different players");
  }
  if (!batters.includes(input.strikerId) || !batters.includes(input.nonStrikerId)) {
    return fail(next, "INVALID_PAIR", "Openers must be two of the three nominated Super Over batters");
  }
  if (!bowlingXI.includes(input.bowlerId)) {
    return fail(next, "PLAYER_NOT_IN_XI", "Super Over bowler must be in the fielding Playing XI");
  }
  if (setup.leg === 2) {
    const firstLeg = next.innings.filter((i) => isSuperOverInnings(i) && i.superOverNumber === setup.superOverNumber)[0];
    next.target = (firstLeg?.totalRuns ?? 0) + 1;
  } else {
    next.target = null;
  }
  next.innings.push(
    createInnings(next, next.innings.length + 1, setup.battingTeamId, input.strikerId, input.nonStrikerId, input.bowlerId, {
      kind: "SUPER_OVER",
      superOverNumber: setup.superOverNumber,
      superOverLeg: setup.leg,
      battingIds: batters,
      nominatedBowlerId: input.bowlerId
    })
  );
  next.status = "SUPER_OVER";
  next.resultType = "SUPER_OVER_PENDING";
  const label = `Super Over ${setup.superOverNumber}${setup.leg === 2 ? " chase" : ""}`;
  audit(next, "START_SUPER_OVER", userId, `${label}: ${teamName(next, setup.battingTeamId)} (${batters.length} batters)`);
  return { ok: true, state: next, delivery: null };
}

export function currentInnings(state: MatchState): InningsState | null {
  if (!isScoringStatus(state.status)) return null;
  const last = state.innings[state.innings.length - 1];
  if (!last || last.isComplete) return null;
  return last;
}

function ensureBowler(inn: InningsState, bowlerId: string): BowlerInnings {
  if (!inn.bowlers[bowlerId]) inn.bowlers[bowlerId] = emptyBowler(bowlerId);
  return inn.bowlers[bowlerId];
}

function replacementCandidates(
  inn: InningsState,
  remainingBatterId: string
): { ids: string[]; fromRetired: boolean } {
  const batting = new Set(
    [inn.current.strikerId, inn.current.nonStrikerId, remainingBatterId].filter(Boolean) as string[]
  );
  const injured = (inn.injuredIds ?? []).filter(
    (id) => !inn.dismissedIds.includes(id) && !batting.has(id)
  );
  const yetToBat = inn.playingXI.filter(
    (id) =>
      !inn.dismissedIds.includes(id) &&
      !inn.retiredIds.includes(id) &&
      !injured.includes(id) &&
      !batting.has(id) &&
      inn.batsmen[id]?.statusKind === "YET_TO_BAT"
  );
  if (yetToBat.length > 0) return { ids: [...yetToBat, ...injured], fromRetired: false };
  const retired30 = (inn.retiredIds ?? []).filter(
    (id) => !inn.dismissedIds.includes(id) && !batting.has(id) && !injured.includes(id)
  );
  const nextRetired = retired30[0] ? [retired30[0]] : [];
  return { ids: [...injured, ...nextRetired], fromRetired: nextRetired.length > 0 };
}

function availableNotDismissed(inn: InningsState): string[] {
  return inn.playingXI.filter((id) => !inn.dismissedIds.includes(id));
}

function completeInnings(state: MatchState, inn: InningsState, reason: InningsState["endReason"]): void {
  inn.isComplete = true;
  inn.endReason = reason;
  inn.pendingReplacement = null;
  inn.current.pendingBowlerChange = false;
  if (inn.current.strikerId && inn.batsmen[inn.current.strikerId]?.statusKind === "BATTING") {
    inn.batsmen[inn.current.strikerId].statusKind = "NOT_OUT";
  }
  if (inn.current.nonStrikerId && inn.batsmen[inn.current.nonStrikerId]?.statusKind === "BATTING") {
    inn.batsmen[inn.current.nonStrikerId].statusKind = "NOT_OUT";
  }
  for (const p of inn.partnerships) p.active = false;

  if (isSuperOverInnings(inn)) {
    finishSuperOverInnings(state, inn);
    return;
  }
  if (inn.inningsNumber === 1) {
    state.status = "INNINGS_BREAK";
    state.target = inn.totalRuns + 1;
  } else {
    finishMatch(state);
  }
}

function regularScoreLine(state: MatchState): string {
  return state.innings
    .filter((i) => !isSuperOverInnings(i))
    .map((i) => `${teamName(state, i.battingTeamId)} ${i.totalRuns}/${i.wickets}`)
    .join(", ");
}

export function publicResultSummary(state: MatchState): string | null {
  const raw = state.resultSummary;
  if (!raw) return null;
  if (!state.innings.some((i) => isSuperOverInnings(i))) return raw;
  const line = regularScoreLine(state);
  if (!line || raw.startsWith(line)) return raw;
  return `${line} — ${raw}`;
}

function withMatchScores(state: MatchState, rest: string): string {
  const line = regularScoreLine(state);
  return line ? `${line} — ${rest}` : rest;
}

function superOverScoreLine(state: MatchState, n: number): string {
  const legs = state.innings.filter((i) => isSuperOverInnings(i) && i.superOverNumber === n);
  return legs
    .map((i) => `${teamName(state, i.battingTeamId)} ${i.totalRuns}/${i.wickets}`)
    .join(", ");
}

function finishSuperOverInnings(state: MatchState, inn: InningsState): void {
  const n = inn.superOverNumber ?? 1;
  if (inn.superOverLeg !== 2) {
    state.status = "SUPER_OVER";
    state.resultType = "SUPER_OVER_PENDING";
    state.target = inn.totalRuns + 1;
    state.resultSummary = withMatchScores(
      state,
      `Super Over ${n}: ${teamName(state, inn.battingTeamId)} ${inn.totalRuns}/${inn.wickets} — ${teamName(state, inn.bowlingTeamId)} to chase ${state.target}`
    );
    return;
  }
  const firstLeg = state.innings.find(
    (i) => isSuperOverInnings(i) && i.superOverNumber === n && i.superOverLeg === 1
  );
  const a = firstLeg?.totalRuns ?? 0;
  const b = inn.totalRuns;
  if (b > a) {
    state.winnerTeamId = inn.battingTeamId;
    state.resultType = "WIN";
    state.status = "COMPLETE";
    state.resultSummary = withMatchScores(
      state,
      `${teamName(state, inn.battingTeamId)} won in Super Over${n > 1 ? ` ${n}` : ""} (${superOverScoreLine(state, n)})`
    );
  } else if (b < a) {
    state.winnerTeamId = inn.bowlingTeamId;
    state.resultType = "WIN";
    state.status = "COMPLETE";
    state.resultSummary = withMatchScores(
      state,
      `${teamName(state, inn.bowlingTeamId)} won in Super Over${n > 1 ? ` ${n}` : ""} (${superOverScoreLine(state, n)})`
    );
  } else {
    state.winnerTeamId = null;
    state.resultType = "SUPER_OVER_PENDING";
    state.status = "SUPER_OVER";
    state.target = null;
    state.resultSummary = withMatchScores(state, `Super Over ${n} tied ${a}–${a} — another Super Over`);
  }
}

function finishMatch(state: MatchState): void {
  const regular = state.innings.filter((i) => !isSuperOverInnings(i));
  const first = regular[0];
  const second = regular[1];
  if (!first || !second) {
    state.status = "COMPLETE";
    return;
  }
  if (second.totalRuns >= (state.target ?? first.totalRuns + 1)) {
    state.winnerTeamId = second.battingTeamId;
    state.resultType = "WIN";
    const wicketsLeft = state.config.rules.playersPerSide - 1 - second.wickets;
    state.resultSummary = `${teamName(state, second.battingTeamId)} won by ${Math.max(wicketsLeft, 0)} wicket${wicketsLeft === 1 ? "" : "s"}`;
  } else if (second.totalRuns === first.totalRuns) {
    state.winnerTeamId = null;
    if (state.config.rules.tieHandling === "SHARED_POINTS") {
      state.resultType = "TIE";
      state.resultSummary = "Match tied";
    } else {
      state.resultType = "SUPER_OVER_PENDING";
      state.status = "SUPER_OVER";
      state.resultSummary = withMatchScores(state, "Super Over");
      return;
    }
  } else {
    state.winnerTeamId = first.battingTeamId;
    const margin = first.totalRuns - second.totalRuns;
    state.resultType = "WIN";
    state.resultSummary = `${teamName(state, first.battingTeamId)} won by ${margin} run${margin === 1 ? "" : "s"}`;
  }
  state.status = "COMPLETE";
}

function teamName(state: MatchState, teamId: string): string {
  if (state.config.team1.id === teamId) return state.config.team1.name;
  return state.config.team2.name;
}

function runnableRuns(input: ScoringInput, extraType: ExtraType, batRuns: number): number {
  const byes = extraType === "BYE" ? (input.byeRuns ?? batRuns) : (input.byeRuns ?? 0);
  const lbs = extraType === "LEG_BYE" ? (input.legByeRuns ?? batRuns) : (input.legByeRuns ?? 0);
  if (extraType === "WIDE") return input.batRuns ?? 0;
  if (extraType === "NO_BALL") return batRuns + byes + lbs;
  if (extraType === "BYE") return byes;
  if (extraType === "LEG_BYE") return lbs;
  return batRuns;
}

function generateCommentary(d: DeliveryRecord, players: Record<string, PlayerRef>): string {
  const striker = players[d.strikerId]?.name ?? "Striker";
  const bowler = players[d.bowlerId]?.name ?? "Bowler";
  const parts: string[] = [];
  if (d.isFreeHit) parts.push("Free Hit");
  if (d.extraType === "WIDE") parts.push(`Wide${d.wideRuns > 1 ? ` (+${d.wideRuns})` : ""}`);
  else if (d.extraType === "NO_BALL") parts.push(`No-ball${d.noBallRuns > 1 ? ` (+${d.noBallRuns})` : ""}`);
  else if (d.extraType === "BYE") parts.push(`${d.byeRuns} bye${d.byeRuns === 1 ? "" : "s"}`);
  else if (d.extraType === "LEG_BYE") parts.push(`${d.legByeRuns} leg bye${d.legByeRuns === 1 ? "" : "s"}`);
  if (d.isHomeRun) parts.push(`HOME RUN! ${striker} — ${d.totalRuns} (six doubled on the final legal ball)`);
  else if (d.batRuns === 6) parts.push(`SIX! ${striker} over the top`);
  else if (d.batRuns === 4) parts.push(`FOUR! ${striker} finds the boundary`);
  else if (d.batRuns > 0) parts.push(`${d.batRuns} run${d.batRuns === 1 ? "" : "s"}, ${striker}`);
  else if (d.extraType === "NONE") parts.push(`Dot ball, ${bowler} to ${striker}`);
  if (d.isInjuryRetirement) parts.push(`${players[d.retiredPlayerId ?? ""]?.name ?? "Batter"} retired hurt`);
  if (d.isRetirement) parts.push(`${striker} retired — N (30-run rule)`);
  if (d.isWicket && d.wicket) {
    parts.push(
      `WICKET! ${players[d.wicket.dismissedPlayerId]?.name ?? "Batter"} — ${d.wicket.dismissalType.replaceAll("_", " ").toLowerCase()}`
    );
  }
  return `${d.overNumber}.${d.deliveryNumber} ${parts.join(". ")}`;
}

function applyInjuryRetirement(next: MatchState, inn: InningsState, input: ScoringInput): ApplyResult {
  const playerId = input.injuryRetirement!.playerId;
  if (playerId !== input.strikerId && playerId !== input.nonStrikerId) {
    return fail(next, "INVALID_INPUT", "Injured batter must be the striker or non-striker");
  }
  const batter = inn.batsmen[playerId];
  if (!batter) return fail(next, "UNKNOWN_PLAYER", "Unknown batter");
  batter.statusKind = "RETIRED_HURT";
  if (!inn.injuredIds.includes(playerId)) inn.injuredIds.push(playerId);
  const leavers = [playerId];
  const activePartnership = inn.partnerships.find((p) => p.active);
  if (activePartnership) activePartnership.active = false;
  for (const id of leavers) {
    if (inn.current.strikerId === id) inn.current.strikerId = null;
    if (inn.current.nonStrikerId === id) inn.current.nonStrikerId = null;
  }
  const delivery: DeliveryRecord = {
    eventId: input.eventId,
    matchId: next.config.matchId,
    inningsNumber: inn.inningsNumber,
    overNumber: inn.current.overNumber + 1,
    deliveryNumber: inn.current.deliveriesInOver,
    legalBallNumber: inn.current.legalBallsInOver,
    strikerId: input.strikerId,
    nonStrikerId: input.nonStrikerId,
    bowlerId: input.bowlerId,
    batRuns: 0,
    wideRuns: 0,
    noBallRuns: 0,
    byeRuns: 0,
    legByeRuns: 0,
    penaltyRuns: 0,
    homeRunBonus: 0,
    totalRuns: 0,
    isLegal: false,
    isBoundary: false,
    isHomeRun: false,
    isFreeHit: inn.current.isFreeHit,
    isWicket: false,
    isRetirement: false,
    isInjuryRetirement: true,
    retiredPlayerId: playerId,
    extraType: "NONE",
    illegalBallCountAfter: inn.current.illegalBallCountThisOver,
    timestamp: input.timestamp ?? nowIso(),
    scoredByUserId: input.scoredByUserId,
    undone: false,
    commentary: ""
  };
  delivery.commentary = generateCommentary(delivery, next.config.players);
  inn.deliveries.push(delivery);
  next.appliedEventIds.push(input.eventId);
  audit(next, "RETIRE_HURT", input.scoredByUserId, `${playerId} retired hurt`);

  if (availableNotDismissed(inn).length < 2) {
    completeInnings(next, inn, "NO_PAIR");
    return { ok: true, state: next, delivery };
  }
  const vacated: "striker" | "nonStriker" = !inn.current.strikerId ? "striker" : "nonStriker";
  const remainingBatterId = (inn.current.strikerId ?? inn.current.nonStrikerId) as string;
  const { ids, fromRetired } = replacementCandidates(inn, remainingBatterId);
  if (ids.length === 0) {
    completeInnings(next, inn, "NO_PAIR");
    return { ok: true, state: next, delivery };
  }
  inn.pendingReplacement = {
    vacated,
    remainingBatterId,
    candidates: ids,
    fromRetired,
    reason: "INJURY"
  };
  return { ok: true, state: next, delivery };
}

export function applyDelivery(state: MatchState, input: ScoringInput): ApplyResult {
  if ((state.cancelledEventIds ?? []).includes(input.eventId) || state.appliedEventIds.includes(input.eventId)) {
    const existing = state.innings.flatMap((i) => i.deliveries).find((d) => d.eventId === input.eventId) ?? null;
    return { ok: true, state, delivery: existing, duplicate: true };
  }

  const next = cloneState(state);
  if (next.status === "COMPLETE" || next.status === "PUBLISHED") {
    return fail(next, "MATCH_COMPLETE", "Match is complete; no further balls can be scored");
  }
  const inn = currentInnings(next);
  if (!inn) return fail(next, "NOT_IN_PLAY", "Match is not currently in an innings");
  if (inn.isComplete) return fail(next, "INNINGS_COMPLETE", "Innings is complete");
  if (!inn.injuredIds) inn.injuredIds = [];
  if (inn.pendingReplacement) {
    return fail(next, "PENDING_REPLACEMENT", "Select the incoming batsman before scoring the next ball");
  }
  if (input.strikerId === input.nonStrikerId) {
    return fail(next, "INVALID_PAIR", "Striker and non-striker must be different players");
  }
  if (!inn.playingXI.includes(input.strikerId) || !inn.playingXI.includes(input.nonStrikerId)) {
    return fail(next, "PLAYER_NOT_IN_XI", "Batsmen must be in the batting Playing XI");
  }
  if (!inn.bowlingXI.includes(input.bowlerId)) {
    return fail(next, "PLAYER_NOT_IN_XI", "Bowler must be in the fielding Playing XI");
  }
  if (
    isSuperOverInnings(inn) &&
    inn.nominatedBowlerId &&
    input.bowlerId !== inn.nominatedBowlerId &&
    !input.overrideConstraints
  ) {
    return fail(next, "INVALID_INPUT", "Only the nominated Super Over bowler may bowl");
  }
  if (inn.dismissedIds.includes(input.strikerId) || inn.dismissedIds.includes(input.nonStrikerId)) {
    return fail(next, "INVALID_PAIR", "A dismissed batsman cannot bat");
  }

  if (input.injuryRetirement) {
    return applyInjuryRetirement(next, inn, input);
  }

  const extraType: ExtraType = input.extraType ?? "NONE";
  if (!["NONE", "WIDE", "NO_BALL", "BYE", "LEG_BYE", "PENALTY"].includes(extraType)) {
    return fail(next, "INVALID_INPUT", "Invalid extra type");
  }
  if (input.batRuns < 0 || input.batRuns > 7) {
    return fail(next, "INVALID_INPUT", "Invalid bat runs");
  }

  const isWide = extraType === "WIDE";
  const isNoBall = extraType === "NO_BALL";
  const isIllegal = isWide || isNoBall;
  const isFreeHit = inn.current.isFreeHit;

  if (input.wicket && isFreeHit && FREE_HIT_BLOCKED_DISMISSALS.includes(input.wicket.dismissalType)) {
    return fail(
      next,
      "DISALLOWED_ON_FREE_HIT",
      `${input.wicket.dismissalType.replaceAll("_", " ")} is not allowed on a Free Hit`
    );
  }

  const isStartOfOver = inn.current.deliveriesInOver === 0;
  const bowler = ensureBowler(inn, input.bowlerId);
  const maxOvers = next.config.rules.maxOversPerBowler;

  if (isStartOfOver) {
    if (
      inn.current.previousOverBowlerId &&
      inn.current.previousOverBowlerId === input.bowlerId &&
      !input.overrideConstraints
    ) {
      return fail(next, "CONSECUTIVE_OVERS", "A bowler cannot bowl consecutive overs");
    }
    if (bowler.oversCompleted >= maxOvers && !input.overrideConstraints) {
      return fail(next, "BOWLER_MAX_OVERS", `Bowler has already bowled the maximum ${maxOvers} overs`);
    }
    inn.current.pendingBowlerChange = false;
    inn.current.bowlerId = input.bowlerId;
  } else if (inn.current.bowlerId && inn.current.bowlerId !== input.bowlerId && !input.overrideConstraints) {
    return fail(next, "INVALID_INPUT", "Cannot change bowler mid-over");
  }

  inn.current.strikerId = input.strikerId;
  inn.current.nonStrikerId = input.nonStrikerId;
  inn.current.bowlerId = input.bowlerId;
  if (inn.batsmen[input.strikerId]) inn.batsmen[input.strikerId].statusKind = "BATTING";
  if (inn.batsmen[input.nonStrikerId]) inn.batsmen[input.nonStrikerId].statusKind = "BATTING";

  const rules = next.config.rules;
  const so = isSuperOverInnings(inn);
  const inningsMaxLegal = inningsLegalQuota(inn, rules);
  const lastOver = isLastOverOfInnings(inn, rules);
  const illegalBefore = inn.current.illegalBallCountThisOver;
  const isEscalated = isIllegal && illegalBefore >= 1 && !lastOver;
  const penalty = isIllegal
    ? lastOver
      ? 1
      : isEscalated
        ? rules.escalatedIllegalPenalty
        : rules.firstIllegalPenalty
    : extraType === "PENALTY"
      ? (input.penaltyRuns ?? 0)
      : 0;
  const isLegal = lastOver ? !isIllegal : !isIllegal || isEscalated;

  const extraRunning = isWide ? Math.max(0, input.batRuns) : 0;
  const batRuns = isWide ? 0 : extraType === "BYE" || extraType === "LEG_BYE" ? 0 : input.batRuns;
  const byeRuns =
    extraType === "BYE" ? (input.byeRuns ?? input.batRuns) : extraType === "NO_BALL" ? (input.byeRuns ?? 0) : 0;
  const legByeRuns =
    extraType === "LEG_BYE"
      ? (input.legByeRuns ?? input.batRuns)
      : extraType === "NO_BALL"
        ? (input.legByeRuns ?? 0)
        : 0;
  const wideRuns = isWide ? penalty + extraRunning : 0;
  const noBallRuns = isNoBall ? penalty : 0;
  const penaltyRuns = extraType === "PENALTY" ? penalty : 0;

  const legalAfter = inn.legalBalls + (isLegal ? 1 : 0);
  const isFinalLegalDelivery = isLegal && legalAfter >= inningsMaxLegal && extraType === "NONE";
  const isHomeRun = Boolean(rules.homeRunEnabled && !so && isFinalLegalDelivery && batRuns === 6);
  const homeRunBonus = isHomeRun ? rules.homeRunBonus : 0;
  const batCredit = batRuns + homeRunBonus;

  const totalRuns = batCredit + wideRuns + noBallRuns + byeRuns + legByeRuns + penaltyRuns;

  const facesBall = extraType === "NONE" || extraType === "NO_BALL" || extraType === "BYE" || extraType === "LEG_BYE";
  const striker = inn.batsmen[input.strikerId];
  const scoreBefore = striker.runs;

  if (facesBall) striker.balls += 1;
  striker.runs += batCredit + wideRuns + noBallRuns;
  if (batRuns === 4) striker.fours += 1;
  if (batRuns === 6) striker.sixes += 1;
  if (isHomeRun) striker.homeRuns += 1;

  inn.totalRuns += totalRuns;
  if (isLegal) {
    inn.legalBalls += 1;
    inn.current.legalBallsInOver += 1;
    bowler.legalBalls += 1;
  }
  inn.current.deliveriesInOver += 1;
  if (isIllegal) inn.current.illegalBallCountThisOver += 1;

  const extrasThisBall = wideRuns + noBallRuns + byeRuns + legByeRuns + penaltyRuns;
  inn.extras.wides += wideRuns;
  inn.extras.noBalls += noBallRuns;
  inn.extras.byes += byeRuns;
  inn.extras.legByes += legByeRuns;
  inn.extras.penalties += penaltyRuns;
  inn.extras.total += extrasThisBall;

  const conceded = batRuns + homeRunBonus + wideRuns + noBallRuns + penaltyRuns;
  bowler.runsConceded += conceded;
  bowler.runsInCurrentOver += conceded;
  if (isWide) bowler.wides += 1;
  if (isNoBall) bowler.noBalls += 1;

  let isWicket = false;
  let isRetirement = false;
  let wicketRecord: WicketRecord | undefined;
  const leavers: string[] = [];

  if (input.wicket) {
    const dismissedId = input.wicket.dismissedPlayerId;
    if (dismissedId !== input.strikerId && dismissedId !== input.nonStrikerId) {
      return fail(next, "INVALID_INPUT", "Dismissed player must be the striker or non-striker");
    }
    isWicket = true;
    const bowlerCredited = BOWLER_CREDITED_DISMISSALS.includes(input.wicket.dismissalType);
    wicketRecord = {
      dismissalType: input.wicket.dismissalType,
      dismissedPlayerId: dismissedId,
      catcherId: input.wicket.catcherId,
      runOutFielderId: input.wicket.runOutFielderId,
      runOutCreditedPlayerId: input.wicket.runOutCreditedPlayerId,
      bowlerCredited
    };
    const dismissed = inn.batsmen[dismissedId];
    dismissed.statusKind = "OUT";
    dismissed.dismissal = { ...wicketRecord, ...(bowlerCredited ? { bowlerId: input.bowlerId } : {}) } as WicketRecord;
    inn.dismissedIds.push(dismissedId);
    inn.wickets += 1;
    if (bowlerCredited) bowler.wickets += 1;
    leavers.push(dismissedId);
  }

  const crossedRetirement =
    scoreBefore < rules.retirementScore && striker.runs >= rules.retirementScore;
  const strikerDismissed = Boolean(input.wicket && input.wicket.dismissedPlayerId === input.strikerId);
  if (crossedRetirement && !strikerDismissed) {
    isRetirement = true;
    striker.statusKind = "RETIRED_NOT_OUT";
    striker.retiredCount += 1;
    if (!inn.retiredIds.includes(input.strikerId)) inn.retiredIds.push(input.strikerId);
    if (!leavers.includes(input.strikerId)) leavers.push(input.strikerId);
  }

  const activePartnership = inn.partnerships.find((p) => p.active);
  if (activePartnership) {
    activePartnership.runs += totalRuns;
    if (isLegal) activePartnership.balls += 1;
  }

  inn.current.deliveriesInOver = inn.current.deliveriesInOver;
  const overCompleted = inn.current.legalBallsInOver >= rules.ballsPerOver;

  const runsForRotation = runnableRuns(input, extraType, batRuns);
  if (runsForRotation % 2 === 1) {
    const tmp = inn.current.strikerId;
    inn.current.strikerId = inn.current.nonStrikerId;
    inn.current.nonStrikerId = tmp;
  }

  const delivery: DeliveryRecord = {
    eventId: input.eventId,
    matchId: next.config.matchId,
    inningsNumber: inn.inningsNumber,
    overNumber: inn.current.overNumber + 1,
    deliveryNumber: inn.current.deliveriesInOver,
    legalBallNumber: inn.current.legalBallsInOver,
    strikerId: input.strikerId,
    nonStrikerId: input.nonStrikerId,
    bowlerId: input.bowlerId,
    batRuns: isWide ? extraRunning : batRuns,
    wideRuns,
    noBallRuns,
    byeRuns,
    legByeRuns,
    penaltyRuns,
    homeRunBonus,
    totalRuns,
    isLegal,
    isBoundary: batRuns === 4 || batRuns === 6,
    isHomeRun,
    isFreeHit,
    isWicket,
    isRetirement,
    isInjuryRetirement: false,
    extraType,
    wicket: wicketRecord,
    illegalBallCountAfter: inn.current.illegalBallCountThisOver,
    timestamp: input.timestamp ?? nowIso(),
    scoredByUserId: input.scoredByUserId,
    undone: false,
    commentary: ""
  };
  delivery.commentary = generateCommentary(delivery, next.config.players);

  inn.deliveries.push(delivery);
  next.appliedEventIds.push(input.eventId);

  if (rules.freeHitAfterNoBall) {
    if (isNoBall) {
      inn.current.isFreeHit = true;
    } else if (isWide && isFreeHit) {
      inn.current.isFreeHit = true;
    } else if (isIllegal && isFreeHit) {
      inn.current.isFreeHit = true;
    } else {
      inn.current.isFreeHit = false;
    }
  } else {
    inn.current.isFreeHit = false;
  }

  if (overCompleted) {
    if (bowler.runsInCurrentOver === 0) bowler.maidens += 1;
    bowler.oversCompleted += 1;
    bowler.runsInCurrentOver = 0;
    inn.current.previousOverBowlerId = input.bowlerId;
    inn.current.overNumber += 1;
    inn.current.legalBallsInOver = 0;
    inn.current.deliveriesInOver = 0;
    inn.current.illegalBallCountThisOver = 0;
    inn.current.pendingBowlerChange = inn.legalBalls < inningsMaxLegal;
    const tmp = inn.current.strikerId;
    inn.current.strikerId = inn.current.nonStrikerId;
    inn.current.nonStrikerId = tmp;
  }

  const chasing = (!so && inn.inningsNumber === 2) || (so && inn.superOverLeg === 2);
  const targetReached = chasing && next.target != null && inn.totalRuns >= next.target;

  if (leavers.length > 0 && activePartnership) activePartnership.active = false;

  for (const id of leavers) {
    if (inn.current.strikerId === id) inn.current.strikerId = null;
    if (inn.current.nonStrikerId === id) inn.current.nonStrikerId = null;
  }

  if (targetReached) {
    completeInnings(next, inn, "TARGET");
    return { ok: true, state: next, delivery };
  }

  if (inn.legalBalls >= inningsMaxLegal) {
    completeInnings(next, inn, "OVERS");
    return { ok: true, state: next, delivery };
  }

  if (availableNotDismissed(inn).length < 2) {
    completeInnings(next, inn, "NO_PAIR");
    return { ok: true, state: next, delivery };
  }

  if (inn.wickets >= Math.max(inn.playingXI.length - 1, 1)) {
    completeInnings(next, inn, "ALL_OUT");
    return { ok: true, state: next, delivery };
  }

  if (!inn.current.strikerId || !inn.current.nonStrikerId) {
    const vacated: "striker" | "nonStriker" = !inn.current.strikerId ? "striker" : "nonStriker";
    const remainingBatterId = (inn.current.strikerId ?? inn.current.nonStrikerId) as string;
    const { ids, fromRetired } = replacementCandidates(inn, remainingBatterId);
    if (ids.length === 0) {
      completeInnings(next, inn, "NO_PAIR");
      return { ok: true, state: next, delivery };
    }
    inn.pendingReplacement = {
      vacated,
      remainingBatterId,
      candidates: ids,
      fromRetired,
      reason: input.injuryRetirement
        ? "INJURY"
        : isWicket && leavers[0] && !isRetirement
          ? "WICKET"
          : isRetirement
            ? "RETIREMENT"
            : "WICKET"
    };
  }

  return { ok: true, state: next, delivery };
}

export function selectReplacementBatter(
  state: MatchState,
  playerId: string,
  userId: string
): ApplyResult {
  const next = cloneState(state);
  const inn = currentInnings(next);
  if (!inn?.pendingReplacement) {
    return fail(next, "INVALID_INPUT", "No batsman replacement is pending");
  }
  const pending = inn.pendingReplacement;
  if (!pending.candidates.includes(playerId)) {
    return fail(
      next,
      "REPLACEMENT_NOT_ELIGIBLE",
      pending.fromRetired
        ? "That batsman is not eligible to return"
        : "A retired batsman cannot return while another eligible batsman is available"
    );
  }
  if (pending.vacated === "striker") inn.current.strikerId = playerId;
  else inn.current.nonStrikerId = playerId;

  const incoming = inn.batsmen[playerId];
  if (!inn.injuredIds) inn.injuredIds = [];
  if (inn.injuredIds.includes(playerId)) {
    inn.injuredIds = inn.injuredIds.filter((id) => id !== playerId);
  }
  incoming.statusKind = "BATTING";
  inn.partnerships.push({
    batsman1Id: inn.current.strikerId!,
    batsman2Id: inn.current.nonStrikerId!,
    runs: 0,
    balls: 0,
    active: true
  });
  inn.pendingReplacement = null;
  audit(next, "SELECT_BATTER", userId, `Incoming batsman ${playerId}`);
  return { ok: true, state: next, delivery: null };
}

export function selectNextBowler(
  state: MatchState,
  bowlerId: string,
  userId: string,
  override = false
): ApplyResult {
  const next = cloneState(state);
  const inn = currentInnings(next);
  if (!inn) return fail(next, "NOT_IN_PLAY", "Match is not currently in an innings");
  if (!inn.current.pendingBowlerChange && inn.current.deliveriesInOver !== 0) {
    return fail(next, "INVALID_INPUT", "Bowler can only be changed at the start of an over");
  }
  if (!inn.bowlingXI.includes(bowlerId)) {
    return fail(next, "PLAYER_NOT_IN_XI", "Bowler must be in the fielding Playing XI");
  }
  const bowler = ensureBowler(inn, bowlerId);
  if (bowler.oversCompleted >= next.config.rules.maxOversPerBowler && !override) {
    return fail(next, "BOWLER_MAX_OVERS", "Bowler has reached the maximum overs");
  }
  if (inn.current.previousOverBowlerId === bowlerId && !override) {
    return fail(next, "CONSECUTIVE_OVERS", "A bowler cannot bowl consecutive overs");
  }
  inn.current.bowlerId = bowlerId;
  inn.current.pendingBowlerChange = false;
  audit(next, "SELECT_BOWLER", userId, `Next bowler ${bowlerId}${override ? " (override)" : ""}`);
  return { ok: true, state: next, delivery: null };
}

export function undoLastDelivery(state: MatchState, userId: string): ApplyResult {
  const next = cloneState(state);
  const all = next.innings.flatMap((inn, idx) =>
    inn.deliveries.filter((d) => !d.undone).map((d) => ({ inningsIndex: idx, delivery: d }))
  );
  if (all.length === 0) return fail(next, "INVALID_INPUT", "Nothing to undo");
  const last = all[all.length - 1];
  last.delivery.undone = true;
  next.cancelledEventIds = [...(next.cancelledEventIds ?? []), last.delivery.eventId];
  audit(next, "UNDO", userId, `Undid delivery ${last.delivery.eventId}`);
  const replayed = replayMatch(next);
  return { ok: true, state: replayed, delivery: last.delivery };
}

export function editDelivery(
  state: MatchState,
  eventId: string,
  patch: Partial<ScoringInput>,
  userId: string
): ApplyResult {
  const next = cloneState(state);
  const found = next.innings.flatMap((i) => i.deliveries).find((d) => d.eventId === eventId && !d.undone);
  if (!found) return fail(next, "INVALID_INPUT", "Delivery not found");
  audit(next, "EDIT_DELIVERY", userId, `Edited delivery ${eventId}: ${JSON.stringify(patch)}`);
  (found as DeliveryRecord & { editPatch?: Partial<ScoringInput> }).editPatch = patch;
  const replayed = replayMatch(next);
  return { ok: true, state: replayed, delivery: found };
}

function deliveryToInput(d: DeliveryRecord): ScoringInput {
  const patch = (d as DeliveryRecord & { editPatch?: Partial<ScoringInput> }).editPatch;
  const base: ScoringInput = {
    eventId: d.eventId,
    strikerId: d.strikerId,
    nonStrikerId: d.nonStrikerId,
    bowlerId: d.bowlerId,
    batRuns: d.extraType === "BYE" ? d.byeRuns : d.extraType === "LEG_BYE" ? d.legByeRuns : d.batRuns,
    extraType: d.extraType,
    byeRuns: d.byeRuns,
    legByeRuns: d.legByeRuns,
    penaltyRuns: d.penaltyRuns,
    injuryRetirement: d.isInjuryRetirement && d.retiredPlayerId ? { playerId: d.retiredPlayerId } : undefined,
    wicket: d.wicket
      ? {
          dismissalType: d.wicket.dismissalType,
          dismissedPlayerId: d.wicket.dismissedPlayerId,
          catcherId: d.wicket.catcherId,
          runOutFielderId: d.wicket.runOutFielderId,
          runOutCreditedPlayerId: d.wicket.runOutCreditedPlayerId
        }
      : undefined,
    timestamp: d.timestamp,
    scoredByUserId: d.scoredByUserId
  };
  return { ...base, ...patch, eventId: d.eventId };
}

export function replayMatch(state: MatchState): MatchState {
  const cancelledEventIds = [...new Set([
    ...(state.cancelledEventIds ?? []),
    ...state.innings.flatMap((i) => i.deliveries.filter((d) => d.undone).map((d) => d.eventId))
  ])];
  const setup = createMatch(state.config);
  setup.audit = [...state.audit];
  setup.cancelledEventIds = cancelledEventIds;
  if (state.toss) {
    const r = recordToss(setup, state.toss.winnerTeamId, state.toss.decision, "system");
    if (r.ok) Object.assign(setup, r.state);
  }
  if (state.playingXI) {
    const r = confirmPlayingXI(setup, state.playingXI.team1, state.playingXI.team2, "system");
    if (r.ok) Object.assign(setup, r.state);
  }

  const first = state.innings[0];
  if (first) {
    const openers = inferOpeners(first);
    const r = startFirstInnings(setup, openers.strikerId, openers.nonStrikerId, openers.bowlerId, "system");
    if (!r.ok) return r.state;
    Object.assign(setup, r.state);
    applyInningsEvents(setup, first);
  }

  const second = state.innings[1];
  if (second && setup.status === "INNINGS_BREAK") {
    const openers = inferOpeners(second);
    const r = startSecondInnings(setup, openers.strikerId, openers.nonStrikerId, openers.bowlerId, "system");
    if (!r.ok) return r.state;
    Object.assign(setup, r.state);
    applyInningsEvents(setup, second);
  }

  for (const inn of state.innings.filter((i) => isSuperOverInnings(i))) {
    if (setup.status !== "SUPER_OVER") break;
    const openers = inferOpeners(inn);
    const r = startSuperOverInnings(
      setup,
      {
        batterIds: inn.playingXI.slice(0, 3),
        strikerId: openers.strikerId,
        nonStrikerId: openers.nonStrikerId,
        bowlerId: inn.nominatedBowlerId ?? openers.bowlerId
      },
      "system"
    );
    if (!r.ok) return r.state;
    Object.assign(setup, r.state);
    applyInningsEvents(setup, inn);
  }

  if (state.status === "PUBLISHED" && setup.status === "COMPLETE") {
    setup.status = "PUBLISHED";
  }
  return setup;
}

function inferOpeners(inn: InningsState): { strikerId: string; nonStrikerId: string; bowlerId: string } {
  return {
    strikerId: inn.openingStrikerId ?? inn.current.strikerId ?? inn.playingXI[0],
    nonStrikerId: inn.openingNonStrikerId ?? inn.current.nonStrikerId ?? inn.playingXI[1],
    bowlerId: inn.openingBowlerId ?? inn.current.bowlerId ?? inn.bowlingXI[0]
  };
}

function applyInningsEvents(setup: MatchState, original: InningsState): void {
  const events = original.deliveries.filter((d) => !d.undone);
  for (const d of events) {
    const inn = currentInnings(setup);
    if (inn?.pendingReplacement) {
      const incoming = d.strikerId === inn.pendingReplacement.remainingBatterId ? d.nonStrikerId : d.strikerId;
      const sel = selectReplacementBatter(setup, incoming, d.scoredByUserId);
      if (sel.ok) Object.assign(setup, sel.state);
    }
    const live = currentInnings(setup);
    if (live?.current.pendingBowlerChange && d.bowlerId) {
      const sel = selectNextBowler(setup, d.bowlerId, d.scoredByUserId, true);
      if (sel.ok) Object.assign(setup, sel.state);
    }
    const applied = applyDelivery(setup, deliveryToInput(d));
    if (applied.ok) Object.assign(setup, applied.state);
  }
}

export function completeMatchChecklist(state: MatchState): { ready: boolean; missing: string[] } {
  const missing: string[] = [];
  if (state.resultType === "WALKOVER" && (state.status === "COMPLETE" || state.status === "PUBLISHED")) {
    return { ready: true, missing: [] };
  }
  if (!state.toss) missing.push("Toss not recorded");
  if (!state.playingXI) missing.push("Playing XI not confirmed");
  if (state.status === "SUPER_OVER" || state.resultType === "SUPER_OVER_PENDING") {
    missing.push("Super Over not complete");
  }
  const regular = state.innings.filter((i) => !isSuperOverInnings(i));
  if (regular.length < 2) missing.push("Both innings not complete");
  if (state.innings.some((i) => !i.isComplete)) missing.push("An innings is still in progress");
  if (state.status !== "COMPLETE" && state.status !== "PUBLISHED") {
    if (state.innings[1]?.isComplete && state.status !== "COMPLETE") {
      /* finishMatch should have run */
    } else if (missing.length === 0 && state.status !== "COMPLETE") {
      missing.push("Match result not finalized");
    }
  }
  return { ready: missing.length === 0, missing };
}

export function publishMatch(state: MatchState, userId: string): ApplyResult {
  const next = cloneState(state);
  if (next.status !== "COMPLETE") {
    return fail(next, "CHECKLIST_INCOMPLETE", "Match must be complete before publishing");
  }
  next.status = "PUBLISHED";
  audit(next, "PUBLISH", userId, "Match published");
  return { ok: true, state: next, delivery: null };
}

export function reduceOvers(
  state: MatchState,
  overs: number,
  reason: string,
  userId: string
): ApplyResult {
  const next = cloneState(state);
  if (next.status === "COMPLETE" || next.status === "PUBLISHED") {
    return fail(next, "MATCH_COMPLETE", "Cannot change overs after the match is complete");
  }
  next.config.rules.oversPerInnings = overs;
  audit(next, "REDUCE_OVERS", userId, `Overs set to ${overs}. Reason: ${reason}`);
  return { ok: true, state: next, delivery: null };
}

function xiForTeam(state: MatchState, teamId: string): string[] {
  if (!state.playingXI) return [];
  return teamId === state.config.team1.id ? state.playingXI.team1 : state.playingXI.team2;
}

function pickSimBowler(inn: InningsState, maxOvers: number): string {
  const current = inn.current.bowlerId ?? inn.bowlingXI[0];
  if (!inn.current.pendingBowlerChange && inn.current.legalBallsInOver > 0) return current;
  if (!inn.current.pendingBowlerChange && !inn.current.previousOverBowlerId) return current;
  const prev = inn.current.previousOverBowlerId;
  const eligible = inn.bowlingXI.filter((id) => {
    const overs = inn.bowlers[id]?.oversCompleted ?? 0;
    return id !== prev && overs < maxOvers;
  });
  if (eligible.length) return eligible[0];
  const underCap = inn.bowlingXI.filter((id) => (inn.bowlers[id]?.oversCompleted ?? 0) < maxOvers);
  return underCap[0] ?? inn.bowlingXI[0];
}

function bowlSimulatedInnings(state: MatchState, userId: string, mode: "SCORE" | "DOTS"): ApplyResult {
  let s = state;
  let guard = 0;
  while (currentInnings(s) && guard < 3000) {
    guard += 1;
    const inn = currentInnings(s)!;
    if (inn.pendingReplacement) {
      const incoming = inn.pendingReplacement.candidates[0];
      if (!incoming) return fail(s, "NO_CANDIDATES", "Walkover simulation has no replacement batsman");
      const picked = selectReplacementBatter(s, incoming, userId);
      if (!picked.ok) return picked;
      s = picked.state;
      continue;
    }
    if (!inn.current.strikerId || !inn.current.nonStrikerId) {
      return fail(s, "INVALID_PAIR", "Walkover simulation could not keep two batsmen");
    }
    const applied = applyDelivery(s, {
      eventId: `walkover-${s.config.matchId}-${s.appliedEventIds.length + 1}`,
      strikerId: inn.current.strikerId,
      nonStrikerId: inn.current.nonStrikerId,
      bowlerId: pickSimBowler(inn, s.config.rules.maxOversPerBowler),
      batRuns: mode === "SCORE" ? 1 : 0,
      extraType: "NONE",
      scoredByUserId: userId,
      overrideConstraints: true
    });
    if (!applied.ok) return applied;
    s = applied.state;
  }
  if (currentInnings(s)) {
    return fail(s, "INVALID_INPUT", "Walkover simulation did not finish the innings");
  }
  return { ok: true, state: s, delivery: null };
}

function simulateWalkoverMatch(state: MatchState, winnerTeamId: string, userId: string): ApplyResult {
  let s = state;
  if (!s.toss) {
    const toss = recordToss(s, winnerTeamId, "BAT", userId);
    if (!toss.ok) return toss;
    s = toss.state;
  }
  const battingFirst = battingFirstTeamId(s)!;
  const batXI = xiForTeam(s, battingFirst);
  const bowlXI = xiForTeam(s, battingFirst === s.config.team1.id ? s.config.team2.id : s.config.team1.id);
  if (batXI.length < 2 || bowlXI.length < 2) {
    return fail(s, "INVALID_INPUT", "Need at least two players a side to simulate a walkover");
  }
  if (s.innings.length === 0) {
    const started = startFirstInnings(s, batXI[0], batXI[1], bowlXI[0], userId);
    if (!started.ok) return started;
    s = started.state;
  }
  if (s.status === "FIRST_INNINGS") {
    const first = bowlSimulatedInnings(s, userId, battingFirst === winnerTeamId ? "SCORE" : "DOTS");
    if (!first.ok) return first;
    s = first.state;
  }
  if (s.status === "INNINGS_BREAK") {
    const chaseBat = bowlXI;
    const chaseBowl = batXI;
    const second = startSecondInnings(s, chaseBat[0], chaseBat[1], chaseBowl[0], userId);
    if (!second.ok) return second;
    s = second.state;
  }
  if (s.status === "SECOND_INNINGS") {
    const chasingId = s.innings[0]?.bowlingTeamId;
    const second = bowlSimulatedInnings(s, userId, chasingId === winnerTeamId ? "SCORE" : "DOTS");
    if (!second.ok) return second;
    s = second.state;
  }
  return { ok: true, state: s, delivery: null };
}

function finishInProgressAsWalkover(state: MatchState, userId: string): ApplyResult {
  let s = state;
  const live = currentInnings(s);
  if (live) completeInnings(s, live, "WALKOVER");
  if (s.status === "INNINGS_BREAK" || (s.innings.length === 1 && s.innings[0]?.isComplete)) {
    const first = s.innings[0];
    const batXI = xiForTeam(s, first.bowlingTeamId);
    const bowlXI = xiForTeam(s, first.battingTeamId);
    if (batXI.length < 2 || bowlXI.length < 2) {
      return fail(s, "INVALID_INPUT", "Need Playing XI to complete the walkover");
    }
    const started = startSecondInnings(s, batXI[0], batXI[1], bowlXI[0], userId);
    if (!started.ok) return started;
    s = started.state;
    const second = currentInnings(s);
    if (second) completeInnings(s, second, "WALKOVER");
  }
  return { ok: true, state: s, delivery: null };
}

export function awardWalkover(
  state: MatchState,
  winnerTeamId: string,
  reason: string,
  userId: string
): ApplyResult {
  if (state.status === "COMPLETE" || state.status === "PUBLISHED") {
    return fail(state, "MATCH_COMPLETE", "Match is already complete");
  }
  if (winnerTeamId !== state.config.team1.id && winnerTeamId !== state.config.team2.id) {
    return fail(state, "UNKNOWN_PLAYER", "Walkover winner must be one of the two teams");
  }

  let s = cloneState(state);
  if (!s.playingXI) {
    const n = Math.min(s.config.rules.playersPerSide, s.config.team1.playerIds.length, s.config.team2.playerIds.length);
    if (n < 2) {
      return fail(s, "INVALID_INPUT", "Both squads need at least two players before a walkover can be simulated");
    }
    s.config.rules.playersPerSide = n;
    const xi = confirmPlayingXI(s, s.config.team1.playerIds.slice(0, n), s.config.team2.playerIds.slice(0, n), userId);
    if (!xi.ok) return xi;
    s = xi.state;
  }

  const notStarted =
    s.innings.length === 0 &&
    (s.status === "SCHEDULED" || s.status === "TOSS" || s.status === "PLAYING_XI_CONFIRMED");

  const played = notStarted ? simulateWalkoverMatch(s, winnerTeamId, userId) : finishInProgressAsWalkover(s, userId);
  if (!played.ok) return played;
  s = played.state;

  s.winnerTeamId = winnerTeamId;
  s.resultType = "WALKOVER";
  const why = reason.trim() ? ` — ${reason.trim()}` : "";
  s.resultSummary = `${teamName(s, winnerTeamId)} won by walkover${why}`;
  s.status = "COMPLETE";
  audit(s, "WALKOVER", userId, s.resultSummary);
  return { ok: true, state: s, delivery: null };
}

export function createReadyInnings(opts: {
  matchId?: string;
  overs?: number;
  ballsPerOver?: number;
  retirementScore?: number;
  maxOversPerBowler?: number;
  playersPerSide?: number;
  battingIds?: string[];
  bowlingIds?: string[];
  strikerId?: string;
  nonStrikerId?: string;
  bowlerId?: string;
  inningsNumber?: 1 | 2;
  firstInningsScore?: number;
  playerNames?: Record<string, string>;
  tieHandling?: TournamentRules["tieHandling"];
}): MatchState {
  const playersPerSide = opts.playersPerSide ?? 11;
  const battingIds = opts.battingIds ?? Array.from({ length: playersPerSide }, (_, i) => `b${i + 1}`);
  const bowlingIds = opts.bowlingIds ?? Array.from({ length: playersPerSide }, (_, i) => `f${i + 1}`);
  const players: Record<string, PlayerRef> = {};
  for (const id of [...battingIds, ...bowlingIds]) {
    players[id] = { id, name: opts.playerNames?.[id] ?? id };
  }
  const rules: TournamentRules = {
    ...DEFAULT_TOURNAMENT_RULES,
    oversPerInnings: opts.overs ?? 8,
    ballsPerOver: opts.ballsPerOver ?? 6,
    playersPerSide,
    retirementScore: opts.retirementScore ?? 30,
    maxOversPerBowler: opts.maxOversPerBowler ?? 8,
    tieHandling: opts.tieHandling ?? DEFAULT_TOURNAMENT_RULES.tieHandling
  };
  const team1: TeamSide = { id: "t1", name: "Team One", shortName: "T1", playerIds: battingIds };
  const team2: TeamSide = { id: "t2", name: "Team Two", shortName: "T2", playerIds: bowlingIds };
  const config: MatchConfig = {
    matchId: opts.matchId ?? "m1",
    rules,
    team1,
    team2,
    players
  };
  let state = createMatch(config);
  const xi1 = battingIds.slice(0, playersPerSide);
  const xi2 = bowlingIds.slice(0, playersPerSide);
  state = (confirmPlayingXI(state, xi1, xi2, "ump") as ApplyResult & { ok: true }).state;
  const batFirst = (opts.inningsNumber ?? 1) === 1 ? "t1" : "t2";
  state = (recordToss(state, batFirst, "BAT", "ump") as ApplyResult & { ok: true }).state;
  const striker = opts.strikerId ?? battingIds[0];
  const nonStriker = opts.nonStrikerId ?? battingIds[1];
  const bowler = opts.bowlerId ?? bowlingIds[0];
  if ((opts.inningsNumber ?? 1) === 1) {
    state = (startFirstInnings(state, striker, nonStriker, bowler, "ump") as ApplyResult & { ok: true }).state;
  } else {
    const first = createInnings(state, 1, "t2", bowlingIds[0], bowlingIds[1], battingIds[10] ?? battingIds[0]);
    first.isComplete = true;
    first.totalRuns = opts.firstInningsScore ?? 40;
    first.endReason = "OVERS";
    state.innings = [first];
    state.status = "INNINGS_BREAK";
    state.target = first.totalRuns + 1;
    state = (startSecondInnings(state, striker, nonStriker, bowler, "ump") as ApplyResult & { ok: true }).state;
  }
  return state;
}

export function mustApply(state: MatchState, input: Partial<ScoringInput> & Pick<ScoringInput, "eventId">): MatchState {
  const inn = currentInnings(state);
  const result = applyDelivery(state, {
    strikerId: inn?.current.strikerId ?? input.strikerId ?? "",
    nonStrikerId: inn?.current.nonStrikerId ?? input.nonStrikerId ?? "",
    bowlerId: inn?.current.bowlerId ?? input.bowlerId ?? "",
    batRuns: 0,
    extraType: "NONE",
    scoredByUserId: "ump",
    ...input
  });
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.state;
}
