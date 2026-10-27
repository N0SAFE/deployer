import type { z } from "zod/v4";
import { userSchema } from "@deployer/contracts-entities";

/**
 * The User aggregate. Inferred from the contract's entity schema so the
 * transport and the domain cannot drift.
 */
export type User = z.output<typeof userSchema>;

/** What `create` accepts — picked from the entity, never re-declared. */
export type NewUser = Pick<User, "name" | "email"> & Partial<Pick<User, "image" | "role">>;

/** What `update` accepts; audit timestamps are intentionally absent. */
export type UserPatch = Partial<
  Pick<User, "name" | "email" | "emailVerified" | "role" | "banned">
>;

export type { Actor } from "@identity/core/utils/actor.utils";
