// Daily Almanac — three stacked "of the day" sections that roll over at midnight:
//   📖 Word of the day   — fully OFFLINE, deterministic by day-of-year (never fails);
//        carries its pronunciation, part of speech, etymology, definition, an example
//        sentence, and a quiet "≈ synonyms  ≠ antonyms" line for words that have them.
//   📜 On this day        — a rotating mix of today's historical events plus the
//        notable people born and who died on this date, from Wikipedia's keyless
//        onthisday feed; each birth/death is tagged so it reads unambiguously.
//        Gracefully falls back to an embedded "Fact of the day" when the network
//        is unavailable, so it never blanks.
//   ❝  Quote of the day   — zenquotes.io/today, embedded fallback.
// Sits beside the Weather card (both 'tall'). Network is best-effort: initial load
// retries with short backoff, periodic refresh fetches BEFORE replacing the DOM so a
// failure keeps the last good render. Embedded data guarantees content fully offline.

// ---- WORD OF THE DAY — curated, deterministic, no network ------------------
const WORDS = [
  { word: 'serendipity', pron: '/ˌsɛrənˈdɪpɪti/', pos: 'noun', def: 'The occurrence of happy or beneficial events by chance, in a fortunate accident.', ex: 'By pure serendipity, she found the missing letter tucked inside a library book.' },
  { word: 'petrichor', pron: '/ˈpɛtrɪkɔːr/', pos: 'noun', def: 'The earthy scent produced when rain falls on dry soil after a warm, dry spell.', ex: 'The first summer rain released a petrichor that drew everyone out onto their porches.' },
  { word: 'ephemeral', pron: '/ɪˈfɛmərəl/', pos: 'adjective', def: 'Lasting for a very short time; fleeting and quick to fade away.', ex: 'Cherry blossoms are beloved precisely because their beauty is so ephemeral.' },
  { word: 'sonder', pron: '/ˈsɒndər/', pos: 'noun', def: 'The realization that each passer-by is living a life as vivid and complex as your own.', ex: 'Watching the lit windows of the passing train, he was overcome by a quiet sonder.' },
  { word: 'limerence', pron: '/ˈlɪmərəns/', pos: 'noun', def: 'The state of being infatuated, marked by an involuntary longing for reciprocation.', ex: 'The early weeks of the romance were a haze of sleepless limerence.' },
  { word: 'mellifluous', pron: '/mɛˈlɪfluəs/', pos: 'adjective', def: 'Sweet or musical; pleasant to hear, as a smooth and flowing voice or sound.', ex: 'The cellist’s mellifluous tone lingered in the hall long after the final note.' },
  { word: 'halcyon', pron: '/ˈhælsiən/', pos: 'adjective', def: 'Denoting a period that is idyllically happy and peaceful, often in fond memory.', ex: 'They spoke of their college years as halcyon days that could never quite return.' },
  { word: 'susurrus', pron: '/suːˈsʌrəs/', pos: 'noun', def: 'A soft, whispering or rustling sound, like leaves or hushed voices.', ex: 'A susurrus of wind moved through the wheat as dusk settled over the field.' },
  { word: 'apricity', pron: '/əˈprɪsɪti/', pos: 'noun', def: 'The warmth of the sun felt on a cold winter day.', ex: 'We lingered on the bench, grateful for the apricity of the winter afternoon.' },
  { word: 'nepenthe', pron: '/nɪˈpɛnθi/', pos: 'noun', def: 'A drug or thing that brings forgetfulness of grief or suffering.', ex: 'He wished for some nepenthe to soften the memory of that long, hard year.' },
  { word: 'eloquence', pron: '/ˈɛləkwəns/', pos: 'noun', def: 'Fluent, persuasive, and graceful speaking or writing.', ex: 'Her closing argument was delivered with an eloquence that silenced the room.' },
  { word: 'quixotic', pron: '/kwɪkˈsɒtɪk/', pos: 'adjective', def: 'Exceedingly idealistic; unrealistic and impractical in a romantic, lofty way.', ex: 'His quixotic plan to sail around the world both charmed and worried his friends.' },
  { word: 'sublime', pron: '/səˈblaɪm/', pos: 'adjective', def: 'Of such excellence or beauty as to inspire great admiration or awe.', ex: 'From the summit the valley opened into a view that was simply sublime.' },
  { word: 'ineffable', pron: '/ɪnˈɛfəbl/', pos: 'adjective', def: 'Too great or extreme to be expressed or described in words.', ex: 'There was an ineffable calm in the empty cathedral at dawn.' },
  { word: 'luminescence', pron: '/ˌluːmɪˈnɛsns/', pos: 'noun', def: 'The emission of light by a substance that has not been heated, as a soft glow.', ex: 'A faint luminescence rippled through the waves as we walked the darkened beach.' },
  { word: 'wanderlust', pron: '/ˈwɒndəlʌst/', pos: 'noun', def: 'A strong, innate desire to travel and explore the world.', ex: 'A single postcard was enough to reawaken her old wanderlust.' },
  { word: 'effervescent', pron: '/ˌɛfəˈvɛsnt/', pos: 'adjective', def: 'Vivacious and enthusiastic; bubbling with high spirits.', ex: 'The host’s effervescent welcome put every guest instantly at ease.' },
  { word: 'solitude', pron: '/ˈsɒlɪtjuːd/', pos: 'noun', def: 'The state of being alone, often by choice and felt as restful.', ex: 'He treasured the solitude of early mornings before the city woke.' },
  { word: 'aurora', pron: '/ɔːˈrɔːrə/', pos: 'noun', def: 'A natural light display in the sky, mainly seen in high-latitude regions.', ex: 'They drove north for hours, hoping to glimpse the aurora over the pines.' },
  { word: 'reverie', pron: '/ˈrɛvəri/', pos: 'noun', def: 'A state of being pleasantly lost in one’s thoughts; a daydream.', ex: 'The whistle of the kettle pulled her out of a long reverie.' },
  { word: 'gossamer', pron: '/ˈɡɒsəmər/', pos: 'noun', def: 'A fine, filmy substance of cobwebs; anything delicate, light, and insubstantial.', ex: 'Dew clung to the gossamer threads strung between the fence posts.' },
  { word: 'incandescent', pron: '/ˌɪnkænˈdɛsnt/', pos: 'adjective', def: 'Emitting light from being heated; full of strong, intense emotion.', ex: 'She was incandescent with joy when the letter finally arrived.' },
  { word: 'vellichor', pron: '/ˈvɛlɪkɔːr/', pos: 'noun', def: 'The strange wistfulness of used bookstores, steeped in time and old paper.', ex: 'Browsing the dim aisles, he felt the vellichor of a thousand unread lives.' },
  { word: 'numinous', pron: '/ˈnjuːmɪnəs/', pos: 'adjective', def: 'Having a strong religious or spiritual quality; suggesting the presence of divinity.', ex: 'The old grove had a numinous stillness that hushed even the children.' },
  { word: 'evanescent', pron: '/ˌɛvəˈnɛsnt/', pos: 'adjective', def: 'Soon passing out of sight, memory, or existence; quickly fading.', ex: 'Fame proved evanescent, gone almost before he understood he had it.' },
  { word: 'plethora', pron: '/ˈplɛθərə/', pos: 'noun', def: 'A very large or excessive amount of something; an abundance.', ex: 'The market offered a plethora of ripe fruit at the height of summer.' },
  { word: 'panacea', pron: '/ˌpænəˈsiːə/', pos: 'noun', def: 'A solution or remedy supposed to cure all problems or diseases.', ex: 'No single policy is a panacea for so tangled a problem.' },
  { word: 'zephyr', pron: '/ˈzɛfər/', pos: 'noun', def: 'A soft, gentle breeze, especially one from the west.', ex: 'A gentle zephyr carried the scent of jasmine across the courtyard.' },
  { word: 'felicity', pron: '/fɪˈlɪsɪti/', pos: 'noun', def: 'Intense happiness; the ability to find apt and pleasing expression.', ex: 'She wrote with a felicity that made difficult ideas feel effortless.' },
  { word: 'verdant', pron: '/ˈvɜːdnt/', pos: 'adjective', def: 'Green with growing plants and vegetation; lush and flourishing.', ex: 'After the rains, the hills turned a deep, verdant green.' },
  { word: 'sanguine', pron: '/ˈsæŋɡwɪn/', pos: 'adjective', def: 'Optimistic or positive, especially in an apparently difficult situation.', ex: 'Despite the setbacks, the coach remained sanguine about the season.' },
  { word: 'aplomb', pron: '/əˈplɒm/', pos: 'noun', def: 'Self-confidence or assurance, especially in a demanding situation; poise.', ex: 'The young pianist handled the slip with remarkable aplomb.' },
  { word: 'lagom', pron: '/ˈlɑːɡɒm/', pos: 'noun', def: 'Swedish: not too much and not too little — the comfortable balance of just right.', ex: 'They furnished the flat with a lagom sense of just enough and no more.' },
  { word: 'hiraeth', pron: '/ˈhɪraɪθ/', pos: 'noun', def: 'A Welsh longing or homesickness for a home you cannot return to, or never was.', ex: 'Hearing the old song filled him with a hiraeth he could not quite name.' },
  { word: 'meraki', pron: '/meˈraki/', pos: 'noun', def: 'Greek: to do something with soul, creativity, and love; to put yourself into it.', ex: 'She poured meraki into every loaf that left her small corner bakery.' },
  { word: 'fernweh', pron: '/ˈfɛrnveː/', pos: 'noun', def: 'German: a deep ache or longing for far-off places one has yet to visit.', ex: 'The maps pinned across his wall only deepened his restless fernweh.' },
  { word: 'pellucid', pron: '/pɪˈluːsɪd/', pos: 'adjective', def: 'Transparently clear in style or meaning; easy to understand.', ex: 'The essay was admired for its pellucid, unhurried prose.' },
  { word: 'redolent', pron: '/ˈrɛdələnt/', pos: 'adjective', def: 'Strongly reminiscent or suggestive of something; fragrant or sweet-smelling.', ex: 'The kitchen was redolent of cinnamon and slow-roasting apples.' },
  { word: 'lissome', pron: '/ˈlɪsəm/', pos: 'adjective', def: 'Thin, supple, and graceful in movement.', ex: 'The dancer crossed the stage with a lissome, almost weightless grace.' },
  { word: 'ethereal', pron: '/ɪˈθɪəriəl/', pos: 'adjective', def: 'Extremely delicate and light, seemingly too perfect for this world.', ex: 'Morning fog gave the bridge an ethereal, half-there quality.' },
  { word: 'cynosure', pron: '/ˈsɪnəzjʊər/', pos: 'noun', def: 'A person or thing that is the centre of attention or admiration.', ex: 'In her emerald gown, she was the cynosure of every eye at the reception.' },
  { word: 'denouement', pron: '/deɪˈnuːmɒ̃/', pos: 'noun', def: 'The final part of a story in which strands are drawn together and resolved.', ex: 'The novel’s quiet denouement tied each loose thread with unexpected care.' },
  { word: 'sempiternal', pron: '/ˌsɛmpɪˈtɜːnl/', pos: 'adjective', def: 'Eternal and unchanging; everlasting.', ex: 'The monks kept a sempiternal flame burning in the chapel.' },
  { word: 'oneiric', pron: '/əˈnaɪrɪk/', pos: 'adjective', def: 'Relating to dreams or dreaming; having a dreamlike quality.', ex: 'The film unfolded with the drifting logic of an oneiric dream.' },
  { word: 'tarantism', pron: '/ˈtærəntɪzəm/', pos: 'noun', def: 'An uncontrollable urge to dance, historically thought caused by a spider’s bite.', ex: 'The bright reel struck the crowd with a kind of joyful tarantism.' },
  { word: 'syzygy', pron: '/ˈsɪzɪdʒi/', pos: 'noun', def: 'An alignment of three celestial bodies in a straight line, as in an eclipse.', ex: 'Astronomers gathered to watch the rare syzygy unfold across the night sky.' },
  { word: 'ebullient', pron: '/ɪˈbʌliənt/', pos: 'adjective', def: 'Cheerful and full of energy; overflowing with excitement.', ex: 'The team returned ebullient after the last-minute victory.' },
  { word: 'scintilla', pron: '/sɪnˈtɪlə/', pos: 'noun', def: 'A tiny trace or spark of a specified quality or feeling.', ex: 'There wasn’t a scintilla of doubt in her steady voice.' },
  { word: 'gloaming', pron: '/ˈɡləʊmɪŋ/', pos: 'noun', def: 'Twilight; the soft half-light of dusk just after the sun goes down.', ex: 'They walked the shoreline in the gloaming, the water gone to pewter.' },
  { word: 'crepuscular', pron: '/krɪˈpʌskjʊlə/', pos: 'adjective', def: 'Of, resembling, or active at twilight; dim and shadowy.', ex: 'Foxes are crepuscular, slipping out to hunt in the failing light.' },
  { word: 'quiescent', pron: '/kwiˈɛsnt/', pos: 'adjective', def: 'In a state of quiet inactivity; dormant and at rest.', ex: 'The volcano had lain quiescent for a hundred years.' },
  { word: 'eudaimonia', pron: '/ˌjuːdɪˈməʊniə/', pos: 'noun', def: 'Human flourishing; a deep, contented well-being that comes from living well.', ex: 'For Aristotle, eudaimonia was the highest aim of a good life.' },
  { word: 'frisson', pron: '/ˈfriːsɒn/', pos: 'noun', def: 'A sudden, passing shiver of excitement or delight.', ex: 'A frisson ran through the audience as the lights went down.' },
  { word: 'saudade', pron: '/saʊˈdɑːdə/', pos: 'noun', def: 'Portuguese: a wistful, aching longing for something loved and lost, or perhaps never had.', ex: 'The old fado songs are steeped in saudade for a vanished Lisbon.' },
  { word: 'komorebi', pron: '/ˌkoʊmoʊˈrɛbi/', pos: 'noun', def: 'Japanese: the dappled sunlight that filters through the leaves of trees.', ex: 'We ate beneath the maple, freckled with komorebi.' },
  { word: 'eunoia', pron: '/juːˈnɔɪə/', pos: 'noun', def: 'Beautiful thinking; a well mind and heart, and the goodwill it extends to others.', ex: 'She met every stranger with a quiet eunoia.' },
  { word: 'nebulous', pron: '/ˈnɛbjʊləs/', pos: 'adjective', def: 'Vague and ill-defined; hazy and cloud-like in form or meaning.', ex: 'His plans were still nebulous, more mood than map.' },
  { word: 'languor', pron: '/ˈlæŋɡə/', pos: 'noun', def: 'A pleasant heaviness or dreamy stillness; a soft, unhurried lack of energy.', ex: 'A summer languor settled over the porch by mid-afternoon.' },
  { word: 'quintessence', pron: '/kwɪnˈtɛsns/', pos: 'noun', def: 'The purest, most perfect example or embodiment of a quality.', ex: 'The little café was the quintessence of unhurried Parisian mornings.' },
  { word: 'noctilucent', pron: '/ˌnɒktɪˈluːsnt/', pos: 'adjective', def: 'Shining or glowing in the night, as the rare high clouds lit long after sunset.', ex: 'On midsummer nights the sky held faint, noctilucent clouds.' },
];

