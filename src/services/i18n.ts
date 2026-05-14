// Multilingual MVP — French (Canada) + Spanish (US/LATAM) translations
// of the three highest-intent marketing pages: landing hero, pricing, about.
//
// These translations were AI-assisted and have NOT been reviewed by a
// native-speaker editor. They ship as a zero-competition SEO trial for
// /fr and /es prefixed routes; production copy should be replaced with
// human translations before a full marketing push.

export type Locale = 'fr' | 'es'
export const LOCALES: Locale[] = ['fr', 'es']

// Human-facing locale label for hreflang + <html lang="..."> values.
// fr-CA is the primary French target (Canadian French) but content reads
// as neutral French so fr-FR readers won't feel it's wrong.
// es-US is the primary Spanish target; content reads as neutral LATAM Spanish.
export const LOCALE_LANG: Record<Locale, string> = {
  fr: 'fr-CA',
  es: 'es-US',
}
export const LOCALE_NAME: Record<Locale, string> = {
  fr: 'Français',
  es: 'Español',
}

// Keyed message bundle. Each key appears across pages so editing copy is
// a single-file operation later when a human translator cleans this up.
export interface MessageBundle {
  brand_tagline: string
  nav_pricing: string
  nav_blog: string
  nav_about: string
  nav_help: string
  cta_start_free: string
  cta_get_4_free: string
  footer_tagline: string
  footer_about_link: string

  // Landing
  landing_hero_badge: string
  landing_hero_title: string
  landing_hero_title_highlight: string
  landing_hero_body: string
  landing_hero_bullet_1: string
  landing_hero_bullet_2: string
  landing_hero_bullet_3: string
  landing_hero_bullet_4: string
  landing_hero_cta: string
  landing_hero_disclaimer: string
  landing_translation_notice: string

  // Pricing
  pricing_title: string
  pricing_subtitle: string
  pricing_free_label: string
  pricing_free_desc: string
  pricing_per_report_label: string
  pricing_per_report_desc: string
  pricing_pack_10: string
  pricing_pack_25: string
  pricing_pack_100: string
  pricing_no_sub_note: string

  // About
  about_h1: string
  about_h1_highlight: string
  about_body: string
  about_mission_h: string
  about_mission_body: string
  about_how_h: string
  about_how_body: string
}

