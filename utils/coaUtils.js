// utils/coaUtils.js
export function getAccountId(coaAccounts, name) {
  const acc = coaAccounts.find(a => a.name.toLowerCase() === name.toLowerCase());
  if (!acc) throw new Error(`COA account not found: ${name}`);
  return acc.id;
}
