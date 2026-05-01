"use client";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useDeletePlan } from "@/hooks/use-plan-mutations";
import { usePlansList } from "@/hooks/use-plans-list";
import { FileTextIcon, LayersIcon, PlusIcon } from "lucide-react";
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
          toast.success("Plan deleted");
        },
        onError: (err) => {
          toast.error(err.message || "Failed to delete plan");
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
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Plans</h1>
          <p className="text-sm text-muted-foreground">Manage your prompt plans and sequences.</p>
        </div>
        <Button render={<Link href="/dashboard/plans/new" aria-label="Create a new plan" />}>
          <PlusIcon aria-hidden="true" />
          New Plan
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
          Failed to load plans.{" "}
          <button
            type="button"
            onClick={() => query.refetch()}
            className="underline underline-offset-2 hover:no-underline"
          >
            Try again
          </button>
        </div>
      )}

      {/* Loading skeleton grid */}
      {isInitialLoading && (
        <div
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
          aria-label="Loading plans"
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
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <FileTextIcon className="size-6 text-muted-foreground" aria-hidden="true" />
          </div>
          <div>
            <p className="font-medium text-foreground">No plans yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create your first plan to start orchestrating prompts.
            </p>
          </div>
          <Button size="sm" render={<Link href="/dashboard/plans/new" />}>
            Create your first plan
          </Button>
        </div>
      )}

      {/* Plans grid */}
      {!isInitialLoading && sortedPlans.length > 0 && (
        <section aria-label="Your plans">
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
          aria-label="Loading more plans"
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
      <section aria-label="Templates" className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-heading text-lg font-semibold tracking-tight">Templates</h2>
            <p className="text-sm text-muted-foreground">
              Start from a pre-built template or browse built-in starters.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            render={<Link href="/dashboard/templates" aria-label="Browse all templates" />}
          >
            <LayersIcon aria-hidden="true" />
            Browse templates
          </Button>
        </div>
        <div className="rounded-xl border border-dashed border-border px-6 py-8 text-center">
          <LayersIcon className="mx-auto mb-3 size-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            Use built-in templates or save any plan as a template for your team.
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <Button variant="secondary" size="sm" render={<Link href="/dashboard/templates" />}>
              View all templates
            </Button>
            <Button variant="outline" size="sm" render={<Link href="/dashboard/plans/new" />}>
              <PlusIcon aria-hidden="true" />
              New from template
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
