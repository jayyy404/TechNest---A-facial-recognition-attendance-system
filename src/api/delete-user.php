<?php 

function POST()
{
  $id = $_POST['id'];
  Database::instance()->query("DELETE FROM `users` WHERE id = ?", [$id]);

  return "User successfully removed from database.";
}