<?php

declare(strict_types=1);

namespace App\Services;

use App\Core\Database;
use PDO;
use RuntimeException;
use ZipArchive;

final class CloudDataTransferService
{
    public const FORMAT = 'locia-cloud-snapshot-v1';
    public const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;

    /** Cloud-local infrastructure, secrets, queues and static catalogs are intentionally absent. */
    private const TABLES = [
        'positions', 'users', 'employee_vacations', 'departments', 'department_groups',
        'role_access_permissions', 'position_access_permissions',
        'projects', 'project_contacts', 'project_members', 'project_pp_codes', 'project_btp_codes',
        'project_uts_facts', 'project_cost_plan', 'project_payment_schedule', 'project_model_links',
        'tasks', 'task_smart', 'personal_notes', 'task_participants', 'task_atlas_refs',
        'task_issuances', 'document_revisions', 'task_approvals', 'project_schedule',
        'project_sections', 'project_issues', 'project_data_registry', 'counterparties',
        'exchange_template_sets', 'exchange_template_items', 'project_task_exchange', 'sbc_items', 'sbc_indices',
        'project_labor_estimates', 'project_labor_estimate_allocations', 'employee_rates',
        'staffing_periods', 'staffing_plan_rows', 'staffing_personal_rates', 'staffing_group_rates',
        'cost_estimates', 'cost_estimate_items', 'calculator_portfolio_entries',
        'custom_fields', 'custom_values', 'tags', 'task_tags', 'comments', 'comment_reads',
        'task_logs', 'activity_logs', 'attachments', 'deadline_shift_reasons', 'task_deadline_shifts',
        'time_batches', 'time_entries', 'time_month_reviews', 'notifications', 'notification_templates',
        'dictionary_items', 'weekly_reports', 'weekly_report_projects', 'weekly_report_items',
        'cfo_rates', 'motivation_settings', 'motivation_grade_coefficients',
        'project_motivation_settings', 'motivation_runs', 'motivation_run_rows',
        'performance_review_templates', 'performance_review_questions', 'performance_review_cycles',
        'performance_reviews', 'performance_review_answers', 'performance_review_competency_scores',
        'performance_review_cycle_notices', 'legal_entities', 'writeoff_articles',
        'employee_legal_entities', 'knowledge_folders', 'knowledge_documents',
        'knowledge_document_revisions',
    ];

    public static function mode(): string
    {
        $configured = strtolower(trim((string) config('cloud_transfer.mode', '')));
        if (in_array($configured, ['export', 'import', 'off'], true)) {
            return $configured;
        }

        return PHP_OS_FAMILY === 'Windows' ? 'export' : 'import';
    }

    public static function storageRoot(): string
    {
        return rtrim((string) config('cloud_transfer.storage_dir', BASE_PATH . '/storage/cloud-transfer'), '/\\');
    }

