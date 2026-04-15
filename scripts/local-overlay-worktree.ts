import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface RemoteSelection {
  name: string;
  usedFallback: boolean;
}

export interface GitStep {
  cwd: string;
  args: string[];
}

export interface OverlayPlan {
  remote: RemoteSelection;
  baseRef: string;
  steps: GitStep[];
  notes: string[];
}

interface BootstrapPlanOptions {
  repoRoot: string;
  cleanDir: string;
  overlayDir: string;
  overlayBranch: string;
  existingBranches: string[];
  remotes: string[];
  baseBranch: string;
  preferredRemote?: string;
  fallbackRemote?: string;
}

interface SyncPlanOptions {
  repoRoot: string;
  cleanDir: string;
  overlayDir: string;
  remotes: string[];
  baseBranch: string;
  preferredRemote?: string;
  fallbackRemote?: string;
}

type CommandMode = "bootstrap" | "sync";

const DEFAULT_BASE_BRANCH = "main";
const DEFAULT_PREFERRED_REMOTE = "upstream";
const DEFAULT_FALLBACK_REMOTE = "origin";

export function resolvePreferredRemote(
  remotes: string[],
  preferredRemote = DEFAULT_PREFERRED_REMOTE,
  fallbackRemote = DEFAULT_FALLBACK_REMOTE,
): RemoteSelection | null {
  if (remotes.includes(preferredRemote)) {
    return {
      name: preferredRemote,
      usedFallback: false,
    };
  }

  if (fallbackRemote && remotes.includes(fallbackRemote)) {
    return {
      name: fallbackRemote,
      usedFallback: true,
    };
  }

  return null;
}

export function defaultOverlayBranchName(date = new Date()): string {
  return `local/routa-overlay-${date.toISOString().slice(0, 10)}`;
}

export function defaultWorktreePaths(repoRoot: string): { cleanDir: string; overlayDir: string } {
  const parentDir = path.dirname(repoRoot);
  const repoName = path.basename(repoRoot);

  return {
    cleanDir: path.resolve(parentDir, `${repoName}-upstream`),
    overlayDir: path.resolve(parentDir, `${repoName}-overlay`),
  };
}

export function buildBootstrapPlan(options: BootstrapPlanOptions): OverlayPlan {
  const remote = resolveRequiredRemote(
    options.remotes,
    options.preferredRemote,
    options.fallbackRemote,
  );
  const baseRef = `${remote.name}/${options.baseBranch}`;
  const notes = buildRemoteNotes(remote, options.preferredRemote, options.fallbackRemote);
  const hasExistingOverlayBranch = options.existingBranches.includes(options.overlayBranch);
  const overlayStep = hasExistingOverlayBranch
    ? {
        cwd: options.repoRoot,
        args: ["worktree", "add", options.overlayDir, options.overlayBranch],
      }
    : {
        cwd: options.repoRoot,
        args: ["worktree", "add", "-b", options.overlayBranch, options.overlayDir, baseRef],
      };

  return {
    remote,
    baseRef,
    notes,
    steps: [
      {
        cwd: options.repoRoot,
        args: ["fetch", remote.name, options.baseBranch],
      },
      {
        cwd: options.repoRoot,
        args: ["worktree", "add", "--detach", options.cleanDir, baseRef],
      },
      overlayStep,
    ],
  };
}

export function buildSyncPlan(options: SyncPlanOptions): OverlayPlan {
  const remote = resolveRequiredRemote(
    options.remotes,
    options.preferredRemote,
    options.fallbackRemote,
  );
  const baseRef = `${remote.name}/${options.baseBranch}`;

  return {
    remote,
    baseRef,
    notes: buildRemoteNotes(remote, options.preferredRemote, options.fallbackRemote),
    steps: [
      {
        cwd: options.repoRoot,
        args: ["fetch", remote.name, options.baseBranch],
      },
      {
        cwd: options.cleanDir,
        args: ["switch", "--detach", baseRef],
      },
      {
        cwd: options.cleanDir,
        args: ["reset", "--hard", baseRef],
      },
      {
        cwd: options.overlayDir,
        args: ["rebase", baseRef],
      },
    ],
  };
}

function resolveRequiredRemote(
  remotes: string[],
  preferredRemote = DEFAULT_PREFERRED_REMOTE,
  fallbackRemote = DEFAULT_FALLBACK_REMOTE,
): RemoteSelection {
  const remote = resolvePreferredRemote(remotes, preferredRemote, fallbackRemote);
  if (remote) {
    return remote;
  }

  const expected = [preferredRemote, fallbackRemote].filter(Boolean).join("' or '");
  throw new Error(`Could not find a usable remote. Expected '${expected}'.`);
}

