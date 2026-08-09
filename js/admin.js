import { GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH, DATA_PATH } from './config.js';
import { loadData } from './data.js';
import { withPlaces } from './ranking.js';
import { generateId, utf8ToBase64, base64ToUtf8, escapeHtml } from './utils.js';

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

let knownPlayers = []; // [{id, name}] — for datalist + matching existing players

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
async function refreshKnownPlayers() {
  try {
    const { players } = await loadData();
    knownPlayers = players;
    datalistEl.innerHTML = players.map((p) => `<option value="${escapeHtml(p.name)}"></option>`).join('');
  } catch (err) {
    // Некритично: без даталиста форма всё равно работает, просто без автодополнения.
    console.warn('Не удалось загрузить список игроков для автодополнения', err);
  }
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
    await githubGetFile(token); // заодно проверяет, что токен рабочий и файл данных доступен
  } catch (err) {
    tokenErrorEl.hidden = false;
    tokenErrorEl.textContent = err.message || 'Не удалось проверить токен.';
    return false;
  }

  showAdminPanel();
  await refreshKnownPlayers();
  if (playersRowsEl.children.length === 0) {
    addPlayerRow();
    addPlayerRow();
  }
  return true;
}

// ============================================================
// Строки "игрок + очки"
// ============================================================
function addPlayerRow() {
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
  row.querySelector('.player-name-input').addEventListener('input', updatePreview);
  row.querySelector('.player-points-input').addEventListener('input', updatePreview);
  playersRowsEl.appendChild(row);
}

addRowBtn.addEventListener('click', addPlayerRow);

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
  const rows = readCompleteRows().filter((r) => Number.isFinite(r.points) && r.points >= 0);
  if (rows.length === 0) {
    previewWrap.hidden = true;
    return;
  }
  const withRanks = withPlaces(rows, 'points');
  previewBody.innerHTML = withRanks
    .map(
      (r) => `
      <tr>
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
  const norm = name.trim().toLowerCase();
  const existing = players.find((p) => p.name.trim().toLowerCase() === norm);
  if (existing) return { id: existing.id, isNew: false };
  const created = { id: generateId('p'), name: name.trim() };
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
    const norm = r.name.toLowerCase();
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
  const originalLabel = submitBtn.textContent;
  submitBtn.innerHTML = '<span class="spinner"></span>&nbsp; Сохраняем…';

  try {
    const { data, sha } = await githubGetFile(token);

    const newlyCreated = [];
    const tournamentResults = result.results.map((r) => {
      const { id, isNew, player } = resolvePlayerId(data.players, r.name);
      if (isNew) newlyCreated.push(player);
      return { playerId: id, points: r.points };
    });

    const newTournament = {
      id: generateId('t'),
      name: result.name,
      date: result.date,
      type: result.type,
      results: tournamentResults,
    };
    data.tournaments.push(newTournament);

    await githubPutFile(token, data, sha, `Турнир: ${result.name} (${result.date})`);

    // Обновляем локальный список игроков для автодополнения, не дожидаясь пересборки сайта
    if (newlyCreated.length > 0) {
      knownPlayers = [...knownPlayers, ...newlyCreated];
      datalistEl.innerHTML = knownPlayers.map((p) => `<option value="${escapeHtml(p.name)}"></option>`).join('');
    }

    setBanner(
      'success',
      `Турнир «${escapeHtml(result.name)}» сохранён. Изменения появятся на сайте в течение минуты.
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
    submitBtn.textContent = originalLabel;
  }
});

function resetFormFieldsOnly() {
  nameInput.value = '';
  dateInput.value = '';
  typeInput.value = 'mini';
  playersRowsEl.innerHTML = '';
  addPlayerRow();
  addPlayerRow();
  previewWrap.hidden = true;
}

function resetForm() {
  hideBanner();
  resetFormFieldsOnly();
  nameInput.focus();
}

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
