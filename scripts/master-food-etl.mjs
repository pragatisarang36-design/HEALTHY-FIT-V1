import { runMasterEtl } from './etl/pipeline.mjs';

const summary = await runMasterEtl();

console.log('Master Nutrition Database ETL summary');
console.log(`Batch ID: ${summary.batch_id}`);
console.log(`Rows processed: ${summary.rows_processed}`);
console.log(`Foods imported: ${summary.foods_imported}`);
console.log(`Branded foods: ${summary.branded_imported}`);
console.log(`Foods merged: ${summary.foods_merged}`);
console.log(`Aliases created: ${summary.aliases_created}`);
console.log(`Serving sizes created: ${summary.serving_sizes_created}`);
console.log(`Recipe templates created: ${summary.recipe_templates_created}`);
console.log(`Conflicts: ${summary.conflicts}`);
console.log(`Failed rows: ${summary.failed_rows}`);
console.log(`Output: ${summary.output_dir}`);
console.log(`Logs: ${summary.log_dir}`);
