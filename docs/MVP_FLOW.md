# Peta kode dan alur MVP TALUNAI

Catatan 29 September 2026: alur utama sekarang pendanaan langsung per Deal. Bagian pool di bawah menjelaskan kontrak historis dan pembagian fee yang sudah dibuktikan; deposit/alokasi baru ke pool lama ditutup di aplikasi. Lihat [status perbaikan audit](TALUNAI_REMEDIATION_STATUS.md).

## Bagian sistem

| Area                                                        | Tanggung jawab                                                                                                               |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `src/app`, `src/components`, `src/features`                 | Rute Next.js, shell per peran, formulir, daftar, rincian invoice, dan dialog tindakan wallet.                                |
| `src/lib/server-workspace.ts`, `src/lib/workspace-paths.ts` | Pemilihan workspace serta pemeriksaan sesi, peran, dan akses invoice di server.                                              |
| `packages/api`, `packages/client`                           | API terotorisasi, validasi tindakan, onboarding, model pembacaan, dan klien frontend.                                        |
| `packages/db`, `apps/worker`, `packages/agents`             | Data persisten, antrean pemeriksaan, dan hasil analisis bukti oleh agent.                                                    |
| `contracts/src`, `packages/chain`                           | Registry ketentuan, vault pendanaan/pembayaran, token uji, gateway transaksi, serta proyeksi dari event chain terkonfirmasi. |
| `contracts/src/LiquidityPoolA.sol`, `packages/pool/read.ts` | Pool investor testnet, share, batas eksposur, pembacaan saldo dan peristiwa langsung dari chain.                             |

`graft/` mengindeks hubungan simbol dan rentang sumber untuk menelusuri perubahan lintas area.

## Akses halaman

| Peran                  | Pintu utama | Halaman kerja                                                                              |
| ---------------------- | ----------- | ------------------------------------------------------------------------------------------ |
| Pengunjung / akun baru | `/app`      | Explore Pool A tanpa login di `/app/explore`; login wallet untuk meminta akses organisasi. |
| Pemohon                | `/borrower` | Piutang, pengajuan baru, tugas, pembayaran, aktivitas, pengaturan.                         |
| Pembeli                | `/buyer`    | Invoice, tugas persetujuan, pembayaran, aktivitas, pengaturan.                             |
| Pendana                | `/lender`   | Peluang pendanaan, tugas, alokasi dan penarikan, aktivitas, pengaturan.                    |
| Verifier               | `/verifier` | Antrean verifikasi, tugas, pemantauan pembayaran, aktivitas, operasi agent.                |
| Admin                  | `/admin`    | Akses, organisasi, pengajuan, antrean tugas, pembukuan, aktivitas, audit, operasi agent.   |
| Operator               | `/agent`    | Run pemeriksaan dan transaksi/rekonsiliasi; hanya admin atau verifier yang dapat masuk.    |

`/app/explore` tersedia di menu semua workspace. Halaman ini menampilkan likuiditas, pokok teralokasi, biaya yang sudah diterima, aktivitas transaksi, alamat kontrak, dan posisi share wallet dari BSC Testnet. Akun admin yang tersambung ke BSC Testnet dapat memberi izin investor dan mengalokasikan claim key yang sudah layak. Investor berizin dapat menyetor MockIDR setelah menyetujui risiko dan menebus share saat tidak ada invoice aktif.

API baca publik `GET /v1/explore` mengembalikan metrik dan blok sumber. `GET /v1/explore?wallet=0x…` menambahkan posisi, saldo, allowance, dan izin onchain untuk investor tersebut; tidak memerlukan API key karena semua datanya sudah publik di chain. `GET /v1/explore/candidate?key=0x…` memeriksa kelayakan sebuah invoice onchain sebelum alokasi. Transaksi tulis tetap memerlukan tanda tangan wallet pemegang peran; API baca tidak dapat mendepositkan dana atas nama investor.

Rincian setiap pengajuan dibuka dari daftar atau tugas. Tab `Bukti`, `Ketentuan`, `Pembayaran`, dan `Aktivitas` mempunyai URL tersendiri. Setiap halaman privat memeriksa akses di server; menu hanya memudahkan navigasi dan tidak menambah kewenangan. `/app/demo` lama dialihkan ke `/app`.

## Peran dan batas wewenang

