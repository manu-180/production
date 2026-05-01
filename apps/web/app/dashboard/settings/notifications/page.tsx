"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiClientError, apiClient } from "@/lib/api-client";
import { qk } from "@/lib/react-query/keys";
import type { NotificationPreference } from "@conductor/db";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { toast } from "sonner";
import { SettingsNav } from "../_components/settings-nav";

// ─── Constants ────────────────────────────────────────────────────────────────

const EVENT_LABELS: Record<string, string> = {
  "run.completed": "Run completed",
  "run.failed": "Run failed",
  "auth.invalid": "Auth token invalid",
  "circuit.open": "Circuit breaker opened",
  "rate_limit.long": "Long rate limit wait",
  "approval.required": "Approval required",
  "cost.threshold": "Monthly cost threshold",
};

const CHANNEL_LABELS: Record<string, string> = {
  desktop: "Desktop",
  email: "Email",
  slack: "Slack",
  discord: "Discord",
  telegram: "Telegram",
};

const EVENT_TYPES = Object.keys(EVENT_LABELS) as Array<keyof typeof EVENT_LABELS>;
const CHANNELS = Object.keys(CHANNEL_LABELS) as Array<keyof typeof CHANNEL_LABELS>;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChannelConfigs {
  desktop?: Record<string, never>;
  email?: { to: string };
  slack?: { webhookUrl: string };
  discord?: { webhookUrl: string };
  telegram?: { botToken: string; chatId: string };
}

interface PreferenceKey {
  event_type: string;
  channel: string;
}

interface TestResult {
  success: boolean;
  error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function findPreference(
  preferences: NotificationPreference[],
  event_type: string,
  channel: string,
): NotificationPreference | undefined {
  return preferences.find((p) => p.event_type === event_type && p.channel === channel);
}

function handleApiError(err: unknown, fallback: string): void {
  const isApi = err instanceof ApiClientError;
  toast.error(isApi ? err.message : fallback, {
    description: isApi ? `Trace: ${err.traceId}` : undefined,
  });
}

// ─── Channel Config Section ───────────────────────────────────────────────────

function ChannelConfigSection({
  configs,
  onTestChannel,
  isTesting,
}: {
  configs: ChannelConfigs;
  onTestChannel: (channel: string) => void;
  isTesting: string | null;
}) {
  const qc = useQueryClient();

  const saveChannelConfig = useMutation({
    mutationFn: (payload: { channel: string; config: Record<string, unknown> }) =>
      apiClient.put("/api/notifications/channels", payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.notifications.channels() });
    },
    onError: (err) => handleApiError(err, "Failed to save channel config"),
  });

  function handleBlur(channel: string, config: Record<string, unknown>) {
    saveChannelConfig.mutate({ channel, config });
  }

  return (
    <Card>
      <CardContent className="p-6">
        <h2 className="font-heading mb-4 text-base font-semibold">Channel Configuration</h2>
        <div className="space-y-4">
          {/* Desktop */}
          <ChannelRow
            label="Desktop"
            badge="Always on"
            channel="desktop"
            onTest={onTestChannel}
            isTesting={isTesting}
          >
            <span className="text-xs text-muted-foreground">
              Browser push notifications — no configuration required.
            </span>
          </ChannelRow>

          {/* Email */}
          <ChannelRow label="Email" channel="email" onTest={onTestChannel} isTesting={isTesting}>
            <EmailInput
              value={configs.email?.to ?? ""}
              onBlur={(to) => handleBlur("email", { to })}
            />
          </ChannelRow>

          {/* Slack */}
          <ChannelRow label="Slack" channel="slack" onTest={onTestChannel} isTesting={isTesting}>
            <WebhookInput
              id="slack-webhook"
              placeholder="https://hooks.slack.com/services/..."
              value={configs.slack?.webhookUrl ?? ""}
              onBlur={(webhookUrl) => handleBlur("slack", { webhookUrl })}
            />
          </ChannelRow>

          {/* Discord */}
          <ChannelRow
            label="Discord"
            channel="discord"
            onTest={onTestChannel}
            isTesting={isTesting}
          >
            <WebhookInput
              id="discord-webhook"
              placeholder="https://discord.com/api/webhooks/..."
              value={configs.discord?.webhookUrl ?? ""}
              onBlur={(webhookUrl) => handleBlur("discord", { webhookUrl })}
            />
          </ChannelRow>

          {/* Telegram */}
          <ChannelRow
            label="Telegram"
            channel="telegram"
            onTest={onTestChannel}
            isTesting={isTesting}
          >
            <TelegramInput
              botToken={configs.telegram?.botToken ?? ""}
              chatId={configs.telegram?.chatId ?? ""}
              onBlur={(botToken, chatId) => handleBlur("telegram", { botToken, chatId })}
            />
          </ChannelRow>
        </div>
      </CardContent>
    </Card>
  );
}

