#!/usr/bin/env bun

import { existsSync, readFileSync, statSync } from 'fs';
import { resolve, dirname, extname, relative, join, isAbsolute, sep } from 'path';
import type { Plugin, ImportInfo, TSConfig } from './lib/types';
import { findTsConfig, findTsConfigPath, resolvePathAlias } from './lib/tsconfig-resolver';
import { resolveWithExtensions, SUPPORTED_EXTENSIONS } from './lib/file-resolver';
import {
  extractImports as extractImportsWithPlugins,
  resolveImportPath as resolveImportPathWithPlugins,
  shouldTraverse as shouldTraverseWithPlugins,
  transformImportInfo as transformImportInfoWithPlugins,
} from './lib/import-extractor';
import nestjsPlugin from './plugins/nestjs';
import nextjsPlugin from './plugins/nextjs';

interface Options {
  file: string;
  depth: number;
  verbose?: boolean;
  help?: boolean;
  diagram?: boolean;
  plugin?: 'none' | 'nestjs' | 'nextjs' | 'auto';
}

const PROJECT_ROOT = resolve(__dirname, '../../..');

/**
 * Get plugins based on options
 */
const getPlugins = (options: Options): Plugin[] => {
  const plugins: Plugin[] = [];
  
  if (options.plugin === 'nestjs') {
    plugins.push(nestjsPlugin);
  } else if (options.plugin === 'nextjs') {
    plugins.push(nextjsPlugin);
  } else if (options.plugin === 'auto') {
    // Auto-detect based on file path
    if (options.file.includes('/apps/api/') || options.file.includes('nestjs')) {
      plugins.push(nestjsPlugin);
    } else if (options.file.includes('/apps/web/') || options.file.includes('next')) {
      plugins.push(nextjsPlugin);
    }
  }
  
  return plugins;
};

// Wrapper to maintain backwards compatibility
const resolveImportPath = (
  importPath: string,
  currentFilePath: string,
  tsConfig: TSConfig | null,
  plugins: Plugin[] = []
): string | null => {
  return resolveImportPathWithPlugins(
    importPath,
    currentFilePath,
    tsConfig,
    PROJECT_ROOT,
    plugins
  );
};

// Wrapper to maintain backwards compatibility
const extractImports = (filePath: string, plugins: Plugin[] = []): string[] => {
  return extractImportsWithPlugins(filePath, plugins);
};

// Analyze imports using breadth-first traversal with plugin support
const analyzeImports = (
  filePath: string,
  maxDepth: number,
  tsConfig: TSConfig | null,
  plugins: Plugin[] = []
): Map<string, ImportInfo> => {
  const result = new Map<string, ImportInfo>();
  const queue: { path: string; depth: number }[] = [{ path: filePath, depth: 0 }];
  const visited = new Set<string>();
  
  while (queue.length > 0) {
    const { path, depth } = queue.shift()!;
    
    if (visited.has(path) || depth > maxDepth) continue;
    
    // Check if plugins want to skip traversal
    if (!shouldTraverseWithPlugins(path, depth, plugins)) {
      continue;
    }
    
    visited.add(path);
    
    const imports = extractImports(path, plugins);
    const resolvedImports: string[] = [];
    
    for (const imp of imports) {
      const resolved = resolveImportPath(imp, path, tsConfig, plugins);
      if (resolved) {
        resolvedImports.push(resolved);
        
        // Add to queue for further analysis
        if (depth < maxDepth && shouldTraverseWithPlugins(resolved, depth + 1, plugins)) {
          queue.push({ path: resolved, depth: depth + 1 });
        }
      }
    }
    
    let info: ImportInfo = {
      path,
      displayPath: relative(PROJECT_ROOT, path),
      exists: existsSync(path),
      imports: resolvedImports,
      isExternal: false,
    };
    
    // Apply plugin transformations
    info = transformImportInfoWithPlugins(info, plugins);
    
    result.set(path, info);
  }
  
  return result;
};

