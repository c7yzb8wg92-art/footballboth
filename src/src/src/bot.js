import 'dotenv/config';
import { Bot, InlineKeyboard, GrammyError, HttpError } from 'grammy';
import { COUNTRIES, TOURNAMENTS, findCountry, findLeague, findTournament } from './leagues.js';
import { aiFetchNews, aiAnswerQuestion } from './gemini.js';
import { cacheGet, cacheSet, cacheClear } from './cache.js';

const BOT_TOKEN = process.env.BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const WEBAPP_URL = process.env.WEBAPP_URL || '';
const ADMIN_ID = process.env.ADMIN_ID ? Number(process.env.ADMIN_ID) : null;

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN missing. Set it in .env');
  process.exit(1);
}
if (!GEMINI_API_KEY) {
  console.error('❌ GEMINI_API_KEY missing. Get one free at https://aistudio.google.com/app/apikey');
  process.exit(1);
}

const bot = new Bot(BOT_TOKEN);

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function timeAgo(h) {
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function renderNews(title, items) {
  if (!items.length) return `<b>${escapeHtml(title)}</b>\n\n📭 No fresh news right now. Try again in a few minutes.`;
  const lines = [`<b>${escapeHtml(title)}</b>\n`];
  items.forEach((n, i) => {
    const head = n.url ? `<a href="${escapeHtml(n.url)}">${escapeHtml(n.title)}</a>` : `<b>${escapeHtml(n.title)}</b>`;
    lines.push(`${n.emoji || '⚽'} <b>${i + 1}.</b> ${head}\n${escapeHtml(n.body)}\n<i>🏷 ${escapeHtml(n.tag)} · 📡 ${escapeHtml(n.source)} · 🕒 ${timeAgo(n.hoursAgo)}</i>\n`);
  });
  lines.push(`\n<i>🤖 Powered by Gemini AI + Google Search · auto-refresh every 20 min</i>`);
  return lines.join('\n');
}

function mainMenuKeyboard() {
  const kb = new InlineKeyboard()
    .text('🔥 Top News', 'cat:top').text('💸 Transfers', 'cat:transfers').row()
    .text('🏆 Tournaments', 'menu:tournaments').text('⭐ Players', 'cat:players').row()
    .text('🌍 Leagues by Country', 'menu:countries').row()
    .text('🤖 Ask AI', 'help:ask').text('🔄 Refresh', 'refresh:cat:top');
  if (WEBAPP_URL) kb.row().webApp('📱 Open Mini App', WEBAPP_URL);
  return kb;
}

function countriesKeyboard(page = 0) {
  const PER_PAGE = 12;
  const start = page * PER_PAGE;
  const slice = COUNTRIES.slice(start, start + PER_PAGE);
  const kb = new InlineKeyboard();
  slice.forEach((c, i) => {
    kb.text(`${c.flag} ${c.name}`, `country:${c.id}`);
    if ((i + 1) % 2 === 0) kb.row();
  });
  if (slice.length % 2 !== 0) kb.row();
  const totalPages = Math.ceil(COUNTRIES.length / PER_PAGE);
  if (totalPages > 1) {
    if (page > 0) kb.text('⬅️ Prev', `countries:${page - 1}`);
    kb.text(`${page + 1}/${totalPages}`, 'noop');
    if (page < totalPages - 1) kb.text('Next ➡️', `countries:${page + 1}`);
    kb.row();
  }
  kb.text('🏠 Main Menu', 'menu:main');
  return kb;
}

function countryLeaguesKeyboard(countryId) {
  const c = findCountry(countryId);
  const kb = new InlineKeyboard();
  if (!c) return kb.text('🏠 Main Menu', 'menu:main');
  c.leagues.forEach(l => { kb.text(`🏟 ${l.name}`, `lg:${l.id}`).row(); });
  kb.text(`📰 All ${c.name} News`, `country-news:${countryId}`).row();
  kb.text('⬅️ Countries', 'menu:countries').text('🏠 Main', 'menu:main');
  return kb;
}

function tournamentsKeyboard() {
  const kb = new InlineKeyboard();
  TOURNAMENTS.forEach((t, i) => {
    kb.text(`${t.emoji} ${t.name}`, `tour:${t.id}`);
    if ((i + 1) % 2 === 0) kb.row();
  });
  if (TOURNAMENTS.length % 2 !== 0) kb.row();
  kb.text('🏠 Main Menu', 'menu:main');
  return kb;
}

function refreshKeyboard(refreshKey, backTarget = 'menu:main') {
  return new InlineKeyboard().text('🔄 Refresh', `refresh:${refreshKey}`).text('⬅️ Back', backTarget);
}

async function getNews(cacheKey, topic, count = 6) {
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const items = await aiFetchNews({ apiKey: GEMINI_API_KEY, topic, count });
  if (items.length) cacheSet(cacheKey, items);
  return items;
}

function topicForCategory(cat) {
  switch (cat) {
    case 'top': return 'biggest worldwide football headlines today';
    case 'transfers': return 'latest football transfer news, rumors, confirmed signings and contract extensions across all top leagues';
    case 'tournaments': return 'latest news about major football tournaments: Champions League, Europa League, World Cup, Euro, Copa America, AFCON, Asian Cup, Libertadores, Club World Cup';
    case 'players': return 'latest news about top football players: awards, records, injuries, contract news';
    default: return 'football news';
  }
}

bot.command('start', async ctx => {
  const name = ctx.from?.first_name || 'mate';
  await ctx.reply(
    `⚽ <b>Welcome to FootballWorlds, ${escapeHtml(name)}!</b>\n\n` +
    `Your AI-powered football companion. I bring you <b>live news</b> from every major league and tournament — refreshed in real time.\n\n` +
    `<b>What I can do:</b>\n🔥 /top — biggest stories right now\n💸 /transfers — latest transfer moves\n🏆 /tournaments — UCL, World Cup & more\n⭐ /players — player news & records\n🌍 /leagues — pick a country and league\n🤖 /ask <i>your question</i> — ask the AI anything\n❓ /help — full command list\n\nPick something from the menu below 👇`,
    { parse_mode: 'HTML', reply_markup: mainMenuKeyboard(), link_preview_options: { is_disabled: true } }
  );
});

bot.command('help', async ctx => {
  await ctx.reply(
    `<b>📖 FootballWorlds Bot — Commands</b>\n\n/start — main menu\n/top — top football news\n/transfers — transfer market\n/tournaments — international cups\n/players — player news\n/leagues — browse by country\n/ask &lt;question&gt; — ask the AI\n/refresh — clear cache & re-fetch news\n\n<i>All news is fetched live via Gemini AI + Google Search.</i>`,
    { parse_mode: 'HTML', reply_markup: mainMenuKeyboard() }
  );
});

bot.command(['top', 'news'], ctx => sendCategoryNews(ctx, 'top'));
bot.command('transfers', ctx => sendCategoryNews(ctx, 'transfers'));
bot.command('players', ctx => sendCategoryNews(ctx, 'players'));

bot.command('tournaments', async ctx => {
  await ctx.reply('🏆 <b>Pick a tournament:</b>', { parse_mode: 'HTML', reply_markup: tournamentsKeyboard() });
});

bot.command('leagues', async ctx => {
  await ctx.reply('🌍 <b>Pick a country:</b>', { parse_mode: 'HTML', reply_markup: countriesKeyboard(0) });
});

bot.command('ask', async ctx => {
  const q = ctx.match?.trim();
  if (!q) return ctx.reply('ℹ️ Usage: <code>/ask your question</code>\n\nExample:\n<code>/ask who scored in El Clasico last weekend?</code>', { parse_mode: 'HTML' });
  await answerQuestion(ctx, q);
});

bot.command('refresh', async ctx => {
  const n = cacheClear();
  await ctx.reply(`🧹 Cache cleared (${n} entries). Next request will fetch fresh news.`);
});

bot.command('admin', async ctx => {
  if (!ADMIN_ID || ctx.from?.id !== ADMIN_ID) return ctx.reply('🚫 Admin only.');
  await ctx.reply(`<b>👑 Admin panel</b>\nCache TTL: ${process.env.CACHE_TTL_MIN || 20} min\nUse /refresh to clear cache.\nWebapp: ${WEBAPP_URL || '(not set)'}`, { parse_mode: 'HTML' });
});

bot.callbackQuery(/^noop$/, ctx => ctx.answerCallbackQuery());

bot.callbackQuery(/^menu:(.+)$/, async ctx => {
  const which = ctx.match[1];
  await ctx.answerCallbackQuery();
  if (which === 'main') return ctx.editMessageText('🏠 <b>Main Menu</b>\nWhat would you like to see?', { parse_mode: 'HTML', reply_markup: mainMenuKeyboard() });
  if (which === 'countries') return ctx.editMessageText('🌍 <b>Pick a country:</b>', { parse_mode: 'HTML', reply_markup: countriesKeyboard(0) });
  if (which === 'tournaments') return ctx.editMessageText('🏆 <b>Pick a tournament:</b>', { parse_mode: 'HTML', reply_markup: tournamentsKeyboard() });
});

bot.callbackQuery(/^countries:(\d+)$/, async ctx => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText('🌍 <b>Pick a country:</b>', { parse_mode: 'HTML', reply_markup: countriesKeyboard(Number(ctx.match[1])) });
});

