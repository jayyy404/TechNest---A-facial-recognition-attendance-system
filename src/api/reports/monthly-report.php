<?php

function GET()
{
  $monthly = Database::instance()->query(
    "SELECT
  CASE WHEN a.status = 'present' THEN COALESCE(u.id, CAST(a.user_id AS CHAR), '') ELSE '' END AS user_id,
  CASE WHEN a.status = 'present' THEN COALESCE(a.name, u.name, '') ELSE '' END AS name,
  CASE WHEN a.status = 'present' THEN COALESCE(a.role, u.role, '') ELSE '' END AS role,
  CASE WHEN a.status = 'present' THEN COALESCE(a.dept, u.dept, '') ELSE '' END AS dept,
      DATE_FORMAT(a.date, '%Y-%m') AS month,
      a.status
    FROM attendance a
    LEFT JOIN users u ON a.user_id = u.id
  ORDER BY month DESC, CASE WHEN a.status = 'present' THEN COALESCE(a.name, u.name) ELSE a.user_id END ASC",
    []
  )->fetchEntireList();

  return json($monthly);
}