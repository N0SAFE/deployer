import z from "zod/v4";

import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";

import { replicaSchema } from "./replica";

export const meshSnapshotOutput = z.object({ replicas: z.array(replicaSchema) });

const meshSnapshotOps = standard.zod(replicaSchema, "meshSnapshot");

export const meshSnapshotContract = meshSnapshotOps
  .list()
  .path("/snapshot")
  .input(z.object({}))
  .output(meshSnapshotOutput)
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();
