import { getLLMText, source } from '@/lib/source';

/**
 * Cache the expensive part, not the response.
 *
 * `export const revalidate = false` is not allowed under `cacheComponents`; its
 * replacement is the `'use cache'` directive. The directive applies to whatever
 * the annotated function **returns**, and a cached return value must be
 * serializable — `new Response(...)` is a class instance, so it cannot be the
 * cached value. Caching the concatenated text (a plain string) achieves the same
 * thing: the page scan runs once, and the response is built from the cached text.
 */
async function getLLMFullText(): Promise<string> {
  'use cache';

  const scan = source.getPages().map(getLLMText);
  const scanned = await Promise.all(scan);

  return scanned.join('\n\n');
}

export async function GET() {
  return new Response(await getLLMFullText());
}
