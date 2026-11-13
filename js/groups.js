// ============================================================
// Группы: расчёт количества групп и жеребьёвка.
// Чистая логика без DOM — используется админкой и тестами.
// ============================================================

export const MIN_GROUP_PLAYERS = 8;
export const MAX_GROUP_PLAYERS = 32;
export const SEEDED_COUNT = 8; // сколько сильнейших по рейтингу рассеиваем змейкой

/** Буква группы по индексу: 0 → A, 1 → B … */
export function groupLetter(index) {
  return String.fromCharCode(65 + index);
}

/** Размеры групп для заданного числа игроков и групп: лишние игроки достаются первым группам. */
export function groupSizes(playersCount, groupCount) {
  const base = Math.floor(playersCount / groupCount);
  const remainder = playersCount % groupCount;
  return Array.from({ length: groupCount }, (_, i) => base + (i < remainder ? 1 : 0));
}

/**
 * Определяет, на сколько групп делить участников (группы по 3–4 человека,
 * предпочтительно 2, 4, 6 или 8 групп).
 *
 * @param {number} playersCount
 * @param {number} [chosenGroupCount] - выбор организатора, когда подходит несколько вариантов
 * @returns {{status:'invalid'}|{status:'choice-required', availableGroupCounts:number[]}|
 *           {status:'success', groupCount:number, groups:number[], advancingPlayers:number, availableGroupCounts:number[]}}
 */
export function calculateGroups(playersCount, chosenGroupCount) {
  if (!Number.isInteger(playersCount) || playersCount < MIN_GROUP_PLAYERS || playersCount > MAX_GROUP_PLAYERS) {
    return { status: 'invalid' };
  }

  const minGroups = Math.ceil(playersCount / 4);
  const maxGroups = Math.floor(playersCount / 3);
  const preferred = [2, 4, 6, 8].filter((count) => count >= minGroups && count <= maxGroups);

  let groupCount;
  if (preferred.length > 1) {
    if (!preferred.includes(chosenGroupCount)) {
      return { status: 'choice-required', availableGroupCounts: preferred };
    }
    groupCount = chosenGroupCount;
  } else {
    groupCount = preferred[0] ?? maxGroups;
  }

  return {
    status: 'success',
    groupCount,
    groups: groupSizes(playersCount, groupCount),
    advancingPlayers: groupCount * 2,
    availableGroupCounts: preferred.length > 1 ? preferred : [groupCount],
  };
}

/**
 * Номер группы для сеяного игрока при распределении змейкой:
 * A, B, C, D, D, C, B, A, A, B … — работает для любого числа групп.
 */
export function snakeGroupIndex(seedIndex, groupCount) {
  const round = Math.floor(seedIndex / groupCount);
  const pos = seedIndex % groupCount;
  return round % 2 === 0 ? pos : groupCount - 1 - pos;
}

/**
 * Гибридная жеребьёвка: восемь сильнейших по рейтингу рассеиваются змейкой,
 * остальные перемешиваются случайно и занимают свободные места.
 *
 * @param {Array<{id:string, name:string, ratingPoints:number, tournamentsPlayed:number}>} players
 * @param {number[]} sizes - вместимость каждой группы
 * @param {() => number} [random]
 * @returns {{groups: Array<{id:string, players:Array}>, seeded: Array}} seeded — сеяные в порядке посева
 */
export function distributeByRating(players, sizes, random = Math.random) {
  const groups = sizes.map((_, index) => ({ id: groupLetter(index), players: [] }));

  // Средние очки за турнир (в рейтинг идут не больше 12 турниров) — для равных по сумме.
  const averageRating = (player) => {
    const tournaments = Math.min(player.tournamentsPlayed, 12);
    return tournaments > 0 ? player.ratingPoints / tournaments : 0;
  };

  // Случайный порядок для игроков с одинаковыми показателями.
  const randomKeys = new Map(players.map((player) => [player.id, random()]));

  const sorted = [...players].sort((a, b) => {
    const pointsDiff = b.ratingPoints - a.ratingPoints;
    if (pointsDiff !== 0) return pointsDiff;
    const averageDiff = averageRating(b) - averageRating(a);
    if (averageDiff !== 0) return averageDiff;
    return randomKeys.get(a.id) - randomKeys.get(b.id);
  });

  const seeded = sorted.slice(0, SEEDED_COUNT);
  const remaining = sorted.slice(SEEDED_COUNT);

  // Сеяные — змейкой. Если группа уже заполнена, берём следующую со свободным местом.
  seeded.forEach((player, seedIndex) => {
    let index = snakeGroupIndex(seedIndex, groups.length);
    for (let step = 0; step < groups.length && groups[index].players.length >= sizes[index]; step += 1) {
      index = (index + 1) % groups.length;
    }
    groups[index].players.push(player);
  });

  // Остальные — случайно (тасование Фишера — Йетса).
  for (let i = remaining.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
  }

  let next = 0;
  groups.forEach((group, index) => {
    while (group.players.length < sizes[index] && next < remaining.length) {
      group.players.push(remaining[next]);
      next += 1;
    }
  });

  return { groups, seeded };
}
