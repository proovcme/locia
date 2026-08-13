<?php

declare(strict_types=1);

namespace App\Services;

final class UpdateInboxService
{
    private const FORBIDDEN_PARTS = [
        '.git',
        '.runtime',
        'node_modules',
        'storage',
        'uploads',
        'sessions',
        'logs',
        'backups',
        'mariadb/data',
    ];

    private const FORBIDDEN_NAMES = [
        '.env',
        '.env.bak',
        'CREDENTIALS_KEEP_SAFE.txt',
    ];

    /**
     * @return array{checked:int,accepted:int,rejected:int,items:list<array<string,mixed>>}
     */
    public function fetchFromImap(array $options): array
    {
        $host = (string) ($options['host'] ?? '');
        $port = (int) ($options['port'] ?? 993);
        $username = (string) ($options['username'] ?? '');
        $password = (string) ($options['password'] ?? '');
        $mailbox = (string) ($options['mailbox'] ?? 'INBOX');
        $subject = (string) ($options['subject'] ?? 'LOCIA UPDATE');
        $limit = max(1, min(20, (int) ($options['limit'] ?? 5)));

        if ($host === '' || $username === '' || $password === '') {
            throw new \RuntimeException('UPDATE_INBOX_HOST, UPDATE_INBOX_USERNAME and UPDATE_INBOX_PASSWORD are required.');
        }

        $client = new MinimalImapClient($host, $port, $username, $password);
        try {
            $client->login();
            $client->select($mailbox);
            $ids = array_slice($client->searchUnseenBySubject($subject), 0, $limit);
            $result = ['checked' => 0, 'accepted' => 0, 'rejected' => 0, 'items' => []];
            foreach ($ids as $id) {
                $raw = $client->fetchRaw($id);
                $item = $this->ingestRawMessage($raw, $options);
                $result['checked']++;
                if (($item['status'] ?? '') === 'accepted') {
                    $result['accepted']++;
                    $client->markSeen($id);
                } else {
                    $result['rejected']++;
                }
                $result['items'][] = $item;
            }

            return $result;
        } finally {
            $client->logout();
        }
    }

    /**
     * @return array<string,mixed>
     */
    public function ingestRawMessage(string $raw, array $options): array
    {
        $message = $this->parseMessage($raw);
        $from = mb_strtolower($this->emailFromHeader((string) ($message['headers']['from'] ?? '')), 'UTF-8');
        $allowed = $this->allowedSenders((string) ($options['allowed_senders'] ?? ''));
        if ($allowed !== [] && !in_array($from, $allowed, true)) {
            return ['status' => 'rejected', 'reason' => 'sender_not_allowed', 'from' => $from];
        }

        $attachments = $message['attachments'];
        $shaFromText = $this->shaFromText((string) $message['text']);
        foreach ($attachments as $attachment) {
            if (!str_ends_with(mb_strtolower((string) $attachment['filename'], 'UTF-8'), '.zip')) {
                continue;
            }

            return $this->storePackage(
                (string) $attachment['filename'],
                (string) $attachment['content'],
                $shaFromText,
                $from,
                $options
            );
        }

        return ['status' => 'rejected', 'reason' => 'zip_attachment_not_found', 'from' => $from];
    }

    /**
     * @return array{headers:array<string,string>,text:string,attachments:list<array{filename:string,content:string}>}
     */
    public function parseMessage(string $raw): array
    {
        [$headerBlock, $body] = $this->splitHeaderBody($raw);
        $headers = $this->parseHeaders($headerBlock);
        $attachments = [];
        $text = '';
        $this->collectMimeParts($headers, $body, $attachments, $text);

        return ['headers' => $headers, 'text' => $text, 'attachments' => $attachments];
    }

