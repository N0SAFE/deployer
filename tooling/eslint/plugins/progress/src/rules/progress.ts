import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { threadId } from 'node:worker_threads';
import nanospinner from 'nanospinner';
import pc from 'picocolors';
import type { Rule } from 'eslint';

/**
 * `file-progress` as a typed ESLint rule.
 *
 * A one-file-at-a-time progress display for lint runs, which ESLint does not
 * offer natively. It works in three modes, chosen at runtime:
 *
 *   single process   a spinner whose line is rewritten per file
 *   worker threads   a multi-line live block, rendered by one elected worker
 *   several processes a plain line per file (a shared cursor would garble)
 *
 * ── WHY THIS IS TYPESCRIPT NOW ──────────────────────────────────────────────
 * It was a raw `.js` file with a hand-written `.d.ts` beside it, because the
 * plugin was loaded by ESLint straight from source. The types were therefore
 * decorative: nothing checked that the declaration still matched the
 * implementation, and the rule's internals were untyped. Compiled through
 * `@deployer/pkg-build` the implementation and its types come from ONE source,
 * so they cannot drift.
 *
 * ── WHY THE STATE IS MODULE-LEVEL ───────────────────────────────────────────
 * ESLint creates the rule's visitor once per config (`create()`), but the
 * `process.on('exit')` hook must outlive it and a worker's whole lifetime is one
 * lint run. Hoisting the mutable state to the module is what lets the exit hook
 * read what `create()` recorded.
 */

const REGISTRY_DIR = path.join(os.tmpdir(), 'eslint-plugin-file-progress');
const pid = process.pid;
const isWorkerThread = threadId > 0;
const workerId = isWorkerThread ? `${pid}.${threadId}` : String(pid);
const STATUS_FILE = path.join(REGISTRY_DIR, `${workerId}.status`);
const RENDERER_FILE = path.join(REGISTRY_DIR, `${pid}.renderer`);
const DONE_FILE = path.join(REGISTRY_DIR, `${pid}.done`);

/** Max completed files shown above the active workers in concurrent mode. */
const MAX_DONE_LINES = 10;

/**
 * Auto-disable when eslint runs with `--debug`.
 *
 * ESLint's `--debug` calls `require("debug").enable(...)` but does NOT set
 * `process.env.DEBUG`, and worker threads do NOT inherit CLI flags in
 * `process.argv`. The main thread does load this module while resolving config
 * (before spawning any worker) and CAN see `--debug`, and ESLint spawns workers
 * with `SHARE_ENV` — so an env var set here is visible to every worker.
 */
if (process.argv.includes('--debug')) {
  process.env.ESLINT_FILE_PROGRESS_DEBUG = '1';
}

const isDebugEnabled = (): boolean =>
  process.env.ESLINT_FILE_PROGRESS_DEBUG === '1' ||
  process.argv.includes('--debug') ||
  Boolean(process.env.DEBUG);

/** A PID file older than this is stale, even if the PID is still alive. */
const PID_STALE_MS = 60_000;

const getActivePids = (): number[] => {
  let entries: string[];
  try {
    entries = fs.readdirSync(REGISTRY_DIR);
  } catch {
    return [];
  }
  const live: number[] = [];
  for (const entry of entries) {
    const candidate = Number(entry);
    if (!candidate) continue;
    const file = path.join(REGISTRY_DIR, entry);
    // Stale by age: guards against PID reuse and against a long-running
    // background process (a `--watch` run) making a normal run look concurrent.
    try {
      const st = fs.statSync(file);
      if (Date.now() - st.mtimeMs > PID_STALE_MS) {
        try {
          fs.unlinkSync(file);
        } catch {
          /* ignore */
        }
        continue;
      }
    } catch {
      /* ignore: file vanished */
    }
    try {
      process.kill(candidate, 0);
      live.push(candidate);
    } catch (error) {
      // EPERM means the process exists but cannot be signalled.
      if ((error as NodeJS.ErrnoException).code === 'EPERM') {
        live.push(candidate);
        continue;
      }
      try {
        fs.unlinkSync(file);
      } catch {
        /* ignore */
      }
    }
  }
  return live;
};

/** Register this process. True when another live process is already registered. */
const register = (): boolean => {
  try {
    fs.mkdirSync(REGISTRY_DIR, { recursive: true });
    fs.writeFileSync(PID_FILE, String(Date.now()));
  } catch {
    /* ignore */
  }
  return getActivePids().length > 1;
};

/** Deregister this process. True when it was the last active one. */
const deregister = (): boolean => {
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    /* ignore */
  }
  if (getActivePids().length === 0) {
    try {
      fs.rmdirSync(REGISTRY_DIR);
    } catch {
      /* ignore ENOTEMPTY race */
    }
    return true;
  }
  return false;
};

