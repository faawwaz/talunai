import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check, FileCheck2 } from "lucide-react";
import { Brand } from "@/components/brand";
import { LandingMotion, LandingNav } from "./interactions";
import { ProductPreview } from "./product-preview";
import { ChecksPreview } from "./checks-preview";
import { NextActionPreview } from "./next-action-preview";
import { landingEvidence } from "./evidence";
import "./landing.css";

function AppLink({
  children = "Buka Aplikasi",
}: {
  children?: React.ReactNode;
}) {
  return (
    <Link
      href="/app"
      prefetch={false}
      className="landing-button landing-button-primary"
    >
      {children}
      <ArrowUpRight size={18} aria-hidden="true" />
    </Link>
  );
}

export function LandingPage({ className }: { className: string }) {
  return (
    <div id="landing" className={`landing ${className}`}>
      <div
        id="landing-top"
        className="landing-top-sentinel"
        aria-hidden="true"
      />
      <a href="#konten" className="skip-link">
        Lewati ke konten
      </a>
      <LandingNav />
      <main id="konten" tabIndex={-1}>
        <section
          className="landing-container landing-hero"
          aria-labelledby="hero-title"
        >
          <div className="landing-hero-copy">
            <p className="landing-eyebrow">Pembiayaan invoice B2B</p>
            <h1 id="hero-title">
              Tagihan belum cair.
              <br />
              <span>Usaha tetap berjalan.</span>
            </h1>
            <p className="landing-hero-description">
              Invoice diakui pembeli, bukti ditinjau, pendana menyediakan modal
              lebih awal. Pembayaran mengikuti ketentuan yang disepakati.
            </p>
            <div className="landing-hero-actions">
              <AppLink />
              <a
                href="#cara-kerja"
                className="landing-button landing-button-secondary"
              >
                Lihat Cara Kerja
                <ArrowRight size={17} aria-hidden="true" />
              </a>
            </div>
            <div className="landing-hero-network">
              <Image
                src="/brand/bnb-symbol.svg"
                alt=""
                width={19}
                height={19}
              />
              <span>BNB Chain Testnet</span>
              <span className="landing-network-divider" aria-hidden="true" />
              <a
                href="#aset-settlement"
                className="landing-network-asset"
                aria-describedby="aset-settlement"
              >
                <Image src="/idrt-logo.svg" alt="" width={19} height={19} />
                <span>IDRT</span>
              </a>
            </div>
          </div>
          <div className="landing-hero-art">
            <div className="landing-hero-object">
              <Image
                src="/landing/invoice-flow.webp"
                alt=""
                width={1280}
                height={1280}
                sizes="(max-width: 767px) 92vw, (max-width: 1023px) 560px, 48vw"
                loading="eager"
                fetchPriority="high"
                className="landing-invoice-image"
              />
            </div>
            <div className="landing-art-label landing-art-label-invoice">
              <FileCheck2 size={17} aria-hidden="true" />
              <span>Invoice diakui</span>
            </div>
            <div className="landing-art-label landing-art-label-capital">
              <span className="landing-art-check">
                <Check size={13} aria-hidden="true" />
              </span>
              <span>Modal lebih awal</span>
            </div>
            <p className="landing-art-caption">
              Invoice yang diakui menjadi modal usaha.
            </p>
          </div>
        </section>

        <section
          id="produk"
          tabIndex={-1}
          className="landing-product-section"
          aria-labelledby="product-title"
        >
          <div className="landing-container landing-product-grid" data-reveal>
            <div className="landing-product-copy">
              <h2 id="product-title">
                Invoice belum cair.
                <br />
                Modal bisa bergerak.
              </h2>
              <p>
                Setelah dikonfirmasi pembeli dan selesai ditinjau, invoice
                menjadi deal yang bisa didanai. Nilai, biaya, dan pembagian
                pembayaran terlihat jelas.
              </p>
              <div className="landing-audiences">
                <div>
                  <h3>Untuk bisnis</h3>
                  <p>
                    Akses sebagian nilai invoice lebih awal untuk melanjutkan
                    kegiatan usaha.
                  </p>
                </div>
                <div>
                  <h3>Untuk pendana</h3>
                  <p>
                    Tinjau invoice dan biaya pendanaan sebelum memilih deal.
                    Risiko keterlambatan dan gagal bayar tetap ada.
                  </p>
                </div>
              </div>
              <a href="/app/explore" className="landing-text-link">
                Lihat data di aplikasi
                <ArrowUpRight size={17} aria-hidden="true" />
              </a>
            </div>
            <ProductPreview />
          </div>
        </section>

        <section
          className="landing-container landing-checks"
          aria-labelledby="checks-title"
          data-reveal
        >
          <ChecksPreview />
          <div className="landing-checks-copy">
            <h2 id="checks-title">
              Bukti diperiksa.
              <span>Keputusan tetap di tangan manusia.</span>
            </h2>
            <p>
              Agent mencocokkan invoice dan bukti pengiriman, lalu menandai
              perbedaan untuk ditinjau verifikator.
            </p>
            <p className="landing-checks-secondary">
              Pendanaan dibuka setelah review dan persetujuan para pihak.
            </p>
          </div>
        </section>

        <section
          id="cara-kerja"
          tabIndex={-1}
          className="landing-container landing-process"
          aria-labelledby="process-title"
        >
          <div className="landing-section-heading" data-reveal>
            <h2 id="process-title">
              Satu deal.
              <br />
              Langkah berikutnya jelas.
            </h2>
            <p>
              Pemasok, pembeli, verifikator, dan pendana melihat tindakan yang
              relevan bagi mereka. Satu alur, dari invoice hingga pembayaran.
            </p>
          </div>
          <div data-reveal>
            <NextActionPreview />
          </div>
        </section>

        <section
          id="teknologi"
          tabIndex={-1}
          className="landing-chain"
          aria-labelledby="chain-title"
        >
          <div className="landing-container" data-reveal>
            <div className="landing-chain-brand">
              <Image
                src="/brand/bnb-chain.svg"
                alt="BNB Chain"
                width={319}
                height={56}
              />
              <span>Berjalan di jaringan testnet</span>
            </div>
            <div className="landing-section-heading">
              <h2 id="chain-title">
                Aturan transaksi
                <br />
                yang bisa diperiksa.
              </h2>
              <p>
                Blockchain mencatat aliran dana dan menjalankan pembagian
                pembayaran sesuai ketentuan deal.
              </p>
            </div>
            <div className="landing-chain-rules">
              <div>
                <h3>Ketentuan terkunci</h3>
                <p>
                  Nilai, penerima, dan jatuh tempo mengikuti kesepakatan yang
                  ditandatangani.
                </p>
              </div>
              <div>
                <h3>Satu kali pendanaan</h3>
                <p>Kontrak mencegah deal yang sama didanai dua kali.</p>
              </div>
              <div>
                <h3>Pembayaran terarah</h3>
                <p>
                  Dana dialokasikan ke pokok, biaya pendanaan, lalu sisa hak
                  pemasok.
                </p>
              </div>
            </div>
            <a
              className="landing-text-link"
              href={landingEvidence.transactions.paid}
              target="_blank"
              rel="noopener noreferrer"
            >
              Periksa transaksi di BscScan
              <ArrowUpRight size={17} aria-hidden="true" />
              <span className="sr-only"> (tab baru)</span>
            </a>
          </div>
        </section>

        <section
          className="landing-container landing-final"
          aria-labelledby="final-title"
          data-reveal
        >
          <div>
            <h2 id="final-title">
              Invoice punya jatuh tempo.
              <br />
              Usaha punya langkah berikutnya.
            </h2>
            <p>Lihat bagaimana pembiayaan invoice bekerja di Talunai.</p>
          </div>
          <AppLink />
        </section>
      </main>
      <footer className="landing-footer">
        <div className="landing-container">
          <div className="landing-footer-top">
            <div>
              <Link href="/" aria-label="Talunai, beranda">
                <Brand />
              </Link>
              <p>Pembiayaan invoice B2B yang lebih transparan.</p>
            </div>
            <nav aria-label="Navigasi footer">
              <a href="#produk">Produk</a>
              <a href="#cara-kerja">Cara Kerja</a>
              <a href="#teknologi">Teknologi</a>
              <Link href="/app" prefetch={false}>
                Buka Aplikasi
                <ArrowUpRight size={14} aria-hidden="true" />
              </Link>
            </nav>
          </div>
          <div className="landing-footer-bottom">
            <span>© 2026 Talunai</span>
            <p id="aset-settlement" tabIndex={-1}>
              Versi uji di BNB Chain Testnet. Untuk MVP ini, label IDRT merujuk
              pada MockIDR (aset simulasi tanpa nilai uang nyata).
            </p>
          </div>
        </div>
      </footer>
      <LandingMotion />
    </div>
  );
}
