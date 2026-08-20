import express from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "./db.js";
import { requireAuth, signToken } from "./middleware/auth.js";
import {
  applyScoring,
  completeMatchChecklist,
  doPlayingXI,
  doPublish,
  doReduceOvers,
  doSelectBatter,
  doSelectBowler,
  doStartInnings,
  doStartSuperOver,
  doToss,
  doUndo,
  doWalkover,
  getState,
  loadMatch,
  publicMatchPayload,
  setStreamUrl
} from "./services/matchService.js";
import { leaderboards, recomputeTournamentStats } from "./services/stats.js";
import { oversForFixture } from "@lms/shared";

export const api = express.Router();

api.get("/health", (_req, res) => res.json({ ok: true, name: "Wolfpack Tape Ball League" }));

api.post("/auth/login", async (req, res) => {
  const body = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Invalid credentials" });
  const user = await prisma.user.findUnique({ where: { email: body.data.email.toLowerCase() } });
  if (!user || !(await bcrypt.compare(body.data.password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  const payload = { id: user.id, email: user.email, name: user.name, role: user.role };
  res.json({ token: signToken(payload), user: payload });
});

api.get("/auth/me", requireAuth(), async (req, res) => {
  res.json({ user: req.user });
});

api.get("/tournaments", async (_req, res) => {
  const rows = await prisma.tournament.findMany({
    include: { rules: true, _count: { select: { teams: true, matches: true } } },
    orderBy: { createdAt: "desc" }
  });
  res.json(rows);
});

api.get("/tournaments/:id", async (req, res) => {
  const row = await prisma.tournament.findUnique({
    where: { id: req.params.id },
    include: {
      rules: true,
      groups: true,
      venues: true,
      teams: { include: { players: { include: { player: true } } } }
    }
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

api.get("/tournaments/:id/fixtures", async (req, res) => {
  const rows = await prisma.fixture.findMany({
    where: { tournamentId: req.params.id },
    include: { team1: true, team2: true, venue: true, match: true, group: true },
    orderBy: { scheduledAt: "asc" }
  });
  res.json(rows);
});

api.get("/tournaments/:id/points", async (req, res) => {
  await recomputeTournamentStats(req.params.id);
  const rows = await prisma.pointsTable.findMany({
    where: { tournamentId: req.params.id },
    orderBy: [{ points: "desc" }, { nrr: "desc" }]
  });
  const teams = await prisma.team.findMany({ where: { tournamentId: req.params.id } });
  res.json(
    rows.map((r) => ({
      ...r,
      team: teams.find((t) => t.id === r.teamId)
    }))
  );
});

api.get("/tournaments/:id/leaderboards", async (req, res) => {
  res.json(await leaderboards(req.params.id));
});

api.get("/matches", async (req, res) => {
  const status = req.query.status as string | undefined;
  const tournamentId = req.query.tournamentId as string | undefined;
  const rows = await prisma.match.findMany({
    where: {
      ...(status ? { status: status as never } : {}),
      ...(tournamentId ? { tournamentId } : {})
    },
    include: { team1: true, team2: true, venue: true, tournament: true },
    orderBy: { scheduledAt: "asc" }
  });
  res.json(
    rows.map((m) => ({
      id: m.no,
      status: m.status,
      scheduledAt: m.scheduledAt,
      resultSummary: m.resultSummary,
      streamUrl: m.streamUrl,
      tournamentId: m.tournamentId,
      tournamentName: m.tournament.name,
      venue: m.venue,
      team1: { id: m.team1.id, name: m.team1.name, shortName: m.team1.shortName },
      team2: { id: m.team2.id, name: m.team2.name, shortName: m.team2.shortName },
      snapshot: m.snapshot
    }))
  );
});

api.get("/matches/:id", async (req, res) => {
  const payload = await publicMatchPayload(req.params.id);
  if (!payload) return res.status(404).json({ error: "Not found" });
  res.json(payload);
});

api.get("/teams/:id", async (req, res) => {
  const team = await prisma.team.findUnique({
    where: { id: req.params.id },
    include: {
      players: { include: { player: true } },
      tournament: true,
      group: true
    }
  });
  if (!team) return res.status(404).json({ error: "Not found" });
  const matches = await prisma.match.findMany({
    where: { OR: [{ team1Id: team.id }, { team2Id: team.id }] },
    include: { team1: true, team2: true },
    orderBy: { scheduledAt: "desc" }
  });
  const stats = await prisma.teamStatistics.findFirst({
    where: { teamId: team.id, tournamentId: team.tournamentId }
  });
  res.json({ team, matches, stats });
});

api.get("/players/:id", async (req, res) => {
  const player = await prisma.player.findUnique({
    where: { id: req.params.id },
    include: { teams: { include: { team: true } } }
  });
  if (!player) return res.status(404).json({ error: "Not found" });
  const stats = await prisma.playerStatistics.findMany({ where: { playerId: player.id } });
  res.json({ player, stats });
});

api.get("/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) return res.json({ players: [], teams: [], tournaments: [], matches: [] });
  const [players, teams, tournaments, matches] = await Promise.all([
    prisma.player.findMany({ where: { name: { contains: q, mode: "insensitive" } }, take: 8 }),
    prisma.team.findMany({ where: { name: { contains: q, mode: "insensitive" } }, take: 8 }),
    prisma.tournament.findMany({ where: { name: { contains: q, mode: "insensitive" } }, take: 8 }),
    prisma.match.findMany({
      where: {
        OR: [
          { team1: { name: { contains: q, mode: "insensitive" } } },
          { team2: { name: { contains: q, mode: "insensitive" } } }
        ]
      },
      include: { team1: true, team2: true },
      take: 8
    })
  ]);
      matches: matches.map((m) => ({ ...m, id: m.no })),
});

api.get("/umpire/matches", requireAuth(["UMPIRE", "ADMIN"]), async (req, res) => {
  const rows = await prisma.matchOfficial.findMany({
    where: req.user!.role === "ADMIN" ? {} : { userId: req.user!.id },
    include: {
      match: { include: { team1: true, team2: true, venue: true, tournament: true } }
    }
  });
  const unique = new Map(rows.map((r) => [r.match.id, r.match]));
  res.json(
    [...unique.values()].map((m) => ({
      ...m,
      id: m.no
    }))
  );
});

api.get("/umpire/matches/:id", requireAuth(["UMPIRE", "ADMIN"]), async (req, res) => {
  const match = await loadMatch(req.params.id);
  if (!match) return res.status(404).json({ error: "Not found" });
  const assigned =
    req.user!.role === "ADMIN" || match.officials.some((o) => o.userId === req.user!.id);
  if (!assigned) return res.status(403).json({ error: "Not assigned to this match" });
  const state = getState(match);
  res.json({
    match,
    state,
    snapshot: match.snapshot,
    checklist: completeMatchChecklist(state),
    squads: {
      team1: match.team1.players.map((p) => ({ ...p.player, ...p })),
      team2: match.team2.players.map((p) => ({ ...p.player, ...p }))
    },
    playersPerSide: match.tournament.rules?.playersPerSide ?? 11
  });
});

api.post("/umpire/matches/:id/toss", requireAuth(["UMPIRE", "ADMIN"]), async (req, res) => {
  const body = z.object({ winnerTeamId: z.string(), decision: z.enum(["BAT", "FIELD"]) }).parse(req.body);
  const result = await doToss(req.params.id, body.winnerTeamId, body.decision, req.user!.id);
  if ("error" in result && result.error) return res.status(400).json(result);
  res.json(result);
});

api.post("/umpire/matches/:id/playing-xi", requireAuth(["UMPIRE", "ADMIN"]), async (req, res) => {
  const body = z.object({ team1: z.array(z.string()), team2: z.array(z.string()) }).parse(req.body);
  const result = await doPlayingXI(req.params.id, body.team1, body.team2, req.user!.id);
  if ("error" in result && result.error) return res.status(400).json(result);
  res.json(result);
});

api.post("/umpire/matches/:id/overs", requireAuth(["UMPIRE", "ADMIN"]), async (req, res) => {
  const body = z.object({ overs: z.number().int().positive(), reason: z.string().min(1) }).parse(req.body);
  const result = await doReduceOvers(req.params.id, body.overs, body.reason, req.user!.id);
  if ("error" in result && result.error) return res.status(400).json(result);
  res.json(result);
});

api.post("/umpire/matches/:id/start-innings", requireAuth(["UMPIRE", "ADMIN"]), async (req, res) => {
  const body = z
    .object({
      inningsNumber: z.union([z.literal(1), z.literal(2)]),
      strikerId: z.string(),
      nonStrikerId: z.string(),
      bowlerId: z.string()
    })
    .parse(req.body);
  const result = await doStartInnings(
    req.params.id,
    body.inningsNumber,
    body.strikerId,
    body.nonStrikerId,
    body.bowlerId,
    req.user!.id
  );
  if ("error" in result && result.error) return res.status(400).json(result);
  res.json(result);
});

api.post("/umpire/matches/:id/super-over", requireAuth(["UMPIRE", "ADMIN"]), async (req, res) => {
  const body = z
    .object({
      batterIds: z.array(z.string()).length(3),
      strikerId: z.string(),
      nonStrikerId: z.string(),
      bowlerId: z.string()
    })
    .parse(req.body);
  const result = await doStartSuperOver(req.params.id, body, req.user!.id);
  if ("error" in result && result.error) return res.status(400).json(result);
  res.json(result);
});

api.post("/umpire/matches/:id/deliveries", requireAuth(["UMPIRE", "ADMIN"]), async (req, res) => {
  try {
    const body = z
      .object({
        eventId: z.string().min(4),
        strikerId: z.string(),
        nonStrikerId: z.string(),
        bowlerId: z.string(),
        batRuns: z.number().int().min(0).max(7),
        extraType: z.enum(["NONE", "WIDE", "NO_BALL", "BYE", "LEG_BYE", "PENALTY"]).default("NONE"),
        byeRuns: z.number().int().optional(),
        legByeRuns: z.number().int().optional(),
        penaltyRuns: z.number().int().optional(),
        wicket: z
          .object({
            dismissalType: z.enum([
              "BOWLED",
              "CAUGHT",
              "LBW",
              "RUN_OUT",
              "STUMPED",
              "HIT_WICKET",
              "RETIRED_OUT",
              "TIMED_OUT",
              "MANKAD",
              "OBSTRUCTING_THE_FIELD",
              "HIT_THE_BALL_TWICE"
            ]),
            dismissedPlayerId: z.string(),
            catcherId: z.string().optional(),
            runOutFielderId: z.string().optional(),
            runOutCreditedPlayerId: z.string().optional()
          })
          .optional(),
        injuryRetirement: z.object({ playerId: z.string() }).optional(),
        overrideConstraints: z.boolean().optional(),
        timestamp: z.string().optional()
      })
      .parse(req.body);
    const result = await applyScoring(req.params.id, { ...body, scoredByUserId: req.user!.id });
    if ("error" in result && result.error) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Scoring failed" });
  }
});

api.post("/umpire/matches/:id/undo", requireAuth(["UMPIRE", "ADMIN"]), async (req, res) => {
  const result = await doUndo(req.params.id, req.user!.id);
  if ("error" in result && result.error) return res.status(400).json(result);
  res.json(result);
});

api.post("/umpire/matches/:id/select-batter", requireAuth(["UMPIRE", "ADMIN"]), async (req, res) => {
  const body = z.object({ playerId: z.string() }).parse(req.body);
  const result = await doSelectBatter(req.params.id, body.playerId, req.user!.id);
  if ("error" in result && result.error) return res.status(400).json(result);
  res.json(result);
});

api.post("/umpire/matches/:id/select-bowler", requireAuth(["UMPIRE", "ADMIN"]), async (req, res) => {
  const body = z.object({ bowlerId: z.string(), override: z.boolean().optional() }).parse(req.body);
  const result = await doSelectBowler(req.params.id, body.bowlerId, req.user!.id, body.override);
  if ("error" in result && result.error) return res.status(400).json(result);
  res.json(result);
});

api.patch("/umpire/matches/:id/stream", requireAuth(["UMPIRE", "ADMIN"]), async (req, res) => {
  const body = z.object({ url: z.string() }).parse(req.body);
  try {
    const result = await setStreamUrl(req.params.id, body.url);
    res.json(result);
  } catch (e) {
    const status = e && typeof e === "object" && "status" in e ? Number((e as { status: number }).status) : 400;
    res.status(status || 400).json({ error: e instanceof Error ? e.message : "Invalid stream URL" });
  }
});

api.post("/umpire/matches/:id/publish", requireAuth(["ADMIN"]), async (req, res) => {
  const result = await doPublish(req.params.id, req.user!.id);
  if ("error" in result && result.error) return res.status(400).json(result);
  res.json(result);
});

api.post("/umpire/matches/:id/complete", requireAuth(["UMPIRE", "ADMIN"]), async (req, res) => {
  const match = await loadMatch(req.params.id);
  if (!match) return res.status(404).json({ error: "Not found" });
  const state = getState(match);
  const check = completeMatchChecklist(state);
  if (!check.ready) return res.status(400).json({ error: "Checklist incomplete", missing: check.missing });
  const result = await doPublish(req.params.id, req.user!.id);
  res.json({ ...result, checklist: check });
});

api.post("/umpire/matches/:id/walkover", requireAuth(["UMPIRE", "ADMIN"]), async (req, res) => {
  const body = z
    .object({
      winnerTeamId: z.string().min(1),
      reason: z.string().min(1)
    })
    .parse(req.body);
  const match = await loadMatch(req.params.id);
  if (!match) return res.status(404).json({ error: "Not found" });
  const assigned = req.user!.role === "ADMIN" || match.officials.some((o) => o.userId === req.user!.id);
  if (!assigned) return res.status(403).json({ error: "Not assigned to this match" });
  if (match.status === "COMPLETE" || match.status === "PUBLISHED") {
    return res.status(400).json({ error: "Match is already complete" });
  }
  const result = await doWalkover(req.params.id, body.winnerTeamId, body.reason, req.user!.id);
  if ("error" in result && result.error) return res.status(400).json(result);
  res.json(result);
});

const admin = requireAuth(["ADMIN"]);

api.post("/admin/tournaments", admin, async (req, res) => {
  const body = z
    .object({
      name: z.string(),
      season: z.string().optional(),
      featured: z.boolean().optional(),
      rules: z
        .object({
          oversPerInnings: z.number().int().positive().optional(),
          groupOversPerInnings: z.number().int().positive().optional(),
          knockoutOversPerInnings: z.number().int().positive().optional(),
          finalOversPerInnings: z.number().int().positive().optional(),
          ballsPerOver: z.number().int().positive().optional(),
          maxOversPerBowler: z.number().int().positive().optional(),
          firstIllegalPenalty: z.number().int().min(0).optional(),
          escalatedIllegalPenalty: z.number().int().min(0).optional(),
          retirementScore: z.number().int().positive().optional()
        })
        .optional()
    })
    .parse(req.body);
  const row = await prisma.tournament.create({
    data: {
      name: body.name,
      season: body.season,
      featured: body.featured ?? false,
      rules: { create: body.rules ?? {} }
    },
    include: { rules: true }
  });
  res.json(row);
});

api.patch("/admin/tournaments/:id/rules", admin, async (req, res) => {
  const body = z
    .object({
      oversPerInnings: z.number().int().positive().optional(),
      groupOversPerInnings: z.number().int().positive().optional(),
      knockoutOversPerInnings: z.number().int().positive().optional(),
      finalOversPerInnings: z.number().int().positive().optional(),
      ballsPerOver: z.number().int().positive().optional(),
      playersPerSide: z.number().int().min(2).max(15).optional(),
      maxOversPerBowler: z.number().int().positive().optional(),
      firstIllegalPenalty: z.number().int().min(0).optional(),
      escalatedIllegalPenalty: z.number().int().min(0).optional(),
      retirementScore: z.number().int().positive().optional(),
      homeRunEnabled: z.boolean().optional(),
      homeRunBonus: z.number().int().min(0).optional(),
      freeHitAfterNoBall: z.boolean().optional(),
      tieHandling: z.enum(["TIE", "SUPER_OVER", "SHARED_POINTS"]).optional()
    })
    .parse(req.body);
  const row = await prisma.tournamentRule.upsert({
    where: { tournamentId: req.params.id },
    update: body,
    create: { tournamentId: req.params.id, ...body }
  });
  res.json(row);
});

api.post("/admin/teams", admin, async (req, res) => {
  const body = z
    .object({
      tournamentId: z.string(),
      name: z.string(),
      shortName: z.string(),
      city: z.string().optional(),
      groupId: z.string().optional()
    })
    .parse(req.body);
  res.json(await prisma.team.create({ data: body }));
});

api.post("/admin/players", admin, async (req, res) => {
  const body = z
    .object({
      name: z.string(),
      teamId: z.string(),
      role: z.string().optional(),
      battingStyle: z.string().optional(),
      bowlingStyle: z.string().optional(),
      jerseyNumber: z.number().optional(),
      isCaptain: z.boolean().optional(),
      isWicketKeeper: z.boolean().optional()
    })
    .parse(req.body);
  const player = await prisma.player.create({
    data: {
      name: body.name,
      role: body.role,
      battingStyle: body.battingStyle,
      bowlingStyle: body.bowlingStyle
    }
  });
  await prisma.teamPlayer.create({
    data: {
      teamId: body.teamId,
      playerId: player.id,
      jerseyNumber: body.jerseyNumber,
      isCaptain: body.isCaptain ?? false,
      isWicketKeeper: body.isWicketKeeper ?? false
    }
  });
  res.json(player);
});

api.post("/admin/venues", admin, async (req, res) => {
  const body = z.object({ tournamentId: z.string().optional(), name: z.string(), city: z.string().optional() }).parse(req.body);
  res.json(await prisma.venue.create({ data: body }));
});

api.delete("/admin/venues/:id", admin, async (req, res) => {
  try {
    const id = req.params.id;
    await prisma.match.updateMany({ where: { venueId: id }, data: { venueId: null } });
    await prisma.fixture.updateMany({ where: { venueId: id }, data: { venueId: null } });
    await prisma.venue.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Could not delete venue" });
  }
});

api.delete("/admin/teams/:id", admin, async (req, res) => {
  try {
    const id = req.params.id;
    const started = await prisma.match.count({
      where: { OR: [{ team1Id: id }, { team2Id: id }], NOT: { status: "SCHEDULED" } }
    });
    if (started) {
      return res.status(400).json({
        error: "This squad already has a match that has started or finished. It cannot be deleted."
      });
    }
    const matches = await prisma.match.findMany({
      where: { OR: [{ team1Id: id }, { team2Id: id }] },
      select: { id: true, fixtureId: true }
    });
    const matchIds = matches.map((m) => m.id);
    const fixtureIds = matches.map((m) => m.fixtureId).filter((fid): fid is string => Boolean(fid));
    await prisma.$transaction(async (tx) => {
      if (matchIds.length) await tx.match.deleteMany({ where: { id: { in: matchIds } } });
      if (fixtureIds.length) await tx.fixture.deleteMany({ where: { id: { in: fixtureIds } } });
      await tx.fixture.deleteMany({ where: { OR: [{ team1Id: id }, { team2Id: id }] } });
      await tx.teamStatistics.deleteMany({ where: { teamId: id } });
      await tx.pointsTable.deleteMany({ where: { teamId: id } });
      await tx.team.delete({ where: { id } });
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Could not delete squad" });
  }
});

api.delete("/admin/teams/:teamId/players/:playerId", admin, async (req, res) => {
  try {
    const { teamId, playerId } = req.params;
    const inPlay = await prisma.playingXI.findFirst({
      where: { playerId, match: { status: { not: "SCHEDULED" } } }
    });
    if (inPlay) {
      return res.status(400).json({
        error: "This player is in a match that has started. They cannot be removed until that match is finished."
      });
    }
    await prisma.playingXI.deleteMany({ where: { playerId, teamId } });
    await prisma.teamPlayer.deleteMany({ where: { teamId, playerId } });
    const stillInSquad = await prisma.teamPlayer.count({ where: { playerId } });
    const stillInXi = await prisma.playingXI.count({ where: { playerId } });
    if (stillInSquad === 0 && stillInXi === 0) {
      await prisma.playerStatistics.deleteMany({ where: { playerId } });
      await prisma.player.delete({ where: { id: playerId } });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Could not remove player" });
  }
});

api.post("/admin/fixtures", admin, async (req, res) => {
  const body = z
    .object({
      tournamentId: z.string(),
      team1Id: z.string(),
      team2Id: z.string(),
      venueId: z.string().optional(),
      scheduledAt: z.string(),
      stage: z.enum(["GROUP", "KNOCKOUT"]).optional(),
      round: z.string().optional(),
      groupId: z.string().optional(),
      oversPerInnings: z.number().int().positive().optional(),
      maxOversPerBowler: z.number().int().positive().optional()
    })
    .parse(req.body);
  const tournament = await prisma.tournament.findUnique({
    where: { id: body.tournamentId },
    include: { rules: true }
  });
  const stage = body.stage ?? "GROUP";
  const rules = {
    oversPerInnings: tournament?.rules?.oversPerInnings ?? 8,
    groupOversPerInnings: tournament?.rules?.groupOversPerInnings ?? tournament?.rules?.oversPerInnings ?? 6,
    knockoutOversPerInnings: tournament?.rules?.knockoutOversPerInnings ?? 8,
    finalOversPerInnings: tournament?.rules?.finalOversPerInnings ?? 10
  };
  const overs = body.oversPerInnings ?? oversForFixture(rules, stage, body.round);
  const fixture = await prisma.fixture.create({
    data: {
      tournamentId: body.tournamentId,
      team1Id: body.team1Id,
      team2Id: body.team2Id,
      venueId: body.venueId,
      scheduledAt: new Date(body.scheduledAt),
      stage,
      round: body.round,
      groupId: body.groupId
    }
  });
  const match = await prisma.match.create({
    data: {
      fixtureId: fixture.id,
      tournamentId: body.tournamentId,
      team1Id: body.team1Id,
      team2Id: body.team2Id,
      venueId: body.venueId,
      scheduledAt: new Date(body.scheduledAt),
      status: "SCHEDULED",
      oversPerInnings: overs,
      maxOversPerBowler: body.maxOversPerBowler ?? tournament?.rules?.maxOversPerBowler ?? 2
    }
  });
  res.json({ fixture, match });
});

api.post("/admin/matches/:id/officials", admin, async (req, res) => {
  const body = z.object({ userId: z.string(), role: z.string().optional() }).parse(req.body);
  const match = await loadMatch(req.params.id);
  if (!match) return res.status(404).json({ error: "Match not found" });
  const row = await prisma.matchOfficial.upsert({
    where: { matchId_userId: { matchId: match.id, userId: body.userId } },
    update: { role: body.role ?? "UMPIRE" },
    create: { matchId: match.id, userId: body.userId, role: body.role ?? "UMPIRE" }
  });
  res.json(row);
});

api.get("/admin/users", admin, async (_req, res) => {
  const users = await prisma.user.findMany({ select: { id: true, email: true, name: true, role: true } });
  res.json(users);
});

api.post("/admin/users", admin, async (req, res) => {
  const body = z
    .object({
      email: z.string().email(),
      password: z.string().min(6),
      name: z.string(),
      role: z.enum(["ADMIN", "UMPIRE"])
    })
    .parse(req.body);
  const passwordHash = await bcrypt.hash(body.password, 10);
  const user = await prisma.user.create({
    data: { email: body.email.toLowerCase(), passwordHash, name: body.name, role: body.role }
  });
  res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
});

api.delete("/admin/users/:id", admin, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) return res.status(404).json({ error: "Not found" });
  if (user.role !== "UMPIRE") return res.status(400).json({ error: "Only umpire accounts can be deleted here" });
  try {
    await prisma.user.delete({ where: { id: user.id } });
    res.json({ ok: true });
  } catch {
    res.status(409).json({ error: "Cannot delete this umpire because they have match scoring history" });
  }
});

function gallerySrc(row: { id: string; imageUrl: string | null; imageData: Buffer | null }) {
  if (row.imageUrl) return row.imageUrl;
  if (row.imageData) return `/api/gallery/${row.id}/image`;
  return null;
}

api.get("/gallery", async (_req, res) => {
  const rows = await prisma.galleryImage.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }] });
  res.json(
    rows.map((r) => ({
      id: r.id,
      title: r.title,
      category: r.category,
      sortOrder: r.sortOrder,
      src: gallerySrc(r)
    }))
  );
});

api.get("/gallery/:id/image", async (req, res) => {
  const row = await prisma.galleryImage.findUnique({ where: { id: req.params.id } });
  if (!row?.imageData) return res.status(404).end();
  res.setHeader("Content-Type", row.mimeType || "image/jpeg");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(Buffer.from(row.imageData));
});

api.post("/admin/gallery", admin, async (req, res) => {
  const body = z
    .object({
      title: z.string().min(1),
      category: z.enum(["SQUAD", "TEAM"]),
      imageUrl: z.string().url().optional(),
      imageBase64: z.string().optional(),
      mimeType: z.string().optional(),
      sortOrder: z.number().int().optional()
    })
    .parse(req.body);
  if (!body.imageUrl && !body.imageBase64) {
    return res.status(400).json({ error: "Add a photo file or an image URL" });
  }
  let imageData: Buffer | undefined;
  let mimeType = body.mimeType ?? null;
  if (body.imageBase64) {
    const raw = body.imageBase64.includes(",") ? body.imageBase64.split(",")[1] : body.imageBase64;
    imageData = Buffer.from(raw, "base64");
    if (imageData.length > 2_500_000) return res.status(400).json({ error: "Photo must be under 2.5 MB" });
    const meta = body.imageBase64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
    if (meta) mimeType = meta[1];
  }
  const max = await prisma.galleryImage.aggregate({ _max: { sortOrder: true } });
  const row = await prisma.galleryImage.create({
    data: {
      title: body.title,
      category: body.category,
      imageUrl: body.imageUrl,
      imageData,
      mimeType,
      sortOrder: body.sortOrder ?? (max._max.sortOrder ?? 0) + 1
    }
  });
  res.json({ id: row.id, title: row.title, category: row.category, src: gallerySrc(row) });
});

api.delete("/admin/gallery/:id", admin, async (req, res) => {
  await prisma.galleryImage.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});
