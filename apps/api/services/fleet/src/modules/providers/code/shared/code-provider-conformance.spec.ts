import { provideTo } from "@deployer/effect-core";
import { Cause, Effect, Exit } from "effect";
import { describe, it, expect, vi } from 'vitest';

import { FleetInvalid } from "@/core/fleet.errors";
import { Git, type GitShape } from "@/core/ports/git.port";
import { UploadSourceProviderService, type UploadSourceProviderServiceShape } from '../upload/services/upload-source-provider.service';
import { UploadBundleRegistryService, type UploadBundleRegistryServiceShape } from '../upload/services/upload-bundle-registry.service';
import { CustomSourceProviderService, type CustomSourceProviderServiceShape } from '../custom/services/custom-source-provider.service';
import { GithubSourceProviderService, type GithubSourceProviderServiceShape } from '../github/services/github-source-provider.service';
import { GitlabSourceProviderService, type GitlabSourceProviderServiceShape } from '../gitlab/services/gitlab-source-provider.service';
import { CodeProviderRegistryService } from './code-provider-registry.service';

/** Run an Effect and reject with the ORIGINAL failure, so `rejects.toBeInstanceOf(...)` reads the real error. */
async function run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;
  throw Cause.squash(exit.cause);
}

/** Every provider answered over fakes of what it reads from the context. */
function setup(overrides: { findByUploadId?: ReturnType<typeof vi.fn>; validateRepository?: ReturnType<typeof vi.fn> } = {}) {
  const bundles = {
    findByUploadId:
      overrides.findByUploadId ??
      vi.fn(() =>
        Effect.succeed({
          uploadId: 'upload-1',
          uploadPath: '/tmp/uploads/upload-1-bundle.zip',
          fileName: 'bundle.zip',
          fileSize: 123,
          mimeType: 'application/zip',
          uploadedAt: '2024-01-01T00:00:00.000Z',
        }),
      ),
  };
  const git = { validateRepository: overrides.validateRepository ?? vi.fn().mockResolvedValue(true) };
  // The fakes need nothing from the context beyond what is provided here.
  const ports = (effect: Effect.Effect<unknown, unknown, unknown>) =>
    effect.pipe(
      Effect.provideService(UploadBundleRegistryService, bundles as unknown as UploadBundleRegistryServiceShape),
      Effect.provideService(Git, git as unknown as GitShape),
    ) as Effect.Effect<unknown>;

  const upload = provideTo(UploadSourceProviderService.live, ports);
  const custom = provideTo(CustomSourceProviderService.live, ports);
  const github = provideTo(GithubSourceProviderService.live, ports);
  const gitlab = provideTo(GitlabSourceProviderService.live, ports);
  const registry = provideTo(CodeProviderRegistryService.live, (effect) =>
    effect.pipe(
      Effect.provideService(GithubSourceProviderService, github as unknown as GithubSourceProviderServiceShape),
      Effect.provideService(GitlabSourceProviderService, gitlab as unknown as GitlabSourceProviderServiceShape),
      Effect.provideService(UploadSourceProviderService, upload as unknown as UploadSourceProviderServiceShape),
      Effect.provideService(CustomSourceProviderService, custom as unknown as CustomSourceProviderServiceShape),
    ) as Effect.Effect<unknown>,
  );
  return { bundles, git, upload, custom, github, gitlab, registry };
}

