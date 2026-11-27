const API_BASE = window.OPS_API_BASE || (window.location.protocol === 'file:' ? 'http://127.0.0.1:8000' : window.location.origin);
window.OPS_API_BASE = API_BASE;
const WS_BASE = API_BASE.replace(/^http/, 'ws');

const start = document.getElementById('startBtn');
const stop = document.getElementById('stopBtn');
const state = document.getElementById('matchState');
const deleteAllBtn = document.getElementById('deleteAllBtn');
const recenterMapBtn = document.getElementById('recenterMapBtn');

let currentMatch = null;
let selectedMatchId = null;
let activeViewMode = 'browse';
let browsedMatches = [];
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

function setSystemCamera(onlineCount, message) {
    const item = [...document.querySelectorAll('.system-row > div')]
        .find(el => el.textContent.includes('CAMERA MONITOR'));

    if (!item) return;

    const small = item.querySelector('small');
    const status = item.querySelector('em');

    if (small) small.textContent = message;

    if (status) {
        status.textContent = `${onlineCount} / 8 SOURCES`;
        status.style.color = onlineCount > 0 ? 'var(--lime)' : '';
    }
}

// ==============================
// MATCH BROWSE & POST-MATCH SUMMARY NAVIGATION
// ==============================

function setSubMenuLocked(locked) {
    ['navOverview', 'navCamera'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.toggle('disabled-nav', locked);
        }
    });
}

function escapeMatchHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
}

function getMatchTeams(match) {
    if (Array.isArray(match?.team_stats) && match.team_stats.length) {
        return match.team_stats;
    }
    if (Array.isArray(match?.teams) && match.teams.length) {
        return match.teams;
    }

    // Fallback untuk match lama yang belum memiliki konfigurasi match_teams.
    return [
        { team_code: 'RED', team_name: 'RED TEAM', team_color: '#EF4444', total_players: match?.red_players_count ?? match?.red_players ?? match?.red_count ?? 0 },
        { team_code: 'BLUE', team_name: 'BLUE TEAM', team_color: '#3B82F6', total_players: match?.blue_players_count ?? match?.blue_players ?? match?.blue_count ?? 0 }
    ].filter(team => Number(team.total_players) > 0 || ['RED', 'BLUE'].includes(team.team_code));
}

function renderMatchBrowseCards(matches = []) {
    // Match Browse khusus room yang belum selesai: WAITING dan ACTIVE.
    matches = (Array.isArray(matches) ? matches : []).filter(match =>
        ['waiting', 'active'].includes(String(match?.status || 'waiting').toLowerCase())
    );

    const container = document.getElementById('matchBrowseList');
    const countTag = document.getElementById('browseCountTag');

    if (countTag) {
        countTag.textContent = `${matches.length} ${matches.length === 1 ? 'MATCH' : 'MATCHES'}`;
    }

    if (!container) return;

    if (!matches.length) {
        container.innerHTML = `
            <div class="browse-empty-box">
                Belum ada room WAITING atau ACTIVE saat ini.<br>
                Match yang sudah COMPLETED dapat dilihat di menu <strong>MATCH HISTORY</strong>.
            </div>
        `;
        return;
    }

    container.innerHTML = '';

    matches.forEach(match => {
        const statusRaw = (match.status || 'waiting').toLowerCase();
        const isCompleted = statusRaw === 'completed';
        const statusClass = statusRaw === 'active' ? 'active' : statusRaw === 'waiting' ? 'waiting' : 'completed';
        const statusLabel = statusRaw === 'active' ? 'ACTIVE' : statusRaw === 'waiting' ? 'WAITING LOBBY' : 'COMPLETED';
        const teams = getMatchTeams(match);

        const teamsMarkup = teams.map((team, index) => {
            const name = team.team_name || team.name || `${team.team_code || `TEAM ${index + 1}`} TEAM`;
            const count = Number(team.total_players ?? team.players_count ?? team.player_count ?? team.players?.length ?? 0);
            const capacity = team.capacity == null ? '' : ` / ${Number(team.capacity)}`;
            const colorCandidate = String(team.team_color || team.color || '#A3E635');
            const color = /^#[0-9a-fA-F]{3,8}$/.test(colorCandidate) ? colorCandidate : '#A3E635';
            return `
                <div class="match-card-team" title="${escapeMatchHtml(name)}">
                    <span>FACTION ${String(index + 1).padStart(2, '0')}</span>
                    <strong style="color:${color};">${escapeMatchHtml(name)} (${count}${capacity})</strong>
                </div>
            `;
        }).join('');

        const card = document.createElement('div');
        card.className = 'match-browse-card';
        card.innerHTML = `
            <div>
                <div class="match-card-top">
                    <div>
                        <small style="font:9px 'DM Mono',monospace;color:var(--muted);">OPERATION MATCH</small>
                        <div class="match-card-title">${escapeMatchHtml(match.match_name || match.name || 'Unnamed Match')}</div>
                        <div class="match-card-id">ID: ${escapeMatchHtml(match.id)}</div>
                    </div>
                    <span class="match-status-pill ${statusClass}">${statusLabel}</span>
                </div>

                <div class="match-card-teams" style="margin-top:12px;">
                    ${teamsMarkup || '<div class="match-card-team"><span>TEAMS</span><strong>Belum ada konfigurasi tim</strong></div>'}
                </div>
            </div>

            <button type="button" class="btn-enter-match ${isCompleted ? 'summary-mode' : ''}">
                ▶ ENTER MATCH
            </button>
        `;

        const enterBtn = card.querySelector('.btn-enter-match');
        enterBtn.addEventListener('click', () => {
            if (isCompleted) openPostMatchSummary(match);
            else enterMatchWorkspace(match);
        });

        container.appendChild(card);
    });
}

