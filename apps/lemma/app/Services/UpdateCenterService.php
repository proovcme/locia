<?php

declare(strict_types=1);

namespace App\Services;

final class UpdateCenterService
{
    private const STATUS_FILE = 'status.json';
    private const MANIFEST_FILE = 'manifest-cache.json';
    private const JOB_FILE = 'install-current.json';

    /**
     * @return array<string,mixed>
     */
    public function dashboard(): array
    {
        return [
            'settings' => $this->settings(),
            'current_version' => $this->currentVersion(),
            'manifest' => $this->readJson($this->storagePath(self::MANIFEST_FILE)),
            'downloaded' => $this->downloadedPackages(),
            'status' => $this->readJson($this->storagePath(self::STATUS_FILE)),
            'worker_status' => $this->readJson($this->storagePath('jobs/status.json')),
            'latest_report' => $this->latestTelemetryReport(),
        ];
    }

    /**
     * @return array<string,mixed>
     */
    public function settings(): array
    {
        $baseUrl = rtrim((string) config('update_center.base_url', ''), '/');

        return [
            'enabled' => (bool) config('update_center.enabled', false),
            'base_url' => $baseUrl,
            'manifest_url' => (string) config('update_center.manifest_url', ''),
            'telemetry_url' => (string) config('update_center.telemetry_url', ''),
            'token_set' => (string) config('update_center.token', '') !== '',
            'public_key_set' => (string) config('update_center.public_key', '') !== '',
            'require_signature' => (bool) config('update_center.require_signature', true),
            'allow_http' => (bool) config('update_center.allow_http', false),
            'verify_tls' => (bool) config('update_center.verify_tls', true),
            'task_name' => (string) config('update_center.task_name', 'LociaERP\Updater'),
            'storage_dir' => $this->storageDir(),
            'fix_dir' => $this->fixDir(),
        ];
    }

    /**
     * @return array<string,mixed>
     */
    public function checkForUpdates(): array
    {
        $this->assertEnabled();
        $manifestUrl = $this->manifestUrl();
        $manifest = $this->requestJson($manifestUrl);
        $this->verifyManifestSignature($manifest);

        $normalized = $this->normalizeManifest($manifest, $manifestUrl);
        $compatible = $this->compatiblePackages($normalized);
        $normalized['compatible_packages'] = $compatible;
        $normalized['checked_at'] = date(DATE_ATOM);

        $this->writeJson($this->storagePath(self::MANIFEST_FILE), $normalized);
        $this->writeStatus([
            'stage' => 'checked',
            'ok' => true,
            'message' => 'manifest_checked',
            'checked_at' => $normalized['checked_at'],
            'compatible_count' => count($compatible),
        ]);

        return $normalized;
    }

    /**
     * @return array<string,mixed>
     */
    public function downloadLatestCompatible(): array
    {
        $this->assertEnabled();
        // Never install from a stale/tampered local cache. The manifest is
        // fetched and its detached signature is checked for every download.
        $manifest = $this->checkForUpdates();

        $packages = $this->compatiblePackages($manifest);
        if ($packages === []) {
            throw new \RuntimeException('Нет пакета, совместимого с текущей версией ' . $this->currentVersion() . '.');
        }

        $package = $packages[0];
        $url = $this->resolveUrl((string) ($manifest['source_url'] ?? $this->manifestUrl()), (string) $package['url']);
        $bytes = $this->requestBytes($url);
        $sha = hash('sha256', $bytes);
        $expectedSha = mb_strtolower((string) ($package['sha256'] ?? ''), 'UTF-8');
        if ($expectedSha === '' || !hash_equals($expectedSha, $sha)) {
            throw new \RuntimeException('SHA256 пакета не совпал.');
        }

        $name = $this->safeFilename((string) ($package['name'] ?? basename((string) parse_url($url, PHP_URL_PATH))));
        $target = $this->fixDir() . DIRECTORY_SEPARATOR . $name;
        $this->ensureDirectory(dirname($target));
        file_put_contents($target, $bytes);

        $validation = (new UpdateInboxService())->validatePackage($target);
        if (!$validation['ok']) {
            @unlink($target);
            throw new \RuntimeException('Пакет не прошёл проверку: ' . implode(', ', $validation['errors']));
        }

        $packageManifest = is_array($validation['manifest']) ? $validation['manifest'] : [];
        $this->assertPackageBaseCompatible($packageManifest);

        $meta = [
            'status' => 'downloaded',
            'name' => $name,
            'path' => $target,
            'sha256' => $sha,
            'base_version' => (string) ($packageManifest['base_version'] ?? $package['base_version'] ?? ''),
            'target_version' => (string) ($packageManifest['target_version'] ?? $package['target_version'] ?? ''),
            'manifest' => $packageManifest,
            'downloaded_at' => date(DATE_ATOM),
            'install_command' => $this->installCommand($target),
        ];
        $this->writeJson($this->downloadMetaPath($name), $meta);
        $this->writeStatus([
            'stage' => 'downloaded',
            'ok' => true,
            'message' => 'package_downloaded',
            'package' => $name,
            'downloaded_at' => $meta['downloaded_at'],
        ]);

        return $meta;
    }

