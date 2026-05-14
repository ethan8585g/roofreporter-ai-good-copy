// ============================================================
// ROOF ANATOMY APPENDIX — Editable static copy
// All strings rendered on the educational appendix page live here so a
// non-engineer can edit wording without touching renderer code.
// ============================================================

export interface AnatomyLayer {
  number: number
  name: string
  blurb: string
}

export const LAYER_CROSS_SECTION_TITLE = 'Layer Cross-Section'
export const LAYER_CROSS_SECTION_SUBTITLE = 'Typical residential roof assembly from top to bottom'

export const LAYERS: AnatomyLayer[] = [
  { number: 1, name: 'Shingles',     blurb: 'Outer weather barrier — asphalt, metal, or tile' },
  { number: 2, name: 'Underlayment', blurb: 'Synthetic or felt — secondary water resistance' },
  { number: 3, name: 'Decking',      blurb: 'Plywood / OSB sheathing — the structural deck' },
  { number: 4, name: 'Framing',      blurb: 'Rafters or trusses — load-carrying members' },
  { number: 5, name: 'Insulation',   blurb: 'Batt, blown, or rigid — controls heat loss' },
  { number: 6, name: 'Drywall',      blurb: 'Interior ceiling finish' },
]

export const EAVE_OVERHANG_TITLE = 'Eave Overhang Detail'
export const EAVE_OVERHANG_SUBTITLE = 'Where the roof meets the wall'
export const EAVE_OVERHANG_RANGE_LABEL = 'Typical overhang 16″–24″'
export const EAVE_PARTS: { name: string; blurb: string }[] = [
  { name: 'Rafter tail',  blurb: 'Exposed end of the rafter' },
  { name: 'Soffit',       blurb: 'Underside panel — ventilated' },
  { name: 'Fascia',       blurb: 'Vertical board at the eave' },
  { name: 'Drip edge',    blurb: 'Metal flashing along the eave' },
  { name: 'Gutter',       blurb: 'Channels rainwater away from the wall' },
]

export const COMMON_PITCHES_TITLE = 'Common Roof Pitches'
export const COMMON_PITCHES_SUBTITLE = 'Rise per 12″ of horizontal run'

export const COMMON_PITCHES: Array<{ label: string; degrees: string; description: string }> = [
  { label: '3/12',  degrees: '14°', description: 'Low slope' },
  { label: '6/12',  degrees: '27°', description: 'Standard' },
  { label: '8/12',  degrees: '34°', description: 'Steep' },
  { label: '12/12', degrees: '45°', description: 'Very steep' },
]

export const APPENDIX_TITLE = 'Roof Anatomy Reference'
export const APPENDIX_SUBTITLE = 'Glossary diagrams showing common residential roof components'
export const APPENDIX_DISCLAIMER =
  'Layer thicknesses and overhang dimensions shown are typical industry ranges. ' +
  'Actual values for this property may vary based on construction era, local building code, and contractor practice.'
