import pc from 'picocolors';
import type { Rule } from 'eslint';

/**
 * `file-progress` as a typed ESLint rule.
 *
 * Renders ONE line, in the same shape `bun check` uses:
 *
 *   ⠸ Linting ━━━━━━━━━━━━────────── 1,374 / 3,000 files
 *
 * A file counter plus a bar says how far a run is and how long it has left; the
 * per-file `Processing: <file>` spinner it replaced said neither.
 *
 * ── WHY THE COUNTER IS DRIVEN BY `create()` ─────────────────────────────────
 * ESLint calls a rule's `create()` once per file and gives it no "file finished"
 * hook, so the honest signal is the start of the next file. The counter
 * therefore reads "files started" — which is what `bun check` counts too.
 *
 * ── WHY THE DENOMINATOR IS ESTIMATED FROM DISK ──────────────────────────────
 * ESLint does not publish its file list to plugins, and asking the runner
 * (`bun lint --list-files`) costs a second config load: measured 2s on a small
 * workspace and 8.6s on `apps/web`, against a 5.4s lint. A `Bun.Glob` scan of
 * the workspace costs ~8ms for 850 files and lands within a few percent of the
 * real list — and `done` widens it if the run overshoots, so a bad estimate
 * cannot pin the bar at 100%.
 *
 * ── WHY THERE IS NO WORKER/PROCESS COORDINATION ANY MORE ────────────────────
 * This rule used to keep a registry in `os.tmpdir()`, elect a renderer among
 * worker threads, and print plain lines when several processes ran at once.
 * Measured on this repo, `bun lint` runs plugin rules in the main thread only
 * (1,500 files, one pid/threadId — the native rules are what parallelize), and
 * when several lint processes run in parallel (turbo) each one already owns its
 * own stderr. Both hazards were unobservable, so the machinery is gone.
 */

/** Bar cells. Matches `bun check`, which does not widen with the terminal. */
const BAR_WIDTH = 24;

/** `bun check`'s spinner. */
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const SOURCE_EXTENSIONS = '{ts,tsx,js,jsx,mjs,cjs,mts,cts}';

/** Directories no workspace lints. Mirrors `bunfig.toml`'s `ignorePatterns`. */
const IGNORED_DIRS = /(^|\/)(node_modules|dist|\.next|\.source|coverage|build)\//;

/**
 * Auto-disable when eslint runs with `--debug`: debug output and a repainting
 * line cannot share a terminal.
 *
 * ESLint's `--debug` does not set `process.env.DEBUG` and worker threads do not
 * inherit CLI flags, so the flag is detected here and exported for anything that
 * reloads this module.
 */
if (process.argv.includes('--debug')) {
  process.env.ESLINT_FILE_PROGRESS_DEBUG = '1';
}

const isDebugEnabled = (): boolean =>
  process.env.ESLINT_FILE_PROGRESS_DEBUG === '1' ||
  process.argv.includes('--debug') ||
  Boolean(process.env.DEBUG);

/**
 * A repainting line needs a terminal of its own. Turbo's task renderer prefixes
 * every frame (`a:lint: ⠋ …`) and turns each `\r` into a new line, so the bar
 * arrives as a wall of text; there, and in any piped run, print nothing and let
 * the runner's own summary carry the result.
 */
const isInteractive = (): boolean =>
  Boolean(process.stderr.isTTY) && !process.env.TURBO_HASH && !isDebugEnabled();

interface ProgressSettings {
  hide: boolean;
}

const defaultSettings: ProgressSettings = {
  hide: false,
};

let done = 0;
let total = 0;
let spinIndex = 0;
let drew = false;
let bindExit = false;
let totalScanned = false;

/**
 * Count the files this workspace will lint, once per process.
 *
 * `src/**` plus root-level sources is the layout every workspace here follows.
 * A workspace that lints more (or less) gets an estimate a few percent off,
 * which is inaudible on a bar.
 */
const estimateTotal = (cwd: string): void => {
  if (totalScanned) return;
  totalScanned = true;

  // The glob comes from Bun's runtime, which is not a compile-time dependency here: the plugin is built with plain
  // `tsc` and also runs in editors that have no `Bun` global. Reading it off `globalThis` keeps the runtime guard the
  // `typeof Bun === 'undefined'` check used to provide — and keeps `@types/bun` out of the build.
  const bun = (globalThis as { Bun?: BunGlobHost }).Bun;
  if (bun === undefined) return;

  const seen = new Set<string>();
  for (const pattern of [
    `src/**/*.${SOURCE_EXTENSIONS}`,
    `*.${SOURCE_EXTENSIONS}`,
  ]) {
    try {
      for (const file of new bun.Glob(pattern).scanSync({
        cwd,
        dot: false,
        onlyFiles: true,
      })) {
        if (!IGNORED_DIRS.test(`${file}/`)) seen.add(file);
      }
    } catch {
      // Unreadable cwd: fall back to showing only the completed count.
    }
  }
  total = seen.size;
};

/** The sliver of Bun's glob API this rule uses, so the build needs no `@types/bun`. */
type BunGlobHost = {
  readonly Glob: new (
    pattern: string,
  ) => {
    scanSync(options: {
      cwd: string;
      dot: boolean;
      onlyFiles: boolean;
    }): Iterable<string>;
  };
};

/** Repaint the line in place. */
const render = (): void => {
  const shownTotal = Math.max(total, done);
  const filled =
    shownTotal > 0 ? Math.round((done / shownTotal) * BAR_WIDTH) : 0;
  const frame = SPINNER[spinIndex % SPINNER.length];
  spinIndex += 1;

  const bar =
    (filled > 0 ? pc.cyan('━'.repeat(filled)) : '') +
    (filled < BAR_WIDTH ? pc.dim('━'.repeat(BAR_WIDTH - filled)) : '');
  const counts =
    shownTotal > 0
      ? `${done.toLocaleString('en-US')}${pc.dim(` / ${shownTotal.toLocaleString('en-US')} files`)}`
      : `${done.toLocaleString('en-US')} files`;

  process.stderr.write(`\r\x1b[2K${pc.cyan(frame)} Linting ${bar} ${counts}`);
  drew = true;
};

/** Erase the line so the runner's summary starts clean. */
const clearLine = (): void => {
  if (!drew) return;
  process.stderr.write('\x1b[2K\r');
  drew = false;
};

const onExit = (): void => {
  clearLine();
};

const create: Rule.RuleModule['create'] = (context) => {
  const settings: ProgressSettings = {
    ...defaultSettings,
    ...(context.settings.progress as Partial<ProgressSettings> | undefined),
  };

  if (settings.hide || !isInteractive()) return {};

  if (!bindExit) {
    process.on('exit', onExit);
    bindExit = true;
  }

  estimateTotal(context.cwd);

  done += 1;
  // The scan is an estimate; let an overshoot widen the denominator instead of
  // pinning the bar at 100% while files keep arriving.
  if (done > total) total = done;

  render();
  return {};
};

/** The rule itself, in the shape ESLint expects. */
export const progressRule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    messages: {},
    schema: [],
  },
  create,
};

export default progressRule;