interface WorkerStatus {
  workerId: string;
  file: string;
}

/** Read every worker's status file, skipping ones that vanish mid-read. */
const readStatusFiles = (): WorkerStatus[] => {
  let entries: string[];
  try {
    entries = fs.readdirSync(REGISTRY_DIR);
  } catch {
    return [];
  }
  const statuses: WorkerStatus[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.status')) continue;
    try {
      statuses.push({
        workerId: entry.slice(0, -'.status'.length),
        file: fs.readFileSync(path.join(REGISTRY_DIR, entry), 'utf8'),
      });
    } catch {
      /* ignore: file vanished */
    }
  }
  return statuses;
};

interface DoneEntry {
  file: string;
  ms: number;
  t: number;
}

const writeStatus = (current: string | null, done: DoneEntry[]): void => {
  try {
    fs.mkdirSync(REGISTRY_DIR, { recursive: true });
    fs.writeFileSync(STATUS_FILE, JSON.stringify({ current, done }));
  } catch {
    /* ignore */
  }
};

/** A duration as a compact human-readable string. */
const formatMs = (ms: number): string =>
  ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;

const clearStatus = (): void => {
  try {
    fs.unlinkSync(STATUS_FILE);
  } catch {
    /* ignore */
  }
};

let isRenderer = false;
let renderTimer: ReturnType<typeof setInterval> | null = null;
/**
 * The drawn block height. MONOTONIC by design: it never shrinks, so the cursor
 * always returns to the same top line and every line is rewritten in place. A
 * shrinking height was the cause of a display that grew or duplicated.
 */
let lastRenderedLines = 0;

const render = (): void => {
  const statuses = readStatusFiles();
  const doneEntries: DoneEntry[] = [];
  const activeLines: string[] = [];

  for (const { workerId: id, file } of statuses) {
    let data: { current?: string | null; done?: DoneEntry[] };
    try {
      data = JSON.parse(file) as { current?: string | null; done?: DoneEntry[] };
    } catch {
      data = { current: file, done: [] };
    }
    if (Array.isArray(data.done)) {
      for (const entry of data.done) {
        if (entry && entry.file != null) doneEntries.push(entry);
      }
    }
    if (data.current) {
      activeLines.push(`  ${pc.cyan(`worker ${id}`)} ${pc.green(data.current)}`);
    }
  }

  doneEntries.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  const doneLines = doneEntries
    .slice(-MAX_DONE_LINES)
    .map((d) => `  ${pc.green('✔')} ${pc.dim(d.file)} ${pc.dim(`(${formatMs(d.ms)})`)}`);

  const lines = [...doneLines, ...activeLines];
  const count = lines.length;
  const height = Math.max(lastRenderedLines, count);

  let out = '';
  if (lastRenderedLines > 0) out += `\x1b[${lastRenderedLines}A`;
  for (let i = 0; i < height; i += 1) {
    out += `\x1b[2K\r${i < count ? lines[i] : ''}\n`;
  }
  // Leave the cursor just below the block.
  if (height > count) out += `\x1b[${height - count}A`;
  lastRenderedLines = height;
  process.stderr.write(out);
};

const clearDisplay = (): void => {
  if (lastRenderedLines === 0) return;
  let out = `\x1b[${lastRenderedLines}A`;
  for (let i = 0; i < lastRenderedLines; i += 1) out += '\x1b[2K\r\n';
  process.stderr.write(out);
  lastRenderedLines = 0;
};

/**
 * Claim the renderer role, atomically.
 *
 * The stale marker is only removed when it is older than 5s: two workers
 * starting together would otherwise each delete the other's fresh marker and
 * BOTH would become renderers. The `wx` flag then makes exactly one win.
 */
const tryBecomeRenderer = (): void => {
  try {
    fs.mkdirSync(REGISTRY_DIR, { recursive: true });
    try {
      const st = fs.statSync(RENDERER_FILE);
      if (Date.now() - st.mtimeMs > 5000) fs.unlinkSync(RENDERER_FILE);
    } catch {
      /* ignore: no stale marker */
    }
    fs.writeFileSync(RENDERER_FILE, String(threadId), { flag: 'wx' });
    isRenderer = true;
    try {
      fs.unlinkSync(DONE_FILE);
    } catch {
      /* ignore */
    }
  } catch {
    isRenderer = false;
  }
  if (isRenderer) {
    renderTimer = setInterval(render, 100);
    // Let the renderer thread exit once its own linting is done.
    renderTimer.unref?.();
  }
};

const spinner = nanospinner.createSpinner('', {
  frames: ['|', '/', '-', '\\'],
  color: 'cyan',
});

