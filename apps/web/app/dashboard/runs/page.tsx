"use client";
import { useState } from "react";
import { RunsFilterBar, type RunsFilters } from "./_components/runs-filter-bar";
import { RunsTable } from "./_components/runs-table";

export default function RunsListPage() {
  const [filters, setFilters] = useState<RunsFilters>({});

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
          Ejecuciones
        </h1>
        <p className="text-sm text-muted-foreground">
          Todas las ejecuciones que lanzaste. Filtrá por estado, buscá por directorio de trabajo.
        </p>
      </header>

      <div className="sticky top-14 z-10 -mx-4 border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <RunsFilterBar value={filters} onChange={setFilters} />
      </div>

      <RunsTable filters={{ status: filters.status, limit: 25 }} searchClient={filters.search} />
    </div>
  );
}
