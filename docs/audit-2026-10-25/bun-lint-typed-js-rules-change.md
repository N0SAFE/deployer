# Making typed JavaScript lint rules possible in Bun: the change, and where it goes

Follow-up to [`bun-lint-type-information.md`](./bun-lint-type-information.md).
That document established the behaviour; this one is the code change that would
remove it. It is **implemented in the clone** (`~/Bureau/projects/self-hosted/bun`,
working tree dirty) and not upstreamed.

Clone used: `~/Bureau/projects/self-hosted/bun`, `git clone --depth 1`, HEAD
`449877f3` (2026-10-25), i.e. newer than the 2026-10-24 canary tested earlier.

---

## 1. The single line that decides the behaviour

`src/jsc/bindings/LintSourceCode.cpp:354-384`, `jsLintSourceCodeParserServices`:

```cpp
services = constructEmptyObject(vm, state.servicesStructure.get());
PropertyOffset offset = 0;
for (auto *name : {&state.emitDecoratorMetadata, &state.experimentalDecorators, &state.isolatedDeclarations}) {
    JSValue option = options.get(globalObject, *name);
    services->putDirectOffset(vm, offset++, jsBoolean(option.isTrue()));
}
services->putDirectOffset(vm, offset++, jsNull());                                  // ← `program`, line 380
services->putDirectOffset(vm, offset++, JSWeakMap::create(vm, globalObject->weakMapStructure()));
services->putDirectOffset(vm, offset++, JSWeakMap::create(vm, globalObject->weakMapStructure()));
```

`program` is hardcoded to `null` and both node maps are empty. That is the whole
gap: the checker is not missing, it is simply not wired to the JS side.

## 2. What already exists (so the patch is a bridge, not a type checker)

| Piece | Where |
|---|---|
| The checker attached to a linted file | `File.types: Option<types::Checker>` — `src/lint/ast/mod.rs:259` |
| Accessors | `File::types() -> Option<Types>` and `File::type_checker() -> Types` — `src/lint/ast/mod.rs:346-360` |
| TypeScript-shaped API | `Types` — `src/lint/types/mod.rs:321,383` (`ts.Program` + `ts.TypeChecker`), `Type` (`ty.rs`), `TsSymbol` (`symbol.rs`), `Signature`, `TsNode` (`node.rs`) |
| ESTree handle → `ts.Node` | `Locate` — `src/lint/types/locate.rs:34`, `impl Locate for Node` at `:231` |
| The queries a rule needs | `Types::get_type_at_location` (`mod.rs:438`), `Type::flags` / `has_flags` / `to_text` / `types` (`ty.rs:314,325,623,361`), `TypeFlags` (`src/sema/check/services/vocabulary.rs:14`, a `bitflags` over `u32`), `TsSymbol::name` (`symbol.rs:148`) |
| Typed files already run JS rules | `types::with_file_and_modules` (`mod.rs:525-557`) builds `File::new(..., Some(types))`; called from `driver/typed.rs:384+`; the linter then calls `host.run_on_block(file, …)` (`js_plugin/host.rs:571`) with that `File` |
| The wire into the worker | `wire.rs` `ask` 1..=18, served in `host.rs:625-700` (`serve` closure, `file` in scope); JS side `native.askText/askWords` (`worker/main.js:108-120`) |
| Node identity across the wire | `Numbered.nodes: Vec<VNode>` (`js_plugin/ast.rs:139`), index == the JS `nodes[i]`; `VNode { base: Node<'a>, part }` (`estree/vnode.rs:18`) |
| Where a rule is retired for asking types | `host.rs:318-345` (`asks_for_types`, `has_asked_for_types`) and `driver/run.rs:1150-1175` (the "cannot use type information" notice) |

So the checker runs already for `--type-aware`; only the three `parserServices`
slots are empty.

## 3. Patch sketch (6 files, ~150 lines)

**`src/lint/js_plugin/wire.rs`** — one new request kind:

```rust
/// JSON `{ op, node }` / `{ op, type }` / `{ op, symbol }`. Returns JSON.
pub(crate) const CHECKER: u32 = 19;
```

**`src/lint/estree/vnode.rs`** — expose the underlying AST handle:

```rust
#[inline]
pub(crate) fn base(self) -> Node<'a> { self.base }
```

**`src/lint/js_plugin/checker.rs`** (new) — the bridge; `nodes` is the numbered
view already built for scopes/code paths:

