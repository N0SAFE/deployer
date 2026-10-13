import { Global, Module } from "@nestjs/common";

import { ServiceClientsModule } from "./service-clients.module";
import { ServiceClientRegistry } from "./service-registry";

/**
 * Owns `ServiceClientRegistry` so any screen module can inject it.
 *
 * ── WHY THIS IS A MODULE AND NOT A PROVIDER ON `BffModule` ─────────────────
 * A NestJS module's providers are visible only to that module — declaring the
 * registry on `BffModule` made it resolvable by `BffModule`'s own consumers and
 * by nothing else. `PlatformConsoleModule` and `PlatformHealthModule` are imported
 * BY `BffModule`, which does not make the parent's providers visible to them: the
 * dependency goes the other way. Booting failed with
 * `Nest can't resolve dependencies of the PlatformManagedWebClientService (?)
 * … ServiceClientRegistry at index [0] is available in the PlatformConsoleModule`,
 * naming the consumer rather than the scoping mistake.
 *
 * `@Global()` because every screen that composes services needs it, and re-importing
 * it per screen would be a line that adds nothing. A global module still has to be
 * imported ONCE — `BffModule` does that.
 */
@Global()
@Module({
	// The registry (the transport) and the typed clients built on it are one unit:
	// a client cannot exist without the registry, so a consumer that imports this
	// module gets both and can inject whichever it needs.
	imports: [ServiceClientsModule],
	providers: [ServiceClientRegistry],
	exports: [ServiceClientRegistry, ServiceClientsModule],
})
export class ServiceClientModule {}
