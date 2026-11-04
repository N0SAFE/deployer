import { createGlobalModule } from "@deployer/nest-effect";

import { EgressService, makeEgressService } from "./egress.service";

/**
 * CORE: outbound requests to targets a user or operator chooses go through `EgressService`.
 *
 * @Global() like the other core reachability pieces: any module can inject it once this
 * module is imported anywhere in the app graph (`CoreReachabilityModule` imports it).
 */
export const CoreEgressModule = createGlobalModule({
	providers: [{ provide: EgressService, useFactory: () => makeEgressService({ env: process.env }) }],
	exports: [EgressService],
});
