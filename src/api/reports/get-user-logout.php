<?php 

function GET()
{
  $userLogout = Database::instance()->query(
    "SELECT date, status FROM logout WHERE user_id= ? ORDER BY date DESC",
    [$_GET['id']])->fetchEntireList();

  return json($userLogout);
}
