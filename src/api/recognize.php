<?php

function POST()
{
    if (!isset($_FILES['image']) || $_FILES['image']['error'] !== UPLOAD_ERR_OK) {
        http_response_code(400);
        echo json_encode(['status' => 'error', 'message' => 'Missing image file']);
        exit;
    }

    $baseDir = dirname(__DIR__, 2); // repo root
    $incomingDir = $baseDir . DIRECTORY_SEPARATOR . 'embeddings' . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . 'incoming';
    if (!is_dir($incomingDir)) {
        @mkdir($incomingDir, 0755, true);
    }

    $tmpName = $_FILES['image']['tmp_name'];
    $ext = pathinfo($_FILES['image']['name'], PATHINFO_EXTENSION) ?: 'jpg';
    $destName = time() . '_' . bin2hex(random_bytes(6)) . '.' . $ext;
    $destPath = $incomingDir . DIRECTORY_SEPARATOR . $destName;

    if (!move_uploaded_file($tmpName, $destPath)) {
        http_response_code(500);
        echo json_encode(['status' => 'error', 'message' => 'Failed to save uploaded image']);
        exit;
    }

    // Build python command
    $python = 'python'; // assume python is in PATH; adjust if necessary
    $script = $baseDir . DIRECTORY_SEPARATOR . 'Original_code' . DIRECTORY_SEPARATOR . 'scripts' . DIRECTORY_SEPARATOR . 'recognize_cli.py';

    // Escape arguments
    $cmd = escapeshellcmd($python) . ' ' . escapeshellarg($script) . ' --image ' . escapeshellarg($destPath);

    // optional threshold from client
    if (isset($_POST['threshold'])) {
        $th = floatval($_POST['threshold']);
        $cmd .= ' --threshold ' . escapeshellarg((string) $th);
    }

    $cmd .= ' 2>&1';

    // Execute and capture output
    $output = shell_exec($cmd);

    // Try to decode JSON from python output. Some Python libs (TF/Keras) print logs
// before the CLI JSON. Try to extract the last JSON object from the output.
    $data = json_decode($output, true);
    if (json_last_error() !== JSON_ERROR_NONE || !is_array($data)) {
        // attempt to extract a JSON object from the output (last occurrence)
        $matches = [];
        if (preg_match('/(\{.*"status".*\})/s', $output, $matches)) {
            $candidate = $matches[1];
            $decoded = json_decode($candidate, true);
            if (json_last_error() === JSON_ERROR_NONE && is_array($decoded)) {
                header('Content-Type: application/json');
                echo json_encode($decoded);
                exit;
            }
        }

        // Fallback: return a short error (do not include giant raw logs in the response)
        http_response_code(500);
        echo json_encode(['status' => 'error', 'message' => 'Recognition engine returned invalid output']);
        exit;
    }

    header('Content-Type: application/json');
    echo json_encode($data);
}