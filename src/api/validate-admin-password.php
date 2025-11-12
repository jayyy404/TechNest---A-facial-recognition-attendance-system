<?php 

function GET() 
{
  $adminPassword = password_hash($_ENV['ADMIN_PASSWORD'], PASSWORD_DEFAULT);
  $enteredPassword = $_GET['password'];

  return password_verify($enteredPassword, $adminPassword)
    ? "true" : "false";
}