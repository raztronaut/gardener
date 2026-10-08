// Daily Almanac — three stacked "of the day" sections that roll over at midnight:
//   📖 Word of the day   — a LIVE word drawn each day from Datamuse (a keyless API):
//        one of ~56 evocative theme seeds per day surfaces kindred words with their
//        definition, part of speech and pronunciation. Dull over-common words are
//        filtered out, and a rolling localStorage memory skips any word shown in the
//        last ~45 days — so the word has genuine, ever-fresh variety instead of
//        recycling the same vocabulary every few weeks. The day's pick is cached so it
//        stays stable across refreshes/reloads. Datamuse's ARPAbet pronunciation is
//        rendered as the same plain-English "say-it-like" respelling used by the curated
//        words. If the network is unavailable it falls back to a curated, fully-annotated
//        OFFLINE word (IPA, etymology, example, "≈ synonyms ≠ antonyms"), so it never fails.
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
  { word: 'brume', pron: '/bruːm/', pos: 'noun', def: 'Mist or fog, especially a soft wintry haze that softens the view.', ex: 'A pale brume hung over the bay, dissolving the far hills into grey.' },
  { word: 'aubade', pron: '/əʊˈbɑːd/', pos: 'noun', def: 'A song or poem greeting the dawn; music made for the early morning.', ex: 'He woke to birdsong, an aubade drifting through the open window.' },
  { word: 'lambent', pron: '/ˈlæmbənt/', pos: 'adjective', def: 'Glowing softly; flickering over a surface with a gentle, radiant light.', ex: 'Lambent candlelight moved slowly across the old stone walls.' },
  { word: 'vespertine', pron: '/ˈvɛspərtaɪn/', pos: 'adjective', def: 'Of, relating to, or occurring in the evening.', ex: 'The garden released its vespertine scent as the light began to fail.' },
  { word: 'psithurism', pron: '/ˈsɪθjʊrɪzəm/', pos: 'noun', def: 'The soft whispering sound of wind moving through the trees.', ex: 'We lay in the meadow and listened to the psithurism of the pines.' },
  { word: 'murmuration', pron: '/ˌmɜːmjʊˈreɪʃn/', pos: 'noun', def: 'A great flock of starlings wheeling as one; a low, continuous murmur.', ex: 'At dusk a murmuration folded and unfolded above the reeds.' },
  { word: 'sillage', pron: '/siːˈjɑːʒ/', pos: 'noun', def: 'The lingering trail of scent left behind by someone as they pass.', ex: 'A sillage of jasmine lingered in the hallway long after she had gone.' },
  { word: 'hygge', pron: '/ˈhuːɡə/', pos: 'noun', def: 'Danish: a cosy, contented warmth found in simple comforts and good company.', ex: 'Rain on the roof and a pot of tea — the evening was pure hygge.' },
  { word: 'ikigai', pron: '/ˌiːkɪˈɡaɪ/', pos: 'noun', def: 'Japanese: a reason for being — the thing that makes life feel worth living.', ex: 'Tending the garden each morning had become her quiet ikigai.' },
  { word: 'cwtch', pron: '/kʊtʃ/', pos: 'noun', def: 'Welsh: a warm, affectionate hug, or a small safe and cosy place.', ex: 'Come here for a cwtch — the world can wait a moment.' },
  { word: 'pluviophile', pron: '/ˈpluːviəfaɪl/', pos: 'noun', def: 'A lover of rain; someone who finds joy and calm in rainy days.', ex: 'A true pluviophile, she flung the windows open at the first storm.' },
  { word: 'nemophilist', pron: '/nɪˈmɒfɪlɪst/', pos: 'noun', def: 'One who loves woods and forests; a haunter of quiet groves.', ex: 'The old nemophilist knew every deer path through the redwoods.' },
  { word: 'ataraxia', pron: '/ˌætəˈræksiə/', pos: 'noun', def: 'A serene calm; freedom from worry and emotional disturbance.', ex: 'After a week by the sea he returned in a state of gentle ataraxia.' },
  { word: 'solivagant', pron: '/səˈlɪvəɡənt/', pos: 'adjective', def: 'Wandering alone; given to solitary rambling.', ex: 'His solivagant habit led him down streets no map had ever named.' },
  { word: 'chatoyant', pron: '/ʃəˈtɔɪənt/', pos: 'adjective', def: 'Shimmering with a shifting lustre, like a cat’s eye or fine silk.', ex: 'The chatoyant silk shifted from green to gold as she turned.' },
  { word: 'refulgent', pron: '/rɪˈfʌldʒənt/', pos: 'adjective', def: 'Shining brilliantly; radiant and gleaming with light.', ex: 'The refulgent dome caught and held the very last of the sun.' },
  { word: 'limpid', pron: '/ˈlɪmpɪd/', pos: 'adjective', def: 'Perfectly clear and transparent; calm and untroubled.', ex: 'The stream ran limpid over a bed of pale, rounded stones.' },
  { word: 'sonorous', pron: '/ˈsɒnərəs/', pos: 'adjective', def: 'Deep, full, and resonant in sound.', ex: 'The old bell gave a sonorous toll that rolled across the valley.' },
  { word: 'eventide', pron: '/ˈiːvəntaɪd/', pos: 'noun', def: 'The end of the day; evening, especially at its gentle close.', ex: 'They walked home at eventide, the sky gone to rose and grey.' },
  { word: 'coddiwomple', pron: '/ˈkɒdiwɒmpl/', pos: 'verb', def: 'To travel purposefully toward an as-yet-unknown destination.', ex: 'With no plan but a full tank, they set off to coddiwomple up the coast.' },
  { word: 'brontide', pron: '/ˈbrɒntaɪd/', pos: 'noun', def: 'The low, distant rumble of thunder, or a thunder-like sound.', ex: 'A faint brontide rolled beyond the hills, promising rain by morning.' },
  { word: 'selcouth', pron: '/ˈsɛlkuːθ/', pos: 'adjective', def: 'Strange and rare, yet wonderful; unfamiliar in a marvellous way.', ex: 'The tide pools held a selcouth world of drifting, glowing things.' },
  { word: 'estival', pron: '/ˈɛstɪvl/', pos: 'adjective', def: 'Of or belonging to summer; appearing in the summertime.', ex: 'The estival heat drew everyone into the shade of the plane trees.' },
  { word: 'dwaal', pron: '/dwɑːl/', pos: 'noun', def: 'South African: a dreamy, absent-minded or pleasantly dazed state.', ex: 'She drifted through the whole slow afternoon in a pleasant dwaal.' },
  { word: 'mångata', pron: '/ˈmoːnɡɑːta/', pos: 'noun', def: 'Swedish: the shimmering, road-like reflection of the moon on water.', ex: 'A single mångata stretched across the black water toward the far shore.' },
  { word: 'gökotta', pron: '/jœˈkɔta/', pos: 'noun', def: 'Swedish: to rise at dawn and go outside just to hear the first birdsong.', ex: 'They kept a summer gökotta, slipping out at first light to hear the thrushes.' },
  { word: 'resfeber', pron: '/ˈreːsfeːber/', pos: 'noun', def: 'Swedish: the restless, fluttering heart in the moments before a journey begins.', ex: 'The night before the flight she lay awake in a happy resfeber.' },
  { word: 'friluftsliv', pron: '/ˈfriːlʊftsliːv/', pos: 'noun', def: 'Norwegian: open-air living — a restorative, unhurried communion with nature.', ex: 'Weekends were for friluftsliv: a rucksack, a trail, and the open sky.' },
  { word: 'waldeinsamkeit', pron: '/valtˈaɪnzamkaɪt/', pos: 'noun', def: 'German: the serene, solitary feeling of being alone in the woods.', ex: 'Deep among the redwoods he felt a hush of pure waldeinsamkeit.' },
  { word: 'vorfreude', pron: '/ˈfoːɐfrɔɪdə/', pos: 'noun', def: 'German: the savoured, joyful anticipation of a pleasure still to come.', ex: 'Half the joy of the trip was the vorfreude of planning it for months.' },
  { word: 'wabi-sabi', pron: '/ˈwɑːbi ˈsɑːbi/', pos: 'noun', def: 'Japanese: the art of finding beauty in imperfection, age, and impermanence.', ex: 'The cracked, hand-thrown bowl held a quiet wabi-sabi all its own.' },
  { word: 'tsundoku', pron: '/tsɯnˈdokɯ/', pos: 'noun', def: 'Japanese: the gentle habit of buying books and letting them pile up unread.', ex: 'Her nightstand was a monument to tsundoku, ten spines deep.' },
  { word: 'querencia', pron: '/keˈɾenθja/', pos: 'noun', def: 'Spanish: a place where one feels safe, at home, and most truly oneself.', ex: 'The old reading chair by the window was her querencia.' },
  { word: 'duende', pron: '/ˈdwende/', pos: 'noun', def: 'Spanish: a surge of soulful, spellbinding passion, especially in art or music.', ex: 'The guitarist played with a raw duende that stilled the whole room.' },
  { word: 'sprezzatura', pron: '/ˌsprɛtsaˈtuːra/', pos: 'noun', def: 'Italian: studied nonchalance — making the difficult look wholly effortless.', ex: 'He wore the borrowed tux with an easy sprezzatura, as if born to it.' },
  { word: 'flâneur', pron: '/flɑːˈnɜːr/', pos: 'noun', def: 'French: one who strolls the city slowly, savouring it with no aim but delight.', ex: 'A born flâneur, he let the side streets decide where the evening went.' },
  { word: 'mudita', pron: '/mʊˈdiːtɑː/', pos: 'noun', def: 'Sanskrit: the pure, unselfish joy of delighting in another’s happiness.', ex: 'Watching her rival take the prize, she felt only a warm mudita.' },
  { word: 'eucatastrophe', pron: '/ˌjuːkəˈtæstrəfi/', pos: 'noun', def: 'A sudden, redemptive turn of events; a joyous catastrophe.', ex: 'The rescue arrived like a eucatastrophe, snatching hope from the last page.' },
];

