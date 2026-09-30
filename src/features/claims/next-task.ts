import type { Claim, Financing } from "../../../packages/client";

export type ParticipantArea =
  "borrower" | "buyer" | "lender" | "verifier" | "admin";
export type ClaimTask = {
  title: string;
  description: string;
  tab: "evidence" | "terms" | "payments" | "activity";
  action: string;
  actionable: boolean;
};

/** Presentation only: the API and contract independently enforce every action. */
export function nextClaimTask(
  area: string,
  claim: Claim,
  now: number,
  financing?: Financing,
  wallet?: string,
): ClaimTask {
  if (["CANCELLED", "REJECTED"].includes(claim.workflow))
    return {
      title:
        claim.workflow === "CANCELLED"
          ? "Pengajuan dibatalkan"
          : "Keputusan penolakan tercatat",
      description:
        claim.workflow === "CANCELLED"
          ? "Pembatalan onchain bersifat final. Identitas invoice tidak dapat digunakan kembali."
          : "Baca alasan verifier. Pemohon dapat memperbaiki bukti dan mengajukan versi baru sebelum registrasi.",
      tab: "activity",
      action: "Baca keputusan",
      actionable: area === "borrower" && claim.workflow === "REJECTED",
    };
  if (
    (claim.fundingHold || claim.hasDispute) &&
    claim.workflow !== "REGISTERED"
  )
    return {
      title:
        area === "verifier"
          ? "Tinjau alasan penahanan pendanaan"
          : "Pendanaan ditahan untuk peninjauan",
      description:
        "Dispute memerlukan review manusia. Collection buyer dan hak penarikan yang sudah terbentuk tetap berjalan.",
      tab: "terms",
      action: "Lihat dispute",
      actionable: area === "verifier",
    };
  if (claim.workflow === "REGISTERED")
    return registeredTask(area, claim, now, financing, wallet);
  if (claim.workflow === "REGISTRATION_PENDING")
    return {
      title: "Menunggu konfirmasi registrasi",
      description:
        "Transaksi yang dikirim belum dianggap berhasil. Periksa receipt dan event kanonik sebelum melanjutkan.",
      tab: "activity",
      action: "Lihat transaksi",
      actionable: false,
    };
  if (
    Math.min(
      claim.terms.fundingDeadline,
      claim.terms.reviewExpiry,
      claim.terms.consentExpiry,
    ) <= now
  )
    return {
      title: "Batas ketentuan telah berakhir",
      description:
        "Tanda tangan atau pendanaan baru tidak dapat dilanjutkan dengan ketentuan kedaluwarsa. Pemohon perlu memperbarui versi sebelum registrasi dan mengulang review.",
      tab: "terms",
      action: "Periksa batas waktu",
      actionable: area === "borrower",
    };
  if (claim.workflow === "DRAFT" || claim.workflow === "PROCESSING_FAILED")
    return {
      title:
        area === "borrower"
          ? "Lengkapi bukti dan mulai pemeriksaan"
          : "Menunggu bukti dari pemohon",
      description:
        "Invoice, bukti penyerahan, dan pengakuan buyer harus saling mendukung. Analisis yang gagal tidak menghasilkan persetujuan.",
      tab: "evidence",
      action: "Lihat bukti",
      actionable: area === "borrower",
    };
  if (claim.workflow === "EXTRACTING")
    return {
      title: "Bukti sedang diperiksa",
      description:
        "Progres tersimpan di worker. Anda dapat kembali nanti; hasil pemeriksaan tetap memerlukan tindakan manusia.",
      tab: "evidence",
      action: "Lihat progres",
      actionable: false,
    };
  if (
    claim.workflow === "NEEDS_REVIEW" ||
    (claim.workflow === "READY_FOR_SIGNATURES" &&
      claim.evidence.humanReviewStatus !== "ATTESTED")
  )
    return {
      title:
        area === "verifier"
          ? "Periksa bukti dan ambil keputusan"
          : area === "buyer"
            ? "Pengakuan menunggu tinjauan verifier"
            : "Menunggu pemeriksaan manusia",
      description:
        area === "buyer"
          ? "Buyer menandatangani ketentuan final setelah verifier menyetujui versi yang sama. Anda tetap dapat membaca bukti sekarang."
          : "Periksa temuan, sumber dokumen, dan gates kebijakan. Eligible dari agent belum menjadi izin pembiayaan.",
      tab: area === "verifier" ? "terms" : "evidence",
      action: area === "verifier" ? "Tinjau pengajuan" : "Periksa temuan",
      actionable:
        area === "verifier" ||
        (area === "borrower" && claim.workflow === "NEEDS_REVIEW"),
    };
  if (claim.workflow === "READY_FOR_SIGNATURES")
    return {
      title:
        area === "buyer"
          ? "Tinjau pengakuan invoice Anda"
          : area === "borrower"
            ? "Tinjau persetujuan pembiayaan"
            : "Menunggu persetujuan borrower dan buyer",
      description:
        "Periksa persetujuan yang sudah tersimpan untuk versi ini. Kedua pihak menandatangani nominal, penerima, dan batas waktu yang tepat.",
      tab: "terms",
      action: "Lihat persetujuan",
      actionable: area === "borrower" || area === "buyer",
    };
  return {
    title:
      area === "verifier"
        ? "Tinjau dan catat piutang onchain"
        : "Menunggu registrasi oleh verifier",
    description:
      "Persetujuan tersimpan diperiksa kembali saat simulasi. Verifier mengirim transaksi sendiri; pendanaan baru tersedia sesudah registrasi terkonfirmasi.",
    tab: "terms",
    action: "Lihat registrasi",
    actionable: area === "verifier",
  };
}

