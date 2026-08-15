import {
  BatterCard,
  BatsmanInnings,
  BowlerCard,
  BowlerInnings,
  DeliveryRecord,
  economy,
  formatOvers,
  isSuperOverInnings,
  LiveSnapshot,
  MatchState,
  PlayerRef,
  strikeRate,
  WicketRecord
} from "./types.js";
import { nextSuperOverSetup, publicResultSummary } from "./engine.js";

function playerName(players: Record<string, PlayerRef>, id: string): string {
  return players[id]?.name ?? id;
}

function oversString(legalBalls: number, ballsPerOver: number): string {
  return formatOvers(legalBalls, ballsPerOver);
}

export function batterStatusText(
  b: BatsmanInnings,
  players: Record<string, PlayerRef>,
  bowlerId?: string
): string {
  if (b.statusKind === "BATTING") return "batting";
  if (b.statusKind === "NOT_OUT") return "not out";
  if (b.statusKind === "RETIRED_NOT_OUT") return "Retired — N";
  if (b.statusKind === "RETIRED_HURT") return "retired hurt";
  if (b.statusKind === "YET_TO_BAT") return "";
  const d = b.dismissal;
  if (!d) return "out";
  const bowlerName = d.bowlerCredited && bowlerId ? playerName(players, bowlerId) : undefined;
  switch (d.dismissalType) {
    case "BOWLED":
      return bowlerName ? `b ${bowlerName}` : "bowled";
    case "CAUGHT": {
      const catcher = d.catcherId ? playerName(players, d.catcherId) : undefined;
      if (catcher && bowlerName) return `c ${catcher} b ${bowlerName}`;
      return catcher ? `c ${catcher}` : "caught";
    }
    case "LBW":
      return bowlerName ? `lbw b ${bowlerName}` : "lbw";
    case "RUN_OUT":
      return "run out";
    case "STUMPED":
      return "stumped";
    case "HIT_WICKET":
      return "hit wicket";
    case "RETIRED_OUT":
      return "retired out";
    case "TIMED_OUT":
      return "timed out";
    case "MANKAD":
      return "run out (Mankad)";
    case "OBSTRUCTING_THE_FIELD":
      return "obstructing the field";
    case "HIT_THE_BALL_TWICE":
      return "hit the ball twice";
    default:
      return "out";
  }
}

function wicketBowlerId(d: WicketRecord | undefined, deliveries: DeliveryRecord[]): string | undefined {
  if (!d?.bowlerCredited) return undefined;
  const hit = deliveries.find((x) => x.wicket && x.wicket.dismissedPlayerId === d.dismissedPlayerId && x.isWicket);
  return hit?.bowlerId;
}

export function toBatterCard(
  b: BatsmanInnings,
  players: Record<string, PlayerRef>,
  opts: { isStriker?: boolean; isNonStriker?: boolean; bowlerId?: string }
): BatterCard {
  return {
    playerId: b.playerId,
    name: playerName(players, b.playerId),
    runs: b.runs,
    balls: b.balls,
    fours: b.fours,
    sixes: b.sixes,
    strikeRate: strikeRate(b.runs, b.balls),
    status: batterStatusText(b, players, opts.bowlerId),
    isStriker: Boolean(opts.isStriker),
    isNonStriker: Boolean(opts.isNonStriker)
  };
}

export function toBowlerCard(b: BowlerInnings, players: Record<string, PlayerRef>, ballsPerOver: number): BowlerCard {
  return {
    playerId: b.playerId,
    name: playerName(players, b.playerId),
    overs: oversString(b.legalBalls, ballsPerOver),
    maidens: b.maidens,
    runs: b.runsConceded,
    wickets: b.wickets,
    economy: economy(b.runsConceded, b.legalBalls, ballsPerOver),
    wides: b.wides,
    noBalls: b.noBalls
  };
}

function inningsScore(state: MatchState, teamId: string): string {
  const inns = state.innings.filter((i) => i.battingTeamId === teamId);
  if (inns.length === 0) return "—";
  return inns
    .map((i) => {
      const ov = oversString(i.legalBalls, state.config.rules.ballsPerOver);
      const so = isSuperOverInnings(i) ? `SO${i.superOverNumber ?? ""} ` : "";
      return `${so}${i.totalRuns}/${i.wickets} (${ov})`;
    })
    .join(" & ");
}

