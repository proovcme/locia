<?php
$tableMeta = (array) (($preview['manifest']['tables'] ?? null) ?: []);
$fileMeta = (array) (($preview['manifest']['files'] ?? null) ?: []);
$rowCount = array_sum(array_map(static fn ($meta) => (int) ($meta['rows'] ?? 0), $tableMeta));
?>
<section class="cloud-transfer-hero panel">
    <div class="cloud-transfer-hero__copy">
        <span class="eyebrow"><?= $mode === 'export' ? 'Закрытый контур → VPS' : 'Закрытый контур → этот VPS' ?></span>
        <h2><?= $mode === 'export' ? 'Собрать снимок рабочих данных' : 'Загрузить снимок рабочих данных' ?></h2>
        <p><?= $mode === 'export'
            ? 'Лоция соберёт пользователей, проекты, задачи, бюджеты, время, базу знаний и вложения в один проверяемый ZIP.'
            : 'Сначала Лоция проверит формат, состав и контрольные суммы. Замена данных начнётся только после отдельного подтверждения.' ?></p>
    </div>
    <div class="cloud-transfer-route" aria-label="Направление обмена">
        <span>Прод</span><b aria-hidden="true">→</b><span>VPS</span>
    </div>
</section>

<section class="panel cloud-transfer-card">
    <?php if ($mode === 'export'): ?>
        <div>
            <h2>Экспорт</h2>
            <p class="muted">Модели, пароли SMTP, `.env`, push-подписки, очереди и серверные логи в архив не попадут. Пароли пользователей сохраняются только как необратимые хеши.</p>
        </div>
        <form method="post" action="<?= url('/admin/cloud-transfer/export') ?>">
            <?= csrf_field() ?>
            <button class="btn btn--red cloud-transfer-primary" type="submit">Получить ZIP</button>
        </form>
    <?php elseif (!$preview): ?>
        <form class="cloud-transfer-upload" method="post" enctype="multipart/form-data" action="<?= url('/admin/cloud-transfer/inspect') ?>">
            <?= csrf_field() ?>
            <label for="cloud-snapshot"><strong>ZIP из закрытого прода</strong><span>До 1 ГБ. Файл не применяется на этом шаге.</span></label>
            <input id="cloud-snapshot" type="file" name="snapshot" accept=".zip,application/zip" required>
            <button class="btn btn--red cloud-transfer-primary" type="submit">Проверить ZIP</button>
        </form>
    <?php else: ?>
        <div class="cloud-transfer-preview__head">
            <div>
                <span class="status-badge status-badge--ok">ZIP проверен</span>
                <h2><?= e((string) ($preview['name'] ?? 'snapshot.zip')) ?></h2>
                <p class="muted">Источник: Лоция v<?= e((string) ($preview['manifest']['source_version'] ?? '?')) ?> · <?= e((string) ($preview['manifest']['created_at'] ?? '')) ?></p>
            </div>
            <div class="cloud-transfer-stats">
                <div><strong><?= count($tableMeta) ?></strong><span>таблиц</span></div>
                <div><strong><?= number_format($rowCount, 0, ',', ' ') ?></strong><span>записей</span></div>
                <div><strong><?= count($fileMeta) ?></strong><span>вложений</span></div>
            </div>
        </div>
        <div class="notice notice--warning">
            <strong>Будут заменены рабочие данные VPS.</strong>
            <span>Перед заменой Лоция автоматически сохранит текущие данные и вложения в резервный ZIP. Облачные SMTP, push и очереди останутся без изменений.</span>
        </div>
        <form method="post" action="<?= url('/admin/cloud-transfer/apply') ?>" onsubmit="return confirm('Заменить рабочие данные VPS проверенным снимком? Перед импортом будет создана резервная копия.')">
            <?= csrf_field() ?>
            <input type="hidden" name="import_token" value="<?= e((string) ($preview['token'] ?? '')) ?>">
            <button class="btn btn--red cloud-transfer-primary" type="submit">Импортировать данные</button>
        </form>
    <?php endif; ?>
</section>

<section class="panel cloud-transfer-scope">
    <h2>Что переносится</h2>
    <div class="cloud-transfer-scope__grid">
        <div><strong>Переносится</strong><p>Люди и структура, проекты, задачи, бюджеты, платежи, табель, штатное расписание, база знаний, комментарии и вложения.</p></div>
        <div><strong>Остаётся на контуре</strong><p>Модели, SMTP и DKIM, push-подписки, очереди, публичные ссылки, серверные логи, ключи, `.env` и настройки обновлений.</p></div>
    </div>
</section>
