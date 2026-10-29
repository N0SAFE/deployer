import type { DockerRuntimeActivityEntity, DockerRuntimeEvent } from "@deployer/contracts-entities";
import { serviceOver, type Over } from "@deployer/effect-core";
import type { DbError } from "@deployer/effect-infra";
import type {
  DockerRuntimeActivityDetailQueryInput,
  DockerRuntimeActivityListInput,
} from "@deployer/runtime-contracts/modules/docker/runtime/activity";
import { Context, Effect } from "effect";

import type { RuntimeDatabasePort, RuntimeDb } from "../../../../core/database/runtime-db";
import { DockerRuntimeActivitiesStore } from "./docker-runtime-activities.store";
import { listRuntimeActivityEntities } from "./runtime-activity-list";
import { buildRuntimeActivityRecord, toRuntimeActivityEntity } from "./runtime-activity-mapping";

/** How many of the most recent activities a list filters, sorts and pages over. */
const RECENT_ACTIVITY_WINDOW = 5000;

type DbRequirements = RuntimeDb | RuntimeDatabasePort;

export type DockerRuntimeActivitiesShape = {
  /** Store the activity an event describes; one already stored with the same fingerprint is left alone. */
  readonly persist: (event: DockerRuntimeEvent) => Effect.Effect<void, DbError, DbRequirements>;
  readonly list: (
    input: DockerRuntimeActivityListInput,
  ) => Effect.Effect<ReturnType<typeof listRuntimeActivityEntities>, DbError, DbRequirements>;
  readonly getById: (
    input: DockerRuntimeActivityDetailQueryInput,
  ) => Effect.Effect<DockerRuntimeActivityEntity | null, DbError, DbRequirements>;
};

const makeDockerRuntimeActivities = ({ store }: { store: DockerRuntimeActivitiesStore["Service"] }): DockerRuntimeActivitiesShape => ({
  persist: (event) => Effect.suspend(() => store.insert(buildRuntimeActivityRecord(event, new Date()))),
  list: (input) =>
    Effect.map(store.listRecent(RECENT_ACTIVITY_WINDOW), (rows) =>
      listRuntimeActivityEntities(rows.map(toRuntimeActivityEntity), input),
    ),
  getById: (input) => Effect.map(store.findById(input.id), (row) => (row === null ? null : toRuntimeActivityEntity(row))),
});

/** Persisted docker runtime activities; a constant that reads the store from the Effect context when it runs. */
export class DockerRuntimeActivities extends Context.Service<
  DockerRuntimeActivities,
  Over<DockerRuntimeActivitiesShape, DockerRuntimeActivitiesStore>
>()("runtime/DockerRuntimeActivities") {
  static readonly live = serviceOver(Effect.all({ store: DockerRuntimeActivitiesStore }), makeDockerRuntimeActivities);
}
