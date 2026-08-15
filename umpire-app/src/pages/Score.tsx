import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  applyDelivery,
  buildSnapshot,
  DismissalType,
  ExtraType,
  FREE_HIT_BLOCKED_DISMISSALS,
  MatchState,
  ScoringInput,
  selectNextBowler,
  selectReplacementBatter,
  startSecondInnings,
  startSuperOverInnings,
  nextSuperOverSetup,
  isLastOverOfInnings,
  isScoringStatus,
  undoLastDelivery
} from "@lms/shared";
import { api } from "../api";
import { enqueue, flushQueue } from "../db";

const DISMISSALS: DismissalType[] = [
  "BOWLED",
  "CAUGHT",
  "LBW",
  "RUN_OUT",
  "STUMPED",
  "HIT_WICKET",
  "RETIRED_OUT",
  "TIMED_OUT",
  "MANKAD",
  "OBSTRUCTING_THE_FIELD"
];

function ballLabel(d: { extraType: string; batRuns: number; isWicket: boolean; isHomeRun: boolean; isInjuryRetirement?: boolean; wideRuns: number; noBallRuns: number }) {
  if (d.isInjuryRetirement) return "Inj";
  if (d.isHomeRun) return "HR";
  if (d.isWicket && d.batRuns) return `${d.batRuns}W`;
  if (d.isWicket) return "W";
  if (d.extraType === "WIDE") return d.batRuns ? `Wd+${d.batRuns}` : "Wd";
  if (d.extraType === "NO_BALL") return `Nb${d.batRuns || ""}`;
  if (d.extraType === "BYE") return "B";
  if (d.extraType === "LEG_BYE") return "Lb";
  return String(d.batRuns);
}

