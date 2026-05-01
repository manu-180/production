import type { GitHubIssueOptions, GitHubIssueResult } from "./types.js";

/**
 * Create an issue on GitHub via the REST API.
 * Uses fetch directly — no external SDK dependency.
 */
export async function createIssue(opts: GitHubIssueOptions): Promise<GitHubIssueResult> {
  const url = `https://api.github.com/repos/${opts.repoOwner}/${opts.repoName}/issues`;

  const body: Record<string, unknown> = {
    title: opts.title,
    body: opts.body,
  };
  if (opts.labels !== undefined && opts.labels.length > 0) {
    body["labels"] = opts.labels;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${opts.token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(unreadable body)");
    throw new Error(`GitHub API error creating issue: ${res.status} ${res.statusText} — ${text}`);
  }

  const data = (await res.json()) as { html_url: string; number: number };

  return {
    url: data.html_url,
    number: data.number,
  };
}
