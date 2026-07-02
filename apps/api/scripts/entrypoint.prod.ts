#!/usr/bin/env -S bun

/**
 * Unified Production Entrypoint (Single Container)
 *
 * In production, a single container runs both the NestJS API and the Next.js
 * web server. The API handles all startup tasks internally via
 * `StartupOrchestratorService.onModuleInit()`:
 *   - Runs pending Drizzle migrations
 *   - Creates default admin user (if configured)
 *   - Registers this node in the mesh
 *   - Reports schema version
 *
 * This entrypoint:
 *   1. Validates environment variables
 *   2. Starts the NestJS API (which auto-runs startup tasks in lifecycle hooks)
 *   3. Starts the Next.js web server alongside the API
 *   4. Handles graceful shutdown for both processes
 */

import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { validateApiEnvSafe, apiEnvIsValid } from "@repo/env";
import zod from "zod/v4";

// ─── Configuration ────────────────────────────────────────────────────────────

interface ProcessHandle {
  process: ReturnType<typeof spawn>;
  name: string;
}

// ─── Phase 1: Validate environment ──────────────────────────────────────────

function validateEnvironment(): void {
  console.log("🔍 Validating environment variables...");

  if (!apiEnvIsValid(process.env)) {
    const result = validateApiEnvSafe(process.env);
    console.error("❌ Environment validation failed:");
    if (!result.success) {
      console.error(zod.prettifyError(result.error));
    }
    process.exit(1);
  }

  console.log("✅ Environment validation passed\n");
}

// ─── Phase 2: Start NestJS API ─────────────────────────────────────────────

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

// ─── Phase 3: Start Next.js web server ──────────────────────────────────────

function startWeb(): Promise<ProcessHandle | null> {
  return new Promise((resolve) => {
    // Check if the built web app exists
    const webDist = "../web/.next";
    if (!existsSync(webDist)) {
      console.log("⏭️  Web build not found at ../web/.next — skipping web server");
      resolve(null);
      return;
    }

    // Check if web entrypoint exists
    const webEntrypoint = "../web/scripts/entrypoint.prod.ts";
    if (!existsSync(webEntrypoint)) {
      console.log("⏭️  Web entrypoint not found — skipping web server");
      resolve(null);
      return;
    }

    console.log("🌐 Starting Next.js web server...");

    const webProcess = spawn("bun", ["--bun", webEntrypoint], {
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
        // Don't exit — API continues running
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

  validateEnvironment();

  const processes: ProcessHandle[] = [];

  try {
    // Start the API (handles migrations, admin, mesh registration in lifecycle hooks)
    const api = await startApi();
    processes.push(api);

    // Start the web server (if built output exists)
    const web = await startWeb();
    if (web) processes.push(web);

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
