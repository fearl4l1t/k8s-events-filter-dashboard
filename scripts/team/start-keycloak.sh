#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Lalit Krishna and contributors
#
# Starts the disposable Keycloak container and waits for the events realm.
set -euo pipefail

REALM_URL="http://127.0.0.1:8081/realms/events/.well-known/openid-configuration"

if curl -fsS "${REALM_URL}" >/dev/null 2>&1; then
  echo "Keycloak is already serving the events realm."
  exit 0
fi

docker compose up -d keycloak >/dev/null

for _ in $(seq 1 90); do
  if curl -fsS "${REALM_URL}" >/dev/null 2>&1; then
    echo "Keycloak events realm is ready."
    exit 0
  fi
  sleep 2
done

echo "Keycloak did not become ready. Check: docker compose logs keycloak" >&2
exit 1
