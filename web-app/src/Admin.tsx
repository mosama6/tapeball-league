import { FormEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FixtureStage, oversForFixture } from "@lms/shared";
import { api } from "./api";
import { WolfLogo } from "./brand";

type Tab = "tournament" | "rules" | "teams" | "players" | "fixtures" | "umpires" | "gallery" | "publish";

export function Admin() {
  const [token, setToken] = useState(localStorage.getItem("wolfpack_admin_token") ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tab, setTab] = useState<Tab>("tournament");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tours, setTours] = useState<any[]>([]);
  const [tournamentId, setTournamentId] = useState("");
  const [detail, setDetail] = useState<any>(null);
  const [matches, setMatches] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);

  async function login(e: FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      const data = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      if (data.user?.role !== "ADMIN") {
        setErr("This login is not an admin account.");
        return;
      }
      localStorage.setItem("wolfpack_admin_token", data.token);
      setToken(data.token);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Login failed");
    }
  }

  async function reload() {
    const list = await api("/api/tournaments");
    setTours(list);
    const tid = tournamentId || list[0]?.id;
    if (tid && !tournamentId) setTournamentId(tid);
    if (tid) {
      setDetail(await api(`/api/tournaments/${tid}`));
      setMatches(await api(`/api/matches?tournamentId=${tid}`));
    }
    setUsers(await api("/api/admin/users"));
  }

  useEffect(() => {
    if (!token) return;
    reload().catch((e) => setErr(e.message));
  }, [token]);

  useEffect(() => {
    if (!token || !tournamentId) return;
    api(`/api/tournaments/${tournamentId}`)
      .then(setDetail)
      .catch((e) => setErr(e.message));
    api(`/api/matches?tournamentId=${tournamentId}`).then(setMatches);
  }, [token, tournamentId]);

  function showToast(text: string) {
    setMsg(text);
    setErr("");
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setMsg(""), 2800);
  }

  function note(text: string) {
    showToast(text);
    reload().catch(() => undefined);
  }

  async function removeVenue(id: string) {
    if (!confirm("Delete this venue?")) return;
    try {
      await api(`/api/admin/venues/${id}`, { method: "DELETE" });
      note("Venue deleted");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function removeTeam(id: string, name: string) {
    if (!confirm(`Delete squad ${name}? Scheduled fixtures for this team will also be removed.`)) return;
    try {
      await api(`/api/admin/teams/${id}`, { method: "DELETE" });
      note("Squad deleted");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function removePlayer(teamId: string, playerId: string, name: string) {
    if (!confirm(`Remove ${name} from this squad?`)) return;
    try {
      await api(`/api/admin/teams/${teamId}/players/${playerId}`, { method: "DELETE" });
      note("Player removed");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    }
  }

  if (!token) {
    return (
      <form onSubmit={login} className="card" style={{ maxWidth: 420, marginTop: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <span className="mark"><WolfLogo /></span>
          <div>
            <h2 style={{ margin: 0 }}>Admin login</h2>
            <p className="tiny" style={{ margin: 0 }}>Wolfpack Tape Ball League</p>
          </div>
        </div>
        <p className="muted">Set up tournaments, squads, fixtures, and umpires.</p>
        <label className="tiny">Email</label>
        <input className="input" type="email" autoComplete="username" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className="tiny">Password</label>
        <input className="input" type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {err && <p className="tiny" style={{ color: "var(--hot)", marginTop: 8 }}>{err}</p>}
        <button className="btn" style={{ marginTop: 12, width: "100%" }}>Sign in</button>
      </form>
    );
  }

  const teams = detail?.teams ?? [];
  const venues = detail?.venues ?? [];

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h2 className="h2">Admin</h2>
        <button
          className="tiny"
          onClick={() => {
            localStorage.removeItem("wolfpack_admin_token");
            setToken("");
          }}
        >
          Sign out
        </button>
      </div>
      <p className="muted">Create the data the umpire and public apps need. Public site stays view-only.</p>
      {err && <p className="tiny" style={{ color: "var(--hot)" }}>{err}</p>}
      {msg && <div className="toast" role="status">{msg}</div>}

      <label className="tiny">Working tournament</label>
      <select className="input" value={tournamentId} onChange={(e) => setTournamentId(e.target.value)}>
        {tours.map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>

      <div className="tabs">
        {([
          ["tournament", "Tournament"],
          ["rules", "Scoring rules"],
          ["teams", "Teams"],
          ["players", "Players"],
          ["fixtures", "Fixtures"],
          ["umpires", "Umpires"],
          ["gallery", "Gallery"],
          ["publish", "Publish"]
        ] as const).map(([id, label]) => (
          <button key={id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === "tournament" && (
        <div className="grid-2">
          <CreateTournament onCreated={(id) => { setTournamentId(id); note("Tournament created"); }} onError={setErr} />
          <CreateVenue tournamentId={tournamentId} onCreated={() => note("Venue added")} onError={setErr} />
          <div className="card">
            <h3>Venues</h3>
            {venues.map((v: any) => (
              <div className="list-row" key={v.id}>
                <span>{v.name}</span>
                <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span className="tiny">{v.city}</span>
                  <button type="button" className="tiny" style={{ color: "var(--hot)" }} onClick={() => removeVenue(v.id)}>
                    Delete
                  </button>
                </span>
              </div>
            ))}
            {venues.length === 0 && <p className="tiny">None yet.</p>}
          </div>
        </div>
      )}

      {tab === "rules" && (
        <ScoringRules
          tournamentId={tournamentId}
          rules={detail?.rules}
          onSaved={() => note("Scoring rules saved — they apply to new scoring in this tournament")}
          onError={setErr}
        />
      )}

      {tab === "teams" && (
        <div className="grid-2">
          <CreateTeam tournamentId={tournamentId} onCreated={() => note("Team created")} onError={setErr} />
          <div className="card">
            <h3>Teams</h3>
            {teams.map((t: any) => (
              <div className="list-row" key={t.id}>
                <Link to={`/teams/${t.id}`}>{t.name}</Link>
                <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span className="tiny">{t.shortName} · {t.players?.length ?? 0} players</span>
                  <button type="button" className="tiny" style={{ color: "var(--hot)" }} onClick={() => removeTeam(t.id, t.name)}>
                    Delete
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "players" && (
        <div className="grid-2">
          <CreatePlayer teams={teams} onCreated={() => note("Player added")} onError={setErr} />
          <div className="card">
            <h3>Squads</h3>
            {teams.map((t: any) => (
              <div key={t.id} style={{ marginBottom: 12 }}>
                <strong>{t.shortName}</strong>
                {(t.players ?? []).map((p: any) => (
                  <div className="list-row" key={p.playerId}>
                    <Link to={`/players/${p.playerId}`}>{p.player?.name}</Link>
                    <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <span className="tiny">{p.player?.role}{p.isCaptain ? " · C" : ""}</span>
                      <button
                        type="button"
                        className="tiny"
                        style={{ color: "var(--hot)" }}
                        onClick={() => removePlayer(t.id, p.playerId, p.player?.name ?? "player")}
                      >
                        Delete
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "fixtures" && (
        <div className="grid-2">
          <CreateFixture
            tournamentId={tournamentId}
            teams={teams}
            venues={venues}
            rules={detail?.rules}
            defaultMaxBowler={detail?.rules?.maxOversPerBowler ?? 2}
            onCreated={() => note("Fixture + match created")}
            onError={setErr}
          />
          <div className="card">
            <h3>Matches</h3>
            {matches.map((m) => (
              <div className="list-row" key={m.id}>
                <Link to={`/matches/${m.id}`}>{m.team1.shortName} vs {m.team2.shortName}</Link>
                <span className="tiny">{m.status.replaceAll("_", " ")} · {m.oversPerInnings} ov</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "umpires" && (
        <div className="grid-2">
          <CreateUmpire onCreated={() => note("Umpire account created")} onError={setErr} />
          <AssignUmpire users={users} matches={matches} onDone={() => note("Umpire assigned")} onError={setErr} />
          <div className="card">
            <h3>Accounts</h3>
            {users.map((u) => (
              <div className="list-row" key={u.id}>
                <span>{u.name}</span>
                <span className="tiny">{u.role} · {u.email}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "gallery" && <GalleryManager onError={setErr} onSaved={showToast} />}

      {tab === "publish" && (
        <div className="card">
          <h3>Publish completed matches</h3>
          <p className="tiny">Publishing locks the result onto the public site.</p>
          {matches.filter((m) => m.status === "COMPLETE").map((m) => (
            <div className="list-row" key={m.id}>
              <span>{m.team1.shortName} vs {m.team2.shortName}</span>
              <button className="btn" onClick={async () => {
                try {
                  await api(`/api/umpire/matches/${m.id}/publish`, { method: "POST", body: "{}" });
                  note("Match published");
                } catch (e) {
                  setErr(e instanceof Error ? e.message : "Publish failed");
                }
              }}>Publish</button>
            </div>
          ))}
          {matches.filter((m) => m.status === "COMPLETE").length === 0 && (
            <p className="tiny">No completed matches waiting to publish.</p>
          )}
        </div>
      )}
    </>
  );
}

function ScoringRules({
  tournamentId,
  rules,
  onSaved,
  onError
}: {
  tournamentId: string;
  rules: any;
  onSaved: () => void;
  onError: (s: string) => void;
}) {
  const [groupOvers, setGroupOvers] = useState(rules?.groupOversPerInnings ?? rules?.oversPerInnings ?? 6);
  const [knockoutOvers, setKnockoutOvers] = useState(rules?.knockoutOversPerInnings ?? 8);
  const [finalOvers, setFinalOvers] = useState(rules?.finalOversPerInnings ?? 10);
  const [balls, setBalls] = useState(rules?.ballsPerOver ?? 6);
  const [maxBowler, setMaxBowler] = useState(rules?.maxOversPerBowler ?? 2);
  const [first, setFirst] = useState(rules?.firstIllegalPenalty ?? 2);
  const [next, setNext] = useState(rules?.escalatedIllegalPenalty ?? 4);
  const [retire, setRetire] = useState(rules?.retirementScore ?? 30);
  const [side, setSide] = useState(rules?.playersPerSide ?? 11);

  useEffect(() => {
    if (!rules) return;
    setGroupOvers(rules.groupOversPerInnings ?? rules.oversPerInnings ?? 6);
    setKnockoutOvers(rules.knockoutOversPerInnings ?? 8);
    setFinalOvers(rules.finalOversPerInnings ?? 10);
    setBalls(rules.ballsPerOver);
    setMaxBowler(rules.maxOversPerBowler);
    setFirst(rules.firstIllegalPenalty);
    setNext(rules.escalatedIllegalPenalty);
    setRetire(rules.retirementScore);
    setSide(rules.playersPerSide ?? 11);
  }, [rules]);

  return (
    <div className="card">
      <h3>Match scoring rules</h3>
      <p className="tiny">
        Group/round matches, knockouts, and the final can each have a different over limit.
        New fixtures pick the matching length automatically. An umpire can still shorten a match
        (rain, light) from the scoring pad. Set players per side to 8 for an 8-a-side tournament —
        the umpire must pick that many for the playing squad before a match starts.
      </p>
      <div className="grid-2" style={{ marginTop: 10 }}>
        <div>
          <label className="tiny">Group / round overs</label>
          <input className="input" type="number" min={1} value={groupOvers} onChange={(e) => setGroupOvers(Number(e.target.value))} />
        </div>
        <div>
          <label className="tiny">Knockout overs (QF / SF)</label>
          <input className="input" type="number" min={1} value={knockoutOvers} onChange={(e) => setKnockoutOvers(Number(e.target.value))} />
        </div>
        <div>
          <label className="tiny">Final overs</label>
          <input className="input" type="number" min={1} value={finalOvers} onChange={(e) => setFinalOvers(Number(e.target.value))} />
        </div>
        <div>
          <label className="tiny">Balls per over</label>
          <input className="input" type="number" min={1} value={balls} onChange={(e) => setBalls(Number(e.target.value))} />
        </div>
        <div>
          <label className="tiny">Players per side (playing squad)</label>
          <input className="input" type="number" min={2} max={15} value={side} onChange={(e) => setSide(Number(e.target.value))} />
        </div>
        <div>
          <label className="tiny">Max overs per bowler</label>
          <input className="input" type="number" min={1} value={maxBowler} onChange={(e) => setMaxBowler(Number(e.target.value))} />
        </div>
        <div>
          <label className="tiny">30-run retirement threshold</label>
          <input className="input" type="number" min={1} value={retire} onChange={(e) => setRetire(Number(e.target.value))} />
        </div>
        <div>
          <label className="tiny">First wide or no-ball in an over (runs)</label>
          <input className="input" type="number" min={0} value={first} onChange={(e) => setFirst(Number(e.target.value))} />
        </div>
        <div>
          <label className="tiny">Later wide or no-ball in that over (runs)</label>
          <input className="input" type="number" min={0} value={next} onChange={(e) => setNext(Number(e.target.value))} />
        </div>
      </div>
      <p className="tiny" style={{ marginTop: 10 }}>
        Wides and no-balls use the same extras. First in an over = +{first}, not a legal ball. Later in
        the same over = +{next} and it counts as a legal ball. Last over of an innings is simpler: a
        wide or no-ball is always +1, never a legal ball, plus whatever was scored (1+1 … 1+6). Home
        run: only a fair six on the final legal ball of a normal innings (6+6=12). A wide, no-ball,
        bye, or leg-bye on that apparent last ball is not a Home Run; wide/no-ball also keeps the
        innings going until a legal last ball. Super Overs have no home run.
      </p>
      <button
        className="btn"
        style={{ marginTop: 12 }}
        disabled={!tournamentId}
        onClick={async () => {
          try {
            await api(`/api/admin/tournaments/${tournamentId}/rules`, {
              method: "PATCH",
              body: JSON.stringify({
                oversPerInnings: groupOvers,
                groupOversPerInnings: groupOvers,
                knockoutOversPerInnings: knockoutOvers,
                finalOversPerInnings: finalOvers,
                ballsPerOver: balls,
                playersPerSide: side,
                maxOversPerBowler: maxBowler,
                firstIllegalPenalty: first,
                escalatedIllegalPenalty: next,
                retirementScore: retire,
                tieHandling: "SUPER_OVER"
              })
            });
            onSaved();
          } catch (e) {
            onError(e instanceof Error ? e.message : "Failed");
          }
        }}
      >
        Save scoring rules
      </button>
    </div>
  );
}

function CreateTournament({ onCreated, onError }: { onCreated: (id: string) => void; onError: (s: string) => void }) {
  const [name, setName] = useState("");
  const [season, setSeason] = useState("2026");
  return (
    <div className="card">
      <h3>New tournament</h3>
      <input className="input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="input" placeholder="Season" value={season} onChange={(e) => setSeason(e.target.value)} />
      <button className="btn" style={{ marginTop: 10 }} disabled={!name} onClick={async () => {
        try {
          const row = await api("/api/admin/tournaments", { method: "POST", body: JSON.stringify({ name, season, featured: true }) });
          setName("");
          onCreated(row.id);
        } catch (e) {
          onError(e instanceof Error ? e.message : "Failed");
        }
      }}>Create tournament</button>
    </div>
  );
}

function CreateVenue({ tournamentId, onCreated, onError }: { tournamentId: string; onCreated: () => void; onError: (s: string) => void }) {
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  return (
    <div className="card">
      <h3>New venue</h3>
      <input className="input" placeholder="Ground name" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="input" placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} />
      <button className="btn" style={{ marginTop: 10 }} disabled={!name || !tournamentId} onClick={async () => {
        try {
          await api("/api/admin/venues", { method: "POST", body: JSON.stringify({ tournamentId, name, city }) });
          setName("");
          setCity("");
          onCreated();
        } catch (e) {
          onError(e instanceof Error ? e.message : "Failed");
        }
      }}>Add venue</button>
    </div>
  );
}

function CreateTeam({ tournamentId, onCreated, onError }: { tournamentId: string; onCreated: () => void; onError: (s: string) => void }) {
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [city, setCity] = useState("");
  return (
    <div className="card">
      <h3>New team</h3>
      <input className="input" placeholder="Team name" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="input" placeholder="Short code (KK)" value={shortName} onChange={(e) => setShortName(e.target.value)} />
      <input className="input" placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} />
      <button className="btn" style={{ marginTop: 10 }} disabled={!name || !shortName || !tournamentId} onClick={async () => {
        try {
          await api("/api/admin/teams", { method: "POST", body: JSON.stringify({ tournamentId, name, shortName, city }) });
          setName("");
          setShortName("");
          setCity("");
          onCreated();
        } catch (e) {
          onError(e instanceof Error ? e.message : "Failed");
        }
      }}>Add team</button>
    </div>
  );
}

function CreatePlayer({ teams, onCreated, onError }: { teams: any[]; onCreated: () => void; onError: (s: string) => void }) {
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [name, setName] = useState("");
  const [role, setRole] = useState("BATSMAN");
  const [captain, setCaptain] = useState(false);
  const [wk, setWk] = useState(false);
  useEffect(() => {
    if (!teamId && teams[0]) setTeamId(teams[0].id);
  }, [teams, teamId]);
  return (
    <div className="card">
      <h3>Add player to squad</h3>
      <select className="input" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
        {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <input className="input" placeholder="Player name" value={name} onChange={(e) => setName(e.target.value)} />
      <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
        <option value="BATSMAN">Batsman</option>
        <option value="BOWLER">Bowler</option>
        <option value="ALL_ROUNDER">All-rounder</option>
        <option value="WK">Wicket-keeper</option>
      </select>
      <label className="tiny" style={{ display: "block", marginTop: 8 }}>
        <input type="checkbox" checked={captain} onChange={(e) => setCaptain(e.target.checked)} /> Captain
      </label>
      <label className="tiny" style={{ display: "block" }}>
        <input type="checkbox" checked={wk} onChange={(e) => setWk(e.target.checked)} /> Wicket-keeper
      </label>
      <button className="btn" style={{ marginTop: 10 }} disabled={!name || !teamId} onClick={async () => {
        try {
          await api("/api/admin/players", {
            method: "POST",
            body: JSON.stringify({ name, teamId, role, isCaptain: captain, isWicketKeeper: wk })
          });
          setName("");
          setCaptain(false);
          setWk(false);
          onCreated();
        } catch (e) {
          onError(e instanceof Error ? e.message : "Failed");
        }
      }}>Add player</button>
    </div>
  );
}

function CreateFixture({
  tournamentId,
  teams,
  venues,
  rules,
  defaultMaxBowler,
  onCreated,
  onError
}: {
  tournamentId: string;
  teams: any[];
  venues: any[];
  rules: any;
  defaultMaxBowler: number;
  onCreated: () => void;
  onError: (s: string) => void;
}) {
  const [team1Id, setTeam1Id] = useState("");
  const [team2Id, setTeam2Id] = useState("");
  const [venueId, setVenueId] = useState("");
  const [when, setWhen] = useState("");
  const [stage, setStage] = useState<FixtureStage>("GROUP");
  const [round, setRound] = useState("Group");
  const [overs, setOvers] = useState(6);
  const [maxBowler, setMaxBowler] = useState(defaultMaxBowler);
  useEffect(() => {
    setMaxBowler(defaultMaxBowler);
  }, [defaultMaxBowler]);
  useEffect(() => {
    const next = oversForFixture(
      {
        oversPerInnings: rules?.oversPerInnings ?? 8,
        groupOversPerInnings: rules?.groupOversPerInnings ?? rules?.oversPerInnings ?? 6,
        knockoutOversPerInnings: rules?.knockoutOversPerInnings ?? 8,
        finalOversPerInnings: rules?.finalOversPerInnings ?? 10
      },
      stage,
      round
    );
    setOvers(next);
  }, [stage, round, rules]);
  return (
    <div className="card">
      <h3>New fixture / match</h3>
      <p className="tiny">
        Overs default from the round: group {rules?.groupOversPerInnings ?? rules?.oversPerInnings ?? 6},
        knockout {rules?.knockoutOversPerInnings ?? 8}, final {rules?.finalOversPerInnings ?? 10}. You can
        still override this match.
      </p>
      <select className="input" value={team1Id} onChange={(e) => setTeam1Id(e.target.value)}>
        <option value="">Team 1</option>
        {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <select className="input" value={team2Id} onChange={(e) => setTeam2Id(e.target.value)}>
        <option value="">Team 2</option>
        {teams.filter((t) => t.id !== team1Id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <select className="input" value={venueId} onChange={(e) => setVenueId(e.target.value)}>
        <option value="">Venue</option>
        {venues.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>
      <input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      <select
        className="input"
        value={stage}
        onChange={(e) => {
          const next = e.target.value as FixtureStage;
          setStage(next);
          setRound(next === "GROUP" ? "Group" : "Semi-final");
        }}
      >
        <option value="GROUP">Group / round</option>
        <option value="KNOCKOUT">Knockout</option>
      </select>
      {stage === "KNOCKOUT" && (
        <select className="input" value={round} onChange={(e) => setRound(e.target.value)}>
          <option value="Quarter-final">Quarter-final</option>
          <option value="Semi-final">Semi-final</option>
          <option value="Final">Final</option>
        </select>
      )}
      <label className="tiny">Overs this match</label>
      <input className="input" type="number" min={1} value={overs} onChange={(e) => setOvers(Number(e.target.value))} />
      <label className="tiny">Max overs per bowler</label>
      <input className="input" type="number" min={1} value={maxBowler} onChange={(e) => setMaxBowler(Number(e.target.value))} />
      <button
        className="btn"
        style={{ marginTop: 10 }}
        disabled={!team1Id || !team2Id || team1Id === team2Id || !when}
        onClick={async () => {
          try {
            await api("/api/admin/fixtures", {
              method: "POST",
              body: JSON.stringify({
                tournamentId,
                team1Id,
                team2Id,
                venueId: venueId || undefined,
                scheduledAt: new Date(when).toISOString(),
                stage,
                round,
                oversPerInnings: overs,
                maxOversPerBowler: maxBowler
              })
            });
            onCreated();
          } catch (e) {
            onError(e instanceof Error ? e.message : "Failed");
          }
        }}
      >
        Create match
      </button>
    </div>
  );
}

function CreateUmpire({ onCreated, onError }: { onCreated: () => void; onError: (s: string) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <div className="card">
      <h3>New umpire login</h3>
      <input className="input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input className="input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <button className="btn" style={{ marginTop: 10 }} disabled={!name || !email || !password} onClick={async () => {
        try {
          await api("/api/admin/users", {
            method: "POST",
            body: JSON.stringify({ name, email, password, role: "UMPIRE" })
          });
          setName("");
          setEmail("");
          setPassword("");
          onCreated();
        } catch (e) {
          onError(e instanceof Error ? e.message : "Failed");
        }
      }}>Create umpire</button>
    </div>
  );
}

function AssignUmpire({
  users,
  matches,
  onDone,
  onError
}: {
  users: any[];
  matches: any[];
  onDone: () => void;
  onError: (s: string) => void;
}) {
  const [userId, setUserId] = useState("");
  const [matchId, setMatchId] = useState("");
  return (
    <div className="card">
      <h3>Assign umpire to match</h3>
      <select className="input" value={matchId} onChange={(e) => setMatchId(e.target.value)}>
        <option value="">Match</option>
        {matches.map((m) => (
          <option key={m.id} value={m.id}>{m.team1.shortName} vs {m.team2.shortName}</option>
        ))}
      </select>
      <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)}>
        <option value="">Umpire</option>
        {users.filter((u) => u.role === "UMPIRE" || u.role === "ADMIN").map((u) => (
          <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
        ))}
      </select>
      <button className="btn" style={{ marginTop: 10 }} disabled={!userId || !matchId} onClick={async () => {
        try {
          await api(`/api/admin/matches/${matchId}/officials`, { method: "POST", body: JSON.stringify({ userId }) });
          onDone();
        } catch (e) {
          onError(e instanceof Error ? e.message : "Failed");
        }
      }}>Assign</button>
    </div>
  );
}

function GalleryManager({ onError, onSaved }: { onError: (s: string) => void; onSaved: (s: string) => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<"SQUAD" | "TEAM">("SQUAD");
  const [imageUrl, setImageUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);

  async function reload() {
    setRows(await api("/api/gallery"));
  }
  useEffect(() => {
    reload().catch((e) => onError(e.message));
  }, []);

  async function add() {
    try {
      let imageBase64: string | undefined;
      if (file) {
        imageBase64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("Could not read photo"));
          reader.readAsDataURL(file);
        });
      }
      await api("/api/admin/gallery", {
        method: "POST",
        body: JSON.stringify({
          title,
          category,
          imageUrl: imageUrl || undefined,
          imageBase64,
          mimeType: file?.type
        })
      });
      setTitle("");
      setImageUrl("");
      setFile(null);
      await reload();
      onSaved("Photo added to the public gallery");
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not add photo");
    }
  }

  return (
    <div className="grid-2">
      <div className="card">
        <h3>Add gallery photo</h3>
        <p className="tiny">Squad and team photos slide on the public home page. Upload a file (under 2.5 MB) or paste an image URL.</p>
        <label className="tiny">Title</label>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Wolfpack squad 2026" />
        <label className="tiny">Album</label>
        <select className="input" value={category} onChange={(e) => setCategory(e.target.value as "SQUAD" | "TEAM")}>
          <option value="SQUAD">Squad</option>
          <option value="TEAM">Team</option>
        </select>
        <label className="tiny">Photo file</label>
        <input className="input" type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <label className="tiny">Or image URL</label>
        <input className="input" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" />
        <button className="btn" style={{ marginTop: 10 }} disabled={!title || (!file && !imageUrl)} onClick={add}>
          Add to gallery
        </button>
      </div>
      <div className="card">
        <h3>On the public site</h3>
        {rows.length === 0 && <p className="tiny">No photos yet.</p>}
        {rows.map((r) => (
          <div className="list-row" key={r.id}>
            <span>{r.title} <span className="tiny">· {r.category}</span></span>
            <button
              className="tiny"
              onClick={async () => {
                if (!confirm("Remove this photo?")) return;
                try {
                  await api(`/api/admin/gallery/${r.id}`, { method: "DELETE" });
                  await reload();
                  onSaved("Photo removed");
                } catch (e) {
                  onError(e instanceof Error ? e.message : "Delete failed");
                }
              }}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
