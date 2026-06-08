// =============================================================================
// Theme preview (TEST-ONLY) — lets us A/B four green/turquoise palettes derived
// from the lobby background image. Each id matches a class in index.css that
// overrides the design-system CSS variables on <html>. Delete this module, the
// switcher component, and the .theme-* blocks once a palette is chosen.
// =============================================================================

export interface PreviewTheme {
  id: string;
  name: string;
  /** Indicator swatch (approx of the theme's primary/accent). */
  swatch: string;
}

export const PREVIEW_THEMES: PreviewTheme[] = [
  { id: 'theme-turquoise', name: 'Turquoise', swatch: '#15c2c4' },
  { id: 'theme-emerald', name: 'Emerald', swatch: '#1fb588' },
  { id: 'theme-teal-gold', name: 'Teal & Gold', swatch: '#e0a82e' },
  { id: 'theme-jade', name: 'Jade', swatch: '#2da86c' },
];

export const THEME_STORAGE_KEY = 'acquire_theme_preview';
export const DEFAULT_THEME_ID = 'theme-turquoise';

const VALID_IDS = new Set(PREVIEW_THEMES.map((t) => t.id));

export function getStoredThemeId(): string {
  // Allow #theme-<id> in the URL to force a palette (handy for previewing).
  try {
    const hash = window.location.hash.slice(1);
    if (VALID_IDS.has(hash)) return hash;
  } catch {
    /* ignore */
  }
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored && VALID_IDS.has(stored)) return stored;
  } catch {
    /* ignore */
  }
  return DEFAULT_THEME_ID;
}

/** Swap the active theme class on <html> and persist the choice. */
export function applyTheme(id: string): void {
  const html = document.documentElement;
  for (const t of PREVIEW_THEMES) html.classList.remove(t.id);
  html.classList.add(id);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}
