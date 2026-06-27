$ErrorActionPreference = "Stop"

$nodePath = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if (-not (Test-Path $nodePath)) {
  $nodePath = "node"
}

Push-Location $PSScriptRoot
try {
  & $nodePath ".\server.js"
}
finally {
  Pop-Location
}
