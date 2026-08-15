import { useEffect, useState } from "react";
import { Link, NavLink, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { io } from "socket.io-client";
import { formatNrr, youtubeEmbedUrl } from "@lms/shared";
import { api } from "./api";
import { Admin } from "./Admin";
import { GallerySlideshow } from "./Gallery";
import { WolfLogo } from "./brand";
import { ThemeToggle } from "./ThemeToggle";
import { API_BASE } from "./config";

const socket = io(API_BASE || undefined, {
  path: "/socket.io",
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionDelay: 500,
  reconnectionDelayMax: 4000
});

function Shell({ children }: { children: React.ReactNode }) {
  const [q, setQ] = useState("");
  const nav = useNavigate();
  return (
    <>
      <nav className="nav">
        <Link to="/" className="brand">
          <span className="mark"><WolfLogo /></span>
          <span className="brand-copy">
            <strong>Wolfpack Cricket</strong>
           
          </span>
        </Link>
        <ThemeToggle />
        <form
          className="nav-search"
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim().length >= 2) nav(`/search?q=${encodeURIComponent(q)}`);
          }}
        >
          <input className="search" placeholder="Search players, teams…" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
        <div className="nav-links">
          <NavLink to="/leaderboards">Points</NavLink>
          <NavLink to="/admin">Admin</NavLink>
        </div>
      </nav>
      <div className="wrap">{children}</div>
    </>
  );
}

function Home() {
  const [matches, setMatches] = useState<any[]>([]);
  const [tournaments, setTournaments] = useState<any[]>([]);
  const [gallery, setGallery] = useState<any[]>([]);
  useEffect(() => {
    api("/api/matches").then(setMatches);
    api("/api/tournaments").then(setTournaments);
    api("/api/gallery").then(setGallery).catch(() => setGallery([]));
    socket.emit("join:live");
    const onLive = (p: any) => {
      setMatches((prev) => prev.map((m) => (m.id === p.matchId ? { ...m, snapshot: p.snapshot, status: p.snapshot?.status ?? m.status } : m)));
    };
    socket.on("live:update", onLive);
    return () => {
      socket.off("live:update", onLive);
    };
  }, []);
  const live = matches.filter((m) => ["FIRST_INNINGS", "SECOND_INNINGS", "INNINGS_BREAK", "SUPER_OVER"].includes(m.status));
  const upcoming = matches.filter((m) => ["SCHEDULED", "TOSS", "PLAYING_XI_CONFIRMED"].includes(m.status));
  const recent = matches.filter((m) => ["COMPLETE", "PUBLISHED"].includes(m.status));
  const featured = tournaments.find((t: any) => t.featured) ?? tournaments[0];

  return (
    <>
      {gallery.length > 0 && (
        <>
          <h2 className="h2">Wolfpack gallery</h2>
          <GallerySlideshow items={gallery} />
        </>
      )}
      <h2 className="h2">Live now</h2>
      <div className="hero-live">
        {live.length === 0 && <p className="muted">No live matches right now.</p>}
        {live.map((m) => (
          <LiveCard key={m.id} m={m} />
        ))}
        {featured && (
          <Link to={`/tournaments/${featured.id}`} className="card">
            <div className="tiny">Featured tournament</div>
            <h3>{featured.name}</h3>
            <p className="muted">{featured.season} · {featured._count?.teams ?? ""} teams</p>
            <p className="tiny" style={{ marginTop: 8 }}>Open points table →</p>
          </Link>
        )}
      </div>
      <h2 className="h2">Upcoming</h2>
      <div className="grid-2">
        {upcoming.map((m) => (
          <Link key={m.id} to={`/matches/${m.id}`} className="card">
            <div className="tiny">{new Date(m.scheduledAt).toLocaleString()}</div>
            <strong>{m.team1.shortName} vs {m.team2.shortName}</strong>
            <p className="muted">{m.venue?.name}</p>
          </Link>
        ))}
      </div>
      <h2 className="h2">Recent results</h2>
      <div className="grid-2">
        {recent.map((m) => (
          <Link key={m.id} to={`/matches/${m.id}`} className="card">
            <strong>{m.team1.shortName} vs {m.team2.shortName}</strong>
            <p>{m.resultSummary || m.status}</p>
          </Link>
        ))}
      </div>
    </>
  );
}

