"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowRight, ArrowUpRight, Check, RefreshCw } from "lucide-react";
import { landingEvidence as proof, rupiah } from "./evidence";

const steps = ["Invoice", "Pendanaan", "Pembayaran"] as const;
type NetworkState = "loading" | "confirmed" | "unavailable" | "changed";

export function ProductPreview() {
  const [selected, setSelected] = useState(1);
  const [network, setNetwork] = useState<NetworkState>("loading");
  const [attempt, setAttempt] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let started = false;
    const load = async () => {
      if (started) return;
      started = true;
      timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch("/v1/explore?events=0", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("PUBLIC_READ_UNAVAILABLE");
        const data: unknown = await response.json();
        if (
          !data ||
          typeof data !== "object" ||
          !("chainId" in data) ||
          data.chainId !== 97 ||
          !("deals" in data) ||
          !Array.isArray(data.deals)
        )
          throw new Error("PUBLIC_READ_INVALID");
        const deal = data.deals.find(
          (item: unknown) =>
            item &&
            typeof item === "object" &&
            "claimKey" in item &&
            item.claimKey === proof.claimKey,
        );
        if (!controller.signal.aborted) {
          setNetwork(
            deal?.status === "REPAID" &&
              deal?.principal === proof.principal &&
              typeof deal?.dueAt === "string" &&
              Date.parse(deal.dueAt) === Date.parse(proof.invoiceDueAt) &&
              deal?.remainingLenderEntitlement === "0"
              ? "confirmed"
              : "changed",
          );
        }
      } catch {
        if (!disposed) setNetwork("unavailable");
      } finally {
        clearTimeout(timer);
      }
    };
    let disposed = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          observer.disconnect();
          void load();
        }
      },
      { rootMargin: "300px" },
    );
    if (ref.current) observer.observe(ref.current);
    return () => {
      disposed = true;
      observer.disconnect();
      clearTimeout(timer);
      controller.abort();
    };
  }, [attempt]);

  const moveTab = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % steps.length;
    else if (event.key === "ArrowLeft")
      next = (index + steps.length - 1) % steps.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = steps.length - 1;
    else return;
    event.preventDefault();
    setSelected(next);
    document.getElementById(`proof-tab-${next}`)?.focus();
  };
  const step =
    selected === 0
      ? {
          label: "Sisa tagihan yang diakui pembeli",
          amount: proof.acceptedOutstanding,
          caption:
            "Invoice dan ketentuan telah didaftarkan setelah review dan persetujuan pemasok serta pembeli.",
          link: proof.transactions.registered,
          linkText: "Lihat persetujuan terdaftar",
        }
      : selected === 1
        ? {
            label: "Modal lebih awal untuk pemasok",
            amount: proof.principal,
            caption:
              "Dana dikirim ke pemasok. Pembeli tetap membayar invoice sesuai ketentuan yang disepakati.",
            link: proof.transactions.funded,
            linkText: "Lihat bukti pendanaan",
          }
        : {
            label: "Pembayaran diterima dari pembeli",
            amount: proof.buyerPayment,
            caption:
              "Pembayaran dialokasikan ke pokok pendanaan, biaya pendanaan, lalu sisa hak pemasok.",
            link: proof.transactions.paid,
            linkText: "Lihat bukti pembayaran",
          };

  return (
    <div className="landing-deal" ref={ref}>
      <div className="landing-deal-header">
        <div>
          <span className="landing-deal-caption">Rekam transaksi testnet</span>
          <h3>{proof.dealLabel}</h3>
        </div>
        <span className="landing-complete">
          <Check size={13} aria-hidden="true" /> Siklus selesai
        </span>
      </div>
      <div className="landing-deal-parties">
        <span>Pemasok</span>
        <ArrowRight size={15} aria-hidden="true" />
        <span>Pembeli bisnis</span>
        <time className="landing-deal-date" dateTime={proof.verifiedAt}>
          {new Intl.DateTimeFormat("id-ID", {
            day: "numeric",
            month: "short",
            year: "numeric",
            timeZone: "Asia/Jakarta",
          }).format(new Date(proof.verifiedAt))}
        </time>
      </div>
      <dl className="landing-deal-terms">
        <div>
          <dt>Sisa tagihan diakui</dt>
          <dd>{rupiah(proof.acceptedOutstanding)}</dd>
        </div>
        <div>
          <dt>Jatuh tempo</dt>
          <dd>
            <time dateTime={proof.invoiceDueAt}>
              {new Intl.DateTimeFormat("id-ID", {
                day: "numeric",
                month: "short",
                year: "numeric",
                timeZone: "Asia/Jakarta",
              }).format(new Date(proof.invoiceDueAt))}
            </time>
          </dd>
        </div>
      </dl>
      <div
        className="landing-proof-tabs"
        role="tablist"
        aria-label="Lihat tahap transaksi yang sudah tercatat"
      >
        {steps.map((label, index) => (
          <button
            type="button"
            role="tab"
            id={`proof-tab-${index}`}
            aria-controls="proof-panel"
            aria-selected={selected === index}
            tabIndex={selected === index ? 0 : -1}
            key={label}
            onClick={() => setSelected(index)}
            onKeyDown={(event) => moveTab(event, index)}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        id="proof-panel"
        role="tabpanel"
        aria-labelledby={`proof-tab-${selected}`}
        tabIndex={0}
        className="landing-proof-panel"
      >
        <p className="landing-amount-label">{step.label}</p>
        <p className="landing-proof-amount" key={selected}>
          {rupiah(step.amount)}
        </p>
        <p className="landing-proof-caption">{step.caption}</p>
        <a
          className="landing-text-link"
          href={step.link}
          target="_blank"
          rel="noopener noreferrer"
        >
          {step.linkText}
          <ArrowUpRight size={15} aria-hidden="true" />
          <span className="sr-only"> (tab baru)</span>
        </a>
      </div>
      <section
        className="landing-allocation"
        aria-labelledby="allocation-title"
      >
        <h4 id="allocation-title" className="landing-allocation-heading">
          Biaya tetap {proof.feePercent.toLocaleString("id-ID")}% dan pembagian
          dana
        </h4>
        <dl>
          <div>
            <dt>Invoice awal</dt>
            <dd>{rupiah(proof.invoiceOriginalAmount)}</dd>
          </div>
          <div className="landing-invoice-prior">
            <dt>Sudah dibayar sebelumnya</dt>
            <dd>{rupiah(proof.previouslyPaidAmount)}</dd>
          </div>
          <div>
            <dt>Pokok untuk pendana</dt>
            <dd>{rupiah(proof.principal)}</dd>
          </div>
          <div>
            <dt>Biaya tetap ({proof.feePercent.toLocaleString("id-ID")}%)</dt>
            <dd>{rupiah(proof.fee)}</dd>
          </div>
          <div className="landing-allocation-total">
            <dt>Total hak pendana</dt>
            <dd>
              <a
                href={proof.transactions.lender}
                target="_blank"
                rel="noopener noreferrer"
              >
                {rupiah(proof.lenderReceives)}
                <ArrowUpRight size={13} aria-hidden="true" />
                <span className="sr-only">
                  , lihat transaksi hak pendana (tab baru)
                </span>
              </a>
            </dd>
          </div>
          <div>
            <dt>Sisa untuk pemasok</dt>
            <dd>
              <a
                href={proof.transactions.supplier}
                target="_blank"
                rel="noopener noreferrer"
              >
                {rupiah(proof.supplierResidual)}
                <ArrowUpRight size={13} aria-hidden="true" />
                <span className="sr-only">
                  , lihat transaksi sisa pemasok (tab baru)
                </span>
              </a>
            </dd>
          </div>
        </dl>
      </section>
      <div className="landing-network-read" aria-live="polite">
        {network === "loading" ? (
          <span>Memeriksa ringkasan jaringan…</span>
        ) : network === "confirmed" ? (
          <span>
            <Check size={13} aria-hidden="true" /> Hak pendana terpenuhi, sesuai
            data jaringan.
          </span>
        ) : (
          <>
            <span>
              {network === "changed"
                ? "Data jaringan berbeda. Periksa bukti transaksi."
                : "Pembaruan jaringan belum tersedia. Rekam transaksi tetap dapat diperiksa."}
            </span>
            <button
              type="button"
              onClick={() => {
                setNetwork("loading");
                setAttempt((value) => value + 1);
              }}
              aria-label="Periksa ulang data jaringan"
            >
              <RefreshCw size={15} aria-hidden="true" />
            </button>
          </>
        )}
      </div>
      <p className="landing-synthetic-note">
        Nominal simulasi dalam IDRT (MockIDR), tanpa nilai uang nyata.
      </p>
      <noscript>
        <style>
          {".landing-network-read, .landing-proof-tabs { display: none; }"}
        </style>
      </noscript>
    </div>
  );
}