async function enterMatchWorkspace(match, targetSubView = 'overview') {
    if (!match) return;
    if ((match.status || '').toLowerCase() === 'completed') {
        await openPostMatchSummary(match);
        return;
    }
    selectedMatchId = match.id;
    currentMatch = match;
    setSubMenuLocked(false);
    switchAdminMenu(targetSubView);
    await refreshDashboard();
}

function exitToMatchBrowse() {
    selectedMatchId = null;
    setSubMenuLocked(true);
    switchAdminMenu('browse');
}

function renderPostMatchSummaryData(match, healthPlayers = [], analyticsPlayers = [], lobbyData = null) {
    const titleEl = document.getElementById('summaryMatchTitle');
    const winnerBadge = document.getElementById('summaryWinnerBadge');
    const teamsGrid = document.getElementById('summaryTeamsGrid');
    const playersGrid = document.getElementById('summaryPlayersGrid');
    const playerCountTag = document.getElementById('summaryPlayerCountTag');

    if (titleEl) {
        titleEl.textContent = `${match?.match_name || 'OPERATION MATCH'} · FINAL STATISTICS`;
    }

    const healthMap = new Map(healthPlayers.map(p => [p.player_id, p]));
    const analyticsMap = new Map(analyticsPlayers.map(p => [p.player_id, p]));

    // Gabungkan semua data pemain dari analytics, health, dan lobby agar semua tim & pemain tercakup
    const unifiedPlayers = new Map();

    const addPlayerEntry = (raw, fallbackTeam = '') => {
        const pid = raw.player_id || raw.id;
        if (!pid) return;
        const existing = unifiedPlayers.get(pid) || {};
        const h = healthMap.get(pid) || {};
        const a = analyticsMap.get(pid) || {};

        unifiedPlayers.set(pid, {
            player_id: pid,
            full_name: a.full_name || h.full_name || raw.full_name || existing.full_name || raw.username || 'Unknown Player',
            username: a.username || h.username || raw.username || existing.username || '-',
            player_number: a.player_number ?? h.player_number ?? raw.player_number ?? existing.player_number ?? '-',
            team_code: (a.team_code || h.team_code || raw.team_code || fallbackTeam || existing.team_code || 'UNKNOWN').toUpperCase(),
            current_health: h.current_health ?? existing.current_health ?? 100,
            max_health: h.max_health ?? existing.max_health ?? 100,
            is_eliminated: h.is_eliminated ?? existing.is_eliminated ?? false,
            total_shots: Number(a.total_shots ?? existing.total_shots ?? 0),
            total_hit_given: Number(a.total_hit_given ?? existing.total_hit_given ?? 0),
            total_hit_received: Number(a.total_hit_received ?? existing.total_hit_received ?? 0),
            accuracy_percent: Number(a.accuracy_percent ?? existing.accuracy_percent ?? 0),
            total_heal: Number(a.total_heal ?? existing.total_heal ?? 0),
            distance_meters: Number(a.distance_meters ?? existing.distance_meters ?? 0)
        });
    };

    (lobbyData?.red_team?.players || []).forEach(item => {
        if (item.player) addPlayerEntry(item.player, 'RED');
    });
    (lobbyData?.blue_team?.players || []).forEach(item => {
        if (item.player) addPlayerEntry(item.player, 'BLUE');
    });
    healthPlayers.forEach(p => addPlayerEntry(p));
    analyticsPlayers.forEach(p => addPlayerEntry(p));

    const allPlayers = [...unifiedPlayers.values()];

    // Kelompokkan statistik berdasarkan semua tim yang ada (minimal RED & BLUE selalu ditampilkan)
    const teamCodes = new Set(['RED', 'BLUE']);
    allPlayers.forEach(p => {
        if (p.team_code && p.team_code !== 'UNKNOWN') {
            teamCodes.add(p.team_code);
        }
    });

    const teamSummaries = [...teamCodes].map(code => {
        const members = allPlayers.filter(p => p.team_code === code);
        const aliveCount = members.filter(p => !p.is_eliminated).length;
        const totalShots = members.reduce((sum, p) => sum + p.total_shots, 0);
        const totalHitGiven = members.reduce((sum, p) => sum + p.total_hit_given, 0);
        const totalHitReceived = members.reduce((sum, p) => sum + p.total_hit_received, 0);
        const totalHeal = members.reduce((sum, p) => sum + p.total_heal, 0);
        const totalDistance = members.reduce((sum, p) => sum + p.distance_meters, 0);
        const accuracy = totalShots > 0
            ? ((totalHitGiven / totalShots) * 100).toFixed(1)
            : '0.0';

        return {
            code,
            members,
            aliveCount,
            totalShots,
            totalHitGiven,
            totalHitReceived,
            totalHeal,
            totalDistance,
            accuracy
        };
    });

    // Tentukan pemenang dari winner_team_code atau perbandingan surviving/hits
    let winnerCode = (match?.winner_team_code || '').toUpperCase();
    if (!winnerCode && teamSummaries.length >= 2) {
        const sorted = [...teamSummaries].sort((a, b) => {
            if (b.aliveCount !== a.aliveCount) return b.aliveCount - a.aliveCount;
            if (b.totalHitGiven !== a.totalHitGiven) return b.totalHitGiven - a.totalHitGiven;
            return b.totalDistance - a.totalDistance;
        });
        if (sorted[0].aliveCount > sorted[1].aliveCount || sorted[0].totalHitGiven > sorted[1].totalHitGiven) {
            winnerCode = sorted[0].code;
        }
    }

    if (winnerBadge) {
        winnerBadge.className = 'summary-winner-badge';
        if (winnerCode) {
            winnerBadge.textContent = `VICTORY · ${winnerCode} TEAM`;
            if (winnerCode === 'RED') winnerBadge.classList.add('red');
            if (winnerCode === 'BLUE') winnerBadge.classList.add('blue');
        } else {
            winnerBadge.textContent = 'MATCH COMPLETED · FINAL STANDINGS';
        }
    }

    if (teamsGrid) {
        teamsGrid.innerHTML = '';
        teamSummaries.forEach(team => {
            const teamLower = team.code.toLowerCase();
            const isWinner = winnerCode && winnerCode === team.code;
            const titleColor = team.code === 'RED'
                ? 'var(--red)'
                : team.code === 'BLUE'
                    ? 'var(--blue)'
                    : team.code === 'GREEN'
                        ? '#22c55e'
                        : '#eab308';

            const card = document.createElement('div');
            card.className = `summary-team-card team-${teamLower}`;
            card.innerHTML = `
                <div class="summary-team-header">
                    <div>
                        <small style="font:9px 'DM Mono',monospace;color:var(--muted);">TEAM STATISTICS</small>
                        <h3 style="color:${titleColor};">${team.code} TEAM</h3>
                    </div>
                    <span class="match-status-pill ${isWinner ? 'active' : 'completed'}">
                        ${isWinner ? '★ WINNER' : `${team.aliveCount} / ${team.members.length} ALIVE`}
                    </span>
                </div>

                <div class="summary-kpi-grid">
                    <div class="summary-kpi-box">
                        <small>PEMAIN BERTAHAN</small>
                        <strong>${team.aliveCount} / ${team.members.length}</strong>
                    </div>
                    <div class="summary-kpi-box">
                        <small>TOTAL TEMBAKAN</small>
                        <strong>${team.totalShots}</strong>
                    </div>
                    <div class="summary-kpi-box">
                        <small>HIT GIVEN</small>
                        <strong>${team.totalHitGiven}</strong>
                    </div>
                    <div class="summary-kpi-box">
                        <small>HIT RECEIVED</small>
                        <strong>${team.totalHitReceived}</strong>
                    </div>
                    <div class="summary-kpi-box">
                        <small>AKURASI TIM</small>
                        <strong>${team.accuracy}%</strong>
                    </div>
                    <div class="summary-kpi-box">
                        <small>TOTAL HEAL</small>
                        <strong>${team.totalHeal}</strong>
                    </div>
                    <div class="summary-kpi-box" style="grid-column: 1 / -1;">
                        <small>TOTAL JARAK TEMPUH TIM</small>
                        <strong>${team.totalDistance.toFixed(2)} m</strong>
                    </div>
                </div>
            `;
            teamsGrid.appendChild(card);
        });
    }

    if (playerCountTag) {
        playerCountTag.textContent = `${allPlayers.length} PLAYERS`;
    }

    if (playersGrid) {
        playersGrid.innerHTML = '';
        if (!allPlayers.length) {
            playersGrid.innerHTML = `
                <div class="chart-empty" style="grid-column:1/-1;">
                    Tidak ada data statistik pemain tercatat pada pertandingan ini.
                </div>
            `;
            return;
        }

        allPlayers.forEach(player => {
            const teamClass = player.team_code === 'RED' ? 'red-text' : 'blue-text';
            const card = document.createElement('div');
            card.className = 'player-analytics-card';
            card.innerHTML = `
                <div class="player-analytics-heading">
                    <div>
                        <strong>${player.full_name}</strong>
                        <small>ID #${player.player_number} · @${player.username} · ${player.is_eliminated ? 'ELIMINATED' : 'SURVIVED'} (${player.current_health}/${player.max_health} HP)</small>
                    </div>
                    <span class="player-team-tag ${teamClass}">${player.team_code}</span>
                </div>
                <div class="player-metrics-grid">
                    <div class="player-metric">
                        <small>TOTAL TEMBAKAN</small>
                        <strong>${player.total_shots}</strong>
                    </div>
                    <div class="player-metric">
                        <small>HIT GIVEN</small>
                        <strong>${player.total_hit_given}</strong>
                    </div>
                    <div class="player-metric">
                        <small>HIT RECEIVED</small>
                        <strong>${player.total_hit_received}</strong>
                    </div>
                    <div class="player-metric">
                        <small>AKURASI</small>
                        <strong>${player.accuracy_percent}%</strong>
                    </div>
                    <div class="player-metric">
                        <small>TOTAL HEAL</small>
                        <strong>${player.total_heal}</strong>
                    </div>
                    <div class="player-metric">
                        <small>JARAK TEMPUH</small>
                        <strong>${player.distance_meters.toFixed(2)} m</strong>
                    </div>
                </div>
            `;
            playersGrid.appendChild(card);
        });
    }
}

