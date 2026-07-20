#!/usr/bin/env -S bun

/**
 * Unified Production Entrypoint (Single Container)
 *
 * Starts the NestJS API (which handles all startup internally via
 * the v2 Sub-App Trigger Chain: BootstrapGate → SubAppOrchestrator →
 * ephemeral sub-apps for Config, Database, Auth, Mesh, Events, Docker),
 * then builds and starts the Next.js web
 * server at runtime so prerender can use the live API.
 *
 * Env validation is handled by the API's own EnvService + ConfigModule.
 */

import { spawn } from "node:child_process";

// ─── Configuration ────────────────────────────────────────────────────────────

interface ProcessHandle {
  process: ReturnType<typeof spawn>;
  name: string;
}

// ─── Phase 1: Start NestJS API ─────────────────────────────────────────────

function startApi(): Promise<ProcessHandle> {
  return new Promise((resolve, reject) => {
    console.log("🚀 Starting NestJS API...");
    console.log("   (Migrations, admin creation, mesh registration run automatically)");

    const apiProcess = spawn("bun", ["run", "start:prod"], {
      stdio: "inherit",
      shell: true,
      env: process.env,
    });

    apiProcess.on("error", (err) => {
      console.error("❌ API process error:", err);
      reject(err);
    });

    apiProcess.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        console.error(`❌ API process exited with code ${code}`);
        process.exit(code);
      }
    });

    // Give the API a moment to start before resolving
    setTimeout(() => resolve({ process: apiProcess, name: "API" }), 2000);
  });
}

// ─── Phase 3: Build and start Next.js web server at runtime ──────────────

function buildWeb(): Promise<boolean> {
  return new Promise((resolve) => {
    console.log("🏗️  Building Next.js web app (runtime — API available)...");

    const buildProcess = spawn("bun", ["--bun", "run", "build"], {
      stdio: "inherit",
      shell: true,
      cwd: "../web",
      env: {
        ...process.env,
        NODE_ENV: "production",
      },
    });

    buildProcess.on("error", (err) => {
      console.error("❌ Web build error:", err);
      resolve(false);
    });

    buildProcess.on("exit", (code) => {
      if (code === 0) {
        console.log("✅ Web app built successfully\n");
        resolve(true);
      } else {
        console.error(`❌ Web build failed with exit code ${code}`);
        resolve(false);
      }
    });
  });
}

function startWeb(): Promise<ProcessHandle | null> {
  return new Promise((resolve) => {
    console.log("🌐 Starting Next.js web server...");

    const webProcess = spawn("bun", ["--bun", "run", "start"], {
      stdio: "inherit",
      shell: true,
      cwd: "../web",
      env: {
        ...process.env,
        NODE_ENV: "production",
      },
    });

    webProcess.on("error", (err) => {
      console.error("❌ Web process error:", err);
      resolve(null);
    });

    webProcess.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        console.warn(`⚠️  Web process exited with code ${code}`);
      }
    });

    setTimeout(() => resolve({ process: webProcess, name: "Web" }), 2000);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("════════════════════════════════════════════════════════");
  console.log("🎯 Unified Production Container Entrypoint");
  console.log("════════════════════════════════════════════════════════\n");

  const processes: ProcessHandle[] = [];

  try {
    // Start the API (handles migrations, admin, mesh registration in lifecycle hooks)
    const api = await startApi();
    processes.push(api);

    // Build the web app at runtime (API is running, so prerender works)
    const webBuilt = await buildWeb();
    if (webBuilt) {
      const web = await startWeb();
      if (web) processes.push(web);
    }

    console.log(`\n✅ ${processes.length} process(es) running:`);
    for (const p of processes) {
      console.log(`   • ${p.name}`);
    }
    console.log("\n📋 API:  http://localhost:" + (process.env.API_PORT ?? "3001"));
    console.log("📋 Web:  http://localhost:" + (process.env.NEXT_PUBLIC_APP_PORT ?? "3000"));

    // Keep running until a process exits
    await new Promise<void>((_resolve) => {
      // Never resolve — keep the container alive
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`❌ Entrypoint failed: ${msg}`);
    process.exit(1);
  }
}

// ─── Signal handling (cleanup on container stop) ─────────────────────────────

process.on("SIGTERM", () => {
  console.log("\n⚠️  Received SIGTERM, shutting down...");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("\n⚠️  Received SIGINT, shutting down...");
  process.exit(0);
});

main();
