# Scope piutang perdagangan B2B

Override pengguna tanggal 28 September 2026: TALUNAI mendukung core invoice B2B lintas kategori barang; kakao adalah demo utama, kemasan adalah demo nonpertanian kedua.

## Identitas aset dan metadata

Asset type selalu `TRADE_RECEIVABLE`: outstanding invoice bernominal tetap, barang telah diserahkan dan buyer mengakui piutang. Tidak mendukung pembiayaan PO, panen masa depan, persediaan, properti atau emas.

`goods` berisi `category`, `description`, dan `lineItems[]` dengan `description`, `quantity` sebagai string decimal exact, dan `unit`. Kuantitas bukan basis penilaian harga komoditas. Alokasi dan fee tetap berasal dari outstanding/principal yang ditandatangani.

- Demo policy v2 mengenali `COCOA` dan `PACKAGING` melalui alur yang sama.
- `OTHER`, metadata kosong, dan konflik bukti menghasilkan review; tidak otomatis eligible.
- Record lama tanpa metadata tidak diasumsikan kakao. Registry/funding baru diblokir sampai metadata dan review sesuai. Collection/withdrawal deal yang sudah funded tetap tersedia.
- Parser mock membaca label `goodsDescription`, `goodsCategory`, `quantity`, `quantityUnit`. Label lama `commodity`/`komoditas` merupakan alias deskripsi, bukan penentu kategori.
- Metadata multi-item tersedia dalam schema. Parser berlabel saat ini hanya merekonsiliasi satu item secara otomatis; banyak item memerlukan adapter rekonsiliasi sebelum dapat melewati gate. Tidak menganggap angka agregat sebagai bukti semua item.
- Edit metadata sebelum registrasi membuat versi baru, membatalkan consent/review lama. Sesudah registrasi immutable.

Kontrak tidak memiliki kategori kakao atau penilaian sektor. Batas nominal immutable dan consent tetap ditegakkan onchain; perluasan metadata ini tidak memerlukan redeploy kontrak. Versi/hash kebijakan baru terikat pada review dan versi yang ditandatangani. Kebijakan simulasi ini **bukan model risiko lintas sektor**.

## Fixture dan verifikasi

`fixtures/cocoa-invoice.{txt,json,pdf}` dan `fixtures/packaging-invoice.{txt,json,pdf}` merupakan dokumen sintetis. Buat ulang PDF teks dengan `npm run fixtures:pdf`.

- `tests/goods.test.ts`: schema kuantitas, tipe aset, unsupported category, ekstraksi TXT/PDF dengan source references untuk kedua kategori.
- `tests/frontend-api.integration.test.ts`: actual `processClaim`, kebijakan, authority dan review verifier pada database terisolasi untuk kedua kategori; immutable metadata dan invalidasi consent.
- `tests/agents-db.test.ts`: worker persisten/idempotensi kedua kategori, konflik, alias invoice dan bukti kurang. Jalankan `npm run test:workflow` untuk PostgreSQL temporer otomatis.

Tidak ada perubahan cap, fee flat, buyer-only collection, waterfall, satu lender, deduplication identitas issuer, role agent terbatas, atau sifat sintetis MockIDR.
