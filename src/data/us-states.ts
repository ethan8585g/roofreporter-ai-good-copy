// US state data for SEO programmatic pages
// Sources: US Census, NOAA, IBHS, state insurance departments (as of 2026)

export interface USStateData {
  name: string
  code: string
  slug: string
  capital: string
  population: number  // 2024 estimate
  metros: string[]    // top 5-8 by population
  stormProfile: {
    hailDaysPerYear: number
    hurricaneRisk: 'high' | 'moderate' | 'low' | 'none'
    tornadoRisk: 'high' | 'moderate' | 'low' | 'none'
    avgClaimsPerYear: string
    primaryPeril: string
  }
  buildingCode: {
    adoptedIRC: string
    notes: string
  }
  roofingNotes: string
  topInsurers: string[]
}

export const US_STATES: Record<string, USStateData> = {
  'alabama': {
    name: 'Alabama', code: 'AL', slug: 'alabama', capital: 'Montgomery',
    population: 5108468,
    metros: ['Birmingham', 'Huntsville', 'Montgomery', 'Mobile', 'Tuscaloosa'],
    stormProfile: { hailDaysPerYear: 12, hurricaneRisk: 'moderate', tornadoRisk: 'high', avgClaimsPerYear: '180,000+', primaryPeril: 'Tornadoes and hurricane remnants' },
    buildingCode: { adoptedIRC: 'IRC 2021', notes: 'Wind speed maps per ASCE 7-22 required' },
    roofingNotes: 'High tornado frequency increases demand for impact-resistant shingles and Class 4 products. Hurricane exposure along Gulf Coast drives re-roofing cycles.',
    topInsurers: ['State Farm', 'Allstate', 'USAA', 'Farmers', 'Liberty Mutual']
  },
  'alaska': {
    name: 'Alaska', code: 'AK', slug: 'alaska', capital: 'Juneau',
    population: 733583,
    metros: ['Anchorage', 'Fairbanks', 'Juneau', 'Sitka', 'Ketchikan'],
    stormProfile: { hailDaysPerYear: 2, hurricaneRisk: 'none', tornadoRisk: 'none', avgClaimsPerYear: '25,000+', primaryPeril: 'Heavy snow loads and freeze-thaw cycles' },
    buildingCode: { adoptedIRC: 'IRC 2018', notes: 'Snow load design critical; varies by region' },
    roofingNotes: 'Snow load calculations are the primary roofing concern. Low-slope roofing common due to snow shedding requirements. Remote areas rely on satellite measurement tools.',
    topInsurers: ['State Farm', 'USAA', 'Allstate', 'Farmers', 'Progressive']
  },
  'arizona': {
    name: 'Arizona', code: 'AZ', slug: 'arizona', capital: 'Phoenix',
    population: 7431344,
    metros: ['Phoenix', 'Tucson', 'Mesa', 'Chandler', 'Scottsdale', 'Tempe', 'Glendale'],
    stormProfile: { hailDaysPerYear: 8, hurricaneRisk: 'none', tornadoRisk: 'low', avgClaimsPerYear: '220,000+', primaryPeril: 'Monsoon hail, haboob damage, UV degradation' },
    buildingCode: { adoptedIRC: 'IRC 2018', notes: 'Tile roofing dominant; tile-specific fastening requirements' },
    roofingNotes: 'Monsoon season (July–September) generates hail and high-wind claims. UV degradation is severe at 300+ sun days/year. Concrete and clay tile roofing dominate the Phoenix metro.',
    topInsurers: ['State Farm', 'USAA', 'Allstate', 'Travelers', 'Farmers']
  },
  'arkansas': {
    name: 'Arkansas', code: 'AR', slug: 'arkansas', capital: 'Little Rock',
    population: 3067732,
    metros: ['Little Rock', 'Fort Smith', 'Fayetteville', 'Springdale', 'Jonesboro'],
    stormProfile: { hailDaysPerYear: 15, hurricaneRisk: 'low', tornadoRisk: 'high', avgClaimsPerYear: '130,000+', primaryPeril: 'Tornado corridor hail and wind' },
    buildingCode: { adoptedIRC: 'IRC 2021', notes: 'Tornado alley wind provisions required' },
    roofingNotes: 'Located in the southern tornado alley. Frequent hail storms from April through June. Asphalt shingles are standard; Class 4 impact-resistant products gaining market share.',
    topInsurers: ['State Farm', 'Farmers', 'Allstate', 'USAA', 'Liberty Mutual']
  },
  'california': {
    name: 'California', code: 'CA', slug: 'california', capital: 'Sacramento',
    population: 39538223,
    metros: ['Los Angeles', 'San Diego', 'San Jose', 'San Francisco', 'Fresno', 'Sacramento', 'Oakland', 'Long Beach'],
    stormProfile: { hailDaysPerYear: 4, hurricaneRisk: 'none', tornadoRisk: 'none', avgClaimsPerYear: '400,000+', primaryPeril: 'Wildfire debris, atmospheric river flooding, wind-driven rain' },
    buildingCode: { adoptedIRC: 'California Residential Code (CRC) 2022', notes: 'Most stringent energy code in US (T24); wildfire interface zones (WUI) have Class A roofing requirements' },
    roofingNotes: 'Wildland-urban interface (WUI) zones require Class A fire-rated roofing — a significant re-roofing driver. Solar installations are mandated on most new builds. Satellite measurement is essential for complex hillside rooflines.',
    topInsurers: ['State Farm', 'Allstate', 'Farmers', 'USAA', 'Travelers']
  },
  'colorado': {
    name: 'Colorado', code: 'CO', slug: 'colorado', capital: 'Denver',
    population: 5877610,
    metros: ['Denver', 'Colorado Springs', 'Aurora', 'Fort Collins', 'Lakewood', 'Thornton', 'Westminster', 'Boulder'],
    stormProfile: { hailDaysPerYear: 44, hurricaneRisk: 'none', tornadoRisk: 'moderate', avgClaimsPerYear: '350,000+', primaryPeril: 'Hail — one of the highest hail-claim frequencies in the US' },
    buildingCode: { adoptedIRC: 'IRC 2021', notes: 'Many jurisdictions mandate Class 4 hail-resistant roofing for insurance discounts' },
    roofingNotes: 'Colorado is one of the top 3 US states for hail damage claims. The Denver metro averages one major hail event per year. Class 4 impact-resistant shingles are the standard recommendation. Re-roofing cycles of 5–8 years are common in hail corridors.',
    topInsurers: ['State Farm', 'Allstate', 'USAA', 'Farmers', 'Nationwide']
  },
  'connecticut': {
    name: 'Connecticut', code: 'CT', slug: 'connecticut', capital: 'Hartford',
    population: 3605944,
    metros: ['Bridgeport', 'New Haven', 'Hartford', 'Stamford', 'Waterbury', 'Norwalk'],
    stormProfile: { hailDaysPerYear: 6, hurricaneRisk: 'moderate', tornadoRisk: 'low', avgClaimsPerYear: '90,000+', primaryPeril: 'Nor\'easters, ice dams, hurricane remnants' },
    buildingCode: { adoptedIRC: 'IRC 2021', notes: 'Ice barrier requirements for low-slope areas' },
    roofingNotes: 'Ice dam damage is a major concern. Steep-slope asphalt shingles dominate. Nor\'easters and post-hurricane events generate significant roofing claims.',
    topInsurers: ['State Farm', 'Travelers', 'Allstate', 'USAA', 'Liberty Mutual']
  },
  'delaware': {
    name: 'Delaware', code: 'DE', slug: 'delaware', capital: 'Dover',
    population: 1031890,
    metros: ['Wilmington', 'Dover', 'Newark', 'Middletown', 'Smyrna'],
    stormProfile: { hailDaysPerYear: 7, hurricaneRisk: 'moderate', tornadoRisk: 'low', avgClaimsPerYear: '40,000+', primaryPeril: 'Coastal storms and hurricane remnants' },
    buildingCode: { adoptedIRC: 'IRC 2021', notes: 'Coastal construction wind provisions' },
    roofingNotes: 'Mid-Atlantic coastal exposure. Nor\'easters and tropical system remnants drive re-roofing cycles. Asphalt shingles with Class D wind resistance are standard.',
    topInsurers: ['State Farm', 'Allstate', 'USAA', 'Erie Insurance', 'Travelers']
  },
  'florida': {
    name: 'Florida', code: 'FL', slug: 'florida', capital: 'Tallahassee',
    population: 22610726,
    metros: ['Miami', 'Tampa', 'Orlando', 'Jacksonville', 'Fort Lauderdale', 'West Palm Beach', 'Sarasota', 'Fort Myers'],
    stormProfile: { hailDaysPerYear: 6, hurricaneRisk: 'high', tornadoRisk: 'moderate', avgClaimsPerYear: '1,500,000+', primaryPeril: 'Hurricanes — highest hurricane exposure of any US state' },
    buildingCode: { adoptedFBC: 'Florida Building Code 8th Edition 2023', notes: 'Most stringent wind load requirements in US outside of Hawaii; hip roofs required in high-wind zones; permits required for any re-roofing' },
    roofingNotes: 'Florida accounts for more insurance claims than any other US state. Hurricane Ian (2022) generated $110B+ in losses. The Florida Building Code requires permits for re-roofing, and satellite measurement reports are accepted as documentation by adjusters and insurers. Tile and metal roofing have grown significantly post-Ian.',
    topInsurers: ['Citizens Property Insurance', 'Universal Property', 'Slide Insurance', 'State Farm', 'Allstate']
  },
  'georgia': {
    name: 'Georgia', code: 'GA', slug: 'georgia', capital: 'Atlanta',
    population: 11029227,
    metros: ['Atlanta', 'Augusta', 'Columbus', 'Macon', 'Savannah', 'Athens', 'Sandy Springs'],
    stormProfile: { hailDaysPerYear: 10, hurricaneRisk: 'moderate', tornadoRisk: 'moderate', avgClaimsPerYear: '280,000+', primaryPeril: 'Severe thunderstorm hail, tornado outbreaks, hurricane remnants' },
    buildingCode: { adoptedIRC: 'IRC 2021', notes: 'Coastal high hazard zones under FBC equivalents' },
    roofingNotes: 'Atlanta is a top 5 US market for roofing contractors. Severe thunderstorm seasons in spring and fall generate consistent hail claims. Coastal Georgia faces hurricane exposure.',
    topInsurers: ['State Farm', 'Allstate', 'USAA', 'Farmers', 'Nationwide']
  },
  'hawaii': {
    name: 'Hawaii', code: 'HI', slug: 'hawaii', capital: 'Honolulu',
    population: 1440196,
    metros: ['Honolulu', 'Pearl City', 'Hilo', 'Kailua', 'Waipahu'],
    stormProfile: { hailDaysPerYear: 1, hurricaneRisk: 'moderate', tornadoRisk: 'none', avgClaimsPerYear: '30,000+', primaryPeril: 'Hurricane wind, volcanic ash, corrosion from salt air' },
    buildingCode: { adoptedIRC: 'Hawaii State Building Code', notes: 'Highest wind design requirements in US; hurricane provisions mandatory' },
    roofingNotes: 'Metal roofing is dominant due to salt air corrosion and hurricane resistance. Re-roofing cycles driven by corrosion rather than impact damage. Satellite measurement is critical for complex terrain.',
    topInsurers: ['USAA', 'State Farm', 'Allstate', 'DTRIC Insurance', 'First Insurance']
  },
  'idaho': {
    name: 'Idaho', code: 'ID', slug: 'idaho', capital: 'Boise',
    population: 1939033,
    metros: ['Boise', 'Meridian', 'Nampa', 'Idaho Falls', 'Pocatello', 'Caldwell'],
    stormProfile: { hailDaysPerYear: 10, hurricaneRisk: 'none', tornadoRisk: 'low', avgClaimsPerYear: '55,000+', primaryPeril: 'Hail, heavy snow loads, wildfire ember exposure' },
    buildingCode: { adoptedIRC: 'IRC 2018', notes: 'WUI (wildfire interface) zones require Class A roofing' },
    roofingNotes: 'Boise metro is growing rapidly with significant new construction. Hail damage and snow load are the primary roofing perils. WUI zones expanding as urban growth pushes into foothills.',
    topInsurers: ['State Farm', 'Farmers', 'USAA', 'Allstate', 'Travelers']
  },
  'illinois': {
    name: 'Illinois', code: 'IL', slug: 'illinois', capital: 'Springfield',
    population: 12582032,
    metros: ['Chicago', 'Aurora', 'Joliet', 'Naperville', 'Rockford', 'Springfield', 'Peoria', 'Elgin'],
    stormProfile: { hailDaysPerYear: 18, hurricaneRisk: 'none', tornadoRisk: 'moderate', avgClaimsPerYear: '400,000+', primaryPeril: 'Hail belt, severe thunderstorms, ice dams in winter' },
    buildingCode: { adoptedIRC: 'IRC 2021 via Chicago Building Code for city; IRC 2018 elsewhere', notes: 'Chicago has additional wind provisions' },
    roofingNotes: 'Illinois sits in the hail belt with 18+ significant hail days per year. Chicago\'s flat and low-slope roofing market is one of the largest in the US. Ice dams are a secondary winter peril.',
    topInsurers: ['State Farm', 'Allstate', 'Country Financial', 'USAA', 'Farmers']
  },
  'indiana': {
    name: 'Indiana', code: 'IN', slug: 'indiana', capital: 'Indianapolis',
    population: 6833037,
    metros: ['Indianapolis', 'Fort Wayne', 'Evansville', 'South Bend', 'Carmel', 'Fishers'],
    stormProfile: { hailDaysPerYear: 16, hurricaneRisk: 'none', tornadoRisk: 'moderate', avgClaimsPerYear: '220,000+', primaryPeril: 'Hail and tornado corridor' },
    buildingCode: { adoptedIRC: 'IRC 2020', notes: 'Tornado-rated products increasingly common in new builds' },
    roofingNotes: 'Indiana sits at the northern edge of tornado alley. Hail is the dominant roofing peril. Indianapolis is a significant contractor market. Class 4 shingles adopted widely post-2020.',
    topInsurers: ['State Farm', 'USAA', 'Allstate', 'Farmers', 'Travelers']
  },
  'iowa': {
    name: 'Iowa', code: 'IA', slug: 'iowa', capital: 'Des Moines',
    population: 3190369,
    metros: ['Des Moines', 'Cedar Rapids', 'Davenport', 'Sioux City', 'Iowa City', 'Waterloo'],
    stormProfile: { hailDaysPerYear: 20, hurricaneRisk: 'none', tornadoRisk: 'high', avgClaimsPerYear: '180,000+', primaryPeril: 'Hail belt — one of the highest hail-day averages in the Midwest' },
    buildingCode: { adoptedIRC: 'IRC 2018', notes: 'No statewide amendments; municipalities may vary' },
    roofingNotes: 'Iowa averages 20 hail days per year — among the highest in the US. The 2020 derecho caused $11B in damage across Iowa. Cedar Rapids and Des Moines are active contractor markets.',
    topInsurers: ['State Farm', 'Farmers', 'USAA', 'IMT Insurance', 'Grinnell Mutual']
  },
  'kansas': {
    name: 'Kansas', code: 'KS', slug: 'kansas', capital: 'Topeka',
    population: 2940865,
    metros: ['Wichita', 'Overland Park', 'Kansas City', 'Topeka', 'Olathe', 'Lawrence'],
    stormProfile: { hailDaysPerYear: 25, hurricaneRisk: 'none', tornadoRisk: 'high', avgClaimsPerYear: '200,000+', primaryPeril: 'Hail belt core — Wichita is one of the most hail-impacted metros in the US' },
    buildingCode: { adoptedIRC: 'IRC 2018', notes: 'Wichita has adopted enhanced wind provisions' },
    roofingNotes: 'Wichita sits at the heart of the US hail belt. Kansas ranks in the top 5 nationally for hail damage claims per capita. Re-roofing cycles of 5–10 years are common. Class 4 shingles are standard in most contractor bids.',
    topInsurers: ['State Farm', 'Farmers', 'USAA', 'Allstate', 'Shelter Insurance']
  },
  'kentucky': {
    name: 'Kentucky', code: 'KY', slug: 'kentucky', capital: 'Frankfort',
    population: 4512310,
    metros: ['Louisville', 'Lexington', 'Bowling Green', 'Owensboro', 'Covington'],
    stormProfile: { hailDaysPerYear: 12, hurricaneRisk: 'none', tornadoRisk: 'moderate', avgClaimsPerYear: '150,000+', primaryPeril: 'Severe thunderstorm hail and tornado outbreaks' },
    buildingCode: { adoptedIRC: 'IRC 2018', notes: 'State amendments for seismic zone 2 areas in western KY' },
    roofingNotes: 'Louisville and Lexington are growing contractor markets. Tornado outbreaks (including the 2021 western Kentucky tornado) drive periodic demand spikes.',
    topInsurers: ['State Farm', 'Kentucky Farm Bureau', 'USAA', 'Allstate', 'Farmers']
  },
  'louisiana': {
    name: 'Louisiana', code: 'LA', slug: 'louisiana', capital: 'Baton Rouge',
    population: 4573749,
    metros: ['New Orleans', 'Baton Rouge', 'Shreveport', 'Metairie', 'Lafayette', 'Lake Charles'],
    stormProfile: { hailDaysPerYear: 5, hurricaneRisk: 'high', tornadoRisk: 'moderate', avgClaimsPerYear: '300,000+', primaryPeril: 'Hurricanes — Katrina (2005), Laura (2020), Ida (2021)' },
    buildingCode: { adoptedIRC: 'IRC 2021', notes: 'Post-Katrina wind speed maps; coastal parishes under SFJBCC' },
    roofingNotes: 'Louisiana\'s entire coastal zone has hurricane exposure. Hurricane Ida (2021) generated $75B+ in losses. Metal and impact-resistant roofing have surged since 2005. Satellite measurement is widely used in post-storm documentation.',
    topInsurers: ['State Farm', 'Allstate', 'USAA', 'Louisiana Citizens', 'Farmers']
  },
  'maine': {
    name: 'Maine', code: 'ME', slug: 'maine', capital: 'Augusta',
    population: 1395722,
    metros: ['Portland', 'Lewiston', 'Bangor', 'South Portland', 'Auburn'],
    stormProfile: { hailDaysPerYear: 4, hurricaneRisk: 'low', tornadoRisk: 'none', avgClaimsPerYear: '40,000+', primaryPeril: 'Ice dams, Nor\'easters, heavy snow loads' },
    buildingCode: { adoptedIRC: 'IRC 2021', notes: 'Snow load design critical; coastal wind provisions' },
    roofingNotes: 'Ice dam damage is the dominant roofing peril. Snow load calculations are mandatory. Metal roofing is popular for snow shedding. Satellite measurement tools reduce the need for on-roof inspections in winter.',
    topInsurers: ['State Farm', 'Allstate', 'USAA', 'Hanover Insurance', 'Travelers']
  },
  'maryland': {
    name: 'Maryland', code: 'MD', slug: 'maryland', capital: 'Annapolis',
    population: 6177224,
    metros: ['Baltimore', 'Frederick', 'Rockville', 'Gaithersburg', 'Bowie', 'Germantown'],
    stormProfile: { hailDaysPerYear: 8, hurricaneRisk: 'moderate', tornadoRisk: 'low', avgClaimsPerYear: '170,000+', primaryPeril: 'Severe thunderstorms, Nor\'easters, hurricane remnants' },
    buildingCode: { adoptedIRC: 'IRC 2021', notes: 'Coastal wind provisions for Chesapeake Bay and Atlantic areas' },
    roofingNotes: 'Baltimore is a major Mid-Atlantic roofing market. Roof replacement cycles driven by Nor\'easters and hurricane remnants. ENERGY STAR and solar incentives drive roofing upgrades.',
    topInsurers: ['State Farm', 'Allstate', 'USAA', 'Erie Insurance', 'Travelers']
  },
  'massachusetts': {
    name: 'Massachusetts', code: 'MA', slug: 'massachusetts', capital: 'Boston',
    population: 7029917,
    metros: ['Boston', 'Worcester', 'Springfield', 'Cambridge', 'Lowell', 'New Bedford', 'Brockton'],
    stormProfile: { hailDaysPerYear: 5, hurricaneRisk: 'moderate', tornadoRisk: 'low', avgClaimsPerYear: '200,000+', primaryPeril: 'Nor\'easters, ice dams, hurricane remnants' },
    buildingCode: { adoptedIRC: 'Massachusetts Stretch Energy Code (9th edition)', notes: 'Stringent energy requirements drive cool roof and solar installs' },
    roofingNotes: 'Boston metro has one of the highest roofing contractor densities in the US. Ice dam damage is the primary winter peril. Nor\'easters generate significant claims annually. ENERGY STAR requirements drive premium shingle adoption.',
    topInsurers: ['State Farm', 'Allstate', 'USAA', 'Safety Insurance', 'Travelers']
  },
  'michigan': {
    name: 'Michigan', code: 'MI', slug: 'michigan', capital: 'Lansing',
    population: 10077331,
    metros: ['Detroit', 'Grand Rapids', 'Warren', 'Sterling Heights', 'Ann Arbor', 'Lansing', 'Flint'],
    stormProfile: { hailDaysPerYear: 10, hurricaneRisk: 'none', tornadoRisk: 'moderate', avgClaimsPerYear: '250,000+', primaryPeril: 'Severe thunderstorm hail, ice dams, lake-effect snow' },
    buildingCode: { adoptedIRC: 'Michigan Residential Code 2015', notes: 'Ice barrier requirements for entire state' },
    roofingNotes: 'Detroit and Grand Rapids are significant roofing markets. Lake-effect snow causes ice dam issues in western Michigan. Spring hail season generates the highest claims volume.',
    topInsurers: ['State Farm', 'Allstate', 'USAA', 'Auto Club Group', 'Farmers']
  },
  'minnesota': {
    name: 'Minnesota', code: 'MN', slug: 'minnesota', capital: 'St. Paul',
    population: 5717184,
    metros: ['Minneapolis', 'St. Paul', 'Rochester', 'Duluth', 'Bloomington', 'Brooklyn Park', 'Plymouth'],
    stormProfile: { hailDaysPerYear: 17, hurricaneRisk: 'none', tornadoRisk: 'moderate', avgClaimsPerYear: '280,000+', primaryPeril: 'Hail belt, ice dams, severe spring thunderstorms' },
    buildingCode: { adoptedIRC: 'Minnesota Residential Code 2020', notes: 'Ice barrier mandatory from eave to 24" inside warm wall; stringent insulation requirements' },
    roofingNotes: 'Minneapolis is one of the top US markets for hail damage. Minnesota averages 17 hail days per year. Ice dam claims are a major secondary peril. Spring re-roofing season is extremely active.',
    topInsurers: ['State Farm', 'Farmers', 'USAA', 'Allstate', 'West Bend Mutual']
  },
  'mississippi': {
    name: 'Mississippi', code: 'MS', slug: 'mississippi', capital: 'Jackson',
    population: 2940057,
    metros: ['Jackson', 'Gulfport', 'Southaven', 'Hattiesburg', 'Biloxi', 'Meridian'],
    stormProfile: { hailDaysPerYear: 8, hurricaneRisk: 'high', tornadoRisk: 'high', avgClaimsPerYear: '130,000+', primaryPeril: 'Hurricanes (Gulf Coast) and tornado outbreaks' },
    buildingCode: { adoptedIRC: 'IRC 2015', notes: 'Coastal construction zone requirements' },
    roofingNotes: 'Mississippi Gulf Coast has hurricane exposure comparable to Louisiana. Tornado frequency inland is among the highest in the US. Older housing stock drives frequent re-roofing.',
    topInsurers: ['State Farm', 'Allstate', 'USAA', 'Mississippi Farm Bureau', 'Nationwide']
  },
  'missouri': {
    name: 'Missouri', code: 'MO', slug: 'missouri', capital: 'Jefferson City',
    population: 6177957,
    metros: ['Kansas City', 'St. Louis', 'Springfield', 'Columbia', "Lee's Summit", "O'Fallon"],
    stormProfile: { hailDaysPerYear: 20, hurricaneRisk: 'none', tornadoRisk: 'high', avgClaimsPerYear: '280,000+', primaryPeril: 'Hail belt, tornado corridor (Joplin 2011 EF5)' },
    buildingCode: { adoptedIRC: 'IRC 2018', notes: 'Post-Joplin tornado provisions in some jurisdictions' },
    roofingNotes: 'Missouri straddles the hail belt and tornado alley. The 2011 Joplin tornado resulted in $2.8B in roofing claims alone. Kansas City is a major contractor market with frequent hail-driven re-roofing.',
    topInsurers: ['State Farm', 'Shelter Insurance', 'USAA', 'Farmers', 'Allstate']
  },
  'montana': {
    name: 'Montana', code: 'MT', slug: 'montana', capital: 'Helena',
    population: 1122867,
    metros: ['Billings', 'Missoula', 'Great Falls', 'Bozeman', 'Butte'],
    stormProfile: { hailDaysPerYear: 12, hurricaneRisk: 'none', tornadoRisk: 'low', avgClaimsPerYear: '45,000+', primaryPeril: 'Hail, high winds, heavy snow loads' },
    buildingCode: { adoptedIRC: 'IRC 2021', notes: 'Snow load design varies widely by elevation and region' },
    roofingNotes: 'Montana\'s low population but high storm frequency creates concentrated contractor demand. Bozeman is a rapidly growing market. Snow load is critical in mountain areas.',
    topInsurers: ['State Farm', 'Farmers', 'USAA', 'Allstate', 'Montana Farm Bureau']
  },
  'nebraska': {
    name: 'Nebraska', code: 'NE', slug: 'nebraska', capital: 'Lincoln',
    population: 1961504,
    metros: ['Omaha', 'Lincoln', 'Bellevue', 'Grand Island', 'Kearney', 'Fremont'],
    stormProfile: { hailDaysPerYear: 22, hurricaneRisk: 'none', tornadoRisk: 'high', avgClaimsPerYear: '160,000+', primaryPeril: 'Hail belt core — Nebraska ranked top 5 nationally for hail claims per capita' },
    buildingCode: { adoptedIRC: 'IRC 2018', notes: 'No statewide energy code; some municipalities adopt independently' },
    roofingNotes: 'Nebraska sits at the core of the hail belt. Omaha and Lincoln are among the most hail-impacted metros in the US. Class 4 shingles command a premium but are standard for insurance discounts.',
    topInsurers: ['State Farm', 'Farmers', 'USAA', 'Nationwide', 'Auto-Owners']
  },
  'nevada': {
    name: 'Nevada', code: 'NV', slug: 'nevada', capital: 'Carson City',
    population: 3104614,
    metros: ['Las Vegas', 'Henderson', 'Reno', 'North Las Vegas', 'Sparks', 'Carson City'],
    stormProfile: { hailDaysPerYear: 5, hurricaneRisk: 'none', tornadoRisk: 'none', avgClaimsPerYear: '95,000+', primaryPeril: 'UV degradation, monsoon hail, extreme heat cycling' },
    buildingCode: { adoptedIRC: 'IRC 2018', notes: 'Las Vegas valley has additional seismic zone provisions' },
    roofingNotes: 'Extreme heat (115°F+) degrades asphalt shingles faster than national averages. Cool roof requirements in Clark County. Las Vegas is a growing roofing market driven by population expansion and re-roofing due to UV damage.',
    topInsurers: ['State Farm', 'Allstate', 'USAA', 'Farmers', 'Travelers']
  },
  'new-hampshire': {
    name: 'New Hampshire', code: 'NH', slug: 'new-hampshire', capital: 'Concord',
    population: 1395231,
    metros: ['Manchester', 'Nashua', 'Concord', 'Derry', 'Dover'],
    stormProfile: { hailDaysPerYear: 5, hurricaneRisk: 'low', tornadoRisk: 'none', avgClaimsPerYear: '40,000+', primaryPeril: 'Ice dams, Nor\'easters, heavy snow' },
    buildingCode: { adoptedIRC: 'IRC 2021', notes: 'Ice barrier requirements throughout' },
    roofingNotes: 'Ice dam damage is the primary roofing peril. Granite State winters require robust roofing systems. Nor\'easter claims are a regular occurrence.',
    topInsurers: ['State Farm', 'USAA', 'Allstate', 'Hanover Insurance', 'Concord General']
  },
  'new-jersey': {
    name: 'New Jersey', code: 'NJ', slug: 'new-jersey', capital: 'Trenton',
    population: 9288994,
    metros: ['Newark', 'Jersey City', 'Paterson', 'Elizabeth', 'Trenton', 'Edison', 'Toms River'],
    stormProfile: { hailDaysPerYear: 7, hurricaneRisk: 'moderate', tornadoRisk: 'low', avgClaimsPerYear: '270,000+', primaryPeril: 'Nor\'easters, Superstorm Sandy aftermath, hurricane remnants' },
    buildingCode: { adoptedIRC: 'New Jersey Residential Building Code 2021', notes: 'Coastal A/V zones have stringent wind provisions; post-Sandy building requirements' },
    roofingNotes: 'Superstorm Sandy (2012) resulted in massive re-roofing across the Jersey Shore. Nor\'easters generate significant annual claims. Dense population means high contractor density and competitive market.',
    topInsurers: ['State Farm', 'Allstate', 'USAA', 'NJ Manufacturers', 'Travelers']
  },
  'new-mexico': {
    name: 'New Mexico', code: 'NM', slug: 'new-mexico', capital: 'Santa Fe',
    population: 2117522,
    metros: ['Albuquerque', 'Las Cruces', 'Rio Rancho', 'Santa Fe', 'Roswell'],
    stormProfile: { hailDaysPerYear: 10, hurricaneRisk: 'none', tornadoRisk: 'low', avgClaimsPerYear: '65,000+', primaryPeril: 'Monsoon hail, high UV, wind damage' },
    buildingCode: { adoptedIRC: 'IRC 2018', notes: 'Seismic provisions for Rio Grande rift zone' },
    roofingNotes: 'Monsoon season (July–September) brings concentrated hail events. Extreme UV at high altitude degrades roofing faster. Flat/low-slope roofing common in adobe-style construction.',
    topInsurers: ['State Farm', 'Farmers', 'USAA', 'Allstate', 'Travelers']
  },
  'new-york': {
    name: 'New York', code: 'NY', slug: 'new-york', capital: 'Albany',
    population: 20201249,
    metros: ['New York City', 'Buffalo', 'Rochester', 'Albany', 'Syracuse', 'Long Island', 'Yonkers'],
    stormProfile: { hailDaysPerYear: 8, hurricaneRisk: 'moderate', tornadoRisk: 'low', avgClaimsPerYear: '500,000+', primaryPeril: 'Nor\'easters, Superstorm Sandy (NYC), lake-effect snow (Buffalo)' },
    buildingCode: { adoptedIRC: 'New York State Residential Code 2022', notes: 'NYC has its own Building Code; Long Island coastal provisions; ice barrier required statewide' },
    roofingNotes: 'New York is one of the largest US roofing markets by volume. Buffalo has the highest ice dam incidence in the northeast. NYC brownstone and townhouse roofing is specialized. Long Island has coastal hurricane exposure.',
    topInsurers: ['State Farm', 'Allstate', 'USAA', 'Travelers', 'Liberty Mutual']
  },
  'north-carolina': {
    name: 'North Carolina', code: 'NC', slug: 'north-carolina', capital: 'Raleigh',
    population: 10439388,
    metros: ['Charlotte', 'Raleigh', 'Greensboro', 'Durham', 'Winston-Salem', 'Fayetteville', 'Cary'],
    stormProfile: { hailDaysPerYear: 8, hurricaneRisk: 'high', tornadoRisk: 'moderate', avgClaimsPerYear: '350,000+', primaryPeril: 'Atlantic hurricanes — Hurricane Florence (2018), Matthew (2016)' },
    buildingCode: { adoptedIRC: 'NC Residential Code 2018', notes: 'Coastal wind zones; hurricane provisions for Tier 1-3 counties' },
    roofingNotes: 'Charlotte is one of the fastest-growing US roofing markets. Hurricane exposure covers the entire eastern half of the state. Hurricane Florence (2018) caused $22B in damage to NC. Satellite measurement reports are standard in post-hurricane adjusting.',
    topInsurers: ['State Farm', 'Allstate', 'USAA', 'NC Farm Bureau', 'Nationwide']
  },
  'north-dakota': {
    name: 'North Dakota', code: 'ND', slug: 'north-dakota', capital: 'Bismarck',
    population: 779261,
    metros: ['Fargo', 'Bismarck', 'Grand Forks', 'Minot', 'West Fargo'],
    stormProfile: { hailDaysPerYear: 16, hurricaneRisk: 'none', tornadoRisk: 'moderate', avgClaimsPerYear: '55,000+', primaryPeril: 'Hail — among the highest hail frequencies in the US' },
    buildingCode: { adoptedIRC: 'IRC 2018', notes: 'Snow load and frost depth design critical' },
    roofingNotes: 'North Dakota has disproportionately high hail claim rates relative to its small population. Fargo is the largest contractor market. Snow load design is mandatory statewide.',
    topInsurers: ['State Farm', 'Farmers', 'USAA', 'Nodak Mutual', 'Allstate']
  },
  'ohio': {
    name: 'Ohio', code: 'OH', slug: 'ohio', capital: 'Columbus',
    population: 11799448,
    metros: ['Columbus', 'Cleveland', 'Cincinnati', 'Toledo', 'Akron', 'Dayton', 'Youngstown'],
    stormProfile: { hailDaysPerYear: 14, hurricaneRisk: 'none', tornadoRisk: 'moderate', avgClaimsPerYear: '380,000+', primaryPeril: 'Severe thunderstorm hail, lake-effect snow (Cleveland), tornado outbreaks' },
    buildingCode: { adoptedIRC: 'Ohio Residential Building Code 2017', notes: 'Ice barrier requirements; seismic provisions in some zones' },
    roofingNotes: 'Ohio has multiple major contractor markets. Cleveland has lake-effect snow and ice dam issues. Columbus and Cincinnati generate steady hail-driven re-roofing. The 2012 Derechogrena significant claim events.',
    topInsurers: ['State Farm', 'USAA', 'Allstate', 'Erie Insurance', 'Nationwide']
  },
  'oklahoma': {
    name: 'Oklahoma', code: 'OK', slug: 'oklahoma', capital: 'Oklahoma City',
    population: 3959353,
    metros: ['Oklahoma City', 'Tulsa', 'Norman', 'Broken Arrow', 'Edmond', 'Lawton'],
    stormProfile: { hailDaysPerYear: 28, hurricaneRisk: 'none', tornadoRisk: 'high', avgClaimsPerYear: '290,000+', primaryPeril: 'Tornado alley — Moore, Oklahoma is one of the most tornado-impacted cities in the world' },
    buildingCode: { adoptedIRC: 'IRC 2015', notes: 'Moore Tornado Code (enhanced wind provisions after 2013 EF5 tornado)' },
    roofingNotes: 'Oklahoma has 28+ hail days per year and sits at the core of tornado alley. The Oklahoma City metro sees frequent major hail events. Class 4 shingles are near-mandatory for insurance rates. Roof replacement cycles of 3–7 years are common.',
    topInsurers: ['State Farm', 'Farmers', 'USAA', 'Shelter Insurance', 'Allstate']
  },
  'oregon': {
    name: 'Oregon', code: 'OR', slug: 'oregon', capital: 'Salem',
    population: 4237256,
    metros: ['Portland', 'Salem', 'Eugene', 'Gresham', 'Hillsboro', 'Beaverton', 'Bend'],
    stormProfile: { hailDaysPerYear: 4, hurricaneRisk: 'none', tornadoRisk: 'none', avgClaimsPerYear: '110,000+', primaryPeril: 'Wildfire ember exposure, wind-driven rain, moss/algae damage' },
    buildingCode: { adoptedIRC: 'Oregon Residential Specialty Code 2021', notes: 'WUI zones require Class A roofing; moss/algae provisions' },
    roofingNotes: 'Portland has high moss and algae growth rates requiring treatment or replacement more frequently. WUI fire zones are expanding. The Willamette Valley has persistent wind-driven rain that accelerates shingle degradation.',
    topInsurers: ['State Farm', 'USAA', 'Allstate', 'Farmers', 'Mutual of Enumclaw']
  },
  'pennsylvania': {
    name: 'Pennsylvania', code: 'PA', slug: 'pennsylvania', capital: 'Harrisburg',
    population: 13002700,
    metros: ['Philadelphia', 'Pittsburgh', 'Allentown', 'Erie', 'Reading', 'Scranton'],
    stormProfile: { hailDaysPerYear: 9, hurricaneRisk: 'moderate', tornadoRisk: 'low', avgClaimsPerYear: '380,000+', primaryPeril: 'Nor\'easters, ice dams (Erie — lake-effect), hurricane remnants' },
    buildingCode: { adoptedIRC: 'Pennsylvania Uniform Construction Code 2018', notes: 'Ice barrier required in much of state; coastal wind provisions for SE PA' },
    roofingNotes: 'Philadelphia and Pittsburgh are among the top 10 US markets for roofing volume. Erie has the highest lake-effect snow in the northeast. Hurricane remnants (Ida 2021) caused catastrophic flooding and roof damage in Philadelphia.',
    topInsurers: ['State Farm', 'Erie Insurance', 'USAA', 'Allstate', 'Travelers']
  },
  'rhode-island': {
    name: 'Rhode Island', code: 'RI', slug: 'rhode-island', capital: 'Providence',
    population: 1097379,
    metros: ['Providence', 'Cranston', 'Woonsocket', 'Pawtucket', 'East Providence'],
    stormProfile: { hailDaysPerYear: 5, hurricaneRisk: 'moderate', tornadoRisk: 'none', avgClaimsPerYear: '35,000+', primaryPeril: 'Nor\'easters, coastal hurricane exposure' },
    buildingCode: { adoptedIRC: 'Rhode Island Building Code 2018', notes: 'Coastal wind provisions for Narragansett Bay zone' },
    roofingNotes: 'Small state but high contractor density. Coastal exposure drives periodic re-roofing after significant Nor\'easter events.',
    topInsurers: ['State Farm', 'Allstate', 'USAA', 'Amica Mutual', 'Travelers']
  },
  'south-carolina': {
    name: 'South Carolina', code: 'SC', slug: 'south-carolina', capital: 'Columbia',
    population: 5282634,
    metros: ['Columbia', 'Charleston', 'North Charleston', 'Mount Pleasant', 'Rock Hill', 'Greenville'],
    stormProfile: { hailDaysPerYear: 7, hurricaneRisk: 'high', tornadoRisk: 'moderate', avgClaimsPerYear: '200,000+', primaryPeril: 'Atlantic hurricane exposure — Hugo (1989), Dorian (2019) near-miss' },
    buildingCode: { adoptedIRC: 'South Carolina Residential Code 2018', notes: 'Wind-borne debris region requirements for coastal counties; SCDOI mandatory roof permits' },
    roofingNotes: 'Charleston has direct hurricane exposure. Columbia and Greenville see regular hail events. Impact-resistant shingles required in wind-borne debris regions. Re-roofing cycles driven by hurricane seasons.',
    topInsurers: ['State Farm', 'Allstate', 'USAA', 'SC Farm Bureau', 'Nationwide']
  },
  'south-dakota': {
    name: 'South Dakota', code: 'SD', slug: 'south-dakota', capital: 'Pierre',
    population: 886667,
    metros: ['Sioux Falls', 'Rapid City', 'Aberdeen', 'Brookings', 'Watertown'],
    stormProfile: { hailDaysPerYear: 18, hurricaneRisk: 'none', tornadoRisk: 'moderate', avgClaimsPerYear: '70,000+', primaryPeril: 'Hail belt — disproportionately high hail claims per capita' },
    buildingCode: { adoptedIRC: 'IRC 2018', notes: 'Snow load design critical; frost depth provisions' },
    roofingNotes: 'Sioux Falls regularly ranks in the top 20 US metros for hail damage. South Dakota has some of the highest hail claim rates per capita in the US.',
    topInsurers: ['State Farm', 'Farmers', 'USAA', 'Nationwide', 'IMT Insurance']
  },
  'tennessee': {
    name: 'Tennessee', code: 'TN', slug: 'tennessee', capital: 'Nashville',
    population: 7051339,
    metros: ['Nashville', 'Memphis', 'Knoxville', 'Chattanooga', 'Clarksville', 'Murfreesboro'],
    stormProfile: { hailDaysPerYear: 10, hurricaneRisk: 'low', tornadoRisk: 'moderate', avgClaimsPerYear: '240,000+', primaryPeril: 'Severe thunderstorm hail, tornado outbreaks' },
    buildingCode: { adoptedIRC: 'IRC 2018', notes: 'Seismic zone 2 provisions for western Tennessee (New Madrid fault)' },
    roofingNotes: 'Nashville is one of the fastest-growing US cities and has a booming roofing contractor market. The 2020 Nashville tornado caused $1.5B in losses. Memphis sits near the New Madrid seismic zone adding structural concerns.',
    topInsurers: ['State Farm', 'Tennessee Farmers', 'USAA', 'Allstate', 'Nationwide']
  },
  'texas': {
    name: 'Texas', code: 'TX', slug: 'texas', capital: 'Austin',
    population: 29945493,
    metros: ['Houston', 'San Antonio', 'Dallas', 'Austin', 'Fort Worth', 'El Paso', 'Arlington', 'Corpus Christi'],
    stormProfile: { hailDaysPerYear: 30, hurricaneRisk: 'high', tornadoRisk: 'high', avgClaimsPerYear: '1,200,000+', primaryPeril: 'Hail, hurricanes (Gulf Coast), and tornadoes — the #1 US state for roofing insurance claims' },
    buildingCode: { adoptedIRC: 'IRC 2021 (with local amendments)', notes: 'Texas Windstorm Insurance Association (TWIA) zone compliance required for Gulf Coast; Harris County Flood Control requirements post-Harvey' },
    roofingNotes: 'Texas is the single largest US market for roofing contractors. The state generates more insurance roofing claims than any other US state. Dallas-Fort Worth averages 2-3 major hail events per year. Hurricane Harvey (2017) caused $125B in losses. The San Antonio to Dallas corridor is the hail belt\'s western core. Satellite measurement reports are standard in all major Texas metros.',
    topInsurers: ['State Farm', 'Allstate', 'Farmers', 'USAA', 'TWIA (Texas Windstorm)']
  },
  'utah': {
    name: 'Utah', code: 'UT', slug: 'utah', capital: 'Salt Lake City',
    population: 3271616,
    metros: ['Salt Lake City', 'West Valley City', 'Provo', 'West Jordan', 'Orem', 'Sandy', 'St. George'],
    stormProfile: { hailDaysPerYear: 8, hurricaneRisk: 'none', tornadoRisk: 'none', avgClaimsPerYear: '90,000+', primaryPeril: 'Monsoon hail, heavy snow loads at elevation, UV degradation' },
    buildingCode: { adoptedIRC: 'IRC 2021', notes: 'Snow load varies significantly by elevation; seismic zone 3 provisions for Wasatch Front' },
    roofingNotes: 'Salt Lake City is a growing contractor market. Wasatch Front has seismic considerations. Hail events are concentrated in summer monsoon season. Mountain communities require heavy snow load roofing design.',
    topInsurers: ['State Farm', 'Allstate', 'USAA', 'Farmers', 'Bear River Mutual']
  },
  'vermont': {
    name: 'Vermont', code: 'VT', slug: 'vermont', capital: 'Montpelier',
    population: 647464,
    metros: ['Burlington', 'South Burlington', 'Rutland', 'Essex Junction', 'Barre'],
    stormProfile: { hailDaysPerYear: 4, hurricaneRisk: 'low', tornadoRisk: 'none', avgClaimsPerYear: '22,000+', primaryPeril: 'Heavy snow loads, ice dams, Nor\'easters' },
    buildingCode: { adoptedIRC: 'Vermont Residential Building Energy Standards 2020', notes: 'Very high energy code requirements; snow load design critical' },
    roofingNotes: 'Vermont has among the highest snow loads in the contiguous US. Metal roofing is common for snow shedding. Ice dam damage is the primary winter claim. Summer Nor\'easters can cause significant damage.',
    topInsurers: ['State Farm', 'USAA', 'Allstate', 'Union Mutual', 'Vermont Mutual']
  },
  'virginia': {
    name: 'Virginia', code: 'VA', slug: 'virginia', capital: 'Richmond',
    population: 8631393,
    metros: ['Virginia Beach', 'Norfolk', 'Chesapeake', 'Richmond', 'Arlington', 'Newport News', 'Alexandria'],
    stormProfile: { hailDaysPerYear: 8, hurricaneRisk: 'moderate', tornadoRisk: 'low', avgClaimsPerYear: '270,000+', primaryPeril: 'Hurricane remnants, Nor\'easters, coastal storm surge' },
    buildingCode: { adoptedIRC: 'Virginia Uniform Statewide Building Code 2018', notes: 'Coastal A/V zones wind provisions; tidal flooding requirements' },
    roofingNotes: 'Virginia Beach/Norfolk is the largest metro with direct hurricane exposure. Richmond and Northern Virginia are dense contractor markets. Hurricane Isabel (2003) and Floyd (1999) were major re-roofing drivers.',
    topInsurers: ['State Farm', 'Allstate', 'USAA', 'Erie Insurance', 'Nationwide']
  },
  'washington': {
    name: 'Washington', code: 'WA', slug: 'washington', capital: 'Olympia',
    population: 7705281,
    metros: ['Seattle', 'Spokane', 'Tacoma', 'Vancouver', 'Bellevue', 'Everett', 'Renton'],
    stormProfile: { hailDaysPerYear: 4, hurricaneRisk: 'none', tornadoRisk: 'none', avgClaimsPerYear: '160,000+', primaryPeril: 'Wind-driven rain, moss/algae, wildfire ember exposure (eastern WA)' },
    buildingCode: { adoptedIRC: 'Washington State Residential Code 2021', notes: 'Seismic zone 3-4 provisions for Cascadia subduction zone; WUI requirements in eastern WA' },
    roofingNotes: 'Seattle has one of the highest moss growth rates in the US, driving re-roofing and maintenance demand. The Cascadia subduction zone means seismic-qualified roofing attachments are increasingly specified. Eastern Washington has wildfire exposure.',
    topInsurers: ['State Farm', 'USAA', 'Allstate', 'Farmers', 'Mutual of Enumclaw']
  },
  'west-virginia': {
    name: 'West Virginia', code: 'WV', slug: 'west-virginia', capital: 'Charleston',
    population: 1775156,
    metros: ['Charleston', 'Huntington', 'Morgantown', 'Parkersburg', 'Wheeling'],
    stormProfile: { hailDaysPerYear: 10, hurricaneRisk: 'none', tornadoRisk: 'low', avgClaimsPerYear: '65,000+', primaryPeril: 'Severe thunderstorm hail, snow loads in mountains, ice dams' },
    buildingCode: { adoptedIRC: 'IRC 2015', notes: 'Snow load design critical for Appalachian terrain' },
    roofingNotes: 'Mountainous terrain makes on-roof inspection difficult and costly. Satellite measurement is particularly valuable. Hail and snow damage are the primary perils.',
    topInsurers: ['State Farm', 'USAA', 'Erie Insurance', 'Allstate', 'Nationwide']
  },
  'wisconsin': {
    name: 'Wisconsin', code: 'WI', slug: 'wisconsin', capital: 'Madison',
    population: 5893718,
    metros: ['Milwaukee', 'Madison', 'Green Bay', 'Kenosha', 'Racine', 'Appleton', 'Waukesha'],
    stormProfile: { hailDaysPerYear: 15, hurricaneRisk: 'none', tornadoRisk: 'moderate', avgClaimsPerYear: '250,000+', primaryPeril: 'Hail, severe thunderstorms, ice dams, lake-effect snow' },
    buildingCode: { adoptedIRC: 'Wisconsin Uniform Dwelling Code 2021', notes: 'Ice barrier requirements statewide; stringent energy code' },
    roofingNotes: 'Milwaukee and Madison are major contractor markets. Wisconsin averages 15 hail days per year. Ice dam claims are the primary winter peril. Spring re-roofing season is heavily backlogged after harsh winters.',
    topInsurers: ['State Farm', 'USAA', 'Allstate', 'West Bend Mutual', 'Sentry Insurance']
  },
  'wyoming': {
    name: 'Wyoming', code: 'WY', slug: 'wyoming', capital: 'Cheyenne',
    population: 576851,
    metros: ['Cheyenne', 'Casper', 'Laramie', 'Gillette', 'Rock Springs'],
    stormProfile: { hailDaysPerYear: 18, hurricaneRisk: 'none', tornadoRisk: 'low', avgClaimsPerYear: '45,000+', primaryPeril: 'Hail belt — Cheyenne has one of the highest hail rates in the US' },
    buildingCode: { adoptedIRC: 'IRC 2018', notes: 'Snow load design critical; high-wind provisions for eastern plains' },
    roofingNotes: 'Wyoming has very high hail claim rates per capita. Cheyenne regularly ranks among the top 20 US cities for hail damage. Low population but concentrated demand during storm seasons.',
    topInsurers: ['State Farm', 'Farmers', 'USAA', 'Allstate', 'Wyoming Farm Bureau']
  }
}

