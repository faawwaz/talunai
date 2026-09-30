"use client";

import { useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, FileText } from "lucide-react";
import { landingEvidence as proof, rupiah } from "./evidence";

// Explanatory states correspond to nextClaimTask in the actual application.
// This is a role preview, never a current claim, login or transaction control.
const stages = [
  {
    role: "Pemasok",
    label: "Ajukan invoice",
    when: "Saat pengajuan disiapkan",
    next: "Lengkapi bukti invoice",
    description:
      "Unggah invoice, bukti penerimaan barang, dan pengakuan pembeli. Mulai pemeriksaan setelah bukti lengkap.",
    outcome: "Bukti lengkap → pemeriksaan dimulai",
  },
  {
    role: "Verifikator",
    label: "Tinjau pemeriksaan",
    when: "Setelah pemeriksaan otomatis",
    next: "Periksa bukti dan ambil keputusan",
    description:
      "Baca hasil pemeriksaan dan dokumen sumber. Minta perbaikan jika perlu. Keputusan tetap di tangan manusia.",
    outcome: "Review disetujui → para pihak menandatangani",
  },
  {
    role: "Pembeli",
    label: "Konfirmasi ketentuan",
    when: "Setelah review disetujui",
    next: "Tinjau pengakuan invoice Anda",
    description:
      "Periksa nilai dan jatuh tempo invoice sebelum menandatangani. Pemasok juga menyetujui ketentuan pembiayaan yang sama.",
    outcome: "Kedua pihak menyetujui → deal didaftarkan",
  },
  {
    role: "Pendana",
    label: "Danai deal",
    when: "Setelah registrasi terkonfirmasi",
    next: "Deal siap didanai",
    description: `Tinjau dana ${rupiah(proof.principal)}, biaya ${rupiah(proof.fee)}, jatuh tempo, dan risiko. Status berubah setelah transaksi dikonfirmasi.`,
    outcome: "Pendanaan terkonfirmasi → modal diterima pemasok",
  },
] as const;

export function NextActionPreview() {
  const [selected, setSelected] = useState(2);
  const stage = stages[selected];
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    if (event.key === "ArrowRight" || event.key === "ArrowDown")
      next = (index + 1) % stages.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = (index + stages.length - 1) % stages.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = stages.length - 1;
    else return;
    event.preventDefault();
    setSelected(next);
    document.getElementById(`role-preview-${next}`)?.focus();
  };

  return (
    <div className="landing-workflow">
      <noscript>
        <style>
          {
            ".landing-role-tabs, .landing-workflow-top > span:last-child { display: none; } .landing-workflow-layout { grid-template-columns: 1fr; }"
          }
        </style>
      </noscript>
      <div className="landing-workflow-top">
        <span>Pratinjau tampilan peran</span>
      </div>
      <div className="landing-workflow-layout">
        <div
          className="landing-role-tabs"
          role="tablist"
          aria-label="Pihak dalam deal"
        >
          {stages.map((item, index) => (
            <button
              key={item.role}
              type="button"
              role="tab"
              id={`role-preview-${index}`}
              aria-controls="role-preview-panel"
              aria-selected={selected === index}
              tabIndex={selected === index ? 0 : -1}
              onClick={() => setSelected(index)}
              onKeyDown={(event) => move(event, index)}
            >
              <span className="landing-role-number" aria-hidden="true">
                0{index + 1}
              </span>
              <span>
                <strong>{item.role}</strong>
                <span>{item.label}</span>
              </span>
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          ))}
        </div>
        <div
          className="landing-next-action"
          id="role-preview-panel"
          role="tabpanel"
          aria-labelledby={`role-preview-${selected}`}
          tabIndex={0}
        >
          <div className="landing-next-deal">
            <span>
              <FileText size={16} aria-hidden="true" />
              {proof.dealLabel}
            </span>
            <span>Tagihan {rupiah(proof.acceptedOutstanding)}</span>
          </div>
          <div className="landing-next-content" key={selected}>
            <p className="landing-next-eyebrow">Langkah berikutnya</p>
            <h3>{stage.next}</h3>
            <p className="landing-next-when">{stage.when}</p>
            <p className="landing-next-description">{stage.description}</p>
            <p className="landing-next-outcome">{stage.outcome}</p>
          </div>
          <div className="landing-next-footer">
            <p>Contoh tampilan alur. Siklus deal di atas sudah selesai.</p>
            <Link href="/app" prefetch={false} className="landing-text-link">
              Buka Aplikasi
              <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
