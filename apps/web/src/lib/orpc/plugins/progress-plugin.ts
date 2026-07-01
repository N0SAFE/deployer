// ============================================
// Type Definitions
// ============================================

import { StandardLinkOptions, StandardLinkPlugin } from "@orpc/client/standard";
import { createContextFilterDebugLogger } from "@/lib/logging/context-filter-debug";

export interface ProgressEvent {
  loaded: number;
  total: number;
  percentage: number;
  phase: "upload" | "processing" | "download";
  timestamp: number;
}

type ProgressSubscriber = (event: ProgressEvent) => void;

// Internal symbols for context injection
const PROGRESS_SUBSCRIPTION_SYMBOL = Symbol("orpc.progress.subscription");
const PROGRESS_TRACKER_SYMBOL = Symbol("orpc.progress.tracker");

// Debug logger gated by APP_DEBUG_CONTEXT_FILTER env var
const debugLogger = createContextFilterDebugLogger("ProgressPlugin", "orpc-progress");

// ============================================
// Progress Subscription Manager
// ============================================

class ProgressSubscription {
  private subscribers = new Set<ProgressSubscriber>();
  private uploadSubscribers = new Set<ProgressSubscriber>();
  private downloadSubscribers = new Set<ProgressSubscriber>();
  private latestEvent: ProgressEvent | null = null;

  subscribe(callback: ProgressSubscriber): () => void {
    debugLogger("Subscribing to general progress events");
    this.subscribers.add(callback);
    debugLogger("Total general subscribers", { count: this.subscribers.size });

    // Send latest event to new subscriber if available
    if (this.latestEvent) {
      debugLogger("Sending latest event to new subscriber", { event: this.latestEvent });
      callback(this.latestEvent);
    }

    return () => {
      debugLogger("Unsubscribing from general progress events");
      this.subscribers.delete(callback);
    };
  }

  subscribeUpload(callback: ProgressSubscriber): () => void {
    debugLogger("Subscribing to upload progress events");
    this.uploadSubscribers.add(callback);
    debugLogger("Total upload subscribers", { count: this.uploadSubscribers.size });
    return () => {
      debugLogger("Unsubscribing from upload progress events");
      this.uploadSubscribers.delete(callback);
    };
  }

  subscribeDownload(callback: ProgressSubscriber): () => void {
    debugLogger("Subscribing to download progress events");
    this.downloadSubscribers.add(callback);
    debugLogger("Total download subscribers", { count: this.downloadSubscribers.size });
    return () => {
      debugLogger("Unsubscribing from download progress events");
      this.downloadSubscribers.delete(callback);
    };
  }

  emit(event: ProgressEvent) {
    debugLogger("Emitting progress", {
      loaded: event.loaded,
      total: event.total,
      percentage: event.percentage.toFixed(2),
      phase: event.phase,
    });
    this.latestEvent = event;

    // Emit to all general subscribers
    debugLogger("Notifying general subscribers", { count: this.subscribers.size });
    this.subscribers.forEach((callback) => {
      try {
        callback(event);
      } catch (error) {
        debugLogger("subscriber_error", { error });
      }
    });

    // Emit to phase-specific subscribers
    if (event.phase === "upload") {
      debugLogger("Notifying upload subscribers", { count: this.uploadSubscribers.size });
      this.uploadSubscribers.forEach((callback) => {
        try {
          callback(event);
        } catch (error) {
          debugLogger("upload_subscriber_error", { error });
        }
      });
    } else if (event.phase === "download") {
      debugLogger("Notifying download subscribers", { count: this.downloadSubscribers.size });
      this.downloadSubscribers.forEach((callback) => {
        try {
          callback(event);
        } catch (error) {
          debugLogger("download_subscriber_error", { error });
        }
      });
    }
  }

  getLatest(): ProgressEvent | null {
    return this.latestEvent;
  }

  clear() {
    this.subscribers.clear();
    this.uploadSubscribers.clear();
    this.downloadSubscribers.clear();
    this.latestEvent = null;
  }