    /**
     * @return array{ok:bool,errors:list<string>,manifest:array<string,mixed>|null}
     */
    public function validatePackage(string $zipPath): array
    {
        if (!class_exists(\ZipArchive::class)) {
            return ['ok' => false, 'errors' => ['zip_extension_missing'], 'manifest' => null];
        }
        $zip = new \ZipArchive();
        if ($zip->open($zipPath) !== true) {
            return ['ok' => false, 'errors' => ['zip_open_failed'], 'manifest' => null];
        }

        $errors = [];
        $manifest = null;
        $hasManifest = false;
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $name = str_replace('\\', '/', (string) $zip->getNameIndex($i));
            $normalized = trim($name, '/');
            if ($normalized === '' || str_contains($normalized, '../') || str_starts_with($normalized, '../')) {
                $errors[] = 'unsafe_path:' . $name;
                continue;
            }
            if (basename($normalized) === 'manifest.json') {
                $hasManifest = true;
                $rawManifest = $zip->getFromIndex($i);
                $decoded = is_string($rawManifest) ? json_decode($rawManifest, true) : null;
                $manifest = is_array($decoded) ? $decoded : null;
            }
            foreach (self::FORBIDDEN_NAMES as $forbiddenName) {
                if (strcasecmp(basename($normalized), $forbiddenName) === 0) {
                    $errors[] = 'forbidden_file:' . $normalized;
                }
            }
            foreach (self::FORBIDDEN_PARTS as $forbiddenPart) {
                if (str_contains(mb_strtolower($normalized, 'UTF-8'), mb_strtolower($forbiddenPart, 'UTF-8'))) {
                    $errors[] = 'forbidden_path:' . $normalized;
                    break;
                }
            }
        }
        $zip->close();

        if (!$hasManifest) {
            $errors[] = 'manifest_missing';
        }
        if ($manifest === null) {
            $errors[] = 'manifest_invalid';
        }

