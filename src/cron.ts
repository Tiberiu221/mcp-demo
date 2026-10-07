// Explains a standard 5-field cron expression in plain Romanian.
// Pure function: no I/O and no dependencies, so it is easy to unit-test.

interface Item {
  from: number;
  to: number;
  step: number;
  wildcard: boolean; // written as "*" or "*/n"
}

interface FieldSpec {
  label: string;
  min: number;
  max: number;
  aliases?: Record<string, number>;
}

const MONTHS = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'];
// Cron accepts both 0 and 7 for Sunday.
const WEEKDAYS = ['duminică', 'luni', 'marți', 'miercuri', 'joi', 'vineri', 'sâmbătă', 'duminică'];

const aliases = (names: string[], first: number) => Object.fromEntries(names.map((name, i) => [name, i + first]));

const FIELDS: FieldSpec[] = [
  { label: 'minut', min: 0, max: 59 },
  { label: 'oră', min: 0, max: 23 },
  { label: 'ziua lunii', min: 1, max: 31 },
  { label: 'lună', min: 1, max: 12, aliases: aliases(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'], 1) },
  { label: 'ziua săptămânii', min: 0, max: 7, aliases: aliases(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], 0) },
];

const MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

function parseValue(token: string, spec: FieldSpec): number {
  const alias = spec.aliases?.[token];
  if (alias !== undefined) return alias;
  const value = /^\d+$/.test(token) ? Number(token) : NaN;
  if (!(value >= spec.min && value <= spec.max)) {
    throw new Error(`Valoare invalidă „${token}” pentru ${spec.label} (permis ${spec.min}–${spec.max}).`);
  }
  return value;
}

function parseField(raw: string, spec: FieldSpec): Item[] {
  return raw.split(',').map((part) => {
    const [base, stepText, extra] = part.split('/');
    if (extra !== undefined || (stepText !== undefined && !/^[1-9]\d*$/.test(stepText))) {
      throw new Error(`Pas invalid „${part}” pentru ${spec.label}.`);
    }
    const step = stepText === undefined ? 1 : Number(stepText);
    if (base === '*') return { from: spec.min, to: spec.max, step, wildcard: true };

    const [fromText = '', toText, more] = base.split('-');
    if (more !== undefined) throw new Error(`Interval invalid „${part}” pentru ${spec.label}.`);
    const from = parseValue(fromText, spec);
    // "a/n" means "from a to the end of the range, every n".
    const to = toText !== undefined ? parseValue(toText, spec) : stepText !== undefined ? spec.max : from;
    if (from > to) throw new Error(`Interval invalid „${part}” pentru ${spec.label}: începutul e după sfârșit.`);
    return { from, to, step, wildcard: false };
  });
}

const pad = (n: number) => String(n).padStart(2, '0');

function joinRo(parts: string[]): string {
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} și ${parts.at(-1)}`;
}

const isAny = (field: Item[]) => field.length === 1 && field[0].wildcard && field[0].step === 1; // "*"
const isEvery = (field: Item[]) => field.length === 1 && field[0].wildcard && field[0].step > 1; // "*/n"
const isSimpleRange = (field: Item[]) => field.length === 1 && !field[0].wildcard && field[0].step === 1;

// Sorted values when the field is only a list of single values ("5" or "0,30"), otherwise null.
function singles(field: Item[]): number[] | null {
  return field.every((item) => item.from === item.to) ? field.map((item) => item.from).sort((a, b) => a - b) : null;
}

function expand(field: Item[]): number[] {
  const values = new Set<number>();
  for (const { from, to, step } of field) for (let v = from; v <= to; v += step) values.add(v);
  return [...values].sort((a, b) => a - b);
}

function describeItems(field: Item[], format: (n: number) => string): string {
  return joinRo(
    field.map(({ from, to, step }) => {
      if (from === to) return format(from);
      const range = `${format(from)}–${format(to)}`;
      return step === 1 ? range : `${range} din ${step} în ${step}`;
    }),
  );
}

// "fixed" means concrete clock times (e.g. "la 02:00"), which read best after the day part.
function describeTime(minute: Item[], hour: Item[]): { text: string; fixed: boolean } {
  const minutes = singles(minute);
  const hours = singles(hour);
  if (minutes && hours && minutes.length * hours.length <= 6) {
    const times = hours.flatMap((h) => minutes.map((m) => `${pad(h)}:${pad(m)}`));
    return { text: `la ${joinRo(times)}`, fixed: true };
  }

  const minuteText = isAny(minute)
    ? 'în fiecare minut'
    : isEvery(minute)
      ? `la fiecare ${minute[0].step} minute`
      : minutes?.length === 1
        ? `la minutul ${minutes[0]}`
        : `la minutele ${describeItems(minute, String)}`;

  if (isAny(hour)) return { text: minutes ? `${minuteText} din fiecare oră` : minuteText, fixed: false };
  if (minutes && isEvery(hour)) return { text: `la fiecare ${hour[0].step} ore, ${minuteText}`, fixed: false };
  if (isSimpleRange(hour)) {
    const { from, to } = hour[0];
    if (from === to) return { text: `${minuteText}, în ora ${pad(from)}`, fixed: false };
    return minutes
      ? { text: `${minuteText} din fiecare oră, între orele ${pad(from)} și ${pad(to)}`, fixed: false }
      : { text: `${minuteText}, între orele ${pad(from)}:00 și ${pad(to)}:59`, fixed: false };
  }
  return { text: `${minuteText}, în orele ${joinRo(expand(hour).map(pad))}`, fixed: false };
}

function describeDayOfMonth(dom: Item[]): string {
  const days = singles(dom);
  return days?.length === 1 ? `în ziua ${days[0]} a lunii` : `în zilele ${describeItems(dom, String)} ale lunii`;
}

function describeDayOfWeek(dow: Item[]): string {
  const days = singles(dow);
  if (days?.length === 1) return `în fiecare ${WEEKDAYS[days[0]]}`;
  if (isSimpleRange(dow)) return `de ${WEEKDAYS[dow[0].from]} până ${WEEKDAYS[dow[0].to]}`;
  const unique = [...new Set(expand(dow).map((d) => d % 7))].sort((a, b) => a - b);
  return `în zilele de ${joinRo(unique.map((d) => WEEKDAYS[d]))}`;
}

function describeMonth(month: Item[]): string {
  const name = (n: number) => MONTHS[n - 1];
  if (isSimpleRange(month)) {
    const { from, to } = month[0];
    return from === to ? `doar în ${name(from)}` : `doar din ${name(from)} până în ${name(to)}`;
  }
  return `doar în ${joinRo(expand(month).map(name))}`;
}

export function explainCron(expression: string): string {
  const normalized = expression.trim().toLowerCase();
  if (normalized === '@reboot') return 'la fiecare pornire a sistemului';
  const source = MACROS[normalized] ?? normalized;
  if (source.startsWith('@')) {
    throw new Error(`Macro necunoscut „${expression.trim()}”. Acceptate: ${Object.keys(MACROS).join(', ')}, @reboot.`);
  }

  const parts = source.split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(
      `Expresia cron trebuie să aibă exact 5 câmpuri (minut oră zi-a-lunii lună zi-a-săptămânii); am primit ${parts.length}.`,
    );
  }
  const [minute, hour, dom, month, dow] = parts.map((part, i) => parseField(part, FIELDS[i]));

  const time = describeTime(minute, hour);
  // Classic cron gotcha: when both day fields are restricted (neither starts with "*"),
  // the job runs when EITHER of them matches, not both.
  const days =
    isAny(dom) && isAny(dow)
      ? null
      : isAny(dom)
        ? describeDayOfWeek(dow)
        : isAny(dow)
          ? describeDayOfMonth(dom)
          : `${describeDayOfMonth(dom)}${dom[0].wildcard || dow[0].wildcard ? ',' : ' sau'} ${describeDayOfWeek(dow)}`;
  const monthText = isAny(month) ? '' : `, ${describeMonth(month)}`;

  if (time.fixed) return `${days ?? 'în fiecare zi'} ${time.text}${monthText}`;
  return `${time.text}${days ? `, ${days}` : ''}${monthText}`;
}