// Print import tree using breadth-first display order
const printTree = (
  startFile: string,
  importMap: Map<string, ImportInfo>,
  maxDepth: number,
  verbose: boolean = false
): void => {
  const queue: { path: string; depth: number; parentIndent: string }[] = [
    { path: startFile, depth: 0, parentIndent: '' }
  ];
  const visited = new Set<string>();
  
  // Group by depth for breadth-first display
  const depthLevels: Array<Array<{ path: string; indent: string }>> = [];
  
  while (queue.length > 0) {
    const { path, depth, parentIndent } = queue.shift()!;
    
    if (visited.has(path)) continue;
    visited.add(path);
    
    // Ensure depth level exists
    while (depthLevels.length <= depth) {
      depthLevels.push([]);
    }
    
    const indent = depth === 0 ? '' : parentIndent + '  ';
    depthLevels[depth].push({ path, indent });
    
    const info = importMap.get(path);
    if (!info || depth >= maxDepth) continue;
    
    // Queue children for next level
    for (const imp of info.imports) {
      if (!visited.has(imp)) {
        const childIndent = depth === 0 ? '  ' : indent + '  ';
        queue.push({ path: imp, depth: depth + 1, parentIndent: childIndent });
      }
    }
  }
  
  // Display level by level (breadth-first)
  const alreadyShown = new Set<string>();
  
  for (let level = 0; level < depthLevels.length; level++) {
    const nodes = depthLevels[level];
    
    for (const { path, indent } of nodes) {
      const info = importMap.get(path);
      if (!info) continue;
      
      if (alreadyShown.has(path)) {
        console.log(`${indent}\x1b[33m↻ ${info.displayPath} (already visited)\x1b[0m`);
        continue;
      }
      
      alreadyShown.add(path);
      
      // Determine file type icon
      const ext = extname(path);
      let icon = '📄';
      if (['.tsx', '.jsx'].includes(ext)) icon = '⚛️';
      else if (['.ts', '.mts', '.cts'].includes(ext)) icon = '📘';
      else if (['.js', '.mjs', '.cjs'].includes(ext)) icon = '📗';
      
      // Print current file
      console.log(`${indent}\x1b[34m${icon} ${info.displayPath}\x1b[0m`);
      
      if (info.imports.length === 0) {
        continue;
      }
      
      if (verbose) {
        console.log(`${indent}  \x1b[32m→ ${info.imports.length} import(s)\x1b[0m`);
      }
      
      // Show imports
      if (level < maxDepth || verbose) {
        for (const imp of info.imports) {
          const impInfo = importMap.get(imp);
          if (!impInfo) {
            if (existsSync(imp)) {
              if (verbose) {
                const rel = relative(PROJECT_ROOT, imp);
                console.log(`${indent}    \x1b[90m○ ${rel} (outside depth)\x1b[0m`);
              }
            } else {
              const rel = relative(PROJECT_ROOT, imp);
              console.log(`${indent}    \x1b[31m✗ ${rel} (not found)\x1b[0m`);
            }
          } else if (alreadyShown.has(imp)) {
            console.log(`${indent}    \x1b[33m↻ ${impInfo.displayPath} (already visited)\x1b[0m`);
          } else {
            const impExt = extname(imp);
            let impIcon = '📄';
            if (['.tsx', '.jsx'].includes(impExt)) impIcon = '⚛️';
            else if (['.ts', '.mts', '.cts'].includes(impExt)) impIcon = '📘';
            else if (['.js', '.mjs', '.cjs'].includes(impExt)) impIcon = '📗';
            
            console.log(`${indent}    \x1b[36m${impIcon} ${impInfo.displayPath}\x1b[0m`);
          }
        }
      }
    }
  }
};

