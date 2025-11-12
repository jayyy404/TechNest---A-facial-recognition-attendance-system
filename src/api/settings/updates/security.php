<?php 

function POST()
{
  $timeout = $_POST['session_timeout'];
  $access  = $_POST['access_level'];
  
  Database::instance()->query(
    "UPDATE settings 
      SET 
        session_timeout = ?, 
        access_level = ?
    WHERE id = 1
    ", 
    [$timeout, $access]
  );

  return "Security settings updated!";
}