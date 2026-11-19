const API_BASE = 'http://127.0.0.1:8000';

const start = document.getElementById('startBtn');
const stop = document.getElementById('stopBtn');
const state = document.getElementById('matchState');
const deleteAllBtn = document.getElementById('deleteAllBtn');
const recenterMapBtn = document.getElementById('recenterMapBtn');

let currentMatch = null;
let refreshTimer = null;

// Koordinat Arena Surabaya (PENS)
const ARENA_CENTER = [-7.2758, 112.7949];
const LEGACY_BASE_COORDS = { RED: [-7.2758, 112.7940], BLUE: [-7.2758, 112.7958] };

let tacticalMap = null;
let playerMarkersLayer = null;
let baseMarkersLayer = null;

// ==============================
// INITIALIZE TACTICAL MAP
// ==============================

function initTacticalMap() {
    const mapEl = document.getElementById('tacticalMap');
    if (!mapEl || typeof L === 'undefined') return;

    tacticalMap = L.map('tacticalMap', {
        center: ARENA_CENTER,
        zoom: 17,
        zoomControl: true
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 20,
        attribution: '&copy; OpenStreetMap'
    }).addTo(tacticalMap);

    // Batas Zona Arena
    L.circle(ARENA_CENTER, {
        radius: 150,
        color: '#a3e635',
        weight: 1,
        dashArray: '4 4',
        fillColor: '#a3e635',
        fillOpacity: 0.04
    }).addTo(tacticalMap);

    baseMarkersLayer = L.layerGroup().addTo(tacticalMap);
    playerMarkersLayer = L.layerGroup().addTo(tacticalMap);

    setTimeout(() => {
        tacticalMap.invalidateSize();
    }, 250);
}

if (recenterMapBtn) {
    recenterMapBtn.addEventListener('click', () => {
        if (!tacticalMap) return;
        tacticalMap.setView(ARENA_CENTER, 17);
        tacticalMap.invalidateSize();
    });
}

// ==============================
// API
// ==============================

async function api(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(body.detail || `HTTP ${response.status}`);
    }

    return body;
}

// ==============================
// SYSTEM STATUS
// ==============================

function setSystemDatabase(connected, message) {
    const item = [...document.querySelectorAll('.system-row > div')]
        .find(el => el.textContent.includes('DATABASE'));

    if (!item) return;

    const small = item.querySelector('small');
    const status = item.querySelector('em');

    if (small) small.textContent = message;

    if (status) {
        status.textContent = connected ? 'CONNECTED' : 'OFFLINE';
        status.style.color = connected ? 'var(--lime)' : 'var(--red)';
    }
}

// ==============================
// TEAM RENDER
// ==============================

