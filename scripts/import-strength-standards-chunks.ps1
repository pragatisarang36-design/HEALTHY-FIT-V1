param(
  [Parameter(Mandatory = $true)]
  [string]$DatabaseUrl,

  [string]$StartAt = ""
)

$ErrorActionPreference = "Stop"

$chunkDir = Join-Path $PSScriptRoot "..\supabase\imports\master_strength_standards_chunks"
$files = Get-ChildItem -LiteralPath $chunkDir -Filter "*.sql" | Sort-Object Name

if ($StartAt) {
  $files = $files | Where-Object { $_.Name -ge $StartAt }
}

foreach ($file in $files) {
  Write-Host "Running $($file.Name)"
  psql $DatabaseUrl -v ON_ERROR_STOP=1 -c "set statement_timeout = '5min';" -f $file.FullName
  if ($LASTEXITCODE -ne 0) {
    throw "Import failed at $($file.Name). Fix the error, then rerun with -StartAt `"$($file.Name)`"."
  }
}

Write-Host "Strength standards chunk import complete."
