import { existsSync, readFileSync } from 'fs';
import { dirname, join, extname, resolve } from 'path';
import type { Plugin, ResolverContext, ImportInfo } from '../lib/types';
import { resolveWithExtensions } from '../lib/file-resolver';

/**
 * NestJS Plugin for Import Analyzer
 * 
 * This plugin handles NestJS-specific module resolution:
 * - Detects NestJS modules (files ending with .module.ts)
 * - When a module is detected, resolves its dependencies using NestJS module metadata
 * - Extracts imports from @Module decorator (imports, providers, controllers, exports)
 * - Stops TypeScript import resolution for module children (only follows NestJS dependencies)
 */
export const nestjsPlugin: Plugin = {
  name: 'nestjs',
  
  /**
   * Check if file is a NestJS module
   */
  shouldHandle: (filePath: string): boolean => {
    return filePath.endsWith('.module.ts');
  },
  
  /**
   * Extract imports from NestJS @Module decorator
   */
  extractImports: (filePath: string): string[] | null => {
    if (!filePath.endsWith('.module.ts')) {
      return null; // Let default handle non-module files
    }
    
    try {
      const content = readFileSync(filePath, 'utf-8');
      const imports: string[] = [];
      
      // Extract all import statements to find module dependencies
      const importRegex = /import\s+{([^}]+)}\s+from\s+['"]([^'"]+)['"]/g;
      let match;
      
      while ((match = importRegex.exec(content)) !== null) {
        const importPath = match[2];
        imports.push(importPath);
      }
      
      // Also extract from @Module decorator
      const moduleDecoratorRegex = /@Module\s*\(\s*{([^}]+)}\s*\)/s;
      const moduleMatch = content.match(moduleDecoratorRegex);
      
      if (moduleMatch) {
        const moduleContent = moduleMatch[1];
        
        // Extract imports array
        const importsArrayRegex = /imports\s*:\s*\[([^\]]+)\]/s;
        const importsMatch = moduleContent.match(importsArrayRegex);
        
        if (importsMatch) {
          // Extract module class names
          const moduleNames = importsMatch[1]
            .split(',')
            .map(s => s.trim())
            .filter(s => s && !s.startsWith('//'));
          
          // Map module names to their import paths
          for (const moduleName of moduleNames) {
            const cleanName = moduleName.replace(/\.forRoot\(.*\)|\.register\(.*\)/g, '').trim();
            
            // Find corresponding import statement
            const importForModule = new RegExp(
              `import\\s+{[^}]*\\b${cleanName}\\b[^}]*}\\s+from\\s+['"]([^'"]+)['"]`
            );
            const moduleImportMatch = content.match(importForModule);
            
            if (moduleImportMatch) {
              imports.push(moduleImportMatch[1]);
            }
          }
        }
      }
      
      return [...new Set(imports)];
    } catch (error) {
      console.error(`Failed to extract NestJS module imports from ${filePath}:`, error);
      return null;
    }
  },
  
  /**
   * Resolve NestJS module imports
   */
  resolveImport: (context: ResolverContext): string | null => {
    const { currentFilePath, importPath } = context;
    
    // Only handle if current file is a NestJS module
    if (!currentFilePath.endsWith('.module.ts')) {
      return null;
    }
    
    // Skip external packages
    if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
      return null;
    }
    
    // Resolve relative module path
    const currentDir = dirname(currentFilePath);
    const absolutePath = resolve(currentDir, importPath);
    
    return resolveWithExtensions(absolutePath);
  },
  
  /**
   * Add metadata to indicate this is a NestJS module
   */
  transformImportInfo: (info: ImportInfo): ImportInfo => {
    if (info.path.endsWith('.module.ts')) {
      return {
        ...info,
        metadata: {
          ...info.metadata,
          type: 'nestjs-module',
        },
      };
    }
    return info;
  },
  
  /**
   * For NestJS modules, only traverse module dependencies
   * This prevents deep traversal into service/controller internals
   */
  shouldTraverse: (filePath: string, depth: number): boolean => {
    // If we've found a module, only traverse other modules
    if (filePath.endsWith('.module.ts')) {
      return true;
    }
    
    // Don't traverse non-module NestJS files if they're imported by a module
    // (this would be controlled by the parent context)
    return true;
  },
};

/**
 * Factory function to create NestJS plugin with custom options
 */
export const createNestJSPlugin = (options?: {
  /** Only follow module imports (skip services, controllers, etc.) */
  modulesOnly?: boolean;
  /** Custom module file patterns */
  modulePatterns?: RegExp[];
}): Plugin => {
  const modulePatterns = options?.modulePatterns || [/\.module\.ts$/];
  const modulesOnly = options?.modulesOnly ?? true;
  
  return {
    ...nestjsPlugin,
    name: 'nestjs-custom',
    
    shouldHandle: (filePath: string): boolean => {
      return modulePatterns.some(pattern => pattern.test(filePath));
    },
    
    shouldTraverse: (filePath: string, depth: number): boolean => {
      if (modulesOnly && !modulePatterns.some(pattern => pattern.test(filePath))) {
        // If modules-only mode and this isn't a module, don't traverse its imports
        return false;
      }
      return true;
    },
  };
};

export default nestjsPlugin;
