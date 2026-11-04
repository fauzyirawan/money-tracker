/* demo-data.js: data contoh untuk mode demo, saat backend belum dipasang.
   id kategori dan sumber dana sama dengan bawaan backend, jadi perilakunya serupa. */

import { addDays, toIso } from "./stats.js";

const HISTORY_DAYS = 420;

export const DEMO_CATEGORIES = [
  { id: "food_drinks", nameId: "Makan & Minum", nameEn: "Food & Drinks", type: "OUT", icon: "lucide:utensils", color: "#ff9500", budget: 1800000 },
  { id: "transportation", nameId: "Transportasi", nameEn: "Transportation", type: "OUT", icon: "lucide:car", color: "#007aff", budget: 700000 },
  { id: "groceries", nameId: "Belanja Harian", nameEn: "Groceries", type: "OUT", icon: "lucide:shopping-cart", color: "#34c759", budget: 1500000 },
  { id: "online_shopping", nameId: "Belanja Online", nameEn: "Online Shopping", type: "OUT", icon: "lucide:shopping-bag", color: "#af52de", budget: 800000 },
  { id: "bills_utilities", nameId: "Tagihan & Utilitas", nameEn: "Bills & Utilities", type: "OUT", icon: "lucide:zap", color: "#ffcc00", budget: 900000 },
  { id: "installments", nameId: "Cicilan", nameEn: "Installments", type: "OUT", icon: "lucide:repeat", color: "#ff3b30", budget: 0 },
  { id: "entertainment", nameId: "Hiburan", nameEn: "Entertainment", type: "OUT", icon: "lucide:film", color: "#a2845e", budget: 400000 },
  { id: "health", nameId: "Kesehatan", nameEn: "Health", type: "OUT", icon: "lucide:heart-pulse", color: "#00c7be", budget: 0 },
  { id: "subscriptions", nameId: "Langganan", nameEn: "Subscriptions", type: "OUT", icon: "lucide:tv", color: "#5856d6", budget: 200000 },
  { id: "other_out", nameId: "Lainnya", nameEn: "Others", type: "OUT", icon: "lucide:ellipsis", color: "#8e8e93", budget: 0 },
  { id: "salary", nameId: "Gaji", nameEn: "Salary", type: "IN", icon: "lucide:briefcase", color: "#34c759", budget: 0 },
  { id: "freelance", nameId: "Freelance", nameEn: "Freelance", type: "IN", icon: "lucide:laptop", color: "#32ade6", budget: 0 },
  { id: "other_in", nameId: "Lainnya", nameEn: "Others", type: "IN", icon: "lucide:ellipsis", color: "#8e8e93", budget: 0 },
].map((category, order) => ({ systemKey: category.id, parentId: "", order, active: true, ...category }));

export const DEMO_FUNDS = [
  { id: "bca", name: "BCA", kind: "BANK", openingBalance: 4000000, icon: "lucide:landmark", color: "#007aff" },
  { id: "mandiri", name: "Mandiri", kind: "BANK", openingBalance: 3500000, icon: "lucide:landmark", color: "#ff9500" },
  { id: "gopay", name: "GoPay", kind: "EWALLET", openingBalance: 900000, icon: "lucide:smartphone", color: "#00c7be" },
  { id: "cash", name: "Cash", kind: "CASH", openingBalance: 1200000, icon: "lucide:banknote", color: "#34c759" },
].map((fund, order) => ({ order, active: true, ...fund }));

const DAILY_PLACES = [
  ["Warung Bu Tini", "food_drinks", 18000, 42000, "cash"],
  ["Kopi Kenangan", "food_drinks", 22000, 38000, "gopay"],
  ["Mie Gacoan", "food_drinks", 25000, 55000, "gopay"],
  ["Grab", "transportation", 15000, 48000, "gopay"],
  ["Pertamina", "transportation", 40000, 90000, "bca"],
];

const WEEKLY_PLACES = [
  ["Indomaret", "groceries", 60000, 180000, "bca"],
  ["Superindo", "groceries", 150000, 340000, "bca"],
  ["Tokopedia", "online_shopping", 70000, 320000, "gopay"],
  ["Shopee", "online_shopping", 45000, 210000, "gopay"],
  ["XXI Cinema", "entertainment", 50000, 120000, "gopay"],
];

