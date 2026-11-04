import * as fs from "fs";
import * as path from "path";

import { Cause, Context, Effect, Layer } from "effect";
import { simpleGit } from "simple-git";

import { FileSystem, type FsError } from "@deployer/effect-infra";
import { ArchiveExtractor, type ArchiveError } from "@deployer/effect-platform";
import type { ServiceLifecycleShape } from "@deployer/nest-effect";

import {
    ArchiveExtractionFailure,
    ArchiveRejected,
    GitCommandFailure,
    GitInputInvalid,
    GitNoCommits,
} from "../errors";

import { gitRefProblem, repositoryUrlProblem, type GitRefField } from "./git-input";

export type CommitInfo = { sha: string; message: string; author: string; date: Date };

/**
 * Local git operations over a per-deployment workspace directory: clone, extract an upload, describe the head commit,
 * clean up, and probe a remote. Every input that reaches a `git` argv is validated first.
 *
 * It owns one resource (the workspace directory), so it is built once over its path and declares `onStart` to create it.
 */
export type GitServiceShape = ServiceLifecycleShape & {
    /** Shallow-clone a repository (optionally detached at `commit`) into the deployment's workspace; the path. */
    readonly cloneRepository: (options: {
        url: string;
        branch?: string;
        commit?: string;
        deploymentId: string;
    }) => Effect.Effect<string, GitInputInvalid | GitCommandFailure>;
    /** Extract an uploaded zip/tar/tar.gz (format sniffed from content) into the workspace; the path. */
    readonly extractUploadedFile: (options: {
        filePath: string;
        deploymentId: string;
    }) => Effect.Effect<string, ArchiveRejected | ArchiveExtractionFailure>;
    readonly getCommitInfo: (repoPath: string) => Effect.Effect<CommitInfo, GitNoCommits | GitCommandFailure>;
    /** Remove the deployment's workspace. */
    readonly cleanupDeployment: (deploymentId: string) => Effect.Effect<void>;
    /** Whether the remote answers `ls-remote`. Never fails: a rejected URL or an unreachable remote is `false`. */
    readonly validateRepository: (url: string) => Effect.Effect<boolean>;
    readonly onStart: () => Effect.Effect<void>;
};

const extractorLayer = ArchiveExtractor.layer.pipe(Layer.provide(FileSystem.layer));

const removeDir = (dir: string): Effect.Effect<void> =>
    Effect.sync(() => {
        if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    });

const checked = (value: string, field: GitRefField): Effect.Effect<string, GitInputInvalid> => {
    const problem = gitRefProblem(value);
    return problem === undefined ? Effect.succeed(value) : Effect.fail(new GitInputInvalid({ field, reason: `"${value}": ${problem}` }));
};

/** Hostile or malformed uploads are the caller's fault (400); our own filesystem failing is not. */
function toExtractionError(error: ArchiveError | FsError): ArchiveRejected | ArchiveExtractionFailure {
    switch (error._tag) {
        case "UnsafePath":
            return new ArchiveRejected({ reason: `Invalid archive: unsafe path "${error.entry}" (${error.reason})` });
        case "SymlinkEscape":
            return new ArchiveRejected({ reason: `Invalid archive: ${error.kind} entries are not allowed ("${error.entry}")` });
        case "TooManyEntries":
            return new ArchiveRejected({ reason: `Invalid archive: more than ${String(error.limit)} entries` });
        case "TooLarge":
            return new ArchiveRejected({ reason: `Invalid archive: ${error.what} exceeds the size limit` });
        case "NestingTooDeep":
            return new ArchiveRejected({ reason: `Invalid archive: path nested deeper than ${String(error.limit)} levels` });
        case "UnsupportedFormat":
            return new ArchiveRejected({ reason: `Unsupported archive: ${error.reason}` });
        case "Corrupt":
            return new ArchiveRejected({ reason: `Invalid archive: ${error.reason}` });
        case "DestinationNotEmpty":
            return new ArchiveExtractionFailure({ reason: "destination is not empty" });
        case "FsError":
            return new ArchiveExtractionFailure({ reason: error.message });
    }
}

