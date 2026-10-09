import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Economy, DomainError } from '../src/economy.mjs';
import { PACKS, ITEMS, CASTS, TOPICS, STORY_EVENTS } from '../src/catalog.mjs';

const USER = 'economy-test-user';
const OTHER = 'other-test-user';
const CAST = CASTS[0].id;
const OTHER_CAST = CASTS[1].id;
let sequence = 0;
const key = label => `${label}-${++sequence}`;
const code = (action, expected) => assert.throws(action, error => error instanceof DomainError && error.code === expected);
const fixture = (t, options = {}) => {
  let now = Date.parse('2026-10-09T00:00:00.000Z');
  const economy = new Economy(':memory:', { clock: () => now, allowFastJobs: true, ...options });
  t.after(() => economy.close());
  return { economy, advance: amount => { now += amount; }, set: amount => { now = amount; }, now: () => now };
};
const reserve = (economy, user = USER, packId = PACKS[0].id) => {
  const purchase = economy.reservePurchase(user, packId, key('reserve'));
  const sessionId = `cs_test_${key('session')}`;
  const bound = economy.bindCheckout(purchase.id, sessionId);
  const session = {
    id: sessionId, client_reference_id: purchase.id, currency: 'jpy', amount_total: purchase.yen,
    payment_status: 'paid', status: 'complete', livemode: false, payment_intent: `pi_${key('payment')}`,
    metadata: { purchaseId: purchase.id, userId: user, packId }, created: Math.floor(purchase.createdAt / 1000),
  };
  return { purchase: bound, session };
};
const fund = (economy, user = USER, packId = 's5000') => {
  const pending = reserve(economy, user, packId);
  economy.checkoutPaid(key('evt-paid'), pending.session);
  return pending;
};
const giftFund=(economy,user=USER,amount=5000)=>economy._tx(()=>{economy._ensure(user);economy._writeLedger(user,'G',amount,'fixture_earned_gold',key('gift-fund'));});
const answerFor = challenge => {
  if (/グラス|タンブラー/.test(challenge.prompt)) return 'glass';
  if (/ボトル|ミネラルウォーター/.test(challenge.prompt)) return 'bottle';
  return 'food';
};
const earnJob = (fixtureValue, user = USER, difficulty = 'hard') => {
  const { economy, advance } = fixtureValue;
  let job = economy.startJob(user, { difficulty, key: key('job-start') });
  for (let action = 0; action < 8; action++) {
    job = economy.jobAction(user, job.id, { challengeId: job.challenge.id, choiceId: answerFor(job.challenge) }, key('job-action')).job;
  }
  advance(job.durationMs);
  return economy.finishJob(user, job.id, key('job-finish'));
};

test('accounts begin at zero, maintain separate G/S balances, and isolate history', t => {
  const { economy } = fixture(t);
  assert.deepEqual(economy.ensureAccount(USER).wallet, { G: 0, S: 0, debtS: 0 });
  fund(economy);
  assert.deepEqual(economy.state(USER).wallet, { G: 0, S: 5000, debtS: 0 });
  assert.deepEqual(economy.state(OTHER).wallet, { G: 0, S: 0, debtS: 0 });
  assert.equal(economy.state(OTHER).purchases.length, 0);
  assert.equal(economy.state(USER).affection.length, CASTS.length);
  code(() => economy.purchase(OTHER, economy.state(USER).purchases[0].id), 'purchase_not_found');
});

test('only verified payment credits S, with event and purchase level deduplication', t => {
  const { economy } = fixture(t);
  const { purchase, session } = reserve(economy);
  assert.equal(economy.state(USER).wallet.S, 0);
  const eventId = key('evt');
  assert.equal(economy.checkoutPaid(eventId, session).duplicate, false);
  assert.equal(economy.checkoutPaid(eventId, session).duplicate, true);
  assert.equal(economy.checkoutPaid(key('evt'), session).duplicate, true);
  assert.equal(economy.state(USER).wallet.S, purchase.coins);
  assert.equal(economy.state(USER).ledger.length, 1);
  assert.equal(economy.state(USER).monthly.reservedYen, 0);
  assert.equal(economy.state(USER).monthly.paidYen, purchase.yen);
  assert.equal(economy.purchaseForPaymentIntent(session.payment_intent).id, purchase.id);
});

