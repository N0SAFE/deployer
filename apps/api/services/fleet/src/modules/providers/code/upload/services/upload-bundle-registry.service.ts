import { Context, Effect } from "effect";

export type UploadBundleRecord = {
    uploadId: string;
    uploadPath: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    uploadedAt: string;
}

/** The uploaded bundles this process knows of, by upload id. In memory: a restart forgets them. */
export class UploadBundleRegistryServiceImpl {
    private readonly recordsByUploadId = new Map<string, UploadBundleRecord>();

    register(record: Omit<UploadBundleRecord, "uploadedAt"> & { uploadedAt?: string }) {
        return Effect.sync((): UploadBundleRecord => {
            const nextRecord: UploadBundleRecord = {
                ...record,
                uploadedAt: record.uploadedAt ?? new Date().toISOString(),
            };
            this.recordsByUploadId.set(nextRecord.uploadId, nextRecord);
            return nextRecord;
        });
    }

    findByUploadId(uploadId: string) {
        return Effect.sync((): UploadBundleRecord | null => this.recordsByUploadId.get(uploadId) ?? null);
    }
}

/** The registry's public surface is exactly the implementation's methods. */
export type UploadBundleRegistryServiceShape = UploadBundleRegistryServiceImpl;

/** Effect key = NestJS token. */
export class UploadBundleRegistryService extends Context.Service<UploadBundleRegistryService, UploadBundleRegistryServiceShape>()(
    "fleet/UploadBundleRegistryService",
) {
    /** One registry for the process: the bundles it holds are the state shared by every call. */
    static readonly live: UploadBundleRegistryServiceShape = new UploadBundleRegistryServiceImpl();
}
