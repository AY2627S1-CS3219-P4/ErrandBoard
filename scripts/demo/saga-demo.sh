#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
scenario="${1:-all}"

if [[ "$scenario" == "--help" || "$scenario" == "help" ]]; then
  node "$repo_root/scripts/demo/run.mjs" --help
  exit 0
fi
if [[ "${2:-}" != "" ]]; then
  echo "Specify one scenario, or 'all'." >&2
  exit 2
fi

command -v docker >/dev/null || { echo "Docker is required." >&2; exit 1; }
command -v openssl >/dev/null || { echo "OpenSSL is required." >&2; exit 1; }
command -v node >/dev/null || { echo "Node.js 22 or newer is required." >&2; exit 1; }
node "$repo_root/scripts/demo/run.mjs" --validate "$scenario"
docker info >/dev/null || { echo "Docker Desktop must be running." >&2; exit 1; }

# These credentials belong only to this disposable Compose project. Do not
# source .env, print credentials, or let Compose load .env implicitly.
export MONGO_ROOT_PASSWORD="$(openssl rand -hex 24)"
export MONGO_USER_SERVICE_PASSWORD="$(openssl rand -hex 24)"
export MONGO_SUPPLIER_SERVICE_PASSWORD="$(openssl rand -hex 24)"
export MONGO_ORDER_SERVICE_PASSWORD="$(openssl rand -hex 24)"
export MONGO_CREDIT_SERVICE_PASSWORD="$(openssl rand -hex 24)"
export MONGO_REPLICA_SET_KEY="$(openssl rand -hex 48)"
export RABBITMQ_DEFAULT_USER="demo"
export RABBITMQ_DEFAULT_PASS="$(openssl rand -hex 24)"
export JWT_SECRET="$(openssl rand -hex 48)"
export CREDIT_INTERNAL_API_KEY="$(openssl rand -hex 32)"
export ORDER_CREDIT_API_KEY="$(openssl rand -hex 32)"
export DEMO_CONTROL_TOKEN="$(openssl rand -hex 32)"

demo_project="errandboard-demo-$$-$(openssl rand -hex 3)"
compose=(docker compose --project-name "$demo_project" --env-file /dev/null
  -f "$repo_root/compose.yaml" -f "$repo_root/compose.demo.yaml")

cleanup() {
  local result=$?
  trap - EXIT INT TERM HUP
  echo "Cleaning up isolated demo project $demo_project (including its temporary volumes)."
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  exit "$result"
}
trap cleanup EXIT INT TERM HUP

"${compose[@]}" config --quiet
echo "Starting isolated demo project $demo_project. Normal Compose containers are untouched."
"${compose[@]}" up -d --build
DEMO_PROJECT="$demo_project" node "$repo_root/scripts/demo/run.mjs" "$scenario"
