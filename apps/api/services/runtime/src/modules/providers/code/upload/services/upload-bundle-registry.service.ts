import { Context, Effect } from 'effect'

export type UploadBundleRecord = {
    uploadId: string
    uploadPath: string
    fileName: string
    fileSize: number
    mimeType: string
    uploadedAt: string
}

export type UploadBundleRegistryShape = {
    readonly register: (
        record: Omit<UploadBundleRecord, 'uploadedAt'> & { uploadedAt?: string }
    ) => Effect.Effect<UploadBundleRecord>
    readonly findByUploadId: (
        uploadId: string
    ) => Effect.Effect<UploadBundleRecord | null>
}

export class UploadBundleRegistry extends Context.Service<
    UploadBundleRegistry,
    UploadBundleRegistryShape
>()('runtime/UploadBundleRegistry') {}

/** In-memory registry; the map lives in the closure, so a module provides one instance with `useFactory`. */
export function makeUploadBundleRegistry(): UploadBundleRegistryShape {
    const recordsByUploadId = new Map<string, UploadBundleRecord>()
    return {
        register: (record) =>
            Effect.sync(() => {
                const nextRecord: UploadBundleRecord = {
                    ...record,
                    uploadedAt: record.uploadedAt ?? new Date().toISOString(),
                }
                recordsByUploadId.set(nextRecord.uploadId, nextRecord)
                return nextRecord
            }),
        findByUploadId: (uploadId) =>
            Effect.sync(() => recordsByUploadId.get(uploadId) ?? null),
    }
}
