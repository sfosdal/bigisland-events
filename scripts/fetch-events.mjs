#!/usr/bin/env node
/**
 * Aggregates upcoming events on Hawaiʻi Island — the Big Island, Kona and
 * Hilo sides both — into site/events.json and site/events.ics. Runs in CI (see .github/workflows/events.yml) and locally
 * for preview. The pipeline is lqa-events' (scripts/*.mjs are its files,
 * byte for byte; the build itself is scripts/build.mjs); only the readers below and site/city.js are the island's.
 *
 * Each source returns [{ venue, title, date, time, url }]. Ticketmaster needs
 * a free Discovery API key in env TICKETMASTER_API_KEY (repo secret of the
 * same name); with no key it's skipped. Every room is read by its Ticketmaster
 * venue id (city.js `tm`); there is no city sweep, as in Chicago — the rooms
 * are read one by one, a second apart (the key is shared with the sister
 * cities' builds). Ticketmaster lists little here: the rooms' own calendars
 * come through scripts/feeds.mjs (Ludus, The Events Calendar, Squarespace, the
 * NPS events API, the Kahilu's cards, the Vulcans' season iCal, Honokaʻa's
 * Eventbrite links), and six are parsed below — the Kona Coffee Cultural
 * Festival's calendar page, the Kings' Shops' EyeOn calendar, the UH Hilo
 * Performing Arts Center's eight-month outlook, the Merrie Monarch Festival's
 * programme page, the Volcano Art Center's EventPrime month pages and the
 * Hawaii Concert Society's season page. The Rainbow Warriors' seasons come from ESPN (scripts/schedules.mjs).
 */
import './failures.mjs'; // first: every outside call retried, the ones still failing written to failures.json (Steve, 2026-10-29)
import { build, BROWSER_UA, unent } from './build.mjs';
import { CITY } from './badges.mjs';
import { cardDates, chromeFetch, feedFailedVenues } from './feeds.mjs';

// "9 am to 1 pm" → 09:00; "5:30-8:30pm" → 17:30 (a first clock with no am/pm borrows the next one's)
export function firstClock(text) {
  const t = String(text || '');
  if (/^\s*noon\b/i.test(t)) return '12:00';
  const m = /(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i.exec(t);
  if (!m) return '';
  const mer = m[3] ? m[3][0].toLowerCase() : (/(am|pm|a\.m\.|p\.m\.)/i.exec(t.slice(m.index + m[0].length)) || [''])[0][0]?.toLowerCase();
  let h = Number(m[1]); if (h > 23) return '';
  if (mer === 'p' && h < 12) h += 12; else if (mer === 'a' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${m[2] || '00'}`;
}

// --- The Kona Coffee Cultural Festival: its calendar page ---
// konacoffeefest.com/calendar/ prints each month as <div class="kccf-calendar" data-month data-year>
// of <div class="kccf-day"> cells (kccf-day-number), each event an <a class="kccf-event"> with
// title, time ("9 am to 1 pm") and location spans; a multi-day event sits in every day it spans.
// One row per event per day, the location after the title (the venue column is the festival's).
const KCCF_URL = 'https://konacoffeefest.com/calendar/';
export function parseKccf(html) {
  const out = [];
  for (const cal of String(html || '').split('<div class="kccf-calendar"').slice(1)) {
    const mo = /data-month="(\d+)"/.exec(cal), yr = /data-year="(\d+)"/.exec(cal);
    if (!mo || !yr) continue;
    for (const day of cal.split(/<div class="kccf-day(?: [^"]*)?"/).slice(1)) {
      const dn = /kccf-day-number">\s*(\d+)/.exec(day); if (!dn) continue;
      const date = `${yr[1]}-${mo[1].padStart(2, '0')}-${dn[1].padStart(2, '0')}`;
      for (const ev of day.matchAll(/<a\s+class="kccf-event[^"]*"\s+href="([^"]+)"\s*>([\s\S]*?)<\/a>/g)) {
        const field = (cls) => { const m = new RegExp(`kccf-event-${cls}">\\s*([\\s\\S]*?)\\s*</span>`).exec(ev[2]); return m ? unent(m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()) : ''; };
        const title = field('title'); if (!title) continue;
        const loc = field('location');
        out.push({ venue: 'Kona Coffee Cultural Festival', title: loc && !title.toLowerCase().includes(loc.toLowerCase()) ? `${title} — ${loc}` : title, date, time: firstClock(field('time')), url: ev[1], type: 'community' });
      }
    }
  }
  return out;
}
async function konaCoffeeFest() {
  const res = await fetch(KCCF_URL, { headers: { 'User-Agent': BROWSER_UA } });
  if (!res.ok) throw new Error(`Kona Coffee Cultural Festival HTTP ${res.status}`);
  const evs = parseKccf(await res.text());
  console.log(`Kona Coffee Cultural Festival: ${evs.length} events`);
  return evs;
}

