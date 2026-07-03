import React, { useMemo, useState } from 'react';
import { Database, AlertTriangle, CheckCircle, XCircle, FileText, Utensils, Scale, Tag, BookOpen, Package, DatabaseZap, Ghost, Copy, AlertCircle, ChevronDown, ChevronUp, BarChart3, PieChart, TrendingUp, Download } from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import StatCard from '@/components/ui/StatCard';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx';
import { Button } from '@/components/ui/button';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart as RechartsPieChart, Pie, Cell, LineChart, Line } from 'recharts';

export default function DataQualityDashboard() {
  // In a real implementation, this would fetch data from the audit reports
  // For now, we'll use mock data that matches the CLI output structure
  const auditData = useMemo(() => ({
    overview: {
      total_foods: 9,
      canonical_foods: 9,
      food_states: 9,
      food_profiles: 9,
      aliases: 39,
      serving_sizes: 11,
      branded_foods: 2,
      recipe_templates: 12,
      recipe_template_items: 58,
      tiny_garnish_profiles: 1,
      food_sources: 4,
      unresolved_foods: 0,
      import_conflicts: 1,
      classification_rules: 0,
    },
    issues: {
      missing_data: 0,
      duplicate_foods: 0,
      duplicate_aliases: 6,
      recipe_validation_issues: 12,
      unresolved_foods: 0,
      import_conflicts: 1,
    },
    import_summary: {
      rows_processed: 0,
      generic_records: 0,
      branded_records: 0,
      failed_rows: 0,
      conflicts: 1,
      unique_foods: 9,
      unique_aliases: 39,
      recipe_templates: 12,
    },
  }), []);

  const healthScore = useMemo(() => {
    let score = 100;
    const { overview, issues } = auditData;
    
    // Missing data penalty
    const missingDataRatio = issues.missing_data / Math.max(overview.total_foods, 1);
    score -= missingDataRatio * 20;
    
    // Duplicate penalty
    const duplicateRatio = issues.duplicate_foods / Math.max(overview.total_foods, 1);
    score -= duplicateRatio * 15;
    
    // Unresolved penalty
    const unresolvedRatio = issues.unresolved_foods / Math.max(overview.total_foods, 1);
    score -= unresolvedRatio * 15;
    
    // Recipe validation penalty
    const recipeIssueRatio = issues.recipe_validation_issues / Math.max(overview.recipe_templates, 1);
    score -= recipeIssueRatio * 10;
    
    // Conflict penalty
    const conflictRatio = issues.import_conflicts / Math.max(overview.total_foods, 1);
    score -= conflictRatio * 10;
    
    return Math.max(0, Math.min(100, Math.round(score)));
  }, [auditData]);

  const getHealthStatus = (score) => {
    if (score >= 90) return { label: 'Excellent', color: 'text-emerald-500', bg: 'bg-emerald-500' };
    if (score >= 75) return { label: 'Good', color: 'text-blue-500', bg: 'bg-blue-500' };
    if (score >= 60) return { label: 'Needs Improvement', color: 'text-yellow-500', bg: 'bg-yellow-500' };
    return { label: 'Poor', color: 'text-red-500', bg: 'bg-red-500' };
  };

  const healthStatus = getHealthStatus(healthScore);

  // Mock chart data
  const chartData = useMemo(() => ({
    foodsByCategory: [
      { category: 'Grains', count: 3 },
      { category: 'Vegetables', count: 2 },
      { category: 'Proteins', count: 2 },
      { category: 'Dairy', count: 1 },
      { category: 'Fruits', count: 1 },
    ],
    foodsByCuisine: [
      { cuisine: 'Indian', count: 8 },
      { cuisine: 'International', count: 1 },
    ],
    foodsBySource: [
      { source: 'IFCT', count: 5 },
      { source: 'INDB', count: 2 },
      { source: 'Recipe Derived', count: 2 },
    ],
    foodsByState: [
      { state: 'Cooked', count: 6 },
      { state: 'Raw', count: 2 },
      { state: 'Steamed', count: 1 },
    ],
    templateDistribution: [
      { type: 'Mixed Recipe', count: 4 },
      { type: 'Simple Ingredient', count: 5 },
      { type: 'Cooked Side', count: 3 },
    ],
    importGrowth: [
      { date: 'Jan', foods: 5 },
      { date: 'Feb', foods: 7 },
      { date: 'Mar', foods: 9 },
    ],
    unresolvedTrend: [
      { date: 'Jan', count: 2 },
      { date: 'Feb', count: 1 },
      { date: 'Mar', count: 0 },
    ],
    duplicateTrend: [
      { date: 'Jan', count: 8 },
      { date: 'Feb', count: 7 },
      { date: 'Mar', count: 6 },
    ],
  }), []);

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

  const exportToCsv = (data, filename) => {
    if (!data || data.length === 0) {
      alert('No data to export');
      return;
    }
    
    const headers = Object.keys(data[0]);
    const csvContent = [
      headers.join(','),
      ...data.map(row => headers.map(header => {
        const value = row[header] ?? '';
        const stringValue = String(value);
        // Escape quotes and wrap in quotes if contains comma
        if (stringValue.includes(',') || stringValue.includes('"')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      }).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${filename}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExport = (type) => {
    switch (type) {
      case 'duplicate':
        exportToCsv(issueDetails.duplicateFoods, 'duplicate_report');
        break;
      case 'conflict':
        exportToCsv([{ ...auditData.import_summary, type: 'conflict' }], 'conflict_report');
        break;
      case 'missing':
        exportToCsv(issueDetails.missingMacros, 'missing_data_report');
        break;
      case 'unresolved':
        exportToCsv(issueDetails.unresolvedFoods, 'unresolved_foods');
        break;
      case 'template':
        exportToCsv(issueDetails.invalidRecipeTemplates, 'template_validation_report');
        break;
      case 'health':
        const healthReport = [
          { metric: 'Health Score', value: healthScore, status: healthStatus.label },
          { metric: 'Total Foods', value: auditData.overview.total_foods },
          { metric: 'Missing Data', value: auditData.issues.missing_data },
          { metric: 'Duplicate Foods', value: auditData.issues.duplicate_foods },
          { metric: 'Duplicate Aliases', value: auditData.issues.duplicate_aliases },
          { metric: 'Recipe Issues', value: auditData.issues.recipe_validation_issues },
          { metric: 'Unresolved Foods', value: auditData.issues.unresolved_foods },
          { metric: 'Import Conflicts', value: auditData.issues.import_conflicts },
        ];
        exportToCsv(healthReport, 'complete_health_report');
        break;
      default:
        break;
    }
  };

  // Mock detailed issue data
  const issueDetails = useMemo(() => ({
    duplicateFoods: [],
    duplicateAliases: [
      { search_key: 'rice', alias_id: '1', alias: 'rice', food_id: 'f1', duplicate_count: 2 },
      { search_key: 'rice', alias_id: '2', alias: 'chawal', food_id: 'f1', duplicate_count: 2 },
      { search_key: 'rice', alias_id: '3', alias: 'bhaat', food_id: 'f1', duplicate_count: 2 },
      { search_key: 'rice', alias_id: '4', alias: 'cooked rice', food_id: 'f1', duplicate_count: 2 },
      { search_key: 'rice', alias_id: '5', alias: 'white rice', food_id: 'f1', duplicate_count: 2 },
      { search_key: 'rice', alias_id: '6', alias: 'chawal', food_id: 'f1', duplicate_count: 2 },
    ],
    missingMacros: [],
    missingServingSizes: [],
    invalidServingSizes: [],
    invalidAliases: [],
    invalidRecipeTemplates: [
      { recipe_id: 'r1', canonical_name: 'Chicken Curry', search_key: 'chicken_curry', cuisine: 'Indian', item_count: 3, confidence: 0.85, issues: 'Percentage sum: 95.0%' },
      { recipe_id: 'r2', canonical_name: 'Dal Rice', search_key: 'dal_rice', cuisine: 'Indian', item_count: 2, confidence: 0.75, issues: 'Percentage sum: 90.0%' },
      { recipe_id: 'r3', canonical_name: 'Poha', search_key: 'poha', cuisine: 'Indian', item_count: 2, confidence: 0.80, issues: 'Percentage sum: 92. 0%' },
      { recipe_id: 'r4', canonical_name: 'Sambar', search_key: 'sambar', cuisine: 'Indian', item_count: 2, confidence: 0.78, issues: 'Percentage sum: 88.0%' },
      { recipe_id: 'r5', canonical_name: 'Bhindi Sabzi', search_key: 'bhindi_sabzi', cuisine: 'Indian', item_count: 1, confidence: 0.65, issues: 'Percentage sum: 100.0%' },
      { recipe_id: 'r6', canonical_name: 'Dosa', search_key: 'dosa', cuisine: 'Indian', item_count: 1, confidence: 0.70, issues: 'Percentage sum: 100.0%' },
      { recipe_id: 'r7', canonical_name: 'Idli', search_key: 'idli', cuisine: 'Indian', item_count: 1, confidence: 0.72, issues: 'Percentage sum: 100.0%' },
      { recipe_id: 'r8', canonical_name: 'White Rice', search_key: 'white_rice', cuisine: 'Indian', item_count: 1, confidence: 0.68, issues: 'Percentage sum: 100.0%' },
      { recipe_id: 'r9', canonical_name: 'Dal Chawal', search_key: 'dal_chawal', cuisine: 'Indian', item_count: 1, confidence: 0.60, issues: 'Percentage sum: 100.0%' },
      { recipe_id: 'r10', canonical_name: 'Rice with Dal', search_key: 'rice_with_dal', cuisine: 'Indian', item_count: 1, confidence: 0.62, issues: 'Percentage sum: 100.0%' },
      { recipe_id: 'r11', canonical_name: 'Idly', search_key: 'idly', cuisine: 'Indian', item_count: 1, confidence: 0.65, issues: 'Percentage sum: 100.0%' },
      { recipe_id: 'r12', canonical_name: 'Steamed Idli', search_key: 'steamed_idli', cuisine: 'Indian', item_count: 1, confidence: 0.67, issues: 'Percentage sum: 100.0%' },
    ],
    unresolvedFoods: [],
  }), []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold">Data Quality Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1">Master Nutrition Database Health Monitor</p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`px-4 py-2 rounded-lg ${healthStatus.bg}/10 ${healthStatus.color} font-semibold`}>
            Health Score: {healthScore}/100
          </div>
          <div className={`px-3 py-2 rounded-lg ${healthStatus.bg} text-white text-sm font-medium`}>
            {healthStatus.label}
          </div>
        </div>
      </div>

      {/* Database Overview */}
      <GlassCard>
        <div className="flex items-center gap-2 mb-4">
          <Database className="w-5 h-5 text-blue-500" />
          <h2 className="text-lg font-semibold">Database Overview</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <StatCard title="Total Foods" value={auditData.overview.total_foods} unit="" icon={Package} color="blue" subtitle="" />
          <StatCard title="Food States" value={auditData.overview.food_states} unit="" icon={Scale} color="purple" subtitle="" />
          <StatCard title="Food Profiles" value={auditData.overview.food_profiles} unit="" icon={FileText} color="green" subtitle="" />
          <StatCard title="Aliases" value={auditData.overview.aliases} unit="" icon={Tag} color="orange" subtitle="" />
          <StatCard title="Serving Sizes" value={auditData.overview.serving_sizes} unit="" icon={Scale} color="cyan" subtitle="" />
          <StatCard title="Branded Foods" value={auditData.overview.branded_foods} unit="" icon={Package} color="pink" subtitle="" />
          <StatCard title="Recipe Templates" value={auditData.overview.recipe_templates} unit="" icon={Utensils} color="amber" subtitle="" />
          <StatCard title="Recipe Items" value={auditData.overview.recipe_template_items} unit="" icon={BookOpen} color="indigo" subtitle="" />
          <StatCard title="Tiny Garnish" value={auditData.overview.tiny_garnish_profiles} unit="" icon={Scale} color="teal" subtitle="" />
          <StatCard title="Food Sources" value={auditData.overview.food_sources} unit="" icon={DatabaseZap} color="violet" subtitle="" />
          <StatCard title="Unresolved" value={auditData.overview.unresolved_foods} unit="" icon={Ghost} color="red" subtitle="" />
          <StatCard title="Conflicts" value={auditData.overview.import_conflicts} unit="" icon={AlertTriangle} color="red" subtitle="" />
        </div>
      </GlassCard>

      {/* Issues Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <GlassCard>
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-5 h-5 text-orange-500" />
            <h2 className="text-lg font-semibold">Issues Summary</h2>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div className="flex items-center gap-3">
                <XCircle className={`w-4 h-4 ${auditData.issues.missing_data > 0 ? 'text-red-500' : 'text-emerald-500'}`} />
                <span className="text-sm font-medium">Missing Data</span>
              </div>
              <span className={`font-semibold ${auditData.issues.missing_data > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                {auditData.issues.missing_data}
              </span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div className="flex items-center gap-3">
                <Copy className={`w-4 h-4 ${auditData.issues.duplicate_foods > 0 ? 'text-red-500' : 'text-emerald-500'}`} />
                <span className="text-sm font-medium">Duplicate Foods</span>
              </div>
              <span className={`font-semibold ${auditData.issues.duplicate_foods > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                {auditData.issues.duplicate_foods}
              </span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div className="flex items-center gap-3">
                <Copy className={`w-4 h-4 ${auditData.issues.duplicate_aliases > 0 ? 'text-red-500' : 'text-emerald-500'}`} />
                <span className="text-sm font-medium">Duplicate Aliases</span>
              </div>
              <span className={`font-semibold ${auditData.issues.duplicate_aliases > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                {auditData.issues.duplicate_aliases}
              </span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div className="flex items-center gap-3">
                <AlertCircle className={`w-4 h-4 ${auditData.issues.recipe_validation_issues > 0 ? 'text-red-500' : 'text-emerald-500'}`} />
                <span className="text-sm font-medium">Recipe Validation Issues</span>
              </div>
              <span className={`font-semibold ${auditData.issues.recipe_validation_issues > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                {auditData.issues.recipe_validation_issues}
              </span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div className="flex items-center gap-3">
                <Ghost className={`w-4 h-4 ${auditData.issues.unresolved_foods > 0 ? 'text-red-500' : 'text-emerald-500'}`} />
                <span className="text-sm font-medium">Unresolved Foods</span>
              </div>
              <span className={`font-semibold ${auditData.issues.unresolved_foods > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                {auditData.issues.unresolved_foods}
              </span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div className="flex items-center gap-3">
                <AlertTriangle className={`w-4 h-4 ${auditData.issues.import_conflicts > 0 ? 'text-red-500' : 'text-emerald-500'}`} />
                <span className="text-sm font-medium">Import Conflicts</span>
              </div>
              <span className={`font-semibold ${auditData.issues.import_conflicts > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                {auditData.issues.import_conflicts}
              </span>
            </div>
          </div>
        </GlassCard>

        <GlassCard>
          <div className="flex items-center gap-2 mb-4">
            <FileText className="w-5 h-5 text-green-500" />
            <h2 className="text-lg font-semibold">Import Summary</h2>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <span className="text-sm font-medium">Rows Processed</span>
              <span className="font-semibold">{auditData.import_summary.rows_processed}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <span className="text-sm font-medium">Generic Records</span>
              <span className="font-semibold">{auditData.import_summary.generic_records}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <span className="text-sm font-medium">Branded Records</span>
              <span className="font-semibold">{auditData.import_summary.branded_records}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <span className="text-sm font-medium">Failed Rows</span>
              <span className={`font-semibold ${auditData.import_summary.failed_rows > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                {auditData.import_summary.failed_rows}
              </span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <span className="text-sm font-medium">Unique Foods</span>
              <span className="font-semibold text-blue-500">{auditData.import_summary.unique_foods}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <span className="text-sm font-medium">Unique Aliases</span>
              <span className="font-semibold text-blue-500">{auditData.import_summary.unique_aliases}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <span className="text-sm font-medium">Recipe Templates</span>
              <span className="font-semibold text-blue-500">{auditData.import_summary.recipe_templates}</span>
            </div>
          </div>
        </GlassCard>
      </div>

      {/* Health Score Details */}
      <GlassCard>
        <div className="flex items-center gap-2 mb-4">
          <CheckCircle className="w-5 h-5 text-emerald-500" />
          <h2 className="text-lg font-semibold">Health Score Breakdown</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-lg bg-muted/50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Missing Data Impact</span>
              <span className="text-xs text-muted-foreground">-20 max</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div 
                className="bg-orange-500 h-2 rounded-full transition-all" 
                style={{ width: `${(auditData.issues.missing_data / Math.max(auditData.overview.total_foods, 1)) * 100}%` }}
              />
            </div>
          </div>
          <div className="p-4 rounded-lg bg-muted/50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Duplicate Impact</span>
              <span className="text-xs text-muted-foreground">-15 max</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div 
                className="bg-red-500 h-2 rounded-full transition-all" 
                style={{ width: `${(auditData.issues.duplicate_foods / Math.max(auditData.overview.total_foods, 1)) * 100}%` }}
              />
            </div>
          </div>
          <div className="p-4 rounded-lg bg-muted/50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Unresolved Impact</span>
              <span className="text-xs text-muted-foreground">-15 max</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div 
                className="bg-purple-500 h-2 rounded-full transition-all" 
                style={{ width: `${(auditData.issues.unresolved_foods / Math.max(auditData.overview.total_foods, 1)) * 100}%` }}
              />
            </div>
          </div>
          <div className="p-4 rounded-lg bg-muted/50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Recipe Issues Impact</span>
              <span className="text-xs text-muted-foreground">-10 max</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div 
                className="bg-yellow-500 h-2 rounded-full transition-all" 
                style={{ width: `${(auditData.issues.recipe_validation_issues / Math.max(auditData.overview.recipe_templates, 1)) * 100}%` }}
              />
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Detailed Issue Tables */}
      <GlassCard>
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="w-5 h-5 text-orange-500" />
          <h2 className="text-lg font-semibold">Detailed Issue Tables</h2>
        </div>
        <Tabs defaultValue="duplicate-aliases" className="w-full">
          <TabsList className="grid w-full grid-cols-4 lg:grid-cols-8">
            <TabsTrigger value="duplicate-foods">Duplicate Foods</TabsTrigger>
            <TabsTrigger value="duplicate-aliases">Duplicate Aliases</TabsTrigger>
            <TabsTrigger value="missing-macros">Missing Macros</TabsTrigger>
            <TabsTrigger value="missing-serving">Missing Serving</TabsTrigger>
            <TabsTrigger value="invalid-serving">Invalid Serving</TabsTrigger>
            <TabsTrigger value="invalid-aliases">Invalid Aliases</TabsTrigger>
            <TabsTrigger value="invalid-recipes">Invalid Recipes</TabsTrigger>
            <TabsTrigger value="unresolved">Unresolved</TabsTrigger>
          </TabsList>
          
          <TabsContent value="duplicate-foods" className="mt-4">
            <IssueTable
              data={issueDetails.duplicateFoods}
              columns={[
                { key: 'search_key', label: 'Search Key' },
                { key: 'food_id', label: 'Food ID' },
                { key: 'canonical_name', label: 'Canonical Name' },
                { key: 'duplicate_count', label: 'Duplicate Count' },
              ]}
              emptyMessage="No duplicate foods found"
            />
          </TabsContent>
          
          <TabsContent value="duplicate-aliases" className="mt-4">
            <IssueTable
              data={issueDetails.duplicateAliases}
              columns={[
                { key: 'search_key', label: 'Search Key' },
                { key: 'alias_id', label: 'Alias ID' },
                { key: 'alias', label: 'Alias' },
                { key: 'food_id', label: 'Food ID' },
                { key: 'duplicate_count', label: 'Duplicate Count' },
              ]}
              emptyMessage="No duplicate aliases found"
            />
          </TabsContent>
          
          <TabsContent value="missing-macros" className="mt-4">
            <IssueTable
              data={issueDetails.missingMacros}
              columns={[
                { key: 'type', label: 'Type' },
                { key: 'table', label: 'Table' },
                { key: 'id', label: 'ID' },
                { key: 'name', label: 'Name' },
                { key: 'details', label: 'Details' },
              ]}
              emptyMessage="No missing macros found"
            />
          </TabsContent>
          
          <TabsContent value="missing-serving" className="mt-4">
            <IssueTable
              data={issueDetails.missingServingSizes}
              columns={[
                { key: 'food_id', label: 'Food ID' },
                { key: 'food_name', label: 'Food Name' },
                { key: 'details', label: 'Details' },
              ]}
              emptyMessage="No missing serving sizes found"
            />
          </TabsContent>
          
          <TabsContent value="invalid-serving" className="mt-4">
            <IssueTable
              data={issueDetails.invalidServingSizes}
              columns={[
                { key: 'serving_id', label: 'Serving ID' },
                { key: 'food_id', label: 'Food ID' },
                { key: 'serving_size', label: 'Serving Size' },
                { key: 'details', label: 'Details' },
              ]}
              emptyMessage="No invalid serving sizes found"
            />
          </TabsContent>
          
          <TabsContent value="invalid-aliases" className="mt-4">
            <IssueTable
              data={issueDetails.invalidAliases}
              columns={[
                { key: 'alias_id', label: 'Alias ID' },
                { key: 'alias', label: 'Alias' },
                { key: 'food_id', label: 'Food ID' },
                { key: 'details', label: 'Details' },
              ]}
              emptyMessage="No invalid aliases found"
            />
          </TabsContent>
          
          <TabsContent value="invalid-recipes" className="mt-4">
            <IssueTable
              data={issueDetails.invalidRecipeTemplates}
              columns={[
                { key: 'recipe_id', label: 'Recipe ID' },
                { key: 'canonical_name', label: 'Name' },
                { key: 'search_key', label: 'Search Key' },
                { key: 'cuisine', label: 'Cuisine' },
                { key: 'item_count', label: 'Items' },
                { key: 'confidence', label: 'Confidence' },
                { key: 'issues', label: 'Issues' },
              ]}
              emptyMessage="No invalid recipe templates found"
            />
          </TabsContent>
          
          <TabsContent value="unresolved" className="mt-4">
            <IssueTable
              data={issueDetails.unresolvedFoods}
              columns={[
                { key: 'file', label: 'File' },
                { key: 'row', label: 'Row' },
                { key: 'reason', label: 'Reason' },
                { key: 'raw_name', label: 'Raw Name' },
              ]}
              emptyMessage="No unresolved foods found"
            />
          </TabsContent>
        </Tabs>
      </GlassCard>

      {/* Charts Section */}
      <GlassCard>
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-5 h-5 text-purple-500" />
          <h2 className="text-lg font-semibold">Data Visualization</h2>
        </div>
        <Tabs defaultValue="category" className="w-full">
          <TabsList className="grid w-full grid-cols-2 lg:grid-cols-4">
            <TabsTrigger value="category">By Category</TabsTrigger>
            <TabsTrigger value="cuisine">By Cuisine</TabsTrigger>
            <TabsTrigger value="source">By Source</TabsTrigger>
            <TabsTrigger value="state">By State</TabsTrigger>
            <TabsTrigger value="templates">Templates</TabsTrigger>
            <TabsTrigger value="growth">Growth</TabsTrigger>
            <TabsTrigger value="unresolved">Unresolved</TabsTrigger>
            <TabsTrigger value="duplicates">Duplicates</TabsTrigger>
          </TabsList>
          
          <TabsContent value="category" className="mt-4">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData.foodsByCategory}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="category" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="count" fill="#3b82f6" name="Foods" />
              </BarChart>
            </ResponsiveContainer>
          </TabsContent>
          
          <TabsContent value="cuisine" className="mt-4">
            <ResponsiveContainer width="100%" height={300}>
              <RechartsPieChart>
                <Pie
                  data={chartData.foodsByCuisine}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ cuisine, percent }) => `${cuisine}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="count"
                >
                  {chartData.foodsByCuisine.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </RechartsPieChart>
            </ResponsiveContainer>
          </TabsContent>
          
          <TabsContent value="source" className="mt-4">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData.foodsBySource}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="source" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="count" fill="#10b981" name="Foods" />
              </BarChart>
            </ResponsiveContainer>
          </TabsContent>
          
          <TabsContent value="state" className="mt-4">
            <ResponsiveContainer width="100%" height={300}>
              <RechartsPieChart>
                <Pie
                  data={chartData.foodsByState}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ state, percent }) => `${state}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="count"
                >
                  {chartData.foodsByState.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </RechartsPieChart>
            </ResponsiveContainer>
          </TabsContent>
          
          <TabsContent value="templates" className="mt-4">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData.templateDistribution}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="type" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="count" fill="#f59e0b" name="Templates" />
              </BarChart>
            </ResponsiveContainer>
          </TabsContent>
          
          <TabsContent value="growth" className="mt-4">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData.importGrowth}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="foods" stroke="#3b82f6" strokeWidth={2} name="Total Foods" />
              </LineChart>
            </ResponsiveContainer>
          </TabsContent>
          
          <TabsContent value="unresolved" className="mt-4">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData.unresolvedTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="count" stroke="#ef4444" strokeWidth={2} name="Unresolved Foods" />
              </LineChart>
            </ResponsiveContainer>
          </TabsContent>
          
          <TabsContent value="duplicates" className="mt-4">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData.duplicateTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="count" stroke="#f59e0b" strokeWidth={2} name="Duplicates" />
              </LineChart>
            </ResponsiveContainer>
          </TabsContent>
        </Tabs>
      </GlassCard>

      {/* CSV Exports */}
      <GlassCard>
        <div className="flex items-center gap-2 mb-4">
          <Download className="w-5 h-5 text-green-500" />
          <h2 className="text-lg font-semibold">CSV Exports</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Button
            onClick={() => handleExport('duplicate')}
            variant="outline"
            className="flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Duplicate Report
          </Button>
          <Button
            onClick={() => handleExport('conflict')}
            variant="outline"
            className="flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Conflict Report
          </Button>
          <Button
            onClick={() => handleExport('missing')}
            variant="outline"
            className="flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Missing Data
          </Button>
          <Button
            onClick={() => handleExport('unresolved')}
            variant="outline"
            className="flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Unresolved Foods
          </Button>
          <Button
            onClick={() => handleExport('template')}
            variant="outline"
            className="flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Template Report
          </Button>
          <Button
            onClick={() => handleExport('health')}
            variant="outline"
            className="flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Complete Health
          </Button>
        </div>
      </GlassCard>

      {/* Read-Only Notice */}
      <GlassCard className="bg-blue-500/10 border-blue-500/20">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-blue-500 mt-0.5" />
          <div>
            <h3 className="font-semibold text-blue-500">Read-Only Dashboard</h3>
            <p className="text-sm text-muted-foreground mt-1">
              This dashboard is for monitoring data quality only. No automatic modifications are made to nutrition data.
              Use the CLI audit tool (npm run nutrition:audit) for detailed reports.
            </p>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}

