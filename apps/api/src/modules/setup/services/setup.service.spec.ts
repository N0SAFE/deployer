import { beforeEach, describe, expect, it, vi } from "vitest";
import { SetupService } from "./setup.service";

describe("SetupService", () => {
    let service: SetupService;

    const mockLimit = vi.fn();
    const mockFrom = vi.fn(() => ({ limit: mockLimit }));
    const mockSelect = vi.fn(() => ({ from: mockFrom }));

    const mockDatabaseService = {
        isConnected: true,
        db: {
            select: mockSelect,
        },
    };

    const mockAdminPlugin = {
        createUser: vi.fn(),
    };

    const mockOrganizationPlugin = {
        createOrganization: vi.fn(),
        addMember: vi.fn(),
    };

    const mockAuthService = {
        plugin: vi.fn((pluginName: string) => {
            if (pluginName === "admin") {
                return mockAdminPlugin;
            }

            if (pluginName === "organization") {
                return mockOrganizationPlugin;
            }

            throw new Error(`Unknown auth plugin: ${pluginName}`);
        }),
    };

    const mockNodeConfigRepository = {
        find: vi.fn(() => null),
        upsert: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        service = new SetupService(mockDatabaseService as never, mockAuthService as never, mockNodeConfigRepository as never);
    });

    it("returns awaiting_initial_admin state when no users and no organizations", async () => {
        mockLimit.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

        const state = await service.getSetupState();

        expect(state.state).toBe("awaiting_initial_admin");
        expect(state.needsSetup).toBe(true);
        expect(state.currentStep).toBe("create_initial_user");
    });

    it("returns completed state when users and organizations exist", async () => {
        mockLimit.mockResolvedValueOnce([{ id: "user-1" }]).mockResolvedValueOnce([{ id: "org-1" }]);

        const state = await service.getSetupState();

        expect(state.state).toBe("completed");
        expect(state.needsSetup).toBe(false);
        expect(state.progressPercent).toBe(100);
    });

    it("throws when initialize is called after setup completion", async () => {
        mockLimit.mockResolvedValueOnce([{ id: "user-1" }]).mockResolvedValueOnce([{ id: "org-1" }]);

        await expect(
            service.initialize({
                strategy: "local_instance",
                name: "Root",
                email: "root@example.com",
                password: "password123",
                organizationName: "Root Org",
            }),
        ).rejects.toThrow("Setup has already been completed");
    });

    it("initializes setup and returns completed setup snapshot", async () => {
        mockLimit
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ id: "user-1" }])
            .mockResolvedValueOnce([{ id: "org-1" }]);

        mockAdminPlugin.createUser.mockResolvedValue({
            user: {
                id: "user-1",
                name: "Root",
                email: "root@example.com",
            },
        });

        mockOrganizationPlugin.createOrganization.mockResolvedValue({
            id: "org-1",
            name: "Root Org",
            slug: "root-org",
        });

        const result = await service.initialize({
            strategy: "local_instance",
            name: "Root",
            email: "root@example.com",
            password: "password123",
            organizationName: "Root Org",
        });

        expect(mockAdminPlugin.createUser).toHaveBeenCalled();
        expect(mockOrganizationPlugin.createOrganization).toHaveBeenCalled();
        expect(mockOrganizationPlugin.addMember).toHaveBeenCalled();
        expect(result.user.email).toBe("root@example.com");
        expect(result.organization.slug).toBe("root-org");
        expect(result.state.state).toBe("completed");
    });

    it("reuses existing initial user when setup is already in initial_admin_created state", async () => {
        mockLimit
            .mockResolvedValueOnce([{ id: "user-1" }])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ id: "user-1", name: "Admin", email: "admin@admin.com" }])
            .mockResolvedValueOnce([{ id: "user-1" }])
            .mockResolvedValueOnce([{ id: "org-1" }]);

        mockOrganizationPlugin.createOrganization.mockResolvedValue({
            id: "org-1",
            name: "Root Org",
            slug: "root-org",
        });

        const result = await service.initialize({
            strategy: "local_instance",
            name: "Root",
            email: "admin@admin.com",
            password: "password123",
            organizationName: "Root Org",
        });

        expect(mockAdminPlugin.createUser).not.toHaveBeenCalled();
        expect(mockOrganizationPlugin.createOrganization).toHaveBeenCalledWith({
            name: "Root Org",
            slug: "root-org",
        });
        expect(result.user.email).toBe("admin@admin.com");
        expect(result.state.state).toBe("completed");
    });
});