test('payment validation rejects mismatched identity, price, currency, session, and payment state', t => {
  const { economy } = fixture(t);
  const { session } = reserve(economy);
  const invalid = [
    { ...session, id: 'cs_another' }, { ...session, currency: 'usd' },
    { ...session, amount_total: session.amount_total + 1 },
    { ...session, metadata: { ...session.metadata, userId: OTHER } },
    { ...session, metadata: { ...session.metadata, packId: 's3000' } },
    { ...session, metadata: {} }, { ...session, payment_status: 'unpaid' },
    { ...session, status: 'open' }, { ...session, payment_intent: null },
  ];
  for (const candidate of invalid) assert.throws(() => economy.checkoutPaid(key('evt-bad'), candidate), DomainError);
  assert.equal(economy.state(USER).wallet.S, 0);
  assert.equal(economy.state(USER).purchases[0].status, 'pending');
  assert.equal(economy.db.prepare('SELECT COUNT(*) AS n FROM econ_payment_events').get().n, 0);
});

test('live mode and absent live-mode verification are blocked at the economy boundary', t => {
  const { economy } = fixture(t);
  const { session } = reserve(economy);
  code(() => economy.checkoutPaid(key('live'), { ...session, livemode: true }), 'live_payment_disabled');
  code(() => economy.checkoutPaid(key('missing-live'), { ...session, livemode: undefined }), 'live_payment_disabled');
  assert.equal(economy.state(USER).wallet.S, 0);
});

test('event-ID and payment-intent collisions rollback the whole mutation', t => {
  const { economy } = fixture(t);
  const first = reserve(economy);
  const second = reserve(economy);
  const eventId = key('evt-shared');
  economy.checkoutPaid(eventId, first.session);
  code(() => economy.checkoutPaid(eventId, second.session), 'event_conflict');
  code(() => economy.checkoutPaid(key('same-pi'), { ...second.session, payment_intent: first.session.payment_intent }), 'payment_identity_conflict');
  assert.equal(economy.purchase(USER, second.purchase.id).status, 'pending');
  assert.equal(economy.state(USER).wallet.S, first.purchase.coins);
  assert.equal(economy.db.prepare('SELECT COUNT(*) AS n FROM econ_payment_events').get().n, 1);
});

test('monthly cap includes all pending reservations and paid purchases', t => {
  const { economy } = fixture(t);
  economy.setLimit(USER, 1500);
  const first = reserve(economy);
  reserve(economy);
  reserve(economy);
  code(() => reserve(economy), 'monthly_limit');
  assert.equal(economy.state(USER).monthly.reservedYen, 1500);
  economy.checkoutPaid(key('evt'), first.session);
  assert.deepEqual(economy.state(USER).monthly, { month: '2026-10', limitYen: 1500, paidYen: 500, reservedYen: 1000 });
  code(() => reserve(economy), 'monthly_limit');
  economy.setLimit(USER, 0);
  code(() => reserve(economy), 'monthly_limit');
  for (const invalid of [-1, 50001, 0.5, '500', NaN]) code(() => economy.setLimit(USER, invalid), 'invalid_amount');
});

test('JST month is the initiation month even if settlement happens later', t => {
  const f = fixture(t);
  f.set(Date.parse('2026-10-31T14:59:59.000Z'));
  const { purchase, session } = reserve(f.economy);
  assert.equal(purchase.month, '2026-10');
  f.advance(2000);
  f.economy.checkoutPaid(key('later-paid'), session);
  assert.equal(f.economy.purchase(USER, purchase.id).month, '2026-10');
  assert.deepEqual(f.economy.state(USER).monthly, { month: '2026-11', limitYen: 10000, paidYen: 0, reservedYen: 0 });
});

