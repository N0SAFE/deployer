# Import Analyzer Plugin System Implementation

## Overview

The import analyzer now includes a complete plugin system for framework-specific import resolution. This allows the tool to intelligently analyze dependencies based on the framework being used (NestJS, Next.js, or standard TypeScript).

## Architecture

### Core Components

1. **Plugin Interface** (`lib/types.ts`)
   - `shouldHandle(filePath)`: Determines if the plugin should handle a file
   - `extractImports(filePath)`: Extracts imports from a file
   - `resolveImport(context)`: Resolves import paths
   - `transformImportInfo(info)`: Adds metadata to import information
   - `shouldTraverse(filePath, depth)`: Controls traversal depth

2. **Modular Library**
   - `lib/types.ts`: Core type definitions and plugin interface
   - `lib/tsconfig-resolver.ts`: TypeScript configuration handling
   - `lib/file-resolver.ts`: File path resolution with extension inference
   - `lib/import-extractor.ts`: Plugin-aware import extraction

3. **Framework Plugins**
   - `plugins/nestjs.ts`: NestJS module-aware import resolution
   - `plugins/nextjs.ts`: Next.js page/layout-aware resolution

### Plugin Execution Flow

```
┌─────────────────────────────────────┐
│    User runs analyze-imports.ts    │
│    with --plugin flag               │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│    getPlugins() loads plugin        │
│    based on --plugin value          │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│    analyzeImports() processes       │
│    file with BFS traversal          │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│    For each import:                 │
│    1. extractImports(file, plugins) │
│    2. resolveImportPath(context,    │
│       plugins)                      │
│    3. transformImportInfo(info,     │
│       plugins)                      │
└─────────────────────────────────────┘
```

## NestJS Plugin

### Features

- **Module Detection**: Identifies `.module.ts` files
- **@Module Parsing**: Extracts imports from `@Module` decorator
- **Module-Only Mode**: Can limit traversal to module files only
- **Metadata Addition**: Tags files as 'nestjs-module'

### Example Usage

```bash
# Analyze NestJS application
bun run analyze-imports.ts --file apps/api/src/app.module.ts --plugin nestjs --depth 2
```

### How It Works

1. Detects files ending with `.module.ts`
2. Uses regex to extract `@Module({ imports: [...] })` decorator
3. Maps module class names to their import paths
4. Resolves module dependencies
5. Optionally stops traversal at module boundaries (modules-only mode)

### Output Example

```
=== Import Dependency Analysis ===
File: apps/api/src/app.module.ts
Plugin: nestjs (nestjs)

📘 apps/api/src/app.module.ts
    📘 apps/api/src/core/modules/auth/auth.module.ts
    📘 apps/api/src/modules/features.module.ts
    📘 apps/api/src/modules/bootstrap/bootstrap.module.ts
```

## Next.js Plugin

### Features

- **Router Detection**: Identifies App Router and Pages Router
- **Special Files**: Detects page.tsx, layout.tsx, loading.tsx, error.tsx, etc.
- **Route Extraction**: Derives route paths from file structure
- **Sibling Detection**: Finds related route files in same directory
- **Component Fallback**: Falls back to TypeScript resolver for non-route files

### Example Usage

```bash
# Analyze Next.js application
bun run analyze-imports.ts --file apps/web/src/app/layout.tsx --plugin nextjs --depth 2
```

### How It Works

1. Walks up directory tree to find `app/` or `pages/` directory
2. Identifies special Next.js files (page, layout, loading, error, etc.)
3. Extracts route path from file structure
4. Detects sibling route files in same directory
5. For non-route files, falls back to standard TypeScript resolution
6. Adds metadata with router type and route information

### Output Example

```
=== Import Dependency Analysis ===
File: apps/web/src/app/layout.tsx
Plugin: nextjs (nextjs)

⚛️ apps/web/src/app/layout.tsx
    ⚛️ apps/web/src/app/setup/page.tsx
    ⚛️ apps/web/src/app/profile/layout.tsx
    ⚛️ apps/web/src/app/profile/page.tsx
    ⚛️ apps/web/src/app/dashboard/layout.tsx
```

