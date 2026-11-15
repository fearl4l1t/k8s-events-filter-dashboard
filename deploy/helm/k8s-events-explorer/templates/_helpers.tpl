{{/* SPDX-License-Identifier: Apache-2.0 */}}
{{/* Copyright 2026 Lalit Krishna and contributors */}}
{{- define "k8s-events-explorer.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "k8s-events-explorer.fullname" -}}
{{- printf "%s-%s" .Release.Name (include "k8s-events-explorer.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "k8s-events-explorer.labels" -}}
app.kubernetes.io/name: {{ include "k8s-events-explorer.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "k8s-events-explorer.serviceAccountName" -}}
{{- printf "%s" (include "k8s-events-explorer.fullname" .) -}}
{{- end -}}