test('only provider-verified expiry releases a bound reservation', t => {
  const { economy } = fixture(t);
  economy.setLimit(USER, 500);
  const { purchase, session } = reserve(economy);
  code(() => economy.checkoutClosed(key('cancel'), { ...session, status: 'open', payment_status: 'unpaid' }), 'checkout_not_expired');
  assert.equal(economy.state(USER).monthly.reservedYen, 500);
  const expired = { ...session, status: 'expired', payment_status: 'unpaid', payment_intent: null };
  const eventId = key('expired');
  economy.checkoutClosed(eventId, expired);
  assert.equal(economy.checkoutClosed(eventId, expired).duplicate, true);
  assert.equal(economy.purchase(USER, purchase.id).status, 'expired');
  assert.equal(economy.state(USER).monthly.reservedYen, 0);
  assert.equal(economy.state(USER).ledger.length, 0);
  reserve(economy);
});

test('out-of-order expiry does not remove paid credit and verified payment is authoritative', t => {
  const { economy } = fixture(t);
  const one = reserve(economy);
  economy.checkoutPaid(key('paid'), one.session);
  economy.checkoutClosed(key('expired-after-paid'), { ...one.session, status: 'expired', payment_status: 'unpaid' });
  assert.equal(economy.purchase(USER, one.purchase.id).status, 'paid');
  const two = reserve(economy);
  economy.checkoutClosed(key('expired-first'), { ...two.session, status: 'expired', payment_status: 'unpaid' });
  economy.checkoutPaid(key('paid-later'), two.session);
  assert.equal(economy.state(USER).wallet.S, 1000);
});

test('reservation idempotency cannot be reused with a different payload or operation', t => {
  const { economy } = fixture(t);
  const requestKey = key('reservation');
  const one = economy.reservePurchase(USER, 's500', requestKey);
  assert.equal(economy.reservePurchase(USER, 's500', requestKey).id, one.id);
  economy.bindCheckout(one.id, 'cs_test_bound');
  assert.equal(economy.reservePurchase(USER, 's500', requestKey).sessionId, 'cs_test_bound');
  code(() => economy.reservePurchase(USER, 's1500', requestKey), 'idempotency_conflict');
  code(() => economy.visit(USER, CAST, requestKey), 'idempotency_conflict');
  assert.equal(economy.pendingPurchases(USER).length, 1);
  code(() => economy.reservePurchase(USER, 's500', undefined), 'invalid_identifier');
});

test('server recovery closes only unbound unpaid purchases and lookups isolate absent records', t => {
  const { economy } = fixture(t);
  const one = economy.reservePurchase(USER, 's500', key('unbound'));
  assert.equal(economy.pendingAllPurchases().length, 1);
  assert.equal(economy.purchaseById(one.id).id, one.id);
  assert.equal(economy.purchaseById('unknown'), null);
  assert.equal(economy.purchaseForPaymentIntent('pi_unknown'), null);
  economy.closeUnboundPurchase(one.id, 'provider_rejected');
  assert.equal(economy.closeUnboundPurchase(one.id, 'provider_rejected').duplicate, true);
  assert.equal(economy.state(USER).monthly.reservedYen, 0);
  const two = reserve(economy);
  code(() => economy.closeUnboundPurchase(two.purchase.id, 'user_cancelled'), 'checkout_bound');
  economy.checkoutPaid(key('paid'), two.session);
  assert.equal(economy.paidPurchases().length, 1);
  code(() => economy.bindCheckout(two.purchase.id, 'cs_other'), 'checkout_conflict');
});

test('partial refunds are cumulative, monotonic, deduplicated, and leave gross monthly spend intact', t => {
  const { economy } = fixture(t);
  const { purchase } = fund(economy);
  const eventId = key('refund');
  economy.adjustPayment(eventId, purchase.id, { refundedYen: 1000 });
  assert.equal(economy.state(USER).wallet.S, 4000);
  assert.equal(economy.adjustPayment(eventId, purchase.id, { refundedYen: 1000 }).duplicate, true);
  economy.adjustPayment(key('old-refund'), purchase.id, { refundedYen: 500 });
  assert.equal(economy.state(USER).wallet.S, 4000);
  economy.adjustPayment(key('new-refund'), purchase.id, { refundedYen: 2500 });
  assert.equal(economy.state(USER).wallet.S, 2500);
  assert.equal(economy.state(USER).monthly.paidYen, 5000);
  assert.equal(economy.purchase(USER, purchase.id).refundedYen, 2500);
  code(() => economy.adjustPayment(key('too-large'), purchase.id, { refundedYen: 5001 }), 'invalid_amount');
  code(() => economy.adjustPayment(eventId, purchase.id, { refundedYen: 3000 }), 'event_conflict');
});