## Auto-Detection

The `--plugin auto` flag automatically selects the appropriate plugin based on file path:

```typescript
if (options.plugin === 'auto') {
  // Auto-detect based on file path
  if (options.file.includes('/apps/api/') || options.file.includes('nestjs')) {
    plugins.push(nestjsPlugin);
  } else if (options.file.includes('/apps/web/') || options.file.includes('next')) {
    plugins.push(nextjsPlugin);
  }
}
```

### Example Usage

```bash
# Auto-detect plugin
bun run analyze-imports.ts --file apps/api/src/main.ts --plugin auto
```

## CLI Options

### Plugin-Related Flags

- `-p, --plugin <type>`: Specify plugin (none|nestjs|nextjs|auto)
- Default: `none` (standard TypeScript resolution)

### Complete Command Examples

```bash
# Standard TypeScript resolution (no plugin)
bun run analyze-imports.ts --file apps/api/src/main.ts

# NestJS module-aware analysis
bun run analyze-imports.ts --file apps/api/src/app.module.ts --plugin nestjs

# Next.js route-aware analysis  
bun run analyze-imports.ts --file apps/web/src/app/layout.tsx --plugin nextjs

# Auto-detect framework
bun run analyze-imports.ts --file apps/api/src/main.ts --plugin auto

# With depth limit and verbose output
bun run analyze-imports.ts --file apps/api/src/app.module.ts --plugin nestjs --depth 2 --verbose

# Generate Mermaid diagram
bun run analyze-imports.ts --file apps/web/src/app/layout.tsx --plugin nextjs --diagram
```

## Creating Custom Plugins

### Plugin Interface

```typescript
import type { Plugin, ResolverContext, ImportInfo } from './lib/types';

export const myPlugin: Plugin = {
  name: 'my-plugin',
  
  shouldHandle: (filePath: string): boolean => {
    // Determine if plugin should handle this file
    return filePath.endsWith('.my-ext');
  },
  
  extractImports: (filePath: string): string[] | null => {
    // Extract imports from file
    // Return null to fall back to default
    return ['./import1', './import2'];
  },
  
  resolveImport: (context: ResolverContext): string | null => {
    // Resolve import path
    // Return null to fall back to default
    const { importPath, currentFilePath, tsConfig, projectRoot } = context;
    return '/absolute/path/to/import';
  },
  
  transformImportInfo: (info: ImportInfo): ImportInfo => {
    // Add metadata to import information
    return {
      ...info,
      metadata: {
        ...info.metadata,
        type: 'my-plugin-type',
      },
    };
  },
  
  shouldTraverse: (filePath: string, depth: number): boolean => {
    // Control traversal
    return depth < 3;
  },
};
```

### Factory Pattern

```typescript
export const createMyPlugin = (options?: {
  // Custom options
  maxDepth?: number;
  patterns?: RegExp[];
}): Plugin => {
  return {
    ...myPlugin,
    name: 'my-plugin-custom',
    shouldTraverse: (filePath, depth) => {
      return depth < (options?.maxDepth ?? 3);
    },
  };
};
```

## Testing

### NestJS Plugin Test

```bash
# Test with app.module.ts
cd /home/sebille/Bureau/projects/tests/deployer
bun run packages/bin/scripts/analyze-imports.ts --file apps/api/src/app.module.ts --plugin nestjs --depth 2

# Expected output:
# - Detects .module.ts files
# - Extracts @Module imports
# - Shows module dependencies
```

### Next.js Plugin Test

```bash
# Test with layout.tsx
cd /home/sebille/Bureau/projects/tests/deployer
bun run packages/bin/scripts/analyze-imports.ts --file apps/web/src/app/layout.tsx --plugin nextjs --depth 2

# Expected output:
# - Detects App Router structure
# - Finds sibling page/layout files
# - Shows route hierarchy
```

### Auto-Detection Test

