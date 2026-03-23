import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ForbiddenException, NotFoundException, ConflictException } from "@nestjs/common";
import { ApiKeyService } from "./api-key.service";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockProject = { id: "proj-1", ownerId: "user-1", name: "Test" };
const mockKeyRecord = {
    id: "key-1",
    userId: "user-1",
    name: "My Key",
    keyHash: "abc123",
    keyPreview: "dk_deadbeef",
    projectId: null,
    scopes: ["deploy", "read"],
    lastUsed: null,
    expiresAt: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
};

describe("ApiKeyService", () => {
    let service: ApiKeyService;
    let mockApiKeyRepository: {
        findById: ReturnType<typeof vi.fn>;
        findByHash: ReturnType<typeof vi.fn>;
        findByUser: ReturnType<typeof vi.fn>;
        findByProject: ReturnType<typeof vi.fn>;
        create: ReturnType<typeof vi.fn>;
        setActive: ReturnType<typeof vi.fn>;
        touchLastUsed: ReturnType<typeof vi.fn>;
        delete: ReturnType<typeof vi.fn>;
    };
    let mockProjectRepository: {
        findById: ReturnType<typeof vi.fn>;
        findCollaboratorByUserAndProject: ReturnType<typeof vi.fn>;
    };

    beforeEach(async () => {
        mockApiKeyRepository = {
            findById: vi.fn(),
            findByHash: vi.fn(),
            findByUser: vi.fn(),
            findByProject: vi.fn(),
            create: vi.fn(),
            setActive: vi.fn(),
            touchLastUsed: vi.fn(),
            delete: vi.fn(),
        };

        mockProjectRepository = {
            findById: vi.fn(),
            findCollaboratorByUserAndProject: vi.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                {
                    provide: ApiKeyService,
                    useFactory: () =>
                        new ApiKeyService(
                            mockApiKeyRepository as never,
                            mockProjectRepository as never,
                        ),
                },
            ],
        }).compile();

        service = module.get<ApiKeyService>(ApiKeyService);
        vi.clearAllMocks();
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });

    // -----------------------------------------------------------------------
    // createApiKey
    // -----------------------------------------------------------------------

    describe("createApiKey", () => {
        it("should create a key and return rawKey once for the owning user", async () => {
            mockApiKeyRepository.findByHash.mockResolvedValue(null);
            mockApiKeyRepository.create.mockResolvedValue(mockKeyRecord);

            const result = await service.createApiKey({ userId: "user-1", name: "My Key" });

            expect(result.rawKey).toMatch(/^dk_[0-9a-f]{64}$/);
            expect(result.keyPreview).toBe(mockKeyRecord.keyPreview);
            expect(mockApiKeyRepository.create).toHaveBeenCalledOnce();
            const createArg = mockApiKeyRepository.create.mock.calls[0]?.[0];
            // Raw key must NOT be stored plain
            expect(createArg?.keyHash).not.toBe(result.rawKey);
            expect(createArg?.keyHash).toHaveLength(64); // SHA-256 hex
        });

        it("should validate project access when projectId is given", async () => {
            mockProjectRepository.findById.mockResolvedValue(mockProject);
            mockApiKeyRepository.findByHash.mockResolvedValue(null);
            mockApiKeyRepository.create.mockResolvedValue({
                ...mockKeyRecord,
                projectId: "proj-1",
            });

            const result = await service.createApiKey({
                userId: "user-1",
                name: "Project Key",
                projectId: "proj-1",
            });

            expect(result.rawKey).toBeDefined();
            expect(mockProjectRepository.findById).toHaveBeenCalledWith("proj-1");
        });

        it("should throw ForbiddenException if non-admin requests project key", async () => {
            mockProjectRepository.findById.mockResolvedValue(mockProject);
            mockProjectRepository.findCollaboratorByUserAndProject.mockResolvedValue({
                role: "developer",
            });

            await expect(
                service.createApiKey({
                    userId: "dev-user",
                    name: "Key",
                    projectId: "proj-1",
                }),
            ).rejects.toThrow(ForbiddenException);
        });

        it("should throw ConflictException on key hash collision", async () => {
            mockApiKeyRepository.findByHash.mockResolvedValue(mockKeyRecord); // hash already exists

            await expect(service.createApiKey({ userId: "user-1", name: "Key" })).rejects.toThrow(
                ConflictException,
            );
        });
    });

    // -----------------------------------------------------------------------
    // revokeApiKey
    // -----------------------------------------------------------------------

    describe("revokeApiKey", () => {
        it("should revoke own key", async () => {
            mockApiKeyRepository.findById.mockResolvedValue(mockKeyRecord);
            mockApiKeyRepository.setActive.mockResolvedValue({ ...mockKeyRecord, isActive: false });

            await service.revokeApiKey("key-1", "user-1");

            expect(mockApiKeyRepository.setActive).toHaveBeenCalledWith("key-1", false);
        });

        it("should throw NotFoundException for unknown key", async () => {
            mockApiKeyRepository.findById.mockResolvedValue(null);

            await expect(service.revokeApiKey("bad-id", "user-1")).rejects.toThrow(
                NotFoundException,
            );
        });

        it("should throw ForbiddenException when another user owns the key and no project", async () => {
            mockApiKeyRepository.findById.mockResolvedValue({
                ...mockKeyRecord,
                userId: "other-user",
                projectId: null,
            });

            await expect(service.revokeApiKey("key-1", "user-1")).rejects.toThrow(
                ForbiddenException,
            );
        });

        it("should allow project admin to revoke a project-scoped key", async () => {
            mockApiKeyRepository.findById.mockResolvedValue({
                ...mockKeyRecord,
                userId: "other-user",
                projectId: "proj-1",
            });
            mockProjectRepository.findById.mockResolvedValue(mockProject);
            // user-1 is project owner, which also grants admin
            mockApiKeyRepository.setActive.mockResolvedValue({ ...mockKeyRecord, isActive: false });

            await service.revokeApiKey("key-1", "user-1");

            expect(mockApiKeyRepository.setActive).toHaveBeenCalledWith("key-1", false);
        });
    });

    // -----------------------------------------------------------------------
    // rotateApiKey
    // -----------------------------------------------------------------------

    describe("rotateApiKey", () => {
        it("should revoke old key and issue a new one", async () => {
            mockApiKeyRepository.findById.mockResolvedValue(mockKeyRecord);
            mockApiKeyRepository.setActive.mockResolvedValue({ ...mockKeyRecord, isActive: false });
            mockApiKeyRepository.findByHash.mockResolvedValue(null);
            mockApiKeyRepository.create.mockResolvedValue({
                ...mockKeyRecord,
                id: "key-2",
                keyHash: "newHash",
            });

            const result = await service.rotateApiKey("key-1", "user-1");

            expect(result.revokedKeyId).toBe("key-1");
            expect(result.newKey.rawKey).toMatch(/^dk_[0-9a-f]{64}$/);
            expect(mockApiKeyRepository.setActive).toHaveBeenCalledWith("key-1", false);
            expect(mockApiKeyRepository.create).toHaveBeenCalledOnce();
        });

        it("should throw NotFoundException when key not found", async () => {
            mockApiKeyRepository.findById.mockResolvedValue(null);

            await expect(service.rotateApiKey("bad-id", "user-1")).rejects.toThrow(
                NotFoundException,
            );
        });

        it("should throw ForbiddenException for unauthorized rotate", async () => {
            mockApiKeyRepository.findById.mockResolvedValue({
                ...mockKeyRecord,
                userId: "other-user",
                projectId: null,
            });

            await expect(service.rotateApiKey("key-1", "user-1")).rejects.toThrow(
                ForbiddenException,
            );
        });
    });
});
