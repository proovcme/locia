<?php
$settings = $settings ?? [];
$manifest = is_array($manifest ?? null) ? $manifest : null;
$downloaded = is_array($downloaded ?? null) ? $downloaded : [];
$status = is_array($status ?? null) ? $status : null;
$workerStatus = is_array($workerStatus ?? null) ? $workerStatus : null;
$latestReport = $latestReport ?? null;
$compatible = is_array($manifest['compatible_packages'] ?? null) ? $manifest['compatible_packages'] : [];
?>

<section class="panel">
    <div class="panel__head">
        <div>
            <h1>Обновления</h1>
            <span>Проверка пакетов через VPS, установка через штатный hotfix-runner и отправка telemetry</span>
        </div>
    </div>
    <section class="metric-row project-summary-metrics cost-summary-metrics">
        <div class="metric"><span><?= e($currentVersion ?? 'dev') ?></span><strong>Текущая версия</strong></div>
        <div class="metric"><span><?= !empty($settings['enabled']) ? 'ON' : 'OFF' ?></span><strong>Update Center</strong></div>
        <div class="metric"><span><?= count($compatible) ?></span><strong>Совместимых пакетов</strong></div>
    </section>
    <table class="data-table">
        <tbody>
            <tr>
                <th>VPS</th>
                <td><?= e($settings['base_url'] ?: 'не задан') ?></td>
            </tr>
            <tr>
                <th>Manifest</th>
                <td><?= e($settings['manifest_url'] ?: (($settings['base_url'] ?? '') !== '' ? rtrim((string) $settings['base_url'], '/') . '/manifest.json' : 'не задан')) ?></td>
            </tr>
            <tr>
                <th>Авторизация</th>
                <td><?= !empty($settings['token_set']) ? 'Bearer token задан' : 'token не задан' ?><?= !empty($settings['public_key_set']) ? ', подпись включена' : '' ?></td>
            </tr>
            <tr>
                <th>Scheduled Task</th>
                <td><?= e($settings['task_name'] ?? 'LociaERP\\Updater') ?></td>
            </tr>
        </tbody>
    </table>
</section>

<section class="panel">
    <div class="panel__head">
        <div>
            <h2>Пакеты</h2>
            <span>пакет применяется только если его base_version совпадает с текущей версией</span>
        </div>
        <div class="actions-inline">
            <form method="post" action="<?= url('/admin/updates/check') ?>">
                <?= csrf_field() ?>
                <button class="btn btn-outline" type="submit">Проверить VPS</button>
            </form>
            <form method="post" action="<?= url('/admin/updates/download') ?>">
                <?= csrf_field() ?>
                <button class="btn btn-outline" type="submit"<?= $compatible === [] ? ' disabled' : '' ?>>Скачать пакет</button>
            </form>
            <form method="post" action="<?= url('/admin/updates/install') ?>" onsubmit="return confirm('Запустить установку обновления? Apache будет остановлен updater-задачей.')">
                <?= csrf_field() ?>
                <button class="btn btn--red" type="submit"<?= $downloaded === [] ? ' disabled' : '' ?>>Установить</button>
            </form>
        </div>
    </div>
    <?php if ($manifest): ?>
        <p class="muted">Последняя проверка: <?= e($manifest['checked_at'] ?? '-') ?>, канал: <?= e($manifest['channel'] ?? '-') ?></p>
    <?php endif; ?>
    <table class="data-table">
        <thead>
            <tr>
                <th>Пакет</th>
                <th>База</th>
                <th>Цель</th>
                <th>SHA256</th>
            </tr>
        </thead>
        <tbody>
            <?php foreach ($compatible as $package): ?>
                <tr>
                    <td><strong><?= e($package['name'] ?? '') ?></strong></td>
                    <td><?= e($package['base_version'] ?? implode(', ', (array) ($package['base_versions'] ?? []))) ?></td>
                    <td><?= e($package['target_version'] ?? '') ?></td>
                    <td class="muted"><?= e(substr((string) ($package['sha256'] ?? ''), 0, 16)) ?>...</td>
                </tr>
            <?php endforeach; ?>
            <?php if ($compatible === []): ?>
                <tr><td colspan="4" class="muted">Совместимых пакетов пока нет. Нажмите «Проверить VPS».</td></tr>
            <?php endif; ?>
        </tbody>
    </table>
</section>

<section class="panel">
    <div class="panel__head">
        <div>
            <h2>Скачанные пакеты</h2>
            <span>последний скачанный пакет будет передан updater-задаче</span>
        </div>
    </div>
    <table class="data-table">
        <thead>
            <tr>
                <th>Файл</th>
                <th>Версии</th>
                <th>Дата</th>
                <th>Команда</th>
            </tr>
        </thead>
        <tbody>
            <?php foreach ($downloaded as $package): ?>
                <tr>
                    <td><strong><?= e($package['name'] ?? basename((string) ($package['path'] ?? ''))) ?></strong></td>
                    <td><?= e(($package['base_version'] ?? '-') . ' -> ' . ($package['target_version'] ?? '-')) ?></td>
                    <td><?= e($package['downloaded_at'] ?? '-') ?></td>
                    <td class="muted"><?= e($package['install_command'] ?? '') ?></td>
                </tr>
            <?php endforeach; ?>
            <?php if ($downloaded === []): ?>
                <tr><td colspan="4" class="muted">Пакеты ещё не скачивались.</td></tr>
            <?php endif; ?>
        </tbody>
    </table>
</section>

<section class="panel">
    <div class="panel__head">
        <div>
            <h2>Telemetry и логи</h2>
            <span>собирается штатный locia-offline-report zip и отправляется на VPS</span>
        </div>
        <form method="post" action="<?= url('/admin/updates/telemetry') ?>">
            <?= csrf_field() ?>
            <button class="btn btn-outline" type="submit">Отправить telemetry</button>
        </form>
    </div>
    <table class="data-table">
        <tbody>
            <tr>
                <th>Последний report</th>
                <td><?= e($latestReport ? basename((string) $latestReport) : 'нет') ?></td>
            </tr>
            <tr>
                <th>Update status</th>
                <td><?= e($status ? (($status['stage'] ?? '-') . ' / ' . ($status['message'] ?? '-')) : 'нет данных') ?></td>
            </tr>
            <tr>
                <th>Worker status</th>
                <td><?= e($workerStatus ? (($workerStatus['status'] ?? '-') . ' / ' . ($workerStatus['message'] ?? '-')) : 'нет данных') ?></td>
            </tr>
        </tbody>
    </table>
</section>
