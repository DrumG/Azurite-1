import { stat } from "fs";
import Loki from "lokijs";

import AllExtentsAsyncIterator from "./AllExtentsAsyncIterator";
import IExtentMetadata, { IExtentModel } from "./IExtentMetadata";

/**
 * This is a metadata source implementation for extent management based on loki DB.
 *
 * It contains following collection and documents:
 *
 * -- EXTENTS_COLLECTION     // Collections maintain extents information, including extentID, mapped local file path
 *                           // Unique document properties: id, path
 *
 * @export
 * @class LokiExtentMetadata
 * @implements {IExtentMetadata}
 */
export default class LokiExtentMetadata implements IExtentMetadata {
  private readonly db: Loki;

  private initialized: boolean = false;
  private closed: boolean = false;

  private readonly EXTENTS_COLLECTION = "$EXTENTS_COLLECTION$";

  public constructor(public readonly lokiDBPath: string) {
    this.db = new Loki(lokiDBPath, {
      autosave: true,
      autosaveInterval: 5000
    });
  }

  public isInitialized(): boolean {
    return this.initialized;
  }

  public isClosed(): boolean {
    return this.closed;
  }

  public async init(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      stat(this.lokiDBPath, (statError, stats) => {
        if (!statError) {
          this.db.loadDatabase({}, dbError => {
            if (dbError) {
              reject(dbError);
            } else {
              resolve();
            }
          });
        } else {
          // when DB file doesn't exist, ignore the error because following will re-create the file
          resolve();
        }
      });
    });

    // Create EXTENTS_COLLECTION if not exists
    if (this.db.getCollection(this.EXTENTS_COLLECTION) === null) {
      this.db.addCollection(this.EXTENTS_COLLECTION, {
        indices: ["id"]
      });
    }

    await new Promise((resolve, reject) => {
      this.db.saveDatabase(err => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

    this.initialized = true;
    this.closed = false;
  }

  /**
   * Close loki DB.
   *
   * @returns {Promise<void>}
   * @memberof LokiBlobDataStore
   */
  public async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.db.close(err => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

    this.closed = true;
  }

  /**
   * Update the extent status in DB. A new item will be created if the extent does not exists.
   *
   * @param {IExtentModel} extent
   * @returns {Promise<void>}
   * @memberof LokiExtentMetadata
   */
  public async updateExtent(extent: IExtentModel): Promise<void> {
    const coll = this.db.getCollection(this.EXTENTS_COLLECTION);
    const doc = coll.findOne({ id: extent.id });

    if (!doc) {
      coll.insert(extent);
      return;
    }

    doc.size = extent.size;
    doc.LastModifyInMS = extent.LastModifyInMS;
    coll.update(doc);
  }

  /**
   * List extents.
   *
   * @param {string} [id]
   * @param {number} [maxResults]
   * @param {number} [marker]
   * @param {Date} [queryTime]
   * @param {number} [UnmodifiedTime]
   * @returns {(Promise<[IExtentModel[], number | undefined]>)}
   * @memberof LokiExtentMetadata
   */
  public async listExtents(
    id?: string,
    maxResults?: number,
    marker?: number,
    queryTime?: Date,
    UnmodifiedTime?: number
  ): Promise<[IExtentModel[], number | undefined]> {
    const query: any = {};
    if (id !== undefined) {
      query.id = id;
    }
    if (maxResults === undefined) {
      maxResults = 5000;
    }

    if (UnmodifiedTime === undefined) {
      UnmodifiedTime = 0;
    }

    if (queryTime !== undefined) {
      query.LastModifyInMS = {
        $lt: queryTime.getTime() - UnmodifiedTime * 1000
      };
    }

    query.$loki = { $gt: marker };

    const coll = this.db.getCollection(this.EXTENTS_COLLECTION);
    const docs = coll
      .chain()
      .find(query)
      .limit(maxResults)
      .data();

    if (docs.length < maxResults) {
      return [docs, undefined];
    } else {
      const nextMarker = docs[docs.length - 1].$loki;
      return [docs, nextMarker];
    }
  }

  /**
   * Delete the extent metadata from DB with the extentId.
   *
   * @param {string} extentId
   * @returns {Promise<void>}
   * @memberof IExtentMetadata
   */
  public async deleteExtent(extentId: string): Promise<void> {
    const coll = this.db.getCollection(this.EXTENTS_COLLECTION);
    return coll.findAndRemove({ id: extentId });
  }

  /**
   * Create an async iterator to enumerate all extent IDs.
   *
   * @returns {AsyncIterator<string[]>}
   * @memberof IExtentMetadata
   */
  public getExtentIterator(): AsyncIterator<string[]> {
    return new AllExtentsAsyncIterator(this);
  }

  /**
   * Get the persistencyId for a given extentId.
   *
   * @param {string} extentId
   * @returns {Promise<string>}
   * @memberof IExtentMetadata
   */
  public async getExtentPersistencyId(extentId: string): Promise<string> {
    const coll = this.db.getCollection(this.EXTENTS_COLLECTION);
    const doc = coll.findOne({ id: extentId });
    return doc.persistencyId;
  }
}
