import { DatabaseSync } from 'node:sqlite';
import { randomInt, randomUUID } from 'node:crypto';
import { PACKS, ITEMS, CASTS, TOPICS, STORY_EVENTS } from './catalog.mjs';

export class DomainError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'DomainError';
    this.status = status;
    this.code = code;
  }
}

const fail = (status, code, message) => { throw new DomainError(status, code, message); };
const identity = (value, name = '識別子') => {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || /[\u0000-\u001f]/.test(value)) {
    fail(400, 'invalid_identifier', `${name}が不正です。`);
  }
  return value;
};
const integer = (value, min, max, name) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(400, 'invalid_amount', `${name}が不正です。`);
  return value;
};
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
};
const fingerprint = value => JSON.stringify(canonical(value));
const jstDay = timestamp => new Date(timestamp + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
const jstMonth = timestamp => jstDay(timestamp).slice(0, 7);
const levelOf = score => score >= 80 ? 5 : score >= 60 ? 4 : score >= 40 ? 3 : score >= 20 ? 2 : 1;
const LEVEL_NAMES = ['初対面', '常連客', '仲良し', '特別なお客様', '大切な常連'];
const DIFFICULTIES = {
  easy: { seconds: 180, base: 100, label: 'かんたん' },
  normal: { seconds: 240, base: 175, label: 'ふつう' },
  hard: { seconds: 300, base: 250, label: 'むずかしい' },
};
const BIN_OPTIONS = [
  { id: 'glass', label: 'グラス棚' },
  { id: 'bottle', label: 'ボトル棚' },
  { id: 'food', label: 'キッチン' },
];
const SORT_ITEMS = [
  { name: 'タンブラー', bin: 'glass' }, { name: 'シャンパングラス', bin: 'glass' },
  { name: 'ワイングラス', bin: 'glass' }, { name: 'ジュースボトル', bin: 'bottle' },
  { name: 'ミネラルウォーター', bin: 'bottle' }, { name: 'シロップボトル', bin: 'bottle' },
  { name: 'ケーキ', bin: 'food' }, { name: 'サンドイッチ', bin: 'food' }, { name: 'フルーツ皿', bin: 'food' },
];

/** All financial and reward mutations execute in BEGIN IMMEDIATE transactions.
 * The balance is derived from an append-only ledger, never accepted from a client.
 * allowFastJobs is an explicit in-process testing option, not an environment flag.
 */
export class Economy {
  constructor(dbPath = ':memory:', { clock = () => Date.now(), allowFastJobs = false } = {}) {
    if (typeof clock !== 'function') throw new TypeError('clock must be a function');
    this.clock = clock;
    this.allowFastJobs = allowFastJobs === true;
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS econ_accounts (
        user_id TEXT PRIMARY KEY, limit_yen INTEGER NOT NULL DEFAULT 10000 CHECK(limit_yen BETWEEN 0 AND 50000),
        jobs_completed INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS econ_ledger (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES econ_accounts(user_id),
        currency TEXT NOT NULL CHECK(currency IN ('G','S')), amount INTEGER NOT NULL CHECK(amount != 0),
        balance_after INTEGER NOT NULL, kind TEXT NOT NULL, reference TEXT NOT NULL, created_at INTEGER NOT NULL,
        UNIQUE(user_id,currency,kind,reference)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS econ_ledger_user ON econ_ledger(user_id,created_at);
      CREATE TRIGGER IF NOT EXISTS econ_ledger_no_update BEFORE UPDATE ON econ_ledger
        BEGIN SELECT RAISE(ABORT,'econ_ledger is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS econ_ledger_no_delete BEFORE DELETE ON econ_ledger
        BEGIN SELECT RAISE(ABORT,'econ_ledger is append-only'); END;
      CREATE TABLE IF NOT EXISTS econ_purchases (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES econ_accounts(user_id), pack_id TEXT NOT NULL,
        yen INTEGER NOT NULL CHECK(yen > 0), coins INTEGER NOT NULL CHECK(coins > 0),
        status TEXT NOT NULL CHECK(status IN ('pending','paid','expired')), session_id TEXT UNIQUE,
        payment_intent TEXT UNIQUE, created_at INTEGER NOT NULL, month TEXT NOT NULL, paid_at INTEGER,
        refunded_yen INTEGER NOT NULL DEFAULT 0, disputed_yen INTEGER NOT NULL DEFAULT 0,
        dispute_status TEXT NOT NULL DEFAULT 'none' CHECK(dispute_status IN ('none','open','won','lost')),
        hold_coins INTEGER NOT NULL DEFAULT 0
      ) STRICT;
      CREATE INDEX IF NOT EXISTS econ_purchases_month ON econ_purchases(user_id,month,status);
      CREATE TABLE IF NOT EXISTS econ_payment_events (
        event_id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, purchase_id TEXT NOT NULL
          REFERENCES econ_purchases(id), created_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS econ_receipts (
        user_id TEXT NOT NULL REFERENCES econ_accounts(user_id), receipt_key TEXT NOT NULL, action TEXT NOT NULL,
        payload TEXT NOT NULL, result TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(user_id,receipt_key)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS econ_affection (
        user_id TEXT NOT NULL REFERENCES econ_accounts(user_id), cast_id TEXT NOT NULL,
        spend_points INTEGER NOT NULL DEFAULT 0 CHECK(spend_points BETWEEN 0 AND 40),
        visit_points INTEGER NOT NULL DEFAULT 0 CHECK(visit_points BETWEEN 0 AND 20),
        conversation_points INTEGER NOT NULL DEFAULT 0 CHECK(conversation_points BETWEEN 0 AND 30),
        event_points INTEGER NOT NULL DEFAULT 0 CHECK(event_points BETWEEN 0 AND 30),
        visits INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id,cast_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS econ_visits (
        user_id TEXT NOT NULL REFERENCES econ_accounts(user_id), cast_id TEXT NOT NULL, day TEXT NOT NULL,
        created_at INTEGER NOT NULL, PRIMARY KEY(user_id,cast_id,day)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS econ_conversations (
        user_id TEXT NOT NULL REFERENCES econ_accounts(user_id), cast_id TEXT NOT NULL, topic_id TEXT NOT NULL,
        day TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(user_id,cast_id,topic_id,day)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS econ_story_completions (
        user_id TEXT NOT NULL REFERENCES econ_accounts(user_id), cast_id TEXT NOT NULL, event_id TEXT NOT NULL,
        created_at INTEGER NOT NULL, PRIMARY KEY(user_id,cast_id,event_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS econ_orders (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES econ_accounts(user_id), item_id TEXT NOT NULL,
        cast_id TEXT NOT NULL, currency TEXT NOT NULL CHECK(currency IN ('G','S')),
        amount INTEGER NOT NULL CHECK(amount > 0), item_name TEXT NOT NULL, reaction TEXT NOT NULL,
        benefits TEXT NOT NULL, created_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS econ_album (
        id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE REFERENCES econ_orders(id),
        user_id TEXT NOT NULL REFERENCES econ_accounts(user_id), cast_id TEXT NOT NULL, item_id TEXT NOT NULL,
        title TEXT NOT NULL, reaction TEXT NOT NULL, benefits TEXT NOT NULL, created_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS econ_jobs (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES econ_accounts(user_id), difficulty TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('active','complete')), started_at INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL, last_action_at INTEGER, actions INTEGER NOT NULL DEFAULT 0,
        correct_actions INTEGER NOT NULL DEFAULT 0, challenges TEXT NOT NULL, completed_at INTEGER, reward INTEGER
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS econ_one_active_job ON econ_jobs(user_id) WHERE status='active';
    `);
  }

  _now() {
    const timestamp = this.clock();
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new TypeError('clock must return an integer Unix millisecond timestamp');
    return timestamp;
  }

  _tx(action) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  _ensure(userId) {
    identity(userId, 'ユーザーID');
    this.db.prepare('INSERT OR IGNORE INTO econ_accounts(user_id,created_at) VALUES (?,?)').run(userId, this._now());
    const insert = this.db.prepare('INSERT OR IGNORE INTO econ_affection(user_id,cast_id) VALUES (?,?)');
    for (const cast of CASTS) insert.run(userId, cast.id);
  }

  ensureAccount(userId) {
    return this._tx(() => {
      this._ensure(userId);
      const account = this.db.prepare('SELECT * FROM econ_accounts WHERE user_id=?').get(userId);
      return { userId, createdAt: account.created_at, monthlyLimitYen: account.limit_yen, wallet: this._wallet(userId) };
    });
  }

  _wallet(userId) {
    const rows = this.db.prepare('SELECT currency,COALESCE(SUM(amount),0) AS balance FROM econ_ledger WHERE user_id=? GROUP BY currency').all(userId);
    const wallet = { G: 0, S: 0, debtS: 0 };
    for (const row of rows) wallet[row.currency] = row.balance;
    wallet.debtS = Math.max(0, -wallet.S);
    return wallet;
  }

  _writeLedger(userId, currency, amount, kind, reference) {
    if (amount === 0) return;
    integer(amount, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, '台帳金額');
    const balance = this._wallet(userId)[currency] + amount;
    if (!Number.isSafeInteger(balance)) fail(409, 'balance_overflow', '残高の上限を超えています。');
    if (currency === 'G' && balance < 0) fail(409, 'insufficient_funds', 'Gが不足しています。');
    this.db.prepare('INSERT INTO econ_ledger(id,user_id,currency,amount,balance_after,kind,reference,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(randomUUID(), userId, currency, amount, balance, kind, reference, this._now());
  }

  _monthly(userId) {
    const month = jstMonth(this._now());
    const account = this.db.prepare('SELECT limit_yen FROM econ_accounts WHERE user_id=?').get(userId);
    const amounts = this.db.prepare(`SELECT COALESCE(SUM(CASE WHEN status='paid' THEN yen ELSE 0 END),0) AS paid,
      COALESCE(SUM(CASE WHEN status='pending' THEN yen ELSE 0 END),0) AS reserved
      FROM econ_purchases WHERE user_id=? AND month=?`).get(userId, month);
    return { month, limitYen: account.limit_yen, paidYen: amounts.paid, reservedYen: amounts.reserved };
  }

  _receipt(userId, key, action, payload, perform) {
    identity(key, '再送防止キー');
    const encoded = fingerprint(payload);
    const existing = this.db.prepare('SELECT * FROM econ_receipts WHERE user_id=? AND receipt_key=?').get(userId, key);
    if (existing) {
      if (existing.action !== action || existing.payload !== encoded) fail(409, 'idempotency_conflict', '同じ再送防止キーを別の操作には使用できません。');
      return JSON.parse(existing.result);
    }
    const result = perform();
    this.db.prepare('INSERT INTO econ_receipts(user_id,receipt_key,action,payload,result,created_at) VALUES (?,?,?,?,?,?)')
      .run(userId, key, action, encoded, JSON.stringify(result), this._now());
    return result;
  }

  setLimit(userId, yen) {
    integer(yen, 0, 50000, '月間支出上限');
    return this._tx(() => {
      this._ensure(userId);
      this.db.prepare('UPDATE econ_accounts SET limit_yen=? WHERE user_id=?').run(yen, userId);
      return this._monthly(userId);
    });
  }

  _purchase(row) {
    return {
      id: row.id, userId: row.user_id, packId: row.pack_id, yen: row.yen, coins: row.coins,
      status: row.status, sessionId: row.session_id, paymentIntent: row.payment_intent,
      createdAt: row.created_at, month: row.month, paidAt: row.paid_at,
      refundedYen: row.refunded_yen, disputedYen: row.disputed_yen, disputeStatus: row.dispute_status,
      heldS: row.hold_coins,
    };
  }

  _purchaseRow(id) {
    identity(id, '購入ID');
    const row = this.db.prepare('SELECT * FROM econ_purchases WHERE id=?').get(id);
    if (!row) fail(404, 'purchase_not_found', '購入が見つかりません。');
    return row;
  }

  reservePurchase(userId, packId, key) {
    const pack = PACKS.find(candidate => candidate.id === packId);
    if (!pack) fail(404, 'pack_not_found', '販売商品が見つかりません。');
    return this._tx(() => {
      this._ensure(userId);
      const result = this._receipt(userId, key, 'reservePurchase', { packId }, () => {
        if (this._wallet(userId).debtS > 0) fail(409, 'paid_currency_frozen', '返金・異議申立てによるS残高の不足を解消するまで、Sの購入と利用は停止しています。Gでの無料プレイは継続できます。');
        const monthly = this._monthly(userId);
        integer(pack.yen, 1, 50000, '販売価格');
        integer(pack.coins, 1, 1000000, '販売通貨量');
        if (monthly.paidYen + monthly.reservedYen + pack.yen > monthly.limitYen) fail(409, 'monthly_limit', '月間支出上限を超えています。決済待ちの購入も上限に含まれます。');
        const id = randomUUID();
        this.db.prepare('INSERT INTO econ_purchases(id,user_id,pack_id,yen,coins,status,created_at,month) VALUES (?,?,?,?,?,?,?,?)')
          .run(id, userId, pack.id, pack.yen, pack.coins, 'pending', this._now(), monthly.month);
        return { id };
      });
      return this._purchase(this._purchaseRow(result.id));
    });
  }

  bindCheckout(purchaseId, sessionId) {
    identity(sessionId, '決済セッションID');
    return this._tx(() => {
      const row = this._purchaseRow(purchaseId);
      if (row.session_id === sessionId) return this._purchase(row);
      if (row.session_id || row.status !== 'pending') fail(409, 'checkout_conflict', '購入に別の決済セッションが登録されています。');
      const linked = this.db.prepare('SELECT id FROM econ_purchases WHERE session_id=?').get(sessionId);
      if (linked) fail(409, 'checkout_conflict', 'この決済セッションは別の購入に登録されています。');
      this.db.prepare('UPDATE econ_purchases SET session_id=? WHERE id=?').run(sessionId, purchaseId);
      return this._purchase(this._purchaseRow(purchaseId));
    });
  }

  purchase(userId, id) {
    identity(userId, 'ユーザーID');
    const row = this._purchaseRow(id);
    if (row.user_id !== userId) fail(404, 'purchase_not_found', '購入が見つかりません。');
    return this._purchase(row);
  }

  pendingPurchases(userId) {
    identity(userId, 'ユーザーID');
    return this.db.prepare("SELECT * FROM econ_purchases WHERE user_id=? AND status='pending' ORDER BY created_at,id").all(userId).map(row => this._purchase(row));
  }

  pendingAllPurchases() {
    return this.db.prepare("SELECT * FROM econ_purchases WHERE status='pending' ORDER BY created_at,id").all().map(row => this._purchase(row));
  }

  purchaseForPaymentIntent(paymentIntentId) {
    identity(paymentIntentId, '決済ID');
    const row = this.db.prepare('SELECT * FROM econ_purchases WHERE payment_intent=?').get(paymentIntentId);
    return row ? this._purchase(row) : null;
  }

  purchaseById(id) {
    identity(id, '購入ID');
    const row = this.db.prepare('SELECT * FROM econ_purchases WHERE id=?').get(id);
    return row ? this._purchase(row) : null;
  }

  paidPurchases() {
    return this.db.prepare("SELECT * FROM econ_purchases WHERE status='paid' ORDER BY created_at,id").all().map(row => this._purchase(row));
  }

  /** Server recovery only: callers must have a conclusive provider rejection or
   * verified absence of a session. Browser cancellation must never invoke this.
   */
  closeUnboundPurchase(purchaseId, reason) {
    identity(reason, '予約終了理由');
    return this._tx(() => {
      const row = this._purchaseRow(purchaseId);
      if (row.session_id || row.status === 'paid') fail(409, 'checkout_bound', '決済セッションが存在する購入の予約は、この操作では解除できません。');
      if (row.status === 'expired') return this._paymentResult(row, true);
      this._event(`server-unbound-close-${row.id}`, 'unbound_closed', row.id, { reason });
      this.db.prepare("UPDATE econ_purchases SET status='expired' WHERE id=?").run(row.id);
      return this._paymentResult(row, false);
    });
  }

  _verifyCheckout(session, paid) {
    if (!session || typeof session !== 'object') fail(400, 'invalid_checkout', '決済セッションが不正です。');
    if (session.livemode !== false) fail(403, 'live_payment_disabled', '本番決済は有効化されていません。');
    const row = this._purchaseRow(session.client_reference_id);
    const metadata = session.metadata;
    if (row.session_id !== session.id || !metadata || metadata.purchaseId !== row.id || metadata.userId !== row.user_id || metadata.packId !== row.pack_id ||
        session.currency !== 'jpy' || session.amount_total !== row.yen) {
      fail(400, 'checkout_mismatch', '決済内容と予約された購入内容が一致しません。');
    }
    if (paid) {
      if (session.status !== 'complete' || session.payment_status !== 'paid' || typeof session.payment_intent !== 'string' || !session.payment_intent.startsWith('pi_')) {
        fail(400, 'payment_not_paid', '決済成功が確認できません。');
      }
      if (row.payment_intent && row.payment_intent !== session.payment_intent) fail(409, 'payment_identity_conflict', '決済IDが以前の検証結果と一致しません。');
    } else if (session.status !== 'expired' || session.payment_status === 'paid') {
      fail(400, 'checkout_not_expired', '決済事業者による期限切れが確認できません。');
    }
    return row;
  }

  _event(eventId, kind, purchaseId, payload) {
    identity(eventId, '決済イベントID');
    const encoded = fingerprint(payload);
    const prior = this.db.prepare('SELECT * FROM econ_payment_events WHERE event_id=?').get(eventId);
    if (prior) {
      if (prior.kind !== kind || prior.purchase_id !== purchaseId || prior.payload !== encoded) fail(409, 'event_conflict', '同じ決済イベントIDの内容が一致しません。');
      return false;
    }
    this.db.prepare('INSERT INTO econ_payment_events(event_id,kind,payload,purchase_id,created_at) VALUES (?,?,?,?,?)')
      .run(eventId, kind, encoded, purchaseId, this._now());
    return true;
  }

  _paymentResult(row, duplicate) {
    return { handled: true, duplicate, purchase: this._purchase(this._purchaseRow(row.id)), wallet: this._wallet(row.user_id) };
  }

  checkoutPaid(eventId, verifiedSession) {
    return this._tx(() => {
      const row = this._verifyCheckout(verifiedSession, true);
      const fresh = this._event(eventId, 'paid', row.id, { sessionId: verifiedSession.id, paymentIntent: verifiedSession.payment_intent, yen: verifiedSession.amount_total });
      if (!fresh || row.status === 'paid') return this._paymentResult(row, true);
      const linked = this.db.prepare('SELECT id FROM econ_purchases WHERE payment_intent=?').get(verifiedSession.payment_intent);
      if (linked && linked.id !== row.id) fail(409, 'payment_identity_conflict', 'この決済IDは別の購入に登録されています。');
      // Verified money received must be credited even if an older expiry notification arrived first.
      this.db.prepare("UPDATE econ_purchases SET status='paid',payment_intent=?,paid_at=? WHERE id=?")
        .run(verifiedSession.payment_intent, this._now(), row.id);
      this._writeLedger(row.user_id, 'S', row.coins, 'purchase', row.id);
      return this._paymentResult(row, false);
    });
  }

  checkoutClosed(eventId, verifiedSession) {
    return this._tx(() => {
      const row = this._verifyCheckout(verifiedSession, false);
      const fresh = this._event(eventId, 'expired', row.id, { sessionId: verifiedSession.id, yen: verifiedSession.amount_total });
      if (fresh && row.status === 'pending') this.db.prepare("UPDATE econ_purchases SET status='expired' WHERE id=?").run(row.id);
      return this._paymentResult(row, !fresh || row.status !== 'pending');
    });
  }

  adjustPayment(eventId, purchaseId, adjustment) {
    if (!adjustment || typeof adjustment !== 'object') fail(400, 'invalid_adjustment', '決済調整内容が不正です。');
    const permitted = ['refundedYen', 'disputedYen', 'disputeStatus'];
    if (Object.keys(adjustment).some(key => !permitted.includes(key))) fail(400, 'invalid_adjustment', '決済調整内容が不正です。');
    return this._tx(() => {
      const row = this._purchaseRow(purchaseId);
      if (row.status !== 'paid') fail(409, 'purchase_not_paid', '決済完了前の購入は返金・異議申立て調整できません。');
      const refundedInput = adjustment.refundedYen ?? row.refunded_yen;
      const disputedInput = adjustment.disputedYen ?? row.disputed_yen;
      const disputeStatus = adjustment.disputeStatus ?? row.dispute_status;
      integer(refundedInput, 0, row.yen, '累計返金額');
      integer(disputedInput, 0, row.yen, '異議申立て額');
      if (!['none', 'open', 'won', 'lost'].includes(disputeStatus)) fail(400, 'invalid_dispute_status', '異議申立て状態が不正です。');
      if (!this._event(eventId, 'adjustment', row.id, adjustment)) return this._paymentResult(row, true);
      const refundedYen = Math.max(row.refunded_yen, refundedInput);
      // Refund events do not erase an existing dispute, and stale notifications
      // cannot reopen a won dispute or release a lost dispute without a win.
      let effectiveStatus = disputeStatus;
      if (disputeStatus === 'none' && row.dispute_status !== 'none') effectiveStatus = row.dispute_status;
      if (row.dispute_status === 'won') effectiveStatus = 'won';
      if (row.dispute_status === 'lost' && disputeStatus !== 'won') effectiveStatus = 'lost';
      const disputedYen = Math.max(row.disputed_yen, disputedInput);
      const activeDisputeYen = effectiveStatus === 'open' || effectiveStatus === 'lost' ? disputedYen : 0;
      const holdYen = Math.max(refundedYen, activeDisputeYen);
      const holdCoins = Math.ceil(row.coins * holdYen / row.yen);
      this._writeLedger(row.user_id, 'S', row.hold_coins - holdCoins, 'payment_adjustment', eventId);
      this.db.prepare('UPDATE econ_purchases SET refunded_yen=?,disputed_yen=?,dispute_status=?,hold_coins=? WHERE id=?')
        .run(refundedYen, disputedYen, effectiveStatus, holdCoins, row.id);
      return this._paymentResult(row, false);
    });
  }

  /** A complete, freshly retrieved provider snapshot. Server-only; no browser route.
   * Unlike historical notifications, successful refund totals may decrease after
   * a bank reverses a refund. Multiple disputes are aggregated by the server.
   */
  reconcilePayment(purchaseId, snapshot) {
    return this._tx(() => {
      const row = this._purchaseRow(purchaseId);
      if (row.status !== 'paid') fail(409, 'purchase_not_paid', '決済完了前の購入を調整できません。');
      integer(snapshot.refundedYen, 0, row.yen, '現在の確定返金額');
      integer(snapshot.disputedYen, 0, row.yen, '現在の異議申立て額');
      if (!['none','open','won','lost'].includes(snapshot.disputeStatus)) fail(400,'invalid_dispute_status','異議申立て状態が不正です。');
      if (row.refunded_yen === snapshot.refundedYen && row.disputed_yen === snapshot.disputedYen && row.dispute_status === snapshot.disputeStatus) return this._paymentResult(row,true);
      const active = ['open','lost'].includes(snapshot.disputeStatus) ? snapshot.disputedYen : 0;
      const holdCoins = Math.ceil(row.coins * Math.max(snapshot.refundedYen, active) / row.yen);
      const eventId = `provider-snapshot-${randomUUID()}`;
      this._event(eventId,'snapshot',purchaseId,snapshot);
      this._writeLedger(row.user_id,'S',row.hold_coins-holdCoins,'payment_adjustment',eventId);
      this.db.prepare('UPDATE econ_purchases SET refunded_yen=?,disputed_yen=?,dispute_status=?,hold_coins=? WHERE id=?')
        .run(snapshot.refundedYen,snapshot.disputedYen,snapshot.disputeStatus,holdCoins,row.id);
      return this._paymentResult(row,false);
    });
  }

  _cast(castId) {
    const cast = CASTS.find(candidate => candidate.id === castId);
    if (!cast) fail(404, 'cast_not_found', 'キャストが見つかりません。');
    return cast;
  }

  _affection(userId, castId) {
    const row = this.db.prepare('SELECT * FROM econ_affection WHERE user_id=? AND cast_id=?').get(userId, castId);
    const relationshipPoints = Math.min(60, row.visit_points + row.conversation_points + row.event_points);
    const score = Math.min(100, row.spend_points + relationshipPoints);
    const level = levelOf(score);
    const completedEvents = this.db.prepare('SELECT event_id FROM econ_story_completions WHERE user_id=? AND cast_id=?').all(userId, castId).map(event => event.event_id);
    return {
      castId, score, value: score, level, label: LEVEL_NAMES[level - 1], spendPoints: row.spend_points,
      relationshipPoints, visitPoints: row.visit_points, conversationPoints: row.conversation_points,
      eventPoints: row.event_points, visits: row.visits, completedEvents,
      unlockedEvents: STORY_EVENTS.filter(event => level >= event.minLevel).map(event => event.id),
    };
  }

  _order(row) {
    return {
      id: row.id, itemId: row.item_id, name: row.item_name, castId: row.cast_id, currency: row.currency,
      amount: row.amount, reaction: JSON.parse(row.reaction), benefits: JSON.parse(row.benefits), createdAt: row.created_at,
    };
  }

  _albumEntry(row) {
    return {
      id: row.id, orderId: row.order_id, castId: row.cast_id, itemId: row.item_id, title: row.title,
      reaction: JSON.parse(row.reaction), benefits: JSON.parse(row.benefits), createdAt: row.created_at,
    };
  }

  order(userId, { itemId, castId, currency, key } = {}) {
    const item = ITEMS.find(candidate => candidate.id === itemId);
    if (!item) fail(404, 'item_not_found', 'メニューが見つかりません。');
    this._cast(castId);
    if (!['G', 'S'].includes(currency)) fail(400, 'currency_required', '支払う通貨GまたはSを明示的に選択してください。');
    const price = currency === 'G' ? item.priceG : item.priceS;
    if (!Number.isSafeInteger(price) || price <= 0) fail(400, 'currency_unavailable', 'この商品では選択した通貨を利用できません。');
    return this._tx(() => {
      this._ensure(userId);
      return this._receipt(userId, key, 'order', { itemId, castId, currency }, () => {
        const wallet = this._wallet(userId);
        if (currency === 'S' && wallet.debtS > 0) fail(409, 'paid_currency_frozen', 'S残高の不足を解消するまでSでの注文は停止しています。Gは引き続き利用できます。');
        if (wallet[currency] < price) fail(409, 'insufficient_funds', `${currency}が不足しています。`);
        const id = randomUUID();
        const reaction = JSON.stringify(item.reaction ?? 'drink');
        const benefits = JSON.stringify(item.benefits ?? []);
        const now = this._now();
        this.db.prepare('INSERT INTO econ_orders(id,user_id,item_id,cast_id,currency,amount,item_name,reaction,benefits,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
          .run(id, userId, itemId, castId, currency, price, item.name, reaction, benefits, now);
        this._writeLedger(userId, currency, -price, 'order', id);
        integer(item.affection ?? 0, 0, 40, '好意ポイント');
        this.db.prepare('UPDATE econ_affection SET spend_points=MIN(40,spend_points+?) WHERE user_id=? AND cast_id=?')
          .run(item.affection ?? 0, userId, castId);
        let albumEntry = null;
        if (item.album === true || item.premium || /champagne|premium/i.test(String(item.reaction))) {
          const albumId = randomUUID();
          this.db.prepare('INSERT INTO econ_album(id,order_id,user_id,cast_id,item_id,title,reaction,benefits,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
            .run(albumId, id, userId, castId, itemId, `${item.name}の記念`, reaction, benefits, now);
          albumEntry = this._albumEntry(this.db.prepare('SELECT * FROM econ_album WHERE id=?').get(albumId));
        }
        return {
          ...this._order(this.db.prepare('SELECT * FROM econ_orders WHERE id=?').get(id)),
          affection: this._affection(userId, castId), albumEntry, wallet: this._wallet(userId),
        };
      });
    });
  }

  visit(userId, castId, key) {
    this._cast(castId);
    return this._tx(() => {
      this._ensure(userId);
      return this._receipt(userId, key, 'visit', { castId }, () => {
        const result = this.db.prepare('INSERT OR IGNORE INTO econ_visits(user_id,cast_id,day,created_at) VALUES (?,?,?,?)')
          .run(userId, castId, jstDay(this._now()), this._now());
        const credited = result.changes > 0;
        if (credited) this.db.prepare('UPDATE econ_affection SET visit_points=MIN(20,visit_points+2),visits=visits+1 WHERE user_id=? AND cast_id=?').run(userId, castId);
        return { credited, affection: this._affection(userId, castId) };
      });
    });
  }

  conversation(userId, castId, topicId, key) {
    this._cast(castId);
    if (!TOPICS.some(topic => topic.id === topicId)) fail(404, 'topic_not_found', '会話テーマが見つかりません。');
    return this._tx(() => {
      this._ensure(userId);
      return this._receipt(userId, key, 'conversation', { castId, topicId }, () => {
        const result = this.db.prepare('INSERT OR IGNORE INTO econ_conversations(user_id,cast_id,topic_id,day,created_at) VALUES (?,?,?,?,?)')
          .run(userId, castId, topicId, jstDay(this._now()), this._now());
        const credited = result.changes > 0;
        if (credited) this.db.prepare('UPDATE econ_affection SET conversation_points=MIN(30,conversation_points+2) WHERE user_id=? AND cast_id=?').run(userId, castId);
        return { credited, topicId, affection: this._affection(userId, castId) };
      });
    });
  }

  completeEvent(userId, castId, eventId, key) {
    this._cast(castId);
    const event = STORY_EVENTS.find(candidate => candidate.id === eventId);
    if (!event) fail(404, 'event_not_found', 'ストーリーイベントが見つかりません。');
    return this._tx(() => {
      this._ensure(userId);
      return this._receipt(userId, key, 'completeEvent', { castId, eventId }, () => {
        if (this._affection(userId, castId).level < event.minLevel) fail(409, 'story_locked', 'このエピソードは関係性が進展すると解放されます。');
        const result = this.db.prepare('INSERT OR IGNORE INTO econ_story_completions(user_id,cast_id,event_id,created_at) VALUES (?,?,?,?)').run(userId, castId, eventId, this._now());
        const credited = result.changes > 0;
        if (credited) this.db.prepare('UPDATE econ_affection SET event_points=MIN(30,event_points+10) WHERE user_id=? AND cast_id=?').run(userId, castId);
        return { credited, event: { id: event.id, title: event.title }, affection: this._affection(userId, castId) };
      });
    });
  }

  _jobRow(userId, jobId) {
    identity(jobId, '仕事ID');
    const row = this.db.prepare('SELECT * FROM econ_jobs WHERE id=? AND user_id=?').get(jobId, userId);
    if (!row) fail(404, 'job_not_found', '仕事が見つかりません。');
    return row;
  }

  _job(row) {
    const challenges = JSON.parse(row.challenges);
    const challenge = row.status === 'active' ? challenges[row.actions] : null;
    const remainingMs = Math.max(0, row.started_at + row.duration_ms - this._now());
    return {
      id: row.id, difficulty: row.difficulty, difficultyLabel: DIFFICULTIES[row.difficulty].label,
      status: row.status, startedAt: row.started_at, endsAt: row.started_at + row.duration_ms,
      durationMs: row.duration_ms, durationSeconds: row.duration_ms / 1000, remainingMs,
      minActions: 8, maxActions: challenges.length, actions: row.actions, correctActions: row.correct_actions,
      challenge: challenge ? { id: challenge.id, prompt: challenge.prompt, options: BIN_OPTIONS } : null,
      canFinish: row.status === 'active' && remainingMs === 0 && row.actions >= 8,
      completedAt: row.completed_at, reward: row.reward, baseReward: DIFFICULTIES[row.difficulty].base,
    };
  }

  startJob(userId, { difficulty = 'easy', key } = {}) {
    if (!Object.hasOwn(DIFFICULTIES, difficulty)) fail(400, 'invalid_difficulty', '仕事の難易度が不正です。');
    return this._tx(() => {
      this._ensure(userId);
      const receipt = this._receipt(userId, key, 'startJob', { difficulty }, () => {
        if (this.db.prepare("SELECT id FROM econ_jobs WHERE user_id=? AND status='active'").get(userId)) fail(409, 'job_active', '進行中の仕事があります。');
        const challenges = Array.from({ length: 12 }, () => {
          const item = SORT_ITEMS[randomInt(SORT_ITEMS.length)];
          return { id: randomUUID(), prompt: `${item.name}の置き場所を選んでください。`, expected: item.bin };
        });
        const id = randomUUID();
        this.db.prepare('INSERT INTO econ_jobs(id,user_id,difficulty,status,started_at,duration_ms,challenges) VALUES (?,?,?,?,?,?,?)')
          .run(id, userId, difficulty, 'active', this._now(), this.allowFastJobs ? 1000 : DIFFICULTIES[difficulty].seconds * 1000, JSON.stringify(challenges));
        return { id };
      });
      return this._job(this._jobRow(userId, receipt.id));
    });
  }

  jobAction(userId, jobId, answer, key) {
    identity(userId, 'ユーザーID');
    let choice = answer;
    let challengeId = null;
    if (answer && typeof answer === 'object' && !Array.isArray(answer)) {
      challengeId = answer.challengeId;
      choice = answer.choiceId ?? answer.choice ?? answer.optionId;
      identity(challengeId, '課題ID');
    }
    if (!BIN_OPTIONS.some(option => option.id === choice)) fail(400, 'invalid_answer', '仕事の回答が不正です。');
    return this._tx(() => {
      this._ensure(userId);
      return this._receipt(userId, key, 'jobAction', { jobId, answer }, () => {
        const row = this._jobRow(userId, jobId);
        if (row.status !== 'active') fail(409, 'job_complete', 'この仕事は完了しています。');
        const challenges = JSON.parse(row.challenges);
        const current = challenges[row.actions];
        if (!current) fail(409, 'job_actions_complete', 'すべての仕事課題を提出済みです。');
        if (challengeId && challengeId !== current.id) fail(409, 'challenge_changed', '課題が更新されています。最新の課題を取得してください。');
        const now = this._now();
        if (!this.allowFastJobs && row.last_action_at !== null && now - row.last_action_at < 1000) fail(429, 'job_too_fast', '次の仕事課題まで少しお待ちください。');
        const correct = choice === current.expected;
        this.db.prepare('UPDATE econ_jobs SET actions=actions+1,correct_actions=correct_actions+?,last_action_at=? WHERE id=?')
          .run(correct ? 1 : 0, now, row.id);
        return { correct, feedback: correct ? '正しい置き場所です。' : '次の課題で挑戦しましょう。', job: this._job(this._jobRow(userId, jobId)) };
      });
    });
  }

  finishJob(userId, jobId, key) {
    return this._tx(() => {
      this._ensure(userId);
      return this._receipt(userId, key, 'finishJob', { jobId }, () => {
        const row = this._jobRow(userId, jobId);
        if (row.status === 'complete') return { job: this._job(row), reward: row.reward, wallet: this._wallet(userId), duplicate: true };
        const now = this._now();
        if (now < row.started_at + row.duration_ms) fail(409, 'job_too_early', '仕事の終了時刻に達していません。');
        if (row.actions < 8) fail(409, 'job_actions_required', '報酬を受け取るには8問以上の仕事課題を提出してください。');
        const account = this.db.prepare('SELECT jobs_completed FROM econ_accounts WHERE user_id=?').get(userId);
        const accuracy = row.correct_actions / row.actions;
        const skillMultiplier = 1 + Math.min(0.5, account.jobs_completed * 0.02);
        const reward = Math.floor(DIFFICULTIES[row.difficulty].base * (0.7 + 0.3 * accuracy) * skillMultiplier);
        this.db.prepare("UPDATE econ_jobs SET status='complete',completed_at=?,reward=? WHERE id=?").run(now, reward, row.id);
        this.db.prepare('UPDATE econ_accounts SET jobs_completed=jobs_completed+1 WHERE user_id=?').run(userId);
        this._writeLedger(userId, 'G', reward, 'job', row.id);
        return { job: this._job(this._jobRow(userId, jobId)), reward, wallet: this._wallet(userId), duplicate: false };
      });
    });
  }

  state(userId) {
    return this._tx(() => {
      this._ensure(userId);
      const account = this.db.prepare('SELECT jobs_completed FROM econ_accounts WHERE user_id=?').get(userId);
      return {
        userId, wallet: this._wallet(userId), monthly: this._monthly(userId),
        affection: CASTS.map(cast => this._affection(userId, cast.id)),
        ledger: this.db.prepare('SELECT * FROM econ_ledger WHERE user_id=? ORDER BY created_at DESC,rowid DESC').all(userId).map(row => ({
          id: row.id, currency: row.currency, amount: row.amount, balanceAfter: row.balance_after, kind: row.kind, reference: row.reference, createdAt: row.created_at,
        })),
        purchases: this.db.prepare('SELECT * FROM econ_purchases WHERE user_id=? ORDER BY created_at DESC,rowid DESC').all(userId).map(row => this._purchase(row)),
        orders: this.db.prepare('SELECT * FROM econ_orders WHERE user_id=? ORDER BY created_at DESC,rowid DESC').all(userId).map(row => this._order(row)),
        album: this.db.prepare('SELECT * FROM econ_album WHERE user_id=? ORDER BY created_at DESC,rowid DESC').all(userId).map(row => this._albumEntry(row)),
        jobs: this.db.prepare('SELECT * FROM econ_jobs WHERE user_id=? ORDER BY started_at DESC,rowid DESC').all(userId).map(row => this._job(row)),
        jobsCompleted: account.jobs_completed, serverTime: this._now(),
      };
    });
  }

  close() { this.db.close(); }
}
