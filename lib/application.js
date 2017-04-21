'use strict';

const http = require('http');
const stream = require('stream');
const EventEmitter = require('events');
const common = require('x2node-common');

const ServiceCall = require('./service-call.js');
const ServiceResponse = require('./service-response.js');
const AuthenticatorsMapper = require('./authenticators-mapper.js');
const EndpointsMapper = require('./endpoints-mapper.js');


/**
 * Application shutdown event. Fired after all active HTTP connections has
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
 * Multipart HTTP response boundary.
 *
 * @private
 * @constant {string}
 */
const BOUNDARY = 'x2node_boundary_gc0p4Jq0M2Yt08j34c0p';

const BOUNDARY_MID = new Buffer('--' + BOUNDARY + '\r\n', 'ascii');
const BOUNDARY_END = new Buffer('--' + BOUNDARY + '--', 'ascii');
const CRLF = new Buffer('\r\n', 'ascii');

/**
 * Default connection idle timeout.
 *
 * @private
 * @constant {number}
 */
const DEFAULT_CONN_IDLE_TIMEOUT = 30000;

const DEFAULT_MAX_REQUEST_SIZE = 2048;

/**
 * Used to store list of supported methods on a handler.
 *
 * @private
 * @constant {Symbol}
 */
const METHODS = Symbol('METHODS');

/**
 * Known HTTP methods.
 *
 * @private
 * @constant {Set.<string>}
 */
const KNOWN_METHODS = new Set(http.METHODS);

/**
 * Callback on the initial request timeout.
 *
 * @private
 * @param {net.external:Socket} socket The connection socket.
 */
