'use strict';

const http = require('http');
const stream = require('stream');
const EventEmitter = require('events');
const common = require('x2node-common');

const ServiceCall = require('./service-call.js');
const ServiceResponse = require('./service-response.js');
const PatternMap = require('./pattern-map.js');


/**
 * Application shutdown event. Fired after all active HTTP connections have
 * completed.
 *
 * @event module:x2node-ws~Application#shutdown
 * @type {string}
 */

/**
 * Cacheable HTTP response status codes.
 *
 * @private
 * @constant {Set.<number>}
 */
const CACHEABLE_STATUS_CODES = new Set([
	200, 203, 204, 206, 300, 301, 304, 308, 404, 405, 410, 414, 501
]);

/**
 * "Simple" HTTP response headers.
 *
 * @private
 * @constant {Set.<string>}
 */
const SIMPLE_RESPONSE_HEADERS = new Set([
	'cache-control',
	'content-language',
	'content-type',
	'expires',
	'last-modified',
	'pragma'
]);

/**
 * Multipart HTTP response boundary.
 *
 * @private
 * @constant {string}
 */
const BOUNDARY = 'x2node_boundary_gc0p4Jq0M2Yt08j34c0p';

const BOUNDARY_MID = new Buffer(`--${BOUNDARY}\r\n`, 'ascii');
const BOUNDARY_END = new Buffer(`--${BOUNDARY}--`, 'ascii');
const CRLF = new Buffer('\r\n', 'ascii');

/**
 * Default connection idle timeout.
 *
 * @private
 * @constant {number}
 */
const DEFAULT_CONN_IDLE_TIMEOUT = 30000;

const DEFAULT_MAX_REQUEST_SIZE = 2048;

const DEFAULT_CORS_PREFLIGHT_MAX_AGE = 20 * 24 * 3600;

/**
 * Used to store list of supported methods on a handler.
 *
 * @private
 * @constant {Symbol}
 */
const METHODS = Symbol('METHODS');

/**
 * Used to store connection id on sockets.
 *
 * @private
 * @constant {Symbol}
 */
const CONNECTION_ID = Symbol('CONNECTION_ID');

/**
 * Used to store idle/active status on sockets.
 *
 * @private
 * @constant {Symbol}
 */
const IDLE = Symbol('IDLE');

/**
 * Known HTTP methods.
 *
 * @private
 * @constant {Set.<string>}
 */
const KNOWN_METHODS = new Set(http.METHODS);
KNOWN_METHODS.delete('OPTIONS'); // handled in a special way

/**
 * Known normalized header names that are not trivially capitalized.
 *
 * @private
 * @constant {Object.<string,string>}
 */
const NORMAL_HEADER_NAMES = {
	'www-authenticate': 'WWW-Authenticate',
	'etag': 'ETag'
};

/**
 * Callback for the socket timeout before response has started to be sent.
 *
 * @private
 * @param {net.external:Socket} socket The connection socket.
 */
function onBeforeResponseTimeout(socket) {

	if (socket)
		socket.end(
			'HTTP/1.1 408 ' + http.STATUS_CODES[408] + '\r\n' +
				'Date: ' + (new Date()).toUTCString() + '\r\n' +
				'Connection: close\r\n' +
				'\r\n');
}

/**
 * JSON marshaller implementation.
 *
 * @private
 * @constant {module:x2node-ws.Marshaller}
 */
const JSON_MARSHALLER = {

	serialize(obj) {

		return new Buffer(JSON.stringify(obj));
	},

	deserialize(data) {

		let record;
		try {
			record = JSON.parse(data.toString());
		} catch (err) {
			if (err instanceof SyntaxError)
				throw new common.X2DataError(`Invalid JSON: ${err.message}`);
			throw err;
		}

		if (((typeof record) !== 'object') || (record === null))
			throw new common.X2DataError(
				'Invalid record data: expected an object.');

		return record;
	}
};

/**
 * Represents the web service application.
 *
 * @memberof module:x2node-ws
 * @inner
 * @extends external:EventEmitter
 * @fires module:x2node-ws~Application#shutdown
 */
class Application extends EventEmitter {

