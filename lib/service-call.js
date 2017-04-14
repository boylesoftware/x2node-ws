'use strict';


/**
 * Web-service call. An instance is created automatically by the framework for
 * each and every web-service call and provides context for all the components
 * that participate in the call handling (such as call handlers).
 *
 * @memberof module:x2node-webservices
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

		this._httpRequest = httpRequest;

		this._responseHeaderWritten = false;
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
	 * The original HTTP request.
	 *
	 * @member {http.external:IncomingMessage}
	 * @readonly
	 */
	get httpRequest() { return this._httpRequest; }

	/**
	 * The authenticator associated with the call, if any.
	 *
	 * @member {module:x2node-webservices.Authenticator=}
	 * @readonly
	 */
	get authenticator() { return this._authenticator; }
}

// export the class
module.exports = ServiceCall;
