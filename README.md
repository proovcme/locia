# Locia Public

[![self-host smoke](https://github.com/proovcme/locia/actions/workflows/selfhost-smoke.yml/badge.svg)](https://github.com/proovcme/locia/actions/workflows/selfhost-smoke.yml)
[![live](https://img.shields.io/badge/live-locia.work-9B1C31)](https://locia.work/)
[![self-hosted](https://img.shields.io/badge/self--hosted-Docker-2496ED?logo=docker&logoColor=white)](docs/SELF_HOSTING.md)

Публичный демонстрационный контур для проектных организаций: управление проектами, просмотр IFC-моделей и расчёт стоимости проектных работ.

[Открыть locia.work](https://locia.work/) · [Лемма](https://locia.work/lemma/) · [Атлас](https://locia.work/atlas/) · [Калькулятор](https://locia.work/pircalc/)

![Главная страница locia.work](assets/landing.png)

## Три продукта

| Продукт | Назначение | Live |
|---|---|---|
| **Лемма** | Управление проектами, задачами, сроками, загрузкой и контролем проектирования | [Открыть демо](https://locia.work/lemma/) |
| **Атлас** | Просмотр информационных моделей IFC в браузере: федерации, структура, слои, сечения и измерения | [Открыть viewer](https://locia.work/atlas/) |
| **Калькулятор** | Сметы на проектные работы: норматив ФГИС ЦС и формы 2П, 3П, 4П | [Открыть расчёт](https://locia.work/pircalc/) |

### Лемма

Демо открывается без пароля по одной из четырёх ролей. База создаётся заново при каждом старте и содержит только синтетические проекты, сотрудников, задачи и показатели.

![Лемма — управление проектами в проектировании](assets/lemma.png)

### Атлас

WebGL-просмотрщик работает без установки ПО. В публичный каталог включены все 23 IFC-файла из официального репозитория [buildingSMART Sample & Test Files](https://github.com/buildingSMART/Sample-Test-Files): IFC4, IFC4.3, здания, инфраструктура и эталонные примеры. Стартовая сцена объединяет четыре дисциплины здания.

![Атлас — публичный просмотр IFC](assets/atlas.png)

### Калькулятор

Браузерный расчёт стоимости проектных работ по нормативу ФГИС ЦС, трудозатратам и командировочным расходам с подготовкой форм 2П, 3П и 4П.

![Калькулятор проектных работ](assets/calculator.png)

## Self-host за одну команду

Нужны Docker Engine и Docker Compose v2.

```bash
git clone https://github.com/proovcme/locia.git
cd locia
docker compose up --build -d
```

Откройте [http://localhost:8080](http://localhost:8080). Порт и публичный origin можно изменить через `.env`:

```bash
cp .env.example .env
docker compose up --build -d
```

Подробности: [self-hosting](docs/SELF_HOSTING.md), [архитектура](docs/ARCHITECTURE.md), [публичная граница](docs/PUBLIC_BOUNDARY.md).

## Что лежит в репозитории

```text
apps/lemma/       изолированный PHP/SQLite demo-runtime
public/atlas/     проверенная статическая сборка Атласа и 23 IFC
public/pircalc/   проверенная статическая сборка калькулятора
site/             главная, robots.txt и sitemap.xml
docker/           контейнер Леммы и Caddy-маршрутизация
assets/           скриншоты реального публичного контура
manifest/         происхождение сборок и закреплённые версии источников
```

Это отдельный showcase/self-host репозиторий. Он не содержит production-баз, конфигурации рабочих серверов, update/notify/Revit-контуров, токенов, почтовых секретов или моделей заказчиков.

## Безопасность и данные

- «Лемма» всегда запускается с `DEMO_MODE=1` и новой SQLite-базой.
- Перед стартом выполняется privacy audit; при нарушении демо не поднимается.
- Встроенные логины и адреса используют зарезервированный домен `example.local`.
- IFC buildingSMART загружаются из закреплённого commit, сверяются по SHA-256 и очищаются от полей персон/авторов.
- Caddy закрывает dotfiles, исходники, хранилище и любые неразрешённые IFC-пути.
- `scripts/audit-public.sh` проверяет дерево перед публикацией.

Сообщить о проблеме: [hello@locia.work](mailto:hello@locia.work). Политика: [SECURITY.md](SECURITY.md).

## Индексация

Главная, Атлас и Калькулятор имеют canonical URL, Open Graph, JSON-LD и входят в sitemap. Демо-страницы Леммы и каталоги моделей закрыты от поисковых роботов. GitHub-репозиторий описывает публичные продукты словами **управление проектами в проектировании**, **IFC viewer**, **BIM**, **сметный калькулятор**, **ФГИС ЦС**, **формы 2П, 3П и 4П**.

## Лицензии

Модели buildingSMART распространяются по [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); источник и изменения указаны в [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Условия использования оригинальных компонентов Locia — в [LICENSE.md](LICENSE.md).
