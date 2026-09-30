import { writeFile, mkdir, readFile } from "node:fs/promises";
import {
  artifact,
  getScenario,
  save,
  sha256,
  spec,
  validateEconomics,
  type Scenario,
} from "./common";

// Text-bearing vector PDFs, generated locally without a browser, external service or fake document screenshot.
const currency = (n: string) => Number(n).toLocaleString("id-ID");
const escape = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[—–]/g, "-")
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
class PdfPage {
  commands: string[] = [];
  text(
    text: string,
    x: number,
    top: number,
    size = 11,
    bold = false,
    color = "0.09 0.23 0.21",
  ) {
    this.commands.push(
      `BT /${bold ? "F2" : "F1"} ${size} Tf ${color} rg 1 0 0 1 ${x} ${842 - top} Tm (${escape(text)}) Tj ET`,
    );
  }
  rule(top: number) {
    this.commands.push(
      `0.85 0.89 0.85 RG 0.7 w 48 ${842 - top} m 547 ${842 - top} l S`,
    );
  }
  band(top: number, height: number) {
    this.commands.push(
      `0.90 0.94 0.90 rg 48 ${842 - top - height} 499 ${height} re f`,
    );
  }
  field(label: string, value: string, top: number) {
    this.text(`${label}: ${value}`, 48, top, 10);
  }
  encode() {
    const stream = this.commands.join("\n");
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
      `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    ];
    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    for (const [i, obj] of objects.entries()) {
      offsets.push(Buffer.byteLength(pdf, "latin1"));
      pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
    }
    const xref = Buffer.byteLength(pdf, "latin1");
    pdf += `xref\n0 7\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
      .join(
        "",
      )}trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(pdf, "latin1");
  }
}
function header(page: PdfPage, title: string, reference: string) {
  page.text("TALUNAI", 48, 49, 10, true);
  page.band(66, 26);
  page.text("SIMULASI DEMO - BUKAN TRANSAKSI NYATA", 60, 84, 10, true);
  page.text(title, 48, 137, 27, true);
  page.text(reference, 48, 162, 11);
  page.rule(180);
  page.field("Penjual", spec.supplier, 205);
  page.field("Pembeli", spec.buyer, 226);
  page.text("Lokasi pemasok: Kebumen, Jawa Tengah", 48, 248, 10);
}
function footer(page: PdfPage) {
  page.rule(747);
  page.text("Settlement demo: IDRT · BNB Chain Testnet", 48, 770, 10);
  page.text("Bukan dokumen resmi Unilever.", 48, 792, 8);
  page.text("Lokal: id-ID", 48, 810, 7.5);
  page.text("Format tanggal: YYYY-MM-DD", 48, 825, 7.5);
}
function invoice(s: Scenario) {
  const p = new PdfPage();
  header(p, "Invoice komersial", s.invoiceNumber);
  p.field("Tanggal invoice", s.issueDate, 282);
  p.field("Jatuh tempo", s.dueDate, 302);
  p.field("Ketentuan pembayaran", s.paymentTerms, 322);
  p.field("Referensi PO", s.purchaseOrderReference, 342);
  p.field("Bukti penyerahan", s.deliveryReference, 362);
  p.field("Mata uang", "IDR", 382);
  p.band(403, 32);
  p.text("Barang", 60, 424, 10, true);
  p.text("Kuantitas", 306, 424, 10, true);
  p.text("Harga / kg", 384, 424, 10, true);
  p.text("Jumlah (Rp)", 463, 424, 10, true);
  p.text(spec.product, 60, 458, 11);
  p.text("4.000 kg", 306, 458, 10);
  p.text(currency(spec.unitPriceIdr), 394, 458, 10);
  p.text(currency(spec.invoiceAmountIdr), 463, 458, 10);
  p.rule(478);
  p.field("Deskripsi barang", spec.product, 507);
  p.field("Kuantitas", "4.000", 549);
  p.field("Satuan", spec.unit, 570);
  p.field("Nilai invoice awal", currency(spec.invoiceAmountIdr), 600);
  p.field("Sudah dibayar", "0", 622);
  p.field("Outstanding diakui", currency(spec.outstandingIdr), 644);
  p.text(
    `Total invoice  Rp${currency(spec.invoiceAmountIdr)}`,
    48,
    684,
    19,
    true,
  );
  p.text("Kemasan: 160 x 25 kg", 48, 711, 9);
  footer(p);
  return p.encode();
}
function delivery(s: Scenario) {
  const p = new PdfPage();
  header(p, "Bukti penyerahan barang", s.deliveryReference);
  p.field("Nomor invoice", s.invoiceNumber, 285);
  p.field("Referensi PO", s.purchaseOrderReference, 309);
  p.field("Tanggal penyerahan", s.issueDate, 333);
  p.field("Bukti penyerahan", s.deliveryReference, 357);
  p.band(386, 116);
  p.text(spec.product, 63, 413, 17, true);
  p.text("Kuantitas: 4.000", 63, 443, 12);
  p.text("Satuan: kg", 63, 466, 12);
  p.text("Kemasan: 160 x 25 kg", 63, 489, 11);
  p.text("Penerimaan barang: lengkap, tanpa selisih jumlah.", 48, 544, 11);
  p.text("Penerima: buyer demo Talunai", 48, 572, 10);
  footer(p);
  return p.encode();
}
function acknowledgement(s: Scenario) {
  const p = new PdfPage();
  header(p, "Pengakuan penerimaan", s.acknowledgementReference);
  p.field("Nomor invoice", s.invoiceNumber, 285);
  p.field("Referensi PO", s.purchaseOrderReference, 309);
  p.field("Bukti penyerahan", s.deliveryReference, 333);
  p.field("Pengakuan buyer", s.acknowledgementReference, 357);
  p.field("Outstanding diakui", currency(spec.outstandingIdr), 381);
  p.field("Jatuh tempo", s.dueDate, 405);
  p.field("Deskripsi barang", spec.product, 429);
  p.field("Kuantitas", "4.000", 453);
  p.field("Satuan", "kg", 477);
  p.band(509, 82);
  p.text("Penerimaan barang dan tagihan", 62, 535, 14, true);
  p.text("Jumlah dan nominal sesuai dengan invoice.", 62, 559, 10);
  p.text("Persetujuan digital dilakukan melalui deal Talunai.", 62, 580, 9);
  footer(p);
  return p.encode();
}
export async function generateDocuments() {
  validateEconomics();
  const scenario = await getScenario();
  await mkdir(artifact("documents"), { recursive: true });
  const list = [
    { filename: "invoice.pdf", purpose: "INVOICE", bytes: invoice(scenario) },
    {
      filename: "delivery-note.pdf",
      purpose: "DELIVERY_EVIDENCE",
      bytes: delivery(scenario),
    },
    {
      filename: "buyer-acknowledgement.pdf",
      purpose: "SYNTHETIC_BUYER_EVIDENCE",
      bytes: acknowledgement(scenario),
    },
  ];
  const existing = await readFile(artifact("documents/manifest.json"), "utf8")
    .then(JSON.parse)
    .catch((e) => {
      if (e.code === "ENOENT") return null;
      throw e;
    });
  const uploaded = await readFile(artifact("case-state.json"), "utf8")
    .then(JSON.parse)
    .catch((e) => {
      if (e.code === "ENOENT") return null;
      throw e;
    });
  for (const doc of list) {
    const prior = existing?.find(
      (p: { filename: string }) => p.filename === doc.filename,
    );
    if (
      prior &&
      prior.sha256 !== sha256(doc.bytes) &&
      uploaded?.documents?.length
    )
      throw new Error("DOCUMENT_FIXTURE_CHANGED_USE_NEW_INSTANCE");
    await writeFile(artifact(`documents/${doc.filename}`), doc.bytes);
  }
  await save(
    artifact("documents/manifest.json"),
    list.map(({ bytes, ...meta }) => ({
      ...meta,
      sha256: sha256(bytes),
      mime: "application/pdf",
      isSynthetic: true,
    })),
  );
  return scenario;
}
