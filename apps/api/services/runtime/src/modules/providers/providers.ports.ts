import { Context } from "effect";

import type { GitService } from "@deployer/shared/core/modules/git/index";

/**
 * What the source providers need and have no Effect version of yet: the shared git service, Promise-based.
 * The module binds this tag with `useExisting`, so a provider asks for the port without importing Nest.
 */
export class SourceGitPort extends Context.Service<SourceGitPort, GitService>()("runtime/SourceGitPort") {}
