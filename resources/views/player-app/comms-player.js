// ==========================================
// TACTICAL COMMS (PLAYER: REAL-TIME GAMEPLAY SYNC + AI STT + UNMUTABLE ADMIN VOICE)
// ==========================================
(function () {
  const $ = (id) => document.getElementById(id);

  const PLAYER_TOKEN_KEY = 'ops_comms_player_token';
  let playerToken = localStorage.getItem(PLAYER_TOKEN_KEY);
  if (!playerToken || playerToken.length < 20) {
    playerToken = 'player-' + crypto.randomUUID() + '-' + Date.now();
    localStorage.setItem(PLAYER_TOKEN_KEY, playerToken);
  }

  let currentRoomId = null;
  let currentTeam = null;
  let joinedSignature = '';
  let audioReceiverRoom = null;
  let recognition = null;
  let sttActive = false;
  let lastInterimBuffer = '';
  let silenceTimer = null;

  // Gunakan base URL yang sama dengan app.js agar Socket.IO konsisten di semua port/tunnel
  const COMMS_SERVER_URL = window.OPS_API_BASE || window.location.origin;
  const socket = io(COMMS_SERVER_URL, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000
  });

  function setStatus(msg, isError = false) {
    const el = $('commsPlayerStatus');
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? '#ff858a' : '#c7f36b';
  }

  function setPreview(msg) {
    const preview = $('commsPlayerSttPreview');
    if (preview) preview.textContent = msg || '';
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatTime(iso) {
    if (!iso) return '--:--';
    try {
      return new Date(iso).toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch (_) {
      return '--:--';
    }
  }

  function normalizeTeamCode(raw) {
    const v = String(raw || '').trim().toLowerCase();
    if (!v || v === 'unknown' || v === 'not assigned' || v === 'team') return '';
    if (v === 'red' || v === 'merah' || v.includes('red') || v.includes('merah')) return 'merah';
    if (v === 'blue' || v === 'biru' || v.includes('blue') || v.includes('biru')) return 'biru';
    return v.replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  }

  function getTeamAccent(teamKey) {
    if (teamKey === 'merah') return '#ff4d4d';
    if (teamKey === 'biru') return '#3b9eff';
    if (teamKey === 'green' || teamKey === 'hijau') return '#22c55e';
    if (teamKey === 'yellow' || teamKey === 'kuning') return '#eab308';
    return '#c7f36b';
  }

  function extractPlayerAppContext(overrideCtx = null) {
    let ctx = overrideCtx;
    if (!ctx) {
      try {
        ctx = JSON.parse(localStorage.getItem('player_portal_context') || 'null');
      } catch (_) {}
    }

    const lobbyVisible = $('lobbyPanel') && !$('lobbyPanel').classList.contains('hidden');
    const gameplayVisible = $('gameplayPanel') && !$('gameplayPanel').classList.contains('hidden');
    const isInActiveSquad = Boolean(
      lobbyVisible ||
      gameplayVisible ||
      (ctx && (ctx.view === 'lobby' || ctx.view === 'gameplay') && ctx.match && ctx.teamCode)
    );

    const domRoomCode = ($('lobbyRoomCode')?.textContent || '').trim().toUpperCase();
    const validDomCode = domRoomCode && domRoomCode !== '--------' && domRoomCode !== 'ROOM CODE UNAVAILABLE'
      ? domRoomCode
      : '';

    const roomCode = (
      String(ctx?.match?.room_code || ctx?.roomCode || ctx?.room?.code || ctx?.room_id || '').trim().toUpperCase() ||
      validDomCode
    );

    const roomName = (
      ($('gameplayMatchName')?.textContent || '').trim() ||
      String(ctx?.match?.match_name || ctx?.roomName || ctx?.room?.name || roomCode).trim()
    );

    let playerName = '';
    if (ctx?.player) {
      const num = ctx.player.player_number ? `#${ctx.player.player_number} ` : '';
      playerName = (num + (ctx.player.full_name || ctx.player.username || '')).trim();
    }
    if (!playerName) {
      const lobbyWelcome = ($('lobbyWelcome')?.textContent || '').trim();
      if (lobbyWelcome && lobbyWelcome !== 'Pemain') playerName = lobbyWelcome;
    }
    if (!playerName) playerName = 'Player';

    const domAssignment = ($('assignment')?.textContent || '').trim();
    const domBadge = ($('gameplayTeamBadge')?.textContent || '').trim();
    const rawTeam = (
      String(window.currentPlayerTeam || ctx?.teamCode || ctx?.team || '').trim() ||
      (domAssignment !== '—' && domAssignment !== 'NOT ASSIGNED' ? domAssignment : '') ||
      (domBadge !== 'TEAM' ? domBadge : '')
    );
    const teamKey = normalizeTeamCode(rawTeam);

    const teamsConfig = [];
    const seenKeys = new Set();

    const matchTeams = Array.isArray(ctx?.match?.teams)
      ? ctx.match.teams
      : Array.isArray(ctx?.teams)
      ? ctx.teams
      : [];

    matchTeams.forEach((t) => {
      const rawCode = t.team_code || t.code || t.team || t.team_name || t.name;
      const key = normalizeTeamCode(rawCode);
      if (key && !seenKeys.has(key)) {
        seenKeys.add(key);
        const label = String(t.team_name || t.name || rawCode || key).trim().toUpperCase();
        teamsConfig.push({
          code: key,
          name: label.endsWith('TEAM') ? label : `${label} TEAM`,
          max_players: parseInt(t.capacity || t.max_players || t.max || 10, 10) || 10
        });
      }
    });

    document.querySelectorAll('#lobbyTeams .lobby-team, #lobbyTeams [data-team], #lobbyTeams > section').forEach((card) => {
      const codeAttr = card.getAttribute('data-team') || '';
      const codeLabel = (card.querySelector('.team-code-label')?.textContent || '')
        .replace(/^TEAM CODE:\s*/i, '')
        .trim();
      const heading = (card.querySelector('h3, h4, strong, .team-name')?.textContent || '').trim();
      const countText = card.textContent || '';
      const matchCap = countText.match(/(\d+)\s*\/\s*(\d+)/);
      const rawIdentifier = codeAttr || codeLabel || heading;
      const key = normalizeTeamCode(rawIdentifier);
      if (key && !seenKeys.has(key)) {
        seenKeys.add(key);
        teamsConfig.push({
          code: key,
          name: (heading || rawIdentifier).toUpperCase(),
          max_players: matchCap ? parseInt(matchCap[2], 10) : 10
        });
      }
    });

    if (teamKey && !seenKeys.has(teamKey)) {
      seenKeys.add(teamKey);
      teamsConfig.push({
        code: teamKey,
        name: rawTeam ? rawTeam.toUpperCase() : teamKey.toUpperCase(),
        max_players: 10
      });
    }

    return {
      isInActiveSquad,
      matchStatus: ctx?.matchStatus || ctx?.match?.status || null,
      roomCode,
      roomName,
      playerName,
      teamKey,
      teamLabel: rawTeam ? rawTeam.toUpperCase() : teamKey.toUpperCase(),
      teamsConfig
    };
  }

  function renderTeamStats(teamStats = [], activeTeamKey = '') {
    const bar = $('commsPlayerAllTeamsBar');
    const capBadge = $('commsPlayerSquadCapacity');
    if (!Array.isArray(teamStats) || !teamStats.length) return;

    if (bar) {
      bar.innerHTML = teamStats
        .map((t) => {
          const accent = getTeamAccent(t.key);
          const isCurrent = t.key === activeTeamKey;
          return `<span style="font:700 10px 'DM Mono',monospace;padding:3px 8px;border:1px solid ${isCurrent ? accent : 'rgba(255,255,255,0.15)'};background:rgba(10,16,23,0.85);color:${accent};">
            ${escapeHtml(t.label)}: ${t.online}/${t.max}
          </span>`;
        })
        .join('');
    }

    const myTeamStat = teamStats.find((t) => t.key === activeTeamKey);
    if (capBadge && myTeamStat) {
      capBadge.textContent = `${myTeamStat.label}: ${myTeamStat.online}/${myTeamStat.max} ANGGOTA`;
      capBadge.style.color = getTeamAccent(activeTeamKey);
      capBadge.style.borderColor = getTeamAccent(activeTeamKey);
    }
  }

  function renderRoster(players = []) {
    const el = $('commsPlayerRoster');
    if (!el) return;
    el.innerHTML = players.length
      ? players
          .map(
            (p) =>
              `<span style="display:inline-block;padding:2px 8px;margin:2px;border:1px solid rgba(255,255,255,0.12);background:rgba(10,16,23,0.75);font-size:11px;">${p.online ? '🟢' : '⚫'} ${escapeHtml(p.name)}</span>`
          )
          .join('')
      : '<small style="opacity:0.65;">Menunggu anggota tim lain bergabung...</small>';
  }

  function appendChat(msg) {
    const box = $('commsPlayerChatBox');
    if (!box) return;
    const item = document.createElement('div');
    const accent = getTeamAccent(msg.team);
    item.style.cssText = `padding:6px 8px;margin-bottom:6px;border-left:2px solid ${accent};background:rgba(255,255,255,0.04);font-size:12px;`;
    const badge = msg.source === 'voice' ? '🤖🎙️ AI STT · ' : '💬 ';
    item.innerHTML = `<div style="display:flex;justify-content:space-between;font-size:10px;opacity:0.75;">
      <strong style="color:${accent};">${badge}${escapeHtml(msg.name)}</strong>
      <span>${formatTime(msg.timestamp)}</span>
    </div>
    <div style="margin-top:2px;">${escapeHtml(msg.message)}</div>`;
    box.appendChild(item);
    box.scrollTop = box.scrollHeight;
  }

  function appendNotice(text) {
    const box = $('commsPlayerChatBox');
    if (!box) return;
    const item = document.createElement('div');
    item.style.cssText = 'padding:4px 8px;margin-bottom:5px;font-size:11px;opacity:0.65;text-align:center;';
    item.textContent = `— ${text} —`;
    box.appendChild(item);
    box.scrollTop = box.scrollHeight;
  }

  function enforceUnmutedAdminAudio(el) {
    if (!el) return;
    el.muted = false;
    el.volume = 1.0;
    el.addEventListener('volumechange', () => {
      if (el.muted || el.volume < 1.0) {
        el.muted = false;
        el.volume = 1.0;
      }
    });
  }

  async function disconnectAdminAudio() {
    if (audioReceiverRoom) {
      try {
        await audioReceiverRoom.disconnect();
      } catch (_) {}
      audioReceiverRoom = null;
    }
    document.querySelectorAll('audio[data-comms-admin-audio]').forEach((el) => el.remove());
  }

  function sendVoiceTranscript(text) {
    const clean = String(text || '').trim();
    if (!clean) return;
    if (!socket.connected || !currentRoomId) {
      setStatus('Menunggu koneksi radio tim...', true);
      return;
    }
    socket.emit('send_text', { message: clean, source: 'voice' });
    lastInterimBuffer = '';
    setPreview('✅ Terkirim: "' + clean + '"');
  }

  function stopStt() {
    sttActive = false;
    clearTimeout(silenceTimer);
    if (lastInterimBuffer.trim()) {
      sendVoiceTranscript(lastInterimBuffer);
    }
    if (recognition) {
      try {
        recognition.onend = null;
        recognition.stop();
      } catch (_) {}
      recognition = null;
    }
    const btn = $('commsPlayerSttBtn');
    if (btn) {
      btn.textContent = '🤖🎙️ MULAI AI SPEECH-TO-TEXT';
      btn.style.background = '';
      btn.style.color = '';
    }
    setPreview('');
  }

  async function toggleStt() {
    if (sttActive) {
      stopStt();
      setStatus('AI Speech-to-Text dinonaktifkan.');
      return;
    }

    if (!window.isSecureContext) {
      setStatus('Mic diblokir browser karena bukan HTTPS / localhost.', true);
      return;
    }

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      setStatus('Browser tidak mendukung AI Speech-to-Text. Gunakan Google Chrome atau Microsoft Edge.', true);
      return;
    }

    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      }
    } catch (err) {
      setStatus('Izin mikrofon ditolak browser: ' + err.message, true);
      return;
    }

    recognition = new SpeechRec();
    recognition.lang = 'id-ID';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onaudiostart = () => setPreview('🎙️ Mikrofon aktif — silakan berbicara...');
    recognition.onspeechstart = () => setPreview('🗣️ Suara terdeteksi, sedang mentranskripsi...');

    recognition.onresult = (event) => {
      clearTimeout(silenceTimer);
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const transcript = (res[0]?.transcript || '').trim();
        if (res.isFinal) {
          if (transcript) sendVoiceTranscript(transcript);
          interimText = '';
          lastInterimBuffer = '';
        } else {
          interimText += transcript + ' ';
        }
      }

      if (interimText.trim()) {
        lastInterimBuffer = interimText.trim();
        setPreview(`Mendengarkan: "${lastInterimBuffer}..."`);
        silenceTimer = setTimeout(() => {
          if (lastInterimBuffer.trim()) sendVoiceTranscript(lastInterimBuffer);
        }, 1800);
      }
    };

    recognition.onerror = (e) => {
      if (e.error === 'no-speech') {
        setPreview('⏳ Tidak ada suara terdeteksi, tetap mendengarkan...');
        return;
      }
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        sttActive = false;
        stopStt();
        setStatus('Izin mikrofon atau layanan Speech browser diblokir.', true);
        return;
      }
      if (e.error === 'network') {
        setStatus('Error jaringan Speech API.', true);
        return;
      }
      setStatus('AI Speech-to-Text error: ' + e.error, true);
    };

    recognition.onend = () => {
      if (sttActive && recognition) {
        setTimeout(() => {
          if (!sttActive || !recognition) return;
          try { recognition.start(); } catch (_) {}
        }, 150);
      }
    };

    try {
      sttActive = true;
      lastInterimBuffer = '';
      recognition.start();
      const btn = $('commsPlayerSttBtn');
      if (btn) {
        btn.textContent = '⏹️ STOP AI SPEECH-TO-TEXT';
        btn.style.background = '#c7f36b';
        btn.style.color = '#0a1017';
      }
      setPreview('🎙️ Menyiapkan mikrofon...');
      setStatus('AI Speech-to-Text aktif. Ucapkan pesan taktis untuk tim Anda.');
    } catch (err) {
      sttActive = false;
      setStatus('Gagal memulai Speech-to-Text: ' + err.message, true);
    }
  }

  function teardownCommsSession(hidePanel = true) {
    const panel = $('commsPlayerPanel');
    if (hidePanel && panel && !panel.classList.contains('hidden')) {
      panel.classList.add('hidden');
    }
    if (currentRoomId) {
      socket.emit('player_leave_room');
      currentRoomId = null;
      currentTeam = null;
      joinedSignature = '';
    }
    disconnectAdminAudio();
    stopStt();
  }

  function syncCommsWithPlayerState(overrideCtx = null) {
    const panel = $('commsPlayerPanel');
    if (!panel) return;

    const info = extractPlayerAppContext(overrideCtx);

    if (!info.isInActiveSquad || !info.roomCode || !info.teamKey) {
      teardownCommsSession(true);
      return;
    }

    if (panel.classList.contains('hidden')) {
      panel.classList.remove('hidden');
    }

    // Hentikan STT jika match sudah completed namun tetap tampilkan log chat
    if (info.matchStatus === 'completed') {
      if (sttActive) stopStt();
      setStatus('Pertandingan selesai · Riwayat komunikasi tim tersedia.');
    }

    const teamsSig = (info.teamsConfig || []).map((t) => `${t.code}:${t.max_players}`).join(',');
    const sig = `${info.roomCode}|${info.teamKey}|${info.playerName}|${teamsSig}`;

    if (sig !== joinedSignature && socket.connected) {
      joinedSignature = sig;
      socket.emit('player_join_room', {
        room_id: info.roomCode,
        room_name: info.roomName,
        name: info.playerName,
        team: info.teamKey,
        teams: info.teamsConfig,
        player_token: playerToken,
        auto_create: true
      });
    }
  }

  // Socket.IO Events
  socket.on('connect', () => {
    joinedSignature = '';
    syncCommsWithPlayerState();
  });

  socket.on('connect_error', () => {
    setStatus('Gagal terhubung ke server Comms. Periksa koneksi server.', true);
  });

  socket.on('player_joined', (data) => {
    currentRoomId = data.room_id;
    currentTeam = data.team;
    if (data.player_token) {
      playerToken = data.player_token;
      localStorage.setItem(PLAYER_TOKEN_KEY, playerToken);
    }

    const badge = $('commsPlayerTeamTag');
    if (badge) {
      badge.textContent = `${data.room_id} · ${data.team_label || data.team.toUpperCase()}`;
      badge.style.color = getTeamAccent(data.team);
    }

    const box = $('commsPlayerChatBox');
    if (box) box.innerHTML = '';
    (data.messages || []).forEach(appendChat);
    renderRoster(data.players || []);
    renderTeamStats(data.team_stats || [], data.team);
    setStatus(`Radio Tim Terhubung · ${data.team_label || data.team.toUpperCase()}`);

    socket.emit('player_voice_token_request');
  });

  socket.on('room_roster', (data) => {
    if (data.room_id === currentRoomId) {
      if (data.team === currentTeam) {
        renderRoster(data.players || []);
      }
      renderTeamStats(data.team_stats || [], currentTeam);
    }
  });

  socket.on('chat_update', (msg) => appendChat(msg));
  socket.on('system_notice', (data) => {
    if (data?.message) appendNotice(data.message);
  });

  socket.on('player_voice_token', async (data) => {
    if (typeof LivekitClient === 'undefined') return;
    try {
      await disconnectAdminAudio();
      audioReceiverRoom = new LivekitClient.Room({ adaptiveStream: true, dynacast: true });
      audioReceiverRoom.on(LivekitClient.RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === LivekitClient.Track.Kind.Audio) {
          const el = track.attach();
          el.autoplay = true;
          el.dataset.commsAdminAudio = '1';
          enforceUnmutedAdminAudio(el);
          document.body.appendChild(el);
        }
      });
      audioReceiverRoom.on(LivekitClient.RoomEvent.TrackUnsubscribed, (track) => {
        track.detach().forEach((el) => el.remove());
      });
      await audioReceiverRoom.connect(data.url, data.token);
    } catch (err) {
      console.warn('Penerima audio Admin gagal terhubung:', err);
    }
  });

  socket.on('room_closed', (data) => {
    teardownCommsSession(false);
    setStatus(data?.message || 'Channel Comms ditutup oleh Admin.', true);
  });

  socket.on('player_error', (err) => {
    joinedSignature = '';
    setStatus(err?.message || 'Error Comms', true);
  });
  socket.on('message_error', (err) => setStatus(err?.message || 'Error Pesan', true));

  // Event langsung dari app.js setiap kali state Lobby / Gameplay berubah
  window.addEventListener('ops-player-state-sync', (event) => {
    syncCommsWithPlayerState(event?.detail?.context || null);
  });

  // UI Bindings & Observer Fallback
  document.addEventListener('DOMContentLoaded', () => {
    $('commsPlayerSttBtn')?.addEventListener('click', toggleStt);

    $('commsPlayerSendBtn')?.addEventListener('click', () => {
      const input = $('commsPlayerChatInput');
      const text = (input?.value || '').trim();
      if (!text) return;
      socket.emit('send_text', { message: text, source: 'text' });
      input.value = '';
    });

    $('commsPlayerChatInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        $('commsPlayerSendBtn')?.click();
      }
    });

    const observer = new MutationObserver(() => syncCommsWithPlayerState());
    ['lobbyPanel', 'gameplayPanel', 'roomPanel', 'teamPanel', 'loginPanel'].forEach((id) => {
      const el = $(id);
      if (el) observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    });
    ['lobbyRoomCode', 'assignment', 'gameplayTeamBadge', 'lobbyTeams'].forEach((id) => {
      const el = $(id);
      if (el) observer.observe(el, { childList: true, subtree: true, characterData: true });
    });

    syncCommsWithPlayerState();
    setInterval(() => syncCommsWithPlayerState(), 2500);
  });
})();