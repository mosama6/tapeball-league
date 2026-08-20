import {
  applyDelivery,
  awardWalkover,
  ApplyResult,
  buildSnapshot,
  cloneState,
  completeMatchChecklist,
  confirmPlayingXI,
  createMatch,
  DEFAULT_TOURNAMENT_RULES,
  DeliveryRecord,
  LiveSnapshot,
  MatchConfig,
  MatchState,
  publishMatch,
  recordToss,
  reduceOvers,
  ScoringInput,
  selectNextBowler,
  selectReplacementBatter,
  startFirstInnings,
  startSecondInnings,
  startSuperOverInnings,
  TournamentRules,
  undoLastDelivery,
  youtubeEmbedUrl
} from "@lms/shared";
import { prisma } from "../db.js";
import { emitMatch, emitTournament } from "../ws.js";
import { recomputeTournamentStats } from "./stats.js";

const matchInclude = {
  team1: { include: { players: { include: { player: true } } } },
  team2: { include: { players: { include: { player: true } } } },
  tournament: { include: { rules: true } },
  playingXI: true,
  officials: true,
  venue: true,
  deliveries: { orderBy: { createdAt: "asc" as const } }
};

export type FullMatch = Awaited<ReturnType<typeof loadMatch>>;

export async function loadMatch(id: string) {
  if (!/^\d+$/.test(id)) return null;
  return prisma.match.findUnique({ where: { no: Number(id) }, include: matchInclude });
}

export function rulesFrom(match: NonNullable<FullMatch>): TournamentRules {
  const r = match.tournament.rules;
  return {
    ...DEFAULT_TOURNAMENT_RULES,
    oversPerInnings: match.oversPerInnings || r?.oversPerInnings || 8,
    groupOversPerInnings: r?.groupOversPerInnings ?? 6,
    knockoutOversPerInnings: r?.knockoutOversPerInnings ?? 8,
    finalOversPerInnings: r?.finalOversPerInnings ?? 10,
    ballsPerOver: r?.ballsPerOver ?? 6,
    playersPerSide: r?.playersPerSide ?? 11,
    maxOversPerBowler: match.maxOversPerBowler || r?.maxOversPerBowler || 2,
    retirementScore: r?.retirementScore ?? 30,
    firstIllegalPenalty: r?.firstIllegalPenalty ?? 1,
    escalatedIllegalPenalty: r?.escalatedIllegalPenalty ?? 4,
    homeRunEnabled: r?.homeRunEnabled ?? true,
    homeRunBonus: r?.homeRunBonus ?? 6,
    freeHitAfterNoBall: r?.freeHitAfterNoBall ?? true,
    pointsWin: r?.pointsWin ?? 2,
    pointsTie: r?.pointsTie ?? 1,
    pointsNoResult: r?.pointsNoResult ?? 1,
    pointsLoss: r?.pointsLoss ?? 0,
    tieHandling: r?.tieHandling ?? "SUPER_OVER"
  };
}

export function toConfig(match: NonNullable<FullMatch>): MatchConfig {
  const players: MatchConfig["players"] = {};
  for (const row of [...match.team1.players, ...match.team2.players]) {
    players[row.playerId] = { id: row.playerId, name: row.player.name };
  }
  return {
    matchId: match.id,
    rules: rulesFrom(match),
    team1: {
      id: match.team1.id,
      name: match.team1.name,
      shortName: match.team1.shortName,
      playerIds: match.team1.players.map((p) => p.playerId)
    },
    team2: {
      id: match.team2.id,
      name: match.team2.name,
      shortName: match.team2.shortName,
      playerIds: match.team2.players.map((p) => p.playerId)
    },
    players
  };
}

export function getState(match: NonNullable<FullMatch>): MatchState {
  const config = toConfig(match);
  if (!match.engineState) return createMatch(config);
  const state = cloneState(match.engineState as unknown as MatchState);
  state.config.rules = { ...state.config.rules, ...config.rules };
  return state;
}

