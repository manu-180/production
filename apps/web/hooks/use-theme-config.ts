"use client";

import { apiClient } from "@/lib/api-client";
import { qk } from "@/lib/react-query/keys";
import type { ColorTheme } from "@/lib/validators/settings";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

export type { ColorTheme };

interface SettingsWithColorTheme {
  color_theme?: string;
}

const COLOR_THEME_CLASSES = ["theme-midnight", "theme-solarized"] as const;

function applyThemeClass(theme: ColorTheme): void {
  const root = document.documentElement;
  for (const cls of COLOR_THEME_CLASSES) {
    root.classList.remove(cls);
  }
  if (theme !== "conductor-classic") {
    root.classList.add(`theme-${theme}`);
  }
}

function isColorTheme(value: unknown): value is ColorTheme {
  return value === "conductor-classic" || value === "midnight" || value === "solarized";
}

export function useThemeConfig(): {
  theme: ColorTheme;
  setTheme: (t: ColorTheme) => void;
  isPending: boolean;
} {
  const qc = useQueryClient();

  const { data } = useQuery<SettingsWithColorTheme>({
    queryKey: qk.settings.detail(),
    queryFn: ({ signal }) => apiClient.get<SettingsWithColorTheme>("/api/settings", { signal }),
    staleTime: 60_000,
  });

  const theme: ColorTheme = isColorTheme(data?.color_theme)
    ? data.color_theme
    : "conductor-classic";

  // Apply CSS class whenever theme changes
  useEffect(() => {
    applyThemeClass(theme);
  }, [theme]);

  const mutation = useMutation({
    mutationFn: (newTheme: ColorTheme) =>
      apiClient.patch("/api/settings", { color_theme: newTheme }),
    onMutate: async (newTheme) => {
      await qc.cancelQueries({ queryKey: qk.settings.detail() });
      const prev = qc.getQueryData<SettingsWithColorTheme>(qk.settings.detail());
      qc.setQueryData(qk.settings.detail(), (old: SettingsWithColorTheme | undefined) => ({
        ...old,
        color_theme: newTheme,
      }));
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev !== undefined) {
        qc.setQueryData(qk.settings.detail(), context.prev);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.settings.detail() });
    },
  });

  return {
    theme,
    setTheme: (t: ColorTheme) => mutation.mutate(t),
    isPending: mutation.isPending,
  };
}
