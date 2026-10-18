/**
 * DEMO DATA — FICTIONAL. Airlines, hotels and prices below are invented to
 * demonstrate the app. Every record is stored with source_kind = 'demo', is
 * labelled "DEMO" everywhere it appears, and is never ranked as bookable.
 * Destinations are real places; providers are deliberately fictional.
 */
import { eq, inArray } from 'drizzle-orm'
import type { InferInsertModel } from 'drizzle-orm'
import type { Region } from '../domain/constants'
import type { CashProduct, FlightDetails, HotelDetails } from '../domain/types'
import { getAirport } from '../geo/airports'
import type { AppDb } from './client'
import { dealPriceHistory, deals } from './schema'

type DealInsert = InferInsertModel<typeof deals>

const DAY = 86_400_000
const LAX_CODE = 'LAX'

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(base: Date, days: number): string {
  return isoDate(new Date(base.getTime() + days * DAY))
}

/** Next given weekday (0=Sun) at least `minDays` from now. */
function nextWeekday(base: Date, weekday: number, minDays: number): string {
  const d = new Date(base.getTime() + minDays * DAY)
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() + 1)
  return isoDate(d)
}

function plusNights(start: string, nights: number): string {
  return isoDate(new Date(Date.parse(`${start}T00:00:00Z`) + nights * DAY))
}

interface Place {
  city: string
  country: string
  cc: string
  region: Region
  airport: string
}

function place(city: string, airport: string, region?: Region): Place {
  const a = getAirport(airport)
  return { city, country: a?.countryName ?? '', cc: a?.countryCode ?? '', region: region ?? a?.region ?? 'north_america', airport }
}

interface DemoFlight {
  slug: string
  from: string
  to: Place
  start: string
  airline: string
  program: string
  miles: number
  taxes: number | null
  cash: number
  flight: Partial<FlightDetails> & Pick<FlightDetails, 'cabin'>
  cash_product?: Partial<CashProduct>
  tags: string[]
  why: string
  bonus?: number
  deadline?: { at: Date; source: string }
  firstSeenDaysAgo?: number
  cashSource?: string
}

interface DemoHotel {
  slug: string
  at: Place
  start: string
  nights: number
  property: string
  program: string
  points: number
  mandatory: number | null
  cash: number
  hotel: Partial<HotelDetails> & Pick<HotelDetails, 'roomType'>
  cash_product?: Partial<CashProduct>
  tags: string[]
  why: string
  kind?: 'hotel' | 'package'
  deadline?: { at: Date; source: string }
  firstSeenDaysAgo?: number
  cashSource?: string
  missing?: string[]
}

function flightRow(f: DemoFlight, now: Date): DealInsert {
  const dest = getAirport(f.to.airport)
  const flight: FlightDetails = {
    seatType: 'unknown',
    flightNumbers: [],
    connectionMinutes: [],
    aircraftVerified: false,
    ...f.flight,
  }
  return {
    dedupeKey: `demo:${f.slug}`,
    kind: 'flight',
    title: `${f.airline} — ${f.flight.cabin === 'first' ? 'First' : f.flight.cabin === 'business' ? 'Business' : 'Economy'} to ${f.to.city}`,
    destCity: f.to.city,
    destCountry: f.to.country,
    destCountryCode: f.to.cc,
    destRegion: f.to.region,
    destAirport: f.to.airport,
    destLat: dest?.lat ?? null,
    destLon: dest?.lon ?? null,
    originAirport: f.from,
    providerName: f.airline,
    programId: f.program,
    programPoints: f.miles,
    mandatoryCashUsd: f.taxes,
    comparableCashUsd: f.cash,
    comparableCashSource: f.cashSource ?? 'owner_observed',
    comparableCashObservedAt: now,
    travelStart: f.start,
    flexibleDates: false,
    flight,
    cashProduct: { cabin: f.flight.cabin, seatType: flight.seatType, origin: f.from, destination: f.to.airport, date: f.start, ...f.cash_product },
    tags: f.tags,
    sourceKind: 'demo',
    sourceName: 'Demo data (fictional)',
    availability: 'available',
    deadlineType: f.deadline ? 'confirmed' : 'observed',
    deadlineAt: f.deadline?.at ?? null,
    deadlineSource: f.deadline?.source ?? null,
    deadlineTimezone: f.deadline ? 'America/Los_Angeles' : null,
    whyNoteworthy: f.why,
    assumedBonusPercent: f.bonus ?? null,
    firstSeenAt: new Date(now.getTime() - (f.firstSeenDaysAgo ?? 10) * DAY),
    lastSeenAt: now,
    collectedAt: now,
  }
}

