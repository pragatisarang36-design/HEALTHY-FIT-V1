export const REFERENCE_OBJECTS = Object.freeze({
  card: { widthMm: 85.60, heightMm: 53.98 },
  coin: Object.freeze({
    // Current 2011 Definitive Series diameters, physically verified by the developer against
    // multiple coins dated 2012-2018 (all matching). Only pre-2011/2012 coins may differ
    // slightly (confirmed: a 2009 coin measured marginally larger). This is accepted as minor,
    // tolerable error given the feature's overall confidence level (0.5-0.6) and given
    // coin-diameter variance is a small contributor to total estimation error compared to
    // thickness-bucket and area-ratio uncertainty. Do not add old/new-series detection.
    '1_rupee': { diameterMm: 21.93 },
    '2_rupee': { diameterMm: 27.0 },
    '5_rupee': { diameterMm: 23.0 },
    '10_rupee': { diameterMm: 27.0 },
  }),
  paper: Object.freeze({
    a4: { widthMm: 210, heightMm: 297 },
    letter: { widthMm: 215.9, heightMm: 279.4 },
  }),
});

export const THICKNESS_CM = Object.freeze({
  thin: 0.7,
  medium: 2,
  thick: 4,
});

export const DENSITY_G_PER_CM3 = Object.freeze({
  rice_dish: 0.75,
  legumes: 0.85,
  grains: 0.55,
  vegetables_sabzi: 0.65,
  curries_gravies: 0.9,
  default: 0.75,
});

export const densityKeyForFoodName = (name = '') => {
  const text = String(name || '').toLowerCase();
  if (/\b(rice|chawal|bhaat|biryani|pulao|fried rice)\b/.test(text)) return 'rice_dish';
  if (/\b(dal|dhal|daal|lentil|lentils|bean|beans|chana|chole|rajma|chickpea|chickpeas)\b/.test(text)) return 'legumes';
  if (/\b(roti|chapati|naan|paratha|bread|toast|dosa|idli|grain|grains|wheat|flour|atta|millet|quinoa)\b/.test(text)) return 'grains';
  if (/\b(sabzi|subzi|vegetable|vegetables|bhindi|okra|gobi|cauliflower|spinach|palak|carrot|cabbage|capsicum)\b/.test(text)) return 'vegetables_sabzi';
  if (/\b(curry|curries|gravy|gravy|masala|korma|sambar|rasam)\b/.test(text)) return 'curries_gravies';
  return 'default';
};

export const confidenceForReferenceType = (referenceType) =>
  referenceType === 'card' ? 0.6 : 0.5;

const mm2ToCm2 = (areaMm2) => areaMm2 / 100;

const rectangleAreaMm2 = ({ widthMm, heightMm }) => widthMm * heightMm;

const circleAreaMm2 = ({ diameterMm }) => {
  const radiusMm = diameterMm / 2;
  return Math.PI * radiusMm * radiusMm;
};

export const referenceAreaCm2 = ({ referenceType, referenceSubtype } = {}) => {
  if (referenceType === 'card') {
    return mm2ToCm2(rectangleAreaMm2(REFERENCE_OBJECTS.card));
  }

  if (referenceType === 'coin') {
    const coin = REFERENCE_OBJECTS.coin[referenceSubtype];
    return coin ? mm2ToCm2(circleAreaMm2(coin)) : null;
  }

  if (referenceType === 'paper') {
    const paper = REFERENCE_OBJECTS.paper[referenceSubtype];
    return paper ? mm2ToCm2(rectangleAreaMm2(paper)) : null;
  }

  return null;
};

export function estimateGrams({
  areaRatioToReference,
  thicknessBucket,
  densityKey = 'default',
  referenceType,
  referenceSubtype,
} = {}) {
  const areaRatio = Number(areaRatioToReference);
  if (!Number.isFinite(areaRatio) || areaRatio <= 0) return null;

  const referenceArea = referenceAreaCm2({ referenceType, referenceSubtype });
  if (!referenceArea) return null;

  const thickness = THICKNESS_CM[thicknessBucket];
  if (!thickness) return null;

  const density = DENSITY_G_PER_CM3[densityKey] || DENSITY_G_PER_CM3.default;
  const itemAreaCm2 = areaRatio * referenceArea;
  const volumeCm3 = itemAreaCm2 * thickness;
  const grams = volumeCm3 * density;

  return Math.max(1, Math.round(grams));
}
