# Satu case gula kelapa Talunai

Rencana ini ditulis setelah inspeksi repository dan riset sumber publik, sebelum implementasi tooling case. Tidak membuat pitch deck atau video baru.

## Produk yang menjadi sumber kebenaran

| Bagian          | Implementasi yang ditemukan                                                                                                 | Keputusan case                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| UI              | Next.js App Router; deal summary, evidence, terms, payments, activity; workspace per role                                   | Capture halaman aplikasi yang tersedia, tanpa redesain                                                      |
| Auth/RBAC       | SIWE, cookie sesi, CSRF, idempotency; role + organisasi + hubungan deal                                                     | Login wallet asli, onboarding dan persetujuan admin melalui API                                             |
| Organisasi      | Organisasi synthetic approved; otoritas peserta terikat ke satu wallet                                                      | Buat supplier/buyer/lender khusus case, tidak mengganti nama organisasi lama                                |
| Agent           | Worker terpisah, pg-boss/outbox; PDF parsing; OpenRouter structured extraction; provenance dan pemeriksaan deterministik    | Wajib live, tidak ada fallback mock; simpan hasil aktual                                                    |
| Core extraction | Nama, invoice, tanggal, nominal awal/net, barang, quantity, unit, PO, bukti delivery/ack                                    | Pakai schema yang ada; payment terms diperiksa tambahan di tooling, tanpa mengubah terms finansial          |
| Approval        | Review verifikator mengubah versi dan mengikat decisionHash; consent memerlukan review versi terkini                        | Review dahulu, lalu tanda tangan supplier dan buyer. Bukti penerimaan buyer tersedia sebelum agent berjalan |
| Kontrak         | RWARegistry, FinancingVault, AgentExecutor, MockIDR; satu funding; buyer-only collection; recipient tetap                   | Pakai deployment chain 97 yang dikonfigurasi; tidak redeploy atau mengaku IDRT mainnet                      |
| Money           | Pokok dikirim ke borrower; koleksi dialokasikan lender dahulu sampai principal+fee, residual ke borrower; withdraw terpisah | Rp100M → Rp70M sekarang; Rp71,05M lender; Rp28,95M residual                                                 |
| Canonical state | Confirmations, indexer, transaction intents dan event reconciliation                                                        | Receipt sukses saja belum cukup; tunggu projection dan cek block hash                                       |
| Fixture lama    | Kakao Rp120M, dibayar Rp20M, outstanding Rp100M; completed pool case                                                        | Tetap historis. Case baru invoice Rp100M, belum dibayar, outstanding Rp100M; jangan mencampurkan keduanya   |
| Browser         | Playwright + wallet injection untuk SIWE/consent; helper lama menolak broadcasts                                            | Capture asli; transaksi scripted melalui API intent dan wallet viem. Tidak membuat popup wallet palsu       |

Rujukan kode: `scripts/demo-lib.ts:17`, `packages/api/claims.ts:121`, `packages/api/actions.ts:58`, `packages/agents/process.ts:31`, `packages/domain/evidence.ts:49`, `contracts/src/FinancingVault.sol:57`, `tests/ui.browser.ts:39`, `video/scripts/capture-product.mts:47`.

## Cerita dan batas klaim

Konteks publik: Unilever Indonesia melaporkan pemasok lokal, gula kelapa, dan mekanisme pembayaran supplier lebih awal melalui SCF. Detail sumber berada di `research.json`.

Transaksi demo: supplier fiktif menjual 4.000 kg gula kelapa cetak pada Rp25.000/kg. Ini asumsi komersial, bukan data order Unilever. Seluruh PDF diberi `SIMULASI DEMO — BUKAN TRANSAKSI NYATA`, tanpa logo atau tanda tangan resmi Unilever. Organisasi buyer juga menyebut simulasi.

Tempo 45 hari adalah asumsi. Settlement demo dipercepat; kontrak mendukung pembayaran sebelum tanggal jatuh tempo. MockIDR tidak bernilai uang nyata. Pembiayaan bersifat direct lender, bukan Pool A; economics pool dan APY tidak dicampurkan ke case ini.

## Implementasi

1. Satu `spec.json` menjadi sumber nominal, kuantitas, economics dan disclosure.
2. Generate invoice PDF, delivery note PDF, acknowledgement PDF; semua punya teks yang dapat diparse oleh parser produk.
3. Generate tiga wallet case secara lokal dengan private key di `.local/`, mode 0600. Gunakan admin dan verifier testnet yang sudah dikonfigurasi. Jangan menaruh key pada artifact publik.
4. Prepare menjalankan/mengecek layanan lokal, memvalidasi chain/token/provider, membuat organisasi lewat admin API, dan mengaktifkan peserta lewat access request + admin review. Topup hanya aset uji untuk case.
5. Run membuat deal, upload PDF, menjalankan agent live, memeriksa extraction dan provenance, melakukan review manusia yang diotorisasi, consent para pihak, registrasi, funding, collection, dan dua withdrawal.
6. Transaction journal ditulis sebelum broadcast dan dapat dilanjutkan. Re-run tidak mereset DB, tidak menggandakan invoice, dan tidak mengganti hash yang tidak diketahui dengan hash fiktif.
7. Playwright mengambil state nyata per tahap. Nominal, font, layout, loading dan error diperiksa sebelum screenshot diterima.
8. Summary JSON/Markdown, truth manifest, agent output, audit dan transaction receipts menyatakan status eksekusi yang sebenarnya. Field transaksi tetap kosong bila belum dijalankan.

## Acceptance

- PDF dapat diparse dengan parser Talunai; seluruh field finansial dan komersial cocok.
- Agent run live COMPLETED, provider OpenRouter, tanpa conflict material. Jika gagal, flow berhenti sebelum uang bergerak.
- Consent supplier/buyer berlaku pada versi reviewed yang sama.
- Registrasi/funding/payment/withdraw receipt canonical dan projection sesuai.
- Funding masuk supplier tepat Rp70M; collection Rp100M; entitlement Rp71,05M/Rp28,95M; final claimable nol setelah kedua withdrawal.
- Tidak ada bypass RBAC, penulisan state deal langsung, mock provider, atau data runtime sintetis yang dilabeli actual.
- Capture dan summary dapat direproduksi dengan perintah yang didokumentasikan.
