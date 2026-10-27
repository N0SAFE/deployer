import { createApp } from "./server";
import { startTelemetry } from "./telemetry";

const telemetry = startTelemetry();
const app = await createApp();
const port = Number(process.env.PORT ?? 3000);

await app.listen(port, "0.0.0.0");

console.log(`oRPC + NestJS showcase → http://localhost:${port}`);
console.log(`  OpenAPI document → http://localhost:${port}/openapi.json`);
console.log(`  Better Auth      → http://localhost:${port}/api/auth/*`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void Promise.all([app.close(), telemetry.shutdown()]).finally(() => process.exit(0));
  });
}
