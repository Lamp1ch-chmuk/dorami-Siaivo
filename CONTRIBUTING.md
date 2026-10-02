# Розробка

Потрібен Node.js 22 або новіший. Для JS-плагіна в Siaivo Node.js не потрібен.

```sh
npm ci --ignore-scripts
npm test
```

Авторський код `siaivo-dorama.js` має залишатися ES5. Сучасний JavaScript дозволений
у Node-тестах. Тести перевіряють ES5 справжнім парсером Acorn.

Для браузерної перевірки див. [опис аудиту](docs/AUDIT.md). На GitHub її можна
запустити вручну: Actions → Siaivo browser smoke → Run workflow.

Під час змін зберігай окремий розділ «Дорами» в лівому меню, штатні category /
category_full / full і TMDB source карток. Не додавай рядки на головну й не патч
глобальні API або фільтри Siaivo без окремо обговореної потреби.

До pull request додавай опис поведінки, результати перевірок і запис у CHANGELOG,
якщо змінено плагін. Після оновлення JS перезапускай Siaivo повністю.