	/**
	 * <strong>Note:</strong> The constructor is not accessible from the client
	 * code. Instances are created using module's
	 * [createApplication()]{@link module:x2node-ws.createApplication} function.
	 *
	 * @protected
	 * @param {module:x2node-ws~ApplicationOptions} options Application
	 * configuration options.
	 */
	constructor(options) {
		super();

		// save options
		this._options = options;

		// application API version
		if (options.apiVersion === undefined) {
			if (process.env.NODE_ENV === 'development') {
				this._apiVersion = `dev-${Date.now()}`;
			} else {
				this._apiVersion =
					require.main.require('./package.json').version;
			}
		} else {
			this._apiVersion = String(options.apiVersion);
		}

		// allowed CORS origins
		if (Array.isArray(options.allowedOrigins) &&
			(options.allowedOrigins.length > 0))
			this._allowedOrigins = new Set(
				options.allowedOrigins.map(o => String(o).toLowerCase()));
		else if (((typeof options.allowedOrigins) === 'string') &&
			(options.allowedOrigins.trim().length > 0))
			this._allowedOrigins = new Set(
				options.allowedOrigins.toLowerCase().trim().split(/\s*,\s*/));

		// the debug log
		this._log = common.getDebugLogger('X2_APP');

		// marshallers, authenticators, authorizers and endpoints (later maps)
		this._marshallers = new Array();
		this._authenticators = new Array();
		this._authorizers = new Array();
		this._endpoints = new Array();

		// current URIs prefix
		this._prefix = '';

		// application running state
		this._connections = new Map();
		this._nextConnectionId = 1;
		this._running = false;
		this._shuttingDown = false;
	}

	/**
	 * Set URI prefix for the subsequent <code>addAuthenticator()</code>,
	 * <code>addAuthorizer()</code> and <code>addEndpoint()</code> calls.
	 *
	 * @param {string} prefix Prefix to add to the URI patterns.
	 * @returns {module:x2node-ws~Application} This application.
	 */
	setPrefix(prefix) {

		this._prefix = (prefix || '');

		return this;
	}

	/**
	 * Add marshaller for the content type. When looking up marshaller for a
	 * content type, the content type patterns are matched in the order the
	 * marshallers were added to the application. After all custom marshallers
	 * are added, the application automatically adds default JSON marshaller
	 * implementation for patterns "application/json" and ".+\+json".
	 *
	 * @param {string} contentTypePattern Content type regular expression
	 * pattern. The content type is matched against the pattern as a whole, so no
	 * starting <code>^</code> and ending <code>$</code> are necessary. It is
	 * matched without any parameters (such as charset, etc.). Also, the match is
	 * case-insensitive.
	 * @param {module:x2node-ws.Marshaller} marshaller The marshaller
	 * implementation.
	 * @returns {module:x2node-ws~Application} This application.
	 */
	addMarshaller(contentTypePattern, marshaller) {

		if (this._running)
			throw new common.X2UsageError('Application is already running.');

		this._marshallers.push({
			pattern: contentTypePattern,
			value: marshaller
		});

		return this;
	}

	/**
	 * Associate an authenticator with the specified URI pattern. When looking up
	 * authenticator for a URI, the URI patterns are matched in the order the
	 * authenticators were added to the application.
	 *
	 * @param {string} uriPattern URI regular expression pattern. The URI is
	 * matched against the pattern as a whole, so no starting <code>^</code> and
	 * ending <code>$</code> are necessary. The match is case-sensitive.
	 * @param {module:x2node-ws.Authenticator} authenticator The authenticator.
	 * @returns {module:x2node-ws~Application} This application.
	 */
	addAuthenticator(uriPattern, authenticator) {

		if (this._running)
			throw new common.X2UsageError('Application is already running.');

		this._authenticators.push(
			this._toMappingDesc(uriPattern, authenticator));

		return this;
	}

	/**
	 * Associate an authorizer with the specified URI pattern. When looking up
	 * authorizer for a URI, the URI patterns are matched in the order the
	 * authorizers were added to the application.
	 *
	 * @param {string} uriPattern URI regular expression pattern. The URI is
	 * matched against the pattern as a whole, so no starting <code>^</code> and
	 * ending <code>$</code> are necessary. The match is case-sensitive.
	 * @param {(module:x2node-ws.Authorizer|function)} authorizer The authorizer.
	 * If function, the function is used as the authorizer's
	 * <code>isAllowed()</code> method.
	 * @returns {module:x2node-ws~Application} This application.
	 */
	addAuthorizer(uriPattern, authorizer) {

		if (this._running)
			throw new common.X2UsageError('Application is already running.');

		this._authorizers.push(
			this._toMappingDesc(uriPattern, (
				(typeof authorizer) === 'function' ?
					{ isAllowed: authorizer } : authorizer
			)));

		return this;
	}

	/**
	 * Add web service endpoint. When looking up endpoint handler for a URI, the
	 * URI patterns are matched in the order the handlers were added to the
	 * application.
	 *
	 * @param {(string|Array.<string>)} uriPattern Endpoint URI regular
	 * expression pattern. URI parameters are groups in the pattern. The URI is
	 * matched against the pattern as a whole, so no starting <code>^</code> and
	 * ending <code>$</code> are necessary. The match is case-sensitive. If
	 * array, the first array element is the pattern and the rest are names for
	 * the positional URI parameters.
	 * @param {module:x2node-ws.Handler} handler The handler for the endpoint.
	 * @returns {module:x2node-ws~Application} This application.
	 */
	addEndpoint(uriPattern, handler) {

		if (this._running)
			throw new common.X2UsageError('Application is already running.');

		this._endpoints.push(
			this._toMappingDesc(uriPattern, handler));

		return this;
	}