// ---- WORD ORIGINS — a quiet etymology for each word (offline, keyed by word).
// Kept as a separate map so the WORDS list above is never touched: a missing
// entry simply renders no origin line. Concise: language + literal roots.
const ORIGINS = {
  serendipity: 'coined 1754 · from “Serendip”',
  petrichor: 'Greek petra “stone” + ichor',
  ephemeral: 'Greek ephēmeros “lasting a day”',
  sonder: 'modern coinage',
  limerence: 'coined 1970s by D. Tennov',
  mellifluous: 'Latin mel “honey” + fluere',
  halcyon: 'Greek halkyōn “kingfisher”',
  susurrus: 'Latin · “a whispering”',
  apricity: 'Latin apricari “to bask”',
  nepenthe: 'Greek · “banishing grief”',
  eloquence: 'Latin eloqui “to speak out”',
  quixotic: 'from Don Quixote, 1605',
  sublime: 'Latin sublimis “lofty”',
  ineffable: 'Latin · “unutterable”',
  luminescence: 'Latin lumen “light”',
  wanderlust: 'German · “desire to wander”',
  effervescent: 'Latin · “to boil up”',
  solitude: 'Latin solus “alone”',
  aurora: 'Latin · Roman goddess of dawn',
  reverie: 'Old French · “revelry”',
  gossamer: 'Middle English “goose summer”',
  incandescent: 'Latin · “to glow white”',
  vellichor: 'modern coinage',
  numinous: 'Latin numen “divine power”',
  evanescent: 'Latin evanescere “to vanish”',
  plethora: 'Greek plēthōrē “fullness”',
  panacea: 'Greek · “all-healing”',
  zephyr: 'Greek Zephyros, west wind',
  felicity: 'Latin felicitas “happiness”',
  verdant: 'Old French “becoming green”',
  sanguine: 'Latin sanguis “blood”',
  aplomb: 'French à plomb “plumb-straight”',
  lagom: 'Swedish · “just enough”',
  hiraeth: 'Welsh · longing for home',
  meraki: 'Greek · to do with soul',
  fernweh: 'German fern “far” + Weh “ache”',
  pellucid: 'Latin pellucidus “transparent”',
  redolent: 'Latin redolere “to give scent”',
  lissome: 'variant of “lithesome”',
  ethereal: 'Greek aithēr “upper air”',
  cynosure: 'Greek “dog’s tail” · Pole Star',
  denouement: 'French dénouer “to untie”',
  sempiternal: 'Latin semper “always”',
  oneiric: 'Greek oneiros “dream”',
  tarantism: 'from Taranto, Italy',
  syzygy: 'Greek · “yoked together”',
  ebullient: 'Latin ebullire “to bubble”',
  scintilla: 'Latin · “a spark”',
  gloaming: 'Old English glōm “twilight”',
  crepuscular: 'Latin crepusculum “dusk”',
  quiescent: 'Latin quiescere “to rest”',
  eudaimonia: 'Greek eu “good” + daimōn',
  frisson: 'French · “a shiver”',
  saudade: 'Portuguese · Latin solitas',
  komorebi: 'Japanese 木漏れ日 · leaf-light',
  eunoia: 'Greek eu “good” + nous “mind”',
  nebulous: 'Latin nebula “mist, cloud”',
  languor: 'Latin languēre “to be faint”',
  quintessence: 'Latin quinta essentia',
  noctilucent: 'Latin nox “night” + lucēre',
};

