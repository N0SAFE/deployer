import { describe, expect, it } from "vitest";

import {
	buildCanonicalImageIdentifier,
	buildImageInspectCandidates,
	buildImageInspectCandidatesFromImageList,
	identifiersMatch,
	normalizeImageIdentifier,
	toStringArray,
} from "./docker-image-reference";

describe("image references", () => {
	it("looks an image up by id with and without the sha256 prefix", () => {
		expect(buildImageInspectCandidates("sha256:abc")).toEqual(["sha256:abc", "abc"]);
		expect(buildImageInspectCandidates("abc")).toEqual(["abc", "sha256:abc"]);
		expect(buildImageInspectCandidates("  ")).toEqual([]);
	});

	it("compares ids ignoring case, the sha256 prefix and truncation", () => {
		expect(normalizeImageIdentifier(" SHA256:ABC ")).toBe("abc");
		expect(identifiersMatch("sha256:abcdef0123", "ABCDEF")).toBe(true);
		expect(identifiersMatch("abc", "abd")).toBe(false);
		expect(identifiersMatch("", "abc")).toBe(false);
		expect(identifiersMatch(null, undefined)).toBe(false);
	});

	it("keeps only real strings from the engine's loose arrays", () => {
		expect(toStringArray(["a", "", 1 as never, "b"])).toEqual(["a", "b"]);
		expect(toStringArray("solo")).toEqual(["solo"]);
		expect(toStringArray(undefined)).toEqual([]);
	});

	it("builds a canonical identifier from the digest, or falls back to the normalized id", () => {
		expect(buildCanonicalImageIdentifier({ registry: "GHCR.io", repository: "Acme/Web", digest: "sha256:ABCDEF", fallbackId: "sha256:id1" })).toBe("ghcr.io/acme/web@abcdef");
		expect(buildCanonicalImageIdentifier({ registry: "ghcr.io", repository: "acme/web", digest: null, fallbackId: "sha256:ID1" })).toBe("id1");
	});

	it("finds the candidate references of an image in the engine's list", () => {
		const candidates = buildImageInspectCandidatesFromImageList("sha256:abc", [
			{ Id: "sha256:abc", RepoTags: ["acme/web:1", "<none>:<none>"], RepoDigests: ["acme/web@sha256:feed"] },
			{ Id: "sha256:other", RepoTags: ["nginx:latest"] },
		] as never);
		expect(candidates).toContain("acme/web:1");
		expect(candidates).not.toContain("nginx:latest");
	});
});
