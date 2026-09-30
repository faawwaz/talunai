# TALUNAI — klaim produk untuk juri

## Submission Indonesia Web3 Hackathon 2026

[Penyelenggara](https://luma.com/pcc699dv) membuka submission 1–30 September 2026, mengizinkan **pitch deck dikirim saat MVP masih diperbaiki**, lalu submission diperbarui sebelum tenggat. Track yang paling cocok adalah **Finance & Commerce**: AI membantu pemeriksaan alur dana dan aset, sementara keputusan pendanaan tetap dibatasi manusia dan kontrak. Deskripsi track AI Agents meminta tindakan otonom; TALUNAI tidak perlu mengklaim otonomi yang belum dimiliki.

- [Pitch deck PDF siap unggah](pitch/TALUNAI_PITCH_DECK.pdf) · [sumber HTML yang dapat diedit](pitch/TALUNAI_PITCH_DECK.html).
- [FAQ portal resmi](https://indonesiaweb3hack.xyz/en/faq) meminta registrasi tim di Luma, alamat kontrak BNB Smart Chain/opBNB yang terbuka di BscScan, repo GitHub **publik**, video demo YouTube (maksimal 5 menit disarankan), problem, solusi, detail proyek, anggota tim, dan tautan pendukung. Portal memungkinkan edit sebelum 30 September dengan edit code yang diterima setelah submit pertama. Batas ukuran deck dan jam penutupan menurut zona waktu tidak terlihat di FAQ.
- **Belum siap untuk submission lengkap:** repo publik dan video belum dibuat; nama/anggota tim serta email kontak harus diisi pemilik akun. Riwayat karya inti selama periode hackathon juga perlu dapat dibuktikan karena FAQ menyaratkan proyek inti baru dalam periode itu.
- Kredensial OpenRouter masih perlu diaktifkan dan diuji sebelum menyebut inferensi agent **live**. Status deck saat dibuat menyebut provider mock secara eksplisit.

## Hipotesis MVP

Invoice yang disetujui kedua pihak bisa menjadi peluang pendanaan onchain yang dapat diperiksa investor. Agent membaca bukti dan mengangkat anomali; manusia memutuskan kelayakan; smart contract menegakkan persetujuan, batas eksposur, arus dana, dan pembagian fee. Investor melihat kas, pokok berisiko, pembayaran, serta transaksi dari chain.

## Alur yang harus ditunjukkan

1. Buka Explore **tanpa wallet**. Tunjukkan satu market, blok sumber, invoice lunas, fee yang telah dibayar, dan tautan transaksi.
2. Pada satu klaim, tunjukkan hasil agent dengan sumber bukti, keputusan verifier, serta dua persetujuan wallet borrower dan buyer. Siapkan organisasi dan akses sebelumnya agar waktu juri tidak habis pada setup.
3. Tunjukkan pendanaan pool, pembayaran buyer, lalu pembagian 70 juta pokok + 1,05 juta fee + 28,95 juta sisa borrower dari transaksi testnet.

Setiap langkah harus menampilkan status transaksi dan bukti chain yang aktual. Jika salah satu layanan belum siap, tampilkan status gagal/tertunda apa adanya dan jangan menyebut alur ujung ke ujung sudah live.

## Ekonomi dan risiko yang dapat dipertanggungjawabkan

- Pool A punya batas 10% aset buku per invoice dan 80% utilisasi aktif. Batas kontrak utama: advance maksimal 80% nilai invoice dan pokok maksimal 100.000.000 MockIDR per invoice.
- Fee 1,5% adalah **flat per invoice**, bukan APY yang dijanjikan. Fee investor hanya muncul setelah buyer benar-benar membayar. Saat modal seluruhnya idle, hasil berjalan 0.
- Pengujian kontrak dua investor: setoran A 1 miliar dan B 400 juta; satu invoice berpokok 70 juta membayar fee 1,05 juta. Setelah pembayaran hak lender selesai, A memperoleh 750 ribu dan B 300 ribu sebagai kenaikan nilai share. Transaksi testnet publik di bawah memakai satu investor; contoh dua investor ini berasal dari pengujian kontrak, bukan aktivitas pasar yang diklaim sudah terjadi.
- Jika buyer belum membayar, pokok investor terekspos dan redemption pool terkunci. Pada gagal bayar, saldo buku nominal tidak menunjukkan nilai pemulihan. Tidak ada penjamin, asuransi, penagihan otomatis, write-off final, atau jalan keluar sekunder pada MVP ini.
- Semua jumlah adalah **MockIDR tanpa nilai ekonomis di BSC Testnet**. Setoran satu miliar adalah transaksi token uji sungguhan, bukan dana rupiah riil. Kontrak belum diaudit untuk dana riil.

## Batas klaim pitch

Sebut ini **pasar kredit invoice testnet dengan pemeriksaan agent dan keputusan manusia**, bukan DEX swap, bukan pembiayaan riil berizin, dan bukan mesin scoring kredit terkalibrasi. Inspirasi DeFi ada pada transparansi posisi, portofolio, transaksi, dan interaksi wallet. Mekanisme pool kredit memang berbeda dari AMM dua aset seperti [Uniswap](https://support.uniswap.org/hc/en-us/articles/8829880740109-What-is-a-liquidity-pool); pembatasan likuiditas saat pinjaman aktif juga dikenal pada [pool kredit Aave](https://www.aave.com/docs/aave-v3/concepts/liquidity-pool).

Untuk rencana produksi, validasi identitas/dokumen, penilaian risiko, penagihan, dan perlindungan pemberi dana menjadi pekerjaan terpisah. [FAQ OJK tentang POJK 40/2024](https://www.ojk.go.id/id/regulasi/Documents/Pages/POJK-40-Tahun-2024-Layanan-Pendanaan-Bersama-Berbasis-Teknologi-Informasi/FAQ%20POJK%2040%20Tahun%202024%20Layanan%20Pendanaan%20Bersama%20Berbasis%20Teknologi%20Informasi.pdf) menyebut mitigasi risiko, verifikasi identitas dan dokumen, serta penagihan dalam konteks LPBBTI. MVP ini tidak mengklaim telah memenuhi kewajiban tersebut.

## Bukti yang tersedia sekarang

- Kontrak Pool A: [`0x7858c6418eb818da50f57bc9c9bbfd9257b96ba1`](https://testnet.bscscan.com/address/0x7858c6418eb818da50f57bc9c9bbfd9257b96ba1).
- [Transaksi setoran 1.000.000.000 MockIDR](https://testnet.bscscan.com/tx/0x6b04ad9864f3dff28063bf4382b1ec78229a30dee8377b41ed986393b26b12a4).
- `GET /v1/explore` membaca data pool, deal, aktivitas, dan posisi wallet langsung dari chain pada blok terkonfirmasi. Setelah satu siklus invoice sintetis, pool memiliki 1.001.050.000 MockIDR idle, fee tertagih 1.050.000, satu deal lunas, dan nol deal aktif.
- Agent OpenRouter hanya dapat disebut live setelah `OPENROUTER_API_KEY` diset pada worker, preflight lolos, dan run nyata menunjukkan mode/provenance live. Jangan memakai hasil mode mock sebagai bukti inferensi live.
- [Siklus invoice BSC Testnet](../deployments/bsc-testnet-flow-smoke.json) membuktikan registrasi, pendanaan pool, pembayaran buyer, harvest, residual borrower, redemption investor, dan redeposit melalui 12 transaksi dengan receipt kanonik. Indexer historis telah dipulihkan tanpa melompati blok dan readiness kembali 200.

## Kesalahan hackathon yang perlu dicegah

| Risiko presentasi | Keputusan untuk TALUNAI |
| --- | --- |
| Terlalu banyak fitur hingga inti produk kabur | Bekukan cerita pada satu siklus invoice yang bekerja. Multi-pool, swap DEX, dan APY prediktif bukan klaim MVP. [Devpost: hindari overcommit](https://info.devpost.com/blog/hackathon-etiquette-for-participants). |
| Waktu habis pada login dan setup | Mulai dari Explore publik, lalu satu bukti agent dan satu alur transaksi. [Devpost: tampilkan produk bekerja](https://info.devpost.com/blog/how-to-present-a-successful-hackathon-demo). |
| Tampilan meyakinkan tetapi integrasi tidak terbukti | Buka transaksi dan kontrak BSC Testnet; bedakan provider mock dari OpenRouter live; jangan menyebut MockIDR sebagai rupiah riil. [Devpost: kriteria implementasi, UX, demo](https://info.devpost.com/blog/understanding-hackathon-submission-and-judging-criteria). |
| Gugur karena syarat submission | Baca aturan **event ini** di portal sebelum unggah; pastikan deck, link, dan video (jika diminta) dapat diakses juri. [Aturan resmi acara](https://luma.com/pcc699dv). |
