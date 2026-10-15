#!/bin/sh
set -eu

if [ -z "${MONGO_REPLICA_SET_KEY:-}" ]; then
  echo "MONGO_REPLICA_SET_KEY is required" >&2
  exit 1
fi

printf '%s' "$MONGO_REPLICA_SET_KEY" > /data/configdb/replica-set.key
chmod 400 /data/configdb/replica-set.key
chown mongodb:mongodb /data/configdb/replica-set.key

exec /usr/local/bin/docker-entrypoint.sh mongod \
  --auth --replSet rs0 --bind_ip_all --keyFile /data/configdb/replica-set.key
