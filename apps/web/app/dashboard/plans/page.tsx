"use client";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useDeletePlan } from "@/hooks/use-plan-mutations";
import { usePlansList } from "@/hooks/use-plans-list";
import { LayersIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PlanCard } from "./_components/plan-card";
import { PlanCardSkeleton } from "./_components/plan-card-skeleton";
import { PlansFilterBar } from "./_components/plans-filter-bar";

const SKELETON_COUNT = 6;

export default function PlansPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [tag, setTag] = useState<string | undefined>(undefined);
  const [sort, setSort] = useState<"created" | "updated">("updated");

  const sentinelRef = useRef<HTMLDivElement>(null);

  // Debounce search
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 500);
    return () => clearTimeout(id);
  }, [search]);

  const query = usePlansList({
    search: debouncedSearch || undefined,
    tag,
    isTemplate: false,
  });

  const deletePlan = useDeletePlan();

  const allPlans = useMemo(() => query.data?.pages.flatMap((p) => p.plans) ?? [], [query.data]);

  // Collect all unique tags across loaded pages for the filter dropdown
  const availableTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const plan of allPlans) {
      for (const t of plan.tags) {
        tagSet.add(t);
      }
    }
    return Array.from(tagSet).sort();
  }, [allPlans]);

  // Sort client-side (the API returns most-recent-first by default)
  const sortedPlans = useMemo(() => {
    const copy = [...allPlans];
    copy.sort((a, b) => {
      const dateA = sort === "created" ? a.created_at : a.updated_at;
      const dateB = sort === "created" ? b.created_at : b.updated_at;
      return new Date(dateB).getTime() - new Date(dateA).getTime();
    });
    return copy;
  }, [allPlans, sort]);

  // Infinite scroll via IntersectionObserver
  const handleDelete = useCallback(
    (planId: string) => {
      deletePlan.mutate(planId, {
        onSuccess: () => {
          toast.success("Plan eliminado");
        },
        onError: (err) => {
          toast.error(err.message || "Error al eliminar el plan");
        },
      });
    },
    [deletePlan],
  );

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first?.isIntersecting && query.hasNextPage && !query.isFetchingNextPage) {
          void query.fetchNextPage();
        }
      },
      { rootMargin: "200px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [query]);

  const isInitialLoading = query.isLoading;
  const isEmpty = !isInitialLoading && sortedPlans.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      {/* Page header */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Planes</h1>
          <p className="text-sm text-muted-foreground">
            Administrá tus planes de prompts y secuencias.
          </p>
        </div>
        <Button render={<Link href="/dashboard/plans/new" aria-label="Crear un nuevo plan" />}>
          <PlusIcon aria-hidden="true" />
          Nuevo Plan
        </Button>
      </header>

      {/* Filter bar */}
      <PlansFilterBar
        search={search}
        onSearchChange={setSearch}
        tag={tag}
        onTagChange={setTag}
        availableTags={availableTags}
        sort={sort}
        onSortChange={setSort}
        totalCount={isInitialLoading ? undefined : sortedPlans.length}
      />

      {/* Error state */}
      {query.isError && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Error al cargar los planes.{" "}
          <button
            type="button"
            onClick={() => query.refetch()}
            className="underline underline-offset-2 hover:no-underline"
          >
            Intentar de nuevo
          </button>
        </div>
      )}

      {/* Loading skeleton grid */}
      {isInitialLoading && (
        <div
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
          aria-label="Cargando planes"
          aria-busy="true"
        >
          {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton items are static placeholders, never reordered
            <PlanCardSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {isEmpty && (
        <EmptyState
          type="plans"
          description="Creá tu primer plan para empezar a orquestar prompts."
          action={{ label: "Crear Plan", href: "/dashboard/plans/new" }}
        />
      )}

      {/* Plans grid */}
      {!isInitialLoading && sortedPlans.length > 0 && (
        <section aria-label="Tus planes">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sortedPlans.map((plan) => (
              <PlanCard key={plan.id} plan={plan} onDelete={() => handleDelete(plan.id)} />
            ))}
          </div>
        </section>
      )}

      {/* Fetch next page loading indicator */}
      {query.isFetchingNextPage && (
        <div
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
          aria-label="Cargando más planes"
          aria-busy="true"
        >
          {Array.from({ length: 3 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton items are static placeholders, never reordered
            <PlanCardSkeleton key={`more-${i}`} />
          ))}
        </div>
      )}

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} className="h-1" aria-hidden="true" />

      {/* Templates section link */}
      <Separator />
      <section aria-label="Plantillas" className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-heading text-lg font-semibold tracking-tight">Plantillas</h2>
            <p className="text-sm text-muted-foreground">
              Comenzá desde una plantilla prediseñada o explorá los iniciadores.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            render={<Link href="/dashboard/templates" aria-label="Explorar todas las plantillas" />}
          >
            <LayersIcon aria-hidden="true" />
            Explorar plantillas
          </Button>
        </div>
        <div className="rounded-xl border border-dashed border-border px-6 py-8 text-center">
          <LayersIcon className="mx-auto mb-3 size-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            Usá plantillas integradas o guardá cualquier plan como plantilla para tu equipo.
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <Button variant="secondary" size="sm" render={<Link href="/dashboard/templates" />}>
              Ver todas las plantillas
            </Button>
            <Button variant="outline" size="sm" render={<Link href="/dashboard/plans/new" />}>
              <PlusIcon aria-hidden="true" />
              Nuevo desde plantilla
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
