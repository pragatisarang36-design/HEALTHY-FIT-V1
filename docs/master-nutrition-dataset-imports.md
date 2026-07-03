# Master Nutrition Dataset Imports

This is the import contract for populating the master nutrition reference tables from real datasets. The smoke-test foods such as boiled chickpeas, raw chickpeas, lime wedge, and green chili remain validation examples only; do not patch those foods manually unless they come from a real source file.

## Run Order

1. Place nutrition files in `raw_datasets/` and recipe files in `raw_datasets/recipes/`.
2. Enable the matching dataset entry in `scripts/etl/dataset-registry.json` when it is disabled by default.
3. Run `npm run etl:all`.
4. Review `import_logs/summary.json`, `import_logs/recipes/summary.json`, and `import_logs/master_import_verification_summary.json`.
5. Apply generated SQL files from `supabase/imports/` in Supabase.

## Output Tables

The ETL writes these processed CSVs and SQL load files for Supabase:

| Output table | Populated by |
| --- | --- |
| `master_food_sources` | Every source key observed in nutrition and recipe registries |
| `master_foods` | IFCT, USDA FDC, INDB, generic nutrition files, recipe-derived aggregate nutrition files |
| `master_food_aliases` | Dataset aliases, source names, alternate names, normalized recipe names |
| `master_serving_sizes` | Serving columns from nutrition datasets and source defaults |
| `master_recipe_templates` | Recipe-derived nutrition rows and recipe dataset aggregation |
| `master_recipe_template_items` | `recipe_ingredients` columns and parsed recipe ingredient lists |
| `master_food_classifications` | Generated intelligence rules for simple foods, recipes, and branded foods |
| `master_tiny_garnish_profiles` | Small garnish-like ingredients inferred from imported foods and recipe items |
| `master_branded_foods` | Open Food Facts and branded generic rows |
| `master_food_source_links` | Source lineage for foods, branded foods, and templates |

## Nutrition Datasets

| Dataset | Expected file or folder | Folder path | Formats | Columns expected | Output tables | Known limitations |
| --- | --- | --- | --- | --- | --- | --- |
| IFCT | `ifct2017.csv`; URL fallback is configured | `raw_datasets/` | CSV | Native IFCT columns: `code`, `name`, `enerc`, `protcnt`, `choavldf`, `fatce`, `fibtg`, `water`, `grup`, optional `lang` | Sources, foods, states, profiles, aliases, servings, classifications, source links, tiny garnish candidates | Local import requires enabling `ifct_2017`; URL fallback depends on network availability; micronutrients are not loaded yet |
| USDA FoodData Central | Extracted folder containing `food.csv`, `nutrient.csv`, `food_nutrient.csv` | `raw_datasets/usda/` | CSV folder | Native FDC columns: `fdc_id`, `description`, `data_type`, nutrient ids for kcal, protein, carbs, fat | Sources, foods, states, profiles, aliases, classifications, source links, tiny garnish candidates | Adapter currently loads common macro nutrients only; default `maxFoods` limits volume; branded FDC products are not handled here |
| Open Food Facts | `openfoodfacts.csv`, `openfoodfacts.tsv`, or `openfoodfacts.csv.gz` | `raw_datasets/` | CSV, TSV, GZ | Native OFF columns: `code`, `product_name`, `brands`, `categories`, `countries`, `energy-kcal_100g`, `proteins_100g`, `carbohydrates_100g`, `fat_100g`, `fiber_100g`, `serving_size` | Sources, branded foods, aliases, serving sizes, classifications, source links | Country filter defaults to India; feed/pet-food terms are excluded; ingredient parsing is not used for recipe templates |
| INDB | `indb*.csv`, `indb*.json`, or `indb*.xlsx` | `raw_datasets/` | CSV, JSON, XLSX | Standard nutrition columns: `food_name`, `external_id`, `category`, `cuisine`, `calories_per_100g`, `protein_per_100g`, `carbs_per_100g`, `fat_per_100g`, optional `fiber_per_100g`, `water_per_100g`, `state_key`, `aliases`, `serving_name`, `serving_grams`, `recipe_ingredients` | Sources, foods, states, profiles, aliases, servings, recipe templates, recipe items, classifications, source links, tiny garnish candidates | Uses the generic adapter, so source files must map to supported column aliases or be normalized before import |
| Recipe-derived aggregate nutrition | `recipe*.csv`, `recipe*.json`, or `recipe*.xlsx` | `raw_datasets/` | CSV, JSON, XLSX | Standard nutrition columns plus optional `recipe_ingredients` like `rice:55-70;dal:30-45` | Sources, foods, states, profiles, aliases, servings, recipe templates, recipe items, classifications, source links | Best for precomputed per-100g recipe macros; raw recipe instructions belong in `raw_datasets/recipes/` |

