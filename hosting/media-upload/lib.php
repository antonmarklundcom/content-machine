<?php
// Shared by upload.php and delete.php. Not reachable over HTTP (.htaccess), and does nothing if it were.
declare(strict_types=1);

if (!defined('CE_MEDIA')) {
    http_response_code(404);
    exit;
}

/** Extension => the MIME types finfo may report for it. Both must match. */
const CE_TYPES = [
    'jpg' => ['image/jpeg'],
    'jpeg' => ['image/jpeg'],
    'png' => ['image/png'],
    'webp' => ['image/webp'],
    'gif' => ['image/gif'],
    'mp4' => ['video/mp4'],
    'mov' => ['video/quicktime'],
];

/** Stored under this extension, so a key is always one of a few shapes. */
const CE_CANONICAL = ['jpeg' => 'jpg'];

/** files/YYYY/MM/<32 hex>.<ext> — the only paths this endpoint ever writes or deletes. */
const CE_KEY = '#^files/\d{4}/\d{2}/[a-f0-9]{32}\.(jpg|png|webp|gif|mp4|mov)$#';

function ce_json(int $status, array $body): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($body, JSON_UNESCAPED_SLASHES);
    exit;
}

function ce_config(): array
{
    $file = __DIR__ . '/config.php';
    if (!is_file($file)) {
        ce_json(503, ['error' => 'Endpoint not configured: config.php is missing.']);
    }
    $config = require $file;
    $token = is_array($config) ? (string)($config['token'] ?? '') : '';
    if (strlen($token) < 32 || strpos($token, 'CHANGE-ME') === 0) {
        ce_json(503, ['error' => 'Endpoint not configured: set a token of at least 32 characters.']);
    }
    return [
        'token' => $token,
        'max_bytes' => (int)($config['max_bytes'] ?? 250 * 1024 * 1024),
        'public_base' => rtrim((string)($config['public_base'] ?? ''), '/'),
    ];
}

function ce_require_post(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        header('Allow: POST');
        ce_json(405, ['error' => 'POST only.']);
    }
}

/** The bearer token, compared in constant time. Anything else is a 401 that says nothing more. */
function ce_authenticate(array $config): void
{
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if ($header === '' && function_exists('getallheaders')) {
        foreach (getallheaders() as $name => $value) {
            if (strtolower((string)$name) === 'authorization') {
                $header = (string)$value;
            }
        }
    }
    $given = preg_match('/^Bearer\s+(\S+)$/', trim((string)$header), $m) ? $m[1] : '';
    // hash_equals on both branches, so a missing header takes as long as a wrong one.
    if (!hash_equals($config['token'], $given) || $given === '') {
        ce_json(401, ['error' => 'Unauthorized.']);
    }
}

function ce_public_base(array $config): string
{
    if ($config['public_base'] !== '') {
        return $config['public_base'];
    }
    $https = ($_SERVER['HTTPS'] ?? '') !== '' && ($_SERVER['HTTPS'] ?? '') !== 'off';
    $scheme = $https || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https' ? 'https' : 'http';
    $host = preg_replace('/[^A-Za-z0-9.:\-\[\]]/', '', (string)($_SERVER['HTTP_HOST'] ?? 'localhost'));
    $dir = rtrim(str_replace('\\', '/', dirname((string)($_SERVER['SCRIPT_NAME'] ?? '/'))), '/');
    return $scheme . '://' . $host . $dir;
}