function registeredTask(
  area: string,
  claim: Claim,
  now: number,
  financing?: Financing,
  wallet?: string,
): ClaimTask {
  const base = { tab: "payments" as const };
  if (!financing || financing.stateConfidence !== "CONFIRMED_PROJECTION")
    return {
      ...base,
      title: "Memeriksa pembayaran Deal",
      description:
        "Status pendanaan dan pembayaran sedang diselaraskan dengan jaringan. Periksa kembali sebelum mengambil tindakan.",
      action: "Lihat pembukuan",
      actionable: false,
    };

  if (financing.financingStatus === "UNFUNDED") {
    if (financing.registryStatus === "CANCELLED")
      return {
        tab: "activity",
        title: "Deal dibatalkan",
        description:
          "Pendanaan tidak dapat dilanjutkan. Periksa riwayat keputusan dan transaksi.",
        action: "Lihat riwayat",
        actionable: false,
      };
    const fundingCutoff = Math.min(
      claim.terms.fundingDeadline,
      claim.terms.reviewExpiry,
      claim.terms.consentExpiry,
    );
    if (fundingCutoff <= now)
      return {
        tab: "activity",
        title: "Masa pendanaan berakhir",
        description:
          "Deal terdaftar ini tidak dapat didanai atau diperpanjang. Periksa riwayatnya dan bawa nomor invoice ke operator untuk tindak lanjut.",
        action: "Lihat riwayat",
        actionable: false,
      };
    if (
      claim.fundingHold ||
      claim.hasDispute ||
      financing.fundingHold ||
      financing.hasDispute
    )
      return {
        tab: area === "verifier" ? "terms" : "payments",
        title:
          area === "verifier"
            ? "Tinjau penahanan pendanaan"
            : "Pendanaan ditahan untuk peninjauan",
        description:
          "Periksa alasan dan keputusan manusia sebelum Deal dapat didanai.",
        action: area === "verifier" ? "Tinjau Deal" : "Lihat alasan",
        actionable: area === "verifier",
      };
    const canFund =
      area === "lender" &&
      financing.registryStatus === "AVAILABLE" &&
      fundingCutoff > now;
    return {
      ...base,
      title: canFund ? "Deal siap didanai" : "Menunggu pendanaan",
      description: canFund
        ? "Periksa nominal, fee, jatuh tempo, risiko, dan izin wallet sebelum mendanai."
        : "Dana belum dicairkan. Periksa status dan kewenangan pendanaan pada detail Deal.",
      action: canFund ? "Tinjau pendanaan" : "Lihat Deal",
      actionable: canFund,
    };
  }

  if (
    area === "lender" &&
    financing.lender?.toLowerCase() === wallet?.toLowerCase() &&
    BigInt(financing.lenderClaimable) > 0n
  )
    return {
      ...base,
      title: "Dana pendana bisa ditarik",
      description: "Pembayaran buyer yang diterima sudah tersedia untuk Anda.",
      action: "Tarik dana",
      actionable: true,
    };
  if (area === "borrower" && BigInt(financing.borrowerResidualClaimable) > 0n)
    return {
      ...base,
      title: "Sisa invoice bisa ditarik",
      description: "Bagian supplier dari pembayaran buyer sudah tersedia.",
      action: "Tarik saldo",
      actionable: true,
    };
  if (area === "buyer" && BigInt(financing.remainingInvoiceCollection) > 0n)
    return {
      ...base,
      title: "Bayar invoice",
      description:
        financing.collectionStatus === "PARTIALLY_COLLECTED"
          ? "Sebagian invoice sudah dibayar. Periksa sisa tagihan sebelum melanjutkan."
          : "Pendanaan telah dicairkan. Bayar invoice sesuai jumlah yang diakui.",
      action: "Lihat sisa tagihan",
      actionable: true,
    };
  if (financing.collectionStatus === "FULLY_COLLECTED")
    return {
      ...base,
      title: "Invoice sudah dibayar penuh",
      description:
        "Pembayaran invoice telah tercatat. Hak penarikan yang masih tersedia tetap dapat diambil oleh penerimanya.",
      action: "Lihat pembagian dana",
      actionable: false,
    };
  return {
    ...base,
    title:
      financing.collectionStatus === "PARTIALLY_COLLECTED"
        ? "Invoice dibayar sebagian"
        : "Menunggu pembayaran buyer",
    description:
      "Pantau pembayaran yang sudah diterima dan hak penarikan pada detail Deal.",
    action: "Lihat pembayaran",
    actionable: false,
  };
}
