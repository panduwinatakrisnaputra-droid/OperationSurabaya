PLAYER PORTAL SESSION PERSISTENCE UPDATE

Changes:
- Player access token is stored in localStorage instead of sessionStorage.
- Existing sessionStorage access tokens are migrated to localStorage.
- Player profile, current room, team assignment, and last portal view are persisted locally.
- On page reload, the Player Portal restores Room Browser or Waiting Lobby.
- If the restored room is already active, the lobby refresh flow reopens Gameplay.
- Explicit LOG OUT actions clear the persistent token and saved portal context.

Deployment:
1. Deploy the updated Player Portal resources/views/player-app/app.js.
2. No Supabase migration is required.
3. Restart/redeploy the web application and hard-refresh the browser.
4. Players should log in once after this update so their profile and current screen are saved.

Note: This change preserves the existing backend authentication mechanism. The current backend issues deterministic session-like tokens; production-grade token expiry/revocation should be implemented separately if the authentication system is upgraded.