function buildRemoteNotes(
  remote: RemoteSelection,
  preferredRemote = DEFAULT_PREFERRED_REMOTE,
  fallbackRemote = DEFAULT_FALLBACK_REMOTE,
): string[] {
  const notes: string[] = [];
  if (remote.usedFallback) {
    notes.push(
      `No '${preferredRemote}' remote was found, so '${fallbackRemote}' will be treated as the upstream source.`,
    );
  }
  return notes;
}

function tryExecGit(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function runGit(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}`);
  }
}

function resolveRepoRoot(cwd: string): string {
  const repoRoot = tryExecGit(cwd, ["rev-parse", "--show-toplevel"]);
  if (!repoRoot) {
    throw new Error("Current directory is not inside a Git repository.");
  }
  return repoRoot;
}

function listRemotes(repoRoot: string): string[] {
  const stdout = tryExecGit(repoRoot, ["remote"]);
  if (!stdout) return [];
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function listLocalBranches(repoRoot: string): string[] {
  const stdout = tryExecGit(repoRoot, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
  if (!stdout) return [];
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function ensurePathAbsent(targetPath: string, label: string): void {
  if (existsSync(targetPath)) {
    throw new Error(`${label} already exists at ${targetPath}. Choose a different path or remove it first.`);
  }
}

function ensurePathPresent(targetPath: string, label: string): void {
  if (!existsSync(targetPath)) {
    throw new Error(`${label} does not exist at ${targetPath}. Run bootstrap first or pass the correct path.`);
  }
}

function ensureCleanWorktree(targetPath: string, label: string): void {
  const status = tryExecGit(targetPath, ["status", "--porcelain"]);
  if (status === null) {
    throw new Error(`${label} at ${targetPath} is not a Git worktree.`);
  }
  if (status.length > 0) {
    throw new Error(`${label} at ${targetPath} has uncommitted changes. Commit or stash them before syncing.`);
  }
}

function renderGitStep(step: GitStep, repoRoot: string): string {
  const prefix = step.cwd === repoRoot ? "git" : `git -C ${quoteArg(step.cwd)}`;
  return [prefix, ...step.args.map(quoteArg)].join(" ");
}

function quoteArg(value: string): string {
  return /\s/.test(value) ? JSON.stringify(value) : value;
}

function printPlan(mode: CommandMode, repoRoot: string, plan: OverlayPlan): void {
  console.log(`${mode === "bootstrap" ? "Bootstrap" : "Sync"} plan using ${plan.baseRef}`);
  for (const note of plan.notes) {
    console.log(`Note: ${note}`);
  }
  for (const step of plan.steps) {
    console.log(`- ${renderGitStep(step, repoRoot)}`);
  }
}

function printBootstrapNextSteps(cleanDir: string, overlayDir: string, overlayBranch: string): void {
  console.log("");
  console.log("Next steps:");
  console.log(`1. Use the clean upstream worktree for comparison and PR prep: ${cleanDir}`);
  console.log(`2. Use the overlay worktree for your self-hosted branch: ${overlayDir}`);
  console.log(`3. Start Routa from the overlay worktree on branch ${overlayBranch}:`);
  console.log(`   cd ${quoteArg(overlayDir)} && npm install --legacy-peer-deps && npm run dev`);
}

function printSyncNextSteps(overlayDir: string): void {
  console.log("");
  console.log("Sync complete.");
  console.log(`Re-run your normal checks from the overlay worktree: cd ${quoteArg(overlayDir)} && npm run test`);
}

function parseArgs(argv: string[]): {
  mode: CommandMode | null;
  flags: Map<string, string | boolean>;
} {
  let mode: CommandMode | null = null;
  const flags = new Map<string, string | boolean>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) continue;

    if (!mode && (token === "bootstrap" || token === "sync")) {
      mode = token;
      continue;
    }

    if (!token.startsWith("--")) {
      throw new Error(`Unknown argument: ${token}`);
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      flags.set(key, true);
      continue;
    }

    flags.set(key, next);
    index += 1;
  }

  return { mode, flags };
}

function readFlag(
  flags: Map<string, string | boolean>,
  name: string,
  fallback: string,
): string {
  const value = flags.get(name);
  return typeof value === "string" ? value : fallback;
}

function hasFlag(flags: Map<string, string | boolean>, name: string): boolean {
  return flags.get(name) === true;
}

function resolveCliPath(cwd: string, value: string): string {
  return path.resolve(cwd, value);
}

function printHelp(): void {
  console.log("Usage:");
  console.log("  npm run overlay:bootstrap -- [options]");
  console.log("  npm run overlay:sync -- [options]");
  console.log("");
  console.log("Commands:");
  console.log("  bootstrap   Create a clean upstream worktree and an overlay worktree");
  console.log("  sync        Fetch upstream and rebase the overlay worktree");
  console.log("");
  console.log("Options:");
  console.log("  --clean-dir <path>        Path for the clean upstream worktree");
  console.log("  --overlay-dir <path>      Path for the overlay worktree");
  console.log("  --overlay-branch <name>   Long-lived local overlay branch name");
  console.log("  --base <name>             Base branch to track (default: main)");
  console.log("  --remote <name>           Preferred upstream remote (default: upstream)");
  console.log("  --fallback-remote <name>  Fallback remote when preferred is missing (default: origin)");
  console.log("  --dry-run                 Print the git plan without executing it");
}

function runBootstrap(
  cwd: string,
  repoRoot: string,
  flags: Map<string, string | boolean>,
): void {
  const defaults = defaultWorktreePaths(repoRoot);
  const cleanDir = resolveCliPath(cwd, readFlag(flags, "clean-dir", defaults.cleanDir));
  const overlayDir = resolveCliPath(cwd, readFlag(flags, "overlay-dir", defaults.overlayDir));
  const overlayBranch = readFlag(flags, "overlay-branch", defaultOverlayBranchName());
  const baseBranch = readFlag(flags, "base", DEFAULT_BASE_BRANCH);
  const preferredRemote = readFlag(flags, "remote", DEFAULT_PREFERRED_REMOTE);
  const fallbackRemote = readFlag(flags, "fallback-remote", DEFAULT_FALLBACK_REMOTE);
  const plan = buildBootstrapPlan({
    repoRoot,
    cleanDir,
    overlayDir,
    overlayBranch,
    existingBranches: listLocalBranches(repoRoot),
    remotes: listRemotes(repoRoot),
    baseBranch,
    preferredRemote,
    fallbackRemote,
  });

  printPlan("bootstrap", repoRoot, plan);

  if (hasFlag(flags, "dry-run")) {
    return;
  }

  ensurePathAbsent(cleanDir, "Clean upstream worktree");
  ensurePathAbsent(overlayDir, "Overlay worktree");

  for (const step of plan.steps) {
    runGit(step.cwd, step.args);
  }

  printBootstrapNextSteps(cleanDir, overlayDir, overlayBranch);
}

function runSync(
  cwd: string,
  repoRoot: string,
  flags: Map<string, string | boolean>,
): void {
  const defaults = defaultWorktreePaths(repoRoot);
  const cleanDir = resolveCliPath(cwd, readFlag(flags, "clean-dir", defaults.cleanDir));
  const overlayDir = resolveCliPath(cwd, readFlag(flags, "overlay-dir", defaults.overlayDir));
  const baseBranch = readFlag(flags, "base", DEFAULT_BASE_BRANCH);
  const preferredRemote = readFlag(flags, "remote", DEFAULT_PREFERRED_REMOTE);
  const fallbackRemote = readFlag(flags, "fallback-remote", DEFAULT_FALLBACK_REMOTE);
  const plan = buildSyncPlan({
    repoRoot,
    cleanDir,
    overlayDir,
    remotes: listRemotes(repoRoot),
    baseBranch,
    preferredRemote,
    fallbackRemote,
  });

  printPlan("sync", repoRoot, plan);

  if (hasFlag(flags, "dry-run")) {
    return;
  }

  ensurePathPresent(cleanDir, "Clean upstream worktree");
  ensurePathPresent(overlayDir, "Overlay worktree");
  ensureCleanWorktree(cleanDir, "Clean upstream worktree");
  ensureCleanWorktree(overlayDir, "Overlay worktree");

  for (const step of plan.steps) {
    runGit(step.cwd, step.args);
  }

  printSyncNextSteps(overlayDir);
}

function main(argv: string[]): void {
  const { mode, flags } = parseArgs(argv);
  if (!mode || hasFlag(flags, "help")) {
    printHelp();
    return;
  }

  const cwd = process.cwd();
  const repoRoot = resolveRepoRoot(cwd);

  if (mode === "bootstrap") {
    runBootstrap(cwd, repoRoot, flags);
    return;
  }

  runSync(cwd, repoRoot, flags);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main(process.argv.slice(2));
}
