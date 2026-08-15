# Архитектура

## Публичное демо

```text
Browser → Caddy :8080
           ├── /            витрина
           ├── /lemma/*     PHP + пересоздаваемая SQLite
           ├── /atlas/*     статический IFC viewer
           ├── /pircalc/*   статический калькулятор
           └── /pdf-editor/* временный Python/PyMuPDF worker
```

Демо наполняется синтетическими данными при каждом старте. Оно предназначено только для знакомства с продуктами.

## Рабочий self-host

```text
Browser → Caddy 80/443
           ├── /*             PHP-FPM «Лемма»
           ├── /atlas/*       статический IFC viewer
           ├── /calculator/*  статический калькулятор
           └── /pdf-editor/*  временный Python/PyMuPDF worker
                    │
                    └── MariaDB + persistent volumes
```

`compose.work.yml` запускает Caddy, PHP-FPM, MariaDB и изолированный PDF worker. При старте приложение ждёт готовности базы, применяет ещё не выполненные миграции и создаёт администратора только в пустой установке. Повторный запуск не сбрасывает данные и не меняет пароль.

Из сети публикуется только Caddy. MariaDB, PHP-FPM и PDF worker остаются во внутренних Compose-сетях. PDF worker не имеет исходящего доступа в интернет, работает с read-only root filesystem и временным `tmpfs`; загруженные документы удаляются после ответа. Хранилище приложения, база и данные Caddy находятся в отдельных volumes.

## Отключённые интеграции

В self-host по умолчанию выключены update center, mail relay, cloud transfer, MSP sync и Revit API. Маршруты служебных контуров `/locia-update/` и `/locia-notify/` в этот репозиторий не входят.