	/**
	 * Create mapping descriptor.
	 *
	 * @private
	 * @param {(string|Array.<string>)} uriPattern URI pattern.
	 * @param {*} value The mapping value.
	 * @returns {module:x2node-ws~PatternMap~MappingDesc} Mapping descriptor.
	 */
	_toMappingDesc(uriPattern, value) {

		return {
			pattern: (
				this._prefix.length > 0 ? (
					Array.isArray(uriPattern) ?
						[ this._prefix + uriPattern[0] ].concat(
							uriPattern.slice(1))
						: this._prefix + uriPattern
				) : uriPattern
			),
			value: value
		};
	}

	/**
	 * Create HTTP server and run the application on it.
	 *
	 * @param {number} port Port, on which to listen for incoming HTTP requests.
	 */
	run(port) {

		// check if already running
		if (this._running)
			throw new common.X2UsageError('Application is already running.');
		this._running = true;

		// the debug log
		const log = this._log;
		log('starting up');

		// add default marshallers
		this._marshallers.push({
			pattern: 'application/json',
			value: JSON_MARSHALLER
		});
		this._marshallers.push({
			pattern: '.+\\+json',
			value: JSON_MARSHALLER
		});

		// compile pattern maps
		this._marshallers = new PatternMap(this._marshallers);
		this._authenticators = new PatternMap(this._authenticators);
		this._authorizers = new PatternMap(this._authorizers);
		this._endpoints = new PatternMap(this._endpoints);

		// create HTTP server
		const server = http.createServer();

		// set initial connection idle timeout
		server.setTimeout(
			this._options.connectionIdleTimeout || DEFAULT_CONN_IDLE_TIMEOUT,
			onBeforeResponseTimeout
		);

		// set maximum allowed number of HTTP request headers
		server.maxHeadersCount = (this._options.maxRequestHeadersCount || 50);

		// set open connections registry maintenance handlers
		server.on('connection', socket => {
			const connectionId = `#${this._nextConnectionId++}`;
			this._log(`connection ${connectionId} opened`);
			socket[CONNECTION_ID] = connectionId;
			socket[IDLE] = true;
			this._connections.set(CONNECTION_ID, socket);
			socket.on('close', () => {
				this._log(`connection ${connectionId} closed`);
				this._connections.delete(CONNECTION_ID);
			});
		});

		// set shutdown handler
		server.on('close', () => {
			log('all connections closed, firing shutdown event');
			this.emit('shutdown');
		});

		// set request processing handlers
		server.on('checkContinue', this._respond.bind(this));
		server.on('request', this._respond.bind(this));

		// setup signals
		const terminate = (singalNum) => {
			if (this._shuttingDown) {
				log('already shutting down');
			} else {
				log('shutting down');
				this._shuttingDown = true;
				for (let connection of this._connections.values())
					if (connection[IDLE])
						this._destroyConnection(connection);
				server.close(() => {
					process.exit(128 + singalNum);
				});
			}
		};
		process.on('SIGHUP', () => { terminate(1); });
		process.on('SIGINT', () => { terminate(2); });
		process.on('SIGTERM', () => { terminate(15); });
		process.on('SIGBREAK', () => { terminate(21); });

		// start listening for incoming requests
		server.listen(port, () => {
			log(
				`ready for requests on ${port}, ` +
					`API version ${this._apiVersion}`);
		});
	}

