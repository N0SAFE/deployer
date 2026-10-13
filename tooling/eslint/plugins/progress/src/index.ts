import type { Linter } from 'eslint';

import progressRule from './rules/progress';

/**
 * The `file-progress` plugin, typed.
 *
 * ── WHY THE PLUGIN OBJECT IS BUILT HERE AND NOT IMPORTED ────────────────────
 * `eslint-plugin-file-progress` is not published in a shape this repo can
 * consume as a flat-config plugin, so the rule is taken from a dependency and
 * wrapped with the plugin metadata and config presets ESLint needs. Keeping that
 * wrapper in TypeScript means the preset names below are checked against the
 * `configs` type rather than being strings a consumer can mistype.
 */
export interface ProgressPlugin {
  meta: { name: string; version: string };
  configs: Record<'recommended' | 'recommended-ci', Linter.Config>;
  rules: Record<'activate', typeof progressRule>;
}

const plugin: ProgressPlugin = {
  meta: {
    name: 'eslint-plugin-file-progress',
    version: '3.0.0',
  },
  configs: {} as ProgressPlugin['configs'],
  rules: {
    activate: progressRule,
  },
};

/**
 * Both presets enable the same rule; the split exists because a consumer chooses
 * how much terminal output it wants, not because the rules differ. `recommended`
 * is the interactive default, `recommended-ci` the one the shared base config
 * uses so CI logs stay greppable.
 */
const configs: ProgressPlugin['configs'] = {
  recommended: {
    name: 'progress/recommended',
    plugins: {
      progress: plugin,
    },
    rules: {
      'progress/activate': 'error',
    },
  },
  'recommended-ci': {
    name: 'progress/recommended-ci',
    plugins: {
      progress: plugin,
    },
    rules: {
      'progress/activate': 'error',
    },
  },
};

plugin.configs = configs;

export default plugin;
