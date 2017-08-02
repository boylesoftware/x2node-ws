'use strict';

const common = require('x2node-common');


/**
 * HTTP entity descriptor.
 *
 * @typedef {Object} module:x2node-ws~ServiceResponse~Entity
 * @property {Object.<string,string>} headers HTTP response headers associated
 * with the entity (such as "content-type" and "content-disposition"). All header
 * names are lowercase.
 * @property {(Object|external:Buffer|stream.external:Readable)} data The entity
 * data.
 */

/**
 * Web-service response. An instance is usually returned by an enpoint handler
 * and is used by the framework to construct the HTTP response and send it back
 * to the client.
 *
 * @memberof module:x2node-ws
 * @inner
 */
class ServiceResponse {

	/**
	 * <strong>Note:</strong> The constructor is not accessible from the client
	 * code. Instances are created using module's
	 * [createResponse()]{@link module:x2node-ws.createResponse} function.
	 *
	 * @protected
	 * @param {number} statusCode HTTP response status code.
	 */
	constructor(statusCode) {

		if (!Number.isInteger(statusCode))
			throw new common.X2UsageError(`Invalid status code: ${statusCode}.`);

		this._statusCode = statusCode;

		this._headers = new Object();
		this._entity = null;
		this._attachments = null;
	}

	/**
	 * Add header to the HTTP response. Any existing value is replaced.
	 *
	 * @param {string} name HTTP response header name, case-insensitive.
	 * @param {*} value The value. If the value is a <code>Date</code>, it is
	 * converted to string using <code>Date.toUTCString()</code> method.
	 * Otherwise, <code>String()</code> is used to convert it to string. If value
	 * is <code>null</code>, any existing header is removed instead.
	 * @returns {module:x2node-ws~ServiceResponse} This response object.
	 */
	setHeader(name, value) {

		if (value === null)
			delete this._headers[name.toLowerCase()];
		else
			this._headers[name.toLowerCase()] = (
				value instanceof Date ? value.toUTCString() : String(value));

		return this;
	}

	/**
	 * Add value(s) to an HTTP response header that is a list of other header
	 * names. Examples of such headers are "Vary", "Access-Control-Allow-Headers"
	 * and "Access-Control-Expose-Headers". The method checks if the headers are
	 * already present in the current value and does not add them twice.
	 *
	 * @param {string} name HTTP response header name, case-insensitive.
	 * @param {(string|Array.<string>)} value Header(s) to add. Multiple headers
	 * can be specified as an array of in a comma-separated string. The case of
	 * the headers is not important as all the values are automatically
	 * normalized.
	 * @returns {module:x2node-ws~ServiceResponse} This response object.
	 */
	addToHeadersListHeader(name, value) {

		const nameLC = name.toLowerCase();
		const curVal = this._headers[nameLC];
		const values = new Set(curVal && curVal.split(', '));

		const valuesToAdd = (
			Array.isArray(value) ?
				value :
				String(value).trim().split(/\s*,\s*/)
		);
		for (let v of valuesToAdd)
			values.add(String(v).toLowerCase().replace(
					/\b[a-z]/g, m => m.toUpperCase()));

		this._headers[nameLC] = Array.from(values).join(', ');

		return this;
	}

	/**
	 * Add value(s) to an HTTP response header that is a list of HTTP methods.
	 * Examples of such headers are "Allow" and "Access-Control-Allow-Methods".
	 * The method checks if the methods are already present in the current value
	 * and does not add them twice.
	 *
	 * @param {string} name HTTP response header name, case-insensitive.
	 * @param {(string|Array.<string>)} value Method(s) to add. Multiple methods
	 * can be specified as an array or in a comma-separated string. The case of
	 * the methods is not important as all the values are automatically
	 * upper-cased.
	 * @returns {module:x2node-ws~ServiceResponse} This response object.
	 */
	addToMethodsListHeader(name, value) {

		const nameLC = name.toLowerCase();
		const curVal = this._headers[nameLC];
		const values = new Set(curVal && curVal.split(', '));

		const valuesToAdd = (
			Array.isArray(value) ?
				value :
				String(value).trim().split(/\s*,\s*/)
		);
		for (let v of valuesToAdd)
			values.add(String(v).toUpperCase());

		this._headers[nameLC] = Array.from(values).join(', ');

		return this;
	}

