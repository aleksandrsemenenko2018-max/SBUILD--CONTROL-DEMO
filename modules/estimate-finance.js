function number(value) {
 if(value===null || value===undefined || value==="") throw new Error("Missing numeric value");
 const n=Number(value); if(!Number.isFinite(n)||n<0) throw new Error("Invalid numeric value"); return n;
}
const money=n=>Math.round((n+Number.EPSILON)*100)/100;
export function estimateLine(row){
 const quantity=number(row.quantity), workerRate=number(row.worker_rate), clientRate=number(row.client_rate);
 const laborCost=money(quantity*workerRate), revenue=money(quantity*clientRate);
 return {...row,quantity,laborCost,revenue,margin:money(revenue-laborCost)};
}
export function materialLine(row){
 const quantity=number(row.quantity),cost=money(quantity*number(row.purchase_price)),revenue=money(quantity*number(row.customer_price));
 return {cost,revenue,margin:money(revenue-cost)};
}
export function planFact(planned,actual){
 const plan=number(planned),fact=number(actual);
 return {plan,fact,remaining:Math.max(0,plan-fact),overrun:Math.max(0,fact-plan),percent:plan?fact/plan*100:null};
}
export function summarizeApproved(rows,approvedStatuses){
 if(!Array.isArray(approvedStatuses)||!approvedStatuses.length) throw new Error("Explicit approved statuses required");
 const totals=rows.filter(r=>approvedStatuses.includes(r.status)).map(estimateLine).reduce((a,r)=>({laborCost:a.laborCost+r.laborCost,revenue:a.revenue+r.revenue}),{laborCost:0,revenue:0});
 return {laborCost:money(totals.laborCost),revenue:money(totals.revenue),laborMargin:money(totals.revenue-totals.laborCost)};
}
export function plasterConsumption(area,thicknessMm,kgPerMmM2,bagKg,wastePercent=0){
 const bag=number(bagKg); if(!bag)throw new Error("Bag weight must be positive");
 const kg=number(area)*number(thicknessMm)*number(kgPerMmM2)*(1+number(wastePercent)/100);
 return {kg,bags:Math.ceil(kg/bag)};
}

export function summarizeProjectFinance(approvedWork, expenseTotal, payoutRecords) {
 const safeMoney=value=>Number.isFinite(value)?money(value):null;
 const approved=approvedWork?.filter(row=>row.status==="owner_approved");
 function totalRate(rateKey) {
  if(!approved)return null;
  try {
   return safeMoney(approved.reduce((total,row)=>total+money(number(row.quantity)*number(row[rateKey])),0));
  } catch {
   return null;
  }
 }
 function payoutTotal(status) {
  if(!payoutRecords)return null;
  try {
   return safeMoney(payoutRecords.filter(row=>row.status===status).reduce((total,row)=>total+number(row.amount),0));
  } catch {
   return null;
  }
 }
 const revenue=totalRate("client_rate"),laborCost=totalRate("worker_rate");
 let expenseCost=null;
 try { expenseCost=safeMoney(number(expenseTotal)); } catch {}
 const margin=[revenue,laborCost,expenseCost].some(value=>value===null)?null:safeMoney(revenue-laborCost-expenseCost);
 return {revenue,laborCost,expenseCost,margin,paid:payoutTotal("paid"),planned:payoutTotal("planned")};
}