function LiveCard({ m }: { m: any }) {
  const s = m.snapshot;
  return (
    <Link to={`/matches/${m.id}`} className="card">
      <span className="live-tag"><i /> Live</span>
      <div className="muted" style={{ marginTop: 8 }}>
        {m.team1.name} vs {m.team2.name}
      </div>
      {s ? (
        <>
          <div className="list-row" style={{ marginTop: 8 }}>
            <span>{s.team1.shortName}</span>
            <span className="num">{s.team1.score}</span>
          </div>
          <div className="list-row">
            <span>{s.team2.shortName}</span>
            <span className="num">{s.team2.score}</span>
          </div>
          <div className="muted">
            {s.isSuperOver ? "Super Over · " : ""}
            {s.battingTeamName} {s.runs}/{s.wickets} ({s.overs} ov)
          </div>
          {m.streamUrl && <p className="tiny" style={{ marginTop: 6 }}>Watch live on YouTube</p>}
        </>
      ) : (
        <div className="muted">{m.status}</div>
      )}
    </Link>
  );
}

function MatchPage() {
  const { id } = useParams();
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState("Summary");
  useEffect(() => {
    api(`/api/matches/${id}`).then(setData);
    socket.emit("join:match", id);
    const onUp = (payload: any) => {
      const snap = payload?.runs != null ? payload : payload?.snapshot ?? payload;
      setData((d: any) =>
        d
          ? {
              ...d,
              snapshot: snap,
              status: snap?.status ?? d.status,
              resultSummary: snap?.resultSummary ?? d.resultSummary,
              streamUrl: payload?.streamUrl ?? snap?.streamUrl ?? d.streamUrl
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
  if (!data) return <p className="muted">Loading…</p>;
  const s = data.snapshot;
  const live = ["FIRST_INNINGS", "SECOND_INNINGS", "SUPER_OVER"].includes(data.status);
  const embed = youtubeEmbedUrl(data.streamUrl ?? "");
  return (
    <>
      <p className="tiny">{data.tournamentName} · {data.venue?.name}</p>
      <h2 className="h2" style={{ marginTop: 6 }}>
        {data.team1.name} vs {data.team2.name}
      </h2>
      {live && <span className="live-tag"><i /> Live</span>}
      {s && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="list-row">
            <strong>{s.team1.name}</strong>
            <span className="num" style={{ fontSize: 22 }}>{s.team1.score}</span>
          </div>
          <div className="list-row">
            <strong>{s.team2.name}</strong>
            <span className="num" style={{ fontSize: 22 }}>{s.team2.score}</span>
          </div>
          {(data.resultSummary || s.resultSummary) && (
            <p style={{ marginTop: 10 }}>{data.resultSummary || s.resultSummary}</p>
          )}
          {live && (
            <>
              {s.isSuperOver && <p className="tiny" style={{ marginTop: 10 }}>Super Over in progress</p>}
              <div className="muted" style={{ marginTop: 8 }}>{s.battingTeamName}</div>
              <div className="score num">{s.runs}/{s.wickets}</div>
              <div className="muted">
                {s.overs} ov · RR {s.runRate}
                {s.target != null && ` · Target ${s.target}`}
                {s.requiredRunRate != null && ` · RRR ${s.requiredRunRate}`}
              </div>
              {s.currentBatsmen?.map((b: any) => (
                <div key={b.playerId} className="list-row">
                  <span>{b.isStriker ? "★ " : ""}{b.name}</span>
                  <span className="num">{b.runs} ({b.balls}) SR {b.strikeRate}</span>
                </div>
              ))}
              {s.currentBowler && (
                <div className="list-row">
                  <span>{s.currentBowler.name}</span>
                  <span className="num">{s.currentBowler.overs}-{s.currentBowler.runs}-{s.currentBowler.wickets} · {s.currentBowler.economy}</span>
                </div>
              )}
              <div className="balls">
                {s.lastSixBalls?.map((d: any) => (
                  <div key={d.eventId} className={`ball ${d.isHomeRun ? "hr" : d.isWicket ? "w" : d.batRuns >= 4 ? "four" : ""}`}>
                    {d.isHomeRun ? "HR" : d.isWicket ? "W" : d.extraType === "WIDE" ? "Wd" : d.extraType === "NO_BALL" ? "Nb" : d.batRuns}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {embed && (
        <div className="card" style={{ marginTop: 12 }}>
          <h3>Watch live</h3>
          <div className="yt-wrap">
            <iframe
              src={embed}
              title="Match stream"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
        </div>
      )}
      <div className="tabs">
        {["Summary", "Scorecard", "Ball-by-Ball", "Teams", "Stats"].map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {tab === "Scorecard" && s?.scorecard && <Scorecard s={s} />}
      {tab === "Ball-by-Ball" && (
        <div className="card">
          {(s?.ballByBall ?? []).slice().reverse().map((c: any) => (
            <p key={c.eventId} className={c.isHomeRun ? "hr-call" : c.isWicket ? "wk-call" : ""} style={{ padding: "8px 0", borderTop: "1px solid var(--line)" }}>
              <span className="tiny">
                {c.kind === "SUPER_OVER"
                  ? `SO${c.superOverNumber ?? ""} · ${c.battingTeamName} · `
                  : `${c.battingTeamName ? `${c.battingTeamName} · ` : ""}Ov ${c.overNumber} · `}
              </span>
              {c.commentary}
            </p>
          ))}
        </div>
      )}
      {tab === "Summary" && s && (
        <div className="card">
          {(s.scorecard?.innings ?? []).map((inn: any) => (
            <p key={`${inn.kind}-${inn.inningsNumber}`}>
              {inn.kind === "SUPER_OVER"
                ? `Super Over ${inn.superOverNumber ?? ""}${inn.superOverLeg === 2 ? " chase" : ""}: `
                : `Innings ${inn.inningsNumber}: `}
              {inn.battingTeamName} {inn.total}/{inn.wickets} ({inn.overs})
              <span className="muted">
                {" "}· extras wd {inn.extras.wides} nb {inn.extras.noBalls} b {inn.extras.byes} lb {inn.extras.legByes}
              </span>
            </p>
          ))}
          {s.partnership && live && (
            <p style={{ marginTop: 8 }}>Current partnership {s.partnership.runs} off {s.partnership.balls}</p>
          )}
        </div>
      )}
      {tab === "Teams" && (
        <div className="grid-2">
          <Link className="card" to={`/teams/${data.team1.id}`}>{data.team1.name}</Link>
          <Link className="card" to={`/teams/${data.team2.id}`}>{data.team2.name}</Link>
        </div>
      )}
      {tab === "Stats" && s?.scorecard && (
        <div className="card">
          {s.scorecard.innings.map((inn: any) => (
            <p key={inn.inningsNumber}>
              {inn.kind === "SUPER_OVER" ? `Super Over ${inn.superOverNumber ?? ""}: ` : ""}
              {inn.battingTeamName}: {inn.total}/{inn.wickets} ({inn.overs})
            </p>
          ))}
        </div>
      )}
    </>
  );
}

function Scorecard({ s }: { s: any }) {
  return (
    <>
      {s.scorecard.innings.map((inn: any) => (
        <div className="card" key={inn.inningsNumber} style={{ marginBottom: 12 }}>
          <h3>
            {inn.kind === "SUPER_OVER" ? `Super Over ${inn.superOverNumber ?? ""}${inn.superOverLeg === 2 ? " chase" : ""} · ` : ""}
            {inn.battingTeamName} · {inn.total}/{inn.wickets} ({inn.overs})
          </h3>
          <table>
            <thead>
              <tr><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th><th></th></tr>
            </thead>
            <tbody>
              {inn.batting.filter((b: any) => b.status !== "").map((b: any) => (
                <tr key={b.playerId} className={b.isStriker ? "bat" : ""}>
                  <td><Link to={`/players/${b.playerId}`}>{b.name}</Link></td>
                  <td className="num">{b.runs}</td>
                  <td className="num">{b.balls}</td>
                  <td>{b.fours}</td>
                  <td>{b.sixes}</td>
                  <td>{b.strikeRate}</td>
                  <td className="tiny">{b.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="tiny" style={{ marginTop: 8 }}>Yet to bat: {inn.yetToBat.join(", ") || "—"}</p>
          <p className="tiny">Extras {inn.extras.total} (wd {inn.extras.wides}, nb {inn.extras.noBalls}, b {inn.extras.byes}, lb {inn.extras.legByes})</p>
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr><th>Bowler</th><th>O</th><th>R</th><th>W</th><th>Econ</th><th>Wd</th><th>Nb</th></tr>
            </thead>
            <tbody>
              {inn.bowling.map((b: any) => (
                <tr key={b.playerId}>
                  <td><Link to={`/players/${b.playerId}`}>{b.name}</Link></td>
                  <td>{b.overs}</td>
                  <td>{b.runs}</td>
                  <td>{b.wickets}</td>
                  <td>{b.economy}</td>
                  <td>{b.wides}</td>
                  <td>{b.noBalls}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}

function TournamentPage() {
  const { id } = useParams();
  const [t, setT] = useState<any>(null);
  const [points, setPoints] = useState<any[]>([]);
  const [fixtures, setFixtures] = useState<any[]>([]);
  const [boards, setBoards] = useState<any>(null);
  useEffect(() => {
    api(`/api/tournaments/${id}`).then(setT);
    api(`/api/tournaments/${id}/points`).then(setPoints);
    api(`/api/tournaments/${id}/fixtures`).then(setFixtures);
    api(`/api/tournaments/${id}/leaderboards`).then(setBoards);
  }, [id]);
  if (!t) return <p className="muted">Loading…</p>;
  return (
    <>
      <h2 className="h2">{t.name}</h2>
      <p className="muted">{t.season} · Tape ball rules: illegal-ball escalation, free hit, home run, retire at {t.rules?.retirementScore}</p>
      <h3 className="h2">Points table</h3>
      <div className="card">
        <table>
          <thead><tr><th>Team</th><th>P</th><th>W</th><th>L</th><th>T</th><th>Pts</th><th>NRR</th></tr></thead>
          <tbody>
            {points.map((r) => (
              <tr key={r.teamId}>
                <td><Link to={`/teams/${r.teamId}`}>{r.team?.name}</Link></td>
                <td>{r.played}</td><td>{r.won}</td><td>{r.lost}</td><td>{r.tied}</td>
                <td className="num">{r.points}</td>
                <td className="num">{formatNrr(r.nrr)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {points.length === 0 && <p className="tiny">No completed matches yet — points appear after a result is recorded.</p>}
        <p className="tiny" style={{ marginTop: 10 }}>
          NRR = batting run rate − bowling run rate, across the tournament.
          Batting RR = runs scored ÷ overs faced. Bowling RR = runs conceded ÷ overs bowled.
          All out: the batting side is given the full innings (e.g. 220 all out in 44 of 50 still
          counts as 50 overs). Successful chase: only the overs actually used (e.g. 244 in 40 of 50
          counts as 40). Walkovers and no-results do not change NRR. Sorted by points, then NRR.
        </p>
      </div>
      <h3 className="h2">Fixtures</h3>
      <div className="grid-2">
        {fixtures.map((f) => (
          <Link key={f.id} className="card" to={f.match ? `/matches/${f.match.id}` : "#"}>
            <div className="tiny">{f.stage} · {new Date(f.scheduledAt).toLocaleString()}</div>
            <strong>{f.team1.shortName} vs {f.team2.shortName}</strong>
            <p className="muted">{f.venue?.name} · {f.match?.status}</p>
          </Link>
        ))}
      </div>
      {boards && (
        <>
          <h3 className="h2">Most runs</h3>
          <div className="card">
            {boards.mostRuns.map((r: any) => (
              <div className="list-row" key={r.playerId}><Link to={`/players/${r.playerId}`}>{r.name}</Link><span className="num">{r.value}</span></div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function TeamPage() {
  const { id } = useParams();
  const [data, setData] = useState<any>(null);
  useEffect(() => { api(`/api/teams/${id}`).then(setData); }, [id]);
  if (!data) return <p className="muted">Loading…</p>;
  const { team, matches, stats } = data;
  const cap = team.players.find((p: any) => p.isCaptain);
  return (
    <>
      <h2 className="h2">{team.name}</h2>
      <p className="muted">{team.city} · Captain {cap?.player.name ?? "—"} · {stats ? `${stats.won}W ${stats.lost}L` : ""}</p>
      <h3 className="h2">Squad</h3>
      <div className="card">
        {team.players.map((p: any) => (
          <div className="list-row" key={p.playerId}>
            <Link to={`/players/${p.playerId}`}>{p.player.name}</Link>
            <span className="tiny">{p.player.role}{p.isCaptain ? " · C" : ""}{p.isWicketKeeper ? " · WK" : ""}</span>
          </div>
        ))}
      </div>
      <h3 className="h2">Matches</h3>
      {matches.map((m: any) => (
        <Link key={m.id} className="card" to={`/matches/${m.id}`} style={{ display: "block", marginBottom: 8 }}>
          {m.team1.name} vs {m.team2.name} · {m.resultSummary || m.status}
        </Link>
      ))}
    </>
  );
}

function PlayerPage() {
  const { id } = useParams();
  const [data, setData] = useState<any>(null);
  useEffect(() => { api(`/api/players/${id}`).then(setData); }, [id]);
  if (!data) return <p className="muted">Loading…</p>;
  const s = data.stats[0];
  const avg = s && s.dismissals ? (s.runs / s.dismissals).toFixed(2) : s?.runs ?? "—";
  const sr = s && s.ballsFaced ? ((s.runs / s.ballsFaced) * 100).toFixed(1) : "—";
  const econ = s && s.ballsBowled ? (s.runsConceded / (s.ballsBowled / 6)).toFixed(2) : "—";
  return (
    <>
      <h2 className="h2">{data.player.name}</h2>
      <p className="muted">{data.player.role} · {data.player.battingStyle} · {data.player.teams.map((t: any) => t.team.name).join(", ")}</p>
      {s && (
        <div className="grid-3" style={{ marginTop: 12 }}>
          <div className="card"><div className="tiny">Runs</div><div className="score num" style={{ fontSize: 36 }}>{s.runs}</div></div>
          <div className="card"><div className="tiny">Avg / SR</div><div className="num" style={{ fontSize: 28 }}>{avg} / {sr}</div></div>
          <div className="card"><div className="tiny">Highest / 30+ retirements</div><div className="num" style={{ fontSize: 28 }}>{s.highestScore} / {s.retirements}</div></div>
          <div className="card"><div className="tiny">Wickets</div><div className="num" style={{ fontSize: 28 }}>{s.wickets}</div></div>
          <div className="card"><div className="tiny">Economy</div><div className="num" style={{ fontSize: 28 }}>{econ}</div></div>
          <div className="card"><div className="tiny">Catches / RO</div><div className="num" style={{ fontSize: 28 }}>{s.catches} / {s.runOuts}</div></div>
        </div>
      )}
    </>
  );
}

function Boards() {
  const [tours, setTours] = useState<any[]>([]);
  const [id, setId] = useState("");
  const [boards, setBoards] = useState<any>(null);
  const [points, setPoints] = useState<any[]>([]);
  useEffect(() => {
    api("/api/tournaments").then((rows) => {
      setTours(rows);
      const featured = rows.find((t: any) => t.featured) ?? rows[0];
      if (featured) setId(featured.id);
    });
  }, []);
  useEffect(() => {
    if (!id) return;
    api(`/api/tournaments/${id}/leaderboards`).then(setBoards);
    api(`/api/tournaments/${id}/points`).then(setPoints);
  }, [id]);
  const blocks = boards
    ? [
        ["Most runs", boards.mostRuns],
        ["Highest score", boards.highestScore],
        ["Best average", boards.bestAverage],
        ["Best SR", boards.bestStrikeRate],
        ["Most 4s", boards.mostFours],
        ["Most 6s", boards.mostSixes],
        ["Most 30-run retirements", boards.mostRetirements],
        ["Most wickets", boards.mostWickets],
        ["Best economy", boards.bestEconomy],
        ["Most catches", boards.mostCatches]
      ]
    : [];
  return (
    <>
      <h2 className="h2">Points & boards</h2>
      <select className="input" value={id} onChange={(e) => setId(e.target.value)}>
        {tours.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      {id && (
        <p className="tiny" style={{ marginTop: 8 }}>
          <Link to={`/tournaments/${id}`}>Open full tournament page</Link>
        </p>
      )}
      <h3 className="h2">Points table</h3>
      <div className="card">
        <table>
          <thead><tr><th>Team</th><th>P</th><th>W</th><th>L</th><th>T</th><th>Pts</th><th>NRR</th></tr></thead>
          <tbody>
            {points.map((r) => (
              <tr key={r.teamId}>
                <td><Link to={`/teams/${r.teamId}`}>{r.team?.name}</Link></td>
                <td>{r.played}</td><td>{r.won}</td><td>{r.lost}</td><td>{r.tied}</td>
                <td className="num">{r.points}</td>
                <td className="num">{formatNrr(r.nrr)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {points.length === 0 && <p className="tiny">No completed matches yet.</p>}
        <p className="tiny" style={{ marginTop: 10 }}>
          NRR = batting run rate − bowling run rate. All out counts as the full innings; a
          successful chase uses only the overs actually faced. Walkovers do not affect NRR.
        </p>
      </div>
      <div className="grid-2" style={{ marginTop: 12 }}>
        {blocks.map(([title, rows]) => (
          <div className="card" key={title as string}>
            <h3>{title}</h3>
            {(rows as any[]).map((r) => (
              <div className="list-row" key={r.playerId}>
                <Link to={`/players/${r.playerId}`}>{r.name}</Link>
                <span className="num">{r.value}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

function SearchPage() {
  const q = new URLSearchParams(location.search).get("q") ?? "";
  const [res, setRes] = useState<any>(null);
  useEffect(() => {
    if (q) api(`/api/search?q=${encodeURIComponent(q)}`).then(setRes);
  }, [q]);
  if (!res) return <p className="muted">Search…</p>;
  return (
    <>
      <h2 className="h2">Results for “{q}”</h2>
      <div className="grid-2">
        <div className="card">
          <h3>Players</h3>
          {res.players.map((p: any) => <div className="list-row" key={p.id}><Link to={`/players/${p.id}`}>{p.name}</Link></div>)}
        </div>
        <div className="card">
          <h3>Teams</h3>
          {res.teams.map((t: any) => <div className="list-row" key={t.id}><Link to={`/teams/${t.id}`}>{t.name}</Link></div>)}
        </div>
        <div className="card">
          <h3>Tournaments</h3>
          {res.tournaments.map((t: any) => <div className="list-row" key={t.id}><Link to={`/tournaments/${t.id}`}>{t.name}</Link></div>)}
        </div>
        <div className="card">
          <h3>Matches</h3>
          {res.matches.map((m: any) => (
            <div className="list-row" key={m.id}>
              <Link to={`/matches/${m.id}`}>{m.team1.name} vs {m.team2.name}</Link>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/matches/:id" element={<MatchPage />} />
        <Route path="/tournaments/:id" element={<TournamentPage />} />
        <Route path="/teams/:id" element={<TeamPage />} />
        <Route path="/players/:id" element={<PlayerPage />} />
        <Route path="/leaderboards" element={<Boards />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </Shell>
  );
}
