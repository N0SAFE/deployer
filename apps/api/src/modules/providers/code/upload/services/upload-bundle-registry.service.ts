import { Injectable } from "@nestjs/common";

export interface UploadBundleRecord {
    uploadId: string;
    uploadPath: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    uploadedAt: string;
}

@Injectable()
export class UploadBundleRegistryService {
    private readonly recordsByUploadId = new Map<string, UploadBundleRecord>();

    register(record: Omit<UploadBundleRecord, "uploadedAt"> & { uploadedAt?: string }): UploadBundleRecord {
        const nextRecord: UploadBundleRecord = {
            ...record,
            uploadedAt: record.uploadedAt ?? new Date().toISOString(),
        };
        this.recordsByUploadId.set(nextRecord.uploadId, nextRecord);
        return nextRecord;
    }

    findByUploadId(uploadId: string): UploadBundleRecord | null {
        return this.recordsByUploadId.get(uploadId) ?? null;
    }
}