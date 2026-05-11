import { oc } from "@orpc/contract";
import {
  serviceQueryStreamContract,
  serviceStreamEventTypeSchema,
  serviceStreamEventSchema,
  serviceStreamQueryFiltersSchema,
  type ServiceStreamEvent,
  type ServiceStreamQueryInput,
} from "./query";

export const serviceStreamsContract = oc.tag("Service Streams").router({
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