| Peran                             | Yang dikerjakan                                                                                                                                    | Tidak bisa dilakukan sendirian                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Pengunjung                        | Membaca pool dan transaksi publik tanpa wallet.                                                                                                    | Membaca dokumen privat atau melakukan transaksi.                                                                     |
| Admin/operator (pemilik platform) | Meninjau permohonan akses, mengelola organisasi, memantau audit, memberi izin investor pool, dan memutuskan alokasi pool dalam batas kontrak.      | Menggantikan tanda tangan borrower/buyer atau mengabaikan hold kontrak.                                              |
| Borrower/pemohon                  | Membuat pengajuan invoice, mengunggah bukti, menyetujui ketentuan, dan menarik residual setelah buyer membayar.                                    | Menyetujui invoice atas nama buyer atau memverifikasi bukti sendiri.                                                 |
| Buyer/pembeli                     | Mengakui invoice, menandatangani ketentuan, dan membayar melalui vault.                                                                            | Mengambil bagian lender atau mengubah ketentuan yang sudah terdaftar.                                                |
| Verifier                          | Memeriksa bukti dan keputusan agent, mendaftarkan pengajuan yang layak, menahan/membuka pendanaan melalui review manusia.                          | Mengirim dana investor tanpa izin kontrak.                                                                           |
| Lender langsung                   | Memilih invoice, menyetujui risiko pendanaan, mendanai principal, dan menarik haknya sesudah collection.                                           | Membuat pendanaan kedua atas invoice yang sama.                                                                      |
| Investor Pool A                   | Menyetor MockIDR, menerima share yang tidak dapat dipindahtangankan, melihat posisi, dan menebus ketika siklus invoice selesai.                    | Memaksa penarikan saat hak lender invoice aktif masih terutang.                                                      |
| Agent worker                      | Membaca bukti yang diizinkan, mengekstrak data, membandingkan dokumen/kebijakan, membuat temuan, mengusulkan hold, dan mencatat jejak pemeriksaan. | Menandatangani persetujuan manusia, menyetujui invoice, mencairkan dana, menghapus hold sendiri, atau menarik token. |

`/agent` adalah **konsol operasi** untuk admin/verifier, bukan login agent sebagai manusia. `LLM_MODE=mock` pada konfigurasi saat ini berarti pemeriksaan memakai provider deterministik; integrasi provider live tersedia di kode tetapi belum aktif tanpa kunci dan konfigurasi. Temuan agent tetap ditinjau manusia.

## Alur operasional

1. Pengunjung melihat data pool publik; calon peserta menghubungkan wallet dan meminta akses organisasi/peran. Admin meninjau permintaan.
2. Borrower membuat pengajuan invoice dan mengunggah bukti barang, tagihan, serta pengakuan buyer. Sistem menyimpan versi dan jejak audit.
3. Worker memeriksa bukti dan menandai ketidakcocokan atau risiko. Verifier meninjau sumber serta ketentuan dan dapat menahan pendanaan.
4. Borrower dan buyer menandatangani versi ketentuan yang sama. Verifier meregistrasikan invoice onchain setelah syarat terpenuhi.
5. Pendanaan dapat lewat lender langsung yang berizin, atau lewat Pool A bila admin mengalokasikan claim key yang layak. Vault mencairkan pokok ke borrower secara atomik. Pool menegakkan batas 10% aset buku per invoice dan 80% pokok aktif total, selain aturan registry dan hold.
6. Buyer membayar ke vault, dapat bertahap. Vault mengalokasikan pembayaran ke pokok lender, lalu fee lender, lalu residual borrower. Pool menarik haknya dari vault; aset pool dan nilai tebus share bertambah hanya ketika pembayaran benar-benar tercatat.
7. Lender langsung menarik haknya. Investor Pool A menebus share setelah semua invoice dalam pool memenuhi hak lender. Borrower menarik residual. Semua transaksi mempunyai hash dan status konfirmasi.

Status registrasi, pendanaan, collection, dan penarikan ditampilkan terpisah. Hash transaksi yang terkirim tetap berstatus pending sampai receipt dan event kanonik diverifikasi. Seluruh token dan pihak pada demo bersifat sintetis di Anvil atau BSC Testnet.

## Ekonomi Pool A dan status nyata

