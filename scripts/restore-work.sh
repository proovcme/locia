#!/usr/bin/env sh
set -eu

cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

backup_dir=${1:-}
confirmation=${2:-}
if [ -z "$backup_dir" ] || [ "$confirmation" != '--yes' ]; then
  echo "Usage: ./scripts/restore-work.sh backups/YYYYMMDDTHHMMSSZ --yes" >&2
  echo "Restore replaces the current database and application storage." >&2
  exit 1
fi
test -f .env.work || {
  echo "Missing .env.work" >&2
  exit 1
}
test -f "$backup_dir/database.sql"
test -f "$backup_dir/storage.tar.gz"
(
  cd "$backup_dir"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c SHA256SUMS
  else
    shasum -a 256 -c SHA256SUMS
  fi
)

compose='docker compose --env-file .env.work -f compose.work.yml'
$compose stop web lemma
$compose exec -T db sh -c 'exec mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -e "DROP DATABASE IF EXISTS \`$MARIADB_DATABASE\`; CREATE DATABASE \`$MARIADB_DATABASE\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"'
$compose exec -T db sh -c 'exec mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" "$MARIADB_DATABASE"' < "$backup_dir/database.sql"
$compose run --rm --no-deps --entrypoint sh lemma -c 'find /app/storage -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +; tar -C /app/storage -xzf -' < "$backup_dir/storage.tar.gz"
$compose up -d lemma web

echo "Restore completed from: $backup_dir"
