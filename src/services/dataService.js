import { supabase } from '@/lib/supabaseClient';

const dateOnly = (value) => {
  if (!value) return null;
  const d = new Date(value);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const currentUser = async () => {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const user = data.session?.user;
  if (!user) throw new Error('Not authenticated');
  return user;
};

const sortRows = (rows, sort) => {
  if (!sort) return rows;
  const descending = sort.startsWith('-');
  const field = descending ? sort.slice(1) : sort;
  return [...rows].sort((a, b) => {
    const aValue = a[field] ?? '';
    const bValue = b[field] ?? '';
    if (aValue === bValue) return 0;
    return (aValue > bValue ? 1 : -1) * (descending ? -1 : 1);
  });
};

const matchesCriteria = (row, criteria = {}) =>
  Object.entries(criteria).every(([key, value]) => {
    if (value === undefined || key === 'created_by') return true;
    return row[key] === value;
  });

const throwIfError = ({ error, context }) => {
  if (!error) return;
  if (context) {
    console.error(`${context}:`, error);
  }
  throw error;
};

const isMissingColumnError = (error, column) =>
  error?.code === 'PGRST204' ||
  error?.code === '42703' ||
  (String(error?.message || '').toLowerCase().includes('could not find') &&
    String(error?.message || '').includes(column));

const withoutColumns = (payload, columns) => {
  const nextPayload = { ...payload };
  for (const column of columns) delete nextPayload[column];
  return nextPayload;
};

const missingMealPlanColumns = (error) =>
  ['plan_type', 'filter', 'date_generated'].filter((column) => isMissingColumnError(error, column));

const normalizeBase = (row, user) => ({
  ...row,
  created_by: user?.email,
  created_date: row.created_at,
  updated_date: row.updated_at || row.created_at,
  date: row.date || dateOnly(row.created_at),
});

const normalizeItems = (items = []) => {
  const categoryOrder = ['produce', 'vegetables', 'fruits', 'protein', 'dairy', 'grains', 'spices', 'pantry', 'other'];
  const seen = new Map();

  for (const item of items || []) {
    const name = String(item?.name || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const category = String(item?.category || 'other').toLowerCase();
    const quantity = String(item?.quantity || '').trim();

    if (seen.has(key)) {
      const existing = seen.get(key);
      seen.set(key, {
        ...existing,
        quantity: [existing.quantity, quantity].filter(Boolean).join(' + '),
        checked: existing.checked && item.checked === true,
      });
    } else {
      seen.set(key, { name, category, quantity, checked: item.checked === true });
    }
  }

  return [...seen.values()].sort((a, b) => {
    const aIndex = categoryOrder.indexOf(a.category);
    const bIndex = categoryOrder.indexOf(b.category);
    return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex) || a.name.localeCompare(b.name);
  });
};

const browserJsonStore = (kind, normalize) => {
  const storageKey = (userId) => `healthy-fit:${userId}:json:${kind}`;
  const read = (userId) => {
    if (typeof localStorage === 'undefined') return [];
    try {
      return JSON.parse(localStorage.getItem(storageKey(userId)) || '[]');
    } catch {
      return [];
    }
  };
  const write = (userId, rows) => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(storageKey(userId), JSON.stringify(rows));
  };
  const fromData = (data, user, id = crypto.randomUUID(), createdAt = new Date().toISOString()) => ({
    id,
    user_id: user.id,
    created_at: createdAt,
    updated_at: new Date().toISOString(),
    plan_data: data.plan_data,
    plan_json: {
      kind,
      data: data.plan_data,
      items: normalizeItems(data.items),
      insights: data.insights,
      weight: data.weight,
      date: data.date || data.date_generated,
      meta: {
        plan_type: data.plan_type,
        filter: data.filter,
        date_generated: data.date_generated,
      },
    },
  });

  return {
    async filter(criteria = {}, sort, limit) {
      const user = await currentUser();
      const rows = read(user.id).map((row) => normalize(row, user));
      return sortRows(rows.filter((row) => matchesCriteria(row, criteria)), sort).slice(0, limit || rows.length);
    },
    async create(data) {
      const user = await currentUser();
      const rows = read(user.id);
      const row = fromData(data, user);
      write(user.id, [row, ...rows]);
      return normalize(row, user);
    },
    async update(id, data) {
      const user = await currentUser();
      const rows = read(user.id);
      const nextRows = rows.map((row) => (row.id === id ? fromData(data, user, id, row.created_at) : row));
      write(user.id, nextRows);
      return normalize(nextRows.find((row) => row.id === id), user);
    },
    async delete(id) {
      const user = await currentUser();
      write(user.id, read(user.id).filter((row) => row.id !== id));
      return true;
    },
  };
};