export function Score() {
  const { id } = useParams();
  const [state, setState] = useState<MatchState | null>(null);
  const [payload, setPayload] = useState<any>(null);
  const [extra, setExtra] = useState<ExtraType>("NONE");
  const [wicketOpen, setWicketOpen] = useState(false);
  const [dismissal, setDismissal] = useState<DismissalType>("BOWLED");
  const [dismissed, setDismissed] = useState("");
  const [catcher, setCatcher] = useState("");
  const [completedRuns, setCompletedRuns] = useState(0);
  const [wicketExtra, setWicketExtra] = useState<ExtraType>("NONE");
  const [injuryOpen, setInjuryOpen] = useState(false);
  const [injuredPlayer, setInjuredPlayer] = useState("");
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(!navigator.onLine);
  const [secondOpen, setSecondOpen] = useState(false);
  const [striker2, setStriker2] = useState("");
  const [non2, setNon2] = useState("");
  const [bowl2, setBowl2] = useState("");
  const [soBatters, setSoBatters] = useState<string[]>([]);
  const [soStriker, setSoStriker] = useState("");
  const [soNon, setSoNon] = useState("");
  const [soBowler, setSoBowler] = useState("");
  const [walkoverOpen, setWalkoverOpen] = useState(false);
  const [woWinner, setWoWinner] = useState("");
  const [woReason, setWoReason] = useState("Opponent did not show");
  const [streamUrl, setStreamUrl] = useState("");
  const [streamMsg, setStreamMsg] = useState("");

  async function reload() {
    const row = await api.match(id!);
    setPayload(row);
    setState(row.state);
    setStreamUrl(row.match?.streamUrl ?? "");
  }

  useEffect(() => {
    reload().catch((e) => setError(e.message));
    const on = () => {
      setOffline(false);
      flushQueue(async (ev) => {
        await api.delivery(ev.matchId, ev.body as object);
      }).then(() => reload().catch(() => undefined));
    };
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [id]);

  const snap = useMemo(() => (state ? buildSnapshot(state) : null), [state]);
  const inn = state?.innings[state.innings.length - 1];
  const names = state?.config.players ?? {};
  const name = (pid?: string | null) => (pid ? names[pid]?.name ?? pid : "—");

  async function commit(partial: Partial<ScoringInput>) {
    if (!state || !inn) return;
    setError("");
    const input: ScoringInput = {
      eventId: crypto.randomUUID(),
      strikerId: inn.current.strikerId ?? "",
      nonStrikerId: inn.current.nonStrikerId ?? "",
      bowlerId: inn.current.bowlerId ?? "",
      batRuns: 0,
      extraType: "NONE",
      scoredByUserId: "umpire",
      overrideConstraints: false,
      ...partial
    };
    const local = applyDelivery(state, input);
    if (!local.ok) {
      setError(local.error.message);
      return;
    }
    setState(local.state);
    setExtra("NONE");
    setWicketOpen(false);
    await enqueue({ eventId: input.eventId, matchId: id!, path: "deliveries", body: input });
    try {
      const res = await api.delivery(id!, input);
      if (res.state) setState(res.state);
      setOffline(false);
    } catch (e) {
      setOffline(true);
      if (e instanceof Error && !e.message.includes("fetch")) setError(e.message);
    }
  }

  function tapRun(n: number) {
    if (extra === "WIDE") return commit({ extraType: "WIDE", batRuns: n });
    if (extra === "NO_BALL") return commit({ extraType: "NO_BALL", batRuns: n });
    if (extra === "BYE") return commit({ extraType: "BYE", byeRuns: n || 1, batRuns: n || 1 });
    if (extra === "LEG_BYE") return commit({ extraType: "LEG_BYE", legByeRuns: n || 1, batRuns: n || 1 });
    return commit({ batRuns: n, extraType: "NONE" });
  }

  async function undo() {
    if (!state) return;
    const local = undoLastDelivery(state, "umpire");
    if (local.ok) setState(local.state);
    try {
      const res = await api.undo(id!);
      if (res.state) setState(res.state);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Undo failed");
    }
  }

  if (!state || !snap) return <p className="tiny" style={{ padding: 16 }}>Loading match…</p>;

  const fh = inn?.current.isFreeHit;
  const pendingBat = inn?.pendingReplacement;
  const pendingBowl = inn?.current.pendingBowlerChange;
  const fielders = inn?.bowlingXI ?? [];
  const soPending = nextSuperOverSetup(state);
  const bp = state.config.rules.ballsPerOver;
  const lastOver = Boolean(inn) && isLastOverOfInnings(inn!, state.config.rules);
  const lastBallComing =
    Boolean(inn) &&
    inn?.kind !== "SUPER_OVER" &&
    !inn?.isComplete &&
    inn!.legalBalls === state.config.rules.oversPerInnings * bp - 1;

  return (
    <div>
      <div className="topbar" style={{ position: "relative", paddingTop: 0 }}>
        <Link to="/" className="tiny">
          ← Matches
        </Link>
        <div style={{ display: "flex", gap: 6 }}>
          {offline && <span className="pill off">Offline</span>}
          {fh && <span className="pill fh">Free Hit</span>}
          {isScoringStatus(state.status) && <span className="pill live">Live</span>}
        </div>
      </div>

      {fh && (
        <div className="card" style={{ margin: "0 12px 10px", background: "linear-gradient(90deg,#163, #1a3a32)" }}>
          <strong>FREE HIT</strong>
          <p className="tiny">Bowled, caught, LBW, stumped and hit-wicket are disabled.</p>
        </div>
      )}

      <div className="score-hero">
        <div className="teams">
          {snap.battingTeamName} vs {snap.bowlingTeamName}
        </div>
        <div className="big num">
          {snap.runs}/{snap.wickets}
        </div>
        <div className="meta">
          <span>{snap.overs} ov</span>
          <span>RR {snap.runRate}</span>
          {snap.target != null && <span>Target {snap.target}</span>}
          {snap.requiredRunRate != null && <span>RRR {snap.requiredRunRate}</span>}
        </div>
      </div>

      <div className="card" style={{ margin: "0 12px 10px" }}>
        {snap.currentBatsmen.map((b) => (
          <div key={b.playerId} className={`batter-row ${b.isStriker ? "on" : ""}`}>
            <span>
              {b.isStriker ? "★ " : ""}
              {b.name}
            </span>
            <span className="num">
              {b.runs} ({b.balls})
            </span>
          </div>
        ))}
        {snap.currentBowler && (
          <div className="bowl-row">
            <span>{snap.currentBowler.name}</span>
            <span className="num">
              {snap.currentBowler.overs}-{snap.currentBowler.runs}-{snap.currentBowler.wickets}
            </span>
          </div>
        )}
        <div className="balls">
          {snap.lastSixBalls.map((d) => (
            <div
              key={d.eventId}
              className={`ball ${d.isHomeRun ? "hr" : d.isWicket ? "w" : d.batRuns === 4 ? "four" : d.batRuns === 6 ? "six" : d.extraType === "WIDE" ? "wd" : d.extraType === "NO_BALL" ? "nb" : ""}`}
            >
              {ballLabel(d)}
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ margin: "0 12px 10px" }}>
        <strong>YouTube stream</strong>
        <p className="tiny">Paste a YouTube link any time. The public match page shows it live.</p>
        <input
          className="input"
          style={{ marginTop: 8 }}
          placeholder="https://youtube.com/watch?v=…"
          value={streamUrl}
          onChange={(e) => setStreamUrl(e.target.value)}
        />
        <div className="row-actions" style={{ marginTop: 8 }}>
          <button
            className="btn lime"
            onClick={async () => {
              try {
                await api.stream(id!, streamUrl);
                setStreamMsg(streamUrl.trim() ? "Stream is live on the public page" : "Stream removed");
              } catch (e) {
                setError(e instanceof Error ? e.message : "Could not save stream");
              }
            }}
          >
            Save stream
          </button>
          <button
            className="btn ghost"
            onClick={async () => {
              setStreamUrl("");
              try {
                await api.stream(id!, "");
                setStreamMsg("Stream removed");
              } catch (e) {
                setError(e instanceof Error ? e.message : "Could not clear stream");
              }
            }}
          >
            Clear
          </button>
        </div>
        {streamMsg && <p className="tiny" style={{ marginTop: 6 }}>{streamMsg}</p>}
      </div>

      {error && <p className="error">{error}</p>}

      {state.status === "SUPER_OVER" && (
        <div className="card" style={{ margin: "0 12px 10px" }}>
          <strong>{inn && !inn.isComplete ? `Super Over ${inn.superOverNumber ?? ""}` : "Super Over"}</strong>
          <p className="tiny">
            {inn && !inn.isComplete
              ? "No home run. Two wickets ends the innings. One over only."
              : state.resultSummary}
          </p>
        </div>
      )}

      {state.status === "INNINGS_BREAK" && (
        <div className="pad">
          <button className="btn lime" style={{ width: "100%" }} onClick={() => setSecondOpen(true)}>
            Start 2nd innings (target {state.target})
          </button>
        </div>
      )}

      {isScoringStatus(state.status) && !inn?.isComplete && (
        <div className="pad">
          <div className="grid">
            {[0, 1, 2, 3, 4, 6].map((n) => (
              <button key={n} className={`btn ${n === 4 || n === 6 ? "lime" : ""}`} onClick={() => tapRun(n)}>
                {n}
              </button>
            ))}
          </div>
          <div className="extras">
            {(["WIDE", "NO_BALL", "BYE", "LEG_BYE"] as ExtraType[]).map((t) => (
              <button key={t} className={`btn ghost ${extra === t ? "on" : ""}`} onClick={() => setExtra(extra === t ? "NONE" : t)}>
                {t === "NO_BALL" ? "No Ball" : t === "LEG_BYE" ? "Leg Bye" : t[0] + t.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
          <div className="row-actions">
            <button className="btn hot" onClick={() => {
              setDismissal("BOWLED");
              setDismissed(inn?.current.strikerId ?? "");
              setCompletedRuns(0);
              setWicketExtra(extra === "WIDE" ? "NONE" : extra);
              setWicketOpen(true);
            }}>
              Wicket
            </button>
            <button className="btn ghost" onClick={() => {
              setInjuredPlayer(inn?.current.strikerId ?? "");
              setInjuryOpen(true);
            }}>
              Injured
            </button>
            <button className="btn ghost" onClick={undo}>
              Undo last
            </button>
          </div>
          <p className="tiny" style={{ marginTop: 8 }}>
            {lastBallComing
              ? "Last legal ball: a fair six is a Home Run (12). Wide/no-ball is +1 plus runs, not legal, innings continues."
              : lastOver
                ? "Last over: wide/no-ball is always +1 plus runs scored, and never a legal ball. Tap extra, then 0–6."
                : extra !== "NONE"
                  ? `Modifier: ${extra.replace("_", " ")} — tap runs to confirm (0 = extras only)`
                  : "Wide and no-ball share the same extras: tap extra, then runs (0 = extras only). Bye / leg-bye: tap modifier then runs."}
          </p>
        </div>
      )}

      {soPending && (
        <div className="pad">
          <div className="card">
            <h3>Start Super Over {soPending.superOverNumber}{soPending.leg === 2 ? " chase" : ""}</h3>
            <p className="tiny">
              {(soPending.battingTeamId === state.config.team1.id ? state.config.team1.name : state.config.team2.name)} batting.
              Nominate 3 batters and 1 bowler. No home run.
            </p>
            <p className="tiny" style={{ marginTop: 8 }}>Batters (pick 3)</p>
            {(soPending.battingTeamId === state.config.team1.id ? state.playingXI?.team1 ?? [] : state.playingXI?.team2 ?? []).map((pid) => {
              const on = soBatters.includes(pid);
              return (
                <button
                  key={pid}
                  className={`choice ${on ? "on" : ""}`}
                  onClick={() => {
                    setSoBatters((cur) => {
                      if (cur.includes(pid)) return cur.filter((id) => id !== pid);
                      if (cur.length >= 3) return cur;
                      return [...cur, pid];
                    });
                  }}
                >
                  {on ? "✓ " : ""}{name(pid)}
                </button>
              );
            })}
            <select className="input" value={soStriker} onChange={(e) => setSoStriker(e.target.value)} style={{ marginTop: 8 }}>
              <option value="">Striker</option>
              {soBatters.map((p) => <option key={p} value={p}>{name(p)}</option>)}
            </select>
            <select className="input" value={soNon} onChange={(e) => setSoNon(e.target.value)}>
              <option value="">Non-striker</option>
              {soBatters.map((p) => <option key={p} value={p}>{name(p)}</option>)}
            </select>
            <p className="tiny" style={{ marginTop: 8 }}>Bowler</p>
            <select className="input" value={soBowler} onChange={(e) => setSoBowler(e.target.value)}>
              <option value="">Bowler</option>
              {(soPending.bowlingTeamId === state.config.team1.id ? state.playingXI?.team1 ?? [] : state.playingXI?.team2 ?? []).map((p) => (
                <option key={p} value={p}>{name(p)}</option>
              ))}
            </select>
            <button
              className="btn lime"
              style={{ width: "100%", marginTop: 12 }}
              disabled={soBatters.length !== 3 || !soStriker || !soNon || soStriker === soNon || !soBowler}
              onClick={async () => {
                const local = startSuperOverInnings(state, {
                  batterIds: soBatters,
                  strikerId: soStriker,
                  nonStrikerId: soNon,
                  bowlerId: soBowler
                }, "umpire");
                if (local.ok) setState(local.state);
                try {
                  const res = await api.superOver(id!, {
                    batterIds: soBatters,
                    strikerId: soStriker,
                    nonStrikerId: soNon,
                    bowlerId: soBowler
                  });
                  if (res.state) setState(res.state);
                  setSoBatters([]);
                  setSoStriker("");
                  setSoNon("");
                  setSoBowler("");
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Failed");
                }
              }}
            >
              Start Super Over innings
            </button>
          </div>
        </div>
      )}

      {state.status === "COMPLETE" && (
        <div className="card" style={{ margin: 12 }}>
          <h3>Match complete</h3>
          <p>{state.resultSummary}</p>
        </div>
      )}

      {state.status !== "COMPLETE" && state.status !== "PUBLISHED" && payload?.match && (
        <div className="pad">
          <button className="btn ghost" style={{ width: "100%" }} onClick={() => {
            setWoWinner(payload.match.team1Id);
            setWalkoverOpen(true);
          }}>
            Award walkover
          </button>
        </div>
      )}

      {wicketOpen && inn && (
        <div className="sheet" onClick={() => setWicketOpen(false)}>
          <div className="sheet-card" onClick={(e) => e.stopPropagation()}>
            <h3>Wicket</h3>
            {DISMISSALS.map((d) => {
              const blocked = Boolean(fh && FREE_HIT_BLOCKED_DISMISSALS.includes(d));
              return (
                <button key={d} className="choice" disabled={blocked} onClick={() => setDismissal(d)}>
                  {d.replaceAll("_", " ")}
                  {dismissal === d ? " ✓" : ""}
                  {blocked ? " (not on Free Hit)" : ""}
                </button>
              );
            })}
            <label style={{ marginTop: 12, display: "block" }}>Dismissed</label>
            <select className="input" value={dismissed} onChange={(e) => setDismissed(e.target.value)}>
              <option value="">Select</option>
              {inn.current.strikerId && <option value={inn.current.strikerId}>{name(inn.current.strikerId)} (striker)</option>}
              {inn.current.nonStrikerId && <option value={inn.current.nonStrikerId}>{name(inn.current.nonStrikerId)} (non-striker)</option>}
            </select>
            {dismissal === "CAUGHT" && (
              <>
                <label style={{ marginTop: 8, display: "block" }}>Catcher</label>
                <select className="input" value={catcher} onChange={(e) => setCatcher(e.target.value)}>
                  <option value="">Select</option>
                  {fielders.map((pid) => (
                    <option key={pid} value={pid}>
                      {name(pid)}
                    </option>
                  ))}
                </select>
              </>
            )}
            {(dismissal === "RUN_OUT" || dismissal === "MANKAD" || dismissal === "OBSTRUCTING_THE_FIELD") && (
              <>
                <label style={{ marginTop: 8, display: "block" }}>Completed runs (run-out taking 3rd = 2)</label>
                <select className="input" value={completedRuns} onChange={(e) => setCompletedRuns(Number(e.target.value))}>
                  {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                <label style={{ marginTop: 8, display: "block" }}>Ball type</label>
                <select className="input" value={wicketExtra} onChange={(e) => setWicketExtra(e.target.value as ExtraType)}>
                  <option value="NONE">Fair ball</option>
                  <option value="WIDE">Wide (runs count, ball usually not)</option>
                  <option value="NO_BALL">No-ball (runs count, ball usually not)</option>
                </select>
              </>
            )}
            <button
              className="btn hot"
              style={{ width: "100%", marginTop: 12 }}
              disabled={!dismissed || (dismissal === "CAUGHT" && !catcher)}
              onClick={() => {
                const isRunOutKind = dismissal === "RUN_OUT" || dismissal === "MANKAD" || dismissal === "OBSTRUCTING_THE_FIELD";
                commit({
                  batRuns: isRunOutKind ? completedRuns : 0,
                  extraType: isRunOutKind ? wicketExtra : extra === "NO_BALL" ? "NO_BALL" : "NONE",
                  wicket: {
                    dismissalType: dismissal,
                    dismissedPlayerId: dismissed,
                    catcherId: catcher || undefined,
                    runOutFielderId: dismissal === "RUN_OUT" || dismissal === "MANKAD" ? catcher || fielders[0] : undefined
                  }
                });
              }}
            >
              Confirm wicket
            </button>
          </div>
        </div>
      )}

      {injuryOpen && inn && (
        <div className="sheet" onClick={() => setInjuryOpen(false)}>
          <div className="sheet-card" onClick={(e) => e.stopPropagation()}>
            <h3>Retire hurt</h3>
            <p className="tiny">Not out. They can return later if they are fit, even while others are still to bat.</p>
            <select className="input" value={injuredPlayer} onChange={(e) => setInjuredPlayer(e.target.value)}>
              <option value="">Select</option>
              {inn.current.strikerId && <option value={inn.current.strikerId}>{name(inn.current.strikerId)} (striker)</option>}
              {inn.current.nonStrikerId && <option value={inn.current.nonStrikerId}>{name(inn.current.nonStrikerId)} (non-striker)</option>}
            </select>
            <button
              className="btn"
              style={{ width: "100%", marginTop: 12 }}
              disabled={!injuredPlayer}
              onClick={() => {
                commit({ injuryRetirement: { playerId: injuredPlayer } });
                setInjuryOpen(false);
              }}
            >
              Confirm injured
            </button>
          </div>
        </div>
      )}

      {pendingBat && (
        <div className="sheet">
          <div className="sheet-card">
            <h3>
              {pendingBat.reason === "INJURY"
                ? "Replacement after injury"
                : pendingBat.fromRetired
                  ? "Retired batter to return"
                  : "Next batsman"}
            </h3>
            <p className="tiny">
              {pendingBat.fromRetired
                ? "30-run retirees return in the order they retired, and only after everyone else has batted and is out or retired."
                : pendingBat.reason === "INJURY"
                  ? "Pick the next batter, or send the injured batter back in if they are fit."
                  : "Yet to bat first. An injured batter may also return now if they are fit. 30-run retirees wait until the rest are done."}
            </p>
            {pendingBat.candidates.map((pid) => (
              <button
                key={pid}
                className="choice"
                onClick={async () => {
                  const local = selectReplacementBatter(state, pid, "umpire");
                  if (local.ok) setState(local.state);
                  try {
                    const res = await api.selectBatter(id!, pid);
                    if (res.state) setState(res.state);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Failed");
                  }
                }}
              >
                {name(pid)}
                {inn?.injuredIds?.includes(pid) ? " (injured — fit to return)" : ""}
                {inn?.retiredIds?.includes(pid) && !inn?.injuredIds?.includes(pid) ? " (retired 30 — next back)" : ""}
              </button>
            ))}
          </div>
        </div>
      )}

      {pendingBowl && !pendingBat && (
        <div className="sheet">
          <div className="sheet-card">
            <h3>Next bowler</h3>
            <p className="tiny">A bowler cannot bowl two overs in a row.</p>
            {(inn?.bowlingXI ?? []).map((pid) => {
              const prev = inn?.current.previousOverBowlerId === pid;
              const used = (inn?.bowlers[pid]?.oversCompleted ?? 0) >= (state.config.rules.maxOversPerBowler ?? 2);
              return (
                <button
                  key={pid}
                  className="choice"
                  disabled={prev || used}
                  onClick={async () => {
                    const local = selectNextBowler(state, pid, "umpire", false);
                    if (local.ok) setState(local.state);
                    try {
                      const res = await api.selectBowler(id!, pid, false);
                      if (res.state) setState(res.state);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "Failed");
                    }
                  }}
                >
                  {name(pid)}
                  {prev ? " (bowled last over)" : used ? " (max overs)" : ""}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {secondOpen && (
        <div className="sheet" onClick={() => setSecondOpen(false)}>
          <div className="sheet-card" onClick={(e) => e.stopPropagation()}>
            <h3>Start 2nd innings</h3>
            {(() => {
              const first = state.innings[0];
              const bat = first.bowlingTeamId === state.config.team1.id ? state.playingXI?.team1 ?? [] : state.playingXI?.team2 ?? [];
              const bowl = first.battingTeamId === state.config.team1.id ? state.playingXI?.team1 ?? [] : state.playingXI?.team2 ?? [];
              return (
                <>
                  <select className="input" value={striker2} onChange={(e) => setStriker2(e.target.value)}>
                    <option value="">Striker</option>
                    {bat.map((p) => (
                      <option key={p} value={p}>{name(p)}</option>
                    ))}
                  </select>
                  <select className="input" value={non2} onChange={(e) => setNon2(e.target.value)}>
                    <option value="">Non-striker</option>
                    {bat.map((p) => (
                      <option key={p} value={p}>{name(p)}</option>
                    ))}
                  </select>
                  <select className="input" value={bowl2} onChange={(e) => setBowl2(e.target.value)}>
                    <option value="">Bowler</option>
                    {bowl.map((p) => (
                      <option key={p} value={p}>{name(p)}</option>
                    ))}
                  </select>
                  <button
                    className="btn lime"
                    style={{ width: "100%", marginTop: 12 }}
                    onClick={async () => {
                      const local = startSecondInnings(state, striker2, non2, bowl2, "umpire");
                      if (local.ok) setState(local.state);
                      try {
                        const res = await api.startInnings(id!, {
                          inningsNumber: 2,
                          strikerId: striker2,
                          nonStrikerId: non2,
                          bowlerId: bowl2
                        });
                        if (res.state) setState(res.state);
                        setSecondOpen(false);
                      } catch (e) {
                        setError(e instanceof Error ? e.message : "Failed");
                      }
                    }}
                  >
                    Start chase
                  </button>
                </>
              );
            })()}
          </div>
        </div>
      )}
      {walkoverOpen && payload?.match && (
        <div className="sheet" onClick={() => setWalkoverOpen(false)}>
          <div className="sheet-card" onClick={(e) => e.stopPropagation()}>
            <h3>Award walkover</h3>
            <p className="tiny">Simulates a completed match and awards points to the selected team.</p>
            <select className="input" value={woWinner} onChange={(e) => setWoWinner(e.target.value)}>
              <option value={payload.match.team1Id}>{payload.match.team1.name}</option>
              <option value={payload.match.team2Id}>{payload.match.team2.name}</option>
            </select>
            <input className="input" placeholder="Reason" value={woReason} onChange={(e) => setWoReason(e.target.value)} />
            <button
              className="btn hot"
              style={{ width: "100%", marginTop: 12 }}
              disabled={!woWinner || !woReason.trim()}
              onClick={async () => {
                try {
                  const res = await api.walkover(id!, { winnerTeamId: woWinner, reason: woReason.trim() });
                  if (res.state) setState(res.state);
                  setWalkoverOpen(false);
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Walkover failed");
                }
              }}
            >
              Simulate and award
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
