"use strict";


/**
 * URI mapper.
 *
 * @protected
 * @memberof module:x2node-ws
 * @inner
 */
class URIMapper {

	/**
	 * Single mapping descriptor fed to the URI mapper constructor.
	 *
	 * @typedef {Object} module:x2node-ws~URIMapper~MappingDesc
	 * @property {string} uriPattern URI regular expression pattern used to match
	 * the whole URI (so no starting <code>^</code> nor ending <code>$</code> are
	 * necessary).
	 * @property {Object} handler Corresponding handler passed to the lookup
	 * callback if matched.
	 */

	/**
	 * Create new mapper.
	 *
	 * @param {Array.<module:x2node-ws~URIMapper~MappingDesc>} mappings Mapping
	 * descriptors.
	 */
	constructor(mappings) {

		this._mappingsIndex = new Array();

		this._mappings = mappings.map(mapping => {
			const uriPatternRE = new RegExp(`^(?:${mapping.uriPattern})?$`);
			return {
				uriPattern: mapping.uriPattern,
				uriPatternRE: uriPatternRE,
				numUriParams: uriPatternRE.exec('').length - 1,
				handler: mapping.handler
			};
		});

		this._mappingsReverse = this._mappings.concat().reverse();

		let pattern = '^(?:', patternIndex = 0;
		for (let mapping of this._mappings) {
			if (patternIndex > 0)
				pattern += '|';
			pattern += '(' + mapping.uriPattern + ')';
			this._mappingsIndex[patternIndex] = mapping;
			patternIndex += mapping.numUriParams + 1;
		}
		pattern += ')$';

		this._masterUriRE = new RegExp(pattern);
	}

	/**
	 * Handler lookup callback.
	 *
	 * @callback module:x2node-ws~URIMapper~lookupCallback
	 * @param {Object} handler Matched handler.
	 * @param {Array.<string>} uriParams Extracted URI parameters.
	 */

	/**
	 * Lookup handler matching the URL of the specified call. Only a single
	 * handler is matched.
	 *
	 * @param {module:x2node-ws~ServiceCall} call The call.
	 * @param {module:x2node-ws~URIMapper~lookupCallback} cb Lookup success
	 * callback.
	 * @returns {boolean} <code>true</code> if lookup was successful.
	 */
	lookup(call, cb) {

		// match the URI
		const match = this._masterUriRE.exec(call.requestUrl.pathname);
		if (!match)
			return false;

		// find matched handler in the index
		const matchInd = this._mappingsIndex.findIndex(
			(_, i) => match[i + 1]);
		const mapping = this._mappingsIndex[matchInd];
		const uriParams = match.slice(
			matchInd + 2, matchInd + 2 + mapping.numUriParams);

		// call the callback
		cb(mapping.handler, uriParams);

		// report success
		return true;
	}

	/**
	 * Lookup multiple handlers matching the URL of the specified call. For each
	 * matched handler, the provided callback is invoked. The mappings are tested
	 * in reverse order.
	 *
	 * @param {module:x2node-ws~ServiceCall} call The call.
	 * @param {module:x2node-ws~URIMapper~lookupCallback} cb Lookup callback.
	 */
	lookupMultiReverse(call, cb) {

		// try mappings one by one on the call URI
		const uri = call.requestUrl.pathname;
		for (let mapping of this._mappingsReverse) {
			const match = mapping.uriPatternRE.exec(uri);
			if (match)
				cb(mapping.handler, match.slice(1));
		}
	}
}

// export the class
module.exports = URIMapper;
