export type RepoPin = {
  owner: string;
  repo: string;
  sha: string;
};

export type RepoOverview = RepoPin & {
  description: string | null;
  defaultBranch: string;
  refName: string;
  stars: number;
  language: string | null;
  htmlUrl: string;
  commitUrl: string;
  fetchedAt: string;
  treeTruncated: boolean;
  fileCount: number;
  skippedCount: number;
  directories: string[];
  samplePaths: string[];
  readmePath: string | null;
  starterQuestions: string[];
};

export type ListedFile = {
  path: string;
  size: number | null;
  readable: boolean;
};

export type FileSlice = {
  path: string;
  sha: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  excerpt: string;
  truncated: boolean;
  url: string;
};

export type EvidenceTool = "read_file" | "search_content";

export type Evidence = FileSlice & {
  id: string;
  tool: EvidenceTool;
};

export type ParsedGithubUrl = {
  owner: string;
  repo: string;
  /** Remainder after /tree, /blob, or /commit. Null means the default branch. */
  ref: string | null;
};
