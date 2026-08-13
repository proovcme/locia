# Self-hosting Locia

В репозитории есть два независимых режима:

- `docker-compose.yml` — публичное демо с пересоздаваемой SQLite;
- `compose.work.yml` — рабочая установка с постоянной MariaDB.

Для реальных проектов используйте только рабочий режим.

## Требования

- Linux-сервер с Docker Engine 25+ и Docker Compose v2;
- от 2 CPU, 4 ГБ RAM и 10 ГБ свободного места;
- DNS-запись на сервер и открытые порты 80/443 для публичного HTTPS;
- отдельное внешнее хранилище для резервных копий.

## Первый запуск

```bash
git clone https://github.com/proovcme/locia.git
cd locia
./scripts/init-work.sh admin@company.ru
docker compose --env-file .env.work -f compose.work.yml up --build -d
```

`init-work.sh` создаёт `.env.work` с правами `600`, генерирует отдельные пароли базы и администратора и печатает пароль администратора один раз. Сохраните его в менеджере паролей.

Проверьте установку:

```bash
docker compose --env-file .env.work -f compose.work.yml ps
curl -I http://localhost:8080/login
```

Войдите по табельному номеру `0001` или email, переданному в `init-work.sh`.

## Домен и HTTPS

Укажите в `.env.work`:

```dotenv
APP_URL=https://locia.company.ru
LOCIA_WORK_SITE=locia.company.ru
LOCIA_WORK_HTTP_PORT=80
LOCIA_WORK_HTTPS_PORT=443
```

Направьте A/AAAA-запись домена на сервер и перезапустите контейнеры:

```bash
docker compose --env-file .env.work -f compose.work.yml up -d
```

Caddy самостоятельно получает и обновляет TLS-сертификат. Если перед Locia уже стоит внешний reverse proxy, оставьте внутренний HTTP-порт и завершайте TLS на этом proxy.

## Обновление

Сначала создайте резервную копию, затем обновите код. Миграции выполняются автоматически до запуска PHP-FPM.

```bash
./scripts/backup-work.sh
git pull --ff-only
docker compose --env-file .env.work -f compose.work.yml up --build -d
```

Повторный запуск не пересоздаёт базу и не меняет пароль существующего администратора.

## Резервные копии

Полная резервная копия включает SQL-дамп MariaDB и каталог `storage`:

```bash
./scripts/backup-work.sh
./scripts/backup-work.sh /mnt/backup/locia
```

Скопируйте созданный каталог за пределы сервера. Восстановление намеренно требует явного `--yes`, потому что заменяет текущую базу и хранилище:

```bash
./scripts/restore-work.sh /mnt/backup/locia/20260813T180000Z --yes
```

Проверяйте восстановление на отдельном сервере не реже одного раза в квартал.

## Почта

Почта по умолчанию выключена. Для SMTP заполните параметры `MAIL_*` в `.env.work`, сохраните `APP_DATA_KEY` и включите `MAIL_ENABLED=1`. Не подключайте публичную установку к служебному `/locia-notify/`.

## Что не входит в self-host

Self-host не подключён к production Locia, служебным `/locia-update/` и `/locia-notify/`, внутренним файлам, клиентским IFC и Revit API. Эти интеграции выключены и не требуются для управления проектами, Атласа и Калькулятора.

Перед публикацией в интернет настройте firewall, регулярные внешние backups, мониторинг свободного места и обновления Docker-хоста. Дополнительные ограничения описаны в [PUBLIC_BOUNDARY.md](PUBLIC_BOUNDARY.md) и [SECURITY.md](../SECURITY.md).
