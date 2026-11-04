import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeCustomSourceProvider } from '../custom/services/custom-source-provider.service';
import { makeUploadBundleRegistry } from '../upload/services/upload-bundle-registry.service';

import { makeCodeProviderRegistry } from './code-provider-registry.service';

describe('makeCodeProviderRegistry', () => {
  const registry = makeCodeProviderRegistry([makeCustomSourceProvider()]);

  it('lists the registered types and finds a provider case-insensitively', async () => {
    expect(await Effect.runPromise(registry.listProviderTypes())).toEqual(['custom']);
    expect(await Effect.runPromise(registry.getProvider('CUSTOM'))).not.toBeNull();
    expect(await Effect.runPromise(registry.getProvider('nope'))).toBeNull();
  });

  it('resolves null for an unsupported source type', async () => {
    const result = await Effect.runPromise(
      registry.resolveSourceCheckout({ source: { sourceType: 'gitlab' } } as never),
    );
    expect(result).toBeNull();
  });

  it('dispatches to the provider of the source type', async () => {
    const result = await Effect.runPromise(
      registry.resolveSourceCheckout({
        source: { sourceType: 'custom', customData: { containerImage: 'img:1' } },
      } as never),
    );
    expect(result).toMatchObject({ provider: 'custom', containerImage: 'img:1' });
  });
});

describe('makeUploadBundleRegistry', () => {
  it('registers a record and finds it by id', async () => {
    const bundles = makeUploadBundleRegistry();
    const record = await Effect.runPromise(
      bundles.register({ uploadId: 'u1', uploadPath: '/p', fileName: 'f.zip', fileSize: 1, mimeType: 'application/zip' }),
    );
    expect(record.uploadedAt).toBeTypeOf('string');
    expect(await Effect.runPromise(bundles.findByUploadId('u1'))).toEqual(record);
    expect(await Effect.runPromise(bundles.findByUploadId('u2'))).toBeNull();
  });
});