// ---- SYNONYMS — a few kindred words for each entry (offline, keyed by word).
// Same pattern as ORIGINS: a separate map so WORDS is never touched, and a
// missing entry simply renders no synonyms line. Kept to 2-3 apt near-synonyms;
// the genuinely untranslatable coinages (petrichor, sonder, lagom, hiraeth…)
// are intentionally absent — they have no real synonym, and that silence is apt.
const SYNONYMS = {
  serendipity: ['chance', 'fluke', 'providence'],
  ephemeral: ['fleeting', 'transient', 'momentary'],
  limerence: ['infatuation', 'obsession'],
  mellifluous: ['honeyed', 'dulcet', 'melodious'],
  halcyon: ['peaceful', 'serene', 'idyllic'],
  susurrus: ['whisper', 'murmur', 'rustle'],
  nepenthe: ['solace', 'balm', 'oblivion'],
  eloquence: ['fluency', 'articulacy', 'expressiveness'],
  quixotic: ['idealistic', 'romantic', 'impractical'],
  sublime: ['majestic', 'awe-inspiring', 'exalted'],
  ineffable: ['indescribable', 'inexpressible', 'unutterable'],
  luminescence: ['glow', 'radiance', 'phosphorescence'],
  wanderlust: ['restlessness', 'itchy feet'],
  effervescent: ['bubbly', 'vivacious', 'lively'],
  solitude: ['seclusion', 'aloneness', 'isolation'],
  aurora: ['dawn', 'daybreak', 'sunrise'],
  reverie: ['daydream', 'musing', 'trance'],
  gossamer: ['delicate', 'filmy', 'diaphanous'],
  incandescent: ['glowing', 'radiant', 'luminous'],
  numinous: ['spiritual', 'sacred', 'transcendent'],
  evanescent: ['fleeting', 'transient', 'vanishing'],
  plethora: ['abundance', 'excess', 'surfeit'],
  panacea: ['cure-all', 'remedy', 'elixir'],
  zephyr: ['breeze', 'gust', 'waft'],
  felicity: ['bliss', 'happiness', 'joy'],
  verdant: ['green', 'lush', 'leafy'],
  sanguine: ['optimistic', 'hopeful', 'buoyant'],
  aplomb: ['poise', 'composure', 'self-assurance'],
  pellucid: ['clear', 'lucid', 'transparent'],
  redolent: ['evocative', 'reminiscent', 'suggestive'],
  lissome: ['supple', 'lithe', 'graceful'],
  ethereal: ['delicate', 'airy', 'celestial'],
  cynosure: ['focal point', 'lodestar', 'centrepiece'],
  denouement: ['resolution', 'finale', 'conclusion'],
  sempiternal: ['eternal', 'everlasting', 'perpetual'],
  oneiric: ['dreamlike', 'dreamy', 'surreal'],
  ebullient: ['exuberant', 'buoyant', 'high-spirited'],
  scintilla: ['trace', 'spark', 'iota'],
  gloaming: ['dusk', 'twilight', 'nightfall'],
  crepuscular: ['dim', 'shadowy', 'dusky'],
  quiescent: ['dormant', 'still', 'latent'],
  eudaimonia: ['flourishing', 'well-being', 'contentment'],
  frisson: ['thrill', 'shiver', 'tingle'],
  eunoia: ['goodwill', 'benevolence', 'kindliness'],
  nebulous: ['vague', 'hazy', 'indistinct'],
  languor: ['lassitude', 'listlessness', 'torpor'],
  quintessence: ['essence', 'epitome', 'embodiment'],
  noctilucent: ['night-glowing', 'luminous', 'gleaming'],
};