Pool A di BSC Testnet: [`0x7858c6418eb818da50f57bc9c9bbfd9257b96ba1`](https://testnet.bscscan.com/address/0x7858c6418eb818da50f57bc9c9bbfd9257b96ba1). Investor awal menyetor **1.000.000.000 MockIDR** pada [transaksi deposit](https://testnet.bscscan.com/tx/0x6b04ad9864f3dff28063bf4382b1ec78229a30dee8377b41ed986393b26b12a4), menerima 1.000.000.000 share. Manifest dan blok deploy ada di `deployments/pool-a-bsc-testnet.json`; halaman Explore selalu membaca keadaan terbaru, jadi angka di UI tidak disetel manual.

| Ukuran                       | Rumus dan makna                                                                                                                                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aset buku                    | MockIDR idle + pokok yang belum kembali + hak lender yang sudah ditagih buyer tetapi belum dipanen dari vault. Ini nilai nominal akuntansi onchain, bukan harga pasar atau estimasi kerugian.  |
| Utilisasi                    | Pokok aktif ÷ aset buku. Batas kontrak 80%; per invoice 10% aset buku.                                                                                                                         |
| Share investor               | Saat deposit, share baru sebanding dengan aset buku dan total share. Nilai posisi buku = share investor ÷ total share × aset buku; angka ini belum tentu dapat ditarik saat invoice aktif.         |
| Insentif lender              | Fee pendanaan yang ditetapkan per invoice dan dibayar buyer, dialokasikan setelah pokok. Fee masuk ke aset pool dan secara pro rata meningkatkan nilai tebus share; tidak ada reward token.    |
| Fee Deal                     | Biaya tetap dinyatakan untuk satu Deal; pada contoh 70 juta principal, 1,5% berarti 1,05 juta bila buyer membayar sesuai terms. Ini bukan APY.                                                     |
| Hasil yang telah diterima     | Satu siklus cepat menghasilkan fee 1.050.000, tetapi belum cukup untuk APY tahunan yang bermakna. Modal kini idle; halaman menampilkan fee aktual dan alasan APY belum tersedia.                  |

Deposit historis mengharuskan checkbox risiko dan hash disclosure versi kontrak. Kontrak memancarkan event penerimaan risiko pada transaksi deposit; aplikasi kini menutup deposit baru ke pool lama. Share tidak dapat ditransfer; penarikan terkunci selama invoice aktif. Gagal bayar belum otomatis diturunkan dari aset buku, dan tidak ada pasar sekunder atau jaminan likuiditas. Karena itu, pool ini adalah **pool kredit invoice sintetis**, bukan AMM/DEX yang menetapkan harga swap. Integrasi dana bernilai nyata dan proses regulasi memerlukan tahap tersendiri.

### Pembagian fee dan risiko gagal bayar

Fee kontrak saat ini **1,5% flat dari pokok**, dihitung di awal; fee tersebut belum menjadi pendapatan ketika invoice baru didanai. Pembayaran buyer masuk dengan urutan pokok lender → fee lender → sisa untuk borrower. Investor memiliki `share / totalShare` dari aset pool; fee yang benar-benar tertagih menaikkan nilai aset per share. Tidak ada pembagian fee manual oleh admin dan tidak ada imbal hasil tetap.

Contoh yang diuji di kontrak: investor A menyetor 1.000.000.000 MockIDR, B menyetor 400.000.000. Pool mendanai pokok 70.000.000 dengan fee 1.050.000. Setelah buyer membayar total 71.050.000, nilai pool menjadi 1.401.050.000; A dapat menebus 1.000.750.000 dan B 400.300.000. Selisih 750.000 + 300.000 tepat sama dengan fee tertagih. Saat pembayaran baru 35.000.000, seluruhnya masih pemulihan pokok: fee investor tetap nol dan redemption terkunci.

Jika buyer terlambat atau gagal bayar, setiap investor menanggung eksposur **pro rata menurut share**, sampai seluruh pokok terutang dan fee yang belum diterima. Saat ini kontrak menahan redemption selama hak lender invoice belum terpenuhi; ia tidak memiliki mekanisme penyelesaian rugi final atau pasar sekunder. `bookAssets` menghitung pokok belum tertagih pada nilai nominal, sehingga **bukan kas yang dapat ditarik atau valuasi setelah gagal bayar**. MVP harus menampilkan status overdue, kas idle, pokok tertunggak, dan hak yang baru benar-benar dapat dipanen secara terpisah. Untuk pitch, jangan mengklaim perlindungan pokok, recovery otomatis, atau likuiditas saat default. Penyelesaian kerugian dan kepastian hak tagih menjadi gerbang sebelum dana bernilai nyata.

## Kesiapan indexer dan transaksi testnet

Explore membaca Pool A langsung dari chain. Celah historis sekitar 90 ribu blok yang semula ditolak `eth_getLogs` dipulihkan pada 29 September 2026 melalui backfill header dan receipt: kontinuitas hash blok, bloom, jumlah/urutan transaksi pada blok kandidat, dan log kontrak diperiksa sebelum checkpoint bergerak. Backfill tidak melompati rentang atau menganggap respons kosong sebagai bukti tanpa peristiwa. Worker indexer kemudian memproyeksikan state kanonik normal dan `/health/ready` kembali 200. Pembacaan header pada RPC fallback kini dibatch agar heartbeat tidak melewati batas kesegaran.

Satu invoice sintetis telah menyelesaikan alur BSC Testnet: dua consent EIP-712, registrasi verifier, pendanaan 70.000.000 MockIDR dari pool, pembayaran buyer 100.000.000, harvest hak lender 71.050.000, penarikan residual borrower 28.950.000, redemption investor 1.001.050.000, lalu redeposit seluruh jumlah. [Bukti transaksi dan blok](../deployments/bsc-testnet-flow-smoke.json) memuat 12 receipt kanonik dengan tiga konfirmasi. Pool sekarang menyimpan **1.001.050.000 MockIDR**, terdiri dari pokok awal 1 miliar dan fee yang benar-benar dibayar 1,05 juta; satu deal tercatat lunas, tidak ada pokok aktif. Agent analisis masih **mock** karena kunci OpenRouter belum dipasang; transaksi finansial testnet ini tetap nyata.
