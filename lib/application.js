'use strict';

const http = require('http');
const EventEmitter = require('events');
const common = require('x2node-common');


/**
 * Application shutdown event. Fired after all active HTTP connections has
 * completed.
 *
 * @event module:x2node-webservices~Application#shutdown
 * @type {string}
 */

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
	 * @param {module:x2node-webservices~ApplicationOptions} options Application
	 * configuration options.
	 */
	constructor(options) {
		super();

		this._options = options;

		this._log = common.getDebugLogger('X2_APP');

		//...
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
			socket => {
				socket.end(
					'HTTP/1.1 408 Request Timeout\r\n' +
						'Date: ' + (new Date()).toUTCString() + '\r\n' +
						'Connection: close\r\n' +
						'\r\n');
			}
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

	_respond(request, response) {

		//...
	}
}

// export the class
module.exports = Application;
