import { calculateGroups, distributeByRating, snakeGroupIndex, groupSizes } from '../js/groups.js';

function ok(cond, label) {
  console.log(`${cond ? 'OK' : 'FAIL'}: ${label}`);
  if (!cond) process.exitCode = 1;
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Детерминированный генератор случайных чисел для воспроизводимых тестов
function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// --- calculateGroups ---
ok(calculateGroups(7).status === 'invalid' && calculateGroups(33).status === 'invalid' && calculateGroups(8.5).status === 'invalid', 'меньше 8, больше 32 и дробные — invalid');
ok(eq(calculateGroups(8).groups, [4, 4]), '8 игроков → 2 группы по 4');
ok(eq(calculateGroups(9).groups, [3, 3, 3]), '9 игроков → 3 группы по 3');
ok(eq(calculateGroups(12).groups, [3, 3, 3, 3]), '12 игроков → 4 группы по 3');
ok(eq(calculateGroups(16).groups, [4, 4, 4, 4]), '16 игроков → 4 группы по 4');
ok(eq(calculateGroups(20).groups, [4, 4, 3, 3, 3, 3]), '20 игроков → 6 групп');
ok(eq(calculateGroups(32).groups, [4, 4, 4, 4, 4, 4, 4, 4]) && calculateGroups(32).advancingPlayers === 16, '32 игрока → 8 групп, выходят 16');
const c24 = calculateGroups(24);
ok(c24.status === 'choice-required' && eq(c24.availableGroupCounts, [6, 8]), '24 игрока → выбор 6 или 8 групп');
ok(eq(calculateGroups(24, 6).groups, [4, 4, 4, 4, 4, 4]) && eq(calculateGroups(24, 8).groups, [3, 3, 3, 3, 3, 3, 3, 3]), '24 игрока с выбором → 6×4 или 8×3');
ok(calculateGroups(24, 5).status === 'choice-required', 'недопустимый выбор не принимается');

let sizesOk = true;
for (let n = 8; n <= 32; n += 1) {
  const r = calculateGroups(n, 6);
  if (r.status !== 'success') { sizesOk = false; continue; }
  const sum = r.groups.reduce((a, b) => a + b, 0);
  if (sum !== n || r.groups.some((g) => g < 3 || g > 4)) sizesOk = false;
}
ok(sizesOk, 'для 8–32 игроков: сумма мест равна числу игроков, в группах по 3–4');

// --- змейка ---
ok(eq([0, 1, 2, 3, 4, 5, 6, 7].map((i) => snakeGroupIndex(i, 4)), [0, 1, 2, 3, 3, 2, 1, 0]), 'змейка на 4 группы: A B C D D C B A');
ok(eq([0, 1, 2, 3, 4, 5, 6, 7].map((i) => snakeGroupIndex(i, 2)), [0, 1, 1, 0, 0, 1, 1, 0]), 'змейка на 2 группы продолжается: A B B A A B B A');
ok(eq([0, 1, 2, 3, 4, 5, 6, 7].map((i) => snakeGroupIndex(i, 3)), [0, 1, 2, 2, 1, 0, 0, 1]), 'змейка на 3 группы: A B C C B A A B');
ok(eq([0, 1, 2, 3, 4, 5, 6, 7].map((i) => snakeGroupIndex(i, 8)), [0, 1, 2, 3, 4, 5, 6, 7]), '8 групп: каждый сеяный в своей группе');

// --- distributeByRating: инварианты для всех размеров ---
function makePlayers(n) {
  // p1 сильнейший … дальше по убыванию; до трёх последних (но не из первой восьмёрки) — без рейтинга
  const unrated = (i) => i >= Math.max(8, n - 3);
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Игрок ${i + 1}`,
    ratingPoints: unrated(i) ? 0 : 5000 - i * 100,
    tournamentsPlayed: unrated(i) ? 0 : 12,
  }));
}

let invariantsOk = true;
let failNote = '';
for (let n = 8; n <= 32; n += 1) {
  for (const choice of [6, 8]) {
    const calc = calculateGroups(n, choice);
    for (let seed = 1; seed <= 20; seed += 1) {
      const players = makePlayers(n);
      const { groups, seeded } = distributeByRating(players, calc.groups, rng(seed * 7919 + n));
      const all = groups.flatMap((g) => g.players);
      const ids = all.map((p) => p && p.id);
      const sizesMatch = eq(groups.map((g) => g.players.length), calc.groups);
      const everyoneOnce = new Set(ids).size === n && ids.every(Boolean);
      const seedsRight = eq(seeded.map((p) => p.id), ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']);
      const snakeRight = seeded.every((p, i) => groups[snakeGroupIndex(i, groups.length)].players.includes(p));
      if (!(sizesMatch && everyoneOnce && seedsRight && snakeRight)) {
        invariantsOk = false;
        failNote = `n=${n}, групп=${groups.length}, seed=${seed}`;
      }
    }
  }
}
ok(invariantsOk, `все размеры 8–32: никто не потерян и не продублирован, вместимость соблюдена, топ-8 по змейке ${failNote}`);

// 8 групп: топ-8 все в разных группах
const g32 = distributeByRating(makePlayers(32), calculateGroups(32).groups, rng(5)).groups;
ok(g32.every((g, i) => g.players[0].id === `p${i + 1}`), '32 игрока: в каждой группе ровно один сеяный, 1-й в A … 8-й в H');

// 4 группы: пары 1+8, 2+7, 3+6, 4+5
const g16 = distributeByRating(makePlayers(16), calculateGroups(16).groups, rng(9)).groups;
ok(eq(g16.map((g) => g.players.slice(0, 2).map((p) => p.id)), [['p1', 'p8'], ['p2', 'p7'], ['p3', 'p6'], ['p4', 'p5']]), '16 игроков: сеяные парами 1+8, 2+7, 3+6, 4+5');

// Остальные действительно перемешиваются
const a = distributeByRating(makePlayers(24), groupSizes(24, 6), rng(1)).groups.map((g) => g.players.map((p) => p.id).join());
const b = distributeByRating(makePlayers(24), groupSizes(24, 6), rng(2)).groups.map((g) => g.players.map((p) => p.id).join());
ok(!eq(a, b), 'несеяные распределяются случайно (разные результаты при разных прогонах)');

// Равные очки → выше тот, у кого больше средние очки за турнир
const tie = makePlayers(16);
tie[8] = { id: 'x', name: 'X', ratingPoints: 4300, tournamentsPlayed: 5 }; // столько же, сколько у p8 (12 турниров)
ok(distributeByRating(tie, [4, 4, 4, 4], rng(3)).seeded[7].id === 'x', 'при равных очках сеется игрок с большим средним');

console.log('\nDone.');
