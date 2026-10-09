import "reflect-metadata";
import { Controller, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { Implement, ORPCModule } from "@orpc/nest";
import { implement } from "@orpc/server";
import { healthContract } from "@repo/api-contracts";

const routes = [
  { key: "check", contract: (healthContract as any).check, call: async () => ({ status: "ok", timestamp: new Date(), service: "bff" }) },
  { key: "detailed", contract: (healthContract as any).detailed, call: async () => ({}) },
];

@Controller()
class BffController {}

// Runtime application of the Implement decorator.
for (const r of routes) {
  const method = function (this: unknown) {
    return implement(r.contract as any).handler(async () => r.call());
  };
  Object.defineProperty(BffController.prototype, r.key, { value: method, writable: true, configurable: true });
  Implement(r.contract as any)(BffController.prototype, r.key, {
    value: method, writable: true, enumerable: false, configurable: true,
  });
}

@Module({
  imports: [ORPCModule.forRoot({ context: () => ({ request: new Request("http://x") }) })],
  controllers: [BffController],
})
class ProbeModule {}

(async () => {
  const app = await NestFactory.create<NestExpressApplication>(ProbeModule, { logger: false });
  await app.init();
  const server = app.getHttpAdapter().getInstance();
  const http = await app.listen(0);
  const addr = http.address() as { port: number };
  const res = await fetch(`http://127.0.0.1:${addr.port}/health/`);
  console.log("STATUS", res.status);
  console.log("BODY", await res.text());
  await app.close();
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