function hotelRow(h: DemoHotel, now: Date): DealInsert {
  const a = getAirport(h.at.airport)
  const end = plusNights(h.start, h.nights)
  const hotel: HotelDetails = { property: h.property, roomVerified: false, guests: 2, ...h.hotel }
  return {
    dedupeKey: `demo:${h.slug}`,
    kind: h.kind ?? 'hotel',
    title: `${h.property} — ${h.nights} nights`,
    destCity: h.at.city,
    destCountry: h.at.country,
    destCountryCode: h.at.cc,
    destRegion: h.at.region,
    destAirport: h.at.airport,
    destLat: a?.lat ?? null,
    destLon: a?.lon ?? null,
    providerName: h.property,
    programId: h.program,
    programPoints: h.points,
    mandatoryCashUsd: h.mandatory,
    comparableCashUsd: h.cash,
    comparableCashSource: h.cashSource ?? 'owner_observed',
    comparableCashObservedAt: now,
    travelStart: h.start,
    travelEnd: end,
    nights: h.nights,
    hotel,
    cashProduct: { property: h.property, roomType: hotel.roomType, guests: hotel.guests, checkIn: h.start, checkOut: end, ...h.cash_product },
    tags: h.tags,
    sourceKind: 'demo',
    sourceName: 'Demo data (fictional)',
    availability: 'available',
    missingInfo: h.missing ?? [],
    deadlineType: h.deadline ? 'confirmed' : 'observed',
    deadlineAt: h.deadline?.at ?? null,
    deadlineSource: h.deadline?.source ?? null,
    deadlineTimezone: h.deadline ? 'America/Los_Angeles' : null,
    whyNoteworthy: h.why,
    firstSeenAt: new Date(now.getTime() - (h.firstSeenDaysAgo ?? 10) * DAY),
    lastSeenAt: now,
    collectedAt: now,
  }
}

