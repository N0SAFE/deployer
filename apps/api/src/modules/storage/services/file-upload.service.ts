import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as tar from 'tar-stream';
import * as yauzl from 'yauzl';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
export interface UploadedFile {
    fieldname: string;
    originalname: string;
    encoding: string;
    mimetype: string;
    buffer: Buffer;
    size: number;
}
export interface FileUploadResult {
    uploadId: string;
    originalName: string;
    extractedPath: string;
    fileCount: number;
    totalSize: number;
    hash: string;
    metadata: {
        hasDockerfile: boolean;
        hasPackageJson: boolean;
        hasIndex: boolean;
        detectedType: 'static' | 'node' | 'docker' | 'unknown';
        buildCommand?: string;
        startCommand?: string;
    };
}
@Injectable()
export class FileUploadService {
    private readonly logger = new Logger(FileUploadService.name);
    private readonly uploadsDir = '/app/uploads';
    private readonly extractDir = '/app/extracted';
    private readonly maxFileSize = 100 * 1024 * 1024; // 100MB
    private readonly allowedMimeTypes = [
        'application/zip',
        'application/x-zip-compressed',
        'application/x-tar',
        'application/gzip',
        'application/x-gzip',
        'application/x-compressed-tar',
    ];
    constructor(
    @InjectQueue('deployment')
    private deploymentQueue: Queue) { }
    async onModuleInit() {
        // Ensure upload directories exist
        await fs.ensureDir(this.uploadsDir);
        await fs.ensureDir(this.extractDir);
        this.logger.log('File upload service initialized');
    }
    /**
     * Process uploaded file and extract contents
     */
    async processUploadedFile(file: UploadedFile): Promise<FileUploadResult> {
        try {
            this.validateFile(file);
            const uploadId = uuidv4();
            const hash = this.calculateFileHash(file.buffer);
            const uploadPath = path.join(this.uploadsDir, `${uploadId}_${file.originalname}`);
            const extractPath = path.join(this.extractDir, uploadId);
            this.logger.log(`Processing uploaded file: ${file.originalname} (${file.size} bytes)`);
            // Save uploaded file
            await fs.writeFile(uploadPath, file.buffer);
            // Extract archive
            await fs.ensureDir(extractPath);
            const fileCount = await this.extractArchive(uploadPath, extractPath, file.mimetype);
            // Analyze extracted contents
            const metadata = await this.analyzeExtractedFiles(extractPath);
            // Clean up uploaded archive
            await fs.remove(uploadPath);
            const result: FileUploadResult = {
                uploadId,
                originalName: file.originalname,
                extractedPath: extractPath,
                fileCount,
                totalSize: file.size,
                hash,
                metadata,
            };
            this.logger.log(`File processed successfully: ${uploadId} (${fileCount} files extracted)`);
            return result;
        }
        catch (error) {
            this.logger.error(`Failed to process uploaded file ${file.originalname}:`, error);
            throw error;
        }
    }
    /**
     * Validate uploaded file
     */
    private validateFile(file: UploadedFile): void {
        if (!file || !file.buffer) {
            throw new BadRequestException('No file provided');
        }
        if (file.size > this.maxFileSize) {
            throw new BadRequestException(`File too large. Maximum size is ${this.maxFileSize / 1024 / 1024}MB`);
        }
        if (!this.allowedMimeTypes.includes(file.mimetype)) {
            throw new BadRequestException(`Invalid file type. Allowed types: ${this.allowedMimeTypes.join(', ')}`);
        }
        // Additional validation based on file extension
        const ext = path.extname(file.originalname).toLowerCase();
        const validExtensions = ['.zip', '.tar', '.tar.gz', '.tgz'];
        if (!validExtensions.includes(ext)) {
            throw new BadRequestException(`Invalid file extension. Allowed extensions: ${validExtensions.join(', ')}`);
        }
    }
    /**
     * Calculate file hash for deduplication
     */
    private calculateFileHash(buffer: Buffer): string {
        return crypto.createHash('sha256').update(buffer).digest('hex');
    }
    /**
     * Extract archive file
     */
    private async extractArchive(archivePath: string, extractPath: string, mimeType: string): Promise<number> {
        let fileCount = 0;
        try {
            if (mimeType.includes('zip')) {
                // Extract ZIP file using yauzl
                fileCount = await this.extractZipFile(archivePath, extractPath);
            }
            else if (mimeType.includes('tar') || mimeType.includes('gzip')) {
                // Extract TAR/TAR.GZ file using tar-stream
                fileCount = await this.extractTarFile(archivePath, extractPath, mimeType.includes('gzip'));
            }
            else {
                throw new BadRequestException(`Unsupported archive type: ${mimeType}`);
            }
            this.logger.log(`Extracted ${fileCount} files from ${archivePath}`);
            return fileCount;
        }
        catch (error) {
            this.logger.error(`Failed to extract archive ${archivePath}:`, error);
            await fs.remove(extractPath); // Clean up on failure
            throw new BadRequestException('Failed to extract archive. File may be corrupted.');
        }
    }
    /**
     * Extract ZIP file using yauzl
     */
    private async extractZipFile(archivePath: string, extractPath: string): Promise<number> {
        return new Promise((resolve, reject) => {
            let fileCount = 0;
            yauzl.open(archivePath, { lazyEntries: true }, (err, zipfile) => {
                if (err)
                    return reject(err);
                if (!zipfile)
                    return reject(new Error('Failed to open ZIP file'));
                zipfile.readEntry();
                zipfile.on('entry', (entry) => {
                    const fullPath = path.join(extractPath, entry.fileName);
                    // Skip directories
                    if (/\/$/.test(entry.fileName)) {
                        zipfile.readEntry();
                        return;
                    }
                    // Ensure directory exists
                    fs.ensureDirSync(path.dirname(fullPath));
                    zipfile.openReadStream(entry, (err, readStream) => {
                        if (err)
                            return reject(err);
                        if (!readStream)
                            return reject(new Error('Failed to create read stream'));
                        const writeStream = fs.createWriteStream(fullPath);
                        readStream.pipe(writeStream);
                        writeStream.on('close', () => {
                            fileCount++;
                            zipfile.readEntry();
                        });
                        writeStream.on('error', reject);
                        readStream.on('error', reject);
                    });
                });
                zipfile.on('end', () => {
                    resolve(fileCount);
                });
                zipfile.on('error', reject);
            });
        });
    }
    /**
     * Extract TAR file using tar-stream
     */
    private async extractTarFile(archivePath: string, extractPath: string, isGzipped: boolean): Promise<number> {
        return new Promise((resolve, reject) => {
            let fileCount = 0;
            const extract = tar.extract();
            extract.on('entry', (header, stream, next) => {
                const fullPath = path.join(extractPath, header.name);
                if (header.type === 'file') {
                    // Ensure directory exists
                    fs.ensureDirSync(path.dirname(fullPath));
                    const writeStream = fs.createWriteStream(fullPath);
                    stream.pipe(writeStream);
                    writeStream.on('close', () => {
                        fileCount++;
                        next();
                    });
                    writeStream.on('error', (err) => {
                        next(err);
                    });
                }
                else {
                    stream.on('end', () => {
                        next();
                    });
                    stream.resume();
                }
            });
            extract.on('finish', () => {
                resolve(fileCount);
            });
            extract.on('error', reject);
            // Create read stream and pipe through decompression if needed
            const readStream = fs.createReadStream(archivePath);
            if (isGzipped) {
                readStream.pipe(zlib.createGunzip()).pipe(extract);
            }
            else {
                readStream.pipe(extract);
            }
        });
    }
    /**
     * Analyze extracted files to determine project type and build configuration
     */
    private async analyzeExtractedFiles(extractPath: string): Promise<FileUploadResult['metadata']> {
        const metadata: FileUploadResult['metadata'] = {
            hasDockerfile: false,
            hasPackageJson: false,
            hasIndex: false,
            detectedType: 'unknown',
        };
        try {
            // Stream file discovery to avoid building a large in-memory list
            let fileCount = 0;
            for await (const file of this.walkFiles(extractPath)) {
                fileCount++;
                const filename = path.basename(file).toLowerCase();
                if (filename === 'dockerfile') {
                    metadata.hasDockerfile = true;
                }
                else if (filename === 'package.json') {
                    metadata.hasPackageJson = true;
                    // Try to read package.json for scripts
                    try {
                        const packageJson = await fs.readJson(file);
                        if (packageJson.scripts?.build) {
                            metadata.buildCommand = 'npm run build';
                        }
                        if (packageJson.scripts?.start) {
                            metadata.startCommand = 'npm start';
                        }
                    }
                    catch (error) {
                        this.logger.warn(`Failed to parse package.json at ${file}:`, error);
                    }
                }
                else if (['index.html', 'index.htm'].includes(filename)) {
                    metadata.hasIndex = true;
                }
            }
            // Determine project type
            if (metadata.hasDockerfile) {
                metadata.detectedType = 'docker';
            }
            else if (metadata.hasPackageJson) {
                metadata.detectedType = 'node';
            }
            else if (metadata.hasIndex) {
                metadata.detectedType = 'static';
            }
            // Set default build/start commands based on type
            if (metadata.detectedType === 'static' && !metadata.buildCommand) {
                metadata.buildCommand = 'echo "Static files, no build required"';
                metadata.startCommand = 'http-server . -p ${PORT:-3000}';
            }
            else if (metadata.detectedType === 'node' && !metadata.buildCommand) {
                metadata.buildCommand = 'npm ci';
                if (!metadata.startCommand) {
                    metadata.startCommand = 'npm start';
                }
            }
            this.logger.log(`File analysis complete: type=${metadata.detectedType}, files=${fileCount}`);
            return metadata;
        }
        catch (error) {
            this.logger.error(`Failed to analyze extracted files at ${extractPath}:`, error);
            return metadata;
        }
    }
    /**
     * Async generator to walk files under a directory and yield file paths one by one
     */
    private async *walkFiles(dir: string): AsyncGenerator<string> {
        const items = await fs.readdir(dir);
        for (const item of items) {
            const fullPath = path.join(dir, item);
            const stat = await fs.stat(fullPath);
            if (stat.isDirectory()) {
                yield* this.walkFiles(fullPath);
            }
            else {
                yield fullPath;
            }
        }
    }
    /**
     * Get uploaded file info
     */
    async getUploadedFileInfo(uploadId: string): Promise<FileUploadResult | null> {
        try {
            const extractPath = path.join(this.extractDir, uploadId);
            const exists = await fs.pathExists(extractPath);
            if (!exists) {
                return null;
            }
            // Try to read cached metadata if available
            const metadataPath = path.join(extractPath, '.deployer-metadata.json');
            if (await fs.pathExists(metadataPath)) {
                return await fs.readJson(metadataPath);
            }
            return null;
        }
        catch (error) {
            this.logger.error(`Failed to get upload info for ${uploadId}:`, error);
            return null;
        }
    }
    /**
     * Clean up uploaded files
     */
    async cleanupUpload(uploadId: string): Promise<void> {
        try {
            const extractPath = path.join(this.extractDir, uploadId);
            await fs.remove(extractPath);
            this.logger.log(`Cleaned up upload: ${uploadId}`);
        }
        catch (error) {
            this.logger.error(`Failed to cleanup upload ${uploadId}:`, error);
        }
    }
    /**
     * Clean up old uploads (older than specified days)
     */
    async cleanupOldUploads(olderThanDays: number = 7): Promise<number> {
        let cleanedCount = 0;
        try {
            const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
            const uploads = await fs.readdir(this.extractDir);
            for (const uploadId of uploads) {
                const uploadPath = path.join(this.extractDir, uploadId);
                const stat = await fs.stat(uploadPath);
                if (stat.mtime.getTime() < cutoffTime) {
                    await fs.remove(uploadPath);
                    cleanedCount++;
                    this.logger.log(`Cleaned up old upload: ${uploadId}`);
                }
            }
            this.logger.log(`Cleaned up ${cleanedCount} old uploads`);
            return cleanedCount;
        }
        catch (error) {
            this.logger.error('Failed to cleanup old uploads:', error);
            return 0;
        }
    }
    /**
     * Deploy uploaded files
     */
    async deployUpload(uploadId: string, serviceId: string): Promise<string> {
        try {
            const extractPath = path.join(this.extractDir, uploadId);
            const exists = await fs.pathExists(extractPath);
            if (!exists) {
                throw new BadRequestException(`Upload ${uploadId} not found or has been cleaned up`);
            }
            // Queue deployment job
            const job = await this.deploymentQueue.add('deploy-upload', {
                uploadId,
                serviceId,
                extractPath,
            }, {
                priority: 1,
                attempts: 3,
            });
            this.logger.log(`Queued upload deployment: ${uploadId} -> service ${serviceId}`);
            return job.id as string;
        }
        catch (error) {
            this.logger.error(`Failed to deploy upload ${uploadId}:`, error);
            throw error;
        }
    }
    /**
     * Create deployment bundle from uploaded files
     */
    async createDeploymentBundle(uploadId: string): Promise<Buffer> {
        try {
            const extractPath = path.join(this.extractDir, uploadId);
            const bundlePath = path.join(this.uploadsDir, `${uploadId}-bundle.tar.gz`);
            // Create tar.gz bundle using tar-stream
            await this.createTarGzBundle(extractPath, bundlePath);
            const bundle = await fs.readFile(bundlePath);
            await fs.remove(bundlePath); // Clean up temporary bundle
            this.logger.log(`Created deployment bundle for upload: ${uploadId}`);
            return bundle;
        }
        catch (error) {
            this.logger.error(`Failed to create deployment bundle for ${uploadId}:`, error);
            throw error;
        }
    }
    /**
     * Create TAR.GZ bundle using tar-stream
     */
    private async createTarGzBundle(sourcePath: string, outputPath: string): Promise<void> {
        return new Promise(async (resolve, reject) => {
            try {
                const pack = tar.pack();
                const gzip = zlib.createGzip();
                const writeStream = fs.createWriteStream(outputPath);
                pack.pipe(gzip).pipe(writeStream);
                // Stream files using the async generator to avoid building large in-memory lists
                for await (const filePath of this.walkFiles(sourcePath)) {
                    const relativePath = path.relative(sourcePath, filePath);
                    const stats = await fs.stat(filePath);
                    if (stats.isFile()) {
                        const fileStream = fs.createReadStream(filePath);
                        const entry = pack.entry({ name: relativePath, size: stats.size });
                        // Pipe file into tar entry and wait for the entry to finish
                        await new Promise<void>((resolve, reject) => {
                            fileStream.pipe(entry);
                            const onClose = () => resolve();
                            const onError = (err: any) => reject(err);
                            entry.on('close', onClose);
                            entry.on('error', onError);
                            fileStream.on('error', onError);
                        });
                    }
                }
                pack.finalize();
                writeStream.on('close', resolve);
                writeStream.on('error', reject);
            }
            catch (error) {
                reject(error);
            }
        });
    }
}