// ---- SAY IT LIKE — a plain-English pronunciation respelling for each word
// (offline, keyed by word). The IPA in WORDS is precise but unreadable to most
// people; this is the "say-it-like" cue that actually lets someone pronounce these
// lovely words aloud. Same pattern as ORIGINS/SYNONYMS: a separate map so WORDS is
// never touched, and a missing entry simply renders no respelling. The STRESSED
// syllable is written in CAPS so the emphasis reads at a glance.
const SAY = {
  serendipity: 'seh-ruhn-DIP-ih-tee',
  petrichor: 'PET-rih-kor',
  ephemeral: 'ih-FEM-er-uhl',
  sonder: 'SON-der',
  limerence: 'LIM-er-uhns',
  mellifluous: 'meh-LIF-loo-uhs',
  halcyon: 'HAL-see-uhn',
  susurrus: 'soo-SUR-uhs',
  apricity: 'uh-PRIS-ih-tee',
  nepenthe: 'nih-PEN-thee',
  eloquence: 'EL-uh-kwuhns',
  quixotic: 'kwik-SOT-ik',
  sublime: 'suh-BLYME',
  ineffable: 'in-EF-uh-buhl',
  luminescence: 'loo-mih-NES-uhns',
  wanderlust: 'WON-der-lust',
  effervescent: 'ef-er-VES-uhnt',
  solitude: 'SOL-ih-tood',
  aurora: 'aw-ROR-uh',
  reverie: 'REV-er-ee',
  gossamer: 'GOS-uh-mer',
  incandescent: 'in-kan-DES-uhnt',
  vellichor: 'VEL-ih-kor',
  numinous: 'NOO-mih-nuhs',
  evanescent: 'ev-uh-NES-uhnt',
  plethora: 'PLETH-er-uh',
  panacea: 'pan-uh-SEE-uh',
  zephyr: 'ZEF-er',
  felicity: 'fuh-LIS-ih-tee',
  verdant: 'VUR-duhnt',
  sanguine: 'SANG-gwin',
  aplomb: 'uh-PLOM',
  lagom: 'LAH-gom',
  hiraeth: 'HEER-ryth',
  meraki: 'meh-RAH-kee',
  fernweh: 'FERN-vey',
  pellucid: 'peh-LOO-sid',
  redolent: 'RED-uh-luhnt',
  lissome: 'LIS-uhm',
  ethereal: 'ih-THEER-ee-uhl',
  cynosure: 'SIN-uh-shoor',
  denouement: 'day-noo-MON',
  sempiternal: 'sem-pih-TUR-nuhl',
  oneiric: 'oh-NY-rik',
  tarantism: 'TAR-uhn-tiz-uhm',
  syzygy: 'SIZ-ih-jee',
  ebullient: 'ih-BULL-yuhnt',
  scintilla: 'sin-TIL-uh',
  gloaming: 'GLOH-ming',
  crepuscular: 'krih-PUS-kyuh-ler',
  quiescent: 'kwee-ES-uhnt',
  eudaimonia: 'yoo-dy-MOH-nee-uh',
  frisson: 'free-SON',
  saudade: 'sow-DAH-duh',
  komorebi: 'koh-moh-REH-bee',
  eunoia: 'yoo-NOY-uh',
  nebulous: 'NEB-yuh-luhs',
  languor: 'LANG-ger',
  quintessence: 'kwin-TES-uhns',
  noctilucent: 'nok-tih-LOO-suhnt',
  brume: 'BROOM',
  aubade: 'oh-BAHD',
  lambent: 'LAM-buhnt',
  vespertine: 'VES-per-tyne',
  psithurism: 'SITH-yoo-riz-uhm',
  murmuration: 'mur-myuh-RAY-shuhn',
  sillage: 'see-YAHZH',
  hygge: 'HOO-guh',
  ikigai: 'ee-kee-GUY',
  cwtch: 'KUUTCH',
  pluviophile: 'PLOO-vee-uh-file',
  nemophilist: 'nih-MOF-ih-list',
  ataraxia: 'at-uh-RAK-see-uh',
  solivagant: 'suh-LIV-uh-guhnt',
  chatoyant: 'shuh-TOY-uhnt',
  refulgent: 'rih-FUHL-juhnt',
  limpid: 'LIM-pid',
  sonorous: 'SON-er-uhs',
  eventide: 'EE-vuhn-tide',
  coddiwomple: 'KOD-ee-wom-pul',
  brontide: 'BRON-tide',
  selcouth: 'SEL-kooth',
  estival: 'ES-tih-vuhl',
  dwaal: 'DVAHL',
  'mångata': 'MOHN-gah-ta',
  'gökotta': 'yer-KOT-a',
  resfeber: 'RESS-fay-ber',
  friluftsliv: 'FREE-loofts-liv',
  waldeinsamkeit: 'VALD-ine-zam-kite',
  vorfreude: 'FOR-froy-duh',
  'wabi-sabi': 'WAH-bee SAH-bee',
  tsundoku: 'tsoon-DOH-koo',
  querencia: 'keh-REN-see-ah',
  duende: 'DWEN-day',
  sprezzatura: 'spret-sah-TOO-rah',
  'flâneur': 'flah-NUR',
  mudita: 'moo-DEE-tah',
  eucatastrophe: 'yoo-kuh-TAS-truh-fee',
};

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
  brume: 'French brume “fog, mist”',
  aubade: 'French · Spanish alba “dawn”',
  lambent: 'Latin lambere “to lick”',
  vespertine: 'Latin vesper “evening”',
  psithurism: 'Greek psithuros “whispering”',
  murmuration: 'Latin murmur “a murmur”',
  sillage: 'French sillage “wake, trail”',
  hygge: 'Danish · Norwegian “well-being”',
  ikigai: 'Japanese 生き甲斐 “reason to live”',
  cwtch: 'Welsh · “cubbyhole, embrace”',
  pluviophile: 'Latin pluvia “rain” + -phile',
  nemophilist: 'Greek nemos “grove” + -phile',
  ataraxia: 'Greek · “impassiveness”',
  solivagant: 'Latin solus “alone” + vagari',
  chatoyant: 'French chatoyer “to shimmer”',
  refulgent: 'Latin refulgēre “to shine out”',
  limpid: 'Latin limpidus “clear”',
  sonorous: 'Latin sonor “sound”',
  eventide: 'Old English ǣfentīd “eventime”',
  coddiwomple: 'modern English coinage',
  brontide: 'Greek brontē “thunder”',
  selcouth: 'Old English seldcūth “seldom known”',
  estival: 'Latin aestas “summer”',
  dwaal: 'Afrikaans · Dutch dwalen “to wander”',
  'mångata': 'Swedish måne “moon” + gata “road”',
  'gökotta': 'Swedish · “dawn cuckoo-song”',
  resfeber: 'Swedish resa “journey” + feber “fever”',
  friluftsliv: 'Norwegian · “free-air life”',
  waldeinsamkeit: 'German Wald “forest” + Einsamkeit',
  vorfreude: 'German vor “before” + Freude “joy”',
  'wabi-sabi': 'Japanese 侘寂 · “rustic patina”',
  tsundoku: 'Japanese 積ん読 · “pile-up reading”',
  querencia: 'Spanish querer “to love, to desire”',
  duende: 'Spanish · “spirit, sprite”',
  sprezzatura: 'Italian · coined 1528, Castiglione',
  'flâneur': 'French flâner “to stroll, saunter”',
  mudita: 'Sanskrit/Pali · “sympathetic joy”',
  eucatastrophe: 'coined by Tolkien · Greek eu “good”',
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
  brume: ['mist', 'haze', 'fog'],
  lambent: ['glowing', 'radiant', 'flickering'],
  vespertine: ['evening', 'twilit', 'crepuscular'],
  psithurism: ['whisper', 'rustle', 'susurrus'],
  ataraxia: ['serenity', 'calm', 'tranquillity'],
  solivagant: ['wandering', 'roving', 'roaming'],
  chatoyant: ['shimmering', 'iridescent', 'lustrous'],
  refulgent: ['radiant', 'brilliant', 'luminous'],
  limpid: ['clear', 'transparent', 'lucid'],
  sonorous: ['resonant', 'rich', 'full'],
  eventide: ['evening', 'dusk', 'gloaming'],
  brontide: ['rumble', 'roll', 'roar'],
  selcouth: ['strange', 'wondrous', 'marvellous'],
  estival: ['summery', 'summerlike'],
  duende: ['passion', 'soul', 'fire'],
  sprezzatura: ['nonchalance', 'insouciance', 'panache'],
  'flâneur': ['stroller', 'saunterer', 'idler'],
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
  brume: ['clarity', 'clearness'],
  lambent: ['dull', 'dark', 'lightless'],
  ataraxia: ['anxiety', 'turmoil', 'agitation'],
  chatoyant: ['matte', 'dull', 'lustreless'],
  refulgent: ['dull', 'dim', 'lightless'],
  limpid: ['murky', 'cloudy', 'opaque'],
  sonorous: ['thin', 'tinny', 'muffled'],
  eventide: ['dawn', 'daybreak', 'morning'],
  selcouth: ['familiar', 'ordinary', 'commonplace'],
  estival: ['hibernal', 'wintry'],
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