const legacyPlanData = (kind, data = {}) => {
  if (data.plan_data) return data.plan_data;
  if (data.items) return { items: normalizeItems(data.items) };
  if (data.insights) return { insights: data.insights };
  if (data.weight !== undefined) return { weight: data.weight, date: data.date || data.date_generated };
  return { kind };
};

const legacyPlanMeta = (kind, data = {}) => ({
  plan_type: data.plan_type,
  filter: data.filter,
  date_generated: data.date_generated || data.date,
});

const tableStore = ({ table, select = '*', normalize, toInsert, toUpdate, baseFilter, keyField = 'id' }) => ({
  async filter(criteria = {}, sort, limit) {
    const user = await currentUser();
    let query = supabase.from(table).select(select);
    query = baseFilter ? baseFilter(query, user) : query.eq('user_id', user.id);
    query = query.order(sort?.replace('-', '') === 'date' ? 'created_at' : 'created_at', { ascending: !sort?.startsWith('-') });
    if (typeof limit === 'number') query = query.limit(limit);

    const { data, error } = await query;
    throwIfError({ error, context: `Failed to load ${table}` });
    const rows = (data || []).map((row) => normalize(row, user));
    return sortRows(rows.filter((row) => matchesCriteria(row, criteria)), sort).slice(0, limit || rows.length);
  },

  async create(data) {
    const user = await currentUser();
    const payload = toInsert(data, user);
    let { data: row, error } = await supabase.from(table).insert(payload).select(select).single();
    const missingOptionalPayloadColumns = ['notes', 'photo_url'].filter((column) => isMissingColumnError(error, column) && Object.hasOwn(payload, column));
    if (error && missingOptionalPayloadColumns.length > 0) {
      const payloadWithoutMissing = withoutColumns(payload, missingOptionalPayloadColumns);
      ({ data: row, error } = await supabase.from(table).insert(payloadWithoutMissing).select(select).single());
    }
    const optionalMissingColumns = table === 'meal_plans' ? missingMealPlanColumns(error) : [];
    if (error && optionalMissingColumns.length > 0) {
      const payloadWithoutMissingColumns = withoutColumns(payload, optionalMissingColumns);
      ({ data: row, error } = await supabase.from(table).insert(payloadWithoutMissingColumns).select(select).single());
    }
    throwIfError({ error, context: `Failed to create ${table}` });
    return normalize(row, user);
  },

  async update(id, data) {
    const user = await currentUser();
    const payload = toUpdate ? toUpdate(data, user) : data;
    let { data: row, error } = await supabase
      .from(table)
      .update(payload)
      .eq(keyField, id)
      .select(select)
      .single();
    const optionalMissingColumns = table === 'meal_plans' ? missingMealPlanColumns(error) : [];
    if (error && optionalMissingColumns.length > 0) {
      const payloadWithoutMissingColumns = withoutColumns(payload, optionalMissingColumns);
      ({ data: row, error } = await supabase
        .from(table)
        .update(payloadWithoutMissingColumns)
        .eq(keyField, id)
        .select(select)
        .single());
    }
    throwIfError({ error, context: `Failed to update ${table}` });
    return normalize(row, user);
  },

  async delete(id) {
    const { error } = await supabase.from(table).delete().eq(keyField, id);
    throwIfError({ error, context: `Failed to delete ${table}` });
    return true;
  },
});

