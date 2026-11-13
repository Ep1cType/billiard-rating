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

    const byId = playersMap(players);
    const hasResults = (tournament.results?.length ?? 0) > 0;
    const groups = (tournament.groups ?? []).filter((g) => (g.playerIds ?? []).length > 0);

    // Группы (жеребьёвка) — если турнир проводится с групповым этапом
    if (groups.length > 0) {
      const seedNumber = new Map((tournament.seeds ?? []).map((playerId, i) => [playerId, i + 1]));
      document.getElementById('groups-grid').innerHTML = groups
        .map(
          (group) => `
          <div class="group-card">
            <div class="group-card__head">
              <span class="group-card__title">Группа ${escapeHtml(group.id)}</span>
              <span class="group-card__count">${group.playerIds.length}</span>
            </div>
            <ul class="group-card__list">
              ${group.playerIds
                .map((playerId) => {
                  const seed = seedNumber.get(playerId);
                  const mark = seed
                    ? `<span class="seed-mark" title="Посев по рейтингу: №${seed}">${seed}</span>`
                    : '<span class="seed-mark seed-mark--none"></span>';
                  return `<li><a class="group-player" href="player.html?id=${encodeURIComponent(playerId)}">${mark}<span>${escapeHtml(byId.get(playerId)?.name ?? 'Неизвестный игрок')}</span></a></li>`;
                })
                .join('')}
            </ul>
          </div>`
        )
        .join('');
      document.getElementById('groups-note').textContent =
        seedNumber.size > 0 ? 'цифра у имени — номер посева по рейтингу' : '';
      document.getElementById('groups-section').hidden = false;
      document.getElementById('results-title').hidden = !hasResults;
    }

    document.getElementById('upcoming-note').hidden = hasResults;
    document.getElementById('standings-wrap').hidden = !hasResults;

    const standings = computeTournamentStandings(tournament, byId);
    document.getElementById('standings-body').innerHTML = standings
      .map(
        (row, i) => `
        <tr>
          <td class="idx">${i + 1}</td>
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
