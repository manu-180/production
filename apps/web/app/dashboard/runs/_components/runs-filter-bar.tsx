"use client";
import { ListFilterIcon, SearchIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { type RunStatus, runStatusInfo } from "@/lib/ui/status";

const STATUSES: RunStatus[] = [
  "queued",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
];

export interface RunsFilters {
  status?: RunStatus;
  search?: string;
}

export function RunsFilterBar({
  value,
  onChange,
}: {
  value: RunsFilters;
  onChange: (next: RunsFilters) => void;
}) {
  const [search, setSearch] = useState(value.search ?? "");

  useEffect(() => {
    const handle = setTimeout(() => {
      if (search !== (value.search ?? "")) {
        onChange({ ...value, search: search || undefined });
      }
    }, 300);
    return () => clearTimeout(handle);
    // biome-ignore lint/correctness/useExhaustiveDependencies: only react to local search changes
  }, [search]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[220px] flex-1">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by id or working dir…"
          className="pl-8"
          aria-label="Search runs"
        />
      </div>

      <Popover>
        <PopoverTrigger
          render={
            <Button variant="outline" size="sm" className="gap-1.5">
              <ListFilterIcon className="size-3.5" />
              {value.status ? `Status: ${runStatusInfo(value.status).label}` : "All statuses"}
            </Button>
          }
        />
        <PopoverContent align="end" className="w-48 p-1">
          <button
            type="button"
            className="flex w-full items-center rounded-md px-2 py-1.5 text-sm hover:bg-muted"
            onClick={() => onChange({ ...value, status: undefined })}
          >
            All statuses
          </button>
          {STATUSES.map((s) => {
            const info = runStatusInfo(s);
            return (
              <button
                key={s}
                type="button"
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                onClick={() => onChange({ ...value, status: s })}
              >
                <span>{info.label}</span>
                {value.status === s && (
                  <span className="text-xs text-primary">●</span>
                )}
              </button>
            );
          })}
        </PopoverContent>
      </Popover>

      {(value.status || value.search) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setSearch("");
            onChange({});
          }}
        >
          Clear
        </Button>
      )}
    </div>
  );
}
