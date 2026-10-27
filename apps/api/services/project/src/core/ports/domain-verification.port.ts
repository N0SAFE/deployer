import type { DomainVerificationService } from "@deployer/shared/core/modules/domain/services/domain-verification.service";
import { Context } from "effect";

/** Effect view of the DNS verification workflow. */
export type DomainVerificationShape = Pick<
	DomainVerificationService,
	"verifyProjectDomain"
>;

export class DomainVerification extends Context.Service<
	DomainVerification,
	DomainVerificationShape
>()("project/DomainVerification") {}