bot.callbackQuery(/^country:(.+)$/, async ctx => {
  const c = findCountry(ctx.match[1]);
  await ctx.answerCallbackQuery();
  if (!c) return;
  await ctx.editMessageText(`${c.flag} <b>${escapeHtml(c.name)}</b>\nPick a league or get country-wide news:`, { parse_mode: 'HTML', reply_markup: countryLeaguesKeyboard(c.id) });
});

bot.callbackQuery(/^country-news:(.+)$/, async ctx => {
  const c = findCountry(ctx.match[1]);
  await ctx.answerCallbackQuery();
  if (!c) return;
  await fetchAndShow(ctx, { cacheKey: `country:${c.id}`, topic: `latest football news from ${c.name}: all leagues, national team, clubs and transfers`, title: `${c.flag} ${c.name} — Latest News`, backTarget: `country:${c.id}`, refreshKey: `country-news:${c.id}` });
});

bot.callbackQuery(/^lg:(.+)$/, async ctx => {
  const info = findLeague(ctx.match[1]);
  await ctx.answerCallbackQuery();
  if (!info) return;
  await fetchAndShow(ctx, { cacheKey: `league:${info.league.id}`, topic: `latest news, matches, transfers and standings from the ${info.league.name} (${info.country.name} football)`, title: `${info.country.flag} ${info.league.name}`, backTarget: `country:${info.country.id}`, refreshKey: `lg:${info.league.id}` });
});

