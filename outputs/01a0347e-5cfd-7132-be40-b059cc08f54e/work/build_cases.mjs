import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = "/Users/kirillsaidashev/Documents/Projects/actual/AgroMarketKZ/outputs/01a0347e-5cfd-7132-be40-b059cc08f54e";
const outputPath = `${outputDir}/chehly_iphone_12_kaspi.xlsx`;
const previewPath = `${outputDir}/chehly_iphone_12_kaspi_preview.png`;

const products = [
  [1, "Для Apple iPhone 12, iPhone 12 Pro прозрачный", "iPhone 12 / 12 Pro", "Прозрачный", 7000, "", "https://kaspi.kz/shop/p/dlja-apple-iphone-12-iphone-12-pro-prozrachnyi-116576238/?c=750000000", "Верхняя граница бюджета"],
  [2, "Чехол для Apple iPhone 12 темно-коричневый", "iPhone 12", "Темно-коричневый", 6999, "", "https://kaspi.kz/shop/p/chehol-dlja-apple-iphone-12-temno-korichnevyi-172866096/?c=750000000", ""],
  [3, "Чехол 727 для Apple iPhone 12 оранжевый", "iPhone 12", "Оранжевый", 6990, "", "https://kaspi.kz/shop/p/chehol-727-dlja-apple-iphone-12-oranzhevyi-147243254/?c=750000000", ""],
  [4, "Чехол Totu для Apple iPhone 12, iPhone 12 Pro красный", "iPhone 12 / 12 Pro", "Красный", 6990, "", "https://kaspi.kz/shop/p/chehol-totu-dlja-apple-iphone-12-iphone-12-pro-krasnyi-150957113/?c=750000000", ""],
  [5, "Чехол Kajsa для Apple iPhone 12, iPhone 12 Pro рисунок", "iPhone 12 / 12 Pro", "Рисунок", 6900, "", "https://kaspi.kz/shop/p/chehol-kajsa-dlja-apple-iphone-12-iphone-12-pro-risunok-113487492/?c=750000000", ""],
  [6, "Чехол Commo для Apple iPhone 12 Pro, iPhone 12 желтый", "iPhone 12 / 12 Pro", "Желтый", 6818, "", "https://kaspi.kz/shop/p/chehol-commo-dlja-apple-iphone-12-pro-iphone-12-zheltyi-164409669/?c=750000000", ""],
  [7, "Чехол Commo для Apple iPhone 12, iPhone 12 Pro темно-серый", "iPhone 12 / 12 Pro", "Темно-серый", 6675, 1, "https://kaspi.kz/shop/p/chehol-commo-dlja-apple-iphone-12-iphone-12-pro-temno-seryi-154515957/?c=750000000", "1 отзыв на момент проверки"],
  [8, "Чехол CASETiFY для Apple iPhone 12, iPhone 12 Pro белый", "iPhone 12 / 12 Pro", "Белый", 6500, "", "https://kaspi.kz/shop/p/chehol-casetify-dlja-apple-iphone-12-iphone-12-pro-belyi-103009559/?c=750000000", ""],
  [9, "Чехол Coblue для Apple iPhone 12, iPhone 12 Pro черный", "iPhone 12 / 12 Pro", "Черный", 6000, "", "https://kaspi.kz/shop/p/chehol-coblue-dlja-apple-iphone-12-iphone-12-pro-chernyi-105639398/?c=750000000", ""],
  [10, "Чехол Im-Case для Apple iPhone 12, iPhone 12 Pro рисунок", "iPhone 12 / 12 Pro", "Рисунок", 5990, "", "https://kaspi.kz/shop/p/chehol-im-case-dlja-apple-iphone-12-iphone-12-pro-risunok-101785752/?c=750000000", "Самая низкая цена в подборке"],
];

const workbook = Workbook.create();
const sheet = workbook.worksheets.add("Подборка");
sheet.showGridLines = false;
sheet.freezePanes.freezeRows(5);

sheet.mergeCells("A1:H1");
sheet.getRange("A1").values = [["Чехлы для iPhone 12 на Kaspi"]];
sheet.getRange("A1:H1").format = {
  fill: "#C8102E",
  font: { bold: true, color: "#FFFFFF", size: 18 },
  horizontalAlignment: "center",
  verticalAlignment: "center",
};
sheet.getRange("A1:H1").format.rowHeight = 34;