export function buildDemoDeals(now: Date): DealInsert[] {
  const LAX = LAX_CODE
  const tokyo = place('Tokyo', 'HND')
  const male = place('Malé', 'MLE')
  const tulum = place('Tulum', 'TQO')
  const lisbon = place('Lisbon', 'LIS')
  const la = place('Los Angeles', 'LAX')

  const tokyoStart = addDays(now, 45)
  const maleStart = addDays(now, 60)
  const tulumStart = addDays(now, 30)

  const flights: DemoFlight[] = [
    {
      slug: 'tokyo-business',
      from: LAX,
      to: tokyo,
      start: tokyoStart,
      airline: 'Aurora Air (fictional)',
      program: 'aeroplan',
      miles: 75_000,
      taxes: 180,
      cash: 5_200,
      bonus: 25,
      flight: { cabin: 'business', seatType: 'lie_flat', flightNumbers: ['AU 101'], aircraft: 'Boeing 787-9 (unverified)', stops: 0, durationMinutes: 11 * 60 + 40, directAisleAccess: true },
      tags: ['city', 'culture', 'food', 'photography'],
      why: 'Fictional example from the product spec: a $5,200 lie-flat fare for 60,000 Chase points with an illustrative 25% transfer bonus — about 8.37¢ per point.',
      firstSeenDaysAgo: 2,
    },
    {
      slug: 'tokyo-business-return',
      from: 'HND',
      to: la,
      start: plusNights(tokyoStart, 5),
      airline: 'Aurora Air (fictional)',
      program: 'aeroplan',
      miles: 75_000,
      taxes: 120,
      cash: 4_800,
      bonus: 25,
      flight: { cabin: 'business', seatType: 'lie_flat', flightNumbers: ['AU 102'], stops: 0, durationMinutes: 10 * 60 + 5 },
      tags: ['city'],
      why: 'Fictional return leg so the Trip Architect can assemble a complete Tokyo trip.',
    },
    {
      slug: 'maldives-business',
      from: LAX,
      to: male,
      start: maleStart,
      airline: 'Coral Wings (fictional)',
      program: 'flying_blue',
      miles: 85_000,
      taxes: 220,
      cash: 6_900,
      flight: { cabin: 'business', seatType: 'lie_flat', flightNumbers: ['CW 8', 'CW 412'], stops: 1, connectionMinutes: [150], durationMinutes: 22 * 60 },
      tags: ['beach', 'island', 'romantic'],
      why: 'Fictional one-stop lie-flat itinerary to the Maldives at under 9¢ per point.',
      firstSeenDaysAgo: 4,
    },
    {
      slug: 'maldives-business-return',
      from: 'MLE',
      to: la,
      start: plusNights(maleStart, 4),
      airline: 'Coral Wings (fictional)',
      program: 'flying_blue',
      miles: 85_000,
      taxes: 260,
      cash: 6_400,
      flight: { cabin: 'business', seatType: 'lie_flat', stops: 1, connectionMinutes: [180], durationMinutes: 23 * 60 },
      tags: ['beach'],
      why: 'Fictional return leg.',
    },
    {
      slug: 'paris-first',
      from: LAX,
      to: place('Paris', 'CDG'),
      start: addDays(now, 75),
      airline: 'Lumière Airways (fictional)',
      program: 'flying_blue',
      miles: 120_000,
      taxes: 520,
      cash: 11_500,
      flight: { cabin: 'first', seatType: 'suite', flightNumbers: ['LU 65'], stops: 0, durationMinutes: 11 * 60, directAisleAccess: true },
      tags: ['city', 'food', 'culture', 'romantic', 'luxury'],
      why: 'Fictional first-class suite with a fictional confirmed booking deadline in 3 days — shows the countdown.',
      deadline: { at: new Date(now.getTime() + 3 * DAY + 5 * 3_600_000), source: 'Demo promotion (fictional)' },
      firstSeenDaysAgo: 1,
    },
    {
      slug: 'lisbon-from-jfk',
      from: 'JFK',
      to: lisbon,
      start: addDays(now, 50),
      airline: 'Atlântico Air (fictional)',
      program: 'iberia',
      miles: 34_000,
      taxes: 260,
      cash: 3_300,
      flight: { cabin: 'business', seatType: 'lie_flat', stops: 0, durationMinutes: 6 * 60 + 50 },
      tags: ['city', 'food', 'culture', 'hidden_gem'],
      why: 'Fictional off-peak business award from New York — requires positioning from Southern California.',
    },
    {
      slug: 'lisbon-from-lax',
      from: LAX,
      to: lisbon,
      start: addDays(now, 50),
      airline: 'Atlântico Air (fictional)',
      program: 'iberia',
      miles: 68_000,
      taxes: 300,
      cash: 4_100,
      flight: { cabin: 'business', seatType: 'lie_flat', stops: 1, connectionMinutes: [120], durationMinutes: 14 * 60 },
      tags: ['city', 'food', 'culture'],
      why: 'Fictional home-airport alternative to compare against positioning to JFK.',
    },
    {
      slug: 'queenstown-business',
      from: LAX,
      to: place('Queenstown', 'ZQN'),
      start: addDays(now, 95),
      airline: 'Southern Cross Air (fictional)',
      program: 'united',
      miles: 88_000,
      taxes: 95,
      cash: 7_400,
      flight: { cabin: 'business', seatType: 'lie_flat', stops: 1, connectionMinutes: [135], durationMinutes: 15 * 60 + 30 },
      tags: ['mountains', 'adventure', 'scenic', 'photography'],
      why: 'Fictional long-haul adventure award.',
    },
    {
      slug: 'cape-town-business',
      from: LAX,
      to: place('Cape Town', 'CPT'),
      start: addDays(now, 110),
      airline: 'Fynbos Airways (fictional)',
      program: 'virgin_atlantic',
      miles: 85_000,
      taxes: 450,
      cash: 7_900,
      flight: { cabin: 'business', seatType: 'lie_flat', stops: 1, connectionMinutes: [200], durationMinutes: 21 * 60, mixedCabin: true },
      tags: ['wildlife', 'scenic', 'food', 'adventure'],
      why: 'Fictional — includes a short economy segment (mixed cabin), which the app flags.',
    },
    {
      slug: 'singapore-suites',
      from: LAX,
      to: place('Singapore', 'SIN'),
      start: addDays(now, 130),
      airline: 'Merlion Air (fictional)',
      program: 'singapore',
      miles: 120_000,
      taxes: 80,
      cash: 16_800,
      flight: { cabin: 'first', seatType: 'suite', stops: 0, durationMinutes: 17 * 60 + 30 },
      tags: ['city', 'food', 'luxury'],
      why: 'Fictional — value above 12¢ triggers the “double-check the cash comparison” warning.',
      cashSource: 'published_fare',
    },
    {
      slug: 'maui-economy',
      from: 'SAN',
      to: place('Maui', 'OGG'),
      start: addDays(now, 40),
      airline: 'Trade Wind Air (fictional)',
      program: 'southwest',
      miles: 28_000,
      taxes: 6,
      cash: 420,
      flight: { cabin: 'economy', seatType: 'standard', stops: 0, durationMinutes: 5 * 60 + 50 },
      tags: ['beach', 'scenic'],
      why: 'Fictional fare-based award — value stays near 1.5¢ because points track the cash price.',
    },
    {
      slug: 'tulum-out',
      from: LAX,
      to: tulum,
      start: tulumStart,
      airline: 'Jaguar Air (fictional)',
      program: 'united',
      miles: 30_000,
      taxes: 6,
      cash: 780,
      flight: { cabin: 'business', seatType: 'recliner', stops: 0, durationMinutes: 4 * 60 + 50 },
      tags: ['beach', 'wellness'],
      why: 'Fictional short-haul recliner business seat — part of a trip that fits a 150k-point budget.',
    },
    {
      slug: 'tulum-return',
      from: 'TQO',
      to: la,
      start: plusNights(tulumStart, 4),
      airline: 'Jaguar Air (fictional)',
      program: 'united',
      miles: 30_000,
      taxes: 40,
      cash: 760,
      flight: { cabin: 'business', seatType: 'recliner', stops: 0, durationMinutes: 5 * 60 + 20 },
      tags: ['beach'],
      why: 'Fictional return leg.',
    },
  ]

  const hotels: DemoHotel[] = [
    {
      slug: 'tokyo-hotel',
      at: tokyo,
      start: tokyoStart,
      nights: 5,
      property: 'Shibuya Sky House (fictional)',
      program: 'hyatt',
      points: 90_000,
      mandatory: 0,
      cash: 3_900,
      hotel: { roomType: 'standard', roomCategory: 'King room, city view', programCategory: 'Category 6', isStandardAward: true },
      tags: ['city', 'food', 'luxury'],
      why: 'Fictional hotel matched to the Tokyo flight dates.',
    },
    {
      slug: 'maldives-overwater',
      at: male,
      start: maleStart,
      nights: 4,
      property: 'Lagoon House Maldives (fictional)',
      program: 'hyatt',
      points: 140_000,
      mandatory: 900,
      cash: 9_600,
      hotel: { roomType: 'overwater_villa', roomCategory: 'Overwater villa', mandatoryTransfer: 'Seaplane, $900 round trip (fictional)', mandatoryTransferUsd: 900, programCategory: 'Category 8', isStandardAward: false },
      tags: ['beach', 'island', 'overwater', 'luxury', 'romantic', 'private_pool'],
      why: 'Fictional overwater villa where the award really is the villa (not a standard room).',
      firstSeenDaysAgo: 3,
    },
    {
      slug: 'bora-bora-weak',
      at: place('Bora Bora', 'BOB'),
      start: addDays(now, 85),
      nights: 5,
      property: 'Motu Pearl Resort (fictional)',
      program: 'marriott',
      points: 500_000,
      mandatory: 450,
      cash: 7_500,
      hotel: { roomType: 'overwater_villa', roomCategory: 'Overwater bungalow', resortFeeUsd: 450 },
      tags: ['beach', 'island', 'overwater', 'luxury', 'romantic'],
      why: 'Fictional — looks spectacular but redeems at about 1.4¢: an example of a deal not worth your points.',
    },
    {
      slug: 'kyoto-ryokan',
      at: place('Kyoto', 'KIX'),
      start: addDays(now, 70),
      nights: 3,
      property: 'Ryokan Hanami (fictional)',
      program: 'hyatt',
      points: 90_000,
      mandatory: 0,
      cash: 4_200,
      hotel: { roomType: 'suite', roomCategory: 'Garden suite with onsen', meals: 'Breakfast and kaiseki dinner', programCategory: 'Category 8' },
      cash_product: { mealsIncluded: true },
      tags: ['culture', 'unique_stay', 'food', 'romantic', 'luxury'],
      why: 'Fictional traditional inn with private onsen.',
    },
    {
      slug: 'reykjavik-weekend',
      at: place('Reykjavík', 'KEF'),
      start: nextWeekday(now, 4, 14),
      nights: 3,
      property: 'Aurora Glass Lodge (fictional)',
      program: 'ihg',
      points: 90_000,
      mandatory: 0,
      cash: 1_900,
      hotel: { roomType: 'premium', roomCategory: 'Glass-roof cabin' },
      tags: ['snow', 'scenic', 'photography', 'unique_stay', 'romantic'],
      why: 'Fictional Thursday–Sunday northern-lights escape.',
    },
    {
      slug: 'patagonia-lodge',
      at: place('Puerto Natales', 'PNT'),
      start: addDays(now, 120),
      nights: 4,
      property: 'Torres Wild Lodge (fictional)',
      program: 'hyatt',
      points: 100_000,
      mandatory: 0,
      cash: 5_200,
      hotel: { roomType: 'suite', roomCategory: 'All-inclusive suite', meals: 'All meals and guided excursions' },
      cash_product: { mealsIncluded: true },
      tags: ['adventure', 'wildlife', 'scenic', 'hidden_gem', 'mountains', 'photography'],
      why: 'Fictional all-inclusive lodge at the edge of a national park — a hidden sweet spot.',
    },
    {
      slug: 'seychelles-villa',
      at: place('Mahé', 'SEZ'),
      start: addDays(now, 100),
      nights: 5,
      property: 'Coco de Mer Villas (fictional)',
      program: 'marriott',
      points: 300_000,
      mandatory: 0,
      cash: 6_000,
      hotel: { roomType: 'pool_villa', roomCategory: 'Ocean pool villa' },
      tags: ['beach', 'island', 'private_pool', 'luxury', 'romantic'],
      why: 'Fictional pool villa at about 2¢ per point.',
    },
    {
      slug: 'santorini-suite',
      at: place('Santorini', 'JTR'),
      start: addDays(now, 150),
      nights: 3,
      property: 'Caldera Cave Suites (fictional)',
      program: 'hyatt',
      points: 105_000,
      mandatory: 0,
      cash: 3_900,
      hotel: { roomType: 'suite', roomCategory: 'Cave suite with plunge pool' },
      tags: ['romantic', 'scenic', 'photography', 'beach', 'private_pool'],
      why: 'Fictional cliffside suite.',
    },
    {
      slug: 'arusha-safari',
      kind: 'package',
      at: place('Arusha', 'JRO'),
      start: addDays(now, 140),
      nights: 7,
      property: 'Serengeti Horizon Safari Package (fictional)',
      program: 'chase_travel',
      points: 360_000,
      mandatory: 0,
      cash: 3_600,
      hotel: { roomType: 'suite', roomCategory: 'Tented suite, full board', meals: 'Full board' },
      cash_product: { mealsIncluded: true },
      tags: ['safari', 'wildlife', 'adventure', 'photography'],
      why: 'Fictional package booked through Chase Travel at 1¢ per point — the honest baseline for comparison.',
    },
    {
      slug: 'banff-weekend',
      at: place('Banff', 'YYC'),
      start: nextWeekday(now, 5, 21),
      nights: 2,
      property: 'Spruce Peak Lodge (fictional)',
      program: 'marriott',
      points: 120_000,
      mandatory: 0,
      cash: 1_450,
      hotel: { roomType: 'standard', roomCategory: 'Mountain-view king' },
      tags: ['snow', 'mountains', 'scenic'],
      why: 'Fictional — a pretty weekend but weak value (about 1.2¢).',
    },
    {
      slug: 'tulum-villa',
      at: tulum,
      start: tulumStart,
      nights: 4,
      property: 'Selva Cenote Villas (fictional)',
      program: 'hyatt',
      points: 60_000,
      mandatory: 0,
      cash: 2_900,
      hotel: { roomType: 'pool_villa', roomCategory: 'Jungle pool villa' },
      tags: ['beach', 'wellness', 'hidden_gem', 'private_pool', 'romantic'],
      why: 'Fictional pool villa — the Trip Architect can fit flights + villa into 150,000 points.',
    },
    {
      slug: 'amalfi-rack-rate',
      at: place('Positano', 'NAP'),
      start: addDays(now, 160),
      nights: 4,
      property: 'Positano Terrace (fictional)',
      program: 'ihg',
      points: 280_000,
      mandatory: 0,
      cash: 9_800,
      cashSource: 'rack_rate',
      hotel: { roomType: 'premium', roomCategory: 'Sea-view room' },
      tags: ['romantic', 'scenic', 'food', 'luxury'],
      why: 'Fictional — compared against an advertised rack rate, so the value is flagged as possibly inflated.',
    },
    {
      slug: 'rovaniemi-igloo',
      at: place('Rovaniemi', 'RVN'),
      start: addDays(now, 12),
      nights: 3,
      property: 'Arctic Glass Igloo (fictional)',
      program: 'hyatt',
      points: 75_000,
      mandatory: 0,
      cash: 2_700,
      hotel: { roomType: 'premium', roomCategory: 'Glass igloo' },
      tags: ['snow', 'unique_stay', 'photography', 'romantic'],
      why: 'Fictional last-minute stay with a fictional deadline less than a day away.',
      deadline: { at: new Date(now.getTime() + 20 * 3_600_000), source: 'Demo promotion (fictional)' },
      firstSeenDaysAgo: 0,
    },
    {
      slug: 'fiji-mismatch',
      at: place('Nadi', 'NAN'),
      start: addDays(now, 90),
      nights: 5,
      property: 'Reef Lagoon Fiji (fictional)',
      program: 'ihg',
      points: 250_000,
      mandatory: 0,
      cash: 4_800,
      hotel: { roomType: 'standard', roomCategory: 'Garden room (standard award)' },
      cash_product: { roomType: 'overwater_villa' },
      tags: ['beach', 'island', 'overwater'],
      why: 'Fictional — the cash price is for an overwater villa but the award is a garden room, so value cannot be reliably calculated.',
    },
    {
      slug: 'mexico-city-weekend',
      at: place('Mexico City', 'MEX'),
      start: nextWeekday(now, 5, 7),
      nights: 2,
      property: 'Casa Roma Courtyard (fictional)',
      program: 'hyatt',
      points: 24_000,
      mandatory: 0,
      cash: 780,
      hotel: { roomType: 'standard', roomCategory: 'Courtyard king' },
      tags: ['city', 'food', 'culture', 'hidden_gem'],
      why: 'Fictional boutique weekend at about 3¢ per point.',
    },
    {
      slug: 'costa-rica-treehouse',
      at: place('Liberia', 'LIR'),
      start: addDays(now, 65),
      nights: 4,
      property: 'Cloud Forest Treehouse (fictional)',
      program: 'marriott',
      points: 160_000,
      mandatory: 0,
      cash: 2_400,
      hotel: { roomType: 'villa', roomCategory: 'Treehouse villa' },
      tags: ['wildlife', 'adventure', 'unique_stay', 'scenic'],
      why: 'Fictional unique stay at about 1.5¢.',
    },
    {
      slug: 'marrakech-missing-taxes',
      at: place('Marrakesh', 'RAK'),
      start: addDays(now, 80),
      nights: 3,
      property: 'Riad Saffron (fictional)',
      program: 'hyatt',
      points: 45_000,
      mandatory: null,
      cash: 1_650,
      hotel: { roomType: 'suite', roomCategory: 'Courtyard suite' },
      tags: ['culture', 'food', 'hidden_gem', 'unique_stay'],
      why: 'Fictional — taxes and fees are unknown, so the app refuses to calculate a value.',
      missing: ['Taxes and fees'],
    },
  ]

  return [...flights.map((f) => flightRow(f, now)), ...hotels.map((h) => hotelRow(h, now)), ...pastDemoDeals(now)]
}

