# Matriks fitur workspace per peran

Diperbarui 29 September 2026. Semua tindakan memakai sesi wallet dan API yang melakukan otorisasi objek. Memilih workspace hanya mengubah konteks tampilan; tidak memberikan membership atau role onchain.

## Ruang kerja

| Workspace | Pekerjaan utama | Data dan prasyarat |
|---|---|---|
| `/borrower` | Mengajukan piutang, melengkapi bukti, consent, memantau pencairan dan menarik residual | Organisasi issuer dan wallet borrower harus cocok dengan claim |
| `/buyer` | Meninjau invoice, consent pengakuan, membayar collection sebagian/penuh | Organisasi buyer dan wallet buyer immutable harus cocok; consent setelah review manusia, collection setelah funding |
| `/lender` | Menilai bukti/ketentuan, izin token terbatas, funding atomik, menarik hak lender | Akses claim dari backend; allowlist lender diperiksa kontrak; hanya lender yang mendanai dapat withdraw |
| `/verifier` | Antrean review, membaca sumber, approve/reject, register, menyelesaikan dispute dan clear hold | Verifier independen dari organisasi issuer/buyer; transaksi ditandatangani wallet verifier |
| `/admin` | Aktivasi akses organisasi dan pemantauan | Admin tidak mendapat tombol persetujuan peserta atau verifier hanya karena berstatus admin |
| `/agent` | Operasional worker dan run | Dashboard operasional terpisah; bukan wallet peserta dan bukan pemilik hak pembiayaan |

Beranda per peran menggunakan claim dan review task yang benar-benar tersimpan. Ringkasan memuat maksimal 12 claim terbaru dan 8 task per halaman; bukan agregasi keseluruhan portofolio. Backend menyeleksi akses dengan gabungan membership aktor. Beranda borrower/buyer mempersempit tampilan kembali berdasarkan organisasi peran tersebut. Lender tidak menjadi eligible hanya karena claim muncul pada daftar.

## Alur claim yang tersedia

| Fitur | Peran UI | Endpoint/tindakan | Batas penting |
|---|---|---|---|
| Buat invoice B2B + kategori/rincian barang | Borrower | `POST /v1/claims` | Nominal integer string; issuer/buyer/lender dari organisasi disetujui; COCOA/PACKAGING fixture, OTHER memerlukan review |
| Edit ketentuan sebelum registrasi | Borrower | `PATCH /v1/claims/:id` | expectedVersion; review dan consent lama dibatalkan |
| Upload privat + retry | Borrower | `POST /v1/claims/:id/documents` | PDF teks/TXT/JSON, batas ukuran; input gagal tidak dianggap tersimpan |
| Unduh dokumen dan lihat sumber ekstraksi | Pihak berwenang pada claim | `/documents/:id`, `/claims/:id/evidence` | Nilai, rawText, document ID, halaman/baris; riwayat versi diberi label |
| Mulai analisis + pantau progres | Borrower/Verifier | `/claims/:id/analyze`, `/agent-runs/:id` | Worker persisten; mock/live dan hasil/error run nyata |
| Approve/reject + attestation manual spesifik | Verifier | `/claims/:id/review` | Pilih bukti dan alasan; attestation opt-in, tidak melewati konflik material atau policy gates |
| Consent borrower/buyer | Masing-masing signer | `/consents/prepare`, `/consents` | Review manusia aktif lebih dahulu; exact typed data; nonce dan expiry; catatan offchain dibedakan dari validitas nonce onchain; persetujuan baru dapat disiapkan setelah nonce sebelumnya dicabut |
| Cabut nonce | Borrower/Buyer | `REVOKE_CONSENT` | Pilih nonce tersimpan atau masukkan nonce; guard browser membandingkan nonce yang ditinjau dengan calldata; invalidation kanonik ditampilkan beserta tx/block dan hilang bila event di-reorg |
| Registrasi | Verifier | `REGISTER` | Dua consent versi sama; expiry/hold dan kontrak diperiksa; pending bukan registered |
| Pembatalan final sebelum funding | Borrower/Buyer/Verifier | `CANCEL` | Ditampilkan setelah registry aktif dan read model unfunded; kontrak tetap memeriksa race funding |
| Pendanaan | Lender | `APPROVE_TOKEN`, `FUND` | Persetujuan token exact principal; funding + pencairan atomik; hold/expiry mencegah exposure baru |
| Collection | Buyer | `APPROVE_TOKEN`, `COLLECT_BUYER_PAYMENT` | Nominal positif tidak melebihi sisa invoice; borrower/third party tidak diberi kontrol ini |
| Penarikan lender | Lender deal tersebut | `WITHDRAW_LENDER` | Hanya alokasi diterima dan belum ditarik; recipient tetap |
| Penarikan residual | Borrower | `WITHDRAW_BORROWER` | Residual setelah hak lender tertutup; berbeda dari pencairan principal |
| Dispute berbukti | Borrower/Buyer/Verifier | `/claims/:id/disputes` | Reason + evidence ID; UI tidak menyatakan hold onchain sebelum konfirmasi |
| Clear hold | Verifier | Review penyelesaian + `CLEAR_HOLD` | Dua langkah; manusia saja; tidak memperpanjang ketentuan expired |
| Rekonsiliasi hash hilang | Pengirim intent | `/transactions/observe` | Hash dari wallet diverifikasi; tidak mengirim transaksi lagi |
| Pemulihan hash Speed Up | Pengirim intent | `/transactions/:id/replacement` | Receipt pengganti harus sudah mined dan kanonik; backend memeriksa sender, target, calldata, value dan actual nonce sama, lalu mencatat intent pengganti |
| Audit dan langkah agent | Pihak berwenang | `/audit`, `/agent-runs` | Catatan nyata, pagination, detail hasil tahap; tidak ada aktivitas buatan |

## Hierarki status

Trail detail: **Invoice → Review → Persetujuan → Registrasi → Pendanaan → Collection penuh**. Tahap terakhir hanya selesai bila collection invoice penuh, bukan ketika financing sudah REPAID. Read model degraded ditandai sebagai konfirmasi terakhir. Status withdrawal tetap terpisah dari kedua status tersebut.

Konfirmasi wallet menampilkan tindakan, jaringan, principal, fee, outstanding, sender, recipient, kontrak/token address, dan payload aktual. Withdraw menunjukkan saldo saat persiapan; kontrak menarik seluruh saldo hak yang tersedia saat eksekusi sehingga collection baru dapat menambah nominalnya.

MockIDR Testnet adalah label tampilan yang cocok dengan simbol token uji onchain. ABI, alamat, desimal, dan pembukuan tidak berubah. Detail token dapat dibuka dari identitas token.

## Batas dan pengujian

- Route dan UI tidak menggantikan otorisasi backend maupun role kontrak. Semua error/hold/expiry tetap diperiksa ulang saat prepare dan eksekusi.
- UI tidak membroadcast tanpa tindakan pengguna. Tidak ada key peserta pada browser bundle atau backend runtime.
- Data preview, bila ada, terpisah dari claim otoritatif. Tidak memberi role atau kredit saldo.
- `next-task.test.ts` menguji urutan review/consent, registrasi pending, expiry, dan hold; `wallet-guards.test.ts` termasuk negative test nonce pencabutan. Pengujian browser lintas peran dan integration API dicatat terpisah dalam TEST_REPORT.
- Perubahan ini tidak membuktikan keberhasilan transaksi finansial di public testnet. Tidak ada transaksi publik baru yang dikirim oleh pekerjaan UI ini.
