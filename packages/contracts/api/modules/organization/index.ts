import { oc } from "@orpc/contract";
import { organizationAdminContract } from "./admin";

export const organizationContract = oc.tag("Organization").prefix("/organization").router({
	admin: organizationAdminContract,
});

export { organizationAdminContract } from "./admin";

export { organizationListAllContract, organizationListAllConfigSchemas } from "./listAll";
export type { OrganizationListAllInput } from "./listAll";

export { organizationListMembersContract } from "./listMembers";
export type { OrganizationListMembersInput } from "./listMembers";
