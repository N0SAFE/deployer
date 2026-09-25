import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import {
  serviceQueryStreamContract,
  serviceStreamEventTypeSchema,
  serviceStreamEventSchema,
  serviceStreamQueryFiltersSchema,
  type ServiceStreamEvent,
  type ServiceStreamQueryInput,
} from "./query";

export const serviceStreamsContract = oc.meta(openapi({ tags: ["Service Streams"] })).router({
  query: serviceQueryStreamContract,
});

export {
  serviceQueryStreamContract,
  serviceStreamEventTypeSchema,
  serviceStreamEventSchema,
  serviceStreamQueryFiltersSchema,
};

export type {
  ServiceStreamEvent,
  ServiceStreamQueryInput,
};