    /**
     * @return array<string,mixed>
     */
    public function queueInstall(?string $packagePath = null): array
    {
        $package = $packagePath !== null && trim($packagePath) !== ''
            ? $this->packageMetaByPath($packagePath)
            : $this->latestDownloadedPackage();
        if (!$package) {
            throw new \RuntimeException('Сначала скачайте пакет обновления.');
        }

        $path = (string) $package['path'];
        if (!is_file($path)) {
            throw new \RuntimeException('Файл пакета не найден: ' . $path);
        }
        $expectedSha = mb_strtolower(trim((string) ($package['sha256'] ?? '')), 'UTF-8');
        if (!preg_match('/^[a-f0-9]{64}$/', $expectedSha)) {
            throw new \RuntimeException('У скачанного пакета отсутствует доверенный SHA256. Скачайте пакет заново.');
        }
        $actualSha = hash_file('sha256', $path);
        if (!is_string($actualSha) || !hash_equals($expectedSha, $actualSha)) {
            throw new \RuntimeException('Пакет изменился после скачивания; установка запрещена.');
        }

        $job = [
            'status' => 'queued',
            'package_path' => $path,
            'package_name' => basename($path),
            'sha256' => $expectedSha,
            'install_root' => BASE_PATH,
            'queued_at' => date(DATE_ATOM),
        ];
        $this->writeJson($this->storagePath('jobs/' . self::JOB_FILE), $job);
        $this->writeStatus([
            'stage' => 'install_queued',
            'ok' => true,
            'message' => 'install_job_queued',
            'package' => basename($path),
            'queued_at' => $job['queued_at'],
        ]);

        $taskResult = $this->runUpdaterTask();
        return [...$job, ...$taskResult];
    }

    /**
     * @return array<string,mixed>
     */
    public function sendTelemetry(): array
    {
        $this->assertEnabled();
        $telemetryUrl = $this->telemetryUrl();
        $report = $this->collectTelemetryReport();
        $response = $this->uploadFile($telemetryUrl, $report);
        $result = [
            'status' => 'sent',
            'report' => $report,
            'bytes' => filesize($report) ?: 0,
            'response' => $response,
            'sent_at' => date(DATE_ATOM),
        ];
        $this->writeStatus([
            'stage' => 'telemetry_sent',
            'ok' => true,
            'message' => 'telemetry_uploaded',
            'report' => basename($report),
            'sent_at' => $result['sent_at'],
        ]);

        return $result;
    }

