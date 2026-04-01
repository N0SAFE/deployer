import { randomUUID } from "node:crypto";
import { BadRequestException, Injectable, InternalServerErrorException } from "@nestjs/common";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { Roles } from "@repo/auth/permissions";
import type {
    NodeConfigStatus,
    SetupBootstrapStrategy,
    SetupConfigureDatabaseInput,
    SetupConfigureDatabaseResult,
    SetupInitializeInput,
    SetupInitializeResult,
    SetupStateMachine,
    SetupStateSnapshot,
    SetupStep,
} from "@repo/contracts-entities";
import { GlobalDatabaseService } from "@/core/modules/database/services/global-database.service";
import { AuthCoreService } from "@/core/modules/auth/services/auth-core.service";
import * as schema from "@/config/drizzle/global/schema";
import { organization, user } from "@/config/drizzle/global/schema/auth";
import { NodeConfigRepository } from "../repositories/node-config.repository";
import { slugify } from "@/core/utils/slug.utils";

@Injectable()
export class SetupService {
    constructor(
        private readonly databaseService: GlobalDatabaseService,
        private readonly authCoreService: AuthCoreService,
        private readonly nodeConfigRepository: NodeConfigRepository,
    ) {}

    async getSetupState(): Promise<SetupStateSnapshot> {
        if (!this.databaseService.isConnected) {
            return this.buildSetupSnapshot({ hasUsers: false, hasOrganizations: false, isDatabaseConfigured: false });
        }

        const db = this.databaseService.db;
        try {
            const [existingUsers, existingOrganizations] = await Promise.all([
                db.select({ id: user.id }).from(user).limit(1),
                db.select({ id: organization.id }).from(organization).limit(1),
            ]);

            return this.buildSetupSnapshot({
                hasUsers: existingUsers.length > 0,
                hasOrganizations: existingOrganizations.length > 0,
            });
        } catch {
            // Freshly provisioned databases may not have auth tables yet.
            return this.buildSetupSnapshot({ hasUsers: false, hasOrganizations: false });
        }
    }

    async configureDatabaseUrl(input: SetupConfigureDatabaseInput): Promise<SetupConfigureDatabaseResult> {
        // Use a small pool for probing; for the permanent connection we'll use default sizing
        const pool = new Pool({ connectionString: input.databaseUrl, max: input.testOnly ? 1 : undefined });

        try {
            await pool.query("SELECT 1");
        } catch (error: unknown) {
            await pool.end().catch(() => undefined);
            const message = error instanceof Error ? error.message : String(error);
            throw new BadRequestException(`Cannot connect to the provided database URL: ${message}`);
        }

        let hasUsers = false;
        let hasOrganizations = false;
        try {
            const probeDb = drizzle(pool, { schema });
            const [userRows, orgRows] = await Promise.all([
                probeDb.select({ id: user.id }).from(user).limit(1),
                probeDb.select({ id: organization.id }).from(organization).limit(1),
            ]);
            hasUsers = userRows.length > 0;
            hasOrganizations = orgRows.length > 0;
        } catch {
            // Tables do not exist yet on a fresh database — treated as new
        }

        const existingConfig = this.nodeConfigRepository.find();
        const nodeId = input.nodeId ?? existingConfig?.nodeId ?? randomUUID();
        const isNewDatabase = !hasUsers && !hasOrganizations;

        if (input.testOnly) {
            await pool.end();
            const state = this.buildSetupSnapshot({ hasUsers, hasOrganizations, isDatabaseConfigured: true });
            return { state, connected: true, isNewDatabase, nodeId };
        }

        // Persist the URL to local SQLite so subsequent boots auto-connect
        const now = new Date().toISOString();
        this.nodeConfigRepository.upsert({
            databaseUrl: input.databaseUrl,
            nodeId,
            configuredAt: existingConfig?.configuredAt ?? now,
            updatedAt: now,
        });

        // Hot-swap the live Postgres connection — no restart required
        const liveDb = drizzle(pool, { schema });
        this.databaseService.setConnection(liveDb);

        const state = this.buildSetupSnapshot({ hasUsers, hasOrganizations, isDatabaseConfigured: true });
        return { state, connected: true, isNewDatabase, nodeId };
    }

    getNodeStatus(): NodeConfigStatus {
        const config = this.nodeConfigRepository.find();
        return {
            isConfigured: !!config?.databaseUrl,
            nodeId: config?.nodeId ?? null,
            configuredAt: config?.configuredAt ?? null,
        };
    }

