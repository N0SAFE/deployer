echo '=== All running containers ==='
 docker ps --format 'ID={{.ID}}\tNAME={{.Names}}\tIMAGE={{.Image}}\tSTATUS={{.Status}}\tLABELS={{.Labels}}'

# Find key containers
NGINX_ID=$(docker ps --filter "label=deployer.nginx.static=true" --format "{{.ID}}" | head -n1)
NGINX_NAME=$(docker ps --filter "label=deployer.nginx.static=true" --format "{{.Names}}" | head -n1)
TRAEFIK_ID=$(docker ps --filter "ancestor=traefik" --format "{{.ID}}" | head -n1)
TRAEFIK_NAME=$(docker ps --filter "ancestor=traefik" --format "{{.Names}}" | head -n1)
# Fallback for traefik by name
if [ -z "$TRAEFIK_ID" ]; then
  TRAEFIK_ID=$(docker ps --filter "name=traefik" --format "{{.ID}}" | head -n1)
  TRAEFIK_NAME=$(docker ps --filter "name=traefik" --format "{{.Names}}" | head -n1)
fi
# Find API container heuristics: look for 'api' in name or image
API_ID=$(docker ps --format "{{.ID}}\t{{.Names}}\t{{.Image}}" | awk '/api|nestjs|deployer-api/{print $1; exit}')
API_NAME=$(docker ps --format "{{.ID}}\t{{.Names}}\t{{.Image}}" | awk '/api|nestjs|deployer-api/{print $2; exit}')

echo '\n=== Detected containers ==='
[ -n "$NGINX_ID" ] && echo "NGINX: $NGINX_NAME ($NGINX_ID)" || echo "NGINX: not found"
[ -n "$TRAEFIK_ID" ] && echo "TRAEFIK: $TRAEFIK_NAME ($TRAEFIK_ID)" || echo "TRAEFIK: not found"
[ -n "$API_ID" ] && echo "API: $API_NAME ($API_ID)" || echo "API: not found via heuristics"

# Inspect networks and labels for each
if [ -n "$NGINX_ID" ]; then
  echo '\n--- nginx: inspect networks and labels ---'
  docker inspect --format '{{json .NetworkSettings.Networks}}' "$NGINX_ID" | jq || docker inspect "$NGINX_ID" --format '{{json .NetworkSettings.Networks}}'
  echo '\n-- labels --'
  docker inspect --format '{{json .Config.Labels}}' "$NGINX_ID" | jq || docker inspect "$NGINX_ID" --format '{{json .Config.Labels}}'
  echo '\n-- tail nginx logs (last 500 lines) --'
  docker logs --tail 500 "$NGINX_ID" || true
  echo '\n-- list mounted web files --'
  docker exec "$NGINX_NAME" sh -c 'ls -la /usr/share/nginx/html || true'
fi

if [ -n "$TRAEFIK_ID" ]; then
  echo '\n--- traefik: inspect networks and labels ---'
  docker inspect --format '{{json .NetworkSettings.Networks}}' "$TRAEFIK_ID" | jq || docker inspect "$TRAEFIK_ID" --format '{{json .NetworkSettings.Networks}}'
  echo '\n-- traefik logs (last 500 lines) --'
  docker logs --tail 500 "$TRAEFIK_ID" || true
  echo '\n-- traefik dynamic files referencing static-demo --'
  docker exec "$TRAEFIK_NAME" sh -c "ls -la /etc/traefik/dynamic || true; grep -nR \"static-demo\" /etc/traefik/dynamic || true"
  echo '\n-- traefik access log tail (if exists) --'
  docker exec "$TRAEFIK_NAME" sh -c 'tail -n 200 /etc/traefik/logs/access.log || true'
fi

if [ -n "$API_ID" ]; then
  echo '\n--- API server: inspect networks and labels ---'
  docker inspect --format '{{json .NetworkSettings.Networks}}' "$API_ID" | jq || docker inspect "$API_ID" --format '{{json .NetworkSettings.Networks}}'
  echo '\n-- API logs (last 500 lines) --'
  docker logs --tail 500 "$API_ID" || true
fi

# From Traefik container: attempt to fetch the site via container name and by IP
if [ -n "$TRAEFIK_NAME" ] && [ -n "$NGINX_NAME" ]; then
  echo '\n--- In-container (Traefik) fetch to nginx by name and by IP ---'
  docker exec "$TRAEFIK_NAME" sh -c "(wget -S -T 5 -O- http://$NGINX_NAME/ 2>&1 || true)"
  # Inspect nginx container IP
  NGINX_IP=$(docker inspect --format '{{range $k,$v := .NetworkSettings.Networks}}{{$v.IPAddress}}{{end}}' "$NGINX_ID")
  echo "\n-- In-container fetch to nginx by IP ($NGINX_IP) --"
  docker exec "$TRAEFIK_NAME" sh -c "(wget -S -T 5 -O- http://$NGINX_IP/ 2>&1 || true)"
fi

# Host-level curl to domain
echo '\n--- Host curl to http://static-demo.blog.localhost/ ---'
curl -v --max-time 10 http://static-demo.blog.localhost/ 2>&1 || true

# Show any docker events for the deployer namespace in the last minute to see recent create/remove
echo '\n--- Recent docker events (last 2 minutes) filtered by "nginx" or "traefik" or "deployer" ---'
docker events --since 2m --filter 'type=container' --filter 'event=create' --filter 'event=start' 2>/dev/null | tail -n 200 || true

echo '\n=== diagnostics done ==='