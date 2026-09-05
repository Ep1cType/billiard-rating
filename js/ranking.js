// ============================================================
// Логика подсчёта мест и рейтинга.
// Используется и на публичных страницах, и в админке (для предпросмотра).
// ============================================================

export const TOP_N = 12;

export const TOURNAMENT_TYPES = {
  mini: { label: 'Мини-турнир', short: 'Мини' },
  masters: { label: 'Мастерс', short: 'Мастерс' },
  grand_slam: { label: 'Большой шлем', short: 'Шлем' },
};

export function typeLabel(type) {
  return TOURNAMENT_TYPES[type]?.label ?? type;
}

/**
 * Добавляет поле place к списку объектов с очками.
 * Места делятся: у двух игроков с одинаковыми очками — одно и то же место,
 * следующий игрок получает место с учётом пропуска (1, 2, 2, 4).
 *
 * @param {Array<Object>} items - объекты, содержащие числовое поле pointsKey
 * @param {string} pointsKey - имя поля с очками
 * @returns {Array<Object>} те же объекты (копии), отсортированные по местам, с полем place
 */
export function withPlaces(items, pointsKey = 'points') {
  const sorted = [...items].sort((a, b) => {
    const diff = b[pointsKey] - a[pointsKey];
    if (diff !== 0) return diff;
    return (a.name ?? '').localeCompare(b.name ?? '', 'ru');
  });

  let place = 0;
  let prevPoints = null;
  let index = 0;

  return sorted.map((item) => {
    index += 1;
    if (item[pointsKey] !== prevPoints) {
      place = index;
      prevPoints = item[pointsKey];
    }
    return { ...item, place };
  });
}

/**
 * Считает итоговую таблицу одного турнира.
 * @param {Object} tournament
 * @param {Map<string,Object>} playersById
 */
export function computeTournamentStandings(tournament, playersById) {
  const rows = tournament.results.map((r) => ({
    playerId: r.playerId,
    name: playersById.get(r.playerId)?.name ?? 'Неизвестный игрок',
    points: r.points,
  }));
  return withPlaces(rows, 'points');
}

/**
 * Считает общий рейтинг: для каждого игрока суммируются очки
 * по TOP_N турнирам с максимальным количеством очков.
 * Игроки, не сыгравшие ни одного турнира, в рейтинг не попадают.
 *
 * @param {Array<Object>} players - [{id, name}]
 * @param {Array<Object>} tournaments - [{id, results: [{playerId, points}]}]
 */
export function computeLeaderboard(players, tournaments) {
  const pointsByPlayer = new Map();

  for (const t of tournaments) {
    for (const r of t.results) {
      if (!pointsByPlayer.has(r.playerId)) pointsByPlayer.set(r.playerId, []);
      pointsByPlayer.get(r.playerId).push(r.points);
    }
  }

  const rows = players
    .map((p) => {
      const all = (pointsByPlayer.get(p.id) || []).slice().sort((a, b) => b - a);
      const counted = all.slice(0, TOP_N);
      const total = counted.reduce((sum, x) => sum + x, 0);
      return {
        playerId: p.id,
        name: p.name,
        total,
        played: all.length,
        counted: counted.length,
      };
    })
    .filter((row) => row.played > 0);

  return withPlaces(rows, 'total');
}

/**
 * Собирает профиль одного игрока: все турниры, где он участвовал,
 * с очками по каждому, и отмечает, какие из них вошли в зачёт TOP_N
 * (по количеству очков, а не по дате).
 *
 * @param {string} playerId
 * @param {Array<Object>} players
 * @param {Array<Object>} tournaments
 * @returns {Object|null} профиль или null, если игрок не найден
 */
export function computePlayerProfile(playerId, players, tournaments) {
  const player = players.find((p) => p.id === playerId);
  if (!player) return null;

  const participations = [];
  for (const t of tournaments) {
    const result = t.results.find((r) => r.playerId === playerId);
    if (result) {
      participations.push({
        tournamentId: t.id,
        tournamentName: t.name,
        date: t.date,
        type: t.type,
        points: result.points,
      });
    }
  }

  // Стабильный порядок при равенстве очков — по id турнира, чтобы
  // результат был детерминированным.
  const byPointsDesc = [...participations].sort(
    (a, b) => b.points - a.points || a.tournamentId.localeCompare(b.tournamentId)
  );
  const countedIds = new Set(byPointsDesc.slice(0, TOP_N).map((p) => p.tournamentId));
  const totalPoints = byPointsDesc.slice(0, TOP_N).reduce((sum, p) => sum + p.points, 0);

  const history = [...participations]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .map((p) => ({ ...p, isCounted: countedIds.has(p.tournamentId) }));

  return {
    player,
    totalPoints,
    played: participations.length,
    counted: Math.min(participations.length, TOP_N),
    history,
  };
}