// --- Kings' Shops: the Waikoloa shopping centre's EyeOn calendar ---
// GET /events/ for the plugin's nonce, then POST admin-ajax.php?api=/v1/events (action
// eyeon_api_request) → { items }: one item per listing with event_type onetime / recurring /
// custom / ongoing, start_date, end_date, start_time and the recurrence as an RRULE
// (repeat_rrule: WEEKLY by day, MONTHLY by day and set position, DAILY). One row per
// occurrence inside the window; the open-all-day items (the putting green, the art challenge,
// the calendar itself) and the classes, workshops, fitness mornings and markets are left out.
const KINGS_URL = 'https://kingsshops.com/events/';
const KINGS_DROP = /\bclass(es)?\b|workshop|open daily|fitness|volunteer|market|calendar of events|art challenge|virtual golf|paint(ing)? (&|and) sip/i;
const KINGS_DAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const ymdUtc = (d) => d.toISOString().slice(0, 10);
const dayAt = (ymd) => new Date(`${ymd}T12:00:00Z`);
export function kingsDates(item, from, to) {
  const clock = (t) => (t ? String(t).slice(0, 5) : '');
  const type = item.event_type || 'onetime';
  if (type === 'ongoing') return [];
  if (type === 'custom') return (item.custom_dates || []).filter((c) => c.date >= from && c.date <= to).map((c) => ({ date: c.date, time: clock(c.start_time) }));
  const start = item.start_date || '', time = clock(item.start_time);
  if (!start) return [];
  if (type === 'onetime') {
    const end = item.end_date && item.end_date > start ? item.end_date : start;
    const out = []; for (let d = dayAt(start); ymdUtc(d) <= end && out.length < 7; d.setUTCDate(d.getUTCDate() + 1)) out.push({ date: ymdUtc(d), time });
    return out.filter((o) => o.date >= from && o.date <= to);
  }
  const rule = Object.fromEntries((String(item.repeat_rrule || '').split('\n').find((l) => l.startsWith('RRULE:')) || '').slice(6).split(';').filter(Boolean).map((kv) => kv.split('=')));
  const until = rule.UNTIL ? `${rule.UNTIL.slice(0, 4)}-${rule.UNTIL.slice(4, 6)}-${rule.UNTIL.slice(6, 8)}` : '';
  const end = [item.end_date, until, to].filter(Boolean).sort()[0];
  const days = (rule.BYDAY || '').split(',').map((d) => KINGS_DAYS[d]).filter((d) => d !== undefined);
  const out = [];
  if (rule.FREQ === 'WEEKLY' && days.length) {
    for (let d = dayAt(start < from ? from : start); ymdUtc(d) <= end; d.setUTCDate(d.getUTCDate() + 1)) if (days.includes(d.getUTCDay())) out.push({ date: ymdUtc(d), time });
  } else if (rule.FREQ === 'MONTHLY' && days.length) {
    const pos = (rule.BYSETPOS || '1').split(',').map(Number);
    for (let m = dayAt(`${start.slice(0, 7)}-01`); ymdUtc(m) <= end; m.setUTCMonth(m.getUTCMonth() + 1)) {
      for (const n of pos) for (const wd of days) {
        const first = new Date(m); while (first.getUTCDay() !== wd) first.setUTCDate(first.getUTCDate() + 1);
        first.setUTCDate(first.getUTCDate() + (n - 1) * 7);
        const date = ymdUtc(first);
        if (date.slice(0, 7) === ymdUtc(m).slice(0, 7) && date >= start && date >= from && date <= end) out.push({ date, time });
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
export function mapKingsItems(items, from, to) {
  const out = [];
  for (const it of items || []) {
    const title = unent(it.title).replace(/\s+/g, ' ').trim();
    if (!title || KINGS_DROP.test(title)) continue;
    const url = it.slug ? `https://kingsshops.com/event/${encodeURI(it.slug)}/` : KINGS_URL;
    for (const { date, time } of kingsDates(it, from, to)) out.push({ venue: 'Kings’ Shops', title, date, time, url });
  }
  return out;
}
// Both calls go through the Chrome fingerprint (feeds.mjs chromeFetch): the page and the EyeOn call answer
// GitHub's runners 403 (2026-10-26); the call needs only the page's nonce, no cookie (checked 2026-10-30).
// A failed read keeps the venue's upcoming rows from the last feed.
async function kingsShops() {
  const failed = (why) => { feedFailedVenues.add('Kings’ Shops'); return new Error(`Kings' Shops: ${why}`); };
  const html = (await chromeFetch([KINGS_URL], "Kings' Shops")).get(KINGS_URL);
  if (html == null) throw failed(`page unreadable ${KINGS_URL}`);
  const nonce = /"nonce":"([^"]+)"/.exec(html)?.[1], ajax = /"ajaxurl":"([^"]+)"/.exec(html)?.[1]?.replace(/\\\//g, '/');
  if (!nonce || !ajax) throw failed('no EyeOn nonce in the page');
  const call = JSON.stringify({ url: `${ajax}?api=/v1/events`, data: { action: 'eyeon_api_request', nonce, apiUrl: '/v1/events', paginated_data: 'true', force_refresh: 'false' } });
  const text = (await chromeFetch([call], "Kings' Shops events")).get(call);
  if (text == null) throw failed('EyeOn events call unreadable');
  const data = JSON.parse(text);
  const items = data.items || data.data?.items || [];
  const from = new Date().toISOString().slice(0, 10), to = new Date(Date.now() + 120 * 86400e3).toISOString().slice(0, 10);
  const evs = mapKingsItems(items, from, to);
  console.log(`Kings' Shops (EyeOn): ${evs.length} events from ${items.length} listings`);
  return evs;
}

const MONTH_NUM = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const WEEKDAYS = 'Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday';
const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';
const pad2 = (n) => String(n).padStart(2, '0');
const plainText = (html) => unent(String(html || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// --- UH Hilo Performing Arts Center: its eight-month outlook ---
// artscenter.uhh.hawaii.edu/future.php prints eight monthly tables (class caltable, the month in a
// colspan-7 header) of <td> day cells — <p class="day">8</p> (the month's first day "Oct 1"; the
// grey days of the months either side carry class="off") — each event a <div class="ev"> with a
// <span class="time">7p</span> and a link to the university's news page for it.
const PAC_URL = 'https://artscenter.uhh.hawaii.edu/future.php';
const pacClock = (t) => { const m = /(\d{1,2})(?::(\d{2}))?\s*([ap])/i.exec(t || ''); if (!m) return ''; let h = Number(m[1]) % 12; if (m[3].toLowerCase() === 'p') h += 12; return `${pad2(h)}:${m[2] || '00'}`; };
export function parsePacOutlook(html) {
  const out = [];
  for (const table of String(html || '').split(/<table\b/).slice(1)) {
    const h = /<th colspan="7" class="large">\s*([A-Za-z]+)\s+(\d{4})\s*</.exec(table); if (!h) continue;
    const mo = MONTH_NUM[h[1].toLowerCase()]; if (!mo) continue;
    for (const cell of table.split(/<td\b/).slice(1)) {
      if (/^[^>]*class="off"/.test(cell)) continue;
      const dn = /<p class="day">(?:[A-Za-z]{3}\s+)?(\d{1,2})<\/p>/.exec(cell); if (!dn) continue;
      const date = `${h[2]}-${pad2(mo)}-${pad2(dn[1])}`;
      for (const ev of cell.matchAll(/<div class="ev[^"]*">([\s\S]*?)<\/div>/g)) {
        const clock = /<span class="time">([^<]*)<\/span>/.exec(ev[1]);
        const a = /<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(ev[1]); if (!a) continue;
        const title = unent(a[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(); if (!title) continue;
        out.push({ venue: 'UH Hilo Performing Arts Center', title, date, time: pacClock(clock && clock[1]), url: unent(a[1]).replace(/^http:/, 'https:'), type: 'arts' });
      }
    }
  }
  return out;
}
async function pacOutlook() {
  const res = await fetch(PAC_URL, { headers: { 'User-Agent': BROWSER_UA } });
  if (!res.ok) throw new Error(`UH Hilo Performing Arts Center HTTP ${res.status}`);
  const evs = parsePacOutlook(await res.text());
  console.log(`UH Hilo Performing Arts Center: ${evs.length} events`);
  return evs;
}

// --- The Merrie Monarch Festival: its programme page ---
// merriemonarch.com/<year>-merrie_monarch_festival/ lists the week's events as prose — "Hōʻike
// Performances 6:00 pm, Wednesday, March 31st at the Edith Kanakaʻole Stadium", "Merrie Monarch
// Invitational Hawaiian Arts Fair 9:00 a.m. to 5:00 p.m., Wednesday, March 31st through Friday,
// April 2nd …". Each clock-weekday-date mention is an event; the title is the sentence fragment
// before the clock, the place the "at the …" that follows, a "through" range one row a day. The
// year is the page's. This year's page and next year's are both read (the next appears in autumn).
const MM_BASE = 'https://www.merriemonarch.com/';
export function parseMerrieMonarch(html, year) {
  const text = plainText(html);
  const re = new RegExp(`(\\d{1,2}(?::\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?))(?:\\s*(?:to|-|–)\\s*\\d{1,2}(?::\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?))?\\s*,?\\s*(?:${WEEKDAYS})\\s*,?\\s*(${MONTHS})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+through\\s+(?:${WEEKDAYS})\\s*,?\\s*(${MONTHS})\\s+(\\d{1,2})(?:st|nd|rd|th)?)?`, 'gi');
  const out = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const before = text.slice(last, m.index);
    last = m.index + m[0].length;
    // the title: after the last sentence end or year in the text since the previous mention
    let title = before.split(/(?<=[.!?])\s+|(?<=\b\d{4})\s+/).pop().trim().replace(/^[^A-Za-zʻŌĀĪŪĒōāīūē]+/, '').replace(/\s*\(celebration\)/i, '');
    if (!title || title.length < 4 || new RegExp(`\\b(${WEEKDAYS}|${MONTHS})\\b`, 'i').test(title) || !/^[A-ZʻŌĀĪŪĒ]/.test(title)) continue;
    const after = text.slice(last, last + 160);
    const at = /^\s*(?:\.|,)?\s*at the ([A-ZʻŌĀĪŪĒ][^.]*?(?:Stadium|Auditorium|Hotel|Center|Park|Hilo|Bayfront|Avenue))/.exec(after);
    const place = at ? at[1].trim() : '';
    const start = Date.UTC(year, MONTH_NUM[m[2].toLowerCase()] - 1, Number(m[3]));
    const end = m[4] ? Date.UTC(year, MONTH_NUM[m[4].toLowerCase()] - 1, Number(m[5])) : start;
    const time = firstClock(m[1]);
    for (let d = start; d <= end && d < start + 7 * 86400e3; d += 86400e3) {
      out.push({ venue: 'Merrie Monarch Festival', title: place && !title.toLowerCase().includes(place.toLowerCase()) ? `${title} — ${place}` : title, date: new Date(d).toISOString().slice(0, 10), time, url: `${MM_BASE}${year}-merrie_monarch_festival/`, type: 'community' });
    }
  }
  return out;
}
async function merrieMonarch() {
  const y = new Date().getFullYear();
  const out = [];
  for (const year of [y, y + 1]) {
    const res = await fetch(`${MM_BASE}${year}-merrie_monarch_festival/`, { headers: { 'User-Agent': BROWSER_UA } });
    if (!res.ok) { if (res.status !== 404) console.error(`Merrie Monarch ${year} HTTP ${res.status}`); continue; }
    out.push(...parseMerrieMonarch(await res.text(), year));
  }
  console.log(`Merrie Monarch Festival: ${out.length} events`);
  return out;
}

// --- Volcano Art Center: its EventPrime month pages ---
// volcanoartcenter.org/ep-events/?epc_month=YYYY-MM draws the month as a grid whose every item is an
// <a data-epc-peek> carrying the card as attributes: data-peek-title, data-peek-when ("28 Sep",
// "6 Sep – 25 Oct"), data-peek-time ("9:30 AM"), data-peek-venue, data-peek-type (Exhibits,
// Workshops …). A multi-day item sits in every day it spans, so items are read once by link; a run
// longer than three days is a class or an exhibition, not an event, and goes with the workshops,
// tours and classes. Four months are read.
const VAC_URL = 'https://volcanoartcenter.org/ep-events/';
const VAC_DROP = /workshop|\bclass(es)?\b|forest tours?|exhibition|\bexhibit\b|open studio|print lab|yoga|zumba|tai chi|meditation|lessons?\b|handbuilding|exploration in clay|with [A-Z][a-z]+ [A-Z][a-z]+ \(/i;
export function parseVacMonth(html, monthFirst) {
  const out = [];
  const seen = new Set();
  for (const tag of String(html || '').matchAll(/<a\s[^>]*data-epc-peek[^>]*>/g)) {
    const attr = (k) => { const m = new RegExp(`data-peek-${k}="([^"]*)"`).exec(tag[0]); return m ? unent(m[1]).trim() : ''; };
    const href = /href="([^"]+)"/.exec(tag[0]); if (!href || seen.has(href[1])) continue;
    seen.add(href[1]);
    const when = attr('when'), type = attr('type');
    const title = attr('title').replace(/^(almost )?sold out!?\s*(call [^a-z]*for tickets)?\s*/i, '').replace(/,?\s*(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?(?:\s+at\s+\d{1,2}(?::\d{2})?\s*[ap]m)?\s*$/i, '').trim(); // "Almost Sold Out! Call … for tickets Concert: …", "VAC Voices, October 8th at 5PM"
    if (!title || !when || /^(Exhibits|Workshops|Classes)$/i.test(type) || VAC_DROP.test(title)) continue;
    const days = cardDates(when, monthFirst);
    if (!days.length || days.length > 3) continue;
    const time = firstClock(attr('time'));
    const where = attr('venue');
    for (const { date } of days) out.push({ venue: 'Volcano Art Center', title: where && /gallery/i.test(where) ? `${title} — ${where.replace(/^Volcano Art Center\s*/i, '')}` : title, date, time, url: unent(href[1]), type: 'arts' });
  }
  return out;
}
async function volcanoArtCenter() {
  const out = [];
  const now = new Date();
  for (let i = 0; i < 4; i++) {
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    const ym = first.toISOString().slice(0, 7);
    const res = await fetch(`${VAC_URL}?epc_month=${ym}`, { headers: { 'User-Agent': BROWSER_UA } });
    if (!res.ok) { console.error(`Volcano Art Center ${ym} HTTP ${res.status}`); continue; }
    out.push(...parseVacMonth(await res.text(), first));
  }
  console.log(`Volcano Art Center: ${out.length} events over four months`);
  return out;
}

// --- The Hawaii Concert Society: its season page ---
// hawaiiconcertsociety.org/<yyyy>-<yy>-season is a Wix page whose concerts read, line by line,
// "WEDNESDAY, SEPTEMBER 23, 2026" / "U. H. HILO PERFORMING ARTS CENTER" / "NEAVE TRIO" / the blurb.
// Concerts begin at 7:00 PM (the page says so once). The hall line names the room — the Performing
// Arts Center or the Crown Room; a concert in a church is left to the shared church filter.
const HCS_BASE = 'https://www.hawaiiconcertsociety.org/';
const HCS_ROOMS = [[/performing arts/i, 'UH Hilo Performing Arts Center'], [/crown room|naniloa/i, 'Crown Room at the Grand Naniloa']];
export function parseConcertSociety(html, url) {
  const lines = unent(String(html || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, '\n')).replace(/[​ ]/g, ' ').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const re = new RegExp(`^(?:${WEEKDAYS}),?\\s+(${MONTHS})\\s+(\\d{1,2}),?\\s+(\\d{4})$`, 'i');
  const out = [];
  for (let i = 0; i < lines.length - 2; i++) {
    const m = re.exec(lines[i]); if (!m) continue;
    const hall = lines[i + 1], title = lines[i + 2];
    const room = HCS_ROOMS.find(([r]) => r.test(hall));
    out.push({ venue: room ? room[1] : hall, title, date: `${m[3]}-${pad2(MONTH_NUM[m[1].toLowerCase()])}-${pad2(m[2])}`, time: '19:00', url, type: 'concert' });
  }
  return out;
}
async function concertSociety() {
  const now = new Date();
  const y = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1; // the season opens in September
  const out = [];
  for (const start of [y, y + 1]) {
    const url = `${HCS_BASE}${start}-${String(start + 1).slice(2)}-season`;
    const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA } });
    if (!res.ok) { if (res.status !== 404) console.error(`Hawaii Concert Society ${start} HTTP ${res.status}`); continue; }
    out.push(...parseConcertSociety(await res.text(), url));
  }
  console.log(`Hawaii Concert Society: ${out.length} concerts`);
  return out;
}

await build({
  feedUrl: 'https://bigisland.here.events/events.json',
  archiveUrl: 'https://raw.githubusercontent.com/sfosdal/bigisland-events/archive/events-archive.json',
  listedVenuesOnly: true, decodeEntities: true,
  primary: (s) => [...s.tmFirst, ...s.feedsFirst, konaCoffeeFest, kingsShops, pacOutlook, merrieMonarch, volcanoArtCenter],
  secondary: (s) => [...s.tmSecond, ...s.feedsSecond, concertSociety],
});
