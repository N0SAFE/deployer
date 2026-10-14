import z from "zod/v4";

export const slugSchema = z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Invalid slug format");

export type Slug = z.infer<typeof slugSchema>;

export interface SlugifyOptions {
    maxLength?: number;
    fallback?: string;
    trimInput?: boolean;
}

export function slugify(input: string, options: SlugifyOptions = {}): Slug {
    const {
        maxLength = 60,
        fallback = "default",
        trimInput = true,
    } = options;

    const normalizedSource = trimInput ? input.trim() : input;
    const normalized = normalizedSource
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, maxLength)
        .replace(/-+$/g, "");

    const candidate = normalized.length > 0 ? normalized : fallback;

    return slugSchema.parse(candidate);
}
