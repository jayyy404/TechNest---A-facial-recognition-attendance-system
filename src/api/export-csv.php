<?php

function GET() {
    require_once __DIR__ . '/../../.server/database.php';

    // Determine which type of export is requested
    $type = $_GET['type'] ?? 'attendance';

    try {
        if ($type === 'logout') {
            // Query logout records
            $rows = Database::instance()->query("
                SELECT 
                    l.date, 
                    u.id AS user_id, 
                    u.name, 
                    u.role, 
                    u.dept, 
                    l.status
                FROM logout l
                LEFT JOIN users u ON l.user_id = u.id
                ORDER BY l.date DESC, u.name ASC
            ")->fetchEntireList();

            $filename = "TechNest-logout.csv";
        } else {
            // Query attendance records (default)
            $rows = Database::instance()->query("
                SELECT 
                    a.date, 
                    u.id AS user_id, 
                    u.name, 
                    u.role, 
                    u.dept, 
                    a.status
                FROM attendance a
                JOIN users u ON a.user_id = u.id
                ORDER BY a.date DESC, u.name ASC
            ")->fetchEntireList();

            $filename = "TechNest-attendance.csv";
        }

        // Ensure no previous output
        if (ob_get_length()) {
            ob_end_clean();
        }

        // CSV response headers
        header('Content-Type: text/csv; charset=UTF-8');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('Pragma: no-cache');
        header('Expires: 0');

 
        $output = fopen('php://output', 'w');
        fwrite($output, "\xEF\xBB\xBF"); 

        fputcsv($output, ['Date', 'User ID', 'Name', 'Role', 'Dept', 'Status']);

   
        foreach ($rows as $r) {
            fputcsv($output, [
                $r['date'],
                $r['user_id'],
                $r['name'],
                $r['role'],
                $r['dept'],
                $r['status']
            ]);
        }

        fclose($output);

        exit; // stop router from sending more data
    } catch (Throwable $e) {
        http_response_code(500);
        echo 'Error exporting CSV: ' . htmlspecialchars($e->getMessage());
    }
}
