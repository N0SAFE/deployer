import { Context } from "effect";

import type { GitServiceShape } from "@deployer/shared/core/modules/git/git/services/git.service";

/** Effect view of the git service: what the source providers ask of it. */
export type GitShape = Pick<GitServiceShape, "validateRepository">;

export class Git extends Context.Service<Git, GitShape>()("fleet/Git") {}
