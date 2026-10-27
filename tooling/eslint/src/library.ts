import { defineConfig } from "eslint/config";
import coreConfig, { type BaseConfigOptions } from "./base";

const coreBaseFactory = coreConfig.configs.base;
const coreTestFactory = coreConfig.configs.test;

const base = (options: BaseConfigOptions = {}) => defineConfig([
    coreBaseFactory(options),
    {
        rules: {
            "no-unused-vars": "off",
            "@typescript-eslint/no-unused-vars": ["error"],
            "typescript-eslint/no-namespace": "off",
            // OFF, not "type": its autofix rewrites an `interface` into a `type` alias, and an
            // interface that merges with a class (the BFF service clients) stops merging, which
            // surfaces as `Duplicate identifier` and silently drops the class's typed members.
            "@typescript-eslint/consistent-type-definitions": "off",
        },
    },
]);

const test = (options: BaseConfigOptions = {}) => defineConfig([
    coreTestFactory(options),
    {
        rules: {
            "no-unused-vars": "off",
            "@typescript-eslint/no-unused-vars": ["error"],
            "typescript-eslint/no-namespace": "off",
        },
    },
]);

const all = (options: BaseConfigOptions = {}) => defineConfig([
    base(options),
    test(options),
]);

export default {
    meta: {
        name: "@deployer/config-eslint/library",
        version: "0.0.0",
    },
    configs: {
        base,
        test,
        all,
    },
} as const;
