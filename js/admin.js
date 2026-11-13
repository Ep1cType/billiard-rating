import { GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH, DATA_PATH } from './config.js';
import { withPlaces, typeLabel, computeLeaderboard } from './ranking.js';
import { calculateGroups, distributeByRating, MIN_GROUP_PLAYERS, MAX_GROUP_PLAYERS } from './groups.js';
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

const groupsStatusEl = document.getElementById('groups-status');
const groupsCountSelect = document.getElementById('groups-count-select');
const drawBtn = document.getElementById('draw-btn');
const clearGroupsBtn = document.getElementById('clear-groups-btn');
const groupsBoard = document.getElementById('groups-board');
const undoBar = document.getElementById('undo-bar');
const undoText = document.getElementById('undo-text');
const undoBtn = document.getElementById('undo-btn');
const deleteBtn = document.getElementById('delete-btn');

let knownPlayers = []; // [{id, name}] — для подсказок имён и сопоставления с существующими игроками
let knownTournaments = []; // турниры из репозитория — для списка «что исправляем» и рейтинга при посеве
let editingId = null; // id турнира, который сейчас правим (null = добавляем новый)

// Группы в форме. Игроки в группах привязаны к строкам формы (по uid строки),
// поэтому переименование игрока не ломает распределение.
// null = турнир без групп; иначе { groups: [{ id: 'A', uids: [...] }], seeds: [uid, ...] }
let groupsState = null;
let selectedUid = null; // игрок, выбранный для обмена/перемещения
let rowUidCounter = 0;
let saving = false;
let lastRemoved = null; // последняя удалённая строка игрока — для кнопки «Вернуть»

/** Имена сравниваем без учёта регистра, «ё/е» и лишних пробелов — чтобы «Артём» и «Артем» не стали двумя игроками. */
function normName(name) {
  return String(name).trim().replace(/\s+/g, ' ').toLowerCase().replace(/ё/g, 'е');
}

function isUpcoming(tournament) {
  return (tournament.results?.length ?? 0) === 0;
}

/** Все игроки, связанные с турниром: и по результатам, и по группам. */
function participantIds(tournament) {
  const ids = new Set((tournament.results ?? []).map((r) => r.playerId));
  for (const group of tournament.groups ?? []) {
    for (const id of group.playerIds ?? []) ids.add(id);
  }
  return ids;
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
// Свежие данные из репозитория → подсказки имён и список турниров
// ============================================================
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
      .map((t) => {
        const note = isUpcoming(t) ? ' · жеребьёвка, очки не внесены' : '';
        return `<option value="${escapeHtml(t.id)}">✏️ ${escapeHtml(formatDate(t.date))} — ${escapeHtml(t.name)} (${escapeHtml(typeLabel(t.type))})${note}</option>`;
      })
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
  onRowsChanged();
  return true;
}

// ============================================================
// Строки "игрок + очки"
// ============================================================
function addPlayerRow(name = '', points = '') {
  const row = document.createElement('div');
  row.className = 'player-row';
  rowUidCounter += 1;
  row.dataset.uid = String(rowUidCounter);
  row.innerHTML = `
    <input type="text" class="player-name-input" list="players-datalist" placeholder="Имя игрока" autocomplete="off" autocapitalize="words" autocorrect="off" spellcheck="false" enterkeyhint="next" aria-label="Имя игрока">
    <input type="number" class="player-points-input" placeholder="Очки" min="0" step="any" inputmode="decimal" enterkeyhint="next" aria-label="Очки">
    <button type="button" class="remove-row-btn" aria-label="Удалить игрока">✕</button>
  `;
  row.querySelector('.player-name-input').value = name;
  row.querySelector('.player-points-input').value = points;
  row.querySelector('.remove-row-btn').addEventListener('click', () => removeRow(row));
  row.querySelector('.player-name-input').addEventListener('input', onRowsChanged);
  row.querySelector('.player-points-input').addEventListener('input', onRowsChanged);
  playersRowsEl.appendChild(row);
  return row.dataset.uid;
}

addRowBtn.addEventListener('click', () => {
  addPlayerRow();
  playersRowsEl.lastElementChild.querySelector('.player-name-input').focus();
  onRowsChanged();
});

