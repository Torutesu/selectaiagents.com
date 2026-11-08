import { CATEGORIES, type Pricing } from "./types";

export function compact(n: number): string {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

export function usd(n: number): string {
  if (n === 0) return "Free";
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: n < 0.01 ? 4 : 2,
    maximumFractionDigits: 6,
    useGrouping: false,
  })}`;
}

export function priceLabel(p: Pricing): string {
  return p.model === "free" ? "Free" : `${usd(p.priceUsd)} / ${p.unit}`;
}

export function duration(ms: number): string {
  return ms >= 1000
    ? `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)}s`
    : `${ms}ms`;
}

export function categoryLabel(id: string): string {
  return CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

export function dayLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
