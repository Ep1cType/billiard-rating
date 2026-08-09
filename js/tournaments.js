import { loadData } from './data.js';
import { typeLabel } from './ranking.js';
import { formatDate, escapeHtml } from './utils.js';

const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error-banner');
const listEl = document.getElementById('list');
const emptyStateEl = document.getElementById('empty-state');

function render(tournaments) {
  const sorted = [...tournaments].sort((a, b) => (a.date < b.date ? 1 : -1));
  listEl.innerHTML = sorted
    .map((t) => {
      const count = t.results?.length ?? 0;
      const playersWord = pluralPlayers(count);
      return `
        <a class="tournament-list-item" href="tournament.html?id=${encodeURIComponent(t.id)}">
          <div class="tournament-list-item__main">
            <span class="type-badge type-badge--${t.type}">${typeLabel(t.type)}</span>
            <span class="tournament-list-item__name">${escapeHtml(t.name)}</span>
          </div>
          <div class="tournament-list-item__meta">${formatDate(t.date)} · ${count} ${playersWord}</div>
        </a>`;
    })
    .join('');
}

function pluralPlayers(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'игрок';
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'игрока';
  return 'игроков';
}

async function init() {
  try {
    const { tournaments } = await loadData();
    loadingEl.hidden = true;

    if (tournaments.length === 0) {
      emptyStateEl.hidden = false;
      return;
    }
    render(tournaments);
  } catch (err) {
    loadingEl.hidden = true;
    errorEl.hidden = false;
    errorEl.textContent = err.message || 'Не удалось загрузить список турниров.';
  }
}

init();
