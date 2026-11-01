import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import { z } from "zod";

import { replicaSchema } from "../../mesh/contracts/mesh.contract";

/** A second domain reading the mesh's directory: the export path, exercised. */
export const consumerContract = {
	directory: oc
		.meta(
			openapi({
				method: "GET",
				path: "/consumer/directory",
				summary: "Read the directory from a module that only imports it",
			}),
		)
		.output(z.object({ replicas: z.array(replicaSchema) })),
};
