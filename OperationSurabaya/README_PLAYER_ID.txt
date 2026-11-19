PLAYER ID UPDATE - OPERATION: SURABAYA

Perubahan:
- Register kini mewajibkan Player ID numerik 1-999.
- Player ID harus unik secara global.
- Player ID disimpan di public.players.player_number.
- Data login wajah, daftar pemain, dan roster pertandingan menyertakan player_number.

LANGKAH WAJIB SEBELUM MENJALANKAN BACKEND:
1. Buka Supabase SQL Editor.
2. Jalankan player_number_migration.sql satu kali.
3. Restart backend FastAPI.
4. Coba registrasi pemain baru dengan nomor yang belum digunakan.
5. Coba nomor yang sama pada akun lain; sistem harus menolak dengan HTTP 409.

CATATAN:
- Akun lama tetap dipertahankan, tetapi player_number-nya NULL sampai diberi nomor.
- File .env tidak disertakan di ZIP. Salin .env milik sendiri ke folder project.
- Player ID merupakan identitas akun; warna RED/BLUE tetap ditentukan saat pemain bergabung ke room.
