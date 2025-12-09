# Storage Module

> **Module Type**: CORE Infrastructure Module  
> **Priority**: MEDIUM (Infrastructure Layer)  
> **Last Updated**: 2025-11-30

## Overview

The Storage module provides core storage infrastructure services for file operations and uploads.

## ✅ Architecture Status

This module has a **CLEAN architecture**:
- No explicit imports (uses global services)
- Simple service composition
- Clear responsibility boundaries

## Services Provided

| Service | Description |
|---------|-------------|
| `StorageService` | File storage operations (read, write, delete) |
| `FileUploadService` | File upload handling and processing |

## Module Dependencies

```
CoreStorageModule
└── (No explicit imports - uses global services)
```

## Quick Start

```typescript
import { StorageService } from '@/core/modules/storage/services/storage.service';

@Injectable()
export class MyService {
  constructor(private readonly storageService: StorageService) {}

  async saveFile(content: string, path: string) {
    await this.storageService.writeFile(path, content);
  }
}
```

## Service Responsibilities

### StorageService

File system operations:
- Read files from storage
- Write files to storage
- Delete files
- Directory operations

### FileUploadService

Upload handling:
- Process uploaded files
- Validate file types
- Handle multipart uploads
- Create deployment from uploads

## Notes

**StaticFileServingService** has been moved to `StaticProviderModule` as part of the providers consolidation.

## Documentation Index

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System architecture |
