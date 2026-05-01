import { qk } from "@/lib/react-query/keys";
import type { Plan, Prompt } from "@conductor/db";
import { HydrationBoundary, QueryClient, dehydrate } from "@tanstack/react-query";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { PlanEditorClient } from "./_components/plan-editor-client";

export const dynamic = "force-dynamic";

type PlanWithPrompts = Plan & { prompts: Prompt[] };

async function fetchPlan(planId: string): Promise<PlanWithPrompts | null> {
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  const cookie = h.get("cookie") ?? "";

  const res = await fetch(`${proto}://${host}/api/plans/${planId}`, {
    cache: "no-store",
    headers: { cookie },
  });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Plan fetch failed: ${res.status}`);
  return res.json() as Promise<PlanWithPrompts>;
}

export default async function PlanEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const qc = new QueryClient();
  const data = await fetchPlan(id);
  if (!data) notFound();

  qc.setQueryData(qk.plans.detail(id), data);

  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <PlanEditorClient planId={id} />
    </HydrationBoundary>
  );
}
