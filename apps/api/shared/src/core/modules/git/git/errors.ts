import { domainError } from "@deployer/effect-core";

/** A repository URL or a branch/tag/commit is not one `git` may be given (it could become an option or an unsupported remote). */
export class GitInputInvalid extends domainError("GitInputInvalid", "validation")<{
  readonly field: "repositoryUrl" | "branch" | "commit" | "ref";
  readonly reason: string;
}>() {
  override publicMessage() { return `Invalid ${this.field}: ${this.reason}`; }
}

/** A `git` command failed (network, auth, unknown ref); the cause stays server-side. */
export class GitCommandFailure extends domainError("GitCommandFailure", "dependency_missing")<{
  readonly operation: string;
}>() {
  override publicMessage() { return `Git ${this.operation} failed`; }
}

/** The repository has no commit to describe. */
export class GitNoCommits extends domainError("GitNoCommits", "not_found")() {
  override publicMessage() { return "No commits found in repository"; }
}

/** An uploaded archive is hostile or malformed (zip-slip, symlinks, too large, unsupported): the uploader's fault. */
export class ArchiveRejected extends domainError("ArchiveRejected", "validation")<{ readonly reason: string }>() {
  override publicMessage() { return this.reason; }
}

/** Extracting an archive failed for a reason that is not the upload's (our filesystem, a defect). */
export class ArchiveExtractionFailure extends domainError("ArchiveExtractionFailure", "dependency_missing")<{
  readonly reason: string;
}>() {
  override publicMessage() { return `Failed to extract archive: ${this.reason}`; }
}
