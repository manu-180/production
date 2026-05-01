export interface GitHubPROptions {
  repoOwner: string;
  repoName: string;
  title: string;
  body: string;
  headBranch: string;
  baseBranch: string;
  token: string;
}

export interface GitHubIssueOptions {
  repoOwner: string;
  repoName: string;
  title: string;
  body: string;
  labels?: string[];
  token: string;
}

export interface GitHubPRResult {
  url: string;
  number: number;
}

export interface GitHubIssueResult {
  url: string;
  number: number;
}
