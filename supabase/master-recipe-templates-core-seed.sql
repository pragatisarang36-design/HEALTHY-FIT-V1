-- Core recipe templates for Food Intelligence Layer.
-- Run after master-nutrition-schema.sql.

insert into public.master_food_sources (source_key, source_name, source_type, priority)
values ('recipe_derived', 'Recipe-derived aggregate', 'recipe', 50)
on conflict (source_key) do update
set source_name = excluded.source_name,
    source_type = excluded.source_type,
    priority = excluded.priority,
    updated_at = now();

with templates(canonical_name, search_key, cuisine, default_serving_grams, confidence) as (
  values
    ('Shrimp Curry', 'shrimp curry', 'indian', 250, 0.72),
    ('Chicken Curry', 'chicken curry', 'indian', 250, 0.72),
    ('Egg Curry', 'egg curry', 'indian', 220, 0.72),
    ('Paneer Butter Masala', 'paneer butter masala', 'indian', 300, 0.74),
    ('Dal Tadka', 'dal tadka', 'indian', 180, 0.72),
    ('Vegetable Biryani', 'veg biryani', 'indian', 350, 0.72),
    ('Chicken Biryani', 'chicken biryani', 'indian', 380, 0.72),
    ('Fried Rice', 'fried rice', 'asian', 300, 0.70),
    ('Pulao', 'pulao', 'indian', 300, 0.70),
    ('Poha', 'poha', 'indian', 180, 0.70),
    ('Upma', 'upma', 'indian', 180, 0.70),
    ('Sambar', 'sambar', 'indian', 150, 0.70),
    ('Rasam', 'rasam', 'indian', 150, 0.70),
    ('Chole', 'chole', 'indian', 150, 0.72),
    ('Rajma', 'rajma', 'indian', 150, 0.72),
    ('Aloo Gobi', 'aloo gobi', 'indian', 150, 0.70),
    ('Palak Paneer', 'palak paneer', 'indian', 250, 0.72),
    ('Mixed Vegetable Curry', 'mixed vegetable curry', 'indian', 180, 0.70),
    ('Pasta', 'pasta', 'global', 300, 0.68),
    ('Sandwich', 'sandwich', 'global', 180, 0.70),
    ('Smoothie', 'smoothie', 'global', 300, 0.68),
    ('Pizza', 'pizza', 'global', 250, 0.68)
)
insert into public.master_recipe_templates (
  canonical_name,
  search_key,
  cuisine,
  default_serving_grams,
  source_id,
  confidence,
  recipe_count,
  active
)
select
  canonical_name,
  search_key,
  cuisine,
  default_serving_grams,
  (select id from public.master_food_sources where source_key = 'recipe_derived'),
  confidence,
  1,
  true
from templates
on conflict (search_key) do update
set canonical_name = excluded.canonical_name,
    cuisine = excluded.cuisine,
    default_serving_grams = excluded.default_serving_grams,
    source_id = excluded.source_id,
    confidence = excluded.confidence,
    recipe_count = greatest(public.master_recipe_templates.recipe_count, excluded.recipe_count),
    active = true,
    updated_at = now();

with template_keys(search_key) as (
  values
    ('shrimp curry'), ('chicken curry'), ('egg curry'), ('paneer butter masala'),
    ('dal tadka'), ('veg biryani'), ('chicken biryani'), ('fried rice'),
    ('pulao'), ('poha'), ('upma'), ('sambar'), ('rasam'), ('chole'), ('rajma'),
    ('aloo gobi'), ('palak paneer'), ('mixed vegetable curry'), ('pasta'),
    ('sandwich'), ('smoothie'), ('pizza')
)
delete from public.master_recipe_template_items rti
using public.master_recipe_templates rt, template_keys tk
where rti.recipe_template_id = rt.id
  and rt.search_key = tk.search_key;

