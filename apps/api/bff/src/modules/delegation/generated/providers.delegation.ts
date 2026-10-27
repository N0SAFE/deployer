/**
 * GENERATED — the `providers` surface, delegated to `fleet`.
 *
 * Every method here is a CALL ON A TYPED CLIENT, not a relayed request: the input the
 * handler receives is the one the contract declares, and the client accepts exactly that
 * type. The BFF is a CLIENT of the service — which is what lets the orchestrators call
 * several and join the answers, and what the removed proxy middleware could not do,
 * because it relayed bytes it never parsed.
 *
 * ── WHY THERE IS NO `requireAuth()` HERE ────────────────────────────────────
 * Authorization is a property of the PROCEDURE, and the service enforces it on the leg it
 * receives (it applies `requireAuth()`, `requireMesh()` and role gates to the procedures
 * that need them). Re-applying a blanket session requirement at the BFF would BREAK the
 * procedures that are legitimately public — the health probes, the mesh endpoints, the
 * setup surface — and would put one policy in two places, where the copy that drifts is
 * the one nobody reads. The caller's credentials still travel (see `service-auth-context`),
 * so the service decides with the real session in hand.
 *
 * ── WHY THE CLIENT BINDS THE NAMESPACE CONTRACT ─────────────────────────────
 * `clients.for(service, <namespaceContract>)` — not the service's combined contract. The
 * combined one puts `list`/`findById`/`create`/`update`/`delete` on two namespaces at once
 * (project and service both declare them), so its client omits those from the root type and
 * `this.client.list(...)` would not compile. Binding the namespace keeps every call
 * unambiguous by construction, with no aliasing rules to remember.
 *
 * Regenerate with `scripts/gen-bff-delegation.py`; do not hand-edit.
 */

import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";

import { providersContract } from "@deployer/fleet-contracts";

import { ServiceClientRegistry } from "../../../clients/service-registry";

@Controller()
export class ProvidersDelegationController {
	constructor(private readonly clients: ServiceClientRegistry) {}

	/** The typed client for the NAMESPACE this controller serves. */
	private get client() {
		return this.clients.for("fleet", providersContract);
	}

	@Implement(providersContract.code.github.list)
	code_github_list() {
		return implement(providersContract.code.github.list).handler(({ input }) => this.client.code.github.list(input));
	}

	@Implement(providersContract.code.github.create)
	code_github_create() {
		return implement(providersContract.code.github.create).handler(({ input }) => this.client.code.github.create(input));
	}

	@Implement(providersContract.code.github.update)
	code_github_update() {
		return implement(providersContract.code.github.update).handler(({ input }) => this.client.code.github.update(input));
	}

	@Implement(providersContract.code.github.delete)
	code_github_delete() {
		return implement(providersContract.code.github.delete).handler(({ input }) => this.client.code.github.delete(input));
	}

	@Implement(providersContract.code.github.oauthInit)
	code_github_oauthInit() {
		return implement(providersContract.code.github.oauthInit).handler(({ input }) => this.client.code.github.oauthInit(input));
	}

	@Implement(providersContract.code.github.oauthCallback)
	code_github_oauthCallback() {
		return implement(providersContract.code.github.oauthCallback).handler(({ input }) => this.client.code.github.oauthCallback(input));
	}

	@Implement(providersContract.code.github.listRepos)
	code_github_listRepos() {
		return implement(providersContract.code.github.listRepos).handler(({ input }) => this.client.code.github.listRepos(input));
	}

	@Implement(providersContract.code.github.listBranches)
	code_github_listBranches() {
		return implement(providersContract.code.github.listBranches).handler(({ input }) => this.client.code.github.listBranches(input));
	}

	@Implement(providersContract.code.github.detectRunner)
	code_github_detectRunner() {
		return implement(providersContract.code.github.detectRunner).handler(({ input }) => this.client.code.github.detectRunner(input));
	}

	@Implement(providersContract.code.github.installCallback)
	code_github_installCallback() {
		return implement(providersContract.code.github.installCallback).handler(({ input }) => this.client.code.github.installCallback(input));
	}

	@Implement(providersContract.code.github.selfCheck)
	code_github_selfCheck() {
		return implement(providersContract.code.github.selfCheck).handler(({ input }) => this.client.code.github.selfCheck(input));
	}

	@Implement(providersContract.code.github.manifestInit)
	code_github_manifestInit() {
		return implement(providersContract.code.github.manifestInit).handler(({ input }) => this.client.code.github.manifestInit(input));
	}

