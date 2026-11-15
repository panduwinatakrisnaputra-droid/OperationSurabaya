from fastapi import HTTPException
from supabase import create_client
from config.database import supabase, supabase_auth
from config.config import SUPABASE_URL, SUPABASE_KEY
from app.Models.player import PlayerRegister, PlayerLogin, PlayerLogout

def register_player(player: PlayerRegister):
    auth_user_id = None

    try:
        email = player.email.strip().lower()
        username = player.username.strip()

        # 1. Periksa apakah username sudah digunakan
        username_check = (
            supabase.table("players")
            .select("id, email")
            .eq("username", username)
            .limit(1)
            .execute()
        )

        # 2. Cari profil lama berdasarkan email
        email_check = (
            supabase.table("players")
            .select("id, email, auth_user_id")
            .eq("email", email)
            .limit(1)
            .execute()
        )

        existing_player = (
            email_check.data[0] if email_check.data else None
        )

        # Username tidak boleh dipakai pemain lain
        if username_check.data:
            username_owner = username_check.data[0]

            if (
                not existing_player
                or username_owner["id"] != existing_player["id"]
            ):
                raise HTTPException(
                    status_code=409,
                    detail="Username sudah digunakan"
                )

        # Profil sudah terhubung dengan akun Auth
        if existing_player and existing_player.get("auth_user_id"):
            raise HTTPException(
                status_code=409,
                detail="Email sudah terdaftar. Silakan login."
            )

        # 3. Buat akun di Supabase Authentication
        auth_response = supabase.auth.admin.create_user({
            "email": email,
            "password": player.password,
            "email_confirm": True
        })

        auth_user = auth_response.user

        if not auth_user:
            raise Exception("Gagal membuat akun Supabase Auth")

        auth_user_id = auth_user.id

        # 4. Hubungkan akun Auth dengan profil pemain
        if existing_player:
            profile_response = (
                supabase.table("players")
                .update({
                    "auth_user_id": auth_user_id,
                    "username": username,
                    "full_name": player.full_name,
                    "email": email,
                    "status": "offline"
                })
                .eq("id", existing_player["id"])
                .execute()
            )
        else:
            profile_response = (
                supabase.table("players")
                .insert({
                    "auth_user_id": auth_user_id,
                    "username": username,
                    "full_name": player.full_name,
                    "email": email,
                    "status": "offline"
                })
                .execute()
            )

        if not profile_response.data:
            raise Exception("Gagal menyimpan profil pemain")

        return {
            "success": True,
            "message": "Registrasi berhasil. Silakan login.",
            "player": profile_response.data[0]
        }

    except HTTPException:
        raise

    except Exception as error:
        # Hapus akun Auth jika pembuatan profil gagal
        if auth_user_id:
            try:
                supabase.auth.admin.delete_user(auth_user_id)
            except Exception as cleanup_error:
                print("AUTH CLEANUP ERROR:", repr(cleanup_error))

        print("REGISTER ERROR:", repr(error))

        raise HTTPException(
            status_code=500,
            detail="Registrasi gagal. Periksa backend."
        )





def login_player(player: PlayerLogin):
    try:
        email = player.email.strip().lower()

        # 1. Verifikasi email dan password
        auth_response = supabase_auth.auth.sign_in_with_password({
            "email": email,
            "password": player.password
        })

        user = auth_response.user
        session = auth_response.session

        if not user or not session:
            raise HTTPException(
                status_code=401,
                detail="Email atau password salah"
            )

        # 2. Cari profil berdasarkan UUID Auth
        profile = (
            supabase.table("players")
            .select("id, username, full_name, email, status, auth_user_id")
            .eq("auth_user_id", user.id)
            .limit(1)
            .execute()
        )

        # 3. Jika tidak ditemukan, cari berdasarkan email
        if not profile.data:
            profile = (
                supabase.table("players")
                .select("id, username, full_name, email, status, auth_user_id")
                .ilike("email", email)
                .limit(1)
                .execute()
            )

            # Profil benar-benar tidak ditemukan
            if not profile.data:
                print("LOGIN DEBUG - AUTH USER ID:", user.id)
                print("LOGIN DEBUG - EMAIL:", email)
                print("LOGIN DEBUG - PROFILE:", profile.data)

                raise HTTPException(
                    status_code=404,
                    detail=(
                        "Akun Auth ditemukan, tetapi profil pemain "
                        "tidak ditemukan di database backend."
                    )
                )

            player_data = profile.data[0]

            # Jangan menghubungkan profil milik akun lain
            if (
                player_data.get("auth_user_id")
                and player_data["auth_user_id"] != user.id
            ):
                raise HTTPException(
                    status_code=409,
                    detail="Profil ini sudah terhubung dengan akun lain."
                )

            # 4. Hubungkan profil lama dengan UUID Auth
            if not player_data.get("auth_user_id"):
                linked = (
                    supabase.table("players")
                    .update({"auth_user_id": user.id})
                    .eq("id", player_data["id"])
                    .execute()
                )

                if not linked.data:
                    raise Exception(
                        "Gagal menghubungkan profil dengan akun Auth"
                    )

                player_data = linked.data[0]

        else:
            player_data = profile.data[0]

        # 5. Update status pemain
        updated = (
            supabase.table("players")
            .update({"status": "online"})
            .eq("id", player_data["id"])
            .execute()
        )

        if updated.data:
            player_data["status"] = "online"

        print("LOGIN BERHASIL:", user.id, player_data["username"])

        return {
            "success": True,
            "message": "Login berhasil",
            "access_token": session.access_token,
            "refresh_token": session.refresh_token,
            "player": player_data
        }

    except HTTPException:
        raise

    except Exception as error:
        print("LOGIN ERROR:", repr(error))

        raise HTTPException(
            status_code=401,
            detail="Login gagal. Periksa konfigurasi backend."
        )



def logout_player(data: PlayerLogout):
    try:
        # Buat client Supabase khusus sesi pengguna
        user_client = create_client(
            SUPABASE_URL,
            os.getenv("SUPABASE_ANON_KEY")
        )

        # Pasang access token pengguna
        user_client.auth.set_session(
            data.access_token,
            ""
        )

        # Ambil identitas pengguna
        user = user_client.auth.get_user(data.access_token).user

        if not user:
            raise HTTPException(
                status_code=401,
                detail="Sesi tidak valid"
            )

        # Ubah status pemain menjadi offline
        supabase.table("players").update({
            "status": "offline"
        }).eq("auth_user_id", user.id).execute()

        # Logout dari Supabase Auth
        user_client.auth.sign_out()

        return {
            "success": True,
            "message": "Logout berhasil"
        }

    except HTTPException:
        raise

    except Exception:
        raise HTTPException(
            status_code=401,
            detail="Gagal melakukan logout"
        )
    


def get_players():
    try:
        response = (
            supabase.table("players")
            .select("*")
            .execute()
        )

        return {
            "success": True,
            "total": len(response.data),
            "data": response.data
        }

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error)
        )
        # ==========================================
