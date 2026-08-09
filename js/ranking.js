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
