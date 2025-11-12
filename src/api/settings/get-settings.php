<?php 

function GET()
{
  $settings = Database::instance()->query("SELECT * FROM settings", [])->fetchOneRow();
  return json($settings);
}