import { existsSync, statSync } from 'fs';
import { join } from 'path';

const SUPPORTED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs', '.cts', '.cjs'];

// Try to resolve file with different extensions
export const resolveWithExtensions = (filePath: string): string | null => {
  // If path already has extension and exists
  if (existsSync(filePath) && statSync(filePath).isFile()) {
    return filePath;
  }
  
  // Try with different extensions
  for (const ext of SUPPORTED_EXTENSIONS) {
    const pathWithExt = filePath + ext;
    if (existsSync(pathWithExt) && statSync(pathWithExt).isFile()) {
      return pathWithExt;
    }
  }
  
  // Try index files in directory
  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    for (const ext of SUPPORTED_EXTENSIONS) {
      const indexPath = join(filePath, `index${ext}`);
      if (existsSync(indexPath)) {
        return indexPath;
      }
    }
  }
  
  return null;
};

export { SUPPORTED_EXTENSIONS };
