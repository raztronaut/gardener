#!/usr/bin/env node
// Painting of the Day — curated list builder + verifier.
//
//   node tools/paintings.mjs            # verify every entry, write public/lib/paintings.js
//   node tools/paintings.mjs --dry      # verify + report only
//
// The Today card's "Painting of the Day" rotates through a HAND-CURATED list of
// public-domain artworks about gardens, gardening, flowers, plants, forests,
// jungles and rainforests, botanical studies and birds among plants. This is not
// a keyword search: every entry below was picked by a person (well, an agent) for
// its subject. This script only VERIFIES each pick against the museum's open API
// — the object exists, is flagged public domain, and has an image that actually
// loads — and pulls the canonical title / artist / date / medium / image from the
// API so the wall never shows hand-typed metadata. Entries that fail are dropped
// (and reported); nothing is written on --dry.
//
// Sources (both keyless, open access):
//   aic — Art Institute of Chicago, api.artic.edu (is_public_domain, IIIF image_id;
//         images at www.artic.edu/iiif/2/<image_id>/full/<w>,/0/default.jpg)
//   met — The Met Collection API, collectionapi.metmuseum.org (isPublicDomain,
//         primaryImageSmall). The Met's API rate-limits bursts (HTTP 403), so it is
//         queried one object at a time with a pause, and retried with backoff.
//
// Output: public/lib/paintings.js — an ES module whose default export is plain JSON
// ({ generated, count, paintings: [...] }). It is a .js module rather than a .json
// file so the read-only Roots "Wall" mirror (plant-server allows /lib/*.js) can load
// it too. Image sizes are chosen for the Jetson: the tile asks for 400 px wide
// (AIC) / the Met's ~600 px "web-large"; fullscreen asks for AIC's 843 px.
//
// Seed entry: [source, objectId, note, blurb, opts?]
//   note  — one line on why it belongs on a garden wall
//   blurb — a short plain-language description for the fullscreen view
//   opts  — { title?: display-title override, focus?: CSS object-position for the
//            tile's cover crop (default '50% 50%') }

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'lib', 'paintings.js');
const DRY = process.argv.includes('--dry');
// --only=aic|met verifies just one source (quick iteration; never use for the real build).
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
const UA = 'TheGardener/1.0 (home kiosk; painting-of-the-day curation)';