    private function assertEnabled(): void
    {
        if (!(bool) config('update_center.enabled', false)) {
            throw new \RuntimeException('Update Center выключен. Задайте UPDATE_CENTER_ENABLED=1.');
        }
        if ($this->baseUrl() === '' && (string) config('update_center.manifest_url', '') === '') {
            throw new \RuntimeException('Не задан UPDATE_CENTER_URL или UPDATE_CENTER_MANIFEST_URL.');
        }
        if ((bool) config('update_center.require_signature', true)
            && trim((string) config('update_center.public_key', '')) === '') {
            throw new \RuntimeException('Не задан UPDATE_CENTER_PUBLIC_KEY для обязательной проверки подписи manifest.');
        }
        if (in_array((string) config('app.env', 'local'), ['production', 'prod'], true)
            && !(bool) config('update_center.verify_tls', true)) {
            throw new \RuntimeException('В production запрещено отключать проверку TLS Update Center.');
        }
    }

    private function currentVersion(): string
    {
        $info = app_version_info();
        return (string) ($info['version'] ?? 'dev');
    }

    private function baseUrl(): string
    {
        return rtrim((string) config('update_center.base_url', ''), '/');
    }

    private function manifestUrl(): string
    {
        $url = trim((string) config('update_center.manifest_url', ''));
        if ($url === '') {
            $url = $this->baseUrl() . '/manifest.json';
        }

        return $this->assertAllowedUrl($url);
    }

    private function telemetryUrl(): string
    {
        $url = trim((string) config('update_center.telemetry_url', ''));
        if ($url === '') {
            $url = $this->baseUrl() . '/telemetry';
        }

        return $this->assertAllowedUrl($url);
    }

    private function assertAllowedUrl(string $url): string
    {
        $scheme = strtolower((string) parse_url($url, PHP_URL_SCHEME));
        if ($scheme === 'https') {
            return $url;
        }
        if ($scheme === 'http' && (bool) config('update_center.allow_http', false)) {
            return $url;
        }

        throw new \RuntimeException('Update Center принимает только HTTPS URL.');
    }

    /**
     * @return array<string,mixed>
     */
    private function requestJson(string $url): array
    {
        $raw = $this->requestBytes($url, 'GET', null, ['Accept: application/json']);
        $json = json_decode($raw, true);
        if (!is_array($json)) {
            throw new \RuntimeException('VPS вернул некорректный JSON manifest.');
        }

        return $json;
    }

    /**
     * @param list<string> $extraHeaders
     */
    private function requestBytes(string $url, string $method = 'GET', ?string $body = null, array $extraHeaders = []): string
    {
        $url = $this->assertAllowedUrl($url);
        $headers = $this->authHeaders();
        $headers = array_merge($headers, $extraHeaders);
        if ($body !== null) {
            $headers[] = 'Content-Length: ' . strlen($body);
        }

        if (function_exists('curl_init')) {
            return $this->requestBytesCurl($url, $method, $body, $headers);
        }

        return $this->requestBytesStream($url, $method, $body, $headers);
    }

    /**
     * @param list<string> $headers
     */
    private function requestBytesCurl(string $url, string $method, ?string $body, array $headers): string
    {
        $verifyTls = (bool) config('update_center.verify_tls', true);
        $caBundles = $verifyTls ? $this->caBundles() : [null];
        if ($caBundles === []) {
            $caBundles = [null];
        }
        $lastStatus = 0;
        $lastErrno = 0;
        $lastError = '';

        foreach ($caBundles as $index => $caBundle) {
            $handle = curl_init($url);
            if ($handle === false) {
                throw new \RuntimeException('cURL недоступен для запроса к VPS.');
            }
            curl_setopt_array($handle, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_CUSTOMREQUEST => $method,
                CURLOPT_HTTPHEADER => $headers,
                CURLOPT_TIMEOUT => (int) config('update_center.timeout', 60),
                CURLOPT_FOLLOWLOCATION => false,
                CURLOPT_SSL_VERIFYPEER => $verifyTls,
                CURLOPT_SSL_VERIFYHOST => $verifyTls ? 2 : 0,
            ]);
            if ($verifyTls && is_string($caBundle) && $caBundle !== '') {
                curl_setopt($handle, CURLOPT_CAINFO, $caBundle);
            }
            if ($body !== null) {
                curl_setopt($handle, CURLOPT_POSTFIELDS, $body);
            }

            $result = curl_exec($handle);
            $lastStatus = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
            $lastErrno = curl_errno($handle);
            $lastError = curl_error($handle);
            curl_close($handle);

            if (is_string($result) && $lastErrno === 0 && $lastStatus >= 200 && $lastStatus < 300) {
                return $result;
            }
            $hasFallback = $index < count($caBundles) - 1;
            if (!$hasFallback || !in_array($lastErrno, [60, 77], true)) {
                break;
            }
        }