bot.callbackQuery(/^tour:(.+)$/, async ctx => {
  const t = findTournament(ctx.match[1]);
  await ctx.answerCallbackQuery();
  if (!t) return;
  await fetchAndShow(ctx, { cacheKey: `tour:${t.id}`, topic: `latest news and results from the ${t.name}`, title: `${t.emoji} ${t.name}`, backTarget: 'menu:tournaments', refreshKey: `tour:${t.id}` });
});

bot.callbackQuery(/^cat:(.+)$/, async ctx => {
  await ctx.answerCallbackQuery();
  await sendCategoryNews(ctx, ctx.match[1], true);
});

bot.callbackQuery(/^refresh:(.+)$/, async ctx => {
  await ctx.answerCallbackQuery({ text: '🔄 Refreshing…' });
  const key = ctx.match[1];
  cacheClear();
  if (key.startsWith('cat:')) return sendCategoryNews(ctx, key.slice(4), true);
  if (key.startsWith('lg:')) {
    const info = findLeague(key.slice(3));
    if (!info) return;
    return fetchAndShow(ctx, { cacheKey: `league:${info.league.id}`, topic: `latest news, matches, transfers and standings from the ${info.league.name} (${info.country.name} football)`, title: `${info.country.flag} ${info.league.name}`, backTarget: `country:${info.country.id}`, refreshKey: `lg:${info.league.id}` });
  }
  if (key.startsWith('tour:')) {
    const t = findTournament(key.slice(5));
    if (!t) return;
    return fetchAndShow(ctx, { cacheKey: `tour:${t.id}`, topic: `latest news and results from the ${t.name}`, title: `${t.emoji} ${t.name}`, backTarget: 'menu:tournaments', refreshKey: `tour:${t.id}` });
  }
  if (key.startsWith('country-news:')) {
    const c = findCountry(key.slice(13));
    if (!c) return;
    return fetchAndShow(ctx, { cacheKey: `country:${c.id}`, topic: `latest football news from ${c.name}: all leagues, national team, clubs and transfers`, title: `${c.flag} ${c.name} — Latest News`, backTarget: `country:${c.id}`, refreshKey: `country-news:${c.id}` });
  }
});

