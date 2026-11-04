import { randomBytes } from "crypto";
import * as dns from "dns/promises";

import { Context, Effect } from "effect";

import type { ServiceLifecycleShape } from "@deployer/nest-effect";

import { ProjectDomainNotFoundError, VerificationAttemptError, type DomainStorageFailure } from "../errors";

import type { VerificationInstructions, VerifyDomainResult } from "../interfaces";
import type { ProjectDomainRepositoryShape } from "../repositories/project-domain.repository";

const AUTO_VERIFICATION_INTERVAL = "1 hour";

export type DomainVerificationServiceShape = ServiceLifecycleShape & {
  /** `deployer-verify-{random}-{domain}`: the domain is in the token so a token cannot be reused for another one. Pure. */
  readonly generateVerificationToken: (registeredDomain: string) => string;
  /** The DNS record the owner must add. Pure. */
  readonly getVerificationInstructions: (
    domain: string,
    token: string,
    method: "txt_record" | "cname_record",
  ) => VerificationInstructions;
  /** Check the domain's DNS record and record the outcome. A missing or wrong record is `success: false`, not a failure. */
  readonly verifyProjectDomain: (
    projectId: string,
    domainId: string,
  ) => Effect.Effect<VerifyDomainResult, ProjectDomainNotFoundError | VerificationAttemptError | DomainStorageFailure>;
  readonly getPendingDomainsCount: (projectId: string) => Effect.Effect<number, DomainStorageFailure>;
  /** Reset to pending, then verify again. */
  readonly retryVerification: (
    projectId: string,
    domainId: string,
  ) => Effect.Effect<VerifyDomainResult, ProjectDomainNotFoundError | VerificationAttemptError | DomainStorageFailure>;
  /** One sweep over every pending domain. Never fails: a domain that errors is logged and skipped. */
  readonly autoVerifyPendingDomains: () => Effect.Effect<void>;
  /** The hourly sweep. Never completes; `serviceLifecycle` forks it and interrupts it on stop. */
  readonly run: () => Effect.Effect<void>;
};

const generateVerificationToken = (registeredDomain: string): string =>
  `deployer-verify-${randomBytes(16).toString("hex")}-${registeredDomain}`;

/**
 * Get DNS verification instructions for a domain
 */
function getVerificationInstructions(
  domain: string,
  token: string,
  method: 'txt_record' | 'cname_record'
): VerificationInstructions {
  const recordName = `_deployer-verify.${domain}`;

  if (method === 'txt_record') {
    return {
      method: 'txt_record',
      recordName,
      recordValue: token,
      instructions: `
Add the following TXT record to your DNS configuration:

Record Type: TXT
Name: ${recordName}
Value: ${token}
TTL: 3600 (or minimum allowed)

The verification will be checked automatically within an hour, or you can trigger manual verification.
      `.trim(),
    };
  } else {
    return {
      method: 'cname_record',
      recordName,
      recordValue: `verify-${token}.deployer.io`,
      instructions: `
Add the following CNAME record to your DNS configuration:

Record Type: CNAME
Name: ${recordName}
Value: verify-${token}.deployer.io
TTL: 3600 (or minimum allowed)

The verification will be checked automatically within an hour, or you can trigger manual verification.
      `.trim(),
    };
  }
}

/** A DNS record that is absent or unreadable is "not verified", never a failure. */
const lookupMatches = (what: string, lookup: () => Promise<boolean>): Effect.Effect<boolean> =>
  Effect.tryPromise(lookup).pipe(
    Effect.catch((error) => Effect.logDebug(`${what} lookup failed: ${String(error.cause)}`).pipe(Effect.as(false))),
  );

const verifyTxtRecord = (recordName: string, expectedToken: string) =>
  lookupMatches(`TXT ${recordName}`, async () => {
    const records = await dns.resolveTxt(recordName);
    // TXT records are returned as arrays of strings
    return records.some((record) => record.join("") === expectedToken);
  });

const verifyCnameRecord = (recordName: string, expectedToken: string) =>
  lookupMatches(`CNAME ${recordName}`, async () => {
    const records = await dns.resolveCname(recordName);
    return records.includes(`verify-${expectedToken}.deployer.io`);
  });