async function openPostMatchSummary(match) {
    if (!match || !match.id) return;

    // Kunci Overview dan Camera, serta hentikan stream kamera aktif
    selectedMatchId = null;
    currentMatch = { ...match, status: 'completed' };
    setSubMenuLocked(true);

    if (activeCameraFeeds.size > 0) {
        [...activeCameraFeeds.keys()].forEach(slotId => removeCameraSlot(slotId, false));
        saveConfirmedSlotsToStorage();
        syncCameraDropdownState();
    }

    switchAdminMenu('summary');

    try {
        const [lobbyRes, healthRes, analyticsRes] = await Promise.allSettled([
            api(`/api/matches/${match.id}/lobby`),
            api(`/api/matches/${match.id}/health`),
            api(`/api/matches/${match.id}/analytics`)
        ]);

        const lobbyData = lobbyRes.status === 'fulfilled' ? lobbyRes.value.lobby : null;
        const healthPlayers = healthRes.status === 'fulfilled' ? (healthRes.value.players || []) : [];
        const analyticsPlayers = analyticsRes.status === 'fulfilled' ? (analyticsRes.value.players || []) : [];

        renderPostMatchSummaryData(currentMatch, healthPlayers, analyticsPlayers, lobbyData);
    } catch (err) {
        console.error('SUMMARY LOAD ERROR:', err);
        renderPostMatchSummaryData(currentMatch, [], [], null);
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

    const mapStatus = document.querySelector('#map .map-status');

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

    // Saring event GPS agar tidak memenuhi Event Log, tapi tetap dipakai oleh peta & jarak
    const filteredEvents = (events || []).filter(
        event => event.event_type !== 'player_movement'
    );

    if (countTag) {
        countTag.textContent = `${filteredEvents.length} EVENTS`;
    }

    if (!container) return;

    container.innerHTML = '';

    if (emptyEl) {
        emptyEl.style.display = filteredEvents.length ? 'none' : 'block';
    }

    if (!filteredEvents.length) return;

    filteredEvents.forEach(event => {
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
// REFRESH DASHBOARD & BROWSE LIST
// ==============================

async function refreshDashboard() {
    try {
        api('/api/referee-cam/status/default')
            .then(camStatus => {
                const slots = Object.values(camStatus.slots || {});
                const onlineCount = slots.filter(s => s.online).length;
                setSystemCamera(
                    onlineCount,
                    onlineCount > 0 ? `${onlineCount} kamera wasit aktif` : 'Belum ada stream kamera'
                );
            })
            .catch(() => {});

        const [currentRes, allMatchesRes] = await Promise.allSettled([
            api('/api/matches/current'),
            api('/api/matches/history')
        ]);

        if (currentRes.status === 'rejected') {
            throw currentRes.reason;
        }

        setSystemDatabase(true, 'Supabase PostgreSQL terhubung');

        const matchMap = new Map();
        const currentData = currentRes.value?.data;
        if (currentData && currentData.id) {
            matchMap.set(currentData.id, currentData);
        }

        if (allMatchesRes.status === 'fulfilled') {
            // Endpoint /history mengembalikan { success, history: [...] }.
            const rawList = Array.isArray(allMatchesRes.value?.history)
                ? allMatchesRes.value.history
                : Array.isArray(allMatchesRes.value?.data)
                    ? allMatchesRes.value.data
                    : Array.isArray(allMatchesRes.value?.matches)
                        ? allMatchesRes.value.matches
                        : Array.isArray(allMatchesRes.value)
                            ? allMatchesRes.value
                            : [];

            rawList.forEach(m => {
                if (!m || !m.id) return;
                // Gabungkan data /history ke record /current agar team_stats dari
                // history tidak hilang ketika keduanya merujuk match yang sama.
                matchMap.set(m.id, { ...(matchMap.get(m.id) || {}), ...m });
            });
        }

        browsedMatches = [...matchMap.values()];

        const activeMatch = (selectedMatchId && matchMap.get(selectedMatchId))
            || currentData
            || null;

        if (activeMatch && activeMatch.id) {
            const [lobbyResult, healthResult, eventResult] = await Promise.all([
                api(`/api/matches/${activeMatch.id}/lobby`),
                api(`/api/matches/${activeMatch.id}/health`),
                api(`/api/matches/${activeMatch.id}/events`)
            ]);

            // Lobby merupakan sumber kondisi anggota tim terkini untuk match yang sedang dibuka.
            const liveTeams = Array.isArray(lobbyResult.lobby?.teams) ? lobbyResult.lobby.teams : [];
            activeMatch.team_stats = liveTeams.map(team => ({
                team_id: team.id,
                team_code: team.team_code,
                team_name: team.team_name,
                team_color: team.team_color,
                total_players: Number(team.total ?? team.total_players ?? team.players?.length ?? 0),
                capacity: team.capacity
            }));
            activeMatch.total_players = Number(lobbyResult.lobby?.total_players ?? activeMatch.total_players ?? 0);
            activeMatch.red_players_count = activeMatch.team_stats.find(team => team.team_code === 'RED')?.total_players ?? 0;
            activeMatch.blue_players_count = activeMatch.team_stats.find(team => team.team_code === 'BLUE')?.total_players ?? 0;

            // Match Browse hanya menampilkan WAITING dan ACTIVE.
            // COMPLETED ditampilkan terpisah pada halaman Match History.
            renderMatchBrowseCards(browsedMatches);

            // Jika admin berada di halaman Match Browse atau Post-Match Summary, jangan masuk ke workspace aktif
            if (!selectedMatchId || activeViewMode === 'summary') {
                return;
            }

            // Jika match tiba-tiba berstatus completed, kunci workspace dan arahkan ke Post-Match Summary
            if ((activeMatch.status || '').toLowerCase() === 'completed') {
                await openPostMatchSummary(activeMatch);
                return;
            }

            renderMatch(activeMatch);

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
                    `/api/matches/${activeMatch.id}/analytics`
                );

                const analyticsPlayers = analyticsResult.players || [];
                renderPlayerAnalytics(analyticsPlayers, configuredTeams);
                renderFieldMapAndTelemetry(activeMatch, healthPlayers, analyticsPlayers, eventResult.events || [], configuredTeams);

            } catch (analyticsError) {
                console.error('PLAYER ANALYTICS ERROR:', analyticsError);
                renderFieldMapAndTelemetry(activeMatch, healthPlayers, [], eventResult.events || [], configuredTeams);

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
        } else {
            renderMatchBrowseCards(browsedMatches);
            if (activeViewMode !== 'summary') {
                renderMatch(null);
                clearDashboard();
            }
        }

    } catch (error) {
        console.error('DASHBOARD ERROR:', error);

        setSystemDatabase(false, `API tidak dapat diakses: ${error.message}`);
        renderMatchBrowseCards([]);

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
// END MATCH -> FULL PAGE POST-MATCH SUMMARY & LOCK OVERVIEW / CAMERA
// ==============================

if (stop) {
    stop.addEventListener('click', async () => {
        if (!currentMatch) return;

        const confirmed = confirm(
            'Akhiri pertandingan sekarang?\n\n' +
            'Setelah diakhiri, kamu akan diarahkan ke halaman Statistik Akhir Tim dan tidak bisa kembali ke Overview maupun Camera.'
        );

        if (!confirmed) return;

        const endedMatchSnapshot = { ...currentMatch, status: 'completed' };
        stop.disabled = true;

        try {
            const endResult = await api(
                `/api/admin/matches/${endedMatchSnapshot.id}/end`,
                { method: 'POST' }
            );

            const finalizedMatch = {
                ...endedMatchSnapshot,
                ...(endResult?.data || endResult?.match || {}),
                status: 'completed'
            };

            await openPostMatchSummary(finalizedMatch);
            refreshDashboard();

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
            selectedMatchId = null;

            clearDashboard();
            renderMatch(null);
            exitToMatchBrowse();

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
// MULTI-SCREEN REFEREE CAMERA MENU & WEBRTC MONITOR (LOCKED ONCE SELECTED)
// ==============================

const CAM_RTC_CONFIG = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

const CONFIRMED_CAMS_STORAGE_KEY = 'op_sby_confirmed_camera_slots';

const CAMERA_SLOT_META = {
    'red-1': { label: 'CAMERA 1 · RED TEAM', team: 'red' },
    'red-2': { label: 'CAMERA 2 · RED TEAM', team: 'red' },
    'blue-1': { label: 'CAMERA 1 · BLUE TEAM', team: 'blue' },
    'blue-2': { label: 'CAMERA 2 · BLUE TEAM', team: 'blue' },
    'green-1': { label: 'CAMERA 1 · GREEN TEAM', team: 'green' },
    'green-2': { label: 'CAMERA 2 · GREEN TEAM', team: 'green' },
    'yellow-1': { label: 'CAMERA 1 · YELLOW TEAM', team: 'yellow' },
    'yellow-2': { label: 'CAMERA 2 · YELLOW TEAM', team: 'yellow' }
};

// Map<slotId, { ws, pc, tileEl, videoEl, statusEl, overlayEl }>
const activeCameraFeeds = new Map();

function saveConfirmedSlotsToStorage() {
    try {
        localStorage.setItem(
            CONFIRMED_CAMS_STORAGE_KEY,
            JSON.stringify([...activeCameraFeeds.keys()])
        );
    } catch (err) {
        console.warn('Storage save error:', err);
    }
}

function getConfirmedSlotsFromStorage() {
    try {
        const raw = localStorage.getItem(CONFIRMED_CAMS_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter(id => CAMERA_SLOT_META[id]) : [];
    } catch {
        return [];
    }
}

function syncCameraDropdownState() {
    const slotSelect = document.getElementById('cameraSlotSelect');
    const selectedText = document.getElementById('selectedCameraText');
    const confirmBtn = document.getElementById('confirmCameraBtn');
    if (!slotSelect) return;

    [...slotSelect.options].forEach(opt => {
        if (!opt.dataset.baseText) {
            opt.dataset.baseText = opt.textContent.trim();
        }
        const isAlreadySelected = activeCameraFeeds.has(opt.value);
        opt.disabled = isAlreadySelected;
        opt.textContent = isAlreadySelected
            ? `${opt.dataset.baseText} [SUDAH DIPILIH]`
            : opt.dataset.baseText;
    });

    let currentOpt = slotSelect.options[slotSelect.selectedIndex];
    if (!currentOpt || currentOpt.disabled) {
        const nextAvailableIdx = [...slotSelect.options].findIndex(o => !o.disabled);
        if (nextAvailableIdx !== -1) {
            slotSelect.selectedIndex = nextAvailableIdx;
            currentOpt = slotSelect.options[nextAvailableIdx];
        } else {
            currentOpt = null;
        }
    }

    if (currentOpt && !currentOpt.disabled) {
        if (selectedText) {
            selectedText.textContent = `Pilihan: ${currentOpt.dataset.baseText}`;
        }
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = '✓ CONFIRM CAMERA';
        }
    } else {
        if (selectedText) {
            selectedText.textContent = 'Semua 8 kamera sudah dipilih';
        }
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'SEMUA KAMERA AKTIF';
        }
    }
}

function switchAdminMenu(mode) {
    activeViewMode = mode;

    const navBrowse = document.getElementById('navBrowse');
    const navOverview = document.getElementById('navOverview');
    const navCamera = document.getElementById('navCamera');

    const browseViewEl = document.getElementById('browseView');
    const summaryViewEl = document.getElementById('matchSummaryView');
    const matchWorkspaceEl = document.getElementById('matchWorkspace');
    const overviewEl = document.getElementById('overview');
    const lowerGridEl = document.querySelector('.lower-grid');
    const cameraViewEl = document.getElementById('cameraView');

    [navBrowse, navOverview, navCamera].forEach(el => {
        if (el) el.classList.remove('active');
    });

    if (mode === 'summary') {
        if (browseViewEl) browseViewEl.style.display = 'none';
        if (matchWorkspaceEl) matchWorkspaceEl.style.display = 'none';
        if (summaryViewEl) summaryViewEl.style.display = 'block';
        return;
    }

    if (summaryViewEl) summaryViewEl.style.display = 'none';

    if (mode === 'browse' || !selectedMatchId) {
        activeViewMode = 'browse';
        if (navBrowse) navBrowse.classList.add('active');
        if (browseViewEl) browseViewEl.style.display = 'block';
        if (matchWorkspaceEl) matchWorkspaceEl.style.display = 'none';
        return;
    }

    if (browseViewEl) browseViewEl.style.display = 'none';
    if (matchWorkspaceEl) matchWorkspaceEl.style.display = 'block';

    if (mode === 'camera') {
        if (navCamera) navCamera.classList.add('active');
        if (overviewEl) overviewEl.style.display = 'none';
        if (lowerGridEl) lowerGridEl.style.display = 'none';
        if (cameraViewEl) cameraViewEl.style.display = 'block';
    } else {
        if (navOverview) navOverview.classList.add('active');

        if (overviewEl) overviewEl.style.display = '';
        if (lowerGridEl) lowerGridEl.style.display = '';
        if (cameraViewEl) cameraViewEl.style.display = 'none';

        if (tacticalMap) {
            setTimeout(() => tacticalMap.invalidateSize(), 150);
        }
    }
}

function updateCameraGridLayout() {
    const gridEl = document.getElementById('cameraFeedsGrid');
    const emptyEl = document.getElementById('cameraGridEmpty');
    const countBadge = document.getElementById('activeScreenCountBadge');
    const count = activeCameraFeeds.size;

    if (countBadge) {
        countBadge.textContent = `${count} LAYAR AKTIF`;
    }

    if (emptyEl) {
        emptyEl.style.display = count === 0 ? 'block' : 'none';
    }

    if (gridEl) {
        gridEl.classList.toggle('multi-cam', count >= 2);
    }
}

function setTileState(feed, statusText, isStreaming = false) {
    if (!feed) return;
    if (feed.statusEl) {
        feed.statusEl.textContent = statusText;
        feed.statusEl.classList.toggle('live', isStreaming);
    }
    if (feed.overlayEl) {
        feed.overlayEl.style.display = isStreaming ? 'none' : 'flex';
        const spanEl = feed.overlayEl.querySelector('span');
        if (spanEl) {
            spanEl.textContent = statusText === 'KAMERA OFFLINE'
                ? 'Kamera wasit pada slot ini belum menyalakan Start Live.'
                : 'Menunggu stream video dari perangkat kamera wasit...';
        }
    }
}

function removeCameraSlot(slotId, persist = true) {
    const feed = activeCameraFeeds.get(slotId);
    if (!feed) return;

    if (feed.pc) {
        feed.pc.close();
    }
    if (feed.ws) {
        feed.ws.close();
    }
    if (feed.tileEl) {
        feed.tileEl.remove();
    }

    activeCameraFeeds.delete(slotId);
    updateCameraGridLayout();
    syncCameraDropdownState();

    if (persist) {
        saveConfirmedSlotsToStorage();
    }
}

function addOrReconnectCameraSlot(slotId, labelText, teamKey, persist = true) {
    if (activeCameraFeeds.has(slotId)) {
        syncCameraDropdownState();
        return;
    }

    const gridEl = document.getElementById('cameraFeedsGrid');
    if (!gridEl) return;

    const tileEl = document.createElement('div');
    tileEl.className = 'cam-feed-tile';
    tileEl.dataset.slotId = slotId;

    tileEl.innerHTML = `
        <div class="cam-tile-header">
            <span class="camera-badge-pill team-${teamKey}">${labelText}</span>
            <div class="cam-tile-actions">
                <span class="cam-tile-status">CONNECTING...</span>
                <button type="button" class="btn-remove-cam" title="Tutup layar ini">✕</button>
            </div>
        </div>
        <div class="camera-screen-wrapper">
            <div class="camera-empty-overlay">
                <strong>${labelText}</strong>
                <span style="margin-top:6px;">Menyambungkan ke server kamera wasit...</span>
            </div>
            <video autoplay playsinline muted></video>
        </div>
    `;

    const videoEl = tileEl.querySelector('video');
    const statusEl = tileEl.querySelector('.cam-tile-status');
    const overlayEl = tileEl.querySelector('.camera-empty-overlay');
    const removeBtn = tileEl.querySelector('.btn-remove-cam');

    const feed = {
        ws: null,
        pc: null,
        tileEl,
        videoEl,
        statusEl,
        overlayEl
    };

    removeBtn.addEventListener('click', () => {
        removeCameraSlot(slotId, true);
    });

    gridEl.appendChild(tileEl);
    activeCameraFeeds.set(slotId, feed);
    updateCameraGridLayout();
    syncCameraDropdownState();

    if (persist) {
        saveConfirmedSlotsToStorage();
    }

    const wsUrl = `${WS_BASE}/ws/referee-cam/default/${encodeURIComponent(slotId)}?role=admin`;
    const ws = new WebSocket(wsUrl);
    feed.ws = ws;

    ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'admin-ready', slot_id: slotId }));
        setTileState(feed, 'STANDBY · WAITING FEED', false);
    };

    ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data);

        if (msg.type === 'offer') {
            if (feed.pc) feed.pc.close();
            const pc = new RTCPeerConnection(CAM_RTC_CONFIG);
            feed.pc = pc;

            pc.ontrack = (e) => {
                if (e.streams && e.streams[0] && feed.videoEl) {
                    feed.videoEl.srcObject = e.streams[0];
                    setTileState(feed, 'LIVE FEED', true);
                }
            };

            pc.onicecandidate = (e) => {
                if (e.candidate && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'ice-candidate',
                        candidate: e.candidate,
                        slot_id: slotId
                    }));
                }
            };

            await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            ws.send(JSON.stringify({
                type: 'answer',
                sdp: pc.localDescription,
                slot_id: slotId
            }));
        } else if (msg.type === 'ice-candidate' && msg.candidate && feed.pc) {
            try {
                await feed.pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
            } catch (err) {
                console.warn(`Admin Camera ICE error (${slotId}):`, err);
            }
        } else if (msg.type === 'referee-status') {
            if (!msg.online) {
                if (feed.videoEl) feed.videoEl.srcObject = null;
                setTileState(feed, 'KAMERA OFFLINE', false);
            }
        }
    };

    ws.onerror = () => {
        setTileState(feed, 'SIGNALING ERROR', false);
    };
}

