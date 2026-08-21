import { describe, expect, it } from "vitest";
import {
  applyDelivery,
  awardWalkover,
  buildSnapshot,
  completeMatchChecklist,
  confirmPlayingXI,
  createMatch,
  createReadyInnings,
  currentInnings,
  DEFAULT_TOURNAMENT_RULES,
  formatNrr,
  inningsAllOut,
  MatchState,
  netRunRate,
  nrrBallsCredited,
  oversForFixture,
  ScoringInput,
  selectReplacementBatter,
  startSecondInnings,
  startSuperOverInnings,
  undoLastDelivery
} from "./index.js";

let seq = 0;
function eid(): string {
  seq += 1;
  return `e${seq}`;
}

function inn(state: MatchState) {
  const i = currentInnings(state) ?? state.innings[state.innings.length - 1];
  if (!i) throw new Error("no innings");
  return i;
}

function play(state: MatchState, partial: Partial<ScoringInput> = {}) {
  const i = inn(state);
  const result = applyDelivery(state, {
    eventId: eid(),
    strikerId: partial.strikerId ?? i.current.strikerId ?? "b1",
    nonStrikerId: partial.nonStrikerId ?? i.current.nonStrikerId ?? "b2",
    bowlerId: partial.bowlerId ?? i.current.bowlerId ?? "f1",
    batRuns: 0,
    extraType: "NONE",
    scoredByUserId: "ump",
    overrideConstraints: true,
    ...partial
  });
  return result;
}

function must(state: MatchState, partial: Partial<ScoringInput> = {}): MatchState {
  const result = play(state, partial);
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.state;
}

