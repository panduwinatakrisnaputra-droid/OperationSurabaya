const API_BASE = 'http://127.0.0.1:8000';

const start = document.getElementById('startBtn');
const stop = document.getElementById('stopBtn');
const state = document.getElementById('matchState');
const deleteAllBtn = document.getElementById('deleteAllBtn');

let currentMatch = null;
let refreshTimer = null;

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

    if (!container || !count) return;

    const list = team?.players || [];

    count.textContent = `${list.length} PLAYERS`;
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
        meta.textContent = `@${player.username} · ${item.player_status || 'joined'}`;
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

    // Tombol START hanya aktif saat waiting
    if (start) {
        start.disabled = match.status !== 'waiting';
    }

    // Tombol END hanya aktif saat active
    if (stop) {
        stop.disabled = match.status !== 'active';
    }

    if (mapStatus) {
        mapStatus.textContent = match.status === 'active'
            ? 'LIVE SESSION'
            : match.status === 'completed'
                ? 'MATCH COMPLETED · DATA SAVED'
                : 'WAITING LOBBY';
    }
}

// ==============================
// EVENT LOG
// ==============================

function renderEventLog(events = []) {
    const container = document.getElementById('logList');

    if (!container) return;

    container.innerHTML = '';

    if (!events.length) {
        container.innerHTML = `
            <div class="log-empty">
                Belum ada aktivitas pertandingan.
            </div>
        `;
        return;
    }

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

function renderPlayerAnalytics(players = []) {
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

        const teamClass = player.team_code === 'RED'
            ? 'red-text'
            : 'blue-text';

        const heading = document.createElement('div');
        heading.className = 'player-analytics-heading';

        const identity = document.createElement('div');

        const name = document.createElement('strong');
        name.textContent = player.full_name || player.username || 'Unknown Player';

        const username = document.createElement('small');
        username.textContent = `@${player.username || '-'}`;

        identity.append(name, username);

        const team = document.createElement('span');
        team.className = `player-team-tag ${teamClass}`;
        team.textContent = player.team_code || player.team || '-';

        heading.append(identity, team);

        const metrics = [
            ['TOTAL TEMBAKAN', player.total_shots ?? 0],
            ['HIT GIVEN', player.total_hit_given ?? 0],
            ['HIT RECEIVED', player.total_hit_received ?? 0],
            ['TOTAL HEAL', player.total_heal ?? 0],
            ['TOTAL LANGKAH', player.total_steps ?? 0],
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
    renderTeam('redPlayers', 'redCount', { players: [] }, 'var(--red)');
    renderTeam('bluePlayers', 'blueCount', { players: [] }, 'var(--blue)');
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

        // Ambil data utama dashboard
        const [lobbyResult, healthResult, eventResult] = await Promise.all([
            api(`/api/matches/${matchId}/lobby`),
            api(`/api/matches/${matchId}/health`),
            api(`/api/matches/${matchId}/events`)
        ]);

        renderEventLog(eventResult.events || []);

        const healthMap = new Map(
            (healthResult.players || []).map(player => [
                player.player_id,
                player
            ])
        );

        renderTeam(
            'redPlayers',
            'redCount',
            lobbyResult.lobby?.red_team,
            'var(--red)',
            healthMap
        );

        renderTeam(
            'bluePlayers',
            'blueCount',
            lobbyResult.lobby?.blue_team,
            'var(--blue)',
            healthMap
        );

        // Analytics
        try {
            const analyticsResult = await api(
                `/api/matches/${matchId}/analytics`
            );

            renderPlayerAnalytics(analyticsResult.players || []);

        } catch (analyticsError) {
            console.error('PLAYER ANALYTICS ERROR:', analyticsError);

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
            'Data pertandingan akan tetap tersimpan.'
        );

        if (!confirmed) return;

        stop.disabled = true;

        try {
            await api(
                `/api/admin/matches/${currentMatch.id}/end`,
                { method: 'POST' }
            );

            await refreshDashboard();

            alert('Pertandingan berhasil diakhiri. Data tetap tersimpan.');

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
            deleteAllBtn.textContent = 'DELETE ALL';
        }
    });
}

// ==============================
// INITIALIZE
// ==============================

refreshDashboard();

refreshTimer = setInterval(() => {
    refreshDashboard();
}, 4000);