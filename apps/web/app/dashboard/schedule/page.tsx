"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { usePlansList } from "@/hooks/use-plans-list";
import {
  type ScheduleCreateData,
  type ScheduleWithPlan,
  useCreateSchedule,
  useDeleteSchedule,
  useSchedulesList,
  useToggleSchedule,
  useUpdateSchedule,
} from "@/hooks/use-schedules";
import { getNextRun, isValidCron, parseCron } from "@conductor/core";
import {
  CalendarClockIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";

// ──────────────────────��──────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function formatRelative(isoDate: string | null): string {
  if (!isoDate) return "—";
  const diff = new Date(isoDate).getTime() - Date.now();
  const abs = Math.abs(diff);

  if (abs < 60_000) return diff > 0 ? "in less than a minute" : "just now";

  const minutes = Math.round(abs / 60_000);
  if (minutes < 60) return diff > 0 ? `in ${minutes}m` : `${minutes}m ago`;

  const hours = Math.round(abs / 3_600_000);
  if (hours < 24) return diff > 0 ? `in ${hours}h` : `${hours}h ago`;

  const days = Math.round(abs / 86_400_000);
  return diff > 0 ? `in ${days}d` : `${days}d ago`;
}

/**
 * Produce a very short human-readable summary of a cron expression.
 * Falls back to the raw expression if parsing fails.
 */
function describeCron(expr: string): string {
  if (!expr.trim()) return "";
  const parsed = parseCron(expr);
  if (parsed instanceof Error) return "invalid expression";

  const parts = expr.trim().split(/\s+/);
  const [min, hour, dom, month, dow] = parts as [string, string, string, string, string];

  // Simple cases
  if (expr === "* * * * *") return "every minute";
  if (min !== "*" && hour !== "*" && dom === "*" && month === "*" && dow === "*") {
    return `daily at ${hour.padStart(2, "0")}:${min.padStart(2, "0")} UTC`;
  }
  if (min !== "*" && hour !== "*" && dom === "*" && month === "*" && dow !== "*") {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const dayNames = dow
      .split(",")
      .map((d) => days[Number(d)] ?? d)
      .join(", ");
    return `${dayNames} at ${hour.padStart(2, "0")}:${min.padStart(2, "0")} UTC`;
  }
  if (min.startsWith("*/")) {
    return `every ${min.slice(2)} minutes`;
  }
  if (hour.startsWith("*/")) {
    return `every ${hour.slice(2)} hours`;
  }

  return expr;
}