  hasSubscribers(): boolean {
    return (
      this.subscribers.size > 0 ||
      this.uploadSubscribers.size > 0 ||
      this.downloadSubscribers.size > 0
    );
  }
}

// ============================================
// Progress Tracker with Subscription
// ============================================

class ProgressTracker {
  private uploadLoaded = 0;
  private uploadTotal = 0;
  private downloadLoaded = 0;
  private downloadTotal = 0;
  private subscription: ProgressSubscription;

  constructor(subscription: ProgressSubscription) {
    this.subscription = subscription;
  }

  updateUpload(loaded: number, total: number) {
    debugLogger("Upload progress update", { loaded, total });
    this.uploadLoaded = loaded;
    this.uploadTotal = total;

    const event: ProgressEvent = {
      loaded,
      total,
      percentage: total > 0 ? (loaded / total) * 100 : 0,
      phase: "upload",
      timestamp: Date.now(),
    };

    this.subscription.emit(event);
  }

  updateDownload(loaded: number, total: number) {
    debugLogger("Download progress update", { loaded, total });
    this.downloadLoaded = loaded;
    this.downloadTotal = total;

    const event: ProgressEvent = {
      loaded,
      total,
      percentage: total > 0 ? (loaded / total) * 100 : 0,
      phase: "download",
      timestamp: Date.now(),
    };

    this.subscription.emit(event);
  }

  updateProcessing(loaded: number, total: number) {
    const event: ProgressEvent = {
      loaded,
      total,
      percentage: total > 0 ? (loaded / total) * 100 : 0,
      phase: "processing",
      timestamp: Date.now(),
    };

    this.subscription.emit(event);
  }
}

// ============================================
// Stream Wrappers
// ============================================

async function createUploadProgressStream(
  body: BodyInit,
  tracker: ProgressTracker,
): Promise<ReadableStream<Uint8Array>> {
  debugLogger("Creating upload progress stream");
  let stream: ReadableStream<Uint8Array>;
  let total = 0;
  

  if (body instanceof ReadableStream) {
    debugLogger("Body is ReadableStream (size unknown)");
    stream = body as ReadableStream<Uint8Array>;
  } else if (body instanceof Blob) {
    total = body.size;
    debugLogger("Body is Blob", { total });
    stream = body.stream();
  } else if (body instanceof ArrayBuffer) {
    total = body.byteLength;
    debugLogger("Body is ArrayBuffer", { total });
    stream = new Blob([body]).stream();
  } else if (body instanceof FormData) {
    // FormData doesn't have a direct size property and can't be converted to Blob directly
    // We'll stream it without a known size
    debugLogger("Body is FormData (size unknown)");
    const response = new Response(body);
    const blob = await response.blob();
    total = blob.size;
    stream = blob.stream();
  } else if (typeof body === "string") {
    const blob = new Blob([body]);
    total = blob.size;
    debugLogger("Body is string", { total });
    stream = blob.stream();
  } else if (body instanceof URLSearchParams) {
    const blob = new Blob([body.toString()]);
    total = blob.size;
    debugLogger("Body is URLSearchParams", { total });
    stream = blob.stream();
  } else {
    const serialized = typeof body === 'object' ? JSON.stringify(body) : String(body);
    const blob = new Blob([serialized]);
    total = blob.size;
    debugLogger("Body is unknown type", { total });
    stream = blob.stream();
  }

  let loaded = 0;
  const reader = stream.getReader();

  return new ReadableStream({
    async start(controller) {
      debugLogger("Starting upload stream read");
      try {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            debugLogger("Upload stream read complete");
            if (total > 0) {
              tracker.updateUpload(total, total);
            }
            controller.close();
            break;
          }

          loaded += value.byteLength;
          const actualTotal = total > 0 ? total : loaded;
          tracker.updateUpload(loaded, actualTotal);

          controller.enqueue(value);
        }
      } catch (error) {
        debugLogger("upload_stream_error", { error });
        controller.error(error);
        throw error;
      }
    },
    async cancel() {
      debugLogger("Upload stream cancelled");
      await reader.cancel();
    },
  });
}