let bindExit = false;
let initialReportDone = false;
let isConcurrent = false;
let registered = false;
let rendererStarted = false;
let currentFile: string | null = null;
let currentFileStart = 0;
let workerCurrentFile: string | null = null;
let workerCurrentStart = 0;
let workerDone: DoneEntry[] = [];

interface ProgressSettings {
  hide: boolean;
  hideFileName: boolean;
  successMessage: string;
}

const defaultSettings: ProgressSettings = {
  hide: false,
  hideFileName: false,
  successMessage: 'Lint done.',
};

/** Replace the current "Processing: <file>" line with a "✔ <file> (<time>)". */
const finalizeSingleThreadFile = (): void => {
  if (!currentFile) return;
  const ms = Date.now() - currentFileStart;
  spinner.clear();
  process.stderr.write(
    `✔ ${pc.green(currentFile)} ${pc.dim(`(${formatMs(ms)})`)}\n`
  );
  currentFile = null;
};

const exitCallback = (exitCode: number, settings: ProgressSettings): void => {
  if (isWorkerThread) {
    if (workerCurrentFile) {
      workerDone.push({
        file: workerCurrentFile,
        ms: Date.now() - workerCurrentStart,
        t: Date.now(),
      });
      if (workerDone.length > MAX_DONE_LINES) workerDone.shift();
      workerCurrentFile = null;
    }
    clearStatus();
    if (isRenderer) {
      clearDisplay();
      try {
        fs.unlinkSync(RENDERER_FILE);
      } catch {
        /* ignore */
      }
    }
    if (exitCode !== 0 || settings.hide) return;
    // Only the LAST worker prints the done message.
    const others = readStatusFiles().filter((s) => s.workerId !== workerId);
    if (others.length > 0) return;
    try {
      fs.mkdirSync(REGISTRY_DIR, { recursive: true });
      fs.writeFileSync(DONE_FILE, '', { flag: 'wx' });
      process.stderr.write(`✔ ${settings.successMessage}\n`);
    } catch {
      // another worker already printed it
    }
    return;
  }

  const isLast = deregister();
  if (settings.hide || !isLast) return;

  if (isConcurrent) {
    if (exitCode === 0) process.stderr.write(`✔ ${settings.successMessage}\n`);
    return;
  }

  // Single-thread: finalize the last file even when linting reported errors;
  // the done message itself is only printed on success.
  if (currentFile) {
    finalizeSingleThreadFile();
    process.stderr.write('\x1b[?25h'); // show the cursor again
  } else {
    spinner.success({ text: settings.successMessage });
  }
  if (exitCode === 0) process.stderr.write(`✔ ${settings.successMessage}\n`);
};

const create: Rule.RuleModule['create'] = (context) => {
  const settings: ProgressSettings = {
    ...defaultSettings,
    ...(context.settings.progress as Partial<ProgressSettings> | undefined),
  };

  if (isDebugEnabled()) settings.hide = true;

  if (!registered) {
    isConcurrent = isWorkerThread || register();
    registered = true;
  }

  if (!bindExit) {
    process.on('exit', (code) => {
      exitCallback(code ?? 0, settings);
    });
    bindExit = true;
  }

  if (settings.hide) return {};

  if (isConcurrent) {
    if (isWorkerThread) {
      if (!rendererStarted) {
        tryBecomeRenderer();
        rendererStarted = true;
      }
      const relativeFilePath = settings.hideFileName
        ? '(linting)'
        : path.relative(context.cwd, context.filename);
      if (workerCurrentFile) {
        workerDone.push({
          file: workerCurrentFile,
          ms: Date.now() - workerCurrentStart,
          t: Date.now(),
        });
        if (workerDone.length > MAX_DONE_LINES) workerDone.shift();
      }
      workerCurrentFile = relativeFilePath;
      workerCurrentStart = Date.now();
      writeStatus(workerCurrentFile, workerDone);
    } else if (!settings.hideFileName) {
      // Multi-process: one plain line per file, so parallel runs never fight
      // over a shared cursor.
      process.stderr.write(
        `Processing: ${pc.green(path.relative(context.cwd, context.filename))}\n`
      );
    } else if (!initialReportDone) {
      process.stderr.write('Linting...\n');
      initialReportDone = true;
    }
    return {};
  }

  if (!settings.hideFileName) {
    const relativeFilePath = path.relative(context.cwd, context.filename);
    finalizeSingleThreadFile();
    currentFile = relativeFilePath;
    currentFileStart = Date.now();
    spinner.update({ text: `Processing: ${pc.green(relativeFilePath)}` });
  } else if (!initialReportDone) {
    spinner.update({ text: 'Linting...' });
    initialReportDone = true;
  }

  spinner.spin();
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
