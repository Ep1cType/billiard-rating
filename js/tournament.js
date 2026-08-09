import { loadData, playersMap } from './data.js';
import { computeTournamentStandings, typeLabel } from './ranking.js';
import { formatDate, escapeHtml } from './utils.js';

const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error-banner');
const contentEl = document.getElementById('content');
const notFoundEl = document.getElementById('not-found');

function ballBadge(place) {
  const rankClass = place <= 3 ? `rank-${place}` : '';
  return `<span class="ball-badge ${rankClass}">${place}</span>`;
}

function getTournamentId() {
  return new URLSearchParams(window.location.search).get('id');
}

async function init() {
  const id = getTournamentId();
  try {
    const { players, tournaments } = await loadData();
    const tournament = tournaments.find((t) => t.id === id);

    loadingEl.hidden = true;

    if (!id || !tournament) {
      notFoundEl.hidden = false;
      return;
    }

    document.title = `${tournament.name} — Бильярдный рейтинг`;
    document.getElementById('tournament-name').textContent = tournament.name;
    document.getElementById('tournament-date').textContent = formatDate(tournament.date);
    const badge = document.getElementById('type-badge');
    badge.textContent = typeLabel(tournament.type);
    badge.classList.add(`type-badge--${tournament.type}`);

    const standings = computeTournamentStandings(tournament, playersMap(players));
    document.getElementById('standings-body').innerHTML = standings
      .map(
        (row) => `
        <tr>
          <td class="place-cell">${ballBadge(row.place)}</td>
          <td class="name-cell"><a class="player-link" href="player.html?id=${encodeURIComponent(row.playerId)}">${escapeHtml(row.name)}</a></td>
          <td class="num points-cell">${row.points}</td>
        </tr>`
      )
      .join('');

    contentEl.hidden = false;
  } catch (err) {
    loadingEl.hidden = true;
    errorEl.hidden = false;
    errorEl.textContent = err.message || 'Не удалось загрузить турнир.';
  }
}

init();