bot.callbackQuery(/^help:ask$/, async ctx => {
  await ctx.answerCallbackQuery();
  await ctx.reply('🤖 <b>Ask me anything!</b>\n\nJust type your question and I\'ll search the web for you.\n\nExamples:\n• <code>Who won El Clasico?</code>\n• <code>Top scorers in Bundesliga</code>\n• <code>Mbappé latest news</code>', { parse_mode: 'HTML' });
});

bot.on('message:text', async ctx => {
  const txt = ctx.message.text.trim();
  if (txt.startsWith('/')) return;
  await answerQuestion(ctx, txt);
});

async function sendCategoryNews(ctx, cat, editIfPossible = false) {
  const title = cat === 'top' ? '🔥 Top Football Stories' : cat === 'transfers' ? '💸 Transfer Market' : cat === 'tournaments' ? '🏆 Tournament News' : cat === 'players' ? '⭐ Player News' : '📰 Football News';
  await fetchAndShow(ctx, { cacheKey: `cat:${cat}`, topic: topicForCategory(cat), title, backTarget: 'menu:main', refreshKey: `cat:${cat}`, edit: editIfPossible });
}

async function fetchAndShow(ctx, { cacheKey, topic, title, backTarget, refreshKey, edit = true }) {
  const loadingMsg = '⏳ <i>Fetching the latest news… this takes a few seconds.</i>';
  let target;
  try {
    if (edit && ctx.callbackQuery) {
      await ctx.editMessageText(loadingMsg, { parse_mode: 'HTML' });
      target = 'edit';
    } else {
      const sent = await ctx.reply(loadingMsg, { parse_mode: 'HTML' });
      target = sent.message_id;
    }
  } catch { target = null; }

  try {
    const items = await getNews(cacheKey, topic, 6);
    const text = renderNews(title, items);
    const opts = { parse_mode: 'HTML', reply_markup: refreshKeyboard(refreshKey, backTarget), link_preview_options: { is_disabled: true } };
    if (target === 'edit') await ctx.editMessageText(text, opts);
    else if (typeof target === 'number') await ctx.api.editMessageText(ctx.chat.id, target, text, opts);
    else await ctx.reply(text, opts);
  } catch (err) {
    console.error('fetchAndShow error:', err);
    const errText = `⚠️ Couldn't fetch news right now.\n\n<code>${escapeHtml(err.message || 'Unknown error')}</code>`;
    if (target === 'edit') await ctx.editMessageText(errText, { parse_mode: 'HTML', reply_markup: refreshKeyboard(refreshKey, backTarget) });
    else await ctx.reply(errText, { parse_mode: 'HTML', reply_markup: refreshKeyboard(refreshKey, backTarget) });
  }
}

async function answerQuestion(ctx, question) {
  const loading = await ctx.reply('🤖 <i>Thinking & searching the web…</i>', { parse_mode: 'HTML' });
  try {
    const answer = await aiAnswerQuestion({ apiKey: GEMINI_API_KEY, question });
    await ctx.api.editMessageText(ctx.chat.id, loading.message_id, `🤖 <b>AI Answer</b>\n\n${escapeHtml(answer)}\n\n<i>Powered by Gemini + Google Search</i>`, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
  } catch (err) {
    console.error('answerQuestion error:', err);
    await ctx.api.editMessageText(ctx.chat.id, loading.message_id, `⚠️ AI error: <code>${escapeHtml(err.message || 'unknown')}</code>`, { parse_mode: 'HTML' });
  }
}

bot.catch(err => {
  const e = err.error;
  if (e instanceof GrammyError) console.error('Grammy error:', e.description);
  else if (e instanceof HttpError) console.error('HTTP error:', e);
  else console.error('Unknown error:', e);
});

await bot.api.setMyCommands([
  { command: 'start', description: '🏠 Main menu' },
  { command: 'top', description: '🔥 Top football news' },
  { command: 'transfers', description: '💸 Transfer market' },
  { command: 'tournaments', description: '🏆 Cups & international comps' },
  { command: 'players', description: '⭐ Player news' },
  { command: 'leagues', description: '🌍 Browse by country' },
  { command: 'ask', description: '🤖 Ask AI a question' },
  { command: 'refresh', description: '🔄 Clear cache & re-fetch' },
  { command: 'help', description: '📖 Help' },
]);

console.log('⚽ @footballworlds_bot starting up…');
bot.start({ onStart: info => console.log(`🟢 Bot online as @${info.username}`) });