// ---- ANTONYMS — a few opposite words for each entry (offline, keyed by word).
// Same pattern as SYNONYMS: a separate map so WORDS is never touched, and a
// missing entry simply renders no antonyms clause. Only words with a genuine,
// clean opposite are listed; the untranslatable coinages and the neutral nouns
// (petrichor, sonder, aurora, reverie, zephyr…) are intentionally absent.
const ANTONYMS = {
  ephemeral: ['eternal', 'enduring', 'permanent'],
  mellifluous: ['harsh', 'grating', 'discordant'],
  halcyon: ['turbulent', 'stormy', 'troubled'],
  quixotic: ['pragmatic', 'realistic', 'hard-nosed'],
  sublime: ['ordinary', 'mundane', 'unremarkable'],
  ineffable: ['expressible', 'describable', 'commonplace'],
  luminescence: ['darkness', 'gloom'],
  effervescent: ['flat', 'listless', 'subdued'],
  solitude: ['company', 'togetherness', 'crowd'],
  gossamer: ['sturdy', 'heavy', 'substantial'],
  incandescent: ['dull', 'dim', 'lifeless'],
  numinous: ['mundane', 'profane', 'earthly'],
  evanescent: ['enduring', 'permanent', 'lasting'],
  plethora: ['scarcity', 'dearth', 'lack'],
  panacea: ['scourge', 'affliction'],
  felicity: ['misery', 'woe', 'wretchedness'],
  verdant: ['barren', 'arid', 'withered'],
  sanguine: ['pessimistic', 'gloomy', 'despondent'],
  aplomb: ['awkwardness', 'nervousness', 'unease'],
  pellucid: ['murky', 'opaque', 'muddled'],
  lissome: ['stiff', 'clumsy', 'ungainly'],
  ethereal: ['earthly', 'solid', 'corporeal'],
  sempiternal: ['fleeting', 'transient', 'momentary'],
  ebullient: ['subdued', 'listless', 'downcast'],
  gloaming: ['dawn', 'daybreak', 'sunrise'],
  crepuscular: ['bright', 'radiant', 'sunlit'],
  quiescent: ['active', 'restless', 'agitated'],
  eudaimonia: ['misery', 'wretchedness'],
  eunoia: ['ill will', 'malice'],
  nebulous: ['clear', 'distinct', 'defined'],
  languor: ['vigour', 'energy', 'briskness'],
  noctilucent: ['dark', 'lightless'],
};

