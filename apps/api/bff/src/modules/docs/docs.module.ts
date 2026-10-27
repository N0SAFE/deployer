import { Module } from "@nestjs/common";

import { OpenApiDocsController } from "./openapi-docs.controller";

/**
 * Serves this API's OpenAPI document and a page that lists it.
 *
 * No providers: the controller generates the spec from `appContract` on first
 * request and caches it, so there is nothing to inject. It is its own module
 * (rather than being added to `BffModule`'s `controllers`) because a root module
 * that also declares controllers becomes a second place to look for what this
 * app serves — see the note in `bff.module.ts`.
 */
@Module({
	controllers: [OpenApiDocsController],
})
export class DocsModule {}