function onInitialRequestTimeout(socket) {

	socket.end(
		'HTTP/1.1 408 ' + http.STATUS_CODES[408] + '\r\n' +
			'Date: ' + (new Date()).toUTCString() + '\r\n' +
			'Connection: close\r\n' +
			'\r\n');
}

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

		// the debug log
		this._log = common.getDebugLogger('X2_APP');

		// setup default marshallers
		this._marshallers = new Map();
		const jsonMarshaller = {
			serialize(obj) {
				return new Buffer(JSON.stringify(obj));
			},
			deserialize(data) {
				try {
					return JSON.parse(data.toString());
				} catch (err) {
					if (err instanceof SyntaxError)
						throw new common.X2DataError(
							`Invalid JSON: ${err.message}`);
					throw err;
				}
			}
		};
		this._marshallers.set('application/json', jsonMarshaller);
		this._marshallers.set('application/json-patch+json', jsonMarshaller);
		this._marshallers.set('application/merge-patch+json', jsonMarshaller);

		// authenticators and endpoints collections
		this._authenticators = new Map();
		this._endpoints = new Map();

		// application running state
		this._running = false;
		this._shuttingDown = false;
	}

	/**
	 * Add marshaller for the content type.
	 *
	 * @param {string} contentType Content type (no character set parameters,
	 * etc.).
	 * @param {module:x2node-ws.Marshaller} marshaller The marshaller
	 * implementation.
	 * @returns {module:x2node-ws~Application} This application.
	 */
	addMarshaller(contentType, marshaller) {

		if (this._running)
			throw new common.X2UsageError('Application is already running.');

		this._marshallers.set(contentType, marshaller);

		return this;
	}

	/**
	 * Associate an authenticator with the specified URI pattern.
	 *
	 * @param {string} uriPattern URI regular expression pattern.
	 * @param {module:x2node-ws.Authenticator} authenticator The authenticator.
	 * @returns {module:x2node-ws~Application} This application.
	 */
	addAuthenticator(uriPattern, authenticator) {

		if (this._running)
			throw new common.X2UsageError('Application is already running.');

		this._authenticators.set(uriPattern, authenticator);

		return this;
	}

	/**
	 * Add web service endpoint.
	 *
	 * @param {string} uriPattern Endpoint URI regular expression pattern. URI
	 * parameters are groups in the pattern.
	 * @param {module:x2node-ws.Handler} handler The handler for the endpoint.
	 * @returns {module:x2node-ws~Application} This application.
	 */
	addEndpoint(uriPattern, handler) {

		if (this._running)
			throw new common.X2UsageError('Application is already running.');

		this._endpoints.set(uriPattern, {
			handler: handler,
			numUriParams:
			(new RegExp(`^(?:${uriPattern})?$`)).exec('').length - 1
		});

		return this;
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

		// compile authenticator and endpoint mappings
		this._authenticators = new AuthenticatorsMapper(this._authenticators);
		this._endpoints = new EndpointsMapper(this._endpoints);

		// create HTTP server
		const server = http.createServer();

		// set initial request timeout
		server.setTimeout(
			this._options.connectionIdleTimeout || DEFAULT_CONN_IDLE_TIMEOUT,
			onInitialRequestTimeout
		);

		// set maximum allowed number of HTTP request headers
		server.maxHeadersCount = (this._options.maxRequestHeadersCount || 50);

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
			log(`ready for requests on ${port}`);
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

		// create the service call object
		const call = new ServiceCall(httpRequest);

		// process the call
		try {

			// log the call
			this._log(
				`received call #${call.id}: ${httpRequest.method}` +
					` ${call.requestUrl.pathname}`);

			// remove the initial request timeout
			httpRequest.connection.setTimeout(0, onInitialRequestTimeout);

			// lookup the handler
			if (!this._endpoints.lookup(call))
				return this._sendResponse(
					httpResponse, call, (new ServiceResponse(404).setEntity({
						errorCode: 'X2-404-1',
						errorMessage: 'No service endpoint at this URI.'
					})));

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

			// lookup the authenticator
			this._authenticators.lookup(call);

			// build the processing chain
			this._authenticateCall(call).then(
				call => {
					this._log(
						`authenticated actor:` +
							` ${call.actor && call.actor.stamp}`);
					try {
						return this._readRequestPayload(call, httpResponse);
					} catch (err) {
						return Promise.reject(err);
					}
				},
				err => Promise.reject(err)
			).then(
				call => {
					try {
						return Promise.resolve(call.handler[method](call));
					} catch (err) {
						return Promise.reject(err);
					}
				},
				err => Promise.reject(err)
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
				},
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

				// set actor on the call
				if (actor)
					call.actor = actor;

				// ask handler if the actor is allowed to make the call
				if (call.handler.isAllowed && !call.handler.isAllowed(call))
					return Promise.reject(
						actor ?
							(new ServiceResponse(403)).setEntity({
								errorCode: 'X2-403-1',
								errorMessage: 'Insufficient permissions.'
							}) :
							(new ServiceResponse(401)).setEntity({
								errorCode: 'X2-401-1',
								errorMessage: 'Authentication required.'
							})
					);

				// proceed with the call
				return call;
			},
			err => Promise.reject(err)
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

		// check if multipart
		if (/^multipart\//i.test(contentType)) {

			// TODO: implement
			return Promise.reject((new ServiceResponse(415)).setEntity({
				errorCode: 'X2-415',
				errorMessage: 'Unsupported request entity content type.'
			}));

		} else { // not multipart

			// find marshaller
			const entityContentType = contentType.split(';')[0].toLowerCase();
			const marshaller = this._marshallers.get(entityContentType);
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
				call.httpRequest, marshaller, contentType, maxRequestSize).then(
					entity => {
						call.entity = entity;
						call.entityContentType = entityContentType;
						return call;
					},
					err => Promise.reject(err)
				);
		}
	}

	/**
	 * Read and parse entity from input stream.
	 *
	 * @private
	 * @param {stream.external:Readable} input Input stream.
	 * @param {module:x2node-ws.Marshaller} marshaller Marshaller to use to parse
	 * the entity.
	 * @param {string} contentType Content type request header value.
	 * @param {number} maxSize Maximum size in bytes to allow to read.
	 * @returns {Promise.<Object>} Promise of the parsed entity object.
	 */
	_readEntity(input, marshaller, contentType, maxSize) {

		return new Promise((resolve, reject) => {

			const dataBufs = new Array();
			let bytesRead = 0;
			input
				.on('data', chunk => {
					// TODO: check if needed or Node handles it
					if ((bytesRead += chunk.length) > maxSize) {
						input.pause();
						return reject(
							(new ServiceResponse(413))
								.setHeader('Connection', 'close')
								.setEntity({
									errorCode: 'X2-413',
									errorMessage: 'The request entity is too large.'
								}));
					}
					dataBufs.push(chunk);
				})
				.on('close', () => {
					this._log('connection unexpectedly closed by the client');
					reject(null);
				})
				.on('error', err => {
					reject(err);
				})
				.on('end', () => {
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
		});
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

		// add "Accept-Patch" header
		if (allowedMethods.has('PATCH')) {
			// TODO: implement
		}

		// add zero content length header
		response.setHeader('Content-Length', 0);

		// response always varies depending on the "Origin" header
		response.setHeader('Vary', 'Origin');

		// process CORS preflight request
		const requestHeaders = call.httpRequest.headers;
		const origin = requestHeaders['origin'];
		const requestedMethod = requestHeaders['access-control-request-method'];
		if (origin && requestedMethod) {
			// TODO:...
		}

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

		try {

			// restore idle timeout on the connection
			httpResponse.setTimeout(
				this._options.connectionIdleTimeout || DEFAULT_CONN_IDLE_TIMEOUT,
				socket => {
					if (!call.complete)
						common.error(
							'connection timed out before completing the' +
								' response');
					socket.destroy();
				}
			);

			// get the basics for quick access
			const method = call.httpRequest.method;
			const requestHeaders = call.httpRequest.headers;

			// response always varies depending on the "Origin" header
			response.addToHeadersListHeader('Vary', 'Origin');

			// add CORS headers if cross-origin request
			const origin = requestHeaders['origin'];
			if (origin) {
				// TODO:...
			}

			// let authenticator to add its response headers
			if (call.authenticator && call.authenticator.addResponseHeaders)
				call.authenticator.addResponseHeaders(call, response);

			// default response cache control if none in the service response
			if (!response.hasHeader('Cache-Control') &&
				((method === 'GET') || (method === 'HEAD')) &&
				CACHEABLE_STATUS_CODES.has(response.statusCode)) {
				response
					.setHeader('Cache-Control', 'no-cache')
					.setHeader('Expires', '0')
					.setHeader('Pragma', 'no-cache');
			}

			// completion handler
			httpResponse.on('finish', () => {
				call.complete = true;
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
						'Content-Type', 'multipart/mixed; boundary=' + BOUNDARY);
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
				httpResponse.connection.destroy();
			} else {
				common.error(
					'internal error preparing response, sending 500 response',
					err);
				try {
					httpResponse.connection.end(
						'HTTP/1.1 500 ' + http.STATUS_CODES[500] + '\r\n' +
							'Date: ' + (new Date()).toUTCString() + '\r\n' +
							'Connection: close\r\n' +
							'\r\n');
				} catch (errorResponseErr) {
					common.error(
						'internal error sending 500 response,' +
							' quitely closing the connection', errorResponseErr);
					httpResponse.connection.destroy();
				}
			}
		}
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

		// TODO: react on error and close events

		// write response body buffers and streams
		const numBufs = bufs.length;
		let curBufInd = 0;
		function writeHttpResponse() {
			while (curBufInd < numBufs) {
				const data = bufs[curBufInd++];
				if (Buffer.isBuffer(data)) {
					if (!httpResponse.write(data)) {
						httpResponse.once('drain', writeHttpResponse);
						return;
					}
				} else { // stream
					data.pipe(httpResponse, { end: false });
					data.on('end', writeHttpResponse);
					return;
				}
			}
			httpResponse.end();
		}
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
		const marshaller = this._marshallers.get(contentType);
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

		return headerName.toLowerCase()
			.replace(/\b[a-z]/g, m => m.toUpperCase());
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
