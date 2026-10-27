import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";
import { userSchema } from "@deployer/contracts-entities";

// Create standard operations builder for users
const userOps = standard.zod(userSchema, "user");

// Create update contract using builder
// Omit both image and id, make remaining fields optional, then add required id back
// `entitySchema` is the raw Zod schema, so `omit` takes a shape object
// (`{ key: true }`), not an array of names.
export const userUpdateContract = userOps
    .update()
    .input((b) => b.entitySchema.omit({ image: true, id: true }).partial().extend({ id: userSchema.shape.id }))
    .errors((e) => [
        // 404 for unknown user id.
        ...standardDomainErrorContracts(e),
    ])
    .build();
