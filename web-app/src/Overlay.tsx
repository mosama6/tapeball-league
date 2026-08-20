import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { io } from "socket.io-client";
import { api } from "./api";
import { WolfLogo } from "./brand";
import { API_BASE } from "./config";

const socket = io(API_BASE || undefined, {
  path: "/socket.io",
  transports: ["websocket", "polling"],
  reconnection: true
});

function ballText(d: {
  extraType?: string;
  batRuns: number;
  isWicket: boolean;
  isHomeRun: boolean;
}) {
  if (d.isHomeRun) return "HR";
  if (d.isWicket) return d.batRuns ? `${d.batRuns}W` : "W";
  if (d.extraType === "WIDE") return d.batRuns ? `Wd+${d.batRuns}` : "Wd";
  if (d.extraType === "NO_BALL") return `Nb${d.batRuns || ""}`;
  return String(d.batRuns);
}

function firstName(name: string) {
  return (name || "").trim().split(/\s+/)[0] || name;
}

function scoreOnly(score?: string) {
  if (!score) return "—";
  return score.split(" (")[0];
}

export function ScoreOverlay() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const preview = params.has("preview");
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    document.documentElement.classList.add("overlay-mode");
    document.body.classList.add("overlay-mode");
    if (preview) document.documentElement.classList.add("overlay-preview");
    return () => {
      document.documentElement.classList.remove("overlay-mode");
      document.body.classList.remove("overlay-mode");
      document.documentElement.classList.remove("overlay-preview");
    };
  }, [preview]);

  useEffect(() => {
    if (!id) return;
    let room = /^\d+$/.test(id) ? id : "";
    const load = () =>
      api(`/api/matches/${id}`).then((row) => {
        if (row?.id != null) room = String(row.id);
        setData(row);
      }).catch(() => undefined);
    load();

    const join = () => {
      if (room) socket.emit("join:match", room);
    };
    join();
    socket.on("connect", join);

    const onUp = (payload: any) => {
      const snap = payload?.runs != null ? payload : payload?.snapshot ?? payload;
      setData((d: any) =>
        d
          ? {
              ...d,
              snapshot: snap,
              status: snap?.status ?? d.status,
              resultSummary: snap?.resultSummary ?? d.resultSummary
            }
          : d
      );
    };
    socket.on("match:update", onUp);

    const tick = () => {
      join();
      load();
    };
    const poll = window.setInterval(tick, 2000);
    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVis);
      socket.off("connect", join);
      if (room) socket.emit("leave:match", room);
      socket.off("match:update", onUp);
    };
  }, [id]);

  const s = data?.snapshot;
  const status = s?.status ?? data?.status;
  const live = ["FIRST_INNINGS", "SECOND_INNINGS", "SUPER_OVER"].includes(status);
  const striker = s?.currentBatsmen?.find((b: any) => b.isStriker);
  const non = s?.currentBatsmen?.find((b: any) => !b.isStriker);
  const balls = s?.thisOverBalls ?? [];
  const target = s?.target ?? data?.targetRuns ?? null;
  const chase = live && target != null;
  const needRuns = chase && s ? (s.runsNeeded ?? Math.max(0, target - s.runs)) : null;
  const needBalls = chase && s ? (s.ballsRemaining ?? "—") : null;

  return (
    <div className={`score-overlay${preview ? " preview" : ""}`}>
      <div className="score-bug">
        <div className="score-bug-brand">
          <WolfLogo />
        </div>

        <div className="score-bug-body">
          <div className="score-bug-row">
            <div className="score-bug-slot start">
              <span className="score-bug-code">{s?.team1.shortName ?? data?.team1?.shortName ?? "—"}</span>
              <span className="score-bug-score num">{scoreOnly(s?.team1.score)}</span>
              <span className="score-bug-sep" />
              <span className="score-bug-code">{s?.team2.shortName ?? data?.team2?.shortName ?? "—"}</span>
              <span className="score-bug-score num">{scoreOnly(s?.team2.score)}</span>
            </div>
            <span className="score-bug-sep" />
            <div className="score-bug-slot mid">
              {live && s ? (
                <>
                  <span className="score-bug-tag">{s.isSuperOver ? "SO" : "LIVE"}</span>
                  <span className="score-bug-ov">{s.overs} ov</span>
                  {s.isFreeHit && <span className="score-bug-fh">FH</span>}
                </>
              ) : (
                <span className="score-bug-ov">{data?.resultSummary || s?.resultSummary || "Wolfpack"}</span>
              )}
            </div>
            <span className="score-bug-sep" />
            <div className="score-bug-slot end">
              {chase ? (
                <span className="score-bug-chase">
                  Need <b className="num">{needRuns}</b> off {needBalls}
                </span>
              ) : (
                <span className="score-bug-empty">{live ? "1st innings" : ""}</span>
              )}
            </div>
          </div>
          <div className="score-bug-row score-bug-row-2">
            <div className="score-bug-slot start">
              {balls.length === 0 && <span className="score-bug-empty">This over —</span>}
              {balls.map((d: any) => (
                <span
                  key={d.eventId}
                  className={`score-bug-ball ${d.isHomeRun ? "hr" : d.isWicket ? "w" : d.batRuns >= 4 ? "four" : ""}`}
                >
                  {ballText(d)}
                </span>
              ))}
            </div>
            <span className="score-bug-sep" />
            <div className="score-bug-slot mid">
              {live && striker && (
                <span className="on">
                  ★ {firstName(striker.name)} {striker.runs}({striker.balls})
                </span>
              )}
              {live && non && (
                <span>
                  {firstName(non.name)} {non.runs}({non.balls})
                </span>
              )}
            </div>
            <span className="score-bug-sep" />
            <div className="score-bug-slot end">
              {live && s?.currentBowler && (
                <span>
                  {firstName(s.currentBowler.name)} {s.currentBowler.wickets}-{s.currentBowler.runs}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
