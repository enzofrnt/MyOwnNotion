import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export const THEME_STORAGE_KEY = "myownnotion.theme";
export const THEME_MEDIA_QUERY = "(prefers-color-scheme: dark)";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = Exclude<ThemePreference, "system">;

export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ThemeRoot {
  readonly dataset: Record<string, string | undefined>;
  readonly style: { colorScheme: string };
}

export interface ThemeContextValue {
  readonly preference: ThemePreference;
  readonly resolvedTheme: ResolvedTheme;
  readonly setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function normalizeThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === "system") {
    return systemPrefersDark ? "dark" : "light";
  }
  return preference;
}

export function readThemePreference(storage: ThemeStorage | null): ThemePreference {
  if (storage === null) {
    return "system";
  }
  try {
    return normalizeThemePreference(storage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function persistThemePreference(
  storage: ThemeStorage | null,
  preference: ThemePreference,
): boolean {
  if (storage === null) {
    return false;
  }
  try {
    storage.setItem(THEME_STORAGE_KEY, preference);
    return true;
  } catch {
    return false;
  }
}

export function applyThemeToRoot(
  root: ThemeRoot,
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  const resolvedTheme = resolveTheme(preference, systemPrefersDark);
  root.dataset["themePreference"] = preference;
  root.dataset["theme"] = resolvedTheme;
  root.style.colorScheme = resolvedTheme;
  return resolvedTheme;
}

function getBrowserStorage(): ThemeStorage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function browserPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(THEME_MEDIA_QUERY).matches;
}

function initialPreference(): ThemePreference {
  if (typeof document !== "undefined") {
    const bootstrapped = document.documentElement.dataset["themePreference"];
    if (bootstrapped !== undefined) {
      return normalizeThemePreference(bootstrapped);
    }
  }
  return readThemePreference(getBrowserStorage());
}

export interface ThemeProviderProps {
  readonly children: ReactNode;
  /** Allows deterministic rendering in the UI lab and server-side tests. */
  readonly initialTheme?: ThemePreference;
}

export function ThemeProvider({ children, initialTheme }: ThemeProviderProps) {
  const [preference, setPreferenceState] = useState<ThemePreference>(
    () => initialTheme ?? initialPreference(),
  );
  const [systemPrefersDark, setSystemPrefersDark] = useState(browserPrefersDark);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const media = window.matchMedia(THEME_MEDIA_QUERY);
    const onChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches);
    setSystemPrefersDark(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    persistThemePreference(getBrowserStorage(), preference);
    if (typeof document !== "undefined") {
      applyThemeToRoot(document.documentElement, preference, systemPrefersDark);
    }
  }, [preference, systemPrefersDark]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY) {
        setPreferenceState(normalizeThemePreference(event.newValue));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setPreference = useCallback((nextPreference: ThemePreference) => {
    persistThemePreference(getBrowserStorage(), nextPreference);
    if (typeof document !== "undefined") {
      applyThemeToRoot(document.documentElement, nextPreference, browserPrefersDark());
    }
    setPreferenceState(nextPreference);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      resolvedTheme: resolveTheme(preference, systemPrefersDark),
      setPreference,
    }),
    [preference, setPreference, systemPrefersDark],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === null) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }
  return context;
}
