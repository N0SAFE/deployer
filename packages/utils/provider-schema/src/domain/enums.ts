import z from "zod/v4";

export const configFieldTypeSchema = z.enum([
    "text",
    "number",
    "boolean",
    "select",
    "textarea",
    "password",
    "url",
    "json",
    "array",
]);

export const conditionalOperatorSchema = z.enum(["equals", "notEquals", "in", "notIn"]);

export const providerCategorySchema = z.enum(["git", "registry", "storage", "manual", "other"]);
export const builderCategorySchema = z.enum(["container", "static", "serverless", "other"]);