/** Fictional expired/unavailable records that populate the History archive. */
function pastDemoDeals(now: Date): DealInsert[] {
  const bali = place('Bali', 'DPS')
  const athens = place('Athens', 'ATH')
  return [
    {
      ...hotelRow(
        {
          slug: 'bali-past',
          at: bali,
          start: addDays(now, -25),
          nights: 4,
          property: 'Uluwatu Cliff Villas (fictional)',
          program: 'hyatt',
          points: 80_000,
          mandatory: 0,
          cash: 3_600,
          hotel: { roomType: 'pool_villa', roomCategory: 'Cliff pool villa' },
          tags: ['beach', 'private_pool', 'romantic'],
          why: 'Fictional past deal for the archive.',
          firstSeenDaysAgo: 70,
        },
        now,
      ),
      archivedAt: new Date(now.getTime() - 24 * DAY),
      archiveReason: 'travel_date_passed',
      lastSeenAt: new Date(now.getTime() - 40 * DAY),
    },
    {
      ...flightRow(
        {
          slug: 'athens-gone',
          from: LAX_CODE,
          to: athens,
          start: addDays(now, 35),
          airline: 'Aegean Blue (fictional)',
          program: 'united',
          miles: 70_000,
          taxes: 110,
          cash: 5_100,
          flight: { cabin: 'business', seatType: 'lie_flat', stops: 1 },
          tags: ['culture', 'food', 'beach'],
          why: 'Fictional award that disappeared — kept in the missed-deals archive.',
          firstSeenDaysAgo: 30,
        },
        now,
      ),
      availability: 'unavailable',
      archivedAt: new Date(now.getTime() - 6 * DAY),
      archiveReason: 'availability_disappeared',
      lastSeenAt: new Date(now.getTime() - 6 * DAY),
    },
  ]
}


