import type { AnySchema } from "@orpc/contract";
import type { JsonSchema, JsonSchemaConverter } from "@orpc/json-schema";
import { isObservableSchema, observableItemJsonSchema } from "../../contracts/observable";

/**
 * Teaches the OpenAPI generator how to describe an `observable(...)` output.
 * SSE has no first-class OpenAPI shape, so it is documented as an array of the
 * item schema.
 */
export class ObservableJsonSchemaConverter implements JsonSchemaConverter {
  condition(schema: AnySchema | undefined): boolean {
    return isObservableSchema(schema);
  }

  convert(schema: AnySchema | undefined): [JsonSchema, boolean] {
    if (!isObservableSchema(schema)) {
      throw new TypeError("ObservableJsonSchemaConverter received a non-observable schema");
    }

    return [{ type: "array", items: observableItemJsonSchema(schema) }, false];
  }
}
