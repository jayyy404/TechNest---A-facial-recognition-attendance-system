<?php 

function GET()
{
  $userAttendance = Database::instance()->query(
    "SELECT date, status FROM attendance WHERE user_id= ? ORDER BY date DESC",
    [$_GET['id']])->fetchEntireList();

  return json($userAttendance);
}