#!/usr/bin/env bash
# End-to-end check of the mesh agent with REAL WireGuard, without touching the host.
#
# Each agent runs in its own container network namespace (NET_ADMIN on a private
# bridge, NOT the host network), so the WireGuard interfaces it creates live and die
# with the containers. It proves the properties unit tests cannot:
#
#   1. a real kernel handshake between two agents, and traffic over mesh addresses;
#   2. admission by a NON-founding member (C joins through B);
#   3. a setting written on one member reaching every member by gossip;
#   4. losing the founder: B still admits D, and D reaches C over the mesh.
#
# Usage:  apps/mesh-agent/scripts/e2e-netns.sh   (builds deployer-mesh-agent:dev first)
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
NET=mesh-e2e
IMAGE=deployer-mesh-agent:dev
CTL=$(mktemp -d)
trap 'for n in a b c d; do docker rm -f mesh-$n >/dev/null 2>&1 || true; docker volume rm mesh-$n-state mesh-$n-run >/dev/null 2>&1 || true; done; docker network rm $NET >/dev/null 2>&1 || true; rm -rf "$CTL"' EXIT

docker build -q -f "$ROOT/infra/docker/builder/mesh-agent/Dockerfile.mesh-agent" -t "$IMAGE" "$ROOT" >/dev/null
docker network create "$NET" >/dev/null

cat > "$CTL/ctl.ts" <<'EOF'
const [method, route, body] = process.argv.slice(2);
const res = await fetch(`http://agent${route}`, { method, unix: "/run/deployer-mesh/agent.sock", headers: { "content-type": "application/json" }, body: body ?? undefined });
if (!res.ok) { console.error(await res.text()); process.exit(1); }
console.log(await res.text());
EOF

ctl() { local n=$1; shift; docker run --rm -v "mesh-$n-run:/run/deployer-mesh" -v "$CTL/ctl.ts:/ctl.ts:ro" oven/bun:1.4.2-alpine bun /ctl.ts "$@"; }
field() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }
start() {
	docker run -d --name "mesh-$1" --network "$NET" --cap-add NET_ADMIN \
		-e MESH_AGENT_STUN_SERVERS= -e "MESH_AGENT_NODE_NAME=node-$1" -e MESH_AGENT_TICK_MS=1000 \
		-v "mesh-$1-state:/var/lib/deployer-mesh" -v "mesh-$1-run:/run/deployer-mesh" "$IMAGE" >/dev/null
	sleep 1
}
join_via() {
	local cid req adm
	cid=$(ctl "$1" GET /v1/status | field 'd["cluster"]["clusterId"]')
	req=$(ctl "$2" POST /v1/join-request "{\"clusterId\":\"$cid\",\"cidr\":\"100.88.0.0/16\",\"name\":\"node-$2\"}")
	adm=$(ctl "$1" POST /v1/admissions "{\"request\":$req}")
	ctl "$2" POST /v1/join "$(echo "$adm" | field 'json.dumps({"roster": d["roster"]})')" >/dev/null
}
address() { ctl "$1" GET /v1/status | field 'd["cluster"]["address"]'; }
members() { ctl "$1" GET /v1/status | field 'len(d["members"])'; }
expect() { if [ "$2" != "$3" ]; then echo "FAIL: $1 (expected $3, got $2)"; exit 1; fi; echo "ok: $1"; }

start a; start b
ctl a POST /v1/cluster '{"name":"node-a"}' >/dev/null
join_via a b
sleep 4
docker exec mesh-a ping -c 2 -W 2 "$(address b)" >/dev/null
echo "ok: real WireGuard link a <-> b"

start c; join_via b c
ctl c PUT /v1/settings '{"key":"e2e.flag","value":true}' >/dev/null
sleep 6
for n in a b c; do expect "member $n sees 3 members" "$(members $n)" 3; done
expect "setting written on c reached a" "$(ctl a GET /v1/settings | field 'd.get("e2e.flag")')" True

docker stop mesh-a >/dev/null
start d; join_via b d
sleep 6
docker exec mesh-d ping -c 2 -W 3 "$(address c)" >/dev/null
echo "ok: founder gone, b admitted d, d reaches c"
echo "PASS"
