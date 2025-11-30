export default () =>
  ({
    MAX_FILE_SIZE: 100 * 1024 * 1024, // 100MB
    ALLOWED_MIME_TYPES: [
      "application/zip",
      "application/x-zip-compressed",
      "application/x-tar",
      "application/gzip",
      "application/x-gzip",
      "application/x-compressed-tar",
    ],
  });
