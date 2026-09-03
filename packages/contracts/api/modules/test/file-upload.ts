import z from "zod/v4";
import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";

const testFileUploadOps = standard.zod(
  z.object({
    success: z.boolean(),
    fileName: z.string(),
    fileSize: z.number(),
    mimeType: z.string(),
    message: z.string().optional(),
  }),
  "testFileUpload",
);

/**
 * Test contract for file upload
 * This contract demonstrates how to accept file uploads using z.file()
 */
export const testFileUploadContract = testFileUploadOps
  .create()
  .path("/file-upload")
  .input((b) =>
    b.body(
      z.object({
        file: z.file(),
        name: z.string().optional(),
        description: z.string().optional(),
      }),
    ),
  )
  .output(
    z.object({
      success: z.boolean(),
      fileName: z.string(),
      fileSize: z.number(),
      mimeType: z.string(),
      message: z.string().optional(),
    })
  )
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();

// Define types based on schemas
export type TestFileUploadInput = {
  file: File;
  name?: string;
  description?: string;
};

export type TestFileUploadOutput = {
  success: boolean;
  fileName: string;
  fileSize: number;
  mimeType: string;
  message?: string;
};
