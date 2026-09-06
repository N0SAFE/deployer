import { describe, expect, it, vi, beforeEach } from "vitest";
import type { DockerService } from "@/core/modules/docker/services/docker.service";
import { SwarmComposeRealizerService } from "./swarm-compose-realizer.service";

const FULL_COMPOSE = `
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: secret
    volumes:
      - db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
    deploy:
      replicas: 1
      resources:
        limits:
          cpus: "1.0"
          memory: 512M
  api:
    image: myapp:latest
    depends_on:
      - db
    command: ["node", "server.js"]
    ports:
      - "8080:3000/tcp"
    networks:
      - private
    deploy:
      replicas: 2
      restart_policy:
        condition: on-failure
secrets:
  api_key:
    file: ./keys/api.key
networks:
  private:
    driver: overlay
volumes:
  db-data: {}
`;

const BUILD_ONLY = `
services:
  worker:
    build: .
    restart: always
`;

const BIND_VOLUME = `
services:
  app:
    image: nginx:alpine
    volumes:
      - /host/path:/data
`;

describe("SwarmComposeRealizerService", () => {
    let realizer: SwarmComposeRealizerService;
    let dockerService: {
        ensureOverlayNetwork: ReturnType<typeof vi.fn>;
        listSwarmSecrets: ReturnType<typeof vi.fn>;
        listSwarmConfigs: ReturnType<typeof vi.fn>;
        createSwarmSecret: ReturnType<typeof vi.fn>;
        createSwarmConfig: ReturnType<typeof vi.fn>;
        inspectSwarmService: ReturnType<typeof vi.fn>;
        createSwarmService: ReturnType<typeof vi.fn>;
        updateSwarmService: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        dockerService = {
            ensureOverlayNetwork: vi.fn().mockResolvedValue(undefined),
            listSwarmSecrets: vi.fn().mockResolvedValue([]),
            listSwarmConfigs: vi.fn().mockResolvedValue([]),
            createSwarmSecret: vi.fn().mockResolvedValue({ ID: "s1", Spec: { Name: "x" } }),
            createSwarmConfig: vi.fn().mockResolvedValue({ ID: "c1", Spec: { Name: "x" } }),
            inspectSwarmService: vi.fn().mockRejectedValue(new Error("service not found")),
            createSwarmService: vi.fn().mockResolvedValue({ ID: "svc-1" }),
            updateSwarmService: vi.fn().mockResolvedValue(undefined),
        };
        realizer = new SwarmComposeRealizerService(dockerService as unknown as DockerService);
    });

    describe("parseComposeYaml", () => {
        it("parses a full compose file with normalization", () => {
            const model = realizer.parseComposeYaml(FULL_COMPOSE);
            expect(model.services.length).toBe(2);
            const db = model.services.find((service) => service.name === "db");
            expect(db?.env).toEqual(["POSTGRES_PASSWORD=secret"]);
            expect(db?.healthcheck).toMatchObject({ intervalMs: 10_000, retries: 5 });
            expect(db?.deploy.memoryLimitBytes).toBe(512 * 1024 * 1024);
            expect(db?.deploy.cpuLimit).toBe(1);
            expect(db?.mounts).toContainEqual({ type: "volume", source: "db-data", target: "/var/lib/postgresql/data", readOnly: false });

            const api = model.services.find((service) => service.name === "api");
            expect(api?.dependsOn).toEqual(["db"]);
            expect(api?.args).toEqual(["node", "server.js"]); // compose command → Args
            expect(api?.ports).toEqual([{ targetPort: 3000, publishedPort: 8080, protocol: "tcp" }]);
            expect(api?.networks).toEqual(["private"]);
            expect(api?.deploy.replicas).toBe(2);
            expect(api?.deploy.restartCondition).toBe("on-failure");

            expect(model.secrets).toEqual({ api_key: "./keys/api.key" });
            expect(model.networks["private"]?.driver).toBe("overlay");
            expect(model.volumes["db-data"]).toEqual({});
        });

        it("throws a readable error on non-compose YAML", () => {
            expect(() => realizer.parseComposeYaml("foo: bar")).toThrow(/services/);
        });

        it("throws a readable error on invalid YAML", () => {
            expect(() => realizer.parseComposeYaml("a: [unclosed")).toThrow(/Invalid compose YAML/);
        });
    });

    describe("validateCompatibility", () => {
        it("flags build-only services as errors", () => {
            const model = realizer.parseComposeYaml(BUILD_ONLY);
            const report = realizer.validateCompatibility(model);
            expect(report.issues.some((issue) => issue.severity === "error" && issue.path === "services.worker.image")).toBe(true);
        });

        it("flags bind mounts as errors", () => {
            const model = realizer.parseComposeYaml(BIND_VOLUME);
            const report = realizer.validateCompatibility(model);
            expect(report.issues.some((issue) => issue.severity === "error" && issue.message.includes("Bind mounts"))).toBe(true);
        });

        it("supports the full compose without errors", () => {
            const model = realizer.parseComposeYaml(FULL_COMPOSE);
            const report = realizer.validateCompatibility(model);
            expect(report.issues.filter((issue) => issue.severity === "error")).toEqual([]);
        });
    });

    describe("realizeCompose", () => {
        it("builds a dependency-ordered plan with typed specs", () => {
            const model = realizer.parseComposeYaml(FULL_COMPOSE);
            const plan = realizer.realizeCompose(model, { projectId: "proj-1", deploymentId: "dep-1" });

            // db before api (depends_on ordering)
            expect(plan.services.map((entry) => entry.serviceName)).toEqual(["db", "api"]);

            const dbSpec = plan.services.find((entry) => entry.serviceName === "db")?.spec;
            expect(dbSpec?.image).toBe("postgres:16-alpine");
            expect(dbSpec?.mounts).toEqual([
                { type: "volume", source: "deployer-proj-1-db-data", target: "/var/lib/postgresql/data", readOnly: false },
            ]);
            expect(dbSpec?.healthcheck?.intervalMs).toBe(10_000);

            const apiSpec = plan.services.find((entry) => entry.serviceName === "api")?.spec;
            expect(apiSpec?.endpointPorts).toEqual([{ targetPort: 3000, publishedPort: 8080, protocol: "tcp" }]);
            expect(apiSpec?.networks).toEqual(["deployer-proj-1-private"]);
            expect(apiSpec?.labels["deployer.compose_service"]).toBe("api");

            expect(plan.networks).toEqual([
                { name: "deployer-proj-1-private", driver: "overlay", attachable: true, labels: expect.objectContaining({ "deployer.project_id": "proj-1" }) },
            ]);
            expect(plan.secrets).toEqual([{ name: "deployer-proj-1-secret-api_key", data: "./keys/api.key" }]);
        });
    });

    describe("executeComposePlan", () => {
        it("creates networks, secrets, configs and services idempotently", async () => {
            const model = realizer.parseComposeYaml(FULL_COMPOSE);
            const plan = realizer.realizeCompose(model, { projectId: "proj-1", deploymentId: "dep-1" });

            const summary = await realizer.executeComposePlan(plan);

            expect(dockerService.ensureOverlayNetwork).toHaveBeenCalledTimes(1);
            expect(dockerService.ensureOverlayNetwork).toHaveBeenCalledWith(
                expect.objectContaining({ name: "deployer-proj-1-private", driver: "overlay" }),
            );
            expect(dockerService.createSwarmSecret).toHaveBeenCalledTimes(1);
            expect(dockerService.createSwarmConfig).not.toHaveBeenCalled();
            // Two services, both missing → create (not update)
            expect(dockerService.createSwarmService).toHaveBeenCalledTimes(2);
            expect(dockerService.updateSwarmService).not.toHaveBeenCalled();
            expect(summary.createdServices.length).toBe(2);
            expect(summary.secrets).toEqual(["deployer-proj-1-secret-api_key"]);
        });

        it("skips existing secrets/configs (idempotent)", async () => {
            dockerService.listSwarmSecrets.mockResolvedValue([
                { ID: "s1", Spec: { Name: "deployer-proj-1-secret-api_key" } },
            ]);
            const model = realizer.parseComposeYaml(FULL_COMPOSE);
            const plan = realizer.realizeCompose(model, { projectId: "proj-1", deploymentId: "dep-1" });

            await realizer.executeComposePlan(plan);

            expect(dockerService.createSwarmSecret).not.toHaveBeenCalled();
        });

        it("updates an existing service instead of creating it", async () => {
            dockerService.inspectSwarmService.mockResolvedValue({ ID: "existing", Version: { Index: 3 } });
            const model = realizer.parseComposeYaml(FULL_COMPOSE);
            const plan = realizer.realizeCompose(model, { projectId: "proj-1", deploymentId: "dep-1" });

            const summary = await realizer.executeComposePlan(plan);

            expect(dockerService.updateSwarmService).toHaveBeenCalledTimes(2);
            expect(dockerService.updateSwarmService).toHaveBeenCalledWith(
                expect.any(String),
                3,
                expect.objectContaining({ Name: expect.stringContaining("deployer-proj-1-") }),
                false,
            );
            expect(dockerService.createSwarmService).not.toHaveBeenCalled();
            expect(summary.updatedServices.length).toBe(2);
        });
    });
});