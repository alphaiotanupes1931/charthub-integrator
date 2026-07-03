import { useEffect, useState } from "react";

export type Theme = "dark" | "light";
const KEY = "trademind.theme";

function apply(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("light", theme === "light");
  root.classList.toggle("dark", theme === "dark");
}

export function useTheme() {
  // Always boot in dark mode on every fresh load. The toggle still works
  // for the current session, but reloading the site resets to dark.
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    apply(theme);
  }, [theme]);


  return {
    theme,
    setTheme,
    toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")),
  };
}