        $detail = $lastErrno !== 0 ? (' cURL=' . $lastErrno . ' ' . $lastError) : '';
        throw new \RuntimeException('HTTP-запрос к VPS не прошёл: ' . $url . ' status=' . $lastStatus . $detail);
    }

    /**
     * @param list<string> $headers
     */
    private function requestBytesStream(string $url, string $method, ?string $body, array $headers): string
    {
        $verifyTls = (bool) config('update_center.verify_tls', true);
        $caBundles = $verifyTls ? $this->caBundles() : [null];
        if ($caBundles === []) {
            $caBundles = [null];
        }
        $lastStatus = 0;
        $lastDetail = '';

        foreach ($caBundles as $caBundle) {
            $ssl = [
                'verify_peer' => $verifyTls,
                'verify_peer_name' => $verifyTls,
            ];
            if ($verifyTls && is_string($caBundle) && $caBundle !== '') {
                $ssl['cafile'] = $caBundle;
            }
            $context = stream_context_create([
                'http' => [
                    'method' => $method,
                    'header' => implode("\r\n", $headers),
                    'content' => $body ?? '',
                    'ignore_errors' => true,
                    'timeout' => (int) config('update_center.timeout', 60),
                ],
                'ssl' => $ssl,
            ]);
            $beforeError = error_get_last();
            $http_response_header = [];
            $result = @file_get_contents($url, false, $context);
            $afterError = error_get_last();
            $lastStatus = $this->httpStatus($http_response_header);
            $lastDetail = is_array($afterError) && $afterError !== $beforeError
                ? ' ' . (string) ($afterError['message'] ?? '')
                : '';
            if (is_string($result) && $lastStatus >= 200 && $lastStatus < 300) {
                return $result;
            }
            if (is_string($result)) {
                break;
            }
        }

        throw new \RuntimeException('HTTP-запрос к VPS не прошёл: ' . $url . ' status=' . $lastStatus . $lastDetail);
    }

    /**
     * @return list<string>
     */
    private function authHeaders(): array
    {
        $headers = ['User-Agent: LociaERP-UpdateCenter/1.0'];
        $token = (string) config('update_center.token', '');
        if ($token !== '') {
            $headers[] = 'Authorization: Bearer ' . $token;
        }

        return $headers;
    }

    /**
     * @return list<string>
     */
    private function caBundles(): array
    {
        $paths = [
            trim((string) config('tls.ca_bundle', '')),
            trim((string) config('tls.bundled_ca_bundle', '')),
        ];
        $result = [];
        foreach ($paths as $path) {
            if ($path !== '' && is_file($path) && !in_array($path, $result, true)) {
                $result[] = $path;
            }
        }

        return $result;
    }

    /**
     * @param list<string> $headers
     */
    private function httpStatus(array $headers): int
    {
        foreach ($headers as $line) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', (string) $line, $m)) {
                return (int) $m[1];
            }
        }

        return 0;
    }

    /**
     * @param array<string,mixed> $manifest
     */
    private function verifyManifestSignature(array $manifest): void
    {
        $required = (bool) config('update_center.require_signature', true);
        $publicKey = trim((string) config('update_center.public_key', ''));
        if ($publicKey === '') {
            if ($required) {
                throw new \RuntimeException('Не задан публичный ключ подписи manifest.');
            }
            return;
        }
        if (!function_exists('sodium_crypto_sign_verify_detached')) {
            throw new \RuntimeException('Для проверки подписи manifest требуется PHP Sodium.');
        }
        $signature = (string) ($manifest['signature'] ?? '');
        if ($signature === '') {
            if ($required) {
                throw new \RuntimeException('Manifest не содержит обязательную подпись.');
            }
            return;
        }

        $signed = $manifest;
        unset($signed['signature']);
        $payload = json_encode($signed, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $sig = base64_decode($signature, true);
        $key = base64_decode($publicKey, true);
        if (!is_string($payload)
            || $sig === false
            || strlen($sig) !== SODIUM_CRYPTO_SIGN_BYTES
            || $key === false
            || strlen($key) !== SODIUM_CRYPTO_SIGN_PUBLICKEYBYTES
            || !sodium_crypto_sign_verify_detached($sig, $payload, $key)) {
            throw new \RuntimeException('Подпись manifest не прошла проверку.');
        }
    }

    /**
     * @param array<string,mixed> $manifest
     * @return array<string,mixed>
     */
    private function normalizeManifest(array $manifest, string $sourceUrl): array
    {
        $packages = $manifest['packages'] ?? [];
        if (!is_array($packages) && isset($manifest['package'])) {
            $packages = [$manifest['package']];
        }
        if (!is_array($packages)) {
            $packages = [];
        }

        $normalizedPackages = [];
        foreach ($packages as $package) {
            if (!is_array($package)) {
                continue;
            }
            $name = trim((string) ($package['name'] ?? $package['package_name'] ?? ''));
            $url = trim((string) ($package['url'] ?? $package['href'] ?? ''));
            $sha = mb_strtolower(trim((string) ($package['sha256'] ?? '')), 'UTF-8');
            if ($name === '' || $url === '' || !preg_match('/^[a-f0-9]{64}$/', $sha)) {
                continue;
            }
            $normalizedPackages[] = [
                'name' => $name,
                'url' => $url,
                'sha256' => $sha,
                'base_version' => (string) ($package['base_version'] ?? ''),
                'base_versions' => array_values(array_filter(array_map('strval', (array) ($package['base_versions'] ?? [])))),
                'target_version' => (string) ($package['target_version'] ?? $package['version'] ?? ''),
                'size' => (int) ($package['size'] ?? 0),
                'notes' => (array) ($package['notes'] ?? []),
                'published_at' => (string) ($package['published_at'] ?? ''),
            ];
        }

        usort($normalizedPackages, static function (array $a, array $b): int {
            return version_compare((string) ($b['target_version'] ?? ''), (string) ($a['target_version'] ?? ''));
        });

        return [
            'schema' => (int) ($manifest['schema'] ?? 1),
            'source_url' => $sourceUrl,
            'channel' => (string) ($manifest['channel'] ?? 'stable'),
            'generated_at' => (string) ($manifest['generated_at'] ?? ''),
            'packages' => $normalizedPackages,
        ];
    }

    /**
     * @param array<string,mixed> $manifest
     * @return list<array<string,mixed>>
     */
    private function compatiblePackages(array $manifest): array
    {
        $current = $this->currentVersion();
        $packages = is_array($manifest['packages'] ?? null) ? $manifest['packages'] : [];
        $compatible = [];
        foreach ($packages as $package) {
            if (!is_array($package)) {
                continue;
            }
            $bases = array_values(array_filter(array_map('strval', (array) ($package['base_versions'] ?? []))));
            $base = (string) ($package['base_version'] ?? '');
            if ($base !== '') {
                $bases[] = $base;
            }
            if ($bases === [] || in_array($current, $bases, true)) {
                $compatible[] = $package;
            }
        }

        return $compatible;
    }

    /**
     * @param array<string,mixed> $manifest
     */
    private function assertPackageBaseCompatible(array $manifest): void
    {
        $current = $this->currentVersion();
        $bases = array_values(array_filter(array_map('strval', (array) ($manifest['base_versions'] ?? []))));
        $base = (string) ($manifest['base_version'] ?? '');
        if ($base !== '') {
            $bases[] = $base;
        }
        if ($bases !== [] && !in_array($current, $bases, true)) {
            throw new \RuntimeException('Пакет собран не для текущей версии ' . $current . '. Base: ' . implode(', ', $bases));
        }
    }

    private function resolveUrl(string $base, string $url): string
    {
        if (preg_match('#^https?://#i', $url)) {
            return $this->assertAllowedUrl($url);
        }
        $parts = parse_url($base);
        if (empty($parts['scheme']) || empty($parts['host'])) {
            throw new \RuntimeException('Не удалось собрать URL пакета.');
        }
        $origin = $parts['scheme'] . '://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '');
        $path = (string) ($parts['path'] ?? '/');
        $dir = rtrim(str_replace('\\', '/', dirname($path)), '/');
        $resolved = str_starts_with($url, '/')
            ? $origin . $url
            : $origin . ($dir === '' ? '' : $dir) . '/' . ltrim($url, '/');

        return $this->assertAllowedUrl($resolved);
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function downloadedPackages(): array
    {
        $dir = $this->storagePath('downloads');
        $items = [];
        foreach (glob($dir . '/*.json') ?: [] as $file) {
            $json = $this->readJson($file);
            if ($json) {
                $items[] = $json;
            }
        }
        usort($items, static fn (array $a, array $b): int => strcmp((string) ($b['downloaded_at'] ?? ''), (string) ($a['downloaded_at'] ?? '')));

        return $items;
    }

    /**
     * @return array<string,mixed>|null
     */
    private function latestDownloadedPackage(): ?array
    {
        $packages = $this->downloadedPackages();
        return $packages[0] ?? null;
    }

    /**
     * @return array<string,mixed>|null
     */
    private function packageMetaByPath(string $path): ?array
    {
        $full = realpath($path) ?: $path;
        foreach ($this->downloadedPackages() as $package) {
            if ((realpath((string) ($package['path'] ?? '')) ?: (string) ($package['path'] ?? '')) === $full) {
                return $package;
            }
        }

        return null;
    }

    /**
     * @return array<string,mixed>
     */
    private function runUpdaterTask(): array
    {
        if (DIRECTORY_SEPARATOR !== '\\') {
            return ['task_status' => 'queued_manual', 'task_message' => 'Scheduled Task запускается только на Windows production.'];
        }

        $taskName = (string) config('update_center.task_name', 'LociaERP\Updater');
        $command = 'schtasks.exe /Run /TN "' . str_replace('"', '\"', $taskName) . '"';
        $output = [];
        $code = 1;
        @exec($command . ' 2>&1', $output, $code);
        if ($code !== 0) {
            return [
                'task_status' => 'queued_task_missing',
                'task_message' => 'Задание не запущено. Зарегистрируйте deploy\standalone\update-center\install-update-task.cmd.',
                'task_output' => implode("\n", $output),
            ];
        }

        return ['task_status' => 'started', 'task_message' => 'Updater task запущен.'];
    }

    private function collectTelemetryReport(): string
    {
        $reportCmd = BASE_PATH . '/deploy/standalone/offline-support/locia-offline-report.cmd';
        if (!is_file($reportCmd)) {
            throw new \RuntimeException('locia-offline-report.cmd не найден.');
        }
        if (DIRECTORY_SEPARATOR !== '\\') {
            $latest = $this->latestTelemetryReport();
            if ($latest !== null) {
                return $latest;
            }
            throw new \RuntimeException('Сбор telemetry через .cmd доступен на Windows production.');
        }

        $command = '"' . str_replace('/', '\\', $reportCmd) . '" "' . str_replace('/', '\\', BASE_PATH) . '"';
        $output = [];
        $code = 1;
        @exec($command . ' 2>&1', $output, $code);
        if ($code !== 0) {
            throw new \RuntimeException('Сбор telemetry завершился ошибкой: ' . implode("\n", $output));
        }

        $latest = $this->latestTelemetryReport();
        if ($latest === null) {
            throw new \RuntimeException('Telemetry ZIP не найден после сборки отчёта.');
        }

        return $latest;
    }

    /**
     * @return array<string,mixed>
     */
    private function uploadFile(string $url, string $file): array
    {
        if (!is_file($file)) {
            throw new \RuntimeException('Telemetry ZIP не найден: ' . $file);
        }
        $boundary = 'locia-' . bin2hex(random_bytes(12));
        $body = '';
        $fields = [
            'version' => $this->currentVersion(),
            'sent_at' => date(DATE_ATOM),
        ];
        foreach ($fields as $name => $value) {
            $body .= "--{$boundary}\r\n";
            $body .= 'Content-Disposition: form-data; name="' . $name . '"' . "\r\n\r\n";
            $body .= $value . "\r\n";
        }
        $body .= "--{$boundary}\r\n";
        $body .= 'Content-Disposition: form-data; name="report"; filename="' . basename($file) . '"' . "\r\n";
        $body .= "Content-Type: application/zip\r\n\r\n";
        $body .= (string) file_get_contents($file) . "\r\n";
        $body .= "--{$boundary}--\r\n";

        $raw = $this->requestBytes($url, 'POST', $body, ['Content-Type: multipart/form-data; boundary=' . $boundary]);
        $json = json_decode($raw, true);

        return is_array($json) ? $json : ['raw' => mb_substr($raw, 0, 500, 'UTF-8')];
    }

    private function latestTelemetryReport(): ?string
    {
        $files = glob(BASE_PATH . '/storage/logs/locia-offline-report-*.zip') ?: [];
        usort($files, static fn (string $a, string $b): int => filemtime($b) <=> filemtime($a));

        return $files[0] ?? null;
    }

    private function writeStatus(array $status): void
    {
        $status['updated_at'] = date(DATE_ATOM);
        $this->writeJson($this->storagePath(self::STATUS_FILE), $status);
    }

    private function storageDir(): string
    {
        return rtrim((string) config('update_center.storage_dir', BASE_PATH . '/storage/update-center'), "\\/");
    }

    private function fixDir(): string
    {
        return rtrim((string) config('update_center.fix_dir', BASE_PATH . '/fix'), "\\/");
    }

    private function storagePath(string $relative): string
    {
        return $this->storageDir() . '/' . ltrim($relative, '/');
    }

    private function downloadMetaPath(string $packageName): string
    {
        return $this->storagePath('downloads/' . $packageName . '.json');
    }

    /**
     * @return array<string,mixed>|null
     */
    private function readJson(string $path): ?array
    {
        if (!is_file($path)) {
            return null;
        }
        $json = json_decode((string) file_get_contents($path), true);

        return is_array($json) ? $json : null;
    }

    /**
     * @param array<string,mixed> $data
     */
    private function writeJson(string $path, array $data): void
    {
        $this->ensureDirectory(dirname($path));
        file_put_contents($path, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n");
    }

    private function installCommand(string $packagePath): string
    {
        $root = rtrim(BASE_PATH, "\\/");
        if (DIRECTORY_SEPARATOR === '\\') {
            return '"' . $root . '\deploy\standalone\apply-fixes.cmd" "' . $packagePath . '"';
        }

        return $root . '/deploy/standalone/apply-fixes.cmd ' . $packagePath;
    }

    private function safeFilename(string $filename): string
    {
        $name = basename(str_replace('\\', '/', $filename));
        $name = preg_replace('/[^A-Za-z0-9._-]+/', '-', $name) ?? 'update.zip';
        $name = trim($name, '.-');

        return $name !== '' ? $name : 'update.zip';
    }

    private function ensureDirectory(string $path): void
    {
        if (!is_dir($path) && !mkdir($path, 0775, true) && !is_dir($path)) {
            throw new \RuntimeException('Cannot create directory: ' . $path);
        }
    }
}
