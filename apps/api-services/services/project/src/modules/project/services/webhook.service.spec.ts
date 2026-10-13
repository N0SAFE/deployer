import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { WebhookService } from "./webhook.service";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockProject = { id: "proj-1", ownerId: "user-1", name: "Test" };
const mockWebhook = {
    id: "wh-1",
    projectId: "proj-1",
    sourceType: "github",
    webhookUrl: "https://example.com/hook",
    secret: "encrypted-secret",
    isActive: true,
    triggerCount: 0,
    lastTriggered: null,
    serviceId: null,
    externalWebhookId: null,
    settings: null,
    createdAt: new Date(),
    updatedAt: new Date(),
};

describe("WebhookService", () => {
    let service: WebhookService;
    let mockWebhookRepository: {
        findById: ReturnType<typeof vi.fn>;
        findByProject: ReturnType<typeof vi.fn>;
        create: ReturnType<typeof vi.fn>;
        update: ReturnType<typeof vi.fn>;
        updateSecret: ReturnType<typeof vi.fn>;
        incrementTriggerCount: ReturnType<typeof vi.fn>;
        delete: ReturnType<typeof vi.fn>;
    };
    let mockProjectRepository: {
        findById: ReturnType<typeof vi.fn>;
        findCollaboratorByUserAndProject: ReturnType<typeof vi.fn>;
    };

    beforeEach(async () => {
        mockWebhookRepository = {
            findById: vi.fn(),
            findByProject: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
            updateSecret: vi.fn(),
            incrementTriggerCount: vi.fn(),
            delete: vi.fn(),
        };

        mockProjectRepository = {
            findById: vi.fn(),
            findCollaboratorByUserAndProject: vi.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                {
                    provide: WebhookService,
                    useFactory: () =>
                        new WebhookService(
                            mockWebhookRepository as never,
                            mockProjectRepository as never,
                        ),
                },
            ],
        }).compile();

        service = module.get<WebhookService>(WebhookService);
        vi.clearAllMocks();
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });

    // -----------------------------------------------------------------------
    // createWebhook
    // -----------------------------------------------------------------------

    describe("createWebhook", () => {
        it("should create webhook and return rawSecret for project owner", async () => {
            mockProjectRepository.findById.mockResolvedValue(mockProject);
            mockWebhookRepository.create.mockResolvedValue(mockWebhook);

            const result = await service.createWebhook({
                projectId: "proj-1",
                requesterId: "user-1",
                sourceType: "github",
                webhookUrl: "https://example.com/hook",
            });

            expect(result.webhook).toBeDefined();
            expect(result.rawSecret).toBeDefined();
            // Raw secret must be a 64-char hex string (32 bytes)
            expect(result.rawSecret).toMatch(/^[0-9a-f]{64}$/);
            expect(mockWebhookRepository.create).toHaveBeenCalledOnce();
        });

        it("should throw ForbiddenException for non-admin collaborator", async () => {
            mockProjectRepository.findById.mockResolvedValue(mockProject);
            mockProjectRepository.findCollaboratorByUserAndProject.mockResolvedValue({
                role: "developer",
            });

            await expect(
                service.createWebhook({
                    projectId: "proj-1",
                    requesterId: "user-nobody",
                    sourceType: "github",
                    webhookUrl: "https://example.com/hook",
                }),
            ).rejects.toThrow(ForbiddenException);
        });

        it("should throw NotFoundException for unknown project", async () => {
            mockProjectRepository.findById.mockResolvedValue(null);

            await expect(
                service.createWebhook({
                    projectId: "unknown",
                    requesterId: "user-1",
                    sourceType: "github",
                    webhookUrl: "https://example.com/hook",
                }),
            ).rejects.toThrow(NotFoundException);
        });

        it("should allow admin collaborator to create webhook", async () => {
            mockProjectRepository.findById.mockResolvedValue(mockProject);
            mockProjectRepository.findCollaboratorByUserAndProject.mockResolvedValue({
                role: "admin",
            });
            mockWebhookRepository.create.mockResolvedValue(mockWebhook);

            const result = await service.createWebhook({
                projectId: "proj-1",
                requesterId: "admin-collab",
                sourceType: "github",
                webhookUrl: "https://example.com/hook",
            });

            expect(result.webhook).toBeDefined();
            expect(result.rawSecret).toMatch(/^[0-9a-f]{64}$/);
        });
    });

    // -----------------------------------------------------------------------
    // rotateWebhookSecret
    // -----------------------------------------------------------------------

    describe("rotateWebhookSecret", () => {
        it("should generate a new secret and return it once for project owner", async () => {
            mockWebhookRepository.findById.mockResolvedValue(mockWebhook);
            mockProjectRepository.findById.mockResolvedValue(mockProject);
            mockWebhookRepository.updateSecret.mockResolvedValue({
                ...mockWebhook,
                secret: "new-encrypted",
            });

            const result = await service.rotateWebhookSecret("wh-1", "user-1");

            expect(result.webhookId).toBe("wh-1");
            expect(result.rawSecret).toMatch(/^[0-9a-f]{64}$/);
            expect(mockWebhookRepository.updateSecret).toHaveBeenCalledWith(
                "wh-1",
                result.rawSecret,
            );
        });

        it("should throw NotFoundException when webhook not found", async () => {
            mockWebhookRepository.findById.mockResolvedValue(null);

            await expect(service.rotateWebhookSecret("bad-id", "user-1")).rejects.toThrow(
                NotFoundException,
            );
        });

        it("should throw ForbiddenException for unauthorized user", async () => {
            mockWebhookRepository.findById.mockResolvedValue(mockWebhook);
            mockProjectRepository.findById.mockResolvedValue(mockProject);
            mockProjectRepository.findCollaboratorByUserAndProject.mockResolvedValue(null);

            await expect(service.rotateWebhookSecret("wh-1", "outsider")).rejects.toThrow(
                ForbiddenException,
            );
        });
    });

    // -----------------------------------------------------------------------
    // disableWebhook / enableWebhook
    // -----------------------------------------------------------------------

    describe("disableWebhook", () => {
        it("should set isActive to false for project owner", async () => {
            mockWebhookRepository.findById.mockResolvedValue(mockWebhook);
            mockProjectRepository.findById.mockResolvedValue(mockProject);
            mockWebhookRepository.update.mockResolvedValue({ ...mockWebhook, isActive: false });

            const result = await service.disableWebhook("wh-1", "user-1");

            expect(mockWebhookRepository.update).toHaveBeenCalledWith("wh-1", { isActive: false });
            expect(result?.isActive).toBe(false);
        });

        it("should throw NotFoundException when webhook not found", async () => {
            mockWebhookRepository.findById.mockResolvedValue(null);

            await expect(service.disableWebhook("bad-id", "user-1")).rejects.toThrow(
                NotFoundException,
            );
        });
    });

    // -----------------------------------------------------------------------
    // deleteWebhook
    // -----------------------------------------------------------------------

    describe("deleteWebhook", () => {
        it("should delete webhook for project owner", async () => {
            mockWebhookRepository.findById.mockResolvedValue(mockWebhook);
            mockProjectRepository.findById.mockResolvedValue(mockProject);
            mockWebhookRepository.delete.mockResolvedValue(undefined);

            await expect(service.deleteWebhook("wh-1", "user-1")).resolves.toBeUndefined();
            expect(mockWebhookRepository.delete).toHaveBeenCalledWith("wh-1");
        });

        it("should throw ForbiddenException for developer collaborator", async () => {
            mockWebhookRepository.findById.mockResolvedValue(mockWebhook);
            mockProjectRepository.findById.mockResolvedValue(mockProject);
            mockProjectRepository.findCollaboratorByUserAndProject.mockResolvedValue({
                role: "developer",
            });

            await expect(service.deleteWebhook("wh-1", "dev-user")).rejects.toThrow(
                ForbiddenException,
            );
        });
    });
});
