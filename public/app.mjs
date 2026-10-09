import {setupRewardViewer} from './reward-viewer.mjs';
import {setupVoiceConversation} from './voice-client.mjs';
import {setupCastStage} from './cast-stage.mjs';
const $ = id => document.getElementById(id);
const number = value => new Intl.NumberFormat('ja-JP').format(Number(value) || 0);
const yen = value => `¥${number(value)}`;
const date = value => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const levels = ['初対面', '常連客', '仲良し', '特別なお客様', '大切な常連'];
let catalog = { casts: [], items: [], packs: [], topics: [], events: [] };
let session = { user: null, csrfToken: '', capabilities: {} };
let state = null;
let activeCast = 'luna';
let activeView = 'night';
let difficulty = 'easy';
let job = null;
let serverOffset = 0;
let selectedItem = null;
let selectedPack = null;
let authMode = 'register';
let historyMode = 'all';
let toastTimer;
let refreshing = false;
let voiceUI;
let rewardUI;
const castStage=setupCastStage();
let responseEmotion='neutral';
let previousVoicePhase='idle';
let jobActionBusy = false;
let canStart = false;
let mediaAssets = [];
let lastAIReplyId = null;
let generatedVoiceUrl = null;
const inFlight = new Set();

function el(tag, className, textValue) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textValue !== undefined && textValue !== null) node.textContent = String(textValue);
  return node;
}
function set(id, value) { $(id).textContent = String(value ?? ''); }
function toast(message) {
  clearTimeout(toastTimer);
  set('toast', message);
  $('toast').classList.add('visible');
  toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 5000);
}
function openDialog(id) {
  const dialog = $(id);
  if (!dialog.open) dialog.showModal();
}
function requireAuth() {
  if (session.user) return true;
  openAuth();
  return false;
}
function currentCast() { return catalog.casts.find(cast => cast.id === activeCast) || catalog.casts[0]; }
function currentAffection() { return state?.affection?.find(affection => affection.castId === activeCast); }
function storageGet(key) { try { return sessionStorage.getItem(key); } catch { return null; } }
function storageSet(key, value) { try { sessionStorage.setItem(key, value); } catch {} }
function storageRemove(key) { try { sessionStorage.removeItem(key); } catch {} }

async function api(path, body) {
  const options = { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(path==='/chat'?310000:body === undefined ? 20000 : 45000) };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.headers['X-CSRF-Token'] = session.csrfToken || '';
    options.body = JSON.stringify(body);
  }
  let response;
  try { response = await fetch(`/api${path}`, options); }
  catch { throw Object.assign(new Error('通信を確認できませんでした。履歴を確認して、同じ操作を再試行できます。'), { status: 0 }); }
  let data;
  try { data = await response.json(); }
  catch { throw Object.assign(new Error('サーバーの応答を読み取れませんでした。'), { status: response.status }); }
  if (!response.ok) {
    const message = data.message || data.error?.message || (typeof data.error === 'string' ? data.error : '操作を完了できませんでした。');
    const error = Object.assign(new Error(message), { status: response.status, code: data.code || data.error?.code });
    if (response.status === 401 && session.user) {
      session.user = null; state = null; stopRealtime(); renderState();
      toast('セッションが終了しました。もう一度ログインしてください。');
    }
    throw error;
  }
  return data;
}

