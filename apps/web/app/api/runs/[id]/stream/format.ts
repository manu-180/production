/**
 * Format a single SSE message. Lives in a sibling file (not `route.ts`)
 * because Next.js 15 restricts which symbols a Route Handler module is
 * allowed to export — any non-method export trips typegen with a
 * `does not satisfy the constraint '{ [x: string]: never }'` error.
 *
 * The formatter is pure, so unit tests import it from here directly.
 */
export function formatSseEvent(event: string, data: unknown): string {
  const json = JSON.stringify(data);
  return `event: ${event}\ndata: ${json}\n\n`;
}
