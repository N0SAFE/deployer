import { describe, expect, it } from "vitest";

import { buildContainerInspectDetail, layerFallbackCandidates } from "./container-inspect-detail";

const inspect = {
  Image: "sha256:abc",
  Config: {
    Image: " nginx:alpine ",
    Env: ["PORT=80", "DB_PASSWORD=s3=cret"],
    Labels: { "com.docker.compose.service": "web", "com.docker.compose.depends_on": "db, cache" },
    Healthcheck: { Test: ["CMD-SHELL", "curl -f localhost"], Interval: 30_000_000_000, Retries: 3 },
    ExposedPorts: { "80/tcp": {} },
    Entrypoint: ["/entry"],
    Cmd: ["run"],
    User: "",
    WorkingDir: "/app",
  },
  HostConfig: { Dns: [], RestartPolicy: { Name: "always", MaximumRetryCount: 0 }, Memory: 536_870_912, NetworkMode: "bridge" },
  NetworkSettings: {
    Networks: { frontend: { NetworkID: "n1", IPAddress: "10.0.0.2", Aliases: ["web"] } },
    Ports: { "80/tcp": [{ HostIp: "0.0.0.0", HostPort: "8080" }], "53/udp": null, "99999/tcp": null },
  },
  Mounts: [{ Type: "volume", Name: "data", Source: "/v", Destination: "/data", RW: false }],
} as never;

describe("buildContainerInspectDetail", () => {
  const detail = buildContainerInspectDetail("c1", inspect, ["l1", "l2"], "2026-10-01T00:00:00.000Z");

  it("maps ports, dropping invalid ones and linking tcp host bindings", () => {
    expect(detail.portMappings).toEqual([
      { containerPort: 80, hostIp: "0.0.0.0", hostPort: 8080, protocol: "tcp", url: "http://localhost:8080" },
      { containerPort: 53, hostIp: "0.0.0.0", hostPort: null, protocol: "udp", url: null },
    ]);
  });

  it("masks secret-looking environment keys and keeps '=' inside values", () => {
    expect(detail.environment).toEqual([
      { key: "PORT", value: "80", masked: false, source: "runtime" },
      { key: "DB_PASSWORD", value: "s3=cret", masked: true, source: "secret" },
    ]);
  });

  it("reads the runtime config and the compose view from labels", () => {
    expect(detail.runtimeConfig).toMatchObject({
      restartPolicy: "always",
      restartMaxRetries: null,
      healthcheckCommand: "curl -f localhost",
      healthcheckIntervalSec: 30,
      healthcheckRetries: 3,
    });
    expect(detail.composeConfig?.dependsOn.map((dependency) => dependency.service)).toEqual(["db", "cache"]);
    expect(detail.composeConfig?.memLimitMb).toBe(512);
  });

  it("numbers the layers and marks mounts read-only", () => {
    expect(detail.layers.map((layer) => layer.instruction)).toEqual(["LAYER 1", "LAYER 2"]);
    expect(detail.mounts[0]).toMatchObject({ type: "volume", mountName: "data", readOnly: true });
  });

  it("offers the image id and the configured image as layer fallbacks", () => {
    expect(layerFallbackCandidates(inspect)).toEqual(["sha256:abc", "nginx:alpine"]);
  });
});
