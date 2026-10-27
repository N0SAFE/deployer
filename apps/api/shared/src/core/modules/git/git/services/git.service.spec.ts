import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AppError } from '@deployer/errors';
import { buildTar, buildZip, gzip } from '@deployer/effect-platform/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitService } from './git.service';

/**
 * `extractUploadedFile` is the upload entry point for zip/tar deployments. These specs pin the
 * behaviour that replaced `execSync("unzip -q \"<file>\" ...")` and the unchecked tar path-join.
 *
 * The extractor is built on Bun builtins, so this suite must run under the Bun runtime
 * (`bun --bun vitest run <this file>`).
 */
describe('GitService.extractUploadedFile', () => {
    let root: string;
    let workspace: string;
    let uploads: string;
    let service: GitService;

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'git-service-'));
        workspace = join(root, 'workspace');
        uploads = join(root, 'uploads');
        mkdirSync(uploads, { recursive: true });
        vi.stubEnv('WORKSPACE_DIR', workspace);
        service = new GitService();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        rmSync(root, { recursive: true, force: true });
    });

    const upload = async (name: string, bytes: Uint8Array): Promise<string> => {
        const filePath = join(uploads, name);
        await Bun.write(filePath, bytes);
        return filePath;
    };

    const rejection = async (promise: Promise<unknown>): Promise<AppError> => {
        const error = await promise.then(
            () => undefined,
            (e: unknown) => e,
        );
        expect(error).toBeInstanceOf(AppError);
        return error as AppError;
    };

    it('extracts a zip into the deployment workspace', async () => {
        const filePath = await upload('app.zip', buildZip([{ name: 'src/index.js', data: 'console.log(1)' }, { name: 'Dockerfile', data: 'FROM scratch' }]));
        const out = await service.extractUploadedFile({ filePath, deploymentId: 'd1' });
        expect(out).toBe(join(workspace, 'deployment-d1'));
        expect(await Bun.file(join(out, 'src/index.js')).text()).toBe('console.log(1)');
        expect(await Bun.file(join(out, 'Dockerfile')).text()).toBe('FROM scratch');
    });

    it('extracts a tar.gz whatever the file is called (format comes from the content)', async () => {
        const filePath = await upload('upload.bin', gzip(buildTar([{ name: 'a/b.txt', data: 'hi' }])));
        const out = await service.extractUploadedFile({ filePath, deploymentId: 'd2' });
        expect(await Bun.file(join(out, 'a/b.txt')).text()).toBe('hi');
    });

    it('does not execute shell metacharacters in the uploaded file name (was command injection through unzip)', async () => {
        const marker = join(root, 'PWNED');
        const filePath = await upload(`x"; touch ${marker}; echo ".zip`, buildZip([{ name: 'ok.txt', data: 'fine' }]));
        const out = await service.extractUploadedFile({ filePath, deploymentId: 'd3' });
        expect(existsSync(marker)).toBe(false);
        expect(await Bun.file(join(out, 'ok.txt')).text()).toBe('fine');
    });

    it.each([
        ['zip', () => buildZip([{ name: 'ok.txt', data: 'a' }, { name: '../../escaped.txt', data: 'pwned' }]), 'upload.zip'],
        ['tar', () => buildTar([{ name: 'ok.txt', data: 'a' }, { name: '../../escaped.txt', data: 'pwned' }]), 'upload.tar'],
    ] as const)('refuses a %s whose entry escapes the workspace (zip-slip) and leaves nothing behind', async (_kind, make, name) => {
        const filePath = await upload(name, make());
        const error = await rejection(service.extractUploadedFile({ filePath, deploymentId: 'd4' }));
        expect(error.code).toBe('BAD_REQUEST');
        expect(error.message).toContain('unsafe path');
        expect(existsSync(join(root, 'escaped.txt'))).toBe(false);
        expect(existsSync(join(workspace, 'escaped.txt'))).toBe(false);
        expect(existsSync(join(workspace, 'deployment-d4'))).toBe(false);
        expect(readdirSync(workspace)).toEqual([]);
    });

    it('refuses symlink entries', async () => {
        const filePath = await upload('link.tar', buildTar([{ name: 'l', type: '2', linkname: '/etc/passwd' }]));
        const error = await rejection(service.extractUploadedFile({ filePath, deploymentId: 'd5' }));
        expect(error.code).toBe('BAD_REQUEST');
        expect(error.message).toContain('symlink');
    });

    it('rejects unsupported content as a client error', async () => {
        const filePath = await upload('notes.zip', new TextEncoder().encode('definitely not an archive'));
        const error = await rejection(service.extractUploadedFile({ filePath, deploymentId: 'd6' }));
        expect(error.code).toBe('BAD_REQUEST');
        expect(error.message).toContain('Unsupported archive');
    });

    it('replaces a previous workspace for the same deployment', async () => {
        const first = await upload('one.zip', buildZip([{ name: 'old.txt', data: 'old' }]));
        const second = await upload('two.zip', buildZip([{ name: 'new.txt', data: 'new' }]));
        await service.extractUploadedFile({ filePath: first, deploymentId: 'd7' });
        const out = await service.extractUploadedFile({ filePath: second, deploymentId: 'd7' });
        expect(existsSync(join(out, 'old.txt'))).toBe(false);
        expect(await Bun.file(join(out, 'new.txt')).text()).toBe('new');
    });
});
