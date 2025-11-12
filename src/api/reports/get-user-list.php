<?php 

function GET()
{
  $users = Database::instance()->query("SELECT * FROM users", [])->fetchEntireList();
  return json($users);
}