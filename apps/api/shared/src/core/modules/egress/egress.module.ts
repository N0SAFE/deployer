import { Global, Module } from "@nestjs/common";

import { EgressService } from "./egress.service";

/**
 * CORE: outbound requests to targets a user or operator chooses go through `EgressService`.
 *
 * @Global() like the other core reachability pieces: any module can inject it once this
 * module is imported anywhere in the app graph (`CoreReachabilityModule` imports it).
 */
@Global()
@Module({
	providers: [EgressService],
	exports: [EgressService],
})
export class CoreEgressModule {}