// ---- QUOTE AUTHORS — a quiet role/era for each embedded author (offline, keyed
// by name). Same pattern as ORIGINS/SYNONYMS: a separate map so QUOTES is never
// touched, and a missing entry (e.g. an unfamiliar author from the live feed)
// simply renders no role tag. Concise — one or two words that place the voice.
const AUTHORS = {
  'Steve Jobs': 'Apple co-founder',
  'Albert Einstein': 'physicist',
  'Buddha': 'spiritual teacher',
  'Alan Kay': 'computer scientist',
  'Nelson Mandela': 'statesman',
  'Henry Ford': 'industrialist',
  'Lao Tzu': 'Taoist sage',
  'Dalai Lama': 'spiritual leader',
  'Theodore Roosevelt': 'US president',
  'Socrates': 'philosopher',
  'Leonardo da Vinci': 'polymath',
  'Aristotle': 'philosopher',
  'Oprah Winfrey': 'broadcaster',
  'Franklin D. Roosevelt': 'US president',
  'Pablo Picasso': 'painter',
  'John Lennon': 'musician',
  'Confucius': 'philosopher',
  'Eleanor Roosevelt': 'diplomat',
  'Wayne Gretzky': 'hockey great',
  'William James': 'psychologist',
  'Booker T. Washington': 'educator',
  'Walt Whitman': 'poet',
  'Cicero': 'Roman orator',
  'Frank Sinatra': 'singer',
  'Audrey Hepburn': 'actor',
  'Norman Vaughan': 'explorer',
  'Stewart Brand': 'writer',
  'Ralph Waldo Emerson': 'essayist',
};

