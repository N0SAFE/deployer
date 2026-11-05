import { Context } from "effect";

import type { RuntimeConfigurationAccessorServiceShape as AccessorServiceShape } from "@deployer/shared/core/modules/configuration/services/runtime-configuration-accessor.service";

/** Effect view of the platform's effective-configuration reads. */
export type RuntimeConfigurationAccessorShape = Pick<
	AccessorServiceShape,
	"resolveStrict" | "projectConfigFromSettings" | "serviceConfigFromRecord"
>;

export class RuntimeConfigurationAccessor extends Context.Service<
	RuntimeConfigurationAccessor,
	RuntimeConfigurationAccessorShape
>()("project/RuntimeConfigurationAccessor") {}
