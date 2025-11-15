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
      status,
      CASE WHEN user_id IS NULL OR user_id = -1 THEN 0 ELSE 1 END AS recognized
    FROM logout
    ORDER BY date DESC
  ")->fetchEntireList();

  return json($logout_data);
}