// ---- FACT OF THE DAY — embedded fallback -----------------------------------
const FACTS = [
  'Honey never spoils — archaeologists have found 3,000-year-old jars in Egyptian tombs still perfectly edible.',
  'Octopuses have three hearts and blue blood; two hearts pump to the gills and one to the body.',
  'A day on Venus is longer than its year — it rotates slower than it orbits the Sun.',
  'Bananas are berries, but strawberries are not, botanically speaking.',
  'The Eiffel Tower can grow more than 15 cm taller in summer as the iron expands in the heat.',
  'Wombats produce cube-shaped droppings, which keep them from rolling off the rocks they mark.',
  'There are more possible games of chess than there are atoms in the observable universe.',
  'Sharks existed before trees — they have been around for over 400 million years.',
  'A group of flamingos is called a “flamboyance.”',
  'Hot water can freeze faster than cold water under some conditions — the Mpemba effect.',
  'The shortest war in history lasted about 38 minutes, between Britain and Zanzibar in 1896.',
  'Sea otters hold hands while sleeping so they do not drift apart on the water.',
  'A single bolt of lightning is roughly five times hotter than the surface of the Sun.',
  'The human nose can distinguish more than one trillion different scents.',
  'Cleopatra lived closer in time to the Moon landing than to the building of the Great Pyramid.',
  'Tardigrades can survive the vacuum of space, extreme radiation, and being boiled or frozen.',
  'A teaspoon of neutron star material would weigh about six billion tons on Earth.',
  'The dot over a lowercase “i” or “j” is called a tittle.',
  'Bees can recognise human faces by combining their facial features the way we do.',
  'The Great Wall of China is not visible from space with the naked eye, despite the myth.',
  'A jiffy is an actual unit of time — one hundredth of a second.',
  'Some turtles can breathe through their rear ends while hibernating underwater.',
  'The longest place name on Earth has 85 letters, a hill in New Zealand.',
  'Cows have best friends and can become stressed when they are separated from them.',
  'The inventor of the frisbee was turned into a frisbee — his ashes were molded into discs.',
  'Venus is the only planet in our solar system that spins clockwise.',
  'A bolt of lightning contains enough energy to toast about 100,000 slices of bread.',
  'Scotland’s national animal is the unicorn.',
  'Your stomach lining replaces itself every few days to avoid digesting itself.',
  'Saturn would float in water if there were a bathtub big enough — it is less dense than water.',
  'Butterflies taste with their feet to find out whether a leaf is good for laying eggs.',
  'The hashtag symbol is technically called an octothorpe.',
];

// ---- QUOTE OF THE DAY — embedded fallback ----------------------------------
const QUOTES = [
  { q: 'The only way to do great work is to love what you do.', a: 'Steve Jobs' },
  { q: 'In the middle of difficulty lies opportunity.', a: 'Albert Einstein' },
  { q: 'What we think, we become.', a: 'Buddha' },
  { q: 'The best way to predict the future is to invent it.', a: 'Alan Kay' },
  { q: 'It always seems impossible until it’s done.', a: 'Nelson Mandela' },
  { q: 'Whether you think you can or you think you can’t, you’re right.', a: 'Henry Ford' },
  { q: 'The journey of a thousand miles begins with one step.', a: 'Lao Tzu' },
  { q: 'Happiness is not something ready made. It comes from your own actions.', a: 'Dalai Lama' },
  { q: 'Do what you can, with what you have, where you are.', a: 'Theodore Roosevelt' },
  { q: 'The mind is everything. What you think you become.', a: 'Buddha' },
  { q: 'An unexamined life is not worth living.', a: 'Socrates' },
  { q: 'Simplicity is the ultimate sophistication.', a: 'Leonardo da Vinci' },
  { q: 'We are what we repeatedly do. Excellence, then, is a habit.', a: 'Aristotle' },
  { q: 'Turn your wounds into wisdom.', a: 'Oprah Winfrey' },
  { q: 'The only limit to our realization of tomorrow is our doubts of today.', a: 'Franklin D. Roosevelt' },
  { q: 'Everything you can imagine is real.', a: 'Pablo Picasso' },
  { q: 'Life is what happens when you’re busy making other plans.', a: 'John Lennon' },
  { q: 'It does not matter how slowly you go as long as you do not stop.', a: 'Confucius' },
  { q: 'The future belongs to those who believe in the beauty of their dreams.', a: 'Eleanor Roosevelt' },
  { q: 'You miss 100% of the shots you don’t take.', a: 'Wayne Gretzky' },
  { q: 'Act as if what you do makes a difference. It does.', a: 'William James' },
  { q: 'Quality is not an act, it is a habit.', a: 'Aristotle' },
  { q: 'If you want to lift yourself up, lift up someone else.', a: 'Booker T. Washington' },
  { q: 'Wherever you go, go with all your heart.', a: 'Confucius' },
  { q: 'Keep your face always toward the sunshine, and shadows will fall behind you.', a: 'Walt Whitman' },
  { q: 'A room without books is like a body without a soul.', a: 'Cicero' },
  { q: 'The best revenge is massive success.', a: 'Frank Sinatra' },
  { q: 'Nothing is impossible, the word itself says “I’m possible.”', a: 'Audrey Hepburn' },
  { q: 'Dream big and dare to fail.', a: 'Norman Vaughan' },
  { q: 'Stay hungry, stay foolish.', a: 'Stewart Brand' },
  { q: 'What you do speaks so loudly that I cannot hear what you say.', a: 'Ralph Waldo Emerson' },
];

// Day-of-year (1..366) in local time — stable for the whole day, rolls at midnight.
function dayOfYear(d = new Date()) {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d - start) / 864e5);
}
const pickByDay = (arr) => arr[dayOfYear() % arr.length];

// Wikipedia returns negative years for BC — render legibly, never as "-480".
const fmtYear = (y) => (y < 0 ? `${-y} BC` : String(y));
const p2 = (n) => String(n).padStart(2, '0');
// A relative "how long ago" phrase for a historical year — grounds a bare date
// in lived time ("1906 · 120 yrs ago"). BC years land far in the past, which is
// correct; the off-by-one from the missing year 0 is immaterial for an ambient wall.
const relYears = (y, nowY = new Date().getFullYear()) => {
  const n = nowY - y;
  if (n <= 0) return 'this year';
  return `${n.toLocaleString()} ${n === 1 ? 'yr' : 'yrs'} ago`;
};

