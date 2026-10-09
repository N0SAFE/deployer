import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

vi.mock("@nestjs-ssr/react", () => ({
  RenderModule: { forRoot: vi.fn().mockReturnValue({ module: class {} }) },
  Render: () => () => {},
}));

import { createSetupApp } from "@/app.config";

/** Exactly what the wizard's `handleLocalAccountContinue` sends. */
const WIZARD_PAYLOAD = {
  strategy: "local",
  name: "Admin",
  email: "admin@example.com",
  password: "password123",
  serverUrl: "http://setup.deployer.localhost",
  existingDatabaseUrl: undefined as string | undefined,
  swarm: {
    mode: "create" as const,
    policy: "auto",
    advertiseAddr: null,
    joinToken: null,
    joinAddrs: [] as string[],
  },
  managedWeb: "managed" as const,
};

function log(entry: Record<string, unknown>): void {
  fs.appendFileSync("/tmp/trigger-wizard.jsonl", `${JSON.stringify(entry)}\n`);
}

describe("POST /setup/trigger with the wizard's real payload", () => {
  for (const mode of ["dev", "prod"]) {
    it(`answers under SETUP_MODE=${mode}`, async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `setup-wiz-${mode}-`));
      process.env.NODE_LOCAL_DB_PATH = path.join(dir, "local.db");
      process.env.SETUP_MODE = mode;
      process.env.SETUP_API_URL = "http://127.0.0.1:1";
      process.env.DEPLOYER_PREFIX = "deployer";

      const app = await createSetupApp();
      await app.listen(0, "127.0.0.1");
      const url = (await app.getUrl()).replace("[::1]", "127.0.0.1");

      const payload = { ...WIZARD_PAYLOAD };
      if (payload.existingDatabaseUrl === undefined) delete payload.existingDatabaseUrl;

      try {
        const response = await fetch(`${url}/setup/trigger`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await response.text();
        log({ mode, status: response.status, body: body.slice(0, 600) });
      } catch (error: unknown) {
        log({
          mode,
          threw: error instanceof Error ? error.message : String(error),
        });
      } finally {
        await app.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }, 60_000);
  }
});
