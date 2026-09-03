import { BadRequestException } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GithubSourceProviderService } from './github-source-provider.service';

describe('GithubSourceProviderService', () => {
  const gitService = {
    validateRepository: vi.fn(),
  };

  let service: GithubSourceProviderService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new GithubSourceProviderService(gitService as never);
  });

  it('returns null for non-github source type', async () => {
    const result = await service.resolveSourceCheckout({
      sourceType: 'upload',
      sourceConfig: {},
    } as never);

    expect(result).toBeNull();
    expect(gitService.validateRepository).not.toHaveBeenCalled();
  });

  it('throws when repositoryUrl is missing', async () => {
    await expect(
      service.resolveSourceCheckout({
        sourceType: 'github',
        sourceConfig: { branch: 'main' },
      } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('uses branch from pullRequestNumber when branch is omitted', async () => {
    gitService.validateRepository.mockResolvedValue(true);

    const result = await service.resolveSourceCheckout({
      sourceType: 'github',
      sourceConfig: {
        repositoryUrl: 'https://github.com/acme/repo',
        pullRequestNumber: 42,
      },
    } as never);

    expect(result).toEqual({
      provider: 'github',
      repositoryUrl: 'https://github.com/acme/repo',
      branch: 'refs/pull/42/head',
      pullRequestNumber: 42,
    });
  });

  it('prefers explicit branch over pullRequestNumber fallback', async () => {
    gitService.validateRepository.mockResolvedValue(true);

    const result = await service.resolveSourceCheckout({
      sourceType: 'github',
      sourceConfig: {
        repositoryUrl: 'https://github.com/acme/repo',
        branch: 'feature/x',
        pullRequestNumber: 42,
      },
    } as never);

    expect(result).toEqual({
      provider: 'github',
      repositoryUrl: 'https://github.com/acme/repo',
      branch: 'feature/x',
      pullRequestNumber: 42,
    });
  });

  it('throws when repository is not accessible', async () => {
    gitService.validateRepository.mockResolvedValue(false);

    await expect(
      service.resolveSourceCheckout({
        sourceType: 'github',
        sourceConfig: {
          repositoryUrl: 'https://github.com/acme/private',
        },
      } as never),
    ).rejects.toThrow(BadRequestException);
  });
});
