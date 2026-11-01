"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const LINKS = [
  { href: "/", label: "Decisions" },
  { href: "/opportunities", label: "Register" },
  { href: "/opportunities/new", label: "Submit idea" },
  { href: "/compare", label: "Compare" },
  { href: "/evidence", label: "Evidence" },
  { href: "/import", label: "Import / export" },
  { href: "/settings", label: "Settings" },
];

export function Nav() {
  const path = usePathname();
  const router = useRouter();
  const active = (href: string) =>
    href === "/" ? path === "/" : href === "/opportunities" ? path === "/opportunities" || /^\/opportunities\/[0-9a-f-]{36}/.test(path) : path.startsWith(href);
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4">
        <Link href="/" className="py-3 text-base font-bold tracking-tight text-accent">AVI</Link>
        <nav className="-mb-px flex flex-1 gap-1 overflow-x-auto [scrollbar-width:none]">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href}
              className={`whitespace-nowrap border-b-2 px-2.5 py-3 text-sm font-medium ${active(l.href) ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`}>
              {l.label}
            </Link>
          ))}
        </nav>
        <button
          className="hidden text-sm text-muted hover:text-ink sm:block"
          onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); router.refresh(); }}>
          Sign out
        </button>
      </div>
    </header>
  );
}
