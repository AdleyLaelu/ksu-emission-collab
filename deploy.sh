#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────
# deploy.sh — Build and deploy traffic-emission-collab to EC2
#
# Usage: ./deploy.sh [--skip-sync] [--skip-build] [--backend-only] [--frontend-only]
#
# Configuration: create a .env file in the project root with:
#   EC2_HOST=<your-ec2-ip>
#   EC2_KEY=<path-to-your-pem-file>
#   EC2_USER=ec2-user          (optional, defaults to ec2-user)
#   EC2_APP_DIR=/home/ec2-user/app  (optional)
# ──────────────────────────────────────────────────────────

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"

# Load .env if it exists
if [ -f "${PROJECT_ROOT}/.env" ]; then
  set -a
  source "${PROJECT_ROOT}/.env"
  set +a
fi

# Required config
EC2_HOST="${EC2_HOST:?'EC2_HOST not set. Add it to .env or export it.'}"
EC2_KEY="${EC2_KEY:?'EC2_KEY not set. Add path to your .pem file in .env or export it.'}"
EC2_USER="${EC2_USER:-ec2-user}"
EC2_APP_DIR="${EC2_APP_DIR:-/home/${EC2_USER}/app}"

# Resolve key path relative to project root if not absolute
if [[ "$EC2_KEY" != /* ]]; then
  EC2_KEY="${PROJECT_ROOT}/${EC2_KEY}"
fi

if [ ! -f "$EC2_KEY" ]; then
  echo "Error: SSH key not found at ${EC2_KEY}" >&2
  exit 1
fi

SSH_OPTS="-o ServerAliveInterval=15 -o ConnectTimeout=10 -o StrictHostKeyChecking=no"
SSH_CMD="ssh ${SSH_OPTS} -i ${EC2_KEY} ${EC2_USER}@${EC2_HOST}"

# Parse flags
SKIP_SYNC=false
SKIP_BUILD=false
BACKEND_ONLY=false
FRONTEND_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --skip-sync)     SKIP_SYNC=true ;;
    --skip-build)    SKIP_BUILD=true ;;
    --backend-only)  BACKEND_ONLY=true ;;
    --frontend-only) FRONTEND_ONLY=true ;;
    --help|-h)
      echo "Usage: ./deploy.sh [--skip-sync] [--skip-build] [--backend-only] [--frontend-only]"
      echo ""
      echo "Flags:"
      echo "  --skip-sync       Skip rsync, use whatever is already on EC2"
      echo "  --skip-build      Skip docker build, just restart containers"
      echo "  --backend-only    Only sync/build/restart backend"
      echo "  --frontend-only   Only sync/build/restart frontend"
      echo ""
      echo "Config (.env):"
      echo "  EC2_HOST          EC2 public IP (required)"
      echo "  EC2_KEY           Path to SSH .pem key (required)"
      echo "  EC2_USER          SSH user (default: ec2-user)"
      echo "  EC2_APP_DIR       Remote app directory (default: /home/ec2-user/app)"
      exit 0
      ;;
    *)
      echo "Unknown flag: $arg" >&2
      exit 1
      ;;
  esac
done

echo "==> Target: ${EC2_USER}@${EC2_HOST}:${EC2_APP_DIR}"
echo "==> Checking EC2 connectivity..."
${SSH_CMD} "echo 'EC2 reachable'" || { echo "Cannot reach EC2. Check key/IP."; exit 1; }

# ── Sync files ──────────────────────────────────────────
if [ "$SKIP_SYNC" = false ]; then
  RSYNC_SSH="ssh ${SSH_OPTS} -i ${EC2_KEY}"

  if [ "$BACKEND_ONLY" = false ]; then
    echo "==> Syncing frontend..."
    rsync -az --delete \
      --exclude node_modules \
      --exclude .git \
      --exclude dist \
      -e "${RSYNC_SSH}" \
      "${PROJECT_ROOT}/frontend/" \
      "${EC2_USER}@${EC2_HOST}:${EC2_APP_DIR}/frontend/"
  fi

  if [ "$FRONTEND_ONLY" = false ]; then
    echo "==> Syncing backend..."
    rsync -az --delete \
      --exclude __pycache__ \
      --exclude .venv \
      --exclude .git \
      -e "${RSYNC_SSH}" \
      "${PROJECT_ROOT}/backend/" \
      "${EC2_USER}@${EC2_HOST}:${EC2_APP_DIR}/backend/"
  fi

  echo "==> Syncing docker-compose.yml..."
  scp ${SSH_OPTS} -i "${EC2_KEY}" \
    "${PROJECT_ROOT}/docker-compose.yml" \
    "${EC2_USER}@${EC2_HOST}:${EC2_APP_DIR}/docker-compose.yml"
fi

# ── Build and deploy ────────────────────────────────────
BUILD_TARGETS=""
if [ "$BACKEND_ONLY" = true ]; then
  BUILD_TARGETS="backend"
elif [ "$FRONTEND_ONLY" = true ]; then
  BUILD_TARGETS="frontend"
fi

if [ "$SKIP_BUILD" = false ]; then
  echo "==> Building Docker images on EC2 (this takes a few minutes)..."
  ${SSH_CMD} "cd ${EC2_APP_DIR} && docker compose build ${BUILD_TARGETS} 2>&1"
fi

echo "==> Restarting containers..."
if [ -n "$BUILD_TARGETS" ]; then
  ${SSH_CMD} "cd ${EC2_APP_DIR} && docker compose up -d ${BUILD_TARGETS} 2>&1"
else
  ${SSH_CMD} "cd ${EC2_APP_DIR} && docker compose down && docker compose up -d 2>&1"
fi

echo "==> Waiting for health check..."
sleep 5
${SSH_CMD} "curl -sf http://localhost/health && echo ' OK' || echo ' FAILED'"

echo ""
echo "==> Container status:"
${SSH_CMD} "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'"

echo ""
echo "Deploy complete: http://${EC2_HOST}"
