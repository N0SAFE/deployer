import { oc } from "@orpc/contract";
import { dockerEntityListContract } from "./list";
import { dockerEntityInspectContract } from "./inspect";
import { dockerEntityStreamContract } from "./stream";

/**
 * Unified docker entity API. Same shape for every kind (container, image,
 * network, volume). Use this for live in-memory stores on the web — each
 * event from `stream` carries the full entity payload (with relations) so
 * the client can patch in one shot.
 */
export const dockerEntityContract = oc.tag("Docker Entity").router({
  list: dockerEntityListContract,
  inspect: dockerEntityInspectContract,
  stream: dockerEntityStreamContract,
});

export {
  dockerEntityListContract,
  dockerEntityInspectContract,
  dockerEntityStreamContract,
};

export {
  dockerEntityListInputSchema,
  dockerEntityInspectInputSchema,
  dockerEntityStreamInputSchema,
} from "./shared";

export type {
  DockerEntityListInput,
  DockerEntityInspectInput,
  DockerEntityStreamInput,
} from "./shared";
