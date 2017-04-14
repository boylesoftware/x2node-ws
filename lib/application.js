'use strict';

const http = require('http');
const stream = require('stream');
const EventEmitter = require('events');
const common = require('x2node-common');

const ServiceCall = require('./service-call.js');
const ServiceResponse = require('./service-response.js');


/**
 * Application shutdown event. Fired after all active HTTP connections has
 * completed.
 *
 * @event module:x2node-webservices~Application#shutdown
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
 * @memberof module:x2node-webservices
 * @inner
 * @extends external:EventEmitter
 * @fires module:x2node-webservices~Application#shutdown
 */
class Application extends EventEmitter {

	/**
	 * <strong>Note:</strong> The constructor is not accessible from the client
	 * code. Instances are created using module's
	 * [createApplication()]{@link module:x2node-webservices.createApplication}
	 * function.
	 *
	 * @protected
	 * @param {module:x2node-webservices~ApplicationOptions} options Application
	 * configuration options.
	 */
	constructor(options) {
		super();

		this._options = options;

		this._log = common.getDebugLogger('X2_APP');

		this._marshallers = new Object();
		this._marshallers['application/json'] = {
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

		//...
	}

	/**
	 * Add marshaller for the content type.
	 *
	 * @param {string} contentType Content type (no character set parameters,
	 * etc.).
	 * @param {module:x2node-webservices.Marshaller} marshaller The marshaller
	 * implementation.
	 * @returns {module:x2node-webservices~Application} This application.
	 */
	addMarshaller(contentType, marshaller) {

		this._marshallers[contentType] = marshaller;

		return this;
	}

	/**
	 * Create HTTP server and run the application on it.
	 *
	 * @param {number} port Port, on which to listen for incoming HTTP requests.
	 */
	run(port) {

		// the debug log
		const log = this._log;
		log('starting up');

		// create HTTP server
		const server = http.createServer();

		// set initial request timeout
		server.setTimeout(
			this._options.initialRequestTimeout || 30000,
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
		function terminate(singalNum) {
			log('shutting down');
			server.close(() => {
				process.exit(128 + singalNum);
			});
		}
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

			// remove the initial request timeout
			httpRequest.connection.setTimeout(0, onInitialRequestTimeout);

			//...
			this._sendResponse(
				httpResponse, call,
				(new ServiceResponse(200)).setHeader('Connection', 'close')/*.setEntity({
					'a': true
					})*/.addAttachment(require('fs').createReadStream('package.json'), 'application/json', 'package.json')
					.addAttachment(require('fs').createReadStream('README.md'), 'text/markdown', 'README.md')
			);

		} catch (err) {
			this._sendInternalServerErrorResponse(httpResponse, call, err);
		}
	}

	/**
	 * Send HTTP 500 (Internal Server Error) response as a reaction to an
	 * unexpected error.
	 *
	 * @private
	 * @param {http.external:ServerResponse} httpResponse HTTP response.
	 * @param {module:x2node-webservices~ServiceCall} call The call.
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
	 * @param {module:x2node-webservices~ServiceCall} call The call.
	 * @param {module:x2node-webservices~ServiceResponse} response The response.
	 */
	_sendResponse(httpResponse, call, response) {

		try {

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
			if (call.authenticator && call.authenticator.addResponseHeaders) {
				// TODO:...
			}

			// default response cache control if none in the service response
			if (!response.hasHeader('Cache-Control') &&
				((method === 'GET') || (method === 'HEAD')) &&
				CACHEABLE_STATUS_CODES.has(response.statusCode)) {
				response
					.setHeader('Cache-Control', 'no-cache')
					.setHeader('Expires', '0')
					.setHeader('Pragma', 'no-cache');
			}

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
	 * @param {module:x2node-webservices~ServiceCall} call The call.
	 * @param {module:x2node-webservices~ServiceResponse} response The response.
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
	 * @param {module:x2node-webservices~ServiceCall} call The call.
	 * @param {module:x2node-webservices~ServiceResponse} response The response.
	 * @param {Array.<module:x2node-webservices~ServiceResponse~Entity>} entities
	 * Entities to send.
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

		// TODO: react on error and close events, set response timeout

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
	 * @param {module:x2node-webservices~ServiceResponse~Entity} entity Response
	 * entity.
	 * @returns {external:Buffer} Buffer with the response entity data.
	 */
	_getResponseEntityDataBuffer(entity) {

		if (Buffer.isBuffer(entity.data))
			return entity.data;

		const contentType = entity.headers['content-type'];
		const marshaller = this._marshallers[contentType];
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
}

// export the class
module.exports = Application;
