#!/bin/bash

# Fix Traefik labels for spoon-knife service
# This script updates the project-http container with correct Traefik labels

PROJECT_ID="27c3ad1e-d5d7-4afb-9e8b-27646a387268"
CONTAINER_NAME="project-http-${PROJECT_ID}"
DOMAIN="spoon-knife.my-blog.localhost"
NETWORK="deployer_app_network_dev"

echo "🔧 Fixing Traefik labels for ${CONTAINER_NAME}..."

# Stop the container
echo "Stopping container..."
docker stop ${CONTAINER_NAME}

# Update container labels (requires recreating)
echo "Recreating container with correct labels..."

# Get current container config
VOLUME=$(docker inspect ${CONTAINER_NAME} | jq -r '.[0].Mounts[0].Name')
IMAGE=$(docker inspect ${CONTAINER_NAME} | jq -r '.[0].Config.Image')

# Remove old container
docker rm ${CONTAINER_NAME}

# Create new container with correct labels
docker run -d \
  --name ${CONTAINER_NAME} \
  --network ${NETWORK} \
  --label "deployer.project_server=${PROJECT_ID}" \
  --label "traefik.enable=true" \
  --label "traefik.docker.network=${NETWORK}" \
  --label "traefik.http.routers.project-${PROJECT_ID}.rule=Host(\`${DOMAIN}\`)" \
  --label "traefik.http.services.project-${PROJECT_ID}.loadbalancer.server.port=80" \
  --restart on-failure \
  -v ${VOLUME}:/srv/static:rw \
  -v ${VOLUME}:/etc/lighttpd/conf.d:rw \
  --health-cmd="wget --quiet --tries=1 --spider http://127.0.0.1:80/ || exit 1" \
  --health-interval=30s \
  --health-timeout=10s \
  --health-retries=3 \
  --health-start-period=40s \
  ${IMAGE} \
  sh -c '
    mkdir -p /var/www/html
    echo "<h1>Service Starting...</h1><p>Deployment in progress...</p>" > /var/www/html/index.html
    cat > /etc/lighttpd/conf.d/00-network.conf << EOF
server.use-ipv6 = "enable"
server.bind = "0.0.0.0"
EOF
    exec /usr/sbin/lighttpd -D -f /etc/lighttpd/lighttpd.conf
  '

echo "✅ Container recreated with correct Traefik labels!"
echo ""
echo "New Traefik rule: Host(\`${DOMAIN}\`)"
echo "Test with: curl http://${DOMAIN}/"
echo ""
echo "Wait a few seconds for Traefik to detect the changes..."
sleep 5

# Verify
echo "Checking Traefik router..."
curl -s http://localhost:8095/api/http/routers | python3 -m json.tool | grep -A 3 "project-${PROJECT_ID}"
