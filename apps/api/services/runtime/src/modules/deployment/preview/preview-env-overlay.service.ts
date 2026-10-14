import { Injectable } from "@nestjs/common";
import type { PreviewTemplateConfig } from "@repo/contracts-entities";

/**
 * T033 — Preview environment overlays and secret scoping.
 */
@Injectable()
export class PreviewEnvOverlayService {
    applyOverlay(
        baseEnv: Record<string, string>,
        overlayEnv: Record<string, string>,
        strategy: PreviewTemplateConfig["envOverlayStrategy"],
    ): Record<string, string> {
        switch (strategy) {
            case "inherit":
                return { ...baseEnv };
            case "merge":
                return { ...baseEnv, ...overlayEnv };
            case "replace":
                return { ...overlayEnv };
        }
    }
}