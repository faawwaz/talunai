import { access, writeFile } from "node:fs/promises";
import type { Financing } from "../../packages/client";
import {
  artifact,
  getScenario,
  read,
  research,
  save,
  spec,
  type CaseState,
} from "./common";

export async function exportSummary(
  s: CaseState,
  financing: Financing | null = null,
) {
  const scenario = await getScenario();
  financing ??= await read<Financing>(artifact("financing-final.json"));
  const screenshotManifest =
    (await read<Array<{ name: string; claimId: string; source: string }>>(
      artifact("screenshots/manifest.json"),
    )) ?? [];
  const requiredScreenshots = [
    "01-problem",
    "02-supplier-deal",
    "03-buyer-confirm",
    "04-agent-checks",
    "05-ready-to-fund",
    "06-funded",
    "07-settled",
    "08-completed",
  ];
  const artifactPaths = {
    invoice: "documents/invoice.pdf",
    delivery: "documents/delivery-note.pdf",
    buyerEvidence: "documents/buyer-acknowledgement.pdf",
    agent: "agent-run.json",
    extraction: "agent-extraction.json",
    commercialExtraction: "commercial-extraction.json",
    chainConfiguration: "chain-configuration.json",
    finalDeal: "deal-final.json",
    finalFinancing: "financing-final.json",
    settlementBeforeWithdrawal: "settlement-before-withdrawal.json",
    audit: "audit.json",
    transactionIntents: "transaction-intents.json",
    screenshots: "screenshots/manifest.json",
    truth: "demo-truth.json",
  };
  const missingArtifacts: string[] = [];
  for (const path of Object.values(artifactPaths)) {
    try {
      await access(artifact(path));
    } catch {
      missingArtifacts.push(path);
    }
  }
  for (const transaction of s.transactions) {
    if (transaction.status !== "CONFIRMED") continue;
    const path = `transactions/${transaction.action}.receipt.json`;
    try {
      await access(artifact(path));
    } catch {
      missingArtifacts.push(path);
    }
  }
  for (const name of requiredScreenshots) {
    const entry = screenshotManifest.find(
      (item) =>
        item.name === name &&
        item.claimId === s.claimId &&
        item.source === "ACTUAL_TALUNAI_UI",
    );
    if (!entry) missingArtifacts.push(`screenshots/${name}.png`);
    else {
      try {
        await access(artifact(`screenshots/${name}.png`));
      } catch {
        missingArtifacts.push(`screenshots/${name}.png`);
      }
    }
  }
  const value = {
    schemaVersion: 1,
    case: "Supplier gula kelapa lokal → PT Unilever Indonesia Tbk (skenario simulasi)",
    executionStatus: s.executionStatus,
    lastStage: s.stage,
    disclosure: spec.disclosure,
    publicContext: research.sources.filter(
      (source: { id: string }) =>
        source.id.startsWith("unilever") || source.id.startsWith("mandiri"),
    ),
    assumptions: { ...spec, ...scenario },
    commercialStory: {
      seller: spec.supplier,
      buyer: spec.buyer,
      invoiceNumber: scenario.invoiceNumber,
      issueDate: scenario.issueDate,
      dueDate: scenario.dueDate,
      invoiceAmount: spec.invoiceAmountIdr,
      product: spec.product,
      quantity: spec.quantity,
      unit: spec.unit,
      unitPrice: spec.unitPriceIdr,
      purchaseOrderReference: scenario.purchaseOrderReference,
      deliveryReference: scenario.deliveryReference,
      paymentTerms: scenario.paymentTerms,
      displayedSettlementLabel: "IDRT",
      chainToken: spec.token,
      synthetic: true,
    },
    actualExecution: {
      claimId: s.claimId ?? null,
      agentRunId: s.runId ?? null,
      observations: s.stageRecords,
      transactions: s.transactions.filter((tx) => tx.status === "CONFIRMED"),
      financing,
    },
    artifactPaths,
    submissionEvidence: {
      ready: s.executionStatus === "COMPLETED" && missingArtifacts.length === 0,
      missingArtifacts,
      capturedStates: screenshotManifest
        .filter((item) => item.claimId === s.claimId)
        .map((item) => item.name),
    },
    limitations: [
      "Hubungan supplier–Unilever, harga kontrak, PO, delivery dan tempo adalah sintetis.",
      "Organisasi buyer/wallet bukan Unilever atau pegawainya.",
      "Pembayaran menggunakan MockIDR testnet; bukan IDRT mainnet atau uang Rupiah nyata.",
      "Aksi verifikator diotomatisasi sebagai aktor demo, tetap melewati review/RBAC produk.",
      "Case ini direct lender. Pool A/LP APY tidak termasuk.",
      "Settlement dipercepat dalam demo; tidak mengganti tanggal jatuh tempo.",
      ...(s.executionStatus !== "COMPLETED"
        ? [
            "Eksekusi end-to-end baru belum terbukti. Jangan gunakan sebagai klaim transaksi sukses.",
          ]
        : []),
      ...(missingArtifacts.length > 0
        ? [
            "Paket bukti visual/agent belum lengkap; lihat submissionEvidence.missingArtifacts.",
          ]
        : []),
    ],
  };
  await save(artifact("case-summary.json"), value);
  const money = (n: string) => `Rp${Number(n).toLocaleString("id-ID")}`;
  const sources = research.sources
    .map(
      (source: { title: string; url: string; finding: string }) =>
        `- [${source.title}](${source.url}): ${source.finding}`,
    )
    .join("\n");
  const tx = s.transactions
    .filter((item) => item.status === "CONFIRMED")
    .map(
      (item) =>
        `| ${item.action} | [${item.hash}](${item.explorerUrl}) | ${item.blockNumber} |`,
    )
    .join("\n");
  await writeFile(
    artifact("CASE_SUMMARY.md"),
    `# Case gula kelapa Talunai\n\n**${spec.disclosure}**\n\nStatus eksekusi: **${s.executionStatus}**. Tahap terakhir: ${s.stage}.\n\n## Konteks publik\n\n${sources}\n\n## Asumsi transaksi\n\n${spec.supplier} → ${spec.buyer}. ${spec.quantity} kg ${spec.product.toLowerCase()}, harga asumsi ${money(spec.unitPriceIdr)}/kg, tempo ${spec.paymentTermDays} hari. Bukan transaksi atau hubungan supplier Unilever nyata.\n\n| Komponen | Nilai |\n| --- | ---: |\n| Invoice | ${money(spec.invoiceAmountIdr)} |\n| Sudah dibayar | ${money(spec.previouslyPaidIdr)} |\n| Pendanaan awal | ${money(spec.principalIdr)} |\n| Biaya tetap (1,5% pokok; bukan APY) | ${money(spec.feeIdr)} |\n| Hak pendana | ${money(spec.lenderEntitlementIdr)} |\n| Sisa pemasok | ${money(spec.supplierResidualIdr)} |\n\n${spec.taxAssumption}\n\n## Eksekusi aktual\n\nDeal: ${s.claimId ?? "Belum dibuat"}. Agent run: ${s.runId ?? "Belum berjalan"}.\n\n${financing ? `Koleksi canonical: ${money(financing.totalCollected)}. Pendana telah menarik ${money(financing.lenderWithdrawn)}; supplier telah menarik ${money(financing.borrowerWithdrawn ?? "0")}.` : "Belum ada hasil finansial aktual untuk case baru. Nominal di atas adalah terms skenario, bukan bukti pergerakan dana."}\n\n| Aksi testnet | Hash terkonfirmasi | Block |\n| --- | --- | --- |\n${tx || "| Belum ada | — | — |"}\n\n## Flow sebenarnya\n\nBuat deal → upload tiga PDF → agent live membaca dan mengecek → verifikator demo menyetujui versi final → supplier dan buyer menandatangani terms → verifikator meregistrasikan → lender mendanai → buyer membayar → vault mengalokasikan → kedua penerima menarik haknya. Consent memerlukan review terlebih dahulu dalam implementasi saat ini. Bukti buyer dalam PDF hanya evidence sintetis.\n\n## Batas klaim\n\n${value.limitations.map((item) => `- ${item}`).join("\n")}\n\n## Artifact\n\nSemua artifact berada dalam folder ini; referensi machine-readable di case-summary.json dan demo-truth.json. File screenshot/agent/receipt hanya dihasilkan setelah tahap aktualnya berhasil. Private key berada di .local/coconut-sugar/wallets.json dan tidak termasuk paket publik.\n`,
  );
}
