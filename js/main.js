import { loadData } from './data.js';
import { computeLeaderboard } from './ranking.js';
import { escapeHtml } from './utils.js';

const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error-banner');
const contentEl = document.getElementById('content');
const emptyStateEl = document.getElementById('empty-state');
const podiumEl = document.getElementById('podium');
const ratingBodyEl = document.getElementById('rating-body');

function ballBadge(place, size = '') {
  const rankClass = place <= 3 ? `rank-${place}` : '';
  const sizeClass = size ? `ball-badge--${size}` : '';
  return `<span class="ball-badge ${rankClass} ${sizeClass}">${place}</span>`;
}

function renderPodium(top3) {
  const order = ['second', 'first', 'third'];
  const byOrder = [top3[1], top3[0], top3[2]];
  podiumEl.innerHTML = byOrder
    .map((row, i) => {
      if (!row) return '';
      return `
        <div class="podium__card podium__card--${order[i]}">
          <div class="podium__badge">${ballBadge(row.place, 'lg')}</div>
          <div class="podium__name"><a href="player.html?id=${encodeURIComponent(row.playerId)}">${escapeHtml(row.name)}</a></div>
          <div class="podium__points">${row.total}</div>
          <div class="podium__points-label">очков</div>
        </div>`;
    })
    .join('');
}

function renderTable(rows) {
  ratingBodyEl.innerHTML = rows
    .map((row) => {
      const playedLabel =
        row.played > row.counted ? `${row.played} <span class="muted">(учтено ${row.counted})</span>` : `${row.played}`;
      return `
        <tr>
          <td class="place-cell">${ballBadge(row.place)}</td>
          <td class="name-cell"><a class="player-link" href="player.html?id=${encodeURIComponent(row.playerId)}">${escapeHtml(row.name)}</a></td>
          <td class="num muted">${playedLabel}</td>
          <td class="num points-cell">${row.total}</td>
        </tr>`;
    })
    .join('');
}

async function init() {
  try {
    const { players, tournaments } = await loadData();
    const leaderboard = computeLeaderboard(players, tournaments);

    loadingEl.hidden = true;

    if (leaderboard.length === 0) {
      emptyStateEl.hidden = false;
      return;
    }

    renderPodium(leaderboard.slice(0, 3));
    renderTable(leaderboard);
    contentEl.hidden = false;
  } catch (err) {
    loadingEl.hidden = true;
    errorEl.hidden = false;
    errorEl.textContent = err.message || 'Не удалось загрузить рейтинг.';
  }
}

init();
