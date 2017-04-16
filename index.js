/**
 * Central module for building RESTful web services.
 *
 * @module x2node-webservices
 * @requires module:x2node-common
 */
'use strict';

const Application = require('./lib/application.js');
const ServiceResponse = require('./lib/service-response.js');


/**
 * Node.js <code>http.IncomingMessage</code> object.
 *
 * @external http.IncomingMessage
 * @see {@link https://nodejs.org/dist/latest-v4.x/docs/api/http.html#http_class_http_incomingmessage}
 */
/**
 * Node.js <code>http.ServerResponse</code> object.
 *
 * @external http.ServerResponse
 * @see {@link https://nodejs.org/dist/latest-v4.x/docs/api/http.html#http_class_http_serverresponse}
 */
/**
 * Node.js <code>net.Socket</code> object.
 *
 * @external net.Socket
 * @see {@link https://nodejs.org/dist/latest-v4.x/docs/api/net.html#net_class_net_socket}
 */

/**
 * Application configuration options.
 *
 * @typedef {Object} ApplicationOptions
 * @property {number} connectionIdleTimeout Timeout in milliseconds for
 * inactivity on the HTTP connection when activity is expected from the client.
 * If the timeout occurs before the server starts sending the response, a 408
 * (Request Timeout) response is sent and the connection is closed. If timeout
 * happens after the response headers have been sent, the connection is quitely
 * closed. The default is 30 seconds.
 * @property {number} maxRequestHeadersCount Maximum allowed number of incoming
 * HTTP request headers. The default is 50.
 * @property {number} maxRequestSize Maximum allowed size of request payload in
 * bytes. The default is 2048.
 */

/**
 * Create application the represents the web service. The application must be
 * configured before it's run and starts responding to the incoming requests.
 *
 * @param {module:x2node-webservices~ApplicationOptions} [options] Application
 * configuration options.
 * @returns {module:x2node-webservices~Application} The application.
 */
exports.createApplication = function(options) {

	return new Application(options || {});
};

/**
 * Create new empty response object.
 *
 * @param {number} statusCode HTTP response status code.
 * @returns {module:x2node-webservices~ServiceResponse} Service response object.
 */
exports.createResponse = function(statusCode) {

	return new ServiceResponse(statusCode);
};
