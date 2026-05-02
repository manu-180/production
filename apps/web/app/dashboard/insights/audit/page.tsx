"use client";

import { Download, Search } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  type AuditActor,
  type AuditLogFilters,
  buildAuditExportUrl,
  useAuditLog,
} from "@/hooks/use-audit-log";
import { formatRelativeTime } from "@/lib/ui/format";

// ─── Constants ─────────────────────────────────────────────────────────────────

const ACTORS = ["user", "worker", "guardian", "system"] as const;

const AUDIT_ACTIONS = [
  "plan.created",
  "plan.updated",
  "plan.deleted",
  "run.launched",
  "run.cancelled",
  "run.completed",
  "run.failed",
  "prompt.completed",
  "prompt.failed",
  "guardian.decision_made",
  "token.saved",
  "token.revoked",
  "settings.updated",
] as const;

const PAGE_SIZE = 50;

const ACTOR_COLORS: Record<string, string> = {
  user: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
  worker: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  guardian: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  system: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
};

const SELECT_CLS =
  "h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring";

// ─── Sub-components ────────────────────────────────────────────────────────────

function ActorBadge({ actor }: { actor: string }) {
  const cls = ACTOR_COLORS[actor] ?? ACTOR_COLORS["system"];
  return (
    <span className={`inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>{actor}</span>
  );
}

function MetadataPreview({ metadata }: { metadata: Record<string, unknown> | null }) {
  if (metadata === null || Object.keys(metadata).length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  const preview = JSON.stringify(metadata);
  const truncated = preview.length > 80 ? `${preview.slice(0, 77)}…` : preview;
  return (
    <span className="font-mono text-xs text-muted-foreground" title={preview}>
      {truncated}
    </span>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function AuditLogPage() {
  const [page, setPage] = useState(0);
  const [actor, setActor] = useState<AuditActor | "">("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [resourceType, setResourceType] = useState("");
  const [q, setQ] = useState("");
  const [qInput, setQInput] = useState("");

  const filters: AuditLogFilters = {
    page,
    limit: PAGE_SIZE,
    ...(actor ? { actor } : {}),
    ...(action ? { action } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(resourceType ? { resource_type: resourceType } : {}),
    ...(q ? { q } : {}),
  };

  const { data, isLoading, isError } = useAuditLog(filters);

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const exportUrl = buildAuditExportUrl({
    ...(actor ? { actor } : {}),
    action,
    from,
    to,
    resource_type: resourceType,
    q,
  });

  function resetPage() {
    setPage(0);
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setQ(qInput);
    resetPage();
  }

  async function handleExportCsv() {
    const res = await fetch(exportUrl, { credentials: "same-origin" });
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="mx-auto max-w-7xl flex flex-col gap-6 pb-10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Registro de Auditoría
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Registro inmutable de todos los eventos del sistema.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleExportCsv} className="gap-1.5">
          <Download className="size-4" />
          Exportar CSV
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3">
            {/* Full-text search */}
            <form onSubmit={handleSearch} className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input
                  className="pl-8 w-52"
                  placeholder="Buscar acción, recurso…"
                  value={qInput}
                  onChange={(e) => setQInput(e.target.value)}
                />
              </div>
              <Button type="submit" variant="secondary" size="sm">
                Buscar
              </Button>
              {q && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setQ("");
                    setQInput("");
                    resetPage();
                  }}
                >
                  Limpiar
                </Button>
              )}
            </form>

            {/* Actor */}
            <select
              className={SELECT_CLS}
              value={actor}
              onChange={(e) => {
                setActor(e.target.value as AuditActor | "");
                resetPage();
              }}
              aria-label="Filtrar por actor"
            >
              <option value="">Todos los actores</option>
              {ACTORS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>

            {/* Action */}
            <select
              className={SELECT_CLS}
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                resetPage();
              }}
              aria-label="Filtrar por acción"
            >
              <option value="">Todas las acciones</option>
              {AUDIT_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>

            {/* Date range */}
            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                className="w-36 text-sm"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  resetPage();
                }}
                aria-label="Desde fecha"
              />
              <span className="text-muted-foreground text-xs">–</span>
              <Input
                type="date"
                className="w-36 text-sm"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  resetPage();
                }}
                aria-label="Hasta fecha"
              />
            </div>

            {/* Resource type */}
            <Input
              className="w-40"
              placeholder="Tipo de recurso"
              value={resourceType}
              onChange={(e) => {
                setResourceType(e.target.value);
                resetPage();
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Error */}
      {isError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          No se pudo cargar el registro de auditoría. Actualizá la página para intentar de nuevo.
        </div>
      )}

      {/* Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">
            {isLoading ? "Cargando…" : `${total.toLocaleString()} eventos`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex flex-col gap-2 p-4">
              {Array.from({ length: 10 }).map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholder
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : entries.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Ningún evento de auditoría coincide con los filtros actuales.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-36">Timestamp</TableHead>
                  <TableHead className="w-24">Actor</TableHead>
                  <TableHead>Acción</TableHead>
                  <TableHead className="w-28">Tipo de recurso</TableHead>
                  <TableHead className="w-40">ID de recurso</TableHead>
                  <TableHead>Metadatos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell
                      className="font-mono text-xs text-muted-foreground whitespace-nowrap"
                      title={row.created_at}
                    >
                      {formatRelativeTime(row.created_at)}
                    </TableCell>
                    <TableCell>
                      <ActorBadge actor={row.actor} />
                    </TableCell>
                    <TableCell className="text-sm">{row.action}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.resource_type ?? "—"}
                    </TableCell>
                    <TableCell
                      className="font-mono text-xs text-muted-foreground max-w-[10rem] truncate"
                      title={row.resource_id ?? ""}
                    >
                      {row.resource_id ?? "—"}
                    </TableCell>
                    <TableCell>
                      <MetadataPreview metadata={row.metadata} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Página {page + 1} de {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!data?.hasMore}
              onClick={() => setPage((p) => p + 1)}
            >
              Siguiente
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
