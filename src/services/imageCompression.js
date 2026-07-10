const DEFAULT_MAX_WIDTH_PX = 1600;
const DEFAULT_MAX_HEIGHT_PX = 1600;
const DEFAULT_QUALITY = 0.8;
const OUTPUT_TYPE = 'image/jpeg';

const loadImage = (file) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not load image for compression'));
    };
    image.src = objectUrl;
  });

const canvasToBlob = (canvas, quality) =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error('Could not compress image'));
      },
      OUTPUT_TYPE,
      quality
    );
  });

const fitWithinBounds = (width, height, maxWidthPx, maxHeightPx) => {
  const scale = Math.min(maxWidthPx / width, maxHeightPx / height, 1);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

export async function compressImage(
  file,
  { maxWidthPx = DEFAULT_MAX_WIDTH_PX, maxHeightPx = DEFAULT_MAX_HEIGHT_PX, quality = DEFAULT_QUALITY } = {}
) {
  if (!file) return null;
  if (!String(file.type || '').startsWith('image/')) {
    throw new Error('Only image files can be compressed');
  }

  const image = await loadImage(file);
  const { width, height } = fitWithinBounds(image.naturalWidth, image.naturalHeight, maxWidthPx, maxHeightPx);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not prepare image compression');

  context.drawImage(image, 0, 0, width, height);
  const blob = await canvasToBlob(canvas, quality);

  return new File(
    [blob],
    `${String(file.name || 'meal-photo').replace(/\.[^/.]+$/, '')}.jpg`,
    {
      type: OUTPUT_TYPE,
      lastModified: file.lastModified || Date.now(),
    }
  );
}

export default compressImage;