test('refund and dispute overlap uses the larger hold, with wins restoring only unrefunded S', t => {
  const { economy } = fixture(t);
  const { purchase } = fund(economy);
  economy.adjustPayment(key('refund'), purchase.id, { refundedYen: 1000 });
  economy.adjustPayment(key('dispute-open'), purchase.id, { disputedYen: 3000, disputeStatus: 'open' });
  assert.equal(economy.state(USER).wallet.S, 2000);
  assert.equal(economy.purchase(USER, purchase.id).heldS, 3000);
  economy.adjustPayment(key('refund-overlap'), purchase.id, { refundedYen: 2000 });
  assert.equal(economy.state(USER).wallet.S, 2000);
  economy.adjustPayment(key('dispute-won'), purchase.id, { disputeStatus: 'won' });
  assert.equal(economy.state(USER).wallet.S, 3000);
  assert.equal(economy.purchase(USER, purchase.id).heldS, 2000);
  economy.adjustPayment(key('stale-dispute'), purchase.id, { disputedYen: 5000, disputeStatus: 'open' });
  assert.equal(economy.state(USER).wallet.S, 3000);
});

test('stale none/open dispute updates cannot clear a lost dispute hold', t => {
  const { economy } = fixture(t);
  const { purchase } = fund(economy);
  economy.adjustPayment(key('lost'), purchase.id, { disputedYen: 4000, disputeStatus: 'lost' });
  economy.adjustPayment(key('stale-none'), purchase.id, { disputedYen: 0, disputeStatus: 'none' });
  economy.adjustPayment(key('stale-open'), purchase.id, { disputedYen: 1000, disputeStatus: 'open' });
  assert.equal(economy.state(USER).wallet.S, 1000);
  assert.equal(economy.purchase(USER, purchase.id).disputeStatus, 'lost');
  economy.adjustPayment(key('later-win'), purchase.id, { disputeStatus: 'won' });
  assert.equal(economy.state(USER).wallet.S, 5000);
});

test('spent refunded S becomes debt and freezes only S purchase/use while G and conversations continue', t => {
  const f = fixture(t);
  const { purchase } = fund(f.economy);
  f.economy._tx(()=>f.economy._writeLedger(USER,'S',-4500,'fixture_voice_usage',key('voice-usage')));
  f.economy.adjustPayment(key('full-refund'), purchase.id, { refundedYen: 5000 });
  assert.deepEqual(f.economy.state(USER).wallet, { G: 0, S: -4500, debtS: 4500 });
  code(() => reserve(f.economy), 'paid_currency_frozen');
  code(() => f.economy.order(USER, { itemId: 'drink', castId: CAST, currency: 'S', key: key('order') }), 'currency_unavailable');
  f.economy.conversation(USER, CAST, TOPICS[0].id, key('conversation'));
  for (let i = 0; i < 6; i++) earnJob(f);
  f.economy.order(USER, { itemId: 'drink', castId: CAST, currency: 'G', key: key('free-order') });
  assert.equal(f.economy.state(USER).wallet.debtS, 4500);
  assert.ok(f.economy.state(USER).wallet.G >= 0);
});

test('gifts require G, never use S, and all gifts including premium are available with G', t => {
  const { economy } = fixture(t);
  fund(economy);
  code(() => economy.order(USER, { itemId: 'drink', castId: CAST, key: key('order') }), 'currency_required');
  code(() => economy.order(USER, { itemId: 'drink', castId: CAST, currency: 'G', key: key('order') }), 'insufficient_funds');
  code(() => economy.order(USER, { itemId: 'premium', castId: CAST, currency: 'G', key: key('order') }), 'insufficient_funds');
  code(() => economy.order(USER, { itemId: 'drink', castId: CAST, currency: 'S', key: key('order') }), 'currency_unavailable');
  assert.equal(economy.state(USER).wallet.S, 5000);
  assert.equal(economy.state(USER).orders.length, 0);
});

