<?php

declare(strict_types=1);

namespace App\Services;

final class MailRelayService
{
    public static function isEnabled(): bool
    {
        return (bool) config('mail_relay.enabled', false)
            && trim((string) config('mail_relay.url', '')) !== ''
            && strlen(trim((string) config('mail_relay.token', ''))) >= 32
            && trim((string) config('mail_relay.source_instance', '')) !== '';
    }

    /**
     * @return array{enabled:bool,url:string,source_instance:string,token_set:bool}
     */
    public static function status(): array
    {
        return [
            'enabled' => self::isEnabled(),
            'url' => (string) config('mail_relay.url', ''),
            'source_instance' => (string) config('mail_relay.source_instance', ''),
            'token_set' => strlen(trim((string) config('mail_relay.token', ''))) >= 32,
        ];
    }

    public static function eventIdFor(string $dedupeKey): string
    {
        $source = trim((string) config('mail_relay.source_instance', 'locia-production'));

        return 'locia-mail-' . hash('sha256', $source . "\n" . $dedupeKey);
    }

    public static function send(string $to, string $subject, string $body, string $eventId): void
    {
        if (!self::isEnabled()) {
            throw new \RuntimeException('Почтовый шлюз VPS отключён или настроен не полностью.');
        }
        if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
            throw new \InvalidArgumentException('Некорректный email получателя: ' . $to);
        }
        if (!preg_match('/^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/', $eventId)) {
            throw new \InvalidArgumentException('Некорректный идентификатор почтового события.');
        }
        if ($subject === '' || mb_strlen($subject, 'UTF-8') > 500 || str_contains($subject, "\r") || str_contains($subject, "\n")) {
            throw new \InvalidArgumentException('Некорректная тема письма для почтового шлюза.');
        }
        if ($body === '' || strlen($body) > 64 * 1024) {
            throw new \InvalidArgumentException('Тело письма пустое или превышает 64 КБ.');
        }

        $payload = json_encode([
            'schema' => 1,
            'event_id' => $eventId,
            'source_instance' => (string) config('mail_relay.source_instance'),
            'recipient_email' => mb_strtolower(trim($to), 'UTF-8'),
            'subject' => $subject,
            'body' => $body,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        $timestamp = (string) time();
        $token = trim((string) config('mail_relay.token'));
        $signature = 'sha256=' . hash_hmac('sha256', $timestamp . "\n" . $payload, $token);
        $headers = [
            'Accept: application/json',
            'Content-Type: application/json; charset=utf-8',
            'Authorization: Bearer ' . $token,
            'X-Locia-Timestamp: ' . $timestamp,
            'X-Locia-Signature: ' . $signature,
            'User-Agent: LociaERP-MailRelay/1.0',
            'Content-Length: ' . strlen($payload),
        ];

        $response = self::request(self::relayUrl(), $payload, $headers);
        $decoded = json_decode($response, true);
        if (!is_array($decoded) || empty($decoded['ok']) || empty($decoded['accepted'])) {
            throw new \RuntimeException('Почтовый шлюз VPS не подтвердил сохранение уведомления.');
        }
        if (!hash_equals($eventId, (string) ($decoded['event_id'] ?? ''))) {
            throw new \RuntimeException('Почтовый шлюз VPS вернул чужой идентификатор события.');
        }
    }

    private static function relayUrl(): string
    {
        $url = trim((string) config('mail_relay.url', ''));
        $scheme = strtolower((string) parse_url($url, PHP_URL_SCHEME));
        if ($scheme === 'https') {
            return $url;
        }
        if ($scheme === 'http' && (bool) config('mail_relay.allow_http', false)) {
            return $url;
        }

        throw new \RuntimeException('Почтовый шлюз принимает только HTTPS URL.');
    }

    /**
     * @param list<string> $headers
     */
    private static function request(string $url, string $payload, array $headers): string
    {
        if (function_exists('curl_init')) {
            $handle = curl_init($url);
            if ($handle === false) {
                throw new \RuntimeException('cURL недоступен для почтового шлюза VPS.');
            }
            $options = [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_POST => true,
                CURLOPT_HTTPHEADER => $headers,
                CURLOPT_POSTFIELDS => $payload,
                CURLOPT_TIMEOUT => (int) config('mail_relay.timeout', 20),
                CURLOPT_FOLLOWLOCATION => false,
                CURLOPT_SSL_VERIFYPEER => true,
                CURLOPT_SSL_VERIFYHOST => 2,
            ];
            $caBundle = self::caBundle();
            if ($caBundle !== null) {
                $options[CURLOPT_CAINFO] = $caBundle;
            }
            curl_setopt_array($handle, $options);
            $result = curl_exec($handle);
            $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
            $errno = curl_errno($handle);
            $error = curl_error($handle);
            curl_close($handle);
            if (!is_string($result) || $errno !== 0 || !in_array($status, [200, 202], true)) {
                $detail = $errno !== 0 ? (' cURL=' . $errno . ' ' . $error) : '';
                throw new \RuntimeException('Почтовый шлюз VPS недоступен: status=' . $status . $detail);
            }

            return $result;
        }

        $ssl = [
            'verify_peer' => true,
            'verify_peer_name' => true,
        ];
        $caBundle = self::caBundle();
        if ($caBundle !== null) {
            $ssl['cafile'] = $caBundle;
        }
        $context = stream_context_create([
            'http' => [
                'method' => 'POST',
                'header' => implode("\r\n", $headers),
                'content' => $payload,
                'ignore_errors' => true,
                'timeout' => (int) config('mail_relay.timeout', 20),
            ],
            'ssl' => $ssl,
        ]);
        $beforeError = error_get_last();
        $result = @file_get_contents($url, false, $context);
        $afterError = error_get_last();
        $status = self::httpStatus($http_response_header ?? []);
        if (!is_string($result) || !in_array($status, [200, 202], true)) {
            $detail = is_array($afterError) && $afterError !== $beforeError
                ? ' ' . (string) ($afterError['message'] ?? '')
                : '';
            throw new \RuntimeException('Почтовый шлюз VPS недоступен: status=' . $status . $detail);
        }

        return $result;
    }

    private static function caBundle(): ?string
    {
        $path = trim((string) config('tls.ca_bundle', ''));

        return $path !== '' && is_file($path) ? $path : null;
    }

    /**
     * @param list<string> $headers
     */
    private static function httpStatus(array $headers): int
    {
        $status = 0;
        foreach ($headers as $line) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', (string) $line, $matches)) {
                $status = (int) $matches[1];
            }
        }

        return $status;
    }
}
