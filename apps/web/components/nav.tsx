"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; implemented: boolean };

export function NavLinks({ items, pendingLabel }: { items: NavItem[]; pendingLabel: string }) {
  const pathname = usePathname();
  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-sm ${
                active
                  ? "bg-brand-600 text-white"
                  : "text-slate-300 hover:bg-ink-800 hover:text-white"
              }`}
            >
              <span>{item.label}</span>
              {!item.implemented ? (
                <span className="text-[10px] uppercase tracking-wide text-slate-500" title={pendingLabel}>
                  ●
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