describe("Wolfpack TapeBall scoring engine", () => {
  it("dot ball → +1 legal ball, no runs", () => {
    let s = createReadyInnings({ overs: 8 });
    const r = play(s, { batRuns: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    const i = inn(s);
    expect(i.totalRuns).toBe(0);
    expect(i.legalBalls).toBe(1);
    expect(i.current.legalBallsInOver).toBe(1);
    expect(r.delivery?.isLegal).toBe(true);
    expect(i.batsmen.b1.runs).toBe(0);
    expect(i.batsmen.b1.balls).toBe(1);
  });

  it("1/2/3 runs → totals, strike rotation, legal ball", () => {
    let s = createReadyInnings({});
    s = must(s, { batRuns: 1 });
    expect(inn(s).totalRuns).toBe(1);
    expect(inn(s).batsmen.b1.runs).toBe(1);
    expect(inn(s).current.strikerId).toBe("b2");
    expect(inn(s).current.nonStrikerId).toBe("b1");
    expect(inn(s).legalBalls).toBe(1);

    s = must(s, { batRuns: 2 });
    expect(inn(s).totalRuns).toBe(3);
    expect(inn(s).batsmen.b2.runs).toBe(2);
    expect(inn(s).current.strikerId).toBe("b2");

    s = must(s, { batRuns: 3 });
    expect(inn(s).totalRuns).toBe(6);
    expect(inn(s).batsmen.b2.runs).toBe(5);
    expect(inn(s).current.strikerId).toBe("b1");
    expect(inn(s).legalBalls).toBe(3);
  });

  it("four/six → totals, boundary flag, legal ball", () => {
    let s = createReadyInnings({});
    const four = play(s, { batRuns: 4 });
    expect(four.ok).toBe(true);
    if (!four.ok) return;
    expect(four.delivery?.isBoundary).toBe(true);
    expect(four.delivery?.isLegal).toBe(true);
    s = four.state;
    expect(inn(s).totalRuns).toBe(4);
    expect(inn(s).batsmen.b1.fours).toBe(1);

    const six = play(s, { batRuns: 6 });
    expect(six.ok).toBe(true);
    if (!six.ok) return;
    expect(six.delivery?.isBoundary).toBe(true);
    s = six.state;
    expect(inn(s).totalRuns).toBe(10);
    expect(inn(s).batsmen.b1.sixes).toBe(1);
    expect(inn(s).batsmen.b1.runs).toBe(10);
  });

  it("first wide in an over → +1 team, extra, not legal, counter = 1", () => {
    let s = createReadyInnings({});
    const r = play(s, { extraType: "WIDE" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(inn(s).totalRuns).toBe(1);
    expect(inn(s).extras.wides).toBe(1);
    expect(inn(s).legalBalls).toBe(0);
    expect(inn(s).current.legalBallsInOver).toBe(0);
    expect(inn(s).current.illegalBallCountThisOver).toBe(1);
    expect(r.delivery?.isLegal).toBe(false);
    expect(inn(s).batsmen.b1.runs).toBe(1);
  });

  it("second wide in same over → +4 team, extra, is legal, over advances", () => {
    let s = createReadyInnings({});
    s = must(s, { extraType: "WIDE" });
    const r = play(s, { extraType: "WIDE" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(inn(s).totalRuns).toBe(5);
    expect(inn(s).extras.wides).toBe(5);
    expect(r.delivery?.isLegal).toBe(true);
    expect(inn(s).legalBalls).toBe(1);
    expect(inn(s).current.legalBallsInOver).toBe(1);
    expect(inn(s).current.illegalBallCountThisOver).toBe(2);
    expect(inn(s).batsmen.b1.runs).toBe(5);
  });

  it("wide/illegal counter resets to 0 at the start of each new over", () => {
    let s = createReadyInnings({});
    s = must(s, { extraType: "WIDE" });
    expect(inn(s).current.illegalBallCountThisOver).toBe(1);
    for (let i = 0; i < 6; i++) s = must(s, { batRuns: 0 });
    expect(inn(s).current.overNumber).toBe(1);
    expect(inn(s).current.illegalBallCountThisOver).toBe(0);
    expect(inn(s).current.legalBallsInOver).toBe(0);
    const r = play(s, { extraType: "WIDE", bowlerId: "f2" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.delivery?.wideRuns).toBe(1);
    expect(r.delivery?.isLegal).toBe(false);
    expect(inn(r.state).current.illegalBallCountThisOver).toBe(1);
  });

  it("no-ball + six → team +7, batsman +7 (six + no-ball extra), not legal", () => {
    let s = createReadyInnings({});
    const r = play(s, { extraType: "NO_BALL", batRuns: 6 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(inn(s).totalRuns).toBe(7);
    expect(inn(s).batsmen.b1.runs).toBe(7);
    expect(inn(s).extras.noBalls).toBe(1);
    expect(r.delivery?.isLegal).toBe(false);
    expect(inn(s).legalBalls).toBe(0);
  });

  it("final legal ball six → batsman +12, team +12, is_home_run, innings ends", () => {
    let s = createReadyInnings({ overs: 1 });
    for (let i = 0; i < 5; i++) s = must(s, { batRuns: 0 });
    const r = play(s, { batRuns: 6 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.delivery?.isHomeRun).toBe(true);
    expect(r.delivery?.totalRuns).toBe(12);
    s = r.state;
    expect(inn(s).batsmen.b1.runs).toBe(12);
    expect(inn(s).totalRuns).toBe(12);
    expect(inn(s).isComplete).toBe(true);
    expect(s.status).toBe("INNINGS_BREAK");
  });

  it("final legal ball 4 is not a home run", () => {
    let s = createReadyInnings({ overs: 1 });
    for (let i = 0; i < 5; i++) s = must(s, { batRuns: 0 });
    const r = play(s, { batRuns: 4 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.delivery?.isHomeRun).toBe(false);
    expect(r.delivery?.totalRuns).toBe(4);
    expect(inn(r.state).batsmen.b1.runs).toBe(4);
    expect(inn(r.state).isComplete).toBe(true);
  });

  it("wide (or no-ball) on the apparent final ball → innings does not end, no Home Run", () => {
    let s = createReadyInnings({ overs: 1 });
    for (let i = 0; i < 5; i++) s = must(s, { batRuns: 0 });
    const wide = play(s, { extraType: "WIDE" });
    expect(wide.ok).toBe(true);
    if (!wide.ok) return;
    expect(wide.delivery?.isHomeRun).toBe(false);
    expect(inn(wide.state).isComplete).toBe(false);
    expect(inn(wide.state).legalBalls).toBe(5);

    let s2 = createReadyInnings({ overs: 1 });
    for (let i = 0; i < 5; i++) s2 = must(s2, { batRuns: 0 });
    const nb = play(s2, { extraType: "NO_BALL", batRuns: 6 });
    expect(nb.ok).toBe(true);
    if (!nb.ok) return;
    expect(nb.delivery?.isHomeRun).toBe(false);
    expect(inn(nb.state).isComplete).toBe(false);
    expect(inn(nb.state).legalBalls).toBe(5);
    expect(inn(nb.state).batsmen.b1.runs).toBe(7);
  });

  it("last over wide/no-ball is always +1, never legal, plus runs scored", () => {
    let s = createReadyInnings({ overs: 1 });
    s = must(s, { extraType: "WIDE" });
    const w2 = play(s, { extraType: "WIDE", batRuns: 2 });
    expect(w2.ok).toBe(true);
    if (!w2.ok) return;
    expect(w2.delivery?.isLegal).toBe(false);
    expect(w2.delivery?.wideRuns).toBe(3);
    expect(inn(w2.state).legalBalls).toBe(0);
    expect(inn(w2.state).totalRuns).toBe(4);
    expect(inn(w2.state).isComplete).toBe(false);

    let s2 = createReadyInnings({ overs: 1 });
    s2 = must(s2, { extraType: "NO_BALL", batRuns: 0 });
    const nb2 = play(s2, { extraType: "NO_BALL", batRuns: 4 });
    expect(nb2.ok).toBe(true);
    if (!nb2.ok) return;
    expect(nb2.delivery?.isLegal).toBe(false);
    expect(nb2.delivery?.noBallRuns).toBe(1);
    expect(inn(nb2.state).batsmen.b1.runs).toBe(6);
    expect(inn(nb2.state).totalRuns).toBe(6);
    expect(inn(nb2.state).legalBalls).toBe(0);
  });

  it("bye or leg-bye on the final legal ball is not a home run, and the innings can end", () => {
    let s = createReadyInnings({ overs: 1 });
    for (let i = 0; i < 5; i++) s = must(s, { batRuns: 0 });
    const bye = play(s, { extraType: "BYE", byeRuns: 4, batRuns: 4 });
    expect(bye.ok).toBe(true);
    if (!bye.ok) return;
    expect(bye.delivery?.isHomeRun).toBe(false);
    expect(bye.delivery?.isLegal).toBe(true);
    expect(inn(bye.state).batsmen.b1.runs).toBe(0);
    expect(inn(bye.state).totalRuns).toBe(4);
    expect(inn(bye.state).isComplete).toBe(true);

    let s2 = createReadyInnings({ overs: 1 });
    for (let i = 0; i < 5; i++) s2 = must(s2, { batRuns: 0 });
    const lb = play(s2, { extraType: "LEG_BYE", legByeRuns: 2, batRuns: 2 });
    expect(lb.ok).toBe(true);
    if (!lb.ok) return;
    expect(lb.delivery?.isHomeRun).toBe(false);
    expect(inn(lb.state).batsmen.b1.runs).toBe(0);
    expect(inn(lb.state).isComplete).toBe(true);
  });

  it("last over ignores +2/+4 extras: every wide/no-ball is +1 and not legal", () => {
    let s = createReadyInnings({ overs: 6 });
    s.config.rules.firstIllegalPenalty = 2;
    s.config.rules.escalatedIllegalPenalty = 4;
    for (let i = 0; i < 30; i++) s = must(s, { batRuns: 0 });
    const w1 = play(s, { extraType: "WIDE" });
    expect(w1.ok).toBe(true);
    if (!w1.ok) return;
    expect(w1.delivery?.wideRuns).toBe(1);
    expect(w1.delivery?.isLegal).toBe(false);
    const w2 = play(w1.state, { extraType: "WIDE", batRuns: 2 });
    expect(w2.ok).toBe(true);
    if (!w2.ok) return;
    expect(w2.delivery?.wideRuns).toBe(3);
    expect(w2.delivery?.isLegal).toBe(false);
    expect(inn(w2.state).legalBalls).toBe(30);
    expect(inn(w2.state).isComplete).toBe(false);

    const nb1 = play(w2.state, { extraType: "NO_BALL", batRuns: 4 });
    expect(nb1.ok).toBe(true);
    if (!nb1.ok) return;
    expect(nb1.delivery?.noBallRuns).toBe(1);
    expect(nb1.delivery?.isLegal).toBe(false);
    expect(nb1.delivery?.batRuns).toBe(4);
    expect(inn(nb1.state).totalRuns).toBe(9);
    expect(inn(nb1.state).legalBalls).toBe(30);
  });

  it("before the last over, first wide is tournament extras and the next is +4 and legal", () => {
    let s = createReadyInnings({ overs: 6 });
    s.config.rules.firstIllegalPenalty = 2;
    s.config.rules.escalatedIllegalPenalty = 4;
    const w1 = play(s, { extraType: "WIDE" });
    expect(w1.ok).toBe(true);
    if (!w1.ok) return;
    expect(w1.delivery?.wideRuns).toBe(2);
    expect(w1.delivery?.isLegal).toBe(false);
    const w2 = play(w1.state, { extraType: "WIDE" });
    expect(w2.ok).toBe(true);
    if (!w2.ok) return;
    expect(w2.delivery?.wideRuns).toBe(4);
    expect(w2.delivery?.isLegal).toBe(true);
  });

  it("last over of a longer innings still treats every wide/no-ball as +1 and not legal", () => {
    let s = createReadyInnings({ overs: 8 });
    for (let i = 0; i < 42; i++) s = must(s, { batRuns: 0 });
    expect(inn(s).current.overNumber).toBe(7);
    s = must(s, { extraType: "WIDE" });
    const w2 = play(s, { extraType: "WIDE", batRuns: 2 });
    expect(w2.ok).toBe(true);
    if (!w2.ok) return;
    expect(w2.delivery?.isLegal).toBe(false);
    expect(w2.delivery?.wideRuns).toBe(3);
    expect(inn(w2.state).legalBalls).toBe(42);
    expect(inn(w2.state).isComplete).toBe(false);
  });

  it("escalated wide/no-ball on the apparent last ball does not end the innings or trigger Home Run", () => {
    let s = createReadyInnings({ overs: 1 });
    for (let i = 0; i < 5; i++) s = must(s, { batRuns: 0 });
    s = must(s, { extraType: "WIDE" });
    const w2 = play(s, { extraType: "WIDE" });
    expect(w2.ok).toBe(true);
    if (!w2.ok) return;
    expect(w2.delivery?.isLegal).toBe(false);
    expect(w2.delivery?.isHomeRun).toBe(false);
    expect(w2.delivery?.wideRuns).toBe(1);
    expect(inn(w2.state).legalBalls).toBe(5);
    expect(inn(w2.state).isComplete).toBe(false);

    const fair = play(w2.state, { batRuns: 6 });
    expect(fair.ok).toBe(true);
    if (!fair.ok) return;
    expect(fair.delivery?.isHomeRun).toBe(true);
    expect(fair.delivery?.totalRuns).toBe(12);
    expect(inn(fair.state).isComplete).toBe(true);
  });

  it("batsman crosses 30 → auto-retired, is_wicket false, status Retired — N", () => {
    let s = createReadyInnings({});
    for (let i = 0; i < 5; i++) {
      s = must(s, { batRuns: 6, strikerId: "b1", nonStrikerId: "b2" });
    }
    expect(inn(s).batsmen.b1.runs).toBe(30);
    expect(inn(s).batsmen.b1.statusKind).toBe("RETIRED_NOT_OUT");
    expect(inn(s).wickets).toBe(0);
    expect(inn(s).pendingReplacement).not.toBeNull();
    const last = inn(s).deliveries.at(-1);
    expect(last?.isWicket).toBe(false);
    expect(last?.isRetirement).toBe(true);
  });

  it("crosses 30 and legally dismissed on same ball → Out, not Retired", () => {
    let s = createReadyInnings({});
    for (let i = 0; i < 4; i++) {
      s = must(s, { batRuns: 6, strikerId: "b1", nonStrikerId: "b2" });
    }
    expect(inn(s).batsmen.b1.runs).toBe(24);
    const r = play(s, {
      batRuns: 6,
      strikerId: "b1",
      nonStrikerId: "b2",
      wicket: { dismissalType: "RUN_OUT", dismissedPlayerId: "b1", runOutFielderId: "f3" }
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(inn(s).batsmen.b1.runs).toBe(30);
    expect(inn(s).batsmen.b1.statusKind).toBe("OUT");
    expect(inn(s).batsmen.b1.dismissal?.dismissalType).toBe("RUN_OUT");
    expect(inn(s).wickets).toBe(1);
    expect(r.delivery?.isRetirement).toBe(false);
    expect(r.delivery?.isWicket).toBe(true);
  });

  it("retired batsman cannot return while eligible batsman available; return requires selection", () => {
    let s = createReadyInnings({
      playersPerSide: 4,
      battingIds: ["b1", "b2", "b3", "b4"],
      bowlingIds: ["f1", "f2", "f3", "f4"]
    });
    for (let i = 0; i < 5; i++) s = must(s, { batRuns: 6, strikerId: "b1", nonStrikerId: "b2" });
    const pending = inn(s).pendingReplacement!;
    expect(pending.fromRetired).toBe(false);
    expect(pending.candidates).toContain("b3");
    expect(pending.candidates).not.toContain("b1");

    const deny = selectReplacementBatter(s, "b1", "ump");
    expect(deny.ok).toBe(false);
    if (deny.ok) return;
    expect(deny.error.code).toBe("REPLACEMENT_NOT_ELIGIBLE");

    const allow = selectReplacementBatter(s, "b3", "ump");
    expect(allow.ok).toBe(true);
    if (!allow.ok) return;
    s = allow.state;
    expect(inn(s).pendingReplacement).toBeNull();
    expect(inn(s).current.strikerId === "b3" || inn(s).current.nonStrikerId === "b3").toBe(true);

    const blocked = play(s, { batRuns: 1 });
    expect(blocked.ok).toBe(true);

    s = must(s, {
      batRuns: 0,
      strikerId: inn(s).current.strikerId === "b3" ? "b3" : inn(s).current.strikerId!,
      nonStrikerId: inn(s).current.nonStrikerId === "b3" ? "b3" : inn(s).current.nonStrikerId!,
      wicket: {
        dismissalType: "BOWLED",
        dismissedPlayerId: "b3"
      }
    });
    const afterWicket = selectReplacementBatter(s, "b4", "ump");
    expect(afterWicket.ok).toBe(true);
    if (!afterWicket.ok) return;
    s = afterWicket.state;
    s = must(s, {
      batRuns: 0,
      wicket: { dismissalType: "BOWLED", dismissedPlayerId: "b4" }
    });
    expect(inn(s).pendingReplacement?.fromRetired).toBe(true);
    expect(inn(s).pendingReplacement?.candidates).toContain("b1");
    const mustSelect = play(s, { batRuns: 1 });
    expect(mustSelect.ok).toBe(false);
    if (mustSelect.ok) return;
    expect(mustSelect.error.code).toBe("PENDING_REPLACEMENT");
  });

  it("second innings: target reached → match ends immediately", () => {
    let s = createReadyInnings({ inningsNumber: 2, firstInningsScore: 5, battingIds: ["b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8", "b9", "b10", "b11"] });
    expect(s.target).toBe(6);
    s = must(s, { batRuns: 6 });
    expect(inn(s).totalRuns).toBe(6);
    expect(inn(s).isComplete).toBe(true);
    expect(s.status).toBe("COMPLETE");
    expect(s.winnerTeamId).toBe("t1");
    const extra = play(s, { batRuns: 1 });
    expect(extra.ok).toBe(false);
  });

  it("undo → every derived statistic reverts to pre-ball state", () => {
    let s = createReadyInnings({});
    s = must(s, { batRuns: 4 });
    const before = structuredClone(s);
    s = must(s, { extraType: "WIDE" });
    s = must(s, { extraType: "NO_BALL", batRuns: 6 });
    expect(inn(s).totalRuns).toBe(4 + 1 + 10);
    const undone = undoLastDelivery(s, "ump");
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    s = undone.state;
    expect(inn(s).totalRuns).toBe(5);
    const undone2 = undoLastDelivery(s, "ump");
    expect(undone2.ok).toBe(true);
    if (!undone2.ok) return;
    s = undone2.state;
    expect(inn(s).totalRuns).toBe(before.innings[0].totalRuns);
    expect(inn(s).batsmen.b1.runs).toBe(before.innings[0].batsmen.b1.runs);
    expect(inn(s).legalBalls).toBe(before.innings[0].legalBalls);
    expect(inn(s).extras).toEqual(before.innings[0].extras);
    expect(inn(s).wickets).toBe(before.innings[0].wickets);
    expect(inn(s).current.strikerId).toBe(before.innings[0].current.strikerId);
    expect(inn(s).bowlers.f1.runsConceded).toBe(before.innings[0].bowlers.f1.runsConceded);
  });

  it("undo then the same event ID cannot add those runs again", () => {
    let s = createReadyInnings({});
    const four = { eventId: "ball-4", batRuns: 4 as const };
    s = must(s, four);
    expect(inn(s).totalRuns).toBe(4);
    const undone = undoLastDelivery(s, "ump");
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    s = undone.state;
    expect(inn(s).totalRuns).toBe(0);
    const again = play(s, four);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.duplicate).toBe(true);
    expect(inn(again.state).totalRuns).toBe(0);
    s = must(again.state, { eventId: "ball-4-retry", batRuns: 4 });
    expect(inn(s).totalRuns).toBe(4);
  });

  it("duplicate event ID is applied only once", () => {
    let s = createReadyInnings({});
    const input = {
      eventId: "same-id",
      batRuns: 4
    };
    s = must(s, input);
    const again = play(s, input);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.duplicate).toBe(true);
    expect(inn(again.state).totalRuns).toBe(4);
    expect(inn(again.state).deliveries.filter((d) => d.eventId === "same-id")).toHaveLength(1);
  });

  it("bye/leg-bye stay off the striker; wide and no-ball extras are added to the striker", () => {
    let s = createReadyInnings({});
    s = must(s, { extraType: "BYE", byeRuns: 4, batRuns: 4 });
    s = must(s, { extraType: "LEG_BYE", legByeRuns: 2, batRuns: 2 });
    s = must(s, { extraType: "WIDE" });
    expect(inn(s).batsmen.b1.runs).toBe(1);
    expect(inn(s).totalRuns).toBe(4 + 2 + 1);
    expect(inn(s).batsmen.b1.statusKind).toBe("BATTING");

    let s2 = createReadyInnings({});
    s2 = must(s2, { extraType: "NO_BALL", batRuns: 0 });
    expect(inn(s2).batsmen.b1.runs).toBe(1);
    expect(inn(s2).extras.noBalls).toBe(1);
    expect(inn(s2).totalRuns).toBe(1);
  });

  it("27 + boundary off no-ball → batsman 32 retired; team +5", () => {
    let s = createReadyInnings({});
    for (let i = 0; i < 4; i++) s = must(s, { batRuns: 6, strikerId: "b1", nonStrikerId: "b2" });
    s = must(s, { batRuns: 3, strikerId: "b1", nonStrikerId: "b2" });
    expect(inn(s).batsmen.b1.runs).toBe(27);
    const r = play(s, { extraType: "NO_BALL", batRuns: 4, strikerId: "b1", nonStrikerId: "b2" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(inn(s).batsmen.b1.runs).toBe(32);
    expect(inn(s).totalRuns).toBe(27 + 5);
    expect(inn(s).batsmen.b1.statusKind).toBe("RETIRED_NOT_OUT");
    expect(inn(s).wickets).toBe(0);
  });

  it("batsman on 29, wide → team +1, batsman 30 and retires", () => {
    let s = createReadyInnings({});
    for (let i = 0; i < 4; i++) s = must(s, { batRuns: 6, strikerId: "b1", nonStrikerId: "b2" });
    s = must(s, { batRuns: 4, strikerId: "b1", nonStrikerId: "b2" });
    s = must(s, { batRuns: 1, strikerId: "b1", nonStrikerId: "b2" });
    expect(inn(s).batsmen.b1.runs).toBe(29);
    const r = play(s, { extraType: "WIDE", strikerId: "b1", nonStrikerId: "b2" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(inn(s).batsmen.b1.runs).toBe(30);
    expect(inn(s).totalRuns).toBe(30);
    expect(inn(s).batsmen.b1.statusKind).toBe("RETIRED_NOT_OUT");
  });

  it("wide then no-ball + six → team +11, batsman +11 (wide 1 + NB extra 4 + six 6), legal, next is Free Hit", () => {
    let s = createReadyInnings({});
    s = must(s, { extraType: "WIDE" });
    const r = play(s, { extraType: "NO_BALL", batRuns: 6 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(inn(s).totalRuns).toBe(11);
    expect(r.delivery?.totalRuns).toBe(10);
    expect(inn(s).batsmen.b1.runs).toBe(11);
    expect(r.delivery?.isLegal).toBe(true);
    expect(inn(s).legalBalls).toBe(1);
    expect(inn(s).current.isFreeHit).toBe(true);
  });

  it("illegal-ball counter is shared across wides and no-balls", () => {
    let s = createReadyInnings({});
    const w1 = play(s, { extraType: "WIDE" });
    expect(w1.ok && w1.delivery?.wideRuns === 1 && w1.delivery?.isLegal === false).toBe(true);
    if (!w1.ok) return;
    s = w1.state;
    const nb = play(s, { extraType: "NO_BALL" });
    expect(nb.ok).toBe(true);
    if (!nb.ok) return;
    expect(nb.delivery?.noBallRuns).toBe(4);
    expect(nb.delivery?.isLegal).toBe(true);
    s = nb.state;
    const w3 = play(s, { extraType: "WIDE" });
    expect(w3.ok).toBe(true);
    if (!w3.ok) return;
    expect(w3.delivery?.wideRuns).toBe(4);
    expect(w3.delivery?.isLegal).toBe(true);
    expect(inn(w3.state).current.illegalBallCountThisOver).toBe(3);
  });

  it("illegal-ball counter resets next over regardless of how previous over ended", () => {
    let s = createReadyInnings({});
    s = must(s, { extraType: "WIDE" });
    s = must(s, { extraType: "NO_BALL" });
    s = must(s, { extraType: "WIDE" });
    while (inn(s).current.overNumber === 0 && !inn(s).isComplete) {
      s = must(s, { batRuns: 0, bowlerId: "f1" });
    }
    expect(inn(s).current.illegalBallCountThisOver).toBe(0);
    const r = play(s, { extraType: "NO_BALL", bowlerId: "f2" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.delivery?.noBallRuns).toBe(1);
    expect(r.delivery?.isLegal).toBe(false);
  });

  it("Free Hit: Bowled rejected; Run Out allowed", () => {
    let s = createReadyInnings({});
    s = must(s, { extraType: "NO_BALL" });
    expect(inn(s).current.isFreeHit).toBe(true);
    const bowled = play(s, {
      batRuns: 0,
      wicket: { dismissalType: "BOWLED", dismissedPlayerId: "b1" }
    });
    expect(bowled.ok).toBe(false);
    if (bowled.ok) return;
    expect(bowled.error.code).toBe("DISALLOWED_ON_FREE_HIT");

    const runOut = play(s, {
      batRuns: 1,
      wicket: { dismissalType: "RUN_OUT", dismissedPlayerId: "b1", runOutFielderId: "f4" }
    });
    expect(runOut.ok).toBe(true);
    if (!runOut.ok) return;
    expect(runOut.delivery?.isWicket).toBe(true);
    expect(inn(runOut.state).wickets).toBe(1);
  });

  it("no-ball on a Free Hit → Free Hit carries over; illegal counter continues", () => {
    let s = createReadyInnings({});
    s = must(s, { extraType: "NO_BALL" });
    expect(inn(s).current.isFreeHit).toBe(true);
    expect(inn(s).current.illegalBallCountThisOver).toBe(1);
    const r = play(s, { extraType: "NO_BALL", batRuns: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(inn(s).current.isFreeHit).toBe(true);
    expect(inn(s).current.illegalBallCountThisOver).toBe(2);
    expect(r.delivery?.noBallRuns).toBe(4);
    expect(r.delivery?.isLegal).toBe(true);
    expect(r.delivery?.isFreeHit).toBe(true);
  });

  it("oversForFixture uses group, knockout, and final lengths", () => {
    const rules = DEFAULT_TOURNAMENT_RULES;
    expect(oversForFixture(rules, "GROUP")).toBe(6);
    expect(oversForFixture(rules, "KNOCKOUT", "Quarter-final")).toBe(8);
    expect(oversForFixture(rules, "KNOCKOUT", "Semi-final")).toBe(8);
    expect(oversForFixture(rules, "KNOCKOUT", "Final")).toBe(10);
  });

  it("awardWalkover simulates a completed match for the chosen winner", () => {
    const battingIds = Array.from({ length: 11 }, (_, i) => `b${i + 1}`);
    const bowlingIds = Array.from({ length: 11 }, (_, i) => `f${i + 1}`);
    const players: Record<string, { id: string; name: string }> = {};
    for (const id of [...battingIds, ...bowlingIds]) players[id] = { id, name: id };
    const xi = confirmPlayingXI(
      createMatch({
        matchId: "wo1",
        rules: { ...DEFAULT_TOURNAMENT_RULES, oversPerInnings: 2, maxOversPerBowler: 1 },
        team1: { id: "t1", name: "Team One", shortName: "T1", playerIds: battingIds },
        team2: { id: "t2", name: "Team Two", shortName: "T2", playerIds: bowlingIds },
        players
      }),
      battingIds,
      bowlingIds,
      "ump"
    );
    expect(xi.ok).toBe(true);
    if (!xi.ok) return;
    const r = awardWalkover(xi.state, "t1", "No show", "ump");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.status).toBe("COMPLETE");
    expect(r.state.resultType).toBe("WALKOVER");
    expect(r.state.winnerTeamId).toBe("t1");
    expect(r.state.innings).toHaveLength(2);
    expect(r.state.innings[0].totalRuns).toBeGreaterThan(r.state.innings[1].totalRuns);
    expect(r.state.resultSummary).toMatch(/walkover/i);
    expect(completeMatchChecklist(r.state).ready).toBe(true);
  });

  it("awardWalkover can be given during a live innings", () => {
    let s = createReadyInnings({ overs: 2 });
    s = must(s, { batRuns: 1 });
    const r = awardWalkover(s, "t2", "Conceded", "ump");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.status).toBe("COMPLETE");
    expect(r.state.resultType).toBe("WALKOVER");
    expect(r.state.winnerTeamId).toBe("t2");
  });

  it("NRR credits a full innings when a side is all out", () => {
    expect(inningsAllOut(10, 11, "ALL_OUT")).toBe(true);
    expect(inningsAllOut(2, 11, "TARGET")).toBe(false);
    expect(nrrBallsCredited(45, 8, 6, true)).toBe(48);
    expect(nrrBallsCredited(45, 8, 6, false)).toBe(45);
    expect(nrrBallsCredited(39, 8, 6, false)).toBe(39);
  });

  it("NRR matches the standard two-match cricket example", () => {
    // Match 1: 300 in 50 ov; opposition 220 all out in 44 → still 50 ov conceded
    // Match 2: concede 240 in 50; chase 244 in 40 → only 40 ov faced
    const bp = 6;
    const ballsFaced = nrrBallsCredited(50 * bp, 50, bp, false) + nrrBallsCredited(40 * bp, 50, bp, false);
    const ballsBowled = nrrBallsCredited(44 * bp, 50, bp, true) + nrrBallsCredited(50 * bp, 50, bp, false);
    expect(ballsFaced).toBe(90 * bp);
    expect(ballsBowled).toBe(100 * bp);
    expect(netRunRate(544, ballsFaced, 460, ballsBowled, bp)).toBe(1.444);
    expect(formatNrr(1.444)).toBe("+1.444");
  });

  it("NRR is (runs/overs faced) minus (runs/overs bowled)", () => {
    // 80 in 8 overs vs 60 in 8 overs → 10.000 − 7.500 = +2.500
    expect(netRunRate(80, 48, 60, 48, 6)).toBe(2.5);
    // All out 40 in 5.2 of 8 → faced 8 overs (48 balls), conceded 80 in 8
    expect(netRunRate(40, 48, 80, 48, 6)).toBe(-5);
    expect(formatNrr(2.5)).toBe("+2.500");
    expect(formatNrr(-0.45)).toBe("-0.450");
    expect(formatNrr(0)).toBe("0.000");
  });

  it("run-out credits completed runs, including on wide and no-ball", () => {
    let s = createReadyInnings({});
    const fair = play(s, {
      batRuns: 2,
      wicket: { dismissalType: "RUN_OUT", dismissedPlayerId: "b1", runOutFielderId: "f3" }
    });
    expect(fair.ok).toBe(true);
    if (!fair.ok) return;
    expect(inn(fair.state).totalRuns).toBe(2);
    expect(inn(fair.state).batsmen.b1.runs).toBe(2);
    expect(inn(fair.state).wickets).toBe(1);
    expect(fair.delivery?.isLegal).toBe(true);

    s = createReadyInnings({});
    const wide = play(s, {
      extraType: "WIDE",
      batRuns: 2,
      wicket: { dismissalType: "RUN_OUT", dismissedPlayerId: "b2", runOutFielderId: "f3" }
    });
    expect(wide.ok).toBe(true);
    if (!wide.ok) return;
    expect(inn(wide.state).totalRuns).toBe(3);
    expect(inn(wide.state).extras.wides).toBe(3);
    expect(inn(wide.state).batsmen.b1.runs).toBe(3);
    expect(inn(wide.state).wickets).toBe(1);
    expect(wide.delivery?.isLegal).toBe(false);

    s = createReadyInnings({});
    const nb = play(s, {
      extraType: "NO_BALL",
      batRuns: 2,
      wicket: { dismissalType: "RUN_OUT", dismissedPlayerId: "b1", runOutFielderId: "f3" }
    });
    expect(nb.ok).toBe(true);
    if (!nb.ok) return;
    expect(inn(nb.state).totalRuns).toBe(3);
    expect(inn(nb.state).batsmen.b1.runs).toBe(3);
    expect(inn(nb.state).wickets).toBe(1);
    expect(nb.delivery?.isLegal).toBe(false);
  });

  it("injured batter can return before the rest have batted", () => {
    let s = createReadyInnings({
      playersPerSide: 4,
      battingIds: ["b1", "b2", "b3", "b4"],
      bowlingIds: ["f1", "f2", "f3", "f4"]
    });
    s = must(s, { injuryRetirement: { playerId: "b1" } });
    expect(inn(s).batsmen.b1.statusKind).toBe("RETIRED_HURT");
    expect(inn(s).wickets).toBe(0);
    expect(inn(s).pendingReplacement?.candidates).toContain("b3");
    expect(inn(s).pendingReplacement?.candidates).toContain("b1");
    const back = selectReplacementBatter(s, "b1", "ump");
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(inn(back.state).batsmen.b1.statusKind).toBe("BATTING");
    expect(inn(back.state).injuredIds).not.toContain("b1");
  });

  it("30-run retirees return FIFO after everyone else is done", () => {
    let s = createReadyInnings({
      playersPerSide: 4,
      battingIds: ["b1", "b2", "b3", "b4"],
      bowlingIds: ["f1", "f2", "f3", "f4"]
    });
    s = must(s, { batRuns: 0, wicket: { dismissalType: "BOWLED", dismissedPlayerId: "b1" } });
    const in3 = selectReplacementBatter(s, "b3", "ump");
    expect(in3.ok).toBe(true);
    if (!in3.ok) return;
    s = in3.state;
    for (let i = 0; i < 5; i++) {
      s = must(s, { batRuns: 6, strikerId: "b3", nonStrikerId: "b2" });
    }
    expect(inn(s).batsmen.b3.statusKind).toBe("RETIRED_NOT_OUT");
    const in4 = selectReplacementBatter(s, "b4", "ump");
    expect(in4.ok).toBe(true);
    if (!in4.ok) return;
    s = in4.state;
    for (let i = 0; i < 5; i++) {
      s = must(s, { batRuns: 6, strikerId: "b2", nonStrikerId: "b4" });
    }
    expect(inn(s).batsmen.b2.statusKind).toBe("RETIRED_NOT_OUT");
    expect(inn(s).pendingReplacement?.fromRetired).toBe(true);
    expect(inn(s).pendingReplacement?.candidates).toEqual(["b3"]);
  });

  it("same bowler cannot start the next over", () => {
    let s = createReadyInnings({ ballsPerOver: 6 });
    for (let i = 0; i < 6; i++) s = must(s, { batRuns: 0, bowlerId: "f1" });
    const r = play(s, { batRuns: 0, bowlerId: "f1", overrideConstraints: false });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("CONSECUTIVE_OVERS");
  });

  it("a tied match goes to Super Over until there is a winner", () => {
    function finishOver(state: MatchState, lastRuns: number): MatchState {
      let s = state;
      const left = 6 - inn(s).legalBalls;
      for (let i = 0; i < left - 1; i++) s = must(s, { batRuns: 0 });
      return must(s, { batRuns: lastRuns });
    }

    let s = createReadyInnings({ overs: 1, tieHandling: "SUPER_OVER" });
    s = finishOver(s, 0);
    expect(s.status).toBe("INNINGS_BREAK");
    s = (startSecondInnings(s, "f1", "f2", "b1", "ump") as { ok: true; state: MatchState }).state;
    s = finishOver(s, 0);
    expect(s.status).toBe("SUPER_OVER");
    expect(s.resultType).toBe("SUPER_OVER_PENDING");

    const so1 = startSuperOverInnings(s, { batterIds: ["f1", "f2", "f3"], strikerId: "f1", nonStrikerId: "f2", bowlerId: "b1" }, "ump");
    expect(so1.ok).toBe(true);
    if (!so1.ok) return;
    s = finishOver(so1.state, 1);
    expect(inn(s).kind).toBe("SUPER_OVER");
    expect(inn(s).isComplete || s.status === "SUPER_OVER").toBe(true);
    expect(s.status).toBe("SUPER_OVER");

    const so2 = startSuperOverInnings(s, { batterIds: ["b1", "b2", "b3"], strikerId: "b1", nonStrikerId: "b2", bowlerId: "f1" }, "ump");
    expect(so2.ok).toBe(true);
    if (!so2.ok) return;
    s = finishOver(so2.state, 0);
    expect(s.status).toBe("COMPLETE");
    expect(s.resultType).toBe("WIN");
    expect(s.winnerTeamId).toBe("t2");
    expect(s.resultSummary).toMatch(/Team One 0\/0/);
    expect(s.resultSummary).toMatch(/Team Two 0\/0/);
    expect(s.resultSummary).toMatch(/Super Over/i);
    const snap = buildSnapshot(s);
    expect(snap.team1.score).toMatch(/0\/0/);
    expect(snap.team2.score).toMatch(/0\/0/);
    expect(snap.scorecard.innings).toHaveLength(4);
    expect(s.innings.filter((i) => i.kind === "SUPER_OVER")).toHaveLength(2);
  });

  it("Super Over six is not a home run, and a tied Super Over is replayed", () => {
    function finishOver(state: MatchState, lastRuns: number): MatchState {
      let s = state;
      const left = 6 - inn(s).legalBalls;
      for (let i = 0; i < left - 1; i++) s = must(s, { batRuns: 0 });
      const r = play(s, { batRuns: lastRuns });
      if (!r.ok) throw new Error(r.error.message);
      return r.state;
    }

    let s = createReadyInnings({ overs: 1, tieHandling: "SUPER_OVER" });
    s = finishOver(s, 0);
    s = (startSecondInnings(s, "f1", "f2", "b1", "ump") as { ok: true; state: MatchState }).state;
    s = finishOver(s, 0);

    s = (startSuperOverInnings(s, { batterIds: ["f1", "f2", "f3"], strikerId: "f1", nonStrikerId: "f2", bowlerId: "b1" }, "ump") as { ok: true; state: MatchState }).state;
    for (let i = 0; i < 5; i++) s = must(s, { batRuns: 0 });
    const six = play(s, { batRuns: 6 });
    expect(six.ok).toBe(true);
    if (!six.ok) return;
    expect(six.delivery?.isHomeRun).toBe(false);
    expect(six.delivery?.totalRuns).toBe(6);
    s = six.state;

    s = (startSuperOverInnings(s, { batterIds: ["b1", "b2", "b3"], strikerId: "b1", nonStrikerId: "b2", bowlerId: "f1" }, "ump") as { ok: true; state: MatchState }).state;
    s = finishOver(s, 6);
    expect(s.status).toBe("SUPER_OVER");
    expect(s.resultType).toBe("SUPER_OVER_PENDING");
    expect(s.resultSummary).toMatch(/tied/i);

    const again = startSuperOverInnings(s, { batterIds: ["f1", "f2", "f3"], strikerId: "f1", nonStrikerId: "f2", bowlerId: "b2" }, "ump");
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(inn(again.state).superOverNumber).toBe(2);
  });
});