/** Stateful (it owns the hourly sweep), so it is built once over a repository whose requirements are already settled. */
export function makeDomainVerificationService(projectDomains: ProjectDomainRepositoryShape): DomainVerificationServiceShape {
  const verifyProjectDomain: DomainVerificationServiceShape["verifyProjectDomain"] = (projectId, domainId) =>
    Effect.gen(function* () {
      const projectDomain = yield* projectDomains.findById(domainId);
      if (projectDomain?.projectId !== projectId) {
        return yield* new ProjectDomainNotFoundError({ identifier: domainId });
      }
      if (projectDomain.verificationStatus === "verified" && projectDomain.verifiedAt) {
        return {
          success: true,
          status: "verified",
          message: "Domain is already verified",
          verifiedAt: projectDomain.verifiedAt,
        } satisfies VerifyDomainResult;
      }

      const recordName = `_deployer-verify.${projectDomain.domain}`;
      const verified =
        projectDomain.verificationMethod === "txt_record"
          ? yield* verifyTxtRecord(recordName, projectDomain.verificationToken)
          : yield* verifyCnameRecord(recordName, projectDomain.verificationToken);

      const now = new Date();
      // Recording the outcome is the only step that can fail here: it is the attempt that failed.
      const record = (patch: Parameters<typeof projectDomains.update>[1]) =>
        projectDomains.update(domainId, { ...patch, dnsRecordChecked: true, lastVerificationAttempt: now, updatedAt: now }).pipe(
          Effect.mapError((error) => new VerificationAttemptError({ domainId, reason: error.message, cause: error })),
        );

      if (verified) {
        yield* record({ verificationStatus: "verified", verifiedAt: now });
        yield* Effect.logInfo(`Domain verified successfully: ${projectDomain.domain}`);
        return { success: true, status: "verified", message: "Domain verified successfully", verifiedAt: now } satisfies VerifyDomainResult;
      }

      yield* record({ verificationStatus: "failed" });
      return {
        success: false,
        status: "failed",
        message: "DNS record not found or token mismatch",
        error: {
          code: "DNS_VERIFICATION_FAILED",
          details: "Please check your DNS configuration and try again. DNS changes can take up to 48 hours to propagate.",
        },
      } satisfies VerifyDomainResult;
    });

  const autoVerifyPendingDomains = (): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* Effect.logInfo("Running auto-verification for pending domains...");
      const pending = yield* projectDomains.findPending();
      yield* Effect.logInfo(`Found ${String(pending.length)} pending domains to verify`);
      yield* Effect.forEach(pending, (domain) =>
        verifyProjectDomain(domain.projectId, domain.id).pipe(
          Effect.tap((result) =>
            result.success
              ? Effect.logInfo(`Auto-verified domain: ${domain.domain}`)
              : Effect.logDebug(`Auto-verification failed for ${domain.domain}: ${result.message}`),
          ),
          Effect.catch((error) => Effect.logError(`Auto-verification error for domain ${domain.domain}: ${error.message}`)),
        ),
      );
      yield* Effect.logInfo("Auto-verification completed");
    }).pipe(Effect.catch((error) => Effect.logError(`Auto-verification job failed: ${error.message}`)));

  return {
    generateVerificationToken,
    getVerificationInstructions,
    verifyProjectDomain,
    getPendingDomainsCount: (projectId) =>
      projectDomains.findByProjectId(projectId).pipe(Effect.map((domains) => domains.filter((d) => d.verificationStatus === "pending").length)),
    retryVerification: (projectId, domainId) =>
      projectDomains.update(domainId, { verificationStatus: "pending", updatedAt: new Date() }).pipe(
        Effect.flatMap(() => verifyProjectDomain(projectId, domainId)),
      ),
    autoVerifyPendingDomains,
    // First sweep after one interval, like the timer this replaces, so a boot does not hit DNS for every pending domain.
    run: () => Effect.forever(Effect.andThen(Effect.sleep(AUTO_VERIFICATION_INTERVAL), autoVerifyPendingDomains())),
  };
}

export class DomainVerificationService extends Context.Service<DomainVerificationService, DomainVerificationServiceShape>()(
  "shared/DomainVerificationService",
) {}
