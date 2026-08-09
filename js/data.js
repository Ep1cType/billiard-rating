// ============================================================
// Загрузка данных для публичных (read-only) страниц.
// Файл data/db.json отдаётся напрямую GitHub Pages как статика —
// это быстро и не имеет ограничений по частоте запросов.
// ============================================================

import { DATA_PATH } from './config.js';

export async function loadData() {
  const res = await fetch(`${DATA_PATH}?v=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('Не удалось загрузить данные турниров (data/db.json).');
  }
  const json = await res.json();
  return {
    players: Array.isArray(json.players) ? json.players : [],
    tournaments: Array.isArray(json.tournaments) ? json.tournaments : [],
  };
}

export function playersMap(players) {
  return new Map(players.map((p) => [p.id, p]));
}