async function persist(ref: string, state: MatchState, userId?: string, action?: string, payload?: unknown) {
  const row = /^\d+$/.test(ref)
    ? await prisma.match.findUnique({ where: { no: Number(ref) } })
    : await prisma.match.findUnique({ where: { id: ref } });
  if (!row) throw Object.assign(new Error("Match not found"), { status: 404 });
  const matchId = row.id;
  const snapshot = buildSnapshot(state);
  const last = state.innings[state.innings.length - 1];
  await prisma.$transaction(async (tx) => {
    await tx.match.update({
      where: { id: matchId },
      data: {
        status: state.status,
        tossWinnerId: state.toss?.winnerTeamId,
        tossDecision: state.toss?.decision,
        winnerId: state.winnerTeamId,
        resultType: state.resultType,
        resultSummary: state.resultSummary,
        targetRuns: state.target,
        engineState: state as object,
        snapshot: snapshot as object,
        oversPerInnings: state.config.rules.oversPerInnings,
        publishedAt: state.status === "PUBLISHED" ? new Date() : undefined
      }
    });
    for (const inn of state.innings) {
      await tx.innings.upsert({
        where: { matchId_inningsNumber: { matchId, inningsNumber: inn.inningsNumber } },
        update: {
          battingTeamId: inn.battingTeamId,
          bowlingTeamId: inn.bowlingTeamId,
          totalRuns: inn.totalRuns,
          wickets: inn.wickets,
          legalBalls: inn.legalBalls,
          extrasTotal: inn.extras.total,
          isComplete: inn.isComplete,
          endReason: inn.endReason
        },
        create: {
          matchId,
          inningsNumber: inn.inningsNumber,
          battingTeamId: inn.battingTeamId,
          bowlingTeamId: inn.bowlingTeamId,
          totalRuns: inn.totalRuns,
          wickets: inn.wickets,
          legalBalls: inn.legalBalls,
          extrasTotal: inn.extras.total,
          isComplete: inn.isComplete,
          endReason: inn.endReason
        }
      });
    }
    if (userId && action) {
      await tx.auditLog.create({
        data: { matchId, userId, action, payload: payload as object ?? undefined }
      });
    }
  });
  emitMatch(String(row.no), snapshot);
  void (async () => {
    try {
      const match = await loadMatch(String(row.no));
      if (!match) return;
      emitTournament(match.tournamentId, { matchId: row.no });
      await recomputeTournamentStats(match.tournamentId);
    } catch (err) {
      console.error("stats recompute failed", err);
    }
  })();
  return snapshot;
}

export async function publicMatchPayload(matchId: string) {
  const match = await loadMatch(matchId);
  if (!match) return null;
  const state = match.engineState ? getState(match) : null;
  const snapshot = state ? buildSnapshot(state) : ((match.snapshot as LiveSnapshot | null) ?? null);
  return {
    id: match.no,
    no: match.no,
    status: match.status,
    scheduledAt: match.scheduledAt,
    venue: match.venue,
    tournamentId: match.tournamentId,
    tournamentName: match.tournament.name,
    team1: { id: match.team1.id, name: match.team1.name, shortName: match.team1.shortName },
    team2: { id: match.team2.id, name: match.team2.name, shortName: match.team2.shortName },
    resultSummary: snapshot?.resultSummary ?? match.resultSummary,
    streamUrl: match.streamUrl,
    targetRuns: match.targetRuns,
    snapshot,
    officials: match.officials
  };
}

export async function setStreamUrl(matchId: string, url: string) {
  const match = await loadMatch(matchId);
  if (!match) throw Object.assign(new Error("Match not found"), { status: 404 });
  const trimmed = url.trim();
  if (trimmed && !youtubeEmbedUrl(trimmed)) {
    throw Object.assign(new Error("Paste a valid YouTube watch, live, or youtu.be link"), { status: 400 });
  }
  await prisma.match.update({
    where: { id: match.id },
    data: { streamUrl: trimmed || null }
  });
  const payload = await publicMatchPayload(String(match.no));
  if (payload?.snapshot) {
    emitMatch(String(match.no), { ...payload.snapshot, streamUrl: payload.streamUrl });
  }
  return { streamUrl: trimmed || null, snapshot: payload?.snapshot };
}

