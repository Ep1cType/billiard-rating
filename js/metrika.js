// ============================================================
// Яндекс Метрика
// ============================================================
// Впишите сюда номер счётчика (только цифры) — он показан в Метрике
// рядом с названием счётчика и в его настройках.
// Пока здесь 0, Метрика не подключается.
// ============================================================
var METRIKA_COUNTER_ID = 114240158;

(function () {
  if (!METRIKA_COUNTER_ID) return;

  // Стандартный загрузчик Метрики: создаёт очередь ym и асинхронно подгружает tag.js
  (function (m, e, t, r, i, k, a) {
    m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); };
    m[i].l = 1 * new Date();
    for (var j = 0; j < e.scripts.length; j++) { if (e.scripts[j].src === r) { return; } }
    k = e.createElement(t); a = e.getElementsByTagName(t)[0];
    k.async = 1; k.src = r; a.parentNode.insertBefore(k, a);
  })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js', 'ym');

  window.ym(METRIKA_COUNTER_ID, 'init', {
    clickmap: true,            // карта кликов
    trackLinks: true,          // переходы по внешним ссылкам
    accurateTrackBounce: true, // точный показатель отказов
    webvisor: false            // запись визитов; включите (true), если она нужна
  });
})();
