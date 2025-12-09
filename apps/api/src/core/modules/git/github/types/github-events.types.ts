/**
 * GitHub Webhook Event Types for Deployment
 *
 * This module provides type definitions for GitHub webhook events
 * that are relevant to deployment operations. It wraps the @octokit/webhooks-types
 * and provides utility types and type guards for safe event handling.
 */

import type {
  PushEvent,
  PullRequestEvent,
  CreateEvent,
  ReleaseEvent,
  WorkflowRunEvent,
  IssuesEvent,
  Schema as WebhookPayload,
  Repository,
  User,
  Commit,
} from '@octokit/webhooks-types';

// Re-export the webhook payload types
export type {
  PushEvent,
  PullRequestEvent,
  CreateEvent,
  ReleaseEvent,
  WorkflowRunEvent,
  IssuesEvent,
  WebhookPayload,
  Repository,
  User,
  Commit,
};

/**
 * Base interface for events that have repository information
 */
export interface RepositoryEvent {
  repository: Repository;
  sender: User;
}

/**
 * Union of deployment-related events that have repository information
 * These are the event types that can trigger deployments
 */
export type DeploymentTriggerEvent =
  | PushEvent
  | PullRequestEvent
  | CreateEvent
  | ReleaseEvent
  | WorkflowRunEvent;

/**
 * Simplified event structure used internally by RuleMatcherService
 * and other deployment services
 */
export interface NormalizedGitHubEvent {
  type: 'push' | 'pull_request' | 'create' | 'release' | 'tag' | 'workflow_run';
  action?: string;
  repository: {
    id: number;
    name: string;
    full_name: string;
    private: boolean;
    html_url: string;
    default_branch: string;
  };
  ref?: string;
  branch?: string;
  before?: string;
  after?: string;
  commits?: {
    id: string;
    message: string;
    added?: string[];
    modified?: string[];
    removed?: string[];
  }[];
  pull_request?: {
    number: number;
    title: string;
    state: string;
    merged: boolean;
    head: {
      ref: string;
      sha: string;
    };
    base: {
      ref: string;
    };
    labels: { name: string }[];
  };
  release?: {
    tag_name: string;
    name: string | null;
    draft: boolean;
    prerelease: boolean;
    created_at: string;
    published_at?: string | null;
  };
  sender: {
    login: string;
    type: string;
  };
  pusher?: {
    name?: string;
    email?: string;
  };
}

/**
 * Type guard to check if payload is a deployment-related event with repository info
 */
export function hasRepository(
  payload: WebhookPayload
): payload is WebhookPayload & RepositoryEvent {
  return 'repository' in payload && payload.repository !== undefined;
}

/**
 * Type guard to check if payload is a PushEvent
 */
export function isPushEvent(
  eventType: string,
  payload: WebhookPayload
): payload is PushEvent {
  return eventType === 'push' && 'ref' in payload && 'commits' in payload;
}

/**
 * Type guard to check if payload is a PullRequestEvent
 */
export function isPullRequestEvent(
  eventType: string,
  payload: WebhookPayload
): payload is PullRequestEvent {
  return eventType === 'pull_request' && 'pull_request' in payload;
}

/**
 * Type guard to check if payload is a CreateEvent
 */
export function isCreateEvent(
  eventType: string,
  payload: WebhookPayload
): payload is CreateEvent {
  return eventType === 'create' && 'ref_type' in payload;
}

/**
 * Type guard to check if payload is a ReleaseEvent
 */
export function isReleaseEvent(
  eventType: string,
  payload: WebhookPayload
): payload is ReleaseEvent {
  return eventType === 'release' && 'release' in payload;
}

/**
 * Type guard to check if payload is an IssuesEvent
 */
export function isIssuesEvent(
  eventType: string,
  payload: WebhookPayload
): payload is IssuesEvent {
  return eventType === 'issues' && 'issue' in payload;
}

/**
 * Type guard to check if payload is a WorkflowRunEvent
 */
export function isWorkflowRunEvent(
  eventType: string,
  payload: WebhookPayload
): payload is WorkflowRunEvent {
  return eventType === 'workflow_run' && 'workflow_run' in payload;
}

/**
 * Extract changed files from push event commits
 */
export function extractChangedFilesFromCommits(
  commits: Commit[] | undefined
): string[] {
  if (!commits) return [];

  const files = new Set<string>();
  for (const commit of commits) {
    if (commit.added) commit.added.forEach((f) => files.add(f));
    if (commit.modified) commit.modified.forEach((f) => files.add(f));
    if (commit.removed) commit.removed.forEach((f) => files.add(f));
  }
  return Array.from(files);
}
