import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
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
  if (d.isWicket) return "W";
  if (d.extraType === "WIDE") return "Wd";
  if (d.extraType === "NO_BALL") return "Nb";
  return String(d.batRuns);
}

export function ScoreOverlay() {
  const { id } = useParams();
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    document.documentElement.classList.add("overlay-mode");
    document.body.classList.add("overlay-mode");
    return () => {
      document.documentElement.classList.remove("overlay-mode");
      document.body.classList.remove("overlay-mode");
    };
  }, []);

  useEffect(() => {
    if (!id) return;
    api(`/api/matches/${id}`).then(setData).catch(() => undefined);
    socket.emit("join:match", id);
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
    return () => {
      socket.emit("leave:match", id);
      socket.off("match:update", onUp);
    };
  }, [id]);

  const s = data?.snapshot;
  const live = ["FIRST_INNINGS", "SECOND_INNINGS", "SUPER_OVER"].includes(data?.status);
  const striker = s?.currentBatsmen?.find((b: any) => b.isStriker);
  const non = s?.currentBatsmen?.find((b: any) => !b.isStriker);
  const chase =
    s?.target != null
      ? `Need ${s.runsNeeded ?? Math.max(0, s.target - s.runs)} off ${s.ballsRemaining ?? "—"}`
      : null;

  return (
    <div className="score-overlay">
      <div className="score-bug">
        <div className="score-bug-brand">
          <WolfLogo />
          {live ? <span className="score-bug-live">Live</span> : <span className="score-bug-live idle">Wolfpack</span>}
        </div>
        <div className="score-bug-main">
          <div className="score-bug-teams">
            <div className="score-bug-team">
              <span className="score-bug-code">{s?.team1.shortName ?? data?.team1?.shortName ?? "—"}</span>
              <span className="score-bug-score num">{s?.team1.score ?? "—"}</span>
            </div>
            <div className="score-bug-team">
              <span className="score-bug-code">{s?.team2.shortName ?? data?.team2?.shortName ?? "—"}</span>
              <span className="score-bug-score num">{s?.team2.score ?? "—"}</span>
            </div>
          </div>
          {s && live && (
            <div className="score-bug-live-line">
              <span className="num">
                {s.battingTeamName} {s.runs}/{s.wickets}
              </span>
              <span className="score-bug-ov">{s.overs} ov</span>
              {s.isSuperOver && <span>SO</span>}
              {s.isFreeHit && <span className="score-bug-fh">Free hit</span>}
              {chase && <span>{chase}</span>}
            </div>
          )}
          {s && !live && (data?.resultSummary || s.resultSummary) && (
            <div className="score-bug-live-line">{data.resultSummary || s.resultSummary}</div>
          )}
          {live && (
            <div className="score-bug-players">
              {striker && (
                <span>
                  ★ {striker.name} {striker.runs}({striker.balls})
                </span>
              )}
              {non && (
                <span>
                  {non.name} {non.runs}({non.balls})
                </span>
              )}
              {s?.currentBowler && (
                <span>
                  {s.currentBowler.name} {s.currentBowler.wickets}/{s.currentBowler.runs} ({s.currentBowler.overs})
                </span>
              )}
            </div>
          )}
        </div>
        {live && s?.lastSixBalls?.length > 0 && (
          <div className="score-bug-balls">
            {s.lastSixBalls.map((d: any) => (
              <span
                key={d.eventId}
                className={`score-bug-ball ${d.isHomeRun ? "hr" : d.isWicket ? "w" : d.batRuns >= 4 ? "four" : ""}`}
              >
                {ballText(d)}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
