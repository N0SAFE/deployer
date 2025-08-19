import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as tar from 'tar-stream';
import { simpleGit, SimpleGit } from 'simple-git';

@Injectable()
export class GitService {
  private readonly logger = new Logger(GitService.name);
  private readonly workspaceDir = process.env.WORKSPACE_DIR || '/tmp/deployer-workspace';

  constructor() {
    // Ensure workspace directory exists
    if (!fs.existsSync(this.workspaceDir)) {
      fs.mkdirSync(this.workspaceDir, { recursive: true });
    }
  }

  async cloneRepository(options: {
    url: string;
    branch?: string;
    commit?: string;
    deploymentId: string;
  }): Promise<string> {
    const { url, branch = 'main', commit, deploymentId } = options;
    const repoPath = path.join(this.workspaceDir, `deployment-${deploymentId}`);

    this.logger.log(`Cloning repository ${url} to ${repoPath}`);

    // Clean up existing directory
    if (fs.existsSync(repoPath)) {
      fs.rmSync(repoPath, { recursive: true, force: true });
    }

    try {
      const git: SimpleGit = simpleGit();

      // Clone the repository
      await git.clone(url, repoPath, ['--depth', '1', '--branch', branch]);

      // If specific commit is requested, checkout that commit
      if (commit) {
        const repoGit = simpleGit(repoPath);
        await repoGit.checkout(commit);
      }

      this.logger.log(`Repository cloned successfully to ${repoPath}`);
      return repoPath;

    } catch (error) {
      this.logger.error(`Failed to clone repository ${url}:`, error);
      
      // Clean up on failure
      if (fs.existsSync(repoPath)) {
        fs.rmSync(repoPath, { recursive: true, force: true });
      }

      throw error;
    }
  }

  async extractUploadedFile(options: {
    filePath: string;
    deploymentId: string;
  }): Promise<string> {
    const { filePath, deploymentId } = options;
    const extractPath = path.join(this.workspaceDir, `deployment-${deploymentId}`);

    this.logger.log(`Extracting uploaded file ${filePath} to ${extractPath}`);

    // Clean up existing directory
    if (fs.existsSync(extractPath)) {
      fs.rmSync(extractPath, { recursive: true, force: true });
    }

    fs.mkdirSync(extractPath, { recursive: true });

    try {
      // Check if file is a zip or tar
      const fileExtension = path.extname(filePath).toLowerCase();

      if (fileExtension === '.zip') {
        await this.extractZip(filePath, extractPath);
      } else if (fileExtension === '.tar' || fileExtension === '.gz' || fileExtension === '.tgz') {
        await this.extractTar(filePath, extractPath);
      } else {
        throw new Error(`Unsupported file type: ${fileExtension}`);
      }

      this.logger.log(`File extracted successfully to ${extractPath}`);
      return extractPath;

    } catch (error) {
      this.logger.error(`Failed to extract file ${filePath}:`, error);

      // Clean up on failure
      if (fs.existsSync(extractPath)) {
        fs.rmSync(extractPath, { recursive: true, force: true });
      }

      throw error;
    }
  }

  async getCommitInfo(repoPath: string): Promise<{
    sha: string;
    message: string;
    author: string;
    date: Date;
  }> {
    try {
      const git = simpleGit(repoPath);
      const log = await git.log({ maxCount: 1 });
      const latestCommit = log.latest;

      if (!latestCommit) {
        throw new Error('No commits found in repository');
      }

      return {
        sha: latestCommit.hash,
        message: latestCommit.message,
        author: latestCommit.author_name,
        date: new Date(latestCommit.date)
      };

    } catch (error) {
      this.logger.error(`Failed to get commit info from ${repoPath}:`, error);
      throw error;
    }
  }

  async cleanupDeployment(deploymentId: string): Promise<void> {
    const repoPath = path.join(this.workspaceDir, `deployment-${deploymentId}`);

    if (fs.existsSync(repoPath)) {
      this.logger.log(`Cleaning up deployment workspace: ${repoPath}`);
      fs.rmSync(repoPath, { recursive: true, force: true });
    }
  }

  async validateRepository(url: string): Promise<boolean> {
    try {
      const git = simpleGit();
      await git.listRemote([url]);
      return true;
    } catch (error) {
      this.logger.error(`Repository validation failed for ${url}:`, error);
      return false;
    }
  }

  private async extractZip(filePath: string, extractPath: string): Promise<void> {
    // For now, we'll use a simple approach. In a production environment,
    // you might want to use a library like 'yauzl' or 'adm-zip'
    const { execSync } = await import('child_process');
    
    try {
      execSync(`unzip -q "${filePath}" -d "${extractPath}"`, { stdio: 'pipe' });
    } catch (error) {
      throw new Error(`Failed to extract ZIP file: ${error}`);
    }
  }

  private async extractTar(filePath: string, extractPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const extract = tar.extract();
      
      extract.on('entry', (header, stream, next) => {
        const entryPath = path.join(extractPath, header.name);
        
        // Ensure directory exists
        const dir = path.dirname(entryPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        // Write file
        if (header.type === 'file') {
          const writeStream = fs.createWriteStream(entryPath);
          stream.pipe(writeStream);
          writeStream.on('finish', next);
        } else if (header.type === 'directory') {
          if (!fs.existsSync(entryPath)) {
            fs.mkdirSync(entryPath, { recursive: true });
          }
          stream.resume();
          next();
        } else {
          stream.resume();
          next();
        }
      });

      extract.on('finish', resolve);
      extract.on('error', reject);

      // Read the tar file
      fs.createReadStream(filePath).pipe(extract);
    });
  }
}