test('order retries are atomic and reject payload changes while preserving original reactions', t => {
  const { economy } = fixture(t);
  fund(economy);
  giftFund(economy);
  const request = { itemId: 'drink', castId: CAST, currency: 'G', key: key('order') };
  const first = economy.order(USER, request);
  assert.deepEqual(economy.order(USER, request), first);
  code(() => economy.order(USER, { ...request, castId: OTHER_CAST }), 'idempotency_conflict');
  code(() => economy.order(USER, { ...request, itemId: 'luxury' }), 'idempotency_conflict');
  assert.equal(economy.state(USER).wallet.S, 5000);
  assert.equal(economy.state(USER).orders.length, 1);
  assert.equal(first.reaction, ITEMS.find(item => item.id === 'drink').reaction);
  assert.equal(first.affection.score, 3);
});

test('G gifts progress affection independently of purchased S and never affect other casts', t => {
  const f = fixture(t);
  fund(f.economy, USER);
  for (let i = 0; i < 6; i++) earnJob(f, OTHER);
  giftFund(f.economy,USER,1500);
  const paid = f.economy.order(USER, { itemId: 'drink', castId: CAST, currency: 'G', key: key('gift-drink') });
  const free = f.economy.order(OTHER, { itemId: 'drink', castId: CAST, currency: 'G', key: key('free-drink') });
  assert.equal(paid.affection.spendPoints, free.affection.spendPoints);
  assert.equal(paid.affection.score, free.affection.score);
  assert.equal(f.economy.state(USER).affection.find(value => value.castId === OTHER_CAST).score, 0);
});

test('spending contribution caps at 40 and champagne/premium memories are persisted once', t => {
  const { economy } = fixture(t);
  economy.setLimit(USER, 50000);
  giftFund(economy,USER,45000);
  for (let i = 0; i < 4; i++) economy.order(USER, { itemId: 'champagne', castId: CAST, currency: 'G', key: key('champagne') });
  const last = economy.order(USER, { itemId: 'drink', castId: CAST, currency: 'G', key: key('drink') });
  assert.equal(last.affection.spendPoints, 40);
  assert.equal(last.affection.score, 40);
  assert.equal(last.affection.level, 3);
  assert.equal(economy.state(USER).album.length, 4);
  assert.ok(economy.state(USER).album.every(entry => entry.castId === CAST && entry.itemId === 'champagne'));
});

test('visits are credited once per cast and JST calendar day, without a daily obligation', t => {
  const f = fixture(t);
  f.set(Date.parse('2026-10-09T14:59:59.000Z'));
  assert.equal(f.economy.visit(USER, CAST, key('visit')).credited, true);
  assert.equal(f.economy.visit(USER, CAST, key('visit-again')).credited, false);
  assert.equal(f.economy.visit(USER, OTHER_CAST, key('other-visit')).credited, true);
  f.advance(2000);
  const next = f.economy.visit(USER, CAST, key('next-day'));
  assert.equal(next.credited, true);
  assert.equal(next.affection.visitPoints, 4);
  f.advance(100 * 24 * 60 * 60 * 1000);
  assert.equal(f.economy.state(USER).affection.find(value => value.castId === CAST).score, 4);
});

test('selected conversation topics are validated and capped once/topic/JST day', t => {
  const f = fixture(t);
  const topic = TOPICS[0].id;
  const first = f.economy.conversation(USER, CAST, topic, key('talk'));
  assert.equal(first.credited, true);
  assert.equal(f.economy.conversation(USER, CAST, topic, key('talk-again')).credited, false);
  code(() => f.economy.conversation(USER, CAST, 'invented-topic', key('talk')), 'topic_not_found');
  for (let day = 0; day < 20; day++) {
    f.advance(24 * 60 * 60 * 1000);
    for (const candidate of TOPICS) f.economy.conversation(USER, CAST, candidate.id, key('talk'));
  }
  const affection = f.economy.state(USER).affection.find(value => value.castId === CAST);
  assert.equal(affection.conversationPoints, 30);
  assert.equal(affection.score, 30);
});

