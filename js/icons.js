/* icons.js: ikon kategori dan sumber dana yang bisa diganti.

   Nilai ikon disimpan sebagai satu teks di kolom "ikon" Google Sheets:
     lucide:utensils            ikon dari katalog
     emoji:🍜                    emoji
     image:data:image/webp;...  gambar sendiri, misalnya logo bank

   Logo bank dan e-wallet tidak disertakan karena merupakan merek dagang.
   Kamu bisa mengunggah gambarnya sendiri untuk pemakaian pribadi. */

export const ICON_GROUPS = [
  {
    key: "money",
    icons: ["wallet", "wallet-cards", "credit-card", "landmark", "piggy-bank", "banknote", "coins", "hand-coins", "receipt", "receipt-text", "qr-code", "smartphone", "badge-percent", "percent", "trending-up", "chart-pie", "chart-line", "gem", "vault", "circle-dollar-sign"],
  },
  {
    key: "food",
    icons: ["utensils", "coffee", "cup-soda", "pizza", "sandwich", "ice-cream-cone", "soup", "beef", "apple", "cake", "wine", "beer"],
  },
  {
    key: "shopping",
    icons: ["shopping-cart", "shopping-bag", "shopping-basket", "store", "gift", "shirt", "scissors", "tag"],
  },
  {
    key: "transport",
    icons: ["car", "bus", "bike", "fuel", "train-front", "plane", "ship", "parking-meter", "map-pin"],
  },
  {
    key: "home",
    icons: ["house", "building", "building-2", "lamp", "sofa", "wrench", "hammer", "zap", "droplet", "flame", "wifi", "tv", "phone", "router", "plug"],
  },
  {
    key: "health",
    icons: ["heart-pulse", "pill", "stethoscope", "hospital", "activity", "dumbbell", "baby", "dog", "cat", "paw-print"],
  },
  {
    key: "fun",
    icons: ["graduation-cap", "book-open", "school", "laptop", "gamepad-2", "film", "music", "ticket", "headphones", "camera", "palette", "popcorn"],
  },
  {
    key: "other",
    icons: ["briefcase", "handshake", "users", "user", "heart", "sparkles", "star", "umbrella", "shield", "repeat", "calendar", "ellipsis"],
  },
];

export const EMOJI_CHOICES = ["🍜", "🍚", "🍗", "🍔", "☕", "🧋", "🛒", "🛍️", "🚗", "🛵", "🚌", "⛽", "🏠", "💡", "💧", "📱", "💳", "🏦", "💰", "💵", "🎁", "🎬", "🎮", "🎵", "💊", "🏥", "🎓", "📚", "✈️", "🐱", "👶", "🕌", "❤️", "⭐", "📈", "🧾"];

export const COLOR_CHOICES = ["#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#00c7be", "#32ade6", "#007aff", "#5856d6", "#af52de", "#ff2d55", "#a2845e", "#8e8e93"];

const MAX_IMAGE_SIZE = 128;

export function parseIcon(value = "") {
  const index = value.indexOf(":");
  const type = value.slice(0, index);
  const data = value.slice(index + 1);
  if (type === "emoji" && data) return { type, data };
  if (type === "image" && data.startsWith("data:image/")) return { type, data };
  return { type: "lucide", data: type === "lucide" && data ? data : "ellipsis" };
}

function escapeAttribute(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function relativeLuminance(hex) {
  const channels = [1, 3, 5].map((start) => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/* Warna gambar di atas kotak ikon, dipilih otomatis agar selalu terbaca. */
export function inkFor(color) {
  return relativeLuminance(color) > 0.42 ? "#000000" : "#ffffff";
}

export function glyph(name, className = "icon") {
  return `<svg class="${className}" aria-hidden="true"><use href="icons/sprite.svg#${escapeAttribute(name)}"></use></svg>`;
}

/* Kotak ikon bergaya Pengaturan iOS. size: "sm", "md", atau "lg". */
export function tile(iconValue, color, size = "md") {
  const { type, data } = parseIcon(iconValue);
  if (type === "image") {
    return `<span class="tile tile--${size} tile--image"><img src="${escapeAttribute(data)}" alt="" /></span>`;
  }
  const style = `background:${escapeAttribute(color)};color:${inkFor(color)}`;
  if (type === "emoji") {
    return `<span class="tile tile--${size} tile--emoji" style="background:${escapeAttribute(color)}">${escapeAttribute(data)}</span>`;
  }
  return `<span class="tile tile--${size}" style="${style}">${glyph(data)}</span>`;
}

/* Memotong gambar menjadi persegi kecil, supaya muat di satu sel Google Sheets. */
export async function imageFileToIcon(file) {
  if (!file.type.startsWith("image/")) throw new Error("INVALID_IMAGE");
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("INVALID_IMAGE");
  });
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = MAX_IMAGE_SIZE;
  canvas.height = MAX_IMAGE_SIZE;
  const context = canvas.getContext("2d");
  context.imageSmoothingQuality = "high";
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    MAX_IMAGE_SIZE,
    MAX_IMAGE_SIZE
  );
  bitmap.close();
  return `image:${canvas.toDataURL("image/webp", 0.85)}`;
}
