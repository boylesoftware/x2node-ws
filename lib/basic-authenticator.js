'use strict';


/**
 * Symbol used to mark the call as passed through this authenticator.
 *
 * @private
 * @constant {Symbol}
 */
const AUTHED = Symbol('AUTHED_BASIC');

/**
 * Authenticator that uses "Basic" HTTP authentication scheme (see
 * [RFC 7617]{@link https://tools.ietf.org/html/rfc7617}).
 *
 * @memberof module:x2node-ws
 * @implements module:x2node-ws.Authenticator
 */
class BasicAuthenticator {

	/**
	 * Create new authenticator.
	 *
	 * @param {module:x2node-ws.ActorsRegistry} actorsRegistry Actors registry.
	 * @param {string} [realm=Web Service] The realm.
	 */
	constructor(actorsRegistry, realm) {

		this._actorsRegistry = actorsRegistry;
		this._challenge =
			`Basic realm="${realm || 'Web Service'}", charset="UTF-8"`;
	}

	// authenticate the call
	authenticate(call) {

		// mark the call
		call[AUTHED] = true;

		// get the credentials from the Authorization header
		const match = /^Basic\s+([0-9a-z+/]+={0,2})/i.exec(
			call.httpRequest.headers['authorization']);
		if (match === null)
			return Promise.resolve(null);
		const creds = match[1];

		// decode the credentials
		const decodedCreds = (new Buffer(creds, 'base64')).toString('utf8');
		const colInd = decodedCreds.indexOf(':');
		if ((colInd <= 0) || (colInd >= decodedCreds.length - 1))
			return Promise.resolve(null);
		const handle = decodedCreds.substring(0, colInd);
		const password = decodedCreds.substring(colInd + 1);

		// look up the actor
		return this._actorsRegistry.lookupActor(handle, password);
	}

	// add response headers
	addResponseHeaders(call, response) {

		if (call[AUTHED] && (response.statusCode === 401))
			response.setHeader('WWW-Authenticate', this._challenge);
	}
}

// export the class
module.exports = BasicAuthenticator;
