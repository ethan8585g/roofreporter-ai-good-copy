// United Kingdom regional data for SEO programmatic pages.
// Mirrors src/data/us-states.ts / ca-provinces.ts for the UK market.
// Covers the four home nations plus a shortlist of major English regions.
// Sources: ONS 2024 population estimates, Met Office climatology,
// Approved Documents (England/Wales) + Scottish Technical Handbook +
// NI Technical Booklet building-regs references, ABI insurance data.

export interface UKRegionData {
  name: string
  code: string
  slug: string
  capital: string
  population: number        // 2024 ONS estimate
  metros: string[]
  weatherProfile: {
    rainDaysPerYear: number
    stormRisk: 'high' | 'moderate' | 'low'
    flooding: 'high' | 'moderate' | 'low'
    primaryPeril: string
  }
  buildingCode: {
    adopted: string
    notes: string
  }
  roofingNotes: string
  topInsurers: string[]
}

export const UK_REGIONS: Record<string, UKRegionData> = {
  'england': {
    name: 'England', code: 'ENG', slug: 'england', capital: 'London',
    population: 57106398,
    metros: ['London', 'Birmingham', 'Manchester', 'Leeds', 'Sheffield', 'Bristol', 'Liverpool', 'Newcastle upon Tyne'],
    weatherProfile: {
      rainDaysPerYear: 133,
      stormRisk: 'moderate',
      flooding: 'high',
      primaryPeril: 'Wind-driven rain (Storm Ciarán, Storm Isha and equivalent Atlantic systems), surface-water flooding, and moss growth on slate and clay roofs',
    },
    buildingCode: {
      adopted: 'Approved Document C + Approved Document L (2022) + BS 5534:2014 (slating and tiling)',
      notes: 'Pitched-roof tiling fixings have been tightened under BS 5534 post-2014; Part L 2022 requires improved insulation U-values on replacement roofs.',
    },
    roofingNotes: 'English roofing is dominated by pitched tile + slate rather than shingles. Re-roofing cycles of 60-80 years for natural slate, 30-50 for concrete tile. Storm-driven tile slip remains the single largest insurance loss line. Measurement software must support UK projection conventions (gauge, lap, tile count per m²).',
    topInsurers: ['Aviva', 'Direct Line', 'Admiral', 'LV=', 'AXA UK', 'NFU Mutual', 'Allianz UK', 'Zurich UK'],
  },
  'scotland': {
    name: 'Scotland', code: 'SCT', slug: 'scotland', capital: 'Edinburgh',
    population: 5490100,
    metros: ['Glasgow', 'Edinburgh', 'Aberdeen', 'Dundee', 'Inverness', 'Stirling'],
    weatherProfile: {
      rainDaysPerYear: 170,
      stormRisk: 'high',
      flooding: 'moderate',
      primaryPeril: 'North Atlantic storm wind (100+ mph gusts), heavy rainfall, and wind-driven snow in the Highlands',
    },
    buildingCode: {
      adopted: 'Scottish Technical Handbook — Domestic + Non-Domestic (Section 3 Environment, Section 6 Energy)',
      notes: 'Scotland has its own building standards separate from the Approved Documents in England and Wales. Snow-load design is critical above 300m.',
    },
    roofingNotes: 'Scottish roofing emphasises wind-uplift resistance and rainfall shedding. Natural slate dominates the traditional tenement stock in Glasgow and Edinburgh. Many pitched roofs require sarking board beneath battens — a Scottish practice not seen south of the border. Storm Arwen (2021) alone generated £59M in insured roof damage.',
    topInsurers: ['Aviva', 'Direct Line', 'Admiral', 'Tesco Bank Home', 'Halifax', 'NFU Mutual Scotland'],
  },
  'wales': {
    name: 'Wales', code: 'WLS', slug: 'wales', capital: 'Cardiff',
    population: 3164400,
    metros: ['Cardiff', 'Swansea', 'Newport', 'Wrexham', 'Bangor'],
    weatherProfile: {
      rainDaysPerYear: 175,
      stormRisk: 'high',
      flooding: 'high',
      primaryPeril: 'Coastal Atlantic wind events, heavy orographic rainfall in Snowdonia/Brecon Beacons, and persistent damp creating roof-decay concerns',
    },
    buildingCode: {
      adopted: 'Approved Document C + Approved Document L (Wales 2022) + BS 5534:2014',
      notes: 'Approved Documents in Wales mirror England post-2014 with Welsh-specific amendments. Part L Wales has tighter insulation U-values than England 2022.',
    },
    roofingNotes: 'Welsh slate is the historic standard and remains the premium re-roofing material for listed buildings. Heavy annual rainfall accelerates moss and algae growth; re-roofing cycles trend shorter than England. Cardiff and Swansea coastal properties experience the highest wind-uplift claim volume.',
    topInsurers: ['Aviva', 'Admiral', 'LV=', 'Direct Line', 'NFU Mutual', 'Zurich UK'],
  },
  'northern-ireland': {
    name: 'Northern Ireland', code: 'NIR', slug: 'northern-ireland', capital: 'Belfast',
    population: 1910543,
    metros: ['Belfast', 'Derry/Londonderry', 'Lisburn', 'Newtownabbey', 'Bangor'],
    weatherProfile: {
      rainDaysPerYear: 160,
      stormRisk: 'moderate',
      flooding: 'moderate',
      primaryPeril: 'Atlantic storm wind, sustained rainfall, and coastal salt load',
    },
    buildingCode: {
      adopted: 'Northern Ireland Technical Booklets (Part A through Part V)',
      notes: 'Northern Ireland operates its own Technical Booklets under the NI Building Regulations (2012 consolidated + amendments). Part C covers weather resistance; Part F covers energy (wider than England\'s Part L split).',
    },
    roofingNotes: 'Northern Irish roofing is mostly concrete tile and natural slate, with metal profiled roofing common on agricultural and newer commercial stock. The market is smaller than England, so satellite measurement tools face lower baseline adoption — meaningful opportunity for early movers.',
    topInsurers: ['Aviva', 'AXA Ireland', 'FBD', 'Zurich Ireland', 'Allianz NI', 'Direct Line'],
  },
}

export const ALL_UK_REGION_SLUGS: string[] = Object.keys(UK_REGIONS)
