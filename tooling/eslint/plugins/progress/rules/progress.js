import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { threadId } from 'node:worker_threads';
import nanospinner from 'nanospinner';
import pc from 'picocolors';

const REGISTRY_DIR = path.join(os.tmpdir(), 'eslint-plugin-file-progress');
const pid = process.pid;
const isWorkerThread = threadId > 0;
const workerId = isWorkerThread ? `${pid}.${threadId}` : String(pid);
const STATUS_FILE = path.join(REGISTRY_DIR, `${workerId}.status`);
const RENDERER_FILE = path.join(REGISTRY_DIR, `${pid}.renderer`);
const DONE_FILE = path.join(REGISTRY_DIR, `${pid}.done`);

// Max completed files shown above the active workers in concurrent mode.
const MAX_DONE_LINES = 10;

// Auto-disable when eslint --debug is used.
//
// ESLint's `--debug` flag calls `require("debug").enable(...)` but does NOT set
// `process.env.DEBUG`, and worker threads do NOT inherit the CLI flags in
// `process.argv`. However, the main thread loads this module during config
// loading (before any worker is spawned) and CAN see `--debug` in argv. Because
// ESLint spawns workers with `env: SHARE_ENV`, an env var set here in the main
// thread is visible to every worker. We use that to propagate the flag.
if (process.argv.includes('--debug')) {
  process.env.ESLINT_FILE_PROGRESS_DEBUG = '1';
}
const isDebugEnabled = () =>
  process.env.ESLINT_FILE_PROGRESS_DEBUG === '1' ||
  process.argv.includes('--debug') ||
  Boolean(process.env.DEBUG);

// --- Multi-process registry (main threads only) ---
// Detects several independent `eslint` processes running in parallel (e.g. a
// monorepo linter fanning out across packages). Worker threads share one PID,
// so this is only meaningful for the main thread.
const PID_FILE = path.join(REGISTRY_DIR, String(pid));

// A PID file older than this is considered stale, even if the PID is still
// alive. This prevents a long-running background `eslint` process (e.g. a
// `--watch` or `--fix --cache` run) from making a normal non-concurrency run
// falsely detect "multi-process" and fall back to plain lines. Genuine parallel
// lints (e.g. turbo fanning out across packages) start within seconds of each
// other, so their PID files are always fresh.
const PID_STALE_MS = 60_000;

const getActivePids = () => {
  let entries;
  try {
    entries = fs.readdirSync(REGISTRY_DIR);
  } catch {
    return [];
  }
  return entries.filter((entry) => {
    const p = Number(entry);
    if (!p) {
      return false;
    }
    const file = path.join(REGISTRY_DIR, entry);
    // Treat PID files older than the staleness threshold as stale, regardless
    // of whether the PID is alive (avoids PID-reuse and long-running background
    // process false positives).
    try {
      const st = fs.statSync(file);
      if (Date.now() - st.mtimeMs > PID_STALE_MS) {
        try {
          fs.unlinkSync(file);
        } catch {
          /* ignore */
        }
        return false;
      }
    } catch {
      /* ignore: file vanished */
    }
    try {
      process.kill(p, 0);
      return true;
    } catch (e) {
      if (e.code === 'EPERM') {
        return true; // process exists, no permission to signal
      }
      try {
        fs.unlinkSync(file);
      } catch {
        /* ignore */
      }
      return false; // ESRCH = dead process, stale file removed
    }
  });
};

// Register this process. Returns true if other live processes were already registered.
const register = () => {
  try {
    fs.mkdirSync(REGISTRY_DIR, { recursive: true });
    fs.writeFileSync(PID_FILE, String(Date.now()));
  } catch {
    /* ignore */
  }
  return getActivePids().length > 1;
};

// Deregister this process. Returns true if this was the last active process.
const deregister = () => {
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    /* ignore */
  }
  const remaining = getActivePids();
  if (remaining.length === 0) {
    try {
      fs.rmdirSync(REGISTRY_DIR);
    } catch {
      /* ignore ENOTEMPTY race */
    }
    return true;
  }
  return false;
};