    getStateMachine(): SetupStateMachine {
        return {
            initialState: "not_started",
            terminalStates: ["completed"],
            states: ["not_started", "awaiting_initial_admin", "initial_admin_created", "completed"],
            transitions: [
                {
                    from: "not_started",
                    to: "awaiting_initial_admin",
                    event: "setup_detected",
                    guard: "no_users && no_organizations",
                },
                {
                    from: "awaiting_initial_admin",
                    to: "awaiting_initial_admin",
                    event: "select_local_instance",
                },
                {
                    from: "awaiting_initial_admin",
                    to: "awaiting_initial_admin",
                    event: "select_remote_instance",
                    guard: "remote_connect_flow_completed",
                },
                {
                    from: "awaiting_initial_admin",
                    to: "initial_admin_created",
                    event: "initial_user_created",
                },
                {
                    from: "initial_admin_created",
                    to: "completed",
                    event: "initial_organization_created",
                },
            ],
        };
    }

    async initialize(input: SetupInitializeInput): Promise<SetupInitializeResult> {
        if (input.strategy === "remote_instance") {
            throw new BadRequestException(
                "Remote-instance strategy is handled by setup remote-connect flow; local initialize is not required.",
            );
        }

        const current = await this.getSetupState();
        if (!current.needsSetup) {
            throw new BadRequestException("Setup has already been completed.");
        }

        const createdUser = current.state === "initial_admin_created"
            ? await this.resolveExistingInitialUser(input.email)
            : await this.createInitialUser(input);

        const organizationPlugin = this.authCoreService.plugin("organization", new Headers());

        const organizationName = input.organizationName ?? `${input.name}'s Organization`;
        const slug = slugify(organizationName, { maxLength: 60, fallback: "organization" });
        const createdOrganization = await organizationPlugin.createOrganization({
            name: organizationName,
            slug,
        });

        if (!createdOrganization) {
            throw new InternalServerErrorException("Failed to create initial organization during setup.");
        }

        try {
            await organizationPlugin.addMember(createdOrganization.id, createdUser.id, "owner");
        } catch (error: unknown) {
            if (!this.isAlreadyMemberError(error)) {
                throw error;
            }
        }

        const state = await this.getSetupState();

        return {
            state,
            user: {
                id: createdUser.id,
                name: createdUser.name,
                email: createdUser.email,
                role: Roles.superAdmin,
            },
            organization: {
                id: createdOrganization.id,
                name: createdOrganization.name,
                slug: createdOrganization.slug,
            },
        };
    }

