// The theme system from the design: day / evening / night, plus "follow the
// clock" which auto-resolves by hour. Each theme is a set of CSS custom
// properties (background scene + text + glass) that the whole app reads through
// var(--…). The chosen theme is persisted so it survives reloads.
//
// The visible theme switcher lives on the Settings screen (a later step); this
// module is the shared engine it will call. Default is night.

import { createContext, useContext, useMemo, useState } from 'react';

const ACCENT = '#8B7FE8';

// Background scene + text + glass values, lifted verbatim from the design tokens.
const PALETTES = {
  night: {
    '--text': '#edeffa',
    '--dim': 'rgba(237,239,250,0.72)',
    '--panel': 'rgba(24,26,48,0.55)',
    '--solid': 'rgba(19,21,40,0.9)',
    '--border': 'rgba(255,255,255,0.1)',
    '--field': 'rgba(255,255,255,0.06)',
    '--sky': 'linear-gradient(180deg,#06070f 0%,#10102a 50%,#221b40 100%)',
    '--m1': '#241d44',
    '--m2': '#171231',
    '--m3': '#0c0a20',
    '--star': '0.9',
    '--orb': '#dfe3ff',
    '--orbGlow': 'rgba(190,196,255,0.5)',
    '--orbOp': '1',
    '--haze': 'linear-gradient(180deg,transparent 60%,rgba(10,11,26,0.4) 100%)',
  },
  evening: {
    '--text': '#f4eef1',
    '--dim': 'rgba(244,238,241,0.66)',
    '--panel': 'rgba(48,32,52,0.5)',
    '--solid': 'rgba(40,26,46,0.84)',
    '--border': 'rgba(255,255,255,0.12)',
    '--field': 'rgba(255,255,255,0.07)',
    '--sky': 'linear-gradient(180deg,#1c1638 0%,#4a2b50 50%,#c47556 100%)',
    '--m1': '#3a2348',
    '--m2': '#281634',
    '--m3': '#1a0e26',
    '--star': '0.4',
    '--orb': '#ffd6a3',
    '--orbGlow': 'rgba(255,180,120,0.55)',
    '--orbOp': '1',
    '--haze': 'linear-gradient(180deg,transparent 55%,rgba(180,100,70,0.25) 100%)',
  },
  day: {
    '--text': '#1d2440',
    '--dim': 'rgba(29,36,64,0.58)',
    '--panel': 'rgba(255,255,255,0.55)',
    '--solid': 'rgba(255,255,255,0.9)',
    '--border': 'rgba(29,36,64,0.12)',
    '--field': 'rgba(29,36,64,0.05)',
    '--sky': 'linear-gradient(180deg,#9fc6f2 0%,#c4dff5 48%,#e8f2fb 100%)',
    '--m1': '#a9c4e0',
    '--m2': '#bcd2e8',
    '--m3': '#d3e3f1',
    '--star': '0',
    '--orb': '#fff6d4',
    '--orbGlow': 'rgba(255,238,170,0.7)',
    '--orbOp': '1',
    '--haze': 'linear-gradient(180deg,transparent 60%,rgba(232,242,251,0.5) 100%)',
  },
};

// The themes a user can pick (the value 'auto' resolves by hour).
export const THEME_OPTIONS = ['day', 'evening', 'night', 'auto'];

export function resolveTheme(theme) {
  if (theme !== 'auto') return theme;
  const h = new Date().getHours();
  if (h >= 6 && h < 17) return 'day';
  if (h >= 17 && h < 20) return 'evening';
  return 'night';
}

// Build the full inline-style object (accent + status + the resolved palette) to
// drop on the app root so everything below reads the right var(--…).
export function themeVars(theme) {
  const palette = PALETTES[resolveTheme(theme)] || PALETTES.night;
  return {
    '--accent': ACCENT,
    '--glow': `0 0 20px ${ACCENT}88`,
    '--glowSoft': `0 0 40px ${ACCENT}33`,
    '--accentBorder': `${ACCENT}55`,
    '--accentField': `${ACCENT}1f`,
    '--amber': '#E5A26F',
    '--amberBorder': 'rgba(229,162,111,0.4)',
    '--amberField': 'rgba(229,162,111,0.12)',
    ...palette,
  };
}

const STORAGE_KEY = 'stride-theme';
const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || 'night';
    } catch {
      return 'night';
    }
  });

  function setTheme(next) {
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore storage failures (private mode, etc.)
    }
  }

  const vars = useMemo(() => themeVars(theme), [theme]);
  const value = useMemo(() => ({ theme, setTheme, vars }), [theme, vars]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