function renderTeam(containerId, countId, team, color, healthMap = new Map()) {
    const container = document.getElementById(containerId);
    const count = document.getElementById(countId);

    if (!container) return;

    const list = team?.players || [];

    if (count) count.textContent = `${list.length} PLAYERS`;
    container.innerHTML = '';

    const empty = container.parentElement?.querySelector('.empty');

    if (empty) {
        empty.style.display = list.length ? 'none' : 'block';
    }

    list.forEach(item => {
        const player = item.player;
        if (!player) return;

        const health = healthMap.get(player.id);

        const hp = health?.current_health ?? 100;
        const maxHp = health?.max_health ?? 100;

        const percentage = maxHp > 0
            ? Math.max(0, Math.min(100, (hp / maxHp) * 100))
            : 0;

        const eliminated = health?.is_eliminated ?? false;
        const healing = health?.is_healing ?? false;

        const hpColor = eliminated
            ? 'var(--red)'
            : percentage > 50
                ? 'var(--lime)'
                : percentage > 20
                    ? '#f0b84b'
                    : 'var(--red)';

        const card = document.createElement('div');

        card.style.cssText = `
            border:1px solid var(--line);
            padding:12px;
            margin-top:9px;
            border-left:3px solid ${color};
            background:#0d151e;
        `;

        const name = document.createElement('strong');
        name.textContent = player.full_name || player.username;
        name.style.cssText = 'display:block;font-size:12px';

        const meta = document.createElement('small');
        meta.textContent = `ID #${player.player_number ?? '-'} · @${player.username} · ${item.player_status || 'joined'}`;
        meta.style.cssText = `
            display:block;
            color:var(--muted);
            font:9px DM Mono,monospace;
            margin-top:5px;
        `;

        const hpInfo = document.createElement('div');
        hpInfo.style.cssText = `
            display:flex;
            justify-content:space-between;
            margin-top:12px;
            font:10px DM Mono,monospace;
        `;

        const hpLabel = document.createElement('span');
        hpLabel.textContent = 'HEALTH POINT';

        const hpValue = document.createElement('strong');
        hpValue.textContent = `${hp} / ${maxHp} HP`;
        hpValue.style.color = hpColor;

        hpInfo.append(hpLabel, hpValue);

        const hpBackground = document.createElement('div');
        hpBackground.style.cssText = `
            height:8px;
            background:#26313d;
            border-radius:10px;
            overflow:hidden;
            margin-top:7px;
        `;

        const hpBar = document.createElement('div');
        hpBar.style.cssText = `
            width:${percentage}%;
            height:100%;
            background:${hpColor};
            border-radius:10px;
            transition:width .3s ease;
        `;

        hpBackground.appendChild(hpBar);

        const status = document.createElement('small');

        status.textContent = eliminated
            ? 'ELIMINATED'
            : healing
                ? 'HEALING'
                : 'ALIVE';

        status.style.cssText = `
            display:block;
            margin-top:8px;
            font:10px DM Mono,monospace;
            font-weight:bold;
            color:${eliminated ? 'var(--red)' : healing ? '#f0b84b' : 'var(--lime)'};
        `;

        card.append(name, meta, hpInfo, hpBackground, status);
        container.appendChild(card);
    });
}

function renderDynamicTeams(teams = [], healthMap = new Map()) {
    const grid = document.getElementById('teamPanels');
    if (!grid) return;
    grid.innerHTML = '';

    if (!teams.length) {
        grid.innerHTML = '<div class="chart-empty">Belum ada konfigurasi tim untuk pertandingan ini.</div>';
        return;
    }

    teams.forEach((team, index) => {
        const color = team.team_color || '#94A3B8';
        const code = team.team_code || `TEAM-${index + 1}`;
        const name = team.team_name || `${code} TEAM`;
        const panel = document.createElement('article');
        panel.className = 'team-panel';
        panel.style.setProperty('--team-color', color);

        const heading = document.createElement('div');
        heading.className = 'team-title';
        const emblem = document.createElement('span');
        emblem.textContent = code.slice(0, 1);
        const identity = document.createElement('div');
        const faction = document.createElement('small');
        faction.textContent = `FACTION ${String(index + 1).padStart(2, '0')}`;
        const title = document.createElement('h2');
        title.textContent = name.toUpperCase();
        identity.append(faction, title);
        const count = document.createElement('b');
        const current = Number(team.total ?? team.players?.length ?? 0);
        const capacity = Number(team.capacity ?? 0);
        count.textContent = `${current}/${capacity || '—'} PLAYERS`;
        heading.append(emblem, identity, count);

        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'Belum ada pemain terhubung';
        const players = document.createElement('div');
        players.id = `teamPlayers-${code.replace(/[^a-z0-9_-]/gi, '-')}`;
        panel.append(heading, empty, players);
        grid.appendChild(panel);
        renderTeam(players.id, null, team, color, healthMap);
    });
}