export class ProgressPlugin<
  T extends {
    // Callback-based progress tracking (automatically subscribed)
    onProgress?: (event: ProgressEvent) => void;
    onUploadProgress?: (event: ProgressEvent) => void;
    onDownloadProgress?: (event: ProgressEvent) => void;

    // Subscription-based progress tracking (manual control)
    subscribeProgress?: (callback: ProgressSubscriber) => () => void;
    subscribeUploadProgress?: (callback: ProgressSubscriber) => () => void;
    subscribeDownloadProgress?: (callback: ProgressSubscriber) => () => void;
    
    [PROGRESS_TRACKER_SYMBOL]?: ProgressTracker;
    [PROGRESS_SUBSCRIPTION_SYMBOL]?: ProgressSubscription;
  },
> implements StandardLinkPlugin<T>
{
  // Order controls plugin loading order (higher = loads earlier)
  order = 100;

  init(link: StandardLinkOptions<T>): void {
    // Client interceptor: Intercept requests to add progress tracking
    link.clientInterceptors ??= [];
    link.clientInterceptors.push(async (options) => {
      const { context, request } = options;

      debugLogger("Client Interceptor called");
      debugLogger("Context", { context });
      debugLogger("Request body", { present: Boolean(request.body) });

      // Check if we have any progress callbacks
      if (!context.onProgress && !context.onUploadProgress && !context.onDownloadProgress) {
        debugLogger("No progress callbacks, skipping");
        return await options.next(options);
      }

      // Create subscription and tracker for this request
      const subscription = new ProgressSubscription();
      const tracker = new ProgressTracker(subscription);
      const unsubscribers: (() => void)[] = [];

      if (context.onProgress) {
        debugLogger("Found onProgress callback, subscribing");
        unsubscribers.push(subscription.subscribe(context.onProgress));
      }
      if (context.onUploadProgress) {
        debugLogger("Found onUploadProgress callback, subscribing");
        unsubscribers.push(subscription.subscribeUpload(context.onUploadProgress));
      }
      if (context.onDownloadProgress) {
        debugLogger("Found onDownloadProgress callback, subscribing");
        unsubscribers.push(subscription.subscribeDownload(context.onDownloadProgress));
      }

      // Provide subscription functions for manual subscription
      if (context.subscribeProgress !== undefined) {
        context.subscribeProgress = (callback: ProgressSubscriber) => subscription.subscribe(callback);
      }
      if (context.subscribeUploadProgress !== undefined) {
        context.subscribeUploadProgress = (callback: ProgressSubscriber) => subscription.subscribeUpload(callback);
      }
      if (context.subscribeDownloadProgress !== undefined) {
        context.subscribeDownloadProgress = (callback: ProgressSubscriber) => subscription.subscribeDownload(callback);
      }

      // Store tracker in context
      context[PROGRESS_TRACKER_SYMBOL] = tracker;
      context[PROGRESS_SUBSCRIPTION_SYMBOL] = subscription;

      debugLogger("Wrapping request body and calling next");

      try {
        // Wrap request body if present
        let modifiedRequest = request;
        if (request.body) {
          debugLogger("Wrapping request body for upload progress");
          const progressStream = await createUploadProgressStream(request.body as BodyInit, tracker);
          modifiedRequest = {
            ...request,
            body: progressStream,
          };
        }

        // Call next with modified request
        return await options.next({
          ...options,
          request: modifiedRequest,
        });
      } finally {
        // Cleanup subscriptions
        debugLogger("Cleaning up subscriptions");
        unsubscribers.forEach((unsubscribe) => { unsubscribe() });
        subscription.clear();
        debugLogger("Client Interceptor cleanup complete");
      }
    });
  }
}

export function createProgressPlugin() {
  return new ProgressPlugin();
}

const progressPluginDefault = {
  ProgressPlugin,
};

export default progressPluginDefault;
