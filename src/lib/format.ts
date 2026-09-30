import { TalunaiApiError } from "../../packages/client";

export function money(value: string | bigint | undefined | null) {
  if (value === undefined || value === null) return "—";
  try {
    return BigInt(value).toLocaleString("id-ID");
  } catch {
    return "—";
  }
}
export function shortAddress(value?: string | null) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "—";
}
export function formatDate(
  value?: number | string | null,
  includeTime = false,
) {
  if (!value) return "—";
  const date =
    typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(includeTime ? ({ hour: "2-digit", minute: "2-digit" } as const) : {}),
  }).format(date);
}
const labels: Record<string, string> = {
  DRAFT: "Draf",
  EXTRACTING: "Sedang diperiksa",
  NEEDS_REVIEW: "Perlu tinjauan",
  READY_FOR_SIGNATURES: "Menunggu tanda tangan",
  READY_FOR_REGISTRATION: "Siap dicatat",
  REGISTRATION_PENDING: "Pencatatan diproses",
  REGISTERED: "Tercatat onchain",
  CANCELLED: "Dibatalkan",
  REJECTED: "Ditolak",
  PROCESSING_FAILED: "Pemeriksaan gagal",
  UNFUNDED: "Belum didanai",
  ACTIVE: "Pembiayaan aktif",
  PARTIALLY_RECOVERED: "Dibayar sebagian",
  REPAID: "Pembiayaan lunas",
  UNPAID: "Belum dibayar",
  PARTIALLY_COLLECTED: "Invoice dibayar sebagian",
  FULLY_COLLECTED: "Invoice tertagih penuh",
  MISSING: "Belum dilengkapi",
  PENDING: "Menunggu",
  SUPPORTED_BY_DOCUMENT: "Didukung dokumen",
  ATTESTED: "Diatestasi",
  STALE: "Perlu diperbarui",
  NOT_INTEGRATED: "Belum terhubung",
  PREPARED: "Siap ditandatangani",
  SUBMITTED: "Dikirim ke jaringan",
  MINED: "Menunggu konfirmasi",
  CONFIRMED: "Terkonfirmasi",
  REVERTED: "Transaksi gagal",
  REPLACED: "Transaksi diganti",
  DROPPED_OR_UNKNOWN: "Belum dapat dipastikan",
  QUEUED: "Dalam antrean",
  RUNNING: "Sedang berjalan",
  COMPLETED: "Selesai",
  SUCCEEDED: "Selesai",
  FAILED: "Gagal",
  OPEN: "Perlu tindakan",
  RESOLVED: "Diselesaikan",
  BORROWER: "Pemohon",
  BUYER: "Pembeli",
  LENDER: "Pendana",
  VERIFIER: "Verifier",
  ADMIN: "Administrator",
  AGENT: "Agent pemeriksaan",
  APPROVED: "Disetujui",
  PROVISIONED_SYNTHETIC: "Akun testnet terdaftar",
  PENDING_PARSE: "Menunggu ekstraksi",
  PARSED: "Teks tersedia",
  NEEDS_MANUAL_ENTRY: "Perlu bukti teks",
  ELIGIBLE_FOR_HUMAN_APPROVAL: "Siap ditinjau manusia",
  MOCK: "Mode simulasi",
  LIVE: "Provider live",
  FUNDING_HOLD: "Pendanaan ditahan",
  HUMAN_REVIEW: "Tinjauan verifier",
  MISSING_EVIDENCE: "Lengkapi bukti",
  REQUEST_MISSING_EVIDENCE: "Permintaan bukti",
  READ_AUTHORIZED_EVIDENCE: "Bukti yang diotorisasi dibaca",
  EXTRACT: "Data dokumen diekstrak",
  CHECK_EVIDENCE: "Bukti dibandingkan",
  POLICY: "Kebijakan diperiksa",
  COMPLETE: "Pemeriksaan selesai",
  DECISION: "Tindak lanjut dicatat",
  NO_CONFIRMED_PROJECTION: "Belum ada data chain terkonfirmasi",
  CONFIRMED_PROJECTION: "Data chain terkonfirmasi",
  DEGRADED_LAST_CONFIRMED_PROJECTION: "Data terakhir · sinkronisasi terganggu",
};
export function labelForStatus(value: string) {
  return labels[value] ?? value.replaceAll("_", " ").toLowerCase();
}
const errors: Record<string, string> = {
  ORIGIN_MISMATCH:
    "Alamat browser tidak sesuai dengan konfigurasi login. Untuk sesi testnet lokal, buka https://localhost:3000/app lalu hubungkan wallet lagi; jangan gunakan 127.0.0.1.",
  ROLE_FORBIDDEN:
    "Akun ini belum punya kewenangan untuk tindakan tersebut pada organisasi atau Deal ini. Periksa ruang kerja aktif dan akses organisasi.",
  OPERATOR_ADMIN_REQUIRED:
    "Tinjauan akses hanya dapat dilakukan oleh wallet Admin yang sudah aktif. Ganti ke wallet Admin lalu buka /admin/access.",
  PARTICIPANT_WALLET_REQUIRED:
    "Wallet Admin atau Agent tidak dapat mendaftar sebagai peserta. Gunakan wallet Borrower, Buyer, atau Lender yang terpisah.",
  REVIEWER_CONFLICT:
    "Verifier harus independen dari organisasi borrower dan buyer pada invoice ini. Gunakan wallet Verifier yang terpisah.",
  NETWORK_UNAVAILABLE:
    "Koneksi ke layanan terputus. Periksa jaringan lalu coba lagi; status transaksi belum dapat dipastikan dari koneksi ini.",
  INVALID_RESPONSE:
    "Respons layanan belum dapat dibaca. Periksa status tindakan terakhir sebelum mencoba mengirim lagi.",
  GOODS_REVIEW_REQUIRED:
    "Rincian atau kategori barang masih perlu ditinjau sebelum registrasi dan pendanaan.",
  CONSENT_DOMAIN_MISMATCH:
    "Payload persetujuan tidak sesuai dengan kontrak dan jaringan workspace. Muat ulang ketentuan.",
  TRANSACTION_TEMPLATE_MISMATCH:
    "Payload transaksi tidak cocok dengan wallet atau konfigurasi workspace. Siapkan ulang tindakan.",
  WALLET_UNAVAILABLE:
    "Wallet belum tersedia. Buka aplikasi melalui browser dengan ekstensi wallet EOA.",
  WALLET_REJECTED:
    "Permintaan dibatalkan di wallet. Data tetap tersimpan; Anda dapat mencoba lagi.",
  WALLET_CHANGED:
    "Akun wallet berubah. Masuk kembali dengan akun yang akan digunakan.",
  WRONG_CHAIN:
    "Jaringan wallet belum sesuai. Ganti ke jaringan yang ditampilkan sebelum melanjutkan.",
  STALE_VERSION:
    "Pengajuan sudah diperbarui. Muat versi terbaru dan tinjau kembali sebelum melanjutkan.",
  HOLD_OR_DISPUTE:
    "Pendanaan ditahan. Selesaikan tinjauan dan dispute sebelum melanjutkan.",
  FUNDING_RISK_ACK_REQUIRED:
    "Baca dan setujui risiko pendanaan sebelum membuka wallet.",
  FUNDING_HOLD: "Pendanaan ditahan. Periksa alasan pada aktivitas pengajuan.",
  CSRF_INVALID:
    "Sesi perlu diperbarui. Masuk kembali; data pengajuan tetap tersimpan.",
  RPC_UNAVAILABLE:
    "Jaringan belum merespons. Jika wallet sudah mengirim transaksi, periksa hash dan statusnya sebelum mencoba lagi.",
  CHAIN_UNAVAILABLE:
    "Jaringan belum tersedia. Data terakhir tetap ditampilkan.",
  INDEXER_NOT_READY:
    "Data jaringan sedang diselaraskan. Tindakan pendanaan akan tersedia setelah sinkron.",
  INDEXER_NOT_FRESH:
    "Data Deal dari jaringan belum cukup baru. Perbarui setelah sinkronisasi pulih sebelum mendanai.",
  LENDER_INVITATION_CLOSED:
    "Akses pendana hanya dapat ditetapkan sebelum persetujuan final atau pendanaan. Periksa status Deal.",
  LENDER_ALREADY_INVITED:
    "Deal ini sudah memiliki organisasi pendana. Pilihan pendana tidak dapat diganti melalui undangan baru.",
  BORROWER_ONLY:
    "Hanya wallet supplier pada Deal ini yang dapat mengundang pendana.",
  ACCOUNT_TYPE_UNSUPPORTED:
    "MVP mendukung wallet EOA. Contract wallet belum didukung.",
  UNSUPPORTED_ACCOUNT_TYPE:
    "MVP mendukung wallet EOA. Contract wallet belum didukung.",
  CLAIM_DUPLICATE:
    "Identitas invoice ini sudah digunakan. Periksa pengajuan yang sudah ada.",
  DUPLICATE_CLAIM:
    "Identitas invoice ini sudah digunakan. Periksa pengajuan yang sudah ada.",
  CONSENT_NOT_READY:
    "Ketentuan belum siap ditandatangani. Selesaikan tinjauan bukti dahulu.",
  CONSENT_REVOCATION_REQUIRED:
    "Persetujuan lama harus dicabut di wallet oleh penandatangan, atau ditunggu sampai kedaluwarsa, sebelum revisi Deal disimpan. Buka tab Persetujuan dan cabut nonce yang masih aktif.",
  CONSENT_NONCE_ALREADY_ISSUED:
    "Nonce wallet ini sudah digunakan untuk persetujuan lain. Pilih nonce baru atau cabut yang lama terlebih dahulu.",
};
export function explainError(error: unknown): string {
  if (error instanceof TalunaiApiError) {
    if (errors[error.code]) return errors[error.code];
    if (error.status === 401)
      return "Sesi telah berakhir. Masuk kembali untuk melanjutkan.";
    if (error.status === 403)
      return `Aksi ini belum diizinkan untuk wallet tersebut (${error.code}). Buka /app untuk memeriksa role aktif.`;
    if (error.status === 404)
      return "Data tidak ditemukan atau tidak dapat diakses oleh akun ini.";
    if (error.status === 409)
      return `Tindakan belum dapat dilanjutkan. Muat ulang data dan periksa status pengajuan. (${error.code})`;
    if (error.status === 429)
      return "Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.";
    if (error.status === 503)
      return "Layanan sedang tidak tersedia. Periksa status tindakan terakhir sebelum mencoba lagi.";
    if (error.status >= 500)
      return "Layanan belum dapat memastikan hasil tindakan. Periksa status Deal atau transaksi sebelum mengirim ulang.";
    return `Periksa data yang dimasukkan. (${error.code})`;
  }
  if (error instanceof Error && errors[error.message])
    return errors[error.message];
  return "Hasil tindakan belum dapat dipastikan. Periksa status Deal atau transaksi sebelum mengirim ulang.";
}
export function explorerUrl(
  chainId: number | undefined,
  kind: "tx" | "address",
  value: string,
) {
  return chainId === 97
    ? `https://testnet.bscscan.com/${kind}/${value}`
    : undefined;
}
