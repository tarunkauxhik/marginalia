import { LIMITS } from "@/lib/limits";

const BLOCKED_DIRECTORIES = new Set([
  "node_modules",
  "vendor",
  "dist",
  "build",
  "coverage",
  ".git",
  "__pycache__",
  ".next",
  "out",
  "target",
  "venv",
  ".venv",
  ".turbo",
  "generated",
]);

const BLOCKED_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "ico",
  "bmp",
  "pdf",
  "zip",
  "gz",
  "tgz",
  "tar",
  "bz2",
  "7z",
  "rar",
  "woff",
  "woff2",
  "ttf",
  "eot",
  "otf",
  "mp3",
  "mp4",
  "mov",
  "webm",
  "wasm",
  "bin",
  "exe",
  "dll",
  "so",
  "dylib",
  "class",
  "jar",
  "lock",
  "map",
  "sqlite",
  "db",
  "pyc",
]);

const PRIORITY_PATTERNS = [
  /(^|\/)readme(\.|$)/i,
  /(^|\/)package\.json$/i,
  /(^|\/)pyproject\.toml$/i,
  /(^|\/)cargo\.toml$/i,
  /(^|\/)go\.mod$/i,
  /(^|\/)composer\.json$/i,
  /(^|\/)src\/(index|main)\./i,
  /(^|\/)app\/(page|layout|main)\./i,
  /(^|\/)(index|main)\.(ts|tsx|js|jsx|py|go|rs)$/i,
];

export type FileDecision = {
  include: boolean;
  readable: boolean;
  reason: string | null;
};

export function classifyPath(path: string, size: number | null): FileDecision {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/");
  const base = segments[segments.length - 1]?.toLowerCase() ?? "";

  if (segments.some((segment) => BLOCKED_DIRECTORIES.has(segment.toLowerCase()))) {
    return { include: false, readable: false, reason: "The path is in a generated or dependency directory." };
  }
  if (base.endsWith(".generated.ts") || base.endsWith(".generated.js") || base.endsWith(".min.js") || base.endsWith(".min.css")) {
    return { include: false, readable: false, reason: "The file looks generated or minified." };
  }
  if (
    base === "package-lock.json" ||
    base === "pnpm-lock.yaml" ||
    base === "yarn.lock" ||
    base === "cargo.lock" ||
    base === "composer.lock" ||
    base === "gemfile.lock"
  ) {
    return { include: false, readable: false, reason: "Lockfiles are skipped." };
  }
  if (base === ".env" || base.startsWith(".env.") || base.endsWith(".pem") || base.endsWith(".p12") || base.endsWith(".pfx")) {
    return { include: false, readable: false, reason: "Secret-like files are skipped." };
  }
  if (base === "id_rsa" || base === "id_dsa" || base === "id_ecdsa" || base === "id_ed25519" || base.endsWith(".key")) {
    return { include: false, readable: false, reason: "Secret-like files are skipped." };
  }
  if (base === "credentials.json" || base === "secrets.json" || base === "secrets.yaml" || base === "secrets.yml") {
    return { include: false, readable: false, reason: "Secret-like files are skipped." };
  }

  const extension = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1) : "";
  if (BLOCKED_EXTENSIONS.has(extension)) {
    return { include: false, readable: false, reason: "Binary, archive, or lock files are skipped." };
  }

  if (size !== null && size > LIMITS.maxFileBytes) {
    return {
      include: true,
      readable: false,
      reason: `Files over ${LIMITS.maxFileBytes} bytes are listed but not read.`,
    };
  }

  return { include: true, readable: true, reason: null };
}

export function pathScore(path: string, terms: string[]): number {
  const lower = path.toLowerCase();
  const base = lower.slice(lower.lastIndexOf("/") + 1);
  let score = 0;
  for (const term of terms) {
    if (base.includes(term)) score += 5;
    else if (lower.includes(term)) score += 3;
  }
  if (PRIORITY_PATTERNS.some((pattern) => pattern.test(path))) score += 2;
  return score;
}

export function rankPaths(paths: string[], terms: string[]): string[] {
  return [...paths].sort((left, right) => {
    const delta = pathScore(right, terms) - pathScore(left, terms);
    if (delta !== 0) return delta;
    return left.localeCompare(right);
  });
}

export function queryTerms(query: string): string[] {
  const stop = new Set([
    "the",
    "and",
    "for",
    "how",
    "does",
    "what",
    "with",
    "this",
    "that",
    "from",
    "into",
    "are",
    "was",
    "why",
    "where",
    "when",
    "which",
    "who",
    "can",
    "you",
    "about",
    "file",
    "files",
    "code",
  ]);
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((term) => term.length >= 3 && !stop.has(term));
  return [...new Set(terms)].slice(0, 8);
}
