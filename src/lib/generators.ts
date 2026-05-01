/**
 * Generadores de improvisación para el DM. Cuando los players entran en
 * una taberna que no preparaste, te tira un nombre + 4 detalles random.
 *
 * Los datasets son chicos y curados — no pretenden ser exhaustivos. Son
 * para "darle color a algo improvisado en 2 segundos".
 */

export interface GeneratorLine {
  label: string;
  value: string;
}

export interface GeneratorResult {
  generatorId: string;
  generatorLabel: string;
  title: string;
  lines: GeneratorLine[];
}

export interface Generator {
  id: string;
  label: string;
  icon: string;
  generate: () => GeneratorResult;
}

const pick = <T>(arr: readonly T[]): T =>
  arr[Math.floor(Math.random() * arr.length)];

// ── NPCs ────────────────────────────────────────────────────────────────────

const FIRST_NAMES_ES = [
  "Aldric", "Bren", "Cassia", "Dorian", "Elena", "Faelan", "Gilda", "Hagen",
  "Ileana", "Jorel", "Kira", "Lior", "Mira", "Nael", "Orla", "Pyrrha",
  "Quintana", "Roen", "Sela", "Theron", "Ursa", "Vael", "Wren", "Xanthe",
  "Yarrow", "Zara",
];

const SURNAMES = [
  "del Río", "del Viento", "Piedraalta", "Maderaluz", "Nievescaída",
  "Ojos de Plata", "Mano de Bronce", "Hierro Quieto", "el Ciervo", "la Sombra",
  "Pajarrojo", "Cantorroto", "el Tuerto", "la Murmurante", "Alas Largas",
];

const RACES = [
  "humano", "elfo", "elfa", "enano", "enana", "halfling", "gnomo", "tiefling",
  "drácono", "medio-orco", "media-orca", "aasimar", "goliath",
];

const OCCUPATIONS = [
  "tabernero", "tabernera", "guardia de la ciudad", "mercader de hierbas",
  "armero", "panadera", "ladrón retirado", "sacerdote menor", "espía a sueldo",
  "minero", "carpintero", "cazadora de criaturas", "afinador de instrumentos",
  "barquera", "bibliotecario aficionado", "soldado de fortuna", "alquimista",
  "bardo callejero", "domador de bestias", "ermitaño", "noble venido a menos",
];

const TRAITS = [
  "habla muy bajo, casi en un susurro",
  "le falta un ojo y nunca explica por qué",
  "siempre tiene algo masticando entre los dientes",
  "le tiene pánico a los gatos",
  "no para de bromear, incluso en momentos serios",
  "huele fuerte a tabaco",
  "se persigna cada vez que cruza una puerta",
  "guarda monedas extranjeras en los bolsillos",
  "tiene cicatrices en los nudillos",
  "es daltónico y se confunde con cosas rojas",
  "lleva un anillo que pertenecía a alguien que murió",
  "habla seis idiomas pero finge dos",
  "se rasca la nuca cuando miente",
  "tararea una canción de cuna sin darse cuenta",
  "tiene un acento que nadie sabe identificar",
];

const SECRETS = [
  "está endeudado con un noble local que va a venir a cobrar",
  "tiene un hijo bastardo en otro pueblo",
  "es informante de la guardia",
  "robó algo de valor hace años y lo escondió en su casa",
  "espera la llegada de alguien y se irá apenas aparezca",
  "está enamorado/a de un PJ desde el primer momento",
  "fue parte de un culto que ahora niega",
  "esconde un objeto mágico menor que no sabe que es mágico",
  "tiene una enfermedad terminal y no se lo dijo a nadie",
  "vio algo que no debía ver hace una semana",
  "es agente de una potencia extranjera",
  "vendió a alguien al carcelero por una bolsa de monedas",
  "está pagando una deuda de sangre con su trabajo",
  "es un cambiapieles que aún no se reveló",
];

const npcGen: Generator = {
  id: "npc",
  label: "NPC random",
  icon: "👤",
  generate: () => {
    const first = pick(FIRST_NAMES_ES);
    const last = pick(SURNAMES);
    return {
      generatorId: "npc",
      generatorLabel: "NPC",
      title: `${first} ${last}`,
      lines: [
        { label: "Raza", value: pick(RACES) },
        { label: "Ocupación", value: pick(OCCUPATIONS) },
        { label: "Rasgo", value: pick(TRAITS) },
        { label: "Secreto", value: pick(SECRETS) },
      ],
    };
  },
};

// ── Tabernas ────────────────────────────────────────────────────────────────

const TAVERN_NAMES = [
  "El Cuervo Negro", "La Daga Oxidada", "El Jabalí Borracho",
  "Tres Lunas", "El Yelmo Roto", "La Sirena Muda", "El Dragón Dormido",
  "El Bardo Tuerto", "Las Tres Hermanas", "El Pozo del Eco",
  "La Hoja de Sauce", "El Cántaro Rojo", "La Muralla del Norte",
  "El Caballo Blanco", "La Brujita Curiosa", "El Centinela",
];