/* eslint-disable max-len */
const SEED = [
  // ---- Monet: the water garden and flower beds at Giverny --------------------
  ['aic', 16568, 'Monet painted his own lily pond at Giverny for nearly thirty years.', 'A close view of the water-lily pond Monet dug in his garden at Giverny: floating pads, pale blossoms and the reflected sky, with no horizon at all.'],
  ['aic', 87088, 'The Japanese footbridge over Monet\'s lily pond.', 'The arched footbridge over the lily pond at Giverny, buried in willows and reeds. Monet designed the garden himself and then spent decades painting it.'],
  ['aic', 97933, 'A late, almost abstract view of the Giverny water garden.', 'One of Monet\'s late pond paintings, made when his eyesight was failing: the garden dissolves into loose strokes of green, violet and gold.'],
  ['aic', 4887, 'Irises that Monet planted along the edge of his pond.', 'Monet planted irises in drifts along the banks of his water garden. Here they fill the canvas almost from edge to edge.'],
  ['aic', 4783, 'A field of poppies near Monet\'s home at Giverny.', 'Red poppies scattered through a summer field near Giverny, painted in quick, broken touches of colour.'],
  ['aic', 81537, 'Palms and pines in a lush Riviera garden.', 'Monet spent a winter at Bordighera on the Italian Riviera and was struck by its gardens of palms, pines and olives.'],
  ['aic', 16554, 'Monet\'s garden at Argenteuil, with big blue-and-white flowerpots.', 'The painter\'s rented house at Argenteuil, seen from its sunny garden, with flowers in big blue-and-white pots and his young son playing with a hoop.'],

  // ---- Van Gogh: gardens, orchards, irises, cypresses ------------------------
  ['aic', 14586, 'A public garden in Arles that Van Gogh loved to paint.', 'A sunlit corner of the public garden across from Van Gogh\'s Yellow House in Arles. He painted it to decorate Gauguin\'s room, imagining poets strolling there.'],
  ['met', 436528, 'Irises painted in the garden of the asylum at Saint-Rémy.', 'A bouquet of irises Van Gogh painted in his last weeks at Saint-Rémy. The pink background has faded to almost white over time.'],
  ['met', 436527, 'A fruit orchard in blossom in springtime Arles.', 'Van Gogh painted the orchards around Arles again and again in the spring of 1888, racing to catch the blossom before it fell.'],
  ['met', 436530, 'A vase of oleander, the flower of the Provençal summer.', 'Pink oleanders burst from a majolica jug on a table beside a book — the bright flowering shrub of a Provençal summer.'],
  ['met', 436534, 'Garden roses painted at Saint-Rémy.', 'A great armful of roses painted in May 1890. The pinks have faded over time, leaving the blossoms almost white.'],
  ['met', 436535, 'Cypresses and a wheat field under a swirling sky.', 'A summer wheat field near Saint-Rémy, with a dark cypress rising like a flame and clouds rolling overhead.'],
  ['met', 437980, 'Two cypress trees twisting up through the sky.', 'Van Gogh called the cypress as beautiful in line and proportion as an Egyptian obelisk. Here the trees seem to writhe with life.'],
  ['met', 437998, 'An olive grove near Saint-Rémy.', 'Gnarled olive trees on a sunny slope in Provence, painted with rhythmic, flowing brushstrokes.'],
  ['met', 436524, 'Cut sunflowers going to seed, painted in Paris.', 'Two sunflower heads lying on their backs, one showing its seeds, painted in Paris before Van Gogh moved south.'],
  ['met', 436525, 'A mixed summer bouquet from Van Gogh\'s last months.', 'A loose bouquet of field and garden flowers, from the last year of Van Gogh\'s life.'],
  ['met', 849054, 'A gardener tending an apple tree — Van Gogh\'s early print.', 'One of only a handful of prints Van Gogh made: a man working beside a young apple tree.'],

  // ---- Pissarro: kitchen gardens, orchards, country lanes --------------------
  ['met', 437301, 'Flower beds and strolling families in a town garden.', 'A public garden in Pontoise with bright flower beds, trees and families out walking in the sun.'],
  ['met', 437299, 'Hillside fields and cottages near Pontoise.', 'A green hillside above Pontoise, patterned with fields, gardens and farmhouses.'],
  ['aic', 55787, 'A woman working in a vegetable garden.', 'An etching of a woman bending among the rows of a kitchen garden, one of Pissarro\'s favourite rural subjects.'],
  ['met', 339649, 'Two women chatting in a garden.', 'A drawing of two women talking among the plants of a country garden.'],
  ['met', 358714, 'A field of cabbages near the village.', 'Rows of cabbages in a market-garden field, drawn with the etching needle.'],

  // ---- Heade: hummingbirds and flowers of the tropics -------------------------
  ['met', 11052, 'A hummingbird among passionflowers, from Heade\'s travels in South America.', 'Heade travelled to Brazil to paint hummingbirds in their rainforest home. Here one hovers near a twining passionflower vine.'],
  ['met', 11051, 'A hummingbird visiting apple blossom.', 'A tiny hummingbird perched beside branches of spring apple blossom, painted with a naturalist\'s precision.'],
  ['aic', 100829, 'Magnolia blossoms laid on blue velvet.', 'Creamy magnolia flowers and their glossy leaves resting on a blue velvet cloth — one of the flower pictures Heade painted after moving to Florida.'],
  ['met', 11053, 'Salt marsh meadows with haystacks.', 'The wide, flat marshes of Newburyport, Massachusetts, with haystacks drying in the summer light.'],

  // ---- Frans Post: 17th-century Brazil -----------------------------------------
  ['met', 437323, 'One of the first European paintings of the Brazilian landscape.', 'Frans Post travelled to Dutch Brazil in the 1630s and painted its tropical plants, sugar plantations and wide river plains.'],
  ['met', 371022, 'A tropical coast drawn by the first painter of Brazil.', 'A tropical coastline drawn by Frans Post, who spent seven years in northeastern Brazil.'],

  // ---- Church: the Andes and the tropics ---------------------------------------
  ['met', 10481, 'A whole rainforest world in one canvas, from Church\'s South American journeys.', 'Church built this panorama from sketches made in Ecuador and Colombia: a waterfall, a jungle of tropical trees, and snowy Andes beyond.'],
  ['aic', 76571, 'A volcano rising over tropical Ecuador.', 'Cotopaxi smokes over a green tropical valley, from Church\'s travels in the Andes of Ecuador.'],

  // ---- Henri Rousseau: the jungle -----------------------------------------------
  ['met', 438822, 'Rousseau\'s imaginary jungle — he never left France.', 'A lion seizes its prey in a dense, dreamlike jungle. Rousseau built his jungles from visits to the Paris botanical garden and its hothouses.'],
  ['met', 437512, 'Spring trees along the Bièvre river near Paris.', 'Slender trees just coming into leaf along a small river south of Paris, in Rousseau\'s calm, careful style.'],

  // ---- Botanical artists: Merian, Redouté, Temple of Flora ---------------------
  ['met', 399922, 'A botanical study by Merian, naturalist of the Surinam rainforest.', 'Maria Sibylla Merian studied plants and insects together. Here capers and gorse share the page with a beetle.'],
  ['met', 697703, 'A climbing lily painted by "the Raphael of flowers".', 'Redouté painted this flame-coloured climbing lily with the precision that made him the most famous botanical painter of his age.'],
  ['met', 697702, 'A South African heath, painted for a botanical record.', 'A spray of flowering heath (Erica), a plant family at home in South Africa\'s Cape, painted by Redouté.'],
  ['met', 762055, 'A rose from Redouté\'s celebrated book Les Roses.', 'A plate from Les Roses, Redouté\'s celebrated portrait gallery of roses.'],
  ['met', 762064, 'Crown imperial fritillary, from Les Liliacées.', 'A crown imperial — a tall spring bulb with a ring of hanging orange bells — from Redouté\'s book of lilies and their relatives.'],
  ['aic', 22459, 'A glory lily from The Temple of Flora, a famous botanical book.', 'The Temple of Flora set exotic plants in dramatic, theatrical landscapes. This is the climbing glory lily.'],
  ['aic', 22468, 'Auriculas, prized by Georgian gardeners.', 'A group of auricula primulas, flowers that 18th-century gardeners collected and showed off on special shelves.'],

  // ---- Flower still lifes -----------------------------------------------------
  ['aic', 64029, 'A Flemish bouquet of flowers that bloom in different seasons.', 'Jan Brueghel painted flowers from studies made across many months, so blooms of different seasons share one impossible bouquet.'],
  ['aic', 264716, 'A Dutch flower piece with insects and fruit.', 'Maria van Oosterwijck was one of the most admired flower painters of her day; here fruit shares the stage with the blossoms.'],
  ['met', 922227, 'An early Dutch bouquet by Ambrosius Bosschaert, a pioneer of flower painting.', 'Bosschaert was one of the first painters to make flowers the whole subject of a picture. Each bloom is painted with a botanist\'s care.'],
  ['aic', 66042, 'A painted garland of flowers behind a painted curtain.', 'A trick of the eye: a garland of flowers, half hidden by a blue curtain that is itself painted.'],
  ['aic', 111059, 'Flowers and fruit in a porcelain bowl.', 'A quiet Spanish still life of flowers and fruit in a porcelain bowl, glowing out of a dark background.'],
  ['aic', 149035, 'A great urn of flowers by van Huysum, master of Dutch flower painting.', 'Jan van Huysum was the most celebrated flower painter of 18th-century Holland. This drawing plans a tumbling bouquet in a carved urn.'],
  ['met', 11938, 'An American abundance of flowers and fruit.', 'Severin Roesen painted lavish still lifes for American homes, crowded with flowers, grapes and fruit.'],
  ['aic', 141413, 'Peonies from an 18th-century book of bouquets.', 'An engraved bouquet of peonies, from an 18th-century French collection of flower prints.'],
  ['aic', 141416, 'Tulips from an 18th-century book of bouquets.', 'An engraved bouquet of tulips, the flower that once set off a buying frenzy in Holland.'],
  ['met', 436634, 'A vase of flowers by Margareta Haverman, van Huysum\'s only pupil.', 'Margareta Haverman was the only pupil of the great Jan van Huysum, and was later elected to the French Royal Academy in Paris.'],
  ['met', 827660, 'A bouquet by Clara Peeters, a pioneer of still-life painting.', 'Clara Peeters was one of the earliest still-life painters in the Low Countries and one of very few women painters of her time.'],
  ['met', 437920, 'An early Dutch vase of flowers.', 'An early Dutch flower piece: each blossom is painted as a portrait, many of them prized garden flowers of the day.'],
  ['met', 435814, 'A basket brimming with flowers.', 'A basket overflowing with blossoms, by Jan Brueghel the Younger, son of the great flower painter.'],
  ['met', 816523, 'Fruit and flowers by an Italian nun-painter.', 'Orsola Maddalena Caccia was an Ursuline nun who painted flowers and fruit in her convent in Piedmont.'],
  ['met', 437864, 'A vase of flowers with a conch shell.', 'Anne Vallayer-Coster was one of the most admired still-life painters at the court of Marie Antoinette.'],
  ['met', 436026, 'Spring flowers by Courbet.', 'Courbet, the great realist of rocks and forests, also painted lush bouquets of flowers.'],
  ['met', 436175, 'A basket of flowers by Delacroix.', 'Delacroix, better known for drama and history, painted a series of flower pieces in the late 1840s.'],
  ['met', 436961, 'Peonies, by Manet.', 'Manet painted peonies, then newly fashionable in French gardens, several times in the mid-1860s.'],
  ['met', 406106, 'An American narcissus by Ehret, the great botanical artist.', 'Georg Dionysius Ehret was the leading botanical artist of 18th-century Europe. This is a spider lily from the Americas.'],
  ['aic', 72180, 'A summer bouquet by the great painter of flowers, Fantin-Latour.', 'Fantin-Latour made his name painting flowers, simply arranged and softly lit.'],
  ['aic', 20534, 'Garden roses heaped in a bowl.', 'Full-blown roses loosely arranged in a bowl, painted with Fantin-Latour\'s soft, velvety touch.'],
  ['aic', 110982, 'A dreamlike bouquet by Odilon Redon.', 'Late in life Redon painted flowers as glowing, almost floating shapes of colour.'],
  ['aic', 94240, 'Poppies and daisies, an early flower study by Redon.', 'A small, early study of red poppies and white daisies.'],
  ['aic', 76395, 'Flowers drifting like clouds.', 'Redon\'s pastel of flowers drifting like clouds — half garden, half dream.'],
  ['aic', 16617, 'A bowl of autumn chrysanthemums.', 'Renoir\'s chrysanthemums, painted in feathery strokes of pink, yellow and white.'],
  ['aic', 14561, 'Tulips in a vase, by Cézanne.', 'A vase of tulips on a table with fruit, built up in Cézanne\'s careful blocks of colour.'],

  // ---- Gardens and garden life ----------------------------------------------
  ['met', 436965, 'Monet with his watering can, tending his garden at Argenteuil.', 'Manet visited Monet at Argenteuil and painted his friend at work in the garden, watering can in hand, while Camille and their son Jean rest on the lawn.'],
  ['met', 436177, 'George Sand\'s country garden at Nohant.', 'Delacroix often stayed with the writer George Sand at Nohant, in central France, and painted a corner of her garden there.'],
  ['met', 437462, 'A sunlit garden in Spain.', 'A bright Spanish garden of clipped hedges, flowers and sunlight, by the Spanish painter Martín Rico.'],
  ['met', 436647, 'A Dutch palace and its formal garden.', 'The Huis ten Bosch palace at The Hague with its geometric parterres, painted by Jan van der Heyden, who loved crisp, exact detail.'],
  ['met', 437313, 'The Tuileries Garden in Paris on a spring morning.', 'Late in life Pissarro painted the Tuileries Garden again and again from an apartment window above the rue de Rivoli.'],
  ['met', 439065, 'A family among potted plants in a Berlin conservatory.', 'A 19th-century family gathered in their glass conservatory among potted palms and flowering plants.'],
  ['met', 441364, 'A study of palm trees from Egypt.', 'Gérôme painted this oil study of palms on his travels in Egypt.'],
  ['met', 671456, 'Caillebotte\'s own garden, where he grew prize chrysanthemums and orchids.', 'Caillebotte was a passionate gardener. Late in life he painted the chrysanthemum beds of his garden at Petit-Gennevilliers, close up and filling the whole canvas.'],
  ['aic', 153798, 'A woman sitting among flowers in a garden.', 'Berthe Morisot painted outdoors in gardens around Paris; here a woman sits amid sunlit flowers and greenery.'],
  ['aic', 111610, 'A Venetian palace garden, with pergolas and statues.', 'A formal garden behind a Venetian palace: trellised walks, statues and strolling visitors.'],
  ['aic', 22857, 'The Garden of Eden, from the workshop of Hieronymus Bosch.', 'Adam and Eve in a paradise garden full of strange plants and animals, painted in Bosch\'s workshop.'],
  ['aic', 105462, 'Appledore, the island of Celia Thaxter\'s famous garden.', 'Hassam spent many summers on Appledore Island, home of the poet Celia Thaxter and her celebrated cottage garden. Here, a small pond among the island\'s rocks and wild growth.'],
  ['aic', 133456, 'A sunny garden terrace in Tarragona, Spain.', 'Sargent\'s watercolour of a garden terrace in Catalonia, all dappled light and potted plants.'],
  ['aic', 144969, 'A 19th-century palm house — a rainforest under glass.', 'The interior of a royal palm house near Potsdam: tropical palms growing under a glass roof — a rainforest brought to Prussia.'],
  ['aic', 109926, 'Looking out of a window into the woods.', 'Vuillard\'s view from a country house window across a lawn into the trees.'],

  // ---- Sargent and Homer: trees, palms, gardens -------------------------------
  ['aic', 145807, 'A tangle of wild thistles.', 'Sargent painted these wild thistles as a pure study of light, colour and spiky leaves.'],
  ['aic', 234960, 'Cypress trees on the island of Corfu.', 'Tall cypresses on Corfu, in the dappled light of a Greek afternoon.'],
  ['aic', 14792, 'An olive grove on Corfu.', 'Twisting olive trunks and silvery leaves, painted quickly in watercolour.'],
  ['aic', 55494, 'Peach trees in spring blossom.', 'Homer\'s country scene of spring, with peach trees in full blossom.'],
  ['met', 11121, 'A flower garden in Bermuda.', 'A bright tropical garden and a bungalow, painted in watercolour during Homer\'s winter in Bermuda.'],
  ['met', 11131, 'A palm tree tossing in the Bahamas wind.', 'Homer\'s watercolour of a palm tree in Nassau, its fronds blown about by the trade winds.'],
  ['aic', 16785, 'Evening in the north woods.', 'The end of the day in the Adirondacks forest, painted in watercolour by Winslow Homer.'],

  // ---- Gauguin: Tahitian trees -----------------------------------------------
  ['aic', 8360, 'A Tahitian landscape with a flowering hibiscus tree.', 'Gauguin\'s Tahiti: a hibiscus tree and figures among lush tropical vegetation.'],
  ['aic', 111062, 'A great tree in Tahiti.', 'A huge spreading tree over a Tahitian homestead, painted during Gauguin\'s first stay on the island.'],

  // ---- Inness and the American woods -----------------------------------------
  ['aic', 64729, 'Pines in the Florida morning.', 'Tall pines in early morning light at Tarpon Springs, Florida, where Inness spent his winters.'],
  ['aic', 64736, 'Autumn woods glowing at dusk.', 'A soft, glowing autumn wood, painted late in Inness\'s life.'],
  ['aic', 64724, 'A heron in a misty marsh.', 'A heron stands in a hazy wetland at twilight — one of Inness\'s last paintings.'],

  // ---- Hudson River School: American forests ---------------------------------
  ['aic', 57163, 'A New England valley in summer.', 'An idealised New England landscape with woods, fields, a church and a river — Thomas Cole\'s portrait of American countryside.'],
  ['met', 10501, 'Early autumn on the Catskill Creek.', 'Cole\'s view of the Catskill Creek, with the first autumn colour in the trees and the mountains beyond.'],
  ['met', 10497, 'The Oxbow: wilderness meeting farmland.', 'A storm clears over a bend of the Connecticut River: wild forest on the left, cultivated fields on the right.'],
  ['met', 10786, 'A path through great beech trees.', 'Durand loved to paint trees from life; here tall beeches frame a view into a sunlit landscape.'],
  ['met', 10790, 'Inside a forest, like a cathedral of trees.', 'Durand\'s famous forest interior: tall trunks rise like columns in the green shade.'],
  ['aic', 71971, 'Mist rising at sunset in the Catskills.', 'A golden haze fills a mountain valley as the sun sets.'],
  ['met', 10946, 'A wooded gorge in the Catskills, glowing in autumn.', 'The Kauterskill Clove, a famous mountain ravine, filled with warm autumn light.'],
  ['aic', 129639, 'A storm-blasted tree.', 'A dramatic, twisted, storm-broken tree at the edge of a wild landscape.'],
  ['met', 10578, 'Autumn colour in the hills of New York.', 'Cropsey was famous for blazing American autumns; here maples flame red and gold beneath a mountain.'],
  ['met', 11318, 'An old pine on the Connecticut shore.', 'A single old pine tree on a rocky shore — one of Kensett\'s last paintings.'],
  ['met', 11322, 'A study of beech trees.', 'A quiet study of beech trunks in a wood, painted the year Kensett died.'],
  ['met', 16875, 'A forest brook in dappled light.', 'Whittredge\'s favourite subject: sunlight falling through the trees onto a woodland stream.'],
  ['met', 13313, 'Evening light in the woods.', 'Golden evening light falls between the trunks of a deep forest.'],
  ['aic', 146701, 'A mountain brook among mossy rocks and trees.', 'A rushing stream tumbles over rocks in a shady forest.'],
  ['met', 10150, 'Yosemite\'s Merced River in its valley.', 'The Merced River winding through Yosemite Valley beneath sheer granite cliffs.'],

  // ---- European forests and woods --------------------------------------------
  ['aic', 894, 'Springtime in the French countryside.', 'Théodore Rousseau, leader of the Barbizon painters, captures the fresh green of a spring day.'],
  ['aic', 16490, 'A forest brook in Courbet\'s home country.', 'A cool, shady stream in the Jura, near Courbet\'s home town of Ornans.'],
  ['aic', 29401, 'A deep green wood.', 'Courbet\'s dense, dark-green wooded landscape.'],
  ['aic', 95993, 'A pond deep in the woods.', 'A woodland pond in dappled light. Diaz painted the forest of Fontainebleau for decades.'],
  ['aic', 4770, 'A Dutch wooded landscape with a cottage.', 'Hobbema\'s 17th-century Dutch woodland: tall trees, a cottage and a passing rider.'],
  ['aic', 111623, 'A clump of trees in the French countryside.', 'A study of a stand of trees in summer by the animal and landscape painter Constant Troyon.'],
  ['aic', 109142, 'A forest full of wild animals, drawn in Bruegel\'s time.', 'A dense forest with wild animals, from the circle of Pieter Bruegel the Elder.'],
  ['aic', 53058, 'The forest of Compiègne.', 'Berthe Morisot\'s quick, airy view of the Compiègne forest.'],
  ['aic', 25838, 'A pistachio tree in a Provençal courtyard.', 'Cézanne\'s watercolour of a pistachio tree at the Château Noir, near Aix-en-Provence.'],
  ['aic', 124986, 'Gathering lily-of-the-valley in the woods.', 'People gathering lily-of-the-valley in a spring forest, a French May Day tradition.'],
  ['aic', 69533, 'A bird\'s nest hidden among ferns.', 'Fidelia Bridges painted small corners of nature up close: here a nest tucked into a bank of ferns.'],
  ['aic', 196261, 'A tropical scene with palms and lush plants.', 'A colour print of tropical scenery, with palms and exotic plants.'],

  // ---- Japanese flower-and-bird prints ----------------------------------------
  ['aic', 25110, 'Chrysanthemums with a horsefly, from Hokusai\'s Large Flowers.', 'Hokusai\'s series of large flowers shows each plant boldly, close up. Chrysanthemums are a symbol of autumn in Japan.'],
  ['aic', 25117, 'Hydrangea and a swallow.', 'A swallow swoops past a blue hydrangea in Hokusai\'s Large Flowers series.'],
  ['aic', 25129, 'Bellflowers and a dragonfly.', 'Purple bellflowers sway as a dragonfly hovers nearby.'],
  ['aic', 25102, 'Lilies, from Hokusai\'s Large Flowers.', 'Tall lilies bend and curl across the sheet.'],
  ['aic', 32276, 'Irises and a grasshopper.', 'Blue irises with a grasshopper, from Hokusai\'s series of large flowers.'],
  ['aic', 25099, 'Morning glories and a tree frog.', 'Morning glories climb as a tiny tree frog clings to a leaf.'],
  ['aic', 25093, 'A bullfinch beneath a weeping cherry.', 'A bullfinch hangs from a weeping cherry branch, with a poem written above it.', { title: 'Bullfinch and Weeping Cherry' }],
  ['aic', 25115, 'Orange orchids.', 'Bright orange orchids from Hokusai\'s small flower series.'],
  ['aic', 25108, 'Poppies in the wind.', 'Poppies bending in the wind, by Hokusai.'],
  ['aic', 25088, 'A paddy bird and magnolia blossoms.', 'A small bird perched among white magnolia flowers.', { title: 'Paddy Bird and Magnolia Flowers' }],
  ['aic', 81220, 'Dandelions and clover beneath a cherry tree.', 'A humble corner of spring: dandelions and clovers beneath a cherry tree.'],
  ['aic', 33406, 'A blooming plum tree.', 'A blossoming plum tree from Hokusai\'s picture book of realistic paintings.'],
  ['aic', 26577, 'The famous plum garden at Kameido.', 'A twisting old plum tree in full blossom fills the foreground — a print Van Gogh admired so much he copied it in oils.', { title: 'Plum Garden at Kameido' }],
  ['aic', 34100, 'The iris gardens at Horikiri in Edo.', 'Irises bloom in front of visitors to the Horikiri iris gardens, one of Edo\'s favourite flower-viewing spots.', { title: 'Irises at Horikiri' }],
  ['aic', 13919, 'Wisteria at the Kameido shrine.', 'Wisteria hangs over the arched bridges at the Kameido Tenjin shrine, a famous spring sight in Edo.', { title: 'Wisteria at Kameido' }],
  ['aic', 47686, 'A red plum branch against the summer moon.', 'A branch of red plum blossom silhouetted against a pale full moon.'],
  ['aic', 19018, 'A white-eye bird on a flowering branch.', 'A tiny Japanese white-eye perched on a branch of spring blossom.'],
  ['aic', 56236, 'Autumn flowers and a sparrow.', 'A sparrow among autumn wildflowers.'],
  ['aic', 88853, 'A great tit on a cherry blossom branch.', 'A great tit balances on a branch of cherry blossom.'],
  ['aic', 88536, 'A long-tailed bird among peach blossoms.', 'A long-tailed bird flies through peach blossom, a sign of spring.'],
  ['aic', 47670, 'A bunting and lilies.', 'A small bunting perched by tall summer lilies.'],
  ['aic', 56204, 'A parrot on a plum tree.', 'A brightly coloured parrot on a branch of plum blossom.'],
  ['aic', 34231, 'A plum orchard in bloom at Kamata.', 'Visitors stroll through a plum orchard in blossom at Kamata, near Edo.', { title: 'The Plum Orchard at Kamata' }],
  ['aic', 47675, 'Chrysanthemums in bloom.', 'A cluster of chrysanthemums, the flower of autumn and of the Japanese imperial family.'],
  ['aic', 88564, 'A bush warbler and camellias.', 'A bush warbler, the bird of early spring, among red camellia flowers.'],
  ['aic', 47530, 'A swallow and cherry blossom.', 'A swallow darts past a branch of cherry blossom.', { title: 'Cherry Branch and Swallow' }],
  ['aic', 88570, 'A macaw among bamboo.', 'A tropical macaw, a rare and exotic bird in Edo Japan, perched among bamboo.'],
  ['aic', 56198, 'A swallow and wisteria.', 'A swallow flies beneath hanging wisteria blossom.'],
  ['aic', 88531, 'A Java sparrow on a plum branch.', 'A Java sparrow perched on a branch of white plum blossom.'],
  ['aic', 56215, 'A small bird and ivy.', 'A small bird perched among autumn ivy leaves, by Hiroshige II.'],
  ['aic', 56217, 'A sparrow on a camellia branch.', 'A sparrow among camellia flowers, by Hiroshige II.'],
  ['aic', 21184, 'Two birds on a hibiscus tree.', 'Two birds perched in a flowering hibiscus, by Isoda Koryusai.'],
  ['aic', 21202, 'Cranes in an iris pond at sunrise.', 'Cranes stand in an iris-filled pond as the sun rises.'],
  ['aic', 21188, 'A parrot on a quince tree.', 'A parrot in a flowering quince tree.'],
  ['aic', 22021, 'An orchid and a bird.', 'A small bird beside a blooming orchid.'],
  ['aic', 14245, 'Three kinds of chrysanthemum.', 'Three varieties of chrysanthemum, the flower that Edo gardeners bred into hundreds of forms.'],
  ['aic', 81378, 'Spring flowers for a poetry circle.', 'A cluster of spring flowers, from a print series made for a group of poets.', { title: 'Various Spring Flowers' }],
  ['aic', 197424, 'A red parrot on a flowering branch, after Ito Jakuchu.', 'A woodblock print after Ito Jakuchu, the great 18th-century painter of birds and plants.'],
  ['aic', 23783, 'Irises and morning glories arranged in vases.', 'Flower arrangements of irises and morning glories, by Kitagawa Utamaro.'],
  ['aic', 127737, 'Hydrangeas, by Kamisaka Sekka.', 'A bold, modern design of blue hydrangeas from Sekka\'s celebrated print book Momoyogusa.', { title: 'Hydrangeas' }],
  ['aic', 57703, 'A pine tree and camellias.', 'A pine and red camellias, two evergreens of the Japanese garden.'],
  ['aic', 271417, 'The pine forest at Miho beneath Mount Fuji.', 'Mount Fuji rises over the famous pine groves of Miho, painted by the eccentric Soga Shohaku.'],
  ['aic', 127643, 'Flowering cherry and autumn maples.', 'Spring cherry blossom and autumn maple leaves with hanging poem slips, from a Japanese folding screen.'],
  ['aic', 49328, 'Mushrooms, painted by Shibata Zeshin.', 'A loose, lively painting of mushrooms by Shibata Zeshin.'],

  // ---- Chinese and Korean flower painting -----------------------------------
  ['aic', 80510, 'Birds, flowers and insects in the Chinese tradition.', 'Li Shan, one of the "Eight Eccentrics" of Yangzhou, painted birds, flowers and insects in a free, expressive style.'],
  ['aic', 187050, 'Orchids, a favourite subject of Korean scholar painters.', 'Orchids were a symbol of the cultivated, modest gentleman. Kim Eung-won was famous for painting them.'],
  ['aic', 46466, 'Birds on a red plum tree.', 'Birds gather on a blossoming red plum, painted by Ren Yi in Shanghai.', { title: 'Birds on Red Plum' }],

  // ---- Birds of America (Audubon, engraved by Havell) --------------------------
  ['aic', 18880, 'An indigo bunting among wild plants, from Audubon\'s Birds of America.', 'Audubon painted every American bird he could find, life-size and among the plants it lived with. Robert Havell engraved the plates.'],
  ['aic', 18878, 'Florida jays on a branch.', 'Florida scrub jays, from The Birds of America.'],
  ['aic', 18883, 'A bay-breasted warbler on a branch.', 'A small warbler among leaves, from The Birds of America.'],
  ['aic', 18876, 'A great American shrike among branches.', 'A shrike perched among leafy branches, from The Birds of America.'],
];
/* eslint-enable max-len */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJSON(url, { retries = 5, pause = 0 } = {}) {
  for (let i = 0; ; i++) {
    let r;
    try { r = await fetch(url, { headers: { 'user-agent': UA, 'AIC-User-Agent': UA } }); } catch (e) { r = { status: 0, e }; }
    if (r.status === 200) { if (pause) await sleep(pause); return r.json(); }
    if (r.status === 404) { if (pause) await sleep(pause); return null; }
    if (i >= retries) throw new Error(`HTTP ${r.status} for ${url}`);
    const wait = (r.status === 403 || r.status === 429) ? 20000 * (i + 1) : 2000 * (i + 1);
    console.error(`  … HTTP ${r.status}, retrying in ${wait / 1000}s`);
    await sleep(wait);
  }
}
async function imageOK(url) {
  try {
    let r = await fetch(url, { method: 'HEAD', headers: { 'user-agent': UA } });
    if (r.status === 405 || r.status === 403) r = await fetch(url, { headers: { 'user-agent': UA, range: 'bytes=0-1023' } });
    return r.ok && /image\//.test(r.headers.get('content-type') || '');
  } catch { return false; }
}

