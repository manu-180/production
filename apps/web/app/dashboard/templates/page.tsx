"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useTemplatesList } from "@/hooks/use-plans-list";
import { BUILTIN_TEMPLATES, type BuiltinTemplate } from "@/lib/templates";
import { cn } from "@/lib/utils";
import type { Plan } from "@conductor/db";
import {
  BugIcon,
  Code2Icon,
  CopyIcon,
  GlobeIcon,
  LayersIcon,
  PencilIcon,
  PlugIcon,
  TestTube2Icon,
  WrenchIcon,
} from "lucide-react";
import Link from "next/link";
import type React from "react";
import { useEffect, useRef } from "react";

// ─── Icon mapping ─────────────────────────────────────────────────────────────

const ICON_MAP: Record<string, React.ElementType> = {
  Globe: GlobeIcon,
  Code2: Code2Icon,
  TestTube2: TestTube2Icon,
  Wrench: WrenchIcon,
  Plug: PlugIcon,
  Bug: BugIcon,
};

function TemplateIcon({
  iconName,
  className,
}: {
  iconName?: string;
  className?: string;
}) {
  const Icon: React.ElementType = iconName ? (ICON_MAP[iconName] ?? LayersIcon) : LayersIcon;
  return <Icon className={cn("size-5", className)} aria-hidden="true" />;
}

// ─── Builtin template card ────────────────────────────────────────────────────

function BuiltinTemplateCard({ template }: { template: BuiltinTemplate }) {
  return (
    <Card
      className={cn(
        "flex flex-col transition-all duration-150",
        "hover:ring-2 hover:ring-primary/40 hover:shadow-md",
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <TemplateIcon iconName={template.iconName} className="text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base leading-snug">{template.name}</CardTitle>
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
              {template.description}
            </p>
          </div>
        </div>
      </CardHeader>

      {template.tags.length > 0 && (
        <CardContent className="py-0">
          <div className="flex flex-wrap gap-1">
            {template.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
          </div>
        </CardContent>
      )}

      <CardFooter className="mt-auto gap-2 pt-4">
        <Button
          render={<Link href={`/dashboard/plans/new?template=${template.id}`} />}
          size="sm"
          className="flex-1"
          aria-label={`Use template: ${template.name}`}
        >
          Use Template
        </Button>
        <Button
          render={<Link href={`/dashboard/templates/${template.id}`} />}
          size="sm"
          variant="outline"
          aria-label={`Preview template: ${template.name}`}
        >
          Preview
        </Button>
      </CardFooter>
    </Card>
  );
}

// ─── User template card ───────────────────────────────────────────────────────

function UserTemplateCard({ plan }: { plan: Plan }) {
  return (
    <Card
      className={cn(
        "flex flex-col transition-all duration-150",
        "hover:ring-2 hover:ring-primary/40 hover:shadow-md",
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
            <LayersIcon className="size-5 text-muted-foreground" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base leading-snug">{plan.name}</CardTitle>
            {plan.description && (
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{plan.description}</p>
            )}
          </div>
        </div>
      </CardHeader>

      {plan.tags.length > 0 && (
        <CardContent className="py-0">
          <div className="flex flex-wrap gap-1">
            {plan.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
          </div>
        </CardContent>
      )}

      <CardFooter className="mt-auto gap-2 pt-4">
        <Button
          render={<Link href={`/dashboard/plans/new?template=${plan.id}`} />}
          size="sm"
          className="flex-1"
          aria-label={`Use plan as template: ${plan.name}`}
        >
          <CopyIcon className="mr-1.5 size-3.5" aria-hidden="true" />
          Use as Template
        </Button>
        <Button
          render={<Link href={`/dashboard/plans/${plan.id}`} />}
          size="sm"
          variant="outline"
          aria-label={`Edit template plan: ${plan.name}`}
        >
          <PencilIcon className="mr-1.5 size-3.5" aria-hidden="true" />
          Edit
        </Button>
      </CardFooter>
    </Card>
  );
}

// ─── Skeleton grid ────────────────────────────────────────────────────────────

function TemplateCardSkeleton() {
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-start gap-3">
          <Skeleton className="size-9 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="py-0">
        <div className="flex gap-1.5">
          <Skeleton className="h-5 w-12 rounded-full" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      </CardContent>
      <CardFooter className="mt-auto gap-2 pt-4">
        <Skeleton className="h-8 flex-1 rounded-md" />
        <Skeleton className="h-8 w-20 rounded-md" />
      </CardFooter>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const SKELETON_COUNT = 6;

export default function TemplatesPage() {
  const userTemplates = useTemplatesList();
  const sentinelRef = useRef<HTMLDivElement>(null);

  const allUserTemplates = userTemplates.data?.pages.flatMap((p) => p.plans) ?? [];

  // Infinite scroll for user templates
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (
          first?.isIntersecting &&
          userTemplates.hasNextPage &&
          !userTemplates.isFetchingNextPage
        ) {
          void userTemplates.fetchNextPage();
        }
      },
      { rootMargin: "200px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [userTemplates]);

  const isUserTemplatesLoading = userTemplates.isLoading;
  const hasUserTemplates = !isUserTemplatesLoading && allUserTemplates.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
      {/* Page header */}
      <header>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Templates</h1>
        <p className="mt-1 text-sm text-muted-foreground">Ready-made plans to get started fast.</p>
      </header>

      {/* Built-in templates */}
      <section aria-labelledby="builtin-templates-heading">
        <h2
          id="builtin-templates-heading"
          className="mb-4 font-heading text-lg font-semibold tracking-tight"
        >
          Built-in Templates
        </h2>
        <div
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
          aria-label="Built-in templates"
        >
          {BUILTIN_TEMPLATES.map((template) => (
            <BuiltinTemplateCard key={template.id} template={template} />
          ))}
        </div>
      </section>

      {/* My Templates — only shown when there are user-defined templates */}
      {(isUserTemplatesLoading || hasUserTemplates) && (
        <>
          <Separator />
          <section aria-labelledby="my-templates-heading">
            <h2
              id="my-templates-heading"
              className="mb-4 font-heading text-lg font-semibold tracking-tight"
            >
              My Templates
            </h2>

            {/* Error state */}
            {userTemplates.isError && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                Failed to load your templates.{" "}
                <button
                  type="button"
                  onClick={() => userTemplates.refetch()}
                  className="underline underline-offset-2 hover:no-underline"
                >
                  Try again
                </button>
              </div>
            )}

            {/* Skeleton loading grid */}
            {isUserTemplatesLoading && (
              <div
                className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
                aria-label="Loading your templates"
                aria-busy="true"
              >
                {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: skeleton items are static placeholders, never reordered
                  <TemplateCardSkeleton key={i} />
                ))}
              </div>
            )}

            {/* User templates grid */}
            {!isUserTemplatesLoading && allUserTemplates.length > 0 && (
              <div
                className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
                aria-label="Your templates"
              >
                {allUserTemplates.map((plan) => (
                  <UserTemplateCard key={plan.id} plan={plan} />
                ))}
              </div>
            )}

            {/* Load-more skeletons */}
            {userTemplates.isFetchingNextPage && (
              <div
                className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
                aria-label="Loading more templates"
                aria-busy="true"
              >
                {Array.from({ length: 3 }).map((_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: skeleton items are static placeholders, never reordered
                  <TemplateCardSkeleton key={`more-${i}`} />
                ))}
              </div>
            )}

            {/* Infinite scroll sentinel */}
            <div ref={sentinelRef} className="h-1" aria-hidden="true" />
          </section>
        </>
      )}
    </div>
  );
}
