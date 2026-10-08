import { badge, button, canvas, checkbox, icon, input, panel, separator } from "../kit.ts";
import type { SceneDefinition } from "../scene.ts";
import { rect, text } from "../svg.ts";

const width = 1280;
const height = 720;
const cardX = 64;
const cardY = 164;
const cardWidth = 1152;
const headerHeight = 44;
const rowHeight = 48;
const amountRight = cardX + cardWidth - 24;
const amountLeft = amountRight - 104;

const invoices = [
  ["INV-2048", "Northwind Studio", "billing@northwind.example", "Paid", "Oct 2, 2026", "$4,250.00"],
  ["INV-2047", "Lumen Labs", "accounts@lumen.example", "Pending", "Oct 1, 2026", "$1,180.50"],
  ["INV-2046", "Harbor & Pine", "finance@harborpine.example", "Paid", "Sep 29, 2026", "$920.00"],
  ["INV-2045", "Quill Analytics", "ap@quill.example", "Overdue", "Sep 24, 2026", "$12,400.00"],
  ["INV-2044", "Field Notes Co.", "hello@fieldnotes.example", "Paid", "Sep 22, 2026", "$310.75"],
  ["INV-2043", "Atlas Freight", "payables@atlas.example", "Pending", "Sep 19, 2026", "$6,075.00"],
  ["INV-2042", "Juniper Health", "billing@juniper.example", "Paid", "Sep 15, 2026", "$2,640.00"],
  ["INV-2041", "Kestrel Robotics", "ops@kestrel.example", "Paid", "Sep 12, 2026", "$18,990.00"],
  ["INV-2040", "Moss & Stone", "studio@mossstone.example", "Overdue", "Sep 8, 2026", "$745.20"],
  ["INV-2039", "Brightwater", "accounts@brightwater.example", "Paid", "Sep 3, 2026", "$3,300.00"],
] as const;

function tone(status: string) {
  if (status === "Paid") return "success";
  if (status === "Overdue") return "danger";
  return "neutral";
}

/** A data table page. The Amount column loses its right alignment. */
export const tableScene: SceneDefinition = {
  id: "table",
  title: "Data table",
  size: "wide",
  width,
  height,
  change: { kind: "alignment", summary: "The Amount column is no longer right-aligned." },
  regions: [
    {
      x: amountLeft - 4,
      y: cardY + 8,
      width: 112,
      height: headerHeight + rowHeight * invoices.length - 16,
    },
  ],
  density: 0.13,
  render({ palette, changed }) {
    const amountX = changed ? amountLeft : amountRight;
    const amountAnchor = changed ? "start" : "end";
    let result =
      canvas(palette, width, height) +
      text({ x: cardX, y: 68, value: "Invoices", fill: palette.text, size: 24, weight: 700 }) +
      button(palette, { x: 1088, y: 50, width: 128, label: "New invoice", kind: "primary" }) +
      input(palette, {
        x: cardX,
        y: 104,
        width: 280,
        height: 36,
        placeholder: "Search invoices",
      }) +
      icon({ name: "search", x: cardX + 252, y: 114, color: palette.faint }) +
      button(palette, { x: 356, y: 104, width: 132, label: "All statuses", chevron: true }) +
      panel(palette, {
        x: cardX,
        y: cardY,
        width: cardWidth,
        height: headerHeight + rowHeight * invoices.length,
      }) +
      // The header fill keeps the card radius at the top corners only.
      rect({
        x: cardX + 1,
        y: cardY + 1,
        width: cardWidth - 2,
        height: headerHeight - 1,
        radius: 11,
        fill: palette.subtle,
      }) +
      rect({
        x: cardX + 1,
        y: cardY + 20,
        width: cardWidth - 2,
        height: headerHeight - 20,
        fill: palette.subtle,
      });
    const headerY = cardY + headerHeight / 2;
    const header = (x: number, value: string, anchor: "start" | "end" = "start") =>
      text({ x, y: headerY, value, fill: palette.muted, size: 13, weight: 500, anchor });
    result +=
      checkbox(palette, { x: cardX + 20, y: headerY - 9, checked: false }) +
      header(cardX + 60, "Invoice") +
      icon({ name: "sort", x: cardX + 112, y: headerY - 7, color: palette.faint, size: 14 }) +
      header(cardX + 196, "Customer") +
      header(cardX + 436, "Email") +
      header(cardX + 736, "Status") +
      header(cardX + 880, "Issued") +
      header(amountX, "Amount", amountAnchor);
    invoices.forEach((invoice, index) => {
      const [number, customer, email, status, date, amount] = invoice;
      const rowY = cardY + headerHeight + rowHeight * index;
      const centerY = rowY + rowHeight / 2;
      result +=
        separator(palette, cardX + 1, rowY, cardWidth - 2) +
        checkbox(palette, { x: cardX + 20, y: centerY - 9, checked: index === 1 }) +
        text({ x: cardX + 60, y: centerY, value: number, fill: palette.text, weight: 500 }) +
        text({ x: cardX + 196, y: centerY, value: customer, fill: palette.text }) +
        text({ x: cardX + 436, y: centerY, value: email, fill: palette.muted }) +
        badge(palette, { x: cardX + 736, y: centerY, label: status, tone: tone(status) }) +
        text({ x: cardX + 880, y: centerY, value: date, fill: palette.muted }) +
        text({ x: amountX, y: centerY, value: amount, fill: palette.text, anchor: amountAnchor });
    });
    return result;
  },
};
