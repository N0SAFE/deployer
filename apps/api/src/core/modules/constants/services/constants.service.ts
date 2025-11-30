import { EnvService } from "@/config/env/env.service";
import { Global, Injectable } from "@nestjs/common";
import FOLDER_LOCATION from "@/core/modules/constants/constants/folder-location";
import UPLOAD_FILE from "@/core/modules/constants/constants/upload-file";

// ...existing code...
type DotPrefix<P extends string, K extends string> = P extends ""
  ? K
  : `${P}.${K}`;

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (
  k: infer I
) => void
  ? I
  : never;

// New helpers to detect arrays/functions and only treat plain objects as recursive targets
type IsArray<T> = T extends readonly any[] ? true : false;
type IsFunction<T> = T extends (...args: any[]) => any ? true : false;
type IsPlainObject<T> = T extends object
  ? IsArray<T> extends true
    ? false
    : IsFunction<T> extends true
      ? false
      : true
  : false;

type Flatten<
  T extends Record<string, any>,
  P extends string = "",
> = UnionToIntersection<
  {
    [K in keyof T &
      string]: // Only recurse when the property is a plain object (not an array or function)
    IsPlainObject<T[K]> extends true
      ? { [key in DotPrefix<P, K>]: T[K] } & Flatten<T[K], DotPrefix<P, K>>
      : { [key in DotPrefix<P, K>]: T[K] };
  }[keyof T & string]
>;

// Final exported helper type used by the service
type ToObjectKeys<T extends object> = Flatten<T>;

@Global()
@Injectable()
export class ConstantsService {
  readonly constants: ReturnType<typeof this.initializeConstants>;

  constructor(private readonly envService: EnvService) {
    this.constants = this.initializeConstants();
  }

  private initializeConstants() {
    return {
      FOLDER_LOCATION: FOLDER_LOCATION(this.envService),
      UPLOAD_FILE: UPLOAD_FILE(),
    } as const;
  }

  // Update: constrain K to the keys of the flattened mapping and resolve dotted keys at runtime
  get<K extends keyof ToObjectKeys<typeof this.constants>>(
    key: K
  ): ToObjectKeys<typeof this.constants>[K] {
    const parts = String(key).split(".");
    let result: any = this.constants;
    for (const part of parts) {
      if (result == null) return undefined as any;
      result = result[part];
    }
    return result as ToObjectKeys<typeof this.constants>[K];
  }
}
