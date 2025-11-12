<?php

class Database
{
  private static self $instance;
  private PDO $pdo;

  public static function instance()
  {
    if (!isset(self::$instance)) {
      self::$instance = new self();
    }

    return self::$instance;
  }

  public function connect($host, $dbname, $user, $pass)
  {
    $this->pdo = new PDO("mysql:host=$host;dbname=$dbname;charset=utf8mb4", $user, $pass);
    // Throw exceptions on DB errors so callers can catch them
    $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    // Use real prepared statements where possible
    $this->pdo->setAttribute(PDO::ATTR_EMULATE_PREPARES, false);
    // Default fetch mode
    $this->pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    return $this;
  }

  public function query($sql, $args = [])
  {
    $stmt = $this->pdo->prepare($sql);
    $stmt->execute($args);

    return new DatabaseStatement($stmt);
  }

  private function __construct()
  {
  }
}

class DatabaseStatement
{
  private PDOStatement $stmt;

  public function __construct(PDOStatement $stmt)
  {
    $this->stmt = $stmt;
  }

  // Returns as an associative array
  public function fetchEntireList()
  {
    return $this->stmt->fetchAll(PDO::FETCH_ASSOC);
  }

  // Return one row
  public function fetchOneRow()
  {
    return $this->stmt->fetch(PDO::FETCH_ASSOC);
  }
}