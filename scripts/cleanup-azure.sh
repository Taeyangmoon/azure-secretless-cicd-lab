#!/usr/bin/env bash
# 실습 리소스 정리 / Clean up lab resources
# 사용법 / Usage: APP_NAME=<web-app-name> [RG=rg-secretless-lab] ./scripts/cleanup-azure.sh
set -euo pipefail

: "${APP_NAME:?Set APP_NAME=<web-app-name>}"
RG="${RG:-rg-secretless-lab}"

CLIENT_ID=$(az ad app list --display-name "sp-github-$APP_NAME" --query "[0].appId" -o tsv)
if [ -n "$CLIENT_ID" ]; then
  az ad app delete --id "$CLIENT_ID"
  echo "Deleted Entra app $CLIENT_ID"
fi
az group delete -n "$RG" --yes --no-wait
echo "Resource group $RG deletion started."
