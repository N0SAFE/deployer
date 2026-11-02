/**
 * A container's inspect detail, built from the engine's own description. Pure: the engine call and the image
 * lookup for layers live in the repository, so every mapping rule here is tested on plain data.
 */
import { dockerContainerInspectDetailSchema } from "@deployer/contracts-entities";
import type { ContainersShape } from "@deployer/docker";
import { isRecord } from "@deployer/type-guards";


import { toStringArray } from "../../images/engine/docker-image-reference";

import { detectWatchModeFromLabels, toHealthcheckSeconds } from "./container-inspect-reading";

import type { Effect } from "effect";

export type ContainerInspect = Effect.Success<ReturnType<ContainersShape["inspect"]>>;

/** Image references worth asking the engine about when the container's own description carries no layers. */
export function layerFallbackCandidates(inspect: ContainerInspect): string[] {
  return [inspect.Image, inspect.Config.Image]
    .filter((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0)
    .map((candidate) => candidate.trim());
}

export function buildContainerInspectDetail(
  containerId: string,
  inspect: ContainerInspect,
  layerIds: readonly string[],
  generatedAt: string,
) {
  const labels = inspect.Config?.Labels ?? {};
  const envEntries = toStringArray(inspect.Config.Env);
  const healthcheckTest = toStringArray(inspect.Config.Healthcheck?.Test);
  const healthcheckCommand =
    healthcheckTest.length > 1
      ? healthcheckTest.slice(1).join(" ")
      : (healthcheckTest[0] ?? null);

  const networkConfig = Object.entries(inspect.NetworkSettings.Networks ?? {}).map(
    ([networkName, networkAttachment]) => ({
      networkId: networkAttachment.NetworkID || networkName,
      name: networkName,
      driver: "custom" as const,
      scope: "global" as const,
      ipv4: networkAttachment.IPAddress || null,
      ipv6: networkAttachment.GlobalIPv6Address || null,
      gateway: networkAttachment.Gateway || null,
      macAddress: networkAttachment.MacAddress || null,
      aliases: toStringArray(networkAttachment.Aliases),
      dnsServers: toStringArray(inspect.HostConfig.Dns),
      dnsSearch: toStringArray(inspect.HostConfig.DnsSearch),
      dnsOptions: toStringArray(inspect.HostConfig.DnsOptions),
      extraHosts: toStringArray(inspect.HostConfig?.ExtraHosts),
    }),
  );

  const portMappings = Object.entries(inspect.NetworkSettings.Ports).flatMap(
    ([containerPortWithProtocol, hostBindings]) => {
      const [containerPortRaw, protocolRaw] = containerPortWithProtocol.split("/");
      const containerPort = Number(containerPortRaw);
      const protocol = protocolRaw === "udp" ? "udp" : "tcp";

      if (!Number.isInteger(containerPort) || containerPort < 1 || containerPort > 65535) {
        return [];
      }

      if (!hostBindings || hostBindings.length === 0) {
        return [
          {
            containerPort,
            hostIp: "0.0.0.0",
            hostPort: null,
            protocol,
            url: null,
          },
        ];
      }

      return hostBindings.map((binding) => {
        const hostIp = binding.HostIp || "0.0.0.0";
        const hostPort = binding.HostPort ? Number(binding.HostPort) : null;
        const url =
          protocol === "tcp" && hostPort !== null
            ? `http://${hostIp === "0.0.0.0" ? "localhost" : hostIp}:${String(hostPort)}`
            : null;

        return {
          containerPort,
          hostIp,
          hostPort,
          protocol,
          url,
        };
      });
    },
  );

  const mounts = inspect.Mounts.map((mount) => ({
    type:
      mount.Type === "bind" || mount.Type === "volume" || mount.Type === "tmpfs" || mount.Type === "npipe"
        ? mount.Type
        : "bind",
    mountName: mount.Name || null,
    source: mount.Source || "",
    target: mount.Destination || "",
    readOnly: !mount.RW,
    propagation: mount.Propagation || null,
    mode: mount.Mode || null,
    sizeBytes: null,
  }));

  const environment = envEntries.map((entry) => {
    const [key, ...valueParts] = entry.split("=");
    const normalizedKey = (key ?? "").trim();
    const isSecretKey = /(password|secret|token|key)/i.test(normalizedKey);

    return {
      key: normalizedKey,
      // Secrets never leave the server: the key and the `masked` flag stay, the value is a fixed mask.
      value: isSecretKey ? "********" : valueParts.join("="),
      masked: isSecretKey,
      source: isSecretKey ? ("secret" as const) : ("runtime" as const),
    };
  });

  const runtimeConfig = {
    user: inspect.Config.User || null,
    workingDir: inspect.Config.WorkingDir || null,
    entrypoint: toStringArray(inspect.Config.Entrypoint),
    command: toStringArray(inspect.Config.Cmd),
    restartPolicy: inspect.HostConfig.RestartPolicy?.Name || "no",
    restartMaxRetries:
      typeof inspect.HostConfig.RestartPolicy?.MaximumRetryCount === "number"
      && inspect.HostConfig.RestartPolicy.MaximumRetryCount > 0
        ? inspect.HostConfig.RestartPolicy.MaximumRetryCount
        : null,
    privileged: Boolean(inspect.HostConfig.Privileged),
    readOnlyRootFs: Boolean(inspect.HostConfig.ReadonlyRootfs),
    oomKillDisable: Boolean(inspect.HostConfig.OomKillDisable),
    ipcMode: inspect.HostConfig.IpcMode || null,
    pidMode: inspect.HostConfig.PidMode || null,
    networkMode: inspect.HostConfig.NetworkMode || null,
    cgroupnsMode:
      isRecord(inspect.HostConfig) && inspect.HostConfig.CgroupnsMode &&
      typeof Reflect.get(inspect.HostConfig, "CgroupnsMode") === "string"
        ? (Reflect.get(inspect.HostConfig, "CgroupnsMode") as string)
        : null,
    watchMode: detectWatchModeFromLabels(labels),
    healthcheckCommand,
    healthcheckIntervalSec: toHealthcheckSeconds(inspect.Config.Healthcheck?.Interval),
    healthcheckTimeoutSec: toHealthcheckSeconds(inspect.Config.Healthcheck?.Timeout),
    healthcheckRetries: inspect.Config.Healthcheck?.Retries ?? null,
  };

  const composeServiceName = labels["com.docker.compose.service"]
    || labels["com.docker.swarm.service.name"]
    || null;
  const composeProjectName = labels["com.docker.compose.project"]
    || labels["com.docker.stack.namespace"]
    || null;
  const composeConfigPath = labels["com.docker.compose.project.config_files"] ?? null;
  const composeDependsOnRaw = labels["com.docker.compose.depends_on"] ?? "";
  const composeDependsOn = composeDependsOnRaw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => ({
      service: entry,
      condition: "service_started" as const,
      required: true,
    }));

  const composeConfig = composeServiceName || composeProjectName
    ? {
        serviceName: composeServiceName,
        projectName: composeProjectName,
        composeFilePath: composeConfigPath,
        dependsOn: composeDependsOn,
        dns: toStringArray(inspect.HostConfig.Dns),
        dnsSearch: toStringArray(inspect.HostConfig.DnsSearch),
        dnsOptions: toStringArray(inspect.HostConfig.DnsOptions),
        memLimitMb:
          typeof inspect.HostConfig.Memory === "number" && inspect.HostConfig.Memory > 0
            ? Math.round(inspect.HostConfig.Memory / (1024 * 1024))
            : null,
        memReservationMb:
          typeof inspect.HostConfig.MemoryReservation === "number" && inspect.HostConfig.MemoryReservation > 0
            ? Math.round(inspect.HostConfig.MemoryReservation / (1024 * 1024))
            : null,
        cpus:
          typeof inspect.HostConfig.NanoCpus === "number" && inspect.HostConfig.NanoCpus > 0
            ? Number((inspect.HostConfig.NanoCpus / 1_000_000_000).toFixed(2))
            : null,
        cpuShares:
          typeof inspect.HostConfig.CpuShares === "number" && inspect.HostConfig.CpuShares > 0
            ? inspect.HostConfig.CpuShares
            : null,
        restart: inspect.HostConfig.RestartPolicy?.Name || null,
        profiles: labels["com.docker.compose.project.working_dir"] ? ["default"] : [],
        ports: Object.keys(inspect.Config.ExposedPorts ?? {}),
        volumes: Object.keys(inspect.Config.Volumes ?? {}),
        labels,
        rawYaml: [
          "services:",
          `  ${composeServiceName ?? "service"}:`,
          `    image: ${inspect.Config.Image ?? "unknown"}`,
          `    restart: ${inspect.HostConfig.RestartPolicy?.Name ?? "no"}`,
          ...Object.keys(inspect.Config.ExposedPorts ?? {}).map((port) => `    # exposed: ${port}`),
        ].join("\n"),
      }
    : null;

  const layers = layerIds.map((layerId, index) => ({
    id: layerId,
    instruction: `LAYER ${String(index + 1)}`,
    size: "unknown",
    createdAt: generatedAt,
  }));

  return dockerContainerInspectDetailSchema.parse({
    containerId,
    generatedAt,
    layers,
    processes: [],
    streamingLogsSupported: true,
    networkConfig,
    portMappings,
    mounts,
    environment,
    runtimeConfig,
    composeConfig,
  });
}