/* Generator angka sederhana yang selalu menghasilkan urutan sama. */
function randomizer(seed) {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

export function createId() {
  return crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function demoTransactions(today) {
  const random = randomizer(20261102);
  const items = [];
  const stamp = new Date().toISOString();
  const add = (date, type, name, category, amount, fund, extra = {}) => {
    const hour = String(7 + Math.floor(random() * 14)).padStart(2, "0");
    const minute = String(Math.floor(random() * 60)).padStart(2, "0");
    items.push({ id: createId(), date, time: `${hour}:${minute}`, type, name, category, subCategory: "", fund, toFund: "", amount, merchant: type === "TRANSFER" ? "" : name, note: "", tags: "", inputMethod: "MANUAL", referenceNo: "", receiptLink: "", details: null, scheduleId: "", createdAt: stamp, updatedAt: stamp, deleted: false, groupId: "", scheduleDueDate: "", ...extra });
  };
  const between = (low, high) => Math.round((low + random() * (high - low)) / 500) * 500;

  for (let offset = HISTORY_DAYS; offset >= 0; offset -= 1) {
    const date = addDays(today, -offset);
    const day = Number(date.slice(8));
    if (day === 25) add(date, "IN", "PT Maju Bersama", "salary", 12500000, "bca");
    if (day === 1) add(date, "OUT", "Kos Bulanan", "bills_utilities", 2800000, "bca", { scheduleId: "rent" });
    if (day === 2) add(date, "OUT", "Tabungan Reksa Dana", "other_out", 1500000, "bca", { scheduleId: "saving" });
    if (day === 3) add(date, "OUT", "Cicilan Motor", "installments", 1250000, "bca", { scheduleId: "s1" });
    if (day === 5) add(date, "OUT", "Listrik PLN", "bills_utilities", between(280000, 460000), "bca", { scheduleId: "s2" });
    if (day === 7) add(date, "OUT", "Internet IndiHome", "bills_utilities", 350000, "bca", { scheduleId: "s3" });
    if (day === 9) add(date, "OUT", "Netflix", "subscriptions", 65000, "bca", { scheduleId: "s4" });
    if (day === 15) add(date, "TRANSFER", "Isi GoPay", "", 3200000, "bca", { toFund: "gopay" });
    if (day === 20) add(date, "TRANSFER", "Tarik Tunai", "", 500000, "bca", { toFund: "cash" });
    if (day === 16 && random() > 0.45) add(date, "IN", "Proyek Desain", "freelance", between(800000, 2400000), "mandiri");

    const count = 1 + Math.floor(random() * 3);
    for (let index = 0; index < count; index += 1) {
      const [name, category, low, high, fund] = DAILY_PLACES[Math.floor(random() * DAILY_PLACES.length)];
      add(date, "OUT", name, category, between(low, high), fund);
    }
    if (random() < 0.3) {
      const [name, category, low, high, fund] = WEEKLY_PLACES[Math.floor(random() * WEEKLY_PLACES.length)];
      add(date, "OUT", name, category, between(low, high), fund);
    }
  }
  return items;
}

export function demoSchedules(today) {
  const nextOn = (day) => {
    const date = new Date(`${today}T00:00:00Z`);
    if (date.getUTCDate() >= day) date.setUTCMonth(date.getUTCMonth() + 1, day);
    else date.setUTCDate(day);
    return toIso(date);
  };
  const base = { interval: 1, weekdays: "", startDate: "2026-01-01", endDate: "", fund: "bca", toFund: "", reminderDays: 3, active: true, lastRun: "", lastReminder: "", frequency: "MONTHLY" };
  return [
    { ...base, id: "s1", name: "Cicilan Motor", type: "OUT", category: "installments", amount: 1250000, dayOfMonth: 3, nextDate: nextOn(3), mode: "AUTO", runCount: 4, maxRuns: 12 },
    { ...base, id: "s2", name: "Listrik PLN", type: "OUT", category: "bills_utilities", amount: 380000, dayOfMonth: 5, nextDate: nextOn(5), mode: "CONFIRM", runCount: 10, maxRuns: 0 },
    { ...base, id: "s3", name: "Internet IndiHome", type: "OUT", category: "bills_utilities", amount: 350000, dayOfMonth: 7, nextDate: nextOn(7), mode: "CONFIRM", runCount: 10, maxRuns: 0 },
    { ...base, id: "s4", name: "Netflix", type: "OUT", category: "subscriptions", amount: 65000, dayOfMonth: 9, nextDate: nextOn(9), mode: "AUTO", runCount: 10, maxRuns: 0 },
    { ...base, id: "s5", name: "Gaji", type: "IN", category: "salary", amount: 12500000, dayOfMonth: 25, nextDate: nextOn(25), mode: "AUTO", runCount: 10, maxRuns: 0 },
  ];
}
