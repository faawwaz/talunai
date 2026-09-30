# TALUNAI — alur produk MVP

Status alur aktif dan batas kontrak lama ada di [status perbaikan audit](TALUNAI_REMEDIATION_STATUS.md). Pendanaan langsung per Deal adalah jalur utama. Pool BSC yang sudah terpasang ditampilkan untuk posisi, histori, harvest, dan redeem; aplikasi menutup deposit/alokasi baru pada kontrak lama.

## Masuk ke workspace

Buka `https://localhost:3000/app` pada BSC Testnet (chain ID 97), pilih akun yang benar di ekstensi wallet, lalu tanda tangani pesan login. Jika hanya punya satu role, `/app` mengarahkan otomatis. Untuk akun testnet yang disediakan lokal, gunakan daftar private key pada `.private/TESTNET_WALLETS.md` yang diabaikan Git.

| Wallet yang dipilih | Halaman setelah login |
| --- | --- |
| Admin (`0x1BA82a…dd176`) | `/admin`; permohonan organisasi di `/admin/access` dan pengelolaan peserta di `/admin/organizations`. |
| Verifier | `/verifier`; daftar klaim untuk pemeriksaan. |
| Borrower | `/borrower`; pengajuan invoice dan bukti. |
| Buyer | `/buyer`; persetujuan terms dan pembayaran. |
| Lender atau Lender kedua | `/lender`; tinjauan pendanaan dan posisi. |
| Admin atau Verifier | `/agent`; operasi dan riwayat run agent. |

Agent worker adalah akun layanan onchain, **bukan** akun login browser. Jika ekstensi masih memilih wallet lama, keluar dari sesi, pilih akun baru di ekstensi, lalu masuk lagi. URL login yang benar memakai `localhost`, bukan `127.0.0.1`.

## Siapa melakukan apa

| Aktor | Kewenangan sekarang |
| --- | --- |
| Pengunjung | Membuka Explore tanpa wallet untuk memeriksa pool, invoice, blok sumber, dan transaksi terkonfirmasi. |
| Borrower | Mewakili pemasok yang disetujui, mengajukan invoice dan bukti, memperbaiki versi, menyetujui terms dengan wallet, lalu menerima pokok pendanaan dan sisa pembayaran buyer sesuai kontrak. |
| Buyer | Mewakili pembeli yang disetujui, memeriksa invoice, menyetujui terms dengan wallet sendiri, dan membayar invoice ke vault. Buyer tidak memutuskan apakah investor harus mendanai. |
| Verifier | Reviewer manusia independen dari kedua organisasi pada klaim. Ia memeriksa sumber bukti dan hasil agent, menyetujui/menolak review, lalu mengirim registrasi onchain setelah dua persetujuan wallet valid. Ia juga meninjau penyelesaian dispute atau hold. |
| Lender | Menilai Deal yang sudah terkonfirmasi, menerima terms/risiko, lalu mendanai langsung jika memiliki grant organisasi dan role onchain yang cocok. Pemilik share pool lama masih dapat melihat posisi, harvest, dan redeem sesuai aturan kontrak lama. |
| Agent AI | Worker membaca dokumen, mengekstrak fakta bersumber, mendeteksi konflik/anomali, dan memberi alasan kepada verifier. Role agent onchain dapat mencatat observasi atau mengusulkan funding hold dengan action ID unik dan commitment bukti. Agent tidak menandatangani persetujuan buyer/borrower dan tidak mengesahkan klaim. Provider masih `mock` sampai kunci OpenRouter dipasang dan run live dibuktikan. |
| Admin/operator — pemilik produk | Memeriksa akses organisasi, membership, audit, dan kesiapan role onchain. Kewenangan admin kontrak lama tetap ada di chain; UI aplikasi tidak membuka alokasi baru pada pool lama. Admin bukan pengganti buyer, supplier, lender, atau verifier. |
| Minter token uji | Role kontrak khusus yang mencetak MockIDR di testnet. Token ini tidak bernilai rupiah; mint bukan simpanan atau pendapatan. |

Satu wallet dapat mempunyai lebih dari satu membership yang sah, tetapi akses ke klaim tetap dibatasi organisasi dan role. Wallet operator/agent kontrak tidak bisa memakai formulir peserta untuk memberi dirinya akses. Login SIWE membuktikan kontrol wallet; formulir akses hanya membuat permohonan, bukan membership. Detail status dan edge case ada di [panduan onboarding](ONBOARDING.md).

