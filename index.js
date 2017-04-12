/**
 * Central module for building RESTful web services.
 *
 * @module x2node-webservices
 */
'use strict';

const Application = require('./lib/application.js');


/**
 * Application configuration options.
 *
 * @typedef {Object} ApplicationOptions
 * @property {number} initialRequestTimeout Timeout in milliseconds for the
 * client to issue the HTTP request complete with headers after opening
 * connection to the web service. The default is 30 seconds.
 * @property {number} maxRequestHeadersCount Maximum allowed number of incoming
 * HTTP request headers. The default is 50.
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