// Generate Mermaid diagram
const generateMermaidDiagram = (
  startFile: string,
  importMap: Map<string, ImportInfo>,
  maxDepth: number
): void => {
  console.log('```mermaid');
  console.log('graph TD');
  
  const queue: { path: string; depth: number }[] = [{ path: startFile, depth: 0 }];
  const visited = new Set<string>();
  const nodeIds = new Map<string, string>();
  let nodeCounter = 0;
  
  // Generate node IDs
  const getNodeId = (path: string): string => {
    if (!nodeIds.has(path)) {
      nodeIds.set(path, `N${nodeCounter++}`);
    }
    return nodeIds.get(path)!;
  };
  
  // Collect all nodes and edges level by level
  const edges: string[] = [];
  
  while (queue.length > 0) {
    const { path, depth } = queue.shift()!;
    
    if (visited.has(path)) continue;
    visited.add(path);
    
    const info = importMap.get(path);
    if (!info) continue;
    
    const nodeId = getNodeId(path);
    const displayName = info.displayPath.replace(/"/g, '\\"');
    
    // Add node definition
    const ext = extname(path);
    let shape = '[]'; // default rectangle
    if (['.tsx', '.jsx'].includes(ext)) shape = `[${displayName}]`; // rectangle
    else if (['.ts', '.mts', '.cts'].includes(ext)) shape = `(${displayName})`; // rounded
    else if (['.js', '.mjs', '.cjs'].includes(ext)) shape = `([${displayName}])`; // stadium
    
    console.log(`  ${nodeId}${shape}`);
    
    if (depth >= maxDepth) continue;
    
    // Add edges
    for (const imp of info.imports) {
      const impInfo = importMap.get(imp);
      if (impInfo) {
        const impNodeId = getNodeId(imp);
        edges.push(`  ${nodeId} --> ${impNodeId}`);
        
        if (!visited.has(imp) && depth < maxDepth) {
          queue.push({ path: imp, depth: depth + 1 });
        }
      }
    }
  }
  
  // Output edges
  edges.forEach(edge => console.log(edge));
  
  console.log('```');
};

// Calculate statistics
const getStatistics = (importMap: Map<string, ImportInfo>): {
  totalFiles: number;
  totalImports: number;
  missingImports: number;
} => {
  let totalFiles = 0;
  let totalImports = 0;
  let missingImports = 0;
  
  importMap.forEach((info) => {
    totalFiles++;
    totalImports += info.imports.length;
    
    for (const imp of info.imports) {
      if (!importMap.has(imp) && !existsSync(imp)) {
        missingImports++;
      }
    }
  });
  
  return { totalFiles, totalImports, missingImports };
};

// Parse command line arguments
const parseArgs = (args: string[]): Options => {
  const options: Options = {
    file: '',
    depth: Infinity,
    verbose: false,
    diagram: false,
    plugin: 'none',
  };
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--file':
        options.file = args[++i];
        break;
      case '--depth':
        options.depth = parseInt(args[++i], 10);
        break;
      case '-v':
      case '--verbose':
        options.verbose = true;
        break;
      case '-d':
      case '--diagram':
        options.diagram = true;
        break;
      case '-p':
      case '--plugin':
        options.plugin = args[++i] as Options['plugin'];
        break;
      case '-h':
      case '--help':
        options.help = true;
        break;
    }
  }
  
  return options;
};

// Show help
const showHelp = () => {
  console.log(`
Usage: bun run analyze-imports.ts --file <path> [options]

Analyze JavaScript/TypeScript imports and their dependencies.

Options:
  --file <path>        Path to the file to analyze (required)
  --depth <number>     Recursion depth for following imports (default: unlimited)
  -p, --plugin <type>  Use framework-specific plugin (none|nestjs|nextjs|auto)
  -d, --diagram        Generate Mermaid diagram instead of tree
  -v, --verbose        Show detailed information (import counts, etc.)
  -h, --help          Show this help message

Supported file types:
  - TypeScript: .ts, .tsx, .mts, .cts
  - JavaScript: .js, .jsx, .mjs, .cjs

Plugins:
  none     - Standard TypeScript import resolution (default)
  nestjs   - NestJS module-aware resolution (follows @Module imports)
  nextjs   - Next.js route-aware resolution (detects pages/layouts)
  auto     - Auto-detect plugin based on file path

Features:
  - Resolves TypeScript path aliases from tsconfig.json
  - Detects ES6 imports, dynamic imports, and CommonJS require
  - Excludes external packages (node_modules)
  - Breadth-first traversal for dependency analysis
  - Framework-specific import resolution via plugins

Examples:
  # Analyze single file
  bun run analyze-imports.ts --file apps/web/src/app/page.tsx

  # Follow imports 3 levels deep
  bun run analyze-imports.ts --file apps/api/src/main.ts --depth 3

  # Use NestJS plugin for module-aware analysis
  bun run analyze-imports.ts --file apps/api/src/app.module.ts --plugin nestjs

  # Use Next.js plugin for route-aware analysis
  bun run analyze-imports.ts --file apps/web/src/app/page.tsx --plugin nextjs

  # Auto-detect plugin based on file path
  bun run analyze-imports.ts --file apps/api/src/main.ts --plugin auto

  # Generate Mermaid diagram
  bun run analyze-imports.ts --file apps/web/src/app/page.tsx --diagram

  # Show detailed information
  bun run analyze-imports.ts --file apps/api/src/main.ts --verbose

Output formats:
  - Tree: Hierarchical view of import dependencies
  - Mermaid: Graph diagram for visualization
`);
};

