import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";

export function Setup() {
  const { id } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState<any>(null);
  const [team1, setTeam1] = useState<string[]>([]);
  const [team2, setTeam2] = useState<string[]>([]);
  const [tossWinner, setTossWinner] = useState("");
  const [decision, setDecision] = useState<"BAT" | "FIELD">("BAT");
  const [overs, setOvers] = useState(8);
  const [reason, setReason] = useState("");
  const [striker, setStriker] = useState("");
  const [nonStriker, setNonStriker] = useState("");
  const [bowler, setBowler] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function reload() {
    const row = await api.match(id!);
    setData(row);
    const xi = row.match.playingXI ?? [];
    setTeam1(xi.filter((x: any) => x.teamId === row.match.team1Id).map((x: any) => x.playerId));
    setTeam2(xi.filter((x: any) => x.teamId === row.match.team2Id).map((x: any) => x.playerId));
    setTossWinner(row.match.tossWinnerId ?? row.match.team1Id);
    setOvers(row.match.oversPerInnings ?? 8);
  }

  useEffect(() => {
    reload().catch((e) => setError(e.message));
  }, [id]);

  const squad1 = data?.squads.team1 ?? [];
  const squad2 = data?.squads.team2 ?? [];
  const side =
    data?.playersPerSide ??
    data?.state?.config?.rules?.playersPerSide ??
    data?.match?.tournament?.rules?.playersPerSide ??
    11;
  const battingFirst = useMemo(() => {
    if (!data || !tossWinner) return data?.match.team1Id;
    if (decision === "BAT") return tossWinner;
    return tossWinner === data.match.team1Id ? data.match.team2Id : data.match.team1Id;
  }, [data, tossWinner, decision]);

  function showToast(text: string) {
    setToast(text);
    setError("");
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2800);
  }

  function toggle(list: string[], set: (v: string[]) => void, pid: string) {
    if (list.includes(pid)) set(list.filter((x) => x !== pid));
    else if (list.length < side) set([...list, pid]);
  }

  if (!data) return <p className="tiny" style={{ padding: 16 }}>Loading setup…</p>;

  const batSquad = battingFirst === data.match.team1Id ? team1 : team2;
  const bowlSquad = battingFirst === data.match.team1Id ? team2 : team1;

  return (
    <div className="stack">
      <h1 className="page-title">Pre-match</h1>
      <p className="tiny">
        {data.match.team1.name} vs {data.match.team2.name}
      </p>
      {error && <p className="error">{error}</p>}
      {toast && <div className="toast" role="status">{toast}</div>}

      <div className="card">
        <label>Playing squad · {data.match.team1.shortName} ({team1.length}/{side})</label>
        <p className="tiny" style={{ marginTop: 4 }}>Pick {side} players per side for this tournament.</p>
        <div className="xi-grid" style={{ marginTop: 8 }}>
          {squad1.map((p: any) => (
            <button key={p.id} className={`chip ${team1.includes(p.id) ? "sel" : ""}`} onClick={() => toggle(team1, setTeam1, p.id)}>
              {p.name}
            </button>
          ))}
        </div>
      </div>
      <div className="card">
        <label>Playing squad · {data.match.team2.shortName} ({team2.length}/{side})</label>
        <div className="xi-grid" style={{ marginTop: 8 }}>
          {squad2.map((p: any) => (
            <button key={p.id} className={`chip ${team2.includes(p.id) ? "sel" : ""}`} onClick={() => toggle(team2, setTeam2, p.id)}>
              {p.name}
            </button>
          ))}
        </div>
      </div>
      <button
        className="btn lime"
        disabled={team1.length !== side || team2.length !== side}
        onClick={() =>
          api.xi(id!, { team1, team2 }).then(() => {
            showToast("Playing squad saved");
            return reload();
          }).catch((e) => setError(e.message))
        }
      >
        Confirm playing squad ({side} a side)
      </button>

      <div className="card">
        <label>Toss winner</label>
        <select className="input" value={tossWinner} onChange={(e) => setTossWinner(e.target.value)}>
          <option value={data.match.team1Id}>{data.match.team1.name}</option>
          <option value={data.match.team2Id}>{data.match.team2.name}</option>
        </select>
        <label style={{ marginTop: 10, display: "block" }}>Decision</label>
        <select className="input" value={decision} onChange={(e) => setDecision(e.target.value as "BAT" | "FIELD")}>
          <option value="BAT">Bat</option>
          <option value="FIELD">Field</option>
        </select>
        <button className="btn" style={{ width: "100%", marginTop: 10 }} onClick={() => api.toss(id!, { winnerTeamId: tossWinner, decision }).then(() => { showToast("Toss saved"); return reload(); }).catch((e) => setError(e.message))}>
          Record toss
        </button>
      </div>

      <div className="card">
        <label>Overs (reason required if changed)</label>
        <input className="input" type="number" value={overs} onChange={(e) => setOvers(Number(e.target.value))} />
        <input className="input" placeholder="Reason (rain, light…)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button className="btn" style={{ width: "100%", marginTop: 10 }} onClick={() => api.overs(id!, { overs, reason: reason || "set by umpire" }).then(() => { showToast("Overs saved"); return reload(); }).catch((e) => setError(e.message))}>
          Set overs
        </button>
      </div>

      <div className="card">
        <label>Openers & opening bowler</label>
        <select className="input" value={striker} onChange={(e) => setStriker(e.target.value)}>
          <option value="">Striker</option>
          {batSquad.map((pid) => {
            const p = [...squad1, ...squad2].find((x: any) => x.id === pid);
            return <option key={pid} value={pid}>{p?.name}</option>;
          })}
        </select>
        <select className="input" value={nonStriker} onChange={(e) => setNonStriker(e.target.value)}>
          <option value="">Non-striker</option>
          {batSquad.filter((x) => x !== striker).map((pid) => {
            const p = [...squad1, ...squad2].find((x: any) => x.id === pid);
            return <option key={pid} value={pid}>{p?.name}</option>;
          })}
        </select>
        <select className="input" value={bowler} onChange={(e) => setBowler(e.target.value)}>
          <option value="">Bowler</option>
          {bowlSquad.map((pid) => {
            const p = [...squad1, ...squad2].find((x: any) => x.id === pid);
            return <option key={pid} value={pid}>{p?.name}</option>;
          })}
        </select>
        <button
          className="btn lime"
          style={{ width: "100%", marginTop: 12 }}
          disabled={!striker || !nonStriker || !bowler || striker === nonStriker}
          onClick={() =>
            api
              .startInnings(id!, { inningsNumber: 1, strikerId: striker, nonStrikerId: nonStriker, bowlerId: bowler })
              .then(() => nav(`/matches/${id}`))
              .catch((e) => setError(e.message))
          }
        >
          Start 1st innings
        </button>
      </div>

      <div className="card">
        <h3>Walkover</h3>
        <p className="tiny">
          Award the match to a team. The app simulates a completed innings so the result and points
          table update. Use this when a side cannot play.
        </p>
        <WalkoverForm
          team1={data.match.team1}
          team2={data.match.team2}
          onAward={async (winnerTeamId, reason) => {
            const res = await api.walkover(id!, { winnerTeamId, reason });
            if (res.state) nav(`/matches/${id}`);
          }}
          onError={setError}
        />
      </div>
    </div>
  );
}

function WalkoverForm({
  team1,
  team2,
  onAward,
  onError
}: {
  team1: { id: string; name: string };
  team2: { id: string; name: string };
  onAward: (winnerTeamId: string, reason: string) => Promise<void>;
  onError: (s: string) => void;
}) {
  const [winner, setWinner] = useState(team1.id);
  const [reason, setReason] = useState("Opponent did not show");
  const [busy, setBusy] = useState(false);
  return (
    <>
      <label className="tiny">Winning team</label>
      <select className="input" value={winner} onChange={(e) => setWinner(e.target.value)}>
        <option value={team1.id}>{team1.name}</option>
        <option value={team2.id}>{team2.name}</option>
      </select>
      <input className="input" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button
        className="btn hot"
        style={{ width: "100%", marginTop: 10 }}
        disabled={!winner || !reason.trim() || busy}
        onClick={async () => {
          const team = winner === team1.id ? team1.name : team2.name;
          if (!window.confirm(`Award walkover to ${team}? This completes the match.`)) return;
          setBusy(true);
          try {
            await onAward(winner, reason.trim());
          } catch (e) {
            onError(e instanceof Error ? e.message : "Walkover failed");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Simulating match…" : "Award walkover"}
      </button>
    </>
  );
}
