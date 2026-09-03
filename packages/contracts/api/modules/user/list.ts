import { createFilterConfig, standard, type ComputeInputSchema, standardDomainErrorContracts } from "@repo/orpc-utils";
import { userSchema } from "@repo/contracts-entities";

// Create standard operations builder for users
const userOps = standard.zod(userSchema, "user");

// Build reusable list config with fluent API
const userListConfig = createFilterConfig(userOps)
    .withPagination({
        defaultLimit: 20,
        maxLimit: 100,
        includeOffset: true,
    } as const)
    .withSorting(["createdAt", "name", "email", "updatedAt"] as const, {
        defaultField: "createdAt",
        defaultDirection: "desc",
    })
    .withFiltering({
        id: userSchema.shape.id,
        email: {
            schema: userSchema.shape.email,
            operators: ["eq", "like", "ilike"] as const,
        },
        name: {
            schema: userSchema.shape.name,
            operators: ["eq", "like", "ilike"] as const,
        },
        emailVerified: userSchema.shape.emailVerified,
        createdAt: {
            schema: userSchema.shape.createdAt,
            operators: ["gt", "gte", "lt", "lte", "between"] as const,
        },
    })
    .buildConfig();

// Export reusable query configuration schemas
export const userListConfigSchemas = userListConfig;

// Build the list contract
export const userListContract = userOps.list(userListConfig).errors((e) => [...standardDomainErrorContracts(e)]).build();

// Export input type helper - computed from the config
export type UserListInput = ComputeInputSchema<typeof userListConfigSchemas>;
