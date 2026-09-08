import { CommandFactory } from "nest-commander";
import { Logger } from "@nestjs/common";
import { readFileSync } from "node:fs";
import { CLIModule } from "./cli/cli.module";

const logger = new Logger("CLI");

/** Best-effort deployer version (same source as the command file). */
function resolveDeployerVersion(): string {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf-8");
    return JSON.parse(raw).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * The entrypoint spawns `node-startup-check` and parses JSON from stdout to
 * decide how to boot. If the command fails DURING Nest bootstrap (before
 * run() executes) the previous error handler printed only to stderr and
 * exited 1 → the entrypoint logged "no parseable JSON output" and fell into
 * a misleading fallback. Always emit a parseable payload for this command so
 * the entrypoint can route on the real reason.
 */
function emitStartupCheckErrorPayload(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const payload = {
    setupState: "unknown",
    deployerVersion: resolveDeployerVersion(),
    nodeId: null,
    strategy: null,
    configuredAt: null,
    message: `Startup-state check failed to run: ${message}`,
    exitCode: 5,
  };
  console.log(JSON.stringify(payload));
}

async function bootstrap() {
    try {
        await CommandFactory.run(CLIModule, {
            debug: (...params: unknown[]) => logger.debug(JSON.stringify(params)),
            logger: ["error", "warn"],
            errorHandler: (err: unknown) => {
                // Don't show error for help command exit
                if (err && typeof err === "object" && "code" in err && typeof err.code === "string" && err.code === "commander.helpDisplayed") {
                    process.exit(0);
                }
                if (process.argv.some((arg) => arg.includes("node-startup-check"))) {
                    emitStartupCheckErrorPayload(err);
                }
                logger.error("CLI Error", { error: err });
                process.exit(1);
            },
        });
    } catch (err: unknown) {
        // Covers failures DURING Nest bootstrap (DI/init) that never reach the
        // Commander error handler — e.g. the node-startup-check path on a fresh
        // container. Emit a parseable payload so the entrypoint can route.
        if (process.argv.some((arg) => arg.includes("node-startup-check"))) {
            emitStartupCheckErrorPayload(err);
        }
        logger.error("CLI bootstrap failed", { error: err });
        process.exit(1);
    }
    
    // Explicitly exit after command completes
    // Without this, NestJS keeps connections (DB pool, etc.) open and the process hangs
    process.exit(0);
}

await bootstrap();