	/**
	 * Respond to an HTTP request.
	 *
	 * @private
	 * @param {http.external:IncomingMessage} httpRequest HTTP request.
	 * @param {http.external:ServerResponse} httpResponse HTTP response.
	 */
	_respond(httpRequest, httpResponse) {

		// mark connection as active
		httpRequest.socket[IDLE] = false;

		// create the service call object
		const call = new ServiceCall(
			this._apiVersion, httpRequest, this._options);

		// process the call
		try {

			// log the call
			this._log(
				`received call #${call.id}: ${httpRequest.method}` +
					` ${call.requestUrl.pathname}`);

			// remove the initial connection idle timeout
			httpRequest.socket.setTimeout(0, onBeforeResponseTimeout);

			// install connection close listener
			httpRequest.socket.on('close', () => {
				call.connectionClosed = true;
			});

			// lookup the handler
			const hasHandler = this._endpoints.lookup(
				call.requestUrl.pathname,
				(handler, uriParams) => { call.setHandler(handler, uriParams); }
			);
			if (!hasHandler)
				return this._sendResponse(
					httpResponse, call, (new ServiceResponse(404).setEntity({
						errorCode: 'X2-404-1',
						errorMessage: 'No service endpoint at this URI.'
					})));

			// lookup the authenticator (OPTIONS responder needs it)
			this._authenticators.lookup(
				call.requestUrl.pathname,
				authenticator => { call.setAuthenticator(authenticator); }
			);

			// get handler methods
			const handlerMethods = this._getHandlerMethods(call.handler);

			// get requested method
			const method = (
				httpRequest.method === 'HEAD' ? 'GET' : httpRequest.method);

			// respond to an OPTIONS request
			if (method === 'OPTIONS')
				return this._sendOptionsResponse(
					httpResponse, call, handlerMethods);

			// check if the method is supported by the handler
			if (!handlerMethods.has(method)) {
				const response = new ServiceResponse(405);
				this._setAllowedMethods(response, handlerMethods);
				response.setEntity({
					errorCode: 'X2-405-1',
					errorMessage: 'Method not supported by the service endpoint.'
				});
				return this._sendResponse(httpResponse, call, response);
			}

			// lookup the authorizer
			this._authorizers.lookupMultiReverse(
				call.requestUrl.pathname,
				authorizer => { call.addAuthorizer(authorizer); }
			);

			// build the processing chain
			this._authenticateCall(
				call
			).then(
				call => (
					this._log(`authed actor: ${call.actor && call.actor.stamp}`),
					this._authorizeCall(call)
				)
			).then(
				call => this._readRequestPayload(call, httpResponse)
			).then(
				call => Promise.resolve(call.handler[method](call))
			).then(
				result => {
					let response;
					if ((result === null) || (result === undefined)) {
						response = new ServiceResponse(204);
					} else if (result instanceof ServiceResponse) {
						response = result;
					} else if ((typeof result) === 'object') {
						response = new ServiceResponse(200);
						response.setEntity(result);
					} else {
						response = new ServiceResponse(200);
						response.setEntity(
							new Buffer(String(result), 'utf8'),
							'text/plain; charset=UTF-8'
						);
					}
					this._sendResponse(httpResponse, call, response);
				}
			).catch(
				err => {
					if (err instanceof ServiceResponse)
						this._sendResponse(httpResponse, call, err);
					else if (err)
						this._sendInternalServerErrorResponse(
							httpResponse, call, err);
				}
			);

		} catch (err) {
			this._sendInternalServerErrorResponse(httpResponse, call, err);
		}
	}

	/**
	 * Perform service call authentication, set the actor on the call and check
	 * if allowed to proceed.
	 *
	 * @private
	 * @param {module:x2node-ws~ServiceCall} call The call.
	 * @returns {Promise.<module:x2node-ws~ServiceCall>} Promise of the
	 * authenticated call.
	 */
	_authenticateCall(call) {

		// check if no authenticator
		if (!call.authenticator)
			return Promise.resolve(call);

		// call the authenticator
		return Promise.resolve(call.authenticator.authenticate(call)).then(
			actor => {

				// check if connection closed while authenticating
				if (call.connectionClosed)
					return Promise.reject(null);

				// set actor on the call
				if (actor)
					call.actor = actor;

				// proceed with the call
				return call;
			}
		);
	}

	/**
	 * Perform service call authorization.
	 *
	 * @private
	 * @param {module:x2node-ws~ServiceCall} call The call.
	 * @returns {Promise.<module:x2node-ws~ServiceCall>} Promise of the
	 * authorized call.
	 */
	_authorizeCall(call) {

		// pre-authorize the call
		call.authorized = true;

		// check if no authorizers
		const authorizers = call.authorizers;
		if (!authorizers || (authorizers.length === 0))
			return call;

		// queue up the authorizers
		let promiseChain = Promise.resolve(call);
		for (let authorizer of authorizers) {
			promiseChain = promiseChain.then(
				call => {

					// check if connection closed while authorizing
					if (call.connectionClosed)
						return Promise.reject(null);

					// check if unauthorized by previous authorizer
					if (!call.authorized)
						return call;

					// call the authorizer
					return Promise.resolve(authorizer.isAllowed(call)).then(
						authorized => {

							// check if connection closed while authorizing
							if (call.connectionClosed)
								return Promise.reject(null);

							// check if unauthorized
							if (!authorized)
								call.authorized = false;

							// proceed with the call
							return call;
						}
					);
				}
			);
		}

		// queue up the authorization check and return the result
		return promiseChain.then(
			call => {

				// check if failed to authorize
				if (!call.authorized)
					return Promise.reject(
						call.actor ?
							(new ServiceResponse(403)).setEntity({
								errorCode: 'X2-403-1',
								errorMessage: 'Insufficient permissions.'
							}) :
							(new ServiceResponse(401)).setEntity({
								errorCode: 'X2-401-1',
								errorMessage: 'Authentication required.'
							})
					);

				// authorized, proceed with the call
				return call;
			}
		);
	}

