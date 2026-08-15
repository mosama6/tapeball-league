import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

export function Matches() {
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api.matches().then(setRows).catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <h1 className="page-title">Assigned matches</h1>
      {error && <p className="error">{error}</p>}
      <div className="list">
        {rows.map((m) => {
          const live = ["FIRST_INNINGS", "SECOND_INNINGS", "INNINGS_BREAK", "SUPER_OVER"].includes(m.status);
          const href = ["SCHEDULED", "TOSS", "PLAYING_XI_CONFIRMED"].includes(m.status)
            ? `/matches/${m.id}/setup`
            : `/matches/${m.id}`;
          return (
            <Link key={m.id} to={href} className="card match-card">
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span className={`pill ${live ? "live" : ""}`}>{m.status.replaceAll("_", " ")}</span>
                <span className="tiny">{m.venue?.name}</span>
              </div>
              <h3>
                {m.team1.shortName} vs {m.team2.shortName}
              </h3>
              <p className="tiny">
                {m.team1.name} · {m.team2.name}
              </p>
            </Link>
          );
        })}
        {rows.length === 0 && !error && <p className="tiny">No matches assigned.</p>}
      </div>
    </div>
  );
}
