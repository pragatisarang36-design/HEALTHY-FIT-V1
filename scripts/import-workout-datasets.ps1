param(
  [Parameter(Mandatory = $true)]
  [string]$DatabaseUrl,

  [switch]$SkipStrength
)

$ErrorActionPreference = "Stop"

function Invoke-PsqlFile {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Missing import file: $Path"
  }

  Write-Host "Running $Path"
  psql $DatabaseUrl -v ON_ERROR_STOP=1 -c "set client_encoding = 'UTF8';" -f $Path
  if ($LASTEXITCODE -ne 0) {
    throw "Import failed: $Path"
  }
}

if (-not $SkipStrength) {
  & "$PSScriptRoot\import-strength-standards-chunks.ps1" -DatabaseUrl $DatabaseUrl
  if ($LASTEXITCODE -ne 0) {
    throw "Strength standards import failed."
  }
}

Invoke-PsqlFile ".\supabase\imports\master_exercises_kaggle_megagym_load.sql"
Invoke-PsqlFile ".\supabase\imports\master_exercises_kaggle_fitness_load.sql"
Invoke-PsqlFile ".\supabase\imports\master_exercises_kaggle_gym_exercises_load.sql"
Invoke-PsqlFile ".\supabase\imports\master_exercises_exercemus_load.sql"

Write-Host "Workout dataset imports complete."
psql $DatabaseUrl -c "select source_key, count(*) from public.master_exercises group by source_key order by source_key;"
psql $DatabaseUrl -c "select count(*) as strength_standards from public.master_strength_standards;"