// --- Worker-thread status files ---
// Each worker thread publishes the file it is currently linting to its own
// status file. The elected renderer reads them all to build the live display.
const readStatusFiles = () => {
  let entries;
  try {
    entries = fs.readdirSync(REGISTRY_DIR);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.endsWith('.status'))
    .map((entry) => {
      try {
        const file = fs.readFileSync(path.join(REGISTRY_DIR, entry), 'utf8');
        return { workerId: entry.slice(0, -'.status'.length), file };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
};

const writeStatus = (current, done) => {
  try {
    fs.mkdirSync(REGISTRY_DIR, { recursive: true });
    fs.writeFileSync(STATUS_FILE, JSON.stringify({ current, done }));
  } catch {
    /* ignore */
  }
};

// Format a duration in milliseconds as a compact human-readable string.
const formatMs = (ms) => {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
};

const clearStatus = () => {
  try {
    fs.unlinkSync(STATUS_FILE);
  } catch {
    /* ignore */
  }
};

// --- Renderer (multi-line real-time display) ---
// Exactly one worker thread owns the terminal. It polls every worker's status
// file and redraws a multi-line block in place using ANSI escape sequences.
let isRenderer = false;
let renderTimer = null;
let lastRenderedLines = 0;

const render = () => {
  const statuses = readStatusFiles();

  // Collect completed files (with time spent) and currently-active workers.
  const doneEntries = [];
  const activeLines = [];
  for (const { workerId, file } of statuses) {
    let data;
    try {
      data = JSON.parse(file);
    } catch {
      data = { current: file, done: [] };
    }
    if (Array.isArray(data.done)) {
      for (const d of data.done) {
        if (d && d.file != null) {
          doneEntries.push(d);
        }
      }
    }
    if (data.current) {
      activeLines.push(
        `  ${pc.cyan(`worker ${workerId}`)} ${pc.green(data.current)}`
      );
    }
  }

  // Show the most recent completed files above the active workers.
  doneEntries.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  const recentDone = doneEntries.slice(-MAX_DONE_LINES);
  const doneLines = recentDone.map((d) =>
    `  ${pc.green('✔')} ${pc.dim(d.file)} ${pc.dim(`(${formatMs(d.ms)})`)}`
  );

  const lines = [...doneLines, ...activeLines];
  const count = lines.length;

  // The display block height is MONOTONIC: it never shrinks. This guarantees
  // the cursor always moves back to the same top line and every line is
  // rewritten in place, so the display never grows or duplicates (the bug that
  // occurred when `count` changed and the cursor drifted).
  const height = Math.max(lastRenderedLines, count);

  let out = '';
  // Move the cursor back to the top of the previously drawn block.
  if (lastRenderedLines > 0) {
    out += `\x1b[${lastRenderedLines}A`;
  }
  // Rewrite `height` lines: content for active/done lines, blank for any
  // leftover lines (when the number of lines shrank).
  for (let i = 0; i < height; i++) {
    const line = i < count ? lines[i] : '';
    out += `\x1b[2K\r${line}\n`;
  }
  // Move the cursor back up so it sits just below the content block.
  if (height > count) {
    out += `\x1b[${height - count}A`;
  }
  lastRenderedLines = height;
  process.stderr.write(out);
};

const clearDisplay = () => {
  if (lastRenderedLines > 0) {
    let out = `\x1b[${lastRenderedLines}A`;
    for (let i = 0; i < lastRenderedLines; i++) {
      out += `\x1b[2K\r\n`;
    }
    process.stderr.write(out);
    lastRenderedLines = 0;
  }
};

const tryBecomeRenderer = () => {
  try {
    fs.mkdirSync(REGISTRY_DIR, { recursive: true });
    // Remove a stale renderer marker left by a previous crashed run, then claim
    // the role atomically so only one worker becomes the renderer.
    //
    // We only delete the marker if it is old (mtime > 5s). This avoids a race
    // where two workers starting at the same time each delete the other's
    // freshly-created marker and BOTH become renderers. The `wx` flag then
    // guarantees exactly one worker wins the claim.
    try {
      const st = fs.statSync(RENDERER_FILE);
      if (Date.now() - st.mtimeMs > 5000) {
        fs.unlinkSync(RENDERER_FILE);
      }
    } catch {
      /* ignore: no stale marker */
    }
    fs.writeFileSync(RENDERER_FILE, String(threadId), { flag: 'wx' });
    isRenderer = true;
    // Clear a stale done marker from a previous run.
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
    // unref so the renderer thread can still exit once its own linting is done.
    renderTimer.unref?.();
  }
};

// --- Spinner (single-thread mode) ---
const spinner = nanospinner.createSpinner('', {
  frames: ['|', '/', '-', '\\'],
  color: 'cyan',
});

let bindExit = false;
let initialReportDone = false;
let isConcurrent = false;
let registered = false;
let rendererStarted = false;

// Single-thread mode: track the current file so its "Processing" line can be
// replaced by a "✔ <file> (<time>)" line when it finishes.
let currentFile = null;
let currentFileStart = 0;

// Worker-thread mode: track the current file and a bounded list of completed
// files (with time spent) for the renderer to display.
let workerCurrentFile = null;
let workerCurrentStart = 0;
let workerDone = [];

const defaultSettings = {
  hide: false,
  hideFileName: false,
  successMessage: 'Lint done.',
};

// Replace the current single-thread "Processing: <file>" line with a
// "✔ <file> (<time>)" line, then move to the next line.
const finalizeSingleThreadFile = () => {
  if (currentFile) {
    const ms = Date.now() - currentFileStart;
    spinner.clear();
    process.stderr.write(
      `✔ ${pc.green(currentFile)} ${pc.dim(`(${formatMs(ms)})`)}` + '\n'
    );
    currentFile = null;
  }
};

const exitCallback = (exitCode, settings) => {
  if (isWorkerThread) {
    // Finalize the current file into the done list before clearing status.
    if (workerCurrentFile) {
      const ms = Date.now() - workerCurrentStart;
      workerDone.push({ file: workerCurrentFile, ms, t: Date.now() });
      if (workerDone.length > MAX_DONE_LINES) {
        workerDone.shift();
      }
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
    if (exitCode !== 0 || settings.hide) {
      return;
    }
    // Only the last worker to finish prints the done message.
    const others = readStatusFiles().filter((s) => s.workerId !== workerId);
    if (others.length > 0) {
      return;
    }
    try {
      fs.mkdirSync(REGISTRY_DIR, { recursive: true });
      fs.writeFileSync(DONE_FILE, '', { flag: 'wx' });
      process.stderr.write(`✔ ${settings.successMessage}\n`);
    } catch {
      // another worker already printed the done message
    }
    return;
  }

  // Main thread: multi-process or single-thread mode.
  const isLast = deregister();
  if (settings.hide) {
    return;
  }
  if (!isLast) {
    return; // another process will print the done message
  }
  if (isConcurrent) {
    if (exitCode === 0) {
      process.stderr.write(`✔ ${settings.successMessage}\n`);
    }
  } else {
    // Single-thread: always finalize the last "Processing" line into its "✔"
    // line (per-file completion), even when linting produced errors. The final
    // "✔ Lint done." message is only printed on success (exit code 0).
    if (currentFile) {
      finalizeSingleThreadFile();
      process.stderr.write('\x1b[?25h'); // show the cursor again
    } else {
      // hideFileName: replace the "Linting..." spinner with the done message.
      spinner.success({ text: settings.successMessage });
    }
    if (exitCode === 0) {
      process.stderr.write(`✔ ${settings.successMessage}\n`);
    }
  }
};

const create = (context) => {
  const settings = { ...defaultSettings, ...context.settings.progress };

  if (isDebugEnabled()) {
    settings.hide = true;
  }

  if (!registered) {
    isConcurrent = isWorkerThread || register();
    registered = true;
  }

  if (!bindExit) {
    process.on('exit', (code) => {
      exitCallback(code, settings);
    });
    bindExit = true;
  }

  if (settings.hide) {
    return {};
  }

  if (isConcurrent) {
    if (isWorkerThread) {
      // Multi-line real-time display across worker threads.
      if (!rendererStarted) {
        tryBecomeRenderer();
        rendererStarted = true;
      }
      const relativeFilePath = settings.hideFileName
        ? '(linting)'
        : path.relative(context.cwd, context.filename);
      // Move the previous file into the done list, then publish the new one.
      if (workerCurrentFile) {
        const ms = Date.now() - workerCurrentStart;
        workerDone.push({ file: workerCurrentFile, ms, t: Date.now() });
        if (workerDone.length > MAX_DONE_LINES) {
          workerDone.shift();
        }
      }
      workerCurrentFile = relativeFilePath;
      workerCurrentStart = Date.now();
      writeStatus(workerCurrentFile, workerDone);
    } else {
      // Multi-process: plain line per file to avoid garbling other processes.
      if (!settings.hideFileName) {
        const relativeFilePath = path.relative(context.cwd, context.filename);
        process.stderr.write(`Processing: ${pc.green(relativeFilePath)}\n`);
      } else if (!initialReportDone) {
        process.stderr.write('Linting...\n');
        initialReportDone = true;
      }
    }
    return {};
  }

  // Single-process mode: replace each "Processing" line with a "✔" line.
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

const progress = {
  name: import.meta.filename,
  meta: {
    type: 'suggestion',
    messages: [],
    schema: [],
  },
  create,
};

export default progress;