async function mutation(path, body, actionId) {
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(body))))).map(x=>x.toString(16).padStart(2,'0')).join('');
  const storageKey = `succubus:request:${session.user?.id || 'guest'}:${actionId || path}:${digest}`;
  const key = storageGet(storageKey) || crypto.randomUUID();
  storageSet(storageKey, key);
  try {
    const result = await api(path, { ...body, key });
    storageRemove(storageKey);
    return result;
  } catch (error) {
    if (error.status >= 400 && error.status < 500 && error.status !== 408) storageRemove(storageKey);
    throw error;
  }
}
async function busy(button, operation, errorTarget) {
  if (!button || inFlight.has(button)) return;
  inFlight.add(button); button.disabled = true; button.setAttribute('aria-busy', 'true');
  if (errorTarget) set(errorTarget, '');
  try { return await operation(); }
  catch (error) { if (errorTarget) set(errorTarget, error.message); else toast(error.message); }
  finally { inFlight.delete(button); button.disabled = false; button.removeAttribute('aria-busy'); }
}
async function refresh() {
  if (!session.user || refreshing) return;
  refreshing = true;
  try {
    state = await api('/state');
    if (state.serverTime) serverOffset = state.serverTime - Date.now();
    renderState(); set('connection-status', 'SERVER CONNECTED');
  } catch (error) { set('connection-status', '再接続をお待ちください'); throw error; }
  finally { refreshing = false; }
}
async function acceptResult(result) {
  if (result?.state) { state = result.state; if (state.serverTime) serverOffset = state.serverTime - Date.now(); renderState(); }
  else await refresh();
}
function renderCatalog() {
  $('cast-buttons').replaceChildren(...catalog.casts.map(cast => {
    const button = el('button', `cast-button${cast.id === activeCast ? ' active' : ''}`);
    const thumb = el('span', 'cast-thumb');
    thumb.style.backgroundImage=`url('/media/${cast.id}-expressions.png')`;
    thumb.style.backgroundPosition = `${({ left: 0, center: 50, right: 100 })[cast.position] ?? 50}% 27%`;
    const label = el('span', '', cast.nameEn ? cast.nameEn[0] + cast.nameEn.slice(1).toLowerCase() : cast.name);
    button.append(thumb, label); button.setAttribute('aria-pressed', String(cast.id === activeCast));
    button.setAttribute('aria-label', `${cast.name}を選択`);
    button.addEventListener('click', () => chooseCast(cast.id)); return button;
  }));
  const symbols = { glass: '♧', moon: '☾', stars: '✦', crown: '♛' };
  const captions = { drink: '笑顔と、最初の乾杯。', luxury: '今夜は、少し特別に。', champagne: 'きらめく夜を、記念に。', premium: '物語に彩りを添えて。' };
  $('menu-items').replaceChildren(...catalog.items.map(item => {
    const button = el('button', 'menu-item');
    button.append(el('span', 'item-icon', symbols[item.icon] || '✧'), el('h3', '', item.name), el('p', '', captions[item.id] || '特別な夜の演出。'));
    if (item.premium) button.append(el('span', 'premium-badge', 'PREMIUM'));
    const price = el('div', 'menu-price');
    if (item.priceG !== null && item.priceG !== undefined) price.append(el('i', 'coin gold', 'G'), document.createTextNode(number(item.priceG)));
    button.append(price);
    button.setAttribute('aria-label', `${item.name}、${number(item.priceG)}G。ギフトの特典を確認`);
    button.addEventListener('click', () => openOrder(item)); return button;
  }));
  $('pack-items').replaceChildren(...catalog.packs.map(pack => {
    const button = el('button', 'pack-button'); const amount = el('b', '', number(pack.coins)); amount.append(el('small', '', ' S'));
    button.append(amount, el('span', '', `${yen(pack.yen)} 税込`)); button.disabled = !session.capabilities?.stripe;
    button.addEventListener('click', () => openPack(pack)); return button;
  }));
  renderCast();
}
function renderCast() {
  const cast = currentCast(); if (!cast) return;
  const name = cast.nameEn ? cast.nameEn[0] + cast.nameEn.slice(1).toLowerCase() : cast.name;
  $('cast-name').replaceChildren(document.createTextNode(name), el('small', '', cast.name));
  set('cast-age', `${cast.age}歳 · AI`); set('cast-tagline', cast.description); set('dialogue-name', cast.nameEn || cast.name);
  const tagMap = { luna: ['穏やか', '星と本'], mio: ['明るい', '音楽とカフェ'], reina: ['上品', '旅と映画'] };
  $('cast-tags').replaceChildren(...(tagMap[cast.id] || ['AIキャスト']).map(tag => el('span', '', tag)));
  document.querySelectorAll('.cast-button').forEach((button, index) => {
    const active = catalog.casts[index]?.id === activeCast; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  renderAffection(); renderTopics(); renderStories();
}
async function chooseCast(id) {
  if (id === activeCast) return;
  if(voiceUI?.processing){toast('返答を準備しています。終わってからキャストを選んでください。');return;}
  activeCast = id;storageSet('succubus:cast',id); stopRealtime(); castStage.select(id);
  voiceUI?.clearReplay();
  renderCast(); speakDialogue(currentCast()?.greeting, 'scripted');
  if (session.user) await visitCast();
}
async function visitCast() {
  try { const result = await mutation('/visit', { castId: activeCast }, 'visit'); await acceptResult(result); }
  catch (error) { toast(error.message); }
}
function speakDialogue(reply, source = 'scripted', replyId = null) {
  if (!reply) return;
  lastAIReplyId = replyId;
  $('voice-replay').disabled=true;

  set('dialogue-text', `「${reply}」`);
  set('dialogue-source', source === 'fal-gemini' ? 'GEMINI 3.8 FLASH · AI会話' : source === 'safety' ? '安心して楽しめる話題へ' : 'SCRIPTED · 定型会話');

}
async function playScripted(lineId,castId,emotion='happy'){
  const asset=mediaAssets.find(a=>a.castId===castId&&a.lineId===lineId&&a.variant==='casual-v2');
  if(!asset)return;
  responseEmotion=emotion;await voiceUI.replay({audioUrl:asset.url,emotion});
  $('voice-replay').disabled=false;set('dialogue-source','Gemini 3.8 Flash TTS · 追加消費なし');
}
function renderTopics() {
  $('conversation-actions').replaceChildren(...(session.user ? catalog.topics : []).map(topic => {
    const button = el('button', 'topic-button', topic.label);
    button.addEventListener('click', () => busy(button, async () => {
      const castId = activeCast;
      const result = await mutation('/conversation', { castId, topicId: topic.id }, 'conversation');
      if (activeCast === castId) speakDialogue(result.reply || topic.reply, result.source || 'scripted');
      await acceptResult(result);
      if (result.progress?.credited === false || result.credited === false) toast('この話題も、ゆっくり楽しんでください。今日の関係ポイントは記録済みです。');
      if(activeCast===castId)await playScripted('topic-'+topic.id,castId,'neutral');
    }));
    return button;
  }));
}
function renderAffection() {
  const affection = currentAffection(); const score = affection?.score ?? affection?.value ?? 0; const level = affection?.level || 1;
  set('affection-value', score); set('relationship-level', `LEVEL ${level} · ${affection?.label || levels[level - 1]}`);
  $('affection-fill').style.width = `${Math.max(0, Math.min(100, score))}%`;
  $('relationship').hidden = !session.user; $('welcome-block').hidden = Boolean(session.user);
  document.querySelector('.lounge-hero').classList.toggle('is-playing',Boolean(session.user));
}
function renderState() {
  const wallet = state?.wallet;
  set('header-g', wallet ? number(wallet.G) : '—'); set('header-s', wallet ? number(wallet.S) : '—');
  set('wallet-g', number(wallet?.G)); set('wallet-s', number(wallet?.S)); set('day-g', number(wallet?.G));set('reward-balance',number(wallet?.G));
  set('account-name', session.user?.name || 'ゲスト');
  $('wallet-debt').hidden = !(wallet?.debtS > 0);
  set('wallet-debt', `決済の返金・異議申立てによる不足：${number(wallet?.debtS)}S。解消するまでSでの注文は停止します。`);
  if (state?.monthly) {
    const monthly = state.monthly;
    set('monthly-spend', `${monthly.month} · 決済済 ${yen(monthly.paidYen)} / 上限 ${yen(monthly.limitYen)}${monthly.reservedYen ? ` · 決済待ち ${yen(monthly.reservedYen)}` : ''}`);
    if (document.activeElement !== $('limit-yen')) $('limit-yen').value = String(monthly.limitYen);
  } else set('monthly-spend', 'ログイン後に表示');
  renderAffection(); renderHistory(); renderStories(); renderAlbum();
  const activeJob = state?.jobs?.find(candidate => candidate.status === 'active');
  if (activeJob) job = activeJob;
  else if (!state || job?.status === 'active') job = null;
  renderJob();
  $('job-start').disabled = !canStart;
  set('stripe-status', session.capabilities?.stripe ? 'Stripeテスト決済に接続済みです。カード情報はStripe上で入力します。' : 'Stripeテスト用キーが未設定です。Sの購入は現在利用できません。設定後にテスト決済を検証できます。');
  set('ai-status', session.capabilities?.ai ? (session.capabilities.aiProvider==='fal-gemini'?`Gemini音声に接続済み · 残高 ${number(state?.wallet?.S)}S。表示料金を確認して開始してください。`:'Gemini音声を設定してください。') : 'AI会話キーが未設定です。無料の定型会話と生成済みの挨拶音声を利用できます。');
  $('chat-submit').disabled = !session.capabilities?.ai;
  const price=session.capabilities?.voicePriceS||5;set('voice-price',`返答1回 ${price}S`);$('mic-start').disabled=!session.capabilities?.ai||!$('voice-consent').checked||(wallet?.S||0)<price||wallet?.debtS>0||Boolean(voiceUI?.processing)||Boolean(voiceUI?.active);
  $('chat-submit').textContent=`${price}Sで送信・音声の返答`;
  if(!voiceUI?.processing&&$('cached-audio').paused&&!$('scene').dataset.phase)set('voice-status',`音声会話は返答1回${price}S · 基本会話は無料`);
}
function renderHistory() {
  const rows = [];
  if(historyMode!=='purchases')for(const turn of state?.voiceTurns||[]){
    const row=el('div','history-row');row.append(el('strong','',`音声会話 · ${catalog.casts.find(c=>c.id===turn.castId)?.name||turn.castId}`),el('span','history-amount',turn.status==='failed'?'S返却済':`${turn.priceS}S`),el('small','',date(turn.createdAt)),el('span','history-status',turn.status==='complete'?'返答・音声保存済':turn.status==='failed'?'未完了・追加消費なし':'返答を準備中'));
    if(turn.status==='complete'){const button=el('button','','追加消費なしで聞く');button.addEventListener('click',()=>busy(button,async()=>{if(voiceUI?.processing)throw new Error('返答の準備が終わってから再生してください。');$('wallet-dialog').close();switchView('night');await chooseCast(turn.castId);speakDialogue(turn.reply.reply,turn.reply.source);responseEmotion=turn.reply.emotion||'neutral';await voiceUI.replay({...turn.reply,audioUrl:'/api/voice/'+turn.id+'/audio'});}));row.append(button);}rows.push({time:turn.createdAt,node:row});
  }
  const statusNames = { pending: '決済確認待ち', paid: '決済成功', expired: '期限切れ', failed: '決済失敗', cancelled: 'キャンセル', refunded: '返金', disputed: '異議申立て' };
  for (const purchase of state?.purchases || []) {
    const row = el('div', 'history-row');
    row.append(el('strong', '', `${purchase.sessionId?.startsWith('cs_test_fixture')?'ローカル検証用S':'S購入'} · ${number(purchase.coins)}S`), el('span', 'history-amount', yen(purchase.yen)), el('small', '', date(purchase.createdAt)), el('span', 'history-status', `${statusNames[purchase.status] || purchase.status}${purchase.refundedYen ? ` · 返金 ${yen(purchase.refundedYen)}` : ''}${purchase.heldS ? ` · 調整 ${number(purchase.heldS)}S` : ''}`));
    if (purchase.status === 'pending') {
      const button = el('button', '', '決済結果を再確認');
      button.addEventListener('click', () => busy(button, async () => { await reconcile(purchase.id); toast('サーバーで決済状態を再確認しました。'); })); row.append(button);
    }
    rows.push({ time: purchase.createdAt, node: row });
  }
  if (historyMode === 'all') for (const entry of state?.ledger || []) {
    const labels = { job: 'お仕事の報酬', order: 'メニューの注文', purchase: 'Sの付与', payment: 'Sの付与', payment_adjustment: '返金・異議申立ての調整',test_credit:'テスト用通貨の補充',rewarded_demo:'動画視聴（テスト）の報酬',voice_reservation:'音声会話の料金',voice_release:'未完了の音声会話・S返却' };
    const matchingOrder = (state?.orders || []).find(order => order.id === entry.reference);
    const row = el('div', 'history-row');
    row.append(el('strong', '', matchingOrder?.name || labels[entry.kind] || '残高記録'), el('span', 'history-amount', `${entry.amount > 0 ? '+' : ''}${number(entry.amount)} ${entry.currency}`), el('small', '', date(entry.createdAt)), el('span', 'history-status', `残高 ${number(entry.balanceAfter)} ${entry.currency}`));
    rows.push({ time: entry.createdAt, node: row });
  }
  rows.sort((a, b) => b.time - a.time);
  $('wallet-history').replaceChildren(...(rows.length ? rows.map(row => row.node) : [el('p', 'empty-state', session.user ? 'まだ履歴がありません。会話を楽しんだり、昼のお仕事からはじめてみましょう。' : 'ログインすると、残高と支出履歴を確認できます。')]));
}
function renderStories() {
  const affection = currentAffection();
  $('story-events').replaceChildren(...catalog.events.map(event => {
    const unlocked = (affection?.level || 1) >= event.minLevel;
    const completed = affection?.completedEvents?.includes(event.id);
    const card = el('article', `story-event${unlocked ? '' : ' locked'}`);
    const body = el('div'); body.append(el('h3', '', event.title), el('p', '', `${currentCast()?.name || ''} · LEVEL ${event.minLevel}${completed ? ' · 読了' : ''}`));
    const button = el('button', 'text-button', unlocked ? completed ? 'もう一度読む ↗' : '無料で物語を読む ↗' : '関係性が進むと解放');
    button.disabled = !unlocked;
    button.addEventListener('click', () => { if (!requireAuth()) return; busy(button, async () => {
      const result = await mutation('/event', { castId: activeCast, eventId: event.id }, 'event');
      speakDialogue(result.episode || result.reply || event.episode); await acceptResult(result); switchView('night');
      toast(`${event.title}をアルバムのように、何度でも。`);
    }); });
    body.append(button); card.append(el('span', 'event-icon', unlocked ? '✦' : '◇'), body); return card;
  }));
}
function renderAlbum() {
  $('album-items').replaceChildren(...(state?.album?.length ? state.album.map(entry => {
    const card = el('article', 'album-card'); const body = el('div');
    const cast = catalog.casts.find(candidate => candidate.id === entry.castId);
    body.append(el('h3', '', entry.title), el('p', '', `${cast?.name || entry.castId} · ${date(entry.createdAt)} · 記念カード`));
    const button = el('button', 'text-button', '記念の演出を再生 ↗');
    button.addEventListener('click', () => { switchView('night'); if (cast) { chooseCast(cast.id); } showReaction(entry.reaction || 'champagne'); toast(entry.title); });
    body.append(button); card.append(el('span', '', '✧'), body); return card;
  }) : [el('div', 'empty-state', 'シャンパンやプレミアムボトルの記念カードが、ここに並びます。無料の物語はいつでも隣から楽しめます。')]));
}
function switchView(view) {
  activeView = view;
  castStage?.setActive(view==='night');
  for (const name of ['night', 'day', 'story']) $(`${name}-view`).hidden = name !== view;
  document.querySelectorAll('.nav-tab').forEach(button => { const active = button.dataset.view === view; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  if(view!=='night')stopRealtime();if(view!=='day')rewardUI?.close();
  if (view === 'story') renderStories();
  if(matchMedia('(max-width:700px)').matches)window.scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});
}
function openAuth(mode) {
  if (mode) authMode = mode;
  $('auth-form').hidden = Boolean(session.user); $('account-details').hidden = !session.user;
  document.querySelector('.auth-tabs').hidden = Boolean(session.user);
  set('auth-title', session.user ? 'アカウント' : authMode === 'register' ? 'アカウントを作成' : 'ログイン');
  set('account-details-name', `${session.user?.name || ''} さんの物語を保存しています。`);
  $('auth-password').autocomplete = authMode === 'login' ? 'current-password' : 'new-password';
  $('auth-password').minLength = authMode === 'login' ? 1 : 12;
  set('auth-submit', authMode === 'register' ? 'アカウントを作成する →' : 'ログインする →');
  document.querySelectorAll('[data-auth]').forEach(button => button.classList.toggle('active', button.dataset.auth === authMode));
  set('auth-error', ''); openDialog('auth-dialog');
}
async function authenticate(event) {
  event.preventDefault();
  await busy($('auth-submit'), async () => {
    await api(`/auth/${authMode}`, { name: $('auth-name').value.trim(), password: $('auth-password').value });
    session = await api('/session'); canStart = true; $('auth-password').value = ''; $('auth-dialog').close();
    renderCatalog(); await refresh(); speakDialogue(currentCast()?.greeting); await visitCast();
    toast(`${session.user.name}さん、今夜もご自分のペースで。`);
    const pending = storageGet('succubus:pending-purchase'); if (pending) await reconcile(pending).catch(error => toast(error.message));
  }, 'auth-error');
}
function openWallet() {
  if (!requireAuth()) return;
  stopRealtime();
  renderState(); openDialog('wallet-dialog'); refresh().catch(error => toast(error.message));
}
function openOrder(item) {
  if (!requireAuth()) return;
  stopRealtime();
  selectedItem = item; $('order-form').reset();
  set('order-name', item.name); set('order-description', `${currentCast()?.name}にプレゼントします。無料のGを使います。`);
  $('order-perks').replaceChildren(...(item.benefits || []).map(benefit => el('li', '', benefit)));
  $('option-g').hidden = item.priceG == null; $('option-g').querySelector('input').disabled = item.priceG == null;
  set('order-price-g', item.priceG == null ? '利用不可' : `${number(item.priceG)} G`); set('order-price-s', `${number(item.priceS)} S`);
  $('option-s').hidden=true;$('option-s').querySelector('input').disabled=true;$('option-g').querySelector('input').checked=true;showOrderBalance(); set('order-error', ''); openDialog('order-dialog');
}
function showOrderBalance() {
  const currency = new FormData($('order-form')).get('currency'); if (!currency || !selectedItem) return;
  const cost = currency === 'G' ? selectedItem.priceG : selectedItem.priceS;
  const balance = state?.wallet?.[currency] || 0;
  const enough=balance>=cost;
  set('order-remaining', enough ? `現在 ${number(balance)} ${currency} → 注文後 ${number(balance - cost)} ${currency}` : `現在 ${number(balance)}G · あと${number(cost-balance)}G必要です。`);
  $('order-submit').disabled=!enough;$('order-get-g').hidden=enough;
}
async function placeOrder(event) {
  event.preventDefault(); if (!selectedItem || !requireAuth()) return;
  const currency = new FormData($('order-form')).get('currency'); if (!currency) { set('order-error', '使う通貨を選んでください。'); return; }
  const item = selectedItem; const castId = activeCast;
  await busy($('order-submit'), async () => {
    const result = await mutation('/order', { itemId: item.id, castId, currency }, 'order');
    await acceptResult(result); $('order-dialog').close();
    showReaction(result.reaction || result.order?.reaction || item.reaction);
    const reactions = { luna: 'ありがとうございます。今夜の一杯が、素敵な思い出になりますように。乾杯。', mio: 'ありがとう！ 今日の小さな楽しみに、乾杯。ゆっくり過ごしてね。', reina: 'ありがとうございます。今夜の物語に、素敵な一ページを。乾杯しましょう。' };
    speakDialogue(result.reply || reactions[castId] || 'ありがとう！ 乾杯。');
    await playScripted('order-'+item.id,castId,'happy');
    toast(`${item.name}を注文しました · ${number(currency === 'G' ? item.priceG : item.priceS)}${currency}`);
  }, 'order-error');
}
function showReaction(reaction) {
  const type = typeof reaction === 'object' ? reaction.type || reaction.id : reaction;
  const overlay = $('reaction-overlay'); const scene = $('scene');
  overlay.classList.remove('active'); scene.classList.remove('celebrating'); void overlay.offsetWidth;
  overlay.classList.add('active'); scene.classList.add('celebrating');
  overlay.dataset.reaction=type;scene.dataset.reaction=type;
  if (type === 'closeup') $('cast-photo').style.transform = 'scale(1.38)';
  if (type === 'premium') scene.style.background = 'radial-gradient(ellipse at 65% 35%,#bc9b5c55,#281729)';
  setTimeout(() => { overlay.classList.remove('active'); scene.classList.remove('celebrating'); scene.style.background = '';scene.dataset.reaction=''; $('cast-photo').style.transform = 'none'; }, 3000);
}
function openPack(pack) {
  if (!requireAuth()) return;
  selectedPack = pack; set('pack-amount', `${number(pack.coins)} S`); set('pack-price', `${yen(pack.yen)} 税込`);
  const monthly = state?.monthly;
  set('pack-cap', monthly ? `今月の決済済・決済待ち合計 ${yen(monthly.paidYen + monthly.reservedYen)} / 上限 ${yen(monthly.limitYen)}` : 'サーバーで月間支出上限を確認します。');
  set('pack-error', ''); $('wallet-dialog').close(); openDialog('pack-dialog');
}
async function startCheckout() {
  if (!selectedPack || !requireAuth()) return;
  await busy($('pack-confirm'), async () => {
    const result = await mutation('/purchases', { packId: selectedPack.id }, 'purchase');
    const purchase = result.purchase || result;
    if (purchase.id) storageSet('succubus:pending-purchase', purchase.id);
    const url = result.checkoutUrl || purchase.checkoutUrl;
    if (!url) { await refresh(); throw new Error('決済URLを取得できませんでした。購入履歴から結果を再確認できます。'); }
    const target = new URL(url);
    if (target.protocol !== 'https:' || target.hostname !== 'checkout.stripe.com') throw new Error('Stripeの決済URLを確認できませんでした。');
    window.location.assign(target.href);
  }, 'pack-error');
}
async function reconcile(id) {
  const result = await mutation(`/purchases/${encodeURIComponent(id)}/reconcile`, {}, `reconcile:${id}`);
  await acceptResult(result);
  const purchase = result.purchase || state?.purchases?.find(candidate => candidate.id === id);
  if (purchase?.status && purchase.status !== 'pending') storageRemove('succubus:pending-purchase');
  return purchase;
}
async function recoverCheckout() {
  const query = new URLSearchParams(location.search);
  const id = query.get('purchaseId') || query.get('purchase') || storageGet('succubus:pending-purchase');
  if (!id || !session.user) return;
  openWallet();
  const returned = query.has('purchaseId') || query.has('purchase') || query.has('checkout');
  if (returned) { history.replaceState({}, '', location.pathname); toast('決済の結果をサーバーで確認しています。'); }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const purchase = await reconcile(id);
      if (purchase?.status === 'paid') { toast(`決済を確認し、${number(purchase.coins)}Sを付与しました。`); return; }
      if (purchase?.status && purchase.status !== 'pending') { toast('決済が完了していません。履歴で状態を確認できます。'); return; }
    } catch (error) { toast(error.message); return; }
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1800));
  }
  toast('決済結果を確認中です。履歴から再確認できます。残高はサーバーの確認後に更新されます。');
}
function renderJob() {
  const active = job?.status === 'active';
  $('job-play').hidden = !active; $('job-start').hidden = active; $('difficulty-options').hidden = active;
  if (!active) { if (job?.status === 'complete') set('job-message', `お仕事完了 · ${number(job.reward)}Gを獲得しました。`); return; }
  set('job-score', `${job.correctActions || 0} 正解 / ${job.actions || 0}問`);
  if (job.challenge) {
    set('job-question', job.challenge.prompt); set('job-instruction', `伝票 ${Number(job.actions || 0) + 1} / ${job.maxActions || 12} · 正しい棚を選んでください`);
    $('job-answers').replaceChildren(...(job.challenge.options || []).map(option => {
      const button = el('button', 'job-answer', option.label || option.id);
      button.disabled = jobActionBusy;
      button.addEventListener('click', () => submitJobAnswer(option.id)); return button;
    }));
  } else { set('job-question', '仕込みができました。'); set('job-instruction', '終了時刻まで、夜のラウンジで会話を楽しむこともできます。'); $('job-answers').replaceChildren(); }
  updateJobClock();
}
function updateJobClock() {
  if (job?.status !== 'active') return;
  const remaining = Math.max(0, Math.ceil((job.endsAt - Date.now() - serverOffset) / 1000));
  set('job-time', `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`);
  $('job-finish').disabled = remaining > 0 || Number(job.actions || 0) < Number(job.minActions || 8) || inFlight.has($('job-finish'));
  set('job-message', remaining > 0 ? '仕事は終了時刻と8問以上の伝票提出で完了します。正確さと経験で報酬が育ちます。' : Number(job.actions || 0) < 8 ? '報酬を受け取るには8問以上の伝票を提出してください。' : 'お仕事の時間が終わりました。報酬を受け取れます。');
}
async function startJob() {
  if (!requireAuth()) return;
  await busy($('job-start'), async () => {
    const result = await mutation('/job/start', { difficulty }, 'job-start'); job = result.job || result;
    set('job-feedback', ''); renderJob(); await acceptResult(result);
  }, 'job-message');
}
async function submitJobAnswer(choiceId) {
  if (!job?.challenge || jobActionBusy) return;
  jobActionBusy = true; const activeJob = job;
  $('job-answers').querySelectorAll('button').forEach(button => button.disabled = true);
  try {
    const result = await mutation(`/job/${encodeURIComponent(activeJob.id)}/action`, { answer: { challengeId: activeJob.challenge.id, choiceId } }, `job-action:${activeJob.challenge.id}`);
    job = result.job || result; set('job-feedback', result.feedback || (result.correct ? '正しい棚です。' : '次の伝票で、もう一度。'));renderJob();
    await new Promise(resolve => setTimeout(resolve, 1050));
    if (state?.jobs) { const index = state.jobs.findIndex(candidate => candidate.id === job.id); if (index >= 0) state.jobs[index] = job; }
  } catch (error) { set('job-feedback', error.message); if (error.status === 409) await refresh().catch(() => {}); }
  finally { jobActionBusy = false; renderJob(); }
}
async function finishJob() {
  if (!job) return;
  await busy($('job-finish'), async () => {
    const result = await mutation(`/job/${encodeURIComponent(job.id)}/finish`, {}, 'job-finish');
    job = result.job || { ...job, status: 'complete', reward: result.reward }; await acceptResult(result);
    set('job-message', `お仕事完了 · ${number(result.reward)}Gを獲得しました。`); toast(`${number(result.reward)}Gを受け取りました。おつかれさま。`);
  }, 'job-message');
}
async function aiChat(event){
 event.preventDefault();if(!requireAuth())return;
 if(!$('voice-consent').checked){set('ai-error','返答料金と会話の送信先を確認してください。');return;}
 const text=$('chat-input').value.trim();if(!text)return;
 await busy($('chat-submit'),async()=>{const result=await voiceUI.textTurn(text);if(result){$('chat-input').value='';$('ai-dialog').close();switchView('night');}},'ai-error');
}
function stopRealtime(){voiceUI?.stop();}
function bindEvents() {
  $('greeting-voice').addEventListener('click', () => busy($('greeting-voice'), async () => {speakDialogue(currentCast().greeting,'scripted');await playScripted('greeting',activeCast,'happy');}));
  $('motion-toggle').addEventListener('click',()=>set('motion-toggle',castStage.toggle()?'映像を停止':'接客映像を再生'));
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
  document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.go)));
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
  document.querySelectorAll('[data-auth]').forEach(button => button.addEventListener('click', () => openAuth(button.dataset.auth)));
  document.querySelectorAll('[data-history]').forEach(button => button.addEventListener('click', () => { historyMode = button.dataset.history; document.querySelectorAll('[data-history]').forEach(tab => tab.classList.toggle('active', tab === button)); renderHistory(); }));
  document.querySelectorAll('[data-difficulty]').forEach(button => button.addEventListener('click', () => { difficulty = button.dataset.difficulty; document.querySelectorAll('[data-difficulty]').forEach(tab => tab.classList.toggle('active', tab === button)); }));
  $('start-night').addEventListener('click', () => openAuth()); $('account-open').addEventListener('click', () => openAuth());
  $('wallet-open').addEventListener('click', openWallet); $('auth-form').addEventListener('submit', authenticate);
  $('order-get-g').addEventListener('click',()=>{$('order-dialog').close();switchView('day');});
  $('order-form').addEventListener('submit', placeOrder); $('order-form').addEventListener('change', showOrderBalance);
  $('pack-confirm').addEventListener('click', startCheckout); $('job-start').addEventListener('click', startJob); $('job-finish').addEventListener('click', finishJob);
  $('logout').addEventListener('click', () => busy($('logout'), async () => { stopRealtime();  await api('/auth/logout', {}); session = await api('/session'); state = null; job = null; $('auth-dialog').close(); renderCatalog(); renderState(); toast('ログアウトしました。'); }));
  $('limit-form').addEventListener('submit', event => { event.preventDefault(); if (!requireAuth()) return; const button = event.currentTarget.querySelector('button'); busy(button, async () => { const result = await mutation('/limit', { yen: Number($('limit-yen').value) }, 'limit'); await acceptResult(result); toast('今月の支出上限を保存しました。'); }); });
  $('voice-consent').addEventListener('change',renderState);
  for(const id of ['chat-open'])$(id).addEventListener('click', () => { if (!requireAuth()) return; set('ai-error', '');if($('voice-consent').checked&&state.wallet.S>=(session.capabilities.voicePriceS||5)){voiceUI.start().catch(e=>toast(e.message));return;}stopRealtime();renderState();openDialog('ai-dialog'); });
  $('chat-form').addEventListener('submit', aiChat);
  window.addEventListener('pagehide', stopRealtime);
  setInterval(updateJobClock, 1000);
  setInterval(() => { if (session.user && document.visibilityState === 'visible') refresh().catch(() => {}); }, 15000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && session.user) refresh().catch(() => {}); });
}
async function boot() {
  rewardUI=setupRewardViewer({request:(path,body)=>mutation(path,body,path),onResult:acceptResult,onError:toast,onStart:async()=>{if(!session.user){openAuth();throw new Error('ログインすると視聴報酬を保存できます。');}stopRealtime();}});
  voiceUI=setupVoiceConversation({session:()=>session,state:()=>state,cast:currentCast,request:body=>mutation('/chat',body,'voice'),onReply:async result=>{responseEmotion=result.emotion||'neutral';speakDialogue(result.reply,result.source);await acceptResult(result);},onStage:(phase,message,frame)=>{const scene=$('scene');scene.dataset.phase=phase;castStage.expression(phase==='speaking'?responseEmotion:'idle');if(['listening','thinking'].includes(phase)&&$('ai-dialog').open){$('ai-dialog').close();switchView('night');}if(phase==='listening'&&previousVoicePhase==='idle'&&matchMedia('(max-width:700px)').matches)document.querySelector('.dialogue-card').scrollIntoView({block:'center',behavior:'smooth'});previousVoicePhase=phase;},onError:message=>{set('ai-error',message);toast(message);}});
  bindEvents();
  document.querySelector('.scene-caption').lastElementChild.textContent = 'AI生成の静止画 · 照明演出';
  const difficultyLabels = { easy: '3分 · 基本100G', normal: '4分 · 基本175G', hard: '5分 · 基本250G' };
  document.querySelectorAll('[data-difficulty]').forEach(button => button.querySelector('small').textContent = difficultyLabels[button.dataset.difficulty]);
  try {
    const results = await Promise.allSettled([api('/session'), api('/catalog')]);
    if (results[0].status === 'fulfilled') session = results[0].value; else throw results[0].reason;
    if (results[1].status === 'fulfilled') catalog = results[1].value; else throw results[1].reason;
    const rememberedCast=storageGet('succubus:cast');if(catalog.casts.some(c=>c.id===rememberedCast))activeCast=rememberedCast;
    rewardUI.initialize(catalog.rewardedViews);
    canStart = true; renderCatalog(); renderState(); speakDialogue(currentCast()?.greeting);
    const media=await api('/media');mediaAssets=media.assets||[];
    await castStage.initialize(mediaAssets,activeCast);$('motion-toggle').hidden=!mediaAssets.some(a=>a.mood);set('motion-toggle','映像を停止');
    $('greeting-voice').hidden=!mediaAssets.some(a=>a.kind==='audio');
    set('connection-status', 'SERVER CONNECTED');
    if (session.user) { await refresh(); await visitCast(); await recoverCheckout(); }
  } catch (error) { set('connection-status', '接続できません'); toast(`${error.message} ページを再読み込みして再接続してください。`); }
}
window.succubus = { refresh, getState: () => state, getSession: () => session, switchView };
boot();
