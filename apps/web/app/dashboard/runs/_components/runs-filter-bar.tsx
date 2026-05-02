"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { type RunStatus, runStatusInfo } from "@/lib/ui/status";
import { ListFilterIcon, SearchIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const STATUSES: RunStatus[] = ["queued", "running", "paused", "completed", "failed", "cancelled"];

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

  // Keep stable refs to avoid stale closures in the debounce effect.
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    const handle = setTimeout(() => {
      if (search !== (valueRef.current.search ?? "")) {
        onChangeRef.current({ ...valueRef.current, search: search || undefined });
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [search]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[220px] flex-1">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por id o directorio…"
          className="pl-8"
          aria-label="Buscar ejecuciones"
        />
      </div>

      <Popover>
        <PopoverTrigger
          render={
            <Button variant="outline" size="sm" className="gap-1.5">
              <ListFilterIcon className="size-3.5" />
              {value.status ? `Estado: ${runStatusInfo(value.status).label}` : "Todos los estados"}
            </Button>
          }
        />
        <PopoverContent align="end" className="w-48 p-1">
          <button
            type="button"
            className="flex w-full items-center rounded-md px-2 py-1.5 text-sm hover:bg-muted"
            onClick={() => onChange({ ...value, status: undefined })}
          >
            Todos los estados
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
                {value.status === s && <span className="text-xs text-primary">●</span>}
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
          Limpiar
        </Button>
      )}
    </div>
  );
}
