// Australia state/territory data for SEO programmatic pages.
// Mirrors src/data/us-states.ts / ca-provinces.ts for the AU market.
// Sources: ABS 2024 population estimates, Bureau of Meteorology climatology,
// NCC (National Construction Code) 2022 Volume Two + wind-region maps
// AS/NZS 1170.2, ICA (Insurance Council of Australia) catastrophe database.

export interface AURegionData {
  name: string
  code: string
  slug: string
  capital: string
  population: number        // 2024 ABS estimate
  metros: string[]
  weatherProfile: {
    hailDaysPerYear: number
    cycloneRisk: 'high' | 'moderate' | 'low' | 'none'
    bushfireRisk: 'high' | 'moderate' | 'low'
    primaryPeril: string
  }
  buildingCode: {
    adopted: string
    windRegion: string        // AS/NZS 1170.2 region (A1..D)
    notes: string
  }
  roofingNotes: string
  topInsurers: string[]
}

export const AU_REGIONS: Record<string, AURegionData> = {
  'new-south-wales': {
    name: 'New South Wales', code: 'NSW', slug: 'new-south-wales', capital: 'Sydney',
    population: 8495435,
    metros: ['Sydney', 'Newcastle', 'Wollongong', 'Central Coast', 'Coffs Harbour', 'Wagga Wagga'],
    weatherProfile: {
      hailDaysPerYear: 6,
      cycloneRisk: 'low',
      bushfireRisk: 'high',
      primaryPeril: 'Severe thunderstorm hail (the 1999 Sydney hailstorm remains Australia\'s costliest insured event at $5.6B in today\'s dollars) and bushfire ember attack on roof cavities',
    },
    buildingCode: {
      adopted: 'NCC 2022 Volume Two + BASIX (NSW-specific energy overlay)',
      windRegion: 'A2 (most of Sydney basin); A1 for inland NSW',
      notes: 'NSW is one of the most hail-exposed regions in Australia. Metal roofing (Colorbond) dominates new construction; concrete and terracotta tile are common on pre-2000 stock.',
    },
    roofingNotes: 'Sydney-metro roofing insurance claims skew overwhelmingly to hail. BAL (Bushfire Attack Level) compliance now mandatory for re-roofing in designated fire zones — restricts gutter guards and vent types. Satellite measurement tools must cope with dense terracotta tile that renders poorly on some imagery layers.',
    topInsurers: ['NRMA Insurance (IAG)', 'Allianz Australia', 'Suncorp AAMI', 'QBE Australia', 'Budget Direct', 'Youi'],
  },
  'victoria': {
    name: 'Victoria', code: 'VIC', slug: 'victoria', capital: 'Melbourne',
    population: 7010859,
    metros: ['Melbourne', 'Geelong', 'Ballarat', 'Bendigo', 'Shepparton', 'Mildura'],
    weatherProfile: {
      hailDaysPerYear: 5,
      cycloneRisk: 'none',
      bushfireRisk: 'high',
      primaryPeril: 'Bushfire ember ignition and severe thunderstorm hail (2020 Melbourne hailstorm: $1.04B insured damage)',
    },
    buildingCode: {
      adopted: 'NCC 2022 Volume Two + Victorian-specific 7-star NatHERS energy rating',
      windRegion: 'A2 for Melbourne + greater regional VIC',
      notes: 'Victoria led the NCC 7-star energy overhaul (May 2024). Replacement roofs trigger a BAL assessment in fire-declared areas — a major compliance driver since Black Saturday (2009).',
    },
    roofingNotes: 'Melbourne\'s extensive terrace and inter-war housing stock relies heavily on terracotta and slate re-roofing — specialist trades. Post-bushfire roof replacements account for a measurable share of annual claim volume; ember-resistant roof/gutter assemblies are the compliance hot spot.',
    topInsurers: ['RACV Insurance', 'NRMA Insurance', 'AAMI (Suncorp)', 'Allianz Australia', 'QBE', 'Youi'],
  },
  'queensland': {
    name: 'Queensland', code: 'QLD', slug: 'queensland', capital: 'Brisbane',
    population: 5560540,
    metros: ['Brisbane', 'Gold Coast', 'Sunshine Coast', 'Townsville', 'Cairns', 'Toowoomba', 'Mackay'],
    weatherProfile: {
      hailDaysPerYear: 8,
      cycloneRisk: 'high',
      bushfireRisk: 'moderate',
      primaryPeril: 'Tropical cyclone wind (North QLD, Tully to Cape York), severe SE-QLD thunderstorm hail, and post-cyclone flood damage',
    },
    buildingCode: {
      adopted: 'NCC 2022 Volume Two + Queensland Development Code (cyclone-region amendments)',
      windRegion: 'C (coast from Bundaberg north) + D (Cairns/Far North); A for inland SE-QLD',
      notes: 'Coastal Queensland is the only major populated zone in Australia subject to cyclonic wind design (regions C and D). Ridge and eave fixings are engineered specifically for cyclonic uplift.',
    },
    roofingNotes: 'North Queensland re-roofs post-cyclone regularly (Yasi 2011, Debbie 2017, Jasper 2023). Metal sheet dominates because of wind performance. The Queensland market is the highest-technical of the Australian roofing markets; satellite reports save considerable travel time to remote cyclone-damage sites.',
    topInsurers: ['Suncorp AAMI', 'RACQ Insurance', 'NRMA Insurance', 'Allianz Australia', 'QBE', 'CGU'],
  },
  'western-australia': {
    name: 'Western Australia', code: 'WA', slug: 'western-australia', capital: 'Perth',
    population: 2980875,
    metros: ['Perth', 'Mandurah', 'Bunbury', 'Geraldton', 'Kalgoorlie', 'Broome', 'Karratha'],
    weatherProfile: {
      hailDaysPerYear: 3,
      cycloneRisk: 'high',
      bushfireRisk: 'high',
      primaryPeril: 'Tropical cyclone wind on the Pilbara/Kimberley coast (cyclone Ilsa 2023 hit 218 km/h sustained), coastal bushfire, and Perth-area severe storms',
    },
    buildingCode: {
      adopted: 'NCC 2022 Volume Two + BCA-WA amendments',
      windRegion: 'D (Pilbara coast) + C (Kimberley coast) + A for Perth metro',
      notes: 'WA has the fastest cyclonic design regions anywhere on the Australian continent. Remote Pilbara contractors rely on satellite-delivered measurement because road access to mining-town sites is costly.',
    },
    roofingNotes: 'Perth suburban re-roofs are dominated by Colorbond replacement of pre-1990 terracotta. Remote Pilbara jobs often use temperature-resistant metal with enhanced UV-grade coatings. The distances involved make pre-quote satellite measurement a clear cost saver.',
    topInsurers: ['RAC Insurance', 'Suncorp AAMI', 'NRMA Insurance', 'Allianz Australia', 'QBE', 'Budget Direct'],
  },
  'south-australia': {
    name: 'South Australia', code: 'SA', slug: 'south-australia', capital: 'Adelaide',
    population: 1853716,
    metros: ['Adelaide', 'Mount Gambier', 'Whyalla', 'Port Augusta', 'Port Lincoln'],
    weatherProfile: {
      hailDaysPerYear: 3,
      cycloneRisk: 'none',
      bushfireRisk: 'high',
      primaryPeril: 'Bushfire-driven roof damage (Cudlee Creek 2019, Kangaroo Island 2020) and severe Adelaide thunderstorm events',
    },
    buildingCode: {
      adopted: 'NCC 2022 Volume Two + Ministerial Building Standards (SA)',
      windRegion: 'A2 for Adelaide and settled areas',
      notes: 'SA\'s dry heat drives tile-and-metal roofing degradation faster than temperate zones. BAL compliance mandatory for hills-face and Fleurieu/Adelaide Hills zones.',
    },
    roofingNotes: 'Adelaide has a well-maintained mid-20th-century roofing stock approaching end-of-life — the steady re-roofing demand is consistent year-round. Metal roofing accounts for ~60% of re-roofs; cement-composite tile the balance.',
    topInsurers: ['RAA Insurance', 'Suncorp AAMI', 'NRMA Insurance', 'Allianz Australia', 'QBE'],
  },
  'tasmania': {
    name: 'Tasmania', code: 'TAS', slug: 'tasmania', capital: 'Hobart',
    population: 575345,
    metros: ['Hobart', 'Launceston', 'Devonport', 'Burnie'],
    weatherProfile: {
      hailDaysPerYear: 4,
      cycloneRisk: 'none',
      bushfireRisk: 'high',
      primaryPeril: 'Cold-front wind events, heavy rainfall on west coast, and bushfire ember attack during summer',
    },
    buildingCode: {
      adopted: 'NCC 2022 Volume Two + Tasmanian Director\'s Determination on Building',
      windRegion: 'A1/A2 statewide',
      notes: 'Tasmania has the most demanding rainfall shedding requirements in Australia. Cyclone risk is nil; cold-front and orographic rainfall is the designed-for peril.',
    },
    roofingNotes: 'Hobart and the Huon Valley retain large volumes of corrugated-iron heritage roofing, which is now a conservation-category re-roof category. Steep pitches (30-45°) are the norm because of rainfall intensity.',
    topInsurers: ['RACT Insurance', 'NRMA Insurance', 'Suncorp AAMI', 'Allianz Australia', 'QBE'],
  },
  'australian-capital-territory': {
    name: 'Australian Capital Territory', code: 'ACT', slug: 'australian-capital-territory', capital: 'Canberra',
    population: 479850,
    metros: ['Canberra', 'Tuggeranong', 'Belconnen', 'Gungahlin'],
    weatherProfile: {
      hailDaysPerYear: 5,
      cycloneRisk: 'none',
      bushfireRisk: 'high',
      primaryPeril: 'Summer hailstorm events (Canberra 2020 hailstorm cost $1.65B in insured damage) and ember-attack bushfire risk',
    },
    buildingCode: {
      adopted: 'NCC 2022 Volume Two + ACT Appendix',
      windRegion: 'A2',
      notes: 'The 2020 Canberra hailstorm was the most expensive single insurance event in ACT history. Many replacement roofs in the city are now specifying hail-impact-resistant metal rib profiles.',
    },
    roofingNotes: 'ACT roofing claims are overwhelmingly hail-driven. The re-roofing surge following 2020 has tapered, but Class-4 equivalent impact-resistant specification is now a deliberate homeowner choice rather than an oddity. The territory\'s small size means satellite coverage is uniformly high-quality.',
    topInsurers: ['NRMA Insurance', 'Suncorp AAMI', 'Allianz Australia', 'Budget Direct', 'QBE'],
  },
  'northern-territory': {
    name: 'Northern Territory', code: 'NT', slug: 'northern-territory', capital: 'Darwin',
    population: 252473,
    metros: ['Darwin', 'Palmerston', 'Alice Springs', 'Katherine'],
    weatherProfile: {
      hailDaysPerYear: 1,
      cycloneRisk: 'high',
      bushfireRisk: 'moderate',
      primaryPeril: 'Tropical cyclone wind (Darwin sits in region C), wet-season monsoon rainfall, and heat-driven UV roof degradation',
    },
    buildingCode: {
      adopted: 'NCC 2022 Volume Two + NT Deemed-to-Satisfy amendments',
      windRegion: 'C (Darwin + Top End); B for Alice Springs',
      notes: 'Darwin roofing has been cyclone-engineered since Cyclone Tracy (1974). Connection schedules and fixing frequencies are tightly specified under the NT-specific deemed-to-satisfy provisions.',
    },
    roofingNotes: 'NT roofing is almost exclusively engineered metal sheet with cyclone-rated fixings. The construction industry is small, skilled, and satellite-measurement-native — remote measurement is not a luxury but a logistical necessity.',
    topInsurers: ['TIO (Territory Insurance)', 'Suncorp AAMI', 'Allianz Australia', 'NRMA Insurance', 'QBE'],
  },
}

export const ALL_AU_REGION_SLUGS: string[] = Object.keys(AU_REGIONS)
