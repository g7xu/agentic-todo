/** "Time used" duration helpers — stored as total minutes, shown as "HH:MM". */

/** 90 → "01:30" */
export function minutesToHHMM(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "1:30" / "01:30" → 90. Returns null for anything else (including ""). */
export function hhmmToMinutes(text: string): number | null {
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(text.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