describe('Source provider conformance', () => {
  it('upload provider emits dockerfile runtime context with image when provided', async () => {
    const { upload } = setup();

    const result = await run(upload.resolveSourceCheckout({
      source: {
        sourceType: 'upload',
        uploadId: 'upload-1',
        fileName: 'bundle.zip',
        fileSize: 123,
        customData: {
          uploadId: 'upload-1',
          runtimeRunner: 'dockerfile',
          containerImage: 'registry.local/upload:latest',
          containerName: 'upload-ctr-1',
        },
      },
    } as never));

    expect(result).toMatchObject({
      provider: 'upload',
      uploadPath: '/tmp/uploads/upload-1-bundle.zip',
      runtimeRunner: 'dockerfile',
      containerImage: 'registry.local/upload:latest',
      containerName: 'upload-ctr-1',
    });
  });

  it('upload provider refuses a bundle neither declared nor registered', async () => {
    const { upload } = setup({ findByUploadId: vi.fn(() => Effect.succeed(null)) });

    await expect(
      run(upload.resolveSourceCheckout({
        source: { sourceType: 'upload', uploadId: 'upload-x', customData: { uploadId: 'upload-x' } },
      } as never)),
    ).rejects.toBeInstanceOf(FleetInvalid);
  });

  it('custom provider emits dockerfile runtime context with required image', async () => {
    const { custom } = setup();

    const result = await run(custom.resolveSourceCheckout({
      source: {
        sourceType: 'custom',
        customData: {
          runtimeRunner: 'dockerfile',
          containerImage: 'registry.local/custom:latest',
          containerName: 'custom-ctr-1',
        },
      },
    } as never));

    expect(result).toMatchObject({
      provider: 'custom',
      runtimeRunner: 'dockerfile',
      containerImage: 'registry.local/custom:latest',
      containerName: 'custom-ctr-1',
    });
  });

  it('custom provider refuses a source with no container image', async () => {
    const { custom } = setup();

    await expect(
      run(custom.resolveSourceCheckout({ source: { sourceType: 'custom', customData: {} } } as never)),
    ).rejects.toBeInstanceOf(FleetInvalid);
  });

  it('github provider supports PR context fallback branch', async () => {
    const { github, git } = setup();

    const result = await run(github.resolveSourceCheckout({
      source: {
        sourceType: 'github',
        repositoryUrl: 'https://github.com/acme/repo',
        pullRequestNumber: 7,
      },
    } as never));

    expect(git.validateRepository).toHaveBeenCalledWith('https://github.com/acme/repo');
    expect(result).toMatchObject({
      provider: 'github',
      repositoryUrl: 'https://github.com/acme/repo',
      branch: 'refs/pull/7/head',
      pullRequestNumber: 7,
    });
  });

  it('github provider refuses a repository that is not accessible', async () => {
    const { github } = setup({ validateRepository: vi.fn().mockResolvedValue(false) });

    await expect(
      run(github.resolveSourceCheckout({
        source: { sourceType: 'github', repositoryUrl: 'https://github.com/acme/private' },
      } as never)),
    ).rejects.toBeInstanceOf(FleetInvalid);
  });

  it('gitlab provider targets the merge request ref', async () => {
    const { gitlab } = setup();

    const result = await run(gitlab.resolveSourceCheckout({
      source: { sourceType: 'gitlab', repositoryUrl: 'https://gitlab.com/acme/repo', mergeRequestIid: 3 },
    } as never));

    expect(result).toMatchObject({ provider: 'gitlab', branch: 'refs/merge-requests/3/head', mergeRequestIid: 3 });
  });

  it('a provider answers null for a source type that is not its own', async () => {
    const { github } = setup();

    expect(await run(github.resolveSourceCheckout({ source: { sourceType: 'custom', customData: {} } } as never))).toBeNull();
  });

  describe('registry', () => {
    it('lists the registered source types', async () => {
      const { registry } = setup();
      expect(await run(registry.listProviderTypes())).toEqual(['github', 'gitlab', 'upload', 'custom']);
    });

    it('dispatches by source type', async () => {
      const { registry } = setup();

      const result = await run(registry.resolveSourceCheckout({
        source: { sourceType: 'custom', customData: { containerImage: 'registry.local/custom:latest' } },
      } as never));

      expect(result).toMatchObject({ provider: 'custom', containerImage: 'registry.local/custom:latest' });
    });

    it('answers null for an unsupported source type', async () => {
      const { registry } = setup();
      expect(await run(registry.resolveSourceCheckout({ source: { sourceType: 'docker-hub' } } as never))).toBeNull();
    });
  });
});
