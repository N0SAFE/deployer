import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod";
import { appContract } from "@/core/orpc/app-contract";

export function generateSpec() {
    const generator = new OpenAPIGenerator({
        converters: [new ZodToJsonSchemaConverter()],
    });

    return generator.generate(appContract, {
        // v2 moved the document fields under `base`; `commonSchemas` was
        // removed (reusable schemas are hoisted from the schema library's own
        // metadata instead), so it is no longer passed here.
        base: {
            info: {
                title: "API",
                version: "1.0.0",
            },
            servers: [{ url: "/" }],
        },
    });
}
