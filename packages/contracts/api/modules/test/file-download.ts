import z from "zod/v4";
import { standard } from "@repo/orpc-utils";

const testFileDownloadOps = standard.zod(z.object({ file: z.file() }), "testFileDownload");

/**
 * Test contract for file download
 * This contract demonstrates how to return files using z.file()
 */
export const testFileDownloadContract = testFileDownloadOps
  .list()
  .path("/file-download")
  .input((b) =>
    b.query(
      z.object({
        fileName: z.string().default("test.txt"),
        content: z.string().default("Hello World"),
      }),
    ),
  )
  .output(
    z.object({
      file: z.file(),
    })
  )
  .build();

// Define types based on schemas
export type TestFileDownloadInput = {
  fileName?: string;
  content?: string;
};

export type TestFileDownloadOutput = {
  file: File;
};
