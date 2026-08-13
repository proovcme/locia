<?php

declare(strict_types=1);

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$file = __DIR__ . $path;
$isDemoMode = (string) (getenv('DEMO_MODE') ?: '') === '1';

if (preg_match('#^/(?:\\.env|\\.git|app|config|database|deploy|dev|docs|scripts|storage|tests|vendor|composer\\.(?:json|lock)|package(?:-lock)?\\.json)(?:/|$)#', $path)) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    exit('Not found');
}

if ($isDemoMode && preg_match('#^/locia-atlas(?:/|$)#', $path)) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    exit('Not found');
}

if ($path !== '/' && (is_file($file) || (is_dir($file) && is_file(rtrim($file, '/') . '/index.html')))) {
    return false;
}

require __DIR__ . '/index.php';
