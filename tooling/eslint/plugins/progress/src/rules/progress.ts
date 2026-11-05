import type { Rule } from 'eslint';
import pc from 'picocolors';

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
 * ESLint does not publish its file list to plugins — probed: no Bun global or
 * argv entry carries it — and asking the runner (`bun lint --list-files`) costs a
 * second config load, measured 2.6–4.9s, more than the whole lint of a small
 * workspace. A `Bun.Glob` scan costs 1–20ms instead, and lands within 3% on 66
 * of this repo's 67 workspaces. The exception is `apps/doc`, which narrows its
 * lint with `files: ["src/**"]` — a glob cannot see that, so the estimate there
 * is a ceiling that the run never reaches. Accepted: a bar that finishes at 17%
 * on one workspace beats the alternatives, which are a 2.6–4.9s second config
 * load (`--list-files`, measured) or a cache that a truncated run can poison
 * with a count it never actually linted.
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
 * Files `bun lint` never reports as linted: it drops configs and setups from its
 * own file list. Measured across the repo: excluding these took the estimate
 * from a mean 1.28x of the real count to a mean 1.03x.
 */
const NOT_LINTED = /(^|\/)(eslint\.config|[^/]*\.config|[^/]*\.setup)\.[cm]?[jt]s$/;

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
 * A repainting line needs a terminal it owns, and turbo only gives tasks one in
 * the TUI.
 *
 * Measured, because `TURBO_HASH` cannot answer this: turbo sets it in BOTH UIs,
 * and the task's stderr is a TTY in BOTH (probed with a pty). What separates them
 * is what turbo does with the bytes. The TUI keeps a screen, positions each
 * repaint with cursor moves (`\x1b[4;30H`) and leaves the bar intact, so a lint
 * run there shows the same progress line it shows in a bare terminal. The stream
 * UI prefixes every frame with `<task>: ` and has no screen to rewrite, so each
 * `\r` lands on a new line and the bar becomes a wall of text — there, print
 * nothing and let the runner's summary carry the result.
 *
 * `TURBO_IS_TUI` is the discriminator the task can actually see: it is set to
 * `"true"` by the TUI and absent under `--ui=stream`. Outside turbo it is absent
 * too, which is why the check is "not under turbo, OR under a turbo TUI".
 */
const isInteractive = (): boolean =>
  Boolean(process.stderr.isTTY) &&
  !isDebugEnabled() &&
  (process.env.TURBO_HASH === undefined || process.env.TURBO_IS_TUI === 'true');

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
 * The scan is deliberately repo-wide rather than `src/**`: workspaces here also
 * keep sources in `modules/` (`packages/contracts/*`) and `app/`, and a
 * `src`-only scan reported 3 of `packages/contracts/fleet`'s 24 files — a bar
 * that would never have left 12%.
 *
 * The result is a ceiling, because a workspace can narrow its lint with
 * `files: ["src/**"]` and a glob cannot see that. `done` widens the denominator
 * on overshoot, so the bar can still reach 100% when the estimate is low.
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
  try {
    for (const file of new bun.Glob(`**/*.${SOURCE_EXTENSIONS}`).scanSync({
      cwd,
      dot: false,
      onlyFiles: true,
    })) {
      if (IGNORED_DIRS.test(`${file}/`)) continue;
      if (NOT_LINTED.test(file)) continue;
      seen.add(file);
    }
  } catch {
    // Unreadable cwd: fall back to showing only the completed count.
    return;
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
