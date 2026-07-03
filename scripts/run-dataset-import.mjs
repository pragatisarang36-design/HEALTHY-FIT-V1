import { spawnSync } from 'node:child_process';

const run = (label, args) => {
  console.log(`\n${label}`);
  const result = spawnSync(process.execPath, args, {
    stdio: 'inherit',
    shell: false,
  });

  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}`);
  }
};

try {
  run('1. Import nutrition datasets', ['scripts/master-food-etl.mjs']);
  run('2. Aggregate recipe datasets', ['scripts/generate-recipe-templates.mjs']);
  run('3. Generate nutrition SQL for Supabase SQL Editor', ['scripts/generate-master-nutrition-sql.mjs']);
  run('4. Generate recipe SQL for Supabase SQL Editor', ['scripts/load-master-recipes.mjs']);
  run('5. Verify generated imports', ['scripts/verify-master-imports.mjs']);

  console.log('\nDataset import pipeline complete');
  console.log('SQL Editor files:');
  console.log('  supabase/imports/master_nutrition_sample_load.sql');
  console.log('  supabase/imports/master_recipe_templates_load.sql');
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