	/**
	 * Load request payload, if any, and add it to the service call.
	 *
	 * @private
	 * @param {module:x2node-ws~ServiceCall} call The call.
	 * @param {http.external:ServerResponse} httpResponse The HTTP response.
	 * @returns {Promise.<module:x2node-ws~ServiceCall>} Promise of the call with
	 * payload added to it.
	 */
	_readRequestPayload(call, httpResponse) {

		// get request headers
		const requestHeaders = call.httpRequest.headers;

		// check if there is payload
		const contentLength = Number(requestHeaders['content-length']);
		if (!(contentLength > 0))
			return call;

		// check if not too large
		const maxRequestSize = (
			this._options.maxRequestSize || DEFAULT_MAX_REQUEST_SIZE);
		if (contentLength > maxRequestSize)
			return Promise.reject(
				(new ServiceResponse(413))
					.setHeader('Connection', 'close')
					.setEntity({
						errorCode: 'X2-413',
						errorMessage: 'The request entity is too large.'
					})
			);

		// get content type
		const contentType = (
			requestHeaders['content-type'] || 'application/octet-stream');

		// restore connection idle timeout
		const connection = call.httpRequest.socket;
		connection.setTimeout(
			this._options.connectionIdleTimeout || DEFAULT_CONN_IDLE_TIMEOUT,
			onBeforeResponseTimeout
		);

		// check if multipart
		if (/^multipart\//i.test(contentType)) {

			// TODO: implement
			return Promise.reject((new ServiceResponse(415)).setEntity({
				errorCode: 'X2-415',
				errorMessage: 'Multipart requests are not supported yet.'
			}));

		} else { // not multipart

			// find marshaller
			const entityContentType = contentType.split(';')[0].toLowerCase();
			let marshaller;
			if (call.handler.requestEntityParsers) {
				const deserializer = call.handler.requestEntityParsers[
					entityContentType];
				if ((typeof deserializer) === 'function')
					marshaller = { deserialize: deserializer };
			}
			if (!marshaller)
				marshaller = this._marshallers.lookup(entityContentType);
			if (!marshaller)
				return Promise.reject(
					(new ServiceResponse(415)).setEntity({
						errorCode: 'X2-415',
						errorMessage: 'Unsupported request entity content type.'
					})
				);

			// respond with 100 if expecting continue
			this._sendContinue(httpResponse);

			// read the data
			return this._readEntity(
				call, call.httpRequest, marshaller, contentType).then(
					entity => {

						// remove connection idle timeout
						connection.setTimeout(0, onBeforeResponseTimeout);

						// set entity on the call
						call.entity = entity;
						call.entityContentType = entityContentType;

						// proceed with the call
						return call;
					},
					err => {

						// remove connection idle timeout
						connection.setTimeout(0, onBeforeResponseTimeout);

						// abort the call
						return Promise.reject(err);
					}
				);
		}
	}

	/**
	 * Read and parse entity from input stream.
	 *
	 * @private
	 * @param {module:x2node-ws~ServiceCall} call The call.
	 * @param {stream.external:Readable} input Input stream.
	 * @param {module:x2node-ws.Marshaller} marshaller Marshaller to use to parse
	 * the entity.
	 * @param {string} contentType Content type request header value.
	 * @returns {Promise.<Object>} Promise of the parsed entity object.
	 */
	_readEntity(call, input, marshaller, contentType) {

		return (new Promise((resolve, reject) => {

			const dataBufs = new Array();
			let done = false;
			input
				.on('data', chunk => {

					// check if response resolved in another event handler
					if (done)
						return;

					// check if connection closed
					if (call.connectionClosed) {
						done = true;
						return Promise.reject(null);
					}

					// add data chunk to the read data buffer
					dataBufs.push(chunk);
				})
				.on('error', err => {

					// check if response resolved in another event handler
					if (done)
						return;

					// mark as done
					done = true;

					// reject with the error
					reject(err);
				})
				.on('end', () => {

					// check if response resolved in another event handler
					if (done)
						return;

					// mark as done
					done = true;

					// check if connection closed
					if (call.connectionClosed)
						return Promise.reject(null);

					// parse the request entity
					try {
						resolve(marshaller.deserialize((
							dataBufs.length === 1 ?
								dataBufs[0] : Buffer.concat(dataBufs)
						), contentType));
					} catch (err) {
						this._log(
							`error parsing request entity: ${err.message}`);
						if (err instanceof common.X2DataError) {
							reject(
								(new ServiceResponse(400)).setEntity({
									errorCode: 'X2-400-1',
									errorMessage:
										'Could not parse request entity.'
								})
							);
						} else {
							reject(err);
						}
					}
				});

		})).then( // let all I/O events play out
			entity => new Promise(resolve => {
				setTimeout(() => { resolve(entity); }, 1);
			}),
			err => new Promise((_, reject) => {
				setTimeout(() => { reject(err); }, 1);
			})
		);
	}

	/**
	 * Send 100 (Continue) HTTP response, if needs to.
	 *
	 * @private
	 * @param {http.external:ServerResponse} httpResponse The HTTP response.
	 */
	_sendContinue(httpResponse) {

		// KLUDGE: response properties used below are undocumented
		if (httpResponse._expect_continue && !httpResponse._sent100)
			httpResponse.writeContinue();
		/*if (httpRequest.headers['expect'] === '100-continue')
			httpResponse.writeContinue();*/
	}

