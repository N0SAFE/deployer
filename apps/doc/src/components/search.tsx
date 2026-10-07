'use client';

import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogFooter,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
} from 'fumadocs-ui/components/dialog/search';
import { useDocsSearch } from 'fumadocs-core/search/client';
import type { SharedProps } from 'fumadocs-ui/contexts/search';
import { use, useMemo } from 'react';

/**
 * Search dialog for the static export.
 *
 * The stock `DefaultSearchDialog` uses `fetchClient`, which queries a JSON
 * endpoint on every keystroke. A static export has no such endpoint, so this
 * dialog uses `staticClient` instead: it downloads the index that
 * `/api/search` exported at build time and searches it in the browser.
 *
 * The engine is imported dynamically, not statically. A static import would
 * pull the whole search engine (~70 KB) into the initial JS every doc page
 * loads, even for readers who never open search — the previous `fetchClient`
 * setup needed no browser engine, so that would be a regression. `use()` on the
 * cached promise suspends until the chunk arrives; `SearchProvider` wraps this
 * dialog in a `<Suspense>`, so nothing else waits on it.
 */
let enginePromise: ReturnType<typeof importEngine> | undefined;

function importEngine() {
  return import('fumadocs-core/search/client/orama-static');
}

export default function StaticSearchDialog({ open, onOpenChange }: SharedProps) {
  // `use()` suspends on first render, then resolves from the module-level cache.
  const { staticClient } = use((enginePromise ??= importEngine()));
  // Memoise the client: `staticClient()` returns a fresh object each call, and
  // `useDocsSearch` re-runs its effect whenever the client identity changes.
  const client = useMemo(() => staticClient(), [staticClient]);
  const { search, setSearch, query } = useDocsSearch({ client });

  return (
    <SearchDialog
      open={open}
      onOpenChange={onOpenChange}
      search={search}
      onSearchChange={setSearch}
      isLoading={query.isLoading}
    >
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList items={query.data !== 'empty' ? query.data : null} />
      </SearchDialogContent>
      <SearchDialogFooter />
    </SearchDialog>
  );
}
