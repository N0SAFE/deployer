import { Injectable, Logger } from "@nestjs/common";
import { GithubDeploymentRulesRepository } from "@/core/modules/git/github/repositories/github-deployment-rules.repository";

/**
 * Minimal glob matcher supporting `*` (within a path segment), `**` (any
 * number of segments) and literal text. Kept dependency-free by design.
 */
function globMatch(pattern: string, value: string): boolean {
    const tokens = pattern.split("/");
    const parts = value.split("/");
    let p = 0;
    let v = 0;
    let starP = -1;
    let starV = -1;
    while (v < parts.length) {
        if (p < tokens.length && (tokens[p] === "**" || tokens[p] === "*")) {
            starP = p;
            starV = v;
            p += 1;
        } else if (p < tokens.length && (tokens[p]! === parts[v]! || (tokens[p]!.includes("*") && segmentMatch(tokens[p]!, parts[v]!)))) {
            p += 1;
            v += 1;
        } else if (starP !== -1) {
            p = starP + 1;
            starV += 1;
            v = starV;
        } else {
            return false;
        }
    }
    while (p < tokens.length && tokens[p] === "**") {
        p += 1;
    }
    return p === tokens.length;
}

function segmentMatch(pattern: string, segment: string): boolean {
    const regex = new RegExp(
        `^${pattern.split("*").map(escapeRegex).join(".*")}$`,
    );
    return regex.test(segment);
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type GithubRuleAction = "deploy" | "preview" | "skip";

export interface GithubRuleEvaluationInput {
    /** The project scope the event belongs to. */
    projectId: string;
    /** The raw GitHub event type, e.g. "push" | "pull_request" | "tag". */
    event: string;
    branch?: string | null;
    tag?: string | null;
    /** Changed file paths (used to evaluate pathConditions). */
    changedFiles?: string[];
}

export interface GithubRuleEvaluationResult {
    /** The resolved action, defaulting to deployment when no rule matched. */
    action: GithubRuleAction;
    /** The rule that matched, when one did. */
    rule?: {
        id: string;
        name: string;
        bypassCache: boolean;
        deploymentStrategy?: string | null;
    };
    /** Human-readable reason for traceability / lifecycle events. */
    reason: string;
}

interface GithubDeploymentRuleRecord {
    id: string;
    name: string;
    priority: number;
    isActive: boolean;
    event: string;
    branchPattern?: string | null;
    tagPattern?: string | null;
    pathConditions?: { include?: string[]; exclude?: string[]; requireAll?: boolean } | null;
    customCondition?: string | null;
    action: string;
    deploymentStrategy?: string | null;
    bypassCache: boolean;
}

/**
 * Evaluates the (previously unused) `github_deployment_rules` table against an
 * incoming GitHub webhook event to decide `deploy | preview | skip`.
 *
 * Rules are matched in priority order; the first matching active rule for the
 * project + event wins. This wires the rules table into the webhook decision
 * flow so per-project, per-branch Github events can gate/route deployments.
 */
@Injectable()
export class GithubDeploymentRuleService {
    private readonly logger = new Logger(GithubDeploymentRuleService.name);

    constructor(
        private readonly rulesRepository: GithubDeploymentRulesRepository,
    ) {}

    /**
     * Resolve the action for an event by evaluating the project's active rules
     * in priority order. Returns the default `deploy` when no rule matches.
     */
    async resolveAction(
        input: GithubRuleEvaluationInput,
    ): Promise<GithubRuleEvaluationResult> {
        const rules = await this.rulesRepository.findActiveByProjectId(input.projectId);

        for (const rule of rules) {
            if (!this.matchesEvent(rule, input)) {
                continue;
            }
            const action = this.toAction(rule.action);
            this.logger.log(
                `github_deployment_rule "${rule.name}" matched event=${input.event} ` +
                    `branch=${input.branch ?? "-"} -> action=${action}`,
            );
            return {
                action,
                rule: {
                    id: rule.id,
                    name: rule.name,
                    bypassCache: rule.bypassCache,
                    deploymentStrategy: rule.deploymentStrategy,
                },
                reason: `rule:${rule.name}`,
            };
        }

        return { action: "deploy", reason: "no_rule_matched" };
    }

    private matchesEvent(rule: GithubDeploymentRuleRecord, input: GithubRuleEvaluationInput): boolean {
        if (rule.event !== input.event) {
            return false;
        }
        if (rule.branchPattern && input.branch) {
            if (!branchMatches(rule.branchPattern, input.branch)) {
                return false;
            }
        }
        if (rule.tagPattern && input.tag) {
            if (!globMatch(rule.tagPattern, input.tag)) {
                return false;
            }
        }
        if (rule.pathConditions && input.changedFiles) {
            if (!this.matchesPathConditions(rule.pathConditions, input.changedFiles)) {
                return false;
            }
        }
        return true;
    }

    private matchesPathConditions(
        conditions: { include?: string[]; exclude?: string[]; requireAll?: boolean },
        changedFiles: string[],
    ): boolean {
        const { include = [], exclude = [], requireAll = false } = conditions;
        if (exclude.length > 0 && changedFiles.some((file) => include.some((p) => globMatch(p, file)))) {
            return false;
        }
        if (include.length === 0) {
            return true;
        }
        const matched = changedFiles.filter((file) => include.some((p) => globMatch(p, file)));
        return requireAll ? matched.length === include.length : matched.length > 0;
    }

    private toAction(raw: string): GithubRuleAction {
        if (raw === "preview") return "preview";
        if (raw === "skip") return "skip";
        return "deploy";
    }
}

function branchMatches(pattern: string, branch: string): boolean {
    const normalized = pattern.trim();
    if (normalized === "*" || normalized === "**") {
        return true;
    }
    if (normalized.startsWith("regex:")) {
        try {
            return new RegExp(normalized.slice("regex:".length)).test(branch);
        } catch {
            return false;
        }
    }
    return globMatch(normalized, branch);
}
