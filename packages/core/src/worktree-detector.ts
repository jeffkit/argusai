/**
 * @module worktree-detector
 * Detect git worktree context and derive isolation namespace suffixes.
 *
 * When ArgusAI runs inside a git worktree (e.g. .worktrees/feat/user-auth/),
 * it auto-generates a unique namespace suffix so that Docker containers,
 * networks, and ports don't collide with other worktrees of the same project.
 */

import { execSync } from 'node:child_process';
import { resolve, relative } from 'node:path';

export interface WorktreeInfo {
  /** Whether the current directory is inside a git worktree (not the main working tree) */
  isWorktree: boolean;
  /** The branch name of this worktree (e.g. "feat/user-auth") */
  branch?: string;
  /** A Docker-safe slug derived from the branch (e.g. "feat-user-auth") */
  slug?: string;
  /** Absolute path of the worktree root */
  worktreeRoot?: string;
  /** Absolute path of the main repo root (the common git dir's parent) */
  mainRepoRoot?: string;
}

/**
 * Detect whether `projectDir` is inside a git worktree.
 *
 * Detection strategy:
 * 1. `git rev-parse --git-common-dir` → shared .git directory
 * 2. `git rev-parse --git-dir` → per-worktree .git directory
 * 3. If they differ, we're in a linked worktree
 * 4. Extract branch from `git rev-parse --abbrev-ref HEAD`
 */
export function detectWorktree(projectDir: string): WorktreeInfo {
  try {
    const cwd = resolve(projectDir);
    const gitDir = gitExec('rev-parse --git-dir', cwd).trim();
    const gitCommonDir = gitExec('rev-parse --git-common-dir', cwd).trim();

    const absGitDir = resolve(cwd, gitDir);
    const absCommonDir = resolve(cwd, gitCommonDir);

    const isWorktree = absGitDir !== absCommonDir;

    if (!isWorktree) {
      return { isWorktree: false };
    }

    const worktreeRoot = gitExec('rev-parse --show-toplevel', cwd).trim();
    const mainRepoRoot = resolve(absCommonDir, '..');
    const branch = gitExec('rev-parse --abbrev-ref HEAD', cwd).trim();

    return {
      isWorktree: true,
      branch,
      slug: branchToSlug(branch),
      worktreeRoot,
      mainRepoRoot,
    };
  } catch {
    return { isWorktree: false };
  }
}

/**
 * Convert a branch name to a Docker-safe slug.
 * "feat/user-auth" → "feat-user-auth"
 * "fix/login-bug-#123" → "fix-login-bug-123"
 */
export function branchToSlug(branch: string): string {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/**
 * Derive a worktree-aware namespace suffix.
 * Returns empty string if not in a worktree.
 */
export function worktreeNamespaceSuffix(projectDir: string): string {
  const info = detectWorktree(projectDir);
  return info.slug ?? '';
}

function gitExec(args: string, cwd: string): string {
  return execSync(`git ${args}`, {
    cwd,
    encoding: 'utf-8',
    timeout: 5000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}
