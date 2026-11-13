import { GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH, DATA_PATH } from './config.js';
import { withPlaces, typeLabel } from './ranking.js';
import { generateId, utf8ToBase64, base64ToUtf8, escapeHtml, formatDate } from './utils.js';

const TOKEN_KEY = 'billiard_admin_token';
const API_BASE = 'https://api.github.com';

// ---- DOM references ----
const checkingTokenEl = document.getElementById('checking-token');
const tokenPanel = document.getElementById('token-panel');
const tokenInput = document.getElementById('token-input');
const saveTokenBtn = document.getElementById('save-token-btn');
const tokenErrorEl = document.getElementById('token-error');

const adminPanel = document.getElementById('admin-panel');
const logoutBtn = document.getElementById('logout-btn');
const form = document.getElementById('tournament-form');
const nameInput = document.getElementById('t-name');
const dateInput = document.getElementById('t-date');
const typeInput = document.getElementById('t-type');
const playersRowsEl = document.getElementById('players-rows');
const addRowBtn = document.getElementById('add-player-row-btn');
const datalistEl = document.getElementById('players-datalist');
const previewWrap = document.getElementById('preview-wrap');
const previewBody = document.getElementById('preview-body');
const formBanner = document.getElementById('form-banner');
const submitBtn = document.getElementById('submit-btn');
const editSelect = document.getElementById('edit-select');
const formTitle = document.getElementById('form-title');
const playersCountEl = document.getElementById('players-count');

let knownPlayers = []; // [{id, name}] — for datalist + matching existing players
let knownTournaments = []; // турниры из репозитория — для списка «что исправляем»
let editingId = null; // id турнира, который сейчас правим (null = добавляем новый)

/** Имена сравниваем без учёта регистра, «ё/е» и лишних пробелов — чтобы «Артём» и «Артем» не стали двумя игроками. */
function normName(name) {
  return String(name).trim().replace(/\s+/g, ' ').toLowerCase().replace(/ё/g, 'е');
}

// ============================================================
// Конфигурация
// ============================================================
function configIsMissing() {
  return GITHUB_OWNER === 'ВАШ_ЛОГИН' || GITHUB_REPO === 'НАЗВАНИЕ_РЕПОЗИТОРИЯ' || !GITHUB_OWNER || !GITHUB_REPO;
}

// ============================================================
// Токен
// ============================================================
function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
function setToken(t) {
  localStorage.setItem(TOKEN_KEY, t);
}
function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

function showAdminPanel() {
  checkingTokenEl.hidden = true;
  tokenPanel.hidden = true;
  adminPanel.hidden = false;
}
function showTokenPanel() {
  checkingTokenEl.hidden = true;
  adminPanel.hidden = true;
  tokenPanel.hidden = false;
}

saveTokenBtn.addEventListener('click', async () => {
  const value = tokenInput.value.trim();
  tokenErrorEl.hidden = true;
  if (!value) {
    tokenErrorEl.hidden = false;
    tokenErrorEl.textContent = 'Введите токен.';
    return;
  }

  saveTokenBtn.disabled = true;
  const originalLabel = saveTokenBtn.textContent;
  saveTokenBtn.innerHTML = '<span class="spinner"></span>&nbsp; Проверяем…';

  const ok = await tryEnterAdminMode(value);
  if (ok) {
    setToken(value);
    tokenInput.value = '';
  }

  saveTokenBtn.disabled = false;
  saveTokenBtn.textContent = originalLabel;
});

logoutBtn.addEventListener('click', () => {
  clearToken();
  showTokenPanel();
});

// ============================================================
// Данные для даталиста (список уже известных игроков)
// ============================================================
/** Обновляет подсказки имён и список турниров для правки по свежим данным из репозитория. */
function applyRepoData(data) {
  knownPlayers = data.players;
  knownTournaments = data.tournaments;
  datalistEl.innerHTML = [...knownPlayers]
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    .map((p) => `<option value="${escapeHtml(p.name)}"></option>`)
    .join('');

  const sorted = [...knownTournaments].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  editSelect.innerHTML =
    '<option value="">➕ Добавить новый турнир</option>' +
    sorted
      .map(
        (t) =>
          `<option value="${escapeHtml(t.id)}">✏️ ${escapeHtml(formatDate(t.date))} — ${escapeHtml(t.name)} (${escapeHtml(typeLabel(t.type))})</option>`
      )
      .join('');
  editSelect.value = editingId && knownTournaments.some((t) => t.id === editingId) ? editingId : '';
}