## Jalur utama yang dilihat pengguna

1. **Explore:** pengunjung melihat angka dan riwayat pool terkonfirmasi tanpa login. Lender masuk untuk melihat peluang Deal yang memenuhi izin dan tenggat; admin memeriksa permohonan akses organisasi. Deposit baru ke pool lama ditutup di aplikasi.
2. **Invoice:** borrower mengirim invoice, bukti pengiriman, dan pengakuan buyer. Worker mengekstrak fakta dengan referensi dokumen. Kegagalan parser atau agent tidak berubah menjadi persetujuan diam-diam.
3. **Keputusan:** verifier manusia memeriksa hasil dan bukti. Penolakan memberi alasan; versi yang diperbaiki harus ditinjau ulang. Sesudah review positif, borrower dan buyer masing-masing menandatangani terms versi yang sama. Tanda tangan kedaluwarsa, dicabut, atau dari wallet salah tidak dapat dipakai untuk registrasi.
4. **Registrasi dan pendanaan:** verifier mendaftarkan Deal pada registry. Registrasi belum mencairkan dana. Lender yang dipilih dan siap di app/onchain mendanai satu Deal langsung melalui vault; principal berpindah ke supplier setelah transaksi terkonfirmasi. Pool lama pernah menjadi lender untuk Deal historis, tetapi tidak menerima alokasi baru dari aplikasi.
5. **Pembayaran dan hasil:** buyer membayar ke vault. Kontrak mengalokasikan pembayaran berurutan: pokok lender, fee lender, kemudian sisa supplier. Lender menarik hak yang sudah tersedia. Untuk Deal historis dengan pool sebagai lender, pool memanen hak dari vault, lalu pemilik share menebus sesuai aturan kontrak. Fee tertagih menaikkan nilai share; tidak ada APY tetap.

## Ekonomi, batas, dan gagal bayar

- Fee pembiayaan saat ini **1,5% flat dari pokok invoice**, dibayar dari collection buyer; **bukan APY**. Pada invoice testnet 100.000.000 MockIDR, pokok 70.000.000 menghasilkan fee 1.050.000 dan sisa borrower 28.950.000 setelah buyer membayar penuh. [Receipt publik](TESTNET_FLOW_RECEIPTS.md).
- Share investor mewakili proporsi `bookAssets / totalShares`. Fee yang benar-benar dikumpulkan dibagi melalui kenaikan nilai share. Uji kontrak dua investor menyetor 1 miliar dan 400 juta: fee 1.050.000 menaikkan hak masing-masing 750.000 dan 300.000. Contoh dua investor ini adalah **uji kontrak**; receipt testnet publik memakai satu investor.
- Batas pool: paling banyak 10% aset buku untuk satu deal, 80% utilisasi pokok aktif, dan 32 deal terlacak. Terms registry membatasi advance maksimal 80% nilai invoice dan pokok 100.000.000 MockIDR per invoice.
- Jika buyer terlambat, invoice menjadi overdue dan hasil belum direalisasi. Jika buyer gagal membayar, pokok investor tetap terekspos; penebusan terkunci selama hak lender aktif belum terpenuhi. Nilai buku nominal bukan estimasi pemulihan. Hold/dispute dapat menghentikan pendanaan berikutnya; pembayaran buyer dan klaim yang sudah muncul tidak dihapus. MVP belum memiliki asuransi, penagihan otomatis, pasar sekunder, atau write-off final.

## Batas kejujuran pitch

Yang dapat dibuktikan sekarang adalah satu siklus pendanaan invoice **BSC Testnet** dengan MockIDR tanpa nilai, kontrak pool, receipt, dan antarmuka Explore yang membaca chain. Ini belum pembiayaan rupiah riil, belum pool dengan aset DEX/AMM, dan belum bukti agent OpenRouter live. Kunci OpenRouter perlu dipasang pada worker, lalu preflight dan satu run nyata harus menunjukkan provenance live sebelum klaim itu diubah. [Brief juri](PITCH_BRIEF.md) dan [teks submission](pitch/SUBMISSION_COPY.md) menggunakan batas tersebut.