        return ['ok' => $errors === [], 'errors' => array_values(array_unique($errors)), 'manifest' => $manifest];
    }

    /**
     * @return array<string,mixed>
     */
    private function storePackage(string $filename, string $content, ?string $expectedSha, string $from, array $options): array
    {
        $requireSha = filter_var($options['require_sha'] ?? true, FILTER_VALIDATE_BOOL);
        $safeName = $this->safeFilename($filename);
        $sha = hash('sha256', $content);
        if ($requireSha && $expectedSha === null) {
            return ['status' => 'rejected', 'reason' => 'sha256_missing', 'filename' => $safeName, 'sha256' => $sha, 'from' => $from];
        }
        if ($expectedSha !== null && !hash_equals(mb_strtolower($expectedSha, 'UTF-8'), $sha)) {
            return ['status' => 'rejected', 'reason' => 'sha256_mismatch', 'filename' => $safeName, 'sha256' => $sha, 'expected_sha256' => $expectedSha, 'from' => $from];
        }

        $root = rtrim((string) ($options['storage_dir'] ?? BASE_PATH . '/storage/update-inbox'), "\\/");
        $acceptedDir = $root . '/accepted';
        $rejectedDir = $root . '/rejected';
        $this->ensureDirectory($acceptedDir);
        $this->ensureDirectory($rejectedDir);

        $target = $acceptedDir . '/' . date('Ymd_His') . '-' . substr($sha, 0, 10) . '-' . $safeName;
        file_put_contents($target, $content);
        $validation = $this->validatePackage($target);
        if (!$validation['ok']) {
            $rejected = $rejectedDir . '/' . basename($target);
            @rename($target, $rejected);
            file_put_contents($rejected . '.json', json_encode([
                'status' => 'rejected',
                'reason' => 'package_validation_failed',
                'errors' => $validation['errors'],
                'filename' => $safeName,
                'sha256' => $sha,
                'from' => $from,
                'received_at' => date(DATE_ATOM),
            ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return ['status' => 'rejected', 'reason' => 'package_validation_failed', 'errors' => $validation['errors'], 'path' => $rejected, 'sha256' => $sha, 'from' => $from];
        }

        $installCommand = $this->installCommand($target, (string) ($options['install_root'] ?? BASE_PATH));
        file_put_contents($target . '.json', json_encode([
            'status' => 'accepted',
            'filename' => $safeName,
            'path' => $target,
            'sha256' => $sha,
            'from' => $from,
            'manifest' => $validation['manifest'],
            'install_command' => $installCommand,
            'received_at' => date(DATE_ATOM),
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        file_put_contents($target . '.install.cmd', "@echo off\r\n" . $installCommand . "\r\n");

        return ['status' => 'accepted', 'path' => $target, 'sha256' => $sha, 'from' => $from, 'install_command' => $installCommand, 'manifest' => $validation['manifest']];
    }

    private function installCommand(string $packagePath, string $installRoot): string
    {
        $root = rtrim($installRoot, "\\/");
        if (DIRECTORY_SEPARATOR === '\\') {
            return '"' . $root . '\deploy\standalone\apply-fixes.cmd" "' . $packagePath . '"';
        }

        return $root . '/deploy/standalone/apply-fixes.cmd ' . $packagePath;
    }

    private function collectMimeParts(array $headers, string $body, array &$attachments, string &$text): void
    {
        $contentType = (string) ($headers['content-type'] ?? 'text/plain');
        $boundary = $this->param($contentType, 'boundary');
        if ($boundary !== null) {
            foreach ($this->splitMultipart($body, $boundary) as $part) {
                [$partHeaderBlock, $partBody] = $this->splitHeaderBody($part);
                $partHeaders = $this->parseHeaders($partHeaderBlock);
                $this->collectMimeParts($partHeaders, $partBody, $attachments, $text);
            }
            return;
        }

        $encoding = mb_strtolower((string) ($headers['content-transfer-encoding'] ?? ''), 'UTF-8');
        $decoded = match ($encoding) {
            'base64' => (string) base64_decode(preg_replace('/\s+/', '', $body) ?? $body, true),
            'quoted-printable' => quoted_printable_decode($body),
            default => $body,
        };
        $disposition = (string) ($headers['content-disposition'] ?? '');
        $filename = $this->param($disposition, 'filename') ?? $this->param($contentType, 'name');
        if ($filename !== null) {
            $attachments[] = ['filename' => $this->decodeHeader($filename), 'content' => $decoded];
            return;
        }
        if (str_starts_with(mb_strtolower($contentType, 'UTF-8'), 'text/')) {
            $text .= "\n" . $decoded;
        }
    }

    /**
     * @return list<string>
     */
    private function splitMultipart(string $body, string $boundary): array
    {
        $parts = [];
        $chunks = preg_split('/\R--' . preg_quote($boundary, '/') . '(?:--)?\R/', "\r\n" . $body) ?: [];
        foreach ($chunks as $chunk) {
            $chunk = trim($chunk, "\r\n");
            if ($chunk !== '' && $chunk !== '--') {
                $parts[] = $chunk;
            }
        }

        return $parts;
    }

    /**
     * @return array{0:string,1:string}
     */
    private function splitHeaderBody(string $raw): array
    {
        $normalized = str_replace("\r\n", "\n", $raw);
        $pos = strpos($normalized, "\n\n");
        if ($pos === false) {
            return [$normalized, ''];
        }

        return [substr($normalized, 0, $pos), substr($normalized, $pos + 2)];
    }

    /**
     * @return array<string,string>
     */
    private function parseHeaders(string $headerBlock): array
    {
        $unfolded = preg_replace("/\n[ \t]+/", ' ', str_replace("\r\n", "\n", $headerBlock)) ?? $headerBlock;
        $headers = [];
        foreach (explode("\n", $unfolded) as $line) {
            if (!str_contains($line, ':')) {
                continue;
            }
            [$name, $value] = explode(':', $line, 2);
            $headers[mb_strtolower(trim($name), 'UTF-8')] = trim($value);
        }

        return $headers;
    }

    private function param(string $header, string $name): ?string
    {
        if (preg_match('/(?:^|;\s*)' . preg_quote($name, '/') . '\*?=(?:"([^"]+)"|([^;]+))/i', $header, $m)) {
            $value = trim((string) ($m[1] !== '' ? $m[1] : $m[2]));
            if (str_contains($value, "''")) {
                [, $value] = explode("''", $value, 2);
                $value = rawurldecode($value);
            }
            return $value;
        }

        return null;
    }

    private function decodeHeader(string $value): string
    {
        return preg_replace_callback('/=\?([^?]+)\?([BQbq])\?([^?]+)\?=/', static function (array $m): string {
            $decoded = strtoupper($m[2]) === 'B'
                ? (string) base64_decode($m[3], true)
                : quoted_printable_decode(str_replace('_', ' ', $m[3]));
            return $decoded;
        }, $value) ?? $value;
    }

    private function shaFromText(string $text): ?string
    {
        if (preg_match('/\bsha256\b\s*[:=]?\s*([a-f0-9]{64})\b/i', $text, $m)) {
            return mb_strtolower($m[1], 'UTF-8');
        }
        if (preg_match('/\b([a-f0-9]{64})\b/i', $text, $m)) {
            return mb_strtolower($m[1], 'UTF-8');
        }

        return null;
    }

    /**
     * @return list<string>
     */
    private function allowedSenders(string $value): array
    {
        return array_values(array_filter(array_map(
            static fn (string $item): string => mb_strtolower(trim($item), 'UTF-8'),
            preg_split('/[,;\s]+/', $value) ?: []
        )));
    }

    private function emailFromHeader(string $header): string
    {
        if (preg_match('/<([^>]+)>/', $header, $m)) {
            return trim($m[1]);
        }
        if (preg_match('/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i', $header, $m)) {
            return trim($m[0]);
        }

        return trim($header);
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

final class MinimalImapClient
{
    /** @var resource|null */
    private $socket = null;
    private int $tag = 1;

    public function __construct(
        private readonly string $host,
        private readonly int $port,
        private readonly string $username,
        private readonly string $password
    ) {
    }

    public function login(): void
    {
        $this->socket = @stream_socket_client('ssl://' . $this->host . ':' . $this->port, $errno, $errstr, 30);
        if (!$this->socket) {
            throw new \RuntimeException('IMAP connect failed: ' . $errstr . ' (' . $errno . ')');
        }
        stream_set_timeout($this->socket, 30);
        $this->readLine();
        $this->command('LOGIN ' . $this->quote($this->username) . ' ' . $this->quote($this->password));
    }

    public function select(string $mailbox): void
    {
        $this->command('SELECT ' . $this->quote($mailbox));
    }

    /**
     * @return list<int>
     */
    public function searchUnseenBySubject(string $subject): array
    {
        $response = $this->command('SEARCH UNSEEN SUBJECT ' . $this->quote($subject));
        if (!preg_match('/^\* SEARCH\s+(.+)$/mi', $response, $m)) {
            return [];
        }

        return array_values(array_map('intval', preg_split('/\s+/', trim($m[1])) ?: []));
    }

    public function fetchRaw(int $id): string
    {
        $tag = $this->nextTag();
        fwrite($this->socket, $tag . ' FETCH ' . $id . " BODY.PEEK[]\r\n");
        $raw = '';
        while (($line = $this->readLine()) !== '') {
            if (preg_match('/^\* \d+ FETCH .*{(\d+)}\r\n$/', $line, $m)) {
                $bytes = (int) $m[1];
                $raw .= $this->readBytes($bytes);
                continue;
            }
            if (str_starts_with($line, $tag . ' OK')) {
                return $raw;
            }
            if (str_starts_with($line, $tag . ' NO') || str_starts_with($line, $tag . ' BAD')) {
                throw new \RuntimeException('IMAP FETCH failed: ' . trim($line));
            }
        }

        return $raw;
    }

    public function markSeen(int $id): void
    {
        $this->command('STORE ' . $id . ' +FLAGS (\\Seen)');
    }

    public function logout(): void
    {
        if ($this->socket) {
            try {
                $this->command('LOGOUT');
            } catch (\Throwable) {
                // ignore disconnect errors
            }
            fclose($this->socket);
            $this->socket = null;
        }
    }

    private function command(string $command): string
    {
        $tag = $this->nextTag();
        fwrite($this->socket, $tag . ' ' . $command . "\r\n");
        $response = '';
        while (($line = $this->readLine()) !== '') {
            $response .= $line;
            if (str_starts_with($line, $tag . ' OK')) {
                return $response;
            }
            if (str_starts_with($line, $tag . ' NO') || str_starts_with($line, $tag . ' BAD')) {
                throw new \RuntimeException('IMAP command failed: ' . trim($line));
            }
        }

        return $response;
    }

    private function nextTag(): string
    {
        return 'A' . str_pad((string) $this->tag++, 4, '0', STR_PAD_LEFT);
    }

    private function quote(string $value): string
    {
        return '"' . addcslashes($value, "\\\"") . '"';
    }

    private function readLine(): string
    {
        $line = fgets($this->socket);
        if ($line === false) {
            throw new \RuntimeException('IMAP connection closed.');
        }

        return $line;
    }

    private function readBytes(int $bytes): string
    {
        $data = '';
        while (strlen($data) < $bytes) {
            $chunk = fread($this->socket, $bytes - strlen($data));
            if ($chunk === false || $chunk === '') {
                throw new \RuntimeException('IMAP literal read failed.');
            }
            $data .= $chunk;
        }

        return $data;
    }
}
