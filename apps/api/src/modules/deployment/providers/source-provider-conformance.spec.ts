import { describe, it, expect, vi } from 'vitest';
import { UploadSourceProviderService } from './upload/upload-source-provider.service';
import { CustomSourceProviderService } from './custom/custom-source-provider.service';
import { GithubSourceProviderService } from './github/github-source-provider.service';

describe('Source provider conformance', () => {
  it('upload provider emits dockerfile runtime context with image when provided', async () => {
    const uploadBundleRegistryService = {
      findByUploadId: vi.fn().mockReturnValue({
        uploadId: 'upload-1',
        uploadPath: '/tmp/uploads/upload-1-bundle.zip',
        fileName: 'bundle.zip',
        fileSize: 123,
        mimeType: 'application/zip',
        uploadedAt: '2024-01-01T00:00:00.000Z',
      }),
    };
    const upload = new UploadSourceProviderService(uploadBundleRegistryService as never);

    const result = await upload.resolveSourceCheckout({
      sourceType: 'upload',
      sourceConfig: {
        fileName: 'bundle.zip',
        fileSize: 123,
        customData: {
          uploadId: 'upload-1',
          runtimeRunner: 'dockerfile',
          containerImage: 'registry.local/upload:latest',
          containerName: 'upload-ctr-1',
        },
      },
    } as never);

    expect(result).toMatchObject({
      provider: 'upload',
      uploadPath: '/tmp/uploads/upload-1-bundle.zip',
      runtimeRunner: 'dockerfile',
      containerImage: 'registry.local/upload:latest',
      containerName: 'upload-ctr-1',
    });
  });

  it('custom provider emits dockerfile runtime context with required image', async () => {
    const custom = new CustomSourceProviderService();

    const result = await custom.resolveSourceCheckout({
      sourceType: 'custom',
      sourceConfig: {
        customData: {
          runtimeRunner: 'dockerfile',
          containerImage: 'registry.local/custom:latest',
          containerName: 'custom-ctr-1',
        },
      },
    } as never);

    expect(result).toMatchObject({
      provider: 'custom',
      runtimeRunner: 'dockerfile',
      containerImage: 'registry.local/custom:latest',
      containerName: 'custom-ctr-1',
    });
  });

  it('github provider supports PR context fallback branch', async () => {
    const gitService = { validateRepository: vi.fn().mockResolvedValue(true) };
    const github = new GithubSourceProviderService(gitService as never);

    const result = await github.resolveSourceCheckout({
      sourceType: 'github',
      sourceConfig: {
        repositoryUrl: 'https://github.com/acme/repo',
        pullRequestNumber: 7,
      },
    } as never);

    expect(result).toMatchObject({
      provider: 'github',
      repositoryUrl: 'https://github.com/acme/repo',
      branch: 'refs/pull/7/head',
      pullRequestNumber: 7,
    });
  });
});
