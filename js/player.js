import { loadData } from './data.js';
import { computePlayerProfile, computeLeaderboard, typeLabel } from './ranking.js';
import { formatDate, escapeHtml } from './utils.js';

const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error-banner');
const contentEl = document.getElementById('content');
const notFoundEl = document.getElementById('not-found');
const noHistoryEl = document.getElementById('no-history');

function ballBadge(place, size = '') {
  const rankClass = place && place <= 3 ? `rank-${place}` : '';
  const sizeClass = size ? `ball-badge--${size}` : '';
  return `<span class="ball-badge ${rankClass} ${sizeClass}">${place ?? '—'}</span>`;
}

function getPlayerId() {
  return new URLSearchParams(window.location.search).get('id');
}

function renderHistory(history) {
  const body = document.getElementById('history-body');
  if (history.length === 0) {
    body.innerHTML = '';
    document.querySelector('.table-wrap').hidden = true;
    document.getElementById('counted-hint').hidden = true;
    noHistoryEl.hidden = false;
    return;
  }

  body.innerHTML = history
    .map((h) => {
      const tag = h.isCounted ? '' : '<span class="not-counted-tag">не в зачёте</span>';
      return `
        <tr class="${h.isCounted ? '' : 'row-excluded'}">
          <td class="muted">${formatDate(h.date)}</td>
          <td class="name-cell">
            <a class="player-link" href="tournament.html?id=${encodeURIComponent(h.tournamentId)}">${escapeHtml(h.tournamentName)}</a>
          </td>
          <td><span class="type-badge type-badge--${h.type}">${typeLabel(h.type)}</span></td>
          <td class="num points-cell">${h.points}${tag}</td>
        </tr>`;
    })
    .join('');
}

async function init() {
  const id = getPlayerId();
  try {
    const { players, tournaments } = await loadData();
    const profile = computePlayerProfile(id, players, tournaments);

    loadingEl.hidden = true;

    if (!id || !profile) {
      notFoundEl.hidden = false;
      return;
    }

    document.title = `${profile.player.name} — Бильярдный рейтинг`;
    document.getElementById('player-name').textContent = profile.player.name;

    const leaderboard = computeLeaderboard(players, tournaments);
    const rankRow = leaderboard.find((r) => r.playerId === id);
    document.getElementById('player-badge').innerHTML = rankRow ? ballBadge(rankRow.place, 'lg') : '';

    document.getElementById('player-stats').innerHTML =
      `<span class="stat-points">${profile.totalPoints}</span> очков в общем зачёте · сыграно турниров: ${profile.played}`;

    document.getElementById('counted-hint').textContent =
      profile.played > profile.counted
        ? `В общий зачёт идут 12 турниров с наибольшими очками — остальные показаны ниже, но не входят в сумму.`
        : '';

    renderHistory(profile.history);

    contentEl.hidden = false;
  } catch (err) {
    loadingEl.hidden = true;
    errorEl.hidden = false;
    errorEl.textContent = err.message || 'Не удалось загрузить профиль игрока.';
  }
}

init();
