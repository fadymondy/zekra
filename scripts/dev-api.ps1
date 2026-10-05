# Local dev API for dev.zekra.dev (run by win-tunnel as zekra-dev-api).
# Loads the repo .env, then applies the dev overrides below, then `go run ./cmd/api`.
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
Get-Content (Join-Path $root '.env') | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
        $v = $Matches[2].Trim()
        if ($v.Length -ge 2 -and (($v[0] -eq '"' -and $v[-1] -eq '"') -or ($v[0] -eq "'" -and $v[-1] -eq "'"))) { $v = $v.Substring(1, $v.Length - 2) }
        Set-Item -Path "Env:$($Matches[1])" -Value $v
    }
}
$env:ADDR = '127.0.0.1:9330'
$env:APP_URL = 'https://dev.zekra.dev'
$env:GRPC_ADDR = '127.0.0.1:50061'
go run ./cmd/api