const jsonStore = (kind) => {
  const normalize = (row, user) => {
    const plan = row.plan_json || {};
    const meta = plan.meta || {};
    return normalizeBase(
      {
        ...row,
        ...meta,
        plan_type: row.plan_type || meta.plan_type,
        filter: row.filter || row.filters || meta.filter,
        plan_data: row.plan_data || plan.data,
        items: normalizeItems(row.items || plan.items),
        insights: row.insights || plan.insights,
        weight: row.weight || plan.weight,
        date: row.date || plan.date || meta.date_generated || dateOnly(row.created_at),
      },
      user
    );
  };
  const remoteStore = tableStore({
    table: 'meal_plans',
    normalize,
    baseFilter: (query, user) => query.eq('user_id', user.id).contains('plan_json', { kind }),
    toInsert: (data, user) => {
      const meta = legacyPlanMeta(kind, data);
      return {
        user_id: user.id,
        plan_type: meta.plan_type,
        filter: meta.filter,
        plan_data: legacyPlanData(kind, data),
        date_generated: meta.date_generated,
        plan_json: {
          kind,
          data: data.plan_data,
          items: normalizeItems(data.items),
          insights: data.insights,
          weight: data.weight,
          date: data.date || data.date_generated,
          meta: {
            plan_type: data.plan_type,
            filter: data.filter,
            date_generated: data.date_generated,
          },
        },
      };
    },
    toUpdate: (data) => {
      const meta = legacyPlanMeta(kind, data);
      return {
        plan_type: meta.plan_type,
        filter: meta.filter,
        plan_data: legacyPlanData(kind, data),
        date_generated: meta.date_generated,
        plan_json: {
          kind,
          data: data.plan_data,
          items: normalizeItems(data.items),
          insights: data.insights,
          weight: data.weight,
          date: data.date || data.date_generated,
          meta: {
            plan_type: data.plan_type,
            filter: data.filter,
            date_generated: data.date_generated,
          },
        },
      };
    },
  });
  const fallbackStore = browserJsonStore(kind, normalize);
  const mergeRows = (remoteRows = [], localRows = [], sort, limit) => {
    const rows = new Map();
    for (const row of [...localRows, ...remoteRows]) rows.set(row.id, row);
    const sorted = sortRows([...rows.values()], sort);
    return sorted.slice(0, limit || sorted.length);
  };

  return {
    async filter(criteria = {}, sort, limit) {
      const localRows = await fallbackStore.filter(criteria, sort);
      try {
        const remoteRows = await remoteStore.filter(criteria, sort);
        return mergeRows(remoteRows, localRows, sort, limit);
      } catch (error) {
        console.warn(`Using local ${kind} store because Supabase failed:`, error?.message || error);
        return localRows.slice(0, limit || localRows.length);
      }
    },
    async create(data) {
      try {
        return await remoteStore.create(data);
      } catch (error) {
        console.warn(`Saved ${kind} locally because Supabase failed:`, error?.message || error);
        return fallbackStore.create(data);
      }
    },
    async update(id, data) {
      try {
        return await remoteStore.update(id, data);
      } catch (error) {
        console.warn(`Updated local ${kind} because Supabase failed:`, error?.message || error);
        return fallbackStore.update(id, data);
      }
    },
    async delete(id) {
      try {
        return await remoteStore.delete(id);
      } catch (error) {
        console.warn(`Deleted local ${kind} because Supabase failed:`, error?.message || error);
        return fallbackStore.delete(id);
      }
    },
  };
};

