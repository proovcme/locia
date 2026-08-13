#!/usr/bin/env sh
set -eu

cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
test -f .env.work || {
  echo "Missing .env.work; run ./scripts/init-work.sh first" >&2
  exit 1
}

backup_root=${1:-backups}
stamp=$(date -u '+%Y%m%dT%H%M%SZ')
target="$backup_root/$stamp"
mkdir -p "$target"

compose='docker compose --env-file .env.work -f compose.work.yml'
$compose exec -T db sh -c 'exec mariadb-dump -uroot -p"$MARIADB_ROOT_PASSWORD" --single-transaction --routines --triggers "$MARIADB_DATABASE"' > "$target/database.sql"
$compose exec -T lemma tar -C /app/storage -czf - . > "$target/storage.tar.gz"
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$target/database.sql" "$target/storage.tar.gz" > "$target/SHA256SUMS"
else
  shasum -a 256 "$target/database.sql" "$target/storage.tar.gz" > "$target/SHA256SUMS"
fi

echo "Backup created: $target"
