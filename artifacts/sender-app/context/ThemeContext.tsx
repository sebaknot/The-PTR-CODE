import React, {
  createContext,
  useContext,
  useMemo,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { useColorScheme } from "react-native";

/**
 * Porter design system.
 *
 * A restrained, premium palette: deep ink-navy as the primary, a champagne-gold
 * accent for moments of emphasis, and warm neutral surfaces. Every screen reads
 * from this single source so the brand stays consistent in light and dark.
 */

export type ColorScheme = {
  // Brand
  primary: string;
  primaryLight: string;
  accent: string;
  accentLight: string;

  // Surfaces
  background: string;
  surface: string;
  surfaceSecondary: string;
  border: string;

  // Text
  text: string;
  textSecondary: string;
  textTertiary: string;

  // Semantic
  success: string;
  warning: string;
  error: string;

  // Misc
  dark: string;
  tabIconDefault: string;
};

const light: ColorScheme = {
  primary: "#0E2A4A", // deep ink navy
  primaryLight: "#1B4A7A",
  accent: "#C8A452", // champagne gold
  accentLight: "#F3E9CE",

  background: "#F7F8FA", // warm off-white
  surface: "#FFFFFF",
  surfaceSecondary: "#EEF1F5",
  border: "#E2E7EE",

  text: "#0C1826", // near-black ink
  textSecondary: "#556274",
  textTertiary: "#8A97A6",

  success: "#0F7A52",
  warning: "#B7791F",
  error: "#B42318",

  dark: "#0B0E13",
  tabIconDefault: "#9AA6B3",
};

const dark: ColorScheme = {
  primary: "#5B8FD0", // luminous navy for dark surfaces
  primaryLight: "#7BA8DE",
  accent: "#D8B75F",
  accentLight: "#3A3320",

  background: "#0B0E13", // ink
  surface: "#141922",
  surfaceSecondary: "#1E2530",
  border: "#28303C",

  text: "#F2F5F9",
  textSecondary: "#A9B4C1",
  textTertiary: "#727F8D",

  success: "#3BB88A",
  warning: "#E0A64B",
  error: "#E57368",

  dark: "#05070A",
  tabIconDefault: "#6B7684",
};

type ThemeMode = "light" | "dark" | "system";

type ThemeContextValue = {
  colors: ColorScheme;
  isDark: boolean;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const systemScheme = useColorScheme();
  const [mode, setMode] = useState<ThemeMode>("system");

  const isDark = mode === "system" ? systemScheme === "dark" : mode === "dark";

  const toggleTheme = useCallback(() => {
    setMode(isDark ? "light" : "dark");
  }, [isDark]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      colors: isDark ? dark : light,
      isDark,
      mode,
      setMode,
      toggleTheme,
    }),
    [isDark, mode, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}

/** Convenience hook returning just the active color palette. */
export function useColors(): ColorScheme {
  return useTheme().colors;
}

export const Palettes = { light, dark };