```bash
# Test auto-detection with API file
bun run packages/bin/scripts/analyze-imports.ts --file apps/api/src/main.ts --plugin auto --depth 1

# Expected output:
# - Automatically detects /apps/api/ path
# - Loads NestJS plugin
```

## Implementation Summary

### Files Modified

1. **analyze-imports.ts**
   - Added `getPlugins()` function for plugin loading
   - Updated CLI parser to support `--plugin` flag
   - Modified `analyzeImports()` to accept plugins parameter
   - Created wrappers for plugin-aware functions
   - Enhanced help text with plugin documentation

2. **lib/types.ts** (Created)
   - Plugin interface definition
   - Core type definitions (ImportInfo, TSConfig, ResolverContext)
   - AnalyzerOptions type

3. **lib/tsconfig-resolver.ts** (Created)
   - `findTsConfig()`: Locate and parse tsconfig.json
   - `resolvePathAlias()`: Resolve TypeScript path aliases

4. **lib/file-resolver.ts** (Created)
   - `resolveWithExtensions()`: Try multiple file extensions
   - SUPPORTED_EXTENSIONS constant

5. **lib/import-extractor.ts** (Created)
   - `extractImportsDefault()`: Default AST-based import extraction
   - `resolveImportPath()`: Plugin-aware path resolution
   - `extractImports()`: Plugin-aware extraction wrapper
   - `shouldTraverse()`: Plugin-aware traversal control
   - `transformImportInfo()`: Plugin transformation wrapper

6. **plugins/nestjs.ts** (Created)
   - NestJS module detection and parsing
   - @Module decorator extraction
   - Module-only traversal mode
   - Factory function with options

7. **plugins/nextjs.ts** (Created)
   - Next.js router detection (app/pages)
   - Special file detection
   - Route path extraction
   - Sibling file detection
   - Factory function with options

### Key Design Decisions

1. **Plugin-First Architecture**: All plugin hooks are tried first, with fallback to default behavior
2. **Modular Design**: Core functionality split into focused modules
3. **Interface-Based Plugins**: All plugins implement the same interface for consistency
4. **Factory Pattern**: Plugins support customization via factory functions
5. **Metadata Enrichment**: Plugins can add framework-specific metadata to ImportInfo
6. **Backwards Compatibility**: Wrapper functions maintain backwards compatibility

### Statistics

- **Total Lines**: ~1000 lines across all new files
- **Core Library**: 4 modules (~400 lines)
- **Plugins**: 2 framework plugins (~400 lines)
- **Main Script**: Refactored to ~500 lines (from 633)
- **Tests**: Successfully tested with NestJS and Next.js projects

## Future Enhancements

### Planned Features

1. **Executable Wrappers**
   - `analyze-imports-nestjs.ts`: Pre-configured with NestJS plugin
   - `analyze-imports-nextjs.ts`: Pre-configured with Next.js plugin
   - Add bin entries to package.json

2. **Enhanced Tree Display**
   - Show plugin metadata in tree view (e.g., "[NestJS Module]", "[Next.js Page]")
   - Different node styles in Mermaid for different file types

3. **Additional Plugins**
   - Express.js plugin for route detection
   - React plugin for component dependencies
   - Vue.js plugin for component resolution
   - Angular plugin for module dependencies

4. **Plugin Composition**
   - Allow multiple plugins to run simultaneously
   - Plugin priority system
   - Plugin chaining and composition

5. **Configuration File**
   - `.import-analyzer.json` for project-specific settings
   - Plugin configuration persistence
   - Custom plugin registration

## Conclusion

The plugin system implementation is complete and working successfully. The modular architecture allows for easy extension with new framework-specific plugins while maintaining backwards compatibility with standard TypeScript import resolution.

Key achievements:
- ✅ Modular plugin architecture
- ✅ NestJS module-aware resolution
- ✅ Next.js route-aware resolution
- ✅ Auto-detection based on file path
- ✅ Full backwards compatibility
- ✅ Comprehensive CLI options
- ✅ Successfully tested with real projects
