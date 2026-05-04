#!/usr/bin/env bash
# Deploy the current branch to spruce-cedar.exe.xyz.
# Requirements: SSH access to spruce-cedar.exe.xyz, repo pushed to GitHub.
set -euo pipefail

VM=spruce-cedar.exe.xyz
APP_DIR=/home/exedev/nihongo-practice
BRANCH=$(git rev-parse --abbrev-ref HEAD)

echo "==> Deploying branch '$BRANCH' to $VM"

# Push current branch so the VM can pull it.
git push origin "$BRANCH"

ssh "$VM" bash <<EOF
set -euo pipefail
cd $APP_DIR

echo "-- Pulling latest"
git fetch origin
git checkout $BRANCH
git reset --hard origin/$BRANCH

echo "-- Installing dependencies"
npm ci --prefer-offline

echo "-- Building client"
npm --workspace client run build

echo "-- Building server"
npm --workspace server run build

echo "-- Running migrations"
set -a && source $APP_DIR/.env && set +a
npm --workspace server run db:migrate

echo "-- Restarting app"
pm2 restart nihongo --update-env

echo "-- Waiting for healthz"
for i in \$(seq 1 10); do
  if curl -fsS http://localhost:3001/healthz > /dev/null 2>&1; then
    echo "-- Healthz OK"
    break
  fi
  sleep 2
done
EOF

echo "==> Verifying deployed URL"
sleep 2
STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://$VM/healthz)
if [ "$STATUS" = "200" ]; then
  echo "==> Deploy complete: https://$VM"
else
  echo "==> ERROR: healthz returned HTTP $STATUS" >&2
  exit 1
fi
