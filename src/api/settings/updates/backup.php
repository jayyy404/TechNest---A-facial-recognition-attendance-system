<?php 

function POST()
{
  Database::instance()->query("UPDATE settings SET last_backup = CURRENT_TIMESTAMP WHERE id = 1");
  return "Database backup timestamp updated!";
}