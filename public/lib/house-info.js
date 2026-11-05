// Shared GardenOS household constants. Other features should import this roster.
export const HOUSE_RESIDENTS = Object.freeze([
  { id: 'gui', name: 'Gui' },
  { id: 'max', name: 'Max' },
  { id: 'razi', name: 'Razi' },
  { id: 'param', name: 'Param' },
  { id: 'herbie', name: 'Herbie' },
].map(person => Object.freeze(person)));

export const HOUSE = Object.freeze({ id: 'house', name: 'House', residents: HOUSE_RESIDENTS });