/** Удаляет строку игрока. Если в ней было имя — показывает «Вернуть» (на телефоне легко промахнуться). */
function removeRow(row) {
  const name = row.querySelector('.player-name-input').value.trim();
  const uid = row.dataset.uid;
  lastRemoved = name
    ? {
        row,
        next: row.nextElementSibling,
        place: groupsState ? locate(uid) : null, // где игрок стоял в группах
        seedPos: groupsState ? groupsState.seeds.indexOf(uid) : -1,
      }
    : null;
  row.remove();
  undoText.textContent = name ? `Убран: ${name}` : '';
  undoBar.hidden = !lastRemoved;
  onRowsChanged();
}

function clearUndo() {
  lastRemoved = null;
  undoBar.hidden = true;
}

undoBtn.addEventListener('click', () => {
  if (!lastRemoved) return;
  const { row, next, place, seedPos } = lastRemoved;
  const uid = row.dataset.uid;
  playersRowsEl.insertBefore(row, next && next.parentNode === playersRowsEl ? next : null);
  // Возвращаем игрока на прежнее место в его группе (и в посеве)
  if (groupsState && place && place.group !== -1 && groupsState.groups[place.group]) {
    const uids = groupsState.groups[place.group].uids;
    uids.splice(Math.min(place.pos, uids.length), 0, uid);
    if (seedPos !== -1) groupsState.seeds.splice(Math.min(seedPos, groupsState.seeds.length), 0, uid);
  }
  clearUndo();
  onRowsChanged();
});

// Клавиша «Далее»/Enter на телефоне не должна отправлять форму: ведём по полям.
// Имя → очки этой строки → имя следующей строки (в конце списка добавляется новая строка).
form.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
  e.preventDefault();
  const row = e.target.closest('.player-row');
  if (!row) {
    e.target.blur();
    return;
  }
  if (e.target.classList.contains('player-name-input')) {
    row.querySelector('.player-points-input').focus();
    return;
  }
  if (!row.nextElementSibling) {
    addPlayerRow();
    onRowsChanged();
  }
  row.nextElementSibling.querySelector('.player-name-input').focus();
});

function readPlayerRows() {
  return [...playersRowsEl.querySelectorAll('.player-row')].map((row) => ({
    uid: row.dataset.uid,
    name: row.querySelector('.player-name-input').value.trim(),
    pointsRaw: row.querySelector('.player-points-input').value.trim(),
  }));
}

/** Строки, в которых вписано имя */
function namedRows() {
  return readPlayerRows().filter((r) => r.name !== '');
}

/** Вызывается при любом изменении списка игроков: счётчик, предпросмотр мест, группы, подписи. */
function onRowsChanged() {
  const named = namedRows();
  playersCountEl.textContent = named.length > 0 ? `· ${named.length}` : '';
  renderPreview(named);
  reconcileGroups(named);
  renderGroups(named);
  updateModeLabels(named);
}

