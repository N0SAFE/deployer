import type { Linter } from "eslint";

interface ProgressPlugin {
    meta: { name: string; version: string };
    configs: {
        recommended: Linter.Config;
        "recommended-ci": Linter.Config;
    };
    rules: Record<string, unknown>;
}

declare const plugin: ProgressPlugin;
export default plugin;