export default {
  id: 'daily',
  title: 'Today',
  icon: '📖',
  size: 'tall',
  chrome: true,
  async mount(body, ctx) {
    const { h } = ctx;
    ctx.style(`
      /* Three sections split the tall card into FIXED, non-overlapping regions
         (flex thirds). Because a 'tall' card's height is coupled to the grid, it
         can shrink in production; equal regions + per-region overflow:hidden mean
         each block always ends in a clean ellipsis WITHIN its own region rather
         than being cut at the card's bottom edge. Content is vertically centred so
         the leftover slack reads as balanced breathing room, not an empty gap. */
      .dly { display:flex; flex-direction:column; height:100%; min-height:0;
        animation:dlyfade .6s ease-out both; }
      @keyframes dlyfade { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
      @media (prefers-reduced-motion: reduce) { .dly { animation:none; } }
      .dly-sec { display:flex; flex-direction:column; justify-content:center;
        min-height:0; overflow:hidden; padding:8px 0; }
      /* basis:auto → each region is sized by its own content (so the card keeps
         its generous 'tall' height and stays full); grow shares any extra space,
         shrink lets a region give way gracefully if the grid ever forces the card
         shorter — clamping within its region instead of at the card's edge. */
      .dly-word-sec { flex:1.15 1 auto; }
      .dly-fact-sec { flex:1 1 auto; }
      .dly-quote-sec { flex:1 1 auto; }
      .dly-sec + .dly-sec { border-top:1px solid var(--stroke); }
      .dly-lbl { font-family:var(--font-mono); font-size:11px; font-weight:600; letter-spacing:.2em;
        text-transform:uppercase; color:var(--ink-faint); margin-bottom:6px; flex:none; }

      /* WORD — the hero. Wraps to a 2nd line for long entries, then ellipsizes. */
      .dly-word { font-family:var(--font-display); font-weight:600; font-size:26px; line-height:1.1;
        color:var(--mint);
        background:linear-gradient(120deg,#fff,var(--mint)); -webkit-background-clip:text;
        background-clip:text; -webkit-text-fill-color:transparent;
        overflow-wrap:break-word; word-break:break-word;
        display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
      .dly-wmeta { margin-top:5px; display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; flex:none; }
      .dly-pron { font-family:var(--font-mono); font-size:12.5px; color:var(--ink-faint); }
      .dly-pos { font-style:italic; font-size:13px; color:var(--ink-soft); }
      /* etymology — a quiet mono caption beneath the word's pronunciation/part of
         speech, telling where the word comes from. One line, ellipsised, so it can
         never push the definition or example out of the region. */
      .dly-orig { margin-top:3px; font-family:var(--font-mono); font-size:11.5px; line-height:1.2;
        color:var(--ink-faint); letter-spacing:.01em; flex:none;
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:100%; }
      .dly-orig .rt { color:var(--mint-2); margin-right:6px; }
      .dly-def { margin-top:6px; font-size:14px; line-height:1.34; color:var(--ink);
        display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
      /* synonyms & antonyms — a quiet "kindred + opposite" line beneath the
         definition: a mint "≈" leads a few near-synonyms, and (when the word has
         a clean opposite) a cool blue "≠" leads a few antonyms on the SAME line.
         One line, ellipsised, so it can never push the example out of the region;
         adds no height. Hidden entirely when the word has neither. */
      .dly-syn { margin-top:5px; font-size:12.5px; line-height:1.25; color:var(--ink-soft);
        flex:none; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:100%; }
      .dly-syn .eq { color:var(--mint); font-weight:700; margin-right:7px; }
      .dly-syn .sw + .sw::before { content:'·'; color:var(--ink-faint); margin:0 6px; }
      /* antonyms — cool blue "≠" marker (paired with the mint "≈"); a wider left
         gap sets the opposites apart from the synonyms when both are present. */
      .dly-syn .neq { color:#9cc0ff; font-weight:700; margin-right:7px; }
      .dly-syn .sw + .neq { margin-left:13px; }
      .dly-syn .aw + .aw::before { content:'·'; color:var(--ink-faint); margin:0 6px; }
      /* example usage — a quiet italic line that shows the word living in a sentence.
         The word itself is emphasised in mint so the eye finds it at a glance. */
      .dly-ex { margin-top:5px; font-style:italic; font-size:12.5px; line-height:1.3; color:var(--ink-soft);
        display:-webkit-box; -webkit-line-clamp:1; -webkit-box-orient:vertical; overflow:hidden; }
      .dly-ex b { font-style:italic; font-weight:600; color:var(--mint); }

      /* ON THIS DAY (falls back to a plain fact when offline). The text is the
         flexible middle of its region and clamps with an ellipsis. */
      .dly-fact { font-size:14px; line-height:1.36; color:var(--ink); min-height:0;
        display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; overflow:hidden; }
      .dly-fact .yr { font-family:var(--font-display); font-weight:700; color:var(--mint);
        margin-right:8px; letter-spacing:.01em; }
      /* relative "how long ago" — a hushed mono caption beside the year, so the
         moment reads as both dated and grounded in lived time at a glance. */
      .dly-fact .ago { font-family:var(--font-mono); font-size:11px; color:var(--ink-faint);
        margin-right:8px; letter-spacing:.02em; white-space:nowrap; }
      /* kind tag — a quiet "born"/"died" caption that leads a birthday or memorial
         entry, so the rotating history reads unambiguously (a life, not an event).
         Plain events carry no tag; the "On This Day" label already implies them. */
      .dly-fact .kind { font-family:var(--font-mono); font-size:10.5px; font-weight:700;
        letter-spacing:.1em; text-transform:uppercase; margin-right:8px; }
      .dly-fact .kind.born { color:var(--mint); }
      .dly-fact .kind.died { color:var(--ink-soft); }
      /* rotation indicator — a hushed "moment N of M today" caption with a slim
         progress rail, revealing that On This Day quietly cycles through all of
         today's notable moments over the day (advances every half-hour). Bounded
         width + fixed tiny height (flex:none), so it never grows the region or
         clips; static, no animation. Hidden entirely in the offline fact fallback. */
      .dly-otd-nav { display:flex; align-items:center; gap:9px; margin-top:7px; flex:none; }
      .dly-otd-nav .rail { position:relative; flex:1 1 auto; height:2px; border-radius:2px;
        background:rgba(255,255,255,.08); overflow:hidden; }
      .dly-otd-nav .rail .fill { position:absolute; left:0; top:0; bottom:0; border-radius:2px;
        background:var(--mint); opacity:.75; }
      .dly-otd-nav .rail .fill.born { background:var(--mint); }
      .dly-otd-nav .rail .fill.died { background:var(--ink-soft); }
      .dly-otd-nav .lbl { flex:0 0 auto; font-family:var(--font-mono); font-size:10px;
        letter-spacing:.1em; color:var(--ink-faint); white-space:nowrap; }
      .dly-otd-nav .lbl b { color:var(--ink-soft); font-weight:600; }

      /* QUOTE — the quote clamps and the attribution is pinned as a fixed footer
         inside this region (margin-top:auto), so it can never overlap the block
         above nor slip past the card's bottom edge. */
      .dly-quote { font-family:var(--font-display); font-style:italic; font-size:15px; line-height:1.32;
        color:var(--ink); min-height:0;
        display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
      .dly-auth { margin-top:8px; text-align:right; font-family:var(--font-mono); font-size:12.5px;
        color:var(--mint); letter-spacing:.02em; flex:none;
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    `);

    // ---- WORD: fully offline, never fails ------------------------------------
    const wordEl = h('div', { class: 'dly-word' });
    const pronEl = h('span', { class: 'dly-pron' });
    const posEl = h('span', { class: 'dly-pos' });
    const origEl = h('div', { class: 'dly-orig' });
    const defEl = h('div', { class: 'dly-def' });
    const synEl = h('div', { class: 'dly-syn' });
    const exEl = h('div', { class: 'dly-ex' });
    const wordSec = h('div', { class: 'dly-sec dly-word-sec' },
      h('div', { class: 'dly-lbl' }, 'Word of the Day'),
      wordEl,
      h('div', { class: 'dly-wmeta' }, pronEl, posEl),
      origEl,
      defEl, synEl, exEl);
    // Render the example with the headword emphasised in mint, matching case-
    // insensitively so inflected forms still highlight. Falls back to plain text.
    const applyExample = (w) => {
      exEl.title = w.ex || '';
      if (!w.ex) { exEl.replaceChildren(); return; }
      const stem = w.word.slice(0, Math.max(4, w.word.length - 2));
      const re = new RegExp(`(${stem}[\\w’']*)`, 'i');
      const m = re.exec(w.ex);
      if (!m) { exEl.textContent = w.ex; return; }
      exEl.replaceChildren(
        w.ex.slice(0, m.index),
        h('b', {}, m[0]),
        w.ex.slice(m.index + m[0].length));
    };
    const applyWord = (w) => {
      wordEl.textContent = w.word; wordEl.title = w.word;
      pronEl.textContent = w.pron; posEl.textContent = w.pos; defEl.textContent = w.def;
      // Etymology (optional): a quiet "root" mark + the word's origin. Hidden
      // entirely when we have none, so no empty caption line is ever left behind.
      const origin = ORIGINS[w.word];
      if (origin) {
        origEl.style.display = '';
        origEl.title = `Origin — ${origin}`;
        origEl.replaceChildren(h('span', { class: 'rt' }, 'origin'), origin);
      } else {
        origEl.style.display = 'none';
        origEl.replaceChildren();
      }
      // Synonyms + antonyms (both optional) share ONE line: a mint "≈" then a few
      // kindred words, and a cool-blue "≠" then a few opposites. Either clause is
      // shown only when we have it; the whole line hides when we have neither, so
      // no empty line is ever left behind and no vertical height is added.
      const syns = SYNONYMS[w.word];
      const ants = ANTONYMS[w.word];
      const hasSyn = syns && syns.length;
      const hasAnt = ants && ants.length;
      if (hasSyn || hasAnt) {
        synEl.style.display = '';
        const parts = [];
        const titleBits = [];
        if (hasSyn) {
          parts.push(h('span', { class: 'eq' }, '≈'),
            ...syns.map((s) => h('span', { class: 'sw' }, s)));
          titleBits.push(`Synonyms — ${syns.join(', ')}`);
        }
        if (hasAnt) {
          parts.push(h('span', { class: 'neq' }, '≠'),
            ...ants.map((a) => h('span', { class: 'aw' }, a)));
          titleBits.push(`Antonyms — ${ants.join(', ')}`);
        }
        synEl.title = titleBits.join('   ·   ');
        synEl.replaceChildren(...parts);
      } else {
        synEl.style.display = 'none';
        synEl.replaceChildren();
      }
      applyExample(w);
    };
    applyWord(pickByDay(WORDS));

    // ---- ON THIS DAY + QUOTE: start from embedded fallback, upgrade from network
    // The middle section shows a dated historical moment when Wikipedia answers,
    // and degrades to an embedded "Fact of the Day" when offline — so it always
    // holds something rather than blanking.
    const otdLbl = h('div', { class: 'dly-lbl' }, 'Fact of the Day');
    const factEl = h('div', { class: 'dly-fact' }, pickByDay(FACTS));
    // Rotation indicator (hidden until a live "On This Day" list is loaded): a slim
    // progress rail + "N of M today" caption showing where the half-hourly rotation
    // currently sits within all of today's notable moments.
    const otdFill = h('div', { class: 'fill' });
    const otdLblPos = h('div', { class: 'lbl' });
    const otdNav = h('div', { class: 'dly-otd-nav', style: 'display:none' },
      h('div', { class: 'rail' }, otdFill), otdLblPos);
    const factSec = h('div', { class: 'dly-sec dly-fact-sec' }, otdLbl, factEl, otdNav);

    const quoteEl = h('div', { class: 'dly-quote' });
    const authEl = h('div', { class: 'dly-auth' });
    const quoteSec = h('div', { class: 'dly-sec dly-quote-sec' },
      h('div', { class: 'dly-lbl' }, 'Quote of the Day'), quoteEl, authEl);
    const applyQuoteObj = ({ q, a }) => { quoteEl.textContent = `“${q}”`; authEl.textContent = `— ${a}`; };
    applyQuoteObj(pickByDay(QUOTES));

    body.replaceChildren(h('div', { class: 'dly' }, wordSec, factSec, quoteSec));

    // Network fetchers — each returns parsed content or throws. Never touch the DOM
    // until we have a good value, so a failure simply keeps the last good render.
    const fetchOnThisDay = async () => {
      const now = new Date();
      // The combined "all" feed carries events, curated highlights, and notable
      // births/deaths for today's date in a single keyless call — a richer, more
      // human read of the day than events alone.
      const url = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/all/${p2(now.getMonth() + 1)}/${p2(now.getDate())}`;
      const d = await ctx.fetchJSON(url) || {};
      const clean = (arr, kind) => (Array.isArray(arr) ? arr : [])
        .filter((e) => e && e.text && Number.isFinite(e.year))
        .map((e) => ({ kind, year: e.year, text: e.text.toString().trim() }))
        .sort((a, b) => b.year - a.year); // newest → oldest within a kind
      // Prefer Wikipedia's curated "selected" highlights for the event stream
      // (the day's most notable moments); fall back to the raw events list.
      const selected = clean(d.selected, 'event');
      const events = (selected.length ? selected : clean(d.events, 'event')).slice(0, 12);
      const births = clean(d.births, 'born').slice(0, 8);
      const deaths = clean(d.deaths, 'died').slice(0, 8);
      if (!events.length && !births.length && !deaths.length) throw new Error('no entries');
      // Interleave the three kinds so the half-hourly rotation alternates
      // event → born → died for varied texture, rather than a long run of one.
      const mixed = [];
      const max = Math.max(events.length, births.length, deaths.length);
      for (let i = 0; i < max; i++) {
        if (i < events.length) mixed.push(events[i]);
        if (i < births.length) mixed.push(births[i]);
        if (i < deaths.length) mixed.push(deaths[i]);
      }
      return mixed;
    };
    const fetchQuote = async () => {
      const d = await ctx.fetchJSON('https://zenquotes.io/api/today');
      const item = Array.isArray(d) ? d[0] : null;
      const q = item && (item.q || '').toString().trim();
      const a = item && (item.a || '').toString().trim();
      if (!q) throw new Error('empty quote');
      return { q, a: a || 'Unknown' };
    };

    // Embedded fallback fact (offline): plain text under the "Fact of the Day" label.
    const applyFact = (text) => { otdLbl.textContent = 'Fact of the Day'; factEl.textContent = text; otdNav.style.display = 'none'; };

    // Live historical moments: we hold the whole "on this day" list and rotate
    // through it over the day, so a glance at the wall lands on a different moment
    // each half-hour rather than the same fixed event. otdLive tracks that we have
    // a good live render; otdDateKey lets us keep our rotation position when the
    // network refresh returns the SAME date, and reset only when the day rolls over.
    let otdEvents = [];
    let otdIdx = 0;
    let otdDateKey = '';
    let otdLive = false;
    const renderOnThisDay = () => {
      if (!otdEvents.length) return;
      const n = otdEvents.length;
      const { kind, year, text } = otdEvents[((otdIdx % n) + n) % n];
      otdLbl.textContent = 'On This Day';
      const ago = relYears(year);
      const kids = [];
      if (kind === 'born') kids.push(h('span', { class: 'kind born' }, 'born'));
      else if (kind === 'died') kids.push(h('span', { class: 'kind died' }, 'died'));
      kids.push(
        h('span', { class: 'yr' }, fmtYear(year)),
        h('span', { class: 'ago' }, ago),
        text);
      factEl.replaceChildren(...kids);
      const lead = kind === 'born' ? 'Born ' : kind === 'died' ? 'Died ' : '';
      factEl.title = `${lead}${fmtYear(year)} (${ago}) — ${text}`;
      // Position indicator: which moment of today's M we're showing. Only shown
      // when there's more than one moment to rotate through; the rail is tinted to
      // the current entry's kind so the caption echoes the moment above it.
      const pos = (((otdIdx % n) + n) % n) + 1;
      if (n > 1) {
        otdFill.className = `fill${kind === 'born' ? ' born' : kind === 'died' ? ' died' : ''}`;
        otdFill.style.width = `${Math.round((pos / n) * 100)}%`;
        otdLblPos.replaceChildren(h('b', {}, String(pos)), ` of ${n} today`);
        otdNav.style.display = '';
      } else {
        otdNav.style.display = 'none';
      }
      otdLive = true;
    };
    // Install a freshly fetched list. On a new date (or first load), seed the
    // rotation deterministically by day-of-year; on the same date, preserve where
    // the rotation currently sits so a background refresh doesn't jump the reader.
    const loadOnThisDay = (list) => {
      const now = new Date();
      const key = `${now.getMonth() + 1}-${now.getDate()}`;
      if (key !== otdDateKey) { otdDateKey = key; otdIdx = dayOfYear() % list.length; }
      otdEvents = list;
      renderOnThisDay();
    };
    const applyQuote = applyQuoteObj;

    // Initial load: a few attempts with short backoff before settling on embedded.
    const tryLoad = async (fetcher, apply) => {
      for (let i = 0; i < 3; i++) {
        try { apply(await fetcher()); return; }
        catch { await new Promise((r) => setTimeout(r, 700 * (i + 1))); }
      }
      // give up — embedded fallback already on screen
    };
    // Don't let one slow section block the other.
    tryLoad(fetchOnThisDay, loadOnThisDay);
    tryLoad(fetchQuote, applyQuote);

    // Periodic refresh (every 30 min, so content rolls over at midnight):
    //   - re-pick the OFFLINE word so it always reflects the current day;
    //   - re-pick the embedded fact/quote first (covers a day-change while offline),
    //     then try the network and upgrade in place only if it succeeds (keeps the
    //     last good render on failure — network calls never blank the section);
    //   - ADVANCE the "On This Day" rotation so each half-hour surfaces a fresh
    //     moment from today's date (works offline once the list is loaded).
    let firstTick = true;
    ctx.interval(() => {
      // ctx.interval fires immediately; the initial network load is handled by
      // tryLoad above (with retry backoff), so skip the network on this first tick.
      if (firstTick) { firstTick = false; return; }
      applyWord(pickByDay(WORDS));
      if (otdLive && otdEvents.length) {
        // Step to the next historical moment we already hold — no network needed.
        otdIdx += 1;
        renderOnThisDay();
      } else {
        // Still offline for history — keep a rolling embedded fact on screen.
        applyFact(pickByDay(FACTS));
      }
      applyQuote(pickByDay(QUOTES));
      // Refresh the list from the network (covers the midnight day-change in place);
      // loadOnThisDay preserves the rotation position within the same day.
      fetchOnThisDay().then(loadOnThisDay).catch(() => {});
      fetchQuote().then(applyQuote).catch(() => {});
    }, 30 * 60 * 1000);
  },
};
