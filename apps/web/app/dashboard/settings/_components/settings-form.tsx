"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ApiClientError, apiClient } from "@/lib/api-client";
import { qk } from "@/lib/react-query/keys";

interface SettingsRow {
  user_id: string;
  theme: "light" | "dark" | "system";
  auto_approve_low_risk: boolean;
  default_model: string;
  git_auto_commit: boolean;
  git_auto_push: boolean;
  notification_channels: Record<string, unknown>;
  updated_at: string | null;
}

type Patch = Partial<Pick<SettingsRow, "theme" | "auto_approve_low_risk" | "default_model" | "git_auto_commit" | "git_auto_push">>;

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
    mutationFn: (patch: Patch) =>
      apiClient.patch<SettingsRow>("/api/settings", patch),
    onSuccess: (data) => {
      toast.success("Settings saved");
      qc.setQueryData(qk.settings.detail(), data);
    },
    onError: (err) => {
      const isApi = err instanceof ApiClientError;
      toast.error(isApi ? err.message : "Failed to save settings", {
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
          <p className="text-sm text-muted-foreground">Failed to load settings.</p>
          <Button size="sm" variant="outline" onClick={() => query.refetch()}>
            Retry
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
            <Label htmlFor="default-model">Default model</Label>
            <Input
              id="default-model"
              value={draft.default_model ?? ""}
              onChange={(e) =>
                setDraft({ ...draft, default_model: e.target.value })
              }
              placeholder="sonnet | opus | haiku"
              maxLength={100}
            />
            <p className="text-xs text-muted-foreground">
              Model used by default when launching runs. Override per plan if needed.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Theme</Label>
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

      <Card>
        <CardContent className="space-y-5 p-6">
          <h3 className="font-heading text-base font-semibold">Automation</h3>
          <ToggleRow
            label="Auto-approve low-risk decisions"
            description="Let the Guardian auto-decide low-risk prompts without surfacing approval modals."
            checked={!!draft.auto_approve_low_risk}
            onChange={(v) => setDraft({ ...draft, auto_approve_low_risk: v })}
          />
          <ToggleRow
            label="Auto-commit after each prompt"
            description="Create a checkpoint commit on the run branch after each successful prompt."
            checked={!!draft.git_auto_commit}
            onChange={(v) => setDraft({ ...draft, git_auto_commit: v })}
          />
          <ToggleRow
            label="Auto-push run branches"
            description="Push the run branch to origin once the run completes."
            checked={!!draft.git_auto_push}
            onChange={(v) => setDraft({ ...draft, git_auto_push: v })}
          />
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <span className="text-xs text-muted-foreground">
          {query.data?.updated_at
            ? `Last saved ${new Date(query.data.updated_at).toLocaleString()}`
            : "Never saved"}
        </span>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Saving…" : "Save changes"}
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