function IssueTable({ data, columns, emptyMessage }) {
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });

  const handleSort = (key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const sortedData = useMemo(() => {
    if (!sortConfig.key) return data;
    return [...data].sort((a, b) => {
      const aVal = a[sortConfig.key] ?? '';
      const bVal = b[sortConfig.key] ?? '';
      const comparison = String(aVal).localeCompare(String(bVal));
      return sortConfig.direction === 'asc' ? comparison : -comparison;
    });
  }, [data, sortConfig]);

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <CheckCircle className="w-12 h-12 text-emerald-500 mb-3" />
        <p className="text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            {columns.map(col => (
              <th
                key={col.key}
                className="text-left py-3 px-4 font-semibold cursor-pointer hover:bg-muted/50 select-none"
                onClick={() => handleSort(col.key)}
              >
                <div className="flex items-center gap-2">
                  {col.label}
                  {sortConfig.key === col.key && (
                    sortConfig.direction === 'asc' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedData.map((row, idx) => (
            <tr key={idx} className="border-b hover:bg-muted/30">
              {columns.map(col => (
                <td key={col.key} className="py-3 px-4">
                  {String(row[col.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 text-xs text-muted-foreground">
        Showing {sortedData.length} {sortedData.length === 1 ? 'record' : 'records'}
      </div>
    </div>
  );
}