	/**
	 * Send response to an OPTIONS request.
	 *
	 * @private
	 * @param {http.external:ServerResponse} httpResponse HTTP response.
	 * @param {module:x2node-ws~ServiceCall} call The call.
	 * @param {Set.<string>} allowedMethods Allowed HTTP methods.
	 */
	_sendOptionsResponse(httpResponse, call, allowedMethods) {

		// create the response object
		const response = new ServiceResponse(200);

		// add allowed methods
		this._setAllowedMethods(response, allowedMethods);

		// add zero content length header
		response.setHeader('Content-Length', 0);

		// response always varies depending on the "Origin" header
		response.setHeader('Vary', 'Origin');

		// process CORS preflight request
		const requestHeaders = call.httpRequest.headers;
		const requestedMethod = requestHeaders['access-control-request-method'];
		if (requestedMethod && this._addCORS(call, response)) {

			// preflight response caching
			response.setHeader(
				'Access-Control-Max-Age', (
					this._options.corsPreflightMaxAge ||
						DEFAULT_CORS_PREFLIGHT_MAX_AGE));

			// allowed methods
			response.setHeader(
				'Access-Control-Allow-Methods', response.headers['allow']);

			// allowed request headers
			const requestedHeaders =
				requestHeaders['access-control-request-headers'];
			if (requestedHeaders)
				response.setHeader(
					'Access-Control-Allow-Headers', requestedHeaders);
		}

		// custom handler logic
		if ((typeof call.handler.OPTIONS) === 'function')
			call.handler.OPTIONS(call, response);

		// send the response
		this._sendResponse(httpResponse, call, response);
	}

	/**
	 * Send HTTP 500 (Internal Server Error) response as a reaction to an
	 * unexpected error.
	 *
	 * @private
	 * @param {http.external:ServerResponse} httpResponse HTTP response.
	 * @param {module:x2node-ws~ServiceCall} call The call.
	 * @param {external:Error} err The error that caused the 500 response.
	 */
	_sendInternalServerErrorResponse(httpResponse, call, err) {

		common.error('internal server error', err);

		this._sendResponse(
			httpResponse, call, (new ServiceResponse(500))
				.setHeader('Connection', 'close')
				.setEntity({
					errorCode: 'X2-500-1',
					errorMessage: 'Internal server error.'
				})
		);
	}

	/**
	 * Send web-service response.
	 *
	 * @private
	 * @param {http.external:ServerResponse} httpResponse HTTP response.
	 * @param {module:x2node-ws~ServiceCall} call The call.
	 * @param {module:x2node-ws~ServiceResponse} response The response.
	 */
	_sendResponse(httpResponse, call, response) {

		// check if connection closed
		if (call.connectionClosed) {
			this._log('not sending response because connection was closed');
			return;
		}

		try {

			// restore idle timeout on the connection
			httpResponse.setTimeout(
				this._options.connectionIdleTimeout || DEFAULT_CONN_IDLE_TIMEOUT,
				socket => {
					if (!call.complete)
						common.error(
							'connection timed out before completing the' +
								' response');
					this._destroyConnection(socket);
				}
			);

			// get the request method for quick access
			const method = call.httpRequest.method;

			// response always varies depending on the "Origin" header
			response.addToHeadersListHeader('Vary', 'Origin');

			// let authenticator to add its response headers
			if (call.authenticator && call.authenticator.addResponseHeaders)
				call.authenticator.addResponseHeaders(call, response);

			// default response cache control if none in the service response
			if (!response.hasHeader('Cache-Control') && (
				(method === 'GET') || (method === 'HEAD') ||
					response.hasHeader('Content-Location')) &&
				CACHEABLE_STATUS_CODES.has(response.statusCode)) {
				response
					.setHeader('Cache-Control', 'no-cache')
					.setHeader('Expires', '0')
					.setHeader('Pragma', 'no-cache');
			}

			// check if cross-origin request
			if (this._addCORS(call, response)) {

				// add exposed headers
				const exposedHeaders = Object.keys(response.headers).filter(
					h => !SIMPLE_RESPONSE_HEADERS.has(h)).join(', ');
				if (exposedHeaders.length > 0)
					response.setHeader(
						'Access-Control-Expose-Headers', exposedHeaders);
			}

			// don't keep connection alive if shutting down
			if (this._shuttingDown)
				response.setHeader('Connection', 'close');

			// completion handler
			httpResponse.on('finish', () => {
				call.complete = true;
				const connection = call.httpRequest.socket;
				connection[IDLE] = true;
				if (this._shuttingDown)
					process.nextTick(() => {
						this._destroyConnection(connection);
					});
				this._log(
					`call #${call.id} completed in ` +
						`${Date.now() - call.timestamp}ms`);
			});

			// add response entities
			const entities = response.entities;
			if (entities.length > 0) {

				// set up response content type
				if (entities.length > 1) {
					response.setHeader(
						'Content-Type', `multipart/mixed; boundary=${BOUNDARY}`);
				} else { // single entity
					const entity = entities[0];
					for (let h of Object.keys(entity.headers))
						response.setHeader(h, entity.headers[h]);
				}

				// send entities using different methods
				if (method === 'HEAD') {
					this._completeResponseNoEntities(
						httpResponse, call, response);
				} else {
					this._completeResponseWithEntities(
						httpResponse, call, response, entities);
				}

			} else { // no entities
				this._completeResponseNoEntities(httpResponse, call, response);
			}

		} catch (err) {
			if (call.responseHeaderWritten) {
				common.error(
					'internal error after response header has been written,' +
						' quitely closing the connection', err);
				this._destroyConnection(httpResponse.socket);
			} else {
				common.error(
					'internal error preparing response, sending 500 response',
					err);
				try {
					httpResponse.socket.end(
						'HTTP/1.1 500 ' + http.STATUS_CODES[500] + '\r\n' +
							'Date: ' + (new Date()).toUTCString() + '\r\n' +
							'Connection: close\r\n' +
							'\r\n');
				} catch (errorResponseErr) {
					common.error(
						'internal error sending 500 response,' +
							' quitely closing the connection', errorResponseErr);
					this._destroyConnection(httpResponse.socket);
				}
			}
		}
	}

