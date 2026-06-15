/**
 * @module history/git-context
 * Retrieve git commit SHA and branch name from the current working directory.
 */

import { execSync } from 'node:child_process';

export interface GitContext {
  commit: string | null;
  branch: string | null;
}

/**
 * Get the current git commit and branch for the given directory.
 * Returns null values gracefully when not in a git repo or on detached HEAD.
 */
export function getGitContext(cwd: string): GitContext {
  let commit: string | null = null;
  let branch: string | null = null;

  try {
    commit = execSync('git rev-parse HEAD', { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    if (!commit) commit = null;
  } catch {
    return { commit: null, branch: null };
  }

  try {
    const rawBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    branch = rawBranch === 'HEAD' ? null : rawBranch;
  } catch {
    branch = null;
  }

  return { commit, branch };
}