function renderTeamMobility(analyticsPlayers = [], teams = []) {
    const stats = document.getElementById('teamMobilityStats');
    const bars = document.getElementById('teamMobilityBars');
    if (!stats || !bars) return;

    const distanceByTeam = new Map(teams.map(team => [team.team_code, 0]));
    analyticsPlayers.forEach(player => {
        const code = player.team_code || '-';
        distanceByTeam.set(code, (distanceByTeam.get(code) || 0) + Number(player.distance_meters || 0));
    });
    const total = [...distanceByTeam.values()].reduce((sum, value) => sum + value, 0);
    const totalEl = document.getElementById('totalArenaDistance');
    if (totalEl) totalEl.textContent = `TOTAL: ${total.toFixed(2)} m`;
    stats.innerHTML = '';
    bars.innerHTML = '';

    teams.forEach(team => {
        const distance = distanceByTeam.get(team.team_code) || 0;
        const color = team.team_color || '#94A3B8';
        const line = document.createElement('div');
        line.className = 'mobility-team-stat';
        const label = document.createElement('span');
        label.textContent = team.team_name || team.team_code;
        label.style.color = color;
        const value = document.createElement('strong');
        value.textContent = `${distance.toFixed(2)} m`;
        line.append(label, value);
        stats.appendChild(line);

        const segment = document.createElement('div');
        segment.className = 'dynamic-mobility-segment';
        segment.style.background = color;
        segment.style.width = `${total > 0 ? (distance / total) * 100 : 100 / Math.max(teams.length, 1)}%`;
        segment.title = `${team.team_name || team.team_code}: ${distance.toFixed(2)} m`;
        bars.appendChild(segment);
    });
}

// ==============================
// MAP PLAYER DOTS & OVERALL DISTANCE
// ==============================

function renderFieldMapAndTelemetry(match, healthPlayers = [], analyticsPlayers = [], events = [], teams = []) {
    const activeUnitsEl = document.getElementById('activeUnitsVal');
    const overallBaseEl = document.getElementById('overallBaseVal');

    const analyticsMap = new Map(analyticsPlayers.map(p => [p.player_id, p]));

    // Ambil koordinat GPS terbaru tiap pemain dari event player_movement jika ada
    const gpsMap = new Map();
    for (const ev of events) {
        if (ev.event_type === 'player_movement' && ev.actor_player_id && !gpsMap.has(ev.actor_player_id)) {
            const ed = ev.event_data || {};
            const lat = Number(ed.lat ?? ed.latitude);
            const lng = Number(ed.lng ?? ed.longitude);
            if (!Number.isNaN(lat) && !Number.isNaN(lng) && lat !== 0 && lng !== 0) {
                gpsMap.set(ev.actor_player_id, { lat, lng });
            }
        }
    }

    // Update Titik Pemain di Peta Leaflet
    if (tacticalMap && playerMarkersLayer) {
        tacticalMap.invalidateSize();
        playerMarkersLayer.clearLayers();
        if (baseMarkersLayer) {
            baseMarkersLayer.clearLayers();
            teams.forEach(team => {
                const coords = LEGACY_BASE_COORDS[team.team_code];
                if (!coords) return;
                const color = team.team_color || '#94A3B8';
                const icon = L.divIcon({
                    className: '',
                    html: `<div class="base-square-marker" style="border-color:${color};color:${color};">${String(team.team_code).slice(0, 1)}</div>`,
                    iconSize: [18, 18],
                    iconAnchor: [9, 9]
                });
                L.marker(coords, { icon }).addTo(baseMarkersLayer)
                    .bindPopup(`<strong>${team.team_name || team.team_code} BASE</strong>`);
            });
        }
        const now = new Date();

        healthPlayers.forEach((p, idx) => {
            const stats = analyticsMap.get(p.player_id) || {};
            const dist = Number(stats.distance_meters ?? 0);
            const teamIndex = Math.max(0, teams.findIndex(team => team.team_code === p.team_code));
            const teamInfo = teams[teamIndex] || {};
            const teamColor = teamInfo.team_color || '#94A3B8';
            const angle = (Math.PI * 2 * teamIndex) / Math.max(teams.length, 1);

            let coords;
            let posLabel;

            if (gpsMap.has(p.player_id)) {
                const g = gpsMap.get(p.player_id);
                coords = [g.lat, g.lng];
                posLabel = `GPS LIVE (${g.lat.toFixed(5)}, ${g.lng.toFixed(5)})`;
            } else {
                const radius = 0.00035 + Math.min(0.00035, dist / 100000);
                const spread = ((idx % 4) - 1.5) * 0.00012;
                coords = [ARENA_CENTER[0] + Math.sin(angle) * radius + spread, ARENA_CENTER[1] + Math.cos(angle) * radius];
                posLabel = `${teamInfo.team_name || p.team_code || 'TEAM'} · ESTIMATED POSITION`;
            }

            const ghostExpiry = p.ghost_mode_until ? new Date(p.ghost_mode_until) : null;
            const isGhost = ghostExpiry && !isNaN(ghostExpiry) && ghostExpiry > now && !p.is_eliminated;

            const dotClasses = [
                'player-dot-marker',
                p.is_eliminated ? 'eliminated' : '',
                isGhost ? 'ghost' : ''
            ].filter(Boolean).join(' ');

            const dotIcon = L.divIcon({
                className: '',
                html: `<div class="${dotClasses}" style="background:${p.is_eliminated ? '#5c6773' : teamColor};color:${teamColor};"></div>`,
                iconSize: [16, 16],
                iconAnchor: [8, 8]
            });

            const playerName = p.full_name || p.username || 'Player';
            const popupHtml = `
                <div style="min-width:150px;">
                    <strong style="color:${teamColor};">${playerName}</strong><br>
                    <span>TIM: ${p.team_code} · HP: ${p.current_health ?? 100}/${p.max_health ?? 100}</span><br>
                    <span>JARAK TEMPUH: <b>${dist.toFixed(2)} m</b></span><br>
                    <small style="color:#8b949e;">${posLabel}</small>
                </div>
            `;

            L.marker(coords, { icon: dotIcon })
                .bindTooltip(`#${p.player_number ?? '-'} ${playerName}`, {
                    permanent: true,
                    direction: 'top',
                    offset: [0, -8],
                    className: 'player-map-label'
                })
                .bindPopup(popupHtml)
                .addTo(playerMarkersLayer);
        });
    }

    // Update Footer Status Unit & Base
    const aliveUnits = healthPlayers.filter(p => !p.is_eliminated).length;
    if (activeUnitsEl) {
        activeUnitsEl.textContent = `${aliveUnits} / ${healthPlayers.length} ACTIVE`;
    }

    if (overallBaseEl) {
        if (match?.winner_team_code) {
            overallBaseEl.textContent = `${match.winner_team_code} VICTORY`;
            overallBaseEl.style.color = 'var(--lime)';
        } else if (match?.status === 'active') {
            overallBaseEl.textContent = 'ARENA ACTIVE';
            overallBaseEl.style.color = 'var(--lime)';
        } else {
            overallBaseEl.textContent = 'STANDBY';
            overallBaseEl.style.color = '';
        }
    }

    renderTeamMobility(analyticsPlayers, teams);
}

