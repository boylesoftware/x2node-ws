'use strict';

const url = require('url');


let gNextCallId = 1;

/**
 * Web-service call. An instance is created automatically by the framework for
 * each and every web-service call and provides context for all the components
 * that participate in the call handling (such as call handlers).
 *
 * @memberof module:x2node-ws
 * @inner
 */
class ServiceCall {

	/**
	 * <strong>Note:</strong> The constructor is not accessible from the client
	 * code. Instances are created internally by the framework.
	 *
	 * @protected
	 * @param {http.external:IncomingMessage} httpRequest HTTP request.
	 * @param {http.external:ServerResponse} httpResponse HTTP response.
	 */
	constructor(httpRequest) {

		this._id = String(gNextCallId++);
		this._timestamp = Date.now();

		this._httpRequest = httpRequest;
		this._requestUrl = url.parse(httpRequest.url, true);

		this._actor = null;
		this._entity = null;

		this._responseHeaderWritten = false;
		this._complete = false;
	}

	/**
	 * Tells if HTTP response header has been written.
	 *
	 * @protected
	 * @member {boolean}
	 */
	get responseHeaderWritten() { return this._responseHeaderWritten; }
	set responseHeaderWritten(v) { this._responseHeaderWritten = v; }

	/**
	 * Tells if sending HTTP response has been completed.
	 *
	 * @protected
	 * @member {boolean}
	 */
	get complete() { return this._complete; }
	set complete(v) { this._complete = v; }

	/**
	 * Add authenticator to the call.
	 *
	 * @protected
	 * @param {module:x2node-ws.Authenticator} authenticator The authenticator.
	 */
	setAuthenticator(authenticator) {

		this._authenticator = authenticator;
	}

	/**
	 * Add handler to the call.
	 *
	 * @protected
	 * @param {module:x2node-ws.Handler} handler The handler.
	 * @param {Array.<string>} uriParams Parameter values extracted from the URI.
	 */
	setHandler(handler, uriParams) {

		this._handler = handler;
		this._uriParams = uriParams;
	}

	/**
	 * Call id unique for the process.
	 *
	 * @member {string}
	 * @readonly
	 */
	get id() { return this._id; }

	/**
	 * Timestamp when the call was registered (from <code>Date.now()</code>).
	 *
	 * @member {number}
	 * @readonly
	 */
	get timestamp() { return this._timestamp; }

	/**
	 * The original HTTP request.
	 *
	 * @member {http.external:IncomingMessage}
	 * @readonly
	 */
	get httpRequest() { return this._httpRequest; }

	/**
	 * Parsed request URL object including parsed query string.
	 *
	 * @member {external:Url}
	 * @readonly
	 */
	get requestUrl() { return this._requestUrl; }

	/**
	 * The authenticator associated with the call, if any.
	 *
	 * @member {module:x2node-ws.Authenticator=}
	 * @readonly
	 */
	get authenticator() { return this._authenticator; }

	/**
	 * The handler associated with the call.
	 *
	 * @member {module:x2node-ws.Handler}
	 * @readonly
	 */
	get handler() { return this._handler; }

	/**
	 * Parameter values extracted from the request URI. May be empty array.
	 *
	 * @member {Array.<string>}
	 * @readonly
	 */
	get uriParams() { return this._uriParams; }

	/**
	 * Authenticated actor associated with the call, or <code>null</code> if
	 * unauthenticated.
	 *
	 * @member {?module:x2node-common.Actor}
	 */
	get actor() { return this._actor; }
	set actor(v) { this._actor = v; }

	/**
	 * Entity provided with the call by the caller, or <code>null</code> if none.
	 *
	 * @member {?Object}
	 */
	get entity() { return this._entity; }
	set entity(v) { this._entity = v; }
}

// export the class
module.exports = ServiceCall;
