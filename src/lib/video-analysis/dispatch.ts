export type AnalysisScope = "booking" | "account";
export type AnalysisClaim<T> = { job: T; scope: AnalysisScope; preferAccountNext: boolean } | null;

export function specifiedAnalysisScope(bookingExists: boolean, accountExists: boolean): AnalysisScope {
  if (bookingExists && accountExists) throw new Error("Ambiguous analysis job scope");
  return accountExists ? "account" : "booking";
}

/** Every successful claim gives the other scope priority on the next iteration. */
export async function claimNextAnalysisJob<T>(input: {
  preferAccount: boolean;
  jobId?: string;
  specifiedScope?: AnalysisScope | null;
  claimBooking: (id?: string) => Promise<T | null>;
  claimAccount: (id?: string) => Promise<T | null>;
}): Promise<AnalysisClaim<T>> {
  const scopes: AnalysisScope[] = input.specifiedScope ? [input.specifiedScope]
    : input.preferAccount ? ["account", "booking"] : ["booking", "account"];
  for (const scope of scopes) {
    const job = await (scope === "account" ? input.claimAccount(input.jobId) : input.claimBooking(input.jobId));
    if (job) return { job, scope, preferAccountNext: scope === "booking" };
  }
  return null;
}
