# Аудит v0.4.0 → v0.4.1

Це історичний звіт. Поточна постійна адреса — `https://da.gd/siaivod`;
актуальна схема встановлення й оновлення: [доставка](DELIVERY.md).

Дата: 2026-10-02. Основа — передані `siaivo-dorama.js`, `test.js`, README та
CHANGELOG версії 0.4.0. Історичні повідомлення з розмови використано як контекст,
а перевірки нижче виконано заново.

## Першоджерела

- [Siaivo, commit 94e370e](https://github.com/Siaivo/siaivo.github.io/tree/94e370e7102e6361e47c131448c2e1d2a6714fb7):
  `assembly.json` і `app.min.js`, Siaivo 3.3.4.29 / app_digital 33429.
- [Lampa, commit 6beff32](https://github.com/yumata/lampa/tree/6beff320eee05c633c927269ea1cfc203aa7adc7):
  статичне звірення відповідних API в `app.min.js`.
- [TMDB Discover TV](https://developer.themoviedb.org/reference/discover-tv) —
  довідкове посилання. Онлайн-документація була недоступна через мережеву політику
  цього середовища; актуальний сервер TMDB і всі його параметри наживо не перевірено.

## Виправлені дефекти

| Дефект у 0.4.0 | Наслідок | Виправлення в 0.4.1 |
| --- | --- | --- |
| normalize залишав null/примітиви та приймав масиви/об'єкти без TMDB ID | Некоректні дані потрапляли в нативні Card/Router; некоректний рядок міг вважатися непорожнім | Відсіювання пошкоджених карток; позитивний цілий ID; копія й нормалізація ID |
| parseInt дуже довгого числа повертає Infinity, яке проходило перевірку `> 0` | Некоректний page у TMDB-запиті та необмежені pagination totals | Перевірки isFinite; fallback для пошкоджених значень; валідний total_pages=0 зберігається |
| Будь-який truthy `__siaivo_dorama_plugin` дозволяв перезаписати чужий source | Маркер не доводив власність; чужу реалізацію можна було замінити | Повторна реєстрація дозволена лише для того самого об'єкта SOURCE |
| Конфлікт menu action логувався лише за наявності data-plugin | Конфлікт із немаркованим пунктом меню залишався без діагностики | Попередження також для пунктів без маркера; чужий пункт не змінюється |

Нові regression checks відтворюють ці сценарії. Основна архітектура й усі
14 підбірок збережені; глобальні фільтри Siaivo не змінювались.

## Підтверджена архітектура

- Menu.addButton повертає JQuery-елемент; `data-action` та `data-plugin`
  установлюються без прямого втручання у menu_sort/menu_hide.
- Router зберігає custom source/URL при переході category → category_full.
- Реальний partNext запускає задачі через Progress, зберігає індексний порядок,
  прибирає порожні відповіді й добирає наступний пакет, якщо рядків менше трьох.
- TMDB.get підтримує переданий кеш; Api.list делегує штатному TMDB.list.
  Siaivo застосовує Discover-фільтрацію та зливає дві сирі сторінки в одну view-page.
- Нативний full Router визначає TV за original_name. Звичайні TMDB TV-картки
  зберігають це поле й отримують source=tmdb; деталей через custom source немає.
- Global Api.clear сам очищає всі sources і мережу. Порожній custom clear
  не дублює очищення TMDB.

## Виконані перевірки

- Початкові `node --check` та `node test.js` пройшли ще для переданої v0.4.0.
- Для v0.4.1: frozen install через `npm ci --ignore-scripts`, `npm test`:
  базовий regression усіх 14 рядків + **16 Node-тестів**, без пропущених/невдалих.
- Node.js 24.19.0: UTC, Europe/Berlin, America/Los_Angeles, Asia/Seoul.
  Node.js 22 включено в CI, але локально в цьому середовищі не запускалось.
- Acorn розібрав файл плагіна з `ecmaVersion: 5`.
- `npm audit --audit-level=high`: **0 vulnerabilities** у devDependencies.
- Chromium + справжня, незмінена Siaivo 3.3.4.29: один пункт меню, перші 4 рядки,
  їхній порядок, нативна кнопка «Ще», 40 карток у grid із двох TMDB-сторінок,
  наступна view-page із сирих сторінок 3/4, TV details з описом, Back → grid → category.
  Перевірка відхиляє uncaught errors та нативні помилки Card/Progress.

Браузер використовує детерміновані підставлені TMDB-відповіді. Код Siaivo,
Router, Card, category, category_full та плагін виконуються справжні;
усі інші онлайн-сервіси в цьому тесті вимкнено.

## Повторення браузерної перевірки

Після `npm ci --ignore-scripts` підготуй саме перевірену ревізію:

```sh
git init /tmp/siaivo-upstream
git -C /tmp/siaivo-upstream remote add origin https://github.com/Siaivo/siaivo.github.io.git
git -C /tmp/siaivo-upstream fetch --depth=1 origin 94e370e7102e6361e47c131448c2e1d2a6714fb7
git -C /tmp/siaivo-upstream checkout --detach FETCH_HEAD
npx --no-install playwright install chromium
npm run test:browser
```

Перші дві команди призначені для нового каталогу. Якщо checkout уже існує,
перевір його origin і HEAD; не перезаписуй чужі зміни. Для іншого шляху передай
`SIAIVO_APP_DIR`. За наявності системного Chromium завантаження браузера не потрібне:

```sh
SIAIVO_CHROMIUM_PATH=/usr/bin/chromium npm run test:browser
```

Команда сама піднімає локальний HTTP-сервер, виконує перевірку й закриває сервер
та браузер. Для чистого Linux можуть бути потрібні системні бібліотеки Chromium:
`npx --no-install playwright install --with-deps chromium`.
Ці кроки також збережено у ручному GitHub Actions workflow `Siaivo browser smoke`.

## Межі перевірки

- Реальні відповіді TMDB, доступність CDN та поточний склад добірок не перевірено.
- Chromium smoke не доводить поведінку пульта, фокуса або старих WebView на
  конкретному Tizen/webOS/Android TV. Потрібен ручний прогін на пристрої.
- Культурна категорія «дорама» визначається евристикою TMDB. Soap та частина
  нішевих серіалів можуть бути приховані глобальною політикою Siaivo.
- Першосторінкові рядки й повний grid мають різні штатні cache TTL; це не змінено.
- Однаковий видимий текст меню в різних плагінах усе ще може конфліктувати
  у штатному редакторі Siaivo. Hot reload не замінює повний перезапуск.
- GitHub Actions додано; локальні перевірки не є доказом запуску CI на GitHub.