/** Fictional observation history so charts and calendars have something to show in demo mode. */
function demoHistory(dealId: string, basePoints: number, now: Date, days: number, seed: number) {
  const rows: InferInsertModel<typeof dealPriceHistory>[] = []
  let x = seed
  for (let i = days; i >= 0; i -= 2) {
    x = (x * 9301 + 49297) % 233280
    const r = x / 233280
    const available = r > 0.25
    const points = available ? Math.round((basePoints * (0.9 + r * 0.45)) / 500) * 500 : null
    rows.push({
      dealId,
      observedAt: new Date(now.getTime() - i * DAY),
      programPoints: points,
      availability: available ? 'available' : 'unavailable',
      mandatoryCashUsd: 180,
      source: 'demo',
    })
  }
  rows.push({ dealId, observedAt: now, programPoints: basePoints, availability: 'available', mandatoryCashUsd: 180, source: 'demo' })
  return rows
}

export async function seedDemoData(db: AppDb, now = new Date()): Promise<number> {
  const rows = buildDemoDeals(now)
  const inserted = await db.insert(deals).values(rows).onConflictDoNothing().returning({ id: deals.id, dedupeKey: deals.dedupeKey, programPoints: deals.programPoints })
  const history = inserted
    .filter((r) => ['demo:tokyo-business', 'demo:maldives-business', 'demo:paris-first'].includes(r.dedupeKey))
    .flatMap((r, i) => demoHistory(r.id, r.programPoints ?? 50_000, now, 90, 17 + i * 31))
  if (history.length) await db.insert(dealPriceHistory).values(history)
  return inserted.length
}

export async function removeDemoData(db: AppDb): Promise<void> {
  const ids = (await db.select({ id: deals.id }).from(deals).where(eq(deals.sourceKind, 'demo'))).map((r) => r.id)
  if (ids.length) await db.delete(deals).where(inArray(deals.id, ids))
}