	@Implement(providersContract.code.github.manifestCallback)
	code_github_manifestCallback() {
		return implement(providersContract.code.github.manifestCallback).handler(({ input }) => this.client.code.github.manifestCallback(input));
	}

	@Implement(providersContract.code.github.createFromPat)
	code_github_createFromPat() {
		return implement(providersContract.code.github.createFromPat).handler(({ input }) => this.client.code.github.createFromPat(input));
	}

	@Implement(providersContract.code.github.webhook)
	code_github_webhook() {
		return implement(providersContract.code.github.webhook).handler(({ input }) => this.client.code.github.webhook(input));
	}

	@Implement(providersContract.code.gitlab.list)
	code_gitlab_list() {
		return implement(providersContract.code.gitlab.list).handler(({ input }) => this.client.code.gitlab.list(input));
	}

	@Implement(providersContract.code.gitlab.create)
	code_gitlab_create() {
		return implement(providersContract.code.gitlab.create).handler(({ input }) => this.client.code.gitlab.create(input));
	}

	@Implement(providersContract.code.gitlab.delete)
	code_gitlab_delete() {
		return implement(providersContract.code.gitlab.delete).handler(({ input }) => this.client.code.gitlab.delete(input));
	}

	@Implement(providersContract.dns.list)
	dns_list() {
		return implement(providersContract.dns.list).handler(({ input }) => this.client.dns.list(input));
	}

	@Implement(providersContract.dns.create)
	dns_create() {
		return implement(providersContract.dns.create).handler(({ input }) => this.client.dns.create(input));
	}

	@Implement(providersContract.dns.update)
	dns_update() {
		return implement(providersContract.dns.update).handler(({ input }) => this.client.dns.update(input));
	}

	@Implement(providersContract.dns.delete)
	dns_delete() {
		return implement(providersContract.dns.delete).handler(({ input }) => this.client.dns.delete(input));
	}

	@Implement(providersContract.dns.checkState)
	dns_checkState() {
		return implement(providersContract.dns.checkState).handler(({ input }) => this.client.dns.checkState(input));
	}

	@Implement(providersContract.dns.cloudflare.listZones)
	dns_cloudflare_listZones() {
		return implement(providersContract.dns.cloudflare.listZones).handler(({ input }) => this.client.dns.cloudflare.listZones(input));
	}

	@Implement(providersContract.dns.cloudflare.listRecords)
	dns_cloudflare_listRecords() {
		return implement(providersContract.dns.cloudflare.listRecords).handler(({ input }) => this.client.dns.cloudflare.listRecords(input));
	}

	@Implement(providersContract.dns.cloudflare.checkRecord)
	dns_cloudflare_checkRecord() {
		return implement(providersContract.dns.cloudflare.checkRecord).handler(({ input }) => this.client.dns.cloudflare.checkRecord(input));
	}

	@Implement(providersContract.dns.cloudflare.createRecord)
	dns_cloudflare_createRecord() {
		return implement(providersContract.dns.cloudflare.createRecord).handler(({ input }) => this.client.dns.cloudflare.createRecord(input));
	}

	@Implement(providersContract.dns.cloudflare.deleteRecord)
	dns_cloudflare_deleteRecord() {
		return implement(providersContract.dns.cloudflare.deleteRecord).handler(({ input }) => this.client.dns.cloudflare.deleteRecord(input));
	}

	@Implement(providersContract.dns.cloudflare.listTunnels)
	dns_cloudflare_listTunnels() {
		return implement(providersContract.dns.cloudflare.listTunnels).handler(({ input }) => this.client.dns.cloudflare.listTunnels(input));
	}

	@Implement(providersContract.dns.cloudflare.getTunnel)
	dns_cloudflare_getTunnel() {
		return implement(providersContract.dns.cloudflare.getTunnel).handler(({ input }) => this.client.dns.cloudflare.getTunnel(input));
	}

	@Implement(providersContract.dns.cloudflare.createTunnel)
	dns_cloudflare_createTunnel() {
		return implement(providersContract.dns.cloudflare.createTunnel).handler(({ input }) => this.client.dns.cloudflare.createTunnel(input));
	}

	@Implement(providersContract.dns.cloudflare.deleteTunnel)
	dns_cloudflare_deleteTunnel() {
		return implement(providersContract.dns.cloudflare.deleteTunnel).handler(({ input }) => this.client.dns.cloudflare.deleteTunnel(input));
	}

	@Implement(providersContract.dns.cloudflare.getTunnelToken)
	dns_cloudflare_getTunnelToken() {
		return implement(providersContract.dns.cloudflare.getTunnelToken).handler(({ input }) => this.client.dns.cloudflare.getTunnelToken(input));
	}
}