function computeNextRun(cronExpr: string): string {
  if (!cronExpr.trim()) return "";
  const parsed = parseCron(cronExpr);
  if (parsed instanceof Error) return "invalid expression";
  try {
    return getNextRun(parsed, new Date()).toLocaleString();
  } catch {
    return "unable to compute";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete confirmation dialog
// ────────────────────────────────────────────────────────────────────────────��

interface DeleteDialogProps {
  schedule: ScheduleWithPlan;
  onConfirm: () => void;
  isPending: boolean;
}

function DeleteDialog({ schedule, onConfirm, isPending }: DeleteDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={`Delete schedule ${schedule.name}`} />
        }
      >
        <Trash2Icon className="size-3.5 text-destructive" aria-hidden="true" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete schedule</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Are you sure you want to delete{" "}
          <span className="font-medium text-foreground">{schedule.name}</span>? This cannot be
          undone.
        </p>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button
            variant="destructive"
            disabled={isPending}
            onClick={() => {
              onConfirm();
              setOpen(false);
            }}
          >
            {isPending ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────────────────��──
// Schedule form (create / edit)
// ─────────────────────────────────────────────────────────────────────────────

interface ScheduleFormValues {
  name: string;
  plan_id: string;
  cron_expression: string;
  working_dir: string;
  skip_if_running: boolean;
  skip_if_recent_hours: string; // string from input, parsed to number
  quiet_hours_start: string;
  quiet_hours_end: string;
}

interface ScheduleFormProps {
  defaultValues?: Partial<ScheduleFormValues>;
  onSubmit: (data: ScheduleCreateData) => void;
}

function ScheduleForm({ defaultValues, onSubmit }: ScheduleFormProps) {
  const plansQuery = usePlansList({ isTemplate: false });
  const allPlans = useMemo(
    () => plansQuery.data?.pages.flatMap((p) => p.plans) ?? [],
    [plansQuery.data],
  );

  const [showAdvanced, setShowAdvanced] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors },
  } = useForm<ScheduleFormValues>({
    defaultValues: {
      name: "",
      plan_id: "",
      cron_expression: "",
      working_dir: "",
      skip_if_running: false,
      skip_if_recent_hours: "",
      quiet_hours_start: "",
      quiet_hours_end: "",
      ...defaultValues,
    },
  });

  const cronValue = watch("cron_expression");
  const cronDesc = describeCron(cronValue);
  const nextRun = computeNextRun(cronValue);

  function handleFormSubmit(values: ScheduleFormValues) {
    onSubmit({
      name: values.name,
      plan_id: values.plan_id,
      cron_expression: values.cron_expression,
      working_dir: values.working_dir || undefined,
      skip_if_running: values.skip_if_running,
      skip_if_recent_hours: values.skip_if_recent_hours
        ? Number(values.skip_if_recent_hours)
        : null,
      quiet_hours_start: values.quiet_hours_start ? Number(values.quiet_hours_start) : null,
      quiet_hours_end: values.quiet_hours_end ? Number(values.quiet_hours_end) : null,
    });
  }

  return (
    <form
      id="schedule-form"
      onSubmit={handleSubmit(handleFormSubmit)}
      className="flex flex-col gap-4"
    >
      {/* Name */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sched-name">Name</Label>
        <Input
          id="sched-name"
          placeholder="Daily backup"
          aria-invalid={errors.name !== undefined}
          {...register("name", { required: "Name is required", maxLength: 100 })}
        />
        {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
      </div>

      {/* Plan */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sched-plan">Plan</Label>
        <select
          id="sched-plan"
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-invalid={errors.plan_id !== undefined}
          {...register("plan_id", { required: "Plan is required" })}
        >
          <option value="">Select a plan…</option>
          {allPlans.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.name}
            </option>
          ))}
        </select>
        {errors.plan_id && <p className="text-xs text-destructive">{errors.plan_id.message}</p>}
      </div>

      {/* Cron expression */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sched-cron">Cron Expression</Label>
        <Input
          id="sched-cron"
          placeholder="0 9 * * 1-5"
          spellCheck={false}
          aria-invalid={errors.cron_expression !== undefined}
          {...register("cron_expression", {
            required: "Cron expression is required",
            validate: (v) => isValidCron(v) || "Invalid cron expression",
          })}
        />
        {cronValue && (
          <p className="text-xs text-muted-foreground">
            {cronDesc}
            {nextRun && cronDesc !== "invalid expression" && ` — next: ${nextRun}`}
          </p>
        )}
        {errors.cron_expression && (
          <p className="text-xs text-destructive">{errors.cron_expression.message}</p>
        )}
        <p className="text-xs text-muted-foreground">
          Examples: <code className="font-mono">0 9 * * *</code> (9am daily),{" "}
          <code className="font-mono">*/15 * * * *</code> (every 15 min),{" "}
          <code className="font-mono">0 9 * * 1-5</code> (weekdays 9am)
        </p>
      </div>

      {/* Working directory */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sched-workdir">
          Working Directory <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="sched-workdir"
          placeholder="/path/to/project"
          spellCheck={false}
          {...register("working_dir")}
        />
      </div>

      {/* Advanced options (collapsible) */}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          aria-expanded={showAdvanced}
        >
          {showAdvanced ? (
            <ChevronUpIcon className="size-3.5" aria-hidden="true" />
          ) : (
            <ChevronDownIcon className="size-3.5" aria-hidden="true" />
          )}
          Advanced options
        </button>

        {showAdvanced && (
          <div className="flex flex-col gap-4 rounded-lg border border-border p-3">
            {/* Skip if running */}
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="sched-skip-running" className="cursor-pointer">
                  Skip if already running
                </Label>
                <p className="text-xs text-muted-foreground">
                  Skip this schedule if the plan is currently running.
                </p>
              </div>
              <Controller
                name="skip_if_running"
                control={control}
                render={({ field }) => (
                  <Switch
                    id="sched-skip-running"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
            </div>

            {/* Skip if ran recently */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sched-skip-recent">
                Skip if ran in last N hours{" "}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="sched-skip-recent"
                type="number"
                min={1}
                max={168}
                placeholder="e.g. 4"
                className="w-32"
                {...register("skip_if_recent_hours", {
                  min: { value: 1, message: "Must be at least 1" },
                  max: { value: 168, message: "Must be at most 168" },
                })}
              />
              {errors.skip_if_recent_hours && (
                <p className="text-xs text-destructive">{errors.skip_if_recent_hours.message}</p>
              )}
            </div>

            {/* Quiet hours */}
            <div className="flex flex-col gap-1.5">
              <Label>
                Quiet hours{" "}
                <span className="font-normal text-muted-foreground">(optional, UTC)</span>
              </Label>
              <div className="flex items-center gap-2">
                <select
                  className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  aria-label="Quiet hours start"
                  {...register("quiet_hours_start")}
                >
                  <option value="">Start (hour)</option>
                  {Array.from({ length: 24 }, (_, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: static ordered list of 24 hours, never reordered
                    <option key={i} value={i}>
                      {String(i).padStart(2, "0")}:00
                    </option>
                  ))}
                </select>
                <span className="text-sm text-muted-foreground">to</span>
                <select
                  className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  aria-label="Quiet hours end"
                  {...register("quiet_hours_end")}
                >
                  <option value="">End (hour)</option>
                  {Array.from({ length: 24 }, (_, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: static ordered list of 24 hours, never reordered
                    <option key={i} value={i}>
                      {String(i).padStart(2, "0")}:00
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-muted-foreground">
                The schedule will not fire during these hours (UTC).
              </p>
            </div>
          </div>
        )}
      </div>
    </form>
  );
}

// ────────────────────────���────────────────────────────────────────────────────
// Create dialog
// ────────────────────────────────────────────────────���────────────────────────

function CreateScheduleDialog() {
  const [open, setOpen] = useState(false);
  const create = useCreateSchedule();

  function handleSubmit(data: ScheduleCreateData) {
    create.mutate(data, {
      onSuccess: () => setOpen(false),
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <PlusIcon aria-hidden="true" />
        New Schedule
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Schedule</DialogTitle>
        </DialogHeader>
        <ScheduleForm onSubmit={handleSubmit} />
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button type="submit" form="schedule-form" disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit dialog
// ──────────────────────────────────────────────────────────────────────────��──

interface EditScheduleDialogProps {
  schedule: ScheduleWithPlan;
}

function EditScheduleDialog({ schedule }: EditScheduleDialogProps) {
  const [open, setOpen] = useState(false);
  const update = useUpdateSchedule();

  function handleSubmit(data: ScheduleCreateData) {
    update.mutate({ id: schedule.id, data }, { onSuccess: () => setOpen(false) });
  }

  const defaultValues: Partial<ScheduleFormValues> = {
    name: schedule.name,
    plan_id: schedule.plan_id,
    cron_expression: schedule.cron_expression,
    working_dir: schedule.working_dir ?? "",
    skip_if_running: schedule.skip_if_running,
    skip_if_recent_hours: schedule.skip_if_recent_hours
      ? String(schedule.skip_if_recent_hours)
      : "",
    quiet_hours_start: schedule.quiet_hours_start != null ? String(schedule.quiet_hours_start) : "",
    quiet_hours_end: schedule.quiet_hours_end != null ? String(schedule.quiet_hours_end) : "",
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={`Edit schedule ${schedule.name}`} />
        }
      >
        <PencilIcon className="size-3.5" aria-hidden="true" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Schedule</DialogTitle>
        </DialogHeader>
        <ScheduleForm defaultValues={defaultValues} onSubmit={handleSubmit} />
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button type="submit" form="schedule-form" disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────���────────────────────────────────────���──────────────
// Schedule row
// ────────────────────────────────────────────────���────────────────────────────

interface ScheduleRowProps {
  schedule: ScheduleWithPlan;
}

function ScheduleRow({ schedule }: ScheduleRowProps) {
  const toggle = useToggleSchedule();
  const deleteSchedule = useDeleteSchedule();

  const handleToggle = useCallback(
    (_checked: boolean) => {
      // Optimistically fire — the hook handles invalidation.
      void toggle.mutateAsync(schedule.id).catch(() => null);
    },
    [schedule.id, toggle],
  );

  return (
    <TableRow>
      <TableCell className="font-medium">{schedule.name}</TableCell>
      <TableCell>
        {schedule.plans ? (
          <Link
            href={`/dashboard/plans/${schedule.plans.id}`}
            className="text-primary hover:underline underline-offset-2"
          >
            {schedule.plans.name}
          </Link>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell>
        <span className="font-mono text-xs">{schedule.cron_expression}</span>
        <span className="ml-2 text-xs text-muted-foreground">
          ({describeCron(schedule.cron_expression)})
        </span>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {formatRelative(schedule.next_run_at)}
      </TableCell>
      <TableCell>
        <Switch
          size="sm"
          checked={schedule.enabled}
          onCheckedChange={handleToggle}
          disabled={toggle.isPending}
          aria-label={schedule.enabled ? "Disable schedule" : "Enable schedule"}
        />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <EditScheduleDialog schedule={schedule} />
          <DeleteDialog
            schedule={schedule}
            onConfirm={() => deleteSchedule.mutate(schedule.id)}
            isPending={deleteSchedule.isPending}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}

// ────────────────────────────���────────────────────────────────────��───────────
// Page
// ────────────────────────────────────────────────���────────────────────────────

export default function SchedulePage() {
  const { data, isLoading, isError, refetch } = useSchedulesList();
  const schedules = data?.schedules ?? [];

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Schedules</h1>
          <p className="text-sm text-muted-foreground">
            Automate your plan runs on a cron schedule.
          </p>
        </div>
        <CreateScheduleDialog />
      </header>

      {/* Error state */}
      {isError && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Failed to load schedules.{" "}
          <button
            type="button"
            onClick={() => refetch()}
            className="underline underline-offset-2 hover:no-underline"
          >
            Try again
          </button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Cron</TableHead>
              <TableHead>Next Run</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[80px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* Loading skeletons */}
            {isLoading &&
              Array.from({ length: 3 }).map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: skeleton items are static placeholders
                <TableRow key={i}>
                  <TableCell>
                    <Skeleton className="h-4 w-32" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-24" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-28" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-20" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-10" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-16" />
                  </TableCell>
                </TableRow>
              ))}

            {/* Rows */}
            {!isLoading &&
              schedules.map((schedule) => <ScheduleRow key={schedule.id} schedule={schedule} />)}

            {/* Empty state (inside table via full-width cell) */}
            {!isLoading && schedules.length === 0 && (
              <TableRow>
                <TableCell colSpan={6}>
                  <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
                    <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                      <CalendarClockIcon
                        className="size-6 text-muted-foreground"
                        aria-hidden="true"
                      />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">No schedules yet</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Create one to automate your plan runs.
                      </p>
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
