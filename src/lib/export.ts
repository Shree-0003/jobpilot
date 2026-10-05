import "server-only";
import ExcelJS from "exceljs";

/** Neutralise spreadsheet formula injection (=, +, -, @, tab, CR at the start of a cell). */
export function safeCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const esc = (v: unknown) => {
    const s = safeCell(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\r\n");
}

export async function toXlsx(sheet: string, headers: string[], rows: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "JobPilot";
  const ws = wb.addWorksheet(sheet);
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow(r.map(safeCell));
  ws.columns.forEach((c) => (c.width = 22));
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}
