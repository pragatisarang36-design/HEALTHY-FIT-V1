import { supabase } from '@/lib/supabaseClient';

const BACKEND_API_URL = import.meta.env.VITE_BACKEND_API_URL || 'http://localhost:4000';

const getSessionToken = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || '';
};

const handleResponse = async (response) => {
  if (!response.ok) {
    let message = response.statusText;
    try {
      const data = await response.json();
      message = data?.error || message;
    } catch {}
    throw new Error(message);
  }
  return response.json();
};

export async function estimateNutritionFromFreeSources(foodName, quantity = '1 serving') {
  const token = await getSessionToken();
  if (!token) {
    throw new Error('You must be logged in to estimate nutrition.');
  }

  const response = await fetch(`${BACKEND_API_URL}/api/nutrition/estimate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ foodName, quantity }),
  });

  return handleResponse(response);
}

export async function estimateIngredientFromFreeSources(name, quantity = '1 serving', options = {}) {
  const token = await getSessionToken();
  if (!token) {
    throw new Error('You must be logged in to estimate ingredient nutrition.');
  }

  const response = await fetch(`${BACKEND_API_URL}/api/nutrition/estimate-ingredient`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ name, quantity, options }),
  });

  return handleResponse(response);
}

export async function calculateMealFromIdentifiedIngredients({ foodName, quantity = '1 serving', ingredients = [], mealSizeEstimateGrams = null }) {
  const token = await getSessionToken();
  if (!token) {
    throw new Error('You must be logged in to calculate meal nutrition.');
  }

  const response = await fetch(`${BACKEND_API_URL}/api/nutrition/calculate-meal`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      foodName,
      quantity,
      ingredients,
      mealSizeEstimateGrams,
    }),
  });

  return handleResponse(response);
}

export async function lookupBarcodeNutrition(barcode) {
  const token = await getSessionToken();
  if (!token) {
    throw new Error('You must be logged in to look up barcode nutrition.');
  }

  const response = await fetch(`${BACKEND_API_URL}/api/nutrition/barcode-lookup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ barcode }),
  });

  return handleResponse(response);
}