// ==============================
// MATCH STATUS
// ==============================

function renderMatch(match) {
    currentMatch = match;

    const mapStatus = document.querySelector('.map-status');

    if (!match) {
        if (state) state.textContent = 'NO MATCH DATA';
        if (start) start.disabled = true;
        if (stop) stop.disabled = true;
        if (mapStatus) mapStatus.textContent = 'AWAITING DATA';
        return;
    }

    if (state) {
        state.textContent = `${match.match_name} · ${match.status.toUpperCase()}`;
    }

    if (start) {
        start.disabled = match.status !== 'waiting';
    }

    if (stop) {
        stop.disabled = match.status !== 'active';
    }

    if (mapStatus) {
        mapStatus.textContent = match.status === 'active'
            ? 'LIVE TRACKING'
            : match.status === 'completed'
                ? 'MATCH COMPLETED'
                : 'WAITING LOBBY';
    }
}

// ==============================
// EVENT LOG
// ==============================

function renderEventLog(events = []) {
    const container = document.getElementById('logList');
    const emptyEl = document.getElementById('logEmpty');
    const countTag = document.getElementById('eventCountTag');

    if (countTag) {
        countTag.textContent = `${events.length} EVENTS`;
    }

    if (!container) return;

    container.innerHTML = '';

    if (emptyEl) {
        emptyEl.style.display = events.length ? 'none' : 'block';
    }

    if (!events.length) return;

    events.forEach(event => {
        const item = document.createElement('div');
        item.className = 'log-item';

        const time = event.created_at
            ? new Date(event.created_at).toLocaleTimeString('id-ID', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            })
            : '--:--:--';

        const timestamp = document.createElement('small');
        timestamp.textContent = time;

        const message = document.createElement('span');
        message.textContent = event.description
            || event.event_type
            || 'Aktivitas pertandingan';

        item.append(timestamp, message);
        container.appendChild(item);
    });
}

