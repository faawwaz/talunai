import type { ActionInboxItem } from "../../../packages/client";

const copy: Record<
  ActionInboxItem["action"],
  { title: string; description: string; button: string }
> = {
  COMPLETE_EVIDENCE: {
    title: "Lengkapi bukti invoice",
    description: "Tambahkan dokumen yang dibutuhkan agar Deal dapat diperiksa.",
    button: "Lengkapi bukti",
  },
  INVITE_LENDER: {
    title: "Pilih pendana untuk Deal",
    description:
      "Undang satu organisasi pendana sebelum ketentuan ditandatangani.",
    button: "Pilih pendana",
  },
  SIGN_TERMS: {
    title: "Setujui ketentuan Deal",
    description: "Periksa jumlah, biaya, dan tanggal sebelum menandatangani.",
    button: "Periksa ketentuan",
  },
  CONFIRM_INVOICE: {
    title: "Konfirmasi invoice",
    description: "Pastikan tagihan dan jumlahnya sesuai dengan catatan Anda.",
    button: "Tinjau invoice",
  },
  REVIEW_DEAL: {
    title: "Tinjau bukti Deal",
    description: "Periksa dokumen dan catat keputusan review Anda.",
    button: "Mulai review",
  },
  REGISTER_DEAL: {
    title: "Daftarkan Deal",
    description:
      "Kedua pihak sudah menyetujui ketentuan. Periksa sebelum mendaftarkan di jaringan.",
    button: "Periksa registrasi",
  },
  FUND_DEAL: {
    title: "Deal siap didanai",
    description: "Baca ketentuan dan risiko sebelum mendanai melalui wallet.",
    button: "Tinjau pendanaan",
  },
  PAY_INVOICE: {
    title: "Bayar sisa invoice",
    description: "Periksa sisa tagihan terkonfirmasi sebelum membayar.",
    button: "Lihat pembayaran",
  },
  WITHDRAW_RETURN: {
    title: "Hasil tersedia ditarik",
    description:
      "Pembayaran buyer sudah masuk. Lihat jumlah yang bisa Anda tarik.",
    button: "Lihat saldo",
  },
  WITHDRAW_BALANCE: {
    title: "Sisa pembayaran tersedia",
    description: "Bagian pembayaran untuk usaha Anda sudah dapat ditarik.",
    button: "Lihat saldo",
  },
};

export function actionCopy(action: ActionInboxItem["action"]) {
  return copy[action];
}

export function actionDeadlineLabel(action: ActionInboxItem["action"]) {
  if (
    action === "PAY_INVOICE" ||
    action === "WITHDRAW_RETURN" ||
    action === "WITHDRAW_BALANCE"
  )
    return "Jatuh tempo invoice";
  if (action === "REVIEW_DEAL") return "Batas review";
  if (action === "SIGN_TERMS" || action === "CONFIRM_INVOICE")
    return "Batas persetujuan";
  return "Batas pendanaan";
}

export function actionTargetTab(item: ActionInboxItem) {
  return item.action === "INVITE_LENDER" ? "summary" : item.tab;
}
