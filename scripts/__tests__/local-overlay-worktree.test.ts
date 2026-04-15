import { describe, expect, it } from "vitest";

import {
  buildBootstrapPlan,
  buildSyncPlan,
  defaultOverlayBranchName,
  defaultWorktreePaths,
  resolvePreferredRemote,
} from "../local-overlay-worktree";

describe("local-overlay-worktree helpers", () => {
  it("prefers upstream and falls back to origin", () => {
    expect(resolvePreferredRemote(["origin", "upstream"])).toEqual({
      name: "upstream",
      usedFallback: false,
    });

    expect(resolvePreferredRemote(["origin"])).toEqual({
      name: "origin",
      usedFallback: true,
    });

    expect(resolvePreferredRemote(["fork"])).toBeNull();
  });

  it("builds the default overlay branch name from the current date", () => {
    expect(defaultOverlayBranchName(new Date("2026-04-15T12:00:00Z"))).toBe(
      "local/routa-overlay-2026-04-15",
    );
  });

  it("places clean and overlay worktrees next to the main checkout by default", () => {
    expect(defaultWorktreePaths("/tmp/routa")).toEqual({
      cleanDir: "/tmp/routa-upstream",
      overlayDir: "/tmp/routa-overlay",
    });
  });

  it("creates a bootstrap plan for a new overlay branch", () => {
    const plan = buildBootstrapPlan({
      repoRoot: "/tmp/routa",
      cleanDir: "/tmp/routa-upstream",
      overlayDir: "/tmp/routa-overlay",
      overlayBranch: "local/routa-overlay-team",
      existingBranches: [],
      remotes: ["origin", "upstream"],
      baseBranch: "main",
    });

    expect(plan.baseRef).toBe("upstream/main");
    expect(plan.steps.map((step) => step.args)).toEqual([
      ["fetch", "upstream", "main"],
      ["worktree", "add", "--detach", "/tmp/routa-upstream", "upstream/main"],
      ["worktree", "add", "-b", "local/routa-overlay-team", "/tmp/routa-overlay", "upstream/main"],
    ]);
  });

  it("reuses an existing overlay branch during bootstrap", () => {
    const plan = buildBootstrapPlan({
      repoRoot: "/tmp/routa",
      cleanDir: "/tmp/routa-upstream",
      overlayDir: "/tmp/routa-overlay",
      overlayBranch: "local/routa-overlay-team",
      existingBranches: ["main", "local/routa-overlay-team"],
      remotes: ["origin"],
      baseBranch: "main",
    });

    expect(plan.baseRef).toBe("origin/main");
    expect(plan.remote.usedFallback).toBe(true);
    expect(plan.steps[2]?.args).toEqual([
      "worktree",
      "add",
      "/tmp/routa-overlay",
      "local/routa-overlay-team",
    ]);
  });

  it("creates a sync plan that refreshes the clean worktree then rebases the overlay", () => {
    const plan = buildSyncPlan({
      repoRoot: "/tmp/routa",
      cleanDir: "/tmp/routa-upstream",
      overlayDir: "/tmp/routa-overlay",
      remotes: ["upstream"],
      baseBranch: "main",
    });

    expect(plan.baseRef).toBe("upstream/main");
    expect(plan.steps.map((step) => ({ cwd: step.cwd, args: step.args }))).toEqual([
      {
        cwd: "/tmp/routa",
        args: ["fetch", "upstream", "main"],
      },
      {
        cwd: "/tmp/routa-upstream",
        args: ["switch", "--detach", "upstream/main"],
      },
      {
        cwd: "/tmp/routa-upstream",
        args: ["reset", "--hard", "upstream/main"],
      },
      {
        cwd: "/tmp/routa-overlay",
        args: ["rebase", "upstream/main"],
      },
    ]);
  });
});
