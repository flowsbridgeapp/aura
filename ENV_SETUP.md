# Инструкция по настройке переменных окружения

## Для GitHub Pages (Production)

Ключи Supabase хранятся в **GitHub Secrets** и НЕ попадают в репозиторий.

### Настройка:

1. Перейдите в репозиторий на GitHub: `https://github.com/flowsbridgeapp/aura/settings/secrets/actions`

2. Добавьте два секрета:
   - **VITE_SUPABASE_URL** → `https://nkgcsipcxwxhkyyvddet.supabase.co`
   - **VITE_SUPABASE_KEY** → `sb_publishable_bKnk2aDCxZnw5Bqvhgf7ow_Wyg_m1NL`

3. После добавления секретов, следующий push в ветку `main` автоматически:
   - Создаст файл `.env` во время сборки
   - Встроит ключи в JavaScript-бандл
   - Задеплоит обновлённую версию на GitHub Pages

## Для локальной разработки

Создайте файл `.env` в корне проекта со следующим содержимым:

```env
VITE_SUPABASE_URL=https://nkgcsipcxwxhkyyvddet.supabase.co
VITE_SUPABASE_KEY=sb_publishable_bKnk2aDCxZnw5Bqvhgf7ow_Wyg_m1NL
```

Затем запустите:
```bash
npm install
npm run dev
```

## Для локального тестирования без интернета

1. Убедитесь, что файл `.env` существует (см. выше)
2. Соберите проект: `npm run build`
3. Откройте `dist/index.html` в браузере ИЛИ используйте `npm run preview`

> ⚠️ **Важно:** Файл `.env` исключён из Git через `.gitignore` и никогда не будет отправлен в репозиторий.

## Безопасность

- Используется **publishable key** (`sb_publishable_...`), который предназначен для клиентского использования
- Ключи хранятся только локально и в GitHub Secrets
- При сборке ключи встраиваются в бандл, но не попадают в исходный код репозитория
