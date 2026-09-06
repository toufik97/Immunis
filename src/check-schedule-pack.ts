import { loadSchedulePack } from "./load-schedule-pack";

const pack = loadSchedulePack("MA");

console.log("Morocco schedule pack validated successfully");
console.log("---------------------------------------------");

console.log("Country:", pack.catalog.meta.country);
console.log("Pack ID:", pack.catalog.meta.pack_id);
console.log("Pack version:", pack.catalog.meta.version);
console.log("Status:", pack.catalog.meta.status);
console.log();

console.log("Catalog antigens:", pack.catalog.antigens.length);
console.log("Catalog product groups:", pack.catalog.product_groups.length);
console.log("Counters:", pack.counters.counters.length);
console.log();

console.log("DTP program ID:", pack.programs.dtp.program.id);
console.log("DTP program label:", pack.programs.dtp.program.label_fr);
console.log("DTP counter:", pack.programs.dtp.program.counter);
console.log("DTP booster policy:", pack.programs.dtp.program.booster_policy);
console.log();

console.log("DTP booster policies:", pack.programs.dtp.booster_policies.length);
console.log("DTP protocols:", pack.programs.dtp.protocols.length);
console.log("DTP catch-up rules:", pack.programs.dtp.catchup_rules.length);
console.log("DTP review flags:", pack.programs.dtp.review_flags?.length ?? 0);