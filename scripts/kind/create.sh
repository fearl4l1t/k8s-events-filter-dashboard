#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Lalit Krishna and contributors
#
# Creates the disposable kind cluster used by the integration and browser
# gates. The cluster is never used by the product itself.
set -euo pipefail

CLUSTER_NAME="${KIND_CLUSTER_NAME:-k8s-events}"
KIND_BIN="${KIND_BIN:-kind}"
NODE_IMAGE="${KIND_NODE_IMAGE:-kindest/node:v1.34.0}"

if ! command -v "${KIND_BIN}" >/dev/null 2>&1; then
  echo "kind is not installed. Install it from https://kind.sigs.k8s.io/ and retry." >&2
  exit 1
fi

if "${KIND_BIN}" get clusters | grep -qx "${CLUSTER_NAME}"; then
  echo "kind cluster ${CLUSTER_NAME} already exists."
else
  "${KIND_BIN}" create cluster --name "${CLUSTER_NAME}" --image "${NODE_IMAGE}" --wait 120s
fi

kubectl config use-context "kind-${CLUSTER_NAME}" >/dev/null
kubectl create namespace events-explorer --dry-run=client -o yaml | kubectl apply -f - >/dev/null
echo "kind cluster kind-${CLUSTER_NAME} is ready."
