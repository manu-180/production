"use client";

import { Button } from "@/components/ui/button";
import Link from "next/link";

export type EmptyStateType = "runs" | "plans" | "schedules" | "templates" | "search";

export interface EmptyStateAction {
  label: string;
  onClick?: () => void;
  href?: string;
}

export interface EmptyStateProps {
  type: EmptyStateType;
  title?: string;
  description?: string;
  action?: EmptyStateAction;
}

const DEFAULTS: Record<EmptyStateType, { title: string; description: string }> = {
  runs: {
    title: "No runs yet",
    description: "Launch a plan to see your runs here",
  },
  plans: {
    title: "No plans yet",
    description: "Create your first plan to get started",
  },
  schedules: {
    title: "No schedules yet",
    description: "Automate your plans with cron schedules",
  },
  templates: {
    title: "No templates",
    description: "Templates are not available yet",
  },
  search: {
    title: "No results",
    description: "Try a different search term",
  },
};

function RunsIllustration() {
  return (
    <svg viewBox="0 0 120 100" className="w-32 h-32 mx-auto" aria-hidden="true" fill="none">
      <circle
        cx="60"
        cy="50"
        r="30"
        stroke="currentColor"
        strokeWidth="2"
        className="text-muted-foreground/30"
      />
      <line
        x1="60"
        y1="50"
        x2="60"
        y2="30"
        stroke="currentColor"
        strokeWidth="2.5"
        className="text-muted-foreground/50"
        strokeLinecap="round"
      />
      <line
        x1="60"
        y1="50"
        x2="75"
        y2="58"
        stroke="currentColor"
        strokeWidth="2.5"
        className="text-muted-foreground/50"
        strokeLinecap="round"
      />
      <circle cx="60" cy="50" r="3" fill="currentColor" className="text-muted-foreground/50" />
    </svg>
  );
}

function PlansIllustration() {
  return (
    <svg viewBox="0 0 120 100" className="w-32 h-32 mx-auto" aria-hidden="true" fill="none">
      <rect
        x="30"
        y="20"
        width="60"
        height="70"
        rx="4"
        stroke="currentColor"
        strokeWidth="2"
        className="text-muted-foreground/30"
      />
      <line
        x1="40"
        y1="38"
        x2="80"
        y2="38"
        stroke="currentColor"
        strokeWidth="2"
        className="text-muted-foreground/40"
        strokeLinecap="round"
      />
      <line
        x1="40"
        y1="50"
        x2="80"
        y2="50"
        stroke="currentColor"
        strokeWidth="2"
        className="text-muted-foreground/40"
        strokeLinecap="round"
      />
      <line
        x1="40"
        y1="62"
        x2="65"
        y2="62"
        stroke="currentColor"
        strokeWidth="2"
        className="text-muted-foreground/40"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SchedulesIllustration() {
  return (
    <svg viewBox="0 0 120 100" className="w-32 h-32 mx-auto" aria-hidden="true" fill="none">
      <rect
        x="20"
        y="25"
        width="80"
        height="60"
        rx="4"
        stroke="currentColor"
        strokeWidth="2"
        className="text-muted-foreground/30"
      />
      <line
        x1="20"
        y1="40"
        x2="100"
        y2="40"
        stroke="currentColor"
        strokeWidth="2"
        className="text-muted-foreground/30"
      />
      <line
        x1="40"
        y1="15"
        x2="40"
        y2="32"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        className="text-muted-foreground/50"
      />
      <line
        x1="80"
        y1="15"
        x2="80"
        y2="32"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        className="text-muted-foreground/50"
      />
      <circle cx="45" cy="57" r="4" fill="currentColor" className="text-muted-foreground/20" />
      <circle cx="60" cy="57" r="4" fill="currentColor" className="text-primary/40" />
      <circle cx="75" cy="57" r="4" fill="currentColor" className="text-muted-foreground/20" />
    </svg>
  );
}

function TemplatesIllustration() {
  return (
    <svg viewBox="0 0 120 100" className="w-32 h-32 mx-auto" aria-hidden="true">
      <rect
        x="20"
        y="20"
        width="35"
        height="25"
        rx="4"
        fill="currentColor"
        className="text-muted-foreground/20"
      />
      <rect
        x="65"
        y="20"
        width="35"
        height="25"
        rx="4"
        fill="currentColor"
        className="text-primary/20"
      />
      <rect
        x="20"
        y="55"
        width="35"
        height="25"
        rx="4"
        fill="currentColor"
        className="text-primary/20"
      />
      <rect
        x="65"
        y="55"
        width="35"
        height="25"
        rx="4"
        fill="currentColor"
        className="text-muted-foreground/20"
      />
    </svg>
  );
}

function SearchIllustration() {
  return (
    <svg viewBox="0 0 120 100" className="w-32 h-32 mx-auto" aria-hidden="true" fill="none">
      <circle
        cx="52"
        cy="45"
        r="22"
        stroke="currentColor"
        strokeWidth="2"
        className="text-muted-foreground/30"
      />
      <line
        x1="68"
        y1="62"
        x2="90"
        y2="82"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        className="text-muted-foreground/40"
      />
      <line
        x1="44"
        y1="38"
        x2="60"
        y2="38"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="text-muted-foreground/30"
      />
      <line
        x1="44"
        y1="46"
        x2="56"
        y2="46"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="text-muted-foreground/30"
      />
    </svg>
  );
}

const ILLUSTRATIONS: Record<EmptyStateType, () => React.JSX.Element> = {
  runs: RunsIllustration,
  plans: PlansIllustration,
  schedules: SchedulesIllustration,
  templates: TemplatesIllustration,
  search: SearchIllustration,
};

export function EmptyState({ type, title, description, action }: EmptyStateProps) {
  const defaults = DEFAULTS[type];
  const resolvedTitle = title ?? defaults.title;
  const resolvedDescription = description ?? defaults.description;
  const Illustration = ILLUSTRATIONS[type];

  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border py-16 text-center">
      <Illustration />
      <div className="max-w-xs">
        <p className="font-medium text-foreground">{resolvedTitle}</p>
        <p className="mt-1 text-sm text-muted-foreground">{resolvedDescription}</p>
      </div>
      {action !== undefined &&
        (action.href !== undefined ? (
          <Button size="sm" render={<Link href={action.href} />}>
            {action.label}
          </Button>
        ) : (
          <Button size="sm" onClick={action.onClick} type="button">
            {action.label}
          </Button>
        ))}
    </div>
  );
}
