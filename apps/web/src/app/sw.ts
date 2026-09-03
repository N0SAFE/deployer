/// <reference lib="webworker" />
import { Serwist } from 'serwist';

declare const self: ServiceWorkerGlobalScope & {
  __SW_MANIFEST: { url: string; revision: string | null }[];
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
});

serwist.addEventListeners();


// Auto-activate on message
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  if (event.data && typeof event.data === 'object' && 'type' in event.data && event.data.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});