// ============================================================
// Предпросмотр мест
// ============================================================
function renderPreview(named) {
  const rows = named
    .filter((r) => r.pointsRaw !== '')
    .map((r) => ({ name: r.name, points: Number(r.pointsRaw) }))
    .filter((r) => Number.isFinite(r.points) && r.points >= 0);
  if (rows.length === 0) {
    previewWrap.hidden = true;
    return;
  }
  previewBody.innerHTML = withPlaces(rows, 'points')
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
// Группы: расчёт, жеребьёвка, ручная правка
// ============================================================

/** Расчёт групп для текущего числа игроков с учётом выбора организатора (когда вариантов несколько). */
function currentCalc(playersCount) {
  const first = calculateGroups(playersCount);
  if (first.status !== 'choice-required') return first;
  const options = first.availableGroupCounts;
  const chosen = options.includes(Number(groupsCountSelect.value)) ? Number(groupsCountSelect.value) : options[0];
  return calculateGroups(playersCount, chosen);
}

/** Убирает из групп игроков, чьих строк больше нет (или у кого стёрли имя). */
function reconcileGroups(named) {
  const valid = new Set(named.map((r) => r.uid));
  if (selectedUid && !valid.has(selectedUid)) selectedUid = null;
  if (!groupsState) return;
  for (const group of groupsState.groups) {
    group.uids = group.uids.filter((uid) => valid.has(uid));
  }
  groupsState.seeds = groupsState.seeds.filter((uid) => valid.has(uid));
}

function unassignedRows(named) {
  if (!groupsState) return [];
  const assigned = new Set(groupsState.groups.flatMap((g) => g.uids));
  return named.filter((r) => !assigned.has(r.uid));
}

function findDuplicateName(named) {
  const seen = new Set();
  for (const r of named) {
    const norm = normName(r.name);
    if (seen.has(norm)) return r.name;
    seen.add(norm);
  }
  return null;
}

/** Текущий рейтинг сайта (сумма 12 лучших) по имени игрока — основа посева. */
function ratingLookup() {
  // Турнир, который сейчас правим, в рейтинг для посева не входит
  const leaderboard = computeLeaderboard(
    knownPlayers,
    knownTournaments.filter((t) => t.id !== editingId)
  );
  const byName = new Map(leaderboard.map((row) => [normName(row.name), row]));
  return (name) => {
    const row = byName.get(normName(name));
    return row ? { ratingPoints: row.total, tournamentsPlayed: row.played } : { ratingPoints: 0, tournamentsPlayed: 0 };
  };
}

function runDraw() {
  const named = namedRows();
  const duplicate = findDuplicateName(named);
  if (duplicate) {
    showGroupsError(`Игрок «${duplicate}» вписан дважды — уберите повтор, затем проведите жеребьёвку.`);
    return;
  }
  const calc = currentCalc(named.length);
  if (calc.status !== 'success') return;

  if (
    groupsState &&
    !window.confirm('Провести жеребьёвку заново? Текущее распределение по группам будет заменено.')
  ) {
    return;
  }

  const rating = ratingLookup();
  const players = named.map((r) => ({ id: r.uid, name: r.name, ...rating(r.name) }));
  const { groups, seeded } = distributeByRating(players, calc.groups);

  groupsState = {
    groups: groups.map((g) => ({ id: g.id, uids: g.players.map((p) => p.id) })),
    // Сеяными считаем только тех, у кого действительно есть рейтинг
    seeds: seeded.filter((p) => p.ratingPoints > 0).map((p) => p.id),
  };
  selectedUid = null;
  clearUndo();
  hideBanner();
  onRowsChanged();
}

function showGroupsError(text) {
  groupsStatusEl.textContent = text;
  groupsStatusEl.classList.add('hint--error');
}

function renderGroups(named) {
  const calc = currentCalc(named.length);
  groupsStatusEl.classList.remove('hint--error');

  // Выбор числа групп — только когда подходит несколько вариантов (например, 24 участника: 6 или 8)
  const options = calc.status === 'success' ? calc.availableGroupCounts : [];
  if (options.length > 1) {
    const current = Number(groupsCountSelect.value);
    groupsCountSelect.innerHTML = options.map((n) => `<option value="${n}">Групп: ${n}</option>`).join('');
    groupsCountSelect.value = String(options.includes(current) ? current : options[0]);
    groupsCountSelect.hidden = false;
  } else {
    groupsCountSelect.hidden = true;
  }

  drawBtn.disabled = calc.status !== 'success';
  drawBtn.textContent = groupsState ? 'Пережеребить заново' : 'Провести жеребьёвку';
  clearGroupsBtn.hidden = !groupsState;

  const sizeNote =
    calc.status === 'success'
      ? `Участников: ${named.length} → групп: ${calc.groupCount} (по ${calc.groups.join(', ')}), из групп выходят: ${calc.advancingPlayers}.`
      : `Группы доступны, когда участников от ${MIN_GROUP_PLAYERS} до ${MAX_GROUP_PLAYERS}. Сейчас вписано: ${named.length}.`;

  if (!groupsState) {
    groupsStatusEl.textContent =
      calc.status === 'success'
        ? `${sizeNote} Восемь сильнейших по рейтингу распределяются змейкой, остальные — случайно.`
        : sizeNote;
    groupsBoard.innerHTML = '';
    return;
  }

  groupsStatusEl.textContent =
    'Жеребьёвка проведена и сохранится вместе с турниром. Чтобы поменять двух игроков местами, нажмите на одного, затем на другого. Чтобы перевести игрока в другую группу, нажмите на него, затем «＋ сюда» у нужной группы.';

  const nameByUid = new Map(named.map((r) => [r.uid, r.name]));
  const seedNumber = new Map(groupsState.seeds.map((uid, i) => [uid, i + 1]));
  const selectedGroup = groupsState.groups.findIndex((g) => g.uids.includes(selectedUid));

  const playerButton = (uid) => {
    const seed = seedNumber.get(uid);
    return `
      <li>
        <button type="button" class="group-player${uid === selectedUid ? ' is-selected' : ''}" data-uid="${uid}">
          ${seed ? `<span class="seed-mark" title="Посев по рейтингу: №${seed}">${seed}</span>` : '<span class="seed-mark seed-mark--none"></span>'}
          <span>${escapeHtml(nameByUid.get(uid) ?? '')}</span>
        </button>
      </li>`;
  };

  const cards = groupsState.groups
    .map((group, index) => {
      const canMoveHere = selectedUid !== null && selectedGroup !== index;
      return `
        <div class="group-card">
          <div class="group-card__head">
            <span class="group-card__title">Группа ${escapeHtml(group.id)}</span>
            <span class="group-card__count">${group.uids.length}</span>
            <button type="button" class="group-move-btn" data-group="${index}"${canMoveHere ? '' : ' hidden'}>＋ сюда</button>
          </div>
          <ul class="group-card__list">${group.uids.map(playerButton).join('')}</ul>
        </div>`;
    })
    .join('');

  const unassigned = unassignedRows(named);
  const unassignedCard =
    unassigned.length > 0
      ? `
        <div class="group-card group-card--unassigned">
          <div class="group-card__head">
            <span class="group-card__title">Без группы</span>
            <span class="group-card__count">${unassigned.length}</span>
          </div>
          <ul class="group-card__list">${unassigned.map((r) => playerButton(r.uid)).join('')}</ul>
          <p class="hint">Добавлены после жеребьёвки. Нажмите на игрока, затем «＋ сюда» у группы.</p>
        </div>`
      : '';

  const selectionBar =
    selectedUid !== null
      ? `<div class="groups-selection">
           <span>Выбран: <strong>${escapeHtml(nameByUid.get(selectedUid) ?? '')}</strong> — нажмите на другого игрока или «＋ сюда»</span>
           <button type="button" class="groups-selection__cancel" data-cancel>Отмена</button>
         </div>`
      : '';

  groupsBoard.innerHTML = `${selectionBar}<div class="groups-grid">${cards}${unassignedCard}</div>`;
}

/** Где сейчас игрок: { group: индекс группы или -1, pos } */
function locate(uid) {
  for (let g = 0; g < groupsState.groups.length; g += 1) {
    const pos = groupsState.groups[g].uids.indexOf(uid);
    if (pos !== -1) return { group: g, pos };
  }
  return { group: -1, pos: -1 };
}

function swapPlayers(uidA, uidB) {
  const a = locate(uidA);
  const b = locate(uidB);
  if (a.group !== -1) groupsState.groups[a.group].uids[a.pos] = uidB;
  if (b.group !== -1) groupsState.groups[b.group].uids[b.pos] = uidA;
}

function movePlayer(uid, groupIndex) {
  const from = locate(uid);
  if (from.group !== -1) groupsState.groups[from.group].uids.splice(from.pos, 1);
  groupsState.groups[groupIndex].uids.push(uid);
}

groupsBoard.addEventListener('click', (e) => {
  if (!groupsState) return;
  const moveBtn = e.target.closest('.group-move-btn');
  const playerBtn = e.target.closest('.group-player');

  if (e.target.closest('[data-cancel]')) {
    selectedUid = null;
  } else if (moveBtn && selectedUid !== null) {
    movePlayer(selectedUid, Number(moveBtn.dataset.group));
    selectedUid = null;
  } else if (playerBtn) {
    const uid = playerBtn.dataset.uid;
    if (selectedUid === null) selectedUid = uid;
    else if (selectedUid === uid) selectedUid = null;
    else {
      swapPlayers(selectedUid, uid);
      selectedUid = null;
    }
  } else {
    return;
  }
  onRowsChanged();
});

drawBtn.addEventListener('click', runDraw);
groupsCountSelect.addEventListener('change', onRowsChanged);
clearGroupsBtn.addEventListener('click', () => {
  if (!window.confirm('Убрать группы из этого турнира?')) return;
  groupsState = null;
  selectedUid = null;
  onRowsChanged();
});

// ============================================================
// GitHub API
// ============================================================
async function githubGetFile(token) {
  const url = `${API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${DATA_PATH}?ref=${GITHUB_BRANCH}`;
  const res = await fetch(url, {
    cache: 'no-store', // иначе браузер может минуту отдавать старую версию файла
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (!res.ok) throw await buildGithubError(res, false);
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
  if (!res.ok) throw await buildGithubError(res, true);
  return res.json();
}

async function buildGithubError(res, isWrite) {
  let detail = '';
  try {
    const j = await res.json();
    detail = j.message || '';
  } catch (e) {
    /* ignore */
  }
  const githubSays = detail ? ` Ответ GitHub: «${detail}».` : '';
  if (res.status === 401) return new Error('Токен недействителен или истёк. Нажмите «Сменить токен» и введите новый.');
  if (res.status === 403 || res.status === 429) {
    const rateLimited = /rate limit/i.test(detail) || res.headers?.get?.('x-ratelimit-remaining') === '0';
    if (rateLimited) {
      return new Error(`GitHub временно ограничил число запросов. Подождите несколько минут и попробуйте снова.${githubSays}`);
    }
    if (isWrite) {
      return new Error(
        `GitHub не разрешил запись в репозиторий ${GITHUB_OWNER}/${GITHUB_REPO}, хотя чтение работает. Обычно это значит, что у токена для этого репозитория нет права «Contents: Read and write» (только чтение, или токен выдан на другой репозиторий). Создайте новый токен и введите его через «Сменить токен».${githubSays}`
      );
    }
    return new Error(`Доступ запрещён. Проверьте, что токену выдан доступ к репозиторию ${GITHUB_OWNER}/${GITHUB_REPO}.${githubSays}`);
  }
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
  // На телефоне форма длинная — показываем сообщение, где бы ни был экран
  formBanner.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
}
function hideBanner() {
  formBanner.hidden = true;
}

const quoteList = (names, max = 4) =>
  names.slice(0, max).map((n) => `«${n}»`).join(', ') + (names.length > max ? ` и ещё ${names.length - max}` : '');

function validateForm() {
  const name = nameInput.value.trim();
  const date = dateInput.value;
  const type = typeInput.value;
  const rows = readPlayerRows();
  const named = rows.filter((r) => r.name !== '');

  if (!name) return { error: 'Укажите название турнира.' };
  if (!date) return { error: 'Укажите дату турнира.' };

  if (rows.some((r) => r.name === '' && r.pointsRaw !== '')) {
    return { error: 'В одной из строк вписаны очки, но нет имени игрока. Впишите имя или удалите строку.' };
  }
  if (named.length === 0) return { error: 'Добавьте хотя бы одного игрока.' };

  const duplicate = findDuplicateName(named);
  if (duplicate) return { error: `Игрок «${duplicate}» указан в турнире более одного раза.` };

  // Очки: либо у всех (турнир сыгран), либо ни у кого (предстоящий турнир с жеребьёвкой)
  const withPoints = named.filter((r) => r.pointsRaw !== '');
  const hasResults = withPoints.length > 0;
  if (hasResults && withPoints.length < named.length) {
    const missing = named.filter((r) => r.pointsRaw === '').map((r) => r.name);
    return { error: `Очки вписаны не у всех игроков. Нет очков у: ${quoteList(missing)}. Впишите очки или удалите эти строки.` };
  }
  if (!hasResults && !groupsState) {
    return {
      error: 'Впишите очки игроков. Если турнир ещё не прошёл — проведите жеребьёвку по группам, тогда его можно сохранить без очков.',
    };
  }
  for (const r of withPoints) {
    const points = Number(r.pointsRaw);
    if (!Number.isFinite(points) || points < 0) {
      return { error: `Некорректные очки у игрока «${r.name}». Очки должны быть числом от 0 и больше.` };
    }
  }

  if (groupsState) {
    const unassigned = unassignedRows(named).map((r) => r.name);
    if (unassigned.length > 0) {
      return { error: `Игроки без группы: ${quoteList(unassigned)}. Нажмите на игрока в блоке «Без группы», затем «＋ сюда» у нужной группы.` };
    }
  }

  return {
    name,
    date,
    type,
    hasResults,
    rows: named.map((r) => ({ uid: r.uid, name: r.name, points: hasResults ? Number(r.pointsRaw) : null })),
    groups: groupsState ? groupsState.groups.filter((g) => g.uids.length > 0).map((g) => ({ id: g.id, uids: [...g.uids] })) : null,
    seeds: groupsState ? [...groupsState.seeds] : null,
  };
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

  saving = true;
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner"></span>&nbsp; Сохраняем…';

  try {
    // Всегда берём самую свежую версию файла прямо перед записью
    const { data, sha } = await githubGetFile(token);

    // Каждой строке формы — id игрока (существующего или нового)
    const newNames = [];
    const playerIdByUid = new Map();
    for (const row of result.rows) {
      const { id, isNew, player } = resolvePlayerId(data.players, row.name);
      if (isNew) newNames.push(player.name);
      playerIdByUid.set(row.uid, id);
    }

    const tournamentResults = result.hasResults
      ? result.rows.map((row) => ({ playerId: playerIdByUid.get(row.uid), points: row.points }))
      : [];
    const tournamentGroups = result.groups
      ? result.groups.map((g) => ({ id: g.id, playerIds: g.uids.map((uid) => playerIdByUid.get(uid)) }))
      : null;
    const tournamentSeeds = result.seeds ? result.seeds.map((uid) => playerIdByUid.get(uid)) : null;

    const applyTo = (tournament) => {
      tournament.name = result.name;
      tournament.date = result.date;
      tournament.type = result.type;
      tournament.results = tournamentResults;
      if (tournamentGroups) {
        tournament.groups = tournamentGroups;
        tournament.seeds = tournamentSeeds;
      } else {
        delete tournament.groups;
        delete tournament.seeds;
      }
    };

    const removedNames = [];
    const wasEditing = Boolean(editingId);

    if (editingId) {
      const tournament = data.tournaments.find((t) => t.id === editingId);
      if (!tournament) {
        throw new Error('Этот турнир не найден в репозитории — возможно, его уже удалили. Обновите страницу.');
      }
      const previousIds = [...participantIds(tournament)];
      applyTo(tournament);

      // Игроки, которых убрали из этого турнира и которые больше нигде не участвуют, —
      // это ошибочно созданные дубли. Убираем их из списка игроков.
      const stillPlaying = new Set(data.tournaments.flatMap((t) => [...participantIds(t)]));
      const orphanIds = new Set(previousIds.filter((id) => !stillPlaying.has(id)));
      if (orphanIds.size > 0) {
        data.players = data.players.filter((p) => {
          if (!orphanIds.has(p.id)) return true;
          removedNames.push(p.name);
          return false;
        });
      }
    } else {
      const tournament = { id: generateId('t') };
      applyTo(tournament);
      data.tournaments.push(tournament);
    }

    const what = result.hasResults ? (wasEditing ? 'Исправлен турнир' : 'Турнир') : 'Жеребьёвка';
    await githubPutFile(token, data, sha, `${what}: ${result.name} (${result.date})`);

    editingId = null;
    applyRepoData(data); // подсказки имён и список турниров — сразу, не дожидаясь пересборки сайта

    const notes = [];
    if (!result.hasResults) {
      notes.push('Турнир опубликован как предстоящий, на его странице видны группы. Когда он пройдёт, выберите его в списке «Что делаем» и впишите очки.');
    }
    if (newNames.length > 0) {
      notes.push(`Добавлены новые игроки: ${escapeHtml(quoteList(newNames, 10))}. Если кто-то из них уже был в базе под другим написанием — откройте этот турнир на исправление и выберите нужное имя из подсказки.`);
    }
    if (removedNames.length > 0) {
      notes.push(`Удалены из списка игроков (больше не участвуют ни в одном турнире): ${escapeHtml(quoteList(removedNames, 10))}.`);
    }

    const headline = result.hasResults
      ? `Турнир «${escapeHtml(result.name)}» ${wasEditing ? 'исправлен' : 'сохранён'}.`
      : `Жеребьёвка турнира «${escapeHtml(result.name)}» сохранена.`;

    setBanner(
      'success',
      `${headline} Изменения появятся на сайте в течение минуты.
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
    saving = false;
    submitBtn.disabled = false;
    updateModeLabels(namedRows());
  }
});

function updateModeLabels(named) {
  formTitle.textContent = editingId ? 'Исправление турнира' : 'Новый турнир';
  deleteBtn.hidden = !editingId;
  if (saving) return;
  const noPoints = named.every((r) => r.pointsRaw === '');
  if (groupsState && noPoints && named.length > 0) submitBtn.textContent = 'Сохранить жеребьёвку';
  else submitBtn.textContent = editingId ? 'Сохранить изменения' : 'Сохранить турнир';
}

function resetFormFieldsOnly() {
  editingId = null;
  groupsState = null;
  selectedUid = null;
  clearUndo();
  editSelect.value = '';
  nameInput.value = '';
  dateInput.value = '';
  typeInput.value = 'mini';
  playersRowsEl.innerHTML = '';
  addPlayerRow();
  addPlayerRow();
  onRowsChanged();
}

function resetForm() {
  hideBanner();
  resetFormFieldsOnly();
  nameInput.focus();
}

/** Заполняет форму данными сохранённого турнира. */
function loadTournamentIntoForm(tournament) {
  const nameById = new Map(knownPlayers.map((p) => [p.id, p.name]));
  editingId = tournament.id;
  selectedUid = null;
  clearUndo();
  nameInput.value = tournament.name;
  dateInput.value = tournament.date;
  typeInput.value = tournament.type;
  playersRowsEl.innerHTML = '';

  // Сначала игроки с очками (в порядке мест), затем участники групп, у которых очков ещё нет
  const uidByPlayerId = new Map();
  [...(tournament.results ?? [])]
    .sort((a, b) => b.points - a.points)
    .forEach((r) => uidByPlayerId.set(r.playerId, addPlayerRow(nameById.get(r.playerId) ?? '', r.points)));
  for (const group of tournament.groups ?? []) {
    for (const playerId of group.playerIds ?? []) {
      if (!uidByPlayerId.has(playerId)) uidByPlayerId.set(playerId, addPlayerRow(nameById.get(playerId) ?? '', ''));
    }
  }

  groupsState = tournament.groups
    ? {
        groups: tournament.groups.map((g) => ({
          id: g.id,
          uids: (g.playerIds ?? []).map((id) => uidByPlayerId.get(id)).filter(Boolean),
        })),
        seeds: (tournament.seeds ?? []).map((id) => uidByPlayerId.get(id)).filter(Boolean),
      }
    : null;

  onRowsChanged();
}

// ============================================================
// Удаление турнира
// ============================================================
deleteBtn.addEventListener('click', async () => {
  if (!editingId || saving) return;
  const known = knownTournaments.find((t) => t.id === editingId);
  const label = known ? `«${known.name}» от ${formatDate(known.date)}` : 'этот турнир';
  if (!window.confirm(`Удалить турнир ${label}? Он исчезнет с сайта, а его очки — из рейтинга.`)) return;

  const token = getToken();
  if (!token) {
    showTokenPanel();
    return;
  }

  hideBanner();
  saving = true;
  submitBtn.disabled = true;
  deleteBtn.disabled = true;
  deleteBtn.innerHTML = '<span class="spinner"></span>&nbsp; Удаляем…';

  try {
    const { data, sha } = await githubGetFile(token);
    const tournament = data.tournaments.find((t) => t.id === editingId);
    if (!tournament) {
      throw new Error('Этот турнир не найден в репозитории — возможно, его уже удалили. Обновите страницу.');
    }
    const previousIds = [...participantIds(tournament)];
    data.tournaments = data.tournaments.filter((t) => t.id !== editingId);

    // Игроки, которые участвовали только в этом турнире, остаются без единого турнира — убираем их
    const stillPlaying = new Set(data.tournaments.flatMap((t) => [...participantIds(t)]));
    const orphanIds = new Set(previousIds.filter((id) => !stillPlaying.has(id)));
    const removedNames = [];
    data.players = data.players.filter((p) => {
      if (!orphanIds.has(p.id)) return true;
      removedNames.push(p.name);
      return false;
    });

    await githubPutFile(token, data, sha, `Удалён турнир: ${tournament.name} (${tournament.date})`);

    editingId = null;
    applyRepoData(data);
    const note =
      removedNames.length > 0
        ? `<div style="margin-top:8px;">Вместе с ним из списка игроков убраны те, кто участвовал только в этом турнире: ${escapeHtml(quoteList(removedNames, 10))}.</div>`
        : '';
    setBanner(
      'success',
      `Турнир «${escapeHtml(tournament.name)}» удалён. Изменения появятся на сайте в течение минуты.${note}
       <div style="margin-top:8px;">Если удалили по ошибке — прежнюю версию файла <code>data/db.json</code> можно вернуть из истории изменений на GitHub.</div>`
    );
    resetFormFieldsOnly();
  } catch (err) {
    setBanner('error', escapeHtml(err.message || 'Не удалось удалить турнир.'));
  } finally {
    saving = false;
    submitBtn.disabled = false;
    deleteBtn.disabled = false;
    deleteBtn.textContent = 'Удалить турнир';
    updateModeLabels(namedRows());
  }
});

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
