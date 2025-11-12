<?php

function POST()
{
  $camera = $_POST['default_camera'];
  $sensitivity = $_POST['recognition_sensitivity'];
  $samples = $_POST['samples_per_user'];
  $cutoff = $_POST['cutoff_time'];

  Database::instance()->query(
    "UPDATE settings
      SET
        default_camera = ?,
        recognition_sensitivity = ?,
        samples_per_user = ?,
        cutoff_time = ?,
    WHERE id = 1", 
    [$camera, $sensitivity, $samples, $cutoff]
  );

  return "Attendance settings updated!";
}