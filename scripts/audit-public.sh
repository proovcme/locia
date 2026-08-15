#!/usr/bin/env sh
set -eu

cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

test -f README.md
test -f docker-compose.yml
test -f compose.work.yml
test -f .env.work.example
test -f assets/landing.png
test -f assets/lemma.png
test -f assets/atlas.png
test -f assets/calculator.png
test -f assets/pdf-editor.png
test -f apps/pdf-editor/COPYING
test -f apps/pdf-editor/engine/rule_engine.py
test -f apps/pdf-editor/server/app.py

if find . -type f \( -name '.env' -o -name '*.pem' -o -name '*.key' -o -name '*.p12' -o -name '*.sqlite' -o -name '*.zip' \) | grep -q .; then
  echo "Forbidden secret or data artifact found" >&2
  exit 1
fi

if git ls-files --error-unmatch .env.work >/dev/null 2>&1 || git ls-files 'backups/*' | grep -q .; then
  echo "Working credentials or backups are tracked by Git" >&2
  exit 1
fi

test "$(find apps/lemma/database/migrations -type f -name '*.sql' | wc -l | tr -d ' ')" -eq 97

if grep -RInE --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist --exclude='audit-public.sh' \
  --exclude='COPYING' --exclude='*.mjs' \
  --exclude='*.wasm' --exclude='*.png' --exclude='*.svg' --exclude='*.ifc' \
  '(/Users/|C:\\Users\\|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|Чернетченко|Дом Радио|000_4|1835/2022)' .; then
  echo "Private marker found" >&2
  exit 1
fi

if grep -RIl --include='*.ifc' -E "IFCPERSON[[:space:]]*\([[:space:]]*'|@[A-Za-z0-9.-]+\.[A-Za-z]{2,}" public/atlas/models/buildingsmart | grep -q .; then
  echo "Personal metadata found in public IFC" >&2
  exit 1
fi

model_count=$(grep -c '"id"' public/atlas/models/buildingsmart/catalog.json)
test "$model_count" -eq 23

echo "Public showcase audit passed: 23 IFC models and isolated PDF editor"