// Day-of-year (1..366) in local time — stable for the whole day, rolls at midnight.
function dayOfYear(d = new Date()) {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d - start) / 864e5);
}
const pickByDay = (arr) => arr[dayOfYear() % arr.length];
// Stable per-day key (local time) for caching/deduping the live word.
const todayKey = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

// ---- ANTI-REPEAT MEMORY (localStorage) -------------------------------------
// The humans noticed the Word of the Day recycling the same vocabulary. The live
// word is drawn from a theme cloud, but similar themes surface overlapping words,
// so purely picking by score/day still recurs every few weeks. To make it feel
// genuinely fresh we keep a small rolling memory of recently-shown words and skip
// them when choosing, and we cache the day's chosen word so it stays stable across
// the day's refreshes and page reloads. All access is wrapped so a locked-down or
// unavailable localStorage simply disables the memory rather than throwing.
const LS_HIST = 'garden.wotd.history.v1';   // [{w,d}] recently-shown words, oldest→newest
const LS_TODAY = 'garden.wotd.today.v1';    // {d, n} today's chosen normalised word
const HIST_KEEP = 45;                        // don't repeat a word within ~45 days
const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
const recentWords = () => { const h = lsGet(LS_HIST); return Array.isArray(h) ? h.map((e) => e && e.w).filter(Boolean) : []; };
const rememberWord = (w) => {
  let h = lsGet(LS_HIST); if (!Array.isArray(h)) h = [];
  h = h.filter((e) => e && e.w && e.w !== w);   // drop any prior copy, then re-add as newest
  h.push({ w, d: todayKey() });
  if (h.length > HIST_KEEP) h = h.slice(h.length - HIST_KEEP);
  lsSet(LS_HIST, h);
};

// ---- LIVE WORD OF THE DAY (Datamuse) ---------------------------------------
// The curated WORDS list above is beautiful but finite, so a purely offline pick
// (dayOfYear % length) recycles the same words every few months. To give the word
// genuine, ever-fresh variety we draw the day's word LIVE from Datamuse — a
// reputable, keyless API that returns a word together with its definition, part of
// speech and pronunciation in ONE call. Each day we choose one evocative THEME seed
// and let Datamuse surface words that mean-like it (dusk→gloaming, twilit, evenfall…),
// then pick one deterministically for the day. Datamuse's ARPAbet pronunciation is
// converted to the same plain-English "say-it-like" respelling the curated words use.
// If the network is unavailable the widget silently keeps the offline curated word,
// so it never blanks. The seeds are evocative MOOD/QUALITY words (not concrete
// nouns) — these reliably surface lovely true-synonym clouds (serene → tranquil,
// placid; ephemeral → transient, transitory) rather than mundane associations.
const SEEDS = ['luminous', 'serene', 'ephemeral', 'radiant', 'tranquil', 'graceful',
  'delicate', 'fragrant', 'dreamy', 'mysterious', 'elegant', 'soothing', 'hushed',
  'lush', 'vivid', 'wondrous', 'solitary', 'gleaming', 'sublime', 'ethereal',
  'verdant', 'celestial', 'melancholy', 'wistful', 'nostalgic', 'fleeting',
  'shimmering', 'velvety', 'whimsical', 'opulent', 'austere', 'resplendent',
  'secluded', 'boundless', 'idyllic', 'languid', 'enigmatic', 'incandescent',
  'gossamer', 'twilit', 'sonorous', 'fervent', 'yearning', 'untamed', 'sacred',
  'windswept', 'moonlit', 'brooding', 'effervescent', 'pristine', 'clandestine',
  'labyrinthine', 'spellbound', 'halcyon', 'ineffable', 'mercurial'];

