// Static game data: cargo, places, locomotives, perks.

export const CARGO = {
  pax:   { name: 'Passengers', icon: '👤', rate: 0.10, color: '#f2d46b' },
  grain: { name: 'Grain',      icon: '🌾', rate: 0.08, color: '#e3b04b' },
  food:  { name: 'Food',       icon: '🥫', rate: 0.12, color: '#d9734e' },
  logs:  { name: 'Logs',       icon: '🪵', rate: 0.07, color: '#9b6a3c' },
  goods: { name: 'Goods',      icon: '📦', rate: 0.14, color: '#8fb3d9' },
  coal:  { name: 'Coal',       icon: '🪨', rate: 0.08, color: '#3d3d3d' },
};

// converts: delivered input cargo -> produced output cargo (1:1)
export const NODE_TYPES = {
  town:      { name: 'Town',        icon: '🏘️', color: '#e9e2d0', produces: ['pax'],   accepts: ['pax', 'food', 'goods'] },
  farm:      { name: 'Farm',        icon: '🌾', color: '#c9a227', produces: ['grain'], accepts: [] },
  foodplant: { name: 'Food Plant',  icon: '🥫', color: '#d9734e', produces: [],        accepts: ['grain'], converts: { grain: 'food' } },
  forest:    { name: 'Forest',      icon: '🌲', color: '#2f7d4a', produces: ['logs'],  accepts: [] },
  sawmill:   { name: 'Sawmill',     icon: '🪚', color: '#8b5a2b', produces: [],        accepts: ['logs'], converts: { logs: 'goods' } },
  mine:      { name: 'Coal Mine',   icon: '⛏️', color: '#6b6b6b', produces: ['coal'],  accepts: [] },
  power:     { name: 'Power Plant', icon: '⚡', color: '#6c63ff', produces: [],        accepts: ['coal'] },
};

// What a node can hand to a train (processors output what they convert to).
export function outputsOf(type) {
  const t = NODE_TYPES[type];
  return t.converts ? [...new Set(Object.values(t.converts))] : t.produces;
}

export const MODELS = [
  { name: 'Puffing Billy 0-4-0',  year: 1850, speed: 12, cap: 30,  cost: 8000,   style: 'steam' },
  { name: 'Columbia 2-4-2',       year: 1864, speed: 16, cap: 45,  cost: 14000,  style: 'steam' },
  { name: 'Prairie 2-6-2',        year: 1880, speed: 21, cap: 60,  cost: 22000,  style: 'steam' },
  { name: 'Mikado 2-8-2',         year: 1900, speed: 27, cap: 80,  cost: 34000,  style: 'steam' },
  { name: 'Streamliner',          year: 1928, speed: 34, cap: 100, cost: 52000,  style: 'stream' },
  { name: 'Diesel Co-Co',         year: 1950, speed: 42, cap: 130, cost: 80000,  style: 'diesel' },
  { name: 'Electric Bo-Bo',       year: 1968, speed: 52, cap: 160, cost: 120000, style: 'electric' },
  { name: 'InterCity HS',         year: 1985, speed: 66, cap: 200, cost: 180000, style: 'hs' },
  { name: 'Maglev',               year: 2005, speed: 90, cap: 260, cost: 280000, style: 'maglev' },
];

export const PERKS = [
  { id: 'revenue', name: 'Steady Hands',      icon: '💰', desc: '+10% revenue per level' },
  { id: 'growth',  name: 'Boomtown',          icon: '🏙️', desc: '+20% town & industry growth per level' },
  { id: 'speed',   name: 'Express Timetable', icon: '⏱️', desc: '+6% train speed per level' },
  { id: 'offline', name: 'Night Shift',       icon: '🌙', desc: '+1h away-time cap and +10% away earnings per level' },
];
export const PERK_MAX = 10;
export const perkCost = (lvl) => lvl + 1;

export const TOWN_NAMES = [
  'Ashford', 'Brookvale', 'Cinderby', 'Dunmore', 'Elmsworth', 'Fairhaven', 'Glenrock',
  'Hollowmere', 'Ivybridge', 'Juniper Falls', 'Kingsreach', 'Larkspur', 'Millbrook',
  'Northcote', 'Oakhurst', 'Pinecrest', 'Queensbury', 'Ravensdale', 'Stonebridge',
  'Thornbury', 'Upton', 'Valewood', 'Westmarch', 'Yarrow', 'Zephyr Bay',
];

export const LINE_COLORS = [
  '#e4572e', '#29a3a3', '#f3a712', '#8e6bd9', '#4caf50',
  '#e85d9b', '#3f88c5', '#c0a062', '#ff7f50', '#6ab04c',
];

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const SECONDS_PER_MONTH = 60; // a season lasts about three minutes
export const FOCUS_TOKEN_SECONDS = 300;

// City size tiers by population.
export const TIERS = [
  { name: 'Village', min: 0 },
  { name: 'Town', min: 700 },
  { name: 'City', min: 1600 },
  { name: 'Metropolis', min: 3500 },
];
export const DISTRICT_NAMES = ['Central', 'Northside', 'Eastgate', 'Southfield', 'Westbrook', 'Riverside', 'Hilltop'];

// Local transit inside cities. cap: riders per minute per vehicle.
export const TRANSIT = {
  bus:   { name: 'Bus',         icon: '🚌', year: 1850, tier: 2, cap: 30,  fare: 3, cost: 5000,  veh: 2000,  color: '#f3a712' },
  tram:  { name: 'Light rail',  icon: '🚋', year: 1880, tier: 2, cap: 80,  fare: 4, cost: 18000, veh: 7000,  color: '#29a3a3' },
  metro: { name: 'Metro',       icon: '🚇', year: 1900, tier: 3, cap: 240, fare: 5, cost: 60000, veh: 20000, color: '#8e6bd9' },
};