## Recipe Datasets

| Dataset | Expected file name | Folder path | Formats | Columns or fields expected | Output tables | Known limitations |
| --- | --- | --- | --- | --- | --- | --- |
| RecipeDB | `recipedb*.json`, `recipedb*.csv`, `recipedb*.xlsx` | `raw_datasets/recipes/` | JSON, CSV, XLSX | JSON recipes with `title` or `name` and `ingredients`; CSV/XLSX with `recipe_name` or `title`, `ingredient_name`, `amount`, `unit`, or an inline `recipe_ingredients` column | Sources, recipe templates, recipe items, classifications, source links | Nutrition is derived through ingredient proportions only; unresolved ingredients are logged |
| RecipeNLG | `recipenlg*.json` | `raw_datasets/recipes/` | JSON | Rows or arrays with `title` and textual `ingredients` list | Sources, recipe templates, recipe items, classifications, source links | Text ingredient parsing is heuristic; cooking instructions are ignored |
| Food.com | `foodcom*.json`, `foodcom*.csv`, `foodcom*.xlsx` | `raw_datasets/recipes/` | JSON, CSV, XLSX | Recipe title/name and ingredient list or long ingredient rows | Sources, recipe templates, recipe items, classifications, source links | Serving yield text is not trusted for macro math; ingredient normalization may need later synonym expansion |
| 6000+ Indian Recipes | `indian_recipes*.json`, `indian_recipes_6000*.csv`, `indian_recipes_6000*.xlsx` | `raw_datasets/recipes/` | JSON, CSV, XLSX | Recipe title/name, ingredients, optional cuisine/category | Sources, recipe templates, recipe items, classifications, source links | Files named `indian_recipes*.csv` without the `_6000` marker route to Cleaned Indian Recipes for backward compatibility |
| Cleaned Indian Recipes | `cleaned_indian_recipes*.json`, `cleaned_indian_recipes*.csv`, `cleaned_indian_recipes*.xlsx`, or legacy `indian_recipes*.csv` | `raw_datasets/recipes/` | JSON, CSV, XLSX | Recipe title/name and ingredients; long CSV rows or inline ingredient percentages are supported | Sources, recipe templates, recipe items, classifications, source links | Cleaned datasets vary widely; unsupported columns should be normalized to the standard recipe fields |
| INDoRI | `indori*.json`, `indori*.csv`, `indori*.xlsx` | `raw_datasets/recipes/` | JSON, CSV, XLSX | Recipe title/name and ingredients with amount/unit when available | Sources, recipe templates, recipe items, classifications, source links | Regional ingredient names may remain unresolved until aliases are expanded |

## Standard Generic Nutrition Fields

Generic CSV, JSON, and XLSX nutrition files can use any of these aliases:

| Field | Accepted names |
| --- | --- |
| Source | `source_name`, `source`, `dataset`, `data_source` |
| External ID | `external_id`, `source_id`, `fdc_id`, `code`, `id`, `product_code`, `barcode` |
| Food name | `food_name`, `name`, `canonical_name`, `product_name`, `recipe_name`, `dish_name`, `food` |
| Category | `category`, `food_category`, `group` |
| Cuisine | `cuisine`, `region_cuisine` |
| Calories | `calories_per_100g`, `energy_kcal_100g`, `energy-kcal_100g`, `kcal_100g`, `calories`, `energy_kcal` |
| Protein | `protein_per_100g`, `proteins_100g`, `protein_100g`, `protein`, `proteins` |
| Carbs | `carbs_per_100g`, `carbohydrates_100g`, `carbohydrate_100g`, `carbs_100g`, `carbohydrates`, `carbs` |
| Fat | `fat_per_100g`, `fats_per_100g`, `fat_100g`, `fats_100g`, `fat`, `fats` |
| Fiber | `fiber_per_100g`, `fibre_per_100g`, `fiber_100g`, `fibre_100g`, `fiber`, `fibre` |
| Water | `water_per_100g`, `water_100g`, `water` |
| State | `state_key`, `food_state`, `preparation_state`, `state` |
| Aliases | `aliases`, `alias`, `alternate_names`, `synonyms`, `common_names` |
| Serving | `serving_name`, `serving_unit`, `household_serving`, `portion_name`, `unit`, `serving_grams`, `grams`, `serving_weight_g`, `portion_grams`, `quantity_g` |
| Recipe ingredients | `recipe_ingredients`, `ingredients`, `ingredient_percentages`, `template_items` |

## Verification

`npm run etl:verify` samples generated foods first, then aliases, templates, and rules. When any non-sample raw dataset file is present, verification targets at least 500 unique generated candidates. If fewer than 500 candidates exist, the verifier writes a coverage warning to `import_logs/master_import_verification_summary.json`.