function ChannelRow({
  label,
  badge,
  channel,
  onTest,
  isTesting,
  children,
}: {
  label: string;
  badge?: string;
  channel: string;
  onTest: (channel: string) => void;
  isTesting: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="w-24 shrink-0">
        <span className="text-sm font-medium">{label}</span>
        {badge !== undefined && (
          <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {badge}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
      <Button
        size="sm"
        variant="outline"
        onClick={() => onTest(channel)}
        disabled={isTesting !== null}
        className="shrink-0 text-xs"
      >
        {isTesting === channel ? "Sending…" : "Send test"}
      </Button>
    </div>
  );
}

function WebhookInput({
  id,
  placeholder,
  value,
  onBlur,
}: {
  id: string;
  placeholder: string;
  value: string;
  onBlur: (value: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <Input
      id={id}
      ref={ref}
      defaultValue={value}
      key={value}
      placeholder={placeholder}
      onBlur={(e) => onBlur(e.target.value)}
      className="h-8 text-xs font-mono"
    />
  );
}

function EmailInput({
  value,
  onBlur,
}: {
  value: string;
  onBlur: (value: string) => void;
}) {
  return (
    <Input
      type="email"
      key={value}
      defaultValue={value}
      placeholder="you@example.com"
      onBlur={(e) => onBlur(e.target.value)}
      className="h-8 text-xs"
    />
  );
}

function TelegramInput({
  botToken,
  chatId,
  onBlur,
}: {
  botToken: string;
  chatId: string;
  onBlur: (botToken: string, chatId: string) => void;
}) {
  const tokenRef = useRef<HTMLInputElement>(null);
  const chatRef = useRef<HTMLInputElement>(null);

  function handleBlur() {
    const t = tokenRef.current?.value ?? "";
    const c = chatRef.current?.value ?? "";
    onBlur(t, c);
  }

  return (
    <div className="flex gap-2">
      <div className="flex-1">
        <Label className="mb-1 text-xs text-muted-foreground">Bot token</Label>
        <Input
          ref={tokenRef}
          key={botToken}
          defaultValue={botToken}
          placeholder="1234567890:ABC..."
          onBlur={handleBlur}
          className="h-8 text-xs font-mono"
        />
      </div>
      <div className="w-36">
        <Label className="mb-1 text-xs text-muted-foreground">Chat ID</Label>
        <Input
          ref={chatRef}
          key={chatId}
          defaultValue={chatId}
          placeholder="-1001234567890"
          onBlur={handleBlur}
          className="h-8 text-xs font-mono"
        />
      </div>
    </div>
  );
}

// ─── Preferences Matrix ───────────────────────────────────────────────────────

function PreferencesMatrix({
  preferences,
  onToggle,
}: {
  preferences: NotificationPreference[];
  onToggle: (key: PreferenceKey, enabled: boolean) => void;
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <h2 className="font-heading mb-4 text-base font-semibold">Event Preferences</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[160px]">Event</TableHead>
              {CHANNELS.map((ch) => (
                <TableHead key={ch} className="text-center">
                  {CHANNEL_LABELS[ch]}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {EVENT_TYPES.map((eventType) => (
              <TableRow key={eventType}>
                <TableCell>
                  <span className="text-sm">{EVENT_LABELS[eventType]}</span>
                </TableCell>
                {CHANNELS.map((channel) => {
                  const pref = findPreference(preferences, eventType, channel);
                  const enabled = pref?.enabled ?? false;
                  return (
                    <TableCell key={channel} className="text-center">
                      <Switch
                        size="sm"
                        checked={enabled}
                        onCheckedChange={(v) => onToggle({ event_type: eventType, channel }, v)}
                        aria-label={`${EVENT_LABELS[eventType]} via ${CHANNEL_LABELS[channel]}`}
                      />
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ─── Loading Skeleton ─────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4 p-6">
          <Skeleton className="h-5 w-48" />
          {[...Array(5)].map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-4 p-6">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NotificationsSettingsPage() {
  const qc = useQueryClient();

  const prefsQuery = useQuery<NotificationPreference[]>({
    queryKey: qk.notifications.preferences(),
    queryFn: ({ signal }) =>
      apiClient.get<NotificationPreference[]>("/api/notifications/preferences", { signal }),
  });

  const channelsQuery = useQuery<ChannelConfigs>({
    queryKey: qk.notifications.channels(),
    queryFn: ({ signal }) =>
      apiClient.get<ChannelConfigs>("/api/notifications/channels", { signal }),
  });

  const toggleMutation = useMutation({
    mutationFn: (payload: {
      event_type: string;
      channel: string;
      enabled: boolean;
      severity_threshold: string;
    }) => apiClient.put<NotificationPreference>("/api/notifications/preferences", payload),
    onMutate: async (payload) => {
      // Optimistic update
      await qc.cancelQueries({ queryKey: qk.notifications.preferences() });
      const previous = qc.getQueryData<NotificationPreference[]>(qk.notifications.preferences());
      qc.setQueryData<NotificationPreference[]>(qk.notifications.preferences(), (old) => {
        if (old === undefined) return old;
        const idx = old.findIndex(
          (p) => p.event_type === payload.event_type && p.channel === payload.channel,
        );
        if (idx === -1) {
          return [
            ...old,
            {
              id: `optimistic-${payload.event_type}-${payload.channel}`,
              user_id: "",
              updated_at: new Date().toISOString(),
              ...payload,
            },
          ];
        }
        return old.map((p, i) => (i === idx ? { ...p, enabled: payload.enabled } : p));
      });
      return { previous };
    },
    onError: (err, _payload, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(qk.notifications.preferences(), ctx.previous);
      }
      handleApiError(err, "Failed to update preference");
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.notifications.preferences() });
    },
  });

  const testMutation = useMutation({
    mutationFn: (channel: string) =>
      apiClient.post<TestResult>("/api/notifications/test", { channel }),
    onSuccess: (data, channel) => {
      if (data.success) {
        toast.success(`Test notification sent to ${CHANNEL_LABELS[channel] ?? channel}`);
      } else {
        toast.error("Test failed", { description: data.error });
      }
    },
    onError: (err, channel) =>
      handleApiError(err, `Failed to send test to ${CHANNEL_LABELS[channel] ?? channel}`),
  });

  function handleToggle(key: PreferenceKey, enabled: boolean) {
    const existing = findPreference(prefsQuery.data ?? [], key.event_type, key.channel);
    toggleMutation.mutate({
      event_type: key.event_type,
      channel: key.channel,
      enabled,
      severity_threshold: existing?.severity_threshold ?? "info",
    });
  }

  if (prefsQuery.isLoading || channelsQuery.isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
            Settings
          </h1>
        </header>
        <SettingsNav />
        <LoadingSkeleton />
      </div>
    );
  }

  if (prefsQuery.isError || channelsQuery.isError) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
            Settings
          </h1>
        </header>
        <SettingsNav />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm text-muted-foreground">Failed to load notification settings.</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void prefsQuery.refetch();
                void channelsQuery.refetch();
              }}
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure which events trigger notifications and through which channels.
        </p>
      </header>

      <SettingsNav />

      <ChannelConfigSection
        configs={channelsQuery.data ?? {}}
        onTestChannel={(ch) => testMutation.mutate(ch)}
        isTesting={testMutation.isPending ? (testMutation.variables ?? null) : null}
      />

      <PreferencesMatrix preferences={prefsQuery.data ?? []} onToggle={handleToggle} />
    </div>
  );
}
