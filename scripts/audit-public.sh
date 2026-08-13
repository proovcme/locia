#!/usr/bin/env sh
set -eu

cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

test -f README.md
test -f docker-compose.yml
test -f assets/landing.png
test -f assets/lemma.png
test -f assets/atlas.png
test -f assets/calculator.png

if find . -type f \( -name '.env' -o -name '*.pem' -o -name '*.key' -o -name '*.p12' -o -name '*.sqlite' -o -name '*.zip' \) | grep -q .; then
  echo "Forbidden secret or data artifact found" >&2
  exit 1
fi

if grep -RInE --exclude-dir=.git --exclude='audit-public.sh' --exclude='*.js' --exclude='*.mjs' \
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

echo "Public showcase audit passed: 23 IFC models"
