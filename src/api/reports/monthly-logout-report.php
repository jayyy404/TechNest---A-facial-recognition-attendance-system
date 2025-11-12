<?php

function GET()
{
  $logout_data = Database::instance()->query("
    SELECT 
      user_id, 
      name, 
      role, 
      dept, 
      DATE_FORMAT(date, '%Y-%m') AS month, 
      status
    FROM logout
    ORDER BY date DESC
  ")->fetchEntireList();

  return json($logout_data);
}
