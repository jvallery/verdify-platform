// SPDX-License-Identifier: MIT
import { createContext, useCallback, useContext, useId, useMemo, useState, type ReactNode } from "react";
import { THEMES, applyTheme, type Theme } from "../../lib/theme";

type ThemeState = { readonly theme: Theme; readonly setTheme: (theme: Theme) => void };
const ThemeContext = createContext<ThemeState>({ theme: "system", setTheme: (theme) => applyTheme(theme) });

/**
 * The page's theme, starting from what the root loader read from the cookie, so the switch's server markup matches the
 * `data-theme` the server put on `<html>`. Every switch on the page (the rail's, the More sheet's) shares it.
 */
export function ThemeProvider({ initial, children }: { initial: Theme; children?: ReactNode }) {
  const [theme, setState] = useState<Theme>(initial);
  const setTheme = useCallback((next: Theme) => { setState(next); applyTheme(next); }, []);
  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
export const useTheme = (): ThemeState => useContext(ThemeContext);

const LABELS: Readonly<Record<Theme, string>> = { system: "System", light: "Light", dark: "Dark" };

/**
 * System, Light and Dark as one segmented control: native radios in a fieldset named Theme, so arrows move between them
 * and a screen reader hears the choice. A change applies at once: the cookie, `data-theme`, and the `verdify:theme`
 * event (lib/theme.ts).
 */
export function ThemeSwitch({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const name = useId();
  return <fieldset className={className ? `theme-switch ${className}` : "theme-switch"}>
    <legend className="theme-switch-legend">Theme</legend>
    <div className="theme-switch-options">
      {THEMES.map((option) => <label key={option} className="theme-switch-option">
        <input type="radio" name={name} value={option} checked={theme === option} onChange={() => setTheme(option)} />
        <span>{LABELS[option]}</span>
      </label>)}
    </div>
  </fieldset>;
}
