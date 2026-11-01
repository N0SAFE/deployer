import { BadRequestError } from '@deployer/errors';

/**
 * Sanitising the two values every provider hands to `git`: the repository URL and the
 * branch/tag/commit. `git clone <url> --branch <ref>` builds an argv, so a value starting with
 * `-` is parsed as an OPTION (`--branch --upload-pack=evil` runs a program), and a URL is not
 * limited to a scheme `git` is happy to fetch. Both are attacker-reachable through a webhook
 * payload or a deployment form, so they are rejected here, once, instead of at every provider.
 *
 * Conservative by design: what these patterns reject, `git` could not usefully name anyway.
 */

/** Host label: no leading/trailing dash, so `-x.example.com` can never look like an option. */
const HOST = '[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*';
const URL_PATH = '\\/[A-Za-z0-9._~%+@/-]+';
const PORT = '(?::[0-9]{1,5})?';

const URL_SHAPES = [
    // https://github.com/org/repo.git
    new RegExp(`^https:\\/\\/${HOST}${PORT}${URL_PATH}$`),
    // ssh://git@github.com:22/org/repo.git
    new RegExp(`^ssh:\\/\\/[A-Za-z0-9._-]+@${HOST}${PORT}${URL_PATH}$`),
    // git@github.com:org/repo.git (scp-like)
    new RegExp(`^[A-Za-z0-9._-]+@${HOST}:[A-Za-z0-9._~%+@/-]+$`),
] as const;

/** `git check-ref-format` minus the exotic cases: no space, no `~^:?*[\`, no `@{`. */
const REF = /^[A-Za-z0-9._/-]+$/;

export type GitRefField = 'branch' | 'commit' | 'ref';

/**
 * @throws BadRequestError when the URL is not an `https://`, `ssh://` or `git@host:path` remote.
 * The offending value is NOT echoed: remotes legitimately carry credentials in a URL.
 */
export function assertRepositoryUrl(url: string): string {
    const rejection = repositoryUrlProblem(url);
    if (rejection === undefined) {
        return url;
    }
    throw new BadRequestError(
        `Invalid repository URL: ${rejection}. Use https://host/path, ssh://git@host/path or git@host:path.`,
        { field: 'repositoryUrl' },
    );
}

/** Non-throwing form, for callers that report "repository not reachable" instead of a 400. */
export function repositoryUrlProblem(url: string): string | undefined {
    if (url.trim() !== url) {
        return 'leading or trailing whitespace';
    }
    if (url.startsWith('-')) {
        return 'it starts with "-"';
    }
    if (/[\s\u0000-\u001f\u007f]/.test(url)) {
        return 'it contains whitespace or control characters';
    }
    if (!URL_SHAPES.some((shape) => shape.test(url))) {
        return 'unsupported scheme or host';
    }
    return undefined;
}

/**
 * @throws BadRequestError when the value is not a conservative branch/tag/commit name.
 * A rejected ref IS echoed: it is caller-supplied text a UI shows back, not a credential.
 */
export function assertGitRef(value: string, field: GitRefField): string {
    const rejection = gitRefProblem(value);
    if (rejection === undefined) {
        return value;
    }
    throw new BadRequestError(`Invalid ${field} "${value}": ${rejection}`, { field });
}

export function gitRefProblem(value: string): string | undefined {
    if (value.length === 0) {
        return 'it is empty';
    }
    if (value.startsWith('-')) {
        return 'it starts with "-" (would be read as a git option)';
    }
    if (!REF.test(value)) {
        return 'only letters, digits, ".", "_", "/" and "-" are allowed';
    }
    if (value.includes('..')) {
        return '".." is not allowed';
    }
    if (value.startsWith('/') || value.endsWith('/')) {
        return 'it must not start or end with "/"';
    }
    if (value.endsWith('.lock')) {
        return 'it must not end with ".lock"';
    }
    return undefined;
}