    private buildSetupSnapshot(input: {
        hasUsers: boolean;
        hasOrganizations: boolean;
        bootstrapStrategy?: SetupBootstrapStrategy | null;
        isDatabaseConfigured?: boolean;
    }): SetupStateSnapshot {
        const { hasUsers, hasOrganizations, bootstrapStrategy = null, isDatabaseConfigured = true } = input;

        if (!isDatabaseConfigured) {
            return {
                state: "awaiting_db_config",
                needsSetup: true,
                hasUsers: false,
                hasOrganizations: false,
                bootstrapStrategy: null,
                availableStrategies: ["local_instance", "remote_instance"],
                currentStep: "configure_database",
                progressPercent: 5,
                steps: [
                    {
                        id: "configure_database",
                        title: "Configure database connection",
                        status: "in_progress",
                        description: "Connect this node to the global Postgres database",
                    },
                    {
                        id: "create_initial_user",
                        title: "Create initial admin user",
                        status: "pending",
                    },
                    {
                        id: "create_initial_organization",
                        title: "Create initial organization",
                        status: "pending",
                    },
                    {
                        id: "finalize",
                        title: "Finalize setup",
                        status: "pending",
                    },
                ],
                completedAt: null,
            };
        }

        if (!hasUsers && !hasOrganizations) {
            const steps: SetupStep[] = [
                {
                    id: "check_prerequisites",
                    title: "Check prerequisites",
                    status: "completed",
                },
                {
                    id: "choose_bootstrap_strategy",
                    title: "Choose bootstrap strategy",
                    status: "in_progress",
                    description: "Create a local instance or connect to an existing remote instance",
                },
                {
                    id: "connect_remote_instance",
                    title: "Connect remote instance",
                    status: "pending",
                    description: "Optional branch: link to an existing remote node directly",
                },
                {
                    id: "create_initial_user",
                    title: "Create initial admin user",
                    status: "pending",
                },
                {
                    id: "create_initial_organization",
                    title: "Create initial organization",
                    status: "pending",
                },
                {
                    id: "assign_owner_membership",
                    title: "Assign organization owner",
                    status: "pending",
                },
                {
                    id: "finalize",
                    title: "Finalize setup",
                    status: "pending",
                },
            ];

            return {
                state: "awaiting_initial_admin",
                needsSetup: true,
                hasUsers,
                hasOrganizations,
                bootstrapStrategy,
                availableStrategies: ["local_instance", "remote_instance"],
                currentStep: "create_initial_user",
                progressPercent: 20,
                steps,
                completedAt: null,
            };
        }

        if (hasUsers && !hasOrganizations) {
            const steps: SetupStep[] = [
                {
                    id: "check_prerequisites",
                    title: "Check prerequisites",
                    status: "completed",
                },
                {
                    id: "choose_bootstrap_strategy",
                    title: "Choose bootstrap strategy",
                    status: "completed",
                    description: "Local bootstrap path selected",
                },
                {
                    id: "connect_remote_instance",
                    title: "Connect remote instance",
                    status: "skipped",
                    description: "Skipped while completing local bootstrap",
                },
                {
                    id: "create_initial_user",
                    title: "Create initial admin user",
                    status: "completed",
                },
                {
                    id: "create_initial_organization",
                    title: "Create initial organization",
                    status: "in_progress",
                },
                {
                    id: "assign_owner_membership",
                    title: "Assign organization owner",
                    status: "pending",
                },
                {
                    id: "finalize",
                    title: "Finalize setup",
                    status: "pending",
                },
            ];

            return {
                state: "initial_admin_created",
                needsSetup: true,
                hasUsers,
                hasOrganizations,
                bootstrapStrategy: "local_instance",
                availableStrategies: ["local_instance", "remote_instance"],
                currentStep: "create_initial_organization",
                progressPercent: 60,
                steps,
                completedAt: null,
            };
        }

        const steps: SetupStep[] = [
            {
                id: "check_prerequisites",
                title: "Check prerequisites",
                status: "completed",
            },
            {
                id: "choose_bootstrap_strategy",
                title: "Choose bootstrap strategy",
                status: "completed",
            },
            {
                id: "connect_remote_instance",
                title: "Connect remote instance",
                status: "skipped",
            },
            {
                id: "create_initial_user",
                title: "Create initial admin user",
                status: "completed",
            },
            {
                id: "create_initial_organization",
                title: "Create initial organization",
                status: "completed",
            },
            {
                id: "assign_owner_membership",
                title: "Assign organization owner",
                status: "completed",
            },
            {
                id: "finalize",
                title: "Finalize setup",
                status: "completed",
            },
        ];

        return {
            state: "completed",
            needsSetup: false,
            hasUsers,
            hasOrganizations,
            bootstrapStrategy: "local_instance",
            availableStrategies: ["local_instance", "remote_instance"],
            currentStep: null,
            progressPercent: 100,
            steps,
            completedAt: new Date().toISOString(),
        };
    }

    private async createInitialUser(input: SetupInitializeInput): Promise<{
        id: string;
        name: string;
        email: string;
    }> {
        try {
            const adminPlugin = this.authCoreService.plugin("admin", new Headers());
            const createdUserResult = await adminPlugin.createUser({
                name: input.name,
                email: input.email,
                password: input.password,
                data: {
                    role: Roles.superAdmin,
                    emailVerified: true,
                },
            });

            return createdUserResult.user;
        } catch (error: unknown) {
            if (!this.isUserAlreadyExistsError(error)) {
                throw error;
            }

            return this.resolveExistingInitialUser(input.email);
        }
    }

    private async resolveExistingInitialUser(email: string): Promise<{
        id: string;
        name: string;
        email: string;
    }> {
        const db = this.databaseService.db;
        const existingUsers = await db
            .select({ id: user.id, name: user.name, email: user.email })
            .from(user)
            .limit(10);

        const matchedByEmail = existingUsers.find((existingUser) => existingUser.email === email);
        if (matchedByEmail) {
            return matchedByEmail;
        }

        const firstUser = existingUsers[0];
        if (firstUser) {
            return firstUser;
        }

        throw new BadRequestException("Setup expected an existing user, but none could be resolved.");
    }

    private isAlreadyMemberError(error: unknown): boolean {
        if (!error || typeof error !== "object") {
            return false;
        }

        const message = "message" in error && typeof error.message === "string" ? error.message : "";
        return /already.+member/i.test(message);
    }

    private isUserAlreadyExistsError(error: unknown): boolean {
        if (!error || typeof error !== "object") {
            return false;
        }

        const message = "message" in error && typeof error.message === "string" ? error.message : "";

        const body = "body" in error && typeof error.body === "object" && error.body
            ? error.body as { code?: unknown; message?: unknown }
            : undefined;

        const bodyCode = typeof body?.code === "string" ? body.code : "";
        const bodyMessage = typeof body?.message === "string" ? body.message : "";

        return (
            /already.+exists/i.test(message)
            || /USER_ALREADY_EXISTS/i.test(bodyCode)
            || /already.+exists/i.test(bodyMessage)
        );
    }
}