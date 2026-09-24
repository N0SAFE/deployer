/**
 * The minified ExcelJS bundle ships without type declarations. The regular
 * `exceljs` entry is typed, but this path is imported first for bundle size, so
 * the shape is declared here rather than silenced with a `@ts-ignore` at the
 * import site.
 *
 * NOTE: this file is only picked up by programs whose `include` covers it.
 * `apps/web` narrows `include` to its own `src/`, so its tsconfig lists this
 * path explicitly — see `apps/web/tsconfig.json`.
 */
declare module "exceljs/dist/exceljs.min.js" {
  const exceljs: unknown;
  export default exceljs;
}
