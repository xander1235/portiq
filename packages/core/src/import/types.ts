import type { Collection, Environment } from "../model";

/** The normalized result every importer produces — identical to the shape
 *  `store/portable.ts` `importPortable` returns, so it flows straight through
 *  `mergeIntoAppState` (merge-by-id) with no new merge logic. */
export interface ImportedLibrary {
  collections: Collection[];
  environments: Environment[];
}
