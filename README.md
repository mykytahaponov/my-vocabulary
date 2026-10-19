# Мої слова · v3.3.0

Ручна структура картки:
- Категорія: Word / Phrasal Verb / Collocation / Expression. Для нових карток обов’язкова, за замовчуванням Word.
- Частина мови: необов’язково, тільки для Word. Іменник / Дієслово / Прикметник / Прислівник / Інше.
- Pattern: необов’язкова граматична конструкція для будь-якої категорії, до 1000 символів. Кілька конструкцій записуй з нового рядка.
- Приклад англійською, його переклад і примітка залишилися.

Старі картки не перекласифіковуються автоматично. Якщо стара картка без категорії, її можна переглядати й тренувати як раніше; під час наступного редагування потрібно вибрати категорію. Коли міняєш Word на іншу категорію, прихована частина мови очищається при збереженні. Частину мови визначай для конкретного значення картки.

У Словнику категорія й частина мови видно біля слова. Pattern розгортається через «Конструкція та приклад» й показується у квізі лише після перевірки відповіді. Нові поля синхронізуються між пристроями та включені в JSON-копії й обробку конфліктів. Старі JSON-копії читаються.

## Оновлення

1. У поточному словнику синхронізуй дані й збережи JSON-копію.
2. Supabase → SQL Editor → + → Create a new snippet. Встав увесь SQL нижче та натисни Run. Очікується Success. Цей скрипт підходить після v3.1.0 або v3.2.0; поля прикладів речень уже мають бути створені раніше. Зміни виконуються разом у транзакції; старі слова й приклади не видаляються. Політики доступу залишаються попередніми.
3. Розпакуй ZIP сайту. У Finder ВІДКРИЙ папку, де видно index.html, app.js, sw.js та icons. Натисни ⌘ + A усередині цієї папки.
4. На ГОЛОВНІЙ сторінці існуючого репозиторію my-vocabulary натисни Add file → Upload files і перетягни вибраний ВМІСТ. У GitHub має бути index.html, а не website/index.html або інша папка-обгортка. Натисни Commit changes й дочекайся успішного GitHub Pages.
5. На Mac та iPhone відкрий словник з інтернетом і підтвердь «Оновити застосунок». Перевір v3.3.0 в Налаштуваннях НА ОБОХ пристроях перед редагуванням нових полів. Не очищай Safari й не видаляй іконку PWA.
6. Мак-помічник у цьому оновленні не змінюється; файли цього ZIP призначені тільки для сайту.

## SQL

```sql
begin;

-- Keep existing cards unchanged, including older unmarked cards.
alter table public.vocabulary_words
  add column if not exists category text not null default '',
  add column if not exists part_of_speech text not null default '',
  add column if not exists pattern text not null default '';

-- Default applies to future inserts, not to existing cards.
alter table public.vocabulary_words alter column category set default 'word';

alter table public.vocabulary_words
  drop constraint if exists vocabulary_category_values,
  drop constraint if exists vocabulary_part_of_speech_values,
  drop constraint if exists vocabulary_pattern_length;

alter table public.vocabulary_words
  add constraint vocabulary_category_values
    check (category in ('','word','phrasal_verb','collocation','expression')),
  add constraint vocabulary_part_of_speech_values
    check (part_of_speech in ('','noun','verb','adjective','adverb','other')
      and (part_of_speech = '' or category = 'word')),
  add constraint vocabulary_pattern_length check (char_length(pattern) <= 1000);

grant insert (category,part_of_speech,pattern),
      update (category,part_of_speech,pattern)
  on public.vocabulary_words to authenticated;

notify pgrst, 'reload schema';
commit;
```

## Перша перевірка

- Додай reliable → надійний. Залиш Word, вибери Прикметник. Збережи, відкрий редагування ще раз і перевір збережений вибір.
- Додай give in → поступатися. Обери Phrasal Verb. Частина мови має сховатися. У Pattern запиши give in to someone/something.
- Для make a decision вибери Collocation. Переконайся, що Pattern необов’язковий: можна залишити його порожнім.
- Синхронізуй дані, відкрий потрібну картку на іншому пристрої та перевір нові поля.
- У квізі Pattern видно після перевірки відповіді.

## Перевірено

П’ять груп автоматичних тестів: старі/нові JSON та імпорт дублікатів; синхронізація частини мови й Pattern, очищення та конфлікти; REST з owner/revision; фактичні обробники форми на моделі DOM, обов’язкова категорія, видимість POS та перезапуск; показ Pattern після відповіді й захист від застарілого редагування. Додатково перевірено синтаксис JavaScript та HTML-структуру нових полів.

Тести використовують штучні мережеві відповіді та модель DOM. Живий Supabase не змінювався, оновлення на GitHub ще не опубліковане; реальну міграцію й вигляд на iPhone потрібно перевірити після встановлення.

Тести збережені окремо від ZIP сайту: tests/structure.test.mjs (Node.js 22+).
