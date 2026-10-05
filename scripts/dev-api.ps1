# Local dev API for dev.zekra.dev (run by win-tunnel as zekra-dev-api).
# Loads the repo .env, then .env.live if present (DATABASE_URL -> the production DB
# through the zekra-live-db SSH tunnel on :55433), then the dev overrides below.
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
foreach ($f in '.env', '.env.live') {
    $p = Join-Path $root $f
    if (-not (Test-Path $p)) { continue }
    Get-Content $p | ForEach-Object {
        if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
            $v = $Matches[2].Trim()
            if ($v.Length -ge 2 -and (($v[0] -eq '"' -and $v[-1] -eq '"') -or ($v[0] -eq "'" -and $v[-1] -eq "'"))) { $v = $v.Substring(1, $v.Length - 2) }
            Set-Item -Path "Env:$($Matches[1])" -Value $v
        }
    }
}
$env:ADDR = '127.0.0.1:9330'
$env:APP_URL = 'https://dev.zekra.dev'
$env:GRPC_ADDR = '127.0.0.1:50061'
go run ./cmd/api
