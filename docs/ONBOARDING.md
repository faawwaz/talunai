# Masuk ke organisasi

1. Hubungkan wallet dan tanda tangani login SIWE. Wallet membuktikan identitas akun, **belum** mewakili organisasi.
2. Bila wallet belum memiliki peran aktif, pilih peran peserta (borrower, buyer, atau lender), isi identitas organisasi, lalu kirim **Ajukan akses**. Admin dan verifier tidak dapat diminta melalui formulir peserta.
3. Pengelola memeriksa permohonan dan memasangkannya ke organisasi testnet berstatus `APPROVED` yang sesuai. Akses baru aktif setelah membership disetujui dan muncul di `/v1/me`. Organisasi yang sudah memiliki authority peserta tidak dapat diambil alih wallet lain lewat alur ini.
4. Status `PENDING` dapat diperbarui dari halaman yang sama. Status `REJECTED` menunjukkan alasan dan memberi jalan untuk mengajukan ulang. Bila request `APPROVED` tetapi peran belum aktif, layar meminta pemeriksaan pengelola; status request saja tidak membuka data privat.
5. Satu peran aktif langsung membuka workspace. Beberapa peran aktif memunculkan pilihan workspace. Membuka URL peran lain tidak mengubah izin wallet. Lender yang ingin mendanai masih membutuhkan izin onchain terpisah.

Login SIWE membuktikan kontrol wallet. Pengguna baru mempunyai profil pending; belum mewakili perusahaan dan belum mendapat role transaksi. Form **Ajukan akses** menyimpan permintaan PENDING nyata tanpa membuat membership. Pilihan role bukan izin role. Permintaan dapat diperiksa melalui `GET /v1/access-request`; penolakan memuat alasan dan boleh diajukan kembali. Permintaan tampil pada halaman Akses organisasi untuk akun ADMIN. Tidak ada SLA atau pengiriman email otomatis yang diklaim.

Wallet yang mempunyai role agent, admin, verifier, atau minter pada kontrak deployment aktif tidak dapat menjadi peserta melalui onboarding. Backend membaca `hasRole` dari alamat kontrak yang dikonfigurasi, termasuk chain ID; kegagalan RPC menghasilkan `503 ACCESS_ROLE_CHECK_UNAVAILABLE`. Gunakan wallet peserta terpisah; jangan impor key agent ke browser. API tidak mengakses key privat untuk pemeriksaan tersebut.

## Operator melalui workspace

Akun dengan membership ADMIN approved dapat membuka menu **Permohonan akses** di `/admin/access`. Daftar pemohon berasal dari database, memuat wallet, status, alasan, dan versi request. Operator memilih organisasi kanonik yang sesuai atau secara eksplisit membuat identitas sintetis baru setelah review; tidak ada pembuatan organisasi otomatis ketika klik Setujui.

Endpoint admin:

- `GET /v1/access-requests?status=PENDING&limit=20&offset=0`
- `GET /v1/access-organizations?role=BORROWER&limit=100&offset=0`
- `POST /v1/organizations/demo` dengan `name`, `kind`, `identityKey`, `reason`
- `POST /v1/access-requests/:id/review` dengan `expectedVersion`, `decision`, `organizationId` untuk approval, dan `reason`

Semua mutations memerlukan cookie session SIWE, Origin, CSRF, dan Idempotency-Key. Role dari body tidak dapat membuat seseorang ADMIN. Review dan idempotency tersimpan atomik; audit menandai `AUTHENTICATED_ADMIN_API`. Operator tidak perlu memberikan private key kepada server. Approval tidak mengganti wallet seed atau mengirim transaksi chain.

## Operator lokal melalui CLI

CLI berikut memerlukan akses lokal ke konfigurasi database dan `--operator` yang memiliki membership ADMIN approved. Itu adalah capability administrator lokal, **bukan autentikasi operator melalui signature**. Jangan mengekspos CLI sebagai endpoint web. Semua perubahan menulis audit dengan `TRUSTED_LOCAL_CLI`, operator, alasan, dan identitas target. CLI dan endpoint provisioning hanya menerima APP_ENV local/31337 atau testnet/97. CLI tidak melakukan transaksi chain.

```bash
# Identitas operator hasil seed yang sudah ada; bukan role dari browser.
node --env-file=.env.local --import tsx scripts/access-requests.ts list --operator user-admin
node --env-file=.env.local --import tsx scripts/access-requests.ts organizations --operator user-admin
```

Tinjau identitas sintetis pemohon secara manual. Pilih organisasi kanonik yang sama bila identitasnya sama. Organisasi yang sudah mempunyai authority tidak dapat diambil alih atau diberi wallet baru melalui CLI ini; rotasi authority memerlukan alur lain yang belum didukung. Nama/alias yang hampir sama tetap perlu review manusia; pemeriksaan nama identik ternormalisasi bukan KYB atau pemeriksaan beneficial owner.

Hanya jika usaha sintetis memang berbeda, provision organisasi baru secara eksplisit:

```bash
node --env-file=.env.local --import tsx scripts/access-requests.ts create-organization \
  --operator user-admin --identity demo-packaging-supplier-001 \
  --name "Pemasok Kemasan Sintetis" --role BORROWER \
  --alias "Pemasok Kemasan Demo" \
  --reason "Identitas sintetis baru ditinjau; bukan alias organisasi yang sudah ada."
```

`identity` adalah key identitas stabil yang dipilih operator, bukan wallet/claim/file hash. ID organisasi berupa UUID dibangkitkan server. Key identitas, nama ternormalisasi, dan alias unik melindungi race serta pengulangan tak sengaja. Jangan membuat identitas baru untuk melewati dedup invoice. Provision hanya berarti disetujui untuk simulasi (`isSynthetic=true`, `kybStatus=NOT_INTEGRATED`), bukan perusahaan terverifikasi nyata. Registrasi publik tidak dapat memanggil operasi ini.

Dengan request ID/version dari `list` dan organisasi kanonik yang telah ditinjau:

```bash
node --env-file=.env.local --import tsx scripts/access-requests.ts approve \
  --operator user-admin --request REQUEST_UUID --version 1 \
  --organization ORG_UUID --reason "Wallet peserta dan authority sintetis ditinjau secara manual."

node --env-file=.env.local --import tsx scripts/access-requests.ts reject \
  --operator user-admin --request REQUEST_UUID --version 1 \
  --reason "Identitas organisasi belum dapat dikonfirmasi untuk demo."
```

Approval mengunci request, user, dan organisasi dalam satu transaksi. Role harus cocok dengan jenis organisasi approved sintetis. Tidak ada perubahan pada akun seed, wallet agent, terms, maupun keuangan. Lender yang di-approve tetap memerlukan allowlist onchain oleh admin kontrak melalui alur terpisah sebelum funding; respons CLI menyatakan `ONCHAIN_LENDER_ALLOWLIST_REQUIRED`. Approval offchain tidak mint token, membiayai invoice, atau memberi role kontrak.

Halaman pending memeriksa status setiap 15 detik, dibatasi 12 pembaruan per kunjungan, lalu menyediakan **Perbarui status akses**. Sesudah status `APPROVED`, sesi profil dimuat ulang; workspace terbuka hanya bila membership sudah aktif. Pending request tidak memberi akses ke claim, dokumen, review, atau template transaksi organisasi mana pun. Rute lama `/app/demo` kini mengarah ke pintu masuk `/app`.
