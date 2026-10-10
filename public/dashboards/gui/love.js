// Gui Dávid's dashboard — all the words live here (in Portuguese). Edit freely: each
// widget picks a different entry per day (rotating by date), so nothing repeats day
// to day. On purpose there's no "te amo" anywhere — every line says it another way.
export const FROM = 'Gui Dávid';
export const TO = 'Louise';

// "Para Louise" — the day's line, big.
export const DECLARATIONS = [
  'Louise, você é o meu lugar favorito no mundo — e olha que eu moro em São Francisco.',
  'A neblina chega no Sunset todo fim de tarde. Você chegou uma vez e ficou. Prefiro você.',
  'Se cada dia fosse uma semente, os dias com você já seriam um jardim inteiro.',
  'Já vi a Golden Gate no pôr do sol. Continua perdendo para o seu sorriso.',
  'Você trouxe São Paulo na mala e, sem pedir licença, transformou esta casa num lar.',
  'Tem gente que procura o lugar certo a vida inteira. Eu achei: é do seu lado.',
  'De todas as rotas possíveis no mapa, a melhor foi a que trouxe você até aqui.',
  'Quando você ri, até o Karl — o nevoeiro — resolve ir embora mais cedo.',
  'Você é a garoa boa: chega de mansinho e deixa tudo mais verde.',
  'Eu escolheria você de novo, em qualquer cidade, em qualquer fuso, em qualquer vida.',
  'Hoje eu sou mais seu do que ontem — e menos do que amanhã.',
  'Obrigado por ter vindo de tão longe para ficar tão perto.',
  'O meu dia só começa de verdade quando você diz bom dia.',
  'Casa deixou de ser um lugar no dia em que eu te conheci.',
];

// "De São Paulo a São Francisco" — one haiku a day about her journey.
// 5-7-5 in Portuguese poetic syllables (counted to the last stressed syllable, with
// elision between vowels).
export const HAIKUS = [
  ['Garoa paulista', 'e fez-se neblina aqui', 'trazendo você.'],
  ['São dez mil quilômetros', 'de céu entre a tua casa', 'e a nossa janela.'],
  ['Duas malas só', 'e o mapa todo dobrado', 'no bolso do peito.'],
  ['Lá, São Paulo acorda;', 'aqui, teu sono é a ponte', 'entre os nossos fusos.'],
  ['Trouxe o sol do sul —', 'até a névoa do Sunset', 'abre pra você.'],
  ['Semente de longe,', 'plantada em outro hemisfério,', 'floresce ao contrário.'],
  ['Guarulhos, de noite,', 'e um voo cheio de sono', 'pousa em São Francisco.'],
];

// "Dicionário Louise" — the day's entry (and yesterday's, smaller).
// w: word · c: class · p: pronunciation (optional) · d: definition · v: see also (optional)
export const DICTIONARY = [
  { w: 'Louise', c: 's.f.', p: 'lu·ˈiz', d: 'Pessoa capaz de transformar uma terça-feira de neblina num dia bonito.', v: 'ver também: sorte' },
  { w: 'saudade', c: 's.f.', p: 'saw·ˈda·dʒi', d: 'O que este apartamento sente quando você sai, mesmo que seja só para comprar pão.' },
  { w: 'garoa', c: 's.f.', p: 'ga·ˈro·a', d: 'Chuva fina de São Paulo. Em São Francisco chamam de neblina e fingem que inventaram.' },
  { w: 'lar', c: 's.m.', d: 'Qualquer lugar onde tenha você, uma planta crescendo e um café passado.' },
  { w: 'cafuné', c: 's.m.', p: 'ka·fu·ˈnɛ', d: 'Palavra sem tradução para o inglês. A Louise explica melhor sem palavras.' },
  { w: 'fuso horário', c: 'loc. subst.', d: 'As horas entre São Paulo e aqui. Mudam com o inverno; o que eu sinto, não.' },
  { w: 'Karl', c: 's.m.', d: 'O nevoeiro de São Francisco. Tem nome, tem fã-clube e mesmo assim perde para o sorriso dela.' },
  { w: 'aventura', c: 's.f.', d: 'Atravessar um continente com duas malas e coragem de sobra.', v: 'ver: Louise' },
  { w: 'sorte', c: 's.f.', d: 'O que eu tive no dia em que você decidiu vir.' },
  { w: 'Quintara', c: 's.f.', d: 'Rua do Sunset onde, por pura coincidência, mora a melhor pessoa do mundo.' },
  { w: 'brigadeiro', c: 's.m.', d: 'Prova de que o Brasil sabe ser doce. A outra prova é você.' },
  { w: 'paciência', c: 's.f.', d: 'O que você tem comigo de manhã, antes do café. Um milagre documentado.' },
  { w: 'semente', c: 's.f.', d: 'Coisa pequena que vira coisa enorme.', v: 'exemplo: o nosso primeiro oi' },
];

// "Vales para Louise" — vouchers, three a day. i: icon (see widgets/vouchers.js)
export const VOUCHERS = [
  { i: 'cup', t: 'Café da manhã na cama, sem motivo nenhum.' },
  { i: 'wave', t: 'Um fim de tarde em Ocean Beach, só nós dois.' },
  { i: 'oven', t: 'Pão de queijo feito em casa, saindo do forno.' },
  { i: 'cake', t: 'A última mordida da sobremesa. Para sempre.' },
  { i: 'star', t: 'Um encontro surpresa — é só dizer sim.' },
  { i: 'music', t: 'Uma noite de música brasileira, dançando na cozinha.' },
  { i: 'moon', t: 'Um domingo inteiro sem celular.' },
  { i: 'flower', t: 'Flores do Gardyn, colhidas só para você.' },
  { i: 'film', t: 'Você escolhe o filme. Sem discussão.' },
  { i: 'plane', t: 'Planejar juntos a próxima viagem para São Paulo.' },
  { i: 'phone', t: 'Um café por vídeo com a sua família, no horário de lá.' },
  { i: 'hand', t: 'Uma massagem nos pés depois de um dia longo.' },
];

// Stable daily index (same pick all day, changes at midnight).
export function daily(list, salt = 0) {
  const d = new Date();
  const n = Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5) + salt * 7);
  return list[((n % list.length) + list.length) % list.length];
}
export function dailyN(list, k, salt = 0) {
  const out = [];
  for (let i = 0; i < Math.min(k, list.length); i++) out.push(daily(list, salt + i * 3));
  return [...new Set(out)];
}
