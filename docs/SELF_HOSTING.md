# Self-hosting Locia Public

## Требования

- Docker Engine 25+;
- Docker Compose v2;
- 2 CPU, 4 ГБ RAM и около 1 ГБ свободного места;
- современный браузер с WebGL2 для Атласа.

## Локальный запуск

```bash
git clone https://github.com/proovcme/locia.git
cd locia
docker compose up --build -d
curl -I http://localhost:8080/
```

Страницы:

- `http://localhost:8080/` — витрина;
- `http://localhost:8080/lemma/` — Лемма;
- `http://localhost:8080/atlas/` — Атлас;
- `http://localhost:8080/pircalc/` — Калькулятор.

## Собственный домен

Создайте `.env`:

```dotenv
LOCIA_PUBLIC_ORIGIN=https://demo.example.org
PUBLIC_PORT=8080
```

Поставьте контейнер за своим HTTPS reverse proxy и направьте трафик на `127.0.0.1:8080`. Затем замените canonical URL в `site/index.html`, `site/sitemap.xml`, `public/atlas/index.html` и `public/pircalc/index.html` на свой origin.

## Данные Леммы

При каждом старте контейнера Лемма удаляет прежнюю SQLite и создаёт новый синтетический набор. Это намеренное поведение публичного демо. Не используйте этот compose-файл для рабочих данных.

```bash
docker compose restart lemma   # сбросить демо
docker compose logs -f lemma
```

Privacy audit выполняется до открытия HTTP-порта. Если в базе обнаружены недемо-проекты, контакты, вложения, токены или модели, контейнер завершится с ошибкой.

## Обновление

```bash
git pull --ff-only
docker compose up --build -d
```

Перед обновлением можно выполнить:

```bash
./scripts/audit-public.sh
docker compose config --quiet
```

