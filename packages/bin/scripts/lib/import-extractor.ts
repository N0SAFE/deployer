import { readFileSync, existsSync } from 'fs';
import { extname, dirname, resolve, isAbsolute } from 'path';
import { parse as parseTypeScript } from '@typescript-eslint/typescript-estree';
import type { Plugin, ResolverContext, ImportInfo, TSConfig } from './types';
import { resolvePathAlias } from './tsconfig-resolver';
import { resolveWithExtensions } from './file-resolver';

// Extract imports from file content using TypeScript parser
export const extractImportsDefault = (filePath: string): string[] => {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const imports: string[] = [];
    
    const ext = extname(filePath);
    const isTsx = ext === '.tsx' || ext === '.jsx';
    
    // Parse with TypeScript parser
    const ast = parseTypeScript(content, {
      loc: true,
      range: true,
      jsx: isTsx,
      comment: true,
      errorOnUnknownASTType: false,
    });
    
    // Traverse AST to find imports
    const traverse = (node: any) => {
      if (!node) return;
      
      // ES6 import statements
      if (node.type === 'ImportDeclaration' && node.source?.value) {
        imports.push(node.source.value);
      }
      
      // Dynamic imports: import('...')
      if (node.type === 'ImportExpression' && node.source?.value) {
        imports.push(node.source.value);
      }
      
      // CommonJS require
      if (
        node.type === 'CallExpression' &&
        node.callee?.name === 'require' &&
        node.arguments?.[0]?.value
      ) {
        imports.push(node.arguments[0].value);
      }
      
      // Export from
      if (node.type === 'ExportNamedDeclaration' && node.source?.value) {
        imports.push(node.source.value);
      }
      
      if (node.type === 'ExportAllDeclaration' && node.source?.value) {
        imports.push(node.source.value);
      }
      
      // Traverse children
      for (const key in node) {
        if (key === 'parent' || key === 'loc' || key === 'range') continue;
        const child = node[key];
        
        if (Array.isArray(child)) {
          child.forEach(traverse);
        } else if (child && typeof child === 'object') {
          traverse(child);
        }
      }
    };
    
    traverse(ast);
    
    return [...new Set(imports)]; // Remove duplicates
  } catch (error) {
    console.error(`Failed to parse ${filePath}:`, error instanceof Error ? error.message : error);
    return [];
  }
};

// Resolve import path with plugin support
export const resolveImportPath = (
  importPath: string,
  currentFilePath: string,
  tsConfig: TSConfig | null,
  projectRoot: string,
  plugins: Plugin[] = []
): string | null => {
  const context: ResolverContext = {
    currentFilePath,
    importPath,
    tsConfig,
    projectRoot,
  };
  
  // Try plugins first
  for (const plugin of plugins) {
    if (plugin.resolveImport) {
      const resolved = plugin.resolveImport(context);
      if (resolved) return resolved;
    }
  }
  
  // Default resolution logic
  // Skip external packages (node_modules)
  if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
    // Check if it's a path alias
    const aliasResolved = resolvePathAlias(importPath, tsConfig, currentFilePath);
    if (aliasResolved) {
      return resolveWithExtensions(aliasResolved);
    }
    // External package - skip
    return null;
  }
  
  // Resolve relative path
  const currentDir = dirname(currentFilePath);
  const absolutePath = isAbsolute(importPath) 
    ? importPath 
    : resolve(currentDir, importPath);
  
  return resolveWithExtensions(absolutePath);
};

// Extract imports with plugin support
export const extractImports = (
  filePath: string,
  plugins: Plugin[] = []
): string[] => {
  // Try plugins first
  for (const plugin of plugins) {
    if (plugin.extractImports) {
      const imports = plugin.extractImports(filePath);
      if (imports !== null) return imports;
    }
  }
  
  // Use default extraction
  return extractImportsDefault(filePath);
};

// Check if file should be traversed
export const shouldTraverse = (
  filePath: string,
  depth: number,
  plugins: Plugin[] = []
): boolean => {
  for (const plugin of plugins) {
    if (plugin.shouldTraverse) {
      if (!plugin.shouldTraverse(filePath, depth)) {
        return false;
      }
    }
  }
  return true;
};

// Transform import info with plugins
export const transformImportInfo = (
  info: ImportInfo,
  plugins: Plugin[] = []
): ImportInfo => {
  let transformed = info;
  
  for (const plugin of plugins) {
    if (plugin.transformImportInfo) {
      transformed = plugin.transformImportInfo(transformed);
    }
  }
  
  return transformed;
};
