<?php

function POST()
{
  // Fetch current settings so we can safely fall back when POST keys are missing
  $current = Database::instance()->query("SELECT * FROM settings WHERE id = 1", [])->fetchOneRow();

  $system_name = $_POST['system_name'] ?? ($current['system_name'] ?? '');
  $institution = $_POST['institution'] ?? ($current['institution'] ?? '');
  $timezone = $_POST['timezone'] ?? ($current['timezone'] ?? 'UTC');
  $datetime_format = $_POST['datetime_format'] ?? ($current['datetime_format'] ?? 'Y-m-d H:i');

  Database::instance()->query(
    "UPDATE settings 
      SET 
        system_name = ?, 
        institution = ?, 
        timezone = ?, 
        datetime_format = ? 
    WHERE id = 1",
    [$system_name, $institution, $timezone, $datetime_format]
  );
  
  return "System configuration updated successfully!";
}