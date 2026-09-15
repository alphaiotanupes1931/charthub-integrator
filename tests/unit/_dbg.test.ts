import { it } from "vitest";
import { readProtectedStructure } from "@/lib/protectedStructure";
const c=(time:number,low:number,high:number,open:number,close:number)=>({time,low,high,open,close});
const s=[c(1,100,104,101,103),c(2,98,102,102,99),c(3,100,106,100,105),c(4,103,110,105,109),c(5,102,108,108,104),c(6,96,103,103,98),c(7,99,107,98,106),c(8,104,112,106,111),c(9,108,114,111,113),c(10,110,116,113,115),c(11,112,118,115,117)];
it("dbg",()=>{ console.log(JSON.stringify(readProtectedStructure(s,{wing:1}),null,1)); });
