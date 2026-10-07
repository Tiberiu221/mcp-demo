import assert from 'node:assert/strict';
import { test } from 'node:test';
import { explainCron } from './cron.js';

test('fixed time every day', () => {
  assert.equal(explainCron('0 2 * * *'), 'în fiecare zi la 02:00');
});

test('step in the minute field', () => {
  assert.equal(explainCron('*/15 * * * *'), 'la fiecare 15 minute');
  assert.equal(explainCron('5 * * * *'), 'la minutul 5 din fiecare oră');
});

test('weekday range', () => {
  assert.equal(explainCron('30 9 * * 1-5'), 'de luni până vineri la 09:30');
});

test('day of month', () => {
  assert.equal(explainCron('0 0 1 * *'), 'în ziua 1 a lunii la 00:00');
});

test('step, hour range and weekdays combined', () => {
  assert.equal(
    explainCron('*/15 9-17 * * 1-5'),
    'la fiecare 15 minute, între orele 09:00 și 17:59, de luni până vineri',
  );
});

test('lists and day names', () => {
  assert.equal(explainCron('0 9,17 * * mon,wed,fri'), 'în zilele de luni, miercuri și vineri la 09:00 și 17:00');
});

test('month restriction, macros and the day-of-month OR day-of-week rule', () => {
  assert.equal(explainCron('0 12 * 1 *'), 'în fiecare zi la 12:00, doar în ianuarie');
  assert.equal(explainCron('@daily'), 'în fiecare zi la 00:00');
  // Both day fields restricted: cron runs when EITHER matches.
  assert.equal(explainCron('0 0 1 * 1'), 'în ziua 1 a lunii sau în fiecare luni la 00:00');
});

test('invalid expressions throw a clear error', () => {
  assert.throws(() => explainCron('* * *'), /exact 5 câmpuri/);
  assert.throws(() => explainCron('61 * * * *'), /Valoare invalidă „61” pentru minut/);
  assert.throws(() => explainCron('*/0 * * * *'), /Pas invalid/);
  assert.throws(() => explainCron('0 0 * * 5-1'), /Interval invalid/);
});
