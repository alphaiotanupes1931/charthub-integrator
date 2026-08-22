import { can, resolveEntitlements } from "../../src/lib/entitlements";
const NOW=new Date("2026-08-22T18:00:00Z");
const p={
 legacyTrial: resolveEntitlements({flagEnabled:true,subscription:{status:"trialing",tier:null,trialEnd:"2026-08-30T00:00:00Z"},now:NOW}),
 admin: resolveEntitlements({flagEnabled:true,subscription:null,isAdmin:true,now:NOW}),
 flagOff: resolveEntitlements({flagEnabled:false,subscription:null,now:NOW}),
 pro: resolveEntitlements({flagEnabled:true,subscription:{status:"active",tier:"pro",trialEnd:null},now:NOW}),
};
const caps=["signal_engine","autopilot","analytics","unlimited_grades","academy_all","strategy_library"] as const;
for(const [k,e] of Object.entries(p)) console.log(k, caps.map(c=>`${c}=${can(e as never,c)}`).join(" "));
