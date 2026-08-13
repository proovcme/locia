# Locia

[![self-host smoke](https://github.com/proovcme/locia/actions/workflows/selfhost-smoke.yml/badge.svg)](https://github.com/proovcme/locia/actions/workflows/selfhost-smoke.yml)
[![live](https://img.shields.io/badge/live-locia.work-9B1C31)](https://locia.work/)
[![self-hosted](https://img.shields.io/badge/self--hosted-Docker-2496ED?logo=docker&logoColor=white)](docs/SELF_HOSTING.md)

Набор инструментов для проектной организации: управление проектами, просмотр IFC-моделей и расчёт стоимости проектных работ.

[Открыть locia.work](https://locia.work/) · [Лемма](https://locia.work/lemma/) · [Атлас](https://locia.work/atlas/) · [Калькулятор](https://locia.work/pircalc/)

![Главная страница locia.work](assets/landing.png)

## Три продукта

| Продукт | Назначение | Демо |
|---|---|---|
| **Лемма** | Управление проектами, задачами, сроками, загрузкой и контролем проектирования | [Открыть](https://locia.work/lemma/) |
| **Атлас** | IFC viewer: федерации, структура, слои, сечения и измерения | [Открыть](https://locia.work/atlas/) |
| **Калькулятор** | Сметы на проектные работы по ФГИС ЦС, формы 2П, 3П и 4П | [Открыть](https://locia.work/pircalc/) |

### Лемма

![Лемма — управление проектами в проектировании](assets/lemma.png)

### Атлас

В каталоге — 23 открытые IFC-модели из [buildingSMART Sample & Test Files](https://github.com/buildingSMART/Sample-Test-Files).

![Атлас — просмотр IFC и BIM-моделей](assets/atlas.png)

### Калькулятор

![Калькулятор стоимости проектных работ](assets/calculator.png)

## Запустить демо

```bash
git clone https://github.com/proovcme/locia.git
cd locia
docker compose up --build -d
```

Откройте [http://localhost:8080](http://localhost:8080). Демо использует синтетические данные и пересоздаётся при старте.

## Развернуть для работы

Рабочий контур использует постоянную MariaDB, обычный вход по паролю и автоматические миграции.

```bash
./scripts/init-work.sh admin@company.ru
docker compose --env-file .env.work -f compose.work.yml up --build -d
./scripts/backup-work.sh
```

После первой команды сохраните показанный пароль администратора. Локальный адрес — [http://localhost:8080](http://localhost:8080). Для сервера с доменом и HTTPS, обновлений и восстановления из резервной копии используйте [инструкцию по self-hosting](docs/SELF_HOSTING.md).

Рабочая установка автономна: она не подключается к служебным контурам `locia.work`, а интеграции обновлений, уведомлений и Revit по умолчанию выключены.

## Состав репозитория

```text
apps/lemma/       PHP-приложение и миграции MariaDB
public/atlas/     браузерный IFC viewer и каталог моделей
public/pircalc/   сметный калькулятор
site/             публичная витрина
docker/           контейнеры и Caddy
scripts/          аудит, настройка и резервное копирование
```

Архитектура и границы публикации описаны в [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) и [docs/PUBLIC_BOUNDARY.md](docs/PUBLIC_BOUNDARY.md). О проблемах безопасности: [hello@locia.work](mailto:hello@locia.work).

## Лицензии

Внутреннее использование и изменение Locia в собственной организации разрешены условиями [LICENSE.md](LICENSE.md). Модели buildingSMART распространяются по CC BY 4.0; атрибуция приведена в [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