export function makeGitService(options: { readonly workspaceDir: string }): GitServiceShape {
    const { workspaceDir } = options;
    const workspaceOf = (deploymentId: string): string => path.join(workspaceDir, `deployment-${deploymentId}`);

    const git = (operation: string, run: () => Promise<unknown>) =>
        Effect.tryPromise({ try: run, catch: (cause) => new GitCommandFailure({ operation, cause }) });

    return {
        onStart: () => Effect.sync(() => { fs.mkdirSync(workspaceDir, { recursive: true }); }),

        cloneRepository: ({ url: rawUrl, branch: rawBranch, commit, deploymentId }) =>
            Effect.gen(function* () {
                // Every value below reaches a `git` argv; validate before any filesystem work.
                const urlProblem = repositoryUrlProblem(rawUrl);
                if (urlProblem !== undefined) {
                    return yield* new GitInputInvalid({
                        field: "repositoryUrl",
                        reason: `${urlProblem}. Use https://host/path, ssh://git@host/path or git@host:path.`,
                    });
                }
                const branch = yield* checked(rawBranch ?? "main", "branch");
                const commitRef = commit === undefined ? undefined : yield* checked(commit, "commit");
                const repoPath = workspaceOf(deploymentId);

                yield* Effect.logInfo(`Cloning repository ${rawUrl} to ${repoPath}`);
                yield* removeDir(repoPath);

                yield* Effect.gen(function* () {
                    // `--` ends option parsing, so a hostile URL can never become a git flag.
                    yield* git("clone", () => simpleGit().raw(["clone", "--depth", "1", "--branch", branch, "--", rawUrl, repoPath]));
                    if (commitRef !== undefined) {
                        yield* git("checkout", () => simpleGit(repoPath).raw(["checkout", "--detach", commitRef, "--"]));
                    }
                }).pipe(
                    // A failed clone leaves nothing behind.
                    Effect.tapError((error) => Effect.logError(`Failed to clone repository ${rawUrl}: ${error.message}`).pipe(Effect.andThen(removeDir(repoPath)))),
                );

                yield* Effect.logInfo(`Repository cloned successfully to ${repoPath}`);
                return repoPath;
            }),

        extractUploadedFile: ({ filePath, deploymentId }) =>
            Effect.gen(function* () {
                const extractPath = workspaceOf(deploymentId);
                yield* Effect.logInfo(`Extracting uploaded file ${filePath} to ${extractPath}`);
                yield* removeDir(extractPath);
                yield* Effect.sync(() => { fs.mkdirSync(extractPath, { recursive: true }); });

                yield* Effect.gen(function* () {
                    const extractor = yield* ArchiveExtractor;
                    // The format is sniffed from the content, never trusted from the file name.
                    yield* extractor.extract(filePath, extractPath);
                }).pipe(
                    Effect.provide(extractorLayer),
                    Effect.catchCause((cause) => {
                        const failure = cause.reasons.find((reason) => reason._tag === "Fail");
                        // A defect or an interruption is not an archive problem, so the upload is not blamed.
                        return Effect.fail(
                            failure === undefined
                                ? new ArchiveExtractionFailure({ reason: Cause.pretty(cause) })
                                : toExtractionError(failure.error),
                        );
                    }),
                    Effect.tapError((error) => Effect.logError(`Failed to extract file ${filePath}: ${error.message}`).pipe(Effect.andThen(removeDir(extractPath)))),
                );

                yield* Effect.logInfo(`File extracted successfully to ${extractPath}`);
                return extractPath;
            }),

        getCommitInfo: (repoPath) =>
            Effect.gen(function* () {
                const log = (yield* Effect.tryPromise({
                    try: () => simpleGit(repoPath).log({ maxCount: 1 }),
                    catch: (cause) => new GitCommandFailure({ operation: "log", cause }),
                }));
                const latest = log.latest;
                if (!latest) return yield* new GitNoCommits({});
                return { sha: latest.hash, message: latest.message, author: latest.author_name, date: new Date(latest.date) };
            }).pipe(Effect.tapError((error) => Effect.logError(`Failed to get commit info from ${repoPath}: ${error.message}`))),

        cleanupDeployment: (deploymentId) =>
            Effect.suspend(() => {
                const repoPath = workspaceOf(deploymentId);
                return fs.existsSync(repoPath)
                    ? Effect.logInfo(`Cleaning up deployment workspace: ${repoPath}`).pipe(Effect.andThen(removeDir(repoPath)))
                    : Effect.void;
            }),

        validateRepository: (url) =>
            Effect.gen(function* () {
                const problem = repositoryUrlProblem(url);
                if (problem !== undefined) {
                    // Callers turn `false` into "repository not reachable"; the reason is the log line.
                    yield* Effect.logWarning(`Rejected repository URL (${problem})`);
                    return false;
                }
                return yield* git("ls-remote", () => simpleGit().raw(["ls-remote", "--", url])).pipe(
                    Effect.as(true),
                    Effect.catch((error) => Effect.logError(`Repository validation failed for ${url}: ${error.message}`).pipe(Effect.as(false))),
                );
            }),
    };
}

export class GitService extends Context.Service<GitService, GitServiceShape>()("shared/GitService") {}
