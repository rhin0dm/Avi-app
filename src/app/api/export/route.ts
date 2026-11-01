import { handle } from "@/lib/api";
import { buildBackup, buildCsv, buildWorkbook } from "@/lib/exporter";

export const GET = handle(async (req: Request) => {
  const format = new URL(req.url).searchParams.get("format") ?? "xlsx";
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "csv") {
    return new Response(await buildCsv(), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="avi-opportunities-${stamp}.csv"` },
    });
  }
  if (format === "json") {
    return new Response(JSON.stringify(await buildBackup(), null, 2), {
      headers: { "content-type": "application/json", "content-disposition": `attachment; filename="avi-backup-${stamp}.json"` },
    });
  }
  return new Response(new Uint8Array(await buildWorkbook()), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="avi-register-${stamp}.xlsx"`,
    },
  });
});
