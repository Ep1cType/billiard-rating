import { withPlaces, computeTournamentStandings, computeLeaderboard, TOP_N } from '../js/ranking.js';

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`FAIL: ${label}\n  actual:   ${a}\n  expected: ${e}`);
    process.exitCode = 1;
  } else {
    console.log(`OK: ${label}`);
  }
}

// Test 1: places with ties (1,2,2,4 style)
const t1 = withPlaces([
  { name: 'A', points: 120 },
  { name: 'B', points: 95 },
  { name: 'C', points: 95 },
  { name: 'D', points: 80 },
], 'points').map(x => x.place);
assertEqual(t1, [1,2,2,4], 'withPlaces basic ties');

// Test 2: all tied
const t2 = withPlaces([
  { name: 'A', points: 50 },
  { name: 'B', points: 50 },
  { name: 'C', points: 50 },
], 'points').map(x => x.place);
assertEqual(t2, [1,1,1], 'withPlaces all tied');

// Test 3: no ties
const t3 = withPlaces([
  { name: 'A', points: 10 },
  { name: 'B', points: 30 },
  { name: 'C', points: 20 },
], 'points').map(x => x.place);
assertEqual(t3, [1,2,3], 'withPlaces no ties (also checks sorting)');

// Test 4: single player
const t4 = withPlaces([{ name: 'A', points: 10 }], 'points').map(x => x.place);
assertEqual(t4, [1], 'withPlaces single item');

// Test 5: computeTournamentStandings
const playersById = new Map([
  ['p1', { id: 'p1', name: 'Иван Петров' }],
  ['p2', { id: 'p2', name: 'Мария Иванова' }],
]);
const tournament = { id: 't1', results: [
  { playerId: 'p1', points: 40 },
  { playerId: 'p2', points: 60 },
]};
const standings = computeTournamentStandings(tournament, playersById);
assertEqual(standings.map(s => [s.name, s.place]), [['Мария Иванова', 1], ['Иван Петров', 2]], 'computeTournamentStandings order + cyrillic names');

// Test 6: computeLeaderboard - top 12 by points, not by recency, players with >12 tournaments
const players = [{ id: 'p1', name: 'Игрок1' }, { id: 'p2', name: 'Игрок2' }];
// p1 plays 15 tournaments, points ascending 1..15 (so top 12 by points = last 12 values = 4..15)
const tournaments = [];
for (let i = 1; i <= 15; i++) {
  tournaments.push({ id: `t${i}`, results: [{ playerId: 'p1', points: i }] });
}
// p2 plays 3 tournaments only
tournaments.push({ id: 'ta', results: [{ playerId: 'p2', points: 100 }] });
tournaments.push({ id: 'tb', results: [{ playerId: 'p2', points: 90 }] });
tournaments.push({ id: 'tc', results: [{ playerId: 'p2', points: 80 }] });

const lb = computeLeaderboard(players, tournaments);
const p1row = lb.find(r => r.playerId === 'p1');
const p2row = lb.find(r => r.playerId === 'p2');
// top 12 of [1..15] by value = [15,14,...,4], sum = sum(4..15) = (4+15)*12/2 = 114
assertEqual(p1row.total, 114, 'computeLeaderboard: takes top-12 BY POINTS not by recency');
assertEqual(p1row.played, 15, 'computeLeaderboard: played count = 15');
assertEqual(p1row.counted, 12, 'computeLeaderboard: counted count = 12');
assertEqual(p2row.total, 270, 'computeLeaderboard: player with <12 tournaments sums all');
assertEqual(p2row.played, 3, 'computeLeaderboard: played count = 3 for p2');
// p2 total 270 > p1 total 114, so p2 should be place 1
assertEqual(lb.map(r => r.playerId), ['p2', 'p1'], 'computeLeaderboard: sorted desc by total');

// Test 7: player with zero tournaments excluded
const playersWithGhost = [...players, { id: 'p3', name: 'Призрак' }];
const lb2 = computeLeaderboard(playersWithGhost, tournaments);
assertEqual(lb2.some(r => r.playerId === 'p3'), false, 'computeLeaderboard: excludes players with 0 tournaments');

console.log('\nDone.');