// Main
const main = () => {
  const options = parseArgs(process.argv.slice(2));
  
  if (options.help) {
    showHelp();
    process.exit(0);
  }
  
  if (!options.file) {
    console.error('\x1b[31mError: --file is required\x1b[0m');
    console.error('Use --help for usage information');
    process.exit(1);
  }
  
  // Resolve file path
  const filePath = resolve(options.file);
  
  if (!existsSync(filePath)) {
    console.error(`\x1b[31mError: File not found: ${filePath}\x1b[0m`);
    process.exit(1);
  }
  
  // Check if file is supported
  const ext = extname(filePath);
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    console.error(`\x1b[31mError: Unsupported file type: ${ext}\x1b[0m`);
    console.error(`Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`);
    process.exit(1);
  }
  
  // Find and load tsconfig
  const tsConfig = findTsConfig(filePath);
  
  // Get plugins
  const plugins = getPlugins(options);
  
  if (!options.diagram) {
    console.log('\x1b[32m=== Import Dependency Analysis ===\x1b[0m');
    console.log(`File: \x1b[34m${filePath}\x1b[0m`);
    console.log(`Depth: \x1b[33m${options.depth === Infinity ? 'unlimited' : options.depth}\x1b[0m`);
    if (options.plugin && options.plugin !== 'none') {
      const pluginCount = plugins.length;
      const pluginNames = plugins.map(p => p.name || 'unnamed').join(', ');
      console.log(`Plugin: \x1b[35m${options.plugin}${pluginCount > 0 ? ` (${pluginNames})` : ''}\x1b[0m`);
    }
    if (tsConfig) {
      const configPath = findTsConfigPath(filePath);
      console.log(`TypeScript Config: \x1b[33m${configPath ? relative(PROJECT_ROOT, configPath) : 'found'}\x1b[0m`);
    }
    console.log('');
  }
  
  // Analyze imports
  const importMap = analyzeImports(filePath, options.depth, tsConfig, plugins);
  
  if (options.diagram) {
    generateMermaidDiagram(filePath, importMap, options.depth);
  } else {
    console.log('\x1b[32m=== Import Tree (Breadth-First) ===\x1b[0m');
    printTree(filePath, importMap, options.depth, options.verbose);
    console.log('');
    
    // Statistics
    const stats = getStatistics(importMap);
    console.log('\x1b[32m=== Statistics ===\x1b[0m');
    console.log(`Total files analyzed: \x1b[34m${stats.totalFiles}\x1b[0m`);
    console.log(`Total imports found: \x1b[34m${stats.totalImports}\x1b[0m`);
    console.log(`Missing imports: \x1b[31m${stats.missingImports}\x1b[0m`);
    console.log(`Unique files visited: \x1b[34m${importMap.size}\x1b[0m`);
    
    if (stats.missingImports > 0) {
      console.log('');
      console.log(`\x1b[33m⚠️  Found ${stats.missingImports} missing import(s). Review the tree above.\x1b[0m`);
      process.exit(1);
    }
  }
};

main();
