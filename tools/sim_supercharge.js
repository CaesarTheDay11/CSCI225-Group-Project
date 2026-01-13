// Simulation of supercharged chance per rarity using current gear.generate logic
const SECONDARY_TYPES = ['lifesteal','regen','attack','defense','hp','speed','critChance','evasion','accuracy','pierce','maxHpPercent','critDamage','manaRegen','blockChance','reflectPercent','thorns','critResist','fireDamage','iceDamage','lightningDamage','windDamage','earthDamage','darkDamage','trueDamage','lowHpDamage','luck','executeDamage','stunResist','burnResist','poisonResist','mitigationPercent'];
const V = 3; // variants
const totalChoices = SECONDARY_TYPES.length * V;
const enchantPool = ['regen','lifesteal','critChance','critDamage','evasion','maxHpPercent','speed','pierce','manaRegen','thorns','critResist','fireDamage','iceDamage','lightningDamage','windDamage','earthDamage','darkDamage','trueDamage','lowHpDamage','luck','executeDamage','stunResist','burnResist','poisonResist','mitigationPercent'];
const DESIRED_SUPERCHARGE = { common: 0.01, uncommon: 0.03, rare: 0.06, epic: 0.12, legendary: 0.18 };
const P = enchantPool.length;
const RARITY_SECONDARY_COUNT = { common:2, uncommon:3, rare:4, epic:5, legendary:6 };
const rarityEnchantRange = { common: [0,0], uncommon: [0,1], rare: [1,2], epic: [1,3], legendary: [2,4] };
function randomBetween(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }
function chooseSecondaries(k){ // choose k unique indices from 0..totalChoices-1 using algorithm similar to code
  const available = Array.from({length: totalChoices}, (_,i)=>i);
  const chosen = [];
  for (let i=0;i<k;i++){
    if (available.length===0) break;
    // pick type uniformly then variant uniformly then try to remove index else pick any random
    const typeIdx = Math.floor(Math.random()*SECONDARY_TYPES.length);
    const variant = Math.floor(Math.random()*V);
    const pick = typeIdx * V + variant;
    const idx = available.indexOf(pick);
    if (idx !== -1){ available.splice(idx,1); chosen.push(pick); }
    else { const ridx = Math.floor(Math.random()*available.length); chosen.push(available.splice(ridx,1)[0]); }
  }
  return chosen;
}
function isSuperchargedForRarity(rarity){
  const k = RARITY_SECONDARY_COUNT[rarity] || 2;
  const secondaries = chooseSecondaries(k);
  // compute set of secondary types present intersect enchantPool
  const presentTypes = new Set();
  for (const idx of secondaries){ const type = SECONDARY_TYPES[Math.floor(idx / V)]; if (enchantPool.includes(type)) presentTypes.add(type); }
  const presentArray = Array.from(presentTypes);
  // enchant count
  const range = rarityEnchantRange[rarity] || [0,0];
  const ecount = randomBetween(range[0], range[1]);
  // Enchant sampling now respects the 'forceSuper' decision: with probability
  // DESIRED_SUPERCHARGE we force exactly one enchant to match a present secondary;
  // otherwise we sample enchants excluding present types so no match occurs.
  const desired = DESIRED_SUPERCHARGE[rarity] || 0;
  const forceSuper = (presentArray.length > 0) && (Math.random() < desired);
  if (forceSuper) return true; // allow forced super even when ecount == 0
  if (ecount <= 0) return false;
  if (forceSuper) return true;
  // not forcing super: sample enchants from pool excluding present types
  const pool = enchantPool.slice().filter(p => !presentTypes.has(p));
  for (let i=0;i<ecount && pool.length>0;i++){
    const idx = Math.floor(Math.random()*pool.length);
    pool.splice(idx,1);
  }
  // if no forced super and we successfully sampled without present types, then no supercharge
  return false;
}
async function run(n=200000){
  const rarities = ['common','uncommon','rare','epic','legendary'];
  const counts = {common:0,uncommon:0,rare:0,epic:0,legendary:0};
  const totals = {common:0,uncommon:0,rare:0,epic:0,legendary:0};
  for (const r of rarities){
    for (let i=0;i<n;i++){
      if (isSuperchargedForRarity(r)) counts[r]++;
      totals[r]++;
    }
  }
  for (const r of rarities){
    console.log(r + ': ' + counts[r] + '/' + totals[r] + ' = ' + (counts[r]/totals[r]*100).toFixed(3) + '%');
  }
}
run(200000).catch(console.error);
