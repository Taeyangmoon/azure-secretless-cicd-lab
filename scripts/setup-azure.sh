#!/usr/bin/env bash
# Azure 리소스 + OIDC(Federated Credential) 설정 스크립트 / Provision Azure resources + OIDC federation
# 사용법 / Usage:
#   GITHUB_REPO=<owner>/<repo> ./scripts/setup-azure.sh   (Codespaces: ./scripts/setup-azure.sh)
# 선택 환경변수 / Optional env: APP_NAME, RG, LOCATION, SKU, BRANCH, SET_GH_VARS
set -euo pipefail

# Codespaces에서는 GITHUB_REPOSITORY가 자동 설정됨 / set automatically in Codespaces
GITHUB_REPO="${GITHUB_REPO:-${GITHUB_REPOSITORY:-}}"
: "${GITHUB_REPO:?Set GITHUB_REPO=<owner>/<repo>}"
RG="${RG:-rg-secretless-lab}"
LOCATION="${LOCATION:-koreacentral}"
SKU="${SKU:-B1}"
BRANCH="${BRANCH:-main}"
APP_NAME="${APP_NAME:-secretless-lab-$RANDOM$RANDOM}"
PLAN="plan-$APP_NAME"
IDENTITY_NAME="sp-github-$APP_NAME"

# 신규 저장소는 subject에 불변 ID가 포함될 수 있음 (예: repo:owner@123/name@456). API로 실제 prefix 조회
# New repos may use an immutable-ID subject (e.g. repo:owner@123/name@456); query the real prefix via the API
SUB_PREFIX=$(gh api "repos/$GITHUB_REPO/actions/oidc/customization/sub" --jq '.sub_claim_prefix // empty')
if [ -z "$SUB_PREFIX" ] || [ "$SUB_PREFIX" = "null" ]; then
  SUB_PREFIX="repo:$GITHUB_REPO"
fi

SUBSCRIPTION_ID=$(az account show --query id -o tsv)
TENANT_ID=$(az account show --query tenantId -o tsv)

echo "Resource group: $RG; Web App: $APP_NAME; SKU: $SKU"
echo "Cleanup: APP_NAME=$APP_NAME RG=$RG ./scripts/cleanup-azure.sh"
echo "==> 1/5 Resource group & Web App"
az group create -n "$RG" -l "$LOCATION" -o none
az appservice plan create -g "$RG" -n "$PLAN" --is-linux --sku "$SKU" -o none
az webapp create -g "$RG" -p "$PLAN" -n "$APP_NAME" --runtime "NODE:22-lts" -o none
WEBAPP_ID=$(az webapp show -g "$RG" -n "$APP_NAME" --query id -o tsv)

echo "==> 2/5 Entra ID app registration + service principal"
CLIENT_ID=$(az ad app create --display-name "$IDENTITY_NAME" --query appId -o tsv)
az ad sp create --id "$CLIENT_ID" -o none
SP_OBJECT_ID=$(az ad sp show --id "$CLIENT_ID" --query id -o tsv)

echo "==> 3/5 Federated credential (trust GitHub repo/branch)"
CRED_FILE=$(mktemp)
trap 'rm -f "$CRED_FILE"' EXIT
cat > "$CRED_FILE" <<EOF
{
  "name": "github-$BRANCH",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "$SUB_PREFIX:ref:refs/heads/$BRANCH",
  "audiences": ["api://AzureADTokenExchange"]
}
EOF
az ad app federated-credential create --id "$CLIENT_ID" --parameters "$CRED_FILE" -o none
rm -f "$CRED_FILE"

echo "==> 4/5 Role assignment (least privilege: this Web App only)"
# 역할 전파 지연 대비 재시도 / retry for role propagation delay
for i in 1 2 3 4 5; do
  if az role assignment create --assignee-object-id "$SP_OBJECT_ID" \
      --assignee-principal-type ServicePrincipal \
      --role "Website Contributor" --scope "$WEBAPP_ID" -o none; then
    break
  fi
  if [ "$i" -eq 5 ]; then
    echo "Role assignment failed after 5 attempts. Check Azure permissions before deploying." >&2
    exit 1
  fi
  echo "   retrying ($i/5)..."
  sleep 10
done

echo "==> 5/5 Done. Register these as GitHub repository *Variables* (not secrets):"
cat <<EOF

  AZURE_CLIENT_ID       = $CLIENT_ID
  AZURE_TENANT_ID       = $TENANT_ID
  AZURE_SUBSCRIPTION_ID = $SUBSCRIPTION_ID
  AZURE_WEBAPP_NAME     = $APP_NAME

  Web App URL: https://$(az webapp show -g "$RG" -n "$APP_NAME" --query defaultHostName -o tsv)
EOF

if [ "${SET_GH_VARS:-false}" = "true" ]; then
  gh variable set AZURE_CLIENT_ID --body "$CLIENT_ID" -R "$GITHUB_REPO"
  gh variable set AZURE_TENANT_ID --body "$TENANT_ID" -R "$GITHUB_REPO"
  gh variable set AZURE_SUBSCRIPTION_ID --body "$SUBSCRIPTION_ID" -R "$GITHUB_REPO"
  gh variable set AZURE_WEBAPP_NAME --body "$APP_NAME" -R "$GITHUB_REPO"
  echo "GitHub variables set via gh."
fi
