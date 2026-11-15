#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Lalit Krishna and contributors
#
# Removes the disposable integration cluster.
set -euo pipefail

CLUSTER_NAME="${KIND_CLUSTER_NAME:-k8s-events}"
KIND_BIN="${KIND_BIN:-kind}"

if command -v "${KIND_BIN}" >/dev/null 2>&1 && "${KIND_BIN}" get clusters | grep -qx "${CLUSTER_NAME}"; then
  "${KIND_BIN}" delete cluster --name "${CLUSTER_NAME}"
else
  echo "kind cluster ${CLUSTER_NAME} does not exist."
fi