// ==============================
// PLAYER ANALYTICS
// ==============================

function renderPlayerAnalytics(players = [], teams = []) {
    const container = document.getElementById('playerAnalyticsList');
    const status = document.getElementById('analyticsStatus');

    if (!container) return;

    container.innerHTML = '';

    if (!players.length) {
        container.innerHTML = `
            <div class="chart-empty">
                Belum ada data statistik pemain.
            </div>
        `;

        if (status) status.textContent = 'NO DATA';
        return;
    }

    if (status) {
        status.textContent = `${players.length} PLAYERS`;
    }

    players.forEach(player => {
        const card = document.createElement('div');
        card.className = 'player-analytics-card';

        const teamInfo = teams.find(team => team.team_code === player.team_code) || {};
        const teamColor = teamInfo.team_color || '#94A3B8';

        const heading = document.createElement('div');
        heading.className = 'player-analytics-heading';

        const identity = document.createElement('div');

        const name = document.createElement('strong');
        name.textContent = player.full_name || player.username || 'Unknown Player';

        const username = document.createElement('small');
        username.textContent = `ID #${player.player_number ?? '-'} · @${player.username || '-'}`;

        identity.append(name, username);

        const team = document.createElement('span');
        team.className = 'player-team-tag';
        team.style.color = teamColor;
        team.textContent = teamInfo.team_name || player.team_code || player.team || '-';

        heading.append(identity, team);

        const metrics = [
            ['TOTAL TEMBAKAN', player.total_shots ?? 0],
            ['HIT GIVEN', player.total_hit_given ?? 0],
            ['HIT RECEIVED', player.total_hit_received ?? 0],
            ['AKURASI', `${player.accuracy_percent ?? 0}%`],
            ['TOTAL HEAL', player.total_heal ?? 0],
            [
                'JARAK TEMPUH',
                `${Number(player.distance_meters ?? 0).toFixed(2)} m`
            ]
        ];

        const grid = document.createElement('div');
        grid.className = 'player-metrics-grid';

        metrics.forEach(([label, value]) => {
            const metric = document.createElement('div');
            metric.className = 'player-metric';

            const metricLabel = document.createElement('small');
            metricLabel.textContent = label;

            const metricValue = document.createElement('strong');
            metricValue.textContent = String(value);

            metric.append(metricLabel, metricValue);
            grid.appendChild(metric);
        });

        card.append(heading, grid);
        container.appendChild(card);
    });
}

// ==============================
// CLEAR DASHBOARD
// ==============================

function clearDashboard() {
    renderDynamicTeams([]);
    renderTeamMobility([], []);
    renderFieldMapAndTelemetry(null, [], [], [], []);
    renderPlayerAnalytics([]);
    renderEventLog([]);
}

// ==============================
// REFRESH DASHBOARD
// ==============================

