# Nutrition Dataset Checklist

Phase B checklist for manually placing real nutrition and recipe datasets before import.

Do not download automatically. Place files in the paths below, then run the incremental ETL in a later phase.

Current raw dataset state:

- Present sample nutrition file: `raw_datasets/sample_master_foods.csv`
- Present sample recipe files: `raw_datasets/recipes/sample_recipes.json`, `raw_datasets/recipes/recipe_ingredients_sample.csv`
- Real datasets listed below are not currently present in `raw_datasets/`.

Status values:

- `missing`: no matching raw file/folder is present.
- `present`: matching raw file/folder exists but has not been imported in this checklist pass.
- `imported`: matching dataset has been imported by ETL.
- `skipped`: matching dataset was already imported and unchanged.

## Checklist

| Priority | Dataset | Download/source note | Expected format | Exact folder path / filename pattern | Adapter/parser used | Output tables populated | Present now | Current status |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | IFCT 2017 | Indian Food Composition Tables 2017. Use a CSV export compatible with the IFCT adapter. | CSV | `raw_datasets/ifct2017.csv` | `ifct` adapter from `scripts/etl/lib/adapters/ifct.mjs` | `master_food_sources`, `master_foods`, `master_food_states`, `master_food_profiles`, `master_food_aliases`, `master_serving_sizes`, `master_food_classifications`, `master_food_source_links`, `master_tiny_garnish_profiles` | No | missing |
| 2 | USDA FoodData Central | Download/extract FoodData Central CSV files. Required core files are `food.csv`, `nutrient.csv`, and `food_nutrient.csv`. | Extracted CSV folder | `raw_datasets/usda/` | `usda` adapter from `scripts/etl/lib/adapters/usda.mjs` | `master_food_sources`, `master_foods`, `master_food_states`, `master_food_profiles`, `master_food_aliases`, `master_food_classifications`, `master_food_source_links`, `master_tiny_garnish_profiles` | No | missing |
| 3 | Open Food Facts | Use Open Food Facts product export, preferably India-filterable product rows. | CSV, TSV, or GZ | `raw_datasets/openfoodfacts.csv.gz` | `off` adapter from `scripts/etl/lib/adapters/off.mjs` | `master_food_sources`, `master_branded_foods`, `master_food_aliases`, `master_serving_sizes`, `master_food_classifications`, `master_food_source_links` | No | missing |
| 4 | INDB | Indian Nutrient Database rows normalized to standard nutrition columns. | CSV, JSON, or XLSX | `raw_datasets/indb*.csv`, `raw_datasets/indb*.json`, or `raw_datasets/indb*.xlsx` | Generic nutrition adapter from `scripts/etl/lib/adapters/generic.mjs` with source key `indb` | `master_food_sources`, `master_foods`, `master_food_states`, `master_food_profiles`, `master_food_aliases`, `master_serving_sizes`, `master_recipe_templates`, `master_recipe_template_items`, `master_food_classifications`, `master_food_source_links`, `master_tiny_garnish_profiles` | No | missing |
| 5 | Indian Recipes + Ingredients + Nutrition | Precomputed recipe nutrition rows with per-100g macros and optional ingredient percentages. | CSV, JSON, or XLSX | `raw_datasets/recipe*.csv`, `raw_datasets/recipe*.json`, or `raw_datasets/recipe*.xlsx` | Generic nutrition adapter from `scripts/etl/lib/adapters/generic.mjs` with source key `recipe_derived` | `master_food_sources`, `master_foods`, `master_food_states`, `master_food_profiles`, `master_food_aliases`, `master_serving_sizes`, `master_recipe_templates`, `master_recipe_template_items`, `master_food_classifications`, `master_food_source_links` | No | missing |
| 6 | RecipeDB | RecipeDB exports with recipe title/name and structured ingredients. | JSON, CSV, or XLSX | `raw_datasets/recipes/recipedb*.json`, `raw_datasets/recipes/recipedb*.csv`, or `raw_datasets/recipes/recipedb*.xlsx` | Recipe parser in `scripts/etl/lib/recipe-formats.mjs`, aggregated by `scripts/etl/lib/recipe-generator.mjs` | `master_food_sources`, `master_recipe_templates`, `master_recipe_template_items`, `master_food_classifications`, `master_food_source_links` | No | missing |
| 7 | RecipeNLG | RecipeNLG JSON records with title and ingredient text arrays. | JSON | `raw_datasets/recipes/recipenlg*.json` | Recipe parser in `scripts/etl/lib/recipe-formats.mjs`, aggregated by `scripts/etl/lib/recipe-generator.mjs` | `master_food_sources`, `master_recipe_templates`, `master_recipe_template_items`, `master_food_classifications`, `master_food_source_links` | No | missing |
| 8 | Food.com Recipes | Food.com recipe exports with recipe title/name and ingredient list or long ingredient rows. | JSON, CSV, or XLSX | `raw_datasets/recipes/foodcom*.json`, `raw_datasets/recipes/foodcom*.csv`, or `raw_datasets/recipes/foodcom*.xlsx` | Recipe parser in `scripts/etl/lib/recipe-formats.mjs`, aggregated by `scripts/etl/lib/recipe-generator.mjs` | `master_food_sources`, `master_recipe_templates`, `master_recipe_template_items`, `master_food_classifications`, `master_food_source_links` | No | missing |
| 9 | Epicurious Recipes | Epicurious recipe export with recipe title/name and ingredients. | JSON | `raw_datasets/recipes/epicurious*.json` | Recipe parser in `scripts/etl/lib/recipe-formats.mjs`, aggregated by `scripts/etl/lib/recipe-generator.mjs` | `master_food_sources`, `master_recipe_templates`, `master_recipe_template_items`, `master_food_classifications`, `master_food_source_links` | No | missing |
| 10 | 6000+ Indian Recipes | Indian recipe dataset exports. Use JSON as `indian_recipes*.json`; use CSV/XLSX as `indian_recipes_6000*` to avoid routing to cleaned recipes. | JSON, CSV, or XLSX | `raw_datasets/recipes/indian_recipes*.json`, `raw_datasets/recipes/indian_recipes_6000*.csv`, or `raw_datasets/recipes/indian_recipes_6000*.xlsx` | Recipe parser in `scripts/etl/lib/recipe-formats.mjs`, aggregated by `scripts/etl/lib/recipe-generator.mjs` | `master_food_sources`, `master_recipe_templates`, `master_recipe_template_items`, `master_food_classifications`, `master_food_source_links` | No | missing |
| 11 | Cleaned Indian Recipes | Cleaned Indian recipe exports. Legacy `indian_recipes*.csv` routes here. | JSON, CSV, or XLSX | `raw_datasets/recipes/cleaned_indian_recipes*.json`, `raw_datasets/recipes/cleaned_indian_recipes*.csv`, `raw_datasets/recipes/cleaned_indian_recipes*.xlsx`, or `raw_datasets/recipes/indian_recipes*.csv` | Recipe parser in `scripts/etl/lib/recipe-formats.mjs`, aggregated by `scripts/etl/lib/recipe-generator.mjs` | `master_food_sources`, `master_recipe_templates`, `master_recipe_template_items`, `master_food_classifications`, `master_food_source_links` | No | missing |
| 12 | INDoRI | INDoRI regional Indian recipe dataset exports. | JSON, CSV, or XLSX | `raw_datasets/recipes/indori*.json`, `raw_datasets/recipes/indori*.csv`, or `raw_datasets/recipes/indori*.xlsx` | Recipe parser in `scripts/etl/lib/recipe-formats.mjs`, aggregated by `scripts/etl/lib/recipe-generator.mjs` | `master_food_sources`, `master_recipe_templates`, `master_recipe_template_items`, `master_food_classifications`, `master_food_source_links` | No | missing |

## Placement Notes

- Nutrition datasets go directly under `raw_datasets/`, except USDA FDC, which must be an extracted folder at `raw_datasets/usda/`.
- Recipe datasets go under `raw_datasets/recipes/`.
- Keep sample files unless intentionally replacing test data; they are useful for smoke validation.
- For generic nutrition datasets, use the column aliases documented in `docs/master-nutrition-dataset-imports.md`.
- For recipe datasets, prefer fields named `title` or `recipe_name`, plus `ingredients`, or long rows with `recipe_name`, `ingredient_name`, `amount`, and `unit`.

## Current Summary

| Category | Count |
| --- | ---: |
| Requested real datasets | 12 |
| Present real datasets | 0 |
| Missing real datasets | 12 |
| Present sample files | 3 |
| Imports run in Phase B | 0 |
