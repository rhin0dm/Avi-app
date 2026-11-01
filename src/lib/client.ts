export async function api<T = unknown>(url: string, method = "POST", body?: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const issues = (data.issues as { path: string; message: string }[] | undefined)?.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join("; ");
      return { ok: false, error: issues || data.error || `Request failed (${res.status})` };
    }
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "Network error — check your connection" };
  }
}
