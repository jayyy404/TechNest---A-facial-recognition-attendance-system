<?php

function POST()
{
  $username = $_POST['admin_username'];
  $role = $_POST['default_role'];
  $policy = $_POST['password_policy'];

  Database::instance()->query(
    "UPDATE settings 
      SET 
        admin_username = ?, 
        default_role = ?, 
        password_policy = ? 
    WHERE id = 1",
    [$username, $role, $policy]
  );

  return "Account & Roles updated successfully!";
}