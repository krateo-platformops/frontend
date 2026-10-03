#!/usr/bin/env bash
# The kind-cluster test of the gate's identity (#442 thin gate). The gate holds ONE grant — `get`
# on its own Builders — and judges everything else through snowplow as the caller. This proves,
# against a real API server, as the chart's own ServiceAccount:
#   - it reads its Builder, and no other;
#   - it may not create, read or list anything else (widgets, RESTActions, Secrets);
#   - with no caller token it judges nothing live, and that is red.
# Needs: a kind cluster named explicitly by KUBECONFIG_FILE and KUBE_CONTEXT (never the ambient
# context); helm; node; the gate built (dist/, JQCHECK_BIN). Creates nothing outside that cluster.
set -euo pipefail
: "${KUBECONFIG_FILE:?the kind cluster's kubeconfig}" "${KUBE_CONTEXT:?the kind cluster's context}"
kubectl() { command kubectl --kubeconfig "$KUBECONFIG_FILE" --context "$KUBE_CONTEXT" "$@"; }

GATE="$(cd "$(dirname "$0")/../.." && pwd)"
REPO="$(cd "$GATE/.." && pwd)"
WORK="$(mktemp -d)"
SNOWPLOW_REF="$(tr -d '[:space:]' < "$GATE/SNOWPLOW_REF")"
SA="system:serviceaccount:krateo-system:builder-gate-ci"

echo "::group::CRDs (frontend-crds: widgets + Builder; the RESTAction CRD at snowplow ${SNOWPLOW_REF}), namespaces, the Builders"
cp -r "$REPO/helm/frontend-crds" "$WORK/frontend-crds"
sed -i.bak 's/CHART_VERSION/0.0.0/' "$WORK/frontend-crds/Chart.yaml"
helm template frontend-crds "$WORK/frontend-crds" | kubectl apply -f - >/dev/null
curl -fsSL "https://raw.githubusercontent.com/krateo-platformops/snowplow/${SNOWPLOW_REF}/go/snowplow/crds/templates.krateo.io_restactions.yaml" | kubectl apply -f -
kubectl wait --for condition=established --timeout=120s crd --all >/dev/null
kubectl create namespace krateo-system
kubectl create namespace krateo-preview
kubectl apply -n krateo-system -f "$REPO/ui/src/builders/fixtures/portal-builder.builder.yaml"
kubectl apply -n krateo-system -f "$REPO/ui/src/builders/fixtures/blueprint-builder.builder.yaml"
echo "::endgroup::"

echo "::group::The chart: its RBAC applied, the rest server-dry-run"
cp -r "$REPO/helm/builder-gate" "$WORK/builder-gate"
sed -i.bak 's/CHART_VERSION/0.0.0/' "$WORK/builder-gate/Chart.yaml"
helm template gate "$WORK/builder-gate" --namespace krateo-system \
  --set 'instances[0].name=ci' --set 'instances[0].builders[0]=portal-builder' \
  --show-only templates/rbac.yaml | kubectl apply -f -
helm template gate "$WORK/builder-gate" --namespace krateo-system \
  --set 'instances[0].name=ci' --set 'instances[0].builders[0]=portal-builder' --set remoteMCPServer.enabled=false \
  --show-only templates/gate.yaml | kubectl apply --dry-run=server -f -
echo "::endgroup::"

echo "::group::What the gate's ServiceAccount may do"
fail=0
expect() { # expect <yes|no> <verb> <resource> [namespace] [name]
  local want="$1" verb="$2" resource="$3" ns="${4:-krateo-system}" got
  got="$(kubectl auth can-i "$verb" "$resource${5:+/$5}" -n "$ns" --as "$SA" || true)"
  if [ "$got" = "$want" ]; then echo "ok   can-i $verb $resource${5:+/$5} -n $ns = $got"; else echo "FAIL can-i $verb $resource${5:+/$5} -n $ns = $got (want $want)"; fail=1; fi
}
expect yes get builders.builders.templates.krateo.io krateo-system portal-builder
expect no  get builders.builders.templates.krateo.io krateo-system blueprint-builder
expect no  list builders.builders.templates.krateo.io
for ns in krateo-preview krateo-system; do
  expect no create tables.widgets.templates.krateo.io "$ns"
  expect no create restactions.templates.krateo.io "$ns"
  expect no get restactions.templates.krateo.io "$ns"
  expect no list flexes.widgets.templates.krateo.io "$ns"
  expect no get secrets "$ns"
  expect no list secrets "$ns"
done
[ "$fail" = 0 ] || exit 1
echo "::endgroup::"

# The gate's identity: the chart's ServiceAccount, through a kubeconfig holding its token.
TOKEN="$(kubectl -n krateo-system create token builder-gate-ci --duration=1h)"
SERVER="$(kubectl config view --minify --raw -o jsonpath='{.clusters[0].cluster.server}')"
CA="$(kubectl config view --minify --raw -o jsonpath='{.clusters[0].cluster.certificate-authority-data}')"
cat > "$WORK/gate.kubeconfig" <<YAML
apiVersion: v1
kind: Config
clusters: [{ name: kind, cluster: { server: "$SERVER", certificate-authority-data: "$CA" } }]
users: [{ name: gate, user: { token: "$TOKEN" } }]
contexts: [{ name: gate, context: { cluster: kind, user: gate } }]
current-context: gate
YAML

echo "::group::The gate, as its ServiceAccount"
node "$GATE/test/kind/assert.mjs" "$WORK/gate.kubeconfig"
LEFT="$(kubectl -n krateo-preview get flexes,piecharts,tables,restactions -o name)"
if [ -n "$LEFT" ]; then
  echo "FAIL objects appeared in krateo-preview:"; echo "$LEFT"; exit 1
fi
echo "ok   nothing was stored: krateo-preview is still empty"
echo "::endgroup::"
