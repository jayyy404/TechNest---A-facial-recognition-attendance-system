<?php 

function GET()
{
  $roles = Database::instance()->query("SELECT * FROM roles ORDER BY role_name ASC", [])->fetchEntireList();
  return json($roles);
}