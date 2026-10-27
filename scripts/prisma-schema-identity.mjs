/** Prisma aligns columns when generating; spacing inside strings stays exact. */
export function normalizePrismaAlignment(schema) {
  return schema.replace(/\r\n/g, "\n").split("\n").map((line) =>
    line.replace(/("(?:\\.|[^"\\])*")|[\t ]+/g, (match, quoted) => quoted ?? " ").trim(),
  ).join("\n");
}
