{{/* builder-gate-<instance> — the name of every object one instance owns. */}}
{{- define "builder-gate.name" -}}
builder-gate-{{ .name }}
{{- end -}}

{{- define "builder-gate.labels" -}}
app.kubernetes.io/name: builder-gate
app.kubernetes.io/instance: {{ include "builder-gate.name" .instance }}
app.kubernetes.io/part-of: krateo
app.kubernetes.io/version: {{ .root.Chart.Version | quote }}
krateo.io/builder-gate-for: {{ .instance.name }}
{{- end -}}
