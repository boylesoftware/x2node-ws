'use strict';

const common = require('x2node-common');


/**
 * Symbol used to mark the call as passed through this authenticator.
 *
 * @private
 * @constant {Symbol}
 */
const AUTHED = Symbol('AUTHED_BEARER');

/**
 * The log.
 *
 * @private
 */
const log = common.getDebugLogger('X2_APP_AUTH');

/**
 * Base abstract class for authenticators that use "Bearer" token in the
 * "Authorization" HTTP request header (see
 * [RFC 6750]{@link https://tools.ietf.org/html/rfc6750}).
 *
 * @memberof module:x2node-ws
 * @abstract
 * @implements module:x2node-ws.Authenticator
 */
class BearerAuthenticator {

	// authenticate the call
	authenticate(call) {

		call[AUTHED] = true;

		const match = /^Bearer\s+(.+)/i.exec(
			call.httpRequest.headers['authorization']);
		if (match === null) {
			log('no valid Bearer Authorization header');
			return Promise.resolve(null);
		}

		return this.validateToken(match[1]);
	}

	// add response headers
	addResponseHeaders(call, response) {

		if (call[AUTHED] && (response.statusCode === 401))
			response.setHeader('WWW-Authenticate', 'Bearer');
	}

	/**
	 * Validate Bearer token and convert it to the actor. This method must be
	 * overridden and implemented in the subclass.
	 *
	 * @abstract
	 * @param {string} token Bearer token from the "Auithorization" header.
	 * @returns {(module:x2node-common.Actor|Promise.<module:x2node-common.Actor>)}
	 * Authenticated actor, <code>null</code> if could not authenticate, or a
	 * <code>Promise</code> of the above.
	 */
	// eslint-disable-next-line no-unused-vars
	validateToken(token) {

		throw new Error('validateToken must be implemented.');
	}
}

// export the class
module.exports = BearerAuthenticator;
