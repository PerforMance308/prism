{{- define "openobs.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "openobs.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "openobs.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" -}}
{{- end -}}

{{- define "openobs.selectorLabels" -}}
app.kubernetes.io/name: {{ include "openobs.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "openobs.labels" -}}
helm.sh/chart: {{ include "openobs.chart" . }}
{{ include "openobs.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "openobs.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "openobs.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "openobs.secretName" -}}
{{- if .Values.existingSecret -}}
{{- .Values.existingSecret -}}
{{- else -}}
{{- include "openobs.fullname" . -}}
{{- end -}}
{{- end -}}

{{- define "openobs.corsOrigins" -}}
{{- if .Values.env.CORS_ORIGINS -}}
{{- .Values.env.CORS_ORIGINS -}}
{{- else if and .Values.ingress.enabled .Values.ingress.hosts -}}
{{- $origins := list -}}
{{- $scheme := ternary "https" "http" (gt (len .Values.ingress.tls) 0) -}}
{{- range .Values.ingress.hosts -}}
{{- if .host -}}
{{- $origins = append $origins (printf "%s://%s" $scheme .host) -}}
{{- end -}}
{{- end -}}
{{- if gt (len $origins) 0 -}}
{{- join "," $origins -}}
{{- else -}}
http://localhost
{{- end -}}
{{- else -}}
http://localhost
{{- end -}}
{{- end -}}
