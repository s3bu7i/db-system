#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/excel-db-manager}"
SERVICE_NAME="${SERVICE_NAME:-excel-db-manager}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo: sudo bash deploy/install-ubuntu.sh"
  exit 1
fi

apt-get update
apt-get install -y python3 python3-venv python3-pip rsync

mkdir -p "${APP_DIR}/data" "${APP_DIR}/uploads"

rsync -a --delete \
  --exclude ".git" \
  --exclude ".venv" \
  --exclude "__pycache__" \
  --exclude ".env" \
  --exclude "data" \
  --exclude "uploads" \
  --exclude "VEB 2025" \
  --exclude "ƏRZAQ BALANSI VEB_2024" \
  --exclude "*.xls" \
  --exclude "*.xlsx" \
  --exclude "*.xlsm" \
  --exclude "*.xltx" \
  --exclude "*.xltm" \
  "${REPO_DIR}/" "${APP_DIR}/"

if [[ ! -f "${APP_DIR}/.env" ]]; then
  cp "${APP_DIR}/.env.example" "${APP_DIR}/.env"
  chmod 600 "${APP_DIR}/.env"
  echo "Created ${APP_DIR}/.env. Change APP_PASSWORD before public use."
fi

python3 -m venv "${APP_DIR}/.venv"
"${APP_DIR}/.venv/bin/pip" install --upgrade pip
"${APP_DIR}/.venv/bin/pip" install -r "${APP_DIR}/requirements.txt"

ln -sf "${APP_DIR}/deploy/${SERVICE_NAME}.service" "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}"
systemctl status "${SERVICE_NAME}" --no-pager

echo
echo "Deploy completed."
echo "App: http://SERVER_IP:8000"
echo "Config: ${APP_DIR}/.env"
echo "Logs: journalctl -u ${SERVICE_NAME} -f"
