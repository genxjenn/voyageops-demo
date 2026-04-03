import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Parse a timestamp that may use a compact format without colon separators
 * (e.g. "2026-04-01T102705" → "2026-04-01T10:27:05") as well as standard ISO strings.
 */
export function parseTimestamp(value: string | null | undefined): Date {
  if (!value) return new Date(NaN);
  // Already valid ISO — fast path
  const direct = new Date(value);
  if (!isNaN(direct.getTime())) return direct;
  // Fix compact time component: T102705 → T10:27:05
  const fixed = value.replace(
    /T(\d{2})(\d{2})(\d{2})$/,
    "T$1:$2:$3"
  );
  return new Date(fixed);
}
