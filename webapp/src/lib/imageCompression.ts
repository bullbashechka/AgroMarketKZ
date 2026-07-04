const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.82;

/** Фото не удалось декодировать (например, HEIC без поддержки в браузере). */
export class ImageDecodeError extends Error {}

async function decodeSource(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // Фолбэк ниже — некоторые браузеры не умеют HEIC/HEIF через createImageBitmap.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Сжимает фото до ≤1600px по длинной стороне и перекодирует в JPEG. Заодно решает проблему
 * HEIC-фото с iPhone — после re-encode на выходе всегда `image/jpeg`.
 */
export async function compressImage(file: File): Promise<Blob> {
  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await decodeSource(file);
  } catch {
    throw new ImageDecodeError("Не удалось обработать фото");
  }

  const width = source instanceof ImageBitmap ? source.width : source.naturalWidth;
  const height = source instanceof ImageBitmap ? source.height : source.naturalHeight;
  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageDecodeError("Не удалось обработать фото");
  ctx.drawImage(source, 0, 0, targetWidth, targetHeight);

  if (source instanceof ImageBitmap) source.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  if (!blob) throw new ImageDecodeError("Не удалось обработать фото");
  return blob;
}
