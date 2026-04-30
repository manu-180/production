import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { qk } from "@/lib/react-query/keys";
import {
  type RunDetailCache,
  seedCache,
} from "@/lib/realtime/event-handlers";
import { RunDetailClient } from "./_components/run-detail-client";

export const dynamic = "force-dynamic";

async function fetchRunDetail(
  runId: string,
): Promise<Omit<RunDetailCache, "_lastAppliedSequence"> | null> {
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  const cookie = h.get("cookie") ?? "";

  const res = await fetch(`${proto}://${host}/api/runs/${runId}`, {
    cache: "no-store",
    headers: { cookie },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Run fetch failed: ${res.status}`);
  return (await res.json()) as Omit<RunDetailCache, "_lastAppliedSequence">;
}

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const qc = new QueryClient();
  const data = await fetchRunDetail(id);
  if (data === null) notFound();
  qc.setQueryData(qk.runs.detail(id), seedCache(data));

  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <RunDetailClient runId={id} />
    </HydrationBoundary>
  );
}