// ARPAbet phoneme string (e.g. "P EH1 T R IH0 K ER0") → a plain-English respelling
// ("PEH-trih-ker") with the stressed syllable in CAPS, matching the curated SAY map's
// house style so live words are just as sayable. Rough but readable; returns '' if it
// can't parse anything, in which case the pronunciation line simply hides.
const ARPA_V = { AA: 'ah', AE: 'a', AH: 'uh', AO: 'aw', AW: 'ow', AY: 'y', EH: 'eh',
  ER: 'er', EY: 'ay', IH: 'ih', IY: 'ee', OW: 'oh', OY: 'oy', UH: 'uu', UW: 'oo' };
const ARPA_C = { B: 'b', CH: 'ch', D: 'd', DH: 'th', F: 'f', G: 'g', HH: 'h', JH: 'j',
  K: 'k', L: 'l', M: 'm', N: 'n', NG: 'ng', P: 'p', R: 'r', S: 's', SH: 'sh', T: 't',
  TH: 'th', V: 'v', W: 'w', Y: 'y', Z: 'z', ZH: 'zh' };
function arpabetToSay(arpa) {
  const toks = String(arpa || '').trim().split(/\s+/);
  // Build syllables around each vowel nucleus. Consonants between two vowels split
  // "maximal-onset-lite": the last pending consonant opens the next syllable, the
  // rest close the previous one — so "P EH T R IH K ER" reads "PEHT-rih-ker" rather
  // than clumping every consonant onto one syllable.
  const syls = [];
  let prev = null, cons = [];
  const flushPrev = (coda) => { if (prev) { prev.coda = coda.join(''); syls.push(prev); } };
  for (const t of toks) {
    const m = t.match(/^([A-Z]+)(\d?)$/);
    if (!m) continue;
    const base = m[1];
    if (ARPA_V[base] !== undefined) {
      const stress = m[2] === '1' ? 1 : (m[2] === '2' ? 2 : 0);
      let onset = '';
      if (prev) {
        if (cons.length) { onset = cons[cons.length - 1]; flushPrev(cons.slice(0, -1)); }
        else flushPrev([]);
      } else { onset = cons.join(''); }
      prev = { onset, nucleus: ARPA_V[base], coda: '', stress };
      cons = [];
    } else if (ARPA_C[base] !== undefined) {
      cons.push(ARPA_C[base]);
    }
  }
  if (prev) { prev.coda = cons.join(''); syls.push(prev); }
  if (!syls.length) return '';
  const hasPrimary = syls.some((s) => s.stress === 1);
  return syls
    .map((s, i) => {
      const txt = s.onset + s.nucleus + s.coda;
      return (s.stress === 1 || syls.length === 1 || (!hasPrimary && i === 0)) ? txt.toUpperCase() : txt;
    })
    .join('-');
}

// Turn one Datamuse result into a tidy candidate, or null if it lacks the parts we
// need. `defs` entries are "<pos>\t<definition>"; `tags` carry the part of speech,
// an ARPAbet "pron:…" and a frequency "f:…". We keep the definition that matches the
// word's part of speech when possible.
const DM_POS = { n: 'noun', adj: 'adjective', adv: 'adverb', v: 'verb' };
function parseDatamuse(c) {
  if (!c || !c.word) return null;
  const tags = Array.isArray(c.tags) ? c.tags : [];
  let pos = '', abbr = '';
  for (const t of tags) { if (DM_POS[t]) { pos = DM_POS[t]; abbr = t; break; } }
  const pronTag = tags.find((t) => t.startsWith('pron:'));
  const fTag = tags.find((t) => t.startsWith('f:'));
  const f = fTag ? parseFloat(fTag.slice(2)) : null;
  const defs = Array.isArray(c.defs) ? c.defs : [];
  const picked = (abbr && defs.find((d) => d.startsWith(abbr + '\t'))) || defs[0] || '';
  let def = picked.replace(/^[a-z]+\t/i, '').trim();
  // drop bare "(usage)" parentheticals that some Wiktionary defs open with, and tidy
  def = def.replace(/^\((?:transitive|intransitive|obsolete|archaic|rare|dated|informal|figuratively)\)\s*/i, '').trim();
  if (def) { def = def.charAt(0).toUpperCase() + def.slice(1); if (!/[.!?]$/.test(def)) def += '.'; }
  // `syn` marks a true synonym of the seed (vs a merely-associated word), which is
  // how we keep the day's word lovely rather than tangential.
  return { word: c.word, pos, def, say: pronTag ? arpabetToSay(pronTag.slice(5)) : '',
    f, score: c.score || 0, syn: tags.includes('syn') };
}

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
// A "round anniversary" of a historical year — exactly a multiple of 25 years ago
// to the day (the 25th, 50th, 100th, 150th…). On an ambient almanac this turns an
// ordinary date into a quiet occasion. It fires RARELY (only when a rotating
// moment happens to land on a milestone), so the section stays calm and speaks up
// only when there's a genuine anniversary to mark. Returns { years } or null
// (this-year / non-round); the BC off-by-one is immaterial for a wall. Exported
// for smoke — the "multiple of 25, ≥ 25" rule is the invariant.
export function milestoneOf(year, nowY = new Date().getFullYear()) {
  if (!Number.isFinite(year)) return null;
  const n = nowY - year;
  if (n >= 25 && n % 25 === 0) return { years: n };
  return null;
}

