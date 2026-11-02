import { Context } from "effect";

import type { GitService } from "@deployer/shared/core/modules/git/index";

/** Effect view of the git service: what the source providers ask of it. */
export type GitShape = Pick<GitService, "validateRepository">;

export class Git extends Context.Service<Git, GitShape>()("fleet/Git") {}
