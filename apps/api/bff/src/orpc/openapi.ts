import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod";

import { appContract } from "./app-contract";

/**
 * The OpenAPI document of the composed API.
 *
 * One function for both consumers: the live `/openapi.json` endpoint and the offline
 * `openapi:generate` script (CI, SDK generation), so a spec written to a file cannot differ
 * from the one the running BFF serves. It is built from `appContract`, so it describes only
 * what this process mounts.
 */
export function generateOpenApiSpec(): Promise<unknown> {
	return new OpenAPIGenerator({
		converters: [new ZodToJsonSchemaConverter()],
	}).generate(appContract, {
		base: {
			info: { title: "Deployer API", version: "1.0.0" },
			servers: [{ url: "/" }],
		},
	});
}
