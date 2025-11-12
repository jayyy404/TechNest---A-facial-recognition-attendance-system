<?php

function GET()
{
  // Helper function to escape output 
  function esc($s)
  {
    return htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
  }

  // Fetch summary data
  $totalUsers = Database::instance()->query("SELECT COUNT(*) AS total FROM users", [])->fetchOneRow()['total'];
  $totalRecognized = Database::instance()->query("SELECT COUNT(*) AS total FROM attendance WHERE status='present'", [])->fetchOneRow()['total'];
  $totalUnrecognized = Database::instance()->query("SELECT COUNT(*) AS total FROM attendance WHERE status='unrecognized'", [])->fetchOneRow()['total'];
  $totalLogout = Database::instance()->query("SELECT COUNT(*) AS total FROM logout WHERE status='logged_out'", [])->fetchOneRow()['total'];

  return json([
    'totalUsers' => $totalUsers,
    'totalRecognized' => $totalRecognized,
    'totalUnrecognized' => $totalUnrecognized,
    'totalLogout' => $totalLogout
  ]);
}