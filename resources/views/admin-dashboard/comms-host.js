// ==========================================
// TACTICAL COMMS (HOST) - EMBEDDED IN ADMIN-DASHBOARD
// ==========================================
(function () {
  const $ = (id) => document.getElementById(id);

  const HOST_TOKEN_KEY = 'ops_comms_host_token';
  let hostToken = localStorage.getItem(HOST_TOKEN_KEY);
  if (!hostToken || hostToken.length < 20) {
    hostToken = 'host-' + crypto.randomUUID() + '-' + Date.now();
    localStorage.setItem(HOST_TOKEN_KEY, hostToken);
  }

  let activeRoomId = null;
  let autoSyncedRoomId = null;
  let roomTeams = [];
  let latestPlayers = [];
  let messagesByTeam = {};
  let seenMessageIds = new Set();
  let lastSyncedSignature = '';
  let voiceRoomsByTeam = {};
  let voiceConnected = false;
  let broadcastTarget = 'none'; // 'none' | '<team_key>' | 'all'
  let mutedTeams = {};

  const COMMS_SERVER_URL = window.OPS_API_BASE || window.location.origin;
  const socket = io(COMMS_SERVER_URL, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000
  });

  function setStatus(msg, isError = false) {
    const el = $('commsHostStatus');
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? 'var(--red)' : 'var(--lime)';
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

  function normalizeTeamKey(raw) {
    const v = String(raw || '').trim().toLowerCase();
    if (!v) return '';
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

  function mergeTeamsWithMatchContext(serverTeams = []) {
    const merged = [];
    const byKey = new Map();

    const addOrUpdate = (item) => {
      const key = normalizeTeamKey(item.key || item.team_code || item.code || item.label || item.team_name);
      if (!key) return;
      const rawLabel = String(item.label || item.team_name || item.name || key).trim().toUpperCase();
      const label = rawLabel.endsWith('TEAM') || rawLabel.startsWith('TIM ') ? rawLabel : `${rawLabel} TEAM`;
      const max = Number(item.max ?? item.capacity ?? item.max_players ?? 10) || 10;
      const online = Number(item.online ?? 0);
      const joined = Number(item.joined ?? item.total ?? 0);

      if (byKey.has(key)) {
        const existing = byKey.get(key);
        existing.label = label || existing.label;
        existing.max = max || existing.max;
        existing.online = Math.max(existing.online, online);
        existing.joined = Math.max(existing.joined, joined);
      } else {
        const obj = { key, label, online, joined, max };
        byKey.set(key, obj);
        merged.push(obj);
      }
    };

    const matchCtx = window.activeMatchCommsContext;
    if (matchCtx && Array.isArray(matchCtx.teams)) {
      matchCtx.teams.forEach(addOrUpdate);
    }

    (serverTeams || []).forEach(addOrUpdate);

    return merged;
  }

  function renderRoomList(rooms = []) {
    const container = $('commsHostRoomList');
    if (!container) return;
    if (!rooms.length) {
      container.innerHTML = '<div class="chart-empty">Belum ada Room aktif. Buat dari sini atau tunggu pemain membuat Operation Room.</div>';
      return;
    }
    container.innerHTML = rooms
      .map((r) => {
        const teamBadges = Array.isArray(r.teams) && r.teams.length
          ? r.teams.map((t) => `${escapeHtml(t.label)}: ${t.online}/${t.max}`).join(' · ')
          : `Merah: ${r.red_online}/${r.red_max || 10} · Biru: ${r.blue_online}/${r.blue_max || 10}`;
        return `
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--line);background:#0d151e;margin-bottom:6px;">
            <div>
              <strong style="color:var(--lime);font:700 12px 'DM Mono',monospace;">${escapeHtml(r.room_id)} ${r.room_name && r.room_name !== r.room_id ? `(${escapeHtml(r.room_name)})` : ''}</strong>
              <small style="display:block;color:var(--muted);font:10px 'DM Mono',monospace;">${teamBadges}</small>
            </div>
            <button type="button" class="btn-mini" data-enter-comms="${escapeHtml(r.room_id)}">MASUK MONITOR ↗</button>
          </div>`;
      })
      .join('');

    container.querySelectorAll('[data-enter-comms]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const rid = btn.getAttribute('data-enter-comms');
        socket.emit('host_enter_room', { room_id: rid, host_token: hostToken });
      });
    });
  }

  function renderChatItemToBox(box, msg) {
    const item = document.createElement('div');
    const accent = getTeamAccent(msg.team);
    item.style.cssText = `padding:6px 8px;margin-bottom:6px;border-left:2px solid ${accent};background:#0a1017;font-size:12px;`;
    const badge = msg.source === 'voice' ? '🤖🎙️ STT · ' : '💬 ';
    item.innerHTML = `<div style="display:flex;justify-content:space-between;font:10px 'DM Mono',monospace;color:var(--muted);">
      <strong style="color:${accent};">${badge}${escapeHtml(msg.name)}</strong>
      <span>${formatTime(msg.timestamp)}</span>
    </div>
    <div style="margin-top:2px;">${escapeHtml(msg.message)}</div>`;
    box.appendChild(item);
    box.scrollTop = box.scrollHeight;
  }

  function buildDynamicTeamUI(teams = []) {
    const merged = mergeTeamsWithMatchContext(teams);
    roomTeams = merged.length
      ? merged
      : [
          { key: 'merah', label: 'TIM MERAH', online: 0, joined: 0, max: 10 },
          { key: 'biru', label: 'TIM BIRU', online: 0, joined: 0, max: 10 }
        ];

    // 1. Render tombol target Live Voice untuk setiap tim
    const targetWrap = $('commsHostVoiceTargets');
    if (targetWrap) {
      const teamBtns = roomTeams
        .map(
          (t) =>
            `<button type="button" class="btn-mini" data-voice-target="${escapeHtml(t.key)}">🎙️ ${escapeHtml(t.label)}</button>`
        )
        .join('');
      targetWrap.innerHTML = `
        <span style="font:9px 'DM Mono',monospace;color:var(--muted);margin-right:4px;">LIVE VOICE TARGET:</span>
        <button type="button" class="btn-mini" data-voice-target="none">🔇 MIC OFF</button>
        ${teamBtns}
        <button type="button" class="btn-mini" data-voice-target="all">📢 SEMUA TIM</button>
      `;
      targetWrap.querySelectorAll('[data-voice-target]').forEach((btn) => {
        btn.addEventListener('click', () => applyBroadcastTarget(btn.getAttribute('data-voice-target')));
      });
    }

    // 2. Render kolom Speech-to-Text & roster untuk setiap tim
    const grid = $('commsHostTeamsGrid');
    if (grid) {
      grid.innerHTML = roomTeams
        .map((t) => {
          const accent = getTeamAccent(t.key);
          return `
            <div style="border:1px solid ${accent};background:#0d151e;padding:10px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <strong style="color:${accent};font:700 11px 'DM Mono',monospace;">${escapeHtml(t.label)} (<span id="commsTeamCap_${escapeHtml(t.key)}">${t.online}/${t.max}</span> ANGGOTA)</strong>
                <button type="button" class="btn-mini" data-mute-team="${escapeHtml(t.key)}">${mutedTeams[t.key] ? '🔇 UNMUTE' : '🔊 MUTE'}</button>
              </div>
              <div id="commsHostRoster_${escapeHtml(t.key)}" style="margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--line);"></div>
              <div id="commsHostChat_${escapeHtml(t.key)}" style="height:190px;overflow-y:auto;padding-right:4px;"></div>
            </div>`;
        })
        .join('');

      grid.querySelectorAll('[data-mute-team]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const tk = btn.getAttribute('data-mute-team');
          mutedTeams[tk] = !mutedTeams[tk];
          btn.textContent = mutedTeams[tk] ? '🔇 UNMUTE' : '🔊 MUTE';
          document.querySelectorAll(`audio[data-comms-team="${tk}"]`).forEach((el) => {
            el.muted = Boolean(mutedTeams[tk]);
          });
        });
      });

      // Pulihkan kembali seluruh pesan Speech-to-Text tiap tim setelah grid dibangun ulang
      roomTeams.forEach((t) => {
        const box = $(`commsHostChat_${t.key}`);
        const history = messagesByTeam[t.key] || [];
        if (box && history.length) {
          history.forEach((msg) => renderChatItemToBox(box, msg));
        }
      });
    }

    renderRoster(latestPlayers, roomTeams);
    updateBroadcastButtonsUI();
  }

  function renderRoster(players = [], teams = []) {
    latestPlayers = players || [];
    if (Array.isArray(teams) && teams.length) {
      teams.forEach((t) => {
        const capEl = $(`commsTeamCap_${t.key}`);
        if (capEl) capEl.textContent = `${t.online}/${t.max}`;
      });
    }

    roomTeams.forEach((t) => {
      const box = $(`commsHostRoster_${t.key}`);
      if (!box) return;
      const list = latestPlayers.filter((p) => p.team === t.key);
      box.innerHTML = list.length
        ? list
            .map(
              (p) =>
                `<span style="display:inline-block;padding:2px 7px;margin:2px;border:1px solid var(--line);background:#0a1017;font:10px 'DM Mono',monospace;">${p.online ? '🟢' : '⚫'} ${escapeHtml(p.name)}</span>`
            )
            .join('')
        : `<small style="color:var(--muted);font:10px 'DM Mono',monospace;">Belum ada anggota di ${escapeHtml(t.label)}.</small>`;
    });
  }

  function appendChat(msg) {
    if (!msg || !msg.team) return;
    if (msg.room_id && activeRoomId && msg.room_id !== activeRoomId) return;

    if (msg.message_id) {
      if (seenMessageIds.has(msg.message_id)) return;
      seenMessageIds.add(msg.message_id);
    }

    messagesByTeam[msg.team] = messagesByTeam[msg.team] || [];
    messagesByTeam[msg.team].push(msg);

    const box = $(`commsHostChat_${msg.team}`);
    if (!box) {
      buildDynamicTeamUI([
        ...roomTeams,
        { key: msg.team, label: msg.team_label || msg.team.toUpperCase(), online: 1, joined: 1, max: 10 }
      ]);
      return;
    }

    renderChatItemToBox(box, msg);
  }

  function updateBroadcastButtonsUI() {
    document.querySelectorAll('[data-voice-target]').forEach((btn) => {
      const t = btn.getAttribute('data-voice-target');
      const isActive = broadcastTarget === t;
      btn.style.background = isActive ? 'var(--lime)' : '#111a24';
      btn.style.color = isActive ? '#0a1017' : (t === 'none' || t === 'all' ? 'var(--lime)' : getTeamAccent(t));
      btn.style.borderColor = isActive ? 'var(--lime)' : 'var(--line)';
    });
  }

  async function applyBroadcastTarget(target) {
    broadcastTarget = target;
    updateBroadcastButtonsUI();

    if (!voiceConnected || !Object.keys(voiceRoomsByTeam).length) {
      if (target !== 'none' && activeRoomId) {
        socket.emit('host_voice_tokens_request', {
          room_id: activeRoomId,
          host_token: hostToken
        });
      }
      return;
    }

    try {
      for (const [teamKey, lkRoom] of Object.entries(voiceRoomsByTeam)) {
        const shouldPublish = target === 'all' || target === teamKey;
        await lkRoom.localParticipant.setMicrophoneEnabled(shouldPublish);
      }

      if (target === 'none') {
        setStatus(`Room ${activeRoomId} · Mic Admin OFF (Mode Standby).`);
      } else if (target === 'all') {
        setStatus(`📢 LIVE VOICE BROADCAST -> Mengirim suara ke SELURUH TIM.`);
      } else {
        const found = roomTeams.find((t) => t.key === target);
        setStatus(`🎙️ LIVE VOICE AKTIF -> Mengirim suara ke ${found ? found.label : target.toUpperCase()}.`);
      }
    } catch (err) {
      setStatus('Gagal mengatur mikrofon: ' + err.message, true);
    }
  }

  async function disconnectVoice() {
    voiceConnected = false;
    broadcastTarget = 'none';
    updateBroadcastButtonsUI();
    for (const r of Object.values(voiceRoomsByTeam)) {
      if (r) {
        try {
          await r.disconnect();
        } catch (_) {}
      }
    }
    voiceRoomsByTeam = {};
    document.querySelectorAll('audio[data-comms-team]').forEach((el) => el.remove());
  }

  async function connectTeamChannel(url, token, teamTag) {
    const room = new LivekitClient.Room({ adaptiveStream: true, dynacast: true });
    room.on(LivekitClient.TrackSubscribed, (track) => {
      if (track.kind === LivekitClient.Track.Kind.Audio) {
        const el = track.attach();
        el.autoplay = true;
        el.dataset.commsTeam = teamTag;
        el.muted = Boolean(mutedTeams[teamTag]);
        document.body.appendChild(el);
      }
    });
    room.on(LivekitClient.TrackUnsubscribed, (track) => {
      track.detach().forEach((el) => el.remove());
    });
    await room.connect(url, token);
    return room;
  }

  function enterMonitorView(data) {
    const isDifferentRoom = activeRoomId !== data.room_id;
    activeRoomId = data.room_id;

    if (isDifferentRoom) {
      messagesByTeam = {};
      seenMessageIds = new Set();
    }

    $('commsHostLobbyBox')?.classList.add('hidden');
    $('commsHostMonitorBox')?.classList.remove('hidden');
    if ($('commsHostActiveCode')) $('commsHostActiveCode').textContent = data.room_id;

    const byTeam = data.messages_by_team || {
      merah: data.red_messages || [],
      biru: data.blue_messages || []
    };
    Object.entries(byTeam).forEach(([teamKey, list]) => {
      messagesByTeam[teamKey] = messagesByTeam[teamKey] || [];
      (list || []).forEach((msg) => {
        if (msg.message_id && seenMessageIds.has(msg.message_id)) return;
        if (msg.message_id) seenMessageIds.add(msg.message_id);
        messagesByTeam[teamKey].push(msg);
      });
    });

    latestPlayers = data.players || [];
    buildDynamicTeamUI(data.teams || []);

    setStatus(`Room ${data.room_id} aktif (${roomTeams.length} tim) · Pilih target Live Voice di bawah.`);
    socket.emit('host_voice_tokens_request', {
      room_id: activeRoomId,
      host_token: hostToken
    });
  }

  function exitMonitorView() {
    activeRoomId = null;
    autoSyncedRoomId = null;
    messagesByTeam = {};
    seenMessageIds = new Set();
    disconnectVoice();
    $('commsHostMonitorBox')?.classList.add('hidden');
    $('commsHostLobbyBox')?.classList.remove('hidden');
  }

  function syncWithActiveMatch(ctx) {
    if (!ctx || !ctx.room_code) {
      lastSyncedSignature = '';
      if (activeRoomId && activeRoomId === autoSyncedRoomId) {
        exitMonitorView();
        setStatus('STANDBY · Tidak ada pertandingan aktif.');
      }
      return;
    }

    if (!socket.connected) return;

    const teamsPayload = (ctx.teams || []).map((t) => ({
      code: normalizeTeamKey(t.team_code),
      name: `${t.team_name || t.team_code} TEAM`,
      max_players: Number(t.capacity || 10)
    }));
    const sig = `${ctx.room_code}|${teamsPayload.map((t) => `${t.code}:${t.max_players}`).join(',')}`;
    if (sig === lastSyncedSignature && activeRoomId === ctx.room_code) return;
    lastSyncedSignature = sig;
    autoSyncedRoomId = ctx.room_code;

    const hostName = ($('commsHostName')?.value || '').trim() || 'Command Center';
    socket.emit('host_create_room', {
      room_id: ctx.room_code,
      room_name: ctx.match_name || ctx.room_code,
      host_token: hostToken,
      host_name: hostName,
      teams: teamsPayload
    });
  }

  // Socket.IO Events
  socket.on('connect', () => {
    lastSyncedSignature = '';
    socket.emit('host_register', { host_token: hostToken });
    if (window.activeMatchCommsContext) {
      syncWithActiveMatch(window.activeMatchCommsContext);
    } else if (!activeRoomId) {
      setStatus('CONNECTED · Siap memantau Comms Room.');
    }
  });

  socket.on('connect_error', () => {
    setStatus('COMMS OFFLINE · Gagal terhubung ke server Socket.IO.', true);
  });

  socket.on('host_registered', (data) => renderRoomList(data?.rooms || []));
  socket.on('host_room_list_update', (data) => renderRoomList(data?.rooms || []));

  socket.on('host_room_created', (data) => {
    if (data?.room?.room_id) {
      enterMonitorView({
        room_id: data.room.room_id,
        teams: data.room.teams || [],
        players: latestPlayers,
        messages_by_team: messagesByTeam
      });
    }
  });

  socket.on('host_monitor_joined', (data) => enterMonitorView(data));

  socket.on('host_room_roster', (data) => {
    if (data.room_id === activeRoomId) {
      latestPlayers = data.players || [];
      const merged = mergeTeamsWithMatchContext(data.teams || []);
      const oldKeys = roomTeams.map((t) => t.key).join(',');
      const newKeys = merged.map((t) => t.key).join(',');
      if (oldKeys !== newKeys) {
        buildDynamicTeamUI(merged);
      } else {
        renderRoster(latestPlayers, merged);
      }
    }
  });

  socket.on('host_chat_update', (msg) => appendChat(msg));

  socket.on('host_voice_tokens', async (data) => {
    if (typeof LivekitClient === 'undefined') {
      setStatus('Library LiveKit belum dimuat.', true);
      return;
    }
    try {
      const pendingTarget = broadcastTarget;
      await disconnectVoice();
      setStatus('Menghubungkan saluran suara Command Center...');
      const channels = data.channels || {
        merah: data.red,
        biru: data.blue
      };
      for (const [teamKey, info] of Object.entries(channels)) {
        if (info?.token) {
          voiceRoomsByTeam[teamKey] = await connectTeamChannel(data.url, info.token, teamKey);
        }
      }
      voiceConnected = true;
      await applyBroadcastTarget(pendingTarget);
    } catch (err) {
      setStatus('Gagal terhubung ke LiveKit: ' + err.message, true);
    }
  });

  socket.on('host_room_closed', () => {
    exitMonitorView();
    setStatus('Comms Room telah ditutup.');
  });

  socket.on('host_error', (err) => setStatus(err?.message || 'Error Host', true));
  socket.on('voice_error', (err) => setStatus(err?.message || 'Error Audio', true));

  window.addEventListener('ops-match-comms-sync', (e) => {
    syncWithActiveMatch(e.detail);
  });

  function setupHostCommsUI() {
    $('commsHostCreateBtn')?.addEventListener('click', () => {
      const hostName = ($('commsHostName')?.value || '').trim() || 'Command Center';
      const ctx = window.activeMatchCommsContext;
      const teamsPayload = (ctx?.teams || []).map((t) => ({
        code: normalizeTeamKey(t.team_code),
        name: `${t.team_name || t.team_code} TEAM`,
        max_players: Number(t.capacity || 10)
      }));
      socket.emit('host_create_room', {
        room_id: ctx?.room_code || undefined,
        room_name: ctx?.match_name || undefined,
        host_token: hostToken,
        host_name: hostName,
        teams: teamsPayload
      });
    });

    $('commsHostCloseRoomBtn')?.addEventListener('click', () => {
      if (!activeRoomId) return;
      if (!confirm(`Tutup Comms Room ${activeRoomId}?`)) return;
      socket.emit('host_close_room', { room_id: activeRoomId, host_token: hostToken });
    });

    if (window.activeMatchCommsContext) {
      syncWithActiveMatch(window.activeMatchCommsContext);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupHostCommsUI);
  } else {
    setupHostCommsUI();
  }
})();