sheet.mergeCells("A2:H2");
sheet.getRange("A2").values = [["Город: Алматы • Проверено: 24.08.2026 • Цены могут измениться"]];
sheet.getRange("A2:H2").format = {
  fill: "#FDECEF",
  font: { color: "#6B1D2B", italic: true, size: 10 },
  horizontalAlignment: "center",
  verticalAlignment: "center",
};
sheet.getRange("A2:H2").format.rowHeight = 23;

sheet.getRange("A3:H3").values = [[
  "Количество", "", "Мин. цена", "", "Макс. цена", "", "Средняя цена", "",
]];
sheet.getRange("A4:H4").formulas = [[
  "=COUNT(E6:E15)", "", "=MIN(E6:E15)", "", "=MAX(E6:E15)", "", "=AVERAGE(E6:E15)", "",
]];
sheet.getRange("A3:H3").format = {
  fill: "#F4F6F8",
  font: { bold: true, color: "#475467" },
  horizontalAlignment: "center",
};
sheet.getRange("A4:H4").format = {
  fill: "#FFFFFF",
  font: { bold: true, color: "#101828", size: 12 },
  horizontalAlignment: "center",
  borders: { preset: "outside", style: "thin", color: "#D0D5DD" },
};
sheet.getRange("A4").format.numberFormat = "0";
sheet.getRange("C4:H4").format.numberFormat = "#,##0 \"₸\"";

const headers = [["№", "Название", "Совместимость", "Цвет / дизайн", "Цена, ₸", "Отзывы", "Ссылка", "Примечание"]];
sheet.getRange("A5:H5").values = headers;
sheet.getRange("A6:H15").values = products;

sheet.getRange("A5:H5").format = {
  fill: "#344054",
  font: { bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  wrapText: true,
  borders: { preset: "outside", style: "thin", color: "#344054" },
};
sheet.getRange("A5:H5").format.rowHeight = 28;

sheet.getRange("A6:H15").format = {
  font: { color: "#1D2939", size: 10 },
  verticalAlignment: "top",
  borders: {
    insideHorizontal: { style: "thin", color: "#EAECF0" },
    bottom: { style: "thin", color: "#D0D5DD" },
  },
};
sheet.getRange("A6:A15").format.horizontalAlignment = "center";
sheet.getRange("C6:F15").format.horizontalAlignment = "center";
sheet.getRange("E6:E15").format.numberFormat = "#,##0 \"₸\"";
sheet.getRange("G6:G15").format = {
  font: { color: "#0563C1", underline: true, size: 9 },
  wrapText: true,
};
sheet.getRange("B6:D15").format.wrapText = true;
sheet.getRange("H6:H15").format.wrapText = true;

sheet.getRange("A6:H15").conditionalFormats.add("expression", {
  formula: "=MOD(ROW(),2)=0",
  format: { fill: "#F9FAFB" },
});
sheet.getRange("E6:E15").conditionalFormats.add("dataBar", {
  color: "#F04438",
  gradient: true,
});

sheet.getRange("A1:A15").format.columnWidth = 5;
sheet.getRange("B1:B15").format.columnWidth = 42;
sheet.getRange("C1:C15").format.columnWidth = 21;
sheet.getRange("D1:D15").format.columnWidth = 18;
sheet.getRange("E1:E15").format.columnWidth = 13;
sheet.getRange("F1:F15").format.columnWidth = 10;
sheet.getRange("G1:G15").format.columnWidth = 56;
sheet.getRange("H1:H15").format.columnWidth = 27;
sheet.getRange("A6:H15").format.rowHeight = 42;

const table = sheet.tables.add("A5:H15", true, "IPhone12CasesTable");
table.style = "TableStyleMedium2";
table.showFilterButton = true;
table.showBandedRows = false;

const keyCheck = await workbook.inspect({
  kind: "table",
  range: "Подборка!A1:H15",
  include: "values,formulas",
  tableMaxRows: 20,
  tableMaxCols: 8,
  maxChars: 9000,
});
console.log(keyCheck.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "final formula error scan",
  maxChars: 2500,
});
console.log(errors.ndjson);

await fs.mkdir(outputDir, { recursive: true });
const preview = await workbook.render({
  sheetName: "Подборка",
  range: "A1:H15",
  scale: 1.25,
  format: "png",
});
await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(JSON.stringify({ outputPath, previewPath }));
