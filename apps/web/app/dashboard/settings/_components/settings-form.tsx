"use client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { type ColorTheme, useThemeConfig } from "@/hooks/use-theme-config";
import { ApiClientError, apiClient } from "@/lib/api-client";
import { qk } from "@/lib/react-query/keys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

interface SettingsRow {
  user_id: string;
  theme: "light" | "dark" | "system";
  color_theme: ColorTheme;
  auto_approve_low_risk: boolean;
  default_model: string;
  git_auto_commit: boolean;
  git_auto_push: boolean;
  notification_channels: Record<string, unknown>;
  updated_at: string | null;
}

type Patch = Partial<
  Pick<
    SettingsRow,
    "theme" | "auto_approve_low_risk" | "default_model" | "git_auto_commit" | "git_auto_push"
  >
>;

export function SettingsForm() {
  const qc = useQueryClient();
  const query = useQuery<SettingsRow>({
    queryKey: qk.settings.detail(),
    queryFn: ({ signal }) => apiClient.get<SettingsRow>("/api/settings", { signal }),
  });

  const [draft, setDraft] = useState<Patch | null>(null);

  useEffect(() => {
    if (query.data && draft === null) {
      setDraft({
        theme: query.data.theme,
        auto_approve_low_risk: query.data.auto_approve_low_risk,
        default_model: query.data.default_model,
        git_auto_commit: query.data.git_auto_commit,
        git_auto_push: query.data.git_auto_push,
      });
    }
  }, [query.data, draft]);

  const mutation = useMutation({
    mutationFn: (patch: Patch) => apiClient.patch<SettingsRow>("/api/settings", patch),
    onSuccess: (data) => {
      toast.success("Configuración guardada");
      qc.setQueryData(qk.settings.detail(), data);
    },
    onError: (err) => {
      const isApi = err instanceof ApiClientError;
      toast.error(isApi ? err.message : "Error al guardar la configuración", {
        description: isApi ? `Trace: ${err.traceId}` : undefined,
      });
    },
  });

  if (query.isLoading || draft === null) {
    return (
      <Card>
        <CardContent className="space-y-4 p-6">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (query.isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm text-muted-foreground">Error al cargar la configuración.</p>
          <Button size="sm" variant="outline" onClick={() => query.refetch()}>
            Reintentar
          </Button>
        </CardContent>
      </Card>
    );
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (draft === null) return;
    mutation.mutate(draft);
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <Card>
        <CardContent className="space-y-5 p-6">
          <div className="space-y-2">
            <Label htmlFor="default-model">Modelo predeterminado</Label>
            <Input
              id="default-model"
              value={draft.default_model ?? ""}
              onChange={(e) => setDraft({ ...draft, default_model: e.target.value })}
              placeholder="sonnet | opus | haiku"
              maxLength={100}
            />
            <p className="text-xs text-muted-foreground">
              Modelo utilizado por defecto al lanzar ejecuciones. Podés sobreescribirlo por plan si
              es necesario.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Modo</Label>
            <div className="flex flex-wrap gap-2">
              {(["light", "dark", "system"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setDraft({ ...draft, theme: t })}
                  className={`rounded-md border px-3 py-1.5 text-xs capitalize transition-colors ${
                    draft.theme === t
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <AppearanceSection />

      <Card>
        <CardContent className="space-y-5 p-6">
          <h3 className="font-heading text-base font-semibold">Automatización</h3>
          <ToggleRow
            label="Aprobar automáticamente decisiones de bajo riesgo"
            description="Permitir que el Guardian decida automáticamente los prompts de bajo riesgo sin mostrar modales de aprobación."
            checked={!!draft.auto_approve_low_risk}
            onChange={(v) => setDraft({ ...draft, auto_approve_low_risk: v })}
          />
          <ToggleRow
            label="Commit automático después de cada prompt"
            description="Crear un commit de checkpoint en la rama de ejecución después de cada prompt exitoso."
            checked={!!draft.git_auto_commit}
            onChange={(v) => setDraft({ ...draft, git_auto_commit: v })}
          />
          <ToggleRow
            label="Push automático de ramas de ejecución"
            description="Subir la rama de ejecución al origen una vez que la ejecución se completa."
            checked={!!draft.git_auto_push}
            onChange={(v) => setDraft({ ...draft, git_auto_push: v })}
          />
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <span className="text-xs text-muted-foreground">
          {query.data?.updated_at
            ? `Guardado por última vez ${new Date(query.data.updated_at).toLocaleString()}`
            : "Nunca guardado"}
        </span>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Guardando…" : "Guardar cambios"}
        </Button>
      </div>
    </form>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-0.5">
        <Label className="text-sm font-medium">{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

// ─── Appearance / color theme section ────────────────────────────────────────

interface ThemeOption {
  value: ColorTheme;
  label: string;
  /** oklch primary color for the preview swatch */
  swatch: string;
  description: string;
}

const THEME_OPTIONS: ThemeOption[] = [
  {
    value: "conductor-classic",
    label: "Conductor Classic",
    swatch: "oklch(0.205 0 0)",
    description: "Paleta monocromática predeterminada",
  },
  {
    value: "midnight",
    label: "Midnight",
    swatch: "oklch(0.55 0.2 264)",
    description: "Índigo y violeta profundos",
  },
  {
    value: "solarized",
    label: "Solarized",
    swatch: "oklch(0.75 0.18 80)",
    description: "Ámbar cálido y teal",
  },
];

function AppearanceSection() {
  const { theme, setTheme, isPending } = useThemeConfig();

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <h3 className="font-heading text-base font-semibold">Apariencia</h3>
        <fieldset className="space-y-2" disabled={isPending}>
          <legend className="text-sm font-medium leading-none">Tema de color</legend>
          <p className="text-xs text-muted-foreground">
            Cambia los colores de acento primarios en toda la interfaz. Funciona tanto en modo claro
            como oscuro.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {THEME_OPTIONS.map((opt) => {
              const isSelected = theme === opt.value;
              return (
                <label
                  key={opt.value}
                  className={`flex cursor-pointer flex-col gap-3 rounded-lg border p-4 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 ${
                    isSelected
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-muted-foreground/40 hover:bg-muted/40"
                  }`}
                >
                  <input
                    type="radio"
                    name="color-theme"
                    value={opt.value}
                    checked={isSelected}
                    onChange={() => setTheme(opt.value)}
                    className="sr-only"
                  />
                  <span
                    aria-hidden="true"
                    className="block size-8 rounded-full border border-black/10 dark:border-white/10"
                    style={{ backgroundColor: opt.swatch }}
                  />
                  <span className="space-y-0.5">
                    <span
                      className={`block text-sm font-medium ${isSelected ? "text-primary" : "text-foreground"}`}
                    >
                      {opt.label}
                    </span>
                    <span className="block text-xs text-muted-foreground">{opt.description}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </CardContent>
    </Card>
  );
}
