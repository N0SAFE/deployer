import { createHash, timingSafeEqual } from 'node:crypto'

const digest = (value: string) => createHash('sha256').update(value).digest()

/**
 * The check every mesh peer applies to the credential it is shown. It compares digests, so the comparison takes the
 * same time whatever the length or content of what was presented, and it never throws: a bad credential is an answer.
 */
export function credentialVerifier(
    secret: string
): (credential: string | undefined) => boolean {
    const expected = digest(secret)
    return (credential) =>
        credential !== undefined &&
        timingSafeEqual(digest(credential), expected)
}
