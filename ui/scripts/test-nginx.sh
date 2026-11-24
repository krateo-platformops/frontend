#!/usr/bin/env bash
# What ui/nginx.conf ANSWERS, asked of the real server: the image the Dockerfile ships on, with this
# config, its boot hook and a stand-in app. Reading the config cannot say which location wins.
#   ui/scripts/test-nginx.sh [image]      Exit code = wrong answers.
set -euo pipefail
cd "$(dirname "$0")/.."
IMAGE=${1:-$(awk '/^FROM nginxinc/{print $2; exit}' Dockerfile)}
W=$(mktemp -d); mkdir -p "$W/app/assets" "$W/app/config" "$W/app/.git"
echo '<!doctype html>SHELL' > "$W/app/index.html"; echo 'js' > "$W/app/assets/index-abc.js"
echo '{}' > "$W/app/config/config.json"
# Present on disk on purpose: a hidden file must not be served even if one ever lands in the image.
echo 'SECRET' > "$W/app/.env"; echo 'SECRET' > "$W/app/.git/config"
cp nginx.conf "$W/default.conf"; cp docker-entrypoint.sh "$W/hook.sh"; chmod -R a+rwX "$W"; chmod a+rx "$W/hook.sh"
# Copied in, not mounted: the boot hook rewrites the config in place (port, resolver), as in the image.
# The agents' upstream is a stand-in on the same network, under the name the config proxies to.
NET=nginx-test-$$; docker network create "$NET" >/dev/null
printf 'server { listen 8080; location / { return 200 "AGENT $request_method $request_uri"; } }\n' > "$W/agent.conf"; chmod a+r "$W/agent.conf"
A=$(docker create --network "$NET" --network-alias kagent-ui.krateo-system.svc.cluster.local "$IMAGE")
C=$(docker create --network "$NET" -p 127.0.0.1::8080 "$IMAGE")
trap 'docker rm -f "$C" "$A" >/dev/null 2>&1; docker network rm "$NET" >/dev/null 2>&1; rm -rf "$W"' EXIT
docker cp -q "$W/agent.conf" "$A:/etc/nginx/conf.d/default.conf"; docker start "$A" >/dev/null
docker cp -q "$W/app" "$C:/app"
docker cp -q "$W/default.conf" "$C:/etc/nginx/conf.d/default.conf"
docker cp -q "$W/hook.sh" "$C:/docker-entrypoint.d/40-krateo-resolver.sh"
docker start "$C" >/dev/null
sleep 1; [ "$(docker inspect -f '{{.State.Running}}' "$C")" = true ] || { docker logs "$C" 2>&1 | tail -5; echo "nginx did not start"; exit 1; }
for _ in $(seq 1 40); do [ -n "$(docker port "$C" 8080/tcp 2>/dev/null)" ] && break; sleep 0.25; done
BASE="http://$(docker port "$C" 8080/tcp | head -1)"
for _ in $(seq 1 60); do curl -s -o /dev/null "$BASE/" && break; sleep 0.5; done
bad=0
# want = status, "shell" (200 and the app), or "AGENT <method> <uri>" (what the agents' upstream received).
ask() {
  local want=$1 path=$2 body code got
  body=$(curl -s --max-time 30 --path-as-is -w '\n%{http_code}' "$BASE$path"); code=${body##*$'\n'}; got=$code
  if [ "$code" = 200 ] && [[ $body == *SHELL* ]]; then got=shell; fi
  if [[ $body == AGENT* ]]; then got=${body%$'\n'*}; fi
  if [[ $body == *SECRET* ]]; then got="LEAK($code)"; fi
  if [ "$got" = "$want" ]; then echo "[PASS] $path -> $got"; else echo "[FAIL] $path -> $got, want $want"; bad=$((bad + 1)); fi
}
for p in /.env /.env.production /.git/config /app/.env /.well-known/security.txt /config/..data/config.json /%2eenv /%2Egit/config \
  '/@fs/var/run/secrets/kubernetes.io/serviceaccount/token?raw??' /@vite/client; do ask 404 "$p"; done
for p in / /login /compositions/team-a/web.v1 /compositions/team-a/shop /public/a.b /auth?code=x; do ask shell "$p"; done
# Dots that are not a hidden file, and what a file extension cannot rule out (docs/configuration.md).
for p in /secrets.env /proc/self/environ; do ask shell "$p"; done
ask 200 /assets/index-abc.js; ask 200 /config/config.json; ask 404 /assets/missing.js; ask 400 /../../etc/passwd
# Whether a browser may reuse an answer without asking: never the shell or the config (a roll changes them
# under the same address), always a hashed asset, and nothing said for what the agents answer.
cached() {
  local want=$1 path=$2 got
  got=$(curl -s --max-time 30 -o /dev/null -D - "$BASE$path" | tr -d '\r' | awk -F': ' 'tolower($1)=="cache-control"{print $2}')
  if [ "$got" = "$want" ]; then echo "[PASS] $path cache-control -> ${got:-none}"; else echo "[FAIL] $path cache-control -> ${got:-none}, want ${want:-none}"; bad=$((bad + 1)); fi
}
for p in / /index.html /login /compositions/team-a/shop /config/config.json; do cached no-cache "$p"; done
cached 'public, max-age=31536000, immutable' /assets/index-abc.js; cached '' /assets/missing.js; cached '' /agentiko/; cached '' /.env
etag=$(curl -s -o /dev/null -D - "$BASE/compositions/team-a/shop" | tr -d '\r' | awk -F': ' 'tolower($1)=="etag"{print $2}')
again=$(curl -s -o /dev/null -w '%{http_code}' -H "If-None-Match: $etag" "$BASE/compositions/team-a/shop")
if [ -n "$etag" ] && [ "$again" = 304 ]; then echo "[PASS] an unchanged shell -> 304"; else echo "[FAIL] an unchanged shell -> $again (etag ${etag:-none})"; bad=$((bad + 1)); fi
for a in agentiko autopilot; do
  ask "AGENT GET /api/a2a/krateo-system/$a/" "/$a/"
  ask "AGENT GET /api/a2a/krateo-system/$a/.well-known/agent-card.json" "/$a/.well-known/agent-card.json"
  ask "AGENT GET /api/sessions/x" "/$a/sessions/x"
done
echo "$bad wrong answer(s) from $IMAGE"; exit "$bad"
