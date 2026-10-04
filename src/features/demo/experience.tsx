"use client";

import { useEffect, useReducer, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  FileText,
  Pause,
  Play,
  RotateCcw,
  ScanLine,
  CircleHelp,
  LoaderCircle,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/page-header";
import {
  DetailFacts,
  NextActionSurface,
  SectionTitle,
} from "@/features/claims/presentation";
import {
  caseDate,
  rupiah,
  transactionUrl,
  type DemoCase,
  type DemoTransaction,
} from "./case";
import {
  beats,
  steps,
  initialReplay,
  replayReducer,
  replayFacts,
  replayHash,
  cursorFromHash,
} from "./replay";

function TransactionLink({
  data,
  name,
  children,
}: {
  data: DemoCase;
  name: DemoTransaction;
  children: React.ReactNode;
}) {
  return (
    <a
      className="demo-proof-link"
      href={transactionUrl(data, name)}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
      <ArrowUpRight size={14} aria-hidden="true" />
      <span className="sr-only"> — contoh transaksi testnet, tab baru</span>
    </a>
  );
}
function DocumentLink({ data, index }: { data: DemoCase; index: number }) {
  const doc = data.documents[index];
  return (
    <a
      className="demo-document-link"
      href={doc.url}
      target="_blank"
      rel="noopener noreferrer"
    >
      <FileText size={18} aria-hidden="true" />
      <span>
        {doc.title}
        <small>PDF dari case ini</small>
      </span>
      <ArrowUpRight size={15} aria-hidden="true" />
      <span className="sr-only">Buka PDF, tab baru</span>
    </a>
  );
}
function Checks({ data, count }: { data: DemoCase; count: number }) {
  return (
    <ol className="demo-checks">
      {data.agent.checks.map((check, index) => (
        <li key={check.field} data-complete={index < count}>
          <span className="demo-check-marker" aria-hidden="true">
            {index < count ? (
              <Check size={16} />
            ) : index === count ? (
              <ScanLine size={16} />
            ) : (
              <span className="demo-check-dot" />
            )}
          </span>
          <span>
            <strong>{check.label}</strong>
            <small>
              {index < count
                ? check.detail
                : index === count
                  ? "Sedang diperiksa…"
                  : "Menunggu pemeriksaan"}
            </small>
          </span>
          <span className="sr-only">
            {index < count ? "Cocok" : "Belum selesai"}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function GuidedDemo({ data }: { data: DemoCase }) {
  const [state, dispatch] = useReducer(replayReducer, initialReplay);
  const [ready, markReady] = useReducer(() => true, false);
  const currentStepButton = useRef<HTMLButtonElement>(null);
  const beat = beats[state.cursor],
    step = steps[beat.step],
    facts = replayFacts(state.cursor),
    d = data.deal;
  const active = state.playing || state.performing;
  useEffect(() => {
    const restore = () =>
      dispatch({
        type: "restore",
        cursor: cursorFromHash(window.location.hash),
      });
    restore();
    // A public replay is resumable by URL and does not read any wallet/session storage.
    markReady();
    window.addEventListener("hashchange", restore);
    const pause = () => {
      if (document.hidden) dispatch({ type: "pause" });
    };
    document.addEventListener("visibilitychange", pause);
    return () => {
      window.removeEventListener("hashchange", restore);
      document.removeEventListener("visibilitychange", pause);
    };
  }, []);
  useEffect(() => {
    if (ready)
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${replayHash(state.cursor)}`,
      );
  }, [ready, state.cursor]);
  useEffect(() => {
    if (!active) return;
    // Full dwell on resume; background tabs pause rather than skipping unread steps.
    const timer = window.setTimeout(
      () => dispatch({ type: "tick" }),
      beat.duration,
    );
    return () => window.clearTimeout(timer);
  }, [active, beat.duration, state.cursor]);
  useEffect(() => {
    if (!ready) return;
    const el = currentStepButton.current;
    if (el && window.innerWidth < 1000) {
      const scroller = el.closest("nav");
      scroller?.scrollTo({
        left: el.offsetLeft - scroller.offsetLeft - 12,
        behavior: "instant",
      });
    }
  }, [beat.step, ready]);

  const role =
    beat.step === 4 && facts.funded
      ? "Supplier"
      : beat.step === 6 && beat.phase === 1
        ? "Supplier"
        : step.role;
  const nextTitle = [
    "Menunggu konfirmasi buyer",
    facts.buyerAcknowledged ? "Pengakuan buyer tersedia" : "Konfirmasi invoice",
    facts.checksCompleted
      ? "Hasil siap ditinjau verifikator"
      : "Memeriksa dokumen",
    facts.reviewed ? "Deal siap didanai" : "Tinjau bukti dan ketentuan",
    facts.funded
      ? "Dana diterima pemasok"
      : facts.pending
        ? "Mengonfirmasi transaksi…"
        : `Danai ${rupiah(d.principal)}`,
    facts.paid
      ? "Pembayaran dikonfirmasi"
      : facts.pending
        ? "Mengonfirmasi pembayaran…"
        : "Bayar invoice",
    facts.completed
      ? "Deal selesai"
      : facts.lenderWithdrawn
        ? "Tarik sisa invoice"
        : "Tarik hak pendana",
  ][beat.step];
  const descriptions = [
    "Barang sudah terkirim. Invoice dan bukti pengiriman telah diajukan.",
    facts.buyerAcknowledged
      ? "Dokumen pengakuan buyer menjadi bagian bukti yang akan diperiksa."
      : "Periksa pemasok, nilai tagihan, dan tanggal jatuh tempo.",
    "Agent membantu pemeriksaan; keputusan pendanaan tetap membutuhkan review manusia.",
    facts.reviewed
      ? "Review selesai, supplier dan buyer menyetujui ketentuan yang sama."
      : "Baca hasil agent dan bukti sebelum menyetujui deal.",
    facts.funded
      ? "Modal tersedia sebelum invoice jatuh tempo."
      : "Biaya tetap disepakati di awal. Pendana menanggung risiko buyer tidak membayar.",
    facts.paid
      ? "Dana sudah dialokasikan dan tersedia untuk ditarik oleh penerimanya."
      : `Tempo invoice ${d.paymentTermDays} hari. Pembayaran testnet dipercepat dalam demonstrasi ini.`,
    facts.completed
      ? "Invoice tertagih penuh. Hak pendana dan sisa pemasok sudah ditarik."
      : "Hak pembayaran sudah terbentuk. Masing-masing pihak menarik saldonya sendiri.",
  ][beat.step];
  const actionLabel = [
    "Lihat konfirmasi buyer",
    facts.buyerAcknowledged ? "Mulai pemeriksaan" : "Konfirmasi invoice",
    facts.checksCompleted
      ? "Lanjut ke review"
      : active
        ? "Pemeriksaan berjalan"
        : "Lanjutkan pemeriksaan",
    facts.reviewed ? "Lihat pendanaan" : "Setujui deal",
    facts.funded
      ? "Lihat pembayaran buyer"
      : facts.pending
        ? "Menunggu konfirmasi"
        : `Danai ${rupiah(d.principal)}`,
    facts.paid
      ? "Lihat pembagian dana"
      : facts.pending
        ? "Menunggu konfirmasi"
        : "Bayar invoice",
    facts.completed
      ? "Ulangi demo"
      : facts.lenderWithdrawn
        ? "Tarik sisa pemasok"
        : "Tarik hak pendana",
  ][beat.step];
  const onAction = () => {
    if (facts.completed) dispatch({ type: "restart" });
    else if (beat.step === 2 && !facts.checksCompleted)
      dispatch({ type: "play" });
    else dispatch({ type: "action" });
  };
  const activities = [
    { done: true, label: "Invoice dan bukti diajukan" },
    { done: facts.buyerAcknowledged, label: "Pengakuan buyer tersedia" },
    { done: facts.checksCompleted, label: "Pemeriksaan agent selesai" },
    { done: facts.reviewed, label: "Verifikator menyetujui deal" },
    { done: facts.signed, label: "Ketentuan para pihak disepakati" },
    { done: facts.funded, label: "Pendanaan diterima pemasok" },
    { done: facts.paid, label: "Invoice dibayar penuh" },
    { done: facts.lenderWithdrawn, label: "Hak pendana ditarik" },
    { done: facts.supplierWithdrawn, label: "Sisa pemasok ditarik" },
  ];
  const panelTitle = [
    "Detail invoice",
    "Pengakuan buyer",
    "Pemeriksaan deal",
    "Review & persetujuan",
    facts.funded ? "Penerimaan modal" : "Ketentuan pendanaan",
    "Pembayaran invoice",
    facts.completed ? "Ringkasan penyelesaian" : "Dana tersedia untuk ditarik",
  ][beat.step];
  const status = facts.completed
    ? "COMPLETED"
    : facts.paid
      ? "FULLY_COLLECTED"
      : facts.funded
        ? "FUNDED"
        : facts.pending
          ? "MINED"
          : facts.registered
            ? "AVAILABLE"
            : beat.workflow;
  return (
    <div className="guided-demo">
      <a href="#demo-deal" className="skip-link">
        Lewati ke Deal
      </a>
      <header className="demo-topbar">
        <Link href="/" aria-label="Talunai, beranda">
          <Brand />
        </Link>
        <span className="demo-mode">Mode Demo</span>
        <Link
          href="/app"
          prefetch={false}
          className={buttonVariants({ variant: "outline" })}
        >
          Buka Aplikasi
          <ArrowUpRight size={15} aria-hidden="true" />
        </Link>
      </header>
      <div className="demo-layout">
        <aside className="demo-guide">
          <div className="demo-guide-title">
            <p className="text-kicker">Demo produk</p>
            <h2>
              Satu invoice.
              <br />
              Sampai selesai.
            </h2>
            <p>Ikuti alur modal, dari pengajuan hingga pembagian dana.</p>
          </div>
          <nav className="demo-steps" aria-label="Tahap demo">
            <ol>
              {steps.map((s, i) => (
                <li key={s.id}>
                  <button
                    ref={i === beat.step ? currentStepButton : undefined}
                    aria-current={i === beat.step ? "step" : undefined}
                    onClick={() => dispatch({ type: "goto", step: i })}
                  >
                    <span className="demo-step-number">
                      {i < beat.step || facts.completed ? (
                        <Check size={14} aria-hidden="true" />
                      ) : (
                        String(i + 1).padStart(2, "0")
                      )}
                    </span>
                    <span>{s.label}</span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          <div className="demo-guide-bottom">
            <Image src="/brand/bnb-symbol.svg" width={18} height={18} alt="" />
            <span>BNB Chain Testnet</span>
            <p>Rekam case {caseDate(data.recordedAt)}</p>
          </div>
        </aside>
        <main id="demo-deal" className="demo-main" tabIndex={-1}>
          <div className="demo-step-heading">
            <div>
              <p className="text-kicker">
                Langkah {beat.step + 1} dari {steps.length}
              </p>
              <h2>{step.title}</h2>
            </div>
            <Button
              variant="outline"
              className="demo-play"
              onClick={() => dispatch({ type: active ? "pause" : "play" })}
            >
              {active ? (
                <Pause size={15} aria-hidden="true" />
              ) : (
                <Play size={15} aria-hidden="true" />
              )}
              {active ? "Jeda" : "Putar Otomatis"}
            </Button>
          </div>
          <section
            className="demo-deal surface"
            aria-label="Deal simulasi Talunai"
            data-testid="demo-deal"
            data-step={beat.step}
            data-phase={beat.phase}
            data-workflow={beat.workflow}
          >
            <div className="demo-deal-heading">
              <div className="demo-deal-eyebrow">
                <span>DEAL {d.id.slice(0, 8).toUpperCase()}</span>
                <span className="demo-role">
                  Melihat sebagai <strong>{role}</strong>
                </span>
              </div>
              <PageHeader
                title={d.invoiceNumber}
                description={
                  <span>
                    {d.supplier}
                    <span className="demo-party-arrow" aria-hidden="true">
                      →
                    </span>
                    <span className="sr-only"> kepada </span>
                    {d.buyer}
                  </span>
                }
                actions={<StatusBadge status={status} />}
              />
              <div className="demo-token">
                <Image src="/idrt-logo.svg" width={17} height={17} alt="" />
                <span>{data.network.displayToken}</span>
                <span>·</span>
                <span>{d.product}</span>
              </div>
            </div>
            <dl className="demo-money-strip">
              <div>
                <dt>Nilai invoice</dt>
                <dd>{rupiah(d.invoiceAmount)}</dd>
              </div>
              <div>
                <dt>{facts.funded ? "Modal diterima" : "Pendanaan diminta"}</dt>
                <dd className={facts.funded ? "demo-value-confirmed" : ""}>
                  {rupiah(d.principal)}
                  {facts.funded && <Check size={15} aria-label="Diterima" />}
                </dd>
              </div>
              <div>
                <dt>Biaya tetap {(d.feeBps / 100).toLocaleString("id-ID")}%</dt>
                <dd>{rupiah(d.fee)}</dd>
              </div>
              <div>
                <dt>Jatuh tempo · {d.paymentTermDays} hari</dt>
                <dd>{caseDate(d.dueDate)}</dd>
              </div>
            </dl>
            <div className="demo-next" aria-live="polite" aria-atomic="true">
              <NextActionSurface
                title={nextTitle}
                description={descriptions}
                action={
                  <Button
                    disabled={
                      facts.pending ||
                      (beat.step === 2 && active && !facts.checksCompleted)
                    }
                    onClick={onAction}
                  >
                    {facts.pending ? (
                      <LoaderCircle
                        className="demo-spinner"
                        size={16}
                        aria-hidden="true"
                      />
                    ) : null}
                    {actionLabel}
                    {!facts.pending && (
                      <ArrowRight size={15} aria-hidden="true" />
                    )}
                  </Button>
                }
              />
            </div>
            <div className="demo-product-grid">
              <section
                className="demo-stage-panel"
                key={beat.step}
                aria-label={panelTitle}
              >
                <SectionTitle title={panelTitle} />
                {beat.step === 0 && (
                  <div className="demo-invoice-layout">
                    <a
                      href={data.documents[0].url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="demo-invoice-preview"
                    >
                      <Image
                        src="/demo/coconut-sugar/invoice-preview.webp"
                        loading="eager"
                        width={778}
                        height={1100}
                        alt="Invoice simulasi asli case gula kelapa. Buka PDF untuk membaca dokumen lengkap."
                      />
                      <span>
                        Lihat invoice PDF
                        <ArrowUpRight size={13} aria-hidden="true" />
                      </span>
                    </a>
                    <div>
                      <DetailFacts
                        items={[
                          {
                            label: "Barang",
                            value: `${d.product} · ${BigInt(d.quantity).toLocaleString("id-ID")} ${d.unit}`,
                          },
                          {
                            label: "Tanggal invoice",
                            value: caseDate(d.issueDate),
                          },
                          {
                            label: "Pembayaran",
                            value: `NET ${d.paymentTermDays} hari`,
                          },
                        ]}
                      />
                      <DocumentLink data={data} index={1} />
                    </div>
                  </div>
                )}
                {beat.step === 1 && (
                  <>
                    <DetailFacts
                      items={[
                        { label: "Pemasok", value: d.supplier },
                        {
                          label: "Nilai yang diakui",
                          value: rupiah(d.invoiceAmount),
                        },
                        { label: "Jatuh tempo", value: caseDate(d.dueDate) },
                      ]}
                    />
                    <DocumentLink data={data} index={2} />
                    {facts.buyerAcknowledged && (
                      <p className="demo-success">
                        <CheckCheck size={18} aria-hidden="true" />
                        Pengakuan nilai dan jatuh tempo tersedia.
                      </p>
                    )}
                    <p className="demo-note">
                      Pengakuan dokumen diperiksa lebih dulu. Tanda tangan
                      ketentuan final mengikuti review.
                    </p>
                  </>
                )}
                {beat.step === 2 && (
                  <>
                    <div className="demo-agent-source">
                      <ScanLine size={16} aria-hidden="true" />
                      <span>
                        Hasil OpenRouter ·{" "}
                        {data.agent.model.replace("openai/", "")}
                      </span>
                      <StatusBadge
                        status={facts.checksCompleted ? "COMPLETED" : "RUNNING"}
                      />
                    </div>
                    <Checks data={data} count={beat.phase} />
                    {facts.checksCompleted && (
                      <div className="demo-review-note">
                        <CircleHelp size={17} aria-hidden="true" />
                        <span>
                          Kategori barang perlu tinjauan manual. Hasil
                          diteruskan ke verifikator.
                        </span>
                      </div>
                    )}
                    <p className="demo-note">
                      Hasil pemeriksaan tersimpan dari run{" "}
                      {caseDate(data.agent.completedAt)}.
                    </p>
                  </>
                )}
                {beat.step === 3 && (
                  <>
                    <p className="demo-review-summary">
                      Tidak ditemukan konflik pada nominal, referensi bukti, dan
                      jatuh tempo.
                    </p>
                    <div className="demo-evidence-links">
                      {data.documents.map((doc, i) => (
                        <DocumentLink key={doc.url} data={data} index={i} />
                      ))}
                    </div>
                    <DetailFacts
                      items={[
                        {
                          label: "Kategori pengajuan",
                          value: "Lainnya · gula kelapa cetak",
                        },
                        {
                          label: "Review manusia",
                          value: (
                            <StatusBadge
                              status={facts.reviewed ? "ATTESTED" : "PENDING"}
                            />
                          ),
                        },
                        {
                          label: "Ketentuan supplier & buyer",
                          value: facts.signed
                            ? `Disetujui · versi ${d.version}`
                            : "Setelah review disetujui",
                        },
                      ]}
                    />
                    {facts.registered && (
                      <TransactionLink data={data} name="registered">
                        Lihat pencatatan deal
                      </TransactionLink>
                    )}
                  </>
                )}
                {beat.step === 4 && (
                  <>
                    {facts.funded ? (
                      <div className="demo-capital">
                        <span className="demo-capital-check">
                          <Check size={24} aria-hidden="true" />
                        </span>
                        <p>Dana diterima pemasok</p>
                        <strong>{rupiah(d.principal)}</strong>
                        <span>{d.supplier}</span>
                        <TransactionLink data={data} name="funded">
                          Lihat transaksi pendanaan
                        </TransactionLink>
                      </div>
                    ) : (
                      <>
                        <DetailFacts
                          items={[
                            {
                              label: "Pokok pendanaan",
                              value: rupiah(d.principal),
                            },
                            { label: "Biaya tetap", value: rupiah(d.fee) },
                            {
                              label: "Total hak pendana",
                              value: (
                                <strong>{rupiah(d.lenderEntitlement)}</strong>
                              ),
                            },
                            { label: "Penerima modal", value: d.supplier },
                          ]}
                        />
                        <p className="demo-note">
                          Biaya {(d.feeBps / 100).toLocaleString("id-ID")}%
                          dihitung satu kali dari pokok, bukan APY.
                        </p>
                      </>
                    )}
                  </>
                )}
                {beat.step === 5 && (
                  <>
                    <div className="demo-collection">
                      <span>
                        {facts.paid
                          ? "Pembayaran terkumpul"
                          : "Invoice belum dibayar"}
                      </span>
                      <strong>
                        {rupiah(
                          facts.paid
                            ? data.financing.allocated.totalCollected
                            : d.invoiceAmount,
                        )}
                      </strong>
                      <StatusBadge
                        status={facts.paid ? "FULLY_COLLECTED" : "UNPAID"}
                      />
                    </div>
                    <DetailFacts
                      items={[
                        { label: "Pembayar", value: d.buyer },
                        {
                          label: "Tujuan",
                          value: "Kontrak pembiayaan Talunai",
                        },
                        {
                          label: "Sisa tagihan",
                          value: rupiah(
                            facts.paid
                              ? data.financing.allocated
                                  .remainingInvoiceCollection
                              : d.invoiceAmount,
                          ),
                        },
                      ]}
                    />
                    {facts.paid && (
                      <TransactionLink data={data} name="paid">
                        Lihat pembayaran buyer
                      </TransactionLink>
                    )}
                  </>
                )}
                {beat.step === 6 && (
                  <>
                    {facts.completed && (
                      <p className="demo-success">
                        <CheckCheck size={19} aria-hidden="true" />
                        Deal selesai. Seluruh saldo telah diterima.
                      </p>
                    )}
                    <div className="demo-waterfall">
                      <div className="demo-waterfall-source">
                        <span>Pembayaran buyer</span>
                        <strong>
                          {rupiah(data.financing.allocated.totalCollected)}
                        </strong>
                      </div>
                      <div className="demo-allocation">
                        <div>
                          <span>Pendana · pokok + biaya</span>
                          <strong>{rupiah(d.lenderEntitlement)}</strong>
                          <small>
                            {facts.lenderWithdrawn
                              ? "Sudah diterima"
                              : "Tersedia untuk ditarik"}
                          </small>
                          {facts.lenderWithdrawn && (
                            <TransactionLink data={data} name="lender">
                              Transaksi pendana
                            </TransactionLink>
                          )}
                        </div>
                        <div>
                          <span>Pemasok · sisa invoice</span>
                          <strong>{rupiah(d.supplierResidual)}</strong>
                          <small>
                            {facts.supplierWithdrawn
                              ? "Sudah diterima"
                              : "Tersedia untuk ditarik"}
                          </small>
                          {facts.supplierWithdrawn && (
                            <TransactionLink data={data} name="supplier">
                              Transaksi pemasok
                            </TransactionLink>
                          )}
                        </div>
                      </div>
                    </div>
                    <DetailFacts
                      items={[
                        {
                          label: "Modal pemasok lebih awal",
                          value: rupiah(d.principal),
                        },
                        {
                          label: "Saldo pendana belum ditarik",
                          value: rupiah(
                            facts.lenderWithdrawn
                              ? data.financing.completed.lenderClaimable
                              : data.financing.allocated.lenderClaimable,
                          ),
                        },
                        {
                          label: "Saldo pemasok belum ditarik",
                          value: rupiah(
                            facts.supplierWithdrawn
                              ? data.financing.completed
                                  .borrowerResidualClaimable
                              : data.financing.allocated
                                  .borrowerResidualClaimable,
                          ),
                        },
                      ]}
                    />
                  </>
                )}
              </section>
              <aside className="demo-activity" aria-label="Aktivitas deal">
                <h2>Aktivitas Deal</h2>
                <ol>
                  {activities
                    .filter((a) => a.done)
                    .map((a) => (
                      <li key={a.label}>
                        <Check size={13} aria-hidden="true" />
                        <span>{a.label}</span>
                      </li>
                    ))}
                </ol>
                <p>Satu deal. Setiap pihak tahu langkah berikutnya.</p>
              </aside>
            </div>
          </section>
          <footer className="demo-controls">
            <p>{step.explanation}</p>
            <div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Ulangi Demo"
                onClick={() => dispatch({ type: "restart" })}
              >
                <RotateCcw size={17} aria-hidden="true" />
              </Button>
              <Button
                variant="outline"
                disabled={beat.step === 0}
                onClick={() => dispatch({ type: "previous" })}
              >
                <ArrowLeft size={15} aria-hidden="true" />
                <span>Sebelumnya</span>
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  dispatch({
                    type: facts.completed
                      ? "restart"
                      : beat.step === 6
                        ? "action"
                        : "next",
                  })
                }
              >
                {facts.completed ? "Ulangi Demo" : "Lanjut"}
                <ArrowRight size={15} aria-hidden="true" />
              </Button>
            </div>
          </footer>
          <p className="demo-disclosure">
            Data transaksi disimulasikan untuk demonstrasi. Studi kasus
            berdasarkan konteks supply-chain publik; bukan transaksi nyata PT
            Unilever Indonesia Tbk. Pemasok fiktif. IDRT uji adalah MockIDR
            tanpa nilai uang nyata.{" "}
            <span>
              Rekam transaksi testnet yang sudah selesai; interaksi demo tidak
              memindahkan dana.
            </span>
          </p>
          <noscript>
            Aktifkan JavaScript untuk mengikuti demo interaktif. Invoice tetap
            dapat dibuka dari tautan PDF.
          </noscript>
        </main>
      </div>
    </div>
  );
}