```rust
pub(super) fn answer(file: &File<'_>, nodes: Option<&Numbered<'_>>, details: &[u8], out: &mut Vec<u8>) {
    let types = file.type_checker();            // on an untyped file every query returns the error type
    let (op, at) = decode(details);             // { op, node } or { op, type }
    match op {
        "typeAt"    => json(out, types.get_type_at_location(nodes[at].base()).to_text()),
        "typeFlags" => json(out, types.get_type_at_location(nodes[at].base()).flags().bits()),
        "typeArgs"  => json(out, types.get_type_at_location(nodes[at].base()).types().iter().map(|t| t.to_text()).collect()),
        "symbolAt"  => json(out, nodes[at].base().ts_node().get_symbol_at_location().map(|s| s.name())),
        _ => out.extend_from_slice(b"null"),
    }
}
```

**`src/lint/js_plugin/host.rs`** — two changes:</br>
`serve`: `ask::CHECKER => checker::answer(file, nodes.as_ref(), details, out),`
and stop retiring the rule when the file *had* a checker:

```rust
pub fn asks_for_types(&self, rule: &Arc<Rule>, thrown: &[u8]) -> bool {
    // ... unchanged message check ...
}
// in the linter: only treat it as unhandleable when `file.types().is_none()`
```

**`src/jsc/bindings/LintSourceCode.h` / `.cpp`** — one more hook, and use it:

```cpp
WriteBarrier<JSObject> types;   // the program facade, or null
```

```cpp
// jsLintSourceCode(), where the hooks array is read:
for (auto *hook : {&state.program, &state.scopeManager, &state.parserOptions, &state.types}) { … }
```

```cpp
// jsLintSourceCodeParserServices(), replacing line 380:
services->putDirectOffset(vm, offset++, callHook(globalObject, state.types));
```

**`src/lint/js_plugin/worker/main.js`** — build the facade and pass it as the
fifth hook:

```js
const CHECKER = 19;
const ask = details => JSON.parse(native.askText(CHECKER, JSON.stringify(details)));

const index = new WeakMap();                       // filled when the tree is built
const checker = {
  getTypeAtLocation: node => ask({ op: "typeAt", node: index.get(node) }),
  typeToString: type => type,                      // already text over the wire, or a second call
  getSymbolAtLocation: node => ask({ op: "symbolAt", node: index.get(node) }),
};

const program = {
  getTypeChecker: () => checker,
  getCompilerOptions: () => ({}),
  getSourceFiles: () => [],
};

const SourceCode = native.sourceCode(native.TokenStore, [
  program, scopeManager, parserOptionsOf, oxlintScopeManager, () => program,
]);
```

with `parserServices` built from that hook (`{ program, esTreeNodeToTSNodeMap,
tsNodeToESTreeNodeMap }`), replacing the C++-constructed object.

**Tests** — `test/cli/lint/js-plugins.test.ts:1821` asserts `program == null`
today; that assertion becomes "a typed file exposes a checker, an untyped file
still gets `null`".

## 4. What this buys, and what it does not

- The bridge is **incremental**: implement `getTypeAtLocation` + `typeToString`
  and a rule can already read a yield type's error channel — which is the whole
  requirement for `no-unhandled-effect-error`. Unknown ops keep the current
  behaviour (throw `You have used a rule which requires …`, rule retired, exit 2
  notice).
- Full typescript-eslint compatibility needs two more things, and this is the
  real cost:
  1. **A wider checker surface** — the Rust side has it all (`src/lint/types/*`),
     so it is encoding work per method, not analysis.
  2. **Real `ts.Node` objects**. Many rules import `typescript` themselves and
     call `ts.isCallExpression(mappedNode)` on what `esTreeNodeToTSNodeMap.get()`
     returns. An opaque handle survives `checker.*` calls but not `ts.*` ones.
     Covering that means either shipping a `node`/`type` shim per kind, or the
     other design: when a rule asks for types, run the project's `typescript` +
     `typescript-estree` in the worker and hand out their real `Program`/maps —
     much heavier (a second parse per file) but exactly compatible.

Recommendation if this is ever upstreamed: ship the bridge with the small op set
(design A), and keep `--native-plugin-rules=@typescript-eslint` as the answer for
rules that need the full `typescript` runtime (design B). That is enough for a
project-local rule such as ours, at a fraction of the cost.

## 5. Implemented in the clone

Working tree of `~/Bureau/projects/self-hosted/bun`, `HEAD 449877f3`, nine files:

