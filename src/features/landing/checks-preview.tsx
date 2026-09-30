"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowDown,
  Check,
  Pause,
  Play,
  ScanLine,
  ShieldCheck,
} from "lucide-react";
import {
  landingChecks as record,
  landingEvidence as proof,
  rupiah,
} from "./evidence";

const stageLabels: Record<string, string> = {
  EXTRACT: "Informasi invoice dibaca",
  CHECK_EVIDENCE: "Bukti dan ketentuan dicocokkan",
  REQUEST_HUMAN_ACTION: "Review manusia diminta",
};

export function ChecksPreview() {
  const panel = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState<boolean | null>(null);
  const [motion, setMotion] = useState<"auto" | "play" | "pause">("auto");
  const [readingLog, setReadingLog] = useState(false);
  const enabled =
    motion === "play" || (motion === "auto" && reducedMotion === false);
  const playing = visible && pageVisible && enabled && !readingLog;

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => {
      setReducedMotion(preference.matches);
      if (preference.matches) setMotion("auto");
    };
    const updateVisibility = () => setPageVisible(!document.hidden);
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0 },
    );
    updatePreference();
    updateVisibility();
    if (panel.current) observer.observe(panel.current);
    preference.addEventListener("change", updatePreference);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
      observer.disconnect();
      preference.removeEventListener("change", updatePreference);
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);

  const checks = [
    {
      found:
        record.checks.extraction === "SUPPORTED_BY_DOCUMENT" &&
        record.checks.conflictCount === 0,
      title: "Nilai tagihan cocok",
      detail: `${rupiah(record.acceptedOutstanding)} sesuai ketentuan`,
    },
    {
      found: record.checks.buyerAcknowledgement === "SUPPORTED_BY_DOCUMENT",
      title: "Pengakuan pembeli ditemukan",
      detail: "Didukung dokumen yang diunggah",
    },
    {
      found: record.checks.delivery === "SUPPORTED_BY_DOCUMENT",
      title: "Bukti pengiriman ditemukan",
      detail: "Dokumen mendukung penerimaan barang",
    },
  ];

  return (
    <div
      ref={panel}
      className={`landing-checks-visual${playing ? " checks-is-playing" : ""}${reducedMotion && motion === "play" ? " checks-motion-opted-in" : ""}`}
    >
      <div className="landing-checks-title">
        <ScanLine size={20} strokeWidth={1.5} aria-hidden="true" />
        <span>Pemeriksaan deal</span>
        <span className="landing-mode-label">Mode simulasi</span>
      </div>
      <p className="landing-checks-record">
        {proof.dealLabel} · Rekam{" "}
        {new Intl.DateTimeFormat("id-ID", {
          day: "numeric",
          month: "short",
          year: "numeric",
          timeZone: "Asia/Jakarta",
        }).format(new Date(record.completedAt))}
        <button
          type="button"
          className="landing-checks-motion"
          disabled={reducedMotion === null}
          aria-label={
            enabled ? "Jeda animasi pemeriksaan" : "Putar animasi pemeriksaan"
          }
          title={
            enabled ? "Jeda animasi pemeriksaan" : "Putar animasi pemeriksaan"
          }
          onClick={() => setMotion(enabled ? "pause" : "play")}
        >
          {enabled ? (
            <Pause size={14} aria-hidden="true" />
          ) : (
            <Play size={14} aria-hidden="true" />
          )}
          <span>{enabled ? "Jeda" : "Putar"}</span>
        </button>
      </p>
      <ul className="landing-checks-list">
        {checks.map((check) => (
          <li key={check.title}>
            <span className="landing-check-scan" aria-hidden="true" />
            <span className="landing-check-mark" aria-hidden="true">
              {check.found ? (
                <Check size={19} strokeWidth={1.5} />
              ) : (
                <ScanLine size={19} />
              )}
            </span>
            <div>
              <strong>{check.found ? check.title : "Perlu ditinjau"}</strong>
              <span>
                {check.found
                  ? check.detail
                  : "Periksa dokumen dan hasil pemeriksaan"}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <div className="landing-human-review">
        <ShieldCheck size={18} strokeWidth={1.5} aria-hidden="true" />
        <span>Hasil diteruskan ke verifikator</span>
        <ArrowRight size={16} aria-hidden="true" />
      </div>
      <details
        className="landing-check-log"
        onFocusCapture={(event) =>
          setReadingLog(event.target.matches(":focus-visible"))
        }
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setReadingLog(false);
        }}
      >
        <summary>
          Rekam pemeriksaan
          <ArrowDown size={14} aria-hidden="true" />
        </summary>
        <ol>
          {record.steps
            .filter((step) => stageLabels[step.stage])
            .map((step) => (
              <li key={step.step}>
                <time dateTime={step.recordedAt}>
                  {new Intl.DateTimeFormat("id-ID", {
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "Asia/Jakarta",
                  }).format(new Date(step.recordedAt))}
                </time>
                <span>{stageLabels[step.stage]}</span>
              </li>
            ))}
        </ol>
        <p>
          Waktu pencatatan WIB. Arsip hasil pemeriksaan, bukan aktivitas
          langsung.
        </p>
      </details>
    </div>
  );
}
