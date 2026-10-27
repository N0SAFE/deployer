# Runbook — secrets encryption at rest (SEC-016)

Applies to every secret the platform stores in Postgres through an `encryptedText` column: GitHub App / OAuth secrets and private keys, GitLab tokens, DNS provider credentials, webhook signing secrets, cluster signing material, and environment-variable values (11 columns today; `reseal-secrets` finds them by probing the schema).

## What was wrong

The old codec derived its key as `Buffer.from(AUTH_SECRET, "hex")`. For any `AUTH_SECRET` that is not a hex string (the value in `.env.example` is base64) that buffer is **empty**, and the per-value salt that feeds scrypt is stored inside the ciphertext. Such rows could be decrypted by anyone with read access to the database, without any secret. If your `AUTH_SECRET` is not exactly 64 hex characters, **everything written before this change was effectively unprotected**:

```bash
printf %s "$AUTH_SECRET" | grep -Eq '^[0-9a-fA-F]{64}$' && echo "hex: old rows had a real key" || echo "NOT hex: old rows used an EMPTY key"
```

## What changed

- New writes are stored as `enc:v1:{"v":1,"kid":"column:1","nonce":"…","ct":"…"}`: AES-256-GCM under a key derived with HKDF-SHA256 from a **root secret**, with a key id so keys can rotate.
- The root secret is `DEPLOYER_ROOT_SECRET`, falling back to `AUTH_SECRET`. It must be at least 32 characters, not low-variety, not a placeholder.
- **Production refuses to boot** if the root secret is missing or weak. Outside production a missing/weak root falls back to a public dev root with a warning, so local runs keep working (never use it with real data).
- Old rows (`salt:iv:tag:data`) are still readable: the legacy reader uses the old `AUTH_SECRET` derivation, unchanged, so nothing becomes unreadable on deploy.

## Steps

1. **Generate and store a root secret** (keep a backup in your password manager: losing it makes every sealed value unreadable):
   ```bash
   openssl rand -base64 48
   ```
   Set it as `DEPLOYER_ROOT_SECRET` for every service that talks to Postgres. Do **not** remove `AUTH_SECRET` yet: it is still needed to read legacy rows.
2. **Deploy.** The services refuse to start with a weak root, naming the variable to set.
3. **Dry-run the reseal** (writes nothing, never prints values):
   ```bash
   cd apps/api/bff && bun --bun src/cli.ts reseal-secrets
   ```
4. **Apply** (idempotent; safe to interrupt and re-run; each row is updated with a compare-and-set, so a concurrent write is never overwritten):
   ```bash
   bun --bun src/cli.ts reseal-secrets --apply
   ```
   Exit codes: `0` done; `1` some rows could not be decrypted (wrong key / tampered, left untouched) or the run failed; `2` plaintext rows remain (see below).
5. **Plaintext rows.** Rows that are neither sealed nor legacy ciphertext (for example `environment_variables.value` rows stored before encryption existed, migration `0040`) are listed as `plaintext-or-foreign` and left alone. Check them, then seal them with `--apply --seal-plaintext`.
6. **Done when** every column reports `remaining=0`. From then on the legacy read path and `AUTH_SECRET`-as-a-key can be removed (roadmap `EFF-272`).
7. **If the old key was empty (see the check above): rotate the credentials.** Resealing protects them from now on but cannot undo past exposure. Rotate at the provider: GitHub App private keys and client secrets, GitLab tokens, DNS provider API tokens, webhook secrets, and any secret stored in environment variables.

## Known limits

- The column codec cannot bind a value to its row (it never sees the table or the row), so it does not defend against a ciphertext being copied between rows. That arrives with explicit `seal`/`open` in repositories (roadmap `DEC-EFF-19`).
- Rotating the root secret itself is not wired to configuration yet; the key ring supports generations (`current`/`accepted`) and the reseal command can re-seal under a new generation, but the env surface for it is a follow-up.
- `apps/api` (the frozen monolith) still writes the legacy form; it goes away with the cutover.

## Plaintext environment variables and the retired `backfill-env-secrets`

The monolith shipped `backfill-env-secrets` to encrypt `environment_variables.value` rows written before that column was encrypted. It is not ported: `reseal-secrets --apply --seal-plaintext` does the same for every encrypted column, is idempotent, and recognises sealed values by the `enc:v1:` prefix rather than by counting `:` segments (which mistook `postgres://u:p@h:5432/db` for ciphertext). Migration `0040` only warns when rows are still plaintext and names that command.
