# PoC — a Nest module tree that knows its Effect services

Working proof of the design in [ARCHITECTURE.md](./ARCHITECTURE.md): `createModuleContext`
that unions what a module provides, derives what its layers require, fails to compile when
the requirement has no provider at that point of the tree, and prints the providers per node.

```bash
bun install
bun run check        # tsc (incl. two live @ts-expect-error proofs) + bun test
bun run demo         # prints the tree and the boot report
```

The point in one rule: a module may only `yield*` what it provides or explicitly assumes,
and a `Layer`'s `RIn` must be satisfied where the layer is declared — by importing the
module that provides it. No app-wide layer list, no boot check: the module definition is the
contract.
