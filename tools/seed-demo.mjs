// Fills the house with a spread of made-up jobs, costs, people and notes, for trying
// the app or checking the layout: node tools/seed-demo.mjs <url> <user> <password>
// For a scratch copy only: it adds to whatever is there.
const [url, username, password] = process.argv.slice(2);
const H = { 'content-type': 'application/json', 'x-nest': '1' };
let cookie = '';
async function call(method, path, body) {
  const r = await fetch(url + path, { method, headers: { ...H, cookie }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const j = await r.json();
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(j)}`);
  return j;
}
await call('POST', '/api/login', { username, password });
const { house } = await call('GET', '/api/house');
const room = (name) => house.rooms.find((r) => r.name === name).id;
const [me, other] = house.people;
const day = 86_400_000;
const iso = (n) => new Date(Date.now() + n * day).toISOString().slice(0, 10);

const plumber = (await call('POST', '/api/trades', { name: 'Dai Plumbing & Heating', trade: 'Plumber', phone: '07700 900123', email: 'dai@example.com', notes: 'Recommended by next door. Prefers a text.' })).trade;
const sparky = (await call('POST', '/api/trades', { name: 'Bright Sparks', trade: 'Electrician', phone: '029 2018 0456' })).trade;

const jobs = [
  { title: 'Fix the dripping tap', room: 'Kitchen', size: 'evening', dueDate: iso(-2), assigneeId: me.id, simpleCost: 650 },
  { title: 'Hang the big mirror', room: 'Hallway and Landing', size: 'evening', dueDate: iso(0), notes: 'Needs the heavy-duty plasterboard fixings.' },
  { title: 'Bleed the radiators', room: 'Hallway and Landing', size: 'evening', repeatEvery: 1, repeatUnit: 'year', dueDate: iso(5) },
  { title: 'Put up shelves in the Cwtch', room: 'Cwtch', size: 'weekend', dueDate: iso(3), assigneeId: other?.id, costs: [
    { label: 'Oak shelf boards x3', amount: 5400, shop: 'B&Q' },
    { label: 'Brackets', amount: 1800, shop: 'B&Q', bought: true },
    { label: 'Wall plugs and screws', amount: 450, shop: 'Screwfix' },
  ] },
  { title: 'Paint Olly’s room', room: "Olly's Room", size: 'weekend', dueDate: iso(10), steps: ['Fill the holes', 'Sand and wipe down', 'Mask the skirting', 'Two coats on the walls', 'Gloss the woodwork'], stepsDone: 2, costs: [
    { label: 'Paint, 5 litres', amount: 4200, shop: 'Dulux Decorator Centre' },
    { label: 'Rollers and tray', amount: 1250, shop: 'Screwfix', bought: true },
  ] },
  { title: 'New bathroom', room: 'Upstairs Bathroom', size: 'bigger', dueDate: iso(40), notes: 'Walk-in shower where the bath is. Keep the window.', steps: ['Choose tiles', 'Get three quotes', 'Order the suite', 'Rip out the old one', 'First fix plumbing', 'Tiling', 'Second fix', 'Decorate'], stepsDone: 3, stepDue: [null, null, iso(1)], costs: [
    { label: 'Fitting and plumbing', amount: 320000, kind: 'trade', tradeId: plumber.id, pay: [100000, 60000] },
    { label: 'Electrics and extractor', amount: 42000, kind: 'trade', tradeId: sparky.id },
    { label: 'Suite', amount: 118000, shop: 'Victorian Plumbing', bought: true },
    { label: 'Tiles, 22 sq m', amount: 64000, shop: 'Topps Tiles' },
    { label: 'Grout and adhesive', amount: 5600, shop: 'Topps Tiles' },
  ] },
  { title: 'Lay the new floor', room: 'Office', size: 'bigger', steps: ['Lift the carpet', 'Level the boards', 'Underlay', 'Lay the planks', 'Refit skirting'], simpleCost: 60000 },
  { title: 'Draught-proof the back door', room: 'Utility Room', size: 'evening' },
  { title: 'Sort the wardrobe doors', room: 'Our bedroom', size: 'evening', assigneeId: me.id },
  { title: 'Put up Carys’s fairy lights', room: "Carys's Room", size: 'evening', done: true },
  { title: 'Regrout the shower', room: 'Downstairs bathroom', size: 'weekend', done: true, simpleCost: 1800 },
  { title: 'Paint the Den', room: 'The Den', size: 'weekend', done: true, costs: [{ label: 'Paint', amount: 5600, shop: 'B&Q', bought: true }] },
  { title: 'Clear out the box room', room: 'Box Room', size: 'weekend', done: true },
  { title: 'Change the smoke alarm batteries', room: 'Hallway and Landing', size: 'evening', repeatEvery: 6, repeatUnit: 'month', done: true },
];
for (const j of jobs) {
  const { job } = await call('POST', '/api/jobs', { title: j.title, status: 'todo', roomId: room(j.room), size: j.size, dueDate: j.dueDate, assigneeId: j.assigneeId, notes: j.notes, simpleCost: j.simpleCost, repeatEvery: j.repeatEvery, repeatUnit: j.repeatUnit });
  for (const [i, title] of (j.steps ?? []).entries()) {
    const { step } = await call('POST', `/api/jobs/${job.id}/steps`, { title, dueDate: j.stepDue?.[i] ?? undefined });
    if (i < (j.stepsDone ?? 0)) await call('PUT', `/api/steps/${step.id}`, { done: true });
  }
  for (const { pay, ...c } of j.costs ?? []) {
    const { cost } = await call('POST', `/api/jobs/${job.id}/costs`, c);
    for (const [i, amount] of (pay ?? []).entries()) await call('POST', `/api/costs/${cost.id}/payments`, { amount, paidOn: iso(-20 + i * 9), note: i ? 'Bank transfer' : 'Deposit' });
  }
  if (j.done) await call('POST', `/api/jobs/${job.id}/done`, { done: true });
}
for (const [title, r] of [['Window seat with storage', 'Cwtch'], ['Log burner', 'The Den'], ['Knock through to the utility?', 'Kitchen'], ['Outside tap', null]]) {
  await call('POST', '/api/jobs', { title, status: 'idea', roomId: r ? room(r) : undefined });
}
await call('POST', `/api/rooms/${room('Kitchen')}/facts`, { label: 'Wall paint', value: 'Dulux Timeless, matt\nTin is in the garage' });
await call('POST', `/api/rooms/${room('Kitchen')}/facts`, { label: 'Bulbs', value: 'GU10 warm white, 5W' });
await call('PUT', `/api/rooms/${room('Kitchen')}`, { notes: 'Worktop is 3.2 m along the window wall.' });
const { id } = await call('POST', '/api/notes', { body: 'Stopcock: under the kitchen sink, left-hand side.\nBoiler: Worcester Bosch, serviced every October.' });
await call('PUT', `/api/notes/${id}`, { pinned: true });
await call('POST', '/api/notes', { body: 'Bins: recycling on Tuesdays, general every other Tuesday.' });
console.log(`Seeded ${jobs.length} jobs for ${username}`);