export async function applyScoring(matchId: string, input: ScoringInput) {
  const existing = await prisma.delivery.findUnique({ where: { eventId: input.eventId } });
  if (existing) {
    const match = await loadMatch(matchId);
    return {
      duplicate: true,
      snapshot: match?.snapshot,
      state: match ? getState(match) : undefined,
      delivery: existing
    };
  }
  const match = await loadMatch(matchId);
  if (!match) throw Object.assign(new Error("Match not found"), { status: 404 });
  const uuid = match.id;
  const state = getState(match);
  const result = applyDelivery(state, input);
  if (!result.ok) {
    return { error: result.error };
  }
  if (result.duplicate) {
    return { duplicate: true, snapshot: buildSnapshot(result.state), delivery: result.delivery };
  }
  const d = result.delivery!;
  const innRow = await prisma.innings.findUnique({
    where: { matchId_inningsNumber: { matchId: uuid, inningsNumber: d.inningsNumber } }
  });
  await prisma.delivery.create({
    data: {
      eventId: d.eventId,
      matchId: uuid,
      inningsId: innRow?.id,
      inningsNumber: d.inningsNumber,
      overNumber: d.overNumber,
      deliveryNumber: d.deliveryNumber,
      legalBallNumber: d.legalBallNumber,
      strikerId: d.strikerId,
      nonStrikerId: d.nonStrikerId,
      bowlerId: d.bowlerId,
      batRuns: d.batRuns,
      wideRuns: d.wideRuns,
      noBallRuns: d.noBallRuns,
      byeRuns: d.byeRuns,
      legByeRuns: d.legByeRuns,
      penaltyRuns: d.penaltyRuns,
      homeRunBonus: d.homeRunBonus,
      totalRuns: d.totalRuns,
      isLegal: d.isLegal,
      isBoundary: d.isBoundary,
      isHomeRun: d.isHomeRun,
      isFreeHit: d.isFreeHit,
      isWicket: d.isWicket,
      isRetirement: d.isRetirement,
      extraType: d.extraType,
      dismissalType: d.wicket?.dismissalType,
      dismissedPlayerId: d.wicket?.dismissedPlayerId,
      catcherId: d.wicket?.catcherId,
      runOutFielderId: d.wicket?.runOutFielderId,
      runOutCreditedPlayerId: d.wicket?.runOutCreditedPlayerId,
      illegalBallCountAfter: d.illegalBallCountAfter,
      timestamp: new Date(d.timestamp),
      scoredByUserId: input.scoredByUserId,
      commentary: d.commentary
    }
  });
  if (d.commentary) {
    await prisma.commentary.create({
      data: {
        matchId: uuid,
        eventId: d.eventId,
        text: d.commentary,
        kind: d.isHomeRun ? "HOME_RUN" : d.isWicket ? "WICKET" : "BALL"
      }
    });
  }
  const snapshot = await persist(String(match.no), result.state, input.scoredByUserId, "DELIVERY", { eventId: d.eventId });
  return { snapshot, delivery: d, state: result.state };
}

export async function runEngine(
  matchId: string,
  userId: string,
  fn: (state: MatchState) => ApplyResult,
  action: string
) {
  const match = await loadMatch(matchId);
  if (!match) throw Object.assign(new Error("Match not found"), { status: 404 });
  const result = fn(getState(match));
  if (!result.ok) return { error: result.error };
  if (action === "PLAYING_XI" && match.playingXI.length === 0 && result.state.playingXI) {
    const rows = [
      ...result.state.playingXI.team1.map((playerId, i) => ({ matchId: match.id, teamId: match.team1Id, playerId, battingOrder: i + 1 })),
      ...result.state.playingXI.team2.map((playerId, i) => ({ matchId: match.id, teamId: match.team2Id, playerId, battingOrder: i + 1 }))
    ];
    await prisma.playingXI.createMany({ data: rows, skipDuplicates: true });
  }
  const snapshot = await persist(String(match.no), result.state, userId, action);
  return { snapshot, state: result.state };
}

export async function doToss(matchId: string, winnerTeamId: string, decision: "BAT" | "FIELD", userId: string) {
  return runEngine(matchId, userId, (s) => recordToss(s, winnerTeamId, decision, userId), "TOSS");
}

export async function doPlayingXI(matchId: string, team1: string[], team2: string[], userId: string) {
  return runEngine(matchId, userId, (s) => confirmPlayingXI(s, team1, team2, userId), "PLAYING_XI");
}

export async function doStartInnings(
  matchId: string,
  inningsNumber: 1 | 2,
  strikerId: string,
  nonStrikerId: string,
  bowlerId: string,
  userId: string
) {
  return runEngine(
    matchId,
    userId,
    (s) =>
      inningsNumber === 1
        ? startFirstInnings(s, strikerId, nonStrikerId, bowlerId, userId)
        : startSecondInnings(s, strikerId, nonStrikerId, bowlerId, userId),
    "START_INNINGS"
  );
}

export async function doStartSuperOver(
  matchId: string,
  body: { batterIds: string[]; strikerId: string; nonStrikerId: string; bowlerId: string },
  userId: string
) {
  return runEngine(
    matchId,
    userId,
    (s) => startSuperOverInnings(s, body, userId),
    "START_SUPER_OVER"
  );
}

export async function doSelectBatter(matchId: string, playerId: string, userId: string) {
  return runEngine(matchId, userId, (s) => selectReplacementBatter(s, playerId, userId), "SELECT_BATTER");
}

export async function doSelectBowler(matchId: string, bowlerId: string, userId: string, override = false) {
  return runEngine(matchId, userId, (s) => selectNextBowler(s, bowlerId, userId, override), "SELECT_BOWLER");
}

export async function doUndo(matchId: string, userId: string) {
  const match = await loadMatch(matchId);
  if (!match) throw Object.assign(new Error("Match not found"), { status: 404 });
  const result = undoLastDelivery(getState(match), userId);
  if (!result.ok) return { error: result.error };
  if (result.delivery) {
    await prisma.delivery.update({ where: { eventId: result.delivery.eventId }, data: { undone: true } });
  }
  const snapshot = await persist(String(match.no), result.state, userId, "UNDO", { eventId: result.delivery?.eventId });
  return { snapshot, state: result.state };
}