export function buildSnapshot(state: MatchState): LiveSnapshot {
  const players = state.config.players;
  const bp = state.config.rules.ballsPerOver;
  const live = state.innings[state.innings.length - 1];
  const battingTeam =
    live?.battingTeamId === state.config.team1.id ? state.config.team1 : live ? state.config.team2 : state.config.team1;
  const bowlingTeam =
    live?.bowlingTeamId === state.config.team1.id ? state.config.team1 : live ? state.config.team2 : state.config.team2;

  const maxLegal = (live && isSuperOverInnings(live) ? 1 : state.config.rules.oversPerInnings) * bp;
  const ballsRemaining = live ? Math.max(0, maxLegal - live.legalBalls) : null;
  const runsNeeded = live && state.target != null ? Math.max(0, state.target - live.totalRuns) : null;
  const requiredRunRate =
    runsNeeded != null && ballsRemaining != null && ballsRemaining > 0
      ? Math.round((runsNeeded / (ballsRemaining / bp)) * 100) / 100
      : null;
  const runRate = live && live.legalBalls > 0 ? Math.round((live.totalRuns / (live.legalBalls / bp)) * 100) / 100 : 0;

  const currentBatsmen: BatterCard[] = [];
  if (live?.current.strikerId && live.batsmen[live.current.strikerId]) {
    currentBatsmen.push(
      toBatterCard(live.batsmen[live.current.strikerId], players, { isStriker: true })
    );
  }
  if (live?.current.nonStrikerId && live.batsmen[live.current.nonStrikerId]) {
    currentBatsmen.push(
      toBatterCard(live.batsmen[live.current.nonStrikerId], players, { isNonStriker: true })
    );
  }

  const currentBowler =
    live?.current.bowlerId && live.bowlers[live.current.bowlerId]
      ? toBowlerCard(live.bowlers[live.current.bowlerId], players, bp)
      : null;

  const lastSix = live
    ? live.deliveries.filter((d) => !d.undone && !d.isInjuryRetirement).slice(-6)
    : [];

  return {
    matchId: state.config.matchId,
    status: state.status,
    battingTeamId: live?.battingTeamId ?? null,
    bowlingTeamId: live?.bowlingTeamId ?? null,
    battingTeamName: battingTeam.name,
    bowlingTeamName: bowlingTeam.name,
    team1: {
      id: state.config.team1.id,
      name: state.config.team1.name,
      shortName: state.config.team1.shortName,
      score: inningsScore(state, state.config.team1.id)
    },
    team2: {
      id: state.config.team2.id,
      name: state.config.team2.name,
      shortName: state.config.team2.shortName,
      score: inningsScore(state, state.config.team2.id)
    },
    runs: live?.totalRuns ?? 0,
    wickets: live?.wickets ?? 0,
    overs: live ? oversString(live.legalBalls, bp) : "0.0",
    legalBalls: live?.legalBalls ?? 0,
    runRate,
    target: state.target,
    requiredRunRate,
    runsNeeded,
    ballsRemaining,
    currentBatsmen,
    currentBowler,
    partnership: live?.partnerships.find((p) => p.active) ?? null,
    lastSixBalls: lastSix,
    extras: live?.extras ?? { wides: 0, noBalls: 0, byes: 0, legByes: 0, penalties: 0, total: 0 },
    isFreeHit: live?.current.isFreeHit ?? false,
    pendingReplacement: live?.pendingReplacement ?? null,
    pendingBowlerChange: live?.current.pendingBowlerChange ?? false,
    inningsComplete: live?.isComplete ?? false,
    resultSummary: publicResultSummary(state),
    winnerTeamId: state.winnerTeamId,
    isSuperOver: Boolean(live && isSuperOverInnings(live)),
    pendingSuperOver: nextSuperOverSetup(state),
    scorecard: {
      innings: state.innings.map((inn) => {
        const battingOrder = inn.playingXI.map((id) => inn.batsmen[id]).filter(Boolean);
        const yetToBat = battingOrder.filter((b) => b.statusKind === "YET_TO_BAT").map((b) => playerName(players, b.playerId));
        const bowling = Object.values(inn.bowlers)
          .filter((b) => b.legalBalls > 0 || b.wides > 0 || b.noBalls > 0)
          .map((b) => toBowlerCard(b, players, bp));
        const fow: string[] = [];
        let wk = 0;
        for (const d of inn.deliveries) {
          if (d.isWicket && d.wicket) {
            wk += 1;
            fow.push(`${inn.deliveries.reduce((sum, x) => (x === d ? sum + d.totalRuns : x.timestamp <= d.timestamp ? sum + (inn.deliveries.includes(x) ? 0 : 0) : sum), 0)}`);
          }
        }
        let running = 0;
        const fall: string[] = [];
        for (const d of inn.deliveries.filter((x) => !x.undone)) {
          running += d.totalRuns;
          if (d.isWicket && d.wicket) {
            fall.push(`${running}/${inn.dismissedIds.indexOf(d.wicket.dismissedPlayerId) + 1} (${playerName(players, d.wicket.dismissedPlayerId)})`);
          }
        }
        return {
          inningsNumber: inn.inningsNumber,
          kind: inn.kind ?? "REGULAR",
          superOverNumber: inn.superOverNumber,
          superOverLeg: inn.superOverLeg,
          battingTeamId: inn.battingTeamId,
          battingTeamName: inn.battingTeamId === state.config.team1.id ? state.config.team1.name : state.config.team2.name,
          total: inn.totalRuns,
          wickets: inn.wickets,
          overs: oversString(inn.legalBalls, bp),
          extras: inn.extras,
          batting: battingOrder.map((b) =>
            toBatterCard(b, players, {
              isStriker: inn.current.strikerId === b.playerId,
              isNonStriker: inn.current.nonStrikerId === b.playerId,
              bowlerId: wicketBowlerId(b.dismissal, inn.deliveries)
            })
          ),
          bowling,
          yetToBat,
          fallOfWickets: fall
        };
      })
    },
    ballByBall: state.innings.flatMap((inn) =>
      inn.deliveries
        .filter((d) => !d.undone)
        .map((d) => ({
          inningsNumber: inn.inningsNumber,
          kind: inn.kind ?? "REGULAR",
          superOverNumber: inn.superOverNumber,
          battingTeamName:
            inn.battingTeamId === state.config.team1.id ? state.config.team1.name : state.config.team2.name,
          overNumber: d.overNumber,
          commentary: d.commentary,
          isHomeRun: d.isHomeRun,
          isWicket: d.isWicket,
          eventId: d.eventId
        }))
    )
  };
}

export function inningsOf(state: MatchState, n = 0) {
  return state.innings[n] ?? state.innings[state.innings.length - 1];
}
