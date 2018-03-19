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
	 * @param {string} apiVersion Application API version.
	 * @param {http.external:IncomingMessage} httpRequest HTTP request.
	 * @param {module:x2node-ws~ApplicationOptions} options Application
	 * configuration options.
	 */
	constructor(apiVersion, httpRequest, appOptions) {

		this._id = String(gNextCallId++);
		this._timestamp = Date.now();

		this._apiVersion = apiVersion;
		this._appOptions = appOptions;

		this._httpRequest = httpRequest;
		this._requestUrl = url.parse(httpRequest.url, true);

		this._actor = null;
		this._entity = null;
		this._entityContentType = undefined;

		this._authorized = false;

		this._connectionClosed = false;
		this._responseHeaderWritten = false;
		this._complete = false;
	}

	/**
	 * Tells if the connection was closed unexpectedly.
	 *
	 * @protected
	 * @member {boolean}
	 */
	get connectionClosed() { return this._connectionClosed; }
	set connectionClosed(v) { this._connectionClosed = v; }

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
	 * Assign authenticator to the call. Only a single authenticator can be
	 * assigned to a call.
	 *
	 * @protected
	 * @param {module:x2node-ws.Authenticator} authenticator The authenticator.
	 */
	setAuthenticator(authenticator) {

		this._authenticator = authenticator;
	}

	/**
	 * Add authorizer to the call. The authorizer is added in front of any
	 * existing authorizers.
	 *
	 * @protected
	 * @param {module:x2node-ws.Authorizer} authorizer The authorizer.
	 */
	addAuthorizer(authorizer) {

		if (!this._authorizers)
			this._authorizers = new Array();

		this._authorizers.unshift(authorizer);
	}

	/**
	 * Assign handler to the call. If the handler has <code>isAllowed</code>
	 * method, it is added to the end of the authorizers list as well. Only a
	 * single handler can be assigned to a call.
	 *
	 * @protected
	 * @param {module:x2node-ws.Handler} handler The handler.
	 * @param {Array.<string>} uriParams Parameter values extracted from the URI.
	 */
	setHandler(handler, uriParams) {

		if ((typeof handler.isAllowed) === 'function') {
			if (!this._authorizers)
				this._authorizers = new Array();
			this._authorizers.push(handler);
		}

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
	 * Application API version.
	 *
	 * @member {string}
	 * @readonly
	 */
	get apiVersion() { return this._apiVersion; }

	/**
	 * Application configuration options originally passed to the module's
	 * [createApplication()]{@link module:x2node-ws.createApplication} function,
	 * or an empty object if none were passed.
	 *
	 * @member {module:x2node-ws~ApplicationOptions}
	 * @readonly
	 */
	get appOptions() { return this._appOptions; }

	/**
	 * The original HTTP request.
	 *
	 * @member {http.external:IncomingMessage}
	 * @readonly
	 */
	get httpRequest() { return this._httpRequest; }

	/**
	 * HTTP request method (shortcut for <code>httpRequest.method</code>).
	 *
	 * @member {string}
	 * @readonly
	 */
	get method() { return this._httpRequest.method; }

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
	 * List of authorizers (including the handler if it has
	 * <code>isAllowed</code> method) associated with the call, if any.
	 *
	 * @member {Array.<module:x2node-ws.Authorizer>=}
	 * @readonly
	 */
	get authorizers() { return this._authorizers; }

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
	 * Tells if the call has been authorized.
	 *
	 * @member {boolean}
	 */
	get authorized() { return this._authorized; }
	set authorized(v) { this._authorized = v; }

	/**
	 * Response content type requested by the caller via an "Accept" header. If
	 * no "Accept" header, defaults to the first content type supported by the
	 * endpoint handler, which, in turn, defaults to "application/json".
	 *
	 * @member {string}
	 */
	get requestedRepresentation() { return this._requestedRepresentation; }
	set requestedRepresentation(v) { this._requestedRepresentation = v; }

	/**
	 * Entity provided with the call by the caller, or <code>null</code> if none.
	 *
	 * @member {?Object}
	 */
	get entity() { return this._entity; }
	set entity(v) { this._entity = v; }

	/**
	 * If entity is set on the call, this is the entity content type (all lower
	 * case, without any parameters such as charset).
	 *
	 * @member {string=}
	 */
	get entityContentType() { return this._entityContentType; }
	set entityContentType(v) { this._entityContentType = v; }
}

// export the class
module.exports = ServiceCall;
