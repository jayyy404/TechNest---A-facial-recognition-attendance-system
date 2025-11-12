<?php

function resolvePath(): string
{
  $urlpath = parse_url(urldecode($_SERVER['REQUEST_URI']), PHP_URL_PATH);

  // Resolve assets
  if (array_key_exists('extension', $pathinfo = pathinfo($urlpath))) {
    return resolveAssets($urlpath, $pathinfo['extension']);
  }

  // Check if SSR Variable
  if (preg_match("/^\/ssr\/(.*)/", $urlpath, $matches)) {
    return resolveSSR($matches[1]);
  }

  // Check if API
  if (preg_match("/^\/api\/(.*)/", $urlpath, $matches)) {
    return resolveApi($matches[1]);
  }

  if ($html = resolveRewrites($urlpath)) {
    return $html;
  }

  // Assuming that no other routes fit the above criteria, only the html route remains
  // Don't forget to remove the trailing slash (if any). This makes sure that trailing slashes do not interfere with the routing
  if ($html = resolveRoute($urlpath)) {
    return $html;
  }

  http_response_code(404);
  return '404 Not Found';
}

function resolveAssets(string $urlpath, string $extension)
{
  switch ($extension) {
    case 'js':
      header('Content-Type: application/javascript');
      break;

    case 'css':
      header('Content-Type: text/css');
      break;

    default:
      header('Content-Type: ' . mime_content_type(CONFIG['buildFilesDirectory'] . "/" . ltrim($urlpath, "/")));
      break;
  }

  if ($asset = file_get_contents(CONFIG['buildFilesDirectory'] . "/" . ltrim($urlpath, "/")))
    return $asset;

  http_response_code(404);
  return null;
}

function resolveSSR(string $variable, $from_server = false)
{
  $ssrPathsDirectory = CONFIG['ssrPathsDirectory'];

  if (!is_dir($ssrPathsDirectory)) {
    if (!$from_server)
      http_response_code(404);
    return null;
  }

  $filepath = realpath($ssrPathsDirectory) . "/$variable.php";

  if (!is_file($filepath)) {
    if (!$from_server)
      http_response_code(404);
    return null;
  }

  require $filepath;

  if (isset($ssr)) {
    $result = call_user_func($ssr);
    unset($ssr);
    return $result;
  }

  if (!$from_server)
    http_response_code(404);
  return null;
}

function resolveApi(string $apiPath)
{
  $apiPathsDirectory = CONFIG['apiPathsDirectory'];

  if (!is_dir($apiPathsDirectory)) {
    http_response_code(404);
    return null;
  }

  $filepath = realpath($apiPathsDirectory) . "/$apiPath.php";

  if (!is_file($filepath)) {
    http_response_code(404);
    return null;
  }

  require_once $filepath;

  $method = $_SERVER['REQUEST_METHOD'];

  if (function_exists($method)) {
    return call_user_func($method);
  } else {
    http_response_code(405);
    return json(['error' => "Method $method not allowed"]);
  }
}

function resolveRewrites(string $urlpath)
{
  $rewritesList = CONFIG['rewrites'];

  foreach ($rewritesList as $regex => $rewrite) {
    $regex = "/" . str_replace("/", "\/", $regex) . "/";
    $replaced_url = preg_replace($regex, $rewrite, $urlpath);

    $pathname = parse_url($replaced_url, PHP_URL_PATH);
    $query = parse_url($replaced_url, PHP_URL_QUERY);

    parse_str($query, $queryArr);
    $_GET = [...$_GET, ...$queryArr];

    if ($html = resolveRoute($pathname)) {
      return $html;
    }
  }

  return null;
}

function resolveRoute(string $urlpath): ?string
{
  $urlpath = rtrim($urlpath, "/");
  $filepath = CONFIG['buildFilesDirectory'] . (strlen($urlpath) === 0 ? "/index.html" : "$urlpath.html");

  if (!is_file($filepath)) {
    http_response_code(404);
    return null;
  }

  $html = file_get_contents($filepath);

  // Replace the website title
  // $html = str_replace('%WEBSITE_TITLE%', CONFIG['websiteTitle'], $html);

  // Replace the SSR variables
  $html = preg_replace_callback("/{%(.*?)%}/", function (array $matches) {
    $var = $matches[1];
    $ssrValue = resolveSSR($var, true);
    // $ssrValue = null;

    if ($ssrValue === null) {
      return "Error: SSR variable $var not found";
    }

    return $ssrValue;
  }, $html);

  return $html;
}

function json(array $json)
{
  header('Content-Type: application/json');
  return json_encode($json);
}

/** 
 * Escapes the array to base64. 
 * Mainly used to prevent html escaping issues on the client side.
 * Remember to parse the base64 string on the client side!
 */
function toBase64(array $json)
{
  return base64_encode(json_encode($json));
}