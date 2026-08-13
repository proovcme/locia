#!/usr/bin/env sh
set -eu

cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

if [ -e .env.work ]; then
  echo ".env.work already exists; nothing changed" >&2
  exit 1
fi
command -v openssl >/dev/null 2>&1 || {
  echo "openssl is required" >&2
  exit 1
}

admin_email=${1:-admin@example.local}
db_password=$(openssl rand -hex 32)
root_password=$(openssl rand -hex 32)
admin_password=$(openssl rand -base64 24 | tr -d '\n')
data_key=$(openssl rand -base64 32 | tr -d '\n')

umask 077
{
  echo 'APP_URL=http://localhost:8080'
  echo 'LOCIA_WORK_SITE=http://localhost'
  echo 'LOCIA_WORK_HTTP_PORT=8080'
  echo 'LOCIA_WORK_HTTPS_PORT=8443'
  echo
  echo 'DB_DATABASE=locia'
  echo 'DB_USERNAME=locia'
  printf 'DB_PASSWORD=%s\n' "$db_password"
  printf 'DB_ROOT_PASSWORD=%s\n' "$root_password"
  echo
  echo 'LOCIA_ADMIN_LOGIN=0001'
  echo 'LOCIA_ADMIN_NAME=Администратор'
  printf 'LOCIA_ADMIN_EMAIL=%s\n' "$admin_email"
  printf 'LOCIA_ADMIN_PASSWORD=%s\n' "$admin_password"
  printf 'APP_DATA_KEY=%s\n' "$data_key"
  echo 'APP_TIMEZONE=Europe/Moscow'
  echo 'MAIL_ENABLED=0'
} > .env.work

echo "Created .env.work with mode 600."
echo "Administrator login: 0001"
echo "Administrator password: $admin_password"
echo "Save the password in a password manager before closing this terminal."
