import "reflect-metadata";
const base = "/home/sebille/Bureau/projects/tests/deployer/v3/apps/api/src";
const targets: Array<[string, string]> = [
  ["app.module", `${base}/app.module.ts`],
  ["orchestrator.module", `${base}/core/orchestrator/orchestrator.module.ts`],
  ["mesh-core", `${base}/core/modules/mesh/mesh-core.module.ts`],
  ["swarm-core", `${base}/core/modules/swarm/swarm.module.ts`],
  ["swarm-inventory", `${base}/core/modules/swarm/swarm-inventory.module.ts`],
  ["setup-init", `${base}/core/modules/setup/initialization.module.ts`],
  ["node-state", `${base}/core/modules/node-state/node-state.module.ts`],
  ["m-analytics", `${base}/modules/analytics/analytics.module.ts`],
  ["m-deployment", `${base}/modules/deployment/deployment.module.ts`],
  ["m-docker", `${base}/modules/docker/docker.module.ts`],
  ["m-domain", `${base}/modules/domain/domain.module.ts`],
  ["m-fleet", `${base}/modules/fleet/fleet.module.ts`],
  ["m-platform", `${base}/modules/platform/platform.module.ts`],
  ["m-cluster", `${base}/modules/cluster/cluster.module.ts`],
  ["m-providers", `${base}/modules/providers/providers.module.ts`],
  ["m-health", `${base}/modules/health/health.module.ts`],
  ["m-permission", `${base}/modules/permission/permission.module.ts`],
  ["m-project", `${base}/modules/project/project.module.ts`],
  ["m-provider-schema", `${base}/modules/provider-schema/provider-schema.module.ts`],
  ["m-push", `${base}/modules/push/push.module.ts`],
  ["m-service", `${base}/modules/service/service.module.ts`],
  ["m-setup", `${base}/modules/setup/setup.module.ts`],
  ["m-user", `${base}/modules/user/user.module.ts`],
  ["m-reachability", `${base}/modules/reachability/reachability.module.ts`],
];
const t0 = Date.now();
for (const [name, spec] of targets) {
  const s = Date.now();
  try {
    await import(spec);
    console.log(`OK   ${name.padEnd(20)} ${Date.now() - s}ms`);
  } catch (e) {
    console.log(`FAIL ${name.padEnd(20)} ${e instanceof Error ? e.name + ": " + e.message : String(e)}`);
  }
}
console.log(`TOTAL ${Date.now() - t0}ms`);
