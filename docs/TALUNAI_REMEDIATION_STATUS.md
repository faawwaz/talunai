# Status perbaikan audit Talunai

Diperbarui **29 September 2026**. Dokumen ini melacak implementasi terhadap [audit penyederhanaan](TALUNAI_SIMPLIFICATION_AUDIT.md). Status *source selesai* berarti kode dan tes sudah diperbarui; itu **bukan** klaim bahwa kontrak lama di BSC Testnet berubah atau bahwa layanan finansial ini siap produksi.

## Yang sekarang bekerja

| Temuan | Status | Bukti / batas |
|---|---|---|
| F01, F10, F19, F23 | Source selesai | Label pool untuk recovery sebagian tidak lagi “Lunas”; next action memakai uang canonical; Deal terdaftar yang melewati deadline dijelaskan sebagai terminal; fee tetap tidak dipasarkan sebagai APY. |
| F02, F17 | Source selesai, risiko signature lama dibatasi | Setiap permintaan tanda tangan dan signature disimpan historis. Revisi menunggu semua nonce terkait kedaluwarsa atau invalidasi yang telah terindeks canonical dari registry yang tepat. Signature onchain yang belum kedaluwarsa tetap memiliki konsekuensi sampai benar-benar dibatalkan. |
| F03, F12 | Source selesai | Sengketa pra-registrasi dapat diselesaikan; kategori barang `OTHER` bukan penolakan otomatis selama bukti piutang valid. |
| F05, F21, F30 | Kontrol akses selesai; schema masih perlu konsolidasi | User berstatus nonaktif ditolak untuk login/sesi baru; konflik verifier/lender dan hubungan organisasi diperiksa; aksi Deal mencatat organisasi yang memberikan kewenangan, bukan membership pertama. Hak withdraw yang sudah terbentuk di kontrak tetap dapat dieksekusi wallet pemilik langsung saat akses aplikasi dibekukan. Tabel SQL-only dan sebagian foreign key F30 belum dikonsolidasikan. |
| F13, F26, F29 | Source selesai untuk UX inti | Navigasi utama berpusat pada Tindakan dan Deals. Inbox global memakai pagination/sort, lender melihat kesiapan wallet dan peluang Deal teredaksi; supplier dapat mengundang lender yang berwenang. Route lama masih melayani bookmark/operasional. |
| F14, F22 | Source selesai | Parser/provider agent berjalan di luar transaksi DB panjang, publikasi hasil memakai token eksekusi dan hash input; notifikasi write-only dan framework tool agent yang tidak dipanggil runtime dihapus dari jalur aplikasi. Tabel histori lama dipertahankan. |
| F15, F16 | Dimitigasi | Event pool memeriksa block hash, overlap, dan receipt pin saat reorg; statistik dibaca pada blok terkonfirmasi. Pool lama tetap dapat dilihat saat deployment inti berubah. Pool event belum menyatu dengan indexer utama dan pembacaan activity masih bergantung pada RPC. |
| F24, F25, F27, F31 | Source/runtime selesai | Unit uji dijelaskan sebagai MockIDR onchain/IDRT uji, tanpa klaim token Rupiah resmi. Batas dan receipt testnet didokumentasikan. Web lokal berjalan pada origin HTTPS yang benar; `npm run doctor` memeriksa web, DB, worker, agent, chain, dan readiness. Transaksi pool pending mempertahankan hash untuk pemeriksaan ulang. |

### Sengketa selama registrasi

Buyer sekarang dapat mengunggah dokumen dengan tujuan `DISPUTE` tanpa mengubah versi atau evidence commitment Deal yang sudah ditandatangani. Pemeriksaan agent hanya memakai dokumen `DEAL`. Saat registrasi canonical terindeks dan masih ada sengketa aktif tanpa hold, indexer menjadwalkan hold idempotent; worker memperlakukan RPC yang belum melihat registrasi sebagai gangguan sementara dan mencoba lagi. Pendanaan melalui API tetap ditolak selama sengketa. **Kontrak lama tidak dapat menjamin hold dan registrasi terjadi atomik:** direct onchain funding masih memiliki jendela sebelum transaksi hold terkonfirmasi. Ini harus ditutup dalam deployment protokol baru sebelum klaim keamanan yang lebih kuat.

## Perubahan kontrak yang memerlukan deployment baru

| Temuan | Source baru | Status BSC Testnet lama |
|---|---|---|
| F04 | Verifier tidak dapat melepaskan hold Deal yang melibatkan dirinya sebagai buyer/supplier. | Registry lama immutable; kontrol ini belum berlaku di alamat lama. |
| F07 | Pool baru memakai share 18 desimal dan perlindungan pembulatan/donasi. | Pool lama tetap memakai 0 desimal; aplikasi menjadikannya **position only**. |
| F08 | Admin pool baru tidak otomatis menjadi allocator; grant allocator adalah transaksi tersendiri ke wallet operator berbeda. | Admin kontrak lama masih punya kemampuan lamanya. Admin baru pun masih dapat memberi dirinya role melalui `DEFAULT_ADMIN_ROLE`; pemisahan ini operasional, bukan governance terdesentralisasi. |
| F18 | Hold baru hanya dapat ditempatkan sebelum funding; setelah funding agent memakai risk observation. | Registry lama belum berubah. Worker aplikasi sudah memakai observation ketika funded. |

