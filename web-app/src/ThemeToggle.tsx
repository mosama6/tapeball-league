import { useEffect, useState } from "react";
import { applyTheme, getTheme, toggleTheme, type Theme } from "./brand";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => {
    const t = getTheme();
    applyTheme(t);
    setTheme(t);
  }, []);
  return (
    <button
      className="theme-toggle"
      type="button"
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => setTheme(toggleTheme())}
    >
      {theme === "dark" ? "Light" : "Dark"}
    </button>
  );
}
