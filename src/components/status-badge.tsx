import { Check, Circle, Clock3, Minus, TriangleAlert } from "lucide-react";
import { Badge, type badgeVariants } from "./ui/badge";
import type { VariantProps } from "class-variance-authority";

const statuses: Record<
  string,
  {
    label: string;
    variant: VariantProps<typeof badgeVariants>["variant"];
    marker?: "check" | "clock" | "warning" | "minus";
  }
> = {
  DRAFT: { label: "Draf", variant: "outline" },
  EXTRACTING: { label: "Dokumen diproses", variant: "info", marker: "clock" },
  NEEDS_REVIEW: {
    label: "Perlu tinjauan",
    variant: "warning",
    marker: "warning",
  },
  READY_FOR_SIGNATURES: {
    label: "Menunggu persetujuan",
    variant: "warning",
    marker: "clock",
  },
  READY_FOR_REGISTRATION: {
    label: "Siap dicatat",
    variant: "success",
    marker: "check",
  },
  REGISTRATION_PENDING: {
    label: "Pencatatan diproses",
    variant: "info",
    marker: "clock",
  },
  REGISTERED: {
    label: "Tercatat onchain",
    variant: "success",
    marker: "check",
  },
  AVAILABLE: { label: "Tersedia", variant: "success" },
  FUNDING_EXPIRED: {
    label: "Masa pendanaan berakhir",
    variant: "outline",
    marker: "clock",
  },
  FUNDED: { label: "Sudah didanai", variant: "success", marker: "check" },
  UNFUNDED: { label: "Belum didanai", variant: "outline" },
  ACTIVE: { label: "Pendanaan aktif", variant: "info" },
  PARTIALLY_RECOVERED: { label: "Terbayar sebagian", variant: "info" },
  REPAID: { label: "Pembiayaan lunas", variant: "success", marker: "check" },
  UNPAID: { label: "Belum tertagih", variant: "outline" },
  PARTIALLY_COLLECTED: { label: "Tertagih sebagian", variant: "info" },
  FULLY_COLLECTED: {
    label: "Tertagih penuh",
    variant: "success",
    marker: "check",
  },
  PENDING: { label: "Menunggu", variant: "warning", marker: "clock" },
  PREPARED: { label: "Siap ditandatangani", variant: "outline" },
  SUBMITTED: { label: "Transaksi dikirim", variant: "info", marker: "clock" },
  MINED: { label: "Menunggu konfirmasi", variant: "info", marker: "clock" },
  CONFIRMED: { label: "Terkonfirmasi", variant: "success", marker: "check" },
  CONFIRMED_PROJECTION: {
    label: "Terkonfirmasi",
    variant: "success",
    marker: "check",
  },
  REPLACED: { label: "Transaksi diganti", variant: "outline" },
  DROPPED_OR_UNKNOWN: {
    label: "Perlu rekonsiliasi",
    variant: "warning",
    marker: "warning",
  },
  REVERTED: {
    label: "Transaksi gagal",
    variant: "destructive",
    marker: "warning",
  },
  PROCESSING_FAILED: {
    label: "Pemrosesan gagal",
    variant: "destructive",
    marker: "warning",
  },
  FAILED: { label: "Gagal", variant: "destructive", marker: "warning" },
  REJECTED: { label: "Ditolak", variant: "destructive", marker: "minus" },
  CANCELLED: { label: "Dibatalkan", variant: "outline", marker: "minus" },
  FUNDING_HOLD: {
    label: "Pendanaan ditahan",
    variant: "warning",
    marker: "warning",
  },
  HOLD: { label: "Pendanaan ditahan", variant: "warning", marker: "warning" },
  DISPUTED: { label: "Dalam sengketa", variant: "warning", marker: "warning" },
  OPEN: { label: "Perlu tindakan", variant: "warning", marker: "clock" },
  RESOLVED: { label: "Selesai", variant: "success", marker: "check" },
  COMPLETED: { label: "Selesai", variant: "success", marker: "check" },
  RUNNING: { label: "Sedang berjalan", variant: "info", marker: "clock" },
  QUEUED: { label: "Dalam antrean", variant: "outline", marker: "clock" },
  STALE: { label: "Versi kedaluwarsa", variant: "outline", marker: "minus" },
  SUPERSEDED: {
    label: "Versi diperbarui",
    variant: "outline",
    marker: "minus",
  },
  MISSING: { label: "Belum tersedia", variant: "outline", marker: "minus" },
  SUPPORTED_BY_DOCUMENT: { label: "Bukti tersedia", variant: "info" },
  ATTESTED: { label: "Sudah ditinjau", variant: "success", marker: "check" },
  NOT_INTEGRATED: {
    label: "Belum terhubung",
    variant: "outline",
    marker: "minus",
  },
  PENDING_PARSE: {
    label: "Menunggu pemrosesan",
    variant: "outline",
    marker: "clock",
  },
  PARSED: { label: "Dokumen terbaca", variant: "success", marker: "check" },
  PARSE_FAILED: {
    label: "Dokumen tidak terbaca",
    variant: "destructive",
    marker: "warning",
  },
  NEEDS_MANUAL_ENTRY: {
    label: "Perlu input manual",
    variant: "warning",
    marker: "warning",
  },
  PROVISIONED_SYNTHETIC: { label: "Identitas testnet", variant: "outline" },
  ELIGIBLE_FOR_HUMAN_APPROVAL: {
    label: "Siap ditinjau manusia",
    variant: "info",
  },
  NO_CONFIRMED_PROJECTION: {
    label: "Belum dikonfirmasi",
    variant: "outline",
    marker: "clock",
  },
};

export function statusLabel(status: string) {
  return (
    statuses[status]?.label ??
    status
      .replaceAll("_", " ")
      .toLowerCase()
      .replace(/^./, (letter) => letter.toUpperCase())
  );
}
export function StatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const value = statuses[status] ?? {
    label: statusLabel(status),
    variant: "outline" as const,
  };
  const Icon =
    value.marker === "check"
      ? Check
      : value.marker === "clock"
        ? Clock3
        : value.marker === "warning"
          ? TriangleAlert
          : value.marker === "minus"
            ? Minus
            : Circle;
  return (
    <Badge variant={value.variant} className={className}>
      <Icon
        aria-hidden="true"
        size={11}
        strokeWidth={value.marker ? 1.8 : 2.3}
      />
      {value.label}
    </Badge>
  );
}