/**
 * Проверяет токен реальным запросом к GitHub и, если всё хорошо,
 * открывает форму. Возвращает true/false — удался ли вход.
 */
async function tryEnterAdminMode(token) {
  tokenErrorEl.hidden = true;

  if (configIsMissing()) {
    tokenErrorEl.hidden = false;
    tokenErrorEl.innerHTML =
      'Сайт ещё не настроен: откройте файл <code>js/config.js</code> и укажите GITHUB_OWNER и GITHUB_REPO.';
    return false;
  }

  try {
    // Заодно проверяет, что токен рабочий, и даёт самые свежие данные (без ожидания пересборки сайта)
    const { data } = await githubGetFile(token);
    applyRepoData(data);
  } catch (err) {
    tokenErrorEl.hidden = false;
    tokenErrorEl.textContent = err.message || 'Не удалось проверить токен.';
    return false;
  }

  showAdminPanel();
  if (playersRowsEl.children.length === 0) {
    addPlayerRow();
    addPlayerRow();
  }
  return true;
}

// ============================================================
// Строки "игрок + очки"
// ============================================================
function addPlayerRow(name = '', points = '') {
  const row = document.createElement('div');
  row.className = 'player-row';
  row.innerHTML = `
    <input type="text" class="player-name-input" list="players-datalist" placeholder="Имя игрока" autocomplete="off" aria-label="Имя игрока">
    <input type="number" class="player-points-input" placeholder="Очки" min="0" step="any" aria-label="Очки">
    <button type="button" class="remove-row-btn" aria-label="Удалить игрока">✕</button>
  `;
  row.querySelector('.remove-row-btn').addEventListener('click', () => {
    row.remove();
    updatePreview();
  });
  row.querySelector('.player-name-input').value = name;
  row.querySelector('.player-points-input').value = points;
  row.querySelector('.player-name-input').addEventListener('input', updatePreview);
  row.querySelector('.player-points-input').addEventListener('input', updatePreview);
  playersRowsEl.appendChild(row);
}

addRowBtn.addEventListener('click', () => {
  addPlayerRow();
  playersRowsEl.lastElementChild.querySelector('.player-name-input').focus();
});

function readPlayerRows() {
  return [...playersRowsEl.querySelectorAll('.player-row')].map((row) => ({
    name: row.querySelector('.player-name-input').value.trim(),
    pointsRaw: row.querySelector('.player-points-input').value.trim(),
  }));
}

/** Строки, где заполнены и имя, и очки */
function readCompleteRows() {
  return readPlayerRows()
    .filter((r) => r.name !== '' && r.pointsRaw !== '')
    .map((r) => ({ name: r.name, points: Number(r.pointsRaw) }));
}

// ============================================================
// Предпросмотр мест
// ============================================================
function updatePreview() {
  const filled = readPlayerRows().filter((r) => r.name !== '').length;
  playersCountEl.textContent = filled > 0 ? `· ${filled}` : '';

  const rows = readCompleteRows().filter((r) => Number.isFinite(r.points) && r.points >= 0);
  if (rows.length === 0) {
    previewWrap.hidden = true;
    return;
  }
  const withRanks = withPlaces(rows, 'points');
  previewBody.innerHTML = withRanks
    .map(
      (r, i) => `
      <tr>
        <td class="idx">${i + 1}</td>
        <td class="place-cell"><span class="ball-badge ${r.place <= 3 ? `rank-${r.place}` : ''}">${r.place}</span></td>
        <td class="name-cell">${escapeHtml(r.name)}</td>
        <td class="num points-cell">${r.points}</td>
      </tr>`
    )
    .join('');
  previewWrap.hidden = false;
}

// ============================================================
// GitHub API
// ============================================================
async function githubGetFile(token) {
  const url = `${API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${DATA_PATH}?ref=${GITHUB_BRANCH}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (!res.ok) throw await buildGithubError(res);
  const json = await res.json();
  const content = base64ToUtf8(json.content);
  const parsed = JSON.parse(content);
  return {
    data: {
      players: Array.isArray(parsed.players) ? parsed.players : [],
      tournaments: Array.isArray(parsed.tournaments) ? parsed.tournaments : [],
    },
    sha: json.sha,
  };
}

async function githubPutFile(token, dataObj, sha, message) {
  const url = `${API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${DATA_PATH}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      content: utf8ToBase64(JSON.stringify(dataObj, null, 2)),
      sha,
      branch: GITHUB_BRANCH,
    }),
  });
  if (!res.ok) throw await buildGithubError(res);
  return res.json();
}

