import { Controller, Get } from "@nestjs/common";
import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod";
import { contract } from "../../contracts";
import { ObservableJsonSchemaConverter } from "./observable-json-schema.converter";

@Controller()
export class DocsController {
  private readonly generator = new OpenAPIGenerator({
    converters: [new ObservableJsonSchemaConverter(), new ZodToJsonSchemaConverter()],
  });

  /** Same contract, generated as OpenAPI 3.2 — no duplicate route definitions. */
  @Get("/openapi.json")
  document() {
    return this.generator.generate(contract, {
      base: { info: { title: "oRPC + NestJS showcase", version: "1.0.0" } },
    });
  }
}