async function refreshDashboard() {
    try {
        const result = await api('/api/matches/current');

        renderMatch(result.data);
        setSystemDatabase(true, 'Supabase PostgreSQL terhubung');

        if (!result.data) {
            clearDashboard();
            return;
        }

        const matchId = result.data.id;

        const [lobbyResult, healthResult, eventResult] = await Promise.all([
            api(`/api/matches/${matchId}/lobby`),
            api(`/api/matches/${matchId}/health`),
            api(`/api/matches/${matchId}/events`)
        ]);

        const healthPlayers = healthResult.players || [];
        const events = eventResult.events || [];

        renderEventLog(events);

        const healthMap = new Map(
            healthPlayers.map(player => [
                player.player_id,
                player
            ])
        );

        const configuredTeams = lobbyResult.lobby?.teams || [];
        renderDynamicTeams(configuredTeams, healthMap);

        try {
            const analyticsResult = await api(
                `/api/matches/${matchId}/analytics`
            );

            const analyticsPlayers = analyticsResult.players || [];
            renderPlayerAnalytics(analyticsPlayers, configuredTeams);
            renderFieldMapAndTelemetry(result.data, healthPlayers, analyticsPlayers, events, configuredTeams);

        } catch (analyticsError) {
            console.error('PLAYER ANALYTICS ERROR:', analyticsError);
            renderFieldMapAndTelemetry(result.data, healthPlayers, [], events, configuredTeams);

            const status = document.getElementById('analyticsStatus');
            const container = document.getElementById('playerAnalyticsList');

            if (status) status.textContent = 'ANALYTICS ERROR';

            if (container) {
                container.innerHTML = `
                    <div class="chart-empty">
                        Gagal memuat Player Analytics.
                    </div>
                `;
            }
        }

    } catch (error) {
        console.error('DASHBOARD ERROR:', error);

        setSystemDatabase(false, `API tidak dapat diakses: ${error.message}`);

        if (state) {
            state.textContent = 'BACKEND CONNECTION ERROR';
        }
    }
}

// ==============================
// START MATCH
// ==============================

if (start) {
    start.addEventListener('click', async () => {
        if (!currentMatch) return;

        start.disabled = true;

        try {
            await api(
                `/api/admin/matches/${currentMatch.id}/start`,
                { method: 'POST' }
            );

            await refreshDashboard();

        } catch (error) {
            alert(`Gagal memulai pertandingan: ${error.message}`);
            await refreshDashboard();
        }
    });
}

// ==============================
// END MATCH
// ==============================

if (stop) {
    stop.addEventListener('click', async () => {
        if (!currentMatch) return;

        const confirmed = confirm(
            'Akhiri pertandingan sekarang?\n\n' +
            'Data pertandingan akan tersimpan di halaman Match History.'
        );

        if (!confirmed) return;

        stop.disabled = true;

        try {
            await api(
                `/api/admin/matches/${currentMatch.id}/end`,
                { method: 'POST' }
            );

            await refreshDashboard();

            alert('Pertandingan berhasil diakhiri dan tersimpan di Match History.');

        } catch (error) {
            alert(`Gagal mengakhiri pertandingan: ${error.message}`);
            await refreshDashboard();
        }
    });
}

// ==============================
// DELETE ALL MATCH DATA
// ==============================

if (deleteAllBtn) {
    deleteAllBtn.addEventListener('click', async () => {
        const confirmed = confirm(
            'PERINGATAN!\n\n' +
            'Apakah kamu yakin ingin menghapus SELURUH DATA PERTANDINGAN?\n\n' +
            'Data yang akan dihapus:\n' +
            '- Riwayat pertandingan\n' +
            '- Data pemain dalam pertandingan\n' +
            '- Event log\n' +
            '- Statistik pertandingan\n\n' +
            'Akun pemain dan data tim TIDAK akan dihapus.\n\n' +
            'Tindakan ini tidak dapat dibatalkan.'
        );

        if (!confirmed) return;

        deleteAllBtn.disabled = true;
        deleteAllBtn.textContent = 'DELETING...';

        try {
            const result = await api('/api/admin/matches/all', {
                method: 'DELETE'
            });

            currentMatch = null;

            clearDashboard();
            renderMatch(null);

            await refreshDashboard();

            alert(
                result.message ||
                'Seluruh data pertandingan berhasil dihapus.'
            );

        } catch (error) {
            console.error('DELETE ALL ERROR:', error);
            alert(`Gagal menghapus data pertandingan: ${error.message}`);

        } finally {
            deleteAllBtn.disabled = false;
            deleteAllBtn.textContent = '⌫ HAPUS ALL';
        }
    });
}

// ==============================
// INITIALIZE
// ==============================

initTacticalMap();
refreshDashboard();

refreshTimer = setInterval(() => {
    refreshDashboard();
}, 4000);