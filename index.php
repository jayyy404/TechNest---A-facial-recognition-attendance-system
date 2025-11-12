<?php

require_once "vendor/autoload.php";

require_once ".server/config.php";
require_once ".server/router.php";
require_once ".server/database.php";

$dotenv = Dotenv\Dotenv::createImmutable(__DIR__);
$dotenv->load();

// Load database
Database::instance()->connect(
  $_ENV['DBHOST'],
  $_ENV['DBNAME'],
  $_ENV['DBUSER'],
  $_ENV['DBPASS']
);


$response = resolvePath();
echo $response;