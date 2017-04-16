"use strict";


/**
 * Authenticators mapper.
 *
 * @protected
 * @memberof module:x2node-ws
 * @inner
 */
class AuthenticatorsMapper {

	/**
	 * Create new mapper.
	 *
	 * @param {Map.<string,module:x2node-ws.Authenticator>} authenticators
	 * Authenticators by URI patterns.
	 */
	constructor(authenticators) {

		this._authenticatorsIndex = new Array();

		let pattern = '^(?:';
		authenticators.forEach((authenticator, uriPattern) => {
			if (this._authenticatorsIndex.length > 0)
				pattern += '|';
			pattern += '(' + uriPattern + ')';
			this._authenticatorsIndex.push(authenticator);
		});
		pattern += ')$';

		this._masterUriRE = new RegExp(pattern);
	}

	/**
	 * Lookup authenticator matching the specified request URL and add the
	 * matched authenticator to the service call.
	 *
	 * @param {module:x2node-ws~ServiceCall} call The call.
	 * @returns {boolean} <code>true</code> if lookup was successful.
	 */
	lookup(call) {

		// match the authenticator
		const match = this._masterUriRE.exec(call.requestUrl.pathname);
		if (!match)
			return false;

		// find matched authenticator in the index
		const authenticator = this._authenticatorsIndex[
			match.findIndex((m, i) => ((i > 0) && m)) - 1];

		// add the authenticator to the call
		call.setAuthenticator(authenticator);

		// report success
		return true;
	}
}

// export the class
module.exports = AuthenticatorsMapper;
