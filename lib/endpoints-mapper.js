"use strict";


/**
 * Endpoints mapper.
 *
 * @protected
 * @memberof module:x2node-webservices
 * @inner
 */
class EndpointsMapper {

	/**
	 * Create new mapper.
	 *
	 * @param {Map.<string,Object>} endpoints Endpoint descrpitors
	 * (<code>handler</code> and <code>numUriParams</code>) by URI patterns.
	 */
	constructor(endpoints) {

		this._endpointsIndex = new Array();

		let pattern = '^(?:', patternIndex = 0;
		endpoints.forEach((endpoint, uriPattern) => {
			if (patternIndex > 0)
				pattern += '|';
			pattern += '(' + uriPattern + ')';
			this._endpointsIndex[patternIndex] = endpoint;
			patternIndex += endpoint.numUriParams + 1;
		});
		pattern += ')$';

		this._masterUriRE = new RegExp(pattern);
	}

	/**
	 * Lookup endpoint matching the specified request URL and add the matched
	 * endpoint information to the service call.
	 *
	 * @param {module:x2node-webservices~ServiceCall} call The call.
	 * @returns {boolean} <code>true</code> if lookup was successful.
	 */
	lookup(call) {

		// match the endpoint
		const match = this._masterUriRE.exec(call.requestUrl.pathname);
		if (!match)
			return false;

		// find matched endpoint in the index
		const endpointInd = this._endpointsIndex.findIndex(
			(endpoint, i) => match[i + 1]);
		const endpoint = this._endpointsIndex[endpointInd];
		const uriParams = match.slice(
			endpointInd + 2, endpointInd + 2 + endpoint.numUriParams);

		// add the endpoint information to the call
		call.setHandler(endpoint.handler, uriParams);

		// report success
		return true;
	}
}

// export the class
module.exports = EndpointsMapper;
