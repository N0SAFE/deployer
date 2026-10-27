import { generateOpenApiSpec } from "../src/orpc/openapi";

/** Writes the API's OpenAPI document to stdout: `bun run openapi:generate > openapi.json`. */
const spec = await generateOpenApiSpec();
process.stdout.write(`${JSON.stringify(spec, null, 2)}\n`);