    public function export(?PDO $pdo = null, ?string $targetPath = null): array
    {
        $this->requireZip();
        $pdo = $pdo ?? Database::pdo();
        $dir = self::storageRoot() . '/exports';
        $this->ensurePrivateDir($dir);
        $targetPath = $targetPath ?: $dir . '/locia-data-' . date('Ymd-His') . '-' . bin2hex(random_bytes(4)) . '.zip';
        $zip = new ZipArchive();
        if ($zip->open($targetPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            throw new RuntimeException('Не удалось создать ZIP-снимок. Проверьте свободное место и права storage.');
        }

        $manifest = [
            'format' => self::FORMAT,
            'created_at' => date(DATE_ATOM),
            'source_version' => (string) (config('app.version.version', 'unknown')),
            'tables' => [],
            'files' => [],
        ];
        try {
            foreach (self::TABLES as $table) {
                if (!$this->tableExists($pdo, $table)) {
                    continue;
                }
                $rows = $pdo->query('SELECT * FROM ' . $this->quoteIdentifier($table, $pdo))->fetchAll(PDO::FETCH_ASSOC);
                $payload = json_encode($rows, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
                $entry = 'data/' . $table . '.json';
                $zip->addFromString($entry, $payload);
                $manifest['tables'][$table] = [
                    'rows' => count($rows),
                    'sha256' => hash('sha256', $payload),
                ];
            }

            if (isset($manifest['tables']['attachments'])) {
                $root = BASE_PATH . '/storage/uploads';
                $stmt = $pdo->query('SELECT path FROM attachments ORDER BY id');
                foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $relative) {
                    $relative = $this->safeRelativePath((string) $relative);
                    $absolute = $root . '/' . $relative;
                    if (!is_file($absolute)) {
                        throw new RuntimeException('Вложение из базы не найдено: ' . $relative . '. Экспорт остановлен, чтобы не создать неполный архив.');
                    }
                    $entry = 'attachments/' . $relative;
                    $zip->addFile($absolute, $entry);
                    $manifest['files'][$entry] = [
                        'bytes' => (int) filesize($absolute),
                        'sha256' => hash_file('sha256', $absolute),
                    ];
                }
            }
            ksort($manifest['tables']);
            ksort($manifest['files']);
            $manifestJson = json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
            $zip->addFromString('manifest.json', $manifestJson);
        } finally {
            $zip->close();
        }
        @chmod($targetPath, 0600);

        return ['path' => $targetPath, 'manifest' => $manifest];
    }

    public function inspect(string $archivePath): array
    {
        $this->requireZip();
        if (!is_file($archivePath) || (int) filesize($archivePath) <= 0) {
            throw new RuntimeException('Загруженный ZIP не найден или пуст.');
        }
        if ((int) filesize($archivePath) > self::MAX_ARCHIVE_BYTES) {
            throw new RuntimeException('ZIP больше 1 ГБ. Разделите вложения или обратитесь к администратору.');
        }
        $zip = new ZipArchive();
        if ($zip->open($archivePath) !== true) {
            throw new RuntimeException('Файл не является читаемым ZIP-архивом.');
        }
        try {
            $totalUncompressed = 0;
            for ($i = 0; $i < $zip->numFiles; $i++) {
                $name = (string) $zip->getNameIndex($i);
                $this->validateEntryName($name);
                $stat = $zip->statIndex($i);
                $bytes = (int) ($stat['size'] ?? 0);
                $totalUncompressed += $bytes;
                $limit = str_starts_with($name, 'attachments/') ? 64 * 1024 * 1024 : 256 * 1024 * 1024;
                if ($bytes < 0 || $bytes > $limit || $totalUncompressed > 2 * self::MAX_ARCHIVE_BYTES) {
                    throw new RuntimeException('ZIP имеет недопустимый распакованный размер. Проверка остановлена.');
                }
            }
            $rawManifest = $zip->getFromName('manifest.json');
            if (!is_string($rawManifest)) {
                throw new RuntimeException('В ZIP нет manifest.json. Это не снимок данных Лоции.');
            }
            $manifest = json_decode($rawManifest, true, 512, JSON_THROW_ON_ERROR);
            if (($manifest['format'] ?? '') !== self::FORMAT) {
                throw new RuntimeException('Формат снимка не поддерживается этой версией Лоции.');
            }
            foreach ((array) ($manifest['tables'] ?? []) as $table => $meta) {
                if (!in_array($table, self::TABLES, true)) {
                    throw new RuntimeException('Снимок содержит неподдерживаемую таблицу: ' . $table . '.');
                }
                $entry = 'data/' . $table . '.json';
                $payload = $zip->getFromName($entry);
                if (!is_string($payload) || !hash_equals((string) ($meta['sha256'] ?? ''), hash('sha256', $payload))) {
                    throw new RuntimeException('Контрольная сумма данных не совпала: ' . $table . '.');
                }
                $rows = json_decode($payload, true, 512, JSON_THROW_ON_ERROR);
                if (!is_array($rows) || count($rows) !== (int) ($meta['rows'] ?? -1)) {
                    throw new RuntimeException('Количество строк не совпало: ' . $table . '.');
                }
            }
            foreach ((array) ($manifest['files'] ?? []) as $entry => $meta) {
                $this->validateEntryName((string) $entry);
                if (!str_starts_with((string) $entry, 'attachments/')) {
                    throw new RuntimeException('В ZIP обнаружен файл вне разрешённой папки вложений.');
                }
                $payload = $zip->getFromName((string) $entry);
                if (!is_string($payload) || strlen($payload) !== (int) ($meta['bytes'] ?? -1)
                    || !hash_equals((string) ($meta['sha256'] ?? ''), hash('sha256', $payload))) {
                    throw new RuntimeException('Контрольная сумма вложения не совпала: ' . basename((string) $entry) . '.');
                }
            }

            return $manifest;
        } finally {
            $zip->close();
        }
    }

    public function import(string $archivePath, int $operatorId, ?PDO $pdo = null): array
    {
        $pdo = $pdo ?? Database::pdo();
        $manifest = $this->inspect($archivePath);
        $backupDir = self::storageRoot() . '/backups';
        $this->ensurePrivateDir($backupDir);
        $backup = $this->export($pdo, $backupDir . '/before-import-' . date('Ymd-His') . '.zip');

        $zip = new ZipArchive();
        $zip->open($archivePath);
        $staged = self::storageRoot() . '/staging/' . bin2hex(random_bytes(12));
        $this->ensurePrivateDir($staged);
        $stagedUploads = $staged . '/uploads';
        $this->ensurePrivateDir($stagedUploads);
        $uploadsRoot = BASE_PATH . '/storage/uploads/tasks';
        $oldUploads = '';
        $uploadsInstalled = false;
        try {
            foreach ((array) ($manifest['files'] ?? []) as $entry => $_meta) {
                $relative = $this->safeRelativePath(substr((string) $entry, strlen('attachments/')));
                $destination = $stagedUploads . '/' . $relative;
                $this->ensurePrivateDir(dirname($destination));
                $stream = $zip->getStream((string) $entry);
                $output = @fopen($destination, 'wb');
                if (!is_resource($stream) || !is_resource($output) || stream_copy_to_stream($stream, $output) === false) {
                    if (is_resource($output)) {
                        fclose($output);
                    }
                    throw new RuntimeException('Не удалось подготовить вложение: ' . basename($relative) . '.');
                }
                fclose($stream);
                fclose($output);
                @chmod($destination, 0600);
            }

            $driver = (string) $pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
            if ($driver === 'sqlite') {
                $pdo->exec('PRAGMA foreign_keys = OFF');
            } else {
                $pdo->exec('SET FOREIGN_KEY_CHECKS = 0');
            }
            $pdo->beginTransaction();
            try {
                foreach (array_reverse(self::TABLES) as $table) {
                    if ($this->tableExists($pdo, $table)) {
                        $pdo->exec('DELETE FROM ' . $this->quoteIdentifier($table, $pdo));
                    }
                }
                foreach (self::TABLES as $table) {
                    if (!isset($manifest['tables'][$table]) || !$this->tableExists($pdo, $table)) {
                        continue;
                    }
                    $rows = json_decode((string) $zip->getFromName('data/' . $table . '.json'), true, 512, JSON_THROW_ON_ERROR);
                    $targetColumns = $this->tableColumns($pdo, $table);
                    foreach ($rows as $row) {
                        $row = array_intersect_key((array) $row, array_flip($targetColumns));
                        if ($row === []) {
                            continue;
                        }
                        $columns = array_keys($row);
                        $sql = 'INSERT INTO ' . $this->quoteIdentifier($table, $pdo)
                            . ' (' . implode(', ', array_map(fn ($column) => $this->quoteIdentifier($column, $pdo), $columns)) . ')'
                            . ' VALUES (' . implode(', ', array_fill(0, count($columns), '?')) . ')';
                        $pdo->prepare($sql)->execute(array_values($row));
                    }
                }

                if ((array) ($manifest['files'] ?? []) !== []) {
                    $oldUploads = self::storageRoot() . '/staging/old-tasks-' . bin2hex(random_bytes(8));
                    if (is_dir($uploadsRoot) && !@rename($uploadsRoot, $oldUploads)) {
                        throw new RuntimeException('Не удалось временно убрать прежние вложения. Импорт отменён.');
                    }
                    $this->ensurePrivateDir(dirname($uploadsRoot));
                    if (!@rename($stagedUploads . '/tasks', $uploadsRoot)) {
                        if (is_dir($oldUploads)) {
                            @rename($oldUploads, $uploadsRoot);
                        }
                        throw new RuntimeException('Не удалось установить новые вложения. Импорт отменён.');
                    }
                    $uploadsInstalled = true;
                }
                $pdo->commit();
                if ($oldUploads !== '') {
                    $this->removeTree($oldUploads);
                }
            } catch (\Throwable $e) {
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
                if ($uploadsInstalled && is_dir($uploadsRoot)) {
                    $this->removeTree($uploadsRoot);
                }
                if ($oldUploads !== '' && is_dir($oldUploads)) {
                    @rename($oldUploads, $uploadsRoot);
                }
                throw $e;
            } finally {
                if ($driver === 'sqlite') {
                    $pdo->exec('PRAGMA foreign_keys = ON');
                } else {
                    $pdo->exec('SET FOREIGN_KEY_CHECKS = 1');
                }
            }
        } finally {
            $zip->close();
            $this->removeTree($staged);
        }

        AuditService::record('cloud_data_import', [
            'operator_id' => $operatorId,
            'source_version' => (string) ($manifest['source_version'] ?? ''),
            'tables' => count((array) ($manifest['tables'] ?? [])),
            'backup' => basename((string) $backup['path']),
        ]);

        return ['manifest' => $manifest, 'backup' => $backup['path']];
    }

    public function storeUpload(array $file): string
    {
        if ((int) ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            throw new RuntimeException('ZIP не загрузился. Выберите файл повторно и проверьте лимит загрузки сервера.');
        }
        $tmp = (string) ($file['tmp_name'] ?? '');
        if ($tmp === '' || !is_file($tmp)) {
            throw new RuntimeException('Временный файл загрузки не найден.');
        }
        if ((int) ($file['size'] ?? filesize($tmp)) > self::MAX_ARCHIVE_BYTES) {
            throw new RuntimeException('ZIP больше 1 ГБ.');
        }
        $dir = self::storageRoot() . '/imports';
        $this->ensurePrivateDir($dir);
        $path = $dir . '/' . bin2hex(random_bytes(20)) . '.zip';
        $moved = PHP_SAPI === 'cli' ? copy($tmp, $path) : move_uploaded_file($tmp, $path);
        if (!$moved) {
            throw new RuntimeException('Сервер не смог сохранить ZIP для проверки.');
        }
        @chmod($path, 0600);
        return $path;
    }

    private function tableExists(PDO $pdo, string $table): bool
    {
        if ((string) $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite') {
            $stmt = $pdo->prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?");
            $stmt->execute([$table]);
            return (bool) $stmt->fetchColumn();
        }
        $stmt = $pdo->prepare('SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?');
        $stmt->execute([$table]);
        return (bool) $stmt->fetchColumn();
    }

    private function tableColumns(PDO $pdo, string $table): array
    {
        if ((string) $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite') {
            return array_column($pdo->query('PRAGMA table_info(' . $this->quoteIdentifier($table, $pdo) . ')')->fetchAll(PDO::FETCH_ASSOC), 'name');
        }
        $stmt = $pdo->prepare('SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position');
        $stmt->execute([$table]);
        return $stmt->fetchAll(PDO::FETCH_COLUMN);
    }

    private function quoteIdentifier(string $value, PDO $pdo): string
    {
        if (!preg_match('/^[a-z][a-z0-9_]*$/', $value)) {
            throw new RuntimeException('Недопустимое имя поля в снимке.');
        }
        return (string) $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite' ? '"' . $value . '"' : '`' . $value . '`';
    }

    private function validateEntryName(string $name): void
    {
        $normalized = str_replace('\\', '/', $name);
        if ($normalized === '' || str_starts_with($normalized, '/') || preg_match('#(^|/)\.\.(/|$)#', $normalized)
            || preg_match('/^[A-Za-z]:/', $normalized) || str_contains($normalized, "\0")) {
            throw new RuntimeException('ZIP содержит небезопасный путь.');
        }
        if ($normalized !== 'manifest.json' && !preg_match('#^(data/[a-z][a-z0-9_]*\.json|attachments/tasks/[0-9]+/[A-Za-z0-9._-]+)$#', $normalized)) {
            throw new RuntimeException('ZIP содержит неизвестный файл: ' . $normalized . '.');
        }
    }

    private function safeRelativePath(string $path): string
    {
        $path = str_replace('\\', '/', trim($path));
        if (!preg_match('#^tasks/[0-9]+/[A-Za-z0-9._-]+$#', $path)) {
            throw new RuntimeException('Некорректный путь вложения в снимке.');
        }
        return $path;
    }

    private function ensurePrivateDir(string $dir): void
    {
        if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) {
            throw new RuntimeException('Не удалось создать закрытую папку обмена: ' . basename($dir) . '.');
        }
        @chmod($dir, 0700);
    }

    private function requireZip(): void
    {
        if (!class_exists(ZipArchive::class)) {
            throw new RuntimeException('На сервере не установлен PHP-модуль zip. Экспорт и импорт недоступны до его установки.');
        }
    }

    private function removeTree(string $path): void
    {
        if ($path === '' || !is_dir($path)) {
            return;
        }
        $items = scandir($path) ?: [];
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }
            $child = $path . '/' . $item;
            is_dir($child) ? $this->removeTree($child) : @unlink($child);
        }
        @rmdir($path);
    }
}