const Profile = tableStore({
  table: 'profiles',
  keyField: 'user_id',
  normalize: (row, user) => {
    const name = row.name || row.full_name || '';
    const hasRequiredFields = Boolean(name && row.age && row.gender && row.height && row.weight && row.fitness_goal);
    return normalizeBase(
      {
        ...row,
        id: row.user_id,
        name,
        food_allergies: row.food_allergies || [],
        food_dislikes: row.food_dislikes || [],
        water_goal_litres: Number(row.water_goal_litres) || 2.5,
        is_profile_complete: row.is_profile_complete ?? hasRequiredFields,
      },
      user
    );
  },
  baseFilter: (query, user) => query.eq('user_id', user.id),
  toInsert: (data, user) => ({
    user_id: user.id,
    full_name: data.name,
    age: data.age,
    gender: data.gender,
    height: data.height,
    weight: data.weight,
    target_weight: data.target_weight,
    fitness_goal: data.fitness_goal,
    diet_preference: data.diet_preference,
    food_allergies: data.food_allergies || [],
    food_dislikes: data.food_dislikes || [],
    water_goal_litres: data.water_goal_litres ?? 2.5,
    is_profile_complete: data.is_profile_complete ?? true,
  }),
  toUpdate: (data) => ({
    full_name: data.name,
    age: data.age,
    gender: data.gender,
    height: data.height,
    weight: data.weight,
    target_weight: data.target_weight,
    fitness_goal: data.fitness_goal,
    diet_preference: data.diet_preference,
    food_allergies: data.food_allergies || [],
    food_dislikes: data.food_dislikes || [],
    water_goal_litres: data.water_goal_litres ?? 2.5,
    is_profile_complete: data.is_profile_complete ?? true,
  }),
});

const Meal = tableStore({
  table: 'meals',
  normalize: (row, user) =>
    normalizeBase(
      {
        ...row,
        quantity: row.quantity || '1 serving',
        protein: Number(row.protein) || 0,
        carbs: Number(row.carbs) || 0,
        fats: Number(row.fats) || 0,
        calories: Number(row.calories) || 0,
        meal_type: row.meal_type || 'snack',
        notes: row.notes || row.description || '',
        photo_url: row.photo_url || '',
      },
      user
    ),
  toInsert: (data, user) => ({
    user_id: user.id,
    food_name: String(data.food_name || 'Meal').trim(),
    meal_type: data.meal_type || 'snack',
    quantity: String(data.quantity || '1 serving'),
    date: data.date,
    calories: Number(data.calories) || 0,
    protein: Number(data.protein) || 0,
    carbs: Number(data.carbs) || 0,
    fats: Number(data.fats) || 0,
    ...(data.notes ? { notes: String(data.notes).trim() } : {}),
    ...(data.photo_url ? { photo_url: String(data.photo_url) } : {}),
  }),
  toUpdate: (data) => ({
    food_name: data.food_name,
    meal_type: data.meal_type || 'snack',
    quantity: String(data.quantity || '1 serving'),
    date: data.date,
    calories: Number(data.calories) || 0,
    protein: Number(data.protein) || 0,
    carbs: Number(data.carbs) || 0,
    fats: Number(data.fats) || 0,
    notes: data.notes ? String(data.notes).trim() : null,
    photo_url: data.photo_url || null,
  }),
});

const FoodEstimate = tableStore({
  table: 'food_estimates',
  normalize: (row, user) =>
    normalizeBase(
      {
        ...row,
        food_name: row.food_name || row.normalized_name || 'Meal',
        quantity: row.quantity || '1 serving',
        calories: Number(row.calories) || 0,
        protein: Number(row.protein) || 0,
        carbs: Number(row.carbs) || 0,
        fats: Number(row.fats) || 0,
        source: row.source || 'manual',
        times_used: Number(row.times_used) || 0,
        verified_by_user: row.verified_by_user !== false,
        ingredients: Array.isArray(row.ingredients) ? row.ingredients : [],
      },
      user
    ),
  toInsert: (data, user) => ({
    user_id: user.id,
    normalized_name: String(data.normalized_name || data.food_name || 'meal').trim().toLowerCase(),
    food_name: String(data.food_name || 'Meal').trim(),
    quantity: String(data.quantity || '1 serving').trim(),
    calories: Number(data.calories) || 0,
    protein: Number(data.protein) || 0,
    carbs: Number(data.carbs) || 0,
    fats: Number(data.fats) || 0,
    source: data.source || 'manual',
    confidence: Number(data.confidence) || 0.7,
    times_used: Number(data.times_used) || 1,
    verified_by_user: data.verified_by_user !== false,
    ingredients: data.ingredients || [],
  }),
  toUpdate: (data) => ({
    normalized_name: String(data.normalized_name || data.food_name || 'meal').trim().toLowerCase(),
    food_name: String(data.food_name || 'Meal').trim(),
    quantity: String(data.quantity || '1 serving').trim(),
    calories: Number(data.calories) || 0,
    protein: Number(data.protein) || 0,
    carbs: Number(data.carbs) || 0,
    fats: Number(data.fats) || 0,
    source: data.source || 'manual',
    confidence: Number(data.confidence) || 0.7,
    times_used: Number(data.times_used) || 1,
    verified_by_user: data.verified_by_user !== false,
    ingredients: data.ingredients || [],
  }),
});