const TAVERN_TYPES = [
  "humilde, frecuentada por trabajadores y viajeros",
  "lujosa, donde nobles y mercaderes cierran tratos",
  "tugurio peligroso al borde del barrio bajo",
  "concurrida por aventureros y caza-recompensas",
  "limpia y respetable, propiedad de un clérigo retirado",
  "decadente — tuvo días de gloria, ahora medio vacía",
  "popular entre marinos y contrabandistas",
];

const TAVERN_SCENES = [
  "una pelea de tres borrachos sobre quién tiene mejor caballo",
  "un bardo desafinado intentando una canción heroica",
  "un grupo de mercaderes susurrando sobre rutas seguras",
  "una elfa solitaria mirando fijo la ventana, llorando",
  "un enano que paga rondas a todo el mundo y no dice por qué",
  "dos guardias fuera de servicio jugando dados con un mago",
  "alguien cae al piso desmayado, pero nadie reacciona",
  "un niño escondido bajo una mesa robando carteras",
  "una pareja de halflings discutiendo sobre el menú",
  "un perro grande dormido frente a la chimenea",
];

const TAVERN_SPECIALS = [
  "estofado de venado con cebolla caramelizada",
  "cerveza negra que sabe a roble quemado",
  "vino dulce de las montañas del este",
  "pan recién horneado con miel y queso",
  "una sopa de pescado con un secreto que nadie pregunta",
  "hidromiel especiada con clavo",
  "carne ahumada que el cocinero llama 'su receta'",
];

const tavernGen: Generator = {
  id: "tavern",
  label: "Taberna",
  icon: "🍻",
  generate: () => ({
    generatorId: "tavern",
    generatorLabel: "Taberna",
    title: pick(TAVERN_NAMES),
    lines: [
      { label: "Tipo", value: pick(TAVERN_TYPES) },
      { label: "Escena", value: pick(TAVERN_SCENES) },
      { label: "Especialidad", value: pick(TAVERN_SPECIALS) },
    ],
  }),
};

// ── Loot ─────────────────────────────────────────────────────────────────────

const MUNDANE_LOOT = [
  "una bolsa con 1d6 × 10 piezas de plata",
  "un mapa rasgado de una mina abandonada",
  "una daga ceremonial con runas que nadie reconoce",
  "tres pociones de curación menor",
  "un anillo grabado con un nombre desconocido",
  "una carta sellada dirigida a alguien con el apellido del próximo PNJ que el DM decida",
  "un libro de cuentas con números tachados",
  "un saquito con polvo plateado (componente de hechizo)",
  "una flauta tallada en hueso",
  "tres flechas con la punta envenenada",
  "una llave de hierro sin cerradura conocida",
  "un colgante con un retrato en miniatura",
  "una bolsita de hierbas raras (50 po a un alquimista)",
  "un pergamino con un hechizo de rango 1 al azar",
];

const VALUABLE_LOOT = [
  "un broche de oro con un rubí (250 po)",
  "una espada larga +1 con empuñadura de plata",
  "una poción de invisibilidad",
  "100 piezas de oro en una bolsa con el sello de un noble local",
  "un anillo de protección contra el frío",
  "una capa élfica que parece moverse sola con el viento",
  "un cofre cerrado con un mecanismo (Inteligencia DC 14 para abrir)",
  "una piedra que brilla suavemente cuando se acerca al peligro",
  "un libro mágico con 2d4 hechizos de bajo rango",
  "un puñal +1 que susurra cuando entra en combate",
];

const lootGen: Generator = {
  id: "loot",
  label: "Botín",
  icon: "💰",
  generate: () => {
    const valuable = Math.random() < 0.3;
    const items: GeneratorLine[] = [];
    const count = valuable ? 1 : 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      items.push({
        label: `Ítem ${i + 1}`,
        value: pick(valuable ? VALUABLE_LOOT : MUNDANE_LOOT),
      });
    }
    return {
      generatorId: "loot",
      generatorLabel: "Botín",
      title: valuable ? "Botín valioso" : "Botín mundano",
      lines: items,
    };
  },
};

// ── Tiempo / clima ──────────────────────────────────────────────────────────

const WEATHER_OPTS = [
  "soleado, brisa cálida del oeste",
  "nublado pero seco, niebla que se levanta al mediodía",
  "lluvia ligera intermitente, charcos por todos lados",
  "tormenta repentina con relámpagos a lo lejos",
  "frío seco, escarcha en los techos al amanecer",
  "nieve suave, todo el sonido amortiguado",
  "calor pesado y húmedo, los animales molestos",
  "viento fuerte del norte, banderas tirando con violencia",
  "amanecer rojizo extraño, pájaros callados",
];

const weatherGen: Generator = {
  id: "weather",
  label: "Clima",
  icon: "🌤",
  generate: () => ({
    generatorId: "weather",
    generatorLabel: "Clima",
    title: pick(WEATHER_OPTS),
    lines: [],
  }),
};

// ── Registry ─────────────────────────────────────────────────────────────────

export const GENERATORS: Generator[] = [npcGen, tavernGen, lootGen, weatherGen];

export function findGenerator(id: string): Generator | undefined {
  return GENERATORS.find((g) => g.id === id);
}

export function generatorResultToMarkdown(r: GeneratorResult): string {
  const lines = [`# ${r.title}`, ``];
  for (const l of r.lines) {
    lines.push(`- **${l.label}**: ${l.value}`);
  }
  return lines.join("\n");
}