// Canonical ordered list of all 50 state slugs
export const ALL_STATE_SLUGS = Object.keys(US_STATES)

// US city data for /us/:state/:city pages
export interface USCityData {
  name: string
  state: string
  stateCode: string
  stateSlug: string
  slug: string
  lat: string
  lng: string
  population: number
  stormNarrative: string
  insuranceNote: string
}

export const US_CITIES: USCityData[] = [
  // Texas
  { name: 'Houston', state: 'Texas', stateCode: 'TX', stateSlug: 'texas', slug: 'houston', lat: '29.7604', lng: '-95.3698', population: 2304580, stormNarrative: 'Houston faces dual threats: Gulf Coast hurricanes and severe thunderstorm hail. Hurricane Harvey (2017) generated over $125 billion in losses. The Houston metro averages 8–10 major hail events per year, making it one of the top US cities for roofing insurance claims.', insuranceNote: 'Texas Windstorm Insurance Association (TWIA) coverage is required in coastal zones. State Farm and Allstate are the top private carriers in the Houston metro.' },
  { name: 'San Antonio', state: 'Texas', stateCode: 'TX', stateSlug: 'texas', slug: 'san-antonio', lat: '29.4241', lng: '-98.4936', population: 1434625, stormNarrative: 'San Antonio sits at the intersection of the Texas hail belt and tornado corridor. The city averages 6–8 hail events per year. The April 2016 hailstorm caused over $1.36 billion in insured losses alone — one of the costliest single hail events in Texas history.', insuranceNote: 'USAA (headquartered in San Antonio) and State Farm are the dominant carriers. TWIA coverage applies to coastal-adjacent zones.' },
  { name: 'Dallas', state: 'Texas', stateCode: 'TX', stateSlug: 'texas', slug: 'dallas', lat: '32.7767', lng: '-96.7970', population: 1304379, stormNarrative: 'Dallas sits in the heart of the Texas hail belt. DFW averages 2–3 major hail events per year generating tens of thousands of insurance claims. Roof replacement cycles in Dallas are often 5–8 years due to hail damage frequency.', insuranceNote: 'State Farm, Allstate, and Farmers are the top carriers. Class 4 hail-resistant shingles earn insurance discounts of 20–30% from most Dallas-area insurers.' },
  { name: 'Austin', state: 'Texas', stateCode: 'TX', stateSlug: 'texas', slug: 'austin', lat: '30.2672', lng: '-97.7431', population: 978908, stormNarrative: 'Austin experiences regular spring hail events as Gulf moisture collides with cold fronts. The 2021 winter storm (Uri) also caused widespread roof damage from ice loading. The Austin metro is one of the fastest-growing US roofing markets.', insuranceNote: 'State Farm and Allstate dominate. Austin\'s rapid growth means many new-build warranties are expiring, driving a replacement wave.' },
  { name: 'Fort Worth', state: 'Texas', stateCode: 'TX', stateSlug: 'texas', slug: 'fort-worth', lat: '32.7555', lng: '-97.3308', population: 935508, stormNarrative: 'Fort Worth shares DFW\'s hail exposure. The city has been directly hit by multiple billion-dollar hail storms. The Alliance corridor in north Fort Worth sees concentrated storm activity.', insuranceNote: 'State Farm, USAA, Farmers are top carriers. Texas Department of Insurance data shows Fort Worth in the top 10 Texas cities for hail claims annually.' },
  // Florida
  { name: 'Miami', state: 'Florida', stateCode: 'FL', stateSlug: 'florida', slug: 'miami', lat: '25.7617', lng: '-80.1918', population: 442241, stormNarrative: 'Miami faces the highest hurricane risk of any major US metro. The Florida Building Code mandates the strictest wind load standards in the country. Hurricane Ian (2022) and Irma (2017) together caused over $150B in losses across South Florida. Roof permits are required for any re-roofing in Miami-Dade County.', insuranceNote: 'Citizens Property Insurance is the insurer of last resort for 1.2M+ Florida policies. Private market premiums in Miami-Dade average $5,000–$15,000/year.' },
  { name: 'Tampa', state: 'Florida', stateCode: 'FL', stateSlug: 'florida', slug: 'tampa', lat: '27.9506', lng: '-82.4572', population: 400457, stormNarrative: 'Tampa Bay is considered one of the most hurricane-vulnerable metros in the US due to the shallow bay and dense coastal population. A direct hit from a major hurricane is estimated to be a $250B+ event. Post-Ian, Tampa-area roofing demand surged 300%.', insuranceNote: 'Citizens Property Insurance and Universal Property & Casualty are major carriers. Post-Ian rate increases of 40–80% have been widespread.' },
  { name: 'Orlando', state: 'Florida', stateCode: 'FL', stateSlug: 'florida', slug: 'orlando', lat: '28.5383', lng: '-81.3792', population: 316081, stormNarrative: 'Orlando sits inland but receives tropical storm-force winds during hurricane landfalls. The area averages 3–4 named storms affecting the region per decade. Afternoon thunderstorm hail is common from June through September.', insuranceNote: 'Florida market instability has driven multiple insurer insolvencies. Homeowners Citizens and newer insurtechs dominate.' },
  { name: 'Jacksonville', state: 'Florida', stateCode: 'FL', stateSlug: 'florida', slug: 'jacksonville', lat: '30.3322', lng: '-81.6557', population: 949611, stormNarrative: 'Jacksonville is Northeast Florida\'s largest city with moderate hurricane exposure. Matthew (2016) caused significant coastal damage. The city\'s large geographic footprint creates high demand for satellite measurement tools.', insuranceNote: 'State Farm and Citizens are top carriers. Jacksonville\'s older housing stock drives a consistent re-roofing market.' },
  // Arizona
  { name: 'Phoenix', state: 'Arizona', stateCode: 'AZ', stateSlug: 'arizona', slug: 'phoenix', lat: '33.4484', lng: '-112.0740', population: 1608139, stormNarrative: 'Phoenix experiences intense monsoon-season hail from July through September. UV degradation at 300+ sun days per year significantly shortens asphalt shingle lifespan (15–18 years vs 25–30 in northern states). Concrete and clay tile dominate the market.', insuranceNote: 'State Farm and Farmers are top carriers. Monsoon hail claims spike July–September annually.' },
  { name: 'Tucson', state: 'Arizona', stateCode: 'AZ', stateSlug: 'arizona', slug: 'tucson', lat: '32.2226', lng: '-110.9747', population: 543000, stormNarrative: 'Tucson\'s monsoon season (July–September) brings hail events as moist air surges north from the Gulf of California. Roof lifespans are compressed by UV exposure at 5,000+ ft elevation.', insuranceNote: 'State Farm, USAA, and Allstate are the major carriers. Tile roofing is standard; measurement complexity increases costs for manual estimating.' },
  { name: 'Mesa', state: 'Arizona', stateCode: 'AZ', stateSlug: 'arizona', slug: 'mesa', lat: '33.4152', lng: '-111.8315', population: 504258, stormNarrative: 'Mesa shares Phoenix\'s monsoon hail exposure and UV degradation profile. East Mesa sits at the base of the Superstition Mountains where thunderstorms intensify.', insuranceNote: 'State Farm and Farmers dominate. Mesa has a large percentage of older concrete tile roofs entering replacement cycles.' },
  // Colorado
  { name: 'Denver', state: 'Colorado', stateCode: 'CO', stateSlug: 'colorado', slug: 'denver', lat: '39.7392', lng: '-104.9903', population: 749144, stormNarrative: 'Denver is one of the top 5 US cities for hail damage by claim volume. Colorado averages 44 hail days per year and the Front Range has the densest concentration. The May 2017 hailstorm caused $2.3B in insured losses in the Denver metro alone. Re-roofing cycles of 5–8 years are standard.', insuranceNote: 'State Farm, Allstate, and Farmers are top carriers. Class 4 impact-resistant shingles earn 20–30% insurance discounts from most Colorado carriers.' },
  { name: 'Colorado Springs', state: 'Colorado', stateCode: 'CO', stateSlug: 'colorado', slug: 'colorado-springs', lat: '38.8339', lng: '-104.8214', population: 478961, stormNarrative: 'Colorado Springs sits on the Palmer Divide, a geographic feature that increases storm cell development. The city experiences 12–15 significant hail events per year. The 2018 hailstorm caused over $400M in damage in the Colorado Springs metro.', insuranceNote: 'State Farm and USAA (military community) are dominant. Many El Paso County insurers now require Class 4 for new policies.' },
  // Georgia
  { name: 'Atlanta', state: 'Georgia', stateCode: 'GA', stateSlug: 'georgia', slug: 'atlanta', lat: '33.7490', lng: '-84.3880', population: 498715, stormNarrative: 'Atlanta experiences bimodal hail seasons in spring and fall. The city also sits in the path of weakening Gulf hurricanes, which bring significant wind damage. 2024 tornado outbreaks caused widespread roofing damage across Metro Atlanta.', insuranceNote: 'State Farm, Allstate, and Nationwide are the top carriers. Georgia Insurance Commissioner data shows Atlanta in the top 10 US metros for storm-damage claims.' },
  // North Carolina
  { name: 'Charlotte', state: 'North Carolina', stateCode: 'NC', stateSlug: 'north-carolina', slug: 'charlotte', lat: '35.2271', lng: '-80.8431', population: 897720, stormNarrative: 'Charlotte is one of the fastest-growing US cities and has seen rapid expansion of its roofing contractor market. The city has moderate hurricane exposure (inland from the coast) and regular spring hail events. Charlotte was directly impacted by Tropical Storm Fred (2021) remnants.', insuranceNote: 'State Farm and Nationwide are dominant. NC Farm Bureau is significant in suburban areas.' },
  { name: 'Raleigh', state: 'North Carolina', stateCode: 'NC', stateSlug: 'north-carolina', slug: 'raleigh', lat: '35.7796', lng: '-78.6382', population: 467665, stormNarrative: 'Raleigh/Durham sits in the path of Atlantic hurricanes that make landfall along the Outer Banks. Hurricane Florence (2018) caused $22B in NC damage. The Research Triangle area has seen explosive growth creating high new-construction and re-roofing demand.', insuranceNote: 'State Farm and NC Farm Bureau dominate. Eastern NC counties have limited insurer availability driving up premiums.' },
  // Virginia
  { name: 'Virginia Beach', state: 'Virginia', stateCode: 'VA', stateSlug: 'virginia', slug: 'virginia-beach', lat: '36.8529', lng: '-75.9780', population: 459470, stormNarrative: 'Virginia Beach has the most direct hurricane exposure of any major Virginia city. The city was impacted by Isabel (2003) and several tropical storm events. Nor\'easters generate the highest annual claim volume due to frequency.', insuranceNote: 'USAA (large military presence) and State Farm are dominant. Coastal wind provisions require specific roofing products.' },
  // Tennessee
  { name: 'Nashville', state: 'Tennessee', stateCode: 'TN', stateSlug: 'tennessee', slug: 'nashville', lat: '36.1627', lng: '-86.7816', population: 689447, stormNarrative: 'Nashville is one of the fastest-growing US cities. The 2020 tornado caused $1.5B in damage. The city experiences regular spring hail and tornado events. The rapid population growth is driving a significant new-construction and re-roofing market.', insuranceNote: 'State Farm and Tennessee Farmers Mutual are top carriers. Nashville\'s growth means many contractor shortages and premium pricing.' },
  { name: 'Memphis', state: 'Tennessee', stateCode: 'TN', stateSlug: 'tennessee', slug: 'memphis', lat: '35.1495', lng: '-90.0490', population: 633104, stormNarrative: 'Memphis sits near the New Madrid seismic zone and experiences regular severe thunderstorm hail. The city averages 10+ significant hail events per year. Mississippi River humidity accelerates roof degradation.', insuranceNote: 'State Farm and Shelter Insurance are major carriers. Memphis has one of the highest uninsured homeowner rates in the south.' },
  // Missouri
  { name: 'Kansas City', state: 'Missouri', stateCode: 'MO', stateSlug: 'missouri', slug: 'kansas-city', lat: '39.0997', lng: '-94.5786', population: 508090, stormNarrative: 'Kansas City sits at the eastern edge of the hail belt. The metro averages 20+ hail days per year. The 2019 hail events caused over $600M in insurance claims across the KC metro. Satellite measurement tools are widely used by KC-area contractors.', insuranceNote: 'State Farm and Shelter Insurance dominate. Missouri DOI data shows KC in top 5 for state hail claim volume.' },
  { name: 'St. Louis', state: 'Missouri', stateCode: 'MO', stateSlug: 'missouri', slug: 'st-louis', lat: '38.6270', lng: '-90.1994', population: 301578, stormNarrative: 'St. Louis is at the junction of three major storm tracks, making it one of the Midwest\'s most storm-impacted cities. The 2011 Lambert Airport tornado (EF4) caused catastrophic damage. Hail season runs April through October.', insuranceNote: 'State Farm and USAA are dominant. Gateway to South markets mean large contractor volume.' },
  // Oklahoma
  { name: 'Oklahoma City', state: 'Oklahoma', stateCode: 'OK', stateSlug: 'oklahoma', slug: 'oklahoma-city', lat: '35.4676', lng: '-97.5164', population: 681054, stormNarrative: 'Oklahoma City is at the epicenter of US tornado activity. Moore, a suburb of OKC, has been struck by multiple EF5 tornadoes. The metro also experiences 25+ hail days per year. Re-roofing demand is consistently among the highest in the US relative to population.', insuranceNote: 'State Farm and Shelter Insurance are dominant. Moore Tornado Code compliance affects product specifications.' },
  { name: 'Tulsa', state: 'Oklahoma', stateCode: 'OK', stateSlug: 'oklahoma', slug: 'tulsa', lat: '36.1540', lng: '-95.9928', population: 413066, stormNarrative: 'Tulsa sits in the northern edge of tornado alley with regular tornado and hail exposure. The city averages 20+ hail days per year. Northeastern Oklahoma has some of the most active storm days in the US.', insuranceNote: 'State Farm and Farmers are top carriers. Oklahoma Insurance Department data shows Tulsa consistently in top 3 for state hail claims.' },
  // Kansas
  { name: 'Wichita', state: 'Kansas', stateCode: 'KS', stateSlug: 'kansas', slug: 'wichita', lat: '37.6872', lng: '-97.3301', population: 395695, stormNarrative: 'Wichita sits at the heart of the US hail belt and experiences 25+ hail days per year. The city has been directly hit by several billion-dollar hail events. Wichita contractors are among the most experienced in the US at hail damage documentation.', insuranceNote: 'State Farm, Farmers, and Shelter Insurance dominate. Kansas has passed legislation regulating storm-chaser contractors.' },
  // Nebraska
  { name: 'Omaha', state: 'Nebraska', stateCode: 'NE', stateSlug: 'nebraska', slug: 'omaha', lat: '41.2565', lng: '-95.9345', population: 486051, stormNarrative: 'Omaha averages 22+ hail days per year and sits in the northern hail belt. The city has experienced multiple $500M+ hail events. Omaha\'s older housing stock (many homes from the 1950s–1980s) creates constant re-roofing demand.', insuranceNote: 'State Farm and Nationwide are dominant. Nebraska Insurance Department tracks Omaha as a top-5 hail claim city nationally.' },
  // Iowa
  { name: 'Des Moines', state: 'Iowa', stateCode: 'IA', stateSlug: 'iowa', slug: 'des-moines', lat: '41.5868', lng: '-93.6250', population: 214237, stormNarrative: 'Des Moines averages 20+ hail days per year. The 2020 Iowa Derecho caused $11B in statewide damage and generated massive roofing claims across central Iowa. Re-roofing demand in Des Moines surged 400% in the 6 months following the derecho.', insuranceNote: 'IMT Insurance and Grinnell Mutual are regional carriers. State Farm dominates overall.' },
  // Illinois
  { name: 'Chicago', state: 'Illinois', stateCode: 'IL', stateSlug: 'illinois', slug: 'chicago', lat: '41.8781', lng: '-87.6298', population: 2696555, stormNarrative: 'Chicago is the largest US flat-roofing market due to commercial density and the prevalence of low-slope residential roofs. The metro experiences 18+ hail days per year. Lake Michigan exposure creates wind-driven rain events. Ice dam damage in winter adds to claim volume.', insuranceNote: 'State Farm (headquartered in Illinois) and Allstate (also HQ\'d in IL) are the dominant carriers. Chicago building permits are required for re-roofing.' },
  // Ohio
  { name: 'Columbus', state: 'Ohio', stateCode: 'OH', stateSlug: 'ohio', slug: 'columbus-ohio', lat: '39.9612', lng: '-82.9988', population: 905748, stormNarrative: 'Columbus is the fastest-growing major city in Ohio. The city experiences 14+ hail days per year and regular tornado outbreaks. The June 2012 Derecho caused widespread damage across central Ohio.', insuranceNote: 'State Farm and Erie Insurance are dominant. Ohio has one of the lower uninsured homeowner rates, driving consistent claim volume.' },
  { name: 'Cleveland', state: 'Ohio', stateCode: 'OH', stateSlug: 'ohio', slug: 'cleveland', lat: '41.4993', lng: '-81.6944', population: 367991, stormNarrative: 'Cleveland sits on Lake Erie and receives lake-effect snow regularly. Ice dams are the most costly winter roofing peril. The city also experiences 14+ hail days per year. Older housing stock drives consistent re-roofing demand.', insuranceNote: 'Erie Insurance and State Farm are dominant. Cleveland\'s older housing stock generates consistent re-roofing volume year-round.' },
  { name: 'Cincinnati', state: 'Ohio', stateCode: 'OH', stateSlug: 'ohio', slug: 'cincinnati', lat: '39.1031', lng: '-84.5120', population: 309317, stormNarrative: 'Cincinnati sits at the northern edge of tornado activity. The city experiences 12+ hail days per year. The 2008 Ike remnants caused catastrophic wind damage across Cincinnati — over $1B in losses from a single post-hurricane wind event.', insuranceNote: 'State Farm and Auto-Owners are major carriers. Cincinnati\'s tri-state market (OH/KY/IN) creates complex jurisdictional issues for roofing permits.' },
  // Michigan
  { name: 'Detroit', state: 'Michigan', stateCode: 'MI', stateSlug: 'michigan', slug: 'detroit', lat: '42.3314', lng: '-83.0458', population: 639111, stormNarrative: 'Detroit experiences 10+ hail days per year and significant ice dam issues in winter. The metropolitan area has a large stock of older homes with aged roofing. Contractor density in metro Detroit is among the highest in the Midwest.', insuranceNote: 'State Farm and Auto Club Group (AAA) are dominant. Michigan\'s high auto insurance costs often lead homeowners to under-insure properties.' },
  // Minnesota
  { name: 'Minneapolis', state: 'Minnesota', stateCode: 'MN', stateSlug: 'minnesota', slug: 'minneapolis', lat: '44.9778', lng: '-93.2650', population: 429954, stormNarrative: 'Minneapolis averages 17 hail days per year and is one of the top US cities for hail damage claims. The city also has severe ice dam issues due to extreme cold. Contractor demand is so high that spring booking windows often fill within days of a major hail event.', insuranceNote: 'State Farm and West Bend Mutual are dominant. Minnesota\'s ice barrier requirements are among the strictest in the US.' },
  // Nevada
  { name: 'Las Vegas', state: 'Nevada', stateCode: 'NV', stateSlug: 'nevada', slug: 'las-vegas', lat: '36.1699', lng: '-115.1398', population: 641903, stormNarrative: 'Las Vegas experiences monsoon-season hail July–September and extreme UV degradation year-round. Clark County has Cool Roof requirements for commercial properties. Rapid population growth drives consistent new-construction roofing demand.', insuranceNote: 'State Farm and Allstate are dominant. Nevada insurance regulation allows significant rate increases for UV-related claims.' },
  // Washington
  { name: 'Seattle', state: 'Washington', stateCode: 'WA', stateSlug: 'washington', slug: 'seattle', lat: '47.6062', lng: '-122.3321', population: 749256, stormNarrative: 'Seattle\'s persistent rain and humidity creates ideal conditions for moss and algae growth. Average moss re-roofing cycles are 12–15 years vs 20–25 elsewhere. Wind-driven rain events (atmospheric rivers) cause significant damage every 3–5 years. The Cascadia subduction zone looms as a long-term seismic risk.', insuranceNote: 'State Farm and Farmers are dominant. Seattle\'s high property values mean roofing claims are among the highest dollar amounts per claim in the US.' },
  // Oregon
  { name: 'Portland', state: 'Oregon', stateCode: 'OR', stateSlug: 'oregon', slug: 'portland', lat: '45.5152', lng: '-122.6784', population: 652503, stormNarrative: 'Portland shares Seattle\'s moss and algae challenge. The Columbus Day Storm (1962) and the 2021 heat dome both created massive roofing demand events. December 2021 wind storms caused significant damage across the Portland metro.', insuranceNote: 'State Farm and Farmers are dominant. Oregon\'s WUI requirements are increasingly affecting insurance availability.' },
  // Pennsylvania
  { name: 'Pittsburgh', state: 'Pennsylvania', stateCode: 'PA', stateSlug: 'pennsylvania', slug: 'pittsburgh', lat: '40.4406', lng: '-79.9959', population: 302971, stormNarrative: 'Pittsburgh experiences 9+ hail days per year and significant Nor\'easter impacts. The hilly terrain creates difficult roof access, making satellite measurement particularly valuable. Erie receives the most lake-effect snow of any major Pennsylvania city.', insuranceNote: 'Erie Insurance (Pennsylvania-based) and State Farm are dominant. Pittsburgh\'s steep hillside rooflines require specialized measurement tools.' },
  // Maryland
  { name: 'Baltimore', state: 'Maryland', stateCode: 'MD', stateSlug: 'maryland', slug: 'baltimore', lat: '39.2904', lng: '-76.6122', population: 585708, stormNarrative: 'Baltimore is a major Mid-Atlantic roofing market. Superstorm Sandy (2012) caused significant coastal storm surge damage. Nor\'easters generate consistent annual claims. Baltimore\'s dense row-house market presents unique flat/low-slope roofing challenges.', insuranceNote: 'State Farm and Travelers are dominant. Maryland insurance rates have risen significantly post-Sandy.' },
  // Louisiana
  { name: 'New Orleans', state: 'Louisiana', stateCode: 'LA', stateSlug: 'louisiana', slug: 'new-orleans', lat: '29.9511', lng: '-90.0715', population: 383997, stormNarrative: 'New Orleans sits below sea level and has been struck by multiple catastrophic hurricanes including Katrina (2005, $45B roofing losses) and Ida (2021, $75B+). The entire metro has mandatory hurricane provisions under the Louisiana State Uniform Construction Code. Satellite measurement tools are standard for post-storm claim documentation.', insuranceNote: 'Louisiana Citizens and Allstate are dominant. Louisiana has some of the highest homeowner insurance premiums in the US at $4,000–$8,000/year.' },
  // New York
  { name: 'New York City', state: 'New York', stateCode: 'NY', stateSlug: 'new-york', slug: 'new-york', lat: '40.7128', lng: '-74.0060', population: 8336817, stormNarrative: 'New York City is the largest US roofing market by volume. Superstorm Sandy (2012) generated over $32B in losses in NY alone. Nor\'easters regularly impact the metro with 8+ named storms affecting the area per decade. NYC requires building permits for all re-roofing work.', insuranceNote: 'Travelers and State Farm are dominant. NYC has extremely high labor costs, making per-report material savings from accurate measurements high-value.' },
  { name: 'Buffalo', state: 'New York', stateCode: 'NY', stateSlug: 'new-york', slug: 'buffalo', lat: '42.8864', lng: '-78.8784', population: 278349, stormNarrative: 'Buffalo has the highest lake-effect snow accumulation of any major US city, averaging 94 inches per year. Ice dam claims are the primary roofing peril. The December 2022 blizzard (Buffalo Blizzard) caused catastrophic damage. Snow load calculations are mandatory.', insuranceNote: 'Erie Insurance and State Farm are dominant. Buffalo\'s winter severity means many roofing contractors are also ice dam remediation specialists.' },
  // New Jersey
  { name: 'Newark', state: 'New Jersey', stateCode: 'NJ', stateSlug: 'new-jersey', slug: 'newark', lat: '40.7357', lng: '-74.1724', population: 311549, stormNarrative: 'Newark sits in the NYC metro and experienced significant Superstorm Sandy damage. Nor\'easters are the primary annual claim driver. The dense urban market makes satellite measurement tools highly efficient vs. manual inspection.', insuranceNote: 'NJ Manufacturers and State Farm are top carriers. New Jersey has some of the highest homeowner insurance rates in the northeast.' },
  // Virginia
  { name: 'Richmond', state: 'Virginia', stateCode: 'VA', stateSlug: 'virginia', slug: 'richmond-va', lat: '37.5407', lng: '-77.4360', population: 226610, stormNarrative: 'Richmond sits at the intersection of hurricane tracks and mid-Atlantic severe weather. Hurricane Ida (2021) remnants caused catastrophic flooding and roof damage across the Richmond metro. The city experiences 8+ hail days per year.', insuranceNote: 'USAA and State Farm are dominant. Richmond\'s older housing stock drives consistent re-roofing demand.' },
  // Indiana
  { name: 'Indianapolis', state: 'Indiana', stateCode: 'IN', stateSlug: 'indiana', slug: 'indianapolis', lat: '39.7684', lng: '-86.1581', population: 887642, stormNarrative: 'Indianapolis sits at the northern edge of tornado alley. The city averages 16+ hail days per year. Spring severe thunderstorm seasons generate the majority of annual insurance claims. Rapid suburban expansion drives high new-construction roofing volume.', insuranceNote: 'State Farm and USAA are dominant. Indiana Insurance Commissioner data shows Indianapolis as the top Indiana city for storm claims.' },
  // Wisconsin
  { name: 'Milwaukee', state: 'Wisconsin', stateCode: 'WI', stateSlug: 'wisconsin', slug: 'milwaukee', lat: '43.0389', lng: '-87.9065', population: 577222, stormNarrative: 'Milwaukee sits on Lake Michigan and experiences lake-effect snow and ice dams. The city averages 15 hail days per year. Spring and fall severe thunderstorm seasons generate concentrated claim spikes.', insuranceNote: 'West Bend Mutual and State Farm are dominant. Wisconsin\'s strict ice barrier requirements mean most Milwaukee re-roofing includes system upgrades.' },
  // South Carolina
  { name: 'Charleston', state: 'South Carolina', stateCode: 'SC', stateSlug: 'south-carolina', slug: 'charleston', lat: '32.7765', lng: '-79.9311', population: 150227, stormNarrative: 'Charleston faces the highest hurricane exposure in South Carolina. Dorian (2019), Hugo (1989), and multiple other major storms have directly impacted the area. The city\'s colonial-era building stock creates specialized re-roofing challenges.', insuranceNote: 'SC Farm Bureau and State Farm are dominant. Charleston\'s coastal exposure means wind-borne debris region requirements apply to most of the metro.' },
  // New Mexico
  { name: 'Albuquerque', state: 'New Mexico', stateCode: 'NM', stateSlug: 'new-mexico', slug: 'albuquerque', lat: '35.0844', lng: '-106.6504', population: 564559, stormNarrative: 'Albuquerque\'s monsoon season (July–September) brings concentrated hail events. The city sits at 5,300 ft elevation where UV radiation is 25% more intense than sea level, accelerating shingle degradation. Flat roofing is common in adobe-influenced architecture.', insuranceNote: 'State Farm and Farmers are dominant. New Mexico\'s Implied Warranty Act means contractors have extended liability for roofing defects.' },
  // Idaho
  { name: 'Boise', state: 'Idaho', stateCode: 'ID', stateSlug: 'idaho', slug: 'boise', lat: '43.6150', lng: '-116.2023', population: 235684, stormNarrative: 'Boise is the fastest-growing major US city. The area experiences 10+ hail days per year and wildfire smoke/ember exposure from the expanding WUI interface. New construction is driving high satellite measurement adoption.', insuranceNote: 'State Farm and Farmers are dominant. Idaho\'s rapid growth means contractor capacity is strained and satellite tools are critical for efficiency.' },
  // California (5 cities — largest uncovered US market)
  { name: 'Los Angeles', state: 'California', stateCode: 'CA', stateSlug: 'california', slug: 'los-angeles', lat: '34.0522', lng: '-118.2437', population: 3898747, stormNarrative: 'Los Angeles roofing is driven by wildfire and seismic risk. WUI zones cover ~25% of the metro, mandating Class A fire-rated roofing. The 2025 Palisades and Eaton fires consumed thousands of roofs in days. UV degradation at 284 sunny days/year compresses asphalt lifespans to 15–18 years. Atmospheric river events in 2023–2024 caused widespread wind-driven rain damage on flat commercial roofs.', insuranceNote: 'State Farm and Farmers have significantly reduced new policy issuance in CA WUI zones. Many LA homeowners are pushed to California FAIR Plan. Satellite measurements are critical for FAIR Plan claims documentation.' },
  { name: 'San Francisco', state: 'California', stateCode: 'CA', stateSlug: 'california', slug: 'san-francisco', lat: '37.7749', lng: '-122.4194', population: 815201, stormNarrative: 'San Francisco has a mild climate but faces unique roofing challenges: persistent marine fog accelerates moss and algae growth, atmospheric rivers bring intense rainfall, and the Hayward Fault creates seismic vulnerability. The 2023–2024 atmospheric river sequence caused significant roof damage across the Bay Area.', insuranceNote: 'State Farm paused new homeowner policies in CA in 2023. Farmers exited the market in 2023. Most SF homeowners now rely on Chubb, AIG, or the CA FAIR Plan. Premium satellite documentation is critical.' },
  { name: 'San Diego', state: 'California', stateCode: 'CA', stateSlug: 'california', slug: 'san-diego', lat: '32.7157', lng: '-117.1611', population: 1386932, stormNarrative: 'San Diego faces extreme wildfire risk — the 2007 Cedar and Witch fires burned 1,500+ homes. The county has some of the most expansive WUI zones in California. Near-constant UV exposure at 266 sunny days/year means asphalt shingles last 15–18 years. Atmospheric rivers bring concentrated rainfall on aging flat roofing.', insuranceNote: 'California FAIR Plan covers most high-risk WUI areas. Chubb and AIG offer surplus coverage for qualifying properties. Accurate satellite measurements are required for FAIR Plan claim processing.' },
  { name: 'San Jose', state: 'California', stateCode: 'CA', stateSlug: 'california', slug: 'san-jose', lat: '37.3382', lng: '-121.8863', population: 1013240, stormNarrative: 'San Jose and Silicon Valley face wildfire smoke and ember exposure from surrounding hills. The 2020 SCU Lightning Complex fire burned to the edge of east San Jose suburbs. Atmospheric river events drive concentrated roofing claims in winter months. High property values make accurate satellite measurements especially cost-effective.', insuranceNote: 'Insurance availability crisis is severe — State Farm and Farmers have exited or restricted CA. Tech-sector homeowners typically use Chubb, Nationwide, or FAIR Plan. Exact measurements reduce claim disputes significantly.' },
  { name: 'Sacramento', state: 'California', stateCode: 'CA', stateSlug: 'california', slug: 'sacramento', lat: '38.5816', lng: '-121.4944', population: 524943, stormNarrative: 'Sacramento sits in the Central Valley with rapidly expanding WUI exposure. The 2021 Caldor and Dixie fires threatened eastern Sacramento County. Extreme heat events (110°F+) accelerate shingle degradation. Atmospheric river flooding in 2023 caused significant roof damage across Sacramento County.', insuranceNote: 'CA FAIR Plan and Chubb dominate in WUI zones. Sacramento County requires permit-pulled re-roofing with documented measurements. Satellite tools eliminate time-consuming manual ladder measurements.' },
  // Massachusetts
  { name: 'Boston', state: 'Massachusetts', stateCode: 'MA', stateSlug: 'massachusetts', slug: 'boston', lat: '42.3601', lng: '-71.0589', population: 654776, stormNarrative: 'Boston is a major Nor\'easter market. Winter Storm Juno (2015) and multiple subsequent storms have driven sustained roofing claims. Ice dam damage in winters with significant freeze-thaw cycles is the primary peril. The city\'s dense older housing stock (pre-1940) requires specialized low-slope and historic roofing expertise.', insuranceNote: 'Safety Insurance and State Farm are dominant. Massachusetts requires specific ice barrier and underlayment standards under the MA State Building Code. Accurate satellite measurements are critical for ice-dam claim documentation.' },
  // Utah
  { name: 'Salt Lake City', state: 'Utah', stateCode: 'UT', stateSlug: 'utah', slug: 'salt-lake-city', lat: '40.7608', lng: '-111.8910', population: 205033, stormNarrative: 'Salt Lake City receives 57 inches of annual snowfall and sits in a seismic zone on the Wasatch Fault. Heavy snow load calculations are mandatory under Utah code. The Wasatch Front urban corridor is one of the fastest-growing US metro areas, driving high new-construction roofing demand.', insuranceNote: 'State Farm and Farmers are dominant. Utah Insurance Department data shows hail as the top property claim cause. SLC\'s rapid growth means contractor capacity is stretched.' },
  // Kentucky
  { name: 'Louisville', state: 'Kentucky', stateCode: 'KY', stateSlug: 'kentucky', slug: 'louisville', lat: '38.2527', lng: '-85.7585', population: 663255, stormNarrative: 'Louisville sits at the northern edge of the Ohio Valley severe weather corridor. The city averages 12+ hail days per year and experiences regular tornado threats. The 2021 Kentucky flooding caused significant structural damage across the metro. Louisville\'s aging housing stock drives consistent re-roofing demand.', insuranceNote: 'State Farm and Shelter Insurance dominate. Kentucky has no state-level contractor licensing, making satellite documentation critical for adjuster claims verification.' },
  // Alabama
  { name: 'Birmingham', state: 'Alabama', stateCode: 'AL', stateSlug: 'alabama', slug: 'birmingham', lat: '33.5186', lng: '-86.8104', population: 212237, stormNarrative: 'Birmingham sits in the Southeast severe weather corridor. The April 2011 tornado outbreak caused catastrophic damage across Alabama. The city experiences 12+ significant storm days per year. Birmingham\'s dense older housing stock and rapid suburban expansion drive a dual re-roofing and new-construction market.', insuranceNote: 'State Farm and Farmers are dominant. Alabama Department of Insurance data shows Birmingham in top 3 for state storm claim volume annually.' },
  // Connecticut
  { name: 'Hartford', state: 'Connecticut', stateCode: 'CT', stateSlug: 'connecticut', slug: 'hartford', lat: '41.7658', lng: '-72.6851', population: 121054, stormNarrative: 'Hartford and the Greater Hartford metro experience regular Nor\'easters and tropical storm remnants. Hurricane Irene (2011) and Sandy (2012) caused significant damage. Ice dam issues occur most winters with freeze-thaw cycles. Connecticut\'s older housing stock is among the oldest in the US, driving high re-roofing demand.', insuranceNote: 'Travelers (headquartered in Hartford) and State Farm are major carriers. CT requires permits for all re-roofing, with measurements required for permit applications.' },
  // Alaska
  { name: 'Anchorage', state: 'Alaska', stateCode: 'AK', stateSlug: 'alaska', slug: 'anchorage', lat: '61.2181', lng: '-149.9003', population: 291247, stormNarrative: 'Anchorage receives 74 inches of annual snowfall and experiences extreme freeze-thaw cycles. Snow load engineering is mandatory — roofs must withstand 40–60 psf snow loads. Seismic design requirements from the 2018 M7.1 earthquake mandate upgraded fastening systems for re-roofing. Satellite measurement is critical given remote property access.', insuranceNote: 'State Farm and USAA are dominant. Alaska has stringent contractor licensing. Remote property locations make satellite measurement tools especially valuable for pre-inspection scoping.' },
  // Hawaii
  { name: 'Honolulu', state: 'Hawaii', stateCode: 'HI', stateSlug: 'hawaii', slug: 'honolulu', lat: '21.3069', lng: '-157.8583', population: 337256, stormNarrative: 'Honolulu faces hurricane exposure from Central Pacific storms, with Hurricane Lane (2018) causing significant flooding. Salt air corrosion accelerates roof degradation. Hawaii\'s high UV index at 20°N latitude reduces shingle lifespans to 12–15 years. Vog (volcanic smog) on windward coasts adds additional degradation risk.', insuranceNote: 'Farmers and State Farm are dominant carriers. Hawaii\'s island logistics mean roofing materials cost 30–50% more than mainland. Accurate satellite measurements reduce waste and material overordering.' },
  // Mississippi
  { name: 'Jackson', state: 'Mississippi', stateCode: 'MS', stateSlug: 'mississippi', slug: 'jackson', lat: '32.2988', lng: '-90.1848', population: 149761, stormNarrative: 'Jackson sits in the Southeast severe weather corridor with regular tornado and hail exposure. Mississippi experiences 9+ hail days per year and is in the path of Gulf hurricanes that weaken as they move inland. Katrina (2005) remnants caused significant damage across the state. Mississippi\'s older housing stock drives consistent re-roofing demand.', insuranceNote: 'State Farm and Southern Farm Bureau are dominant. Mississippi has some of the highest uninsured homeowner rates in the US at ~18%, affecting claim volume.' },
  // Arkansas
  { name: 'Little Rock', state: 'Arkansas', stateCode: 'AR', stateSlug: 'arkansas', slug: 'little-rock', lat: '34.7465', lng: '-92.2896', population: 202591, stormNarrative: 'Little Rock sits at the intersection of the Gulf moisture track and Midwest cold fronts. The city averages 12+ significant storm days per year with both hail and tornado exposure. The 2023 Little Rock tornado (EF3) caused widespread roofing damage across the metro. Humid subtropical climate accelerates shingle aging.', insuranceNote: 'State Farm and Southern Farm Bureau are dominant. Arkansas Insurance Department data shows Little Rock as the top city for state storm claims volume.' },
  // West Virginia
  { name: 'Charleston', state: 'West Virginia', stateCode: 'WV', stateSlug: 'west-virginia', slug: 'charleston-wv', lat: '38.3498', lng: '-81.6326', population: 47606, stormNarrative: 'Charleston WV sits in the Appalachian Mountains where storm cells are channeled and intensified by terrain. The city experiences 8+ hail days per year and regular Nor\'easter impacts. Heavy snowfall and ice loading are major winter perils. WV\'s older industrial housing stock has elevated re-roofing demand.', insuranceNote: 'Erie Insurance and State Farm are dominant. West Virginia has a relatively straightforward insurance claims process. Satellite measurements are critical for hilly terrain where manual access is difficult.' },
  // Montana
  { name: 'Billings', state: 'Montana', stateCode: 'MT', stateSlug: 'montana', slug: 'billings', lat: '45.7833', lng: '-108.5007', population: 117116, stormNarrative: 'Billings is the largest city in Montana and faces significant hail and wind exposure on the High Plains. The city averages 14+ hail days per year. Heavy snow loads require regular inspection. The region\'s rapid oil-and-gas economy growth drives new commercial roofing demand. Satellite measurement tools are critical given contractor labor shortages.', insuranceNote: 'State Farm and Farmers dominate. Montana Insurance Commissioner data shows Billings as the top city for state hail claim volume. Remote property locations make satellite tools especially cost-effective.' },
  // Maine
  { name: 'Portland', state: 'Maine', stateCode: 'ME', stateSlug: 'maine', slug: 'portland-me', lat: '43.6591', lng: '-70.2568', population: 68408, stormNarrative: 'Portland ME is the largest city in Maine and faces severe Nor\'easter exposure. Winter Storm Nemo (2013) and multiple subsequent storms caused significant roof damage. Ice dam issues are a primary annual peril. Maine\'s coastal climate drives above-average moss and algae growth on roofing surfaces.', insuranceNote: 'Concord General and State Farm are dominant. Maine requires building permits for re-roofing with documented measurements. Older Cape Cod-style homes have complex hip configurations that benefit from satellite measurement.' },
]