const CustomProduct = tableStore({
  table: 'custom_products',
  normalize: (row, user) =>
    normalizeBase(
      {
        ...row,
        product_name: row.product_name || 'Product',
        brand: row.brand || '',
        serving_size: row.serving_size || '100g',
        calories_per_100g: Number(row.calories_per_100g) || 0,
        protein_per_100g: Number(row.protein_per_100g) || 0,
        carbs_per_100g: Number(row.carbs_per_100g) || 0,
        fats_per_100g: Number(row.fats_per_100g) || 0,
      },
      user
    ),
  toInsert: (data, user) => ({
    user_id: user.id,
    barcode: String(data.barcode || '').trim(),
    product_name: String(data.product_name || 'Product').trim(),
    brand: String(data.brand || '').trim(),
    serving_size: String(data.serving_size || '100g').trim(),
    calories_per_100g: Number(data.calories_per_100g) || 0,
    protein_per_100g: Number(data.protein_per_100g) || 0,
    carbs_per_100g: Number(data.carbs_per_100g) || 0,
    fats_per_100g: Number(data.fats_per_100g) || 0,
    source: data.source || 'manual',
  }),
  toUpdate: (data) => ({
    barcode: String(data.barcode || '').trim(),
    product_name: String(data.product_name || 'Product').trim(),
    brand: String(data.brand || '').trim(),
    serving_size: String(data.serving_size || '100g').trim(),
    calories_per_100g: Number(data.calories_per_100g) || 0,
    protein_per_100g: Number(data.protein_per_100g) || 0,
    carbs_per_100g: Number(data.carbs_per_100g) || 0,
    fats_per_100g: Number(data.fats_per_100g) || 0,
    source: data.source || 'manual',
  }),
});

const Workout = tableStore({
  table: 'workouts',
  normalize: (row, user) => normalizeBase({ ...row, duration_minutes: row.duration, intensity: '' }, user),
  toInsert: (data, user) => ({
    user_id: user.id,
    workout_type: data.workout_type,
    duration: Number(data.duration ?? data.duration_minutes) || 0,
    calories_burned: data.calories_burned || 0,
  }),
  toUpdate: (data) => ({
    workout_type: data.workout_type,
    duration: Number(data.duration ?? data.duration_minutes) || 0,
    calories_burned: data.calories_burned || 0,
  }),
});

const WaterIntake = tableStore({
  table: 'water_logs',
  normalize: (row, user) => normalizeBase({ ...row, glasses: row.amount }, user),
  toInsert: (data, user) => ({
    user_id: user.id,
    date: data.date || dateOnly(new Date()),
    amount: Number(data.amount ?? data.glasses) || 1,
  }),
  toUpdate: (data) => ({
    ...(data.date ? { date: data.date } : {}),
    amount: Number(data.amount ?? data.glasses) || 1,
  }),
});

export const dataService = {
  entities: {
    Profile,
    Meal,
    FoodEstimate,
    CustomProduct,
    Workout,
    WaterIntake,
    MealPlan: jsonStore('meal'),
    WorkoutPlan: jsonStore('workout'),
    GroceryList: jsonStore('grocery'),
    ProgressInsight: jsonStore('insight'),
    WeightLog: jsonStore('weight_log'),
    Notification: jsonStore('notification'),
    ChatMessage: jsonStore('chat_message'),
    Settings: jsonStore('settings'),
  },
};
