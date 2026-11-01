"use client";
import { useState, useSyncExternalStore, type ReactNode } from "react";

const subscribe = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};

export function Tabs({ tabs }: { tabs: { key: string; label: string; content: ReactNode }[] }) {
  // Hash is read hydration-safely: the server and first client render agree on "".
  const hash = useSyncExternalStore(subscribe, () => window.location.hash.slice(1), () => "");
  const [chosen, setChosen] = useState<string | null>(null);
  const active = chosen ?? (tabs.some((t) => t.key === hash) ? hash : tabs[0].key);
  return (
    <div>
      <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none]">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={active === t.key}
            onClick={() => { setChosen(t.key); history.replaceState(null, "", `#${t.key}`); }}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${active === t.key ? "border-accent text-ink" : "border-transparent text-muted"}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => <div key={t.key} hidden={active !== t.key}>{t.content}</div>)}
    </div>
  );
}
