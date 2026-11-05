import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { UploadBundleRegistryServiceImpl } from './upload-bundle-registry.service'

describe('UploadBundleRegistryService', () => {
    const record = {
        uploadId: 'u1',
        uploadPath: '/tmp/u1.zip',
        fileName: 'u1.zip',
        fileSize: 10,
        mimeType: 'application/zip',
    }

    it('remembers a registered bundle by its upload id, stamping when it was uploaded', async () => {
        const registry = new UploadBundleRegistryServiceImpl()

        const registered = await Effect.runPromise(registry.register(record))

        expect(Date.parse(registered.uploadedAt)).not.toBeNaN()
        expect(await Effect.runPromise(registry.findByUploadId('u1'))).toEqual(
            registered
        )
    })

    it('keeps an upload date it is given', async () => {
        const registry = new UploadBundleRegistryServiceImpl()

        const registered = await Effect.runPromise(
            registry.register({
                ...record,
                uploadedAt: '2024-01-01T00:00:00.000Z',
            })
        )

        expect(registered.uploadedAt).toBe('2024-01-01T00:00:00.000Z')
    })

    it('answers null for a bundle it does not know', async () => {
        expect(
            await Effect.runPromise(
                new UploadBundleRegistryServiceImpl().findByUploadId('nope')
            )
        ).toBeNull()
    })
})