with items(template_key, ingredient_name, percentage, min_percentage, max_percentage, sort_order) as (
  values
    ('shrimp curry', 'shrimp', 45, 35, 55, 1),
    ('shrimp curry', 'onion tomato gravy', 30, 22, 38, 2),
    ('shrimp curry', 'oil', 8, 4, 10, 3),
    ('shrimp curry', 'spices and herbs', 5, 2, 7, 4),
    ('shrimp curry', 'coconut curd or water base', 12, 5, 18, 5),
    ('chicken curry', 'chicken breast', 48, 38, 58, 1),
    ('chicken curry', 'onion tomato gravy', 34, 25, 42, 2),
    ('chicken curry', 'oil', 6, 3, 9, 3),
    ('chicken curry', 'spices and herbs', 4, 2, 6, 4),
    ('chicken curry', 'curd base', 8, 0, 14, 5),
    ('egg curry', 'egg', 45, 35, 52, 1),
    ('egg curry', 'onion tomato gravy', 40, 30, 48, 2),
    ('egg curry', 'oil', 7, 3, 10, 3),
    ('egg curry', 'spices and herbs', 4, 2, 6, 4),
    ('paneer butter masala', 'paneer', 38, 30, 48, 1),
    ('paneer butter masala', 'onion tomato gravy', 38, 30, 45, 2),
    ('paneer butter masala', 'butter', 7, 4, 10, 3),
    ('paneer butter masala', 'milk or cream', 13, 5, 18, 4),
    ('dal tadka', 'dal', 82, 75, 88, 1),
    ('dal tadka', 'oil or ghee', 5, 2, 8, 2),
    ('dal tadka', 'onion tomato gravy', 9, 4, 14, 3),
    ('veg biryani', 'cooked rice', 62, 55, 70, 1),
    ('veg biryani', 'mixed vegetables', 22, 15, 30, 2),
    ('veg biryani', 'oil or ghee', 5, 3, 8, 3),
    ('veg biryani', 'curd', 7, 0, 12, 4),
    ('chicken biryani', 'cooked rice', 55, 48, 62, 1),
    ('chicken biryani', 'chicken breast', 27, 20, 35, 2),
    ('chicken biryani', 'oil or ghee', 5, 3, 8, 3),
    ('chicken biryani', 'curd', 8, 3, 12, 4),
    ('fried rice', 'cooked rice', 72, 65, 80, 1),
    ('fried rice', 'mixed vegetables', 15, 8, 22, 2),
    ('fried rice', 'oil', 5, 3, 8, 3),
    ('fried rice', 'egg', 8, 0, 16, 4),
    ('pulao', 'cooked rice', 72, 65, 80, 1),
    ('pulao', 'mixed vegetables', 17, 10, 24, 2),
    ('pulao', 'oil or ghee', 5, 3, 8, 3),
    ('poha', 'flattened rice', 82, 75, 88, 1),
    ('poha', 'oil', 5, 3, 8, 2),
    ('poha', 'peanuts', 6, 2, 10, 3),
    ('upma', 'semolina or upma base', 84, 76, 90, 1),
    ('upma', 'mixed vegetables', 9, 4, 14, 2),
    ('upma', 'oil', 5, 3, 8, 3),
    ('sambar', 'dal and broth', 88, 80, 94, 1),
    ('sambar', 'mixed vegetables', 7, 2, 12, 2),
    ('sambar', 'oil', 3, 1, 5, 3),
    ('rasam', 'rasam broth', 92, 86, 96, 1),
    ('rasam', 'tomato', 4, 1, 8, 2),
    ('rasam', 'oil', 2, 0, 4, 3),
    ('chole', 'chickpeas', 82, 75, 90, 1),
    ('chole', 'onion tomato gravy', 12, 6, 18, 2),
    ('chole', 'oil', 4, 2, 7, 3),
    ('rajma', 'kidney beans', 82, 75, 90, 1),
    ('rajma', 'onion tomato gravy', 12, 6, 18, 2),
    ('rajma', 'oil', 4, 2, 7, 3),
    ('aloo gobi', 'potato', 45, 35, 55, 1),
    ('aloo gobi', 'cauliflower', 42, 32, 52, 2),
    ('aloo gobi', 'oil', 7, 3, 10, 3),
    ('palak paneer', 'paneer', 36, 28, 45, 1),
    ('palak paneer', 'spinach', 42, 34, 52, 2),
    ('palak paneer', 'onion tomato gravy', 12, 6, 18, 3),
    ('palak paneer', 'oil', 6, 3, 9, 4),
    ('mixed vegetable curry', 'mixed vegetables', 78, 68, 86, 1),
    ('mixed vegetable curry', 'onion tomato gravy', 14, 8, 20, 2),
    ('mixed vegetable curry', 'oil', 5, 2, 8, 3),
    ('pasta', 'pasta', 70, 62, 78, 1),
    ('pasta', 'tomato sauce', 18, 10, 28, 2),
    ('pasta', 'cheese', 7, 0, 12, 3),
    ('pasta', 'oil', 5, 2, 8, 4),
    ('sandwich', 'bread', 55, 45, 65, 1),
    ('sandwich', 'cheese or protein filling', 12, 0, 18, 2),
    ('sandwich', 'tomato', 10, 4, 16, 3),
    ('sandwich', 'cucumber', 10, 4, 16, 4),
    ('smoothie', 'milk', 55, 45, 65, 1),
    ('smoothie', 'banana', 20, 10, 30, 2),
    ('smoothie', 'yogurt', 20, 10, 30, 3),
    ('smoothie', 'berries', 5, 0, 12, 4),
    ('pizza', 'pizza dough', 55, 45, 65, 1),
    ('pizza', 'mozzarella cheese', 18, 12, 26, 2),
    ('pizza', 'tomato sauce', 15, 8, 22, 3),
    ('pizza', 'oil', 4, 2, 7, 4),
    ('pizza', 'mixed vegetables', 8, 0, 15, 5)
)
insert into public.master_recipe_template_items (
  recipe_template_id,
  ingredient_name,
  ingredient_search_key,
  percentage,
  min_percentage,
  max_percentage,
  required,
  sort_order,
  source_id
)
select
  rt.id,
  i.ingredient_name,
  btrim(lower(regexp_replace(i.ingredient_name, '[^a-z0-9]+', ' ', 'g'))),
  i.percentage,
  i.min_percentage,
  i.max_percentage,
  true,
  i.sort_order,
  (select id from public.master_food_sources where source_key = 'recipe_derived')
from items i
join public.master_recipe_templates rt on rt.search_key = i.template_key
order by i.template_key, i.sort_order;
