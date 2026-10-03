#!/usr/bin/env bash
# The kind-cluster test of the live dry-run (#444 (d)). Needs: a kind cluster, named explicitly
# by KUBECONFIG_FILE and KUBE_CONTEXT (never the ambient context); helm; node; the gate built
# (dist/, JQCHECK_BIN). Creates nothing outside that cluster.
set -euo pipefail
: "${KUBECONFIG_FILE:?the kind cluster's kubeconfig}" "${KUBE_CONTEXT:?the kind cluster's context}"
kubectl() { command kubectl --kubeconfig "$KUBECONFIG_FILE" --context "$KUBE_CONTEXT" "$@"; }

GATE="$(cd "$(dirname "$0")/../.." && pwd)"
REPO="$(cd "$GATE/.." && pwd)"
SNOWPLOW_REF="$(tr -d '[:space:]' < "$GATE/SNOWPLOW_REF")"
WORK="$(mktemp -d)"

echo "::group::CRDs: frontend-crds (this repo) and the RESTAction CRD (snowplow ${SNOWPLOW_REF})"
cp -r "$REPO/helm/frontend-crds" "$WORK/frontend-crds"
sed -i.bak 's/CHART_VERSION/0.0.0/' "$WORK/frontend-crds/Chart.yaml"
helm template frontend-crds "$WORK/frontend-crds" | kubectl apply -f - >/dev/null
curl -fsSL "https://raw.githubusercontent.com/krateo-platformops/snowplow/${SNOWPLOW_REF}/go/snowplow/crds/templates.krateo.io_restactions.yaml" | kubectl apply -f -
kubectl wait --for condition=established --timeout=120s crd --all >/dev/null
echo "::endgroup::"

echo "::group::Namespaces, the Portal Builder, an existing widget, and the chart's RBAC"
kubectl create namespace krateo-system
kubectl create namespace krateo-preview
kubectl apply -n krateo-system -f "$REPO/ui/src/builders/fixtures/portal-builder.builder.yaml"
kubectl apply -f - <<YAML
apiVersion: widgets.templates.krateo.io/v1beta1
kind: PieChart
metadata: { name: existing-pie, namespace: krateo-system }
spec:
  widgetData: { data: [], angleField: count, colorField: phase }
YAML
cp -r "$REPO/helm/builder-gate" "$WORK/builder-gate"
sed -i.bak 's/CHART_VERSION/0.0.0/' "$WORK/builder-gate/Chart.yaml"
helm template gate "$WORK/builder-gate" --namespace krateo-system \
  --set 'instances[0].name=ci' --set 'instances[0].builders[0]=portal-builder' \
  --show-only templates/rbac.yaml | kubectl apply -f -
# The rest of the chart (Deployment, Service) must be accepted by a real API server too.
helm template gate "$WORK/builder-gate" --namespace krateo-system \
  --set 'instances[0].name=ci' --set 'instances[0].builders[0]=portal-builder' --set remoteMCPServer.enabled=false \
  --show-only templates/gate.yaml | kubectl apply --dry-run=server -f -
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

echo "::group::Granted: the chart's Role in place"
node "$GATE/test/kind/assert.mjs" granted "$WORK/gate.kubeconfig"
echo "::endgroup::"

# Every request above was a dry run: the sandbox must still be empty.
LEFT="$(kubectl -n krateo-preview get flexes,piecharts,tables,restactions -o name)"
if [ -n "$LEFT" ]; then
  echo "FAIL the dry run stored objects in krateo-preview:"; echo "$LEFT"; exit 1
fi
echo "ok   the dry run stored nothing: krateo-preview is still empty"

echo "::group::Forbidden: the dry-run Role removed"
kubectl -n krateo-preview delete role builder-gate-ci-dry-run
node "$GATE/test/kind/assert.mjs" forbidden "$WORK/gate.kubeconfig"
echo "::endgroup::"
