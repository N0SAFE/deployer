import { Context } from "effect";

import type { RuntimeConfigurationAccessorService } from "@deployer/shared/core/modules/configuration/services/runtime-configuration-accessor.service";

/** Effect view of the platform's effective-configuration reads. */
export type RuntimeConfigurationAccessorShape = Pick<
	RuntimeConfigurationAccessorService,
	"resolveStrict" | "projectConfigFromSettings" | "serviceConfigFromRecord"
>;

export class RuntimeConfigurationAccessor extends Context.Service<
	RuntimeConfigurationAccessor,
	RuntimeConfigurationAccessorShape
>()("project/RuntimeConfigurationAccessor") {}
