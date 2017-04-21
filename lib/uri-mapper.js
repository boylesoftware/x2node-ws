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
	 * Create new mapper.
	 *
	 * @param {Array.<Object>} mappings Mapping descriptors.
	 */
	constructor(mappings) {

		this._mappingsIndex = new Array();

		let pattern = '^(?:', patternIndex = 0;
		for (let mapping of mappings) {
			mapping.numUriParams =
				(new RegExp(`^(?:${mapping.uriPattern})?$`)).exec('').length - 1;
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
	 * Lookup handler matching the specified request URL.
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
}

// export the class
module.exports = URIMapper;
