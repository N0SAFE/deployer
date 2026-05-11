import { oc } from "@orpc/contract";
import { organizationListAllContract } from "../listAll";
import { organizationListMembersContract } from "../listMembers";

export const organizationAdminContract = oc.tag("Admin").prefix("/admin").router({
  listAll: organizationListAllContract,
  listMembers: organizationListMembersContract,
});

export { organizationListAllContract, organizationListMembersContract };
