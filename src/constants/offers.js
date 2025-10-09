// src/constants/offers.js

// Набор поддерживаемых действий (код → описание)
export const EVENT_TYPES = {
  start:   'Запуск бота/мини-аппа',
  join:    'Вступление в группу/канал',
  react:   'Реакция/лайк на сообщение',
  fwd:     'Пересыл сообщения',
  comment: 'Комментарий под постом',
  paid:    'Покупка платного контента',
  stars:   'Покупка звёзд/премиума',
};

// Минимальные ставки (из ТЗ)
export const MIN_RATES = {
  start:   { regular: 3,  premium: 10 },
  join:    { regular: 5,  premium: 10 },
  react:   { regular: 1,  premium: 5  },
  fwd:     { regular: 2,  premium: 7  },
  comment: { regular: 3,  premium: 10 },
  paid:    { regular: 30, premium: 30 },
  stars:   { regular: 30, premium: 30 },
};

// Тайм-таргетинг пресеты (кладём в caps_window)
export const TIME_PRESETS = {
  '247':      { mode: '247' },                                  // 24/7
  'weekdays': { mode: 'weekdays', days: ['Mon','Tue','Wed','Thu','Fri'] },
  'weekends': { mode: 'weekends', days: ['Sat','Sun'] },
};
