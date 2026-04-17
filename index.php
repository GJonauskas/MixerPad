<?php
declare(strict_types=1);

const DATA_DIR = __DIR__ . '/data';
const UPLOAD_DIR = __DIR__ . '/uploads';
const PAD_FILE = DATA_DIR . '/pads.json';

ensureFolders();

if (isset($_GET['api'])) {
    header('Content-Type: application/json; charset=utf-8');
    $api = (string) $_GET['api'];

    try {
        if ($api === 'state' && $_SERVER['REQUEST_METHOD'] === 'GET') {
            echo json_encode(loadState(), JSON_THROW_ON_ERROR);
            exit;
        }

        if ($api === 'save' && $_SERVER['REQUEST_METHOD'] === 'POST') {
            $raw = file_get_contents('php://input') ?: '';
            $payload = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
            validateAndSaveState($payload);
            echo json_encode(['ok' => true], JSON_THROW_ON_ERROR);
            exit;
        }

        if ($api === 'upload' && $_SERVER['REQUEST_METHOD'] === 'POST') {
            if (!isset($_FILES['audio'])) {
                throw new RuntimeException('Nėra audio failo.');
            }

            $row = filter_input(INPUT_POST, 'row', FILTER_VALIDATE_INT);
            $col = filter_input(INPUT_POST, 'col', FILTER_VALIDATE_INT);
            if ($row === false || $col === false || $row < 0 || $col < 0) {
                throw new RuntimeException('Netinkama pozicija.');
            }

            $result = handleUpload($_FILES['audio']);
            echo json_encode([
                'ok' => true,
                'file' => $result,
                'row' => $row,
                'col' => $col,
            ], JSON_THROW_ON_ERROR);
            exit;
        }

        http_response_code(404);
        echo json_encode(['error' => 'Nerastas API metodas.'], JSON_THROW_ON_ERROR);
        exit;
    } catch (Throwable $e) {
        http_response_code(400);
        echo json_encode(['error' => $e->getMessage()]);
        exit;
    }
}

function ensureFolders(): void
{
    if (!is_dir(DATA_DIR) && !mkdir(DATA_DIR, 0775, true) && !is_dir(DATA_DIR)) {
        throw new RuntimeException('Nepavyko sukurti data katalogo.');
    }

    if (!is_dir(UPLOAD_DIR) && !mkdir(UPLOAD_DIR, 0775, true) && !is_dir(UPLOAD_DIR)) {
        throw new RuntimeException('Nepavyko sukurti uploads katalogo.');
    }

    if (!file_exists(PAD_FILE)) {
        file_put_contents(PAD_FILE, json_encode(defaultState(), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    }
}

function defaultState(): array
{
    return [
        'rows' => 6,
        'cols' => 8,
        'pads' => [],
    ];
}

function loadState(): array
{
    $raw = file_get_contents(PAD_FILE);
    if ($raw === false || trim($raw) === '') {
        return defaultState();
    }

    $state = json_decode($raw, true);
    if (!is_array($state)) {
        return defaultState();
    }

    return $state;
}

function validateAndSaveState(array $payload): void
{
    if (!isset($payload['rows'], $payload['cols'], $payload['pads'])) {
        throw new RuntimeException('Neteisingas state formatas.');
    }

    $rows = (int) $payload['rows'];
    $cols = (int) $payload['cols'];
    if ($rows < 1 || $rows > 16 || $cols < 1 || $cols > 16) {
        throw new RuntimeException('Leistinas dydis: 1-16.');
    }

    if (!is_array($payload['pads'])) {
        throw new RuntimeException('pads turi būti masyvas.');
    }

    $cleanPads = [];
    foreach ($payload['pads'] as $pad) {
        if (!is_array($pad)) {
            continue;
        }

        $row = (int) ($pad['row'] ?? -1);
        $col = (int) ($pad['col'] ?? -1);
        if ($row < 0 || $row >= $rows || $col < 0 || $col >= $cols) {
            continue;
        }

        $file = null;
        if (isset($pad['file']) && is_string($pad['file']) && str_starts_with($pad['file'], 'uploads/')) {
            $file = $pad['file'];
        }

        $cleanPads[] = [
            'row' => $row,
            'col' => $col,
            'name' => trim((string) ($pad['name'] ?? 'Pad')),
            'loop' => (bool) ($pad['loop'] ?? false),
            'file' => $file,
            'color' => sanitizeColor((string) ($pad['color'] ?? '#6b7280')),
        ];
    }

    $state = ['rows' => $rows, 'cols' => $cols, 'pads' => $cleanPads];
    file_put_contents(PAD_FILE, json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

function sanitizeColor(string $color): string
{
    return preg_match('/^#[0-9a-fA-F]{6}$/', $color) ? $color : '#6b7280';
}

function handleUpload(array $file): string
{
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        throw new RuntimeException('Failo įkėlimo klaida.');
    }

    $tmpPath = $file['tmp_name'] ?? '';
    $mime = mime_content_type($tmpPath);
    $allowed = [
        'audio/mpeg' => 'mp3',
        'audio/mp3' => 'mp3',
        'audio/wav' => 'wav',
        'audio/x-wav' => 'wav',
        'audio/wave' => 'wav',
    ];

    if (!isset($allowed[$mime])) {
        throw new RuntimeException('Leidžiami tik MP3 ir WAV failai.');
    }

    $extension = $allowed[$mime];
    $filename = 'pad_' . date('Ymd_His') . '_' . bin2hex(random_bytes(4)) . '.' . $extension;
    $destination = UPLOAD_DIR . '/' . $filename;

    if (!move_uploaded_file($tmpPath, $destination)) {
        throw new RuntimeException('Nepavyko išsaugoti failo.');
    }

    return 'uploads/' . $filename;
}
?>
<!doctype html>
<html lang="lt">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MixPad</title>
    <link rel="stylesheet" href="style.css" />
</head>
<body>
<div class="app">
    <header>
        <h1>MixPad</h1>
        <p>6x8 startas, MP3/WAV įkėlimas, loop režimas, perstumimas, likęs laikas, mini EQ ir JSON import/export.</p>
    </header>

    <section class="controls">
        <button id="addRow">+ Eilutė</button>
        <button id="addCol">+ Stulpelis</button>
        <button id="saveState">💾 Išsaugoti</button>
        <button id="stopAll">⏹️ Stop all</button>
        <button id="exportState">⬇️ Export JSON</button>
        <button id="importState">⬆️ Import JSON</button>
        <span id="status"></span>
    </section>

    <section class="editor">
        <h2>Pasirinkto mygtuko nustatymai</h2>
        <label>Pavadinimas <input id="padName" type="text" placeholder="Pvz: Drop" /></label>
        <label>Spalva <input id="padColor" type="color" value="#6b7280" /></label>
        <label class="inline"><input id="padLoop" type="checkbox" /> Loop režimas</label>
        <button id="clearAudio">Išvalyti audio</button>
        <small>Pertempk mygtuką ant kito – vietos apsikeis.</small>
    </section>

    <main id="grid" class="grid" aria-label="Mixinx grid"></main>
</div>
<input type="file" id="filePicker" accept=".mp3,.wav,audio/mpeg,audio/wav" hidden />
<input type="file" id="importPicker" accept="application/json,.json" hidden />
<script src="app.js" defer></script>
</body>
</html>
