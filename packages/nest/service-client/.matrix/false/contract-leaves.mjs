// packages/nest/service-client/src/contract-leaves.ts
function isProcedure(value) {
  if (typeof value !== "object" && typeof value !== "function")
    return false;
  if (value === null)
    return false;
  return "~orpc" in value;
}
function collectContractLeaves(contract, path = []) {
  if (contract === null || typeof contract !== "object")
    return [];
  const leaves = [];
  for (const [key, child] of Object.entries(contract)) {
    if (key === "~orpc")
      continue;
    if (isProcedure(child)) {
      leaves.push({ path, name: key, qualifiedName: [...path, key].join(".") });
    } else if (typeof child === "object" && child !== null) {
      leaves.push(...collectContractLeaves(child, [...path, key]));
    }
  }
  return leaves;
}
function resolveAtPath(client, path) {
  let current = client;
  for (const segment of path) {
    if (current === null || current === undefined)
      return;
    current = current[segment];
  }
  return current;
}
export {
  collectContractLeaves,
  isProcedure,
  resolveAtPath
};
