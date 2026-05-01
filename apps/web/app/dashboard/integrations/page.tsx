"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiClientError, apiClient } from "@/lib/api-client";
import { qk } from "@/lib/react-query/keys";
import type { IntegrationRow, Provider } from "@/lib/validators/integrations";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2Icon, CircleIcon, Loader2Icon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

// ── Brand icons (inline SVG, monochrome) ─────────────────────────────────────

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

function SlackIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.122 2.521a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.268 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zm-2.523 10.122a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.268a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
    </svg>
  );
}

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.1 18.08.11 18.1.12 18.12a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.96 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}

// ── Provider metadata ─────────────────────────────────────────────────────────

interface ProviderMeta {
  provider: Provider;
  label: string;
  description: string;
  Icon: (props: { className?: string }) => React.ReactElement;
  fields: FieldDef[];
}

interface FieldDef {
  key: string;
  label: string;
  placeholder: string;
  type?: "password" | "text";
}

const PROVIDERS: ProviderMeta[] = [
  {
    provider: "github",
    label: "GitHub",
    description: "Connect GitHub to create pull requests and issues from run results.",
    Icon: GitHubIcon,
    fields: [
      {
        key: "pat",
        label: "Personal Access Token",
        placeholder: "ghp_••••••••••••••••••••",
        type: "password",
      },
    ],
  },
  {
    provider: "slack",
    label: "Slack",
    description: "Receive run notifications directly in a Slack channel.",
    Icon: SlackIcon,
    fields: [
      {
        key: "webhook_url",
        label: "Webhook URL",
        placeholder: "https://hooks.slack.com/services/…",
      },
    ],
  },
  {
    provider: "discord",
    label: "Discord",
    description: "Post run results to a Discord channel via webhook.",
    Icon: DiscordIcon,
    fields: [
      {
        key: "webhook_url",
        label: "Webhook URL",
        placeholder: "https://discord.com/api/webhooks/…",
      },
    ],
  },
  {
    provider: "telegram",
    label: "Telegram",
    description: "Send run notifications to a Telegram chat using a bot.",
    Icon: TelegramIcon,
    fields: [
      {
        key: "bot_token",
        label: "Bot Token",
        placeholder: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
        type: "password",
      },
      {
        key: "chat_id",
        label: "Chat ID",
        placeholder: "-1001234567890",
      },
    ],
  },
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface TestResult {
  success: boolean;
  message: string;
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function IntegrationsPage() {
  const qc = useQueryClient();

  const query = useQuery<IntegrationRow[]>({
    queryKey: qk.integrations.list(),
    queryFn: ({ signal }) =>
      apiClient.get<IntegrationRow[]>("/api/provider-integrations", { signal }),
  });

  const saveMutation = useMutation({
    mutationFn: (payload: { provider: Provider; config: Record<string, string> }) =>
      apiClient.post<IntegrationRow>("/api/provider-integrations", {
        provider: payload.provider,
        config: payload.config,
      }),
    onSuccess: (data) => {
      toast.success(`${data.provider} integration saved.`);
      qc.setQueryData<IntegrationRow[]>(qk.integrations.list(), (prev) => {
        if (!prev) return [data];
        const idx = prev.findIndex((r) => r.provider === data.provider);
        if (idx === -1) return [...prev, data];
        return prev.map((r) => (r.provider === data.provider ? data : r));
      });
    },
    onError: (err) => {
      const isApi = err instanceof ApiClientError;
      toast.error(isApi ? err.message : "Failed to save integration", {
        description: isApi ? `Trace: ${err.traceId}` : undefined,
      });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/api/provider-integrations/${id}`),
    onSuccess: (_, id) => {
      toast.success("Integration removed.");
      qc.setQueryData<IntegrationRow[]>(qk.integrations.list(), (prev) =>
        prev ? prev.filter((r) => r.id !== id) : [],
      );
    },
    onError: (err) => {
      const isApi = err instanceof ApiClientError;
      toast.error(isApi ? err.message : "Failed to remove integration");
    },
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => apiClient.post<TestResult>(`/api/provider-integrations/${id}/test`),
    onSuccess: (result) => {
      if (result.success) {
        toast.success("Connection test passed", { description: result.message });
      } else {
        toast.error("Connection test failed", { description: result.message });
      }
    },
    onError: (err) => {
      const isApi = err instanceof ApiClientError;
      toast.error(isApi ? err.message : "Test failed");
    },
  });

  if (query.isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
            Integrations
          </h1>
          <p className="text-sm text-muted-foreground">
            Connect external services to enhance your workflow.
          </p>
        </header>
        {[1, 2, 3, 4].map((n) => (
          <Card key={n}>
            <CardContent className="space-y-3 p-6">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-5 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
            Integrations
          </h1>
        </header>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm text-muted-foreground">Failed to load integrations.</p>
            <Button size="sm" variant="outline" onClick={() => query.refetch()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const rows = query.data ?? [];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
          Integrations
        </h1>
        <p className="text-sm text-muted-foreground">
          Connect external services to enhance your workflow.
        </p>
      </header>

      {PROVIDERS.map((meta) => {
        const existing = rows.find((r) => r.provider === meta.provider) ?? null;
        return (
          <IntegrationCard
            key={meta.provider}
            meta={meta}
            existing={existing}
            isSaving={saveMutation.isPending && saveMutation.variables?.provider === meta.provider}
            isRemoving={removeMutation.isPending && removeMutation.variables === existing?.id}
            isTesting={testMutation.isPending && testMutation.variables === existing?.id}
            onSave={(config) => saveMutation.mutate({ provider: meta.provider, config })}
            onRemove={() => {
              if (existing) removeMutation.mutate(existing.id);
            }}
            onTest={() => {
              if (existing) testMutation.mutate(existing.id);
            }}
          />
        );
      })}
    </div>
  );
}

// ── Integration card ──────────────────────────────────────────────────────────

interface IntegrationCardProps {
  meta: ProviderMeta;
  existing: IntegrationRow | null;
  isSaving: boolean;
  isRemoving: boolean;
  isTesting: boolean;
  onSave: (config: Record<string, string>) => void;
  onRemove: () => void;
  onTest: () => void;
}

function IntegrationCard({
  meta,
  existing,
  isSaving,
  isRemoving,
  isTesting,
  onSave,
  onRemove,
  onTest,
}: IntegrationCardProps) {
  const { Icon, label, description, fields, provider } = meta;

  // Initialize local draft from existing config or empty strings
  const initialDraft = (): Record<string, string> => {
    if (!existing) return Object.fromEntries(fields.map((f) => [f.key, ""]));
    const config = existing.config as Record<string, unknown>;
    return Object.fromEntries(
      fields.map((f) => [
        f.key,
        typeof config[f.key] === "string" ? (config[f.key] as string) : "",
      ]),
    );
  };

  const [draft, setDraft] = useState<Record<string, string>>(initialDraft);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const isConnected = existing?.enabled ?? false;

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    onSave(draft);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start gap-4 space-y-0 p-6 pb-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-foreground">
          <Icon className="size-5" />
        </div>
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="font-heading text-base font-semibold">{label}</h2>
            {isConnected ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">
                <CheckCircle2Icon className="size-3" aria-hidden="true" />
                Connected
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                <CircleIcon className="size-3" aria-hidden="true" />
                Not configured
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </CardHeader>

      <CardContent className="px-6 pb-6">
        <form onSubmit={handleSave} className="space-y-4">
          {fields.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={`${provider}-${field.key}`}>{field.label}</Label>
              <Input
                id={`${provider}-${field.key}`}
                type={field.type ?? "text"}
                value={draft[field.key] ?? ""}
                onChange={(e) => setDraft((prev) => ({ ...prev, [field.key]: e.target.value }))}
                placeholder={field.placeholder}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button type="submit" size="sm" disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2Icon className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
                  Saving…
                </>
              ) : (
                "Save"
              )}
            </Button>

            {existing && (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isTesting}
                  onClick={onTest}
                >
                  {isTesting ? (
                    <>
                      <Loader2Icon className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
                      Testing…
                    </>
                  ) : (
                    "Test"
                  )}
                </Button>

                {confirmRemove ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Remove?</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={isRemoving}
                      onClick={() => {
                        onRemove();
                        setConfirmRemove(false);
                      }}
                    >
                      {isRemoving ? (
                        <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        "Confirm"
                      )}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmRemove(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setConfirmRemove(true)}
                    aria-label={`Remove ${label} integration`}
                  >
                    <Trash2Icon className="size-3.5" aria-hidden="true" />
                    <span className="ml-1.5">Remove</span>
                  </Button>
                )}
              </>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
