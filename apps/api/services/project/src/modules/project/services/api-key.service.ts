import { Injectable, NotFoundException, ForbiddenException, ConflictException } from "@nestjs/common";
import { createHash, randomBytes } from "crypto";
import { ApiKeyRepository } from "../repositories/api-key.repository";
import { ProjectRepository } from "../repositories/project.repository";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateApiKeyInput {
    userId: string;
    name: string;
    /** Optional project-scoped key. If provided, ownership is validated. */
    projectId?: string;
    scopes?: string[];
    expiresAt?: Date;
}

export interface IssueApiKeyResult {
    id: string;
    name: string;
    keyPreview: string;
    scopes: string[] | null;
    expiresAt: Date | null;
    createdAt: Date;
    /** Raw API key — returned **only once** at creation. Hash stored in DB. */
    rawKey: string;
}

export interface RotateApiKeyResult {
    /** The newly issued key record. */
    newKey: IssueApiKeyResult;
    /** ID of the revoked predecessor key. */
    revokedKeyId: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class ApiKeyService {
    constructor(
        private readonly apiKeyRepository: ApiKeyRepository,
        private readonly projectRepository: ProjectRepository,
    ) {}

    // -----------------------------------------------------------------------
    // Create
    // -----------------------------------------------------------------------

    /**
     * Issue a new API key.
     * Returns the raw key **once** — the DB stores only the SHA-256 hash and a preview.
     */
    async createApiKey(input: CreateApiKeyInput): Promise<IssueApiKeyResult> {
        if (input.projectId) {
            await this.assertProjectAccess(input.projectId, input.userId);
        }

        const rawKey = `dk_${randomBytes(32).toString("hex")}`;
        const keyHash = this.hashKey(rawKey);
        const keyPreview = rawKey.slice(0, 10);

        // Prevent duplicate hashes (astronomically unlikely, but defensive)
        const existing = await this.apiKeyRepository.findByHash(keyHash);
        if (existing) {
            throw new ConflictException("Key collision — please retry");
        }

        const record = await this.apiKeyRepository.create({
            userId: input.userId,
            name: input.name,
            keyHash,
            keyPreview,
            projectId: input.projectId ?? null,
            scopes: input.scopes ?? null,
            expiresAt: input.expiresAt ?? null,
        });

        return {
            id: record.id,
            name: record.name,
            keyPreview: record.keyPreview,
            scopes: record.scopes ?? null,
            expiresAt: record.expiresAt ?? null,
            createdAt: record.createdAt,
            rawKey,
        };
    }

    // -----------------------------------------------------------------------
    // Read
    // -----------------------------------------------------------------------

    async listUserKeys(userId: string) {
        return this.apiKeyRepository.findByUser(userId);
    }

    async listProjectKeys(projectId: string, requesterId: string) {
        await this.assertProjectAccess(projectId, requesterId);
        return this.apiKeyRepository.findByProject(projectId);
    }

    // -----------------------------------------------------------------------
    // Revoke
    // -----------------------------------------------------------------------

    /**
     * Permanently disable an API key.
     * The hash record is kept for audit purposes; `isActive = false` blocks authentication.
     */
    async revokeApiKey(id: string, requesterId: string): Promise<void> {
        const key = await this.apiKeyRepository.findById(id);
        if (!key) throw new NotFoundException(`API key ${id} not found`);
        if (key.userId !== requesterId) {
            // Also allow project admins to revoke project-scoped keys
            if (key.projectId) {
                await this.assertProjectAccess(key.projectId, requesterId);
            } else {
                throw new ForbiddenException("You do not have permission to revoke this API key");
            }
        }
        await this.apiKeyRepository.setActive(id, false);
    }

    // -----------------------------------------------------------------------
    // Rotate
    // -----------------------------------------------------------------------

    /**
     * Atomically revoke an existing key and issue a replacement.
     * Returns the new raw key in `newKey.rawKey` — store it immediately.
     */
    async rotateApiKey(id: string, requesterId: string): Promise<RotateApiKeyResult> {
        const old = await this.apiKeyRepository.findById(id);
        if (!old) throw new NotFoundException(`API key ${id} not found`);
        if (old.userId !== requesterId) {
            if (old.projectId) {
                await this.assertProjectAccess(old.projectId, requesterId);
            } else {
                throw new ForbiddenException("You do not have permission to rotate this API key");
            }
        }

        // Revoke the old key first
        await this.apiKeyRepository.setActive(id, false);

        // Issue a fresh replacement with the same name / scopes
        const newKey = await this.createApiKey({
            userId: old.userId,
            name: old.name,
            projectId: old.projectId ?? undefined,
            scopes: old.scopes ?? undefined,
            expiresAt: old.expiresAt ?? undefined,
        });

        return { newKey, revokedKeyId: id };
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /** SHA-256 hash of raw key — stored in DB for constant-time lookup. */
    private hashKey(rawKey: string): string {
        return createHash("sha256").update(rawKey).digest("hex");
    }

    private async assertProjectAccess(projectId: string, requesterId: string) {
        const project = await this.projectRepository.findById(projectId);
        if (!project) throw new NotFoundException(`Project ${projectId} not found`);
        if (project.ownerId === requesterId) return;
        const collaborator = await this.projectRepository.findCollaboratorByUserAndProject(
            requesterId,
            projectId,
        );
        if (!collaborator || !["owner", "admin"].includes(collaborator.role)) {
            throw new ForbiddenException("You do not have permission to manage API keys on this project");
        }
    }
}
