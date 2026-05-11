import { oc } from "@orpc/contract";
import { fleetContract } from "../fleet";

export const coreContract = oc.tag("Core").prefix("/core").router({
  fleet: fleetContract,
});

export { fleetContract };