async function buildGithubError(res) {
  let detail = '';
  try {
    const j = await res.json();
    detail = j.message || '';
  } catch (e) {
    /* ignore */
  }
  if (res.status === 401) return new Error('Токен недействителен или истёк. Нажмите «Сменить токен» и введите новый.');
  if (res.status === 403)
    return new Error(
      'Доступ запрещён. Проверьте, что токену выдано право «Contents: Read and write» для этого репозитория.'
    );
  if (res.status === 404)
    return new Error(
      'Репозиторий или файл данных не найдены. Проверьте GITHUB_OWNER/GITHUB_REPO в js/config.js и что файл data/db.json существует в репозитории.'
    );
  if (res.status === 409) return new Error('Данные изменились с момента загрузки формы. Обновите страницу и попробуйте снова.');
  return new Error(`Ошибка GitHub API (${res.status}): ${detail || 'неизвестная ошибка'}`);
}

// ============================================================
// Сохранение игроков (сопоставление с существующими по имени)
// ============================================================
function resolvePlayerId(players, name) {
  const norm = normName(name);
  const existing = players.find((p) => normName(p.name) === norm);
  if (existing) return { id: existing.id, isNew: false };
  const created = { id: generateId('p'), name: name.trim().replace(/\s+/g, ' ') };
  players.push(created);
  return { id: created.id, isNew: true, player: created };
}

// ============================================================
// Отправка формы
// ============================================================
function setBanner(type, html) {
  formBanner.hidden = false;
  formBanner.className = `banner banner-${type}`;
  formBanner.innerHTML = html;
}
function hideBanner() {
  formBanner.hidden = true;
}

