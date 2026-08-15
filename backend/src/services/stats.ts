import { inningsAllOut, LiveSnapshot, MatchState, netRunRate, nrrBallsCredited } from "@lms/shared";
import { prisma } from "../db.js";

export async function recomputeTournamentStats(tournamentId: string) {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: { rules: true, teams: true, matches: true }
  });
  if (!tournament) return;

  const rules = tournament.rules;
  const pointsWin = rules?.pointsWin ?? 2;
  const pointsTie = rules?.pointsTie ?? 1;
  const pointsNR = rules?.pointsNoResult ?? 1;
  const pointsLoss = rules?.pointsLoss ?? 0;

  type PStat = {
    playerId: string;
    teamId?: string;
    matches: Set<string>;
    runs: number;
    ballsFaced: number;
    fours: number;
    sixes: number;
    dismissals: number;
    notOuts: number;
    highestScore: number;
    retirements: number;
    wickets: number;
    runsConceded: number;
    ballsBowled: number;
    catches: number;
    runOuts: number;
    stumpings: number;
  };
  const players = new Map<string, PStat>();
  const ensureP = (id: string): PStat => {
    if (!players.has(id)) {
      players.set(id, {
        playerId: id,
        matches: new Set(),
        runs: 0,
        ballsFaced: 0,
        fours: 0,
        sixes: 0,
        dismissals: 0,
        notOuts: 0,
        highestScore: 0,
        retirements: 0,
        wickets: 0,
        runsConceded: 0,
        ballsBowled: 0,
        catches: 0,
        runOuts: 0,
        stumpings: 0
      });
    }
    return players.get(id)!;
  };

  type TStat = {
    teamId: string;
    played: number;
    won: number;
    lost: number;
    tied: number;
    noResult: number;
    points: number;
    runsFor: number;
    runsAgainst: number;
    ballsFor: number;
    ballsAgainst: number;
  };
  const teams = new Map<string, TStat>();
  for (const t of tournament.teams) {
    teams.set(t.id, {
      teamId: t.id,
      played: 0,
      won: 0,
      lost: 0,
      tied: 0,
      noResult: 0,
      points: 0,
      runsFor: 0,
      runsAgainst: 0,
      ballsFor: 0,
      ballsAgainst: 0
    });
  }

  for (const match of tournament.matches) {
    const state = match.engineState as MatchState | null;
    const snap = match.snapshot as LiveSnapshot | null;
    if (!state && !snap) continue;

    const completed = match.status === "COMPLETE" || match.status === "PUBLISHED";
    const walkover = match.resultType === "WALKOVER";
    const noResult = match.resultType === "NO_RESULT";
    const countNrr = completed && !walkover && !noResult;

    if (state) {
      const walkoverSkipPlayers = walkover;
      if (!walkoverSkipPlayers) {
      for (const inn of state.innings) {
        for (const b of Object.values(inn.batsmen)) {
          const p = ensureP(b.playerId);
          p.matches.add(match.id);
          p.runs += b.runs;
          p.ballsFaced += b.balls;
          p.fours += b.fours;
          p.sixes += b.sixes;
          p.retirements += b.retiredCount;
          if (b.runs > p.highestScore) p.highestScore = b.runs;
          if (b.statusKind === "OUT") p.dismissals += 1;
          if (b.statusKind === "NOT_OUT" || b.statusKind === "RETIRED_NOT_OUT") p.notOuts += 1;
          if (b.dismissal?.catcherId) ensureP(b.dismissal.catcherId).catches += 1;
          if (b.dismissal?.dismissalType === "RUN_OUT" || b.dismissal?.dismissalType === "MANKAD") {
            const fid = b.dismissal.runOutCreditedPlayerId ?? b.dismissal.runOutFielderId;
            if (fid) ensureP(fid).runOuts += 1;
          }
          if (b.dismissal?.dismissalType === "STUMPED") {
            /* stumper unknown unless catcher used */
            if (b.dismissal.catcherId) ensureP(b.dismissal.catcherId).stumpings += 1;
          }
        }
        for (const bowl of Object.values(inn.bowlers)) {
          const p = ensureP(bowl.playerId);
          p.matches.add(match.id);
          p.wickets += bowl.wickets;
          p.runsConceded += bowl.runsConceded;
          p.ballsBowled += bowl.legalBalls;
        }
        if (countNrr && inn.isComplete && (inn.kind ?? "REGULAR") !== "SUPER_OVER") {
          const ballsPerOver = rules?.ballsPerOver ?? 6;
          const oversAllocated = match.oversPerInnings || rules?.oversPerInnings || 8;
          const playersPerSide = rules?.playersPerSide ?? 11;
          const allOut = inningsAllOut(inn.wickets, playersPerSide, inn.endReason);
          const balls = nrrBallsCredited(inn.legalBalls, oversAllocated, ballsPerOver, allOut);
          const bat = teams.get(inn.battingTeamId);
          const bowlT = teams.get(inn.bowlingTeamId);
          if (bat) {
            bat.runsFor += inn.totalRuns;
            bat.ballsFor += balls;
          }
          if (bowlT) {
            bowlT.runsAgainst += inn.totalRuns;
            bowlT.ballsAgainst += balls;
          }
        }
      }
      }
    }

    if (match.status === "COMPLETE" || match.status === "PUBLISHED") {
      const t1 = teams.get(match.team1Id);
      const t2 = teams.get(match.team2Id);
      if (t1) t1.played += 1;
      if (t2) t2.played += 1;
      if (match.resultType === "TIE") {
        if (t1) {
          t1.tied += 1;
          t1.points += pointsTie;
        }
        if (t2) {
          t2.tied += 1;
          t2.points += pointsTie;
        }
      } else if (match.resultType === "NO_RESULT") {
        if (t1) {
          t1.noResult += 1;
          t1.points += pointsNR;
        }
        if (t2) {
          t2.noResult += 1;
          t2.points += pointsNR;
        }
      } else if (match.winnerId) {
        const winner = teams.get(match.winnerId);
        const loserId = match.winnerId === match.team1Id ? match.team2Id : match.team1Id;
        const loser = teams.get(loserId);
        if (winner) {
          winner.won += 1;
          winner.points += pointsWin;
        }
        if (loser) {
          loser.lost += 1;
          loser.points += pointsLoss;
        }
      }
    }
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tournamentId}))`;
      await tx.playerStatistics.deleteMany({ where: { tournamentId } });
      await tx.teamStatistics.deleteMany({ where: { tournamentId } });
      await tx.pointsTable.deleteMany({ where: { tournamentId } });

      if (players.size) {
        await tx.playerStatistics.createMany({
          data: [...players.values()].map((p) => ({
            tournamentId,
            playerId: p.playerId,
            matches: p.matches.size,
            runs: p.runs,
            ballsFaced: p.ballsFaced,
            fours: p.fours,
            sixes: p.sixes,
            dismissals: p.dismissals,
            notOuts: p.notOuts,
            highestScore: p.highestScore,
            retirements: p.retirements,
            wickets: p.wickets,
            runsConceded: p.runsConceded,
            ballsBowled: p.ballsBowled,
            catches: p.catches,
            runOuts: p.runOuts,
            stumpings: p.stumpings
          }))
        });
      }

      if (teams.size) {
        const ballsPerOver = rules?.ballsPerOver ?? 6;
        const nrr = (t: TStat) => netRunRate(t.runsFor, t.ballsFor, t.runsAgainst, t.ballsAgainst, ballsPerOver);
        await tx.teamStatistics.createMany({
          data: [...teams.values()].map((t) => ({
            tournamentId,
            teamId: t.teamId,
            played: t.played,
            won: t.won,
            lost: t.lost,
            tied: t.tied,
            noResult: t.noResult,
            points: t.points,
            runsFor: t.runsFor,
            runsAgainst: t.runsAgainst
          }))
        });
        await tx.pointsTable.createMany({
          data: [...teams.values()].map((t) => ({
            tournamentId,
            teamId: t.teamId,
            played: t.played,
            won: t.won,
            lost: t.lost,
            tied: t.tied,
            noResult: t.noResult,
            points: t.points,
            nrr: nrr(t)
          }))
        });
      }
    },
    { timeout: 20000 }
  );
}

export async function leaderboards(tournamentId: string) {
  const rows = await prisma.playerStatistics.findMany({ where: { tournamentId } });
  const players = await prisma.player.findMany({
    where: { id: { in: rows.map((r) => r.playerId) } }
  });
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? id;
  const avg = (r: (typeof rows)[0]) => (r.dismissals === 0 ? r.runs : r.runs / r.dismissals);
  const sr = (r: (typeof rows)[0]) => (r.ballsFaced === 0 ? 0 : (r.runs / r.ballsFaced) * 100);
  const econ = (r: (typeof rows)[0]) => (r.ballsBowled === 0 ? 0 : r.runsConceded / (r.ballsBowled / 6));
  const map = (list: typeof rows, extra: (r: (typeof rows)[0]) => number) =>
    list.map((r) => ({
      playerId: r.playerId,
      name: name(r.playerId),
      value: Math.round(extra(r) * 100) / 100,
      runs: r.runs,
      wickets: r.wickets,
      retirements: r.retirements
    }));

  return {
    mostRuns: map([...rows].sort((a, b) => b.runs - a.runs).slice(0, 10), (r) => r.runs),
    highestScore: map([...rows].sort((a, b) => b.highestScore - a.highestScore).slice(0, 10), (r) => r.highestScore),
    bestAverage: map(
      [...rows].filter((r) => r.runs >= 10).sort((a, b) => avg(b) - avg(a)).slice(0, 10),
      avg
    ),
    bestStrikeRate: map(
      [...rows].filter((r) => r.ballsFaced >= 6).sort((a, b) => sr(b) - sr(a)).slice(0, 10),
      sr
    ),
    mostFours: map([...rows].sort((a, b) => b.fours - a.fours).slice(0, 10), (r) => r.fours),
    mostSixes: map([...rows].sort((a, b) => b.sixes - a.sixes).slice(0, 10), (r) => r.sixes),
    mostRetirements: map([...rows].sort((a, b) => b.retirements - a.retirements).slice(0, 10), (r) => r.retirements),
    mostWickets: map([...rows].sort((a, b) => b.wickets - a.wickets).slice(0, 10), (r) => r.wickets),
    bestEconomy: map(
      [...rows].filter((r) => r.ballsBowled >= 6).sort((a, b) => econ(a) - econ(b)).slice(0, 10),
      econ
    ),
    mostCatches: map([...rows].sort((a, b) => b.catches - a.catches).slice(0, 10), (r) => r.catches)
  };
}
