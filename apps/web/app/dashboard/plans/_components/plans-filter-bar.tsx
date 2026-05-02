"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SearchIcon, TagIcon, XIcon } from "lucide-react";

interface PlansFilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  tag: string | undefined;
  onTagChange: (value: string | undefined) => void;
  availableTags: string[];
  sort: "created" | "updated";
  onSortChange: (value: "created" | "updated") => void;
  totalCount?: number;
}

export function PlansFilterBar({
  search,
  onSearchChange,
  tag,
  onTagChange,
  availableTags,
  sort,
  onSortChange,
  totalCount,
}: PlansFilterBarProps) {
  const hasActiveFilters = Boolean(search || tag);

  return (
    <div className="sticky top-14 z-10 -mx-4 bg-background/95 backdrop-blur px-4 py-3 border-b border-border sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <SearchIcon
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar planes…"
            className="pl-8"
            aria-label="Buscar planes"
          />
        </div>

        {/* Tag filter */}
        {availableTags.length > 0 && (
          <div className="relative inline-flex items-center">
            <TagIcon
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <select
              value={tag ?? ""}
              onChange={(e) => onTagChange(e.target.value || undefined)}
              aria-label="Filtrar por etiqueta"
              className={cn(
                "h-8 appearance-none rounded-lg border border-input bg-transparent pl-8 pr-8 text-sm transition-colors outline-none",
                "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                "disabled:cursor-not-allowed disabled:opacity-50",
                tag ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <option value="">Todas las etiquetas</option>
              {availableTags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Sort */}
        <div className="relative inline-flex items-center">
          <select
            value={sort}
            onChange={(e) => onSortChange(e.target.value as "created" | "updated")}
            aria-label="Ordenar planes por"
            className={cn(
              "h-8 appearance-none rounded-lg border border-input bg-transparent px-2.5 pr-8 text-sm transition-colors outline-none",
              "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
              "text-muted-foreground",
            )}
          >
            <option value="updated">Último actualizado</option>
            <option value="created">Creado</option>
          </select>
        </div>

        {/* Clear filters */}
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onSearchChange("");
              onTagChange(undefined);
            }}
            aria-label="Limpiar todos los filtros"
            className="gap-1 text-muted-foreground"
          >
            <XIcon className="size-3.5" aria-hidden="true" />
            Limpiar
          </Button>
        )}

        {/* Count */}
        {totalCount !== undefined && (
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {totalCount} {totalCount === 1 ? "plan" : "planes"}
          </span>
        )}
      </div>
    </div>
  );
}