export async function doReduceOvers(matchId: string, overs: number, reason: string, userId: string) {
  const result = await runEngine(matchId, userId, (s) => reduceOvers(s, overs, reason, userId), "REDUCE_OVERS");
  const match = await loadMatch(matchId);
  if (match) {
    await prisma.match.update({ where: { id: match.id }, data: { reducedOversReason: reason, oversPerInnings: overs } });
  }
  return result;
}

export async function doPublish(matchId: string, userId: string) {
  const match = await loadMatch(matchId);
  if (!match) throw Object.assign(new Error("Match not found"), { status: 404 });
  const state = getState(match);
  const check = completeMatchChecklist(state);
  if (!check.ready && state.status !== "COMPLETE") {
    return { error: { code: "CHECKLIST_INCOMPLETE", message: check.missing.join("; ") } };
  }
  const result = publishMatch(state.status === "COMPLETE" ? state : { ...state, status: "COMPLETE" }, userId);
  if (!result.ok) return { error: result.error };
  const snapshot = await persist(String(match.no), result.state, userId, "PUBLISH");
  return { snapshot, state: result.state, checklist: check };
}

function deliveryRow(matchId: string, inningsId: string | undefined, d: DeliveryRecord, userId: string) {
  return {
    eventId: d.eventId,
    matchId,
    inningsId,
    inningsNumber: d.inningsNumber,
    overNumber: d.overNumber,
    deliveryNumber: d.deliveryNumber,
    legalBallNumber: d.legalBallNumber,
    strikerId: d.strikerId,
    nonStrikerId: d.nonStrikerId,
    bowlerId: d.bowlerId,
    batRuns: d.batRuns,
    wideRuns: d.wideRuns,
    noBallRuns: d.noBallRuns,
    byeRuns: d.byeRuns,
    legByeRuns: d.legByeRuns,
    penaltyRuns: d.penaltyRuns,
    homeRunBonus: d.homeRunBonus,
    totalRuns: d.totalRuns,
    isLegal: d.isLegal,
    isBoundary: d.isBoundary,
    isHomeRun: d.isHomeRun,
    isFreeHit: d.isFreeHit,
    isWicket: d.isWicket,
    isRetirement: d.isRetirement,
    extraType: d.extraType,
    dismissalType: d.wicket?.dismissalType,
    dismissedPlayerId: d.wicket?.dismissedPlayerId,
    catcherId: d.wicket?.catcherId,
    runOutFielderId: d.wicket?.runOutFielderId,
    runOutCreditedPlayerId: d.wicket?.runOutCreditedPlayerId,
    illegalBallCountAfter: d.illegalBallCountAfter,
    timestamp: new Date(d.timestamp),
    scoredByUserId: userId,
    commentary: d.commentary
  };
}

export async function doWalkover(matchId: string, winnerTeamId: string, reason: string, userId: string) {
  const match = await loadMatch(matchId);
  if (!match) throw Object.assign(new Error("Match not found"), { status: 404 });
  const result = awardWalkover(getState(match), winnerTeamId, reason, userId);
  if (!result.ok) return { error: result.error };
  if (result.state.playingXI && match.playingXI.length === 0) {
    const rows = [
      ...result.state.playingXI.team1.map((playerId, i) => ({
        matchId: match.id,
        teamId: match.team1Id,
        playerId,
        battingOrder: i + 1
      })),
      ...result.state.playingXI.team2.map((playerId, i) => ({
        matchId: match.id,
        teamId: match.team2Id,
        playerId,
        battingOrder: i + 1
      }))
    ];
    await prisma.playingXI.createMany({ data: rows, skipDuplicates: true });
  }
  const snapshot = await persist(String(match.no), result.state, userId, "WALKOVER", { winnerTeamId, reason });
  const innings = await prisma.innings.findMany({ where: { matchId: match.id } });
  const inningsId = new Map(innings.map((row) => [row.inningsNumber, row.id]));
  const deliveries = result.state.innings.flatMap((inn) =>
    inn.deliveries
      .filter((d) => !d.undone)
      .map((d) => deliveryRow(match.id, inningsId.get(inn.inningsNumber), d, userId))
  );
  if (deliveries.length) {
    await prisma.delivery.createMany({ data: deliveries, skipDuplicates: true });
  }
  if (result.state.resultSummary) {
    await prisma.commentary.create({
      data: {
        matchId: match.id,
        eventId: `walkover-${match.id}-result`,
        text: result.state.resultSummary,
        kind: "WALKOVER"
      }
    });
  }
  return { snapshot, state: result.state };
}

export { completeMatchChecklist };
