/**
 * A booking currently has one participant and one waiver relation.
 *
 * Charging for extra heads before every participant can be identified and
 * covered by the correct waiver would create a misleading legal record. Keep
 * the existing group-pricing/configuration code for the planned multi-person
 * flow, but refuse multi-person orders at every current booking boundary.
 */
export const MAX_SUPPORTED_HEADCOUNT = 1;
