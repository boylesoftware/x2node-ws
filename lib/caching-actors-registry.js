'use strict';

const common = require('x2node-common');


// the debug log
const log = common.getDebugLogger('X2_APP');

/**
 * Caching actors registry wrapper.
 *
 * @memberof module:x2node-ws
 * @implements module:x2node-ws.ActorsRegistry
 */
class CachingActorsRegistry {

	/**
	 * Create new caching registry.
	 *
	 * @param {module:x2node-ws.ActorsRegistry} registry The registry to wrap.
	 * @param {number} maxCached Maximum number of cached actors.
	 * @param {number} ttl Milliseconds after which a cached actor is expired.
	 */
	constructor(registry, maxCached, ttl) {

		this._registry = registry;
		if (maxCached <= 0)
			throw new common.X2UsageError(
				'Maximum cached actors must be a positive number.');
		this._maxCached = maxCached;
		if (ttl <= 0)
			throw new common.X2UsageError(
				'Cached actor TTL must be a positive number.');
		this._ttl = ttl;

		this._cache = new Array();
		this._cacheByHandle = new Map();
	}

	// actor lookup
	lookupActor(handle, creds) {

		const element = this._cacheByHandle.get(handle);

		if (!element)
			return this._loadActor(handle, creds);

		if (element.loading || (element.expireAt > Date.now()))
			return element.actor;

		return this._loadActor(handle, creds);
	}

	/**
	 * Load actor from the underlying registry and save it into the cache.
	 *
	 * @private
	 * @param {string} handle Actor handle.
	 * @param {string} [creds] Actor credentials, if any.
	 * @returns {Promise.<module:x2node-common.Actor>} Promise of the actor.
	 */
	_loadActor(handle, creds) {

		log(`(re)loading actor ${handle}`);

		const element = {
			handle: handle,
			loading: true,
			actor: Promise.resolve(this._registry.lookupActor(handle, creds))
		};

		this._cacheByHandle.set(handle, element);

		return element.actor.then(
			actor => {

				const now = Date.now();

				if (this._cache.length >= this._maxCached) {
					if (this._purgeExpiredActors(now) === 0) {
						common.error(
							'reached maximum cached actors, increasing cache' +
								' size is recommended');
						this._cacheByHandle.delete(handle);
						return actor;
					}
				}

				element.loading = false;
				element.expireAt = now + this._ttl;

				this._cache.push(element);

				return actor;
			},
			err => {

				this._cacheByHandle.delete(handle);

				return Promise.reject(err);
			}
		);
	}

	/**
	 * Remove expired actors from the cache.
	 *
	 * @private
	 * @param {number} now Current time.
	 * @returns {number} Number of purged actors.
	 */
	_purgeExpiredActors(now) {

		const numCached = this._cache.length;
		let numPurged = 0;
		while ((numPurged < numCached) && (
			this._cache[numPurged].expireAt <= now))
			numPurged++;

		for (let element of this._cache.splice(0, numPurged))
			this._cacheByHandle.delete(element.handle);

		log(`purged ${numPurged} expired actors from the cache`);

		return numPurged;
	}
}

// export the class
module.exports = CachingActorsRegistry;