Manifest pool lama tidak ditimpa. Pembacaan posisi, histori, harvest, dan redeem tetap tersedia. Deposit, izin investor baru, dan alokasi baru melalui UI/API Talunai ditutup untuk pool lama. Ini tidak mencabut izin atau fungsi yang sudah ada di kontrak lama; operator harus mengelola role/pause onchain bila akan menghentikan transaksi langsung.

## Batas yang masih terbuka

| Temuan | Keputusan MVP sekarang | Syarat sebelum diperluas |
|---|---|---|
| F06 | Pool lama tidak menerima eksposur baru dari aplikasi. Redemption memang terkunci selama hak lender aktif; gagal bayar belum punya write-down/recovery. Aset buku tidak sama dengan kas yang dapat ditarik. | Tentukan mekanisme default, loss allocation yang adil, recovery terlambat, governance dan tes invariant sebelum membuka pool baru. |
| F09 | Deal lama tetap memakai urutan verifier → dua consent → registrasi. UI tidak mengaku buyer-first bila protokol belum mendukungnya. | Bekukan proposal pra-review dan versi protokol yang eksplisit, atau deployment registry V2 jika verdict harus terikat dalam signature buyer. Migrasi tidak boleh menafsir ulang signature V1. |
| F11 | Adapter OpenRouter live sudah ada, tetapi lingkungan aktif masih `LLM_MODE=mock`; tidak ada key pada sesi ini. | Pasang key pada worker, samakan konfigurasi web/worker, jalankan `npm run smoke:provider` dan satu run end-to-end live. |
| F20 | Self-service onboarding masih satu organisasi/signer per jalur; akses lintas organisasi harus memakai scope dan grant eksplisit. | UI pemilihan konteks dan tes multi-org lengkap sebelum membuka membership fleksibel. |
| F28 | Pemeriksaan wiring kontrak penuh kini di-cache lima menit per deployment; chain ID dan hash blok tetap diperiksa tiap tick. Rekonsiliasi tidak lagi meminta ulang receipt `CONFIRMED` di luar jendela reorg. `npm run doctor` melaporkan lag dan gagal jika melebihi 200 blok. Indexer masih melakukan full projection rebuild dan bergantung pada latensi RPC. | Ukur lag dan throughput sepanjang rehearsal; desain incremental projection hanya setelah replay/reorg tetap terbukti. |
| F30 (schema) | Attribution organisasi untuk audit aksi Deal sudah benar, tetapi sebagian tabel operasional masih didefinisikan hanya lewat SQL dan beberapa relasi historis belum mempunyai foreign key. | Konsolidasikan deklarasi schema dan tambahkan constraint setelah audit data lama, agar migrasi tidak memutus record yang sah. |

F19 (Deal terdaftar yang expired) adalah batas kontrak: tidak ada tombol memperpanjang signed deadline. Deal baru/linked retry memerlukan protokol dedup dan consent baru. F13 menyisakan route lama sebagai kompatibilitas; itu bukan menu utama baru.

## Bukti verifikasi dan operasi

- Tes unit domain/frontend, API terisolasi, agent dengan PostgreSQL sementara, Foundry, TypeScript, lint, dan build web adalah gate perubahan source. Jumlah dan hasil terakhir dicatat pada laporan penyelesaian pekerjaan ini; tes lulus tidak mengganti uji deployment baru.
- Migrasi `0006_consent_issuances.sql`, `0007_chain_event_emitter.sql`, dan `0008_document_purpose.sql` bersifat tambahan dan telah diterapkan pada database lokal testnet. Empat belas log historis yang receipt dan block hash-nya cocok sudah diberi alamat emitter; tidak ada event invalidasi consent historis dalam backfill tersebut.
- Pool testnet lama memiliki **1.001.050.000 MockIDR sintetis** setelah satu siklus receipt nyata yang tercatat di [bukti transaksi](TESTNET_FLOW_RECEIPTS.md). Ini bukan 1 miliar IDR fiat atau saldo redeemable Rupiah.
- Tidak ada kontrak baru atau transaksi chain yang disiarkan dalam perbaikan audit ini. Sebelum deploy V2: selesaikan F06, biayai wallet investor sesuai preflight, verifikasi bytecode/role, migrasikan pembacaan multi-pool, lalu uji dengan transaksi testnet baru. Jangan mengganti alamat manifest lama.

Perintah diagnosis lokal: `npm run local:postgres`, `npm run worker`, `npm run dev:https`, lalu `npm run doctor`. Origin testnet lokal adalah `https://localhost:3000`.
