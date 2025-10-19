const WL = /<(\/?(?:b|i|u|a|code|pre|br)(?:\s+[^>]*)?\/?)/gi;

export function sanitizeTelegramHtml(input) {
  if (input == null) return '';
  let s = String(input);

  // \n -> <br>
  s = s.replace(/\r?\n/g, '<br>');

  // Экраним всё
  s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Разрешаем подмножество тегов
  s = s.replace(/&lt;(\/?(?:b|strong|i|em|u|s|a|code|pre|br)\b[^&]*)&gt;/gi, '<$1>');

  // 🔧 НОРМАЛИЗУЕМ <br/> и <br /> в <br> (Telegram не любит самозакрывающийся br)
  s = s.replace(/<br\s*\/>/gi, '<br>');

  return s;
}