	/**
	 * Add main entity to the response. Only one entity can be added to a
	 * response.
	 *
	 * <p>The entity data can be provided in one of the three forms an object, a
	 * buffer or a readable stream. If an object is provided, it is serialized
	 * according to the <code>contentType</code> argument. If buffer is provided,
	 * its binary data is sent as-is. In either of these cases the response is
	 * sent synchronously all at once. However, if data is provided as a stream,
	 * the response is sent asynchronously using HTTP "chunked" transfer
	 * encoding.
	 *
	 * @param {(Object|external:Buffer|stream.external:Readable)} data The entity
	 * data.
	 * @param {string} [contentType=application/json] Content type. If omitted,
	 * "application/json" is assumed.
	 * @returns {module:x2node-ws~ServiceResponse} This response object.
	 */
	setEntity(data, contentType) {

		if (((typeof data) !== 'object') || (data === null))
			throw new common.X2UsageError('Invalid entity data.');

		this._entity = {
			data: data,
			headers: {
				'content-type': (
					(((typeof contentType) === 'string') && contentType) ||
						'application/json')
			}
		};

		return this;
	}

	/**
	 * Add attachment to the response. Multiple attachments can be added to a
	 * response with or without the main entity.
	 *
	 * <p>If a response has entity and attachments or just more than one
	 * attachment, the HTTP response is sent with content type "multipart/mixed".
	 * The parts are included in the response payload in the order they were
	 * added with the main entity, if any, always first.
	 *
	 * <p>As with the main entity, the attachment data can be provided as an
	 * object, as a buffer or as a readable stream (which will trigger "chunked"
	 * HTTP response encoding).
	 *
	 * @param {(Object|external:Buffer|stream.external:Readable)} data The
	 * attachment data.
	 * @param {string} [contentType=application/json] Content type. If omitted,
	 * "application/json" is assumed.
	 * @param {string} [filename] Optional filename associated with the
	 * attachment.
	 * @returns {module:x2node-ws~ServiceResponse} This response object.
	 */
	addAttachment(data, contentType, filename) {

		if (((typeof data) !== 'object') || (data === null))
			throw new common.X2UsageError('Invalid attachment data.');

		if (!this._attachments)
			this._attachments = new Array();

		const headers = {
			'content-type': (
				(((typeof contentType) === 'string') && contentType) ||
					'application/json'),
			'content-disposition': 'attachment' +
				(filename ? '; filename="' + String(filename) + '"' : '')
		};

		this._attachments.push({
			data: data,
			headers: headers
		});

		return this;
	}

	/**
	 * HTTP response status code.
	 *
	 * @member {number}
	 * @readonly
	 */
	get statusCode() { return this._statusCode; }

	/**
	 * Tell if the response contains the specified HTTP response header.
	 *
	 * @param {string} name HTTP response header name, case-insensitive.
	 * @returns {boolean} <code>true</code> if contains the header.
	 */
	hasHeader(name) { return (this._headers[name.toLowerCase()] !== undefined); }

	/**
	 * HTTP response headers. All header names are lowercase.
	 *
	 * @member {Object.<string,string>}
	 * @readonly
	 */
	get headers() { return this._headers; }

	/**
	 * All response entities and attachments in the correct order, or empty
	 * array if none.
	 *
	 * @member {Array.<module:x2node-ws~ServiceResponse~Entity>}
	 * @readonly
	 */
	get entities() {

		const res = new Array();
		if (this._entity)
			res.push(this._entity);
		if (this._attachments)
			for (let attachment of this._attachments)
				res.push(attachment);

		return res;
	}
}

// export the class
module.exports = ServiceResponse;
