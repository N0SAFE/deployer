import { describe, expect, it } from "vitest";

import { getFilterEntry, matchEq, matchNullableStringEq, matchString, paginate, sortItems } from "./list-query";

describe("list query", () => {
  it("reads a filter entry only when it has an operator", () => {
    const input = { filter: { name: { operator: "like", value: "a" }, broken: { value: 1 } } };
    expect(getFilterEntry(input, "name")).toEqual({ operator: "like", value: "a" });
    expect(getFilterEntry(input, "broken" as never)).toBeUndefined();
    expect(getFilterEntry({}, "name" as never)).toBeUndefined();
  });

  it("matches strings by eq, like and ilike, and lets anything else through", () => {
    expect(matchString("Api", { operator: "eq", value: "Api" })).toBe(true);
    expect(matchString("Api", { operator: "eq", value: "api" })).toBe(false);
    expect(matchString("Api", { operator: "ilike", value: "PI" })).toBe(true);
    expect(matchString("Api", { operator: "gt", value: "z" })).toBe(true);
    expect(matchString("Api", undefined)).toBe(true);
  });

  it("matches booleans and nullable strings on eq only", () => {
    expect(matchEq(true, { operator: "eq", value: "TRUE" })).toBe(true);
    expect(matchEq("a", { operator: "eq", value: "b" })).toBe(false);
    expect(matchNullableStringEq(null, { operator: "eq", value: "x" })).toBe(false);
    expect(matchNullableStringEq("x", { operator: "ne", value: "y" })).toBe(true);
  });

  it("sorts descending by default and ascending on request, without mutating", () => {
    const items = [{ n: 1 }, { n: 3 }, { n: 2 }];
    const by = (item: { n: number }) => item.n;
    expect(sortItems(items, {}, by).map(by)).toEqual([3, 2, 1]);
    expect(sortItems(items, { sortDirection: "asc" }, by).map(by)).toEqual([1, 2, 3]);
    expect(items.map(by)).toEqual([1, 3, 2]);
  });

  it("pages and reports whether more remain", () => {
    expect(paginate([1, 2, 3, 4, 5], { limit: 2, offset: 2 })).toEqual({
      data: [3, 4],
      meta: { total: 5, limit: 2, offset: 2, hasMore: true },
    });
    expect(paginate([1, 2], { limit: 5, offset: 0 }).meta.hasMore).toBe(false);
  });
});
