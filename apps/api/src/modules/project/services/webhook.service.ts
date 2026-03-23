import { Injectable, NotFoundException, ForbiddenException } from "@nestjs/common";
import { randomBytes } from "crypto";
import { WebhookRepository, type WebhookCreateInput } from "../repositories/webhook.repository";
import { ProjectRepository } from "../repositories/project.repository";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateWebhookInput {
    projectId: string;
    requesterId: string;
    sourceType: "github" | "gitlab" | "git" | "upload" | "custom";
    webhookUrl: string;
    serviceId?: string;
    externalWebhookId?: string;
    settings?: {
        events?: string[];
        branches?: string[];
        skipCi?: boolean;
        autoPreview?: boolean;
    };
}

export interface RotateWebhookSecretResult {
    webhookId: string;
    /** Raw secret — returned only once; store it securely. Encrypted in the DB. */
    rawSecret: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class WebhookService {
    constructor(
        private readonly webhookRepository: WebhookRepository,
        private readonly projectRepository: ProjectRepository,
    ) {}

    // -----------------------------------------------------------------------
    // CRUD
    // -----------------------------------------------------------------------

    async createWebhook(input: CreateWebhookInput) {
        await this.assertProjectAccess(input.projectId, input.requesterId);

        // Generate a cryptographically random HMAC signing secret (32 bytes = 64 hex chars)
        const rawSecret = randomBytes(32).toString("hex");

        const dao: WebhookCreateInput = {
            projectId: input.projectId,
            sourceType: input.sourceType,
            webhookUrl: input.webhookUrl,
            secret: rawSecret, // encryptedText column auto-encrypts on insert
            serviceId: input.serviceId ?? null,
            externalWebhookId: input.externalWebhookId ?? null,
            settings: input.settings,
        };

        const webhook = await this.webhookRepository.create(dao);

        return {
            webhook,
            /** Raw secret — returned only once at creation. */
            rawSecret,
        };
    }

    async getWebhook(id: string, requesterId: string) {
        const webhook = await this.webhookRepository.findById(id);
        if (!webhook) throw new NotFoundException(`Webhook ${id} not found`);
        await this.assertProjectAccess(webhook.projectId, requesterId);
        return webhook;
    }

    async listWebhooks(projectId: string, requesterId: string) {
        await this.assertProjectAccess(projectId, requesterId);
        return this.webhookRepository.findByProject(projectId);
    }

    async disableWebhook(id: string, requesterId: string) {
        const webhook = await this.webhookRepository.findById(id);
        if (!webhook) throw new NotFoundException(`Webhook ${id} not found`);
        await this.assertProjectAccess(webhook.projectId, requesterId);
        return this.webhookRepository.update(id, { isActive: false });
    }

    async enableWebhook(id: string, requesterId: string) {
        const webhook = await this.webhookRepository.findById(id);
        if (!webhook) throw new NotFoundException(`Webhook ${id} not found`);
        await this.assertProjectAccess(webhook.projectId, requesterId);
        return this.webhookRepository.update(id, { isActive: true });
    }

    async deleteWebhook(id: string, requesterId: string) {
        const webhook = await this.webhookRepository.findById(id);
        if (!webhook) throw new NotFoundException(`Webhook ${id} not found`);
        await this.assertProjectAccess(webhook.projectId, requesterId);
        await this.webhookRepository.delete(id);
    }

    // -----------------------------------------------------------------------
    // Secret lifecycle
    // -----------------------------------------------------------------------

    /**
     * Rotate the HMAC signing secret for a webhook.
     * A new cryptographically random secret is generated, encrypted in the DB,
     * and returned **once** in plaintext. The caller must relay it to the
     * upstream platform (e.g. GitHub) immediately.
     */
    async rotateWebhookSecret(id: string, requesterId: string): Promise<RotateWebhookSecretResult> {
        const webhook = await this.webhookRepository.findById(id);
        if (!webhook) throw new NotFoundException(`Webhook ${id} not found`);
        await this.assertProjectAccess(webhook.projectId, requesterId);

        const rawSecret = randomBytes(32).toString("hex");
        await this.webhookRepository.updateSecret(id, rawSecret);

        return { webhookId: id, rawSecret };
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private async assertProjectAccess(projectId: string, requesterId: string) {
        const project = await this.projectRepository.findById(projectId);
        if (!project) throw new NotFoundException(`Project ${projectId} not found`);
        if (project.ownerId === requesterId) return;
        const collaborator = await this.projectRepository.findCollaboratorByUserAndProject(
            requesterId,
            projectId,
        );
        if (!collaborator || !["owner", "admin"].includes(collaborator.role)) {
            throw new ForbiddenException("You do not have permission to manage webhooks on this project");
        }
    }
}
