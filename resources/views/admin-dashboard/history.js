const API_BASE = 'http://127.0.0.1:8000';

let selectedMatchId = null;

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

function setDatabaseStatus(connected, message) {
    const item = document.querySelector('.system-row > div');
    if (!item) return;

    const small = item.querySelector('small');
    const status = item.querySelector('em');

    if (small) small.textContent = message;
    if (status) {
        status.textContent = connected ? 'CONNECTED' : 'OFFLINE';
        status.style.color = connected ? 'var(--lime)' : 'var(--red)';
    }
}

function formatDuration(seconds) {
    if (seconds === null || seconds === undefined) return '-';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
}

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
        const percentage = maxHp > 0 ? Math.max(0, Math.min(100, (hp / maxHp) * 100)) : 0;
        const eliminated = health?.is_eliminated ?? false;

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
        hpLabel.textContent = 'FINAL HEALTH';

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
        `;

        hpBackground.appendChild(hpBar);

        const status = document.createElement('small');
        status.textContent = eliminated ? 'ELIMINATED' : 'SURVIVED';
        status.style.cssText = `
            display:block;
            margin-top:8px;
            font:10px DM Mono,monospace;
            font-weight:bold;
            color:${eliminated ? 'var(--red)' : 'var(--lime)'};
        `;

        card.append(name, meta, hpInfo, hpBackground, status);
        container.appendChild(card);
    });
}


function renderDynamicReportTeams(teams = [], healthMap = new Map()) {
    const grid = document.getElementById('reportTeams');
    if (!grid) return;
    grid.innerHTML = '';
    if (!teams.length) {
        grid.innerHTML = '<div class="chart-empty">Tidak ada konfigurasi tim pada pertandingan ini.</div>';
        return;
    }
    teams.forEach((team, index) => {
        const color = team.team_color || '#94A3B8';
        const code = team.team_code || `TEAM-${index + 1}`;
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
        title.textContent = (team.team_name || code).toUpperCase();
        identity.append(faction, title);
        const count = document.createElement('b');
        count.textContent = `${team.total ?? team.players?.length ?? 0}/${team.capacity ?? '—'} PLAYERS`;
        heading.append(emblem, identity, count);
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'Tidak ada pemain di tim ini';
        const players = document.createElement('div');
        players.id = `reportPlayers-${code.replace(/[^a-z0-9_-]/gi, '-')}`;
        panel.append(heading, empty, players);
        grid.appendChild(panel);
        renderTeam(players.id, null, team, color, healthMap);
    });
}

function renderPlayerAnalytics(players = [], teams = []) {
    const container = document.getElementById('playerAnalyticsList');
    const status = document.getElementById('analyticsStatus');

    if (!container) return;
    container.innerHTML = '';

    if (!players.length) {
        container.innerHTML = `<div class="chart-empty">Belum ada data statistik pemain.</div>`;
        if (status) status.textContent = 'NO DATA';
        return;
    }

    if (status) status.textContent = `${players.length} PLAYERS`;

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
            ['JARAK TEMPUH', `${Number(player.distance_meters ?? 0).toFixed(2)} m`]
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
        message.textContent = event.description || event.event_type || 'Aktivitas pertandingan';

        item.append(timestamp, message);
        container.appendChild(item);
    });
}

async function loadMatchReport(matchItem, historyList) {
    selectedMatchId = matchItem.id;
    renderHistoryList(historyList);

    const titleEl = document.getElementById('selectedMatchTitle');
    const metaEl = document.getElementById('selectedMatchMeta');

    if (titleEl) {
        titleEl.textContent = `${matchItem.match_name} · ${matchItem.status.toUpperCase()}`;
    }

    if (metaEl) {
        metaEl.textContent = `DURASI: ${formatDuration(matchItem.duration_seconds)} · ${matchItem.total_events ?? 0} EVENTS`;
    }

    try {
        const [lobbyResult, healthResult, eventResult, analyticsResult] = await Promise.all([
            api(`/api/matches/${matchItem.id}/lobby`),
            api(`/api/matches/${matchItem.id}/health`),
            api(`/api/matches/${matchItem.id}/events?limit=200`),
            api(`/api/matches/${matchItem.id}/analytics`)
        ]);

        const healthMap = new Map(
            (healthResult.players || []).map(p => [p.player_id, p])
        );

        const configuredTeams = lobbyResult.lobby?.teams || [];
        renderDynamicReportTeams(configuredTeams, healthMap);
        renderPlayerAnalytics(analyticsResult.players || [], configuredTeams);
        renderEventLog(eventResult.events || []);

    } catch (error) {
        console.error('LOAD REPORT ERROR:', error);
    }
}

function renderHistoryList(historyList = []) {
    const container = document.getElementById('historyList');
    const countTag = document.getElementById('historyCountTag');

    if (countTag) {
        countTag.textContent = `${historyList.length} MATCHES`;
    }

    if (!container) return;
    container.innerHTML = '';

    if (!historyList.length) {
        container.innerHTML = `<div class="chart-empty">Belum ada riwayat pertandingan tersimpan.</div>`;
        return;
    }

    historyList.forEach(item => {
        const isSelected = selectedMatchId === item.id;
        const row = document.createElement('div');
        row.className = `history-item ${isSelected ? 'selected' : ''}`;

        const badgeClass = item.status === 'completed'
            ? 'badge-completed'
            : item.status === 'active'
                ? 'badge-active'
                : 'badge-waiting';

        const createdDate = item.created_at
            ? new Date(item.created_at).toLocaleString('id-ID', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            })
            : '-';

        const left = document.createElement('div');
        left.innerHTML = `
            <strong style="font-size:13px;">${item.match_name}</strong>
            <span class="badge-status ${badgeClass}">${item.status.toUpperCase()}</span>
            <div class="history-meta">
                <span>WAKTU: ${createdDate}</span>
                <span>DURASI: ${formatDuration(item.duration_seconds)}</span>
                <span>PEMAIN: ${item.total_players} (R:${item.red_players} / B:${item.blue_players})</span>
                <span>TEMBAKAN: ${item.total_shots}</span>
                <span>EVENTS: ${item.total_events}</span>
            </div>
        `;

        const btn = document.createElement('button');
        btn.className = 'btn start';
        btn.textContent = isSelected ? '✓ SEDANG DITAMPILKAN' : '◫ LIHAT LAPORAN';
        btn.disabled = isSelected;

        btn.addEventListener('click', async () => {
            await loadMatchReport(item, historyList);
            document.getElementById('selectedMatchTitle')?.scrollIntoView({ behavior: 'smooth' });
        });

        row.append(left, btn);
        container.appendChild(row);
    });
}

async function initHistoryPage() {
    try {
        const result = await api('/api/matches/history');
        const historyList = result.history || [];

        setDatabaseStatus(true, 'Supabase PostgreSQL terhubung');

        if (historyList.length > 0) {
            await loadMatchReport(historyList[0], historyList);
        } else {
            renderHistoryList([]);
        }
    } catch (error) {
        console.error('HISTORY PAGE ERROR:', error);
        setDatabaseStatus(false, `API tidak dapat diakses: ${error.message}`);
    }
}

initHistoryPage();