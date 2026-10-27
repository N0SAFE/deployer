import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { simpleGit } from 'simple-git';
import { AppError } from "@deployer/errors";
import { FileSystem, type FsError } from '@deployer/effect-infra';
import { ArchiveExtractor, type ArchiveError } from '@deployer/effect-platform';
import { Cause, Effect, Exit, Layer } from 'effect';
@Injectable()
export class GitService {
    /**
     * Archive extraction runs on the Effect platform layer. `GitService` itself stays a
     * Promise-API Nest class until its consumers migrate, so the layer is run here at the edge.
     */
    private static readonly extractorLayer = ArchiveExtractor.layer.pipe(Layer.provide(FileSystem.layer));
    private readonly logger = new Logger(GitService.name);
    private readonly workspaceDir = process.env.WORKSPACE_DIR ?? '/tmp/deployer-workspace';
    constructor() {
        // Ensure workspace directory exists
        if (!fs.existsSync(this.workspaceDir)) {
            fs.mkdirSync(this.workspaceDir, { recursive: true });
        }
    }
    async cloneRepository(options: {
        url: string;
        branch?: string;
        commit?: string;
        deploymentId: string;
    }): Promise<string> {
        const { url, branch = 'main', commit, deploymentId } = options;
        const repoPath = path.join(this.workspaceDir, `deployment-${deploymentId}`);
        this.logger.log(`Cloning repository ${url} to ${repoPath}`);
        // Clean up existing directory
        if (fs.existsSync(repoPath)) {
            fs.rmSync(repoPath, { recursive: true, force: true });
        }
        try {
            const git = simpleGit();
            // Clone the repository
            await git.clone(url, repoPath, ['--depth', '1', '--branch', branch]);
            // If specific commit is requested, checkout that commit
            if (commit) {
                const repoGit = simpleGit(repoPath);
                await repoGit.checkout(commit);
            }
            this.logger.log(`Repository cloned successfully to ${repoPath}`);
            return repoPath;
        }
        catch (error) {
            this.logger.error(`Failed to clone repository ${url}:`, error);
            // Clean up on failure
            if (fs.existsSync(repoPath)) {
                fs.rmSync(repoPath, { recursive: true, force: true });
            }
            throw error;
        }
    }
    async extractUploadedFile(options: {
        filePath: string;
        deploymentId: string;
    }): Promise<string> {
        const { filePath, deploymentId } = options;
        const extractPath = path.join(this.workspaceDir, `deployment-${deploymentId}`);
        this.logger.log(`Extracting uploaded file ${filePath} to ${extractPath}`);
        // Clean up existing directory
        if (fs.existsSync(extractPath)) {
            fs.rmSync(extractPath, { recursive: true, force: true });
        }
        fs.mkdirSync(extractPath, { recursive: true });
        try {
            // The format is sniffed from the content (zip / tar / tar.gz), never trusted from the file name.
            await this.extractArchive(filePath, extractPath);
            this.logger.log(`File extracted successfully to ${extractPath}`);
            return extractPath;
        }
        catch (error) {
            this.logger.error(`Failed to extract file ${filePath}:`, error);
            // Clean up on failure
            if (fs.existsSync(extractPath)) {
                fs.rmSync(extractPath, { recursive: true, force: true });
            }
            throw error;
        }
    }
    async getCommitInfo(repoPath: string): Promise<{
        sha: string;
        message: string;
        author: string;
        date: Date;
    }> {
        try {
            const git = simpleGit(repoPath);
            const log = await git.log({ maxCount: 1 });
            const latestCommit = log.latest;
            if (!latestCommit) {
                throw new AppError('No commits found in repository', 'INTERNAL_ERROR');
            }
            return {
                sha: latestCommit.hash,
                message: latestCommit.message,
                author: latestCommit.author_name,
                date: new Date(latestCommit.date)
            };
        }
        catch (error) {
            this.logger.error(`Failed to get commit info from ${repoPath}:`, error);
            throw error;
        }
    }
    cleanupDeployment(deploymentId: string): void {
        const repoPath = path.join(this.workspaceDir, `deployment-${deploymentId}`);
        if (fs.existsSync(repoPath)) {
            this.logger.log(`Cleaning up deployment workspace: ${repoPath}`);
            fs.rmSync(repoPath, { recursive: true, force: true });
        }
    }
    async validateRepository(url: string): Promise<boolean> {
        try {
            const git = simpleGit();
            await git.listRemote([url]);
            return true;
        }
        catch (error) {
            this.logger.error(`Repository validation failed for ${url}:`, error);
            return false;
        }
    }
    private async extractArchive(filePath: string, extractPath: string): Promise<void> {
        const exit = await Effect.runPromiseExit(
            Effect.gen(function* () {
                return yield* (yield* ArchiveExtractor).extract(filePath, extractPath);
            }).pipe(Effect.provide(GitService.extractorLayer)),
        );
        if (Exit.isSuccess(exit)) {
            return;
        }
        const failure = exit.cause.reasons.find((reason) => reason._tag === 'Fail');
        if (failure === undefined) {
            // A defect or an interruption: not an archive problem, so do not blame the upload.
            throw new AppError(`Failed to extract archive: ${Cause.pretty(exit.cause)}`, 'INTERNAL_ERROR');
        }
        throw GitService.toAppError(failure.error);
    }
    /** Hostile or malformed uploads are the caller's fault (400); our own filesystem failing is not. */
    private static toAppError(error: ArchiveError | FsError): AppError {
        switch (error._tag) {
            case 'UnsafePath':
                return new AppError(`Invalid archive: unsafe path "${error.entry}" (${error.reason})`, 'BAD_REQUEST');
            case 'SymlinkEscape':
                return new AppError(`Invalid archive: ${error.kind} entries are not allowed ("${error.entry}")`, 'BAD_REQUEST');
            case 'TooManyEntries':
                return new AppError(`Invalid archive: more than ${String(error.limit)} entries`, 'BAD_REQUEST');
            case 'TooLarge':
                return new AppError(`Invalid archive: ${error.what} exceeds the size limit`, 'BAD_REQUEST');
            case 'NestingTooDeep':
                return new AppError(`Invalid archive: path nested deeper than ${String(error.limit)} levels`, 'BAD_REQUEST');
            case 'UnsupportedFormat':
                return new AppError(`Unsupported archive: ${error.reason}`, 'BAD_REQUEST');
            case 'Corrupt':
                return new AppError(`Invalid archive: ${error.reason}`, 'BAD_REQUEST');
            case 'DestinationNotEmpty':
            case 'FsError':
                return new AppError(`Failed to extract archive: ${error._tag === 'FsError' ? error.message : 'destination is not empty'}`, 'INTERNAL_ERROR');
        }
    }
}
