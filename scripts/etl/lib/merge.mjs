import { diffNutrition } from './nutrition.mjs';
import { sourcePriority } from './constants.mjs';

export class MergeStore {
  constructor() {
    this.foodsByKey = new Map();
    this.brandedByKey = new Map();
    this.aliasKeys = new Set();
    this.aliases = [];
    this.servingKeys = new Set();
    this.servingSizes = [];
    this.recipeKeys = new Set();
    this.recipeTemplates = [];
    this.recipeTemplateItems = [];
    this.sourceLinkKeys = new Set();
    this.sourceLinks = [];
    this.conflicts = [];
    this.failedRows = [];
    this.stats = {
      rows_processed: 0,
      foods_imported: 0,
      foods_merged: 0,
      branded_imported: 0,
      aliases_created: 0,
      serving_sizes_created: 0,
      recipe_templates_created: 0,
      conflicts: 0,
      failed_rows: 0,
    };
  }

  addGenericRecord(record) {
    const key = record.mergeKey;
    const existing = this.foodsByKey.get(key);

    if (!existing) {
      this.foodsByKey.set(key, record);
    } else {
      this.stats.foods_merged += 1;
      const existingPriority = sourcePriority(existing.sourceName);
      const incomingPriority = sourcePriority(record.sourceName);
      const selected = incomingPriority < existingPriority ? record : existing;
      const rejected = selected === existing ? record : existing;
      this.foodsByKey.set(key, selected);

      const diff = diffNutrition(existing, record);
      const hasMeaningfulDiff = Object.values(diff).some((value) => value >= 5);
      if (hasMeaningfulDiff) {
        this.conflicts.push({
          canonical_name: record.canonicalName,
          state_key: record.stateKey,
          source_a: existing.sourceName,
          source_b: record.sourceName,
          source_a_key: existing.sourceKey,
          source_b_key: record.sourceKey,
          difference: JSON.stringify(diff),
          selected_source: selected.sourceName,
          reason: `Selected higher priority source (${selected.sourceName}) over ${rejected.sourceName}`,
        });
      }
    }

    this.addAliases(record);
    this.addServing(record);
    this.addRecipe(record);
    this.addSourceLink(record, 'food');
  }

  addBrandedRecord(record) {
    const key = record.barcode || `${record.sourceKey}:${record.externalId}`;
    if (this.brandedByKey.has(key)) {
      this.stats.foods_merged += 1;
      return;
    }
    this.brandedByKey.set(key, record);
    this.addAliases(record);
    this.addServing(record);
    this.addSourceLink(record, 'branded');
  }

  addAliases(record) {
    for (const alias of record.aliases) {
      const aliasKey = `${String(record.canonicalName || '').toLowerCase()}|${String(alias.searchKey || '').toLowerCase()}|${record.stateKey || 'unknown'}`;
      if (this.aliasKeys.has(aliasKey)) continue;
      this.aliasKeys.add(aliasKey);
      this.aliases.push({
        canonical_name: record.canonicalName,
        state_key: record.stateKey || 'unknown',
        alias: alias.text,
        search_key: alias.searchKey,
        language: alias.language || 'unknown',
        region: alias.region || '',
        cuisine: record.cuisine || '',
        source_key: record.sourceKey,
      });
    }
  }

  addServing(record) {
    if (!record.servingName || !record.servingGrams) return;
    const key = `${record.canonicalName}|${record.stateKey}|${record.servingName.toLowerCase()}`;
    if (this.servingKeys.has(key)) return;
    this.servingKeys.add(key);
    this.servingSizes.push({
      canonical_name: record.canonicalName,
      state_key: record.stateKey || 'unknown',
      serving_name: record.servingName,
      serving_key: record.servingName.toLowerCase().replace(/\s+/g, '_'),
      grams: record.servingGrams,
      source_key: record.sourceKey,
    });
  }

  addRecipe(record) {
    if (!record.recipeTemplate) return;
    const key = record.recipeTemplate.canonical_name;
    if (!this.recipeKeys.has(key)) {
      this.recipeKeys.add(key);
      this.recipeTemplates.push(record.recipeTemplate);
    }
    record.recipeItems.forEach((item, index) => {
      this.recipeTemplateItems.push({
        recipe_template: record.recipeTemplate.canonical_name,
        sort_order: index,
        ...item,
      });
    });
    this.addSourceLink(record, 'recipe');
  }

  addSourceLink(record, targetType) {
    if (!record.externalId) return;
    const key = `${targetType}|${record.canonicalName}|${record.stateKey}|${record.sourceKey}|${record.externalId}`;
    if (this.sourceLinkKeys.has(key)) return;
    this.sourceLinkKeys.add(key);
    this.sourceLinks.push({
      target_type: targetType,
      canonical_name: record.canonicalName,
      state_key: record.stateKey || 'unknown',
      source_key: record.sourceKey,
      external_id: record.externalId,
      external_name: record.rawName,
      raw_record: JSON.stringify(record.rawRecord || {}),
    });
  }

  addFailure(fileName, rowNumber, reason, rawRecord) {
    this.stats.failed_rows += 1;
    this.failedRows.push({
      file: fileName,
      row: rowNumber,
      reason,
      raw: JSON.stringify(rawRecord || {}),
    });
  }

  finalizeStats() {
    this.stats.foods_imported = this.foodsByKey.size;
    this.stats.branded_imported = this.brandedByKey.size;
    this.stats.aliases_created = this.aliases.length;
    this.stats.serving_sizes_created = this.servingSizes.length;
    this.stats.recipe_templates_created = this.recipeTemplates.length;
    this.stats.conflicts = this.conflicts.length;
  }
}