test('story events require levels, complete once, and can progress without paid currency', t => {
  const f = fixture(t);
  const intro = STORY_EVENTS.find(event => event.minLevel === 1);
  const regular = STORY_EVENTS.find(event => event.minLevel === 2);
  code(() => f.economy.completeEvent(USER, CAST, regular.id, key('story')), 'story_locked');
  const one = f.economy.completeEvent(USER, CAST, intro.id, key('intro'));
  assert.equal(one.credited, true);
  assert.equal(one.affection.score, 10);
  assert.equal(f.economy.completeEvent(USER, CAST, intro.id, key('intro-again')).credited, false);
  for (let day = 0; day < 3; day++) {
    f.advance(24 * 60 * 60 * 1000);
    f.economy.visit(USER, CAST, key('visit'));
    for (const topic of TOPICS) f.economy.conversation(USER, CAST, topic.id, key('talk'));
  }
  const two = f.economy.completeEvent(USER, CAST, regular.id, key('regular'));
  assert.equal(two.credited, true);
  assert.equal(f.economy.state(USER).wallet.S, 0);
  assert.equal(f.economy.state(USER).purchases.length, 0);
});

test('relationship contribution caps at 60 and total affection caps at 100', t => {
  const f = fixture(t);
  f.economy.setLimit(USER, 50000);
  giftFund(f.economy,USER,45000);
  for (let i = 0; i < 4; i++) f.economy.order(USER, { itemId: 'champagne', castId: CAST, currency: 'G', key: key('order') });
  for (let day = 0; day < 20; day++) {
    f.advance(24 * 60 * 60 * 1000);
    f.economy.visit(USER, CAST, key('visit'));
    for (const topic of TOPICS) f.economy.conversation(USER, CAST, topic.id, key('talk'));
    const state = f.economy.state(USER).affection.find(value => value.castId === CAST);
    for (const event of STORY_EVENTS.filter(event => state.level >= event.minLevel)) f.economy.completeEvent(USER, CAST, event.id, key('story'));
  }
  const state = f.economy.state(USER).affection.find(value => value.castId === CAST);
  assert.equal(state.spendPoints, 40);
  assert.equal(state.relationshipPoints, 60);
  assert.equal(state.score, 100);
  assert.equal(state.level, 5);
  assert.equal(state.completedEvents.length, STORY_EVENTS.length);
});

test('real job durations, minimum actions, and action interval are enforced by the server clock', t => {
  let now = Date.parse('2026-10-09T00:00:00.000Z');
  const f = fixture(t, { clock: () => now, allowFastJobs: false });
  let job = f.economy.startJob(USER, { difficulty: 'normal', key: key('start') });
  assert.equal(job.durationMs, 240000);
  assert.equal(Object.hasOwn(job.challenge, 'expected'), false);
  code(() => f.economy.finishJob(USER, job.id, key('early')), 'job_too_early');
  job = f.economy.jobAction(USER, job.id, { challengeId: job.challenge.id, choiceId: answerFor(job.challenge) }, key('action')).job;
  code(() => f.economy.jobAction(USER, job.id, answerFor(job.challenge), key('fast')), 'job_too_fast');
  now += 240000;
  code(() => f.economy.finishJob(USER, job.id, key('few')), 'job_actions_required');
  for (let action = 1; action < 8; action++) {
    now += 1000;
    job = f.economy.jobAction(USER, job.id, { challengeId: job.challenge.id, choiceId: answerFor(job.challenge) }, key('action')).job;
  }
  const done = f.economy.finishJob(USER, job.id, key('finish'));
  assert.equal(done.reward, 175);
  assert.equal(done.wallet.G, 175);
});

test('job challenges reject forged, stale, and other-account submissions', t => {
  const { economy } = fixture(t);
  let job = economy.startJob(USER, { difficulty: 'easy', key: key('start') });
  code(() => economy.jobAction(USER, job.id, 'claim-1000000G', key('bad')), 'invalid_answer');
  code(() => economy.jobAction(OTHER, job.id, 'glass', key('foreign')), 'job_not_found');
  const previousId = job.challenge.id;
  job = economy.jobAction(USER, job.id, { challengeId: previousId, choiceId: answerFor(job.challenge) }, key('action')).job;
  code(() => economy.jobAction(USER, job.id, { challengeId: previousId, choiceId: 'glass' }, key('stale')), 'challenge_changed');
  assert.equal(economy.state(USER).jobs[0].actions, 1);
  assert.equal(economy.state(USER).wallet.G, 0);
});