| File | Change |
|---|---|
| `src/lint/js_plugin/checker.rs` (new) | The bridge. Per-file handle registries for `Type`/`TsSymbol`/`TsNode`, 25 ops (`TYPE_AT…TS_CONTEXTUAL`), each answered from the `File`'s checker. Documents the request format (`"<op>,<a>[,<b>]"`) and the mapping to `ts.TypeChecker` members |
| `src/lint/js_plugin/ts_syntax_kind.rs` (new) | Generated table: Bun's `Kind` → **TypeScript's** `SyntaxKind` number, joined by name (346 of 351). Without it `ts.isCallExpression(node)` cannot be true, because the two enums are numbered differently |
| `src/lint/js_plugin/wire.rs` | `ask::CHECKER = 19` |
| `src/lint/js_plugin/mod.rs` | `mod checker;` |
| `src/lint/js_plugin/host.rs` | `Handles` per file in `run_in`, `ask::CHECKER` arm |
| `src/lint/estree/vnode.rs` | `VNode::base()` — the AST handle a node number stands for |
| `src/lint/linter/mod.rs` | a rule is retired for asking types only when the file has **no** checker |
| `src/lint/driver/run.rs` | a file whose config asks for types **and** enables any JavaScript rule is type checked, so the bridge is reachable |
| `src/jsc/bindings/LintSourceCode.h` | `types` hook (`WriteBarrier<JSObject>`) + GC visit |
| `src/jsc/bindings/LintSourceCode.cpp` | fifth hook in `sourceCode(TokenStore, hooks)`; `parserServices` uses the hook's object when it returns one, else the old null-`program` shape |
| `src/lint/js_plugin/worker/main.js` | `ts.Program`/`ts.TypeChecker`/`ts.Type`/`ts.Symbol` views over handles, `parserServicesOfFile()`, `esTreeNodeToTSNodeMap` = identity (the ESTree node *is* the handle) |
| `test/cli/lint/js-plugins.test.ts` | one test: a rule on a typed file reads `getTypeAtLocation(...)` and reports `object,false,0` |

Shape of the JS side, which is what "the tsc API" means here:

```js
services.program                 // { getTypeChecker, getCompilerOptions, getSourceFiles }
services.program.getTypeChecker()  // getTypeAtLocation, getSymbolAtLocation, getTypeOfSymbolAtLocation,
                                   // getContextualType, isTypeAssignableTo, getPropertiesOfType,
                                   // getBaseTypes, typeToString — either node form is accepted
type.flags        // Bun's numbering (differs from TypeScript 5's)
type.kind         // KIND_UNION | KIND_INTERSECTION | KIND_NEVER | KIND_ANY | KIND_UNKNOWN | KIND_OTHER
type.isUnion() / type.isIntersection()
type.getTypeArguments() / type.getProperties() / type.getBaseTypes() / type.getSymbol()
symbol.getName() / symbol.flags / symbol.getTypeAtLocation()

services.esTreeNodeToTSNodeMap.get(node)   // a `ts.Node` handle: kind (TS number), getText(),
                                           // parent, getChildren(), type
services.tsNodeToESTreeNodeMap.get(tsNode) // back to the ESTree node of this file

```

### Verification

- `cargo check -p bun_lint` — **passes** (whole crate, including the new module
  and the linter gating).
- `node --check` on the concatenated worker sources — **passes**.
- Not verified here: the C++ build and `test/cli/lint/*` need a full Bun build
  (`bun run build`), which is a WebKit + Rust link and was not run.
- `parserServices.flags` returns Bun's flag numbering, not TypeScript's, so a rule
  comparing `type.flags & ts.TypeFlags.Union` gets a wrong answer; that is why
  `kind`/`isUnion()` exist. A `ts.TypeFlags`-compatible numbering would need Bun's
  bits mapped through a table.
- `ts.Node.kind` IS TypeScript's number (the generated table), so `ts.isCallExpression(node)` works. The **fields** of
  a node of a given kind (`expression`, `arguments`, `name`, …) are not exposed yet: a rule that reads one gets
  `undefined`. That is the next layer, and it is per node kind (~200), not per API member.
- Bun's `Kind` has 351 entries against TypeScript 6's 390 and lacks `ShebangTrivia`, so the two enums drift by one from
  there on. The table joins them by name; five typescript-go-only kinds (`JSDocCommentTextToken`, `ImmediateKeyword`,
  `JSDocUnknownTag`, `JSTypeAliasDeclaration`, `JSImportDeclaration`) have no TypeScript 6 name and report `Unknown`.

## 6. Effort

| Step | Size |
|---|---|
| `CHECKER` wire kind + `checker.rs` with 5-6 ops | ~80 lines Rust |
| `VNode::base`, `Numbered` access, hook plumbing | ~20 lines Rust/C++ |
| Worker facade + maps | ~40 lines JS |
| Tests | ~30 lines |
| Build + run Bun's lint suite | the long part (C++/Rust rebuild, `test/cli/lint/*`) |

No change to the checker itself, the parser, or the ESTree layer.