export const MESSAGES: Record<Locale, MessageBundle> = {
  fr: {
    brand_tagline: 'Mesure de toit par satellite + CRM pour couvreurs',
    nav_pricing: 'Tarifs',
    nav_blog: 'Blogue',
    nav_about: 'À propos',
    nav_help: 'Aide',
    cta_start_free: 'Commencer gratuitement',
    cta_get_4_free: 'Obtenir 4 rapports gratuits',
    footer_tagline: 'Rapports de mesure de toit par satellite en 1 à 2 heures.',
    footer_about_link: 'À propos',

    landing_hero_badge: 'Version française · bêta de traduction',
    landing_hero_title: 'Obtenez 4 rapports de toit gratuits.',
    landing_hero_title_highlight: 'Aucune carte de crédit requise.',
    landing_hero_body: 'Rapports de mesure de toit par satellite en 1 à 2 heures. Surface projetée et en pente, longueurs de rives, calcul du matériel — et un CRM complet inclus.',
    landing_hero_bullet_1: 'Mesure 3D par satellite avec le Google Solar API',
    landing_hero_bullet_2: 'Analyse IA de condition de toit avec Gemini 2.5',
    landing_hero_bullet_3: 'Secrétaire vocal IA 24/7 (LiveKit)',
    landing_hero_bullet_4: 'PDF professionnel en 1 à 2 heures',
    landing_hero_cta: 'Réclamer mes 4 rapports gratuits →',
    landing_hero_disclaimer: 'Pas de carte. Pas d\'appel. Annulation en tout temps.',
    landing_translation_notice: 'Cette page a été traduite par IA et n\'a pas encore été révisée par un traducteur francophone. La version anglaise sur roofmanager.ca fait foi.',

    pricing_title: 'Tarifs simples.',
    pricing_subtitle: '4 rapports gratuits. 8 $ par rapport après. Sans abonnement.',
    pricing_free_label: 'Essai gratuit',
    pricing_free_desc: '4 rapports professionnels de mesure de toit, sans carte de crédit.',
    pricing_per_report_label: 'Par rapport',
    pricing_per_report_desc: '8 $ par rapport après l\'essai. Payer à l\'usage.',
    pricing_pack_10: 'Pack de 10 — 75 $ (7,50 $ / rapport)',
    pricing_pack_25: 'Pack de 25 — 175 $ (7,00 $ / rapport)',
    pricing_pack_100: 'Pack de 100 — 595 $ (5,95 $ / rapport)',
    pricing_no_sub_note: 'Aucun abonnement mensuel. Le CRM, les soumissions et la facturation sont inclus dans chaque compte.',

    about_h1: 'La plateforme de mesure de toit',
    about_h1_highlight: 'construite pour les couvreurs, par des ingénieurs.',
    about_body: 'Roof Manager est une plateforme SaaS de mesure de toit par satellite et de CRM complet — soumissions, facturation, secrétaire vocal IA — conçue pour les entrepreneurs en toiture résidentielle et commerciale aux États-Unis et au Canada.',
    about_mission_h: 'Notre mission',
    about_mission_body: 'Éliminer l\'échelle, le temps de déplacement et la marge des tiers de chaque estimation de toit résidentielle — et donner aux entrepreneurs indépendants les mêmes capacités de mesure, CRM et automatisation que les grandes franchises payent des frais mensuels à cinq chiffres pour obtenir.',
    about_how_h: 'Comment nous construisons notre moteur de mesure',
    about_how_body: 'Nous ne revendons pas les rapports de mesure d\'un tiers. Le moteur est le nôtre — vérifiable, auditable, et recoupé avec plusieurs sources de données officielles avant qu\'un nombre n\'apparaisse dans votre rapport. Google Solar API pour l\'empreinte, moteur géodésique propriétaire pour les tracés, Gemini pour l\'analyse d\'image.',
  },
  es: {
    brand_tagline: 'Mediciones de techo por satélite + CRM para contratistas',
    nav_pricing: 'Precios',
    nav_blog: 'Blog',
    nav_about: 'Acerca de',
    nav_help: 'Ayuda',
    cta_start_free: 'Comenzar gratis',
    cta_get_4_free: 'Obtener 4 reportes gratis',
    footer_tagline: 'Reportes de medición de techo por satélite en menos de 60 segundos.',
    footer_about_link: 'Acerca de',

    landing_hero_badge: 'Versión en español · traducción beta',
    landing_hero_title: 'Obtenga 4 reportes de techo gratis.',
    landing_hero_title_highlight: 'Sin tarjeta de crédito.',
    landing_hero_body: 'Reportes de medición de techo por satélite en menos de 60 segundos. Área proyectada e inclinada, longitudes de bordes, cálculo de material — y un CRM completo incluido.',
    landing_hero_bullet_1: 'Medición 3D por satélite con Google Solar API',
    landing_hero_bullet_2: 'Análisis IA de condición de techo con Gemini 2.5',
    landing_hero_bullet_3: 'Recepcionista de voz IA 24/7 (LiveKit)',
    landing_hero_bullet_4: 'PDF profesional en menos de un minuto',
    landing_hero_cta: 'Reclamar mis 4 reportes gratis →',
    landing_hero_disclaimer: 'Sin tarjeta. Sin llamada. Cancele cuando quiera.',
    landing_translation_notice: 'Esta página fue traducida por IA y aún no ha sido revisada por un traductor nativo. La versión en inglés en roofmanager.ca es la versión autorizada.',

    pricing_title: 'Precios simples.',
    pricing_subtitle: '4 reportes gratis. $8 por reporte después. Sin suscripción.',
    pricing_free_label: 'Prueba gratis',
    pricing_free_desc: '4 reportes profesionales de medición de techo, sin tarjeta de crédito.',
    pricing_per_report_label: 'Por reporte',
    pricing_per_report_desc: '$8 por reporte después de la prueba. Pague por uso.',
    pricing_pack_10: 'Pack de 10 — $75 ($7.50 / reporte)',
    pricing_pack_25: 'Pack de 25 — $175 ($7.00 / reporte)',
    pricing_pack_100: 'Pack de 100 — $595 ($5.95 / reporte)',
    pricing_no_sub_note: 'Sin suscripción mensual. CRM, propuestas y facturación incluidos en cada cuenta.',

    about_h1: 'La plataforma de medición de techo',
    about_h1_highlight: 'construida para contratistas, por ingenieros.',
    about_body: 'Roof Manager es una plataforma SaaS de medición de techo por satélite y CRM completo — propuestas, facturación, recepcionista de voz IA — diseñada para contratistas de techos residenciales y comerciales en Estados Unidos y Canadá.',
    about_mission_h: 'Nuestra misión',
    about_mission_body: 'Eliminar la escalera, el tiempo de viaje y el margen de terceros de cada estimación de techo residencial — y dar a los contratistas independientes las mismas capacidades de medición, CRM y automatización por las que las grandes franquicias pagan cuotas mensuales de cinco cifras.',
    about_how_h: 'Cómo construimos nuestro motor de medición',
    about_how_body: 'No revendemos reportes de medición de terceros. El motor es nuestro — verificable, auditable, y cruzado con múltiples fuentes de datos oficiales antes de que un número llegue a su reporte. Google Solar API para el contorno, motor geodésico propietario para los trazos, Gemini para el análisis de imagen.',
  },
}

export function getBundle(locale: Locale): MessageBundle {
  return MESSAGES[locale]
}
