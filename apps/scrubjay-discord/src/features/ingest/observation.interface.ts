/**
 * A domain Observation: one species sighting on one eBird checklist,
 * deduped per species × checklist with media counts tallied (CONTEXT.md).
 * This is the transformer's output — everything downstream of the
 * transformer speaks these field names, not eBird's.
 */
export interface Observation {
  audioCount: number;
  comName: string;
  county: string;
  countyCode: string;
  hasComments: boolean;
  howMany: number;
  isPrivate: boolean;
  lat: number;
  lng: number;
  locId: string;
  locationName: string;
  obsDt: Date;
  obsReviewed: boolean;
  obsValid: boolean;
  photoCount: number;
  presenceNoted: boolean;
  sciName: string;
  speciesCode: string;
  state: string;
  stateCode: string;
  subId: string;
  videoCount: number;
}
