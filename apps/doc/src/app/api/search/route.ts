import { source } from '@/lib/source';
import { createFromSource } from 'fumadocs-core/search/server';

/**
 * Static export: the search index is written once at build time to
 * `out/api/search` (a JSON body, not a route handler), and the client fetches
 * it on first search.
 *
 * `GET` is not exported. Under `output: 'export'` a query-answering endpoint
 * cannot exist — there is no server at request time. `staticGET()` returns the
 * full exported index instead, which is exactly what
 * `staticClient({ from: '/api/search' })` expects to fetch.
 */
const { staticGET } = createFromSource(source, {
  // https://docs.orama.com/docs/orama-js/supported-languages
  language: 'english',
});

export const dynamic = 'force-static';

export { staticGET as GET };
