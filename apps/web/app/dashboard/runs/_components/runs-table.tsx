"use client";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type RunsListParams, useRunsList } from "@/hooks/use-runs-list";
import { formatCostUsd, formatDuration, formatRelativeTime } from "@/lib/ui/format";
import type { RunStatus } from "@/lib/ui/status";
import type { Run } from "@conductor/db";
import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";
import { RunStatusBadge } from "./run-status-badge";

function rowDuration(r: Run): string {
  if (r.started_at === null) return "—";
  const end = r.finished_at !== null ? new Date(r.finished_at).getTime() : Date.now();
  return formatDuration(end - new Date(r.started_at).getTime());
}

interface Props {
  filters: RunsListParams;
  searchClient?: string;
}

export function RunsTable({ filters, searchClient }: Props) {
  const router = useRouter();
  const query = useRunsList(filters);
  const sentinelRef = useRef<HTMLTableRowElement | null>(null);

  // Infinite scroll: trigger fetchNextPage when sentinel is visible.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !query.hasNextPage || query.isFetchingNextPage) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) query.fetchNextPage();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [query]);

  const allRuns = useMemo(() => query.data?.pages.flatMap((p) => p.runs) ?? [], [query.data]);

  const filtered = useMemo(() => {
    if (!searchClient) return allRuns;
    const q = searchClient.toLowerCase();
    return allRuns.filter(
      (r) => r.id.toLowerCase().includes(q) || r.working_dir.toLowerCase().includes(q),
    );
  }, [allRuns, searchClient]);

  if (query.isLoading) {
    return (
      <Card>
        <div className="space-y-2 p-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </Card>
    );
  }

  if (query.isError) {
    return (
      <Card>
        <div className="flex flex-col items-center gap-3 p-12 text-center">
          <p className="text-sm text-muted-foreground">No se pudieron cargar las ejecuciones.</p>
          <Button size="sm" variant="outline" onClick={() => query.refetch()}>
            Intentar de nuevo
          </Button>
        </div>
      </Card>
    );
  }

  if (filtered.length === 0) {
    return (
      <EmptyState
        type="runs"
        title={searchClient ? "Ninguna ejecución coincide con tu búsqueda" : "Sin ejecuciones aún"}
        description={
          searchClient
            ? "Probá con otro término o limpiá el filtro"
            : "Lanzá un plan para ver tus ejecuciones acá"
        }
        action={{ label: "Ver planes", href: "/dashboard/plans" }}
      />
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[140px]">Estado</TableHead>
              <TableHead>Directorio de trabajo</TableHead>
              <TableHead className="hidden md:table-cell">Iniciado</TableHead>
              <TableHead className="hidden md:table-cell">Duración</TableHead>
              <TableHead className="hidden md:table-cell text-right">Costo</TableHead>
              <TableHead className="w-[40px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow
                key={r.id}
                className="cursor-pointer"
                onClick={() => router.push(`/dashboard/runs/${r.id}`)}
              >
                <TableCell>
                  <RunStatusBadge status={r.status as RunStatus} />
                </TableCell>
                <TableCell>
                  <Link
                    href={`/dashboard/runs/${r.id}`}
                    className="block min-w-0 max-w-[400px] truncate text-sm font-medium hover:underline"
                  >
                    {r.working_dir}
                  </Link>
                  <div className="font-mono text-[10px] text-muted-foreground">{r.id}</div>
                </TableCell>
                <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                  {formatRelativeTime(r.created_at)}
                </TableCell>
                <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                  {rowDuration(r)}
                </TableCell>
                <TableCell className="hidden md:table-cell text-xs text-right text-muted-foreground">
                  {formatCostUsd(r.total_cost_usd)}
                </TableCell>
                <TableCell>
                  <Link
                    href={`/dashboard/runs/${r.id}`}
                    className="flex items-center justify-center text-muted-foreground"
                    aria-label="Abrir ejecución"
                  >
                    <ChevronRightIcon className="size-4" />
                  </Link>
                </TableCell>
              </TableRow>
            ))}
            <TableRow ref={sentinelRef}>
              <TableCell colSpan={6} className="text-center text-xs text-muted-foreground">
                {query.isFetchingNextPage
                  ? "Cargando más…"
                  : query.hasNextPage
                    ? "Scrolleá para ver más"
                    : `${filtered.length} ejecución${filtered.length === 1 ? "" : "es"}`}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
