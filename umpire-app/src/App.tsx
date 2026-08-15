import type { ReactNode } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { getToken } from "./api";
import { Login } from "./pages/Login";
import { Matches } from "./pages/Matches";
import { Setup } from "./pages/Setup";
import { Score } from "./pages/Score";
import { WolfLogo } from "./brand";
import { ThemeToggle } from "./ThemeToggle";

function Guard({ children }: { children: ReactNode }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  const nav = useNavigate();
  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => nav("/")}>
          <span className="mark"><WolfLogo /></span>
          <span className="brand-copy">
            <strong>Wolfpack</strong>
            <span>Umpire</span>
          </span>
        </button>
        <ThemeToggle />
      </header>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Guard><Matches /></Guard>} />
        <Route path="/matches/:id/setup" element={<Guard><Setup /></Guard>} />
        <Route path="/matches/:id" element={<Guard><Score /></Guard>} />
      </Routes>
    </div>
  );
}
