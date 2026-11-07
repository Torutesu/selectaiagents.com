import Link from "next/link";

export function Pills({
  items,
  active,
}: {
  items: { href: string; label: string; key: string }[];
  active: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          scroll={false}
          className={`rounded-full border px-3 py-1 text-sm ${
            i.key === active
              ? "border-ink bg-ink text-bg"
              : "border-line text-muted hover:text-ink"
          }`}
        >
          {i.label}
        </Link>
      ))}
    </div>
  );
}