	/**
	 * Forcibly severe connection.
	 *
	 * @private
	 * @param {net.external:Socket} socket The connection socket.
	 */
	_destroyConnection(socket) {

		if (socket && !socket.destroyed) {
			const connectionId = socket[CONNECTION_ID];
			this._log(`severing connection ${connectionId}`);
			this._connections.delete(connectionId);
			socket.destroy();
		}
	}

	/**
	 * Check origin of a cross-origin request and if allowed, add CORS response
	 * headers common for simple and preflight requests.
	 *
	 * @private
	 * @param {module:x2node-ws~ServiceCall} call The call.
	 * @param {module:x2node-ws~ServiceResponse} response The response.
	 * @returns {boolean} <code>true</code> if CORS headers were added (allowed
	 * cross-origin request or not a cross-origin request).
	 */
	_addCORS(call, response) {

		const origin = call.httpRequest.headers['origin'];
		if (!origin)
			return false;

		// check if the service allows only specific origins
		let allowed = false;
		if (this._allowedOrigins) {

			// check if allowed
			allowed = this._allowedOrigins.has(origin.toLowerCase());
			if (allowed) {

				// allow the specific origin
				response.setHeader('Access-Control-Allow-Origin', origin);

				// check if the endpoint supports credentialed requests
				if (call.authenticator)
					response.setHeader(
						'Access-Control-Allow-Credentials', 'true');
			}

		} else { // service is open to all origins

			// allow it
			allowed = true;

			// check if the endpoint supports credentialed requests
			if (call.authenticator) {
				response.setHeader('Access-Control-Allow-Origin', origin);
				response.setHeader('Access-Control-Allow-Credentials', 'true');
			} else { // public endpoint
				response.setHeader('Access-Control-Allow-Origin', '*');
			}
		}

		// if allowed, headers were added
		return allowed;
	}

	/**
	 * Complete sending response with no entities.
	 *
	 * @private
	 * @param {http.external:ServerResponse} httpResponse HTTP response.
	 * @param {module:x2node-ws~ServiceCall} call The call.
	 * @param {module:x2node-ws~ServiceResponse} response The response.
	 */
	_completeResponseNoEntities(httpResponse, call, response) {

		httpResponse.writeHead(
			response.statusCode, this._capitalizeHeaders(response.headers));
		call.responseHeaderWritten = true;
		httpResponse.end();
	}

