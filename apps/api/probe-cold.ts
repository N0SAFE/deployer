import "reflect-metadata";
const base = "/home/sebille/Bureau/projects/tests/deployer/v3/apps/api/src";
const name = process.argv[2];
const t0 = Date.now();
try { await import(`${base}/${name}`); console.log(`OK ${name} ${Date.now() - t0}ms`); }
catch (e) { console.log(`FAIL ${name} ${Date.now() - t0}ms ${e instanceof Error ? e.name : String(e)}`); }
