<?php

function _resolveConfig() {
  // Set default configs here
  $defaultConfig = [
    'apiPathsDirectory' => 'src/api',
    'ssrPathsDirectory' => 'src/ssr',
    'buildFilesDirectory' => 'dist',
    'websiteTitle' => 'SPA with React Router and PHP',
    'rewrites' => []
  ];

  // Fetch config file and add contents to $defaultConfig
  if (file_exists('phpconfig.json')) {
    $config = json_decode(file_get_contents('phpconfig.json'), true);

    if ($config) {
      foreach($config as $param => $value) {
        $defaultConfig[$param] = $value;
      }
    }
  }

  return $defaultConfig;
}

define('CONFIG', _resolveConfig());