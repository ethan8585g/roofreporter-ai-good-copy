// Canadian province and territory data for SEO programmatic pages.
// Mirrors src/data/us-states.ts but adapts the storm profile, building code,
// and top-insurer fields for the Canadian market.
// Sources: StatsCan population (2024), Environment & Climate Change Canada
// (hail/storm frequency), IBC/NBC 2020 + provincial amendments, CHRC.

export interface CAProvinceData {
  name: string
  code: string         // two-letter postal abbreviation (e.g. 'AB')
  slug: string
  capital: string
  population: number   // 2024 StatsCan estimate
  metros: string[]     // top 5-8 by population
  stormProfile: {
    hailDaysPerYear: number
    winterSeverity: 'extreme' | 'high' | 'moderate' | 'low'
    coastalRisk: 'high' | 'moderate' | 'low' | 'none'
    avgClaimsPerYear: string
    primaryPeril: string
  }
  buildingCode: {
    adopted: string
    notes: string
  }
  roofingNotes: string
  topInsurers: string[]
}

export const CA_PROVINCES: Record<string, CAProvinceData> = {
  'alberta': {
    name: 'Alberta', code: 'AB', slug: 'alberta', capital: 'Edmonton',
    population: 4849906,
    metros: ['Calgary', 'Edmonton', 'Red Deer', 'Lethbridge', 'St. Albert', 'Medicine Hat', 'Grande Prairie'],
    stormProfile: { hailDaysPerYear: 14, winterSeverity: 'high', coastalRisk: 'none', avgClaimsPerYear: '140,000+', primaryPeril: 'Hail — Calgary and surrounding region sit in one of North America\'s most active hail corridors' },
    buildingCode: { adopted: 'Alberta Building Code 2023 (based on NBC 2020)', notes: 'Class 4 impact-resistant shingles increasingly required by insurers after the 2020 and 2024 Calgary hailstorms' },
    roofingNotes: 'Alberta is the hail capital of Canada — the 2020 Calgary hailstorm alone caused $1.4B in insured damage. Re-roofing cycles of 8–12 years are common in the Calgary-to-Red Deer corridor. Impact-resistant Class 4 shingles are the recommended standard.',
    topInsurers: ['Intact Insurance', 'Aviva Canada', 'TD Insurance', 'Co-operators', 'Wawanesa', 'Economical'],
  },
  'british-columbia': {
    name: 'British Columbia', code: 'BC', slug: 'british-columbia', capital: 'Victoria',
    population: 5519013,
    metros: ['Vancouver', 'Surrey', 'Burnaby', 'Richmond', 'Abbotsford', 'Coquitlam', 'Kelowna', 'Victoria'],
    stormProfile: { hailDaysPerYear: 2, winterSeverity: 'moderate', coastalRisk: 'high', avgClaimsPerYear: '95,000+', primaryPeril: 'Atmospheric river rainfall, wind-driven rain, moss and organic degradation' },
    buildingCode: { adopted: 'BC Building Code 2024', notes: 'Step Code energy requirements apply in most municipalities; seismic requirements apply throughout the South Coast' },
    roofingNotes: 'BC roofing is dominated by water management rather than hail. Heavy rainfall and coastal humidity accelerate moss growth on asphalt shingles, shortening service life. Metal and cedar shake roofs remain popular in the Lower Mainland and Vancouver Island.',
    topInsurers: ['Intact Insurance', 'ICBC', 'BCAA', 'TD Insurance', 'Aviva Canada', 'Co-operators'],
  },
  'manitoba': {
    name: 'Manitoba', code: 'MB', slug: 'manitoba', capital: 'Winnipeg',
    population: 1484135,
    metros: ['Winnipeg', 'Brandon', 'Steinbach', 'Thompson', 'Portage la Prairie', 'Winkler'],
    stormProfile: { hailDaysPerYear: 9, winterSeverity: 'extreme', coastalRisk: 'none', avgClaimsPerYear: '48,000+', primaryPeril: 'Extreme cold, ice dams, summer hail corridor' },
    buildingCode: { adopted: 'Manitoba Building Code (NBC 2020 with provincial amendments)', notes: 'Ice-and-water-shield membrane required 600mm past the interior wall line; high snow-load ratings per region' },
    roofingNotes: 'Winnipeg and southern Manitoba see both severe hail storms in July–August and 40°C temperature swings seasonally. Ice dam remediation is a recurring winter revenue stream for contractors. Architectural 50-year shingles are the standard.',
    topInsurers: ['MPI (Auto)', 'Wawanesa', 'Intact Insurance', 'Co-operators', 'The Personal', 'TD Insurance'],
  },
  'new-brunswick': {
    name: 'New Brunswick', code: 'NB', slug: 'new-brunswick', capital: 'Fredericton',
    population: 834691,
    metros: ['Moncton', 'Saint John', 'Fredericton', 'Dieppe', 'Riverview', 'Bathurst'],
    stormProfile: { hailDaysPerYear: 3, winterSeverity: 'high', coastalRisk: 'moderate', avgClaimsPerYear: '28,000+', primaryPeril: 'Coastal wind, nor\'easters, ice loading' },
    buildingCode: { adopted: 'National Building Code of Canada 2020 (adopted directly)', notes: 'Wind speed zones along Bay of Fundy require uplift-rated fastening and sealed laminate shingles' },
    roofingNotes: 'Coastal wind exposure along the Bay of Fundy and the Northumberland Strait drives the need for wind-uplift-rated roofing assemblies. Nor\'easters in January–March are the dominant loss driver. Metal roofing common in rural areas.',
    topInsurers: ['Intact Insurance', 'Co-operators', 'Aviva Canada', 'TD Insurance', 'RSA Canada'],
  },
  'newfoundland-and-labrador': {
    name: 'Newfoundland and Labrador', code: 'NL', slug: 'newfoundland-and-labrador', capital: 'St. John\'s',
    population: 540418,
    metros: ['St. John\'s', 'Conception Bay South', 'Mount Pearl', 'Paradise', 'Corner Brook', 'Grand Falls-Windsor'],
    stormProfile: { hailDaysPerYear: 1, winterSeverity: 'extreme', coastalRisk: 'high', avgClaimsPerYear: '18,000+', primaryPeril: 'Hurricane-remnant wind, extreme coastal snow loads, freezing rain' },
    buildingCode: { adopted: 'National Building Code of Canada 2020 (adopted directly)', notes: 'Highest snow loads in Atlantic Canada; sealed eave ice-and-water shield mandatory' },
    roofingNotes: 'St. John\'s metro experiences hurricane-remnant wind events nearly every autumn. Heavy wet snow loads are a primary roofing concern. Steep-slope metal roofs dominate new construction. Re-roofing cycles shortened by wind scouring.',
    topInsurers: ['Intact Insurance', 'Co-operators', 'RSA Canada', 'TD Insurance', 'Wawanesa'],
  },
  'nova-scotia': {
    name: 'Nova Scotia', code: 'NS', slug: 'nova-scotia', capital: 'Halifax',
    population: 1072545,
    metros: ['Halifax', 'Sydney', 'Dartmouth', 'Truro', 'New Glasgow', 'Kentville'],
    stormProfile: { hailDaysPerYear: 2, winterSeverity: 'high', coastalRisk: 'high', avgClaimsPerYear: '34,000+', primaryPeril: 'Post-tropical storms (Fiona, Dorian, Juan), coastal wind, wet snow' },
    buildingCode: { adopted: 'Nova Scotia Building Code Regulations (NBC 2020 base)', notes: 'Post-Fiona amendments added wind-uplift requirements in coastal communities' },
    roofingNotes: 'Post-tropical storms are now the dominant roofing-loss event in Nova Scotia. Hurricane Fiona (2022) generated $800M+ in insured roofing damage. Wind-uplift assemblies and reinforced ridge/hip fastening are standard practice in Halifax and Cape Breton.',
    topInsurers: ['Intact Insurance', 'Co-operators', 'Aviva Canada', 'RSA Canada', 'TD Insurance'],
  },
  'ontario': {
    name: 'Ontario', code: 'ON', slug: 'ontario', capital: 'Toronto',
    population: 15996989,
    metros: ['Toronto', 'Ottawa', 'Mississauga', 'Brampton', 'Hamilton', 'London', 'Markham', 'Vaughan', 'Kitchener', 'Windsor'],
    stormProfile: { hailDaysPerYear: 7, winterSeverity: 'high', coastalRisk: 'none', avgClaimsPerYear: '620,000+', primaryPeril: 'Ice storms, freeze-thaw, wind events along Great Lakes corridor' },
    buildingCode: { adopted: 'Ontario Building Code (2024 updates)', notes: 'Toronto-area snow load 1.3 kPa; Barrie-Kingston corridor requires sealed eave membrane 900mm minimum' },
    roofingNotes: 'Ontario is the largest Canadian roofing market by volume. The 2013 Toronto ice storm exposed systemic failures in eave ice-dam control — every policy renewal since has tightened requirements. Architectural shingles are standard; synthetic slate growing rapidly in Oakville-to-Kitchener suburban markets.',
    topInsurers: ['Intact Insurance', 'Aviva Canada', 'Desjardins', 'TD Insurance', 'Economical', 'Co-operators'],
  },
  'prince-edward-island': {
    name: 'Prince Edward Island', code: 'PE', slug: 'prince-edward-island', capital: 'Charlottetown',
    population: 176113,
    metros: ['Charlottetown', 'Summerside', 'Stratford', 'Cornwall', 'Montague'],
    stormProfile: { hailDaysPerYear: 1, winterSeverity: 'high', coastalRisk: 'high', avgClaimsPerYear: '6,000+', primaryPeril: 'Post-tropical storm wind, heavy wet snow, salt-driven degradation' },
    buildingCode: { adopted: 'National Building Code of Canada 2020 (adopted directly)', notes: 'Island-wide wind exposure — no interior wind-shelter zones; uplift-rated fastening standard' },
    roofingNotes: 'Small but wind-exposed market. Hurricane Fiona damaged roofing on roughly 20% of PEI homes in 2022. Asphalt architectural shingles dominate the residential market; metal roofing popular in agricultural and heritage applications.',
    topInsurers: ['Intact Insurance', 'Co-operators', 'Aviva Canada', 'RSA Canada', 'TD Insurance'],
  },
  'quebec': {
    name: 'Quebec', code: 'QC', slug: 'quebec', capital: 'Québec City',
    population: 9030684,
    metros: ['Montréal', 'Québec City', 'Laval', 'Gatineau', 'Longueuil', 'Sherbrooke', 'Saguenay', 'Lévis', 'Trois-Rivières'],
    stormProfile: { hailDaysPerYear: 5, winterSeverity: 'extreme', coastalRisk: 'low', avgClaimsPerYear: '380,000+', primaryPeril: 'Ice dams, freeze-thaw cycling, heavy wet snow, freezing rain' },
    buildingCode: { adopted: 'Code de construction du Québec — Chapitre I Bâtiment (CNB 2015 modifié)', notes: 'Regie du Bâtiment du Québec (RBQ) licence required for all roofing contractors; double-layer eave protection required' },
    roofingNotes: 'Quebec has the most demanding winter roofing climate in populated Canada. Ice dam mitigation, double-layer eave protection, and proper attic ventilation are regulatory and insurance priorities. Elastomeric membranes dominate flat-roof Montreal plexes; architectural shingles on single-family suburbs.',
    topInsurers: ['Desjardins', 'Intact Insurance', 'Industrial Alliance (iA)', 'La Capitale', 'Promutuel', 'Aviva Canada'],
  },
  'saskatchewan': {
    name: 'Saskatchewan', code: 'SK', slug: 'saskatchewan', capital: 'Regina',
    population: 1231043,
    metros: ['Saskatoon', 'Regina', 'Prince Albert', 'Moose Jaw', 'Swift Current', 'Yorkton'],
    stormProfile: { hailDaysPerYear: 11, winterSeverity: 'extreme', coastalRisk: 'none', avgClaimsPerYear: '62,000+', primaryPeril: 'Prairie hail corridor, blizzards, extreme cold snap freeze damage' },
    buildingCode: { adopted: 'National Building Code of Canada 2020 (adopted directly)', notes: 'Saskatchewan operates under SGI roofing damage guidelines; Class 4 impact-resistant products recommended' },
    roofingNotes: 'Saskatoon and Regina sit inside the Prairie hail belt that extends north from Alberta. Claims frequency peaks June–August. SGI publishes hail maps that directly influence premium pricing. Architectural 40-year shingles with Class 4 upgrades are the emerging standard.',
    topInsurers: ['SGI Canada', 'Intact Insurance', 'Wawanesa', 'Co-operators', 'TD Insurance'],
  },
  'northwest-territories': {
    name: 'Northwest Territories', code: 'NT', slug: 'northwest-territories', capital: 'Yellowknife',
    population: 45074,
    metros: ['Yellowknife', 'Hay River', 'Inuvik', 'Fort Smith', 'Behchokǫ̀'],
    stormProfile: { hailDaysPerYear: 1, winterSeverity: 'extreme', coastalRisk: 'low', avgClaimsPerYear: '1,500+', primaryPeril: 'Permafrost settlement, extreme cold, heavy snow loads' },
    buildingCode: { adopted: 'National Building Code of Canada 2020 + GNWT modifications', notes: 'Permafrost-adaptive foundations affect roof framing movement tolerance' },
    roofingNotes: 'Northern roofing is dominated by thermal and structural movement from permafrost. Metal roofing is standard in Yellowknife and Hay River. Satellite measurement is essential given the remoteness — on-site assessment costs often exceed the report itself.',
    topInsurers: ['Intact Insurance', 'Co-operators', 'Aviva Canada', 'TD Insurance'],
  },
  'nunavut': {
    name: 'Nunavut', code: 'NU', slug: 'nunavut', capital: 'Iqaluit',
    population: 41070,
    metros: ['Iqaluit', 'Rankin Inlet', 'Arviat', 'Baker Lake', 'Cambridge Bay'],
    stormProfile: { hailDaysPerYear: 0, winterSeverity: 'extreme', coastalRisk: 'moderate', avgClaimsPerYear: '600+', primaryPeril: 'Permafrost movement, polar vortex cold, blizzard wind' },
    buildingCode: { adopted: 'National Building Code of Canada 2020 + Nunavut amendments', notes: 'Foundation and envelope requirements dominated by permafrost; roof assemblies sized for differential movement' },
    roofingNotes: 'Iqaluit and the Kivalliq communities rely on flown-in materials. Metal standing-seam roofing dominates. Satellite measurement is essentially the only viable pre-quote workflow given the distances involved.',
    topInsurers: ['Intact Insurance', 'Co-operators', 'Aviva Canada'],
  },
  'yukon': {
    name: 'Yukon', code: 'YT', slug: 'yukon', capital: 'Whitehorse',
    population: 45750,
    metros: ['Whitehorse', 'Dawson City', 'Watson Lake', 'Haines Junction', 'Carmacks'],
    stormProfile: { hailDaysPerYear: 1, winterSeverity: 'extreme', coastalRisk: 'none', avgClaimsPerYear: '1,200+', primaryPeril: 'Mountain snow loads, extreme cold, rapid temperature swings' },
    buildingCode: { adopted: 'National Building Code of Canada 2020 + Yukon amendments', notes: 'Mountain snow-load zones around Whitehorse and Dawson require engineered rafter sizing' },
    roofingNotes: 'Whitehorse has Canada\'s driest climate among the territories but extreme seasonal snow loads. Metal roofing and engineered truss designs are standard. Log home re-roofing is a specialized local market.',
    topInsurers: ['Intact Insurance', 'Co-operators', 'Aviva Canada', 'TD Insurance'],
  },
}

export const ALL_PROVINCE_SLUGS: string[] = Object.keys(CA_PROVINCES)
