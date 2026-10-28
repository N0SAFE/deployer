import {
	swarmServiceRuntimeSchema,
	swarmTaskRuntimeSchema,
	type DockerodeServiceSummary,
	type DockerodeTaskSummary,
	type SwarmServiceRuntime,
	type SwarmTaskRuntime,
} from "@deployer/contracts-entities";

/** A raw engine task as the platform's runtime view, named after its service. */
export const toTaskRuntime = (task: DockerodeTaskSummary, service: DockerodeServiceSummary | undefined): SwarmTaskRuntime =>
	swarmTaskRuntimeSchema.parse({
		id: task.ID,
		serviceId: task.ServiceID,
		nodeId: task.NodeID ?? null,
		slot: task.Slot ?? null,
		state: task.Status.State,
		desiredState: task.DesiredState,
		error: task.Status.Err ?? null,
		containerId: task.Status.ContainerStatus?.ContainerID ?? null,
		updatedAt: task.Status.Timestamp ?? "",
		serviceName: service?.Spec.Name ?? "",
		image: service?.Spec.TaskTemplate?.ContainerSpec?.Image ?? "",
	});

/** A raw engine service plus the cluster-wide tasks as the runtime view, with desired and running counts. */
export const toServiceRuntime = (service: DockerodeServiceSummary, tasks: DockerodeTaskSummary[]): SwarmServiceRuntime => {
	const spec = service.Spec;
	const mode = spec.Mode;
	const isGlobal = Boolean(mode?.Global);
	const replicas = isGlobal ? null : (mode?.Replicated?.Replicas ?? 0);
	const serviceTasks = tasks.filter((task) => task.ServiceID === service.ID);
	const runningTasks = serviceTasks.filter((task) => task.Status.State === "running").length;
	const desiredTasks = isGlobal
		? serviceTasks.filter((task) => task.DesiredState !== "shutdown" && task.DesiredState !== "remove").length
		: (replicas ?? 0);
	return swarmServiceRuntimeSchema.parse({
		id: service.ID,
		name: spec.Name,
		versionIndex: service.Version.Index,
		image: spec.TaskTemplate?.ContainerSpec?.Image ?? "",
		labels: spec.Labels,
		replicas,
		networks: spec.TaskTemplate?.Networks?.map((network) => network.Target ?? "") ?? [],
		updateStatus: service.UpdateStatus
			? {
					state: service.UpdateStatus.State ?? "",
					startedAt: service.UpdateStatus.StartedAt ?? null,
					message: service.UpdateStatus.Message ?? null,
				}
			: null,
		createdAt: service.CreatedAt,
		updatedAt: service.UpdatedAt,
		mode: isGlobal ? "global" : "replicated",
		desiredTasks,
		runningTasks,
	});
};
