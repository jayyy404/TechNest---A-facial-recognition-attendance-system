<?php 

function POST()
{
  $images = $_FILES['file'];
  $destination = '/uploads';

  $uploadedImageList = [];

  foreach($images['name'] as $index => $filename) {
    if (file_exists(CONFIG['buildFilesDirectory'] . "$destination/$filename")) unlink(CONFIG['buildFilesDirectory'] ."$destination/$filename");

    $tmpname = $images['tmp_name'][$index];
    move_uploaded_file($tmpname, CONFIG['buildFilesDirectory'] . "$destination/$filename");

    $uploadedImageList[] = "$destination/$filename";
  }

  // Handle data with positional parameters 
  try {
    Database::instance()->query(
      "INSERT INTO 
        users (dept, id, name, password, role, username, photo)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      
      ON DUPLICATE KEY UPDATE
        dept = VALUES(dept),
        id = VALUES(id),
        name = VALUES(name),
        password = VALUES(password),
        role = VALUES(role),
        username = VALUES(username),
        photo = VALUES(photo)",
      [
        $_POST['dept'] ?? '',
        $_POST['id'] ?? '',
        $_POST['name'] ?? '',
        password_hash($_POST['password'] ?? '', PASSWORD_DEFAULT),
        $_POST['role'] ?? '',
        $_POST['username'] ?? '',
        json_encode($uploadedImageList)
      ]
    );
    return json(["success" => true, "message" => "User uploaded/updated successfully!"]);
  } catch (Exception $e) {
    http_response_code(500);
    return json(["success" => false, "message" => "Failed to save user: " . $e->getMessage()]);
  }
}