export default {
  id: 'daily',
  title: 'Today',
  icon: '📖',
  size: 'tall',
  chrome: true,
  frame: false, // zigzag of open cards (2026-10-06)
  // Fullscreen: the same content at ~1.5× type, natural height (no flex thirds, no
  // clamping) — the panel sizes to it, so there's no empty space.
  async openFull(body, ctx) {
    const wrap = ctx.h('div', { class: 'dly-full' });
    body.replaceChildren(wrap);
    // own <style> (ctx.style is deduped per widget, so it can't add a 2nd sheet)
    if (!document.getElementById('style-daily-full')) {
      const st = document.createElement('style'); st.id = 'style-daily-full'; st.textContent = `
      .dly-full { zoom:1.5; padding:0 4px 8px; }
      .dly-full .dly { height:auto; gap:22px; }
      .dly-full .dly > * { flex:none !important; overflow:visible !important; min-height:0; }
      .dly-full * { -webkit-line-clamp:unset !important; max-height:none !important; }
    `; document.head.appendChild(st);
    }
    await this.mount(wrap, ctx);
  },
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
        animation:dlyfade .22s linear both; }
      @keyframes dlyfade { from{opacity:0} to{opacity:1} }
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
      .dly-lbl { font-family:var(--font-mono); font-size:12.5px; font-weight:600; letter-spacing:.2em;
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
      /* plain-English "say-it-like" respelling, trailing the IPA on the SAME line —
         a hushed mint clause (the stressed syllable is CAPS in the data itself), so
         the word is actually sayable. Fits within the half-width line, adding no
         height; hidden entirely when the word has no respelling. */
      .dly-pron .say { color:var(--mint-2); letter-spacing:.01em; }
      .dly-pos { font-style:italic; font-size:13px; color:var(--ink-soft); }
      /* etymology — a quiet mono caption beneath the word's pronunciation/part of
         speech, telling where the word comes from. One line, ellipsised, so it can
         never push the definition or example out of the region. */
      .dly-orig { margin-top:3px; font-family:var(--font-mono); font-size:13px; line-height:1.2;
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
      .dly-fact { font-size:14px; line-height:1.36; color:var(--ink); flex:none;
        max-height:calc(14px * 1.36 * 3); padding-bottom:0;
        display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
      .dly-fact .yr { font-family:var(--font-display); font-weight:700; color:var(--mint);
        margin-right:8px; letter-spacing:.01em; }
      /* relative "how long ago" — a hushed mono caption beside the year, so the
         moment reads as both dated and grounded in lived time at a glance. */
      .dly-fact .ago { font-family:var(--font-mono); font-size:12.5px; color:var(--ink-faint);
        margin-right:8px; letter-spacing:.02em; white-space:nowrap; }
      /* round-anniversary marker — a moment falling exactly a multiple of 25 years
         ago to the day turns its "how long ago" clause warm gold with a ✦, so the
         almanac quietly marks the occasion. Inline on the existing meta line (adds
         no height, can't clip); fires rarely, keeping the section calm. */
      .dly-fact .ago.ms { color:var(--gold); font-weight:600; }
      /* kind tag — a quiet "born"/"died" caption that leads a birthday or memorial
         entry, so the rotating history reads unambiguously (a life, not an event).
         Plain events carry no tag; the "On This Day" label already implies them. */
      .dly-fact .kind { font-family:var(--font-mono); font-size:12px; font-weight:700;
        letter-spacing:.1em; text-transform:uppercase; margin-right:8px; }
      .dly-fact .kind.born { color:var(--mint); }
      .dly-fact .kind.died { color:var(--ink-soft); }
      /* Almanac layout (2026-10-08): a live moment sets its date as a small
         stacked margin note — kind / year / how-long-ago — with the sentence in a
         hanging column beside it, so wrapped lines align under the text instead
         of sliding back beneath the year. Same 3-line footprint as before. */
      .dly-fact.has-meta { display:grid; grid-template-columns:auto minmax(0,1fr); column-gap:14px;
        align-items:start; max-height:none; -webkit-line-clamp:unset; }
      .dly-fact .meta { display:flex; flex-direction:column; align-items:flex-start; gap:4px;
        padding-top:2px; min-width:58px; }
      .dly-fact .meta > * { margin-right:0; line-height:1; }
      .dly-fact .meta .yr { font-size:22px; }
      .dly-fact .meta .ago { font-size:12px; }
      .dly-fact .txt { align-self:center; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical;
        overflow:hidden; max-height:calc(14px * 1.36 * 3); }
      /* rotation indicator — a hushed "moment N of M today" caption with a slim
         progress rail, revealing that On This Day quietly cycles through all of
         today's notable moments over the day (advances every half-hour). Bounded
         width + fixed tiny height (flex:none), so it never grows the region or
         clips; static, no animation. Hidden entirely in the offline fact fallback. */
      .dly-otd-nav { display:flex; align-items:center; gap:9px; margin-top:10px; flex:none; }
      .dly-otd-nav .rail { position:relative; flex:1 1 auto; height:2px; border-radius:2px;
        background:rgba(255,255,255,.08); overflow:hidden; }
      .dly-otd-nav .rail .fill { position:absolute; left:0; top:0; bottom:0; border-radius:2px;
        background:var(--mint); opacity:.75; }
      .dly-otd-nav .rail .fill.born { background:var(--mint); }
      .dly-otd-nav .rail .fill.died { background:var(--ink-soft); }
      .dly-otd-nav .lbl { flex:0 0 auto; font-family:var(--font-mono); font-size:12px;
        letter-spacing:.1em; color:var(--ink-faint); white-space:nowrap; }
      .dly-otd-nav .lbl b { color:var(--ink-soft); font-weight:600; }

      /* QUOTE — the quote clamps and the attribution is pinned as a fixed footer
         inside this region (margin-top:auto), so it can never overlap the block
         above nor slip past the card's bottom edge. A soft mint blockquote rule
         and mint-tinted quotation marks give the day's quote its own presence, so
         it reads distinctly from the word/fact sections above rather than as one
         more label-plus-text block. Purely decorative — static, adds no height. */
      .dly-quote { font-family:var(--font-display); font-style:normal; font-size:17px; line-height:1.32;
        color:var(--ink); min-height:0; text-wrap:balance; /* no lone last word */
        display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; padding-bottom:3px; }
      .dly-quote .qm { color:var(--mint); font-weight:600; font-style:normal; }
      .dly-auth { margin-top:8px; text-align:right; font-family:var(--font-mono); font-size:12.5px;
        color:var(--mint); letter-spacing:.02em; flex:none;
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      /* author's role/era — a hushed caption trailing the attribution ("· poet"),
         so the day's quote is placed by a voice, not just a name. Faint and
         un-tinted so it never competes with the mint author; on the SAME line,
         ellipsised, so it adds no height and can't clip. Hidden when unknown. */
      .dly-auth .role { color:var(--ink-faint); font-weight:400; letter-spacing:.01em; }
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
    // Hidden entirely (no height) when the word carries no example, as live
    // Datamuse words do — the definition then simply stands on its own.
    const applyExample = (n) => {
      exEl.title = n.ex || '';
      if (!n.ex) { exEl.style.display = 'none'; exEl.replaceChildren(); return; }
      exEl.style.display = '';
      const stem = n.word.slice(0, Math.max(4, n.word.length - 2));
      const re = new RegExp(`(${stem}[\\w’']*)`, 'i');
      const m = re.exec(n.ex);
      if (!m) { exEl.textContent = n.ex; return; }
      exEl.replaceChildren(
        n.ex.slice(0, m.index),
        h('b', {}, m[0]),
        n.ex.slice(m.index + m[0].length));
    };
    // renderWord takes a NORMALISED word object so it can present both an offline
    // curated word (rich: IPA, etymology, hand-written example, synonyms/antonyms)
    // and a live Datamuse word (definition + say-it-like + a "theme" caption). Any
    // field that is empty simply hides its line, so neither source leaves a gap.
    //   { word, ipa, say, pos, def, ex, originLabel, originText, syns, ants }
    const renderWord = (n) => {
      wordEl.textContent = n.word; wordEl.title = n.word;
      // Pronunciation: precise IPA (curated) and/or a plain-English "say-it-like"
      // respelling on the same line. Filter falsy so a missing part never prints
      // a stray "null"; the whole line hides when we have neither.
      const pronParts = [], pronTitle = [];
      if (n.ipa) { pronParts.push(n.ipa); pronTitle.push(n.ipa); }
      if (n.say) { pronParts.push(h('span', { class: 'say' }, n.ipa ? ` · ${n.say}` : n.say)); pronTitle.push(`say it: ${n.say}`); }
      if (pronParts.length) { pronEl.style.display = ''; pronEl.replaceChildren(...pronParts); pronEl.title = pronTitle.join(' · '); }
      else { pronEl.style.display = 'none'; pronEl.replaceChildren(); }
      posEl.textContent = n.pos || '';
      defEl.textContent = n.def || '';
      // Caption (optional): "origin · <etymology>" for a curated word, or
      // "theme · <seed>" for a live word placing it by the day's mood. Hidden when
      // absent, so no empty caption line is ever left behind.
      if (n.originText) {
        origEl.style.display = '';
        const lbl = n.originLabel || 'origin';
        origEl.title = `${lbl.charAt(0).toUpperCase() + lbl.slice(1)} — ${n.originText}`;
        origEl.replaceChildren(h('span', { class: 'rt' }, lbl), n.originText);
      } else {
        origEl.style.display = 'none';
        origEl.replaceChildren();
      }
      // Synonyms + antonyms (both optional) share ONE line: a mint "≈" then a few
      // kindred words, and a cool-blue "≠" then a few opposites. Either clause is
      // shown only when we have it; the whole line hides when we have neither, so
      // no empty line is ever left behind and no vertical height is added.
      const syns = n.syns, ants = n.ants;
      const hasSyn = syns && syns.length;
      const hasAnt = ants && ants.length;
      if (hasSyn || hasAnt) {
        synEl.style.display = '';
        const parts = [];
        const titleBits = [];
        if (hasSyn) {
          parts.push(h('span', { class: 'eq' }, '≈'),
            ...syns.map((s) => h('span', { class: 'sw' }, s)));
          titleBits.push(`Kindred — ${syns.join(', ')}`);
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
      applyExample(n);
    };
    // Offline curated word → normalised (rich: IPA, etymology, example, syn/ant).
    const curatedWord = (w) => ({
      word: w.word, ipa: w.pron || '', say: SAY[w.word] || '', pos: w.pos || '',
      def: w.def || '', ex: w.ex || '', originLabel: 'origin', originText: ORIGINS[w.word] || '',
      syns: SYNONYMS[w.word] || null, ants: ANTONYMS[w.word] || null,
    });
    // Live Datamuse word → normalised. No IPA/example/antonyms, but a say-it-like
    // respelling, a live definition, the day's theme as its caption, and a few
    // kindred words from the same theme pool as the "≈" line.
    const liveWord = (c, seed, related) => ({
      word: c.word, ipa: '', say: c.say || '', pos: c.pos || '', def: c.def || '', ex: '',
      originLabel: 'theme', originText: seed,
      syns: related && related.length ? related : null, ants: null,
    });
    // Instant offline render; the live word upgrades it once the network answers.
    renderWord(curatedWord(pickByDay(WORDS)));

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
    const applyQuoteObj = ({ q, a }) => {
      // Build the quote with mint-tinted opening/closing marks (a span each) rather
      // than a plain string, so the quotation reads as a quotation at a glance.
      quoteEl.replaceChildren(h('span', { class: 'qm' }, '“'), q, h('span', { class: 'qm' }, '”'));
      // Place the voice with a quiet role/era when we know it (offline map); an
      // unfamiliar author from the live feed simply shows the bare name.
      const role = AUTHORS[a];
      quoteEl.title = role ? `“${q}” — ${a} · ${role}` : `“${q}” — ${a}`;
      // Filter falsy: native replaceChildren would render a bare `null` text node
      // for the missing-role case (e.g. an unfamiliar author from the live feed),
      // printing "— Denis Waitleynull". ctx.h drops nulls; the raw call does not.
      authEl.replaceChildren(...[`— ${a}`,
        role ? h('span', { class: 'role' }, ` · ${role}`) : null].filter(Boolean));
      authEl.title = role ? `${a} · ${role}` : a;
    };
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
        .map((e) => ({ kind, year: e.year,
          // Wikipedia's "(pictured)" / "(pictured right)" caption cues point at a photo
          // the wall never shows — drop them so the line reads as plain prose.
          text: e.text.toString().replace(/\s*\((?:also\s+)?pictured(?:[^()]{0,24})?\)/gi, '').replace(/\s+([,.;])/g, '$1').trim() }))
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
    // Live word of the day (Datamuse). Picks the day's THEME seed, fetches words that
    // mean-like it (each carrying a definition, part of speech and pronunciation),
    // keeps only clean single-word candidates with a real definition in a pleasant
    // frequency band, then chooses one deterministically for the day (stable through
    // the day, rolls at midnight). Returns a normalised word object or throws — a
    // throw simply leaves the offline curated word in place, so the section never blanks.
    const fetchWordOfDay = async () => {
      // Reuse today's already-chosen word if we cached one — keeps the word stable
      // across the day's 30-min refreshes and page reloads (so it never flickers to
      // a different word), and means the recent-word memory advances only once a day.
      const cached = lsGet(LS_TODAY);
      if (cached && cached.d === todayKey() && cached.n && cached.n.word) return cached.n;

      const seed = SEEDS[dayOfYear() % SEEDS.length];
      const list = await ctx.fetchJSON(`https://api.datamuse.com/words?ml=${encodeURIComponent(seed)}&md=dpsrf&max=60`);
      if (!Array.isArray(list)) throw new Error('bad word list');
      // Keep only clean single-word TRUE synonyms (noun/adjective/verb) of the seed
      // that carry a real definition — this keeps the word lovely and legible rather
      // than obscure or tangential.
      const clean = list.map(parseDatamuse).filter(Boolean).filter((c) =>
        c.syn && /^[a-z]{4,15}$/.test(c.word) && c.def && c.pos && c.pos !== 'adverb' && c.word !== seed);
      // Prefer an evocative, mid-rare frequency band: this skips the dull, over-common
      // words ("quiet", "bright", "calm") that made the section feel repetitive, and
      // favours richer vocabulary. Relax the band only if it would leave too little.
      const inBand = (lo, hi) => clean.filter((c) => c.f == null || (c.f >= lo && c.f <= hi));
      let pool = inBand(0.05, 8);
      if (pool.length < 4) pool = inBand(0.02, 15);   // relax, but still skip the very-common words
      if (!pool.length) throw new Error('no candidates');
      // Take the most theme-relevant words (highest Datamuse score — usually the core
      // evocative synonyms).
      const top = pool.slice().sort((a, b) => b.score - a.score).slice(0, 18);
      // Skip words shown in the last ~45 days so the day's word is genuinely fresh,
      // then pick deterministically for the day. If the memory has swallowed this
      // whole (small) cloud, fall back to the LEAST-recently-shown word so even the
      // unavoidable repeat lands as far in the past as possible (never blanks).
      const order = recentWords();                    // oldest → newest
      const recent = new Set(order);
      const fresh = top.filter((c) => !recent.has(c.word));
      let chosen;
      if (fresh.length) chosen = fresh[dayOfYear() % fresh.length];
      else chosen = top.slice().sort((a, b) => order.indexOf(a.word) - order.indexOf(b.word))[0];
      // A few kindred words from the same top set for the "≈" line.
      const related = top.filter((c) => c.word !== chosen.word).slice(0, 3).map((c) => c.word);
      const n = liveWord(chosen, seed, related);
      rememberWord(chosen.word);
      lsSet(LS_TODAY, { d: todayKey(), n });
      return n;
    };

    // Embedded fallback fact (offline): plain text under the "Fact of the Day" label.
    const applyFact = (text) => { otdLbl.textContent = 'Fact of the Day'; factEl.classList.remove('has-meta'); factEl.textContent = text; otdNav.style.display = 'none'; };

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
      // Round anniversary (exactly a multiple of 25 years ago to the day): the
      // "how long ago" clause turns a warm gold with a ✦, so the almanac quietly
      // marks the occasion. Fires rarely; inline on the existing line, so it adds
      // no height and can't clip.
      const ms = milestoneOf(year);
      const meta = [];
      if (kind === 'born') meta.push(h('span', { class: 'kind born' }, 'born'));
      else if (kind === 'died') meta.push(h('span', { class: 'kind died' }, 'died'));
      meta.push(
        h('span', { class: 'yr' }, fmtYear(year)),
        h('span', {
          class: `ago${ms ? ' ms' : ''}`,
          title: ms ? `A round anniversary — ${ms.years} years ago to the day` : '',
        }, ms ? `✦ ${ago}` : ago));
      factEl.classList.add('has-meta');
      factEl.replaceChildren(h('div', { class: 'meta' }, ...meta), h('div', { class: 'txt' }, text));
      const lead = kind === 'born' ? 'Born ' : kind === 'died' ? 'Died ' : '';
      factEl.title = `${lead}${fmtYear(year)} (${ago}${ms ? ` · ${ms.years}th anniversary` : ''}) — ${text}`;
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
    // wordLive tracks whether we've upgraded to a live Datamuse word, so an offline
    // refresh keeps rolling the curated word instead of clobbering a good live one.
    let wordLive = false;
    tryLoad(fetchWordOfDay, (n) => { renderWord(n); wordLive = true; });
    tryLoad(fetchOnThisDay, loadOnThisDay);
    tryLoad(fetchQuote, applyQuote);

    // Periodic refresh (every 30 min, so content rolls over at midnight):
    //   - re-fetch the LIVE word (rolls to the new day's theme at midnight), keeping
    //     the offline curated word only if we have never had a live one;
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
      // Word: try the live word first; only fall back to rolling the curated word
      // when we have never had a live one (so a flaky refresh never downgrades it).
      fetchWordOfDay().then((n) => { renderWord(n); wordLive = true; })
        .catch(() => { if (!wordLive) renderWord(curatedWord(pickByDay(WORDS))); });
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
