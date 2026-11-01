"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { btnPrimary } from "@/components/ui";

export function Picker({ all, selected }: { all: { id: string; code: string; name: string; decision: string }[]; selected: string[] }) {
  const router = useRouter();
  const [ids, setIds] = useState<string[]>(selected);
  const [open, setOpen] = useState(selected.length < 2);
  const toggle = (id: string) => setIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 6 ? p : [...p, id]));
  return (
    <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} className="mb-4 rounded-xl border border-line bg-white p-4">
      <summary className="cursor-pointer text-sm font-semibold">Choose opportunities ({ids.length}/6)</summary>
      <ul className="mt-3 grid max-h-72 gap-1 overflow-y-auto sm:grid-cols-2">
        {all.map((o) => (
          <li key={o.id}><label className="!m-0 flex items-center gap-2 !text-sm !font-normal !text-ink">
            <input type="checkbox" className="!w-4" checked={ids.includes(o.id)} onChange={() => toggle(o.id)} />
            <span className="truncate">{o.code} {o.name}</span></label></li>
        ))}
      </ul>
      <button className={`${btnPrimary} mt-3`} disabled={ids.length < 2} onClick={() => { setOpen(false); router.push(`/compare?ids=${ids.join(",")}`); }}>Compare</button>
    </details>
  );
}