	/**
	 * Complete sending response with entities.
	 *
	 * @private
	 * @param {http.external:ServerResponse} httpResponse HTTP response.
	 * @param {module:x2node-ws~ServiceCall} call The call.
	 * @param {module:x2node-ws~ServiceResponse} response The response.
	 * @param {Array.<module:x2node-ws~ServiceResponse~Entity>} entities Entities
	 * to send.
	 */
	_completeResponseWithEntities(httpResponse, call, response, entities) {

		// create sequence of buffers and streams to send in the response body
		let bufs = new Array(), chunked = false;
		if (entities.length === 1) {

			const entity = entities[0];
			if (entity.data instanceof stream.Readable) {
				bufs.push(entity.data);
				chunked = true;
			} else {
				bufs.push(this._getResponseEntityDataBuffer(entity));
			}

		} else { // multipart

			// add payload parts
			for (let i = 0, len = entities.length; i < len; i++) {
				const entity = entities[i];

				// part boundary
				bufs.push(BOUNDARY_MID);

				// part headers
				bufs.push(new Buffer(
					Object.keys(entity.headers).reduce((res, h) => {
						return res + this._capitalizeHeaderName(h) + ': ' +
							entity.headers[h] + '\r\n';
					}, '') + '\r\n', 'ascii'));

				// part body
				if (entity.data instanceof stream.Readable) {
					bufs.push(entity.data);
					chunked = true;
				} else {
					bufs.push(this._getResponseEntityDataBuffer(entity));
				}

				// part end
				bufs.push(CRLF);
			}

			// end boundary of the multipart payload
			bufs.push(BOUNDARY_END);
		}

		// set response content length
		if (!chunked)
			response.setHeader(
				'Content-Length',
				bufs.reduce((tot, buf) => (tot + buf.length), 0)
			);

		// write response head
		httpResponse.writeHead(
			response.statusCode, this._capitalizeHeaders(response.headers));
		call.responseHeaderWritten = true;

		// setup error listener
		let error = false;
		httpResponse.on('error', err => {
			this._log(`error writing the response: ${err.message}`);
			error = true;
		});

		// write response body buffers and streams
		const numBufs = bufs.length;
		let curBufInd = 0;
		function writeHttpResponse() {

			// give up if error or connection closed
			if (error || call.connectionClosed) {
				this._log('aborting sending the response');
				return;
			}

			// write the buffers to the stream
			while (curBufInd < numBufs) {
				const data = bufs[curBufInd++];

				// buffer or stream?
				if (Buffer.isBuffer(data)) {

					// write the buffer, wait for "drain" if necessary
					if (!httpResponse.write(data)) {

						// continue to the next buffer or stream upon "drain"
						httpResponse.once('drain', writeHttpResponse);

						// exit until "drain" is received
						return;
					}

				} else { // stream

					// pipe the stream into the response
					data.pipe(httpResponse, { end: false });

					// continue to the next buffer or stream upon "end"
					data.on('end', writeHttpResponse);

					// exit until "end" is received
					return;
				}
			}

			// all buffers written, end the response
			httpResponse.end();
		}

		// initiate the write
		writeHttpResponse();
	}

	/**
	 * Get data buffer for the specified response entity invoking appropriate
	 * marshaller if necessary.
	 *
	 * @private
	 * @param {module:x2node-ws~ServiceResponse~Entity} entity Response entity.
	 * @returns {external:Buffer} Buffer with the response entity data.
	 */
	_getResponseEntityDataBuffer(entity) {

		if (Buffer.isBuffer(entity.data))
			return entity.data;

		const contentType = entity.headers['content-type'];
		const marshaller = this._marshallers.lookup(contentType.toLowerCase());
		if (!marshaller)
			throw new common.X2UsageError(
				`No marshaller for content type ${contentType}.`);

		return marshaller.serialize(entity.data, contentType);
	}

	/**
	 * Capitalize header names.
	 *
	 * @private
	 * @param {Object.<string,string>} headers Headers to capitalize.
	 * @returns {Object.<string,string>} Capitalized headers.
	 */
	_capitalizeHeaders(headers) {

		return Object.keys(headers).reduce((res, h) => {
			res[this._capitalizeHeaderName(h)] = headers[h];
			return res;
		}, new Object());
	}

	/**
	 * Capitalize header name.
	 *
	 * @private
	 * @param {string} headerName Header name to capitalize.
	 * @returns {string} Capitalized header name.
	 */
	_capitalizeHeaderName(headerName) {

		const headerNameLC = headerName.toLowerCase();

		const normalizedHeaderName = NORMAL_HEADER_NAMES[headerNameLC];
		if (normalizedHeaderName)
			return normalizedHeaderName;

		return headerNameLC.replace(/\b[a-z]/g, m => m.toUpperCase());
	}

	/**
	 * Get HTTP methods supported by the handler.
	 *
	 * @private
	 * @param {module:x2node-ws.Handler} handler The handler.
	 * @returns {Set.<string>} The supported methods.
	 */
	_getHandlerMethods(handler) {

		let methods = handler[METHODS];
		if (!methods) {
			handler[METHODS] = methods = new Set();
			for (let o = handler; o; o = Object.getPrototypeOf(o))
				for (let m of Object.getOwnPropertyNames(o))
					if (((typeof handler[m]) === 'function') &&
						KNOWN_METHODS.has(m))
						methods.add(m);
		}

		return methods;
	}

	/**
	 * Set "Allow" header on the response.
	 *
	 * @private
	 * @param {module:x2node-ws~ServiceResponse} response The response.
	 * @param {Set.<string>} handlerMethods Methods supported by the handler.
	 */
	_setAllowedMethods(response, handlerMethods) {

		const methodsArray = Array.from(handlerMethods);
		methodsArray.push('OPTIONS');
		if (handlerMethods.has('GET'))
			methodsArray.push('HEAD');

		response.addToMethodsListHeader('Allow', methodsArray);
	}
}

// export the class
module.exports = Application;