function validateForm() {
  const name = nameInput.value.trim();
  const date = dateInput.value;
  const type = typeInput.value;
  const rows = readPlayerRows();

  if (!name) return { error: 'Укажите название турнира.' };
  if (!date) return { error: 'Укажите дату турнира.' };

  // Строки, где заполнено только одно из двух полей — ошибка
  const partial = rows.find((r) => (r.name !== '' && r.pointsRaw === '') || (r.name === '' && r.pointsRaw !== ''));
  if (partial) return { error: 'У одного из игроков не заполнено имя или очки. Заполните оба поля или удалите строку.' };

  const complete = readCompleteRows();
  if (complete.length === 0) return { error: 'Добавьте хотя бы одного игрока с очками.' };

  for (const r of complete) {
    if (!Number.isFinite(r.points) || r.points < 0) {
      return { error: `Некорректные очки у игрока «${r.name}». Очки должны быть числом от 0 и больше.` };
    }
  }

  const seen = new Set();
  for (const r of complete) {
    const norm = normName(r.name);
    if (seen.has(norm)) return { error: `Игрок «${r.name}» указан в турнире более одного раза.` };
    seen.add(norm);
  }

  return { name, date, type, results: complete };
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideBanner();

  const result = validateForm();
  if (result.error) {
    setBanner('error', escapeHtml(result.error));
    return;
  }

  const token = getToken();
  if (!token) {
    showTokenPanel();
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner"></span>&nbsp; Сохраняем…';

  try {
    // Всегда берём самую свежую версию файла прямо перед записью
    const { data, sha } = await githubGetFile(token);

    const newNames = [];
    const tournamentResults = result.results.map((r) => {
      const { id, isNew, player } = resolvePlayerId(data.players, r.name);
      if (isNew) newNames.push(player.name);
      return { playerId: id, points: r.points };
    });

    const removedNames = [];
    let commitMessage;

    if (editingId) {
      const tournament = data.tournaments.find((t) => t.id === editingId);
      if (!tournament) {
        throw new Error('Этот турнир не найден в репозитории — возможно, его уже удалили. Обновите страницу.');
      }
      const previousIds = tournament.results.map((r) => r.playerId);

      tournament.name = result.name;
      tournament.date = result.date;
      tournament.type = result.type;
      tournament.results = tournamentResults;

      // Игроки, которых убрали из этого турнира и у которых больше нет ни одного
      // результата нигде, — это и есть ошибочно созданные дубли. Убираем их из списка игроков.
      const stillPlaying = new Set(data.tournaments.flatMap((t) => t.results.map((r) => r.playerId)));
      const orphanIds = new Set(previousIds.filter((id) => !stillPlaying.has(id)));
      if (orphanIds.size > 0) {
        data.players = data.players.filter((p) => {
          if (!orphanIds.has(p.id)) return true;
          removedNames.push(p.name);
          return false;
        });
      }
      commitMessage = `Исправлен турнир: ${result.name} (${result.date})`;
    } else {
      data.tournaments.push({
        id: generateId('t'),
        name: result.name,
        date: result.date,
        type: result.type,
        results: tournamentResults,
      });
      commitMessage = `Турнир: ${result.name} (${result.date})`;
    }

    await githubPutFile(token, data, sha, commitMessage);

    const wasEditing = Boolean(editingId);
    editingId = null;
    applyRepoData(data); // подсказки имён и список турниров — сразу, не дожидаясь пересборки сайта

    const notes = [];
    if (newNames.length > 0) {
      notes.push(`Добавлены новые игроки: ${newNames.map((n) => `«${escapeHtml(n)}»`).join(', ')}. Если кто-то из них уже был в базе под другим написанием — откройте этот турнир на исправление и выберите нужное имя из подсказки.`);
    }
    if (removedNames.length > 0) {
      notes.push(`Удалены из списка игроков (больше не участвуют ни в одном турнире): ${removedNames.map((n) => `«${escapeHtml(n)}»`).join(', ')}.`);
    }

    setBanner(
      'success',
      `Турнир «${escapeHtml(result.name)}» ${wasEditing ? 'исправлен' : 'сохранён'}. Изменения появятся на сайте в течение минуты.
       ${notes.map((n) => `<div style="margin-top:8px;">${n}</div>`).join('')}
       <div class="banner-actions">
         <button type="button" class="btn btn-secondary" id="add-another-btn">Добавить ещё турнир</button>
         <a class="btn btn-ghost" href="tournaments.html">Смотреть турниры</a>
         <a class="btn btn-ghost" href="index.html">Смотреть рейтинг</a>
       </div>`
    );
    document.getElementById('add-another-btn').addEventListener('click', resetForm);
    resetFormFieldsOnly();
  } catch (err) {
    setBanner('error', escapeHtml(err.message || 'Не удалось сохранить турнир.'));
  } finally {
    submitBtn.disabled = false;
    updateModeLabels();
  }
});

function updateModeLabels() {
  formTitle.textContent = editingId ? 'Исправление турнира' : 'Новый турнир';
  submitBtn.textContent = editingId ? 'Сохранить изменения' : 'Сохранить турнир';
}

function resetFormFieldsOnly() {
  editingId = null;
  editSelect.value = '';
  nameInput.value = '';
  dateInput.value = '';
  typeInput.value = 'mini';
  playersRowsEl.innerHTML = '';
  addPlayerRow();
  addPlayerRow();
  updatePreview();
  updateModeLabels();
}

function resetForm() {
  hideBanner();
  resetFormFieldsOnly();
  nameInput.focus();
}

/** Заполняет форму данными сохранённого турнира (игроки — в порядке мест). */
function loadTournamentIntoForm(tournament) {
  const nameById = new Map(knownPlayers.map((p) => [p.id, p.name]));
  editingId = tournament.id;
  nameInput.value = tournament.name;
  dateInput.value = tournament.date;
  typeInput.value = tournament.type;
  playersRowsEl.innerHTML = '';
  [...tournament.results]
    .sort((a, b) => b.points - a.points)
    .forEach((r) => addPlayerRow(nameById.get(r.playerId) ?? '', r.points));
  updatePreview();
  updateModeLabels();
}

editSelect.addEventListener('change', () => {
  hideBanner();
  const tournament = knownTournaments.find((t) => t.id === editSelect.value);
  if (tournament) loadTournamentIntoForm(tournament);
  else resetFormFieldsOnly();
});

// ============================================================
// Инициализация
// ============================================================
(async function init() {
  const token = getToken();
  if (!token) return; // токена нет — панель входа и так видна по умолчанию

  tokenPanel.hidden = true;
  checkingTokenEl.hidden = false;
  const ok = await tryEnterAdminMode(token);
  if (!ok) showTokenPanel();
})();
