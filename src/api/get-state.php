<?php

function GET()
{
  $users = Database::instance()->query("SELECT * FROM users ORDER BY id DESC", [])->fetchEntireList();
  $logs = Database::instance()->query("SELECT * FROM logs ORDER BY time DESC", [])->fetchEntireList();
  
  // Try to get logout logs
  try {
    $logout_logs = Database::instance()->query("SELECT * FROM logout_logs ORDER BY time DESC", [])->fetchEntireList();
  } catch (Exception $e) {
    $logout_logs = [];
  }

  return json(["users" => $users, "logs" => $logs, "logout_logs" => $logout_logs]);
}