function syncCameraFeedsFromStorage() {
    const storedSlots = getConfirmedSlotsFromStorage();
    const storedSet = new Set(storedSlots);

    for (const existingId of [...activeCameraFeeds.keys()]) {
        if (!storedSet.has(existingId)) {
            removeCameraSlot(existingId, false);
        }
    }

    for (const slotId of storedSlots) {
        if (!activeCameraFeeds.has(slotId)) {
            const meta = CAMERA_SLOT_META[slotId];
            addOrReconnectCameraSlot(slotId, meta.label, meta.team, false);
        }
    }

    syncCameraDropdownState();
}

function initNavigationAndCameraMenu() {
    const navBrowse = document.getElementById('navBrowse');
    const navOverview = document.getElementById('navOverview');
    const navCamera = document.getElementById('navCamera');
    const backToBrowseBtn = document.getElementById('backToBrowseBtn');
    const summaryToBrowseBtn = document.getElementById('summaryToBrowseBtn');
    const refreshBrowseBtn = document.getElementById('refreshBrowseBtn');

    const slotSelect = document.getElementById('cameraSlotSelect');
    const selectedText = document.getElementById('selectedCameraText');
    const confirmBtn = document.getElementById('confirmCameraBtn');
    const clearAllCamBtn = document.getElementById('clearAllCamerasBtn');

    syncCameraFeedsFromStorage();

    window.addEventListener('storage', (e) => {
        if (e.key === CONFIRMED_CAMS_STORAGE_KEY) {
            syncCameraFeedsFromStorage();
        }
    });

    if (navBrowse) {
        navBrowse.addEventListener('click', (e) => {
            e.preventDefault();
            exitToMatchBrowse();
            refreshDashboard();
        });
    }

    if (backToBrowseBtn) {
        backToBrowseBtn.addEventListener('click', () => {
            exitToMatchBrowse();
            refreshDashboard();
        });
    }

    if (summaryToBrowseBtn) {
        summaryToBrowseBtn.addEventListener('click', () => {
            exitToMatchBrowse();
            refreshDashboard();
        });
    }

    if (refreshBrowseBtn) {
        refreshBrowseBtn.addEventListener('click', () => {
            refreshDashboard();
        });
    }

    if (navOverview) {
        navOverview.addEventListener('click', (e) => {
            e.preventDefault();
            if (activeViewMode === 'summary') {
                alert('Pertandingan sudah selesai. Menu Overview sudah dikunci.');
                return;
            }
            if (!selectedMatchId) {
                alert('Pilih match aktif terlebih dahulu di halaman Match Browse.');
                return;
            }
            switchAdminMenu('overview');
        });
    }

    if (navCamera) {
        navCamera.addEventListener('click', (e) => {
            e.preventDefault();
            if (activeViewMode === 'summary') {
                alert('Pertandingan sudah selesai. Menu Camera sudah dikunci.');
                return;
            }
            if (!selectedMatchId) {
                alert('Pilih match aktif terlebih dahulu di halaman Match Browse.');
                return;
            }
            switchAdminMenu('camera');
            syncCameraFeedsFromStorage();
        });
    }

    if (slotSelect && selectedText) {
        slotSelect.addEventListener('change', () => {
            const opt = slotSelect.options[slotSelect.selectedIndex];
            if (!opt || opt.disabled) {
                syncCameraDropdownState();
                return;
            }
            selectedText.textContent = `Pilihan: ${opt.dataset.baseText || opt.textContent}`;
        });
    }

    if (confirmBtn && slotSelect) {
        confirmBtn.addEventListener('click', () => {
            const opt = slotSelect.options[slotSelect.selectedIndex];
            if (!opt || opt.disabled || activeCameraFeeds.has(opt.value)) {
                syncCameraDropdownState();
                return;
            }
            addOrReconnectCameraSlot(
                opt.value,
                opt.dataset.label || (opt.dataset.baseText || opt.textContent).toUpperCase(),
                opt.dataset.team || 'red',
                true
            );
        });
    }

    if (clearAllCamBtn) {
        clearAllCamBtn.addEventListener('click', () => {
            [...activeCameraFeeds.keys()].forEach(slotId => removeCameraSlot(slotId, false));
            saveConfirmedSlotsToStorage();
            syncCameraDropdownState();
        });
    }
}

// ==============================
// INITIALIZE
// ==============================

initTacticalMap();
initNavigationAndCameraMenu();
switchAdminMenu('browse');
refreshDashboard();

refreshTimer = setInterval(() => {
    refreshDashboard();
}, 4000);