import { readFile, writeFile } from "node:fs/promises";

/** Small deterministic, text-bearing PDFs generated only from committed synthetic fixtures. */
for (const name of ["cocoa", "packaging"]) {
  const text = await readFile(`fixtures/${name}-invoice.txt`, "utf8");
  const lines = text
    .trim()
    .split("\n")
    .flatMap((line) => line.match(/.{1,94}/g) ?? [""]);
  const stream = `BT /F1 8 Tf 40 790 Td 14 TL\n${lines.map((line) => `(${line.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)")}) Tj T*`).join("\n")}\nET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  await writeFile(`fixtures/${name}-invoice.pdf`, pdf);
}