// Display title: the museum's title minus series/plate suffixes, which are long and
// already implied by the artist (e.g. ', from the series "One Hundred Famous Views of Edo"').
function cleanTitle(t) {
  return String(t || '').replace(/\s+/g, ' ')
    .replace(/,\s+(?:(?:plate|no\.?)\s*[\w\d]+\s+)?from\s+.*$/i, '')   // ", from the series …", ", plate one from …"
    .replace(/\s+from\s+"[^"]*"$/i, '')
    .trim();
}
const tidy = (s) => String(s || '').replace(/\s+/g, ' ').replace(/(\w)\(/g, '$1 (').trim();
const AIC_IMG = (id, w) => `https://www.artic.edu/iiif/2/${id}/full/${w},/0/default.jpg`;

async function verifyAic(ids) {
  const out = new Map();
  const fields = 'id,title,artist_title,date_display,image_id,is_public_domain,thumbnail,medium_display,artwork_type_title';
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const j = await getJSON(`https://api.artic.edu/api/v1/artworks?ids=${chunk.join(',')}&fields=${fields}&limit=50`);
    for (const a of (j && j.data) || []) out.set(a.id, a);
  }
  return out;
}

async function main() {
  const seen = new Set();
  for (const [src, id] of SEED) {
    const k = `${src}-${id}`;
    if (seen.has(k)) throw new Error(`duplicate seed entry ${k}`);
    seen.add(k);
  }
  const seed = ONLY ? SEED.filter((s) => s[0] === ONLY) : SEED;
  const aic = await verifyAic(seed.filter((s) => s[0] === 'aic').map((s) => s[1]));
  const ok = [], bad = [];
  for (const [src, id, note, blurb, opts = {}] of seed) {
    const key = `${src}-${id}`;
    let rec = null, why = '';
    if (src === 'aic') {
      const a = aic.get(id);
      if (!a) why = 'not found';
      else if (!a.is_public_domain) why = 'not public domain';
      else if (!a.image_id) why = 'no image';
      else {
        const t = a.thumbnail || {};
        rec = { id: key, source: 'aic', objectId: id, title: opts.title || cleanTitle(a.title),
          artist: a.artist_title || 'Unknown artist', date: tidy(a.date_display),
          medium: (a.medium_display || a.artwork_type_title || '').replace(/\s+/g, ' ').trim(),
          museum: 'Art Institute of Chicago', museumShort: 'Art Institute',
          url: `https://www.artic.edu/artworks/${id}`,
          img: AIC_IMG(a.image_id, 400), full: AIC_IMG(a.image_id, 843),
          w: t.width || null, h: t.height || null };
      }
    } else if (src === 'met') {
      const o = await getJSON(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`, { pause: 900 });
      if (!o || !o.objectID) why = 'not found';
      else if (!o.isPublicDomain) why = 'not public domain';
      else if (!o.primaryImageSmall) why = 'no image';
      else {
        rec = { id: key, source: 'met', objectId: id, title: opts.title || cleanTitle(o.title),
          artist: o.artistDisplayName || o.culture || 'Unknown artist', date: tidy(o.objectDate),
          medium: (o.medium || '').replace(/\s+/g, ' ').trim(),
          museum: 'The Metropolitan Museum of Art', museumShort: 'The Met',
          url: o.objectURL || `https://www.metmuseum.org/art/collection/search/${id}`,
          img: o.primaryImageSmall, full: o.primaryImageSmall, w: null, h: null };
      }
    } else why = `unknown source ${src}`;
    if (rec && !(await imageOK(rec.img))) { why = 'image did not load'; rec = null; }
    if (!rec) { bad.push(`${key}: ${why}`); console.log(`✗ ${key} — ${why}`); continue; }
    rec.note = note;
    if (blurb) rec.blurb = blurb;
    if (opts.focus) rec.focus = opts.focus;
    const ar = rec.w && rec.h ? rec.w / rec.h : null;
    console.log(`✓ ${key} — ${rec.title} · ${rec.artist} · ${rec.date}${ar && (ar < 0.5 || ar > 2.4) ? `  [aspect ${ar.toFixed(2)}]` : ''}`);
    ok.push(rec);
  }
  console.log(`\n${ok.length} verified, ${bad.length} dropped${bad.length ? `:\n  ${bad.join('\n  ')}` : ''}`);
  if (DRY) return;
  if (ONLY) console.warn('WARNING: --only build — the list is partial; re-run without --only before committing.');
  const body = { _comment: 'GENERATED by tools/paintings.mjs — edit the SEED list there and re-run; do not hand-edit. Public-domain artworks only, each verified against the museum API.', generated: new Date().toISOString().slice(0, 10), count: ok.length, paintings: ok };
  writeFileSync(OUT, `// Painting of the Day — curated list (see tools/paintings.mjs).\nexport default ${JSON.stringify(body, null, 1)};\n`);
  console.log(`wrote ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
