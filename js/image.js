/* image.js: menyiapkan foto struk sebelum dikirim.
   - Foto HEIC dari iPhone diubah ke JPEG. Safari bisa membukanya langsung, browser lain
     memakai heic2any yang hanya dimuat saat dibutuhkan.
   - Orientasi EXIF diikuti, karena createImageBitmap memakai imageOrientation from-image.
   - Sisi terpanjang dibatasi 1600 px dan ukuran file sekitar 1 MB. */

import { loadScript } from "./utils.js";

const MAX_SIDE = 1600;
const MAX_BYTES = 1000000;
const QUALITY_STEPS = [0.86, 0.78, 0.7, 0.6, 0.5];
const HEIC_LIBRARY = "vendor/heic2any-0.0.4.min.js";

export function isHeic(file) {
  return /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name ?? "");
}

export function isImageFile(file) {
  return file && (file.type.startsWith("image/") || isHeic(file));
}

async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch (error) {
    if (!isHeic(file)) throw new Error("INVALID_IMAGE");
  }
  await loadScript(HEIC_LIBRARY);
  const converted = await window.heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
  return createImageBitmap(Array.isArray(converted) ? converted[0] : converted);
}

/* Foto yang sudah dibuka, dengan putaran dan potongan yang bisa diubah di editor. */
export async function openImage(file) {
  const bitmap = await decode(file).catch(() => {
    throw new Error("INVALID_IMAGE");
  });
  return { bitmap, rotation: 0, crop: { x: 0, y: 0, width: 1, height: 1 } };
}

function rotatedSize(bitmap, rotation) {
  const turned = rotation % 180 !== 0;
  return { width: turned ? bitmap.height : bitmap.width, height: turned ? bitmap.width : bitmap.height };
}

/* Menggambar foto yang sudah diputar ke canvas, ukuran asli atau diperkecil. */
function drawRotated(bitmap, rotation, scale = 1) {
  const size = rotatedSize(bitmap, rotation);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(size.width * scale);
  canvas.height = Math.round(size.height * scale);
  const context = canvas.getContext("2d");
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((rotation * Math.PI) / 180);
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  context.drawImage(bitmap, -width / 2, -height / 2, width, height);
  return canvas;
}

/* Pratinjau kecil untuk editor potong dan putar. */
export function previewUrl(image, maxSide = 1000) {
  const size = rotatedSize(image.bitmap, image.rotation);
  const scale = Math.min(1, maxSide / Math.max(size.width, size.height));
  return drawRotated(image.bitmap, image.rotation, scale).toDataURL("image/jpeg", 0.8);
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/* Hasil akhir: JPEG yang sudah dipotong, diputar, diperkecil, dan dikompres. */
export async function exportImage(image) {
  const full = drawRotated(image.bitmap, image.rotation);
  const crop = {
    x: Math.round(image.crop.x * full.width),
    y: Math.round(image.crop.y * full.height),
    width: Math.max(1, Math.round(image.crop.width * full.width)),
    height: Math.max(1, Math.round(image.crop.height * full.height)),
  };
  const scale = Math.min(1, MAX_SIDE / Math.max(crop.width, crop.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(crop.width * scale);
  canvas.height = Math.round(crop.height * scale);
  const context = canvas.getContext("2d");
  context.imageSmoothingQuality = "high";
  context.drawImage(full, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);

  let blob = null;
  for (const quality of QUALITY_STEPS) {
    blob = await canvasToBlob(canvas, quality);
    if (blob && blob.size <= MAX_BYTES) break;
  }
  const data = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.readAsDataURL(blob);
  });
  return { mime: "image/jpeg", data, size: blob.size, width: canvas.width, height: canvas.height };
}

export function imageDataUrl(image) {
  return `data:${image.mime};base64,${image.data}`;
}
