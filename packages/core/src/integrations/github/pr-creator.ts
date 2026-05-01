import type { GitHubPROptions, GitHubPRResult } from "./types.js";

/**
 * Create a pull request on GitHub via the REST API.
 * Uses fetch directly — no external SDK dependency.
 */
export async function createPullRequest(opts: GitHubPROptions): Promise<GitHubPRResult> {
  const url = `https://api.github.com/repos/${opts.repoOwner}/${opts.repoName}/pulls`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${opts.token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      title: opts.title,
      body: opts.body,
      head: opts.headBranch,
      base: opts.baseBranch,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(unreadable body)");
    throw new Error(`GitHub API error creating PR: ${res.status} ${res.statusText} — ${text}`);
  }

  const data = (await res.json()) as { html_url: string; number: number };

  return {
    url: data.html_url,
    number: data.number,
  };
}
