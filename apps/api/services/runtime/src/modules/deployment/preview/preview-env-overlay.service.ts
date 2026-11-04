import { Context, Effect } from "effect";

import type { PreviewTemplateConfig } from "@deployer/contracts-entities";

/**
 * T033 — Preview environment overlays and secret scoping.
 *
 * Pure: it only combines two maps, so it needs no port and cannot fail.
 */
export type PreviewEnvOverlayServiceShape = {
    readonly applyOverlay: (
        baseEnv: Record<string, string>,
        overlayEnv: Record<string, string>,
        strategy: PreviewTemplateConfig["envOverlayStrategy"],
    ) => Effect.Effect<Record<string, string>>;
};

export class PreviewEnvOverlayService extends Context.Service<PreviewEnvOverlayService, PreviewEnvOverlayServiceShape>()(
    "runtime/PreviewEnvOverlayService",
) {
    static readonly live: PreviewEnvOverlayServiceShape = {
        applyOverlay: (baseEnv, overlayEnv, strategy) =>
            Effect.sync(() => {
                switch (strategy) {
                    case "inherit":
                        return { ...baseEnv };
                    case "merge":
                        return { ...baseEnv, ...overlayEnv };
                    case "replace":
                        return { ...overlayEnv };
                }
            }),
    };
}
