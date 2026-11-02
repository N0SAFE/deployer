import { Context } from "effect";

import type { PreviewCleanupPolicyService } from "@deployer/shared/core/modules/deployment/services/preview-cleanup-policy.service";
import type { PreviewNamingService } from "@deployer/shared/core/modules/deployment/services/preview-naming.service";

/** Effect view of preview naming: the name and URL a pull request's preview gets. */
export type PreviewNamingShape = Pick<PreviewNamingService, "buildPreviewName">;

export class PreviewNaming extends Context.Service<PreviewNaming, PreviewNamingShape>()("fleet/PreviewNaming") {}

/** Effect view of the preview cleanup policy: whether a pull request event retires its preview. */
export type PreviewCleanupPolicyShape = Pick<PreviewCleanupPolicyService, "shouldCleanup">;

export class PreviewCleanupPolicy extends Context.Service<PreviewCleanupPolicy, PreviewCleanupPolicyShape>()(
	"fleet/PreviewCleanupPolicy",
) {}
