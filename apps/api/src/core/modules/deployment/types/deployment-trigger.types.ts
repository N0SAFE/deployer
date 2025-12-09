/**
 * Provider-Agnostic Deployment Trigger Types
 *
 * These types define a provider-agnostic interface for deployment triggers.
 * Any provider (GitHub, GitLab, Bitbucket, etc.) should normalize their
 * events to these types before passing to core deployment services.
 *
 * Core deployment services should ONLY depend on these types, not on
 * provider-specific event types (like NormalizedGitHubEvent).
 */

/**
 * Source types that can trigger deployments
 */
export type DeploymentSourceType =
  | 'github'
  | 'gitlab'
  | 'bitbucket'
  | 'git'
  | 'upload'
  | 'static'
  | 'custom';

/**
 * Event types that trigger deployments
 */
export type DeploymentEventType =
  | 'push'
  | 'pull_request'
  | 'merge_request'
  | 'tag'
  | 'release'
  | 'manual'
  | 'scheduled'
  | 'api';

/**
 * Generic source repository information
 * Provider-specific modules should normalize their repo data to this format
 */
export interface DeploymentSourceRepository {
  /** Unique identifier from the source provider */
  id: string | number;
  /** Repository name */
  name: string;
  /** Full repository path (e.g., "owner/repo") */
  fullName: string;
  /** Whether the repository is private */
  private: boolean;
  /** URL to the repository */
  url: string;
  /** Default branch name */
  defaultBranch: string;
  /** Clone URL for git operations */
  cloneUrl?: string;
}

/**
 * Generic commit information
 */
export interface DeploymentCommit {
  /** Commit SHA/hash */
  sha: string;
  /** Commit message */
  message: string;
  /** Author information */
  author?: {
    name?: string;
    email?: string;
  };
  /** Timestamp */
  timestamp?: Date | string;
  /** Files added in this commit */
  added?: string[];
  /** Files modified in this commit */
  modified?: string[];
  /** Files removed in this commit */
  removed?: string[];
}

/**
 * Generic pull/merge request information
 */
export interface DeploymentPullRequest {
  /** PR/MR number */
  number: number;
  /** Title */
  title: string;
  /** State (open, closed, merged) */
  state: string;
  /** Whether the PR is merged */
  merged: boolean;
  /** Source branch */
  sourceBranch: string;
  /** Source commit SHA */
  sourceSha: string;
  /** Target branch */
  targetBranch: string;
  /** Labels/tags on the PR */
  labels?: string[];
}

/**
 * Generic release/tag information
 */
export interface DeploymentRelease {
  /** Tag name */
  tagName: string;
  /** Release name/title */
  name?: string | null;
  /** Whether this is a draft release */
  draft?: boolean;
  /** Whether this is a pre-release */
  prerelease?: boolean;
  /** Creation timestamp */
  createdAt?: string;
  /** Publish timestamp */
  publishedAt?: string;
}

/**
 * Person who triggered the deployment
 */
export interface DeploymentActor {
  /** Username/login */
  username: string;
  /** Account type (user, bot, etc.) */
  type?: string;
  /** Email if available */
  email?: string;
}

/**
 * Provider-agnostic deployment trigger event
 *
 * This is the main interface that all provider-specific events should
 * be normalized to before being processed by core deployment services.
 */
export interface DeploymentTriggerEvent {
  /** Source provider type */
  sourceType: DeploymentSourceType;
  /** Event type that triggered this deployment */
  eventType: DeploymentEventType;
  /** Action within the event (e.g., "opened", "synchronize" for PRs) */
  action?: string;
  /** Repository information */
  repository: DeploymentSourceRepository;
  /** Branch reference (e.g., "refs/heads/main" or "main") */
  ref?: string;
  /** Resolved branch name */
  branch?: string;
  /** Commit SHA before the event (for push events) */
  beforeSha?: string;
  /** Commit SHA after the event (current state) */
  afterSha?: string;
  /** Commits included in this event */
  commits?: DeploymentCommit[];
  /** Pull/Merge request information (if applicable) */
  pullRequest?: DeploymentPullRequest;
  /** Release information (if applicable) */
  release?: DeploymentRelease;
  /** Who triggered this event */
  actor: DeploymentActor;
  /** Provider-specific metadata (for backward compatibility) */
  metadata?: Record<string, unknown>;
}

/**
 * Result of matching deployment rules against an event
 */
export interface DeploymentRuleMatch {
  /** The matched rule */
  rule: {
    id: string;
    name: string;
    environment?: string;
    deploymentStrategy?: string;
    [key: string]: unknown;
  };
  /** The target service for deployment */
  service: {
    id: string;
    name: string;
    projectId: string;
    builderId?: string;
    builderIdConfig?: {
      buildArgs?: Record<string, string>;
      [key: string]: unknown;
    };
    repoConfig?: {
      cacheStrategy?: 'strict' | 'loose';
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Deployment configuration derived from rule + event */
  deploymentConfig: {
    branch?: string;
    environment: string;
    strategy?: string;
    [key: string]: unknown;
  };
  /** Files changed in this event */
  changedFiles: string[];
  /** Repository/source configuration */
  sourceConfig?: Record<string, unknown>;
}

/**
 * Extract changed files from commits
 */
export function extractChangedFiles(commits: DeploymentCommit[] | undefined): string[] {
  if (!commits) return [];

  const files = new Set<string>();
  for (const commit of commits) {
    if (commit.added) commit.added.forEach((f) => files.add(f));
    if (commit.modified) commit.modified.forEach((f) => files.add(f));
    if (commit.removed) commit.removed.forEach((f) => files.add(f));
  }
  return Array.from(files);
}
