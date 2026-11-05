import { Context } from "effect";

import type { GitServiceShape } from "@deployer/shared/core/modules/git/git/services/git.service";

/**
 * What the source providers need and have no Effect version of yet: the shared git service.
 * The module binds this tag with `useExisting`, so a provider asks for the port without importing Nest.
 */
export class SourceGitPort extends Context.Service<SourceGitPort, GitServiceShape>()("runtime/SourceGitPort") {}