test('job start/action/finish retries give exactly one job reward', t => {
  const f = fixture(t);
  const startKey = key('start');
  let job = f.economy.startJob(USER, { difficulty: 'hard', key: startKey });
  assert.equal(f.economy.startJob(USER, { difficulty: 'hard', key: startKey }).id, job.id);
  code(() => f.economy.startJob(USER, { difficulty: 'easy', key: key('another') }), 'job_active');
  code(() => f.economy.startJob(USER, { difficulty: 'easy', key: startKey }), 'idempotency_conflict');
  for (let action = 0; action < 8; action++) {
    const actionKey = key('action');
    const answer = { challengeId: job.challenge.id, choiceId: answerFor(job.challenge) };
    const one = f.economy.jobAction(USER, job.id, answer, actionKey);
    assert.deepEqual(f.economy.jobAction(USER, job.id, answer, actionKey), one);
    job = one.job;
  }
  f.advance(1000);
  const finishKey = key('finish');
  const one = f.economy.finishJob(USER, job.id, finishKey);
  assert.deepEqual(f.economy.finishJob(USER, job.id, finishKey), one);
  assert.equal(f.economy.finishJob(USER, job.id, key('finish-again')).duplicate, true);
  assert.equal(f.economy.state(USER).wallet.G, 250);
  assert.equal(f.economy.state(USER).ledger.filter(entry => entry.kind === 'job').length, 1);
  assert.equal(f.economy.state(USER).jobsCompleted, 1);
});

test('job reward is calculated from validated correctness and improves with practice', t => {
  const f = fixture(t);
  let job = f.economy.startJob(USER, { difficulty: 'easy', key: key('start') });
  for (let i = 0; i < 8; i++) {
    const correct = answerFor(job.challenge);
    const wrong = correct === 'glass' ? 'bottle' : 'glass';
    job = f.economy.jobAction(USER, job.id, { challengeId: job.challenge.id, choiceId: wrong }, key('wrong')).job;
  }
  f.advance(1000);
  assert.equal(f.economy.finishJob(USER, job.id, key('finish')).reward, 70);
  const trained = earnJob(f, USER, 'easy');
  assert.equal(trained.reward, 102);
  assert.equal(f.economy.state(USER).wallet.S, 0);
});

test('history and receipts survive reopening, while ledger SQL mutations are rejected', () => {
  const directory = mkdtempSync(join(tmpdir(), 'succubus-economy-test-'));
  const path = join(directory, 'economy.sqlite');
  let economy;
  try {
    economy = new Economy(path);
    const pending = fund(economy);
    giftFund(economy);
    const request = { itemId: 'drink', castId: CAST, currency: 'G', key: key('order') };
    const order = economy.order(USER, request);
    assert.throws(() => economy.db.prepare('UPDATE econ_ledger SET amount=99999').run(), /append-only/);
    assert.throws(() => economy.db.prepare('DELETE FROM econ_ledger').run(), /append-only/);
    economy.close();
    economy = new Economy(path);
    assert.equal(economy.state(USER).wallet.S, 5000);
    assert.equal(economy.purchase(USER, pending.purchase.id).status, 'paid');
    assert.equal(economy.order(USER, request).id, order.id);
    assert.equal(economy.state(USER).ledger.length, 3);
    assert.equal(economy.checkoutPaid(key('retry-after-reopen'), pending.session).duplicate, true);
    assert.equal(economy.state(USER).wallet.S, 5000);
  } finally {
    if (economy) economy.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('separate database connections observe committed caps and cannot overwrite reservations', () => {
  const directory = mkdtempSync(join(tmpdir(), 'succubus-economy-connections-'));
  const path = join(directory, 'economy.sqlite');
  const first = new Economy(path);
  const second = new Economy(path);
  try {
    first.setLimit(USER, 500);
    reserve(first);
    code(() => reserve(second), 'monthly_limit');
    assert.equal(second.state(USER).monthly.reservedYen, 500);
    assert.equal(second.pendingPurchases(USER).length, 1);
    assert.equal(first.state(USER).wallet.S, 0);
  } finally {
    first.close();
    second.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
