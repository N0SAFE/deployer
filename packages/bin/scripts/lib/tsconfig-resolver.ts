import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import type { TSConfig } from './types';

// Find and parse tsconfig.json
export const findTsConfig = (startPath: string): TSConfig | null => {
  let currentPath = startPath;
  
  while (currentPath !== dirname(currentPath)) {
    const tsConfigPath = join(currentPath, 'tsconfig.json');
    if (existsSync(tsConfigPath)) {
      try {
        const content = readFileSync(tsConfigPath, 'utf-8');
        // Remove comments (both single-line and multi-line)
        let jsonContent = content
          .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi-line comments
          .replace(/\/\/.*/g, '') // Remove single-line comments
          .replace(/,(\s*[}\]])/g, '$1'); // Remove trailing commas
        return JSON.parse(jsonContent);
      } catch (error) {
        // Silently skip if parsing fails
      }
    }
    currentPath = dirname(currentPath);
  }
  
  return null;
};

// Find tsconfig path for a given file
export const findTsConfigPath = (startPath: string): string | null => {
  let currentPath = dirname(startPath);
  
  while (currentPath !== dirname(currentPath)) {
    const tsConfigPath = join(currentPath, 'tsconfig.json');
    if (existsSync(tsConfigPath)) {
      return tsConfigPath;
    }
    currentPath = dirname(currentPath);
  }
  
  return null;
};

// Resolve TypeScript path aliases
export const resolvePathAlias = (
  importPath: string,
  tsConfig: TSConfig | null,
  currentFilePath: string
): string | null => {
  if (!tsConfig?.compilerOptions?.paths) return null;
  
  const { baseUrl = '.', paths } = tsConfig.compilerOptions;
  const configDir = dirname(findTsConfigPath(currentFilePath) || currentFilePath);
  const baseUrlPath = resolve(configDir, baseUrl);
  
  for (const [pattern, replacements] of Object.entries(paths)) {
    // Convert pattern to regex (handle * wildcard)
    const regexPattern = pattern.replace(/\*/g, '(.*)');
    const regex = new RegExp(`^${regexPattern}$`);
    const match = importPath.match(regex);
    
    if (match) {
      // Try each replacement path
      for (const replacement of replacements) {
        let resolvedPath = replacement;
        
        // Replace wildcards with captured groups
        if (match[1]) {
          resolvedPath = resolvedPath.replace(/\*/g, match[1]);
        }
        
        const fullPath = resolve(baseUrlPath, resolvedPath);
        
        return fullPath;
      }
    }
  }
  
  return null;
};
