<?php 

function POST()
{
  $user_id = $_POST['user_id'] ?? null;
  $status = $_POST['status'] ?? null;


  try {
    Database::instance()->query("SELECT name FROM attendance LIMIT 1", []);
  } catch (Exception $e) {
    Database::instance()->query("ALTER TABLE attendance ADD COLUMN name VARCHAR(100) DEFAULT NULL", []);
    Database::instance()->query("ALTER TABLE attendance ADD COLUMN role VARCHAR(50) DEFAULT NULL", []);
    Database::instance()->query("ALTER TABLE attendance ADD COLUMN dept VARCHAR(100) DEFAULT NULL", []);
  }


  $log_user_id = ($user_id === null || $user_id === '-1' || $user_id === -1) ? null : $user_id;

  // Try to get the user's name/role/dept if a valid user_id was provided
  $name = null;
  $role = null;
  $dept = null;
  if ($log_user_id !== null) {
    $row = Database::instance()->query("SELECT name, role, dept FROM users WHERE id = ? LIMIT 1", [$log_user_id])->fetchOneRow();
    if ($row) {
      $name = $row['name'];
      $role = $row['role'];
      $dept = $row['dept'];
    }
  }

  
  try {
    Database::instance()->query(
      "INSERT INTO attendance (user_id, date, status, name, role, dept) VALUES (?, CURRENT_TIMESTAMP, ?, ?, ?, ?)",
      [$user_id, $status, $name, $role, $dept]
    );

    // Prepare log entry: recognized = 1 for present, 0 for unrecognized
    $recognized = ($status === 'present') ? 1 : 0;
    // Insert into logs table so /api/get-state can return it. Use NULL for user_id
    // when the user is unrecognized to satisfy the foreign key constraint.
    Database::instance()->query(
      "INSERT INTO logs (time, recognized, user_id, name) VALUES (CURRENT_TIMESTAMP, ?, ?, ?)",
      [$recognized, $log_user_id, $name]
    );

    return json(["success" => true, "message" => "Successfully logged attendance of user {$user_id}"]);
  } catch (Exception $e) {
    // log the exception to a file for easier server-side debugging
    $logDir = dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'logs';
    if (!is_dir($logDir)) @mkdir($logDir, 0755, true);
    $errFile = $logDir . DIRECTORY_SEPARATOR . 'attendance_errors.log';
    $msg = '[' . date('c') . '] Failed to save attendance: ' . $e->getMessage() . "\n" . $e->getTraceAsString() . "\n\n";
    @file_put_contents($errFile, $msg, FILE_APPEND | LOCK_EX);

    // return a JSON error so the client can surface it
    http_response_code(500);
    return json(["success" => false, "message" => "Failed to save attendance: " . $e->getMessage()]);
  }
}