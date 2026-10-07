// ============================================
// Type Definitions
// ============================================

import { StandardLinkOptions, StandardLinkPlugin } from "@orpc/client/standard";

export class ContextPlugin<
  T extends {
    cache?: RequestCache;
    next?: NextFetchRequestConfig;
  },
> implements StandardLinkPlugin<T>
{
  /** Unique plugin name — oRPC v2 requires it for ordering identification. */
  public readonly name = "context";

  // This plugin intentionally contributes no interceptors — it exists so the
  // link's context type carries `cache` / `next` (see PluginsContext in
  // ../index.ts). oRPC v2 passes options through `init`, so return them
  // unchanged rather than mutating in place.
  init(link: StandardLinkOptions<T>): StandardLinkOptions<T> {
    return link;
  }
}

const contextPluginDefault = {
  ContextPlugin,
};

export default contextPluginDefault;
