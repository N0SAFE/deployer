import type { Schema } from "@orpc/contract";
import type { JsonSchema } from "@orpc/json-schema";
import { concatMap, from, isObservable, mergeMap, of, throwError, type Observable } from "rxjs";
import { z } from "zod";

const OBSERVABLE_SCHEMA = Symbol.for("orpc-nest-showcase/observable");

interface ObservableSchemaMeta {
  readonly item: z.ZodType;
  readonly jsonSchema: JsonSchema;
}

/**
 * Contract-level schema for an RxJS stream.
 *
 * Types both sides as `Observable<T>`:
 * - handler must return an `Observable<T>` (Effect service does),
 * - client receives an `Observable<T>` (link interceptor guarantees it).
 *
 * The wire format stays SSE; `RxJSHandlerPlugin` converts the Observable to an
 * `AsyncIteratorObject` right before encoding, and the client interceptor
 * converts the decoded iterator back to an Observable.
 */
export interface ObservableSchema<T> extends Schema<Observable<T>, Observable<T>> {
  readonly [OBSERVABLE_SCHEMA]: ObservableSchemaMeta;
}

export function observable<T>(item: z.ZodType<T>): ObservableSchema<T> {
  return {
    [OBSERVABLE_SCHEMA]: {
      item,
      jsonSchema: z.toJSONSchema(item, { io: "output" }) as unknown as JsonSchema,
    },
    "~standard": {
      version: 1,
      vendor: "orpc-nest-showcase",
      validate: (value) => {
        if (!isObservable(value)) {
          return { issues: [{ message: "Expected an RxJS Observable" }] };
        }

        // Validate every emission against the item schema; the wrapped
        // Observable fails the stream on the first invalid event instead of
        // letting it reach the client untyped.
        const validated = (value as Observable<unknown>).pipe(
          concatMap((event) =>
            from(Promise.resolve(item["~standard"].validate(event))).pipe(
              mergeMap((result) => {
                if ("issues" in result && result.issues !== undefined) {
                  const message = result.issues.map((issue) => issue.message).join("; ");
                  return throwError(() => new Error(`Invalid stream event: ${message}`));
                }

                return of(result.value as T);
              }),
            ),
          ),
        );

        return { value: validated };
      },
    },
  } as ObservableSchema<T>;
}

export function isObservableSchema(schema: unknown): schema is ObservableSchema<unknown> {
  return typeof schema === "object" && schema !== null && OBSERVABLE_SCHEMA in schema;
}

export function observableItemJsonSchema(schema: ObservableSchema<unknown>): JsonSchema {
  return schema[OBSERVABLE_SCHEMA].jsonSchema;
}
