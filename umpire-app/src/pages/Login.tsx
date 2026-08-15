import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, setToken } from "../api";

export function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState("umpire@wolfpackcricket.com");
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const data = await api.login(email, password);
      setToken(data.token);
      nav("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }

  return (
    <form className="stack" onSubmit={onSubmit}>
      <h1 className="page-title">Wolfpack umpire</h1>
      <div>
        <label>Email</label>
        <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <label>Password</label>
        <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error && <p className="error">{error}</p>}
      <button className="btn lime" type="submit">
        Enter ground
      </button>
      <p className="tiny">Demo: umpire@wolfpackcricket.com / password123</p>
    </form>
  );
}
